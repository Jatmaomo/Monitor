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
} from 'lucide-react';
import { UserProfile } from '../types';
import { rtcConfiguration, generateRoomCode } from '../lib/webrtc';
import { firestoreSignaling, CameraSession } from '../lib/firestoreSignaling';

interface CameraModeProps {
  user: UserProfile;
  onBack: () => void;
}

export const CameraMode: React.FC<CameraModeProps> = ({ user, onBack }) => {
  const [isCameraStarted, setIsCameraStarted] = useState(false);
  const [cameraStatus, setCameraStatus] = useState<'idle' | 'ready' | 'waiting' | 'connected' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const sessionUnsubRef = useRef<(() => void) | null>(null);
  const candidateUnsubRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<any>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const isRemoteDescriptionSetRef = useRef(false);

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

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    releaseWakeLock();
    setIsCameraStarted(false);
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

  // Start Camera and WebRTC session
  const startCamera = async (selectedFacingMode: 'environment' | 'user' = facingMode) => {
    setErrorMessage(null);
    setCameraStatus('ready');

    try {
      // 1. Get Camera MediaStream
      let mediaStream: MediaStream;
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: selectedFacingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: true,
        });
      } catch (videoErr) {
        // If rear camera or audio fails, retry with basic video
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false,
          });
        } catch (permErr: any) {
          if (permErr.name === 'NotAllowedError' || permErr.name === 'PermissionDeniedError') {
            throw new Error('Camera permission was denied. Please allow camera access in your browser settings.');
          } else if (permErr.name === 'NotFoundError' || permErr.name === 'DevicesNotFoundError') {
            throw new Error('No camera found on this device.');
          } else {
            throw new Error('Could not access camera. Please check your camera settings.');
          }
        }
      }

      streamRef.current = mediaStream;
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        await videoRef.current.play().catch(() => {});
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
      mediaStream.getTracks().forEach((track) => {
        pc.addTrack(track, mediaStream);
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

      // 6. Generate QR Code containing pairing information
      const qrPayload = JSON.stringify({
        type: 'cctv_pair',
        sessionId: newSessionId,
        code: newCode,
      });

      const qrUrl = await QRCode.toDataURL(qrPayload, {
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

  // Switch between Rear and Front cameras
  const handleSwitchCamera = async () => {
    const nextFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacingMode);
    if (isCameraStarted) {
      await stopCameraStream();
      await startCamera(nextFacingMode);
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

      {/* Error alert */}
      {errorMessage && (
        <div className="p-4 mb-4 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-0.5">Camera Notice</p>
            <p>{errorMessage}</p>
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
            Place this phone where you want to monitor your room.
          </p>

          <button
            type="button"
            onClick={() => startCamera()}
            className="w-full sm:w-auto min-w-[220px] py-3.5 px-6 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:scale-[0.99] text-neutral-950 font-bold text-base transition flex items-center justify-center gap-2.5 mx-auto cursor-pointer shadow-lg shadow-emerald-500/10"
          >
            <Camera className="w-5 h-5" />
            <span>START CAMERA</span>
          </button>

          <p className="text-xs text-neutral-500 mt-4">
            Prefer rear camera &bull; Screen stay-awake enabled automatically
          </p>
        </div>
      )}

      {/* Active Camera View & QR Pairing */}
      {isCameraStarted && (
        <div className="space-y-4">
          {/* Live Camera Preview Box */}
          <div className="relative aspect-video w-full bg-black rounded-2xl overflow-hidden border border-neutral-800 shadow-xl">
            <video
              ref={videoRef}
              playsInline
              autoPlay
              muted
              className="w-full h-full object-cover"
            />

            {/* Live badge overlay */}
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-neutral-950/80 backdrop-blur px-2.5 py-1 rounded-lg border border-neutral-800 text-xs font-semibold text-white">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>LIVE CAM</span>
            </div>

            {/* In-stream Controls */}
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleSwitchCamera}
                className="p-2 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 text-white border border-neutral-700/80 backdrop-blur transition cursor-pointer"
                title="Switch Camera (Front / Rear)"
              >
                <SwitchCamera className="w-4 h-4" />
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
                Open Watch Camera on your second phone and point its camera here.
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
