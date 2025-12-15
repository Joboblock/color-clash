import { WS_PROD_BASE_URL, WS_INITIAL_BACKOFF_MS, WS_MAX_BACKOFF_MS } from '../config/index.js';
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
 *  - (deprecated) 'hosted' (HostedMessage): replaced by enriched 'roomlist'.
 *  - 'roomlist' (Record<string, RoomListEntry>): Updated list of rooms.
 *  - 'color' (ColorMessage): Server requesting color_ans from all clients.
 *  - 'start' (StartMessage): Server sending assigned colors to non-host clients (requesting start_ack).
 *  - 'start_cnf' (StartCnfMessage): Server sending final confirmation to host.
 *  - (deprecated) 'joined' (JoinedMessage): replaced by enriched 'roomlist'.
 *  - 'move' (MoveMessage): A game move broadcast (other players' moves).
 *  - 'move_ack' (MoveMessage): Server confirmation that our move was accepted.
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
 *  - sendColorAns(color)
 *  - sendStartAck()
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
 * // Deprecated: HostedMessage is no longer used; server emits enriched roomlist
 * @typedef {{type:'roomlist', rooms:Record<string, RoomListEntry>}} RawRoomListMessage
 * @typedef {{type:'color', players:string[]}} ColorMessage
 * @typedef {{type:'start', players:string[], gridSize:number, colors:string[]}} StartMessage
 * @typedef {{type:'start_cnf', players:string[], gridSize:number, colors:string[]}} StartCnfMessage
 * // Deprecated: JoinedMessage is no longer used; server emits enriched roomlist
// RoomUpdateMessage is obsolete; use enriched roomlist entries instead
 * @typedef {{type:'move', room?:string, row:number, col:number, fromIndex:number, nextIndex:number, color:string, seq?:number}} MoveMessage
 * @typedef {{type:'rejoined', room?:string, roomKey?:string, players?:PlayerEntry[], recentMoves?:MoveMessage[], maxPlayers?:number}} RejoinedMessage
 * @typedef {{type:'error', error:string}} ErrorMessage
 * @typedef {{initialBackoffMs?:number, maxBackoffMs?:number, getWebSocketUrl?:()=>string}} OnlineConnectionOptions
 */
export class OnlineConnection {
	/**
		 * Create a new OnlineConnection instance.
		 * @param {OnlineConnectionOptions} [options]
		 * @param {number} [options.initialBackoffMs] Initial reconnect delay in ms.
		 * @param {number} [options.maxBackoffMs] Maximum backoff delay ceiling in ms.
		 * @param {() => string} [options.getWebSocketUrl] Optional provider for dynamic WS base URL.
		 * @param {boolean} [options.debug=false] Enable verbose debug logging.
		 */
	constructor({ initialBackoffMs = WS_INITIAL_BACKOFF_MS, maxBackoffMs = WS_MAX_BACKOFF_MS, getWebSocketUrl, debug = false } = {}) {
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
		// Track if we're waiting for a join_by_key response to avoid redundant roomlist requests
		this._pendingJoinByKey = false;
		// Session info for reconnection
		this._sessionInfo = this._loadSessionInfo();
		// Track if we're in an active game (only restore session if disconnected during game)
		this._inActiveGame = false;
		// Track if session restoration was attempted
		this._sessionRestorationAttempted = false;
		// Track if we're currently restoring a session (blocks moves)
		this._isRestoringSession = false;
		// Queue for moves blocked during restoration
		this._blockedMoves = [];
		// Ping/pong keepalive tracking
		this._lastMessageTime = Date.now();
		this._pingTimer = null;
		this._unansweredPings = 0;
		this._PING_TIMEOUT_MS = 5000; // Send ping after 5 seconds of inactivity
		this._MAX_UNANSWERED_PINGS = 3; // Close connection after 3 unanswered pings
	}	/** @private */
	_log(...args) {
		if (this._debug) {
			console.debug('[OnlineConnection]', ...args);
		}
	}

	/**
	 * Start the ping keepalive timer.
	 * @private
	 */
	_startPingTimer() {
		this._stopPingTimer();
		this._lastMessageTime = Date.now();
		this._unansweredPings = 0;
		this._pingTimer = setInterval(() => {
			// Only send pings while in a started game
			if (!this._inActiveGame) {
				return;
			}

			const timeSinceLastMessage = Date.now() - this._lastMessageTime;
			if (timeSinceLastMessage >= this._PING_TIMEOUT_MS) {
				// Time to send a ping
				if (this._unansweredPings >= this._MAX_UNANSWERED_PINGS) {
					// Too many unanswered pings - close connection to trigger reconnect
					this._log('closing connection due to', this._MAX_UNANSWERED_PINGS, 'unanswered pings');
					console.warn('[Client] ⚠️ Connection timeout: closing WebSocket after', this._MAX_UNANSWERED_PINGS, 'unanswered pings');
					this._stopPingTimer();
					if (this._ws && this._ws.readyState === WebSocket.OPEN) {
						try {
							this._ws.close();
						} catch (e) {
							console.warn('[Client] Failed to close WebSocket:', e);
							// Force cleanup if close fails
							this._ws = null;
							this._scheduleReconnect();
						}
					}
					return;
				}
				// Send ping
				this._unansweredPings++;
				this._log('sending ping (unanswered count:', this._unansweredPings, ')');
				this._sendPayload({ type: 'ping' });
				// Reset timer for next check
				this._lastMessageTime = Date.now();
			}
		}, 1000); // Check every second
	}

	/**
	 * Stop the ping keepalive timer.
	 * @private
	 */
	_stopPingTimer() {
		if (this._pingTimer) {
			clearInterval(this._pingTimer);
			this._pingTimer = null;
		}
		this._unansweredPings = 0;
	}

	/**
	 * Reset the ping timer (called when any message is received).
	 * @private
	 */
	_resetPingTimer() {
		this._lastMessageTime = Date.now();
		this._unansweredPings = 0;
	}


	/**
	 * Load session info from sessionStorage for reconnection.
	 * @private
	 * @returns {{roomKey?: string, playerName?: string, sessionId?: string}}
	 */
	_loadSessionInfo() {
		try {
			const stored = sessionStorage.getItem('ws_session');
			if (stored) {
				return JSON.parse(stored);
			}
		} catch { /* ignore */ }
		return {};
	}

	/**
	 * Save session info to sessionStorage.
	 * @private
	 * @param {{roomKey?: string, playerName?: string, sessionId?: string}} info
	 */
	_saveSessionInfo(info) {
		try {
			this._sessionInfo = { ...this._sessionInfo, ...info };
			sessionStorage.setItem('ws_session', JSON.stringify(this._sessionInfo));
		} catch { /* ignore */ }
	}

	/**
	 * Clear session info from sessionStorage.
	 * @private
	 */
	_clearSessionInfo() {
		try {
			this._sessionInfo = {};
			sessionStorage.removeItem('ws_session');
		} catch { /* ignore */ }
	}

	/**
	 * Generate a unique session ID for this browser tab.
	 * @private
	 * @returns {string}
	 */
	_generateSessionId() {
		return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
	}

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
			if (name === 'open') {
				console.log(`[Client] 🎯 Emitting 'open' event to ${handlers.size} handlers`);
			}
			for (const fn of [...handlers]) {
				try { fn(payload); } catch { /* ignore */ }
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
	 * Whether session restoration is currently in progress.
	 * @returns {boolean}
	 */
	isRestoringSession() { return this._isRestoringSession; }

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

			// Start ping keepalive timer
			this._startPingTimer();

			// Only try to restore session if:
			// 1. We have stored session info
			// 2. We were in an active game when disconnected
			// 3. We haven't already attempted restoration this session
			if (this._inActiveGame &&
				this._sessionInfo &&
				this._sessionInfo.roomKey &&
				this._sessionInfo.playerName &&
				this._sessionInfo.sessionId &&
				!this._sessionRestorationAttempted) {
				console.log('[Client] Attempting session restoration with stored info:', this._sessionInfo);
				this._sessionRestorationAttempted = true;
				this._isRestoringSession = true;
				this._emit('restoring_session', { restoring: true });
				const restorePacket = {
					type: 'restore_session',
					roomKey: this._sessionInfo.roomKey,
					playerName: this._sessionInfo.playerName,
					sessionId: this._sessionInfo.sessionId
				};
				// Use retry logic for restore_session to handle packet loss
				this._sendWithRetry('restore_session', restorePacket, 'restore_status');
				return;
			}

			// If we have session info but game isn't active, rejoin the room (non-started room)
			if (!this._inActiveGame &&
				this._sessionInfo &&
				this._sessionInfo.roomKey &&
				this._sessionInfo.playerName &&
				!this._sessionRestorationAttempted) {
				console.log('[Client] Rejoining non-started room with key:', this._sessionInfo.roomKey);
				this._sessionRestorationAttempted = true;
				this.joinByKey(this._sessionInfo.roomKey, this._sessionInfo.playerName);
				this._emit('open');
				return;
			}

			this._emit('open');
			// Don't request room list if:
			// 1. We're waiting for a join_by_key response
			// 2. We're in an active game (reconnecting after ping timeout, session already restored or in progress)
			const shouldRequestList = !this._pendingJoinByKey && !this._inActiveGame;
			console.log('[Client] WS Opened. Request list:', shouldRequestList, '(pendingJoinByKey:', this._pendingJoinByKey, ', inActiveGame:', this._inActiveGame, ')');
			if (shouldRequestList) {
				this.requestRoomList();
			}
		};
		ws.onmessage = (evt) => {
			let msg; try { msg = JSON.parse(evt.data); } catch { return; }
			const type = msg.type;

			// Reset ping timer on any message received
			this._resetPingTimer();

			// Log received packet with additional info for roomlist
			if (type === 'roomlist') {
				const rooms = msg.rooms || {};
				let inRoom = null;
				for (const [roomName, info] of Object.entries(rooms)) {
					if (info && info.player) {
						inRoom = roomName;
						break;
					}
				}
				console.log('[Client] ⬇️ Received:', type, inRoom ? `(in room: ${inRoom})` : '(not in any room)', msg);
			} else if (type !== 'pong') {
				// Don't log pong messages to avoid spam
				console.log('[Client] ⬇️ Received:', type, msg);
			}

			// Automatically cancel pending packets based on expectedResponseType
			this._autoCancelPendingPackets(type, msg);

			switch (type) {
				// 'hosted' no longer used; ignore if received
				case 'hosted':
					break;
				case 'restore_status': {
					// Server's response to restore_session attempt
					if (msg.success) {
						console.log('[Client] ✅ Session restored successfully!', msg);
						// Reset restoration attempt flag so we can restore again on next disconnect
						this._sessionRestorationAttempted = false;

						// Clear restoring flag first
						if (this._isRestoringSession) {
							this._isRestoringSession = false;
							this._emit('restoring_session', { restoring: false });
						}

						// Resend any blocked moves that were queued during restoration
						if (this._blockedMoves.length > 0) {
							console.log('[Client] 📤 Resending', this._blockedMoves.length, 'blocked move(s)');
							const movesToSend = [...this._blockedMoves];
							this._blockedMoves = [];
							movesToSend.forEach(move => this.sendMove(move));
						}
					} else {
						console.log('[Client] ❌ Session restoration failed:', msg.reason);
						// Clear session info since restoration failed
						this._inActiveGame = false;
						this._sessionInfo = {
							roomKey: null,
							playerName: null,
							sessionId: this._sessionInfo?.sessionId || this._generateSessionId()
						};

						// Clear restoring flag
						if (this._isRestoringSession) {
							this._isRestoringSession = false;
							this._emit('restoring_session', { restoring: false });
						}

						// Clear blocked moves since we're not in a game anymore
						if (this._blockedMoves.length > 0) {
							console.log('[Client] 🗑️ Discarding', this._blockedMoves.length, 'blocked move(s) due to failed restoration');
							this._blockedMoves = [];
						}
					}
					break;
				}
				case 'roomlist': {
					// Ignore roomlist packets while trying to restore session
					if (this._isRestoringSession) {
						console.log('[Client] ⏭️ Ignoring roomlist while restoring session');
						break;
					}
					const rooms = msg.rooms || {};
					this._emit('roomlist', rooms);
					break;
				}
				case 'color':
					// Server sends 'color' to all clients (requesting color_ans)
					this._emit('color', msg);
					break;
				case 'start':
					// Server sends 'start' to non-host clients with assigned colors (requesting start_ack)
					this._emit('start', msg);
					break;
				case 'start_cnf':
					// Server sends 'start_cnf' to host as final confirmation
					this._emit('start_cnf', msg);
					break;
				case 'joined':
					break;
				case 'move': {
					// Cancel pending move retries when we receive any move
					// This includes our own echo (confirmation) or other players' moves
					const moveSeq = Number(msg.seq);
					if (Number.isInteger(moveSeq)) {
						// Cancel all pending move packets with seq <= received seq
						// (our move was accepted if we see any move at or beyond our sequence)
						for (const key of this._pendingPackets.keys()) {
							if (key.startsWith('move:')) {
								// Extract the fromIndex from the pending packet to match
								const pending = this._pendingPackets.get(key);
								if (pending && pending.packet && Number.isInteger(pending.packet.seq)) {
									const pendingSeq = pending.packet.seq;
									// Cancel if the received move's sequence is >= our pending move's sequence
									// This means either:
									// 1. This is our echo (same seq), or
									// 2. Game has progressed beyond our move (higher seq)
									if (moveSeq >= pendingSeq) {
										this._cancelPendingPacket(key);
									}
								}
							}
						}
					}
					this._emit('move', msg);
					break;
				}
				case 'move_ack': {
					// Server confirmation that our move was accepted (echo)
					const moveSeq = Number(msg.seq);
					if (Number.isInteger(moveSeq)) {
						// Cancel the specific pending move packet
						for (const key of this._pendingPackets.keys()) {
							if (key.startsWith('move:')) {
								const pending = this._pendingPackets.get(key);
								if (pending && pending.packet && Number.isInteger(pending.packet.seq)) {
									if (pending.packet.seq === moveSeq) {
										this._cancelPendingPacket(key);
									}
								}
							}
						}
					}
					this._emit('move_ack', msg);
					break;
				}
				case 'rejoined':
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
						// Clear the pending join_by_key flag since the attempt failed
						this._pendingJoinByKey = false;
					}

					// Cancel move retries if sequence is too old (game has progressed)
					if (errStr.includes('Sequence too old') && Number.isInteger(msg.receivedSeq)) {
						// Cancel all pending move packets with seq <= the rejected sequence
						for (const key of this._pendingPackets.keys()) {
							if (key.startsWith('move:')) {
								const pending = this._pendingPackets.get(key);
								if (pending && pending.packet && Number.isInteger(pending.packet.seq)) {
									if (pending.packet.seq <= msg.receivedSeq) {
										this._cancelPendingPacket(key);
									}
								}
							}
						}
					}

					this._emit('error', msg);
					break;
				}
				case 'pong':
					// Pong received - timer already reset above
					break;
				default: this._log('unhandled message type', type);
			}
		};
		ws.onerror = () => { this._log('socket error'); };
		ws.onclose = () => {
			// Stop ping timer
			this._stopPingTimer();
			console.warn('[Client] 🔄 WebSocket closed, preparing to reconnect...');

			// Save packets that are still being attempted to be sent
			this._unsentPackets = [];
			for (const [packetKey, pending] of this._pendingPackets.entries()) {
				if (pending && pending.packet) {
					this._unsentPackets.push({ packetKey, packet: pending.packet });
				}
			}
			this._emit('close', { wasEverOpened: this._everOpened, unsentPackets: this._unsentPackets });
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
		this._stopPingTimer();
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
		console.warn(`[Client] ⏳ Scheduling reconnect in ${delay} ms (backoff: ${this._backoffMs})`);
		this._log('schedule reconnect in', delay, 'ms');
		this._emit('reconnect_scheduled', { delay });
		this._reconnectTimer = setTimeout(() => {
			this._reconnectTimer = null;
			console.warn('[Client] 🔁 Attempting reconnect now...');
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
		try {
			this.ensureConnected();
			if (this._ws && this._ws.readyState === WebSocket.OPEN) {
				try {
					// Log sent packet
					const type = obj && typeof obj === 'object' ? obj.type : undefined;
					console.log('[Client] ⬆️ Sending:', type, obj);

					this._ws.send(JSON.stringify(obj));
				} catch (err) {
					const t = obj && typeof obj === 'object' ? obj.type : undefined;
					const state = typeof this._ws?.readyState === 'number' ? this._ws.readyState : undefined;
					console.error('[Client] Failed to send packet', { type: t, readyState: state }, err);
				}
			}
		} catch (err) {
			const t = obj && typeof obj === 'object' ? obj.type : undefined;
			console.error('[Client] Ensure/send failed', { type: t }, err);
		}
	}

	/**
	 * Helper for delayed packet send (used for simulated delay).
	 * @private
	 * @param {object} obj
	 */
	_sendPayloadDelayed(obj) {
		try {
			this.ensureConnected();
			if (this._ws && this._ws.readyState === WebSocket.OPEN) {
				const type = obj && typeof obj === 'object' ? obj.type : undefined;
				console.log('[Client] ⏩ Delayed send:', type, obj);
				this._ws.send(JSON.stringify(obj));
			}
		} catch (err) {
			const t = obj && typeof obj === 'object' ? obj.type : undefined;
			console.error('[Client] Delayed send failed', { type: t }, err);
		}
	}

	/** Request latest room list. */
	requestRoomList() {
		const packet = { type: 'list' };
		this._sendWithRetry('list', packet, 'roomlist');
	}

	/** Host a new room.
	 * @param {{roomName:string, maxPlayers:number, gridSize?:number, debugName?:string}} p
	 */
	host({ roomName, maxPlayers, gridSize, debugName }) {
		// Generate sessionId if not already present
		if (!this._sessionInfo.sessionId) {
			this._sessionInfo.sessionId = this._generateSessionId();
		}
		this._sendPayload({ type: 'host', roomName, maxPlayers, gridSize, debugName, sessionId: this._sessionInfo.sessionId });
	}

	/** Join an existing room by name.
	 * @param {string} roomName
	 * @param {string} debugName Client name (display/debug only)
	 */
	join(roomName, debugName) {
		// Generate sessionId if not already present
		if (!this._sessionInfo.sessionId) {
			this._sessionInfo.sessionId = this._generateSessionId();
		}
		this._sendPayload({ type: 'join', roomName, debugName, sessionId: this._sessionInfo.sessionId });
	}

	/** Join a room using its key.
	 * @param {string} roomKey
	 * @param {string} debugName Client name
	 */
	joinByKey(roomKey, debugName) {
		console.log('[Client] 🔑 joinByKey() called:', { roomKey, debugName, stack: new Error().stack });
		// Generate sessionId if not already present
		if (!this._sessionInfo.sessionId) {
			this._sessionInfo.sessionId = this._generateSessionId();
		}
		// Mark that we're waiting for a join_by_key response to avoid redundant roomlist request
		this._pendingJoinByKey = true;
		const packet = { type: 'join_by_key', roomKey, debugName, sessionId: this._sessionInfo.sessionId };
		this._sendWithRetry(`join_by_key:${roomKey}`, packet, 'roomlist');
	}

	/** Leave a room (roomName optional if server infers current room).
	 * @param {string} [roomName]
	 */
	leave(roomName) {
		this._clearSessionInfo(); // Clear session on explicit leave
		this._sendPayload({ type: 'leave', roomName });
	}

	/**
	 * Store session info for reconnection (called when successfully joining a room).
	 * @param {{roomKey: string, playerName: string}} info
	 */
	storeSessionInfo({ roomKey, playerName }) {
		if (!this._sessionInfo.sessionId) {
			// Generate session ID on first join
			this._sessionInfo.sessionId = this._generateSessionId();
		}
		this._saveSessionInfo({ roomKey, playerName, sessionId: this._sessionInfo.sessionId });
		console.log('[Client] Stored session info for reconnection:', this._sessionInfo);
	}

	/**
	 * Mark that the game has started (enables session restoration on disconnect).
	 */
	setGameActive() {
		this._inActiveGame = true;
		console.log('[Client] Game marked as active - session restoration enabled');
	}

	/**
	 * Mark that the game has ended (disables session restoration).
	 */
	setGameInactive() {
		this._inActiveGame = false;
		this._sessionRestorationAttempted = false;
		console.log('[Client] Game marked as inactive - session restoration disabled');
	}

	/** Start the game (host only). Optionally override gridSize.
	 * @param {number} [gridSize]
	 */
	start(gridSize) {
		const payload = { type: 'start_req' };
		if (Number.isInteger(gridSize)) payload.gridSize = gridSize;
		// Store gridSize for retry and mark this client as host
		this._lastStartGridSize = gridSize;
		this._initiatedStart = true;
		this._sendWithRetry('start', payload, 'start_cnf');
	}

	/** Send color answer with preferred color.
	 * @param {string} color
	 */
	sendColorAns(color) {
		this._sendPayload({ type: 'color_ans', color });
	}

	/** Send start acknowledgment.
	 */
	sendStartAck() {
		// Send once - server will resend 'start' if it doesn't receive this ack
		this._sendPayload({ type: 'start_ack' });
	}

	/** Broadcast a move.
	 * @param {{row:number, col:number, fromIndex:number, nextIndex:number, color:string, seq?:number}} move
	 */
	sendMove({ row, col, fromIndex, nextIndex, color, seq }) {
		// Block moves while restoring session - queue them for later
		if (this._isRestoringSession) {
			console.log('[Client] 🚫 Move blocked: session restoration in progress, queueing move');
			this._blockedMoves.push({ row, col, fromIndex, nextIndex, color, seq });
			return;
		}
		const moveKey = `move:${fromIndex}:${row}:${col}`;
		const packet = { type: 'move', row, col, fromIndex, nextIndex, color };
		if (Number.isInteger(seq)) packet.seq = seq;
		this._sendWithRetry(moveKey, packet, 'move');
	}

	/** Send acknowledgment for received move.
	 * @param {number} seq - The sequence number of the move being acknowledged
	 */
	sendMoveAck(seq) {
		if (!Number.isInteger(seq)) return;
		this._sendPayload({ type: 'move_ack', seq });
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

		// Block move retries while restoring session
		if (packetKey.startsWith('move:') && this._isRestoringSession) {
			this._log('Pausing move retry: session restoration in progress');
			// Reschedule for later
			pending.retryTimer = setTimeout(() => {
				this._retryPacket(packetKey);
			}, nextBackoff);
			return;
		}

		this._log(`Retrying packet ${packetKey} (attempt ${pending.retryCount})`);
		this._sendPayload(pending.packet);
		// Schedule next retry
		pending.retryTimer = setTimeout(() => {
			this._retryPacket(packetKey);
		}, nextBackoff);
	}

	/**
	 * Automatically cancel pending packets based on received message type and content.
	 * @private
	 * @param {string} msgType - The type of message received
	 * @param {object} msg - The full message object
	 */
	_autoCancelPendingPackets(msgType, msg) {
		for (const [packetKey, pending] of this._pendingPackets.entries()) {
			// Skip packets without expected response type
			if (!pending.expectedResponseType) continue;

			// Check if message type matches expected response
			if (pending.expectedResponseType !== msgType) continue;

			// Type matches - now check if content conditions are met
			let shouldCancel = false;

			switch (pending.expectedResponseType) {
				case 'restore_status': {
					// For restore_session packets, always cancel on restore_status (success or failure)
					if (packetKey === 'restore_session') {
						shouldCancel = true;
					}
					break;
				}
				case 'roomlist': {
					// For join_by_key packets, verify we actually joined a room
					if (packetKey.startsWith('join_by_key:')) {
						const rooms = msg.rooms || {};
						// Check if any room contains our player info
						for (const info of Object.values(rooms)) {
							if (info && info.player) {
								shouldCancel = true;
								// Clear the pending join_by_key flag
								this._pendingJoinByKey = false;
								break;
							}
						}
					} else {
						// For other roomlist requests (like 'list'), always cancel
						shouldCancel = true;
					}
					break;
				}
				case 'move': {
					// For move packets, verify it's the same move
					if (packetKey.startsWith('move:')) {
						const parts = packetKey.split(':');
						if (parts.length === 4) {
							const [, fromIndex, row, col] = parts;
							if (String(msg.fromIndex) === fromIndex &&
								String(msg.row) === row &&
								String(msg.col) === col) {
								shouldCancel = true;
							}
						}
					}
					break;
				}
				case 'move_ack': {
					// Server echo confirms our move was accepted
					if (packetKey.startsWith('move:')) {
						const parts = packetKey.split(':');
						if (parts.length === 4) {
							const [, fromIndex, row, col] = parts;
							if (String(msg.fromIndex) === fromIndex &&
								String(msg.row) === row &&
								String(msg.col) === col) {
								shouldCancel = true;
							}
						}
					}
					break;
				}
				case 'rejoined': {
					// For reconnect packets, verify it's the same room
					if (packetKey.startsWith('reconnect:')) {
						const roomName = packetKey.substring('reconnect:'.length);
						if (msg.room === roomName) {
							shouldCancel = true;
						}
					}
					break;
				}
				case 'start_cnf':
					// start_cnf response confirms the start_req from host (final confirmation)
					if (packetKey === 'start' && msg.colors) {
						shouldCancel = true;
					}
					break;
				default:
					// Unknown response type - cancel to be safe
					shouldCancel = true;
			}

			if (shouldCancel) {
				this._cancelPendingPacket(packetKey);
			}
		}
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
