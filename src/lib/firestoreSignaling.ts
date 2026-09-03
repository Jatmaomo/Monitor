import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  where,
  getDocs,
  serverTimestamp,
  deleteDoc,
  Unsubscribe,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { rtcConfiguration } from './webrtc';

export interface CameraSession {
  sessionId: string;
  pairingCode: string;
  cameraUserId: string;
  monitorUserId?: string | null;
  status: 'waiting' | 'connected' | 'disconnected';
  offer?: RTCSessionDescriptionInit | null;
  answer?: RTCSessionDescriptionInit | null;
  createdAt: number;
  expiresAt: number;
}

export interface CandidateDoc {
  candidate: RTCIceCandidateInit;
  createdAt: number;
  sender: 'camera' | 'monitor';
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export class FirestoreSignaling {
  /**
   * Create a new camera pairing session in Firestore
   */
  async createSession(
    sessionId: string,
    pairingCode: string,
    cameraUserId: string,
    offer: RTCSessionDescriptionInit
  ): Promise<void> {
    const sessionPath = `sessions/${sessionId}`;
    try {
      const sessionDocRef = doc(db, 'sessions', sessionId);
      const sessionData: CameraSession = {
        sessionId,
        pairingCode,
        cameraUserId,
        monitorUserId: null,
        status: 'waiting',
        offer,
        answer: null,
        createdAt: Date.now(),
        expiresAt: Date.now() + 60 * 60 * 1000, // 1 hour expiration
      };
      await setDoc(sessionDocRef, sessionData);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, sessionPath);
    }
  }

  /**
   * Find a session by its 6-digit pairing code
   */
  async findSessionByCode(pairingCode: string): Promise<CameraSession | null> {
    const sessionsPath = 'sessions';
    try {
      const q = query(
        collection(db, 'sessions'),
        where('pairingCode', '==', pairingCode.trim())
      );
      const querySnap = await getDocs(q);
      if (querySnap.empty) {
        return null;
      }
      // Take the most recent active session
      const docs = querySnap.docs.map((d) => d.data() as CameraSession);
      const active = docs.filter((s) => s.status !== 'disconnected' && s.expiresAt > Date.now());
      if (active.length === 0) return null;
      return active[active.length - 1];
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, sessionsPath);
    }
  }

  /**
   * Get a session directly by its sessionId
   */
  async getSession(sessionId: string): Promise<CameraSession | null> {
    const sessionPath = `sessions/${sessionId}`;
    try {
      const snap = await getDoc(doc(db, 'sessions', sessionId));
      if (!snap.exists()) return null;
      return snap.data() as CameraSession;
    } catch (err) {
      handleFirestoreError(err, OperationType.GET, sessionPath);
    }
  }

  /**
   * Monitor joins session: writes SDP answer and updates status to 'connected'
   */
  async joinSession(
    sessionId: string,
    monitorUserId: string,
    answer: RTCSessionDescriptionInit
  ): Promise<void> {
    const sessionPath = `sessions/${sessionId}`;
    try {
      const sessionDocRef = doc(db, 'sessions', sessionId);
      await updateDoc(sessionDocRef, {
        monitorUserId,
        answer,
        status: 'connected',
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, sessionPath);
    }
  }

  /**
   * Add ICE candidate to Firestore subcollection
   */
  async addIceCandidate(
    sessionId: string,
    sender: 'camera' | 'monitor',
    candidate: RTCIceCandidateInit
  ): Promise<void> {
    const subcollectionName = sender === 'camera' ? 'cameraCandidates' : 'monitorCandidates';
    const path = `sessions/${sessionId}/${subcollectionName}`;
    try {
      const colRef = collection(db, 'sessions', sessionId, subcollectionName);
      await addDoc(colRef, {
        candidate,
        createdAt: Date.now(),
        sender,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  }

  /**
   * Listen for session updates (e.g. Camera phone listening for Monitor's answer)
   */
  subscribeToSession(
    sessionId: string,
    onUpdate: (session: CameraSession) => void,
    onError?: (err: Error) => void
  ): Unsubscribe {
    const sessionPath = `sessions/${sessionId}`;
    const docRef = doc(db, 'sessions', sessionId);

    return onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          onUpdate(snapshot.data() as CameraSession);
        }
      },
      (error) => {
        console.error('Session listener error:', error);
        onError?.(error);
        handleFirestoreError(error, OperationType.GET, sessionPath);
      }
    );
  }

  /**
   * Listen for remote ICE candidates
   */
  subscribeToCandidates(
    sessionId: string,
    targetSender: 'camera' | 'monitor',
    onCandidate: (candidate: RTCIceCandidateInit) => void
  ): Unsubscribe {
    const subcollectionName = targetSender === 'camera' ? 'cameraCandidates' : 'monitorCandidates';
    const path = `sessions/${sessionId}/${subcollectionName}`;
    const colRef = collection(db, 'sessions', sessionId, subcollectionName);

    return onSnapshot(
      colRef,
      (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === 'added') {
            const data = change.doc.data() as CandidateDoc;
            if (data?.candidate) {
              onCandidate(data.candidate);
            }
          }
        });
      },
      (error) => {
        console.warn('Candidate subscription error:', error);
        handleFirestoreError(error, OperationType.GET, path);
      }
    );
  }

  /**
   * Mark session as disconnected
   */
  async closeSession(sessionId: string): Promise<void> {
    const sessionPath = `sessions/${sessionId}`;
    try {
      const docRef = doc(db, 'sessions', sessionId);
      await updateDoc(docRef, {
        status: 'disconnected',
      });
    } catch (err) {
      // Ignore if document is already removed
    }
  }
}

export const firestoreSignaling = new FirestoreSignaling();
