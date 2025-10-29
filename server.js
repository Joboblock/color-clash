import { WebSocketServer } from 'ws';
const PORT = 3000;

const wss = new WebSocketServer({ port: PORT });

// Room management: { roomName: { host: ws, guest: ws|null } }
const rooms = {};

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
      rooms[msg.name] = { host: ws, guest: null };
      ws.send(JSON.stringify({ type: 'hosted', room: msg.name }));
      broadcastRoomList();
    } else if (msg.type === 'join' && msg.name) {
      const room = rooms[msg.name];
      if (!room) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room not found' }));
        return;
      }
      if (room.guest) {
        ws.send(JSON.stringify({ type: 'error', error: 'Room already has a guest' }));
        return;
      }
      room.guest = ws;
      ws.send(JSON.stringify({ type: 'joined', room: msg.name }));
      room.host.send(JSON.stringify({ type: 'connected', guest: true }));
      room.guest.send(JSON.stringify({ type: 'connected', host: true }));
      broadcastRoomList();
    } else if (msg.type === 'list') {
      ws.send(JSON.stringify({ type: 'roomlist', rooms: getRoomList() }));
    }
  });

  ws.send(JSON.stringify({ type: 'info', message: 'Connected to server!' }));
});

function getRoomList() {
  // Only show rooms that are not full
  const result = {};
  Object.keys(rooms).forEach(name => {
    if (!rooms[name].guest) result[name] = rooms[name];
  });
  return result;
}

function broadcastRoomList() {
  const list = JSON.stringify({ type: 'roomlist', rooms: getRoomList() });
  wss.clients.forEach(client => {
    if (client.readyState === 1) client.send(list);
  });
}

console.log(`WebSocket server running on ws://localhost:${PORT}`);
