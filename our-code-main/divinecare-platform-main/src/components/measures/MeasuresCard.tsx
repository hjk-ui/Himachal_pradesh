'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { INPUT_CLASSES } from '@/components/ui/tokens';
import { apiJson } from '@/lib/api-client';
import { MEASURE_FREQUENCIES, STAFF_COPY } from '@/lib/measures/copy';

type Assignment = {
  id: string;
  instrumentKey: string;
  instrumentName: string;
  frequency: string;
  status: string;
  nextDueAt: string | null;
  itemContentPending: boolean;
};
type InstrumentOption = { key: string; name: string; fullName: string; sendable: boolean };
type MeasureRequestRow = {
  id: string;
  instrumentName: string;
  channel: string;
  status: string;
  completedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  totalScore: number | null;
  severity: string | null;
  crisis: boolean;
};

const FREQUENCY_LABEL: Record<string, string> = {
  once: 'Once',
  every_visit: 'Every visit',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
};
const SEND_CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'sms', label: 'Text message' },
  { value: 'portal', label: 'Patient portal' },
] as const;

function shortDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
}

export function MeasuresCard({ clientId, className = '' }: { clientId: string; className?: string }) {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [requests, setRequests] = useState<MeasureRequestRow[]>([]);
  const [unreviewed, setUnreviewed] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [channel, setChannel] = useState<(typeof SEND_CHANNELS)[number]['value']>('email');
  const [newKey, setNewKey] = useState('');
  const [newFrequency, setNewFrequency] = useState('');
  const [sessionLink, setSessionLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = `?clientId=${encodeURIComponent(clientId)}`;
      const [a, r] = await Promise.all([
        apiJson<{ assignments: Assignment[]; instruments: InstrumentOption[] }>(`/api/clinical/measure-assignments${q}`),
        apiJson<{ requests: MeasureRequestRow[]; unreviewed: number }>(`/api/clinical/measure-requests${q}`),
      ]);
      setAssignments(a.assignments);
      setInstruments(a.instruments);
      setRequests(r.requests);
      setUnreviewed(r.unreviewed);
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not load measures.' });
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    setLoading(true);
    setSessionLink(null);
    void load();
  }, [load]);

  async function send(a: Assignment, via: 'email' | 'sms' | 'portal' | 'in_session') {
    setBusyKey(`${a.id}:${via}`);
    setMessage(null);
    try {
      const res = await apiJson<{ link?: string }>('/api/clinical/measure-requests', {
        method: 'POST',
        body: JSON.stringify({ clientId, instrumentKey: a.instrumentKey, channel: via, assignmentId: a.id }),
      });
      if (via === 'in_session' && res.link) setSessionLink(res.link);
      else setMessage({ tone: 'ok', text: `${a.instrumentName} sent.` });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Not sent.' });
    } finally {
      setBusyKey(null);
    }
  }

  async function addAssignment() {
    if (!newKey || !newFrequency) return;
    setBusyKey('add');
    setMessage(null);
    try {
      await apiJson('/api/clinical/measure-assignments', {
        method: 'POST',
        body: JSON.stringify({ clientId, instrumentKey: newKey, frequency: newFrequency }),
      });
      setNewKey('');
      setNewFrequency('');
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not add the measure.' });
    } finally {
      setBusyKey(null);
    }
  }

  async function markReviewed() {
    setBusyKey('review');
    setMessage(null);
    try {
      await apiJson('/api/clinical/measure-requests', { method: 'PATCH', body: JSON.stringify({ clientId }) });
      await load();
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Could not mark reviewed.' });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <Card className={className} role="region" aria-label={STAFF_COPY.title}>
      <CardHeader
        title={STAFF_COPY.title}
        actions={
          unreviewed > 0 ? (
            <Button size="sm" variant="secondary" loading={busyKey === 'review'} onClick={markReviewed}>
              {STAFF_COPY.markReviewed(unreviewed)}
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-4">
        {message ? (
          <p role="status" className={`text-[13px] ${message.tone === 'error' ? 'text-rose-700' : 'text-slate-700'}`}>
            {message.text}
          </p>
        ) : null}

        {sessionLink ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-[13px] text-slate-800">
            <p>Hand the device to the patient. This link is shown once.</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => window.open(sessionLink, '_blank', 'noopener,noreferrer')}>
                Open questionnaire
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSessionLink(null)}>
                Done
              </Button>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">
            Loading…
          </p>
        ) : assignments.length === 0 && requests.length === 0 ? (
          <p className="text-sm text-slate-500">{STAFF_COPY.empty}</p>
        ) : (
          <>
            {assignments.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
                {assignments.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{a.instrumentName}</p>
                      <p className="text-xs text-slate-500">
                        {FREQUENCY_LABEL[a.frequency] ?? a.frequency} · {a.status}
                        {a.nextDueAt ? ` · due ${shortDate(a.nextDueAt)}` : ''}
                        {a.itemContentPending ? ' · questions not available yet' : ''}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        aria-label="How to send"
                        value={channel}
                        onChange={(e) => setChannel(e.target.value as typeof channel)}
                        className={`${INPUT_CLASSES} !w-auto !py-1.5`}
                      >
                        {SEND_CHANNELS.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        size="sm"
                        loading={busyKey === `${a.id}:${channel}`}
                        disabled={a.itemContentPending || a.status !== 'active'}
                        onClick={() => send(a, channel)}
                      >
                        {STAFF_COPY.sendNow}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyKey === `${a.id}:in_session`}
                        disabled={a.itemContentPending || a.status !== 'active'}
                        onClick={() => send(a, 'in_session')}
                      >
                        {STAFF_COPY.giveInSession}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {requests.length > 0 ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {requests.slice(0, 8).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="font-medium text-slate-900">{r.instrumentName}</span>
                    <span className="text-xs text-slate-600">
                      {r.status === 'completed'
                        ? `Completed ${shortDate(r.completedAt)}${r.totalScore !== null ? ` · ${r.totalScore}` : ''}${r.severity ? ` · ${r.severity}` : ''}${r.reviewedAt ? ' · reviewed' : ''}`
                        : `${r.status.replace('_', ' ')} · sent ${shortDate(r.createdAt)}`}
                      {r.crisis ? <strong className="ml-2 text-rose-700">Safety answer</strong> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}

        <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4">
          <label className="text-xs font-medium text-slate-600">
            Measure
            <select value={newKey} onChange={(e) => setNewKey(e.target.value)} className={`${INPUT_CLASSES} mt-1`}>
              <option value="">Choose…</option>
              {instruments.map((i) => (
                <option key={i.key} value={i.key}>
                  {i.name}
                  {i.sendable ? '' : ' (questions not available yet)'}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-600">
            How often
            <select
              value={newFrequency}
              onChange={(e) => setNewFrequency(e.target.value)}
              className={`${INPUT_CLASSES} mt-1`}
            >
              <option value="">Choose…</option>
              {MEASURE_FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {FREQUENCY_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            variant="secondary"
            loading={busyKey === 'add'}
            disabled={!newKey || !newFrequency}
            onClick={addAssignment}
          >
            Add
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
