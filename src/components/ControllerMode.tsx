import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { rtcConfiguration, generateRoomCode } from '../lib/webrtc';
import { signaling } from '../lib/signaling';
import {
  Camera,
  Video,
  VideoOff,
  SwitchCamera,
  Copy,
  Check,
  AlertCircle,
  Radio,
  Share2,
  Shield,
  Wifi,
  Eye,
} from 'lucide-react';

interface ControllerModeProps {
  user: UserProfile;
}

export const ControllerMode: React.FC<ControllerModeProps> = ({ user }) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isMonitorConnected, setIsMonitorConnected] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const currentRoomCodeRef = useRef<string | null>(null);
  const frameIntervalRef = useRef<any>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);

  // Helper to stop camera and cleanup WebRTC
  const stopCamera = useCallback(async () => {
    if (frameIntervalRef.current) {
      clearInterval(frameIntervalRef.current);
      frameIntervalRef.current = null;
    }

    if (currentRoomCodeRef.current) {
      try {
        await signaling.closeRoom(currentRoomCodeRef.current);
      } catch (err) {
        console.warn('Failed to close room:', err);
      }
      currentRoomCodeRef.current = null;
    }

    signaling.closeStream();

    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch (err) {
        console.warn('Error closing peer connection:', err);
      }
      peerConnectionRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
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

  // Robust multi-fallback helper to acquire camera stream
  const getCameraMediaStream = async (targetFacing: 'environment' | 'user'): Promise<MediaStream> => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Camera API (getUserMedia) is not supported in this browser. Please open in Chrome or Safari.');
    }

    // Constraint attempt 1: Facing mode + 720p ideal
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
    } catch (err1) {
      console.warn('Attempt 1 failed, trying simple facingMode:', err1);
    }

    // Constraint attempt 2: Simple facingMode
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: { facingMode: targetFacing },
        audio: false,
      });
    } catch (err2) {
      console.warn('Attempt 2 failed, trying default video:', err2);
    }

    // Constraint attempt 3: Generic default camera
    return await navigator.mediaDevices.getUserMedia({
      video: true,
      audio: false,
    });
  };

  // Helper to capture a compressed frame for real-time backup relay
  const captureFrame = () => {
    if (!videoRef.current || videoRef.current.readyState < 2) return null;
    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = 360;
      canvas.height = 270;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.5);
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
      // 1. Acquire media stream from camera
      const stream = await getCameraMediaStream(facingMode);
      streamRef.current = stream;

      // Attach stream to local preview video element
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        try {
          await videoRef.current.play();
        } catch (playErr) {
          console.warn('Video auto-play note:', playErr);
        }
      }

      // 2. Generate a 6-digit room code
      const newRoomCode = generateRoomCode();
      setRoomCode(newRoomCode);
      currentRoomCodeRef.current = newRoomCode;

      // 3. Create WebRTC Peer Connection
      const pc = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = pc;

      // Add local video track to WebRTC
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle ICE Candidates from Controller
      pc.onicecandidate = async (event) => {
        if (event.candidate && currentRoomCodeRef.current) {
          try {
            await signaling.sendCandidate(
              currentRoomCodeRef.current,
              'controller',
              event.candidate.toJSON()
            );
          } catch (err) {
            console.warn('Error saving controller candidate:', err);
          }
        }
      };

      // Track connection state
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

      const initialFrame = captureFrame();

      // 5. Store room and offer in Backend Server
      await signaling.createRoom(
        newRoomCode,
        user.uid,
        user.fullName || 'Home Camera',
        {
          type: offer.type,
          sdp: offer.sdp,
        },
        initialFrame
      );

      // 6. Listen for Monitor's WebRTC Answer & Candidates via SSE
      signaling.subscribeToRoom(newRoomCode, {
        onAnswer: async (data) => {
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
        },
        onMonitorCandidate: async (candidateData) => {
          if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidateData));
            } catch (err) {
              console.warn('Error adding monitor candidate:', err);
            }
          } else {
            candidateQueueRef.current.push(candidateData);
          }
        },
      });

      // 7. Frame relay sync (every 600ms updates lightweight frame snapshot to ensure feed never drops)
      frameIntervalRef.current = setInterval(async () => {
        if (currentRoomCodeRef.current) {
          const frame = captureFrame();
          if (frame) {
            signaling.sendFrame(currentRoomCodeRef.current, frame);
          }
        }
      }, 600);

      setIsCameraActive(true);
    } catch (err: any) {
      console.error('Failed to start camera:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setErrorMessage('Camera access was denied. Please allow camera permission in your browser to start broadcasting.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('No camera was detected on this device. Please connect a webcam or use a phone.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMessage('Camera is currently busy in another tab or application. Please close other camera tabs and retry.');
      } else {
        setErrorMessage(err.message || 'Could not start camera. Please verify device permissions.');
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
      const newStream = await getCameraMediaStream(newFacingMode);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }

      streamRef.current = newStream;
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        await videoRef.current.play();
      }

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
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const copyMonitorLink = () => {
    if (roomCode) {
      const directUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}&role=monitor`;
      navigator.clipboard.writeText(directUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
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
          <div className="leading-snug">
            {errorMessage}
            <div className="mt-2">
              <button
                type="button"
                onClick={startCamera}
                className="px-3 py-1.5 rounded-lg bg-red-800 hover:bg-red-700 text-white text-xs font-semibold transition"
              >
                Retry Camera
              </button>
            </div>
          </div>
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
                Press "Start Camera" below. You will receive a 6-digit code for your Monitor phone.
              </p>
            </div>
          )}

          {/* On-video badges when live */}
          {isCameraActive && (
            <div className="absolute top-3 left-3 right-3 flex items-center justify-between pointer-events-none">
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-semibold text-white">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                LIVE CAMERA
              </div>

              <div className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-sm border border-white/10 text-xs font-mono text-neutral-300 flex items-center gap-1">
                <Wifi className="w-3 h-3 text-emerald-400" />
                {facingMode === 'environment' ? 'Rear' : 'Front'}
              </div>
            </div>
          )}
        </div>

        {/* Room Code & Share Section (When Active) */}
        {isCameraActive && roomCode && (
          <div className="p-4 bg-neutral-950 border-t border-b border-neutral-800">
            <div className="text-center mb-3">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                <Shield className="w-3.5 h-3.5" />
                Your Monitor Code
              </div>
              <p className="text-xs text-neutral-400">
                Input this code on any phone in Monitor mode to watch your room live.
              </p>
            </div>

            {/* 6-Digit Code Display */}
            <div className="flex items-center justify-center gap-2">
              <div
                id="room-code-display"
                className="font-mono text-3xl sm:text-4xl font-extrabold tracking-widest text-emerald-400 bg-neutral-900 px-5 py-2 rounded-xl border border-emerald-500/40 shadow-inner"
              >
                {roomCode}
              </div>
              <button
                id="btn-copy-room-code"
                type="button"
                onClick={copyRoomCode}
                className="p-3 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition cursor-pointer flex items-center justify-center"
                title="Copy Room Code"
              >
                {copiedCode ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Share Direct Link Button */}
            <div className="mt-3 flex justify-center">
              <button
                id="btn-copy-monitor-link"
                type="button"
                onClick={copyMonitorLink}
                className="px-3.5 py-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-xs font-semibold text-neutral-200 transition flex items-center gap-2 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Copy Direct Monitor Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Status Indicators */}
        <div className="p-4 space-y-2.5 bg-neutral-900 text-sm">
          <div className="flex items-center justify-between py-1 border-b border-neutral-800/60">
            <span className="text-neutral-400 font-medium">Camera Feed:</span>
            <span
              id="status-camera-controller"
              className="font-semibold flex items-center gap-1.5"
            >
              {isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-emerald-400">Broadcasting</span>
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
                  <Eye className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Monitor Watching Live</span>
                </>
              ) : isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                  <span className="text-amber-300">Waiting for code entry...</span>
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
              {isStarting ? 'Opening Camera...' : 'Start Camera'}
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
                Switch Camera (Front / Rear)
              </button>

              <button
                id="btn-stop-camera"
                type="button"
                onClick={stopCamera}
                className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
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
