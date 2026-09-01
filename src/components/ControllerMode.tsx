import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UserProfile } from '../types';
import { rtcConfiguration, generateRoomCode } from '../lib/webrtc';
import { signaling } from '../lib/signaling';
import { createVirtualCCTVStream, CameraPreset } from '../lib/virtualCamera';
import {
  Camera,
  Video,
  VideoOff,
  SwitchCamera,
  Copy,
  Check,
  AlertCircle,
  Share2,
  Shield,
  Wifi,
  Eye,
  ExternalLink,
  Sparkles,
  Layers,
  Flashlight,
  Activity,
  CheckCircle2,
} from 'lucide-react';

interface ControllerModeProps {
  user: UserProfile;
}

export const ControllerMode: React.FC<ControllerModeProps> = ({ user }) => {
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isVirtualMode, setIsVirtualMode] = useState(false);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('LIVING ROOM [CAM-01]');
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isMonitorConnected, setIsMonitorConnected] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPermissionDenied, setIsPermissionDenied] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [fpsCount, setFpsCount] = useState(30);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const virtualCleanupRef = useRef<(() => void) | null>(null);
  const virtualGetFrameRef = useRef<(() => string | null) | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const currentRoomCodeRef = useRef<string | null>(null);
  const isBroadcastingRef = useRef<boolean>(false);
  const frameTimeoutRef = useRef<any>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);
  const isRoomCreatedRef = useRef<boolean>(false);

  // Helper to stop camera and cleanup WebRTC
  const stopCamera = useCallback(async () => {
    isBroadcastingRef.current = false;
    isRoomCreatedRef.current = false;

    if (frameTimeoutRef.current) {
      clearTimeout(frameTimeoutRef.current);
      frameTimeoutRef.current = null;
    }

    if (virtualCleanupRef.current) {
      virtualCleanupRef.current();
      virtualCleanupRef.current = null;
      virtualGetFrameRef.current = null;
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
    setIsVirtualMode(false);
    setIsMonitorConnected(false);
    setTorchOn(false);
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
      throw new Error('Camera API (getUserMedia) is not supported in this browser. Please open in Chrome, Edge, or Safari.');
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

  // Helper to capture a compressed frame for continuous fast streaming
  const captureFrame = useCallback(() => {
    // 1. If virtual camera is running, get frame directly from its canvas
    if (virtualGetFrameRef.current) {
      const vFrame = virtualGetFrameRef.current();
      if (vFrame) return vFrame;
    }

    // 2. Otherwise capture from video element
    if (!videoRef.current) return null;
    try {
      const video = videoRef.current;
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 480;
      if (w === 0 || h === 0) return null;

      if (!offscreenCanvasRef.current) {
        offscreenCanvasRef.current = document.createElement('canvas');
      }
      const canvas = offscreenCanvasRef.current;
      canvas.width = 440;
      canvas.height = Math.round((h / w) * 440) || 330;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.50);
    } catch {
      return null;
    }
  }, []);

  // Frame streaming loop: single in-flight request at all times
  const startFrameStreamingLoop = useCallback(() => {
    isBroadcastingRef.current = true;
    const run = async () => {
      if (!isBroadcastingRef.current || !currentRoomCodeRef.current) return;
      const frame = captureFrame();
      if (frame && currentRoomCodeRef.current) {
        await signaling.sendFrame(currentRoomCodeRef.current, frame);
      }
      if (isBroadcastingRef.current) {
        frameTimeoutRef.current = setTimeout(run, 130);
      }
    };
    run();
  }, [captureFrame]);

  // Core stream initialization shared between real camera and virtual CCTV stream
  const initializeBroadcasting = async (stream: MediaStream, isVirtual: boolean, locationLabel: string) => {
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

    // Generate a 6-digit room code
    const newRoomCode = generateRoomCode();
    setRoomCode(newRoomCode);
    currentRoomCodeRef.current = newRoomCode;
    isRoomCreatedRef.current = false;

    // Create WebRTC Peer Connection
    const pc = new RTCPeerConnection(rtcConfiguration);
    peerConnectionRef.current = pc;

    // Add local video track to WebRTC
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    const pendingControllerCandidates: RTCIceCandidateInit[] = [];

    // Handle ICE Candidates from Controller
    pc.onicecandidate = async (event) => {
      if (event.candidate && currentRoomCodeRef.current) {
        const candidateJson = event.candidate.toJSON();
        if (isRoomCreatedRef.current) {
          try {
            await signaling.sendCandidate(currentRoomCodeRef.current, 'controller', candidateJson);
          } catch (err) {
            console.warn('Error sending controller candidate:', err);
          }
        } else {
          pendingControllerCandidates.push(candidateJson);
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

    // Create WebRTC Offer
    const offer = await pc.createOffer({
      offerToReceiveAudio: false,
      offerToReceiveVideo: false,
    });
    await pc.setLocalDescription(offer);

    const initialFrame = captureFrame();

    // Store room and offer in Backend Server
    await signaling.createRoom(
      newRoomCode,
      user.uid,
      user.fullName || (isVirtual ? 'Virtual CCTV Camera' : 'Home Camera'),
      {
        type: offer.type,
        sdp: offer.sdp,
      },
      initialFrame,
      locationLabel
    );

    isRoomCreatedRef.current = true;

    // Flush any candidates gathered during offer creation
    for (const cand of pendingControllerCandidates) {
      try {
        await signaling.sendCandidate(newRoomCode, 'controller', cand);
      } catch (err) {
        console.warn('Error flushing candidate:', err);
      }
    }

    // Listen for Monitor's WebRTC Answer & Candidates via SSE
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

    // Start lightweight continuous frame sync
    startFrameStreamingLoop();

    setIsVirtualMode(isVirtual);
    setIsCameraActive(true);
  };

  const startCamera = async () => {
    setErrorMessage(null);
    setIsPermissionDenied(false);
    setIsStarting(true);
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];

    try {
      const stream = await getCameraMediaStream(facingMode);
      await initializeBroadcasting(stream, false, cameraPreset);
    } catch (err: any) {
      console.error('Failed to start camera:', err);
      const isDenied =
        err.name === 'NotAllowedError' ||
        err.name === 'PermissionDeniedError' ||
        err.message?.toLowerCase().includes('permission denied');

      setIsPermissionDenied(isDenied);

      if (isDenied) {
        setErrorMessage('Camera access was denied by your browser or iframe permissions.');
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        setErrorMessage('No physical camera was found on this device.');
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        setErrorMessage('The camera is in use by another application or tab.');
      } else {
        setErrorMessage(err.message || 'Could not access device camera.');
      }
      await stopCamera();
    } finally {
      setIsStarting(false);
    }
  };

  // 1-Click Simulated CCTV Camera (instant broadcast without hardware camera restrictions)
  const startVirtualCCTV = async (preset: CameraPreset = cameraPreset) => {
    setErrorMessage(null);
    setIsStarting(true);
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];

    try {
      const { stream, getFrame, stop } = createVirtualCCTVStream(preset);
      virtualCleanupRef.current = stop;
      virtualGetFrameRef.current = getFrame;
      await initializeBroadcasting(stream, true, preset);
    } catch (err: any) {
      console.error('Failed to start virtual stream:', err);
      setErrorMessage(err.message || 'Failed to initialize virtual CCTV stream.');
      await stopCamera();
    } finally {
      setIsStarting(false);
    }
  };

  const handleSwitchCamera = async () => {
    if (!isCameraActive || isVirtualMode) return;
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

  const openMonitorInNewTab = () => {
    if (roomCode) {
      const directUrl = `${window.location.origin}${window.location.pathname}?room=${roomCode}&role=monitor`;
      window.open(directUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const openControllerInNewTab = () => {
    const directUrl = `${window.location.origin}${window.location.pathname}?role=controller`;
    window.open(directUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div id="controller-mode" className="w-full max-w-2xl mx-auto p-3 sm:p-5">
      {/* Tactical Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-inner">
            <Camera className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-neutral-100 tracking-tight">
                Surveillance Camera Station
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-800/60 text-[10px] font-mono font-bold text-emerald-300">
                TRANSMITTER
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              "Use this phone as your home security camera."
            </p>
          </div>
        </div>

        {/* Status Pill */}
        {isCameraActive && (
          <div className="flex items-center gap-2 text-xs font-mono bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-xl self-start sm:self-auto">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-emerald-300 font-bold">BROADCASTING</span>
          </div>
        )}
      </div>

      {/* Permission Denied / Error Banner */}
      {errorMessage && (
        <div id="camera-error-banner" className="mb-4 p-4 rounded-2xl bg-red-950/50 border border-red-800/70 text-red-200 text-sm shadow-xl space-y-3">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-red-100">{errorMessage}</p>
              {isPermissionDenied && (
                <p className="text-xs text-red-300 mt-1 leading-relaxed">
                  To enable your physical camera: Click the <strong>camera / padlock icon</strong> in your browser's address bar and set Camera to <strong>"Allow"</strong>, or open in a new tab.
                </p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              id="btn-retry-camera"
              type="button"
              onClick={startCamera}
              className="px-3 py-1.5 rounded-xl bg-red-800 hover:bg-red-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow"
            >
              <Camera className="w-3.5 h-3.5" />
              Retry Permission
            </button>

            <button
              id="btn-open-new-tab"
              type="button"
              onClick={openControllerInNewTab}
              className="px-3 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold border border-neutral-700 transition flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              Open in New Tab
            </button>

            <button
              id="btn-start-virtual-cctv"
              type="button"
              onClick={() => startVirtualCCTV()}
              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-neutral-950 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow ml-auto"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Use Virtual CCTV Feed
            </button>
          </div>
        </div>
      )}

      {/* Main Tactical Camera Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Camera Preview Area */}
        <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden group select-none">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-cover ${
              !isCameraActive ? 'hidden' : ''
            } ${!isVirtualMode && facingMode === 'user' ? 'scale-x-[-1]' : ''}`}
          />

          {!isCameraActive && (
            <div className="text-center p-6 flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3 shadow-inner">
                <Camera className="w-8 h-8" />
              </div>
              <p className="text-base font-bold text-neutral-200">
                Camera is currently inactive
              </p>
              <p className="text-xs text-neutral-400 mt-1 max-w-xs leading-relaxed">
                Press "Start Physical Camera" to stream your webcam, or "Simulate CCTV Stream" for instant zero-permission testing.
              </p>
            </div>
          )}

          {/* On-video Tactical Overlays when active */}
          {isCameraActive && (
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-white/15 text-[11px] font-mono font-bold text-white shadow-lg">
                  <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span>REC</span>
                </div>

                <div className="px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-emerald-500/30 text-[11px] font-mono font-bold text-emerald-400 shadow-lg">
                  {cameraPreset}
                </div>
              </div>

              {/* Bottom HUD */}
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-300 bg-black/75 backdrop-blur-md border border-white/15 px-2.5 py-1 rounded-md">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">LIVE STREAM</span>
                  <span>•</span>
                  <span>{isVirtualMode ? 'SIMULATED HD' : facingMode === 'environment' ? 'REAR LENS' : 'FRONT LENS'}</span>
                </div>
                <div>{new Date().toISOString().split('T')[0]} {new Date().toLocaleTimeString()}</div>
              </div>
            </div>
          )}
        </div>

        {/* Location Preset Selector (When Idle) */}
        {!isCameraActive && (
          <div className="p-4 bg-neutral-950 border-t border-b border-neutral-800">
            <div className="text-xs font-bold uppercase tracking-wider text-neutral-400 mb-2 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-emerald-400" />
              Camera Location Preset
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  'LIVING ROOM [CAM-01]',
                  'FRONT DOOR [CAM-02]',
                  'GARAGE & DRIVEWAY [CAM-03]',
                  'NURSERY [CAM-04]',
                ] as CameraPreset[]
              ).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setCameraPreset(preset)}
                  className={`px-3 py-2 rounded-xl text-xs font-mono font-medium text-left border transition cursor-pointer ${
                    cameraPreset === preset
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-200 shadow-sm'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {preset}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Room Code & Sharing Card (When Active) */}
        {isCameraActive && roomCode && (
          <div className="p-4 bg-neutral-950 border-t border-b border-neutral-800">
            <div className="text-center mb-3">
              <div className="flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-400 mb-1">
                <Shield className="w-4 h-4" />
                6-Digit Monitor Access PIN
              </div>
              <p className="text-xs text-neutral-400">
                Input this code on the Monitor device to watch this camera live.
              </p>
            </div>

            {/* Code and Copy buttons */}
            <div className="flex items-center justify-center gap-2 max-w-sm mx-auto">
              <div
                id="room-code-display"
                className="font-mono text-3xl sm:text-4xl font-extrabold tracking-widest text-emerald-400 bg-neutral-900 px-6 py-2.5 rounded-2xl border-2 border-emerald-500/40 shadow-inner flex-1 text-center"
              >
                {roomCode}
              </div>
              <button
                id="btn-copy-room-code"
                type="button"
                onClick={copyRoomCode}
                className="p-3.5 rounded-2xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 transition cursor-pointer flex items-center justify-center border border-neutral-700 shadow"
                title="Copy Room Code"
              >
                {copiedCode ? (
                  <Check className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Copy className="w-5 h-5" />
                )}
              </button>
            </div>

            {/* Quick Testing & Link Sharing Deck */}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                id="btn-copy-monitor-link"
                type="button"
                onClick={copyMonitorLink}
                className="px-3 py-1.5 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-semibold text-neutral-300 transition flex items-center gap-1.5 cursor-pointer"
              >
                {copiedLink ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-300">Link Copied!</span>
                  </>
                ) : (
                  <>
                    <Share2 className="w-3.5 h-3.5 text-blue-400" />
                    <span>Copy Monitor Link</span>
                  </>
                )}
              </button>

              <button
                id="btn-open-monitor-tab"
                type="button"
                onClick={openMonitorInNewTab}
                className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/40 text-xs font-bold text-blue-300 transition flex items-center gap-1.5 cursor-pointer"
                title="Open Monitor in New Tab with pre-filled code"
              >
                <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
                <span>Open Monitor Tab (Quick Test)</span>
              </button>
            </div>
          </div>
        )}

        {/* Status Indicators */}
        <div className="p-4 space-y-2 bg-neutral-900 text-sm">
          <div className="flex items-center justify-between py-1 border-b border-neutral-800/60">
            <span className="text-neutral-400 font-medium">Broadcast Status:</span>
            <span
              id="status-camera-controller"
              className="font-semibold flex items-center gap-1.5"
            >
              {isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400">
                    {isVirtualMode ? 'Streaming Simulated Feed' : 'Streaming Hardware Camera'}
                  </span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600" />
                  <span className="text-neutral-400">Inactive</span>
                </>
              )}
            </span>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-neutral-400 font-medium">Remote Monitor:</span>
            <span
              id="status-monitor-controller"
              className="font-semibold flex items-center gap-1.5"
            >
              {isMonitorConnected ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400 font-semibold">Monitor Connected (Watching Live)</span>
                </>
              ) : isCameraActive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-300">Awaiting PIN #{roomCode}...</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600" />
                  <span className="text-neutral-400">Standby</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Primary Action Controls */}
        <div className="p-4 pt-0 space-y-2.5">
          {!isCameraActive ? (
            <div className="space-y-2">
              <button
                id="btn-start-camera"
                type="button"
                onClick={startCamera}
                disabled={isStarting}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/40 disabled:opacity-50 cursor-pointer"
              >
                <Video className="w-5 h-5" />
                {isStarting ? 'Initializing Camera...' : 'Start Physical Camera'}
              </button>

              <button
                id="btn-start-virtual"
                type="button"
                onClick={() => startVirtualCCTV()}
                disabled={isStarting}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-neutral-300 font-semibold text-xs sm:text-sm border border-neutral-700 transition flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4 text-emerald-400" />
                <span>Simulate CCTV Stream (No Camera Required)</span>
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {!isVirtualMode && (
                <button
                  id="btn-switch-camera"
                  type="button"
                  onClick={handleSwitchCamera}
                  className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-medium text-sm border border-neutral-700 transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <SwitchCamera className="w-4 h-4" />
                  Switch Camera (Front / Rear)
                </button>
              )}

              <button
                id="btn-stop-camera"
                type="button"
                onClick={stopCamera}
                className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-base transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
              >
                <VideoOff className="w-5 h-5" />
                Stop Broadcasting
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
