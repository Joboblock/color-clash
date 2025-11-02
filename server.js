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

    if (msg.type === 'host' && msg.name) {
      if (rooms[msg.name]) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room already exists' }));
        return;
      }
      // Default to 2 unless provided by host (optional)
      const provided = Number.isFinite(msg.players) ? Math.floor(Number(msg.players)) : 2;
      const clamped = clampPlayers(provided);
      // For debug: use debugName if present, otherwise fallback
      const playerName = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : (typeof msg.player === 'string' && msg.player ? String(msg.player) : 'Player');
      rooms[msg.name] = {
        maxPlayers: clamped,
        participants: [ { ws, name: playerName, isHost: true } ]
      };
      connectionMeta.set(ws, { roomName: msg.name, name: playerName });
      ws.send(JSON.stringify({ type: 'hosted', room: msg.name, maxPlayers: clamped, player: playerName }));
      broadcastRoomList();
    } else if (msg.type === 'join' && msg.name) {
      const room = rooms[msg.name];
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
  // For debug: use debugName if present, otherwise fallback
  const playerName = typeof msg.debugName === 'string' && msg.debugName ? String(msg.debugName) : (typeof msg.player === 'string' && msg.player ? String(msg.player) : 'Player');
  room.participants.push({ ws, name: playerName, isHost: false });
  connectionMeta.set(ws, { roomName: msg.name, name: playerName });

      ws.send(JSON.stringify({ type: 'joined', room: msg.name, maxPlayers: room.maxPlayers, players: room.participants.map(p => ({ name: p.name })) }));
      // Notify existing participants about the new joiner (optional)
      room.participants.forEach(p => {
        if (p.ws !== ws && p.ws.readyState === 1) {
          try {
            p.ws.send(JSON.stringify({ type: 'roomupdate', room: msg.name, players: room.participants.map(pp => ({ name: pp.name })) }));
          } catch {
            // ignore send errors on best-effort notifications
          }
        }
      });
      broadcastRoomList();
    } else if (msg.type === 'list') {
      ws.send(JSON.stringify({ type: 'roomlist', rooms: getRoomList() }));
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
