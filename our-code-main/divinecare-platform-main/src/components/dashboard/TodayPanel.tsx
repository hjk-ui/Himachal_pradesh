'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Lock, Video, Users } from 'lucide-react';
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/Card';
import { buttonClasses } from '@/components/ui/Button';
import { useAuth } from '@/features/auth';
import { PRACTICE_TIME_ZONE } from '@/lib/today/day';
import type { TodayResponse, TodayVisit } from '@/lib/today/types';

const REFRESH_MS = 60_000;
const CELEBRATION_MS = 2800;

export const TODAY_CELEBRATED_KEY_PREFIX = 'altrixs.today.celebrated.v1:';

const COPY = {
  title: 'Today',
  notesDone: 'Notes done today',
  inbox: 'Inbox',
  allCaughtUp: 'All caught up',
  fullSchedule: 'Full schedule',
  empty: 'No visits scheduled today.',
} as const;

function timeLabel(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PRACTICE_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function ActionCell({ visit }: { visit: TodayVisit }) {
  const a = visit.primaryAction;
  if (a.href) {
    return (
      <Link
        href={a.href}
        aria-label={a.ariaLabel}
        className={buttonClasses(a.kind === 'start_session' || a.kind === 'sign' ? 'primary' : 'secondary', 'sm')}
      >
        {a.label}
      </Link>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500">
      {a.kind === 'protected' ? <Lock size={13} aria-hidden /> : null}
      {a.label}
    </span>
  );
}

export function TodayPanel() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [data, setData] = useState<TodayResponse | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const celebratedThisMount = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/today', { cache: 'no-store' });
      if (res.status === 403 || res.status === 401) {
        setHidden(true);
        return;
      }
      const json = (await res.json()) as TodayResponse | { success: false; error?: string };
      if (!res.ok || json.success !== true) {
        setError('Could not load Today.');
        return;
      }
      setError(null);
      setData(json);
    } catch {
      setError('Could not load Today.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  const caughtUp = Boolean(
    data && data.notes.total > 0 && data.notes.done === data.notes.total && (data.inbox?.unread ?? 0) === 0
  );

  // Celebrate once per practice day per user.
  useEffect(() => {
    if (!caughtUp || !data || !userId || celebratedThisMount.current) return;
    const key = `${TODAY_CELEBRATED_KEY_PREFIX}${userId}`;
    try {
      if (window.localStorage.getItem(key) === data.day) return;
      window.localStorage.setItem(key, data.day);
    } catch {
      return; // storage blocked: skip rather than celebrate on every refresh
    }
    celebratedThisMount.current = true;
    if (prefersReducedMotion()) return;
    setCelebrate(true);
    const t = window.setTimeout(() => setCelebrate(false), CELEBRATION_MS);
    return () => window.clearTimeout(t);
  }, [caughtUp, data, userId]);

  if (hidden) return null;

  return (
    <Card aria-label={COPY.title} role="region">
      <CardHeader
        title={COPY.title}
        actions={
          data ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
              <span>
                {COPY.notesDone}:{' '}
                <span className="font-semibold text-slate-900">
                  {data.notes.done}/{data.notes.total}
                </span>
              </span>
              {data.inbox ? (
                <Link href="/dashboard/messages" className="hover:text-blue-600">
                  {COPY.inbox}:{' '}
                  <span className="font-semibold text-slate-900">{data.inbox.unread}</span>
                </Link>
              ) : null}
            </div>
          ) : null
        }
      />

      {caughtUp ? (
        <div
          className="flex items-center gap-2 border-b border-slate-200 bg-blue-50 px-5 py-2.5 text-sm font-semibold text-blue-700"
          role="status"
        >
          <CheckCircle2
            size={16}
            aria-hidden
            className={celebrate ? 'animate-bounce motion-reduce:animate-none' : undefined}
          />
          {COPY.allCaughtUp}
        </div>
      ) : null}

      {error && !data ? (
        <CardBody>
          <p className="text-sm text-slate-500">{error}</p>
        </CardBody>
      ) : !data ? (
        <CardBody>
          <p className="text-sm text-slate-500" aria-busy="true">
            Loading…
          </p>
        </CardBody>
      ) : data.visits.length === 0 ? (
        <CardBody>
          <p className="text-sm text-slate-500">{COPY.empty}</p>
        </CardBody>
      ) : (
        <ul className="divide-y divide-slate-100">
          {data.visits.map((v) => {
            const isNext = v.id === data.nextVisitId;
            return (
              <li
                key={v.id}
                aria-current={isNext ? 'true' : undefined}
                className={`flex flex-wrap items-center gap-3 px-5 py-3 ${isNext ? 'bg-blue-50' : ''}`}
              >
                <div className="w-20 shrink-0 text-sm font-semibold text-slate-900">{timeLabel(v.startsAt)}</div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                    {v.clientId ? (
                      <Link href={`/dashboard/clients/${v.clientId}`} className="truncate hover:text-blue-600">
                        {v.clientName}
                      </Link>
                    ) : (
                      <span className="truncate">{v.clientName}</span>
                    )}
                    {v.isVirtual ? <Video size={13} className="shrink-0 text-slate-400" aria-label="Telehealth" /> : null}
                    {v.isGroup ? <Users size={13} className="shrink-0 text-slate-400" aria-label="Group" /> : null}
                  </p>
                  {v.type ? <p className="truncate text-xs text-slate-500">{v.type}</p> : null}
                </div>
                <div className="shrink-0">
                  <ActionCell visit={v} />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <CardFooter>
        <Link href="/dashboard/appointments" className="text-[13px] font-semibold text-blue-600 hover:underline">
          {COPY.fullSchedule}
        </Link>
      </CardFooter>
    </Card>
  );
}
