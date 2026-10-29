'use client';

/**
 * Huddle sheet (/dashboard/huddle?date=YYYY-MM-DD): one card per visit on the provider's schedule
 * for the day, in time order: time, client, MRN, visit type, location / telehealth, a one-line
 * summary from the chart history digest (with its sources) and deterministic flags. "Show brief"
 * opens the existing pre-visit brief drawer. Default date: today before 3 PM practice time,
 * tomorrow after (server decides). Leadership can pick a provider. GET /api/huddle (audited).
 */
import Link from 'next/link';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FileText, MapPin, Video } from 'lucide-react';
import { Card, EmptyState, ErrorState, LoadingState, Page, PageHeader, StatusBadge, TONE_SOFT, Tabs, cx, inputClasses } from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { formatWallClock, practiceZoneLabel } from '@/lib/time/practiceTime';
import { PreVisitBriefButton } from '@/components/ai/PreVisitBriefButton';
import type { HuddleFlag, HuddleSheet, HuddleVisit } from '@/lib/huddle/core';

type HuddleResponse = {
  success: true;
  sheet: HuddleSheet;
  providers: { id: string; name: string; role: string }[] | null;
  canPickProvider: boolean;
  dates: { today: string; tomorrow: string };
};

const FLAG_TONE: Record<HuddleFlag['tone'], 'danger' | 'warning' | 'info'> = { danger: 'danger', warning: 'warning', info: 'info' };

function longDate(ymd: string) {
  const d = new Date(`${ymd}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? ymd : d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function VisitCard({ v }: { v: HuddleVisit }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="w-[4.75rem] shrink-0">
          <p className="text-sm font-semibold tabular-nums text-slate-900">{formatWallClock(v.startTime)}</p>
          <p className="text-[11px] tabular-nums text-slate-500">to {formatWallClock(v.endTime)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="break-words text-sm font-semibold text-slate-900">
            {v.clientId ? (
              <Link href={`/dashboard/clients/${encodeURIComponent(v.clientId)}`} className="hover:text-blue-700 hover:underline">
                {v.clientName}
              </Link>
            ) : (
              v.clientName
            )}
            {v.mrn ? <span className="ml-2 text-xs font-normal text-slate-500">MRN {v.mrn}</span> : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            <span className="break-words">{v.type}</span>
            {v.isVirtual ? (
              <span className="inline-flex items-center gap-0.5 font-medium text-sky-700">
                <Video size={12} aria-hidden /> Telehealth
              </span>
            ) : v.locationName ? (
              <span className="inline-flex items-center gap-0.5">
                <MapPin size={12} aria-hidden /> {v.locationName}
              </span>
            ) : null}
            {v.status !== 'SCHEDULED' ? <StatusBadge size="sm">{v.status.replace(/_/g, ' ').toLowerCase()}</StatusBadge> : null}
          </p>
        </div>
        {v.clientId ? <PreVisitBriefButton clientId={v.clientId} clientLabel={v.clientName} label="Show brief" className="ml-auto" /> : null}
      </div>

      <div className="mt-3 space-y-2">
        {v.summary ? (
          <div className="text-sm leading-relaxed text-slate-700">
            <p className="break-words">{v.summary.text}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-slate-500">
              <span>Chart history {v.summary.generated}</span>
              {v.summary.sources.map((s) => {
                const cls = 'inline-flex max-w-full items-center gap-0.5 truncate rounded border border-slate-200 bg-white px-1.5 font-semibold text-slate-600';
                return s.href ? (
                  <a key={s.key} href={s.href} target="_blank" rel="noopener noreferrer" className={cx(cls, 'hover:border-[#5C2D91] hover:text-[#5C2D91]')}>
                    <FileText size={10} aria-hidden /> {s.label}
                  </a>
                ) : (
                  <span key={s.key} className={cls}>
                    <FileText size={10} aria-hidden /> {s.label}
                  </span>
                );
              })}
            </div>
          </div>
        ) : v.summaryNote ? (
          <p className="text-sm italic text-slate-500">{v.summaryNote}</p>
        ) : null}
        {v.flags.length ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Flags">
            {v.flags.map((f) => (
              <li key={f.key} className="max-w-full">
                {/* Wraps instead of truncating (StatusBadge truncates): the detail matters on a phone */}
                <span className={cx('inline-block max-w-full break-words rounded-lg px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', TONE_SOFT[FLAG_TONE[f.tone]])}>
                  <strong className="font-semibold">{f.label}:</strong> {f.detail}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Card>
  );
}

function EmailToggle() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    apiJson<{ success: true; emailNotice: boolean }>('/api/huddle/preferences')
      .then((r) => setOn(r.emailNotice))
      .catch(() => setOn(null));
  }, []);
  if (on === null) return null;
  return (
    <label className="inline-flex items-center gap-2 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={on}
        onChange={async (e) => {
          const next = e.target.checked;
          setOn(next);
          try {
            await apiJson('/api/huddle/preferences', { method: 'PUT', body: JSON.stringify({ emailNotice: next }), headers: { 'Content-Type': 'application/json' } });
          } catch {
            setOn(!next);
          }
        }}
        className="h-4 w-4 rounded border-slate-300"
      />
      Email me when tomorrow&apos;s summary is ready
    </label>
  );
}

function HuddleContent() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const date = params.get('date') ?? '';
  const providerId = params.get('providerId') ?? '';
  const [data, setData] = useState<HuddleResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (date) q.set('date', date);
      if (providerId) q.set('providerId', providerId);
      const res = await apiJson<HuddleResponse>(`/api/huddle${q.toString() ? `?${q}` : ''}`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the huddle sheet');
    } finally {
      setLoading(false);
    }
  }, [date, providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const go = (next: { date?: string; providerId?: string }) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v) q.set(k, v);
      else q.delete(k);
    }
    router.replace(`${pathname}?${q.toString()}`);
  };

  const sheet = data?.sheet;
  const dayKey = sheet?.day ?? 'other';
  const title = sheet?.day === 'tomorrow' ? "Tomorrow's huddle" : sheet?.day === 'today' ? "Today's huddle" : 'Huddle sheet';

  return (
    <Page width="narrow">
      <PageHeader
        title={title}
        description={
          sheet
            ? `${longDate(sheet.date)} · ${sheet.provider.name ?? 'Provider'} · ${sheet.counts.visits} visit${sheet.counts.visits === 1 ? '' : 's'}, ${sheet.counts.flags} flag${sheet.counts.flags === 1 ? '' : 's'} · ${practiceZoneLabel(sheet.timeZone)}`
            : 'One-line summaries and flags for the visits on your schedule'
        }
        actions={<EmailToggle />}
      >
        <div className="flex flex-wrap items-center gap-3">
          {data ? (
            <Tabs
              variant="pill"
              label="Day"
              controlsPanels={false}
              value={dayKey as 'today' | 'tomorrow' | 'other'}
              onChange={(k) => go({ date: k === 'today' ? data.dates.today : data.dates.tomorrow })}
              items={[
                { key: 'today', label: 'Today' },
                { key: 'tomorrow', label: 'Tomorrow' },
                ...(dayKey === 'other' ? [{ key: 'other' as const, label: sheet ? longDate(sheet.date) : 'Other day', disabled: true }] : []),
              ]}
            />
          ) : null}
          {data?.canPickProvider && data.providers ? (
            <label className="flex min-w-0 items-center gap-2 text-sm text-slate-600">
              <span className="shrink-0">Provider</span>
              <select
                className={cx(inputClasses, 'min-w-0 max-w-[16rem] py-1.5')}
                value={sheet?.provider.id ?? ''}
                onChange={(e) => go({ providerId: e.target.value })}
              >
                {sheet && !data.providers.some((p) => p.id === sheet.provider.id) ? <option value={sheet.provider.id}>{sheet.provider.name ?? 'Me'}</option> : null}
                {data.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </PageHeader>

      {error && !data ? (
        <ErrorState title="Could not load the huddle sheet" description={error} onRetry={() => void load()} />
      ) : !data || (loading && !sheet) ? (
        <LoadingState label="Loading huddle…" rows={4} />
      ) : sheet && sheet.visits.length === 0 ? (
        <EmptyState title="No visits on this schedule." description="Booked visits for this day show here with a one-line summary and flags." />
      ) : (
        <ol className={cx('space-y-3', loading && 'opacity-60')} aria-label="Visits">
          {sheet?.visits.map((v) => (
            <li key={v.id}>
              <VisitCard v={v} />
            </li>
          ))}
        </ol>
      )}
      <p className="text-xs text-slate-500">
        Summaries are copied from the AI-generated chart history (verify before relying on them). Flags come from chart records only.
      </p>
    </Page>
  );
}

export default function HuddlePage() {
  return (
    <Suspense fallback={<LoadingState label="Loading huddle…" rows={4} />}>
      <HuddleContent />
    </Suspense>
  );
}
