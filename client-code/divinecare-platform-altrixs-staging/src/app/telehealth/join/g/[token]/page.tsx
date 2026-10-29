'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AlertTriangle, Clock, Loader2, ShieldCheck, Video } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { US_STATE_CODES } from '@/lib/telehealth/checkIn';
import { formatWallClock, practiceZoneLabel } from '@/lib/time/practiceTime';
import { GroupVideoCall } from '@/components/telehealth/GroupVideoCall';

/**
 * Member's personal group telehealth link. Same check-in as a 1:1 visit (consent, where you are,
 * state), then a waiting room until the facilitator admits you. No group name is shown.
 */

type GroupJoinSession = {
  date: string;
  startTime: string;
  timeZone: string;
  durationMinutes: number;
  myLabel: string;
  state: string;
  checkedIn: boolean;
  roomOpen: boolean;
  canEnter: boolean;
  muteRequested: boolean;
  labels: Record<string, string>;
};

type ChimeJoin = {
  meetingId: string;
  meeting: Record<string, unknown>;
  attendee: Record<string, unknown>;
  demoMode?: boolean;
  selfExternalUserId: string;
};

const HEARTBEAT_MS = 10_000;
const WAIT_POLL_MS = 4_000;

export default function GroupTelehealthJoinPage() {
  const params = useParams<{ token: string }>();
  const token = decodeURIComponent(params.token || '');
  const api = `/api/telehealth/join/g/${encodeURIComponent(token)}`;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ended, setEnded] = useState('');
  const [session, setSession] = useState<GroupJoinSession | null>(null);
  const [consent, setConsent] = useState(false);
  const [locationType, setLocationType] = useState<'' | 'home' | 'other'>('');
  const [locationState, setLocationState] = useState('');
  const [busy, setBusy] = useState(false);
  const [call, setCall] = useState<ChimeJoin | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [muteKey, setMuteKey] = useState(0);
  const ackMuteRef = useRef(false);
  const joiningRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ session: GroupJoinSession }>(api);
      setSession(r.session);
      setLabels(r.session.labels);
      setError('');
      return r.session;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid or expired link');
      return null;
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const join = useCallback(async () => {
    if (joiningRef.current) return;
    joiningRef.current = true;
    setBusy(true);
    try {
      const r = await apiJson<{ session: GroupJoinSession; chime: ChimeJoin }>(api, { method: 'POST', body: JSON.stringify({ action: 'join' }) });
      setSession(r.session);
      setLabels(r.session.labels);
      setCall(r.chime);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join yet');
    } finally {
      joiningRef.current = false;
      setBusy(false);
    }
  }, [api]);

  // Waiting room: poll until the facilitator admits, then join automatically
  useEffect(() => {
    if (call || !session?.checkedIn || ended) return;
    const t = setInterval(async () => {
      const s = await load();
      if (s?.canEnter) void join();
    }, WAIT_POLL_MS);
    return () => clearInterval(t);
  }, [call, session?.checkedIn, ended, load, join]);

  // In call: heartbeat (minutes), facilitator mute / remove / end
  useEffect(() => {
    if (!call) return;
    const beat = async () => {
      try {
        const ack = ackMuteRef.current;
        const r = await apiJson<{ session: GroupJoinSession }>(api, { method: 'POST', body: JSON.stringify({ action: 'heartbeat', ackMute: ack }) });
        if (ack) ackMuteRef.current = false;
        setLabels(r.session.labels);
        if (!r.session.roomOpen) {
          setCall(null);
          setEnded('The session has ended. Thank you for joining.');
          return;
        }
        if (r.session.muteRequested && !ack) setMuteKey((k) => k + 1);
      } catch (e) {
        setCall(null);
        setEnded(e instanceof Error ? e.message : 'You have left the session.');
      }
    };
    const t = setInterval(beat, HEARTBEAT_MS);
    const onHide = () => {
      try {
        navigator.sendBeacon?.(api, new Blob([JSON.stringify({ action: 'leave' })], { type: 'application/json' }));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('pagehide', onHide);
    return () => {
      clearInterval(t);
      window.removeEventListener('pagehide', onHide);
    };
  }, [call, api]);

  const checkIn = async () => {
    if (!consent) return setError('Please check the box confirming your agreement to telehealth before checking in.');
    if (!locationType) return setError('Please tell us where you are right now (home or another location).');
    if (!locationState) return setError('Please choose the state you are in right now.');
    setBusy(true);
    setError('');
    try {
      const r = await apiJson<{ session: GroupJoinSession }>(api, {
        method: 'POST',
        body: JSON.stringify({ action: 'check_in', consentSigned: true, locationType, locationState }),
      });
      setSession(r.session);
      if (r.session.canEnter) void join();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check-in failed');
    } finally {
      setBusy(false);
    }
  };

  const leave = async () => {
    setCall(null);
    setEnded('You left the session. You can rejoin with the same link while the session is open.');
    try {
      await apiJson(api, { method: 'POST', body: JSON.stringify({ action: 'leave' }) });
    } catch {
      /* ignore */
    }
  };

  if (call) {
    return (
      <GroupVideoCall
        meeting={call.meeting}
        attendee={call.attendee}
        demoMode={call.demoMode}
        labels={labels}
        selfExternalUserId={call.selfExternalUserId}
        title="Your telehealth session"
        muteRequestKey={muteKey}
        onMutedByRequest={() => {
          ackMuteRef.current = true;
        }}
        onLeave={() => void leave()}
      />
    );
  }

  const clock = session ? `${formatWallClock(session.startTime)} ${practiceZoneLabel(session.timeZone)}` : '';

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-900 px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] text-slate-100">
      <div className="w-full min-w-0 max-w-xl space-y-5">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/90 px-3.5 py-1 text-xs font-semibold text-emerald-400">
            <ShieldCheck className="h-4 w-4" aria-hidden />
            <span>Private, encrypted telehealth</span>
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Your telehealth session</h1>
          {session ? (
            <p className="inline-flex items-center gap-1.5 text-sm text-purple-200">
              <Clock className="h-4 w-4" aria-hidden /> {session.date} · {clock}
            </p>
          ) : null}
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-slate-800/80 p-4 shadow-2xl sm:p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-300">
              <Loader2 className="h-5 w-5 animate-spin text-purple-400" aria-hidden /> Checking your link…
            </div>
          ) : null}

          {error ? (
            <div role="alert" className="rounded-2xl border border-rose-500/40 bg-rose-950/60 p-4 text-sm text-rose-200">
              <div className="flex items-center gap-2 font-bold">
                <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" aria-hidden />
                <span>{error}</span>
              </div>
              <p className="mt-1 text-xs text-rose-300/80">Contact the clinic if you need a new link.</p>
            </div>
          ) : null}

          {ended ? (
            <div role="status" className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 text-sm text-slate-200">
              {ended}
              {session?.roomOpen && session.canEnter ? (
                <button type="button" onClick={() => { setEnded(''); void join(); }} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white">
                  <Video className="h-4 w-4" aria-hidden /> Rejoin
                </button>
              ) : null}
            </div>
          ) : null}

          {session && !loading && !ended ? (
            !session.checkedIn ? (
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  Hi {session.myLabel}. Please check in. The facilitator will let you into the session.
                </p>
                <div>
                  <p className="text-xs font-bold text-slate-300">Where are you right now?</p>
                  <p className="text-[11px] text-slate-400">Required for telehealth safety and billing.</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where are you right now?">
                    {([
                      ['home', 'Home'],
                      ['other', 'Other location'],
                    ] as const).map(([value, label]) => (
                      <label key={value} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${locationType === value ? 'border-purple-500 bg-purple-950/40 text-white' : 'border-white/10 bg-slate-950 text-slate-300'}`}>
                        <input type="radio" name="loc" value={value} checked={locationType === value} onChange={() => setLocationType(value)} className="h-4 w-4" />
                        {label}
                      </label>
                    ))}
                  </div>
                  <select
                    value={locationState}
                    onChange={(e) => setLocationState(e.target.value)}
                    aria-label="State you are in right now"
                    className="mt-2 min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-base text-white sm:text-sm"
                  >
                    <option value="">State you are in right now…</option>
                    {US_STATE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-purple-500/30 bg-purple-950/20 p-3">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" />
                  <span className="text-xs text-slate-200">
                    <strong className="text-purple-300">Telehealth consent:</strong> I agree to receive care by secure audio/video and understand my privacy rights. I will not record the session and will join from a private place.
                  </span>
                </label>
                <button type="button" disabled={busy} onClick={() => void checkIn()} className="min-h-12 w-full rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 text-sm font-bold text-white disabled:opacity-50">
                  {busy ? 'Checking in…' : "I'm here / Check in"}
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-purple-500/40 bg-purple-950/30 p-5 text-center">
                  <span className="mx-auto mb-2 block h-3 w-3 animate-pulse rounded-full bg-emerald-400" aria-hidden />
                  <h2 className="text-base font-bold text-white">{session.canEnter ? 'You can join now' : 'You are in the waiting room'}</h2>
                  <p className="mx-auto mt-1 max-w-sm text-xs text-purple-200/90">
                    {session.roomOpen
                      ? session.canEnter
                        ? 'Joining the session…'
                        : 'The facilitator will let you in shortly. Keep this page open.'
                      : 'The session room is not open. Keep this page open or try again closer to the start time.'}
                  </p>
                  {session.canEnter ? (
                    <button type="button" disabled={busy} onClick={() => void join()} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 text-sm font-bold text-white disabled:opacity-50">
                      <Video className="h-4 w-4" aria-hidden /> {busy ? 'Connecting…' : 'Join now'}
                    </button>
                  ) : null}
                </div>
                <p className="text-[11px] text-slate-400">Others in the session see you as: {session.myLabel}</p>
              </div>
            )
          ) : null}

          <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-xs text-rose-200">
            <p className="font-bold text-rose-300">In a crisis?</p>
            <p className="mt-1 text-[11px] leading-relaxed">
              Call or text <strong>988</strong> any time for free, confidential support, or call <strong>911</strong>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
