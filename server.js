import { WebSocketServer } from 'ws';
const PORT = 3000;

const wss = new WebSocketServer({ port: PORT });

// Room management structure:
// rooms = {
//   [roomName]: {
//     maxPlayers: number,
//     participants: Array<{ ws: WebSocket, name: string, isHost: boolean }>
//   }
// }
const rooms = {};
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
      // Use debugName if present, otherwise default to 'Player'
      const playerName = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
      rooms[msg.roomName] = {
        maxPlayers: clamped,
        participants: [ { ws, name: playerName, isHost: true } ]
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
  // Use debugName if present, otherwise default to 'Player'
  const playerName = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : 'Player';
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
      const players = room.participants.map(p => p.name);
      const gridSize = Math.max(3, playerCount + 3);
      // Broadcast start to all participants
      room.participants.forEach(p => {
        if (p.ws.readyState === 1) {
          try {
            p.ws.send(JSON.stringify({ type: 'started', room: meta.roomName, players, gridSize }));
          } catch {
            // ignore
          }
        }
      });
    } else if (msg.type === 'move') {
      const meta = connectionMeta.get(ws);
      if (!meta || !meta.roomName) return;
      const room = rooms[meta.roomName];
      if (!room) return;
      // Re-broadcast move to all participants (including sender) for consistency
      const payload = {
        type: 'move',
        room: meta.roomName,
        row: Number(msg.row),
        col: Number(msg.col),
        fromIndex: Number(msg.fromIndex),
        nextIndex: Number(msg.nextIndex),
        color: typeof msg.color === 'string' ? msg.color : undefined,
      };
      room.participants.forEach(p => {
        if (p.ws.readyState === 1) {
          try { p.ws.send(JSON.stringify(payload)); } catch { /* ignore */ }
        }
      });
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

function broadcastRoomList() {
  const list = JSON.stringify({ type: 'roomlist', rooms: getRoomList() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(list);
  });
}

console.log(`WebSocket server running on ws://localhost:${PORT}`);
