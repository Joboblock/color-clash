// Player name length limit (base, not including suffix)
const PLAYER_NAME_LENGTH = 12;
import { WebSocketServer } from 'ws';
const PORT = 3000;

const wss = new WebSocketServer({ port: PORT });

// Room management structure:
// rooms = {
//   [roomName]: {
//     maxPlayers: number,
//     participants: Array<{ ws: WebSocket, name: string, isHost: boolean }>,
//     game?: {
//       started: boolean,
//       players: string[], // fixed order of names at start
//       turnIndex: number   // whose turn it is (index in players)
//     }
//   }
// }
const rooms = {};
// Keep server-authoritative list of available player colors (must match client order)
const playerColors = ['green', 'red', 'blue', 'yellow', 'magenta', 'cyan', 'orange', 'purple'];
// Track which room a connection belongs to and the player's name (per tab)
const connectionMeta = new Map(); // ws -> { roomName: string, name: string }

wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
            return;
        }

        if (msg.type === 'host' && msg.roomName) {
            // If this connection is already in a room, remove it from that room first
            const metaExisting = connectionMeta.get(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.ws !== ws);
                if (prevRoom.participants.length === 0) {
                    delete rooms[metaExisting.roomName];
                } else {
                    // notify previous room
                    prevRoom.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            try {
                                p.ws.send(JSON.stringify({ type: 'roomupdate', room: metaExisting.roomName, players: prevRoom.participants.map(pp => ({ name: pp.name })) }));
                            } catch {
                                // ignore
                            }
                        }
                    });
                }
                connectionMeta.delete(ws);
            }
            if (rooms[msg.roomName]) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room already exists' }));
                return;
            }
            // Default to 2 unless provided by host (optional)
            const provided = Number.isFinite(msg.maxPlayers) ? Math.floor(Number(msg.maxPlayers)) : 2;
            const clamped = clampPlayers(provided);
            // Use debugName if present, otherwise default to 'Player'. Enforce 12-char base; reserve 13th for numeric suffix.
            const baseRaw = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
            const playerName = pickUniqueName(null, baseRaw);
            rooms[msg.roomName] = {
                maxPlayers: clamped,
                participants: [{ ws, name: playerName, isHost: true }]
            };
            connectionMeta.set(ws, { roomName: msg.roomName, name: playerName });
            ws.send(JSON.stringify({ type: 'hosted', room: msg.roomName, maxPlayers: clamped, player: playerName }));
            broadcastRoomList();
        } else if (msg.type === 'join' && msg.roomName) {
            const room = rooms[msg.roomName];
            if (!room) {
                ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
                return;
            }
            // If this connection is already in a room, remove it from that room first
            const metaExisting = connectionMeta.get(ws);
            if (metaExisting && metaExisting.roomName && rooms[metaExisting.roomName]) {
                const prevRoom = rooms[metaExisting.roomName];
                prevRoom.participants = prevRoom.participants.filter(p => p.ws !== ws);
                if (prevRoom.participants.length === 0) {
                    delete rooms[metaExisting.roomName];
                } else {
                    // notify previous room
                    prevRoom.participants.forEach(p => {
                        if (p.ws.readyState === 1) {
                            try {
                                p.ws.send(JSON.stringify({ type: 'roomupdate', room: metaExisting.roomName, players: prevRoom.participants.map(pp => ({ name: pp.name })) }));
                            } catch {
                                // ignore
                            }
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
            room.participants.push({ ws, name: playerName, isHost: false });
            connectionMeta.set(ws, { roomName: msg.roomName, name: playerName });

            ws.send(JSON.stringify({ type: 'joined', room: msg.roomName, maxPlayers: room.maxPlayers, players: room.participants.map(p => ({ name: p.name })) }));
            // Notify existing participants about the new joiner (optional)
            room.participants.forEach(p => {
                if (p.ws !== ws && p.ws.readyState === 1) {
                    try {
                        p.ws.send(JSON.stringify({ type: 'roomupdate', room: msg.roomName, players: room.participants.map(pp => ({ name: pp.name })) }));
                    } catch {
                        // ignore send errors on best-effort notifications
                    }
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
                const gridSize = Math.max(3, playerCount + 3);
                // Initialize per-room game state for turn enforcement and color validation
                r.game = {
                    started: true,
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned.slice()
                };
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
                try { ws.send(JSON.stringify({ type: 'error', error: 'Game not started' })); } catch (e) { /* ignore */ void e; }
                return;
            }

            const r = Number(msg.row);
            const c = Number(msg.col);
            const players = Array.isArray(room.game.players) ? room.game.players : [];
            const currentTurn = Number.isInteger(room.game.turnIndex) ? room.game.turnIndex : 0;
            const senderName = meta.name;
            const fromIndex = players.indexOf(senderName);

            if (!Number.isInteger(r) || !Number.isInteger(c)) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Invalid move coordinates' })); } catch (e) { /* ignore */ void e; }
                return;
            }
            if (fromIndex < 0) {
                try { ws.send(JSON.stringify({ type: 'error', error: 'Unknown player' })); } catch (e) { /* ignore */ void e; }
                return;
            }
            if (fromIndex !== currentTurn) {
                const expectedPlayer = players[currentTurn];
                console.debug(`[Turn] Rejected move from ${senderName} (idx ${fromIndex}) - expected ${expectedPlayer} (idx ${currentTurn})`);
                try { ws.send(JSON.stringify({ type: 'error', error: 'Not your turn', expectedIndex: currentTurn, expectedPlayer })); } catch (e) { /* ignore */ void e; }
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

            console.debug(`[Turn] Accepted move from ${senderName} (idx ${fromIndex}) -> (${r},${c}). Next: ${players[nextIndex]} (idx ${nextIndex})`);
            room.participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    try { p.ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
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
                const gridSize = Math.max(3, players.length + 3);
                room.game = {
                    started: true,
                    players: players.slice(),
                    turnIndex: 0,
                    colors: assigned.slice()
                };
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
                delete rooms[roomName];
            } else {
                room.participants.forEach(p => {
                    if (p.ws.readyState === 1) {
                        try {
                            p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: room.participants.map(pp => ({ name: pp.name })) }));
                        } catch {
                            // ignore
                        }
                    }
                });
            }
            broadcastRoomList();
        }
    });

    ws.send(JSON.stringify({ type: 'info', message: 'Connected to server!' }));

    ws.on('close', () => {
        const meta = connectionMeta.get(ws);
        if (!meta) return;
        const { roomName } = meta;
        const room = rooms[roomName];
        if (!room) return;
        room.participants = room.participants.filter(p => p.ws !== ws);
        connectionMeta.delete(ws);
        if (room.participants.length === 0) {
            delete rooms[roomName];
        } else {
            // Broadcast room participant update
            room.participants.forEach(p => {
                if (p.ws.readyState === 1) {
                    try {
                        p.ws.send(JSON.stringify({ type: 'roomupdate', room: roomName, players: room.participants.map(pp => ({ name: pp.name })) }));
                    } catch {
                        // ignore send errors on best-effort notifications
                    }
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
function pickUniqueName(room, raw) {
    const base = sanitizeBaseName(raw);
    const taken = room && Array.isArray(room.participants)
        ? room.participants.map(p => p.name)
        : [];
    if (!taken.includes(base)) return base;
    for (let i = 2; i <= 9; i++) {
        const candidate = base.slice(0, PLAYER_NAME_LENGTH) + String(i);
        if (!taken.includes(candidate)) return candidate;
    }
    // Fallback (should not happen with max 8 players): keep base
    return base;
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

console.log(`WebSocket server running on ws://localhost:${PORT}`);
