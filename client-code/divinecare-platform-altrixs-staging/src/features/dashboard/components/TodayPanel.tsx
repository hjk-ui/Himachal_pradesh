'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, CalendarPlus, CheckCircle2, FilePen, Inbox, Video } from 'lucide-react';
import { Card, CardHeader, EmptyState, ErrorState, LoadingState, StatusBadge, buttonClasses, cx } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { formatWallClock, practiceZoneLabel } from '@/lib/time/practiceTime';
import { DocLightDot, docLightText } from '@/components/scheduling/DocLightDot';
import { PreVisitBriefButton } from '@/components/ai/PreVisitBriefButton';
import { StartSessionButton } from '@/components/scribe/StartSessionButton';
import { HuddleEntry } from '@/features/dashboard/components/HuddleEntry';
import { InlineSignNote } from '@/components/notes/InlineSignNote';
import { bookFollowUpHref, startVisitHref } from '@/components/visits/visitGuideHelpers';
import {
  allCaughtUp,
  claimCelebration,
  todayPrimaryAction,
  type TodayPanelData,
  type TodayVisit,
} from '@/lib/dashboard/today';

/** Notes-done ring: a quiet circular meter with the count in text beside it. */
function ProgressRing({ done, total }: { done: number; total: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? done / total : 0;
  return (
    <svg viewBox="0 0 40 40" className="h-10 w-10 shrink-0 -rotate-90" aria-hidden>
      <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" className="stroke-slate-200" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className={cx('motion-safe:transition-[stroke-dashoffset] motion-safe:duration-700', pct >= 1 ? 'stroke-emerald-500' : 'stroke-blue-600')}
      />
    </svg>
  );
}

/** "All caught up for today": a small check with a few sparks, animated only the first time today (and never with reduced motion). */
function CaughtUp({ animate }: { animate: boolean }) {
  const sparks = ['-top-1 left-1', 'top-0 right-0', 'bottom-0 -left-1', '-bottom-1 right-1', 'top-1/2 -right-2'];
  return (
    <div role="status" className="flex items-center gap-3 rounded-lg bg-emerald-50 px-4 py-3 text-emerald-800 ring-1 ring-inset ring-emerald-200">
      <span className="relative inline-flex">
        <CheckCircle2 className={cx('h-6 w-6 text-emerald-600', animate && 'motion-safe:animate-[bounce_0.8s_ease-out_2]')} aria-hidden />
        {animate
          ? sparks.map((pos, i) => (
              <span
                key={pos}
                aria-hidden
                className={cx('absolute h-1.5 w-1.5 rounded-full opacity-0 motion-safe:animate-ping', pos, i % 2 ? 'bg-amber-400' : 'bg-blue-500')}
                style={{ animationIterationCount: 2, animationDelay: `${i * 90}ms` }}
              />
            ))
          : null}
      </span>
      <div>
        <p className="text-sm font-semibold">All caught up for today</p>
        <p className="text-xs text-emerald-700">Every note for today&apos;s visits is signed. Nice work.</p>
      </div>
    </div>
  );
}

function PrimaryAction({ visit, data, onChanged }: { visit: TodayVisit; data: TodayPanelData; onChanged: () => void }) {
  const action = todayPrimaryAction(visit);
  if (!visit.clientId) return <span className="text-xs text-slate-500">{action.label}</span>;
  const appt = { ...visit, clientId: visit.clientId, date: data.date, timeZone: data.timeZone };
  switch (action.kind) {
    case 'start':
      // One click: opens the visit's note with AI Scribe ready to record (group visits: the group session)
      return (
        <StartSessionButton
          appointmentId={visit.id}
          clientId={visit.clientId}
          date={data.date}
          isVirtual={visit.isVirtual}
          groupSessionId={visit.groupSessionId}
        />
      );
    case 'finish':
      return (
        <Link href={startVisitHref(appt)} className={buttonClasses({ size: 'sm' })}>
          <FilePen size={13} aria-hidden /> Finish note
        </Link>
      );
    case 'sign':
      return visit.draftNoteId ? (
        <InlineSignNote
          noteId={visit.draftNoteId}
          clientName={visit.clientName}
          ready
          lateEntryRequired={visit.lateEntryRequired}
          openHref={startVisitHref(appt)}
          onSigned={onChanged}
        />
      ) : null;
    case 'follow_up':
      return (
        <Link href={bookFollowUpHref({ clientId: visit.clientId, days: null, from: data.date })} className={buttonClasses({ size: 'sm', variant: 'secondary' })}>
          <CalendarPlus size={13} aria-hidden /> Book follow-up
        </Link>
      );
    default:
      return <span className="text-xs font-medium text-slate-500">{action.label}</span>;
  }
}

/**
 * Clinician "Today" view (top of the therapist and prescriber homes): today's visits as a
 * timeline with the next visit highlighted, a status light and one primary action each,
 * notes done today and the inbox count. One request: GET /api/dashboard/today.
 */
export function TodayPanel() {
  const { user } = useAuth();
  const [data, setData] = useState<TodayPanelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiJson<{ success: true; today: TodayPanelData }>('/api/dashboard/today');
      setData(res.today);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load today');
    }
  }, []);

  useEffect(() => {
    void load();
    // Coming back to the tab (e.g. after signing in the note editor) refreshes the panel
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const caughtUp = data ? allCaughtUp(data.notes) : false;
  useEffect(() => {
    if (!caughtUp || !data || !user?.id) return;
    let storage: Storage | null = null;
    try {
      storage = window.localStorage;
    } catch {
      storage = null;
    }
    if (claimCelebration(storage, user.id, data.date)) setCelebrate(true);
  }, [caughtUp, data, user?.id]);

  const progress = data?.notes ?? { done: 0, total: 0 };
  return (
    <Card>
      <CardHeader
        title="Today"
        description={data ? `${data.visits.length} visit${data.visits.length === 1 ? '' : 's'} on your schedule · ${practiceZoneLabel(data.timeZone)}` : 'Your visits, notes and inbox for today'}
        actions={
          data ? (
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-2" aria-label={`Notes done today: ${progress.done} of ${progress.total}`}>
                <ProgressRing done={progress.done} total={progress.total} />
                <span className="text-sm text-slate-700">
                  Notes done today: <strong className="tabular-nums text-slate-900">{progress.done} of {progress.total}</strong>
                </span>
              </div>
              {data.inbox ? (
                <Link href="/dashboard/inbox" className={cx(buttonClasses({ size: 'sm', variant: 'secondary' }))}>
                  <Inbox size={14} aria-hidden /> Inbox: {data.inbox.toDo} to do
                  {data.inbox.urgent ? <StatusBadge tone="danger" size="sm">{data.inbox.urgent} urgent</StatusBadge> : null}
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />
      {error && !data ? (
        <ErrorState title="Could not load today" description={error} onRetry={() => void load()} />
      ) : !data ? (
        <LoadingState label="Loading today…" rows={3} />
      ) : (
        <div className="space-y-3 p-5 pt-0">
          {caughtUp ? <CaughtUp animate={celebrate} /> : null}
          <HuddleEntry />
          {data.visits.length === 0 ? (
            <EmptyState compact title="No visits on your schedule today." description="Booked visits show here with their note status and next step." />
          ) : (
            <ol className="relative divide-y divide-slate-100" aria-label="Today's visits">
              {data.visits.map((v) => {
                const next = v.id === data.nextVisitId;
                return (
                  <li
                    key={v.id}
                    aria-current={next ? 'step' : undefined}
                    className={cx('flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap', next && '-mx-3 rounded-lg bg-blue-50 px-3 ring-1 ring-inset ring-blue-200')}
                  >
                    <div className="w-[4.75rem] shrink-0">
                      <p className="text-sm font-semibold tabular-nums text-slate-900">{formatWallClock(v.startTime)}</p>
                      {v.isVirtual ? (
                        <span className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-sky-700">
                          <Video aria-hidden size={12} /> Virtual
                        </span>
                      ) : null}
                    </div>
                    <DocLightDot light={v.docLight} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-semibold text-slate-900">
                        {v.clientId ? (
                          <Link href={`/dashboard/clients/${encodeURIComponent(v.clientId)}`} className="truncate hover:text-blue-700 hover:underline">
                            {v.clientName}
                          </Link>
                        ) : (
                          <span className="truncate">{v.clientName}</span>
                        )}
                        {next ? <StatusBadge tone="brand" size="sm">Next</StatusBadge> : null}
                      </p>
                      <p className="truncate text-xs text-slate-500" title={docLightText(v.docLight)}>
                        {v.type} · {v.docLight.label}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      {v.clientId && v.status !== 'no-show' && v.status !== 'late-cancel' ? (
                        <PreVisitBriefButton clientId={v.clientId} clientLabel={v.clientName} />
                      ) : null}
                      <PrimaryAction visit={v} data={data} onChanged={() => void load()} />
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="flex justify-end">
            <Link href="/dashboard/appointments" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
              Full schedule <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </Card>
  );
}
