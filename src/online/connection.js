import { WS_PROD_BASE_URL } from '../config/index.js';
/**
/**
 * OnlineConnection encapsulates the WebSocket lifecycle for Color Clash, providing
 * an event-driven API so UI/game logic can react to online state changes without
 * implementing low-level socket details (parsing, reconnect backoff, routing).
 *
 * Design goals:
 *  1. Fire-and-forget send helpers – calling code does not need to await connectivity;
 *     messages are sent only if the socket is currently OPEN.
 *  2. Automatic exponential backoff reconnection with ceiling – avoids hammering the server.
 *  3. Simple pub/sub contract – consumers use .on/.off and never touch raw ws handlers.
 *  4. Minimal assumptions about server protocol – only routes known `type` fields.
 *
 * Event names & payloads:
 *  - 'open' (): Socket successfully opened.
 *  - 'close' ({ wasEverOpened:boolean }): Socket closed (may trigger reconnect scheduling afterward).
 *  - 'reconnect_scheduled' ({ delay:number }): A reconnect attempt will occur after `delay` ms.
 *  - 'packet_retry_started' ({ packetKey:string }): First retry of a packet started.
 *  - 'packet_confirmed' ({ packetKey:string, retryCount:number }): Packet confirmed by server.
 *  - 'hosted' (HostedMessage): Host confirmation for newly created room.
 *  - 'roomlist' (Record<string, RoomListEntry>): Updated list of rooms.
 *  - 'started' (StartedMessage): Game start information (players, grid size, colors).
 *  - 'request_preferred_colors' (): Server asks client to provide a preferred color.
 *  - 'joined' (JoinedMessage): Confirmation that this client joined a room.
 *  - 'left' (LeftMessage): Notification that a player (possibly us) left the room.
 *  - 'roomupdate' (RoomUpdateMessage): Player list / occupancy changes.
 *  - 'move' (MoveMessage): A game move broadcast.
 *  - 'rejoined' (RejoinedMessage): State catch-up after reconnect.
 *  - 'error' (ErrorMessage): Server-side validation or protocol error.
 *
 * Public surface:
 *  - connect(), ensureConnected(), disconnect()
 *  - host({ roomName, maxPlayers, gridSize, debugName })
 *  - join(roomName, debugName)
 *  - joinByKey(roomKey, debugName)
 *  - leave(roomName?)
 *  - start(gridSize?)
 *  - sendPreferredColor(color)
 *  - sendMove({ row, col, fromIndex, nextIndex, color })
 *  - requestRoomList()
 *  - on(event, handler), off(event, handler)
 *  - isConnected(), wasEverOpened()
 *
 * Error handling philosophy:
 *  - Internal failures (JSON parse, handler exceptions) are caught & logged.
 *  - Unknown message `type` is logged (debug mode only) and ignored.
 *  - Sending while disconnected is silently ignored.
 *
 * @typedef {{name:string}} PlayerEntry
 * @typedef {{currentPlayers:number, maxPlayers:number, players?:PlayerEntry[], hostName?:string}} RoomListEntry
 * @typedef {{type:'hosted', room:string, roomKey?:string, maxPlayers?:number, player?:string}} HostedMessage
 * @typedef {{type:'roomlist', rooms:Record<string, RoomListEntry>}} RawRoomListMessage
 * @typedef {{type:'started', players:string[], gridSize?:number, colors?:string[]}} StartedMessage
 * @typedef {{type:'joined', room:string, roomKey?:string, players?:PlayerEntry[], maxPlayers?:number, gridSize?:number, player?:string}} JoinedMessage
 * @typedef {{type:'left', room?:string, player?:string}} LeftMessage
 * @typedef {{type:'roomupdate', room:string, players:PlayerEntry[]}} RoomUpdateMessage
 * @typedef {{type:'move', room?:string, row:number, col:number, fromIndex:number, nextIndex:number, color:string, seq?:number}} MoveMessage
 * @typedef {{type:'rejoined', room?:string, roomKey?:string, players?:PlayerEntry[], recentMoves?:MoveMessage[], maxPlayers?:number}} RejoinedMessage
 * @typedef {{type:'error', error:string}} ErrorMessage
 * @typedef {{initialBackoffMs?:number, maxBackoffMs?:number, getWebSocketUrl?:()=>string, debug?:boolean}} OnlineConnectionOptions
 */
export class OnlineConnection {
	/**
	 * Create a new OnlineConnection instance.
	 * @param {OnlineConnectionOptions} [options]
	 * @param {number} [options.initialBackoffMs=800] Initial reconnect delay in ms.
	 * @param {number} [options.maxBackoffMs=10000] Maximum backoff delay ceiling in ms.
	 * @param {() => string} [options.getWebSocketUrl] Optional provider for dynamic WS base URL.
	 * @param {boolean} [options.debug=false] Enable verbose debug logging.
	 */
	constructor({ initialBackoffMs = 800, maxBackoffMs = 10000, getWebSocketUrl, debug = false } = {}) {
		this._initialBackoffMs = initialBackoffMs;
		this._maxBackoffMs = maxBackoffMs;
		this._backoffMs = initialBackoffMs;
		this._ws = null;
		this._reconnectTimer = null;
		this._everOpened = false;
		this._events = new Map();
		this._debug = debug;
		this._getWebSocketUrl = typeof getWebSocketUrl === 'function' ? getWebSocketUrl : () => this._defaultUrl();
		// Generic packet retry tracking: Map of packetKey -> {packet, retryTimer, backoffMs, retryCount, responseType}
		this._pendingPackets = new Map();
		// Track if this client initiated a start request (is host)
		this._initiatedStart = false;
	}

	/** @private */
	_log(...args) { if (this._debug) console.debug('[OnlineConnection]', ...args); }

	/**
	 * Check if any packets are currently being retried.
	 * @returns {boolean}
	 */
	hasRetryingPackets() {
		for (const pending of this._pendingPackets.values()) {
			if (pending.retryCount > 0) return true;
		}
		return false;
	}

	/**
	 * Emit an event to all registered handlers.
	 * @private
	 * @param {string} name Event name.
	 * @param {*} payload Arbitrary event payload.
	 */
	_emit(name, payload) {
		const handlers = this._events.get(name);
		if (handlers) {
			for (const fn of [...handlers]) {
				try { fn(payload); } catch (e) { console.error('[OnlineConnection] handler error', e); }
			}
		}
	}

	/**
	 * Subscribe to a connection event.
	 * @param {string} name Event name.
	 * @param {(payload:any)=>void} handler Callback invoked with event payload.
	 */
	on(name, handler) {
		if (!this._events.has(name)) this._events.set(name, new Set());
		this._events.get(name).add(handler);
	}

	/**
	 * Unsubscribe a previously registered handler.
	 * @param {string} name Event name.
	 * @param {(payload:any)=>void} handler Same function reference passed to on().
	 */
	off(name, handler) {
		const set = this._events.get(name);
		if (set) set.delete(handler);
	}

	/**
	 * Whether the underlying WebSocket is currently OPEN.
	 * @returns {boolean}
	 */
	isConnected() { return !!(this._ws && this._ws.readyState === WebSocket.OPEN); }

	/**
	 * Indicates if the socket has reached OPEN state at least once in its lifetime.
	 * @returns {boolean}
	 */
	wasEverOpened() { return this._everOpened; }

	/**
	 * Initiate a connection if not already OPEN or CONNECTING.
	 * Sets up message routing and schedules reconnect on close.
	 */
	connect() {
		if (this._ws && (this._ws.readyState === WebSocket.OPEN || this._ws.readyState === WebSocket.CONNECTING)) return;
		const url = this._getWebSocketUrl();
		this._log('connecting to', url);
		try { this._ws = new WebSocket(url); } catch (e) { this._log('connect failed immediate', e); this._scheduleReconnect(); return; }
		const ws = this._ws;
		ws.onopen = () => {
			this._log('open');
			this._everOpened = true;
			this._backoffMs = this._initialBackoffMs;
			if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
			this._emit('open');
			this.requestRoomList();
		};
		ws.onmessage = (evt) => {
			let msg; try { msg = JSON.parse(evt.data); } catch { return; }
			const type = msg.type;
			switch (type) {
				case 'hosted':
					this._cancelPendingPacket('host');
					this._emit('hosted', msg);
					break;
				case 'roomlist':
					this._cancelPendingPacket('list');
					this._emit('roomlist', msg.rooms || {});
					break;
				case 'started':
					this._cancelPendingPacket('start');
					this._cancelPendingPacket('start_timeout');
					this._cancelPendingPacket('preferred_color');
					this._emit('started', msg);
					break;
				case 'request_preferred_colors':
					// For host: this confirms server received start request
					this._cancelPendingPacket('start');
					// Now wait for 'started' - if it doesn't come, a color packet was lost
					this._scheduleStartTimeout();
					this._emit('request_preferred_colors');
					break;
				case 'joined':
					this._cancelPendingPacket(`join:${msg.room}`);
					if (msg.roomKey) this._cancelPendingPacket(`join_by_key:${msg.roomKey}`);
					this._emit('joined', msg);
					break;
				case 'left': this._emit('left', msg); break;
				case 'roomupdate': this._emit('roomupdate', msg); break;
				case 'move':
					// Cancel retry timer for this move if it matches a pending packet
					this._cancelPendingPacket(`move:${msg.fromIndex}:${msg.row}:${msg.col}`);
					this._emit('move', msg);
					break;
				case 'rejoined':
					this._cancelPendingPacket(`reconnect:${msg.room}`);
					this._emit('rejoined', msg);
					break;
				case 'error': {
					// Cancel join_by_key retries if room not found or full
					const errStr = String(msg.error || '');
					if (errStr.includes('Room not found') || errStr.includes('full') || errStr.includes('already started')) {
						// Cancel all pending join_by_key packets
						for (const key of this._pendingPackets.keys()) {
							if (key.startsWith('join_by_key:')) {
								this._cancelPendingPacket(key);
							}
						}
					}
					this._emit('error', msg);
					break;
				}
				default: this._log('unhandled message type', type);
			}
		};
		ws.onerror = () => { this._log('socket error'); };
		ws.onclose = () => {
			this._emit('close', { wasEverOpened: this._everOpened });
			this._scheduleReconnect();
		};
	}

	/**
	 * Convenience helper to connect only when not already connected.
	 */
	ensureConnected() { if (!this.isConnected()) this.connect(); }

	/**
	 * Manually close the socket and cancel any pending reconnect timer.
	 */
	disconnect() {
		if (this._ws) {
			try { this._ws.close(); } catch { /* ignore */ }
		}
		if (this._reconnectTimer) { clearTimeout(this._reconnectTimer); this._reconnectTimer = null; }
		this._clearPendingPackets();
	}

	/**
	 * Clear all pending packet retry timers.
	 * @private
	 */
	_clearPendingPackets() {
		for (const pending of this._pendingPackets.values()) {
			if (pending.retryTimer) clearTimeout(pending.retryTimer);
		}
		this._pendingPackets.clear();
	}

	/**
	 * Internal exponential backoff scheduling. Emits 'reconnect_scheduled'.
	 * @private
	 */
	_scheduleReconnect() {
		if (this._reconnectTimer) return;
		const delay = Math.min(this._backoffMs, this._maxBackoffMs);
		this._log('schedule reconnect in', delay, 'ms');
		this._emit('reconnect_scheduled', { delay });
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			this.connect();
			this._backoffMs = Math.min(this._backoffMs * 1.5, this._maxBackoffMs);
		}, delay);
	}

	/**
	 * Low-level send wrapper. Ensures connection first then sends if OPEN.
	 * Silently ignores if still not OPEN after ensure.
	 * @private
	 * @param {object} obj Serializable object payload.
	 */
	_sendPayload(obj) {
		// Debug: 50% chance to drop any outgoing packet
		if (Math.random() < 0.5) {
			console.warn('[Debug] Dropping outgoing packet (simulated packet loss)', obj);
			return;
		}
		try {
			this.ensureConnected();
			if (this._ws && this._ws.readyState === WebSocket.OPEN) {
				this._ws.send(JSON.stringify(obj));
			}
		} catch (e) { this._log('send failed', e); }
	}

	/** Request latest room list. */
	requestRoomList() {
		const packet = { type: 'list' };
		this._sendWithRetry('list', packet, 'roomlist');
	}

	/** Host a new room.
	 * @param {{roomName:string, maxPlayers:number, gridSize?:number, debugName?:string}} p
	 */
	host({ roomName, maxPlayers, gridSize, debugName }) { this._sendPayload({ type: 'host', roomName, maxPlayers, gridSize, debugName }); }

	/** Join an existing room by name.
	 * @param {string} roomName
	 * @param {string} debugName Client name (display/debug only)
	 */
	join(roomName, debugName) { this._sendPayload({ type: 'join', roomName, debugName }); }

	/** Join a room using its key.
	 * @param {string} roomKey
	 * @param {string} debugName Client name
	 */
	joinByKey(roomKey, debugName) {
		const packet = { type: 'join_by_key', roomKey, debugName };
		this._sendWithRetry(`join_by_key:${roomKey}`, packet, 'joined');
	}

	/** Leave a room (roomName optional if server infers current room).
	 * @param {string} [roomName]
	 */
	leave(roomName) { this._sendPayload({ type: 'leave', roomName }); }

	/** Start the game (host only). Optionally override gridSize.
	 * @param {number} [gridSize]
	 */
	start(gridSize) {
		const payload = { type: 'start' };
		if (Number.isInteger(gridSize)) payload.gridSize = gridSize;
		// Store gridSize for retry and mark this client as host
		this._lastStartGridSize = gridSize;
		this._initiatedStart = true;
		this._sendWithRetry('start', payload, 'request_preferred_colors');
	}

	/** Send preferred color selection.
	 * @param {string} color
	 */
	sendPreferredColor(color) {
		this._sendWithRetry('preferred_color', { type: 'preferred_color', color }, 'started');
	}

	/** Broadcast a move.
	 * @param {{row:number, col:number, fromIndex:number, nextIndex:number, color:string}} move
	 */
	sendMove({ row, col, fromIndex, nextIndex, color }) {
		const moveKey = `move:${fromIndex}:${row}:${col}`;
		const packet = { type: 'move', row, col, fromIndex, nextIndex, color };
		this._sendWithRetry(moveKey, packet, 'move');
	}

	/**
	 * Send a packet with automatic retry on no response.
	 * @private
	 * @param {string} packetKey - Unique key for this packet
	 * @param {object} packet - The packet to send
	 * @param {string} expectedResponseType - The message type expected as confirmation
	 */
	_sendWithRetry(packetKey, packet, expectedResponseType) {
		// Cancel any existing retry for this packet
		if (this._pendingPackets.has(packetKey)) {
			const existing = this._pendingPackets.get(packetKey);
			if (existing.retryTimer) clearTimeout(existing.retryTimer);
		}

		// Send the packet
		this._sendPayload(packet);

		const backoffMs = this._initialBackoffMs;
		const retryTimer = setTimeout(() => {
			this._retryPacket(packetKey);
		}, backoffMs);

		this._pendingPackets.set(packetKey, {
			packet,
			retryTimer,
			backoffMs,
			retryCount: 0,
			expectedResponseType
		});
	}

	/**
	 * Retry sending a packet with exponential backoff.
	 * @private
	 * @param {string} packetKey
	 */
	_retryPacket(packetKey) {
		const pending = this._pendingPackets.get(packetKey);
		if (!pending) return;

		pending.retryCount++;
		const nextBackoff = Math.min(pending.backoffMs * 2, this._maxBackoffMs);
		pending.backoffMs = nextBackoff;

		// Emit event on first retry to trigger UI feedback
		if (pending.retryCount === 1) {
			this._emit('packet_retry_started', { packetKey });
		}

		// Special logic for 'start' packet: only resend if starting conditions are still met
		if (packetKey === 'start') {
			// These variables are defined in the main script.js scope
			// We'll use window-scoped variables to check conditions
			const inRoom = !!window.myJoinedRoom;
			const isFull = inRoom && Number.isFinite(window.myRoomMaxPlayers) && window.myRoomCurrentPlayers >= window.myRoomMaxPlayers;
			let hostName = null;
			if (window.lastRoomList && window.myJoinedRoom && window.lastRoomList[window.myJoinedRoom] && window.lastRoomList[window.myJoinedRoom].hostName) {
				hostName = window.lastRoomList[window.myJoinedRoom].hostName;
			} else if (Array.isArray(window.myRoomPlayers) && window.myRoomPlayers[0] && window.myRoomPlayers[0].name) {
				hostName = window.myRoomPlayers[0].name;
			}
			const isHost = inRoom && window.myPlayerName && hostName && (window.myPlayerName === hostName);
			if (!(inRoom && isFull && isHost)) {
				this._log('Cancelling start retry: starting conditions not met');
				this._cancelPendingPacket('start');
				return;
			}
		}
		
		// Special logic for 'join_by_key' packet: only resend if we haven't already joined a room
		if (packetKey.startsWith('join_by_key:')) {
			// If we successfully joined, myJoinedRoom will be set and we should stop retrying
			if (window.myJoinedRoom) {
				this._log('Cancelling join_by_key retry: already joined a room');
				this._cancelPendingPacket(packetKey);
				return;
			}
			// Continue retrying - the server will send an error if room doesn't exist or is full
		}
		this._log(`Retrying packet ${packetKey} (attempt ${pending.retryCount})`);
		this._sendPayload(pending.packet);
		// Schedule next retry
		pending.retryTimer = setTimeout(() => {
			this._retryPacket(packetKey);
		}, nextBackoff);
	}

	/**
	 * Cancel retry timer for a specific packet.
	 * @private
	 * @param {string} packetKey
	 */
	_cancelPendingPacket(packetKey) {
		const pending = this._pendingPackets.get(packetKey);
		if (pending) {
			if (pending.retryTimer) clearTimeout(pending.retryTimer);
			this._pendingPackets.delete(packetKey);
			if (pending.retryCount > 0) {
				this._log(`Packet ${packetKey} confirmed after ${pending.retryCount} retries`);
				// Emit event when packet is confirmed after retries
				this._emit('packet_confirmed', { packetKey, retryCount: pending.retryCount });
			}
		}
	}

	/**
	 * Schedule a timeout to detect lost color packets after receiving request_preferred_colors.
	 * If 'started' doesn't arrive within 1s, resend start (host only).
	 * @private
	 */
	_scheduleStartTimeout() {
		// Cancel any existing timeout
		this._cancelPendingPacket('start_timeout');

		const timeoutMs = 1000;
		const retryTimer = setTimeout(() => {
			// Only resend if this client is the host who initiated the start
			if (!this._initiatedStart) {
				this._log('Start timeout: not host, skipping resend');
				return;
			}
			this._log('Start timeout: no "started" after color request, resending start');
			// Resend start packet
			const payload = { type: 'start' };
			if (Number.isInteger(this._lastStartGridSize)) payload.gridSize = this._lastStartGridSize;
			this._sendWithRetry('start', payload, 'request_preferred_colors');
		}, timeoutMs);

		this._pendingPackets.set('start_timeout', {
			packet: null,
			retryTimer,
			backoffMs: timeoutMs,
			retryCount: 0,
			expectedResponseType: 'started'
		});
	}

	/**
	 * Resolve default WebSocket base URL using simplified fallback chain:
	 *  1. Production constant when hosted on a github.io domain.
	 *  2. Derived from current window location (protocol + host + '/ws').
	 *  3. Localhost fallback on error.
	 * @private
	 * @returns {string}
	 */
	_defaultUrl() {
		try {
			if ((window.location.host || '').endsWith('github.io')) return WS_PROD_BASE_URL;
			const isSecure = window.location.protocol === 'https:'; const proto = isSecure ? 'wss' : 'ws';
			const host = window.location.host || 'localhost:8080';
			return `${proto}://${host}/ws`;
		} catch { return 'ws://localhost:8080/ws'; }
	}
}
