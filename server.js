// Player name length limit (base, not including suffix)
const PLAYER_NAME_LENGTH = 12;
import http from 'http';
import process from 'node:process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { WebSocketServer } from 'ws';

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
//     participants: Array<{ ws: WebSocket, name: string, isHost: boolean, connected: boolean, sessionId?: string }>,
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
// Track which room a connection belongs to and the player's name (per tab)
const connectionMeta = new Map(); // ws -> { roomName: string, name: string, sessionId?: string }
// Allow brief disconnects to reattach by name before freeing the seat
const GRACE_MS = 300000; // 5 min grace window

/**
 * Sends a JSON payload to a WebSocket client.
 *
 * @param {WebSocket} ws - The WebSocket connection to send to.
 * @param {object} payload - The payload object to send (will be JSON-stringified).
 */
function sendPayload(ws, payload) {
    // Debug: Simulate 50% packet loss
    if (Math.random() < 0.50) {
        console.warn('[Server] 🔥 SIMULATED PACKET LOSS:', ws, payload);
        return;
    }
    try {
        ws.send(JSON.stringify(payload));
    } catch (err) {
        try {
            const t = payload && typeof payload === 'object' ? payload.type : undefined;
            const state = typeof ws?.readyState === 'number' ? ws.readyState : undefined;
            console.error('[Server] Failed to send payload', { type: t, readyState: state }, err);
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

        if (msg.type === 'restore_session' && typeof msg.roomKey === 'string' && typeof msg.playerName === 'string' && typeof msg.sessionId === 'string') {
            // Client is attempting to restore a previous session
            const roomKey = String(msg.roomKey);
            const playerName = String(msg.playerName);
            const sessionId = String(msg.sessionId);
            
            console.log('[Session Restore] Attempt from client:', { roomKey, playerName, sessionId });
            
            // Find room by key
            const roomName = roomKeys.get(roomKey);
            if (!roomName || !rooms[roomName]) {
                console.log('[Session Restore] ❌ Room not found for key:', roomKey);
                // Don't send error - just let normal reconnection flow handle it
                return;
            }
            
            const room = rooms[roomName];
            
            // Find participant by name and sessionId
            const participant = room.participants.find(p => p.name === playerName && p.sessionId === sessionId);
            if (!participant) {
                console.log('[Session Restore] ❌ No matching participant found:', { playerName, sessionId });
                // Player not in this room or sessionId doesn't match
                return;
            }
            
            // Clear any pending disconnect timer for this participant
            if (room._disconnectTimers && room._disconnectTimers.has(playerName)) {
                try { clearTimeout(room._disconnectTimers.get(playerName)); } catch { /* ignore */ }
                room._disconnectTimers.delete(playerName);
            }
            
            // Close old WebSocket if still open
            if (participant.ws && participant.ws !== ws && participant.ws.readyState === 1) {
                try { participant.ws.terminate(); } catch { /* ignore */ }
            }
            
            // Swap out the old WebSocket with the new one
            participant.ws = ws;
            participant.connected = true;
            
            // Update connectionMeta for the new WebSocket
            connectionMeta.set(ws, { roomName, name: playerName, sessionId });
            
            console.log('[Session Restore] ✅ Session restored for', playerName, 'in room', roomName);
            
            // Send enriched roomlist to confirm restoration
            const perClientExtras = new Map();
            perClientExtras.set(ws, {
                room: roomName,
                roomKey: room.roomKey,
                maxPlayers: room.maxPlayers,
                player: playerName,
                players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                started: !!(room.game && room.game.started)
            });
            broadcastRoomList(perClientExtras);
            
            // If game is active, send catch-up data
            if (room.game && room.game.started) {
                const lastSeq = (room._lastSeqByName && room._lastSeqByName.get(playerName)) || 0;
                const recentMoves = (room.game && Array.isArray(room.game.recentMoves))
                    ? room.game.recentMoves.filter(m => (m.seq || 0) > lastSeq)
                    : [];
                const rejoinPayload = {
                    type: 'rejoined',
                    room: roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                    started: true,
                    turnIndex: room.game && Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0,
                    colors: room.game && Array.isArray(room.game.colors) ? room.game.colors : undefined,
                    recentMoves
                };
                try { sendPayload(ws, rejoinPayload); } catch { /* ignore */ }
            }
            
            return;
        } else if (msg.type === 'host') {
            // If this connection is already in a room, remove it from that room first
            const metaExisting = connectionMeta.get(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.ws !== ws);
                if (prevRoom.participants.length === 0) {
                    const oldKey = prevRoom.roomKey;
                    delete rooms[metaExisting.roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // notify previous room (no roomupdate, just rely on roomlist)
                }
                connectionMeta.delete(ws);
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
            const sessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();
            rooms[uniqueRoomName] = {
                maxPlayers: clamped,
                participants: [{ ws, name: playerName, isHost: true, connected: true, sessionId }],
                _disconnectTimers: new Map(),
                desiredGridSize: requestedGrid, // null means use dynamic playerCount+3
                roomKey
            };
            roomKeys.set(roomKey, uniqueRoomName);
            connectionMeta.set(ws, { roomName: uniqueRoomName, name: playerName, sessionId });
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
                players: [{ name: playerName }],
                gridSize: requestedGrid !== null ? requestedGrid : undefined,
                started: false
            });
            broadcastRoomList(perClientExtras);
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
            const metaExisting = connectionMeta.get(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.ws !== ws);
                if (prevRoom.participants.length === 0) {
                    const oldKey = prevRoom.roomKey;
                    delete rooms[metaExisting.roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // notify previous room (no roomupdate, just rely on roomlist)
                }
                connectionMeta.delete(ws);
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
            const sessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();
            room.participants.push({ ws, name: playerName, isHost: false, connected: true, sessionId });
            connectionMeta.set(ws, { roomName: msg.roomName, name: playerName, sessionId });

            // No direct roomupdate confirmation; rely on enriched roomlist
            // Enrich roomlist for the joiner so their room entry includes player/roomKey confirmation
            {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: msg.roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    player: playerName,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                    gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                    started: !!(room.game && room.game.started)
                });
                broadcastRoomList(perClientExtras);
            }
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
            // Remove from existing room if any
            const metaExisting = connectionMeta.get(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.ws !== ws);
                if (prevRoom.participants.length === 0) {
                    const oldKey = prevRoom.roomKey;
                    delete rooms[metaExisting.roomName];
                    if (oldKey) roomKeys.delete(oldKey);
                } else {
                    // notify previous room (no roomupdate, just rely on roomlist)
                }
                connectionMeta.delete(ws);
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
            const sessionId = (typeof msg.sessionId === 'string' && msg.sessionId) ? String(msg.sessionId) : generateSessionId();
            room.participants.push({ ws, name: playerName, isHost: false, connected: true, sessionId });
            connectionMeta.set(ws, { roomName, name: playerName, sessionId });
            // No direct roomupdate confirmation; rely on enriched roomlist
            // Enrich roomlist for the joiner so their room entry includes player/roomKey confirmation
            {
                const perClientExtras = new Map();
                perClientExtras.set(ws, {
                    room: roomName,
                    roomKey: room.roomKey,
                    maxPlayers: room.maxPlayers,
                    player: playerName,
                    players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                    gridSize: Number.isFinite(room.desiredGridSize) ? room.desiredGridSize : undefined,
                    started: !!(room.game && room.game.started)
                });
                broadcastRoomList(perClientExtras);
            }
        } else if (msg.type === 'reconnect' && msg.roomName && typeof msg.debugName === 'string') {
            const room = rooms[msg.roomName];
            if (!room) {
                sendPayload(ws, { type: 'error', error: 'Room not found' });
                return;
            }
            const name = sanitizeBaseName(msg.debugName);
            const participant = room.participants.find(p => p.name === name);
            if (!participant) {
                sendPayload(ws, { type: 'error', error: 'No disconnected session to reattach' });
                return;
            }
            // Clear any pending purge timer for this name
            if (room._disconnectTimers && room._disconnectTimers.has(name)) {
                try { clearTimeout(room._disconnectTimers.get(name)); } catch { /* ignore */ }
                room._disconnectTimers.delete(name);
            }
            // Attach this socket and mark connected
            if (participant.ws && participant.ws !== ws && participant.ws.readyState === 1) {
                try { participant.ws.terminate(); } catch { /* ignore */ }
            }
            participant.ws = ws;
            participant.connected = true;
            connectionMeta.set(ws, { roomName: msg.roomName, name, sessionId: participant.sessionId });
            // Compute missed moves since last seen sequence for this player
            const lastSeq = (room._lastSeqByName && room._lastSeqByName.get(name)) || 0;
            const recentMoves = (room.game && Array.isArray(room.game.recentMoves))
                ? room.game.recentMoves.filter(m => (m.seq || 0) > lastSeq)
                : [];
            const rejoinPayload = {
                type: 'rejoined',
                room: msg.roomName,
                roomKey: room.roomKey,
                maxPlayers: room.maxPlayers,
                players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                started: !!(room.game && room.game.started),
                turnIndex: room.game && Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0,
                colors: room.game && Array.isArray(room.game.colors) ? room.game.colors : undefined,
                recentMoves
            };
            try { sendPayload(ws, rejoinPayload); } catch { /* ignore */ }
            // Notify others of updated connected roster
            // No direct roomupdate confirmation; rely on enriched roomlist
            broadcastRoomList();
        } else if (msg.type === 'list') {
            sendPayload(ws, { type: 'roomlist', rooms: getRoomList() });
        } else if (msg.type === 'start_req') {
            // Only the host can start; use their current room from connectionMeta
            const meta = connectionMeta.get(ws);
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
            // Verify host
            const isHost = room.participants.length && room.participants[0].ws === ws;
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
            console.log(`[Start] 🎮 Host ${meta.name} initiating start for room ${meta.roomName} with ${playerCount} players`);
            
            // Check if game already started (host is retrying after start_cnf was lost)
            if (room.game && room.game.started) {
                console.log(`[Start] 🔄 Game already started, resending start_cnf to host ${meta.name}`);
                const colorsPayload = {
                    type: 'start_cnf',
                    room: meta.roomName,
                    players: room.game.players,
                    gridSize: room.game.gridSize || 3, // Use stored gridSize
                    colors: room.game.colors
                };
                try { sendPayload(ws, colorsPayload); } catch (err) { console.error('[Server] Failed to resend colors to host', err); }
                return;
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
                    const colorsPayload = JSON.stringify({ type: 'start', room: meta.roomName, players, colors: room._startAcks.assignedColors, gridSize: room._startAcks.gridSize });
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
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, colors: room._startAcks.assignedColors, gridSize: room._startAcks.gridSize };
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
                    moveSeq: 0,
                    recentMoves: []
                };
                if (!room._lastSeqByName) room._lastSeqByName = new Map();
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, gridSize, colors: assigned };
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
                responses: new Map(), // ws -> { name, color }
                hostWs: ws,
                hostName: meta.name,
                gridSize // Store for later use when sending to host
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
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room) return;

            // Enforce that a game has started and track turn order
            if (!room.game || !room.game.started) {
                try { sendPayload(ws, { type: 'error', error: 'Game not started' }); } catch { /* ignore */ }
                return;
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

            // IMPLICIT ACKNOWLEDGMENT: If this client is sending a move with seq N,
            // they must have received all moves up to seq N-1.
            // This MUST run BEFORE sequence validation to commit pending moves first.
            if (room.game._moveAcks && Number.isInteger(msg.seq)) {
                const clientSeq = msg.seq;
                // Acknowledge all pending moves with seq < clientSeq
                for (const [ackKey, ackData] of room.game._moveAcks.entries()) {
                    const pendingSeq = parseInt(ackKey.replace('move_', ''));
                    // Only implicitly ack if:
                    // 1. This client is expected to ack (they're a receiver, not the sender)
                    // 2. The pending move seq is less than the current move seq
                    if (pendingSeq < clientSeq && ackData.expectedAcks.has(ws) && ackData.senderWs !== ws) {
                        // This client should have received this move, implicitly acknowledge it
                        ackData.receivedAcks.add(ws);
                        
                        // Check if all clients have now acknowledged
                        const allAcked = [...ackData.expectedAcks].every(expectedWs => ackData.receivedAcks.has(expectedWs));
                        if (allAcked) {
                            // All clients acknowledged - commit the move, send echo to sender
                            clearTimeout(ackData.timeout);
                            ackData.commitMove();
                            try { sendPayload(ackData.senderWs, ackData.payload); } catch { /* ignore */ }
                            room.game._moveAcks.delete(ackKey);
                        }
                    }
                }
            }

            // Validate sequence number BEFORE turn validation (to handle retries of already-committed/pending moves)
            if (Number.isInteger(msg.seq)) {
                const currentSeq = room.game.moveSeq || 0;
                const expectedSeq = currentSeq + 1;
                
                if (msg.seq < expectedSeq) {
                    // Client is retrying an already-committed move (echo was lost)
                    // Check if we have this move in recent moves buffer
                    const recentMove = (room.game.recentMoves || []).find(m => 
                        m.seq === msg.seq && m.row === r && m.col === c && m.fromIndex === fromIndex
                    );
                    
                    if (recentMove) {
                        // Resend the echo to this client
                        const echoPayload = {
                            type: 'move',
                            room: meta.roomName,
                            row: recentMove.row,
                            col: recentMove.col,
                            fromIndex: recentMove.fromIndex,
                            nextIndex: recentMove.nextIndex,
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
                // msg.seq === expectedSeq - proceed to check for pending moves or new move
            }

            // Check if this move is already pending acknowledgment (client is retrying)
            const newMoveSeq = (room.game.moveSeq || 0) + 1;
            const pendingAckKey = `move_${newMoveSeq}`;
            if (room.game._moveAcks && room.game._moveAcks.has(pendingAckKey)) {
                const pendingAck = room.game._moveAcks.get(pendingAckKey);
                // Verify it's the same move from the same sender
                if (pendingAck.senderWs === ws) {
                    // This is a retry of a pending move - resend to clients that haven't acked yet
                    const otherParticipants = room.participants.filter(p => p.ws !== ws && p.connected);
                    otherParticipants.forEach(p => {
                        // Only resend to clients that haven't acknowledged
                        if (!pendingAck.receivedAcks.has(p.ws) && p.ws.readyState === 1) {
                            try { sendPayload(p.ws, pendingAck.payload); } catch { /* ignore */ }
                        }
                    });
                    // Don't process this as a new move
                    return;
                }
            }

            // Now validate turn (only for NEW moves, not retries)
            if (fromIndex !== currentTurn) {
                // Silenced - handled correctly by client retry logic
               return;
            }

            // Accept move: compute next turn and prepare for broadcast
            const nextIndex = (fromIndex + 1) % Math.max(1, players.length);
            // Derive the authoritative color for this player, if available
            const assignedColor = (room.game && Array.isArray(room.game.colors))
                ? room.game.colors[fromIndex]
                : (typeof msg.color === 'string' ? msg.color : undefined);
            
            const payload = {
                type: 'move',
                room: meta.roomName,
                row: r,
                col: c,
                fromIndex,
                nextIndex,
                color: assignedColor,
                seq: newMoveSeq
            };

            // Get all other participants (not the sender)
            const otherParticipants = room.participants.filter(p => p.ws !== ws && p.connected);
            
            // Function to commit the move (increment sequence and update turn)
            const commitMove = () => {
                // Now commit the sequence increment and buffer the move
                room.game.moveSeq = newMoveSeq;
                room.game.turnIndex = nextIndex;
                
                // Buffer for reconnect catch-up
                try {
                    const moveRecord = { seq: newMoveSeq, room: meta.roomName, row: r, col: c, fromIndex, nextIndex, color: assignedColor };
                    if (!Array.isArray(room.game.recentMoves)) room.game.recentMoves = [];
                    const bufferSize = Math.max(1, (Array.isArray(room.game.players) ? room.game.players.length : 2));
                    room.game.recentMoves.push(moveRecord);
                    if (room.game.recentMoves.length > bufferSize) room.game.recentMoves.shift();
                } catch { /* ignore buffering errors */ }
            };
            
            // If there are no other participants, immediately confirm to sender
            if (otherParticipants.length === 0) {
                commitMove();
                const ackPayload = { ...payload, type: 'move_ack' };
                try { sendPayload(ws, ackPayload); } catch { /* ignore */ }
            } else {
                // Initialize move acknowledgment tracking
                if (!room.game._moveAcks) room.game._moveAcks = new Map();
                
                const ackKey = `move_${newMoveSeq}`;
                const ackData = {
                    senderWs: ws,
                    payload,
                    commitMove, // Pass the commit function
                    expectedAcks: new Set(otherParticipants.map(p => p.ws)), // Track by WebSocket, not name
                    receivedAcks: new Set()
                    // No timeout: wait indefinitely for all acks
                };
                room.game._moveAcks.set(ackKey, ackData);

                // Broadcast move to all OTHER participants (not the sender)
                otherParticipants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        try { sendPayload(p.ws, payload); } catch { /* ignore */ }
                    }
                });
            }
        } else if (msg.type === 'move_ack') {
            // Client acknowledged receipt of a move
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room || !room.game || !room.game._moveAcks) return;
            
            const moveSeq = Number(msg.seq);
            if (!Number.isInteger(moveSeq)) return;
            
            const ackKey = `move_${moveSeq}`;
            const ackData = room.game._moveAcks.get(ackKey);
            if (!ackData) return; // No pending acknowledgment for this move
            
            // Record this client's acknowledgment by WebSocket, not name
            ackData.receivedAcks.add(ws);
            
            // Check if all expected clients have acknowledged
            const allAcked = [...ackData.expectedAcks].every(expectedWs => ackData.receivedAcks.has(expectedWs));
            
            if (allAcked) {
                // All clients acknowledged - commit the move, send echo to sender
                            // No timeout to clear
                ackData.commitMove(); // Commit sequence and turn
                const ackPayload = { ...ackData.payload, type: 'move_ack' };
                try { sendPayload(ackData.senderWs, ackPayload); } catch { /* ignore */ }
                room.game._moveAcks.delete(ackKey);
            }
        } else if (msg.type === 'color_ans') {
            // A client acknowledged start and sent their preferred color
            const meta = connectionMeta.get(ws);
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
            room._startAcks.responses.set(ws, { name, color: sanitizedColor });
            console.log(`[Start Ack] ✅ Received ack from ${name} with color ${sanitizedColor} (${room._startAcks.responses.size}/${room._startAcks.expected})`);
            
            // Check if we have all responses from other clients
            if (room._startAcks.responses.size >= room._startAcks.expected) {
                console.log(`[Start Ack] 🎉 All ${room._startAcks.expected} acks received! Assigning colors...`);
                room._startAcks.colorsCollected = true;
                
                // Build preferred list in participant order
                const players = room.participants.map(p => p.name);
                const prefs = room.participants.map(p => {
                    const entry = room._startAcks.responses.get(p.ws);
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
                    moveSeq: 0,
                    recentMoves: []
                };
                if (!room._lastSeqByName) room._lastSeqByName = new Map();
                console.log(`[Start Ack] � Colors assigned:`, { players, colors: assigned, gridSize });
                
                // Now send start to non-host clients and wait for their acks
                const otherParticipants = room.participants.filter(p => p.name !== room._startAcks.hostName);
                room._startAcks.colorsAcksExpected = otherParticipants.length;
                room._startAcks.colorsAcksReceived = new Set(); // Track by WebSocket
                
                const colorsPayload = JSON.stringify({ type: 'start', room: meta.roomName, players, colors: assigned, gridSize });
                console.log(`[Start Ack] 📤 Sending colors to ${otherParticipants.length} non-host clients`);
                otherParticipants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        console.log(`[Start Ack]   → Sending colors to ${p.name}`);
                        try { p.ws.send(colorsPayload); } catch (err) { console.error('[Server] Failed to send colors to participant', p.name, err); }
                    }
                });
            }
        } else if (msg.type === 'start_ack') {
            // A client acknowledged receiving the colors
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room || !room._startAcks || !room._startAcks.colorsCollected) {
                console.log(`[Colors Ack] ❌ Received ack from ${meta?.name || 'unknown'} but no colors sent`);
                return;
            }
            const name = meta.name;
            room._startAcks.colorsAcksReceived.add(ws);
            console.log(`[Colors Ack] ✅ Received ack from ${name} (${room._startAcks.colorsAcksReceived.size}/${room._startAcks.colorsAcksExpected})`);
            
            // Check if we have all color acks from non-host clients
            if (room._startAcks.colorsAcksReceived.size >= room._startAcks.colorsAcksExpected) {
                console.log(`[Colors Ack] 🎉 All color acks received! Sending colors to host...`);
                
                // Mark game as fully started now
                if (room.game) room.game.started = true;
                
                // Send start_cnf to host as final confirmation
                const players = room.game.players;
                const colors = room._startAcks.assignedColors;
                const gridSize = room._startAcks.gridSize;
                const colorsPayload = { type: 'start_cnf', room: meta.roomName, players, colors, gridSize };
                console.log(`[Colors Ack] 📤 Sending colors confirmation to host ${room._startAcks.hostName}`);
                try { sendPayload(room._startAcks.hostWs, colorsPayload); } catch (err) { console.error('[Server] Failed to send colors to host', err); }
                
                // Cleanup
                delete room._startAcks;
                console.log(`[Colors Ack] ✨ Start sequence complete for room ${meta.roomName}`);
            }
        } else if (msg.type === 'leave') {
            const meta = connectionMeta.get(ws);
            if (!meta) {
                return;
            }
            const { roomName } = meta;
            const room = rooms[roomName];
            if (!room) {
                connectionMeta.delete(ws);
                broadcastRoomList();
                return;
            }
            room.participants = room.participants.filter(p => p.ws !== ws);
            connectionMeta.delete(ws);
            if (room.participants.length === 0) {
                const oldKey = room.roomKey;
                delete rooms[roomName];
                if (oldKey) roomKeys.delete(oldKey);
            }
            broadcastRoomList();
        }
    });

    // Greet new connections
    try { sendPayload(ws, { type: 'info', message: 'Connected to server!' }); } catch { /* ignore */ }

    ws.on('close', () => {
        const meta = connectionMeta.get(ws);
        if (!meta) return;
        const { roomName, name } = meta;
        const room = rooms[roomName];
        if (!room) { connectionMeta.delete(ws); return; }

        // Mark participant disconnected (reserve seat) and schedule purge
        const participant = room.participants.find(p => p.name === name);
        if (participant) {
            participant.connected = false;
            // Record last seen sequence for reconnect catch-up
            try {
                if (room.game) {
                    if (!room._lastSeqByName) room._lastSeqByName = new Map();
                    room._lastSeqByName.set(name, room.game.moveSeq || 0);
                }
            } catch { /* ignore */ }
            if (!room._disconnectTimers) room._disconnectTimers = new Map();
            // Clear any existing timer for this name
            if (room._disconnectTimers.has(name)) {
                try { clearTimeout(room._disconnectTimers.get(name)); } catch { /* ignore */ }
            }
            const timer = setTimeout(() => {
                const rr = rooms[roomName];
                if (!rr) return;
                const idx = rr.participants.findIndex(pp => pp.name === name && !pp.connected);
                if (idx >= 0) {
                    rr.participants.splice(idx, 1);
                    if (rr.participants.length === 0) {
                        const oldKey = rr.roomKey;
                        delete rooms[roomName];
                        if (oldKey) roomKeys.delete(oldKey);
                    } else {
                        rr.participants.forEach(p => {
                            if (p.ws.readyState === 1) {
                                sendPayload(p.ws, { type: 'roomupdate', room: roomName, players: rr.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) });
                            }
                        });
                    }
                    broadcastRoomList();
                }
                if (rr && rr._disconnectTimers) rr._disconnectTimers.delete(name);
            }, GRACE_MS);
            room._disconnectTimers.set(name, timer);
        }
        connectionMeta.delete(ws);
        // Notify connected clients about updated roster immediately
        if (rooms[roomName]) {
            rooms[roomName].participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    sendPayload(p.ws, { type: 'roomupdate', room: roomName, players: rooms[roomName].participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) });
                }
            });
        }
        broadcastRoomList();
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
 * Broadcasts the room list to all clients, with optional per-client enrichment.
 * @param {Map<WebSocket,object>} [perClientExtras] - Map of ws -> extra fields to merge into their room entry
 */
function broadcastRoomList(perClientExtras) {
    const baseRooms = getRoomList();
    wss.clients.forEach(client => {
        if (client.readyState !== 1) return;
        let rooms = baseRooms;
        // Check if this client is in any room via connectionMeta
        const meta = connectionMeta.get(client);
        if (meta && meta.roomName && baseRooms[meta.roomName]) {
            // Clone rooms and enrich with client's player info
            rooms = { ...baseRooms };
            rooms[meta.roomName] = { ...baseRooms[meta.roomName], player: meta.name };
        }
        // If this client has extra info (e.g. host/join confirmation), merge it into their room entry
        if (perClientExtras && perClientExtras.has(client)) {
            const extras = perClientExtras.get(client);
            if (extras && extras.room && baseRooms[extras.room]) {
                if (rooms === baseRooms) rooms = { ...baseRooms };
                rooms[extras.room] = { ...rooms[extras.room], ...extras };
            }
        }
        const list = JSON.stringify({ type: 'roomlist', rooms });
        try { client.send(list); } catch (err) { console.error('[Server] Failed to broadcast roomlist to client', err); }
    });
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
    return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}
