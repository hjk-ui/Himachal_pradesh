'use client';

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, DoorOpen, Loader2, Mail, MicOff, PhoneOff, UserCheck, UserX, Video } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { ConfirmDialog } from '@/components/ui';
import { GroupVideoCall } from '@/components/telehealth/GroupVideoCall';
import type { VideoAttendance } from '@/lib/groups/video';
import { LINK_SKIP_TEXT } from '@/lib/groups/video';
import { ErrorNote, Pill, apiBase, primaryBtn, secondaryBtn } from './shared';

/**
 * Facilitator controls for a group session's video room: start, send links (email + portal, no PHI),
 * copy a member's personal link, waiting room (admit / admit all), mute, remove, end for all, and
 * the "first names only" toggle. Joins / leaves feed the Attendance step prefill (onVideoData).
 */

type RosterRow = {
  participantId: string;
  kind: 'member' | 'staff';
  clientId: string | null;
  displayName: string;
  videoLabel: string;
  state: string;
  connected: boolean;
  minutes: number;
  joinCount: number;
  checkedInAt: string | null;
  locationType: 'home' | 'other' | null;
  linkSent: boolean;
  muteRequested: boolean;
};

type VideoState = {
  room: { id: string; status: string; nameDisplay: string; maxAttendees: number; demoMode: boolean; startedAt: string; endedAt: string | null } | null;
  roster: RosterRow[];
  defaultNameDisplay: string;
  part2: boolean;
  telehealth: boolean;
  attendance: { hasRoom: boolean; roomEnded: boolean; rows: VideoAttendance[] } | null;
};

type HostJoin = { meetingId: string; meeting: Record<string, unknown>; attendee: Record<string, unknown>; demoMode: boolean; labels: Record<string, string>; selfExternalUserId: string };

const POLL_MS = 5_000;
const HOST_BEAT_MS = 10_000;

function stateLabel(r: RosterRow): { text: string; tone: 'slate' | 'amber' | 'green' | 'rose' | 'blue' } {
  if (r.state === 'removed') return { text: 'Removed', tone: 'rose' };
  if (r.connected) return { text: 'In room', tone: 'green' };
  if (r.state === 'waiting') return { text: 'Waiting', tone: 'amber' };
  if (r.state === 'admitted') return { text: 'Admitted', tone: 'blue' };
  if (r.state === 'left') return { text: 'Left', tone: 'slate' };
  return { text: r.linkSent ? 'Link sent' : 'Not joined', tone: 'slate' };
}

export function GroupVideoPanel({ sessionId, onVideoData }: { sessionId: string; onVideoData?: (a: VideoState['attendance']) => void }) {
  const [data, setData] = useState<VideoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hosting, setHosting] = useState<HostJoin | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<RosterRow | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const url = `${apiBase()}/sessions/${sessionId}/video`;

  const load = useCallback(async () => {
    try {
      const r = await apiJson<VideoState>(url);
      setData(r);
      onVideoData?.(r.attendance);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the video room');
    }
  }, [url, onVideoData]);

  useEffect(() => {
    void load();
  }, [load]);

  const open = data?.room?.status === 'open';
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (!hosting) return;
    const t = setInterval(async () => {
      try {
        const r = await apiJson<{ labels: Record<string, string>; roomOpen: boolean }>(url, { method: 'POST', body: JSON.stringify({ action: 'host_heartbeat' }) });
        setLabels(r.labels);
        if (!r.roomOpen) setHosting(null);
      } catch {
        /* next beat */
      }
    }, HOST_BEAT_MS);
    return () => clearInterval(t);
  }, [hosting, url]);

  const act = async <T,>(key: string, body: Record<string, unknown>): Promise<T | null> => {
    setBusy(key);
    setError(null);
    try {
      const r = await apiJson<T>(url, { method: 'POST', body: JSON.stringify(body) });
      await load();
      return r;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed');
      return null;
    } finally {
      setBusy(null);
    }
  };

  const start = async () => {
    if (await act('start', { action: 'start' })) setInfo('Video room started. Send links, then join as host.');
  };

  const join = async () => {
    const r = await act<HostJoin>('join', { action: 'host_join' });
    if (r) {
      setLabels(r.labels);
      setHosting(r);
    }
  };

  const leaveHost = async () => {
    setHosting(null);
    await act('leave', { action: 'host_leave' });
  };

  const sendLinks = async () => {
    const r = await act<{ emailed: number; portal: number; skipped: number; emailFailed: number; reasons: Record<string, number> }>('send', { action: 'send_links' });
    if (!r) return;
    const reasons = Object.entries(r.reasons)
      .map(([k, n]) => `${n} ${LINK_SKIP_TEXT[k as keyof typeof LINK_SKIP_TEXT] ?? k}`)
      .join('; ');
    setInfo(`Links sent: ${r.emailed} by email, ${r.portal} by portal message.${r.skipped ? ` ${r.skipped} not sent.` : ''}${r.emailFailed ? ` ${r.emailFailed} email failed.` : ''}${reasons ? ` (${reasons})` : ''} Use Copy link for anyone who needs it another way.`);
  };

  const copyLink = async (row: RosterRow) => {
    const r = await act<{ url: string }>(`copy-${row.participantId}`, { action: 'copy_link', participantId: row.participantId });
    if (!r) return;
    try {
      await navigator.clipboard.writeText(r.url);
      setCopied(row.participantId);
      setTimeout(() => setCopied(null), 2500);
    } catch {
      window.prompt('Copy this member’s personal link', r.url);
    }
  };

  const end = async () => {
    setConfirmEnd(false);
    if (await act('end', { action: 'end' })) {
      setHosting(null);
      setInfo('Video room ended for everyone. Attendance can be prefilled from the video on the Attendance step.');
    }
  };

  if (!data) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        {error ? <ErrorNote message={error} /> : <Loader2 size={18} className="animate-spin text-slate-400" aria-label="Loading video room" />}
      </section>
    );
  }

  const members = data.roster.filter((r) => r.kind === 'member');
  const waiting = members.filter((r) => r.state === 'waiting');
  const inRoom = data.roster.filter((r) => r.connected).length;
  const firstOnly = data.room?.nameDisplay === 'first_only';

  const rosterList = (dark: boolean) => (
    <ul className="space-y-2">
      {members.length === 0 ? <li className={dark ? 'text-sm text-slate-400' : 'text-sm text-slate-500'}>No active members on this session.</li> : null}
      {members.map((r) => {
        const st = stateLabel(r);
        const rowBusy = busy?.endsWith(r.participantId);
        return (
          <li key={r.participantId} className={`rounded-lg border p-2.5 ${dark ? 'border-white/10 bg-slate-900/60' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className={`truncate text-sm font-semibold ${dark ? 'text-white' : 'text-slate-900'}`}>{r.displayName}</p>
                <p className={`text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Shown as {r.videoLabel} · {r.minutes} min{r.locationType ? ` · ${r.locationType === 'home' ? 'home' : 'not home'}` : ''}
                  {r.muteRequested ? ' · mute requested' : ''}
                </p>
              </div>
              <Pill tone={st.tone}>{st.text}</Pill>
            </div>
            {r.state !== 'removed' ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {r.state === 'waiting' || (r.state === 'invited' && r.checkedInAt) ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void act(`admit-${r.participantId}`, { action: 'admit', participantId: r.participantId })} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-xs font-semibold text-white disabled:opacity-50">
                    <UserCheck size={14} aria-hidden /> Admit
                  </button>
                ) : null}
                {r.connected ? (
                  <button type="button" disabled={Boolean(busy)} onClick={() => void act(`mute-${r.participantId}`, { action: 'mute', participantId: r.participantId })} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:opacity-50 ${dark ? 'bg-slate-700 text-white' : 'border border-slate-300 text-slate-700'}`}>
                    <MicOff size={14} aria-hidden /> Mute
                  </button>
                ) : null}
                <button type="button" disabled={Boolean(busy)} onClick={() => void copyLink(r)} className={`inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold disabled:opacity-50 ${dark ? 'bg-slate-700 text-white' : 'border border-slate-300 text-slate-700'}`}>
                  {copied === r.participantId ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied === r.participantId ? 'Copied' : 'Copy link'}
                </button>
                <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmRemove(r)} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2.5 text-xs font-semibold text-rose-600 disabled:opacity-50 hover:bg-rose-50/10">
                  <UserX size={14} aria-hidden /> Remove
                </button>
                {rowBusy ? <Loader2 size={14} className="animate-spin self-center" aria-hidden /> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );

  const controls = (dark: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      {waiting.length ? (
        <button type="button" disabled={Boolean(busy)} onClick={() => void act('admit_all', { action: 'admit_all' })} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
          <DoorOpen size={16} aria-hidden /> Admit all ({waiting.length})
        </button>
      ) : null}
      <label className={`inline-flex min-h-10 items-center gap-2 text-sm ${dark ? 'text-slate-200' : 'text-slate-700'}`}>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={firstOnly}
          disabled={Boolean(busy)}
          onChange={(e) => void act('names', { action: 'name_display', mode: e.target.checked ? 'first_only' : 'first_last_initial' })}
        />
        First names only
      </label>
      <button type="button" disabled={Boolean(busy)} onClick={() => setConfirmEnd(true)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
        <PhoneOff size={16} aria-hidden /> End room for all
      </button>
    </div>
  );

  const dialogs = (
    <>
      {confirmEnd ? (
        <ConfirmDialog title="End the video room for everyone?" tone="danger" confirmLabel="End room" onConfirm={end} onCancel={() => setConfirmEnd(false)}>
          Everyone is disconnected and the links stop working until you restart the room. Attendance is not signed: review it on the Attendance step.
        </ConfirmDialog>
      ) : null}
      {confirmRemove ? (
        <ConfirmDialog
          title="Remove this participant?"
          tone="danger"
          confirmLabel="Remove"
          onConfirm={async () => {
            const r = confirmRemove;
            setConfirmRemove(null);
            await act(`remove-${r.participantId}`, { action: 'remove', participantId: r.participantId });
          }}
          onCancel={() => setConfirmRemove(null)}
        >
          {confirmRemove.displayName} is disconnected and their link stops working for this room.
        </ConfirmDialog>
      ) : null}
    </>
  );

  if (hosting) {
    return (
      <>
        <GroupVideoCall
          meeting={hosting.meeting}
          attendee={hosting.attendee}
          demoMode={hosting.demoMode}
          labels={labels}
          selfExternalUserId={hosting.selfExternalUserId}
          title="Group telehealth session"
          leaveLabel="Leave (room stays open)"
          onLeave={() => void leaveHost()}
          sidePanel={
            <div className="space-y-3 p-3">
              <p className="text-sm font-semibold text-white">
                Participants ({inRoom} in room, {waiting.length} waiting)
              </p>
              {error ? <p className="rounded-md bg-rose-900/60 px-2 py-1 text-xs text-rose-100">{error}</p> : null}
              {controls(true)}
              {rosterList(true)}
            </div>
          }
        />
        {dialogs}
      </>
    );
  }

  return (
    <section aria-labelledby="gv-h" className="rounded-xl border border-[#DDD6FE] bg-white p-4 shadow-xs sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="gv-h" className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Video size={18} aria-hidden /> Video room
          {data.room ? <Pill tone={open ? 'green' : 'slate'}>{open ? `Open · ${inRoom} in room` : 'Ended'}</Pill> : null}
          {data.room?.demoMode ? <Pill tone="amber">Demo mode</Pill> : null}
        </h2>
        <div className="flex flex-wrap gap-2">
          {!open ? (
            <button type="button" className={primaryBtn} disabled={Boolean(busy)} onClick={() => void start()}>
              {busy === 'start' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Video size={16} aria-hidden />} {data.room ? 'Restart video room' : 'Start video room'}
            </button>
          ) : (
            <>
              <button type="button" className={primaryBtn} disabled={Boolean(busy)} onClick={() => void join()}>
                {busy === 'join' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Video size={16} aria-hidden />} Join as host
              </button>
              <button type="button" className={secondaryBtn} disabled={Boolean(busy)} onClick={() => void sendLinks()}>
                {busy === 'send' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />} Send links
              </button>
            </>
          )}
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Each member gets their own link (valid through the session day). Messages say only &ldquo;Your telehealth session link&rdquo; and the time.
        {data.part2 ? ' Part 2 group: members see first names only by default.' : ''}
      </p>
      <div className="mt-3 space-y-3">
        <ErrorNote message={error} />
        {info ? <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{info}</p> : null}
        {open ? controls(false) : null}
        {data.room ? rosterList(false) : null}
      </div>
      {dialogs}
    </section>
  );
}
