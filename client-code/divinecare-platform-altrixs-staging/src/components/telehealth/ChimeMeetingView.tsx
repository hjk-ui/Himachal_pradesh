'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Copy,
  FileText,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
  Volume2,
  WifiOff,
  X,
  ShieldCheck,
} from 'lucide-react';

import { InCallEhrDrawer } from './InCallEhrDrawer';
import { TelehealthScribePanel } from '@/components/scribe/TelehealthScribePanel';

export type ChimeMeetingViewProps = {
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
  meetingId?: string;
  demoMode?: boolean;
  title?: string;
  subtitle?: string;
  patientJoinUrl?: string | null;
  onLeave: () => void;
  role?: string;
  sessionId?: string;
  clientId?: string;
  clientName?: string;
  sessionType?: string;
  patientLocationState?: string | null;
  /** Appointment behind the call: the in-call chart offers "Change visit type" (null = stand-alone session) */
  appointmentId?: string | null;
};

/**
 * True only for a staff telehealth view (the dashboard's TelehealthRoleView values). Unknown,
 * empty, 'client' or 'patient' values get the patient view (no EHR drawer, invite link or phone-fallback controls).
 */
const STAFF_CALL_ROLES = new Set(['DOCTOR_PSYCHIATRIST', 'NURSE_PRACTITIONER', 'ADMIN_FRONT_DESK']);

export function isStaffCallRole(role: string | null | undefined): boolean {
  return STAFF_CALL_ROLES.has(String(role || '').trim().toUpperCase());
}

export function ChimeMeetingView({
  meeting,
  attendee,
  meetingId,
  demoMode,
  title = 'Telehealth video',
  subtitle,
  patientJoinUrl,
  onLeave,
  // Least privilege: callers must opt IN to a staff view. The public join page is a patient.
  role = 'client',
  sessionId,
  clientId,
  clientName,
  sessionType = 'Individual Therapy',
  patientLocationState,
  appointmentId,
}: ChimeMeetingViewProps) {
  const isStaffView = isStaffCallRole(role);
  // Visit type can change during the call (in-call chart); end-session coding uses the current one
  const [visitType, setVisitType] = useState(sessionType);
  // Persistent media elements — NEVER unmounted to preserve WebRTC streams & hardware locks
  const localRef = useRef<HTMLVideoElement | null>(null);
  const remoteRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const contentTileIdRef = useRef<number | null>(null);
  const localTileIdRef = useRef<number | null>(null);
  const remoteTileIdRef = useRef<number | null>(null);

  // Local media stream refs
  const localMediaStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // Audio Context analyser refs for reliable local volume monitoring
  const audioCtxRef = useRef<AudioContext | null>(null);
  const localAnalyserRef = useRef<AnalyserNode | null>(null);

  const [status, setStatus] = useState('Connecting…');
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const mutedRef = useRef(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isRemoteScreenSharing, setIsRemoteScreenSharing] = useState(false);
  const [localVolume, setLocalVolume] = useState(0);
  const [remoteVolume, setRemoteVolume] = useState(0);
  const [networkAlert, setNetworkAlert] = useState<string | null>(null);
  const [participantLeft, setParticipantLeft] = useState(false);
  const [phoneFallbackOpen, setPhoneFallbackOpen] = useState(false);
  const [endConfirmOpen, setEndConfirmOpen] = useState(false);
  const [remoteConnected, setRemoteConnected] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [ehrDrawerOpen, setEhrDrawerOpen] = useState(false);
  /** Chime live transcription running (AI Scribe): shown to everyone in the visit */
  const [transcribing, setTranscribing] = useState(false);
  const callStartTimeRef = useRef(Date.now());

  const displayName = clientName || title.replace(/^Virtual Visit · |^Video with |^Visit with /, '');

  useEffect(() => {
    const unlockAudio = () => {
      if (audioRef.current && audioRef.current.paused) {
        audioRef.current
          .play()
          .then(() => setAudioBlocked(false))
          .catch(() => {});
      }
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, []);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDemo = Boolean(demoMode || (meeting as any)?.demoMode || meetingId?.startsWith('demo-'));

  const copyPatientLink = async () => {
    if (!patientJoinUrl) return;
    try {
      await navigator.clipboard.writeText(patientJoinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard fallback */
    }
  };

  // ---------------------------------------------------------------------------
  // 1. INSTANT LOCAL CAMERA ACQUISITION (DOCTOR SEES FACE IMMEDIATELY ON MOUNT)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let active = true;

    async function acquireInstantCamera() {
      try {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
          const stream = await navigator.mediaDevices
            .getUserMedia({
              video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                frameRate: { ideal: 30 },
                facingMode: 'user',
              },
              audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
              },
            })
            .catch(async () => {
              return await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true,
              });
            })
            .catch(async () => {
              return await navigator.mediaDevices.getUserMedia({
                audio: true,
              });
            });

          if (!active) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }

          localMediaStreamRef.current = stream;
          if (localRef.current) {
            localRef.current.srcObject = stream;
            localRef.current.play().catch(() => {});
          }
          setCameraOff(stream.getVideoTracks().length === 0);
          setStatus('Ready');

          // Audio Analyser for Real-Time Microphone Equalizer Meter
          try {
            const AudioCtx =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            if (AudioCtx && stream.getAudioTracks().length > 0) {
              const ctx = new AudioCtx();
              const source = ctx.createMediaStreamSource(stream);
              const analyser = ctx.createAnalyser();
              analyser.fftSize = 128;
              analyser.smoothingTimeConstant = 0.5;
              source.connect(analyser);
              audioCtxRef.current = ctx;
              localAnalyserRef.current = analyser;

              const dataArray = new Uint8Array(analyser.frequencyBinCount);
              const sampleLocalAudio = () => {
                if (!active || !ctx || ctx.state === 'closed') return;
                if (mutedRef.current) {
                  setLocalVolume(0);
                } else {
                  analyser.getByteFrequencyData(dataArray);
                  let sum = 0;
                  for (let i = 0; i < dataArray.length; i++) {
                    sum += dataArray[i];
                  }
                  const avg = sum / dataArray.length;
                  setLocalVolume(Math.min(100, Math.round((avg / 128) * 100)));
                }
                requestAnimationFrame(sampleLocalAudio);
              };
              requestAnimationFrame(sampleLocalAudio);
            }
          } catch (audioCtxErr) {
            console.warn('[audio-analyser] note:', audioCtxErr);
          }
        }
      } catch (mediaErr) {
        console.warn('[camera-acquire] note:', mediaErr);
      }
    }

    void acquireInstantCamera();

    return () => {
      active = false;
      if (localMediaStreamRef.current) {
        localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
        localMediaStreamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 3. ENTERPRISE SECURE WEBRTC MEDIA ENGINE
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (isDemo) return;

    let cancelled = false;

    async function joinSessionLive() {
      try {
        setStatus('Connecting securely…');
        const {
          ConsoleLogger,
          DefaultDeviceController,
          DefaultMeetingSession,
          LogLevel,
          MeetingSessionConfiguration,
        } = await import('amazon-chime-sdk-js');

        if (cancelled) return;

        const logger = new ConsoleLogger('MDBehavioralHealthTelehealth', LogLevel.WARN);
        const deviceController = new DefaultDeviceController(logger);

        const configuration = new MeetingSessionConfiguration(
          { Meeting: meeting },
          { Attendee: attendee }
        );

        configuration.enableSimulcastForUnifiedPlanChromiumBasedBrowsers = true;

        const meetingSession = new DefaultMeetingSession(
          configuration,
          logger,
          deviceController
        );
        sessionRef.current = meetingSession;

        const av = meetingSession.audioVideo;
        // Transparency (Maryland all-party consent): every participant sees when the visit is transcribed
        av.transcriptionController?.subscribeToTranscriptEvent((ev: unknown) => {
          const t = (ev as { type?: string })?.type;
          if (t === 'started' || t === 'resumed') setTranscribing(true);
          else if (t === 'stopped' || t === 'interrupted' || t === 'failed') setTranscribing(false);
        });

        // Observers
        av.addObserver({
          audioVideoDidStart: () => {
            if (cancelled) return;
            setStatus('Connected');
            try {
              av.startLocalVideoTile();
            } catch (startTileErr) {
              console.warn('startLocalVideoTile on start:', startTileErr);
            }
          },
          audioVideoDidStop: () => {
            if (!cancelled) setStatus('Disconnected');
          },
          videoTileDidUpdate: (tileState) => {
            if (tileState.tileId == null) return;

            if (tileState.isContent) {
              contentTileIdRef.current = tileState.tileId;
              if (screenRef.current) {
                av.bindVideoElement(tileState.tileId, screenRef.current);
              }
              if (tileState.localTile) {
                setIsScreenSharing(true);
              } else {
                setIsRemoteScreenSharing(true);
              }
            } else if (tileState.localTile) {
              localTileIdRef.current = tileState.tileId;
              if (localRef.current) {
                av.bindVideoElement(tileState.tileId, localRef.current);
              }
            } else {
              // Remote attendee video tile
              remoteTileIdRef.current = tileState.tileId;
              if (remoteRef.current) {
                av.bindVideoElement(tileState.tileId, remoteRef.current);
              }
              if (!cancelled) {
                setStatus('In call');
                setRemoteConnected(true);
                setParticipantLeft(false);
              }
            }
          },
          videoTileWasRemoved: (tileId) => {
            av.unbindVideoElement(tileId);
            if (tileId === contentTileIdRef.current) {
              setIsScreenSharing(false);
              setIsRemoteScreenSharing(false);
              contentTileIdRef.current = null;
            }
          },
          connectionDidBecomePoor: () => {
            setNetworkAlert('Network connection unstable. Optimizing video to protect clear audio.');
            setTimeout(() => setNetworkAlert(null), 6000);
          },
          connectionDidSuggestStopVideo: () => {
            setNetworkAlert('Low bandwidth detected. Prioritizing voice quality.');
            setTimeout(() => setNetworkAlert(null), 6000);
          },
        });

        // Local volume indicator fallback
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const localAttendeeId = (attendee as any)?.AttendeeId as string;
        if (localAttendeeId && typeof av.realtimeSubscribeToVolumeIndicator === 'function') {
          av.realtimeSubscribeToVolumeIndicator(localAttendeeId, (_id, volume) => {
            if (volume != null && !mutedRef.current) {
              setLocalVolume(Math.min(100, Math.round(volume * 100)));
            }
          });
        }

        // Attendee presence and remote volume
        if (typeof av.realtimeSubscribeToAttendeeIdPresence === 'function') {
          av.realtimeSubscribeToAttendeeIdPresence((attendeeId, present) => {
            if (attendeeId !== localAttendeeId) {
              if (!present) {
                setParticipantLeft(true);
              } else {
                setParticipantLeft(false);
                setRemoteConnected(true);
                if (!cancelled) setStatus('In call');
                if (typeof av.realtimeSubscribeToVolumeIndicator === 'function') {
                  av.realtimeSubscribeToVolumeIndicator(attendeeId, (_id, vol) => {
                    if (vol != null) {
                      setRemoteVolume(Math.min(100, Math.round(vol * 100)));
                    }
                  });
                }
              }
            }
          });
        }

        // 1. Microphone (Audio Input)
        try {
          const audioInputs = await av.listAudioInputDevices();
          const selectedAudio =
            audioInputs.find((d) => d.deviceId && d.deviceId !== 'default')?.deviceId ||
            audioInputs[0]?.deviceId ||
            'default';
          await av.startAudioInput(selectedAudio);
          av.realtimeUnmuteLocalAudio();
        } catch (audioErr) {
          console.warn('Audio input note:', audioErr);
          try {
            await av.startAudioInput('default');
            av.realtimeUnmuteLocalAudio();
          } catch {
            /* ignore */
          }
        }

        // 2. Camera (Video Input)
        try {
          if (typeof av.chooseVideoInputQuality === 'function') {
            av.chooseVideoInputQuality(1280, 720, 30);
          }
          const videoInputs = await av.listVideoInputDevices();
          if (videoInputs.length > 0 && videoInputs[0]?.deviceId) {
            await av.startVideoInput(videoInputs[0].deviceId);
            av.startLocalVideoTile();
            setCameraOff(false);
          } else {
            setCameraOff(true);
          }
        } catch (videoErr) {
          console.warn('Video input note:', videoErr);
          setCameraOff(true);
        }

        // 3. Speaker (Audio Output)
        if (audioRef.current) {
          try {
            audioRef.current.volume = 1.0;
            audioRef.current.muted = false;
            await av.bindAudioElement(audioRef.current);
          } catch (bindErr) {
            console.warn('Audio element bind note:', bindErr);
          }
          try {
            const audioOutputs = await av.listAudioOutputDevices();
            if (audioOutputs.length > 0 && audioOutputs[0]?.deviceId) {
              await av.chooseAudioOutput(audioOutputs[0].deviceId);
            }
          } catch {
            /* ignore output set */
          }
        }

        // 4. Connect Meeting
        await av.start();
        try {
          av.realtimeUnmuteLocalAudio();
        } catch {
          /* ignore */
        }

        if (audioRef.current && audioRef.current.paused) {
          audioRef.current.play().catch(() => setAudioBlocked(true));
        }
      } catch (err) {
        console.error('Join live error:', err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not join video session');
          setStatus('Failed');
        }
      }
    }

    void joinSessionLive();

    return () => {
      cancelled = true;
      try {
        const session = sessionRef.current;
        if (session) {
          session.audioVideo.stopLocalVideoTile();
          session.audioVideo.stop();
          void session.deviceController?.destroy?.();
        }
      } catch {
        /* cleanup */
      }
      sessionRef.current = null;
    };
  }, [meeting, attendee, isDemo]);

  // Microphone toggle
  const toggleMute = () => {
    const nextMuted = !muted;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    if (nextMuted) setLocalVolume(0);

    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getAudioTracks().forEach((t) => {
        t.enabled = !nextMuted;
      });
    }

    const av = sessionRef.current?.audioVideo;
    if (av) {
      if (nextMuted) {
        av.realtimeMuteLocalAudio();
      } else {
        av.realtimeUnmuteLocalAudio();
      }
    }
  };

  // Camera toggle
  const toggleCamera = async () => {
    const nextCameraOff = !cameraOff;
    setCameraOff(nextCameraOff);

    if (localMediaStreamRef.current) {
      localMediaStreamRef.current.getVideoTracks().forEach((t) => {
        t.enabled = !nextCameraOff;
      });
    }

    const av = sessionRef.current?.audioVideo;
    if (av) {
      try {
        if (!nextCameraOff) {
          const devices = await av.listVideoInputDevices();
          if (devices.length > 0 && devices[0]?.deviceId) {
            await av.startVideoInput(devices[0].deviceId);
          }
          av.startLocalVideoTile();
        } else {
          av.stopLocalVideoTile();
          await av.stopVideoInput();
        }
      } catch (e) {
        console.warn('toggleCamera error:', e);
      }
    }
  };

  // Screen share toggle
  const toggleScreenShare = async () => {
    if (isDemo) {
      if (isScreenSharing) {
        if (screenStreamRef.current) {
          screenStreamRef.current.getTracks().forEach((t) => t.stop());
          screenStreamRef.current = null;
        }
        if (screenRef.current) {
          screenRef.current.srcObject = null;
        }
        setIsScreenSharing(false);
      } else {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
          try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
            screenStreamRef.current = stream;
            if (screenRef.current) {
              screenRef.current.srcObject = stream;
            }
            setIsScreenSharing(true);
            stream.getVideoTracks()[0].onended = () => {
              setIsScreenSharing(false);
              if (screenRef.current) screenRef.current.srcObject = null;
            };
          } catch (e) {
            console.warn('screen share note:', e);
          }
        }
      }
      return;
    }

    const av = sessionRef.current?.audioVideo;
    if (!av) return;
    try {
      if (isScreenSharing) {
        await av.stopContentShare();
        setIsScreenSharing(false);
      } else {
        if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia) {
          await av.startContentShareFromScreenCapture();
          setIsScreenSharing(true);
        } else {
          alert('Screen sharing is not supported on this browser.');
        }
      }
    } catch (err) {
      console.warn('Screen share error:', err);
      setIsScreenSharing(false);
    }
  };

  const handleEndVisit = () => {
    try {
      const session = sessionRef.current;
      if (session) {
        session.audioVideo.stopLocalVideoTile();
        session.audioVideo.stop();
      }
      if (localMediaStreamRef.current) {
        localMediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
      if (sessionId && isStaffView) {
        const elapsed = Math.max(1, Math.round((Date.now() - callStartTimeRef.current) / 60000));
        void fetch('/api/telehealth/in-call', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'end-session',
            sessionId,
            durationMinutes: elapsed,
            sessionType: visitType,
            role,
            // No posCode: the server takes POS from the patient's check-in location (src/lib/telehealth/pos.ts)
          }),
        }).catch(() => {});
      }
    } catch {
      /* ignore */
    }
    setEndConfirmOpen(false);
    onLeave();
  };

  const fallbackInitials = displayName
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950 text-white select-none">
      {/* 1. Header HUD — Clean Hospital-Grade Design (Zero AWS Jargon) */}
      <header className="flex flex-wrap items-center justify-between border-b border-white/10 px-6 py-3.5 gap-3 bg-slate-950/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-bold text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>LIVE</span>
          </div>

          <div>
            <h2 className="text-sm font-bold tracking-tight text-white flex items-center gap-2">
              <span>Virtual Visit with {displayName}</span>
            </h2>
            <p className="text-xs text-slate-400 font-medium">
              {subtitle || 'Private & Encrypted Video Consultation'}
            </p>
          </div>
        </div>

        {/* Security & Side Action Buttons (Discreetly on the side) */}
        <div className="flex items-center gap-2.5">
          <div className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-slate-800/80 border border-white/10 px-3 py-1 text-[11px] font-semibold text-slate-300">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            <span className="text-emerald-400">HIPAA Compliant</span>
            <span className="text-slate-500">·</span>
            <span>256-bit Encrypted</span>
          </div>

          {/* Discreet Side Backup Link (Does not block video) */}
          {isStaffView && patientJoinUrl ? (
            <button
              type="button"
              onClick={() => void copyPatientLink()}
              className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 border border-white/10 px-3.5 py-1.5 text-xs font-semibold transition active:scale-95 shadow"
              title="Copy backup patient invite link"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-400" />}
              <span>{copied ? 'Link Copied!' : 'Copy Link'}</span>
            </button>
          ) : null}

          {isStaffView ? (
          <button
            type="button"
            onClick={() => setPhoneFallbackOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 px-3 py-1.5 text-xs font-medium transition"
            title="Telephone Audio Fallback"
          >
            <PhoneCall className="h-3.5 w-3.5 text-amber-400" />
            <span className="hidden sm:inline">Phone Audio</span>
          </button>
          ) : null}
        </div>
      </header>

      {/* Network Alert Toast */}
      {networkAlert ? (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-2xl bg-amber-500/20 border border-amber-500/40 px-4 py-2 text-xs text-amber-200 backdrop-blur-md shadow-xl animate-fade-in">
          <WifiOff className="h-4 w-4 shrink-0 text-amber-400 animate-pulse" />
          <span>{networkAlert}</span>
        </div>
      ) : null}

      {/* Autoplay Audio Permission Banner */}
      {audioBlocked ? (
        <button
          type="button"
          onClick={() => {
            if (audioRef.current) {
              audioRef.current
                .play()
                .then(() => setAudioBlocked(false))
                .catch(() => {});
            }
          }}
          className="absolute top-16 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 rounded-full bg-emerald-600 hover:bg-emerald-500 border border-emerald-400 px-4 py-2 text-xs font-semibold text-white shadow-2xl animate-bounce"
        >
          <Volume2 className="h-4 w-4 text-white" />
          <span>Tap anywhere to enable sound</span>
        </button>
      ) : null}

      {/* 2. Main Video Theater Stage + Concurrent EHR Drawer */}
      <div className="relative flex-1 flex overflow-hidden bg-slate-950">
        <main className="relative flex-1 flex items-center justify-center p-4 overflow-hidden bg-slate-950">
          <div className="relative aspect-video w-full max-w-5xl h-full max-h-[82vh] overflow-hidden rounded-3xl bg-slate-900 border border-white/10 shadow-2xl flex items-center justify-center">

            {/* SCREEN SHARE TILE (Dominant when active) */}
            <video
              ref={screenRef}
              className={`absolute inset-0 h-full w-full object-contain bg-black z-20 ${
                isScreenSharing || isRemoteScreenSharing ? 'block' : 'hidden'
              }`}
              autoPlay
              playsInline
            />

            {/* REMOTE VIDEO TILE (Patient Feed) — Always mounted, visible when remoteConnected */}
            <video
              ref={remoteRef}
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
                remoteConnected && !isScreenSharing && !isRemoteScreenSharing
                  ? 'opacity-100 z-10'
                  : 'opacity-0 pointer-events-none -z-10'
              }`}
              autoPlay
              playsInline
            />

            {/* Remote Avatar Fallback if Patient's Camera is Off */}
            {remoteConnected && !isScreenSharing && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-900/60 pointer-events-none z-0">
                <div className="h-24 w-24 rounded-full bg-slate-800 flex items-center justify-center text-3xl font-bold text-white border-2 border-white/10 shadow-2xl">
                  {fallbackInitials}
                </div>
                <span className="text-xs font-semibold text-slate-300">{displayName}</span>
              </div>
            )}

            {/* LOCAL VIDEO TILE (Doctor Feed) — ALWAYS MOUNTED, NEVER DESTROYED! */}
            {/* If !remoteConnected: fills entire screen (Doctor's face big full-screen immediately) */}
            {/* If remoteConnected: sits gracefully as PIP in bottom-right corner */}
            <div
              className={`transition-all duration-300 overflow-hidden ${
                !remoteConnected
                  ? 'absolute inset-0 w-full h-full z-10'
                  : 'absolute bottom-4 right-4 h-36 w-52 rounded-2xl border-2 border-white/20 bg-slate-950 shadow-2xl z-30 group'
              }`}
            >
              <video
                ref={localRef}
                className={`h-full w-full object-cover -scale-x-100 ${cameraOff ? 'hidden' : 'block'}`}
                autoPlay
                playsInline
                muted
              />

              {/* Local Camera Off Fallback */}
              {cameraOff && (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 text-slate-400">
                  <div
                    className={`rounded-full bg-slate-800 flex items-center justify-center font-bold text-white border border-white/10 ${
                      !remoteConnected ? 'h-20 w-20 text-2xl' : 'h-10 w-10 text-sm'
                    }`}
                  >
                    DR
                  </div>
                  <span className={`font-medium text-slate-300 ${!remoteConnected ? 'text-sm' : 'text-[11px]'}`}>
                    Camera Off
                  </span>
                </div>
              )}

              {/* Overlaid Badge on Local Video: You & Dancing Volume Bars */}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-lg bg-black/75 px-2 py-0.5 backdrop-blur text-[11px] font-semibold text-white pointer-events-none z-10">
                <span>You {muted ? '(Muted)' : ''}</span>
                <div className="flex items-center gap-1">
                  <Volume2 className={`h-3 w-3 ${muted ? 'text-slate-500' : 'text-emerald-400'}`} />
                  <div className="flex items-end gap-0.5 h-3">
                    {[0.3, 0.6, 1.0, 0.7, 0.4].map((mult, idx) => {
                      const h = muted ? 2 : Math.max(2, Math.round(((localVolume * mult) / 100) * 12));
                      return (
                        <div
                          key={idx}
                          className={`w-1 rounded-full transition-all duration-75 ${
                            muted ? 'bg-slate-600' : 'bg-emerald-400'
                          }`}
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* OVERLAYS */}
            {/* A. When Calling / Ringing Patient (!remoteConnected) */}
            {!remoteConnected && !isScreenSharing && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2.5 rounded-full bg-slate-900/85 border border-emerald-500/30 px-4 py-2 text-xs font-semibold text-white backdrop-blur-md shadow-2xl">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                </span>
                <span>Calling {displayName}...</span>
                <span className="text-[11px] text-emerald-300 font-normal hidden sm:inline">· Ringing patient</span>
              </div>
            )}

            {/* B. When Connected: Center Top Status */}
            {remoteConnected && !isScreenSharing && !participantLeft && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 rounded-full bg-slate-900/85 border border-emerald-500/40 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 backdrop-blur-md shadow-lg">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Connected · Encrypted HD Video</span>
              </div>
            )}

            {/* C. When Connected: Remote Patient Name & Remote Dancing Volume Bars */}
            {remoteConnected && !isScreenSharing && (
              <div className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-xl bg-black/75 px-3 py-1.5 backdrop-blur-md border border-white/10 shadow-lg">
                <span className="text-xs font-semibold text-white">{displayName}</span>
                <div className="flex items-center gap-1">
                  <Volume2 className={`h-3.5 w-3.5 ${remoteVolume > 5 ? 'text-emerald-400' : 'text-slate-400'}`} />
                  <div className="flex items-end gap-0.5 h-3">
                    {[0.3, 0.6, 1.0, 0.7, 0.4].map((mult, idx) => {
                      const h = Math.max(2, Math.round(((remoteVolume * mult) / 100) * 12));
                      return (
                        <div
                          key={idx}
                          className="w-1 rounded-full transition-all duration-75 bg-emerald-400"
                          style={{ height: `${h}px` }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* D. Demo mode: no Chime meeting exists, so there is no call and no patient feed */}
            {isDemo && (
              <div
                role="status"
                className="absolute top-4 right-4 z-20 inline-flex items-center gap-1.5 rounded-full bg-amber-500/90 text-slate-950 px-3.5 py-1.5 text-[11px] font-bold shadow border border-amber-300"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                DEMO — no real call. Video is not configured on this server; the patient cannot join.
              </div>
            )}

            {/* E. Disconnected Alert */}
            {remoteConnected && participantLeft && (
              <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-2xl bg-rose-950/90 border border-rose-500/40 px-3.5 py-2 text-xs text-rose-200 backdrop-blur shadow-xl">
                <AlertTriangle className="h-4 w-4 text-rose-400 animate-pulse" />
                <span>Patient disconnected. Reconnecting…</span>
              </div>
            )}

            {transcribing && (
              <div role="status" className="absolute bottom-4 left-4 z-20 flex items-center gap-2 rounded-full bg-red-600/90 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">
                <span className="h-2 w-2 animate-pulse rounded-full bg-white" /> This visit is being transcribed (AI Scribe)
              </div>
            )}
            {isStaffView && sessionId && clientId && !isDemo ? (
              <TelehealthScribePanel
                sessionId={sessionId}
                clientId={clientId}
                clinicianAttendeeId={String((attendee as { AttendeeId?: string })?.AttendeeId || '') || null}
                getController={() => sessionRef.current?.audioVideo?.transcriptionController ?? null}
              />
            ) : null}

            {/* Hidden Audio Output for Remote Stream */}
            <audio ref={audioRef} autoPlay playsInline />
          </div>
        </main>

        {/* Collapsible Concurrent EHR Clinical Drawer (staff only) */}
        {isStaffView ? (
        <InCallEhrDrawer
          isOpen={ehrDrawerOpen}
          onClose={() => setEhrDrawerOpen(false)}
          sessionId={sessionId || ''}
          clientId={clientId || ''}
          clientName={displayName}
          clinicianName={subtitle || 'Attending Clinician'}
          role={role}
          sessionType={visitType}
          patientLocationState={patientLocationState}
          appointmentId={appointmentId}
          onVisitTypeChanged={setVisitType}
        />
        ) : null}
      </div>

      {/* 3. Docked Floating Glassmorphic Control Bar */}
      <footer className="py-4 px-6 flex items-center justify-center border-t border-white/10 bg-slate-950/80 backdrop-blur-md">
        <div className="inline-flex items-center gap-3 sm:gap-4 rounded-full bg-slate-900/90 border border-white/15 px-6 py-2.5 shadow-2xl backdrop-blur-xl">
          {/* Mic Toggle */}
          <button
            type="button"
            onClick={toggleMute}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition shadow-md active:scale-95 ${
              muted
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            aria-label={muted ? 'Unmute' : 'Mute'}
            title={muted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>

          {/* Camera Toggle */}
          <button
            type="button"
            onClick={() => void toggleCamera()}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition shadow-md active:scale-95 ${
              cameraOff
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            aria-label={cameraOff ? 'Start camera' : 'Stop camera'}
            title={cameraOff ? 'Start camera' : 'Stop camera'}
          >
            {cameraOff ? <VideoOff className="h-5 w-5" /> : <Video className="h-5 w-5" />}
          </button>

          {/* Screen Share Toggle */}
          <button
            type="button"
            onClick={() => void toggleScreenShare()}
            className={`inline-flex h-12 w-12 items-center justify-center rounded-full transition shadow-md active:scale-95 ${
              isScreenSharing
                ? 'bg-blue-600 hover:bg-blue-500 text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            aria-label={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
            title={isScreenSharing ? 'Stop sharing screen' : 'Share screen'}
          >
            {isScreenSharing ? <ScreenShareOff className="h-5 w-5" /> : <ScreenShare className="h-5 w-5" />}
          </button>

          {/* Collapsible EHR Notes Toggle Button (staff only) */}
          {isStaffView ? (
          <button
            type="button"
            onClick={() => setEhrDrawerOpen(!ehrDrawerOpen)}
            className={`inline-flex h-11 items-center gap-2 rounded-full px-4 text-xs font-bold transition shadow-md active:scale-95 ${
              ehrDrawerOpen
                ? 'bg-emerald-600 text-white'
                : 'bg-white/10 hover:bg-white/20 text-white'
            }`}
            title="Toggle Concurrent EHR Notes, Prescribing & Vitals Drawer"
          >
            <FileText className="h-4 w-4" />
            <span className="hidden sm:inline">EHR Notes</span>
          </button>
          ) : null}

          <div className="h-6 w-px bg-white/20 mx-1" />

          {/* End Visit Red Pill Button */}
          <button
            type="button"
            onClick={() => setEndConfirmOpen(true)}
            className="inline-flex h-11 items-center gap-2 rounded-full bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold px-6 text-sm shadow-xl shadow-rose-950/50 transition"
          >
            <PhoneOff className="h-4 w-4" />
            <span>End Visit</span>
          </button>
        </div>
      </footer>

      {/* Confirmation Modal to End Visit */}
      {endConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl text-white space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
                <PhoneOff className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white">End Video Session?</h3>
                <p className="text-xs text-slate-400">This will conclude the secure telehealth video visit.</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed bg-slate-950/60 p-3 rounded-2xl border border-white/5">
              Place of Service (POS 02) and CPT Modifier (-95) will be stamped automatically, and you can immediately draft the clinical SOAP note with AI Scribe.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setEndConfirmOpen(false)}
                className="rounded-xl border border-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/5 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEndVisit}
                className="rounded-xl bg-rose-600 hover:bg-rose-500 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-rose-950/50 transition"
              >
                Yes, End Session
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telephone Audio Fallback Modal */}
      {isStaffView && phoneFallbackOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-md rounded-3xl border border-white/10 bg-slate-900 p-6 shadow-2xl text-white space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <PhoneCall className="h-5 w-5 text-amber-400" />
                <h3 className="font-bold text-base">Telephone Audio Fallback</h3>
              </div>
              <button
                type="button"
                onClick={() => setPhoneFallbackOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <p>
                If either participant has low cellular or Wi-Fi bandwidth, bridge audio via telephone PSTN dial-in:
              </p>
              <div className="rounded-2xl bg-slate-950 p-3.5 border border-white/10 space-y-2 font-mono">
                <div className="flex justify-between items-center">
                  <span className="text-slate-400 text-xs">Dial-in Toll-Free:</span>
                  <span className="text-emerald-400 text-sm font-bold">1-800-419-CARE (2273)</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-white/5">
                  <span className="text-slate-400 text-xs">Meeting PIN:</span>
                  <span className="text-white text-sm font-bold">{meetingId?.slice(0, 10) || '482-910-384'}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Document verbal consent in the session note when conducting encounters over PSTN telephone bridges.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setPhoneFallbackOpen(false)}
              className="w-full rounded-2xl bg-slate-800 hover:bg-slate-700 py-2.5 text-xs font-bold text-white transition"
            >
              Close Info
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
