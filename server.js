// Player name length limit (base, not including suffix)
const PLAYER_NAME_LENGTH = 12;
import http from 'http';
import process from 'node:process';
import * as crypto from 'node:crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { WebSocketServer } from 'ws';
import { APP_VERSION } from './src/version.js';
import { createInitialRoomGridState, validateAndApplyMove } from './src/game/serverGridEngine.js';
import { advanceTurnIndex, computeAliveMask } from './src/game/turnCalc.js';
import {
    MAX_CELL_VALUE,
    INITIAL_PLACEMENT_VALUE,
    CELL_EXPLODE_THRESHOLD,
    PACKET_DROP_RATE,
    PACKET_DELAY_RATE,
    PACKET_DELAY_MIN_MS,
    PACKET_DELAY_MAX_MS,
    PACKET_DISCONNECT_RATE
} from './src/config/index.js';

// Keep server rules aligned with client constants (single source of truth).

// Cloud Run provides PORT; default to 8080 locally
const PORT = Number.parseInt(process.env.PORT || '', 10) || 8080;

// Resolve current directory (ESM)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple static file server for index.html, script.js, styles.css
const contentTypes = new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'application/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.woff2', 'font/woff2'],
    ['.woff', 'font/woff'],
    ['.ttf', 'font/ttf'],
    ['.otf', 'font/otf'],
    ['.json', 'application/json; charset=utf-8'],
    ['.svg', 'image/svg+xml'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.ico', 'image/x-icon'],
]);

function sendError(res, code = 404, message = 'Not found') {
    res.statusCode = code;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(message);
}

const server = http.createServer(async (req, res) => {
    try {
        // Health checks
        if (req.url === '/healthz' || req.url === '/_ah/health') {
            res.statusCode = 200;
            res.setHeader('content-type', 'text/plain; charset=utf-8');
            res.end('ok');
            return;
        }

        // Default to index.html for root
        let reqPath = (req.url || '/').split('?')[0];
        if (reqPath === '/' || reqPath === '') {
            reqPath = '/index.html';
        }

        // Prevent path traversal
        const safePath = path
            .normalize(reqPath)
            .replace(/^\.\.(?:\/|\\|$)/, '')
            .replace(/^\/+/, ''); // strip any leading slashes so join is relative
        const absPath = path.join(__dirname, safePath);
        const st = await stat(absPath);
        if (!st.isFile()) {
            sendError(res, 404);
            return;
        }
        const ext = path.extname(absPath).toLowerCase();
        const ct = contentTypes.get(ext) || 'application/octet-stream';
        res.statusCode = 200;
        res.setHeader('content-type', ct);
        createReadStream(absPath).pipe(res);
    } catch { //TODO: No fallbacks
        // Fallback to index.html for SPA routes
        try {
            const absIndex = path.join(__dirname, 'index.html');
            const ext = '.html';
            const ct = contentTypes.get(ext) || 'text/html; charset=utf-8';
            res.statusCode = 200;
            res.setHeader('content-type', ct);
            createReadStream(absIndex).pipe(res);
        } catch {
            sendError(res, 404);
        }
    }
});

// Attach WebSocket server on path /ws
const wss = new WebSocketServer({ server, path: '/ws' });

// Start HTTP server
server.listen(PORT, '0.0.0.0', () => {
    // Emit a single readiness line only when running under VS Code debugger
    // so serverReadyAction can auto-open the browser.
    if (process.env.VSCODE_INSPECTOR_OPTIONS) {
        // Must match .vscode/launch.json pattern: "Server running at (https?://[^\s]+)"
        console.log(`Server running at http://localhost:${PORT}`);
    }
});

// Room management structure:
// rooms = {
//   [roomName]: {
//     maxPlayers: number,
//     participants: Array<{ ws: WebSocket, name: string, isHost: boolean, connected: boolean, sessionId: string }>,
//     _disconnectTimers?: Map<string, NodeJS.Timeout>,
//     game?: {
//       started: boolean,
//       players: string[], // fixed order of names at start
//       turnIndex: number, // whose turn it is (index in players)
//       colors?: string[]
//     }
//   }
// }
const rooms = {};
// Map of room join keys -> room names for deep-link joining
const roomKeys = new Map();
// Keep server-authoritative list of available player colors (must match client order)
const playerColors = ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple'];
// Track which room a connection belongs to and the player's sessionId (per tab)
// Map of sessionId -> { roomName: string, name: string, participantRef: participant }
const connectionMeta = new Map();

/**
 * Sends a JSON payload to a WebSocket client.
 *
 * @param {WebSocket} ws - The WebSocket connection to send to.
 * @param {object} payload - The payload object to send (will be JSON-stringified).
 */
function sendPayload(ws, payload) {
    // Simulate packet drop/delay (debug)
    const type = payload && typeof payload === 'object' ? payload.type : undefined;
    const dropRate = PACKET_DROP_RATE;
    const delayRate = typeof PACKET_DELAY_RATE === 'number' ? PACKET_DELAY_RATE : 0;
    if (Math.random() < dropRate) {
        console.warn('[Server] 🔥 Simulated packet loss:', type, payload);
        return;
    }
    if (Math.random() < delayRate) {
        const min = Number.isFinite(PACKET_DELAY_MIN_MS) ? PACKET_DELAY_MIN_MS : 0;
        const max = Number.isFinite(PACKET_DELAY_MAX_MS) ? PACKET_DELAY_MAX_MS : min;
        const delay = Math.max(0, Math.floor(min + Math.random() * Math.max(0, max - min)));
        console.warn(`[Server] 🕒 Simulated packet delay (${delay}ms):`, type, payload);
        setTimeout(() => {
            sendPayloadDelayed(ws, payload);
        }, delay);
        return;
    }
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        try {
            const state = typeof ws?.readyState === 'number' ? ws.readyState : undefined;
            console.error('[Server] Failed to send payload', { readyState: state }, err);
        } catch { /* ignore meta logging errors */ }
    }
}

/**
 * Helper for delayed packet send (used for simulated delay).
 */
function sendPayloadDelayed(ws, payload) {
    try {
        ws.send(JSON.stringify(payload));
        const type = payload && typeof payload === 'object' ? payload.type : undefined;
        console.log('[Server] ⏩ Delayed send:', type, payload);
    } catch (err) {
        try {
            const state = typeof ws?.readyState === 'number' ? ws.readyState : undefined;
            console.error('[Server] Delayed send failed', { readyState: state }, err);
        } catch { /* ignore meta logging errors */ }
    }
}

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            try { sendPayload(ws, { type: 'error', error: 'Invalid message format' }); } catch { /* ignore */ }
            return;
        }
        // --- PACKET VALIDATION ---
        // Helper: get room info for this ws
    // First, find the sessionId for this ws by searching through connectionMeta
    const { sessionId: clientSessionId, meta } = findSessionByWs(ws);
        const roomName = meta?.roomName;
        const room = roomName ? rooms[roomName] : undefined;
        const isInRoom = !!roomName && !!room;
        const isGameStarted = !!(room && room.game && room.game.started);

        // Define packet type groups
    const gamePackets = new Set(['move', 'ping']);
    const roomPackets = new Set(['leave', 'start_req', 'start_ack', 'color_ans']);
    // Out-of-game packets that normally operate from the lobby. 'list' is handled separately below.
    const outOfGamePackets = new Set(['host', 'join', 'join_by_key']);
        // restore_session is allowed at any time (it's specifically for reconnecting to started games)

        // 1. Game packets from clients not in a started room
        if (gamePackets.has(msg.type) && !isGameStarted) {
            sendPayload(ws, {
                type: 'error',
                error: `Invalid packet: ${msg.type} packet sent while not in a started room`,
                packet: msg,
                room: roomName || null
            });
            return;
        }
        // 2. Room packets from clients not in a room
        if (roomPackets.has(msg.type) && !isInRoom) {
            // If the client sent a 'leave' while not in a room, respond with the latest roomlist
            // (echoing any provided roomlistUuid) instead of an error so the client UI can reconcile state.
            if (msg.type === 'leave') {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
                return;
            }
            // Other room packets (start_req/start_ack/color_ans) are still invalid when not in a room
            sendPayload(ws, {
                type: 'error',
                error: `Invalid packet: ${msg.type} packet sent while not in a room`,
                packet: msg,
                room: null
            });
            return;
        }
        // 3. Out-of-game/room packets from clients in a started room or already in a room
        if (outOfGamePackets.has(msg.type) && (isGameStarted || isInRoom)) {
            // Instead of returning an error popup for clients that tried to host/join while
            // already in a room (or while a game started), respond with an enriched roomlist
            // so the client UI can reconcile its current membership. Include the incoming
            // roomlistUuid when provided.
            const perClientExtras = new Map();
            if (meta && meta.roomName && rooms[meta.roomName]) {
                const r = rooms[meta.roomName];
                perClientExtras.set(ws, {
                    room: meta.roomName,
                    roomKey: r.roomKey,
                    maxPlayers: r.maxPlayers,
                    player: meta.name,
                    sessionId: clientSessionId,
                    players: r.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(r.desiredGridSize) ? r.desiredGridSize : undefined,
                    started: !!(r.game && r.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
            } else {
                perClientExtras.set(ws, {
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
            }
            broadcastRoomList(perClientExtras, { targetedOnly: true });
            return;
        }

        if (msg.type === 'restore_session' && typeof msg.roomKey === 'string' && typeof msg.playerName === 'string' && typeof msg.sessionId === 'string') {
            // Client is attempting to restore a previous session
            const roomKey = String(msg.roomKey);
            const clientSessionId = String(msg.sessionId);
            console.log('[Session Restore] Attempt from client:', { roomKey, sessionId: clientSessionId });
            // Find room by key
            const roomName = roomKeys.get(roomKey);
            if (!roomName || !rooms[roomName]) {
                console.log('[Session Restore] ❌ Room not found for key:', roomKey);
                // Send restore_status indicating failure
                try {
                    sendPayload(ws, { type: 'restore_status', success: false, reason: 'Room not found' });
                } catch (err) {
                    console.error('[Server] Failed to send restore_status after restore_session fail', err);
                }
                return;
            }
            const room = rooms[roomName];
            // Find participant by sessionId only
            const participant = room.participants.find(p => p.sessionId === clientSessionId);
            if (!participant) {
                console.log('[Session Restore] ❌ No matching participant found:', { sessionId: clientSessionId });
                // Send restore_status indicating failure
                try {
                    sendPayload(ws, { type: 'restore_status', success: false, reason: 'Session not found' });
                } catch (err) {
                    console.error('[Server] Failed to send restore_status after restore_session fail', err);
                }
                return;
            }
            // Clear any pending disconnect timer for this participant
            if (room._disconnectTimers && room._disconnectTimers.has(clientSessionId)) {
                try { clearTimeout(room._disconnectTimers.get(clientSessionId)); } catch { /* ignore */ }
                room._disconnectTimers.delete(clientSessionId);
            }
            // Close old WebSocket if still open and different from current
            if (participant.ws && participant.ws !== ws && participant.ws.readyState === 1) {
                try { participant.ws.terminate(); } catch { /* ignore */ }
            }
            const oldWs = participant.ws !== ws ? participant.ws : null;
            participant.ws = ws;
            participant.connected = true;

            // Clear room deletion timer now that a player has rejoined
            if (room._roomDeletionTimer) {
                try { clearTimeout(room._roomDeletionTimer); } catch { /* ignore */ }
                room._roomDeletionTimer = null;
                console.log(`[Session Restore] Cancelled room deletion timer for ${roomName}`);
            }

            // Update connectionMeta to use sessionId as key
            // First remove any old mapping for this ws if it exists
            const result = findSessionByWs(oldWs);
            if (result.sessionId) {
                connectionMeta.delete(result.sessionId);
            }
            connectionMeta.set(clientSessionId, { roomName, name: participant.name, participantRef: participant });

            // Move catch-up is handled via ping(seq) now.

            console.log('[Session Restore] ✅ Session restored for', participant.name, 'in room', roomName);

            // Send restore_status indicating success
            try {
                sendPayload(ws, {
                    type: 'restore_status',
                    success: true,
                    roomName: roomName,
                    roomKey: room.roomKey,
                    playerName: participant.name,
                    sessionId: clientSessionId
                });
            } catch (err) {
                console.error('[Server] Failed to send restore_status after successful restore', err);
            }

            // Send enriched roomlist to confirm restoration using sessionId
            const perClientExtras = new Map();
            perClientExtras.set(ws, {
                room: roomName,
                roomKey: room.roomKey,
                maxPlayers: room.maxPlayers,
                player: participant.name,
                sessionId: clientSessionId,
                players: room.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                started: !!(room.game && room.game.started),
                roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
            });
            broadcastRoomList(perClientExtras, { targetedOnly: true });

            // If game is active, send catch-up data
            if (room.game && room.game.started) {
                // Prefer the client's reported next-expected sequence (sent in restore_session)
                // so we can immediately provide the exact missing slice without waiting for ping.
                // NOTE: client seq semantics match ping: it's the next seq the client expects.
                const clientNextSeq = Number.isInteger(msg.seq) ? msg.seq : 0;
                const recentMoves = (room.game && Array.isArray(room.game.recentMoves))
                    ? room.game.recentMoves.filter(m => Number.isInteger(m.seq) && m.seq >= clientNextSeq)
                    : [];
                const rejoinPayload = {
                    type: 'rejoined',
                    room: roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    started: true,
                    turnIndex: room.game && Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0,
                    colors: room.game && Array.isArray(room.game.colors) ? room.game.colors : undefined,
                    recentMoves
                };
                try { sendPayload(ws, rejoinPayload); } catch { /* ignore */ }
            }


            return;
        } else if (msg.type === 'host') {
            // If client is already in a room, reply with an enriched roomlist to confirm
            // their current membership instead of silently returning.
            const { sessionId: existingSessionId, meta: metaExisting } = findSessionByWs(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const cur = rooms[metaExisting.roomName];
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: metaExisting.roomName,
                    roomKey: cur.roomKey,
                    maxPlayers: cur.maxPlayers,
                    player: metaExisting.name,
                    sessionId: existingSessionId,
                    players: cur.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(cur.desiredGridSize) ? cur.desiredGridSize : undefined,
                    started: !!(cur.game && cur.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
                return;
            }
            // Compute a unique room name using the same pattern as player names
            const roomBaseRaw = (typeof msg.roomName === 'string' && msg.roomName)
                ? String(msg.roomName)
                : 'Player';
            const uniqueRoomName = pickUniqueRoomName(roomBaseRaw);
            if (!uniqueRoomName) {
                try { sendPayload(ws, { type: 'error', error: 'Room name already taken (all variants 2–9 used). Please choose a different name.' }); } catch { /* ignore */ }
                return;
            }
            // Default to 2 unless provided by host (optional)
            const provided = Number.isFinite(msg.maxPlayers) ? Math.floor(Number(msg.maxPlayers)) : 2;
            const clamped = clampPlayers(provided);
            // Recommended grid size schedule for server authoritative fallback
            function recommendedGridSize(p) {
                if (p <= 2) return 3;
                if (p <= 4) return 4; // 3-4 players
                if (p === 5) return 5;
                return 6; // 6-8 players
            }
            // Use debugName if present, otherwise default to 'Player'. Enforce 12-char base; reserve 13th for numeric suffix.
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(null, baseRaw);
            // Capture host requested grid size if provided (clamp 3..16); store for later start
            const requestedGridRaw = Number.isFinite(msg.gridSize) ? Math.floor(msg.gridSize) : NaN;
            let requestedGrid = Number.isFinite(requestedGridRaw) ? requestedGridRaw : null;
            if (requestedGrid !== null) {
                // Enforce schedule minimum
                const minForPlayers = recommendedGridSize(clamped);
                if (requestedGrid < minForPlayers) requestedGrid = minForPlayers;
                if (requestedGrid > 16) requestedGrid = 16;
            }
            // Generate unique join key for this room
            const roomKey = generateRoomKey();
            // Accept sessionId from client if provided, otherwise generate one
            const newSessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();

            // Create participant with sessionId
            const participant = { ws, name: playerName, isHost: true, connected: true, sessionId: newSessionId };
            rooms[uniqueRoomName] = {
                maxPlayers: clamped,
                participants: [participant],
                _disconnectTimers: new Map(),
                desiredGridSize: requestedGrid, // null means use dynamic playerCount+3
                roomKey
            };
            roomKeys.set(roomKey, uniqueRoomName);
            connectionMeta.set(newSessionId, { roomName: uniqueRoomName, name: playerName, participantRef: participant });

            // Compute a planned grid size for the lobby background for the host as well.
            // Use host's desiredGridSize if provided; otherwise default to (playerTarget + 3)
            // No direct roomupdate confirmation; rely on enriched roomlist
            // Enrich roomlist for the host so their room entry includes player/roomKey confirmation
            const perClientExtras = new Map();
            perClientExtras.set(ws, {
                room: uniqueRoomName,
                roomKey,
                maxPlayers: clamped,
                player: playerName,
                sessionId: newSessionId,
                players: [{ name: playerName, sessionId: newSessionId }],
                gridSize: requestedGrid !== null ? requestedGrid : undefined,
                started: false,
                roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
            });
            broadcastRoomList(perClientExtras, { targetedOnly: true });
            // Also broadcast to everyone else because hosting changes lobby state.
            broadcastRoomList(undefined, { excludeSockets: new Set([ws]) });
        } else if (msg.type === 'join' && msg.roomName) {
            const room = rooms[msg.roomName];
            if (!room) {
                sendPayload(ws, { type: 'error', error: 'Room not found' });
                return;
            }
            if (room.game && room.game.started) {
                sendPayload(ws, { type: 'error', error: 'Room already started' });
                return;
            }
            // If this connection is already in a room, remove it from that room first
            const { sessionId: existingSessionId, meta: metaExisting } = findSessionByWs(ws);

            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.sessionId !== existingSessionId);
                if (prevRoom.participants.length === 0) {
                    const oldKey = prevRoom.roomKey;
                    console.log(`[Room Delete] Room '${metaExisting.roomName}' deleted because last participant left/disconnected.`);
                    delete rooms[metaExisting.roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // notify previous room (no roomupdate, just rely on roomlist)
                }
                connectionMeta.delete(existingSessionId);
            }
            const count = room.participants?.length || 0;
            if (count >= room.maxPlayers) {
                sendPayload(ws, { type: 'error', error: 'Room is full' });
                return;
            }
            // Use debugName if present, otherwise default to 'Player'. Enforce 12-char base; reserve 13th for numeric suffix and ensure uniqueness in room.
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(room, baseRaw);
            if (!playerName) {
                try { sendPayload(ws, { type: 'error', error: 'All name variants are taken in this room. Please choose a different name.' }); } catch { /* ignore */ }
                return;
            }
            // Accept sessionId from client if provided, otherwise generate one
            const newSessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();

            // Create participant with sessionId
            const participant = { ws, name: playerName, isHost: false, connected: true, sessionId: newSessionId };
            room.participants.push(participant);
            connectionMeta.set(newSessionId, { roomName: msg.roomName, name: playerName, participantRef: participant });

            // No direct roomupdate confirmation; rely on enriched roomlist
            // Enrich roomlist for the joiner so their room entry includes player/roomKey confirmation
            {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: msg.roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    player: playerName,
                    sessionId: newSessionId,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                    started: !!(room.game && room.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
            }
            // Broadcast lobby change to all clients (excluding the triggering client).
            broadcastRoomList(undefined, { excludeSockets: new Set([ws]) });
        } else if (msg.type === 'join_by_key' && typeof msg.roomKey === 'string') {
            const key = String(msg.roomKey);
            const roomName = roomKeys.get(key);
            if (!roomName) {
                sendPayload(ws, { type: 'error', error: 'Room not found' });
                return;
            }
            const room = rooms[roomName];
            if (!room) {
                sendPayload(ws, { type: 'error', error: 'Room not found' });
                return;
            }
            if (room.game && room.game.started) {
                sendPayload(ws, { type: 'error', error: 'Room already started' });
                return;
            }
            // Remove from existing room if any, but only if not already in the target room
            const { sessionId: existingSessionId, meta: metaExisting } = findSessionByWs(ws);
            if (metaExisting && metaExisting.roomName === roomName) {
                // Already in the target room: send enriched roomlist to confirm membership
                const cur = rooms[roomName];
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: roomName,
                    roomKey: cur.roomKey,
                    maxPlayers: cur.maxPlayers,
                    player: metaExisting.name,
                    sessionId: existingSessionId,
                    players: cur.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(cur.desiredGridSize) ? cur.desiredGridSize : undefined,
                    started: !!(cur.game && cur.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
                return;
            }
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.sessionId !== existingSessionId);
                if (prevRoom.participants.length === 0) {
                    const oldKey = prevRoom.roomKey;
                    console.log(`[Room Delete] Room '${metaExisting.roomName}' deleted because last participant left/disconnected.`);
                    delete rooms[metaExisting.roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // notify previous room (no roomupdate, just rely on roomlist)
                }
                connectionMeta.delete(existingSessionId);
            }
            const count = room.participants?.length || 0;
            if (count >= room.maxPlayers) {
                sendPayload(ws, { type: 'error', error: 'Room is full' });
                return;
            }
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(room, baseRaw);
            if (!playerName) {
                try { sendPayload(ws, { type: 'error', error: 'All name variants are taken in this room. Please choose a different name.' }); } catch { /* ignore */ }
                return;
            }
            // Accept sessionId from client if provided, otherwise generate one
            const newSessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();

            // Create participant with sessionId
            const participant = { ws, name: playerName, isHost: false, connected: true, sessionId: newSessionId };
            room.participants.push(participant);
            connectionMeta.set(newSessionId, { roomName, name: playerName, participantRef: participant });

            // No direct roomupdate confirmation; rely on enriched roomlist
            // Enrich roomlist for the joiner so their room entry includes player/roomKey confirmation
            {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    player: playerName,
                    sessionId: newSessionId,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                    started: !!(room.game && room.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
            }
            // Broadcast lobby change to all clients (excluding the triggering client).
            broadcastRoomList(undefined, { excludeSockets: new Set([ws]) });
            // ...existing code...
        } else if (msg.type === 'list') {
            const roomlistUuid = (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined;
            const perClientExtras = new Map();
            perClientExtras.set(ws, { roomlistUuid });
            // broadcastRoomList will include per-client enrichment for clients in a room
            broadcastRoomList(perClientExtras, { targetedOnly: true });
        } else if (msg.type === 'start_req') {
            // Only the host can start; use their current room from sessionId in meta
            // Find meta by looking for this ws in connectionMeta
            const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

            if (!meta || !meta.roomName) {
                console.log(`[Start] ❌ Client not in a room`);
                sendPayload(ws, { type: 'error', error: 'Not in a room' });
                return;
            }
            const room = rooms[meta.roomName];
            if (!room) {
                console.log(`[Start] ❌ Room ${meta.roomName} not found`);
                sendPayload(ws, { type: 'error', error: 'Room not found' });
                return;
            }
            // Verify host by checking if this is the first participant and sessionId matches
            const isHost = room.participants.length && room.participants[0].sessionId === senderSessionId;
            if (!isHost) {
                console.log(`[Start] ❌ ${meta.name} is not the host of ${meta.roomName}`);
                sendPayload(ws, { type: 'error', error: 'Only the host can start the game' });
                return;
            }
            // Optionally enforce full room
            const playerCount = room.participants.length;
            const mustBeFull = true;
            if (mustBeFull && playerCount < room.maxPlayers) {
                console.log(`[Start] ❌ Room ${meta.roomName} not full: ${playerCount}/${room.maxPlayers}`);
                sendPayload(ws, { type: 'error', error: 'Room is not full yet' });
                return;
            }
            const startUuid = (msg && typeof msg.startUuid === 'string' && msg.startUuid) ? msg.startUuid : null;
            const startUuidShort = startUuid ? String(startUuid).slice(0, 8) : 'none';
            console.log(`[Start] 🎮 Host ${meta.name} initiating start for room ${meta.roomName} with ${playerCount} players (startUuid=${startUuidShort})`);

            // If a game already started, only treat this as a duplicate retry if the uuid matches.
            // A different uuid signals a game restart and should be processed like the game never started.
            if (room.game && room.game.started) {
                const currentStartUuid = (room.game && typeof room.game.startUuid === 'string') ? room.game.startUuid : null;
                const isSameUuid = !!(startUuid && currentStartUuid && startUuid === currentStartUuid);
                
                if (isSameUuid) {
                    console.log(`[Start] 🔄 Game already started (same startUuid), resending start_cnf to host ${meta.name}`);
                    const colorsPayload = {
                        type: 'start_cnf',
                        room: meta.roomName,
                        players: room.game.players,
                        gridSize: room.game.gridSize || 3, // Use stored gridSize
                        colors: room.game.colors,
                        startUuid
                    };
                    try { sendPayload(ws, colorsPayload); } catch (err) { console.error('[Server] Failed to resend colors to host', err); }
                    return;
                }

                console.log(`[Start] 🔁 Restart requested (new startUuid). Resetting game state for room ${meta.roomName} (old=${currentStartUuid ? String(currentStartUuid).slice(0, 8) : 'none'} new=${startUuidShort})`);
                // Reset any previous start handshake and game state.
                delete room._startAcks;
                delete room._lastSeqByName;
                room.game = null;
            }

            // Initiate color collection before starting (similar to move confirmation flow)
            if (room._startAcks && room._startAcks.inProgress) {
                // Already collecting - this is a retry from host
                console.log(`[Start] 🔄 Start already in progress for room ${meta.roomName}, retrying...`);

                const otherParticipants = room.participants.filter(p => p.ws !== ws);
                const players = room.participants.map(p => p.name);

                // Case 1: Not all start_acks received yet - resend start to clients who haven't acked
                if (!room._startAcks.colorsCollected) {
                    console.log(`[Start] 🔄 Colors not yet collected (${room._startAcks.responses.size}/${room._startAcks.expected}), resending start...`);
                    const startPayload = JSON.stringify({ type: 'color', room: meta.roomName, players });
                    let resentCount = 0;
                    room.participants.forEach(p => {
                        // Only resend to clients who haven't sent start_ack yet (tracked by ws)
                        if (!room._startAcks.responses.has(p.ws) && p.ws.readyState === 1) {
                            console.log(`[Start]   🔁 Resending start to ${p.name} (no start_ack yet)`);
                            try { p.ws.send(startPayload); resentCount++; } catch (err) { console.error('[Server] Failed to resend start', p.name, err); }
                        }
                    });
                    console.log(`[Start] 📤 Resent start to ${resentCount} clients`);
                    return;
                }

                // Case 2: Colors collected but not all colors_acks received - resend start to non-host clients who haven't acked
                if (room._startAcks.colorsAcksReceived.size < room._startAcks.colorsAcksExpected) {
                    console.log(`[Start] 🔄 Colors collected but acks pending (${room._startAcks.colorsAcksReceived.size}/${room._startAcks.colorsAcksExpected}), resending colors...`);
                    const colorsPayload = JSON.stringify({ type: 'start', room: meta.roomName, players, colors: room._startAcks.assignedColors, gridSize: room._startAcks.gridSize, startUuid: room._startAcks.startUuid });
                    let resentCount = 0;
                    otherParticipants.forEach(p => {
                        // Only resend to clients who haven't sent start_ack yet
                        if (!room._startAcks.colorsAcksReceived.has(p.ws) && p.ws.readyState === 1) {
                            console.log(`[Start]   🔁 Resending colors to ${p.name} (no start_ack yet)`);
                            try { p.ws.send(colorsPayload); resentCount++; } catch (err) { console.error('[Server] Failed to resend colors', p.name, err); }
                        }
                    });
                    console.log(`[Start] 📤 Resent colors to ${resentCount} clients`);
                    return;
                }

                // Case 3: All acks received, just resend start_cnf to host
                console.log(`[Start] 🔄 All acks collected, resending colors to host`);
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, colors: room._startAcks.assignedColors, gridSize: room._startAcks.gridSize, startUuid: room._startAcks.startUuid || startUuid };
                try { sendPayload(ws, colorsPayload); } catch (err) { console.error('[Server] Failed to resend colors to host', err); }
                return;
            }
            const players = room.participants.map(p => p.name);

            // Get other participants (not the host)
            const otherParticipants = room.participants.filter(p => p.ws !== ws);

            // If host is alone, start immediately with their color
            if (otherParticipants.length === 0) {
                console.log(`[Start] 👤 Solo host - starting immediately for ${meta.name}`);
                const hostColor = 'green'; // Default, host will use their cycler color locally
                const assigned = [hostColor];
                function recommendedGridSize(p) {
                    if (p <= 2) return 3;
                    if (p <= 4) return 4;
                    if (p === 5) return 5;
                    return 6;
                }
                const gridSize = Number.isFinite(room.desiredGridSize)
                    ? Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, room.desiredGridSize)))
                    : Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, playerCount + 3)));
                room.game = {
                    started: true,
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned,
                    gridSize, // Store for potential retry
                    startUuid,
                    moveSeq: 0,
                    recentMoves: []
                };
                // Server-authoritative grid state
                try {
                    room.game.gridState = createInitialRoomGridState({ gridSize, playerColors: assigned });
                } catch (err) {
                    console.error('[Start] Failed to initialize grid state (solo host)', err);
                }
                if (!room._lastSeqByName) room._lastSeqByName = new Map();
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, gridSize, colors: assigned, startUuid };
                console.log(`[Start] ✅ Sending immediate start_cnf to solo host ${meta.name}`);
                try { sendPayload(ws, colorsPayload); } catch (err) { console.error('[Server] Failed to send start_cnf to host', err); }
                return;
            }

            // Calculate gridSize now so non-host clients can start their games
            function recommendedGridSize(p) {
                if (p <= 2) return 3;
                if (p <= 4) return 4;
                if (p === 5) return 5;
                return 6;
            }
            const gridSize = Number.isFinite(room.desiredGridSize)
                ? Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, room.desiredGridSize)))
                : Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, playerCount + 3)));

            const collect = {
                inProgress: true,
                expected: room.participants.length, // expect acks from ALL participants (including host)
                responses: new Map(), // sessionId -> { name, color, sessionId }
                hostWs: ws,
                hostSessionId: senderSessionId,
                hostName: meta.name,
                gridSize, // Store for later use when sending to host
                startUuid
            };
            room._startAcks = collect;

            // Send color to ALL participants (including host) - each will respond with color_ans
            const startPayload = JSON.stringify({ type: 'color', room: meta.roomName, players });
            console.log(`[Start] 📤 Sending start request to ${room.participants.length} clients, expecting ${collect.expected} acks`);
            room.participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    console.log(`[Start]   → Sending to ${p.name}`);
                    try { p.ws.send(startPayload); } catch (err) { console.error('[Server] Failed to send start to participant', p.name, err); }
                }
            });
        } else if (msg.type === 'move') {
            // Find meta by looking for this ws in connectionMeta
            const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room) return;

            // Simulate chance to close all players' WebSockets
            if (Math.random() < PACKET_DISCONNECT_RATE) {
                console.warn('[Server] 🔌 SIMULATED DISCONNECT: Closing all player WebSockets');
                room.participants.forEach(p => {
                    if (p.ws && p.ws.readyState === 1) {
                        try { p.ws.close(); } catch { 0 }
                    }
                });
                return;
            }

            // Enforce that a game has started and track turn order
            if (!room.game || !room.game.started) {
                try { sendPayload(ws, { type: 'error', error: 'Game not started' }); } catch { /* ignore */ }
                return;
            }

            // Ensure authoritative grid state exists for this room
            if (!room.game.gridState) {
                try {
                    const gridSize = Number.isFinite(room.game.gridSize) ? room.game.gridSize : 3;
                    const colors = Array.isArray(room.game.colors) ? room.game.colors.slice() : [];
                    room.game.gridState = createInitialRoomGridState({ gridSize, playerColors: colors });
                } catch (err) {
                    console.error('[Move] Failed to initialize room grid state', err);
                    try { sendPayload(ws, { type: 'error', error: 'Server failed to initialize game state' }); } catch { /* ignore */ }
                    return;
                }
            }

            const r = Number(msg.row);
            const c = Number(msg.col);
            const players = Array.isArray(room.game.players) ? room.game.players : [];
            const currentTurn = Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0;
            const senderName = meta.name;
            const fromIndex = players.indexOf(senderName);

            if (!Number.isInteger(r) || !Number.isInteger(c)) {
                try { sendPayload(ws, { type: 'error', error: 'Invalid move coordinates' }); } catch { /* ignore */ }
                return;
            }
            if (fromIndex < 0) {
                try { sendPayload(ws, { type: 'error', error: 'Unknown player' }); } catch { /* ignore */ }
                return;
            }

            // Unified sequencing model:
            // - seq starts at 0 each game and increments by exactly 1 per accepted move
            // - during initial placements: strict seq % players.length
            // - after that: expected mover is determined by room.game.turnIndex (alive-aware)
            // - server accepts only seq === currentSeq (new move) or seq < currentSeq (retry/echo)
            //   where currentSeq is the next move number to be played.
            if (Number.isInteger(msg.seq)) {
                const currentSeq = Number.isInteger(room.game.moveSeq) ? room.game.moveSeq : 0;
                const expectedSeq = currentSeq;
                let expectedMover = players.length > 0 ? (expectedSeq % players.length) : 0;
                // Initial placement is always seq-driven. After that, use turnIndex as the single source of truth.
                if (expectedSeq >= players.length) {
                    expectedMover = Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : expectedMover;
                }

                if (room.game.gridState && room.game.gridState.grid && Array.isArray(room.game.colors)) {
                    const alive = computeAliveMask(room.game.gridState.grid, room.game.colors, expectedSeq);
                    console.log('[Server][Turn] Pre-validate', {
                        room: meta.roomName,
                        expectedSeq,
                        expectedMover,
                        alive,
                        playerCount: players.length,
                        colors: room.game.colors,
                        turnIndex: room.game.turnIndex
                    });
                }

                if (msg.seq < expectedSeq) {
                    // Client is retrying an already-committed move (echo was lost)
                    // Check if we have this move in recent moves buffer
                    const recentMove = (room.game.recentMoves || []).find(m =>
                        m.seq === msg.seq && m.row === r && m.col === c
                    );

                    if (recentMove) {
                        // Resend the echo to this client
                        const echoPayload = {
                            type: 'move',
                            room: meta.roomName,
                            row: recentMove.row,
                            col: recentMove.col,
                            color: recentMove.color,
                            seq: recentMove.seq
                        };
                        try { sendPayload(ws, echoPayload); } catch { /* ignore */ }
                        return;
                    }
                    // Move not in buffer - likely too old, send error
                    try {
                        sendPayload(ws, {
                            type: 'error',
                            error: 'Sequence too old',
                            expectedSeq,
                            receivedSeq: msg.seq,
                            currentSeq
                        });
                    } catch { /* ignore */ }
                    return;
                } else if (msg.seq > expectedSeq) {
                    return;
                }
                // msg.seq === expectedSeq - proceed (new move)

                // Turn validation is seq-driven (single source of truth).
                // Keep the old turnIndex check only as a compatibility safety net.
                if (fromIndex !== expectedMover) {
                    return;
                }
            }

            // If client didn't send seq (legacy), fall back to turnIndex validation.
            if (!Number.isInteger(msg.seq)) {
                // Now validate turn (only for NEW moves, not retries)
                if (fromIndex !== currentTurn) {
                    // Silenced - handled correctly by client retry logic
                    return;
                }
            }

            // --- Authoritative grid validation ---
            // Only validate NEW moves (seq === expectedSeq). Retries (seq < expectedSeq) are handled above.
            // Legacy moves without seq cannot be validated deterministically; they are accepted under turnIndex rules.
            if (Number.isInteger(msg.seq)) {
                const state = room.game.gridState;
                console.log('[Server][Move Validation] Incoming move:', {
                    seq: msg.seq, row: r, col: c, fromIndex,
                    expectedSeq: state && Number.isInteger(state.seq) ? state.seq : undefined
                });
                if (state && state.grid) {
                    console.log('[Server][Move Validation] Current grid:');
                    for (let row of state.grid) {
                        console.log(JSON.stringify(row));
                    }
                }
                const result = validateAndApplyMove(
                    state,
                    { seq: msg.seq, row: r, col: c, fromIndex },
                    { MAX_CELL_VALUE, INITIAL_PLACEMENT_VALUE, CELL_EXPLODE_THRESHOLD }
                );
                if (!result.ok) {
                    console.log('[Server][Move Validation] Move rejected:', {
                        reason: result.reason,
                        seq: msg.seq, row: r, col: c, fromIndex
                    });
                    if (state && state.grid) {
                        console.log('[Server][Move Validation] Grid at rejection:');
                        for (let row of state.grid) {
                            console.log(JSON.stringify(row));
                        }
                    }
                    try {
                        sendPayload(ws, {
                            type: 'error',
                            error: 'Invalid move rejected by server',
                            reason: result.reason,
                            expectedSeq: state && Number.isInteger(state.seq) ? state.seq : undefined,
                            receivedSeq: msg.seq,
                            row: r,
                            col: c,
                            fromIndex
                        });
                    } catch { /* ignore */ }
                    return;
                } else {
                    console.log('[Server][Move Validation] Move accepted.');
                }
            }

            // Accept move: compute next turn and prepare for broadcast
            // moveSeq is the *next* move number to be played.
            const newMoveSeq = Number.isInteger(room.game.moveSeq) ? room.game.moveSeq : 0;
            const nextSeq = newMoveSeq + 1;

            // Compute nextIndex from the current mover using the same local-style
            // persistent turnIndex rules (single source of truth).
            //
            // During initial placement, turn order remains seq-driven.
            // After that, we advance from the mover, skipping eliminated players.
            let nextIndex = players.length > 0 ? (nextSeq % players.length) : 0;
            if (players.length > 0 && nextSeq >= players.length) {
                const colors = Array.isArray(room.game.colors) ? room.game.colors : [];
                const grid = room.game.gridState?.grid;
                if (grid && colors.length === players.length) {
                    const computed = advanceTurnIndex(grid, colors, fromIndex, nextSeq);
                    if (computed !== null) nextIndex = computed;
                }

                if (room.game.gridState && room.game.gridState.grid && Array.isArray(room.game.colors)) {
                    const alive = computeAliveMask(room.game.gridState.grid, room.game.colors, nextSeq);
                    console.log('[Server][Turn] Post-apply (advanceTurnIndex)', {
                        room: meta.roomName,
                        newMoveSeq,
                        nextSeq,
                        fromIndex,
                        alive,
                        playerCount: players.length,
                        colors: room.game.colors,
                        computedNextIndex: nextIndex
                    });
                }
            }

            console.log('[Server][Turn] Commit', {
                room: meta.roomName,
                committedMoveSeq: newMoveSeq,
                committedNextSeq: nextSeq,
                committedTurnIndex: nextIndex,
                mover: fromIndex
            });
            // Derive the authoritative color for this player, if available
            const assignedColor = (room.game && Array.isArray(room.game.colors))
                ? room.game.colors[fromIndex]
                : (typeof msg.color === 'string' ? msg.color : undefined);

            const payload = {
                type: 'move',
                room: meta.roomName,
                row: r,
                col: c,
                color: assignedColor,
                seq: newMoveSeq
            };

            // Commit immediately (server-authoritative)
            room.game.moveSeq = nextSeq;
            room.game.turnIndex = nextIndex;

            // Buffer for reconnect/catch-up (keep a rolling history)
            try {
                const moveRecord = { seq: newMoveSeq, room: meta.roomName, row: r, col: c, color: assignedColor };
                if (!Array.isArray(room.game.recentMoves)) room.game.recentMoves = [];
                const bufferSize = 256; // keep enough history for ping-based catch-up
                room.game.recentMoves.push(moveRecord);
                if (room.game.recentMoves.length > bufferSize) room.game.recentMoves.shift();
            } catch { /* ignore buffering errors */ }

            // Immediately confirm back to the sender (does not wait for other clients)
            try { sendPayload(ws, { ...payload, type: 'move_ack' }); } catch { /* ignore */ }

            // Broadcast to all other CONNECTED participants
            const connectedOtherParticipants = room.participants.filter(p => p.sessionId !== senderSessionId && p.connected);
            connectedOtherParticipants.forEach(p => {
                if (p.ws && p.ws.readyState === 1) {
                    try { sendPayload(p.ws, payload); } catch { /* ignore */ }
                }
            });
        } else if (msg.type === 'color_ans') {
            // A client acknowledged start and sent their preferred color
            // Find the sender's sessionId
            const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room || !room._startAcks || !room._startAcks.inProgress) {
                console.log(`[Start Ack] ❌ Received ack from ${meta?.name || 'unknown'} but no start in progress`);
                return;
            }
            const name = meta.name;
            const color = typeof msg.color === 'string' ? String(msg.color) : '';
            // Sanitize color to known palette, else use default
            const sanitizedColor = playerColors.includes(color) ? color : 'green';
            room._startAcks.responses.set(senderSessionId, { name, color: sanitizedColor, sessionId: senderSessionId });
            console.log(`[Start Ack] ✅ Received ack from ${name} (sessionId: ${senderSessionId}) with color ${sanitizedColor} (${room._startAcks.responses.size}/${room._startAcks.expected})`);

            // Check if we have all responses from other clients
            if (room._startAcks.responses.size >= room._startAcks.expected) {
                console.log(`[Start Ack] 🎉 All ${room._startAcks.expected} acks received! Assigning colors...`);
                room._startAcks.colorsCollected = true;

                // Build preferred list in participant order
                const players = room.participants.map(p => p.name);
                const prefs = room.participants.map(p => {
                    const entry = room._startAcks.responses.get(p.sessionId);
                    return entry && typeof entry.color === 'string' ? entry.color : 'green';
                });
                const assigned = assignColorsDeterministic(players, prefs, playerColors);

                // Store assigned colors
                room._startAcks.assignedColors = assigned;

                // Use the gridSize calculated when start was initiated
                const gridSize = room._startAcks.gridSize;

                // Initialize game state (but don't mark as fully started yet)
                room.game = {
                    started: false, // Will be set to true after host receives colors
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned.slice(),
                    gridSize, // Store for potential retry
                    startUuid: room._startAcks.startUuid,
                    // moveSeq is the next sequence number to be played (0-based)
                    moveSeq: 0,
                    recentMoves: []
                };
                // Server-authoritative grid state (ready before first move)
                try {
                    room.game.gridState = createInitialRoomGridState({ gridSize, playerColors: assigned.slice() });
                } catch (err) {
                    console.error('[Start Ack] Failed to initialize grid state', err);
                }
                if (!room._lastSeqByName) room._lastSeqByName = new Map();
                console.log(`[Start Ack] 🎨 Colors assigned:`, { players, colors: assigned, gridSize });

                // Now send start to non-host clients and wait for their acks
                const otherParticipants = room.participants.filter(p => p.sessionId !== room._startAcks.hostSessionId);
                room._startAcks.colorsAcksExpected = otherParticipants.length;
                room._startAcks.colorsAcksReceived = new Set(); // Track by sessionId

                const colorsPayload = JSON.stringify({ type: 'start', room: meta.roomName, players, colors: assigned, gridSize, startUuid: room._startAcks.startUuid });
                console.log(`[Start Ack] 📤 Sending colors to ${otherParticipants.length} non-host clients`);
                otherParticipants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        console.log(`[Start Ack]   → Sending colors to ${p.name} (sessionId: ${p.sessionId})`);
                        try { p.ws.send(colorsPayload); } catch (err) { console.error('[Server] Failed to send colors to participant', p.name, err); }
                    }
                });
            }
        } else if (msg.type === 'start_ack') {
            // A client acknowledged receiving the colors
            // Find the sender's sessionId
            const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room || !room._startAcks || !room._startAcks.colorsCollected) {
                console.log(`[Colors Ack] ❌ Received ack from ${meta?.name || 'unknown'} but no colors sent`);
                return;
            }
            const name = meta.name;
            room._startAcks.colorsAcksReceived.add(senderSessionId);
            console.log(`[Colors Ack] ✅ Received ack from ${name} (sessionId: ${senderSessionId}) (${room._startAcks.colorsAcksReceived.size}/${room._startAcks.colorsAcksExpected})`);

            // Check if we have all color acks from non-host clients
            if (room._startAcks.colorsAcksReceived.size >= room._startAcks.colorsAcksExpected) {
                console.log(`[Colors Ack] 🎉 All color acks received! Sending colors to host...`);

                // Mark game as fully started now
                if (room.game) room.game.started = true;

                // Send start_cnf to host as final confirmation
                const players = room.game.players;
                const colors = room._startAcks.assignedColors;
                const gridSize = room._startAcks.gridSize;
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, colors, gridSize, startUuid: room._startAcks.startUuid };
                console.log(`[Colors Ack] 📤 Sending colors confirmation to host...`);
                try { sendPayload(room._startAcks.hostWs, colorsPayload); } catch (err) { console.error('[Server] Failed to send colors to host', err); }

                // Cleanup
                delete room._startAcks;
                console.log(`[Colors Ack] ✨ Start sequence complete for room ${meta.roomName}`);
            }
        } else if (msg.type === 'leave') {
            // Find the sender's sessionId
            const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

            if (!meta) {
                return;
            }
            const { roomName } = meta;
            const room = rooms[roomName];
            if (!room) {
                connectionMeta.delete(senderSessionId);
                broadcastRoomList(undefined, { excludeSockets: new Set([ws]) });
                return;
            }

            // If the client provided a roomKey, only execute the leave if it matches
            // the room the client is currently in. Otherwise, respond with a roomlist
            // confirmation (like 'list' or invalid host/join while already in a room).
            const requestedRoomKey = (typeof msg.roomKey === 'string' && msg.roomKey) ? String(msg.roomKey) : null;
            if (requestedRoomKey && String(room.roomKey || '') !== requestedRoomKey) {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    player: meta.name,
                    sessionId: senderSessionId,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name, sessionId: p.sessionId })),
                    gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                    started: !!(room.game && room.game.started),
                    roomlistUuid: (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined
                });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
                return;
            }

            room.participants = room.participants.filter(p => p.sessionId !== senderSessionId);
            connectionMeta.delete(senderSessionId);
            if (room.participants.length === 0) {
                const oldKey = room.roomKey;
                console.log(`[Room Delete] Room '${roomName}' deleted because last participant left/disconnected.`);
                delete rooms[roomName];
                if (oldKey) roomKeys.delete(oldKey);
            }

            // Echo roomlistUuid back to the leaver (if provided) via a per-client roomlist.
            const roomlistUuid = (typeof msg.roomlistUuid === 'string' && msg.roomlistUuid) ? String(msg.roomlistUuid) : undefined;
            // Always broadcast lobby change to all clients (excluding the leaver).
            broadcastRoomList(undefined, { excludeSockets: new Set([ws]) });
            // Additionally, if the client provided a roomlistUuid, echo it back only to them
            // so they can correlate the leave action.
            if (roomlistUuid) {
                const perClientExtras = new Map();
                // No specific room entry needs enrichment here; we only want to send the uuid.
                perClientExtras.set(ws, { roomlistUuid });
                broadcastRoomList(perClientExtras, { targetedOnly: true });
            }
        } else if (msg.type === 'ping') {
            // Ping now carries client's next expected move sequence number.
            // If the client is behind, send the missing moves.
            const { meta } = findSessionByWs(ws);
            const roomName = meta?.roomName;
            const room = roomName ? rooms[roomName] : undefined;

            const clientSeq = Number.isInteger(msg.seq) ? msg.seq : 0;
            const serverSeq = room && room.game ? (room.game.moveSeq || 0) : 0;

            if (!room || !room.game || !room.game.started) {
                // Not in a started game; keep-alive only.
                try { sendPayload(ws, { type: 'pong', seq: serverSeq }); } catch { /* ignore */ }
                return;
            }

            if (clientSeq === serverSeq) {
                try { sendPayload(ws, { type: 'pong', seq: serverSeq }); } catch { /* ignore */ }
                return;
            }

            // Client is behind (or ahead due to bad state). Send what we have.
            let moves = [];
            try {
                const recent = Array.isArray(room.game.recentMoves) ? room.game.recentMoves : [];
                // If clientSeq is the next expected seq, we need to send all moves with seq >= clientSeq.
                moves = recent.filter(m => Number.isInteger(m.seq) && m.seq >= clientSeq);
            } catch { /* ignore */ }

            try {
                sendPayload(ws, {
                    type: 'missing_moves',
                    fromSeq: clientSeq,
                    serverSeq,
                    moves
                });
            } catch { /* ignore */ }
        }
    });

    // Greet new connections
    try { sendPayload(ws, { type: 'info', version: APP_VERSION }); } catch { /* ignore */ }

    // Note: During the 30s rejoin grace window for started games, we intentionally
    // keep move sequencing/history intact even if all players disconnect.
    // Resetting moveSeq/recentMoves here can desync clients that reconnect with a
    // higher lastAppliedSeq (server would report serverSeq=0 and reject new moves).

    ws.on('close', () => {
        console.error('[Client] 🔌 Disconnected');
        // Find the sessionId for this ws
        const { sessionId: senderSessionId, meta } = findSessionByWs(ws);

        if (!meta) return;
        const { roomName, name } = meta;
        const room = rooms[roomName];
        if (!room) { connectionMeta.delete(senderSessionId); return; }

        // Check if game has started
        const isGameStarted = !!(room.game && room.game.started);

        // Only remove participant if room has NOT started
        if (!isGameStarted) {
            const participantIndex = room.participants.findIndex(p => p.sessionId === senderSessionId);
            if (participantIndex >= 0) {
                console.log(`[Disconnect] Removing ${name} (sessionId: ${senderSessionId}) from non-started room ${roomName}`);

                // Clear any pending disconnect timer for this sessionId
                if (room._disconnectTimers && room._disconnectTimers.has(senderSessionId)) {
                    try { clearTimeout(room._disconnectTimers.get(senderSessionId)); } catch { /* ignore */ }
                    room._disconnectTimers.delete(senderSessionId);
                }

                // Remove the participant
                room.participants.splice(participantIndex, 1);

                // If room is now empty, delete it
                if (room.participants.length === 0) {
                    console.log(`[Disconnect] Room ${roomName} is now empty, deleting`);
                    const oldKey = room.roomKey;
                    delete rooms[roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // Notify remaining clients about updated roster
                    room.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            sendPayload(p.ws, { type: 'roomupdate', room: roomName, players: room.participants.map(pp => ({ name: pp.name, sessionId: pp.sessionId })) });
                        }
                    });
                }
            }
        } else {
            // Game has started: mark participant as disconnected but keep in room for rejoin
            const participant = room.participants.find(p => p.sessionId === senderSessionId);
            if (participant) {
                // Only mark as disconnected if this WebSocket is the current one for this participant
                // (ignore stale close events from old WebSockets after reconnection)
                if (participant.ws !== ws) {
                    console.log(`[Disconnect] Ignoring stale disconnect event for ${name} (closing ws is not current: old=${ws.readyState}, current=${participant.ws ? participant.ws.readyState : 'null'})`);
                    connectionMeta.delete(senderSessionId);
                    return;
                }

                console.log(`[Disconnect] ${name} (sessionId: ${senderSessionId}) disconnected from started room ${roomName} (marked for rejoin, not removed)`);
                participant.connected = false;
                participant.ws = null;

                // Check if all participants are now disconnected - if so, schedule room deletion
                const anyConnected = room.participants.some(p => p.connected);
                if (!anyConnected && !room._roomDeletionTimer) {
                    console.log(`[Disconnect] All players disconnected from room ${roomName}, scheduling room deletion`);
                    room._roomDeletionTimer = setTimeout(() => {
                        console.log(`[Disconnect] Timeout: Deleting empty room ${roomName}`);
                        const oldKey = room.roomKey;
                        delete rooms[roomName];
                        if (oldKey) roomKeys.delete(oldKey);
                        // Room was a started game; don't push roomlist changes to outsiders.
                        // (There shouldn't be any connected participants at this point, but keep it consistent.)
                        broadcastRoomList(undefined, { targetRoomName: roomName });
                    }, 30000); // 30 second grace period for all players to rejoin
                }
            }
        }

        connectionMeta.delete(senderSessionId);
        // Privacy: don't push roomlist updates caused by a started room to outsiders.
        // Participants still receive the updated roomlist; outsiders can always request via 'list'.
        if (isGameStarted) {
            broadcastRoomList(undefined, { targetRoomName: roomName });
        } else {
            broadcastRoomList();
        }
    });
});

function getRoomList() {
    // Show all rooms (joinable and full); provide sanitized metadata
    const result = {};
    Object.keys(rooms).forEach(name => {
        const r = rooms[name];
        if (!r) return;
        const maxPlayers = Number.isFinite(r.maxPlayers) ? r.maxPlayers : 2;
        const currentPlayers = (r.participants?.length || 0);
        const hostName = (r.participants && r.participants[0]) ? r.participants[0].name : undefined;
        const players = (r.participants || []).map(p => ({ name: p.name }));
        result[name] = { maxPlayers, currentPlayers, hostName, players };
    });
    return result;
}

function clampPlayers(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return 2;
    return Math.max(2, Math.min(8, v));
}

// Sanitize an incoming name and enforce base length 12.
function sanitizeBaseName(raw) {
    try {
        let s = String(raw || '').trim();
        if (!s) s = 'Player';
        // Align with client: replace spaces with underscores and drop non-alphanumerics/underscore
        s = s.replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
        if (s.length > PLAYER_NAME_LENGTH) s = s.slice(0, PLAYER_NAME_LENGTH);
        return s;
    } catch {
        return 'Player';
    }
}

// Pick a unique name within a room by appending a single-digit suffix 2..9 in the 13th position if needed.
// Generic unique name picker with suffixing 2..9 in 13th position; returns null if exhausted
function pickUniqueFromTaken(raw, takenArray) {
    const base = sanitizeBaseName(raw);
    const taken = Array.isArray(takenArray) ? takenArray : [];
    if (!taken.includes(base)) return base;
    for (let i = 2; i <= 9; i++) {
        const candidate = base.slice(0, PLAYER_NAME_LENGTH) + String(i);
        if (!taken.includes(candidate)) return candidate;
    }
    return null; // signal exhaustion instead of falling back to base
}

// Pick a unique player name within a room, or null if variants exhausted
function pickUniqueName(room, raw) {
    const taken = room && Array.isArray(room.participants)
        ? room.participants.map(p => p.name)
        : [];
    return pickUniqueFromTaken(raw, taken);
}

// Pick a unique room name across all rooms using the same pattern; or null if exhausted
function pickUniqueRoomName(raw) {
    const taken = Object.keys(rooms);
    return pickUniqueFromTaken(raw, taken);
}

/**
 * Broadcasts the room list, with optional per-client enrichment.
 *
 * By default it sends to all connected clients. When `targetRoomName` is provided,
 * it sends only to currently-connected participants of that room.
 *
 * @param {Map<WebSocket,object>} [perClientExtras] - Map of ws -> extra fields to merge into their room entry
 * @param {{targetRoomName?: string|null, targetedOnly?: boolean, excludeSockets?: Set<WebSocket>}} [opts]
 */
function broadcastRoomList(perClientExtras, opts = {}) {
    const baseRooms = getRoomList();
    const targetRoomName = (opts && typeof opts.targetRoomName === 'string' && opts.targetRoomName)
        ? String(opts.targetRoomName)
        : null;
    const targetRoom = targetRoomName ? rooms[targetRoomName] : null;

    /** @type {Set<WebSocket>|null} */
    let targetSockets = null;
    if (targetRoomName && targetRoom && Array.isArray(targetRoom.participants)) {
        targetSockets = new Set(
            targetRoom.participants
                .filter(p => p && p.connected && p.ws && p.ws.readyState === 1)
                .map(p => p.ws)
        );
    } else if (targetRoomName) {
        // Target specified but room doesn't exist -> nothing to send.
        targetSockets = new Set();
    }

    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        if (opts && opts.excludeSockets && opts.excludeSockets.has(client)) return;
        // When targetedOnly is enabled, only send to clients explicitly listed in perClientExtras
        if (opts && opts.targetedOnly && perClientExtras && !perClientExtras.has(client)) return;
        if (targetSockets && !targetSockets.has(client)) return;
        let roomListPayload = baseRooms;
        let roomlistUuid = undefined;
        // Check if this client is in any room via connectionMeta
        const { sessionId: clientSessionId, meta } = findSessionByWs(client);

        if (meta && meta.roomName && baseRooms[meta.roomName]) {
            // Clone rooms and enrich with client's player info
            roomListPayload = { ...roomListPayload };
            roomListPayload[meta.roomName] = { ...roomListPayload[meta.roomName], player: meta.name, sessionId: clientSessionId };
        }
        // If this client has extra info (e.g. host/join confirmation), merge it into their room entry
        if (perClientExtras && perClientExtras.has(client)) {
            const extras = perClientExtras.get(client);
            // Allow sending a per-client correlation UUID without necessarily enriching a room entry.
            if (extras && typeof extras.roomlistUuid === 'string' && extras.roomlistUuid) {
                roomlistUuid = String(extras.roomlistUuid);
            }
            if (extras && extras.room && baseRooms[extras.room]) {
                if (roomListPayload === baseRooms) roomListPayload = { ...roomListPayload };
                roomListPayload[extras.room] = { ...roomListPayload[extras.room], ...extras };
            }
        }
        const payload = roomlistUuid
            ? { type: 'roomlist', rooms: roomListPayload, roomlistUuid }
            : { type: 'roomlist', rooms: roomListPayload };
        const list = JSON.stringify(payload);
        try { client.send(list); } catch (err) { console.error('[Server] Failed to broadcast roomlist to client', err); }
    });
}

/**
 * Find the sessionId and metadata for a given WebSocket connection.
 * @param {WebSocket} ws - the WebSocket connection to look up
 * @returns {{sessionId: string, meta: object} | {sessionId: null, meta: null}} - sessionId and meta, or null if not found
 */
function findSessionByWs(ws) {
    for (const [sid, m] of connectionMeta.entries()) {
        if (m && m.participantRef && m.participantRef.ws === ws) {
            return { sessionId: sid, meta: m };
        }
    }
    return { sessionId: null, meta: null };
}

/**
 * Assign unique colors to players deterministically using their preferred colors.
 * Order: host first (current room.participants order).
 * Rule: if a preferred color was already taken, assign the next color in playerColors
 * that is NOT inside the preferred colors list. If none remain, pick the next
 * available color not yet assigned.
 * @param {string[]} players - ordered player names
 * @param {string[]} prefs - preferred colors in same order as players
 * @param {string[]} palette - available colors (server-authoritative)
 * @returns {string[]} assignedColors - same length as players
 */
function assignColorsDeterministic(players, prefs, palette) {
    const n = Array.isArray(players) ? players.length : 0;
    if (n <= 0) return [];
    const available = Array.isArray(palette) && palette.length ? palette.slice() : playerColors.slice();
    const preferredSet = new Set(prefs.filter(c => available.includes(c)));
    const assigned = [];
    const used = new Set();

    for (let i = 0; i < n; i++) {
        const pref = prefs[i];
        if (available.includes(pref) && !used.has(pref)) {
            // Take preferred color if not yet taken
            assigned.push(pref); used.add(pref); continue;
        }
        // Find next color after preferred that is not in preferredSet and not used
        let pick = null;
        if (available.includes(pref)) {
            let idx = available.indexOf(pref);
            for (let step = 1; step <= available.length; step++) {
                const cand = available[(idx + step) % available.length];
                if (!preferredSet.has(cand) && !used.has(cand)) { pick = cand; break; }
            }
        }
        // Fallback: any remaining color not used
        if (!pick) {
            for (const c of available) { if (!used.has(c)) { pick = c; break; } }
        }
        if (!pick) pick = available[0]; // last resort (shouldn't happen)
        assigned.push(pick); used.add(pick);
    }
    return assigned;
}

// Generate a random room key (9 chars alphanumeric) ensuring uniqueness
function generateRoomKey() {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randLength = 6;
    let key = '';
    let attempts = 0;
    do {
        // Timestamp part: last 4 base36 chars of current ms timestamp
        const ts = Date.now().toString(36).slice(-4);
        let rand = '';
        for (let i = 0; i < randLength; i++) {
            rand += alphabet[Math.floor(Math.random() * alphabet.length)];
        }
        key = rand + ts;
        attempts++;
        if (attempts > 500) break;
    } while (roomKeys.has(key));
    return key;
}

// Generate a unique session ID for tracking client sessions across reconnects
function generateSessionId() {
    // Prefer standards-based UUIDs over Math.random-based IDs.
    try {
        // Node (ESM): crypto is imported at module scope.
        if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
        if (typeof crypto?.randomBytes === 'function') {
            const bytes = crypto.randomBytes(16);
            // RFC4122 v4
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = bytes.toString('hex');
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
    } catch { /* ignore */ }

    // Last-resort fallback (kept for extreme environments). Not cryptographically strong.
    return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
