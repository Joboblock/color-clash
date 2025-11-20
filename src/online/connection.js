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
	}

	/** @private */
	_log(...args) { if (this._debug) console.debug('[OnlineConnection]', ...args); }

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
				case 'hosted': this._emit('hosted', msg); break;
				case 'roomlist': this._emit('roomlist', msg.rooms || {}); break;
				case 'started': this._emit('started', msg); break;
				case 'request_preferred_colors': this._emit('request_preferred_colors'); break;
				case 'joined': this._emit('joined', msg); break;
				case 'left': this._emit('left', msg); break;
				case 'roomupdate': this._emit('roomupdate', msg); break;
				case 'move': this._emit('move', msg); break;
				case 'rejoined': this._emit('rejoined', msg); break;
				case 'error': this._emit('error', msg); break;
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
			this._backoffMs = Math.min(this._backoffMs * 2, this._maxBackoffMs);
		}, delay);
	}

	/**
	 * Low-level send wrapper. Ensures connection first then sends if OPEN.
	 * Silently ignores if still not OPEN after ensure.
	 * @private
	 * @param {object} obj Serializable object payload.
	 */
	_send(obj) {
		try {
			this.ensureConnected();
			if (this._ws && this._ws.readyState === WebSocket.OPEN) {
				this._ws.send(JSON.stringify(obj));
			}
		} catch (e) { this._log('send failed', e); }
	}

	/** Request latest room list. */
	requestRoomList() { this._send({ type: 'list' }); }
	
	/** Host a new room.
	 * @param {{roomName:string, maxPlayers:number, gridSize?:number, debugName?:string}} p
	 */
	host({ roomName, maxPlayers, gridSize, debugName }) { this._send({ type: 'host', roomName, maxPlayers, gridSize, debugName }); }
	
	/** Join an existing room by name.
	 * @param {string} roomName
	 * @param {string} debugName Client name (display/debug only)
	 */
	join(roomName, debugName) { this._send({ type: 'join', roomName, debugName }); }
	
	/** Join a room using its key.
	 * @param {string} roomKey
	 * @param {string} debugName Client name
	 */
	joinByKey(roomKey, debugName) { this._send({ type: 'join_by_key', roomKey, debugName }); }
	
	/** Leave a room (roomName optional if server infers current room).
	 * @param {string} [roomName]
	 */
	leave(roomName) { this._send({ type: 'leave', roomName }); }
	
	/** Start the game (host only). Optionally override gridSize.
	 * @param {number} [gridSize]
	 */
	start(gridSize) { const payload = { type: 'start' }; if (Number.isInteger(gridSize)) payload.gridSize = gridSize; this._send(payload); }
	
	/** Send preferred color selection.
	 * @param {string} color
	 */
	sendPreferredColor(color) { this._send({ type: 'preferred_color', color }); }

	/** Broadcast a move.
	 * @param {{row:number, col:number, fromIndex:number, nextIndex:number, color:string}} move
	 */
	sendMove({ row, col, fromIndex, nextIndex, color }) { this._send({ type: 'move', row, col, fromIndex, nextIndex, color }); }

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
