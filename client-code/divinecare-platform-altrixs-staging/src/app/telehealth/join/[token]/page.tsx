'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Mic,
  ShieldCheck,
  User,
  Video,
  Volume2,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { TelehealthCall } from '@/components/telehealth/TelehealthCall';
import { US_STATE_CODES } from '@/lib/telehealth/checkIn';
import { ChimeMeetingView } from '@/components/telehealth/ChimeMeetingView';
import { formatWallClock, practiceZoneLabel } from '@/lib/time/practiceTime';

type JoinSession = {
  clientName: string;
  clinicianName: string;
  date: string;
  startTime: string;
  /** Practice zone date/startTime are on (from the API). */
  timeZone?: string;
  timeZoneLabel?: string;
  status: string;
  waiting?: boolean;
  provider?: 'zoom' | 'google' | 'in_app' | 'chime' | string;
  chimeReady?: boolean;
  chimeMeetingId?: string | null;
  zoomJoinUrl?: string | null;
  googleMeetJoinUrl?: string | null;
};

/** "9:00 AM ET": startTime is already practice wall time; label it with the practice zone. */
function sessionClock(s: JoinSession) {
  return `${formatWallClock(s.startTime)} ${s.timeZoneLabel || practiceZoneLabel(s.timeZone)}`;
}

type ChimeJoin = {
  meetingId: string;
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
  demoMode?: boolean;
};

export default function TelehealthJoinPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || '');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [session, setSession] = useState<JoinSession | null>(null);
  const [here, setHere] = useState(false);
  const [inBrowser, setInBrowser] = useState(false);
  const [chimeBusy, setChimeBusy] = useState(false);
  const [chimeRoom, setChimeRoom] = useState<ChimeJoin | null>(null);

  const [consentSigned, setConsentSigned] = useState(false);
  // Asked, never defaulted: drives POS 10 (home) / 02 (other) and licensure (state).
  const [locationType, setLocationType] = useState<'' | 'home' | 'other'>('');
  const [locationState, setLocationState] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);

  // Pre-call mic/camera test states
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [deviceTested, setDeviceTested] = useState(false);
  const [testingMedia, setTestingMedia] = useState(false);

  useEffect(() => {
    let mounted = true;
    apiJson<{ success: true; session: JoinSession }>(
      `/api/telehealth/join/${encodeURIComponent(token)}`
    )
      .then((res) => {
        if (!mounted) return;
        setSession(res.session);
        if (res.session.waiting) {
          setHere(true);
        }
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Invalid or expired link');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  // Live Auto-Detection: Polls session while in waiting room to auto-join as soon as clinician starts the call
  useEffect(() => {
    if (!here || chimeRoom || chimeBusy) return;

    const poll = () => {
      apiJson<{ success: true; session: JoinSession }>(
        `/api/telehealth/join/${encodeURIComponent(token)}`
      )
        .then((res) => {
          if (res?.session) {
            setSession((prev) => ({ ...prev, ...res.session }));
            if (res.session.chimeReady && !chimeRoom && !chimeBusy) {
              void joinChime();
            }
          }
        })
        .catch(() => {});
    };

    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [here, chimeRoom, chimeBusy, token]);

  const stopPreview = () => {
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      setMediaStream(null);
    }
  };

  useEffect(() => {
    return () => {
      if (mediaStream) {
        mediaStream.getTracks().forEach((t) => t.stop());
      }
    };
  }, [mediaStream]);

  const startDeviceTest = async () => {
    setTestingMedia(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
        audio: true,
      });
      setMediaStream(stream);
      setCameraActive(stream.getVideoTracks().length > 0);
      setMicActive(stream.getAudioTracks().length > 0);
      setDeviceTested(true);

      if (previewRef.current) {
        previewRef.current.srcObject = stream;
      }

      // Audio volume monitoring
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        const audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkVolume = () => {
          if (!stream.active) {
            audioCtx.close().catch(() => {});
            return;
          }
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
          requestAnimationFrame(checkVolume);
        };
        requestAnimationFrame(checkVolume);
      }
    } catch (err) {
      console.warn('Pre-call media check error:', err);
      setDeviceTested(true);
    } finally {
      setTestingMedia(false);
    }
  };

  const markHere = async () => {
    if (!consentSigned) {
      setError('Please check the box confirming your agreement to telehealth treatment before checking in.');
      return;
    }
    if (!locationType) {
      setError('Please tell us where you are right now (home or another location).');
      return;
    }
    if (!locationState) {
      setError('Please choose the state you are in right now.');
      return;
    }
    setCheckingIn(true);
    setError('');
    try {
      // First attempt dedicated check-in endpoint which saves consent & location
      const checkInRes = await apiJson<{ success: true; session: JoinSession }>(
        `/api/telehealth/join/${encodeURIComponent(token)}/check-in`,
        {
          method: 'POST',
          body: JSON.stringify({
            consentSigned: true,
            locationType,
            locationState,
          }),
        }
      );
      if (checkInRes.session) {
        setSession((prev) => ({ ...prev, ...checkInRes.session, waiting: true }));
      }
    } catch {
      // Fallback to primary join token action
      try {
        const res = await apiJson<{ success: true; session: JoinSession }>(
          `/api/telehealth/join/${encodeURIComponent(token)}`,
          { method: 'POST', body: JSON.stringify({ action: 'here' }) }
        );
        setSession(res.session);
      } catch {
        // still enter waiting room view
      }
    } finally {
      setCheckingIn(false);
      setHere(true);
    }
  };

  const joinChime = async () => {
    stopPreview();
    setChimeBusy(true);
    setError('');
    try {
      const res = await apiJson<{
        success: true;
        session: JoinSession;
        chime: ChimeJoin;
      }>(`/api/telehealth/join/${encodeURIComponent(token)}`, {
        method: 'POST',
        body: JSON.stringify({ action: 'chime' }),
      });
      setSession(res.session);
      setChimeRoom(res.chime);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Video not ready yet — wait for your clinician to start the session'
      );
    } finally {
      setChimeBusy(false);
    }
  };

  if (chimeRoom) {
    return (
      <ChimeMeetingView
        meeting={chimeRoom.meeting}
        attendee={chimeRoom.attendee}
        meetingId={chimeRoom.meetingId}
        demoMode={chimeRoom.demoMode}
        title={`Visit with ${session?.clinicianName || 'your clinician'}`}
        subtitle={session ? `${session.date} · ${sessionClock(session)}` : undefined}
        role="client"
        onLeave={() => setChimeRoom(null)}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-900 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-slate-100 flex items-center justify-center sm:py-8">
      <div className="w-full min-w-0 max-w-xl space-y-6">
        {/* Clinic Branding & Security Badge */}
        <div className="flex flex-col items-center text-center space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/90 border border-slate-700 px-3.5 py-1 text-xs font-semibold text-emerald-400 shadow-sm">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span>HIPAA Compliant · 256-bit Encrypted Telehealth</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">
            MD Behavioral Health Virtual Clinic
          </h1>
          <p className="text-xs text-slate-400 max-w-sm">
            Zero-install browser consultation. No apps or sign-ups required.
          </p>
        </div>

        <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-800/80 shadow-2xl backdrop-blur-md">
          {/* Appointment Header */}
          <div className="border-b border-white/10 bg-slate-800/90 px-4 py-4 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                  Virtual Patient Waiting Room
                </p>
                <h2 className="break-words text-base font-bold text-white mt-0.5">
                  {session ? `Welcome, ${session.clientName}` : 'Checking Appointment…'}
                </h2>
              </div>
              {session ? (
                <div className="flex items-center gap-1.5 rounded-full bg-purple-500/10 border border-purple-400/30 px-3 py-1 text-xs text-purple-300 font-medium">
                  <Clock className="h-3.5 w-3.5 text-purple-400" />
                  <span>{sessionClock(session)}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-5 p-4 sm:p-6">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-300">
                <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
                <span>Connecting to your secure clinic room…</span>
              </div>
            )}

            {error && (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-950/60 p-4 text-sm text-rose-200">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                  <span>{error}</span>
                </div>
                <p className="mt-1 text-xs text-rose-300/80">
                  Please check your invitation SMS or contact the front desk if you need a new link.
                </p>
              </div>
            )}

            {session && !loading && (
              <>
                {/* Clinician Card */}
                <div className="flex items-center gap-3.5 rounded-2xl bg-slate-900/60 border border-white/5 p-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-purple-600 text-white font-bold shadow-md">
                    <User className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold text-white">{session.clinicianName}</p>
                    <p className="text-xs text-slate-400">Licensed Healthcare Provider</p>
                    <p className="mt-0.5 text-[11px] text-emerald-400 font-medium">
                      Date: {session.date} · Scheduled at {sessionClock(session)}
                    </p>
                  </div>
                </div>

                {/* Pre-Call Camera & Mic Check Tile */}
                <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4 text-purple-400" />
                      <span className="text-xs font-bold text-slate-200">Pre-Call Device Check</span>
                    </div>
                    {!deviceTested ? (
                      <button
                        type="button"
                        disabled={testingMedia}
                        onClick={() => void startDeviceTest()}
                        className="min-h-10 rounded-lg bg-purple-600 hover:bg-purple-500 px-3 py-1 text-xs font-semibold text-white transition disabled:opacity-50"
                      >
                        {testingMedia ? 'Checking…' : 'Test Camera & Mic'}
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Ready
                      </span>
                    )}
                  </div>

                  {/* Video Self-Preview Tile */}
                  {deviceTested && (
                    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-950 border border-white/10">
                      <video
                        ref={previewRef}
                        autoPlay
                        playsInline
                        muted
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between rounded-lg bg-black/60 px-2.5 py-1 text-[11px] backdrop-blur">
                        <span className="flex items-center gap-1.5 text-slate-300">
                          <span className={`h-2 w-2 rounded-full ${cameraActive ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                          Camera {cameraActive ? 'OK' : 'Off'}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Volume2 className="h-3.5 w-3.5 text-slate-400" />
                          <div className="h-1.5 w-12 rounded-full bg-slate-700 overflow-hidden">
                            <div
                              className="h-full bg-emerald-400 transition-all duration-100"
                              style={{ width: `${micLevel}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {!deviceTested && (
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Make sure your camera and microphone permissions are allowed so your doctor can see and hear you.
                    </p>
                  )}
                </div>

                {/* Patient Check-In & Virtual Waiting Room Steps */}
                {!here ? (
                  <div className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/60 p-4">
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-bold text-slate-300">
                          Step 2 · Where are you right now?
                        </label>
                        <p className="text-[11px] text-slate-400">
                          Required for telehealth safety and billing.
                        </p>
                        <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where are you right now?">
                          {([
                            ['home', 'Home'],
                            ['other', 'Other location'],
                          ] as const).map(([value, label]) => (
                            <label
                              key={value}
                              className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-xs ${
                                locationType === value ? 'border-purple-500 bg-purple-950/40 text-white' : 'border-white/10 bg-slate-950 text-slate-300'
                              }`}
                            >
                              <input
                                type="radio"
                                name="patient-location"
                                value={value}
                                checked={locationType === value}
                                onChange={() => setLocationType(value)}
                                className="h-4 w-4 shrink-0 text-purple-600"
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                        <select
                          value={locationState}
                          onChange={(e) => setLocationState(e.target.value)}
                          aria-label="State you are in right now"
                          className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-base text-white sm:text-xs focus:border-purple-500 focus:outline-none"
                        >
                          <option value="">State you are in right now…</option>
                          {US_STATE_CODES.map((code) => (
                            <option key={code} value={code}>
                              {code}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-3">
                        <label className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={consentSigned}
                            onChange={(e) => setConsentSigned(e.target.checked)}
                            className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-700 bg-slate-900 text-purple-600 focus:ring-purple-500"
                          />
                          <span className="text-xs text-slate-200 select-none">
                            <strong className="text-purple-300">Informed Telehealth Consent:</strong> I agree to receive healthcare services via secure audio/video telecommunications and understand my privacy rights under HIPAA.
                          </span>
                        </label>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={checkingIn}
                      onClick={() => {
                        void markHere();
                      }}
                      className="w-full rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-900/30 hover:from-purple-500 hover:to-indigo-500 transition active:scale-[0.99] disabled:opacity-50"
                    >
                      {checkingIn ? 'Checking into Waiting Room…' : "I'm Here / Check In for Visit"}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Calming Ambient Virtual Waiting Room Animation */}
                    <div className="relative overflow-hidden rounded-2xl border border-purple-500/40 bg-gradient-to-b from-purple-950/40 via-slate-900/80 to-slate-900/90 p-6 text-center shadow-xl">
                      {/* Ambient pulsating wave background rings */}
                      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
                        <div className="h-48 w-48 rounded-full bg-purple-500/10 animate-ping opacity-25" />
                        <div className="absolute h-64 w-64 rounded-full bg-indigo-500/5 animate-pulse" />
                      </div>

                      <div className="relative z-10 space-y-2">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-purple-600/30 border border-purple-400/40 shadow-inner">
                          <span className="h-3 w-3 rounded-full bg-emerald-400 animate-pulse" />
                        </div>
                        <h3 className="text-base font-bold text-white">
                          You are in {session.clinicianName}&apos;s waiting room
                        </h3>
                        <p className="text-xs text-purple-200/90 max-w-sm mx-auto">
                          Your clinician has been notified that you are ready and will admit you shortly. Please relax and keep this browser tab open.
                        </p>
                      </div>
                    </div>

                    {/* 988 Crisis Hotline Emergency Banner */}
                    <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
                      <div className="flex items-center gap-2 font-bold text-rose-300">
                        <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
                        <span>Mental Health Safety Notice · 988 Lifeline</span>
                      </div>
                      <p className="mt-1 text-[11px] text-rose-200/80 leading-relaxed">
                        If you are experiencing an acute crisis or thoughts of self-harm, please call or text <strong>988</strong> immediately for free 24/7 confidential support, or call <strong>911</strong>.
                      </p>
                    </div>

                    <button
                      type="button"
                      disabled={chimeBusy}
                      onClick={() => void joinChime()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-5 py-3.5 text-sm font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/40 disabled:opacity-50"
                    >
                      <Video className="h-4 w-4" />
                      {chimeBusy
                        ? 'Connecting to Video…'
                        : session.chimeReady
                          ? 'Join Video Call Now'
                          : 'Enter Video Room'}
                    </button>

                    {/* Secondary fallbacks if configured */}
                    {session.zoomJoinUrl ? (
                      <a
                        href={session.zoomJoinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/40 min-h-11 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-900/80 transition"
                      >
                        <Video className="h-3.5 w-3.5 text-blue-400" />
                        <span>Optional: Join via Zoom Link</span>
                      </a>
                    ) : null}

                    {session.googleMeetJoinUrl ? (
                      <a
                        href={session.googleMeetJoinUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-slate-900/40 min-h-11 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-slate-900/80 transition"
                      >
                        <Video className="h-3.5 w-3.5 text-green-400" />
                        <span>Optional: Join via Google Meet</span>
                      </a>
                    ) : null}

                    {!inBrowser ? (
                      <button
                        type="button"
                        onClick={() => setInBrowser(true)}
                        className="block min-h-11 w-full text-center text-xs font-semibold text-purple-400 hover:underline"
                      >
                        Use in-browser backup video
                      </button>
                    ) : (
                      <TelehealthCall token={token} role="client" />
                    )}
                  </div>
                )}
              </>
            )}

            <div className="pt-2 text-center">
              <Link
                href="/"
                className="inline-flex min-h-10 items-center text-xs text-slate-500 hover:text-slate-400 transition"
              >
                Return to Clinic Home
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
