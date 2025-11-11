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
    } catch {
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
    console.log(`HTTP server listening on http://0.0.0.0:${PORT}`);
    console.log(`WebSocket endpoint available at ws://<host>:${PORT}/ws`);
});

// Room management structure:
// rooms = {
//   [roomName]: {
//     maxPlayers: number,
//     participants: Array<{ ws: WebSocket, name: string, isHost: boolean, connected: boolean }>,
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
const connectionMeta = new Map(); // ws -> { roomName: string, name: string }
// Allow brief disconnects to reattach by name before freeing the seat
const GRACE_MS = 300000; // 5 min grace window

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            try { ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' })); } catch { /* ignore */ }
            return;
        }

        if (msg.type === 'host') {
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
                    // notify previous room
                    prevRoom.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            try {
                                p.ws.send(JSON.stringify({ type: 'roomupdate', room: metaExisting.roomName, players: prevRoom.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) }));
                            } catch { /* ignore */ }
                        }
                    });
                }
                connectionMeta.delete(ws);
            }
            // Compute a unique room name using the same pattern as player names
            const roomBaseRaw = (typeof msg.roomName === 'string' && msg.roomName)
                ? String(msg.roomName)
                : 'Player';
            const uniqueRoomName = pickUniqueRoomName(roomBaseRaw);
            if (!uniqueRoomName) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Room name already taken (all variants 2–9 used). Please choose a different name.' })); } catch { /* ignore */ }
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
            rooms[uniqueRoomName] = {
                maxPlayers: clamped,
                participants: [{ ws, name: playerName, isHost: true, connected: true }],
                _disconnectTimers: new Map(),
                desiredGridSize: requestedGrid, // null means use dynamic playerCount+3
                roomKey
            };
            roomKeys.set(roomKey, uniqueRoomName);
            connectionMeta.set(ws, { roomName: uniqueRoomName, name: playerName });
            // Compute a planned grid size for the lobby background for the host as well.
            // Use host's desiredGridSize if provided; otherwise default to (playerTarget + 3)
            // while respecting the per-player minimum schedule and the max cap of 16.
            {
                function recommendedGridSize(p) {
                    if (p <= 2) return 3;
                    if (p <= 4) return 4; // 3-4 players
                    if (p === 5) return 5;
                    return 6; // 6-8 players
                }
                const scheduleMin = recommendedGridSize(clamped);
                const playerTarget = clamped; // room will enforce full before start
                const defaultGrid = Math.max(scheduleMin, Math.min(16, Math.max(3, playerTarget + 3)));
                const plannedGridSize = requestedGrid !== null
                    ? Math.max(scheduleMin, Math.min(16, Math.max(3, requestedGrid)))
                    : defaultGrid;
                ws.send(JSON.stringify({ type: 'hosted', room: uniqueRoomName, roomKey, maxPlayers: clamped, player: playerName, gridSize: plannedGridSize }));
            }
            broadcastRoomList();
        } else if (msg.type === 'join' && msg.roomName) {
            const room = rooms[msg.roomName];
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            if (room.game && room.game.started) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room already started' }));
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
                    // notify previous room
                    prevRoom.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            try {
                                p.ws.send(JSON.stringify({ type: 'roomupdate', room: metaExisting.roomName, players: prevRoom.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) }));
                            } catch { /* ignore */ }
                        }
                    });
                }
                connectionMeta.delete(ws);
            }
            const count = room.participants?.length || 0;
            if (count >= room.maxPlayers) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
                return;
            }
            // Use debugName if present, otherwise default to 'Player'. Enforce 12-char base; reserve 13th for numeric suffix and ensure uniqueness in room.
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(room, baseRaw);
            if (!playerName) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'All name variants are taken in this room. Please choose a different name.' })); } catch { /* ignore */ }
                return;
            }
            room.participants.push({ ws, name: playerName, isHost: false, connected: true });
            connectionMeta.set(ws, { roomName: msg.roomName, name: playerName });

            // Provide the client with the room's planned grid size so the background grid can match immediately on join.
            // Planned grid size is based on host's desiredGridSize (if any), but not below the schedule minimum for maxPlayers.
            function minGridSize(p) {
                if (p <= 2) return 3;
                if (p <= 4) return 4; // 3-4 players
                if (p === 5) return 5;
                return 6; // 6-8 players
            }
            const scheduleMin = minGridSize(room.maxPlayers || 2);
            const desired = Number.isFinite(room.desiredGridSize) ? Math.floor(room.desiredGridSize) : null;
            const playerTarget = Number.isFinite(room.maxPlayers) ? room.maxPlayers : (room.participants?.length || 2);
            const defaultGrid = Math.max(scheduleMin, Math.min(16, Math.max(3, playerTarget + 3)));
            const plannedGridSize = desired !== null
                ? Math.max(scheduleMin, Math.min(16, Math.max(3, desired)))
                : defaultGrid;

            ws.send(JSON.stringify({
                type: 'joined',
                room: msg.roomName,
                roomKey: room.roomKey,
                maxPlayers: room.maxPlayers,
                player: playerName,
                players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })),
                gridSize: plannedGridSize
            }));
            // Notify existing participants about the new joiner (optional)
            room.participants.forEach(p => {
                if (p.ws !== ws && p.ws.readyState === 1) {
                    try {
                        p.ws.send(JSON.stringify({ type: 'roomupdate', room: msg.roomName, players: room.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) }));
                    } catch { /* ignore */ }
                }
            });
            broadcastRoomList();
        } else if (msg.type === 'join_by_key' && typeof msg.roomKey === 'string') {
            const key = String(msg.roomKey);
            const roomName = roomKeys.get(key);
            if (!roomName) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            const room = rooms[roomName];
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            if (room.game && room.game.started) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room already started' }));
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
                    prevRoom.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: metaExisting.roomName, players: prevRoom.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
                        }
                    });
                }
                connectionMeta.delete(ws);
            }
            const count = room.participants?.length || 0;
            if (count >= room.maxPlayers) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room is full' }));
                return;
            }
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(room, baseRaw);
            if (!playerName) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'All name variants are taken in this room. Please choose a different name.' })); } catch { /* ignore */ }
                return;
            }
            room.participants.push({ ws, name: playerName, isHost: false, connected: true });
            connectionMeta.set(ws, { roomName, name: playerName });
            function minGridSize(p) {
                if (p <= 2) return 3;
                if (p <= 4) return 4; // 3-4 players
                if (p === 5) return 5;
                return 6; // 6-8 players
            }
            const scheduleMin = minGridSize(room.maxPlayers || 2);
            const desired = Number.isFinite(room.desiredGridSize) ? Math.floor(room.desiredGridSize) : null;
            const playerTarget = Number.isFinite(room.maxPlayers) ? room.maxPlayers : (room.participants?.length || 2);
            const defaultGrid = Math.max(scheduleMin, Math.min(16, Math.max(3, playerTarget + 3)));
            const plannedGridSize = desired !== null
                ? Math.max(scheduleMin, Math.min(16, Math.max(3, desired)))
                : defaultGrid;
            ws.send(JSON.stringify({ type: 'joined', room: roomName, roomKey: room.roomKey, maxPlayers: room.maxPlayers, player: playerName, players: room.participants.filter(p => p.connected).map(p => ({ name: p.name })), gridSize: plannedGridSize }));
            room.participants.forEach(p => {
                if (p.ws !== ws && p.ws.readyState === 1) {
                    try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: room.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
                }
            });
            broadcastRoomList();
        } else if (msg.type === 'reconnect' && msg.roomName && typeof msg.debugName === 'string') {
            const room = rooms[msg.roomName];
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            const name = sanitizeBaseName(msg.debugName);
            const participant = room.participants.find(p => p.name === name);
            if (!participant) {
                ws.send(JSON.stringify({ type: 'error', error: 'No disconnected session to reattach' }));
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
            connectionMeta.set(ws, { roomName: msg.roomName, name });
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
            try { ws.send(JSON.stringify(rejoinPayload)); } catch { /* ignore */ }
            // Notify others of updated connected roster
            room.participants.forEach(p => {
                if (p.ws !== ws && p.ws.readyState === 1) {
                    try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: msg.roomName, players: room.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
                }
            });
            broadcastRoomList();
        } else if (msg.type === 'list') {
            ws.send(JSON.stringify({ type: 'roomlist', rooms: getRoomList() }));
        } else if (msg.type === 'start') {
            // Only the host can start; use their current room from connectionMeta
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) {
                ws.send(JSON.stringify({ type: 'error', error: 'Not in a room' }));
                return;
            }
            const room = rooms[meta.roomName];
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            // Verify host
            const isHost = room.participants.length && room.participants[0].ws === ws;
            if (!isHost) {
                ws.send(JSON.stringify({ type: 'error', error: 'Only the host can start the game' }));
                return;
            }
            // Optionally enforce full room
            const playerCount = room.participants.length;
            const mustBeFull = true;
            if (mustBeFull && playerCount < room.maxPlayers) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room is not full yet' }));
                return;
            }
            // Initiate preferred color collection before starting
            if (room._colorCollect && room._colorCollect.inProgress) {
                // Already collecting (debounce multiple start clicks)
                return;
            }
            const players = room.participants.map(p => p.name);
            const collect = {
                inProgress: true,
                expected: playerCount,
                responses: new Map(), // name -> preferred color
                timeout: null
            };
            room._colorCollect = collect;
            // Ask every participant for their current preferred color (client color cycler)
            const requestPayload = JSON.stringify({ type: 'request_preferred_colors', room: meta.roomName, players });
            room.participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    try { p.ws.send(requestPayload); } catch { /* ignore */ }
                }
            });
            // Helper to finalize assignment (on all responses or timeout)
            const finalizeAssignment = () => {
                if (!rooms[meta.roomName]) return; // room gone
                const r = rooms[meta.roomName];
                // Idempotency: ensure we only finalize once
                if (!r._colorCollect || !r._colorCollect.inProgress) return;
                r._colorCollect.inProgress = false;
                if (r._colorCollect.timeout) {
                    clearTimeout(r._colorCollect.timeout);
                    r._colorCollect.timeout = null;
                }
                // Build preferred list in participant order (default to 'green' if missing)
                const prefs = players.map(name => {
                    const raw = r._colorCollect.responses.get(name);
                    const c = typeof raw === 'string' ? String(raw) : 'green';
                    // sanitize to known palette
                    return playerColors.includes(c) ? c : 'green';
                });
                const assigned = assignColorsDeterministic(players, prefs, playerColors);
                function recommendedGridSize(p) {
                    if (p <= 2) return 3;
                    if (p <= 4) return 4;
                    if (p === 5) return 5;
                    return 6;
                }
                // Determine grid size: if host specified, clamp it; otherwise default to (playerCount + 3)
                // while never going below the per-player schedule minimum and never above 16.
                const gridSize = Number.isFinite(r.desiredGridSize)
                    ? Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, r.desiredGridSize)))
                    : Math.max(recommendedGridSize(playerCount), Math.min(16, Math.max(3, playerCount + 3)));
                // Initialize per-room game state for turn enforcement and color validation
                r.game = {
                    started: true,
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned.slice(),
                    moveSeq: 0,
                    recentMoves: []
                };
                if (!r._lastSeqByName) r._lastSeqByName = new Map();
                // Broadcast start to all participants with authoritative colors
                const startPayload = JSON.stringify({ type: 'started', room: meta.roomName, players, gridSize, colors: assigned });
                r.participants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        try { p.ws.send(startPayload); } catch { /* ignore */ }
                    }
                });
                // Cleanup
                delete r._colorCollect;
            };
            // Timeout to avoid hanging if a client doesn't respond
            collect.timeout = setTimeout(finalizeAssignment, 2500);
            // If everyone responds earlier, we'll finalize immediately in the handler below
        } else if (msg.type === 'move') {
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room) return;

            // Enforce that a game has started and track turn order
            if (!room.game || !room.game.started) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Game not started' })); } catch { /* ignore */ }
                return;
            }

            const r = Number(msg.row);
            const c = Number(msg.col);
            const players = Array.isArray(room.game.players) ? room.game.players : [];
            const currentTurn = Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0;
            const senderName = meta.name;
            const fromIndex = players.indexOf(senderName);

            if (!Number.isInteger(r) || !Number.isInteger(c)) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Invalid move coordinates' })); } catch { /* ignore */ }
                return;
            }
            if (fromIndex < 0) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Unknown player' })); } catch { /* ignore */ }
                return;
            }
            if (fromIndex !== currentTurn) {
                const expectedPlayer = players[currentTurn];
                console.debug(`[Turn] Rejected move from ${senderName} (idx ${fromIndex}) - expected ${expectedPlayer} (idx ${currentTurn})`);
                try { ws.send(JSON.stringify({ type: 'error', error: 'Not your turn', expectedIndex: currentTurn, expectedPlayer })); } catch { /* ignore */ }
                return;
            }

            // Accept move: compute next turn and broadcast
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
            };

            // Sequence and buffer this move for catch-up on reconnect
            try {
                if (room.game) {
                    room.game.moveSeq = (room.game.moveSeq || 0) + 1;
                    const moveRecord = { seq: room.game.moveSeq, room: meta.roomName, row: r, col: c, fromIndex, nextIndex, color: assignedColor };
                    if (!Array.isArray(room.game.recentMoves)) room.game.recentMoves = [];
                    const bufferSize = Math.max(1, (Array.isArray(room.game.players) ? room.game.players.length : 2) - 1);
                    room.game.recentMoves.push(moveRecord);
                    if (room.game.recentMoves.length > bufferSize) room.game.recentMoves.shift();
                }
            } catch { /* ignore buffering errors */ }

            console.debug(`[Turn] Accepted move from ${senderName} (idx ${fromIndex}) -> (${r},${c}). Next: ${players[nextIndex]} (idx ${nextIndex})`);
            room.participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    try { p.ws.send(JSON.stringify({ ...payload, seq: room.game?.moveSeq })); } catch { /* ignore */ }
                }
            });
            room.game.turnIndex = nextIndex;
        } else if (msg.type === 'preferred_color') {
            // A client responded with their current preferred color (from cycler)
            const meta = connectionMeta.get(ws);
            if (!meta || !meta.roomName) return;
            const room = rooms[meta.roomName];
            if (!room || !room._colorCollect || !room._colorCollect.inProgress) return;
            const name = meta.name;
            const color = typeof msg.color === 'string' ? String(msg.color) : '';
            // Sanitize color to known palette, else ignore
            if (!playerColors.includes(color)) {
                // ignore invalid colors
                return;
            }
            room._colorCollect.responses.set(name, color);
            // If we have all responses, finalize immediately
            if (room._colorCollect.responses.size >= room._colorCollect.expected) {
                // finalize (simulate start branch behavior)
                if (room._colorCollect.timeout) {
                    clearTimeout(room._colorCollect.timeout);
                    room._colorCollect.timeout = null;
                }
                // Reuse the same logic as in start finalization
                const players = room.participants.map(p => p.name);
                const prefs = players.map(nm => room._colorCollect.responses.get(nm) || 'green');
                const assigned = assignColorsDeterministic(players, prefs, playerColors);
                function recommendedGridSize(p) {
                    if (p <= 2) return 3;
                    if (p <= 4) return 4;
                    if (p === 5) return 5;
                    return 6;
                }
                const gridSize = Number.isFinite(room.desiredGridSize)
                    ? Math.max(recommendedGridSize(players.length), Math.min(16, Math.max(3, room.desiredGridSize)))
                    : Math.max(recommendedGridSize(players.length), Math.min(16, Math.max(3, players.length + 3)));
                room.game = {
                    started: true,
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned.slice(),
                    moveSeq: 0,
                    recentMoves: []
                };
                if (!room._lastSeqByName) room._lastSeqByName = new Map();
                const startPayload = JSON.stringify({ type: 'started', room: meta.roomName, players, gridSize, colors: assigned });
                room.participants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        try { p.ws.send(startPayload); } catch { /* ignore */ }
                    }
                });
                delete room._colorCollect;
            }
        } else if (msg.type === 'leave') {
            const meta = connectionMeta.get(ws);
            if (!meta) {
                ws.send(JSON.stringify({ type: 'left' }));
                return;
            }
            const { roomName } = meta;
            const room = rooms[roomName];
            if (!room) {
                connectionMeta.delete(ws);
                ws.send(JSON.stringify({ type: 'left' }));
                broadcastRoomList();
                return;
            }
            room.participants = room.participants.filter(p => p.ws !== ws);
            connectionMeta.delete(ws);
            ws.send(JSON.stringify({ type: 'left', room: roomName }));
            if (room.participants.length === 0) {
                const oldKey = room.roomKey;
                delete rooms[roomName];
                if (oldKey) roomKeys.delete(oldKey);
            } else {
                room.participants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: room.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
                    }
                });
            }
            broadcastRoomList();
        }
    });

    // Greet new connections
    try { ws.send(JSON.stringify({ type: 'info', message: 'Connected to server!' })); } catch { /* ignore */ }

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
                                try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: rr.participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
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
                    try { p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: rooms[roomName].participants.filter(pp => pp.connected).map(pp => ({ name: pp.name })) })); } catch { /* ignore */ }
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

function broadcastRoomList() {
    const list = JSON.stringify({ type: 'roomlist', rooms: getRoomList() });
    wss.clients.forEach(client => {
        if (client.readyState === 1) client.send(list);
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

console.log(`WebSocket server running on ws://localhost:${PORT}`);
