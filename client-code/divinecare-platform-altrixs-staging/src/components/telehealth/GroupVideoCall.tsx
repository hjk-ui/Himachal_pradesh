'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Mic, MicOff, PhoneOff, ShieldCheck, Users, Video, VideoOff, Volume2 } from 'lucide-react';

/**
 * Group telehealth call (many participants) on the Amazon Chime SDK. Used by the member join page
 * (/telehealth/join/g/[token]) and by the facilitator (SessionRunner video panel).
 *
 * Names: Chime only carries opaque external user ids (m-<id> / s-<id>). Tile labels come from the
 * server (`labels`), already reduced to first name + last initial or first name only.
 */
export type GroupVideoCallProps = {
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
  demoMode?: boolean;
  labels: Record<string, string>;
  selfExternalUserId: string;
  title?: string;
  /** Increment to mute the local microphone (facilitator "Mute" request). */
  muteRequestKey?: number;
  onMutedByRequest?: () => void;
  onLeave: () => void;
  /** Facilitator controls next to the video (roster, admit, end). */
  sidePanel?: ReactNode;
  leaveLabel?: string;
};

type Seat = { attendeeId: string; externalUserId: string; tileId: number | null; local: boolean };

function VideoTile({ seat, label, bind }: { seat: Seat; label: string; bind: (tileId: number, el: HTMLVideoElement | null) => void }) {
  return (
    <div className="relative aspect-video min-w-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
      {seat.tileId != null ? (
        <video ref={(el) => bind(seat.tileId!, el)} autoPlay playsInline muted={seat.local} className={`h-full w-full object-cover ${seat.local ? '-scale-x-100' : ''}`} />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-purple-700 text-lg font-bold text-white">{label.charAt(0).toUpperCase()}</span>
        </div>
      )}
      <span className="absolute bottom-1.5 left-1.5 max-w-[90%] truncate rounded-md bg-black/60 px-2 py-0.5 text-xs font-medium text-white">
        {label}
        {seat.local ? ' (you)' : ''}
      </span>
    </div>
  );
}

export function GroupVideoCall({
  meeting,
  attendee,
  demoMode,
  labels,
  selfExternalUserId,
  title = 'Telehealth session',
  muteRequestKey = 0,
  onMutedByRequest,
  onLeave,
  sidePanel,
  leaveLabel = 'Leave',
}: GroupVideoCallProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sessionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const demoVideoRef = useRef<HTMLVideoElement | null>(null);
  const demoStreamRef = useRef<MediaStream | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [status, setStatus] = useState('Connecting…');
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [audioBlocked, setAudioBlocked] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isDemo = Boolean(demoMode || (meeting as any)?.demoMode || String((meeting as any)?.MeetingId ?? '').startsWith('demo-'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selfAttendeeId = String((attendee as any)?.AttendeeId ?? 'self');

  const bind = useCallback((tileId: number, el: HTMLVideoElement | null) => {
    const av = sessionRef.current?.audioVideo;
    if (av && el) {
      try {
        av.bindVideoElement(tileId, el);
      } catch {
        /* element re-render */
      }
    }
  }, []);

  // Demo mode: local camera only, others shown as name tiles
  useEffect(() => {
    if (!isDemo) return;
    setStatus('Demo mode (video service not configured)');
    setSeats([{ attendeeId: selfAttendeeId, externalUserId: selfExternalUserId, tileId: null, local: true }]);
    let active = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: true, audio: false })
      .then((stream) => {
        if (!active) return stream.getTracks().forEach((t) => t.stop());
        demoStreamRef.current = stream;
        if (demoVideoRef.current) demoVideoRef.current.srcObject = stream;
      })
      .catch(() => setCameraOff(true));
    return () => {
      active = false;
      demoStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [isDemo, selfAttendeeId, selfExternalUserId]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    (async () => {
      try {
        const { ConsoleLogger, DefaultDeviceController, DefaultMeetingSession, LogLevel, MeetingSessionConfiguration } = await import('amazon-chime-sdk-js');
        if (cancelled) return;
        const logger = new ConsoleLogger('AltrixsGroupTelehealth', LogLevel.WARN);
        const deviceController = new DefaultDeviceController(logger);
        const configuration = new MeetingSessionConfiguration({ Meeting: meeting }, { Attendee: attendee });
        configuration.enableSimulcastForUnifiedPlanChromiumBasedBrowsers = true;
        const session = new DefaultMeetingSession(configuration, logger, deviceController);
        sessionRef.current = session;
        const av = session.audioVideo;

        av.addObserver({
          audioVideoDidStart: () => {
            if (!cancelled) setStatus('Connected');
            try {
              av.startLocalVideoTile();
            } catch {
              /* camera may be off */
            }
          },
          audioVideoDidStop: () => {
            if (!cancelled) setStatus('Disconnected');
          },
          videoTileDidUpdate: (t) => {
            if (t.tileId == null || t.isContent) return;
            const attendeeId = t.localTile ? selfAttendeeId : String(t.boundAttendeeId ?? '');
            if (!attendeeId) return;
            setSeats((cur) => {
              const ext = t.localTile ? selfExternalUserId : String(t.boundExternalUserId ?? '');
              const found = cur.find((s) => s.attendeeId === attendeeId);
              if (found) return cur.map((s) => (s.attendeeId === attendeeId ? { ...s, tileId: t.tileId, externalUserId: s.externalUserId || ext } : s));
              return [...cur, { attendeeId, externalUserId: ext, tileId: t.tileId, local: Boolean(t.localTile) }];
            });
          },
          videoTileWasRemoved: (tileId) => {
            setSeats((cur) => cur.map((s) => (s.tileId === tileId ? { ...s, tileId: null } : s)));
          },
        });

        av.realtimeSubscribeToAttendeeIdPresence((attendeeId, present, externalUserId) => {
          if (cancelled || attendeeId.includes('#content')) return;
          setSeats((cur) => {
            if (!present) return cur.filter((s) => s.attendeeId !== attendeeId);
            if (cur.some((s) => s.attendeeId === attendeeId)) return cur;
            return [...cur, { attendeeId, externalUserId: String(externalUserId ?? ''), tileId: null, local: attendeeId === selfAttendeeId }];
          });
        });

        try {
          const inputs = await av.listAudioInputDevices();
          await av.startAudioInput(inputs[0]?.deviceId || 'default');
        } catch {
          try {
            await av.startAudioInput('default');
          } catch {
            /* no microphone */
          }
        }
        try {
          // Groups: modest resolution keeps many tiles smooth on phones
          av.chooseVideoInputQuality(640, 360, 15);
          const cams = await av.listVideoInputDevices();
          if (cams[0]?.deviceId) await av.startVideoInput(cams[0].deviceId);
          else setCameraOff(true);
        } catch {
          setCameraOff(true);
        }
        if (audioRef.current) {
          try {
            await av.bindAudioElement(audioRef.current);
          } catch {
            /* ignore */
          }
        }
        av.start();
        setTimeout(() => {
          if (audioRef.current?.paused) setAudioBlocked(true);
        }, 1500);
      } catch (e) {
        console.warn('[group-video] start failed', e);
        if (!cancelled) setStatus('Could not connect to video');
      }
    })();
    return () => {
      cancelled = true;
      const av = sessionRef.current?.audioVideo;
      if (av) {
        try {
          av.stopLocalVideoTile();
          av.stop();
          void av.stopVideoInput?.();
          void av.stopAudioInput?.();
        } catch {
          /* ignore */
        }
      }
      sessionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemo]);

  // Facilitator asked this participant to mute
  useEffect(() => {
    if (!muteRequestKey) return;
    try {
      sessionRef.current?.audioVideo?.realtimeMuteLocalAudio();
    } catch {
      /* ignore */
    }
    setMuted(true);
    onMutedByRequest?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muteRequestKey]);

  const toggleMute = () => {
    const av = sessionRef.current?.audioVideo;
    if (muted) av?.realtimeUnmuteLocalAudio();
    else av?.realtimeMuteLocalAudio();
    setMuted(!muted);
  };

  const toggleCamera = async () => {
    const av = sessionRef.current?.audioVideo;
    if (!av) return setCameraOff((v) => !v);
    try {
      if (cameraOff) {
        const cams = await av.listVideoInputDevices();
        if (cams[0]?.deviceId) await av.startVideoInput(cams[0].deviceId);
        av.startLocalVideoTile();
        setCameraOff(false);
      } else {
        av.stopLocalVideoTile();
        await av.stopVideoInput();
        setCameraOff(true);
      }
    } catch {
      /* ignore */
    }
  };

  const unlockAudio = () => {
    audioRef.current
      ?.play()
      .then(() => setAudioBlocked(false))
      .catch(() => {});
  };

  const labelOf = (s: Seat) => labels[s.externalUserId] || (s.local ? labels[selfExternalUserId] || 'You' : 'Participant');
  const sorted = [...seats].sort((a, b) => Number(b.local) - Number(a.local));
  const demoOthers = isDemo ? Object.entries(labels).filter(([ext]) => ext !== selfExternalUserId) : [];
  const count = isDemo ? 1 + demoOthers.length : seats.length;
  const cols = count <= 1 ? 'grid-cols-1' : count <= 4 ? 'grid-cols-2' : count <= 9 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4';

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-slate-100 lg:flex-row">
      <audio ref={audioRef} autoPlay className="hidden" />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <ShieldCheck size={13} className="text-emerald-400" aria-hidden /> {status}
              <span aria-hidden>·</span>
              <Users size={13} aria-hidden /> {count}
            </p>
          </div>
          {audioBlocked ? (
            <button type="button" onClick={unlockAudio} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-amber-500 px-3 text-xs font-semibold text-slate-950">
              <Volume2 size={14} aria-hidden /> Tap to turn on sound
            </button>
          ) : null}
        </header>
        <div className={`grid min-h-0 flex-1 auto-rows-min content-start gap-2 overflow-y-auto p-2 sm:p-3 ${cols}`}>
          {isDemo ? (
            <>
              <div className="relative aspect-video min-w-0 overflow-hidden rounded-xl border border-white/10 bg-slate-950">
                <video ref={demoVideoRef} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" />
                <span className="absolute bottom-1.5 left-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs text-white">{labels[selfExternalUserId] || 'You'} (you)</span>
              </div>
              {demoOthers.map(([ext, label]) => (
                <VideoTile key={ext} seat={{ attendeeId: ext, externalUserId: ext, tileId: null, local: false }} label={label} bind={bind} />
              ))}
            </>
          ) : (
            sorted.map((s) => <VideoTile key={s.attendeeId} seat={s} label={labelOf(s)} bind={bind} />)
          )}
        </div>
        <footer className="flex items-center justify-center gap-3 border-t border-white/10 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={toggleMute} aria-pressed={muted} className={`inline-flex min-h-12 min-w-12 items-center justify-center rounded-full px-4 ${muted ? 'bg-rose-600' : 'bg-slate-700 hover:bg-slate-600'}`}>
            {muted ? <MicOff size={20} aria-label="Unmute" /> : <Mic size={20} aria-label="Mute" />}
          </button>
          <button type="button" onClick={() => void toggleCamera()} aria-pressed={cameraOff} className={`inline-flex min-h-12 min-w-12 items-center justify-center rounded-full px-4 ${cameraOff ? 'bg-rose-600' : 'bg-slate-700 hover:bg-slate-600'}`}>
            {cameraOff ? <VideoOff size={20} aria-label="Turn camera on" /> : <Video size={20} aria-label="Turn camera off" />}
          </button>
          <button type="button" onClick={onLeave} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-500">
            <PhoneOff size={18} aria-hidden /> {leaveLabel}
          </button>
        </footer>
      </div>
      {sidePanel ? <aside className="max-h-[45dvh] w-full shrink-0 overflow-y-auto border-t border-white/10 bg-slate-800 lg:max-h-none lg:w-96 lg:border-l lg:border-t-0">{sidePanel}</aside> : null}
    </div>
  );
}
