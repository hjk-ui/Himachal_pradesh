'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarCheck, Info, Mail, Phone, RefreshCw, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import { apiJson } from '@/lib/api-client';
import { Alert, Button, Card, cx, EmptyState, FOCUS_RING, IconButton, LoadingState, StatusBadge, TONE_SOFT, type Tone } from '@/components/ui';

type RiskLevel = 'low' | 'medium' | 'high';

type RiskItem = {
  appointmentId: string;
  clientId: string;
  clientName: string;
  startsAt: string;
  clinicianName: string | null;
  type: string;
  isVirtual: boolean;
  score: number;
  level: RiskLevel;
  reasons: string[];
  phone: string | null;
  hasEmail: boolean;
  historyAvailable: boolean;
};

type RiskSummary = { total: number; high: number; medium: number; low: number; historyLimited: number };

type RemindResult = {
  appointmentId: string;
  result: 'sent' | 'no_email' | 'not_found' | 'not_scheduled' | 'error';
};

const LEVEL_STYLE: Record<RiskLevel, { tone: Tone; label: string }> = {
  high: { tone: 'danger', label: 'High' },
  medium: { tone: 'warning', label: 'Medium' },
  low: { tone: 'neutral', label: 'Low' },
};

const RESULT_LABEL: Record<RemindResult['result'], string> = {
  sent: 'Email sent',
  no_email: 'No email on file',
  not_found: 'Not found',
  not_scheduled: 'No longer scheduled',
  error: 'Send failed',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatDay(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function NoShowRiskPanel({ date }: { date: string }) {
  const [open, setOpen] = useState(true);
  const [items, setItems] = useState<RiskItem[]>([]);
  const [summary, setSummary] = useState<RiskSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [sentStatus, setSentStatus] = useState<Record<string, RemindResult['result']>>({});
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<{ items: RiskItem[]; summary: RiskSummary }>(
        `/api/appointments/no-show-risk?date=${encodeURIComponent(date)}&days=1`
      );
      setItems(data.items);
      setSummary(data.summary);
      setSelected(new Set());
      setSentStatus({});
      setShowAll(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load risk scores');
      setItems([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = showAll ? items : items.slice(0, 15);
  const selectedWithEmail = useMemo(
    () => items.filter((i) => selected.has(i.appointmentId) && i.hasEmail),
    [items, selected]
  );
  const anyEmail = items.some((i) => i.hasEmail);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAtRisk = () =>
    setSelected(
      new Set(items.filter((i) => i.level !== 'low' && i.hasEmail).slice(0, 50).map((i) => i.appointmentId))
    );

  const sendReminders = async () => {
    const ids = selectedWithEmail.map((i) => i.appointmentId).slice(0, 50);
    if (!ids.length) return;
    setSending(true);
    try {
      const data = await apiJson<{
        results: RemindResult[];
        summary: { sent: number; noEmail: number; failed: number };
      }>('/api/appointments/no-show-risk/remind', {
        method: 'POST',
        body: JSON.stringify({ appointmentIds: ids }),
      });
      setSentStatus((prev) => {
        const next = { ...prev };
        for (const r of data.results) next[r.appointmentId] = r.result;
        return next;
      });
      setSelected(new Set());
      const { sent, noEmail, failed } = data.summary;
      const parts = [`${sent} sent`];
      if (noEmail) parts.push(`${noEmail} without email`);
      if (failed) parts.push(`${failed} failed`);
      if (failed) toast.error(`Email reminders: ${parts.join(', ')}`);
      else toast.success(`Email reminders: ${parts.join(', ')}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send reminders');
    } finally {
      setSending(false);
    }
  };

  const remindDisabledReason = !anyEmail
    ? 'None of these clients have an email on file'
    : selectedWithEmail.length === 0
      ? 'Select appointments for clients with an email on file'
      : selectedWithEmail.length > 50
        ? 'Up to 50 reminders per send'
        : undefined;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200">
            <AlertTriangle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">No-Show Risk · {formatDay(date)}</h2>
              <span title="Rule-based checklist using attendance history, booking lead time, slot timing and visit format. Not a validated prediction.">
                <StatusBadge tone="brand" size="sm">
                  Risk score (attendance history)
                </StatusBadge>
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              Upcoming scheduled visits ranked by a rule-based score. Use it to decide who gets a
              confirmation call; it is not a prediction.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span title={remindDisabledReason}>
            <Button
              size="sm"
              icon={<Mail />}
              loading={sending}
              disabled={Boolean(remindDisabledReason)}
              onClick={() => void sendReminders()}
            >
              Email reminders{selectedWithEmail.length ? ` (${selectedWithEmail.length})` : ''}
            </Button>
          </span>
          <IconButton
            label="Refresh scores"
            icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />}
            onClick={() => void load()}
            disabled={loading}
            className="h-8 w-8 border border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
          />
          <Button size="sm" variant="secondary" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Collapse' : 'Expand'}
          </Button>
        </div>
      </div>

      {open && (
        <div className="mt-3.5 border-t border-slate-100 pt-3.5">
          {loading ? (
            <LoadingState label="Scoring appointments…" className="py-6" />
          ) : error ? (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" variant="secondary" onClick={() => void load()}>
                  Retry
                </Button>
              }
            >
              {error}
            </Alert>
          ) : !summary || summary.total === 0 ? (
            <EmptyState
              compact
              icon={<CalendarCheck />}
              title={`No upcoming scheduled appointments on ${formatDay(date)}.`}
              description="Visits booked for this day are scored here so you can plan confirmation calls."
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge tone="info">{summary.total} scheduled</StatusBadge>
                <StatusBadge tone="danger">{summary.high} high</StatusBadge>
                <StatusBadge tone="warning">{summary.medium} medium</StatusBadge>
                <StatusBadge tone="neutral">{summary.low} low</StatusBadge>
                {summary.historyLimited > 0 && (
                  <span className="text-xs text-slate-500">
                    {summary.historyLimited} with limited history (fewer than 3 past visits)
                  </span>
                )}
                <button
                  type="button"
                  onClick={selectAtRisk}
                  className={cx('ml-auto rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                >
                  Select medium + high with email
                </button>
              </div>

              <ul className="mt-3 divide-y divide-slate-100">
                {visible.map((i) => {
                  const style = LEVEL_STYLE[i.level];
                  const sent = sentStatus[i.appointmentId];
                  return (
                    <li key={i.appointmentId} className="flex items-start gap-3 py-2.5">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 accent-blue-600"
                        checked={selected.has(i.appointmentId)}
                        onChange={() => toggle(i.appointmentId)}
                        aria-label={`Select ${i.clientName}`}
                      />
                      <span
                        className={cx('mt-0.5 inline-flex w-10 shrink-0 justify-center rounded-lg px-1.5 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset', TONE_SOFT[style.tone])}
                        title="Score 0-100"
                      >
                        {i.score}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-slate-900">{i.clientName}</span>
                          <StatusBadge tone={style.tone} size="sm">
                            {style.label}
                          </StatusBadge>
                          <span className="text-xs text-slate-600">
                            {formatTime(i.startsAt)} ET · {i.clinicianName || 'Unassigned'}
                          </span>
                          {i.isVirtual && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <Video className="h-3 w-3" aria-hidden /> Telehealth
                            </span>
                          )}
                          {i.phone && (
                            <a
                              href={`tel:${i.phone.replace(/[^\d+]/g, '')}`}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
                            >
                              <Phone className="h-3 w-3" aria-hidden /> {i.phone}
                            </a>
                          )}
                          {!i.hasEmail && <span className="text-[11px] text-slate-500">No email on file</span>}
                          {sent && (
                            <span
                              className={`text-[11px] font-semibold ${sent === 'sent' ? 'text-emerald-700' : 'text-rose-700'}`}
                            >
                              {RESULT_LABEL[sent]}
                            </span>
                          )}
                        </div>
                        {i.reasons.length > 0 && (
                          <p className="mt-0.5 text-xs text-slate-600">{i.reasons.slice(0, 3).join(' · ')}</p>
                        )}
                        {!i.historyAvailable && (
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Limited history: score leans on scheduling factors only.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {items.length > visible.length && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className={cx('mt-1 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                >
                  Show all {items.length}
                </button>
              )}
            </>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
            <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            Reminders go by email only and contain the date, time and practice phone number, with no
            visit details. Text-message reminders will be available once SMS is approved.
          </p>
        </div>
      )}
    </Card>
  );
}
