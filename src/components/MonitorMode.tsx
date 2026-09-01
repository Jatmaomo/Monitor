import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  doc,
  getDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile, RoomData } from '../types';
import { rtcConfiguration } from '../lib/webrtc';
import {
  Tv,
  Radio,
  Plug,
  Unplug,
  RefreshCw,
  AlertCircle,
  Maximize2,
  Minimize2,
  Camera,
  Play,
  Signal,
} from 'lucide-react';

interface MonitorModeProps {
  user: UserProfile;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'lost';

export const MonitorMode: React.FC<MonitorModeProps> = ({ user }) => {
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('idle');
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [discoveredCameras, setDiscoveredCameras] = useState<RoomData[]>([]);
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const unsubscribeRoomRef = useRef<(() => void) | null>(null);
  const unsubscribeCandidatesRef = useRef<(() => void) | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);

  // Auto-discover active Controller cameras from Firestore backend in real-time
  useEffect(() => {
    const unsubscribeRoomsList = onSnapshot(
      collection(db, 'rooms'),
      (snapshot) => {
        const now = Date.now();
        const activeRooms: RoomData[] = [];
        snapshot.forEach((docSnap) => {
          const data = docSnap.data() as RoomData;
          const isRecentlyActive =
            data.status !== 'disconnected' &&
            (now - (data.lastHeartbeat || data.updatedAt || data.createdAt) < 45000);
          if (isRecentlyActive) {
            activeRooms.push({
              ...data,
              id: docSnap.id,
            });
          }
        });
        setDiscoveredCameras(activeRooms);
      },
      (err) => {
        console.warn('Rooms discovery listener warning:', err);
      }
    );

    return () => unsubscribeRoomsList();
  }, []);

  // Cleanly disconnect WebRTC and Firestore listeners
  const disconnect = useCallback(async () => {
    if (unsubscribeRoomRef.current) {
      unsubscribeRoomRef.current();
      unsubscribeRoomRef.current = null;
    }
    if (unsubscribeCandidatesRef.current) {
      unsubscribeCandidatesRef.current();
      unsubscribeCandidatesRef.current = null;
    }

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      peerConnectionRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    if (activeRoomCode) {
      try {
        await updateDoc(doc(db, 'rooms', activeRoomCode), {
          status: 'waiting',
          monitorId: null,
          monitorName: null,
          answer: null,
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.warn('Error updating room doc on monitor disconnect:', err);
      }
    }

    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    setFallbackFrame(null);
    setConnectionStatus('idle');
    setIsCameraLive(false);
    setActiveRoomCode(null);
  }, [activeRoomCode]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const connectToRoom = async (codeToConnect?: string) => {
    const code = (codeToConnect || roomCodeInput).trim();
    if (!code) {
      setErrorMessage('Please enter or select a 6-digit Room Code.');
      return;
    }

    setErrorMessage(null);
    setConnectionStatus('connecting');
    setIsCameraLive(false);
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];

    try {
      // 1. Fetch Room from Firestore Backend
      const roomDocRef = doc(db, 'rooms', code);
      const roomSnap = await getDoc(roomDocRef);

      if (!roomSnap.exists()) {
        throw new Error('Room Code not found. Please check the code and ensure Controller camera is live.');
      }

      const roomData = roomSnap.data() as RoomData;
      if (roomData.status === 'disconnected' || !roomData.offer) {
        throw new Error('Controller camera is not currently active for this room.');
      }

      if (roomData.lastFrame) {
        setFallbackFrame(roomData.lastFrame);
      }

      setActiveRoomCode(code);

      // 2. Create RTCPeerConnection
      const pc = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = pc;

      // Handle receiving remote video stream
      pc.ontrack = async (event) => {
        if (event.streams && event.streams[0]) {
          if (videoRef.current) {
            videoRef.current.srcObject = event.streams[0];
            try {
              await videoRef.current.play();
            } catch (playErr) {
              console.warn('Video play attempt:', playErr);
            }
          }
          setIsCameraLive(true);
        }
      };

      // Handle ICE candidates from Monitor
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          try {
            await addDoc(
              collection(db, 'rooms', code, 'monitorCandidates'),
              event.candidate.toJSON()
            );
          } catch (err) {
            console.warn('Error adding monitor candidate:', err);
          }
        }
      };

      // Handle Connection State Changes
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setConnectionStatus('connected');
          setIsCameraLive(true);
        } else if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          if (!fallbackFrame) {
            setConnectionStatus('lost');
            setIsCameraLive(false);
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setConnectionStatus('connected');
          setIsCameraLive(true);
        } else if (
          pc.iceConnectionState === 'disconnected' ||
          pc.iceConnectionState === 'failed'
        ) {
          if (!fallbackFrame) {
            setConnectionStatus('lost');
            setIsCameraLive(false);
          }
        }
      };

      // 3. Set Remote Description (Controller Offer)
      const offerDescription = new RTCSessionDescription(roomData.offer);
      await pc.setRemoteDescription(offerDescription);
      isRemoteDescriptionSetRef.current = true;

      // Flush queued candidates
      while (candidateQueueRef.current.length > 0) {
        const cand = candidateQueueRef.current.shift();
        if (cand) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn('Error adding queued candidate:', e);
          }
        }
      }

      // 4. Create Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 5. Update Firestore Room with Answer
      await updateDoc(roomDocRef, {
        answer: {
          type: answer.type,
          sdp: answer.sdp,
        },
        monitorId: user.uid,
        monitorName: user.fullName || 'Monitor Phone',
        status: 'connected',
        updatedAt: Date.now(),
      });

      // 6. Listen to Controller ICE Candidates
      const unsubscribeCandidates = onSnapshot(
        collection(db, 'rooms', code, 'controllerCandidates'),
        (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const candidateData = change.doc.data() as RTCIceCandidateInit;
              if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidateData));
                } catch (err) {
                  console.warn('Error adding controller candidate:', err);
                }
              } else {
                candidateQueueRef.current.push(candidateData);
              }
            }
          });
        }
      );
      unsubscribeCandidatesRef.current = unsubscribeCandidates;

      // 7. Listen for Room status updates & real-time frame relay
      const unsubscribeRoom = onSnapshot(roomDocRef, (snapshot) => {
        const data = snapshot.data() as RoomData | undefined;
        if (!data || data.status === 'disconnected') {
          setConnectionStatus('lost');
          setIsCameraLive(false);
        } else {
          if (data.lastFrame) {
            setFallbackFrame(data.lastFrame);
            setIsCameraLive(true);
            setConnectionStatus('connected');
          }
        }
      });
      unsubscribeRoomRef.current = unsubscribeRoom;
    } catch (err: any) {
      console.error('Failed to connect to room:', err);
      setErrorMessage(err.message || 'Failed to connect to Controller. Please check the code.');
      setConnectionStatus('idle');
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch {
          // ignore
        }
        peerConnectionRef.current = null;
      }
    }
  };

  const handleReconnect = () => {
    if (activeRoomCode) {
      connectToRoom(activeRoomCode);
    } else if (roomCodeInput.trim()) {
      connectToRoom(roomCodeInput.trim());
    }
  };

  const toggleFullscreen = () => {
    if (!videoContainerRef.current) return;
    if (!document.fullscreenElement) {
      videoContainerRef.current.requestFullscreen().catch(console.warn);
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(console.warn);
      setIsFullscreen(false);
    }
  };

  return (
    <div id="monitor-mode" className="w-full max-w-md mx-auto p-4 sm:p-6">
      {/* Title & Subtitle */}
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold text-neutral-100 tracking-tight flex items-center justify-center gap-2">
          <Tv className="w-5 h-5 text-blue-400" />
          Monitor Mode
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          "Watch your home from wherever you are."
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 p-3.5 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-sm flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="leading-snug">{errorMessage}</div>
        </div>
      )}

      {/* Discovered Cameras Backend List (When Idle) */}
      {connectionStatus === 'idle' && (
        <div className="mb-4 bg-neutral-900 border border-neutral-800 rounded-2xl p-4 shadow-lg">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
              <Signal className="w-3.5 h-3.5 animate-pulse" />
              Discovered Live Cameras ({discoveredCameras.length})
            </span>
            <span className="text-[11px] text-neutral-500 font-mono">Real-Time Backend</span>
          </div>

          {discoveredCameras.length > 0 ? (
            <div className="space-y-2">
              {discoveredCameras.map((cam) => (
                <div
                  key={cam.id}
                  className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 hover:border-emerald-500/50 transition flex items-center justify-between"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
                      <Camera className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-neutral-200">
                        {cam.cameraLabel || cam.controllerName || 'Camera Phone'}
                      </div>
                      <div className="text-xs text-neutral-400 flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-emerald-400 font-bold tracking-wider">
                          Code: {cam.id}
                        </span>
                        <span>&bull;</span>
                        <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          Online
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setRoomCodeInput(cam.id);
                      connectToRoom(cam.id);
                    }}
                    className="py-1.5 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition flex items-center gap-1.5 cursor-pointer shadow-md shadow-blue-950/40"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    Watch
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-4 px-2 rounded-xl bg-neutral-950 border border-neutral-800/80">
              <Camera className="w-5 h-5 text-neutral-600 mx-auto mb-1.5" />
              <p className="text-xs text-neutral-400">
                No cameras currently broadcasting.
              </p>
              <p className="text-[11px] text-neutral-500 mt-0.5">
                Open Controller mode on another phone or enter a 6-digit code below.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Main Viewer Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Remote Live Video Display */}
        <div
          ref={videoContainerRef}
          className="relative aspect-video sm:aspect-4/3 bg-neutral-950 flex items-center justify-center overflow-hidden group"
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain bg-black ${
              connectionStatus !== 'connected' || !isCameraLive ? 'hidden' : ''
            }`}
          />

          {/* Fallback image relay if peer-to-peer WebRTC video stream is negotiating */}
          {connectionStatus === 'connected' && isCameraLive && fallbackFrame && (
            <img
              src={fallbackFrame}
              alt="Live Camera Relay"
              className={`w-full h-full object-contain bg-black absolute inset-0 ${
                videoRef.current?.srcObject ? 'hidden' : ''
              }`}
            />
          )}

          {/* Fallback States when not live */}
          {(connectionStatus !== 'connected' || !isCameraLive) && (
            <div className="text-center p-6 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3">
                <Tv className="w-7 h-7" />
              </div>
              {connectionStatus === 'connecting' ? (
                <div>
                  <p className="text-sm font-semibold text-emerald-400 animate-pulse">
                    Connecting to Controller...
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Establishing real-time peer-to-peer video stream via backend signaling
                  </p>
                </div>
              ) : connectionStatus === 'lost' ? (
                <div>
                  <p className="text-sm font-semibold text-red-400">
                    Connection Lost
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    The camera feed was interrupted or stopped by the Controller.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-neutral-300">
                    No active video feed
                  </p>
                  <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                    Select a camera above or enter the 6-digit room code below.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* On-Video Badges when live */}
          {connectionStatus === 'connected' && isCameraLive && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-semibold text-white">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE FEED
              </div>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white hover:bg-black/90 transition cursor-pointer"
                title="Toggle Fullscreen"
              >
                {isFullscreen ? (
                  <Minimize2 className="w-4 h-4" />
                ) : (
                  <Maximize2 className="w-4 h-4" />
                )}
              </button>
            </div>
          )}
        </div>

        {/* Manual Pairing Code Input (When Idle) */}
        {connectionStatus === 'idle' && (
          <div className="p-4 bg-neutral-950/80 border-t border-b border-neutral-800">
            <label
              htmlFor="monitor-room-code-input"
              className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5 text-center"
            >
              Or Enter 6-Digit Room Code Manually
            </label>
            <input
              id="monitor-room-code-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={roomCodeInput}
              onChange={(e) =>
                setRoomCodeInput(e.target.value.replace(/[^0-9]/g, ''))
              }
              placeholder="e.g. 482913"
              className="w-full text-center font-mono text-2xl font-bold tracking-widest px-4 py-2.5 rounded-xl bg-neutral-900 border border-neutral-700 text-neutral-100 placeholder-neutral-600 focus:outline-none focus:border-blue-500"
            />
          </div>
        )}

        {/* Room Code Display during active connection */}
        {connectionStatus !== 'idle' && activeRoomCode && (
          <div className="px-4 py-2.5 bg-neutral-950/60 border-t border-b border-neutral-800 text-center flex items-center justify-center gap-2">
            <span className="text-xs text-neutral-400">
              Connected to Room: <strong className="font-mono text-emerald-400 font-bold text-sm tracking-wider">{activeRoomCode}</strong>
            </span>
          </div>
        )}

        {/* Status Indicators */}
        <div className="p-4 space-y-2.5 bg-neutral-900 text-sm">
          <div className="flex items-center justify-between py-1 border-b border-neutral-800/60">
            <span className="text-neutral-400 font-medium">Camera Feed:</span>
            <span
              id="status-camera-monitor"
              className="font-semibold flex items-center gap-1.5"
            >
              {connectionStatus === 'connected' && isCameraLive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-emerald-400">Live Streaming</span>
                </>
              ) : connectionStatus === 'lost' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-red-400">Disconnected</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-amber-300">Connecting...</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600"></span>
                  <span className="text-neutral-400">Inactive</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-neutral-400 font-medium">Controller Phone:</span>
            <span
              id="status-controller-monitor"
              className="font-semibold flex items-center gap-1.5"
            >
              {connectionStatus === 'connected' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-emerald-400">Connected</span>
                </>
              ) : connectionStatus === 'lost' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-red-400">Connection Lost</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-amber-300">Pairing...</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600"></span>
                  <span className="text-neutral-400">Not Connected</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-4 pt-0 space-y-2.5">
          {connectionStatus === 'idle' && (
            <button
              id="btn-connect-monitor"
              type="button"
              onClick={() => connectToRoom()}
              disabled={roomCodeInput.trim().length === 0}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plug className="w-5 h-5" />
              Connect with Code
            </button>
          )}

          {connectionStatus === 'connecting' && (
            <button
              type="button"
              disabled
              className="w-full py-3.5 px-4 rounded-xl bg-blue-600/60 text-white/80 font-bold text-base flex items-center justify-center gap-2 cursor-wait"
            >
              <Radio className="w-5 h-5 animate-spin" />
              Connecting to Camera...
            </button>
          )}

          {connectionStatus === 'connected' && (
            <button
              id="btn-disconnect-monitor"
              type="button"
              onClick={disconnect}
              className="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
            >
              <Unplug className="w-5 h-5" />
              Disconnect
            </button>
          )}

          {connectionStatus === 'lost' && (
            <div className="space-y-2.5">
              <button
                id="btn-reconnect-monitor"
                type="button"
                onClick={handleReconnect}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 cursor-pointer"
              >
                <RefreshCw className="w-5 h-5" />
                Reconnect
              </button>

              <button
                id="btn-reset-monitor"
                type="button"
                onClick={disconnect}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-sm border border-neutral-700 transition cursor-pointer"
              >
                Enter Different Room Code
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
