import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';

interface Room {
  id: string;
  controllerId: string;
  controllerName: string;
  offer: any;
  answer?: any;
  controllerCandidates: any[];
  monitorCandidates: any[];
  status: 'waiting' | 'connected' | 'disconnected';
  lastHeartbeat: number;
  lastFrame?: string;
  updatedAt: number;
}

const rooms = new Map<string, Room>();
const sseClients = new Map<string, express.Response[]>();

// Cleanup stale rooms (older than 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.updatedAt > 30 * 60 * 1000) {
      rooms.delete(id);
      sseClients.delete(id);
    }
  }
}, 60000);

function broadcastToRoom(roomId: string, eventType: string, data: any) {
  const clients = sseClients.get(roomId) || [];
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // ignore
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', activeRooms: rooms.size });
  });

  // Create Room (Controller Mode)
  app.post('/api/rooms/create', (req, res) => {
    const { id, controllerId, controllerName, offer, frame } = req.body;
    if (!id || !offer) {
      return res.status(400).json({ error: 'Missing room id or offer' });
    }

    const newRoom: Room = {
      id,
      controllerId: controllerId || 'anonymous',
      controllerName: controllerName || 'Controller Device',
      offer,
      controllerCandidates: [],
      monitorCandidates: [],
      status: 'waiting',
      lastHeartbeat: Date.now(),
      lastFrame: frame || undefined,
      updatedAt: Date.now(),
    };

    rooms.set(id, newRoom);
    res.json({ success: true, room: newRoom });
  });

  // Get Room Data
  app.get('/api/rooms/:id', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found. Please verify the 6-digit code.' });
    }
    res.json(room);
  });

  // Submit WebRTC Answer (Monitor Mode)
  app.post('/api/rooms/:id/answer', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const { answer, monitorId, monitorName } = req.body;
    room.answer = answer;
    room.status = 'connected';
    room.updatedAt = Date.now();

    broadcastToRoom(room.id, 'answer', { answer, monitorId, monitorName });
    res.json({ success: true });
  });

  // Submit ICE candidate (Controller or Monitor)
  app.post('/api/rooms/:id/candidate', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const { role, candidate } = req.body;
    if (!candidate) {
      return res.status(400).json({ error: 'Missing candidate' });
    }

    if (role === 'controller') {
      room.controllerCandidates.push(candidate);
      broadcastToRoom(room.id, 'controllerCandidate', candidate);
    } else {
      room.monitorCandidates.push(candidate);
      broadcastToRoom(room.id, 'monitorCandidate', candidate);
    }
    room.updatedAt = Date.now();
    res.json({ success: true });
  });

  // Frame relay sync
  app.post('/api/rooms/:id/frame', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const { frame } = req.body;
    room.lastFrame = frame;
    room.updatedAt = Date.now();
    broadcastToRoom(room.id, 'frame', { frame });
    res.json({ success: true });
  });

  // Close / Disconnect Room
  app.post('/api/rooms/:id/close', (req, res) => {
    const room = rooms.get(req.params.id);
    if (room) {
      room.status = 'disconnected';
      room.updatedAt = Date.now();
      broadcastToRoom(room.id, 'disconnected', {});
      rooms.delete(req.params.id);
      sseClients.delete(req.params.id);
    }
    res.json({ success: true });
  });

  // Server-Sent Events (SSE) stream for instant real-time room signaling
  app.get('/api/rooms/:id/stream', (req, res) => {
    const roomId = req.params.id;
    const room = rooms.get(roomId);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    if (!sseClients.has(roomId)) {
      sseClients.set(roomId, []);
    }
    sseClients.get(roomId)!.push(res);

    // Send initial room snapshot
    if (room) {
      res.write(`event: init\ndata: ${JSON.stringify(room)}\n\n`);
    }

    req.on('close', () => {
      const clients = sseClients.get(roomId) || [];
      const idx = clients.indexOf(res);
      if (idx !== -1) {
        clients.splice(idx, 1);
      }
    });
  });

  // Vite middleware in development vs static files in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
