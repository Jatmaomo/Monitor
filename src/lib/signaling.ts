// Client-side Signaling Client connected to backend WebSocket and REST Express API
import { rtcConfiguration } from './webrtc';

export interface RoomSignalData {
  id: string;
  controllerId?: string;
  controllerName?: string;
  cameraName?: string;
  offer?: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  controllerCandidates?: RTCIceCandidateInit[];
  monitorCandidates?: RTCIceCandidateInit[];
  status: 'waiting' | 'connected' | 'disconnected';
  lastFrame?: string;
  updatedAt?: number;
}

export interface SignalingCallbacks {
  onInit?: (data: RoomSignalData) => void;
  onOffer?: (data: { offer: RTCSessionDescriptionInit }) => void;
  onAnswer?: (data: { answer: RTCSessionDescriptionInit; monitorId?: string; monitorName?: string }) => void;
  onControllerCandidate?: (candidate: RTCIceCandidateInit) => void;
  onMonitorCandidate?: (candidate: RTCIceCandidateInit) => void;
  onFrame?: (data: { frame: string; cameraName?: string }) => void;
  onControl?: (data: { command: string; value?: any }) => void;
  onMonitorJoined?: (data: { monitorId?: string }) => void;
  onDisconnected?: () => void;
}

export class SignalingClient {
  private ws: WebSocket | null = null;
  private eventSource: EventSource | null = null;
  private currentRoomCode: string | null = null;
  private currentRole: 'controller' | 'monitor' = 'monitor';
  private callbacks: SignalingCallbacks = {};
  private reconnectTimer: any = null;
  private isExplicitlyClosed = false;

  private getWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  connectWs(
    roomCode: string,
    role: 'controller' | 'monitor',
    callbacks: SignalingCallbacks,
    meta?: any
  ) {
    this.close();
    this.isExplicitlyClosed = false;
    this.currentRoomCode = roomCode;
    this.currentRole = role;
    this.callbacks = callbacks;

    try {
      const wsUrl = this.getWsUrl();
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.currentRoomCode) {
          ws.send(
            JSON.stringify({
              type: 'join',
              roomId: this.currentRoomCode,
              role: this.currentRole,
              meta,
            })
          );
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const type = data.type;

          if (type === 'init' && data.room) {
            this.callbacks.onInit?.(data.room);
          } else if (type === 'offer' && data.offer) {
            this.callbacks.onOffer?.({ offer: data.offer });
          } else if (type === 'answer' && data.answer) {
            this.callbacks.onAnswer?.({ answer: data.answer, monitorId: data.monitorId });
          } else if (type === 'controllerCandidate' && data.candidate) {
            this.callbacks.onControllerCandidate?.(data.candidate);
          } else if (type === 'monitorCandidate' && data.candidate) {
            this.callbacks.onMonitorCandidate?.(data.candidate);
          } else if (type === 'frame' && data.frame) {
            this.callbacks.onFrame?.({ frame: data.frame, cameraName: data.cameraName });
          } else if (type === 'control') {
            this.callbacks.onControl?.({ command: data.command, value: data.value });
          } else if (type === 'monitorJoined') {
            this.callbacks.onMonitorJoined?.({ monitorId: data.monitorId });
          } else if (type === 'disconnected') {
            this.callbacks.onDisconnected?.();
          }
        } catch (err) {
          console.warn('WS message error:', err);
        }
      };

      ws.onerror = (err) => {
        console.warn('WS connection note:', err);
      };

      ws.onclose = () => {
        if (!this.isExplicitlyClosed && this.currentRoomCode) {
          // Reconnect automatically if connection dropped
          this.reconnectTimer = setTimeout(() => {
            if (!this.isExplicitlyClosed && this.currentRoomCode) {
              this.connectWs(this.currentRoomCode, this.currentRole, this.callbacks, meta);
            }
          }, 2000);
        }
      };
    } catch (err) {
      console.warn('Failed to establish WebSocket:', err);
      // Fallback to SSE
      this.subscribeToRoom(roomCode, callbacks);
    }
  }

  sendWsFrame(roomCode: string, frame: string, cameraName?: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'frame',
            roomId: roomCode,
            frame,
            cameraName,
          })
        );
        return true;
      } catch {
        return false;
      }
    }
    // Fallback to HTTP POST
    this.sendFrame(roomCode, frame);
    return false;
  }

  sendWsOffer(roomCode: string, offer: RTCSessionDescriptionInit): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'offer',
            roomId: roomCode,
            offer,
          })
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  sendWsAnswer(roomCode: string, answer: RTCSessionDescriptionInit, monitorId?: string): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'answer',
            roomId: roomCode,
            answer,
            monitorId,
          })
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  sendWsCandidate(roomCode: string, role: 'controller' | 'monitor', candidate: RTCIceCandidateInit): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'candidate',
            roomId: roomCode,
            role,
            candidate,
          })
        );
        return true;
      } catch {
        return false;
      }
    }
    this.sendCandidate(roomCode, role, candidate);
    return false;
  }

  sendControlCommand(roomCode: string, command: string, value?: any): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(
          JSON.stringify({
            type: 'control',
            roomId: roomCode,
            command,
            value,
          })
        );
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  // REST API Endpoints (Rock-solid Fallback & Initial State)
  async createRoom(
    roomCode: string,
    controllerId: string,
    controllerName: string,
    offer?: RTCSessionDescriptionInit,
    frame?: string | null,
    cameraName?: string
  ): Promise<boolean> {
    try {
      const response = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: roomCode,
          controllerId,
          controllerName,
          offer: offer || { type: 'offer', sdp: '' },
          frame,
          cameraName,
        }),
      });
      return response.ok;
    } catch (err) {
      console.warn('Signaling createRoom error:', err);
      return false;
    }
  }

  async getRoom(roomCode: string): Promise<RoomSignalData | null> {
    try {
      const response = await fetch(`/api/rooms/${roomCode}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (err) {
      console.warn('Signaling getRoom error:', err);
      return null;
    }
  }

  async getLatestFrame(roomCode: string): Promise<{ frame: string | null; cameraName?: string } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`/api/rooms/${roomCode}/frame`, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) return null;
      return await response.json();
    } catch {
      return null;
    }
  }

  async sendAnswer(
    roomCode: string,
    answer: RTCSessionDescriptionInit,
    monitorId: string,
    monitorName: string
  ): Promise<boolean> {
    this.sendWsAnswer(roomCode, answer, monitorId);
    try {
      const response = await fetch(`/api/rooms/${roomCode}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          answer,
          monitorId,
          monitorName,
        }),
      });
      return response.ok;
    } catch (err) {
      console.warn('Signaling sendAnswer error:', err);
      return false;
    }
  }

  async sendCandidate(
    roomCode: string,
    role: 'controller' | 'monitor',
    candidate: RTCIceCandidateInit
  ): Promise<boolean> {
    try {
      const response = await fetch(`/api/rooms/${roomCode}/candidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, candidate }),
      });
      return response.ok;
    } catch (err) {
      console.warn('Signaling sendCandidate error:', err);
      return false;
    }
  }

  async sendFrame(roomCode: string, frame: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const response = await fetch(`/api/rooms/${roomCode}/frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async closeRoom(roomCode: string): Promise<void> {
    try {
      await fetch(`/api/rooms/${roomCode}/close`, { method: 'POST' });
    } catch {
      // ignore
    }
    this.close();
  }

  subscribeToRoom(roomCode: string, callbacks: SignalingCallbacks) {
    this.closeStream();

    try {
      const es = new EventSource(`/api/rooms/${roomCode}/stream`);
      this.eventSource = es;

      es.addEventListener('init', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onInit?.(data);
        } catch (err) {
          console.warn('Error parsing init event:', err);
        }
      });

      es.addEventListener('answer', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onAnswer?.(data);
        } catch (err) {
          console.warn('Error parsing answer event:', err);
        }
      });

      es.addEventListener('controllerCandidate', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onControllerCandidate?.(data);
        } catch (err) {
          console.warn('Error parsing controller candidate event:', err);
        }
      });

      es.addEventListener('monitorCandidate', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onMonitorCandidate?.(data);
        } catch (err) {
          console.warn('Error parsing monitor candidate event:', err);
        }
      });

      es.addEventListener('frame', (e) => {
        try {
          const data = JSON.parse(e.data);
          callbacks.onFrame?.(data);
        } catch (err) {
          console.warn('Error parsing frame event:', err);
        }
      });

      es.addEventListener('disconnected', () => {
        callbacks.onDisconnected?.();
      });

      es.onerror = (err) => {
        console.warn('SSE connection note:', err);
      };
    } catch (err) {
      console.warn('Could not establish EventSource stream:', err);
    }
  }

  closeStream() {
    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch {
        // ignore
      }
      this.eventSource = null;
    }
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.closeStream();
  }
}

export const signaling = new SignalingClient();

