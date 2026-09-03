import React, { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import {
  Camera,
  SwitchCamera,
  StopCircle,
  Copy,
  Check,
  Share2,
  AlertCircle,
  ArrowLeft,
  Shield,
  Video,
  ExternalLink,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { UserProfile } from '../types';
import { rtcConfiguration, generateRoomCode } from '../lib/webrtc';
import { firestoreSignaling, CameraSession } from '../lib/firestoreSignaling';
import { createVirtualCCTVStream } from '../lib/virtualCamera';

interface CameraModeProps {
  user: UserProfile;
  onBack: () => void;
}

export const CameraMode: React.FC<CameraModeProps> = ({ user, onBack }) => {
  const [isCameraStarted, setIsCameraStarted] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'ready' | 'waiting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [isSimulatedCamera, setIsSimulatedCamera] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const virtualStreamCleanupRef = useRef<(() => void) | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const candidateUnsubRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef(false);

  useEffect(() => {
    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }
  }, []);

  // Screen Wake Lock to keep phone display awake
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Wake Lock might fail if battery is low or not supported, safe to ignore
    }
  };

  const releaseWakeLock = () => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch {
        // ignore
      }
      wakeLockRef.current = null;
    }
  };

  // Immediate callback ref ensuring the video element attaches the stream upon mount
  const setVideoNode = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && streamRef.current) {
      if (node.srcObject !== streamRef.current) {
        node.srcObject = streamRef.current;
      }
      node.play().catch((err) => {
        console.warn('Direct video autoplay was prevented, playing muted:', err);
        node.muted = true;
        node.play().catch(() => {});
      });
    }
  }, []);

  // Secondary effect to sync stream if changed while video element is already mounted
  useEffect(() => {
    if (videoRef.current && streamRef.current) {
      if (videoRef.current.srcObject !== streamRef.current) {
        videoRef.current.srcObject = streamRef.current;
      }
      videoRef.current.play().catch(() => {});
    }
  }, [isCameraStarted, isSimulatedCamera]);

  // Stop camera tracks and cleanup connections
  const stopCameraStream = useCallback(async () => {
    if (sessionUnsubRef.current) {
      sessionUnsubRef.current();
      sessionUnsubRef.current = null;
    }
    if (candidateUnsubRef.current) {
      candidateUnsubRef.current();
      candidateUnsubRef.current = null;
    }

    if (sessionId) {
      await firestoreSignaling.closeSession(sessionId);
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }

    if (virtualStreamCleanupRef.current) {
      virtualStreamCleanupRef.current();
      virtualStreamCleanupRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    releaseWakeLock();
    setIsCameraStarted(false);
    setIsSimulatedCamera(false);
    setCameraStatus('idle');
    setQrCodeDataUrl(null);
    setPairingCode(null);
    setSessionId(null);
    isRemoteDescriptionSetRef.current = false;
    pendingCandidatesRef.current = [];
  }, [sessionId]);

  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, [stopCameraStream]);

  // Multi-tier media stream acquisition: tries hardware camera first, falls back to CCTV simulator if hardware is blocked/unavailable
  const acquireMediaStream = async (
    targetFacing: 'environment' | 'user',
    forceSimulated: boolean = false
  ): Promise<{ stream: MediaStream; isSimulated: boolean }> => {
    if (forceSimulated) {
      const virtual = createVirtualCCTVStream('SURVEILLANCE CAM-01 [TEST]');
      virtualStreamCleanupRef.current = virtual.stop;
      return { stream: virtual.stream, isSimulated: true };
    }

    const hasMediaDevices = !!(navigator?.mediaDevices?.getUserMedia);
    const legacyGetUserMedia =
      (navigator as any)?.getUserMedia ||
      (navigator as any)?.webkitGetUserMedia ||
      (navigator as any)?.mozGetUserMedia ||
      (navigator as any)?.msGetUserMedia;

    const requestHardware = async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
      if (hasMediaDevices) {
        return await navigator.mediaDevices.getUserMedia(constraints);
      }
      if (legacyGetUserMedia) {
        return new Promise((resolve, reject) => {
          legacyGetUserMedia.call(navigator, constraints, resolve, reject);
        });
      }
      throw new Error('Camera API is not supported in this browser.');
    };

    // Tier 1: Selected facing mode (environment/user) with ideal resolution and audio
    try {
      const s = await requestHardware({
        video: {
          facingMode: { ideal: targetFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      return { stream: s, isSimulated: false };
    } catch (e1) {
      console.warn('Camera Tier 1 (720p + audio) failed, trying video only:', e1);
    }

    // Tier 2: Selected facing mode with video only (ideal)
    try {
      const s = await requestHardware({
        video: {
          facingMode: { ideal: targetFacing },
        },
        audio: false,
      });
      return { stream: s, isSimulated: false };
    } catch (e2) {
      console.warn('Camera Tier 2 (ideal facing) failed, trying direct string facing:', e2);
    }

    // Tier 3: Direct facing mode string
    try {
      const s = await requestHardware({
        video: { facingMode: targetFacing },
        audio: false,
      });
      return { stream: s, isSimulated: false };
    } catch (e3) {
      console.warn('Camera Tier 3 (string facing) failed, trying generic video: true:', e3);
    }

    // Tier 4: Any available video device (webcam, USB camera, built-in)
    try {
      const s = await requestHardware({
        video: true,
        audio: false,
      });
      return { stream: s, isSimulated: false };
    } catch (e4: any) {
      console.warn('All hardware camera tiers failed:', e4);
      // If hardware camera is denied or not found, fall back seamlessly to simulated CCTV feed
      // This ensures the application never crashes or stays black
      const virtual = createVirtualCCTVStream('SURVEILLANCE CAM-01 [LIVE]');
      virtualStreamCleanupRef.current = virtual.stop;
      return { stream: virtual.stream, isSimulated: true };
    }
  };

  // Start Camera and WebRTC session
  const startCamera = async (
    selectedFacingMode: 'environment' | 'user' = facingMode,
    forceSimulated: boolean = false
  ) => {
    setErrorMessage(null);
    setCameraStatus('ready');

    try {
      // 1. Acquire MediaStream
      const { stream, isSimulated } = await acquireMediaStream(selectedFacingMode, forceSimulated);
      streamRef.current = stream;
      setIsSimulatedCamera(isSimulated);

      if (isSimulated && !forceSimulated) {
        setErrorMessage('Device camera was blocked or unavailable in preview. Switched to high-resolution CCTV test feed.');
      }

      // Attach immediately to videoRef if already in DOM
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      await requestWakeLock();
      setIsCameraStarted(true);

      // 2. Generate unique pairing session code
      const newCode = generateRoomCode();
      const newSessionId = `sess_${newCode}_${Date.now()}`;
      setPairingCode(newCode);
      setSessionId(newSessionId);

      // 3. Initialize WebRTC Peer Connection
      const pc = new RTCPeerConnection(rtcConfiguration);
      peerConnectionRef.current = pc;
      isRemoteDescriptionSetRef.current = false;
      pendingCandidatesRef.current = [];

      // Add camera tracks to Peer Connection
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });

      // Handle ICE Candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          const candidateJson = event.candidate.toJSON();
          try {
            await firestoreSignaling.addIceCandidate(newSessionId, 'camera', candidateJson);
          } catch (err) {
            console.warn('Error sending camera candidate:', err);
          }
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected') {
          setCameraStatus('connected');
        } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          setCameraStatus('waiting');
        }
      };

      // 4. Create SDP Offer
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false,
      });
      await pc.setLocalDescription(offer);

      // 5. Store session in Firestore
      await firestoreSignaling.createSession(
        newSessionId,
        newCode,
        user.uid,
        offer
      );

      setCameraStatus('waiting');

      // 6. Generate QR Code containing pairing link
      // Using direct URL allows scanning via both native phone camera & in-app scanner
      const directUrl = `${window.location.origin}?role=monitor&code=${newCode}`;
      const qrUrl = await QRCode.toDataURL(directUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#ffffff',
        },
      });
      setQrCodeDataUrl(qrUrl);

      // 7. Listen for Monitor's SDP Answer and status changes
      sessionUnsubRef.current = firestoreSignaling.subscribeToSession(
        newSessionId,
        async (sessionData: CameraSession) => {
          if (
            sessionData.answer &&
            !isRemoteDescriptionSetRef.current &&
            pc.signalingState !== 'stable'
          ) {
            try {
              const remoteDesc = new RTCSessionDescription(sessionData.answer);
              await pc.setRemoteDescription(remoteDesc);
              isRemoteDescriptionSetRef.current = true;
              setCameraStatus('connected');

              // Flush queued candidates
              while (pendingCandidatesRef.current.length > 0) {
                const cand = pendingCandidatesRef.current.shift();
                if (cand) {
                  await pc.addIceCandidate(new RTCIceCandidate(cand));
                }
              }
            } catch (err) {
              console.error('Error setting remote description from answer:', err);
            }
          }

          if (sessionData.status === 'connected') {
            setCameraStatus('connected');
          } else if (sessionData.status === 'disconnected') {
            setCameraStatus('waiting');
          }
        }
      );

      // 8. Listen for Monitor's ICE Candidates
      candidateUnsubRef.current = firestoreSignaling.subscribeToCandidates(
        newSessionId,
        'monitor',
        async (candidate) => {
          if (isRemoteDescriptionSetRef.current && pc.remoteDescription) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (err) {
              console.warn('Error adding monitor candidate:', err);
            }
          } else {
            pendingCandidatesRef.current.push(candidate);
          }
        }
      );
    } catch (err: any) {
      console.error('Camera startup error:', err);
      setErrorMessage(err.message || 'Failed to start camera.');
      setCameraStatus('error');
      await stopCameraStream();
    }
  };

  // Switch between Rear and Front cameras smoothly without breaking WebRTC session
  const handleSwitchCamera = async () => {
    if (isSimulatedCamera) {
      // If currently in simulated mode, attempt to switch to hardware
      await stopCameraStream();
      await startCamera('environment', false);
      return;
    }

    const nextFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacingMode);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: nextFacingMode } },
        audio: false,
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      if (newVideoTrack && peerConnectionRef.current) {
        const sender = peerConnectionRef.current.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(newVideoTrack);
        }
      }

      // Stop old video tracks
      if (streamRef.current) {
        streamRef.current.getVideoTracks().forEach((t) => t.stop());
      }

      streamRef.current = newStream;
      if (videoRef.current) {
        videoRef.current.srcObject = newStream;
        videoRef.current.play().catch(() => {});
      }
    } catch {
      // Fallback: full restart with facing mode
      await stopCameraStream();
      await startCamera(nextFacingMode, false);
    }
  };

  const copyBackupCode = () => {
    if (!pairingCode) return;
    navigator.clipboard.writeText(pairingCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyDirectLink = () => {
    if (!pairingCode) return;
    const url = `${window.location.origin}?role=monitor&code=${pairingCode}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const openInNewTab = () => {
    try {
      window.open(window.location.href, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Top navigation */}
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={() => {
            stopCameraStream();
            onBack();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>

        {/* Status indicator */}
        <div className="flex items-center gap-2">
          {cameraStatus === 'ready' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              🟢 Camera Ready
            </span>
          )}
          {cameraStatus === 'waiting' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-medium">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              🟡 Waiting for Monitor
            </span>
          )}
          {cameraStatus === 'connected' && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              🟢 Monitor Connected
            </span>
          )}
        </div>
      </div>

      {/* Error alert & Guidance */}
      {errorMessage && (
        <div className="p-4 mb-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          <div className="flex-1">
            <p className="font-semibold mb-0.5">Camera Notice</p>
            <p>{errorMessage}</p>
            {isInIframe && (
              <button
                type="button"
                onClick={openInNewTab}
                className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-semibold cursor-pointer"
              >
                <ExternalLink className="w-3 h-3" />
                <span>Open in Full Tab for Direct Hardware Camera</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Initial Start Camera View */}
      {!isCameraStarted && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 sm:p-8 text-center shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center mb-4">
            <Camera className="w-8 h-8" />
          </div>

          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight mb-2">
            Camera Mode
          </h2>
          <p className="text-neutral-300 text-sm max-w-md mx-auto mb-6">
            Place this phone where you want to monitor your room. The camera will stream live video directly to your watching phone.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 max-w-md mx-auto">
            <button
              type="button"
              onClick={() => startCamera()}
              className="w-full sm:flex-1 py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-neutral-950 font-bold text-base transition flex items-center justify-center gap-2.5 cursor-pointer shadow-lg shadow-emerald-500/10"
            >
              <Camera className="w-5 h-5" />
              <span>START CAMERA</span>
            </button>

            <button
              type="button"
              onClick={() => startCamera('environment', true)}
              className="w-full sm:w-auto py-3.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-[0.99] text-neutral-200 font-medium text-xs sm:text-sm border border-neutral-700 transition flex items-center justify-center gap-2 cursor-pointer"
              title="Quickly test pairing using a high-resolution virtual surveillance feed"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>Test with Virtual CCTV</span>
            </button>
          </div>

          <div className="flex items-center justify-center gap-4 text-xs text-neutral-500 mt-5 flex-wrap">
            <span>&bull; Prefers rear camera</span>
            <span>&bull; Screen wake-lock enabled</span>
            <span>&bull; End-to-end WebRTC</span>
          </div>

          {isInIframe && (
            <div className="mt-4 pt-4 border-t border-neutral-800/80">
              <button
                type="button"
                onClick={openInNewTab}
                className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Running in preview? Click here to open in full tab for direct hardware access</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Active Camera View & QR Pairing */}
      {isCameraStarted && (
        <div className="space-y-4">
          {/* Live Camera Preview Box */}
          <div className="relative aspect-video w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 shadow-xl">
            <video
              ref={setVideoNode}
              playsInline
              autoPlay
              muted
              className="w-full h-full object-cover"
            />

            {/* Live badge overlay */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-neutral-950/80 backdrop-blur px-2.5 py-1 rounded-lg border border-neutral-800 text-xs font-semibold text-white">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>{isSimulatedCamera ? 'LIVE CAM • SIMULATED CCTV' : 'LIVE CAM • HARDWARE'}</span>
            </div>

            {/* In-stream Controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-white border border-neutral-700/80 backdrop-blur transition cursor-pointer"
                title={isSimulatedCamera ? 'Switch to Hardware Camera' : 'Switch Camera (Front / Rear)'}
              >
                {isSimulatedCamera ? <RefreshCw className="w-4 h-4 text-emerald-400" /> : <SwitchCamera className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={stopCameraStream}
                className="px-3 py-2 rounded-xl bg-red-600/90 hover:bg-red-600 text-white border border-red-500 backdrop-blur text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                title="Stop Camera"
              >
                <StopCircle className="w-4 h-4" />
                <span>Stop Camera</span>
              </button>
            </div>
          </div>

          {/* QR Pairing Card */}
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 sm:p-6 text-center shadow-lg">
            <div className="mb-4">
              <h3 className="text-base sm:text-lg font-bold text-white">
                Scan this QR code from your Monitor phone
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                Open Watch Camera on your second phone (or camera app) and point at this screen.
              </p>
            </div>

            {/* Large QR Code Display */}
            {qrCodeDataUrl ? (
              <div className="inline-block p-3.5 bg-white rounded-2xl shadow-inner mb-4">
                <img
                  src={qrCodeDataUrl}
                  alt="Pairing QR Code"
                  className="w-56 h-56 sm:w-64 sm:h-64 object-contain mx-auto"
                />
              </div>
            ) : (
              <div className="w-56 h-56 mx-auto bg-neutral-950 rounded-2xl border border-neutral-800 flex items-center justify-center text-xs text-neutral-500 mb-4">
                Generating QR code...
              </div>
            )}

            {/* Backup 6-digit Code */}
            {pairingCode && (
              <div className="max-w-sm mx-auto">
                <div className="p-3 rounded-xl bg-neutral-950 border border-neutral-800 flex items-center justify-between">
                  <div className="text-left">
                    <span className="text-[11px] text-neutral-400 uppercase tracking-wider font-semibold block">
                      Backup Code
                    </span>
                    <span className="text-xl font-mono font-bold text-emerald-400 tracking-widest">
                      {pairingCode}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={copyBackupCode}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-medium transition cursor-pointer"
                  >
                    {copiedCode ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Direct Share Link button */}
                <button
                  type="button"
                  onClick={copyDirectLink}
                  className="w-full mt-2.5 py-2 px-3 rounded-xl bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-xs font-medium text-neutral-300 hover:text-white transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{copiedLink ? 'Monitor Link Copied!' : 'Copy Direct Monitor Link'}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
