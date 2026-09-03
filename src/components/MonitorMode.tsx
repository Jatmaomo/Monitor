import React, { useState, useEffect, useRef, useCallback } from 'react';
import jsQR from 'jsqr';
import {
  Eye,
  QrCode,
  KeyRound,
  Video,
  StopCircle,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Volume2,
  VolumeX,
  Maximize2,
} from 'lucide-react';
import { UserProfile } from '../types';
import { rtcConfiguration } from '../lib/webrtc';
import { firestoreSignaling, CameraSession } from '../lib/firestoreSignaling';

interface MonitorModeProps {
  user: UserProfile;
  onBack: () => void;
  initialCode?: string | null;
}

export const MonitorMode: React.FC<MonitorModeProps> = ({ user, onBack, initialCode }) => {
  const [connectionStatus, setConnectionStatus] = useState<
    'idle' | 'scanning' | 'connecting' | 'connected' | 'lost' | 'error'
  >('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState(initialCode || '');
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(true);
  const [isScanningQR, setIsScanningQR] = useState(false);

  // Video and WebRTC refs
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerVideoRef = useRef<HTMLVideoElement>(null);
  const qrScannerStreamRef = useRef<MediaStream | null>(null);
  const qrScanAnimFrameRef = useRef<number | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const candidateUnsubRef = useRef<(() => void) | null>(null);
  const isRemoteDescriptionSetRef = useRef(false);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // Disconnect & cleanup
  const disconnectSession = useCallback(async () => {
    stopQRScanner();

    if (sessionUnsubRef.current) {
      sessionUnsubRef.current();
      sessionUnsubRef.current = null;
    }
    if (candidateUnsubRef.current) {
      candidateUnsubRef.current();
      candidateUnsubRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    if (activeSessionId) {
      await firestoreSignaling.closeSession(activeSessionId);
    }

    setActiveSessionId(null);
    setConnectionStatus('idle');
    isRemoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
  }, [activeSessionId]);

  useEffect(() => {
    return () => {
      disconnectSession();
    };
  }, [disconnectSession]);

  // Connect to session using session ID or 6-digit code
  const connectToSession = async (targetSession: CameraSession) => {
    setErrorMessage(null);
    setConnectionStatus('connecting');
    stopQRScanner();

    try {
      if (!targetSession.offer) {
        throw new Error('Camera session has no valid video offer.');
      }

      setActiveSessionId(targetSession.sessionId);

      // 1. Create WebRTC Peer Connection
      const pc = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = pc;
      isRemoteDescriptionSetRef.current = false;
      pendingCandidatesRef.current = [];

      // Receive remote tracks (video & audio)
      pc.ontrack = (event) => {
        if (remoteVideoRef.current && event.streams[0]) {
          remoteVideoRef.current.srcObject = event.streams[0];
          remoteVideoRef.current.play().catch(() => {});
          setConnectionStatus('connected');
        }
      };

      // Handle ICE Candidates from Monitor
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          const candidateJson = event.candidate.toJSON();
          try {
            await firestoreSignaling.addIceCandidate(targetSession.sessionId, 'monitor', candidateJson);
          } catch (err) {
            console.warn('Error sending monitor candidate:', err);
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setConnectionStatus('connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setConnectionStatus('lost');
        }
      };

      // 2. Set Remote Description from Camera's SDP Offer
      const remoteOffer = new RTCSessionDescription(targetSession.offer);
      await pc.setRemoteDescription(remoteOffer);
      isRemoteDescriptionSetRef.current = true;

      // Flush any queued candidates
      while (pendingCandidatesRef.current.length > 0) {
        const cand = pendingCandidatesRef.current.shift();
        if (cand) {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        }
      }

      // 3. Create SDP Answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // 4. Update Firestore with Answer
      await firestoreSignaling.joinSession(targetSession.sessionId, user.uid, answer);

      // 5. Listen for Camera ICE Candidates
      candidateUnsubRef.current = firestoreSignaling.subscribeToCandidates(
        targetSession.sessionId,
        'camera',
        async (candidate) => {
          if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('Error adding camera candidate:', err);
            }
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        }
      );

      // 6. Listen for Camera status changes
      sessionUnsubRef.current = firestoreSignaling.subscribeToSession(
        targetSession.sessionId,
        (updatedSession) => {
          if (updatedSession.status === 'disconnected') {
            setConnectionStatus('lost');
          }
        }
      );
    } catch (err: any) {
      console.error('Connection error:', err);
      setErrorMessage(err.message || 'Unable to connect to camera.');
      setConnectionStatus('error');
    }
  };

  // Connect via 6-digit backup code
  const handleManualCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = manualCode.trim();
    if (!cleanCode) return;

    setErrorMessage(null);
    setConnectionStatus('connecting');

    try {
      const session = await firestoreSignaling.findSessionByCode(cleanCode);
      if (!session) {
        throw new Error('Camera session not found or code expired. Please check the code.');
      }
      await connectToSession(session);
    } catch (err: any) {
      console.error('Manual code lookup error:', err);
      setErrorMessage(err.message || 'Invalid backup code.');
      setConnectionStatus('error');
    }
  };

  // Auto-connect if initialCode was passed in URL query
  useEffect(() => {
    if (initialCode && connectionStatus === 'idle') {
      firestoreSignaling.findSessionByCode(initialCode).then((session) => {
        if (session) {
          connectToSession(session);
        }
      });
    }
  }, [initialCode]);

  // QR Code Scanner implementation
  const startQRScanner = async () => {
    setErrorMessage(null);
    setIsScanningQR(true);
    setConnectionStatus('scanning');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });

      qrScannerStreamRef.current = stream;

      if (qrScannerVideoRef.current) {
        qrScannerVideoRef.current.srcObject = stream;
        await qrScannerVideoRef.current.play().catch(() => {});
        scanQRCodeFrame();
      }
    } catch (err: any) {
      console.error('QR scanner camera error:', err);
      setErrorMessage('Could not access camera for QR scanning. You can enter the backup code manually.');
      setIsScanningQR(false);
      setConnectionStatus('idle');
    }
  };

  const stopQRScanner = () => {
    if (qrScanAnimFrameRef.current) {
      cancelAnimationFrame(qrScanAnimFrameRef.current);
      qrScanAnimFrameRef.current = null;
    }
    if (qrScannerStreamRef.current) {
      qrScannerStreamRef.current.getTracks().forEach((track) => track.stop());
      qrScannerStreamRef.current = null;
    }
    setIsScanningQR(false);
  };

  const scanQRCodeFrame = () => {
    const video = qrScannerVideoRef.current;
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      qrScanAnimFrameRef.current = requestAnimationFrame(scanQRCodeFrame);
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');

      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: 'dontInvert',
        });

        if (code && code.data) {
          try {
            const parsed = JSON.parse(code.data);
            if (parsed && (parsed.sessionId || parsed.code)) {
              stopQRScanner();
              if (parsed.sessionId) {
                firestoreSignaling.getSession(parsed.sessionId).then((session) => {
                  if (session) {
                    connectToSession(session);
                  } else if (parsed.code) {
                    firestoreSignaling.findSessionByCode(parsed.code).then((s) => {
                      if (s) connectToSession(s);
                      else setErrorMessage('Camera session expired or not found.');
                    });
                  }
                });
              } else if (parsed.code) {
                firestoreSignaling.findSessionByCode(parsed.code).then((session) => {
                  if (session) connectToSession(session);
                  else setErrorMessage('Camera session expired.');
                });
              }
              return;
            }
          } catch {
            // Check if raw data is 6-digit code
            const raw = code.data.trim();
            if (/^\d{6}$/.test(raw)) {
              stopQRScanner();
              firestoreSignaling.findSessionByCode(raw).then((session) => {
                if (session) connectToSession(session);
                else setErrorMessage('Camera code not found.');
              });
              return;
            }
          }
        }
      }
    } catch (e) {
      console.warn('QR decode error:', e);
    }

    qrScanAnimFrameRef.current = requestAnimationFrame(scanQRCodeFrame);
  };

  const toggleFullscreen = () => {
    if (!remoteVideoRef.current) return;
    if (!document.fullscreenElement) {
      remoteVideoRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Top navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => {
            disconnectSession();
            onBack();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {/* Connection status indicator */}
        <div className="flex items-center gap-2">
          {connectionStatus === 'connecting' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              🟡 Connecting...
            </span>
          )}
          {connectionStatus === 'connected' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              🟢 Live
            </span>
          )}
          {connectionStatus === 'lost' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-red-400" />
              🔴 Connection Lost
            </span>
          )}
        </div>
      </div>

      {/* Error alert */}
      {errorMessage && (
        <div className="p-4 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-0.5">Monitor Notice</p>
            <p>{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Connected Live View */}
      {connectionStatus === 'connected' && (
        <div className="space-y-4">
          <div className="relative aspect-video w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 shadow-2xl">
            <video
              ref={remoteVideoRef}
              playsInline
              autoPlay
              muted={isAudioMuted}
              className="w-full h-full object-contain bg-black"
            />

            {/* Live Camera Connected overlay */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-neutral-950/80 backdrop-blur px-3 py-1.5 rounded-xl border border-neutral-800 text-xs font-bold text-white">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>🟢 LIVE &bull; Camera Connected</span>
            </div>

            {/* In-stream Controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAudioMuted(!isAudioMuted)}
                className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-white border border-neutral-700/80 backdrop-blur transition cursor-pointer"
                title={isAudioMuted ? 'Unmute Audio' : 'Mute Audio'}
              >
                {isAudioMuted ? <VolumeX className="w-4 h-4 text-neutral-400" /> : <Volume2 className="w-4 h-4 text-emerald-400" />}
              </button>

              <button
                type="button"
                onClick={toggleFullscreen}
                className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-white border border-neutral-700/80 backdrop-blur transition cursor-pointer"
                title="Fullscreen"
              >
                <Maximize2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={disconnectSession}
                className="px-3.5 py-2 rounded-xl bg-red-600/90 hover:bg-red-600 text-white border border-red-500 backdrop-blur text-xs font-bold flex items-center gap-1.5 transition cursor-pointer shadow-lg shadow-red-600/20"
                title="Disconnect"
              >
                <StopCircle className="w-4 h-4" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>

          <div className="text-center">
            <button
              type="button"
              onClick={disconnectSession}
              className="py-2.5 px-6 rounded-xl bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-semibold text-neutral-300 hover:text-white transition cursor-pointer"
            >
              Disconnect from Camera
            </button>
          </div>
        </div>
      )}

      {/* Connection Lost Screen */}
      {connectionStatus === 'lost' && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 text-center shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 mx-auto flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-white mb-1">Connection Lost</h3>
          <p className="text-xs text-neutral-300 mb-6 max-w-sm mx-auto">
            The camera stream was disconnected or the camera phone stopped broadcasting.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (manualCode) {
                  firestoreSignaling.findSessionByCode(manualCode).then((s) => {
                    if (s) connectToSession(s);
                  });
                } else {
                  startQRScanner();
                }
              }}
              className="w-full sm:w-auto py-3 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-neutral-950 font-bold text-sm transition flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Reconnect</span>
            </button>
            <button
              type="button"
              onClick={disconnectSession}
              className="w-full sm:w-auto py-3 px-6 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white font-medium text-sm transition cursor-pointer"
            >
              Back to Monitor Menu
            </button>
          </div>
        </div>
      )}

      {/* Main Connection Choices (Idle or Scanning or Connecting) */}
      {connectionStatus !== 'connected' && connectionStatus !== 'lost' && (
        <div className="space-y-4">
          {/* Card 1: SCAN QR CODE (Primary Connection Method) */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 text-center shadow-xl">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 mx-auto flex items-center justify-center mb-3">
              <QrCode className="w-7 h-7" />
            </div>

            <h2 className="text-xl font-bold text-white tracking-tight mb-1">
              Monitor Mode
            </h2>
            <p className="text-xs text-neutral-300 max-w-xs mx-auto mb-5">
              Scan the QR code shown on the camera phone.
            </p>

            {/* QR Scanner Viewport */}
            {isScanningQR ? (
              <div className="mb-4">
                <div className="relative aspect-square max-w-[280px] mx-auto rounded-2xl overflow-hidden border-2 border-cyan-500 shadow-2xl bg-black">
                  <video
                    ref={qrScannerVideoRef}
                    playsInline
                    autoPlay
                    muted
                    className="w-full h-full object-cover"
                  />
                  {/* Scanner reticle overlay */}
                  <div className="absolute inset-4 border border-cyan-400/50 rounded-xl pointer-events-none flex items-center justify-center">
                    <div className="w-full h-0.5 bg-cyan-400 animate-pulse shadow-lg shadow-cyan-400" />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={stopQRScanner}
                  className="mt-3 px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-xs font-semibold text-neutral-300 transition cursor-pointer"
                >
                  Cancel Scanner
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={startQRScanner}
                disabled={connectionStatus === 'connecting'}
                className="w-full sm:w-auto min-w-[220px] py-3.5 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-600 active:scale-[0.99] disabled:opacity-50 text-neutral-950 font-bold text-sm transition flex items-center justify-center gap-2 mx-auto cursor-pointer shadow-lg shadow-cyan-500/10"
              >
                <QrCode className="w-4 h-4" />
                <span>SCAN QR CODE</span>
              </button>
            )}
          </div>

          {/* Card 2: ENTER CODE MANUALLY (Backup Connection Method) */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 shadow-lg">
            <div className="flex items-center gap-2.5 mb-3">
              <div className="p-2 rounded-xl bg-neutral-800 text-neutral-300">
                <KeyRound className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Enter Code Manually</h3>
                <p className="text-xs text-neutral-400">If your QR scanner does not work</p>
              </div>
            </div>

            <form onSubmit={handleManualCodeSubmit} className="flex gap-2">
              <input
                type="text"
                maxLength={6}
                placeholder="6-digit code (e.g. 482913)"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.replace(/\D/g, ''))}
                className="flex-1 px-4 py-2.5 rounded-xl bg-neutral-950 border border-neutral-800 text-neutral-100 placeholder-neutral-500 font-mono tracking-widest text-center text-base focus:outline-none focus:border-cyan-500 transition"
              />
              <button
                type="submit"
                disabled={manualCode.length !== 6 || connectionStatus === 'connecting'}
                className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-white text-xs font-bold transition cursor-pointer"
              >
                {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
