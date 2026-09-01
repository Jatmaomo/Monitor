export type AppRole = 'controller' | 'monitor' | null;

export interface UserProfile {
  uid: string;
  fullName: string;
  email: string;
  createdAt: number;
}

export interface RoomData {
  id: string;
  controllerId: string;
  controllerName: string;
  cameraLabel?: string;
  status: 'waiting' | 'connected' | 'disconnected';
  monitorId?: string | null;
  monitorName?: string | null;
  offer?: {
    type: RTCSdpType;
    sdp: string;
  } | null;
  answer?: {
    type: RTCSdpType;
    sdp: string;
  } | null;
  lastHeartbeat?: number;
  lastFrame?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
  createdAt: number;
}
