'use client';

import { useState } from 'react';
import { Plus, RefreshCw, Sparkles, Star, Target } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Modal, Page, PageHeader, StatusBadge, Tabs } from '@/components/ui';
import { AiDraftNotice, Labeled, ProgressBar, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, fmtDateTime, hrFetch, titleCase, useHrData } from './hrClient';

export type Review = {
  id: string;
  userId: string;
  name: string;
  reviewerId: string | null;
  reviewerName: string | null;
  reviewType: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueOn: string | null;
  status: string;
  selfReview: string | null;
  selfSubmittedAt: string | null;
  managerNotes?: string | null;
  managerReview: string | null;
  overallRating: string | null;
  metrics: { total?: number; signedOnTime?: number; onTimePct?: number | null; deadlineHours?: number; periodStart?: string; periodEnd?: string } | null;
  aiDraftUsed: boolean;
  managerSignedAt: string | null;
  employeeAckAt: string | null;
  employeeComment: string | null;
  viewerRole: 'hr' | 'reviewer' | 'employee' | 'none';
};
export type Goal = { id: string; userId: string; title: string; description: string | null; dueOn: string | null; status: string; progressPct: number };
type PerfData = {
  viewer: { userId: string; admin: boolean; team: string[] };
  reviews: Review[];
  goals: Goal[];
  people: Array<{ userId: string; name: string; role: string; managerUserId: string | null }>;
  reviewTypes: Array<{ key: string; label: string }>;
  aiReviewAssistant: boolean;
};

const RATINGS: Array<[string, string]> = [
  ['exceeds', 'Exceeds expectations'],
  ['meets', 'Meets expectations'],
  ['partially_meets', 'Partially meets'],
  ['does_not_meet', 'Does not meet'],
];
const STATUS_LABEL: Record<string, string> = { not_started: 'Not started', self_review: 'Self review', manager_review: 'Manager review', awaiting_ack: 'Waiting for employee', complete: 'Complete' };

export function PerformanceHub() {
  const { data, error, loading, reload } = useHrData<PerfData>('/api/hr/performance');
  const [tab, setTab] = useState<'open' | 'complete' | 'goals'>('open');
  const [open, setOpen] = useState<Review | null>(null);
  const [starting, setStarting] = useState(false);
  const reviews = data?.reviews ?? [];
  return (
    <Page>
      <PageHeader
        eyebrow="HR"
        title="Performance"
        description="90-day and annual reviews, goals, self review, manager review, sign-off and acknowledgment."
        actions={<Button icon={<Plus />} onClick={() => setStarting(true)}>Start a review</Button>}
      />
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <Tabs
            label="Performance views"
            value={tab}
            onChange={setTab}
            items={[
              { key: 'open', label: 'Open reviews', count: reviews.filter((r) => r.status !== 'complete').length },
              { key: 'complete', label: 'Completed' },
              { key: 'goals', label: 'Goals', count: data.goals.length },
            ]}
          />
          {tab !== 'goals' ? (
            <ReviewList reviews={reviews.filter((r) => (tab === 'open' ? r.status !== 'complete' : r.status === 'complete'))} onOpen={setOpen} />
          ) : (
            <GoalsPanel goals={data.goals} people={data.people} onChanged={reload} />
          )}
          {open ? <ReviewModal review={open} goals={data.goals.filter((g) => g.userId === open.userId)} aiEnabled={data.aiReviewAssistant} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} /> : null}
          {starting ? <StartReviewModal people={data.people.filter((p) => p.userId !== data.viewer.userId)} types={data.reviewTypes} onClose={() => setStarting(false)} onSaved={() => { setStarting(false); reload(); }} /> : null}
        </>
      ) : null}
    </Page>
  );
}

export function ReviewList({ reviews, onOpen, hideName }: { reviews: Review[]; onOpen: (r: Review) => void; hideName?: boolean }) {
  if (!reviews.length) return <EmptyState compact title="No reviews" icon={<Star />} />;
  return (
    <Card>
      <ul className="divide-y divide-slate-100">
        {reviews.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-slate-900">
                {hideName ? '' : `${r.name} · `}
                {r.reviewType === 'ninety_day' ? '90-day review' : r.reviewType === 'annual' ? 'Annual review' : titleCase(r.reviewType)}
              </p>
              <p className="text-xs text-slate-500">
                {r.reviewerName ? `Reviewer ${r.reviewerName} · ` : 'No reviewer assigned · '}due {fmtDate(r.dueOn)}
                {r.aiDraftUsed ? ' · started from an AI draft' : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={r.status === 'complete' ? 'success' : r.status === 'awaiting_ack' ? 'info' : 'warning'}>{STATUS_LABEL[r.status] ?? r.status}</StatusBadge>
              <Button size="sm" variant="secondary" onClick={() => onOpen(r)}>Open</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ReviewModal({ review, goals, aiEnabled, onClose, onChanged }: { review: Review; goals: Goal[]; aiEnabled: boolean; onClose: () => void; onChanged: () => void }) {
  const [selfReview, setSelfReview] = useState(review.selfReview ?? '');
  const [notes, setNotes] = useState(review.managerNotes ?? '');
  const [text, setText] = useState(review.managerReview ?? '');
  const [rating, setRating] = useState(review.overallRating ?? '');
  const [comment, setComment] = useState('');
  const [aiUsed, setAiUsed] = useState(false);
  const [aiNote, setAiNote] = useState<{ engine: 'bedrock' | 'rules'; disclaimer: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState(review.metrics);
  const isReviewer = review.viewerRole === 'reviewer' || review.viewerRole === 'hr';
  const isEmployee = review.viewerRole === 'employee';
  const signed = Boolean(review.managerSignedAt);

  async function act(body: Record<string, unknown>, label: string, close = true) {
    setBusy(label);
    setError(null);
    try {
      await hrFetch(`/api/hr/performance/${review.id}`, { method: 'PATCH', json: body });
      if (close) onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  }
  async function aiDraft() {
    setBusy('ai');
    setError(null);
    try {
      // Save notes first so the assistant reads the latest version.
      await hrFetch(`/api/hr/performance/${review.id}`, { method: 'PATCH', json: { action: 'save_manager', managerNotes: notes } });
      const r = await hrFetch<{ draft: { data: { text: string }; engine: 'bedrock' | 'rules'; disclaimer: string } }>('/api/hr/ai/review', { method: 'POST', json: { reviewId: review.id } });
      setText(r.draft.data.text);
      setAiUsed(true);
      setAiNote({ engine: r.draft.engine, disclaimer: r.draft.disclaimer });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft');
    } finally {
      setBusy(null);
    }
  }
  async function refreshMetrics() {
    setBusy('metrics');
    try {
      await hrFetch(`/api/hr/performance/${review.id}`, { method: 'PATCH', json: { action: 'refresh_metrics' } });
      const r = await hrFetch<{ reviews: Review[] }>('/api/hr/performance');
      setMetrics(r.reviews.find((x) => x.id === review.id)?.metrics ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load metrics');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal title={`${review.name}: ${review.reviewType === 'ninety_day' ? '90-day review' : review.reviewType === 'annual' ? 'Annual review' : titleCase(review.reviewType)}`} size="lg" onClose={onClose}>
      <div className="space-y-5 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <p className="text-sm text-slate-600">
          Period {fmtDate(review.periodStart)} to {fmtDate(review.periodEnd)} · due {fmtDate(review.dueOn)} · {STATUS_LABEL[review.status] ?? review.status}
        </p>
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Goals</h3>
          {goals.length ? (
            <ul className="space-y-2">
              {goals.map((g) => (
                <li key={g.id} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm"><span>{g.title}</span><StatusBadge size="sm">{titleCase(g.status)}</StatusBadge></div>
                  <ProgressBar pct={g.progressPct} label={g.title} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No goals recorded.</p>
          )}
        </section>
        {isReviewer ? (
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Documentation timeliness (counts only)</h3>
              <Button size="sm" variant="ghost" icon={<RefreshCw />} loading={busy === 'metrics'} onClick={refreshMetrics}>Refresh</Button>
            </div>
            {metrics && metrics.total != null ? (
              <p className="text-sm text-slate-700">
                {metrics.signedOnTime} of {metrics.total} notes signed within {metrics.deadlineHours} hours{metrics.onTimePct != null ? ` (${metrics.onTimePct}%)` : ''}.
              </p>
            ) : (
              <p className="text-sm text-slate-500">Not loaded. Applies to staff who write progress notes.</p>
            )}
          </section>
        ) : null}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">Self review</h3>
          {isEmployee && !review.selfSubmittedAt ? (
            <>
              <TextArea rows={6} value={selfReview} onChange={(e) => setSelfReview(e.target.value)} aria-label="Self review" placeholder="Your accomplishments, challenges and goals for next period" />
              <div className="flex justify-end"><Button loading={busy === 'self'} disabled={!selfReview.trim()} onClick={() => act({ action: 'self_submit', selfReview }, 'self')}>Submit self review</Button></div>
            </>
          ) : (
            <p className="whitespace-pre-wrap text-sm text-slate-700">{review.selfReview || 'Not submitted yet.'}</p>
          )}
        </section>
        {isReviewer ? (
          <section className="space-y-3">
            <Labeled label="Private notes (not shown to the employee)">
              <TextArea rows={4} value={notes} disabled={signed} onChange={(e) => setNotes(e.target.value)} />
            </Labeled>
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">Manager review</h3>
              {aiEnabled && !signed ? <Button size="sm" variant="secondary" icon={<Sparkles />} loading={busy === 'ai'} onClick={aiDraft}>Draft from goals and notes</Button> : null}
            </div>
            {aiNote ? <AiDraftNotice engine={aiNote.engine} disclaimer={aiNote.disclaimer} /> : null}
            <TextArea rows={10} value={text} disabled={signed} onChange={(e) => setText(e.target.value)} aria-label="Manager review" />
            <Labeled label="Overall rating">
              <Select value={rating} disabled={signed} onChange={(e) => setRating(e.target.value)}>
                <option value="">Not rated</option>
                {RATINGS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </Select>
            </Labeled>
            {!signed ? (
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="secondary" loading={busy === 'save'} onClick={() => act({ action: 'save_manager', managerNotes: notes, managerReview: text, overallRating: rating || null, aiDraftUsed: aiUsed }, 'save', false)}>
                  Save draft
                </Button>
                <Button
                  loading={busy === 'sign'}
                  disabled={!text.trim()}
                  onClick={async () => {
                    await act({ action: 'save_manager', managerNotes: notes, managerReview: text, overallRating: rating || null, aiDraftUsed: aiUsed }, 'sign', false);
                    await act({ action: 'manager_sign' }, 'sign');
                  }}
                >
                  Sign and share with employee
                </Button>
              </div>
            ) : (
              <p className="text-xs text-slate-500">Signed {fmtDateTime(review.managerSignedAt)}</p>
            )}
          </section>
        ) : review.managerReview ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-900">Manager review</h3>
            <p className="whitespace-pre-wrap text-sm text-slate-700">{review.managerReview}</p>
            {review.overallRating ? <p className="text-sm">Rating: {RATINGS.find(([k]) => k === review.overallRating)?.[1]}</p> : null}
          </section>
        ) : null}
        {isEmployee && review.status === 'awaiting_ack' ? (
          <section className="space-y-2 rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-900">Acknowledge</h3>
            <p className="text-xs text-slate-500">Acknowledging means you received the review; it does not mean you agree. You can add a comment.</p>
            <TextArea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Comment" />
            <div className="flex justify-end"><Button loading={busy === 'ack'} onClick={() => act({ action: 'acknowledge', employeeComment: comment || null }, 'ack')}>Acknowledge review</Button></div>
          </section>
        ) : null}
        {review.employeeAckAt ? (
          <p className="text-xs text-slate-500">Acknowledged {fmtDateTime(review.employeeAckAt)}{review.employeeComment ? ` · "${review.employeeComment}"` : ''}</p>
        ) : null}
      </div>
    </Modal>
  );
}

function StartReviewModal({ people, types, onClose, onSaved }: { people: PerfData['people']; types: PerfData['reviewTypes']; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ userId: people[0]?.userId ?? '', reviewerId: '', reviewType: 'annual', periodStart: '', periodEnd: '', dueOn: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      const p = people.find((x) => x.userId === f.userId);
      await hrFetch('/api/hr/performance', {
        method: 'POST',
        json: { ...f, reviewerId: f.reviewerId || p?.managerUserId || null, periodStart: f.periodStart || null, periodEnd: f.periodEnd || null, dueOn: f.dueOn || null },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Start a review"
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.userId}>Start</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Labeled label="Employee">
          <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Reviewer" hint="Blank: the employee's manager">
          <Select value={f.reviewerId} onChange={(e) => setF({ ...f, reviewerId: e.target.value })}>
            <option value="">Manager</option>
            {people.filter((p) => p.userId !== f.userId).map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Type">
          <Select value={f.reviewType} onChange={(e) => setF({ ...f, reviewType: e.target.value })}>
            {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Labeled>
        <div className="grid grid-cols-2 gap-3">
          <Labeled label="Period start"><TextInput type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Labeled>
          <Labeled label="Period end"><TextInput type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Labeled>
        </div>
        <Labeled label="Due"><TextInput type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Labeled>
      </div>
    </Modal>
  );
}

export function GoalsPanel({ goals, people, onChanged, fixedUserId }: { goals: Goal[]; people: Array<{ userId: string; name: string }>; onChanged: () => void; fixedUserId?: string }) {
  const [adding, setAdding] = useState(false);
  const [f, setF] = useState({ userId: fixedUserId ?? people[0]?.userId ?? '', title: '', dueOn: '' });
  const [error, setError] = useState<string | null>(null);
  async function save(body: Record<string, unknown>) {
    setError(null);
    try {
      await hrFetch('/api/hr/goals', { method: 'POST', json: body });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    }
  }
  const nameOf = (id: string) => people.find((p) => p.userId === id)?.name ?? '';
  return (
    <Card>
      <CardHeader title="Goals" icon={<Target />} actions={<Button size="sm" icon={<Plus />} onClick={() => setAdding((v) => !v)}>Add goal</Button>} />
      <CardBody className="space-y-3">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {adding ? (
          <div className="grid grid-cols-1 gap-3 rounded-lg border border-slate-200 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_160px_auto] sm:items-end">
            {!fixedUserId ? (
              <Labeled label="For">
                <Select value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>
                  {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
              </Labeled>
            ) : <span />}
            <Labeled label="Goal"><TextInput value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Labeled>
            <Labeled label="Due"><TextInput type="date" value={f.dueOn} onChange={(e) => setF({ ...f, dueOn: e.target.value })} /></Labeled>
            <Button disabled={!f.title.trim()} onClick={async () => { await save({ userId: f.userId, title: f.title, dueOn: f.dueOn || null }); setF({ ...f, title: '', dueOn: '' }); setAdding(false); }}>Save</Button>
          </div>
        ) : null}
        {goals.length === 0 ? (
          <EmptyState compact title="No goals yet" />
        ) : (
          <ul className="divide-y divide-slate-100">
            {goals.map((g) => (
              <li key={g.id} className="grid grid-cols-1 gap-2 py-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_160px_160px] md:items-center">
                <div>
                  <p className="text-sm font-medium text-slate-900">{g.title}</p>
                  <p className="text-xs text-slate-500">{fixedUserId ? '' : `${nameOf(g.userId)} · `}due {fmtDate(g.dueOn)}</p>
                </div>
                <ProgressBar pct={g.progressPct} label={g.title} />
                <Select aria-label="Status" value={g.status} onChange={(e) => save({ id: g.id, userId: g.userId, status: e.target.value, progressPct: e.target.value === 'complete' ? 100 : g.progressPct })}>
                  {['not_started', 'on_track', 'at_risk', 'complete', 'dropped'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
                </Select>
                <Select aria-label="Progress" value={String(Math.round(g.progressPct / 25) * 25)} onChange={(e) => save({ id: g.id, userId: g.userId, progressPct: Number(e.target.value) })}>
                  {[0, 25, 50, 75, 100].map((n) => <option key={n} value={n}>{n}%</option>)}
                </Select>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
