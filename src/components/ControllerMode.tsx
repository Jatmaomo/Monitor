import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  doc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { UserProfile } from '../types';
import { rtcConfiguration, generateRoomCode } from '../lib/webrtc';
import {
  Camera,
  Video,
  VideoOff,
  SwitchCamera,
  Copy,
  Check,
  AlertCircle,
  Radio,
  Wifi,
} from 'lucide-react';

interface ControllerModeProps {
  user: UserProfile;
}

export const ControllerMode: React.FC<ControllerModeProps> = ({ user }) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isMonitorConnected, setIsMonitorConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const unsubscribeRoomRef = useRef<(() => void) | null>(null);
  const unsubscribeCandidatesRef = useRef<(() => void) | null>(null);
  const currentRoomCodeRef = useRef<string | null>(null);
  const heartbeatIntervalRef = useRef<any>(null);
  const frameIntervalRef = useRef<any>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);

  // Stop camera and cleanup WebRTC
  const stopCamera = useCallback(async () => {
    // Clear intervals
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    // Unsubscribe from Firestore listeners
    if (unsubscribeRoomRef.current) {
      unsubscribeRoomRef.current();
      unsubscribeRoomRef.current = null;
    }
    if (unsubscribeCandidatesRef.current) {
      unsubscribeCandidatesRef.current();
      unsubscribeCandidatesRef.current = null;
    }

    // Close WebRTC peer connection
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      peerConnectionRef.current = null;
    }

    // Stop all media tracks
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    // Update room status in Firestore
    if (currentRoomCodeRef.current) {
      try {
        await updateDoc(doc(db, 'rooms', currentRoomCodeRef.current), {
          status: 'disconnected',
          updatedAt: Date.now(),
        });
      } catch (err) {
        console.warn('Failed to update room status on stop:', err);
      }
      currentRoomCodeRef.current = null;
    }

    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    setIsCameraActive(false);
    setIsMonitorConnected(false);
    setRoomCode(null);
  }, []);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Helper to capture a compressed frame for real-time reliable frame backup
  const captureFrame = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.4);
    } catch {
      return null;
    }
  };

  const startCamera = async () => {
    setErrorMessage(null);
    setIsStarting(true);
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];

    try {
      // 1. Request camera permission
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facingMode,
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
          },
          audio: false,
        });
      } catch (err) {
        console.warn('FacingMode fallback attempt:', err);
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch {
          // ignore autoplay block on initial render
        }
      }

      // 2. Generate a clean 6-digit room code
      const newRoomCode = generateRoomCode();
      setRoomCode(newRoomCode);
      currentRoomCodeRef.current = newRoomCode;

      // 3. Create WebRTC Peer Connection
      const pc = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = pc;

      // Add local stream tracks to WebRTC
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle ICE Candidates from Controller
      pc.onicecandidate = async (event) => {
        if (event.candidate && currentRoomCodeRef.current) {
          try {
            await addDoc(
              collection(db, 'rooms', currentRoomCodeRef.current, 'controllerCandidates'),
              event.candidate.toJSON()
            );
          } catch (err) {
            console.warn('Error saving controller candidate:', err);
          }
        }
      };

      // Monitor connection state
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setIsMonitorConnected(true);
        } else if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          setIsMonitorConnected(false);
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
          setIsMonitorConnected(true);
        } else if (
          pc.iceConnectionState === 'disconnected' ||
          pc.iceConnectionState === 'failed'
        ) {
          setIsMonitorConnected(false);
        }
      };

      // 4. Create WebRTC Offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      // 5. Store room and offer in Firestore Backend
      await setDoc(doc(db, 'rooms', newRoomCode), {
        id: newRoomCode,
        controllerId: user.uid,
        controllerName: user.fullName || 'Controller Phone',
        cameraLabel: `${user.fullName || 'Controller'}'s Camera`,
        status: 'waiting',
        offer: {
          type: offer.type,
          sdp: offer.sdp,
        },
        lastHeartbeat: Date.now(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // 6. Listen for Monitor's WebRTC Answer
      const unsubscribeRoom = onSnapshot(doc(db, 'rooms', newRoomCode), async (snapshot) => {
        const data = snapshot.data();
        if (data?.answer && !isRemoteDescriptionSetRef.current && pc.signalingState !== 'stable') {
          try {
            const answer = new RTCSessionDescription(data.answer);
            await pc.setRemoteDescription(answer);
            isRemoteDescriptionSetRef.current = true;
            setIsMonitorConnected(true);

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
          } catch (err) {
            console.error('Error setting remote description from answer:', err);
          }
        }
      });
      unsubscribeRoomRef.current = unsubscribeRoom;

      // 7. Listen for Monitor's ICE Candidates
      const unsubscribeCandidates = onSnapshot(
        collection(db, 'rooms', newRoomCode, 'monitorCandidates'),
        (snapshot) => {
          snapshot.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
              const candidateData = change.doc.data() as RTCIceCandidateInit;
              if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(candidateData));
                } catch (err) {
                  console.warn('Error adding monitor candidate:', err);
                }
              } else {
                candidateQueueRef.current.push(candidateData);
              }
            }
          });
        }
      );
      unsubscribeCandidatesRef.current = unsubscribeCandidates;

      // 8. Start Heartbeat Interval (Updates backend every 3s so Monitor auto-discovers active camera)
      heartbeatIntervalRef.current = setInterval(async () => {
        if (currentRoomCodeRef.current) {
          try {
            await updateDoc(doc(db, 'rooms', currentRoomCodeRef.current), {
              lastHeartbeat: Date.now(),
              updatedAt: Date.now(),
            });
          } catch (err) {
            console.warn('Heartbeat error:', err);
          }
        }
      }, 3000);

      // 9. Frame backup sync (every 600ms updates lightweight frame snapshot)
      frameIntervalRef.current = setInterval(async () => {
        if (currentRoomCodeRef.current) {
          const frame = captureFrame();
          if (frame) {
            try {
              await updateDoc(doc(db, 'rooms', currentRoomCodeRef.current), {
                lastFrame: frame,
                lastHeartbeat: Date.now(),
              });
            } catch {
              // ignore
            }
          }
        }
      }, 600);

      setIsCameraActive(true);
    } catch (err: any) {
      console.error('Failed to start camera:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Camera access was denied. Please allow camera permission in your browser.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('No camera found on this device.');
      } else {
        setErrorMessage(err.message || 'Failed to start camera. Please try again.');
      }
      await stopCamera();
    } finally {
      setIsStarting(false);
    }
  };

  const handleSwitchCamera = async () => {
    if (!isCameraActive) return;
    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(newFacingMode);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: newFacingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      // Stop old video tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      streamRef.current = newStream;
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
      }

      // Replace track on WebRTC peer connection
      if (peerConnectionRef.current) {
        const newVideoTrack = newStream.getVideoTracks()[0];
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender && newVideoTrack) {
          await videoSender.replaceTrack(newVideoTrack);
        }
      }
    } catch (err) {
      console.warn('Failed to switch camera:', err);
      setFacingMode(facingMode);
    }
  };

  const copyRoomCode = () => {
    if (roomCode) {
      navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div id="controller-mode" className="w-full max-w-md mx-auto p-4 sm:p-6">
      {/* Title & Subtitle */}
      <div className="mb-4 text-center">
        <h2 className="text-xl font-bold text-neutral-100 tracking-tight flex items-center justify-center gap-2">
          <Camera className="w-5 h-5 text-emerald-400" />
          Controller Mode
        </h2>
        <p className="text-sm text-neutral-400 mt-1">
          "Use this phone as your home camera."
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 p-3.5 rounded-xl bg-red-950/50 border border-red-800/60 text-red-300 text-sm flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="leading-snug">{errorMessage}</div>
        </div>
      )}

      {/* Main Camera Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-xl">
        {/* Camera Preview Area */}
        <div className="relative aspect-video sm:aspect-4/3 bg-neutral-950 flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${
              !isCameraActive ? 'hidden' : ''
            } ${facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
          />

          {!isCameraActive && (
            <div className="text-center p-6 flex flex-col items-center">
              <div className="w-14 h-14 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3">
                <Camera className="w-7 h-7" />
              </div>
              <p className="text-sm font-medium text-neutral-300">
                Camera is currently inactive
              </p>
              <p className="text-xs text-neutral-500 mt-1 max-w-xs">
                Press "Start Camera" below to begin broadcasting live video to the backend.
              </p>
            </div>
          )}

          {/* On-video badges when live */}
          {isCameraActive && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-semibold text-white">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE BROADCAST
              </div>

              <div className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-mono text-neutral-300 flex items-center gap-1">
                <Wifi className="w-3 h-3 text-emerald-400" />
                {facingMode === 'environment' ? 'Rear Cam' : 'Front Cam'}
              </div>
            </div>
          )}
        </div>

        {/* Pairing / Room Code Display (When Live) */}
        {isCameraActive && roomCode && (
          <div className="p-4 bg-neutral-950/80 border-t border-b border-neutral-800">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-xs font-semibold uppercase tracking-wider text-neutral-400">
                <Radio className="w-3.5 h-3.5 text-emerald-400" />
                Camera Room Code
              </div>
              <div className="flex items-center justify-center gap-2 mt-1.5">
                <span
                  id="room-code-display"
                  className="font-mono text-3xl font-bold tracking-widest text-emerald-400 bg-neutral-900 px-3 py-1 rounded-xl border border-emerald-500/30"
                >
                  {roomCode}
                </span>
                <button
                  id="btn-copy-room-code"
                  type="button"
                  onClick={copyRoomCode}
                  className="p-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition cursor-pointer"
                  title="Copy Room Code"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              <p className="text-xs text-emerald-400/90 mt-2 font-medium">
                Discovered automatically on your Monitor phone, or enter this 6-digit code.
              </p>
            </div>
          </div>
        )}

        {/* Status Indicators */}
        <div className="p-4 space-y-2.5 bg-neutral-900 text-sm">
          <div className="flex items-center justify-between py-1 border-b border-neutral-800/60">
            <span className="text-neutral-400 font-medium">Camera Status:</span>
            <span
              id="status-camera-controller"
              className="font-semibold flex items-center gap-1.5"
            >
              {isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-emerald-400">Live & Broadcasting</span>
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
            <span className="text-neutral-400 font-medium">Monitor Connection:</span>
            <span
              id="status-monitor-controller"
              className="font-semibold flex items-center gap-1.5"
            >
              {isMonitorConnected ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                  <span className="text-emerald-400">Monitor Connected</span>
                </>
              ) : isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-amber-300">Waiting for Monitor...</span>
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

        {/* Action Controls */}
        <div className="p-4 pt-0 space-y-2.5">
          {!isCameraActive ? (
            <button
              id="btn-start-camera"
              type="button"
              onClick={startCamera}
              disabled={isStarting}
              className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50 cursor-pointer"
            >
              <Video className="w-5 h-5" />
              {isStarting ? 'Starting Camera...' : 'Start Camera'}
            </button>
          ) : (
            <div className="space-y-2.5">
              <button
                id="btn-switch-camera"
                type="button"
                onClick={handleSwitchCamera}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-sm border border-neutral-700 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <SwitchCamera className="w-4 h-4" />
                Switch Camera (Front/Rear)
              </button>

              <button
                id="btn-stop-camera"
                type="button"
                onClick={stopCamera}
                className="w-full py-3.5 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
              >
                <VideoOff className="w-5 h-5" />
                Stop Camera
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
