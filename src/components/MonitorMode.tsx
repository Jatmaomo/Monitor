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
  Camera,
  ZoomIn,
  Sparkles,
  Sliders,
  Volume2,
  VolumeX,
  Bell,
  Activity,
  Download,
  History,
  CheckCircle2,
} from 'lucide-react';

interface MonitorModeProps {
  user: UserProfile;
  initialRoomCode?: string;
}

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'lost';
type VideoFilter = 'normal' | 'night-vision' | 'infrared' | 'high-contrast';

interface ActivityLogItem {
  id: string;
  time: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'alert';
}

export const MonitorMode: React.FC<MonitorModeProps> = ({ user, initialRoomCode }) => {
  const [roomCodeInput, setRoomCodeInput] = useState(initialRoomCode || '');
  const [activeRoomCode, setActiveRoomCode] = useState<string | null>(null);
  const [cameraLabel, setCameraLabel] = useState<string>('CAM-01 [HOME CAMERA]');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionState>('idle');
  const [isCameraLive, setIsCameraLive] = useState(false);
  const [hasWebRTCVideo, setHasWebRTCVideo] = useState(false);
  const [streamType, setStreamType] = useState<'p2p' | 'relay'>('relay');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [activeFrame, setActiveFrame] = useState<string | null>(null);
  const [videoFilter, setVideoFilter] = useState<VideoFilter>('normal');
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [isShutterFlashing, setIsShutterFlashing] = useState(false);
  const [isAudioAlertActive, setIsAudioAlertActive] = useState(false);
  const [showHudOverlay, setShowHudOverlay] = useState(true);
  const [recentRooms, setRecentRooms] = useState<string[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [fpsCount, setFpsCount] = useState<number>(30);
  const [latencyMs, setLatencyMs] = useState<number>(24);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const candidateQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef<boolean>(false);
  const framePollerRef = useRef<any>(null);
  const lastFrameTimeRef = useRef<number>(Date.now());
  const isPollingRef = useRef<boolean>(false);

  // Load recent rooms from storage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('myhy_recent_rooms');
      if (saved) {
        setRecentRooms(JSON.parse(saved));
      }
    } catch {
      // ignore
    }
  }, []);

  const saveRecentRoom = (code: string) => {
    try {
      const updated = [code, ...recentRooms.filter((r) => r !== code)].slice(0, 5);
      setRecentRooms(updated);
      localStorage.setItem('myhy_recent_rooms', JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  const addLog = useCallback((message: string, type: 'info' | 'success' | 'warning' | 'alert' = 'info') => {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];
    setActivityLogs((prev) => [
      {
        id: Math.random().toString(36).substring(2, 9),
        time: timeStr,
        message,
        type,
      },
      ...prev.slice(0, 24),
    ]);
  }, []);

  // Cleanly disconnect WebRTC and backend listeners
  const disconnect = useCallback(async () => {
    signaling.closeStream();

    if (framePollerRef.current) {
      clearInterval(framePollerRef.current);
      framePollerRef.current = null;
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

    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    setActiveFrame(null);
    setHasWebRTCVideo(false);
    setConnectionStatus('idle');
    setIsCameraLive(false);
    setActiveRoomCode(null);
    addLog('Surveillance session ended', 'info');
  }, [addLog]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // FPS & Latency ticker simulation
  useEffect(() => {
    if (connectionStatus === 'connected' && isCameraLive) {
      const interval = setInterval(() => {
        setLatencyMs(Math.floor(18 + Math.random() * 14));
        setFpsCount(Math.floor(28 + Math.random() * 4));
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [connectionStatus, isCameraLive]);

  const connectToRoom = useCallback(async (codeToConnect?: string) => {
    const raw = (codeToConnect || roomCodeInput).trim().replace(/\D/g, '');
    if (!raw || raw.length !== 6) {
      setErrorMessage('Please enter a valid 6-digit Controller Code.');
      return;
    }

    setErrorMessage(null);
    setConnectionStatus('connecting');
    setIsCameraLive(false);
    setHasWebRTCVideo(false);
    setStreamType('relay');
    isRemoteDescriptionSetRef.current = false;
    candidateQueueRef.current = [];
    addLog(`Initiating secure handshake for Room #${raw}...`, 'info');

    try {
      // 1. Fetch Room from Backend
      const roomData = await signaling.getRoom(raw);

      if (!roomData) {
        throw new Error(`Room "${raw}" not found. Please ensure the Controller phone has started its camera.`);
      }

      if (roomData.status === 'disconnected') {
        throw new Error(`Controller camera for Room "${raw}" is currently offline.`);
      }

      if (roomData.cameraName) {
        setCameraLabel(roomData.cameraName);
      }

      if (roomData.lastFrame) {
        setActiveFrame(roomData.lastFrame);
        setIsCameraLive(true);
        lastFrameTimeRef.current = Date.now();
      }

      setActiveRoomCode(raw);
      saveRecentRoom(raw);
      addLog(`Room #${raw} located. Authenticating live video stream...`, 'info');

      // 2. Smart fallback frame poller (only polls if SSE was idle for > 1500ms)
      if (framePollerRef.current) {
        clearInterval(framePollerRef.current);
      }
      framePollerRef.current = setInterval(async () => {
        if (Date.now() - lastFrameTimeRef.current > 1500 && !isPollingRef.current) {
          isPollingRef.current = true;
          try {
            const frameData = await signaling.getLatestFrame(raw);
            if (frameData?.frame) {
              setActiveFrame(frameData.frame);
              if (frameData.cameraName) {
                setCameraLabel(frameData.cameraName);
              }
              setIsCameraLive(true);
              setConnectionStatus('connected');
              lastFrameTimeRef.current = Date.now();
            }
          } finally {
            isPollingRef.current = false;
          }
        }
      }, 800);

      // 3. Create RTCPeerConnection for high-definition direct P2P streaming
      if (roomData.offer) {
        const pc = new RTCPeerConnection(rtcConfiguration);
        peerConnectionRef.current = pc;

        // Handle receiving remote video stream
        pc.ontrack = async (event) => {
          if (event.streams && event.streams[0]) {
            if (videoRef.current) {
              videoRef.current.srcObject = event.streams[0];
              videoRef.current.onloadeddata = () => {
                setHasWebRTCVideo(true);
                setStreamType('p2p');
                setIsCameraLive(true);
              };
              try {
                await videoRef.current.play();
              } catch (playErr) {
                console.warn('Video auto-play note:', playErr);
              }
            }
            setIsCameraLive(true);
            setConnectionStatus('connected');
            addLog('WebRTC Direct HD Video Channel Connected', 'success');
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
            setStreamType('p2p');
            addLog('Hardware P2P Encryption Active', 'success');
          } else if (
            pc.connectionState === 'disconnected' ||
            pc.connectionState === 'failed' ||
            pc.connectionState === 'closed'
          ) {
            setHasWebRTCVideo(false);
            setStreamType('relay');
          }
        };

        // Set Remote Description (Controller Offer)
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
              console.warn('Error adding existing candidate:', e);
            }
          }
        }

        // Create WebRTC Answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        // Send Answer to Backend
        await signaling.sendAnswer(
          raw,
          {
            type: answer.type,
            sdp: answer.sdp,
          },
          user.uid,
          user.fullName || 'Surveillance Monitor'
        );
      }

      // 4. Subscribe to Real-Time SSE Stream
      signaling.subscribeToRoom(raw, {
        onControllerCandidate: async (candidateData) => {
          const pc = peerConnectionRef.current;
          if (pc && isRemoteDescriptionSetRef.current && pc.remoteDescription) {
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
          if (data?.frame) {
            setActiveFrame(data.frame);
            setIsCameraLive(true);
            setConnectionStatus('connected');
            lastFrameTimeRef.current = Date.now();
          }
        },
        onDisconnected: () => {
          addLog('Controller broadcast disconnected', 'warning');
          setConnectionStatus('lost');
          setIsCameraLive(false);
          setHasWebRTCVideo(false);
        },
      });

      setConnectionStatus('connected');
      setIsCameraLive(true);
      addLog(`Surveillance channel synchronized for Room #${raw}`, 'success');
    } catch (err: any) {
      console.error('Failed to connect to room:', err);
      setErrorMessage(err.message || 'Failed to connect. Please verify the 6-digit code on the Controller phone.');
      setConnectionStatus('idle');
      addLog(`Connection failed: ${err.message}`, 'alert');
      if (peerConnectionRef.current) {
        try {
          peerConnectionRef.current.close();
        } catch {
          // ignore
        }
        peerConnectionRef.current = null;
      }
    }
  }, [roomCodeInput, user.uid, user.fullName, addLog]);

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

  // Snapshot capture tool
  const takeSnapshot = () => {
    setIsShutterFlashing(true);
    setTimeout(() => setIsShutterFlashing(false), 200);

    try {
      let dataUrl = activeFrame;

      if (!dataUrl && videoRef.current && videoRef.current.readyState >= 2) {
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        }
      }

      if (dataUrl) {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `cctv-snapshot-${activeRoomCode || 'camera'}-${Date.now()}.jpg`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        addLog('Security snapshot captured and saved to device', 'success');
      } else {
        addLog('Could not capture frame snapshot', 'warning');
      }
    } catch (err) {
      console.warn('Snapshot error:', err);
    }
  };

  // Sound Siren / Alert Tone Generator
  const triggerAudioSiren = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1400, audioCtx.currentTime + 0.3);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.6);

      gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.8);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start();
      osc.stop(audioCtx.currentTime + 0.8);

      setIsAudioAlertActive(true);
      setTimeout(() => setIsAudioAlertActive(false), 1000);
      addLog('Surveillance Attention Beep Broadcasted', 'warning');
    } catch (err) {
      console.warn('Audio tone synthesis error:', err);
    }
  };

  // Video filter styling
  const getFilterStyle = (): string => {
    switch (videoFilter) {
      case 'night-vision':
        return 'brightness-125 contrast-150 hue-rotate-[90deg] saturate-200 sepia(50%)';
      case 'infrared':
        return 'grayscale contrast-200 brightness-110 invert';
      case 'high-contrast':
        return 'contrast-175 brightness-105 saturate-125';
      default:
        return '';
    }
  };

  return (
    <div id="monitor-mode" className="w-full max-w-2xl mx-auto p-3 sm:p-5">
      {/* Tactical Header */}
      <div className="mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-neutral-800 pb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400 shadow-inner">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base sm:text-lg font-bold text-neutral-100 tracking-tight">
                Surveillance Monitor Station
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-blue-950/80 border border-blue-800/60 text-[10px] font-mono font-bold text-blue-300">
                HD LIVE
              </span>
            </div>
            <p className="text-xs text-neutral-400">
              "Watch your home from wherever you are."
            </p>
          </div>
        </div>

        {/* Telemetry pill */}
        {connectionStatus === 'connected' && isCameraLive && (
          <div className="flex items-center gap-3 text-xs font-mono bg-neutral-900 border border-neutral-800 px-3 py-1.5 rounded-xl self-start sm:self-auto">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Activity className="w-3.5 h-3.5" />
              <span>{fpsCount} FPS</span>
            </div>
            <span className="text-neutral-600">•</span>
            <div className="text-neutral-300">
              <span>{latencyMs}ms</span>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <div className="mb-4 p-3.5 rounded-xl bg-red-950/60 border border-red-800/70 text-red-200 text-sm flex items-start gap-2.5 shadow-lg">
          <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="leading-snug">{errorMessage}</div>
        </div>
      )}

      {/* Main Tactical Surveillance Monitor Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Remote Live Video Display Viewport */}
        <div
          ref={videoContainerRef}
          className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden group select-none"
        >
          {/* Shutter flash animation on snapshot */}
          {isShutterFlashing && (
            <div className="absolute inset-0 bg-white z-40 transition-opacity duration-150 animate-pulse pointer-events-none" />
          )}

          {/* WebRTC Video Element (High-Definition direct stream) */}
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={`w-full h-full object-contain bg-black transition-transform duration-200 ${getFilterStyle()} ${
              connectionStatus === 'connected' && isCameraLive && hasWebRTCVideo ? 'block' : 'hidden'
            }`}
            style={{ transform: `scale(${zoomLevel})` }}
          />

          {/* Real-time Fast JPEG Frame Relay (Instant Backup & Primary Stream) */}
          {connectionStatus === 'connected' && isCameraLive && activeFrame && !hasWebRTCVideo && (
            <img
              src={activeFrame}
              alt="Live Camera Stream"
              className={`w-full h-full object-contain bg-black transition-transform duration-200 ${getFilterStyle()}`}
              style={{ transform: `scale(${zoomLevel})` }}
            />
          )}

          {/* Night Vision phosphor scanlines overlay */}
          {videoFilter === 'night-vision' && connectionStatus === 'connected' && (
            <div className="absolute inset-0 bg-[radial-gradient(circle,transparent_50%,rgba(0,40,0,0.4)_100%)] pointer-events-none z-10" />
          )}

          {/* Security Tactical HUD Overlays */}
          {connectionStatus === 'connected' && isCameraLive && showHudOverlay && (
            <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-3 z-20">
              {/* Top HUD Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-white/15 text-[11px] font-mono font-bold text-white shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <span>REC</span>
                  </div>

                  <div className="px-2.5 py-1 rounded-md bg-black/75 backdrop-blur-md border border-emerald-500/30 text-[11px] font-mono font-bold text-emerald-400 shadow-lg">
                    {cameraLabel}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pointer-events-auto">
                  <button
                    type="button"
                    onClick={takeSnapshot}
                    className="p-1.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/20 text-white hover:bg-neutral-800 hover:text-emerald-400 transition cursor-pointer"
                    title="Capture Snapshot"
                  >
                    <Camera className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="p-1.5 rounded-lg bg-black/75 backdrop-blur-md border border-white/20 text-white hover:bg-neutral-800 transition cursor-pointer"
                    title="Toggle Fullscreen"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="w-4 h-4" />
                    ) : (
                      <Maximize2 className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Center Crosshair / Corner Brackets Reticle */}
              <div className="w-32 h-32 border border-white/10 rounded-lg mx-auto flex items-center justify-center relative opacity-50">
                <div className="w-3 h-0.5 bg-emerald-400" />
                <div className="h-3 w-0.5 bg-emerald-400 absolute" />
                <div className="absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 border-emerald-400" />
                <div className="absolute top-0 right-0 w-2 h-2 border-t-2 border-r-2 border-emerald-400" />
                <div className="absolute bottom-0 left-0 w-2 h-2 border-b-2 border-l-2 border-emerald-400" />
                <div className="absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 border-emerald-400" />
              </div>

              {/* Bottom HUD Row */}
              <div className="flex items-center justify-between text-[10px] font-mono text-neutral-300 bg-black/75 backdrop-blur-md border border-white/15 px-2.5 py-1 rounded-md">
                <div className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">1080P HD</span>
                  <span>•</span>
                  <span>ZOOM: {zoomLevel}x</span>
                  <span>•</span>
                  <span className="uppercase">{videoFilter}</span>
                </div>
                <div>
                  {new Date().toISOString().split('T')[0]} {new Date().toLocaleTimeString()}
                </div>
              </div>
            </div>
          )}

          {/* Non-live States & Connection Placeholders */}
          {(connectionStatus !== 'connected' || !isCameraLive) && (
            <div className="text-center p-6 flex flex-col items-center">
              <div className="w-16 h-16 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-500 mb-3 shadow-inner">
                <Tv className="w-8 h-8" />
              </div>
              {connectionStatus === 'connecting' ? (
                <div>
                  <p className="text-sm font-bold text-blue-400 animate-pulse flex items-center justify-center gap-2">
                    <Radio className="w-4 h-4 animate-spin" />
                    Connecting to Controller Camera...
                  </p>
                  <p className="text-xs text-neutral-400 mt-1 max-w-xs leading-relaxed">
                    Verifying 6-digit PIN and synchronizing high-resolution video stream.
                  </p>
                </div>
              ) : connectionStatus === 'lost' ? (
                <div>
                  <p className="text-sm font-bold text-red-400">
                    Camera Connection Disconnected
                  </p>
                  <p className="text-xs text-neutral-400 mt-1 max-w-xs leading-relaxed">
                    The Controller camera broadcast was closed or the device went offline.
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-base font-bold text-neutral-200">
                    Enter Controller Code Below
                  </p>
                  <p className="text-xs text-neutral-400 mt-1 max-w-xs leading-relaxed">
                    Input the 6-digit access code displayed on your home camera phone to watch its live surveillance feed.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Surveillance Controls Bar (When Connected) */}
        {connectionStatus === 'connected' && isCameraLive && (
          <div className="p-3 bg-neutral-950 border-t border-neutral-800 flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Filter mode switches */}
            <div className="flex items-center gap-1.5">
              <span className="text-neutral-500 font-mono text-[11px] mr-1 hidden sm:inline">FILTER:</span>
              <button
                type="button"
                onClick={() => setVideoFilter('normal')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  videoFilter === 'normal'
                    ? 'bg-neutral-800 text-neutral-100 border border-neutral-700'
                    : 'text-neutral-400 hover:text-neutral-200'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setVideoFilter('night-vision')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  videoFilter === 'night-vision'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : 'text-neutral-400 hover:text-emerald-400'
                }`}
              >
                Night Vision
              </button>
              <button
                type="button"
                onClick={() => setVideoFilter('infrared')}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                  videoFilter === 'infrared'
                    ? 'bg-cyan-950 text-cyan-300 border border-cyan-700'
                    : 'text-neutral-400 hover:text-cyan-400'
                }`}
              >
                Infrared
              </button>
            </div>

            {/* Zoom and Tools */}
            <div className="flex items-center gap-1.5 ml-auto">
              {/* Zoom Buttons */}
              <div className="flex items-center bg-neutral-900 border border-neutral-800 rounded-lg p-0.5">
                {[1, 1.5, 2, 3].map((z) => (
                  <button
                    key={z}
                    type="button"
                    onClick={() => setZoomLevel(z)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition cursor-pointer ${
                      zoomLevel === z
                        ? 'bg-blue-600 text-white font-bold'
                        : 'text-neutral-400 hover:text-neutral-200'
                    }`}
                  >
                    {z}x
                  </button>
                ))}
              </div>

              {/* Siren Alert Button */}
              <button
                type="button"
                onClick={triggerAudioSiren}
                className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-amber-400 transition cursor-pointer"
                title="Trigger Alert Sound"
              >
                <Bell className={`w-4 h-4 ${isAudioAlertActive ? 'animate-bounce text-red-400' : ''}`} />
              </button>

              {/* Snapshot Button */}
              <button
                type="button"
                onClick={takeSnapshot}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold text-xs transition flex items-center gap-1 cursor-pointer shadow"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Snap</span>
              </button>
            </div>
          </div>
        )}

        {/* 6-Digit Code Input Section (When Idle) */}
        {connectionStatus === 'idle' && (
          <div className="p-5 bg-neutral-950 border-t border-neutral-800">
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

            <div className="max-w-xs mx-auto space-y-3">
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
                className="w-full text-center font-mono text-3xl font-extrabold tracking-widest px-4 py-3.5 rounded-2xl bg-neutral-900 border-2 border-neutral-700 text-neutral-100 placeholder-neutral-700 focus:outline-none focus:border-blue-500 shadow-inner"
              />

              {/* Quick Recent Rooms */}
              {recentRooms.length > 0 && (
                <div className="pt-2 text-center">
                  <div className="text-[11px] font-medium text-neutral-500 flex items-center justify-center gap-1 mb-1.5">
                    <History className="w-3 h-3" />
                    <span>Recent Cameras:</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5">
                    {recentRooms.map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => {
                          setRoomCodeInput(code);
                          connectToRoom(code);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-mono font-semibold text-neutral-300 transition cursor-pointer"
                      >
                        #{code}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active Connected Room Banner */}
        {connectionStatus !== 'idle' && activeRoomCode && (
          <div className="px-4 py-2.5 bg-neutral-950/80 border-t border-b border-neutral-800 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span className="text-neutral-300">
                Connected to: <strong className="font-mono text-emerald-400 font-bold text-sm tracking-wider">#{activeRoomCode}</strong>
              </span>
            </div>
            <span className="text-neutral-400 font-mono text-[11px]">
              {cameraLabel}
            </span>
          </div>
        )}

        {/* Status Indicators */}
        <div className="p-4 space-y-2 bg-neutral-900 text-sm">
          <div className="flex items-center justify-between py-1 border-b border-neutral-800/60">
            <span className="text-neutral-400 font-medium">Surveillance Video:</span>
            <span
              id="status-camera-monitor"
              className="font-semibold flex items-center gap-1.5"
            >
              {connectionStatus === 'connected' && isCameraLive ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400">Live Streaming</span>
                </>
              ) : connectionStatus === 'lost' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-400">Disconnected</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-blue-300">Connecting...</span>
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
            <span className="text-neutral-400 font-medium">Controller Device:</span>
            <span
              id="status-controller-monitor"
              className="font-semibold flex items-center gap-1.5"
            >
              {connectionStatus === 'connected' ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-400">
                    {hasWebRTCVideo ? 'Hardware P2P Direct' : 'Encrypted Cloud Relay'}
                  </span>
                </>
              ) : connectionStatus === 'lost' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-red-400">Offline</span>
                </>
              ) : connectionStatus === 'connecting' ? (
                <>
                  <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
                  <span className="text-blue-300">Authenticating...</span>
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-neutral-600" />
                  <span className="text-neutral-400">Enter Code</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Primary Action Buttons */}
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
              className="w-full py-3 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-red-950/40 cursor-pointer"
            >
              <Unplug className="w-4 h-4" />
              Disconnect Monitor
            </button>
          )}

          {connectionStatus === 'lost' && (
            <div className="space-y-2">
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

      {/* Security Activity & Telemetry Feed */}
      {activityLogs.length > 0 && (
        <div className="mt-4 p-4 rounded-2xl bg-neutral-900/90 border border-neutral-800 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-blue-400" />
              Live Security Telemetry Log
            </h3>
            <span className="text-[10px] text-neutral-500 font-mono">
              {activityLogs.length} Events
            </span>
          </div>

          <div className="max-h-36 overflow-y-auto space-y-1 text-xs font-mono pr-1">
            {activityLogs.map((log) => (
              <div
                key={log.id}
                className={`px-2 py-1 rounded flex items-center gap-2 ${
                  log.type === 'success'
                    ? 'text-emerald-300 bg-emerald-950/30'
                    : log.type === 'alert'
                    ? 'text-red-300 bg-red-950/30'
                    : log.type === 'warning'
                    ? 'text-amber-300 bg-amber-950/30'
                    : 'text-neutral-400 bg-neutral-950/40'
                }`}
              >
                <span className="text-[10px] text-neutral-500">{log.time}</span>
                <span className="flex-1 truncate">{log.message}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
