import express from 'express';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

interface User {
  id: string;
  fullName: string;
  email: string;
  passwordHash?: string;
  createdAt: number;
}

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
  cameraName?: string;
  updatedAt: number;
}

const users = new Map<string, User>();
const rooms = new Map<string, Room>();
const sseClients = new Map<string, express.Response[]>();

// Hash password helper
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password + '_jat_maomo_salt').digest('hex');
}

// Cleanup stale rooms (older than 60 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.updatedAt > 60 * 60 * 1000) {
      rooms.delete(id);
      sseClients.delete(id);
    }
  }
}, 60000);

function broadcastToRoom(roomId: string, eventType: string, data: any) {
  const clients = sseClients.get(roomId) || [];
  const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  for (let i = clients.length - 1; i >= 0; i--) {
    const res = clients[i];
    try {
      res.write(payload);
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }
    } catch {
      clients.splice(i, 1);
    }
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));

  // API Health check
  app.get('/api/health', (req, res) => {
    res.json({
      status: 'ok',
      usersCount: users.size,
      activeRooms: rooms.size,
      serverTime: Date.now(),
    });
  });

  // ===================== AUTHENTICATION ENDPOINTS =====================

  // Sign Up
  app.post('/api/auth/signup', (req, res) => {
    const { fullName, email, password } = req.body;
    if (!fullName || !email || !password) {
      return res.status(400).json({ error: 'Please provide full name, email, and password.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    if (users.has(cleanEmail)) {
      return res.status(400).json({ error: 'An account with this email already exists. Please log in.' });
    }

    const newUser: User = {
      id: 'usr_' + Math.random().toString(36).substring(2, 11),
      fullName: String(fullName).trim(),
      email: cleanEmail,
      passwordHash: hashPassword(String(password)),
      createdAt: Date.now(),
    };

    users.set(cleanEmail, newUser);

    res.json({
      success: true,
      user: {
        uid: newUser.id,
        fullName: newUser.fullName,
        email: newUser.email,
        createdAt: newUser.createdAt,
      },
    });
  });

  // Log In
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Please enter both email and password.' });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const existingUser = users.get(cleanEmail);

    if (!existingUser) {
      // Create user on-the-fly if not found to provide a friction-free experience
      const newUser: User = {
        id: 'usr_' + Math.random().toString(36).substring(2, 11),
        fullName: cleanEmail.split('@')[0] || 'User',
        email: cleanEmail,
        passwordHash: hashPassword(String(password)),
        createdAt: Date.now(),
      };
      users.set(cleanEmail, newUser);
      return res.json({
        success: true,
        user: {
          uid: newUser.id,
          fullName: newUser.fullName,
          email: newUser.email,
          createdAt: newUser.createdAt,
        },
      });
    }

    if (existingUser.passwordHash && existingUser.passwordHash !== hashPassword(String(password))) {
      return res.status(401).json({ error: 'Incorrect password. Please verify and try again.' });
    }

    res.json({
      success: true,
      user: {
        uid: existingUser.id,
        fullName: existingUser.fullName,
        email: existingUser.email,
        createdAt: existingUser.createdAt,
      },
    });
  });

  // Quick Start / Guest Login
  app.post('/api/auth/guest', (req, res) => {
    const { name } = req.body;
    const guestId = 'guest_' + Math.random().toString(36).substring(2, 10);
    const guestUser: User = {
      id: guestId,
      fullName: name?.trim() || 'Home User',
      email: `${guestId}@jatmaomo.local`,
      createdAt: Date.now(),
    };
    users.set(guestUser.email, guestUser);

    res.json({
      success: true,
      user: {
        uid: guestUser.id,
        fullName: guestUser.fullName,
        email: guestUser.email,
        createdAt: guestUser.createdAt,
      },
    });
  });

  // ===================== ROOM & LIVE STREAMING ENDPOINTS =====================

  // Create Room (Controller Mode)
  app.post('/api/rooms/create', (req, res) => {
    const { id, controllerId, controllerName, offer, frame, cameraName } = req.body;
    if (!id || !offer) {
      return res.status(400).json({ error: 'Missing room id or offer' });
    }

    const newRoom: Room = {
      id,
      controllerId: controllerId || 'anonymous',
      controllerName: controllerName || 'Controller Phone',
      cameraName: cameraName || 'CAM-01 [MAIN ENTRANCE]',
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

  // Fast frame poll endpoint (fallback for SSE)
  app.get('/api/rooms/:id/frame', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    res.json({
      frame: room.lastFrame || null,
      updatedAt: room.updatedAt,
      status: room.status,
      cameraName: room.cameraName,
    });
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

  // High-performance Frame Relay Sync
  app.post('/api/rooms/:id/frame', (req, res) => {
    const room = rooms.get(req.params.id);
    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }
    const { frame } = req.body;
    if (frame) {
      room.lastFrame = frame;
      room.updatedAt = Date.now();
      broadcastToRoom(room.id, 'frame', { frame });
    }
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

  // Server-Sent Events (SSE) stream for instant real-time room signaling & frames
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

    // Keepalive ping every 15s to prevent timeouts
    const pingInterval = setInterval(() => {
      try {
        res.write(':keepalive\n\n');
      } catch {
        clearInterval(pingInterval);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(pingInterval);
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
