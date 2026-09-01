import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { rtcConfiguration } from '../lib/webrtc';
import { signaling } from '../lib/signaling';
import {
  Tv,
  Radio,
  Plug,
  Unplug,
  RefreshCw,
  AlertCircle,
  Maximize2,
  Minimize2,
  KeyRound,
  ShieldCheck,
} from 'lucide-react';

interface MonitorModeProps {
  user: UserProfile;
  initialRoomCode?: string;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'lost';

export const MonitorMode: React.FC<MonitorModeProps> = ({ user, initialRoomCode }) => {
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode || '');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('idle');
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);

  // Cleanly disconnect WebRTC and backend listeners
  const disconnect = useCallback(async () => {
    signaling.closeStream();

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

    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    setFallbackFrame(null);
    setConnectionStatus('idle');
    setIsCameraLive(false);
    setActiveRoomCode(null);
  }, []);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  const connectToRoom = useCallback(async (codeToConnect?: string) => {
    const raw = (codeToConnect || roomCodeInput).trim().replace(/\D/g, '');
    if (!raw || raw.length !== 6) {
      setErrorMessage('Please enter a valid 6-digit Controller Code.');
      return;
    }

    setErrorMessage(null);
    setConnectionStatus('connecting');
    setIsCameraLive(false);
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];

    try {
      // 1. Fetch Room from Backend
      const roomData = await signaling.getRoom(raw);

      if (!roomData) {
        throw new Error(`Room "${raw}" not found. Please verify the code on the Controller device.`);
      }

      if (roomData.status === 'disconnected' || !roomData.offer) {
        throw new Error(`Controller camera for room "${raw}" is currently offline.`);
      }

      if (roomData.lastFrame) {
        setFallbackFrame(roomData.lastFrame);
      }

      setActiveRoomCode(raw);

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
            await signaling.sendCandidate(raw, 'monitor', event.candidate.toJSON());
          } catch (err) {
            console.warn('Error sending monitor candidate:', err);
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

      // Add already collected controller candidates
      if (roomData.controllerCandidates && roomData.controllerCandidates.length > 0) {
        for (const c of roomData.controllerCandidates) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(c));
          } catch (e) {
            console.warn('Error adding existing controller candidate:', e);
          }
        }
      }

      // 4. Create WebRTC Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 5. Send Answer to Backend
      await signaling.sendAnswer(
        raw,
        {
          type: answer.type,
          sdp: answer.sdp,
        },
        user.uid,
        user.fullName || 'Monitor Phone'
      );

      // 6. Subscribe to Controller Candidates & Stream updates via SSE
      signaling.subscribeToRoom(raw, {
        onControllerCandidate: async (candidateData) => {
          if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (err) {
              console.warn('Error adding controller candidate:', err);
            }
          } else {
            candidateQueueRef.current.push(candidateData);
          }
        },
        onFrame: (data) => {
          if (data.frame) {
            setFallbackFrame(data.frame);
            setIsCameraLive(true);
            setConnectionStatus('connected');
          }
        },
        onDisconnected: () => {
          setConnectionStatus('lost');
          setIsCameraLive(false);
        },
      });
    } catch (err: any) {
      console.error('Failed to connect to room:', err);
      setErrorMessage(err.message || 'Failed to connect. Please check the 6-digit code and ensure Controller camera is running.');
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
  }, [roomCodeInput, user.uid, user.fullName, fallbackFrame]);

  // Auto-connect if initialRoomCode is passed via direct URL
  useEffect(() => {
    if (initialRoomCode && initialRoomCode.trim().length === 6) {
      connectToRoom(initialRoomCode.trim());
    }
  }, [initialRoomCode, connectToRoom]);

  const handleReconnect = () => {
    if (activeRoomCode) {
      connectToRoom(activeRoomCode);
    } else if (roomCodeInput.trim().length === 6) {
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

      {/* Main Viewer Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Remote Live Video Display */}
        <div
          ref={videoContainerRef}
          className="relative aspect-video sm:aspect-4/3 bg-neutral-950 flex items-center justify-center overflow-hidden"
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

          {/* Real-time frame relay */}
          {connectionStatus === 'connected' && isCameraLive && fallbackFrame && (
            <img
              src={fallbackFrame}
              alt="Live Camera Feed"
              className={`w-full h-full object-contain bg-black absolute inset-0 ${
                videoRef.current?.srcObject ? 'hidden' : ''
              }`}
            />
          )}

          {/* Non-live States */}
          {(connectionStatus !== 'connected' || !isCameraLive) && (
            <div className="text-center p-6 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3">
                <Tv className="w-7 h-7" />
              </div>
              {connectionStatus === 'connecting' ? (
                <div>
                  <p className="text-sm font-semibold text-blue-400 animate-pulse">
                    Connecting to Controller Phone...
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    Verifying code and establishing live video stream.
                  </p>
                </div>
              ) : connectionStatus === 'lost' ? (
                <div>
                  <p className="text-sm font-semibold text-red-400">
                    Connection Ended
                  </p>
                  <p className="text-xs text-neutral-500 mt-1">
                    The Controller camera was stopped or the room disconnected.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm font-medium text-neutral-300">
                    Enter Controller Code Below
                  </p>
                  <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                    Input the 6-digit code shown on the Controller device to watch its live camera.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* On-Video Badges when live */}
          {connectionStatus === 'connected' && isCameraLive && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-semibold text-white">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE HOME FEED
              </div>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-1.5 rounded-lg bg-black/60 backdrop-blur-sm border border-white/10 text-white hover:bg-black/90 transition pointer-events-auto cursor-pointer"
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

        {/* 6-Digit Code Input Section (When Idle) */}
        {connectionStatus === 'idle' && (
          <div className="p-5 bg-neutral-950 border-t border-b border-neutral-800">
            <div className="text-center mb-3">
              <label
                htmlFor="monitor-room-code-input"
                className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-neutral-300 mb-1"
              >
                <KeyRound className="w-4 h-4 text-blue-400" />
                Enter 6-Digit Controller Code
              </label>
              <p className="text-xs text-neutral-500">
                Input the code displayed on your home camera phone.
              </p>
            </div>

            <div className="max-w-xs mx-auto">
              <input
                id="monitor-room-code-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={roomCodeInput}
                onChange={(e) => {
                  const cleaned = e.target.value.replace(/[^0-9]/g, '');
                  setRoomCodeInput(cleaned);
                  if (cleaned.length === 6) {
                    connectToRoom(cleaned);
                  }
                }}
                placeholder="------"
                className="w-full text-center font-mono text-3xl font-extrabold tracking-widest px-4 py-3 rounded-xl bg-neutral-900 border-2 border-neutral-700 text-neutral-100 placeholder-neutral-700 focus:outline-none focus:border-blue-500 shadow-inner"
              />
            </div>
          </div>
        )}

        {/* Active Connected Room Banner */}
        {connectionStatus !== 'idle' && activeRoomCode && (
          <div className="px-4 py-2.5 bg-neutral-950/80 border-t border-b border-neutral-800 text-center flex items-center justify-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs text-neutral-300">
              Monitoring Room: <strong className="font-mono text-emerald-400 font-bold text-sm tracking-wider">{activeRoomCode}</strong>
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
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                  <span className="text-blue-300">Connecting...</span>
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
                  <span className="text-emerald-400">Paired with Code</span>
                </>
              ) : connectionStatus === 'lost' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-red-400">Offline</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
                  <span className="text-blue-300">Authenticating Code...</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600"></span>
                  <span className="text-neutral-400">Enter Code</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 pt-0 space-y-2.5">
          {connectionStatus === 'idle' && (
            <button
              id="btn-connect-monitor"
              type="button"
              onClick={() => connectToRoom()}
              disabled={roomCodeInput.trim().length !== 6}
              className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950/40 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              <Plug className="w-5 h-5" />
              Watch Live Feed
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
              Stop Watching
            </button>
          )}

          {connectionStatus === 'lost' && (
            <div className="space-y-2.5">
              <button
                id="btn-reconnect-monitor"
                type="button"
                onClick={handleReconnect}
                className="w-full py-3.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-blue-950/40 cursor-pointer"
              >
                <RefreshCw className="w-5 h-5" />
                Retry Connection
              </button>

              <button
                id="btn-reset-monitor"
                type="button"
                onClick={disconnect}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-sm border border-neutral-700 transition cursor-pointer"
              >
                Enter Different Code
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
