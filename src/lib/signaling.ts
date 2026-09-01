// Client-side Signaling Client connected to backend Express API
import { rtcConfiguration } from './webrtc';

export interface RoomSignalData {
  id: string;
  controllerId: string;
  controllerName: string;
  offer: RTCSessionDescriptionInit;
  answer?: RTCSessionDescriptionInit;
  controllerCandidates?: RTCIceCandidateInit[];
  monitorCandidates?: RTCIceCandidateInit[];
  status: 'waiting' | 'connected' | 'disconnected';
  lastFrame?: string;
  updatedAt: number;
}

export class SignalingClient {
  private eventSource: EventSource | null = null;

  async createRoom(
    roomCode: string,
    controllerId: string,
    controllerName: string,
    offer: RTCSessionDescriptionInit,
    frame?: string | null
  ): Promise<boolean> {
    try {
      const response = await fetch('/api/rooms/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: roomCode,
          controllerId,
          controllerName,
          offer,
          frame,
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

  async sendAnswer(
    roomCode: string,
    answer: RTCSessionDescriptionInit,
    monitorId: string,
    monitorName: string
  ): Promise<boolean> {
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
      const response = await fetch(`/api/rooms/${roomCode}/frame`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frame }),
      });
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
    this.closeStream();
  }

  subscribeToRoom(
    roomCode: string,
    callbacks: {
      onInit?: (data: RoomSignalData) => void;
      onAnswer?: (data: { answer: RTCSessionDescriptionInit; monitorId: string; monitorName: string }) => void;
      onControllerCandidate?: (candidate: RTCIceCandidateInit) => void;
      onMonitorCandidate?: (candidate: RTCIceCandidateInit) => void;
      onFrame?: (data: { frame: string }) => void;
      onDisconnected?: () => void;
    }
  ) {
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
        console.warn('SSE connection error:', err);
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
}

export const signaling = new SignalingClient();
