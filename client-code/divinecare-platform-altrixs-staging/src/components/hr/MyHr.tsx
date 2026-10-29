'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, CalendarDays, CheckCircle2, MessageCircleQuestion, Pencil, Plus, Send, Sparkles, Users } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
} from '@/components/ui';
import { ExpiryBadge, Field, FieldGrid, Labeled, ProgressBar, TextArea, TextInput } from './HrBits';
import { fmtDate, fmtDateTime, hrFetch, roleLabel, titleCase, useHrData } from './hrClient';
import { CredentialsPanel, type CredentialBundle, type ExpirationRow } from './CredentialsPanel';
import { DocumentsPanel, type HrDoc } from './DocumentsPanel';
import { ChecklistTasks, type Checklist, type ChecklistTask } from './ChecklistTasks';
import { RecordCompletionModal, type Requirement, type TrainingRow } from './TrainingHub';
import { RequestList, RequestTimeOffModal, type TimeOffRequest } from './TimeOffHub';
import { GoalsPanel, ReviewList, ReviewModal, type Goal, type Review } from './PerformanceHub';
import { EmergencyContactsEditor } from './EmployeeProfile';

type Policy = { id: string; kind: string; title: string; version: string; requiresAck: boolean; acknowledgedAt: string | null; sections: Array<{ id: string; heading: string; text: string }> };
type MyData = {
  today: string;
  record: Record<string, unknown> & { userId: string; name: string; email: string; role: string; jobTitle: string; department: string; programs: string[]; locationNames: string[]; managerName: string | null; hrStatus: string; emergencyContacts?: Array<{ name: string; relationship?: string; phone: string; altPhone?: string }> };
  credentials: CredentialBundle;
  expirations: ExpirationRow[];
  documents: HrDoc[];
  training: TrainingRow | null;
  requirements: Requirement[];
  timeOff: { requests: TimeOffRequest[]; balance: { pto: number; sick: number }; types: Array<{ key: string; label: string }>; scheduleIntegration: { message: string } };
  reviews: Review[];
  goals: Goal[];
  discipline: Array<{ id: string; actionType: string; issuedOn: string; summary: string; expectations: string | null; employeeAckAt: string | null }>;
  checklists: Checklist[];
  assignedToMe: Array<ChecklistTask & { checklistId: string; staffName: string; kind: string }>;
  policies: Policy[];
  changeRequests: Array<{ id: string; changes: Record<string, unknown>; status: string; createdAt: string; reviewNote: string | null }>;
  reminders: Array<{ id: string; title: string; detail: string | null; dueOn: string | null; severity: string }>;
  aiPolicyQa: boolean;
  team: Array<{ userId: string; name: string; jobTitle: string; role: string; hrStatus: string; attention: number; pendingTimeOff: number; reviewsOpen: number; balance: { pto: number; sick: number } }>;
  teamTimeOff: TimeOffRequest[];
  teamReviews: Review[];
  teamGoals: Goal[];
};
type TabKey = 'overview' | 'profile' | 'credentials' | 'training' | 'timeoff' | 'documents' | 'performance' | 'policies' | 'team';

/** "My HR": the staff member's own HR record and tasks (no pay data), plus "My team" for supervisors. */
export function MyHr() {
  const { data, error, loading, reload } = useHrData<MyData>('/api/hr/me');
  const [tab, setTab] = useState<TabKey>('overview');
  const [editProfile, setEditProfile] = useState(false);
  const [addTraining, setAddTraining] = useState(false);
  const [requestOff, setRequestOff] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !data) return <Page><LoadingState rows={8} /></Page>;
  if (error && !data) return <Page><ErrorState description={error} onRetry={reload} /></Page>;
  if (!data) return null;
  const r = data.record;
  const viewer = { userId: r.userId, role: r.role, hrAdmin: false };
  const openOnboarding = data.checklists.filter((c) => c.kind === 'onboarding');
  const myOpenTasks = openOnboarding.flatMap((c) => c.tasks.filter((t) => t.status === 'open' && t.ownerType === 'employee'));
  const policiesToAck = data.policies.filter((p) => p.requiresAck && !p.acknowledgedAt);
  const attention = data.expirations.filter((e) => ['expired', 'missing', 'due_30', 'due_60'].includes(e.status) && e.source !== 'exclusion' && e.source !== 'review');
  const items: Array<{ key: TabKey; label: string; count?: number }> = [
    { key: 'overview', label: 'Overview' },
    { key: 'profile', label: 'My profile' },
    { key: 'credentials', label: 'Credentials', count: attention.filter((a) => a.source === 'credential' || a.source === 'compliance' || a.source === 'caqh').length || undefined },
    { key: 'training', label: 'Training & CEUs' },
    { key: 'timeoff', label: 'Time off' },
    { key: 'documents', label: 'Documents' },
    { key: 'performance', label: 'Performance' },
    { key: 'policies', label: 'Policies', count: policiesToAck.length || undefined },
    ...(data.team.length ? [{ key: 'team' as TabKey, label: 'My team', count: data.team.reduce((s, t) => s + t.pendingTimeOff, 0) || undefined }] : []),
  ];

  return (
    <Page>
      <PageHeader
        eyebrow="My HR"
        title={`Hi, ${String(r.preferredName || r.name).split(' ')[0]}`}
        description={[r.jobTitle || roleLabel(r.role), r.locationNames.join(', ')].filter(Boolean).join(' · ')}
        actions={
          <>
            <Button variant="secondary" icon={<CalendarDays />} onClick={() => setRequestOff(true)}>Request time off</Button>
            <Button variant="secondary" icon={<Plus />} onClick={() => setAddTraining(true)}>Add training / CEU</Button>
          </>
        }
      />
      {notice ? <Alert tone="warning" actions={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Alert> : null}
      <Tabs label="My HR sections" value={tab} onChange={setTab} items={items} />

      {tab === 'overview' ? (
        <div className="space-y-6">
          {openOnboarding.length ? (
            <Card>
              <CardHeader title="Welcome aboard: your onboarding" description="Complete your tasks, upload what is asked for, and acknowledge the policies." />
              <CardBody>
                {openOnboarding.map((c) => (
                  <ChecklistTasks key={c.id} checklist={{ ...c, tasks: c.tasks.filter((t) => t.ownerType === 'employee' || t.status !== 'open') }} viewer={viewer} today={data.today} onChanged={reload} />
                ))}
              </CardBody>
            </Card>
          ) : null}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="To do" icon={<CheckCircle2 />} />
              <CardBody flush>
                {data.reminders.length + myOpenTasks.length + policiesToAck.length + data.assignedToMe.length === 0 ? (
                  <EmptyState compact title="You are all caught up" />
                ) : (
                  <ul className="divide-y divide-slate-100 text-sm">
                    {policiesToAck.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                        <span>Acknowledge {p.title} v{p.version}</span>
                        <Button size="sm" variant="secondary" onClick={() => setTab('policies')}>Open</Button>
                      </li>
                    ))}
                    {data.reminders.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                        <span>{t.title}<span className="block text-xs text-slate-500">{t.detail}</span></span>
                        <StatusBadge size="sm" tone={t.severity === 'critical' ? 'danger' : t.severity === 'warning' ? 'warning' : 'info'}>{t.dueOn ? fmtDate(t.dueOn) : 'Now'}</StatusBadge>
                      </li>
                    ))}
                    {data.assignedToMe.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 px-5 py-2.5">
                        <span>{t.label}<span className="block text-xs text-slate-500">{titleCase(t.kind)} for {t.staffName} · due {fmtDate(t.dueOn)}</span></span>
                        <AssignedTaskButton taskId={t.id} onDone={reload} />
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="At a glance" />
              <CardBody className="space-y-3 text-sm">
                <div className="flex justify-between"><span>PTO balance</span><strong className="tabular-nums">{data.timeOff.balance.pto} h</strong></div>
                <div className="flex justify-between"><span>Sick & safe leave balance</span><strong className="tabular-nums">{data.timeOff.balance.sick} h</strong></div>
                <div className="flex justify-between"><span>Training compliance</span><strong>{data.training?.compliancePct == null ? '—' : `${data.training.compliancePct}%`}</strong></div>
                <div className="flex justify-between"><span>Credentials needing attention</span><strong>{attention.length}</strong></div>
                <div className="flex justify-between"><span>Manager</span><span>{r.managerName ?? '—'}</span></div>
              </CardBody>
            </Card>
          </div>
          {data.aiPolicyQa ? <PolicyQa /> : null}
          {data.discipline.filter((d) => !d.employeeAckAt).map((d) => (
            <DisciplineAck key={d.id} record={d} onDone={reload} />
          ))}
        </div>
      ) : null}

      {tab === 'profile' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="My profile" description="Changes go to HR for approval." actions={<Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditProfile(true)}>Request changes</Button>} />
            <CardBody>
              <FieldGrid>
                <Field label="Legal name">{[r.legalFirstName, r.legalMiddleName, r.legalLastName].filter(Boolean).join(' ') || '—'}</Field>
                <Field label="Preferred name">{String(r.preferredName ?? '—')}</Field>
                <Field label="Pronouns">{String(r.pronouns ?? '—')}</Field>
                <Field label="Personal email">{String(r.personalEmail ?? '—')}</Field>
                <Field label="Personal phone">{String(r.personalPhone ?? '—')}</Field>
                <Field label="Home address">{[r.addressLine1, r.addressLine2, [r.city, r.state, r.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</Field>
                <Field label="Job title">{r.jobTitle || '—'}</Field>
                <Field label="Hire date">{fmtDate(r.hireDate as string | null)}</Field>
                <Field label="Programs">{r.programs.join(', ') || '—'}</Field>
              </FieldGrid>
              <div className="mt-5">
                <p className="text-xs font-medium text-slate-500">Emergency contacts</p>
                {r.emergencyContacts?.length ? r.emergencyContacts.map((c, i) => <p key={i} className="text-sm">{c.name}{c.relationship ? ` (${c.relationship})` : ''} · {c.phone}</p>) : <p className="text-sm text-slate-500">None on file</p>}
              </div>
            </CardBody>
          </Card>
          {data.changeRequests.length ? (
            <Card>
              <CardHeader title="My change requests" />
              <CardBody flush>
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.changeRequests.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span>{Object.keys(c.changes).map(titleCase).join(', ')}<span className="block text-xs text-slate-500">{fmtDateTime(c.createdAt)}{c.reviewNote ? ` · ${c.reviewNote}` : ''}</span></span>
                      <StatusBadge size="sm" tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'}>{titleCase(c.status)}</StatusBadge>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === 'credentials' ? (
        <div className="space-y-4">
          <Alert tone="info">Renewed a license or certification? Upload the new document under Documents and HR will update and verify it.</Alert>
          <CredentialsPanel userId={r.userId} bundle={data.credentials} expirations={data.expirations} editable={false} canScan={false} onChanged={reload} />
        </div>
      ) : null}

      {tab === 'training' ? (
        <Card>
          <CardHeader title="Required trainings" description={data.training?.compliancePct != null ? `You are ${data.training.compliancePct}% current.` : undefined} actions={<Button size="sm" icon={<Plus />} onClick={() => setAddTraining(true)}>Add training / CEU</Button>} />
          <CardBody className="space-y-4">
            {data.training ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {data.requirements.filter((x) => x.active).map((req) => {
                  const c = data.training!.cells[req.id];
                  if (!c || c.status === 'not_required') return null;
                  return (
                    <li key={req.id} className="flex items-center justify-between gap-3 py-2">
                      <span>{req.name}<span className="block text-xs text-slate-500">{c.lastCompletedOn ? `Completed ${fmtDate(c.lastCompletedOn)}` : `Due ${fmtDate(c.dueOn)}`}</span></span>
                      <ExpiryBadge status={c.status} dueOn={c.dueOn} size="sm" />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {data.training?.ceu.map((c) => (
              <div key={c.credentialId}>
                <p className="text-sm">{c.title} CEUs ({fmtDate(c.cycleStart)} to {fmtDate(c.cycleEnd)})</p>
                {c.required == null ? <p className="text-xs text-slate-500">{c.earned} h recorded</p> : <ProgressBar pct={c.pct ?? 0} label={`${c.title} CEUs`} />}
              </div>
            ))}
            {data.training?.completions.length ? (
              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">History</p>
                <ul className="space-y-1 text-sm">
                  {data.training.completions.map((c) => <li key={c.id}>{c.title} · {fmtDate(c.completedOn)}{c.hours ? ` · ${c.hours} h` : ''} {c.status === 'pending_review' ? <StatusBadge size="sm" tone="warning">Waiting for HR</StatusBadge> : null}</li>)}
                </ul>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'timeoff' ? (
        <div className="space-y-4">
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <span>PTO <strong className="text-lg tabular-nums">{data.timeOff.balance.pto} h</strong></span>
                <span>Sick & safe leave <strong className="text-lg tabular-nums">{data.timeOff.balance.sick} h</strong></span>
              </div>
              <Button icon={<CalendarDays />} onClick={() => setRequestOff(true)}>Request time off</Button>
            </CardBody>
          </Card>
          <RequestList requests={data.timeOff.requests} onChanged={reload} compact />
        </div>
      ) : null}

      {tab === 'documents' ? <DocumentsPanel userId={r.userId} docs={data.documents} mode="self" expirations={data.expirations} onChanged={reload} /> : null}

      {tab === 'performance' ? (
        <div className="space-y-6">
          <ReviewList reviews={data.reviews} onOpen={setReview} hideName />
          <GoalsPanel goals={data.goals} people={[{ userId: r.userId, name: r.name }]} fixedUserId={r.userId} onChanged={reload} />
        </div>
      ) : null}

      {tab === 'policies' ? (
        <div className="space-y-6">
          {data.aiPolicyQa ? <PolicyQa /> : null}
          {data.policies.length === 0 ? <Card><EmptyState title="No policies published yet" icon={<BookOpen />} /></Card> : data.policies.map((p) => <PolicyCard key={p.id} policy={p} onDone={reload} />)}
        </div>
      ) : null}

      {tab === 'team' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="My team" icon={<Users />} description="Work information for the people you supervise." />
            <CardBody flush>
              <ul className="divide-y divide-slate-100">
                {data.team.map((t) => (
                  <li key={t.userId} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <Link href={`/dashboard/hr/people/${t.userId}`} className="text-sm font-medium text-slate-900 hover:text-blue-700">{t.name}<span className="block text-xs font-normal text-slate-500">{t.jobTitle || roleLabel(t.role)}</span></Link>
                    <span className="flex flex-wrap gap-2 text-xs">
                      {t.attention ? <StatusBadge size="sm" tone="warning">{t.attention} items due</StatusBadge> : <StatusBadge size="sm" tone="success">Current</StatusBadge>}
                      {t.pendingTimeOff ? <StatusBadge size="sm" tone="info">{t.pendingTimeOff} time-off pending</StatusBadge> : null}
                      {t.reviewsOpen ? <StatusBadge size="sm" tone="info">{t.reviewsOpen} review open</StatusBadge> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Team time off" description={data.timeOff.scheduleIntegration.message} />
            <CardBody flush><RequestList requests={data.teamTimeOff} onChanged={reload} onNotice={setNotice} /></CardBody>
          </Card>
          <ReviewList reviews={data.teamReviews} onOpen={setReview} />
          <GoalsPanel goals={data.teamGoals} people={data.team.map((t) => ({ userId: t.userId, name: t.name }))} onChanged={reload} />
        </div>
      ) : null}

      {editProfile ? <ChangeRequestModal record={r} onClose={() => setEditProfile(false)} onSaved={() => { setEditProfile(false); reload(); }} /> : null}
      {addTraining ? (
        <RecordCompletionModal
          selfOnly
          people={[{ userId: r.userId, name: r.name, licenses: data.training?.ceu.map((c) => ({ id: c.credentialId, title: c.title })) ?? [] }]}
          requirements={data.requirements.filter((x) => x.active)}
          initial={{ userId: r.userId }}
          onClose={() => setAddTraining(false)}
          onSaved={() => { setAddTraining(false); reload(); }}
        />
      ) : null}
      {requestOff ? <RequestTimeOffModal types={data.timeOff.types} onClose={() => setRequestOff(false)} onSaved={() => { setRequestOff(false); reload(); }} /> : null}
      {review ? <ReviewModal review={review} goals={[...data.goals, ...data.teamGoals].filter((g) => g.userId === review.userId)} aiEnabled onClose={() => setReview(null)} onChanged={() => { setReview(null); reload(); }} /> : null}
    </Page>
  );
}

function AssignedTaskButton({ taskId, onDone }: { taskId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        await hrFetch(`/api/hr/checklist-tasks/${taskId}`, { method: 'PATCH', json: { status: 'done' } }).catch(() => undefined);
        setBusy(false);
        onDone();
      }}
    >
      Mark done
    </Button>
  );
}

function PolicyCard({ policy, onDone }: { policy: Policy; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader
        title={`${policy.title} v${policy.version}`}
        icon={<BookOpen />}
        description={policy.acknowledgedAt ? `Acknowledged ${fmtDateTime(policy.acknowledgedAt)}` : policy.requiresAck ? 'Please read and acknowledge' : undefined}
        actions={<Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>{open ? 'Hide' : 'Read'}</Button>}
      />
      {open ? (
        <CardBody className="max-h-[480px] space-y-4 overflow-y-auto">
          {policy.sections.map((s) => (
            <section key={s.id}>
              <h3 className="text-sm font-semibold text-slate-900">{s.heading}</h3>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{s.text}</p>
            </section>
          ))}
        </CardBody>
      ) : null}
      {policy.requiresAck && !policy.acknowledgedAt ? (
        <CardBody className="flex flex-col gap-3 border-t border-slate-200 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> I have read this policy and agree to follow it.</label>
          <Button
            disabled={!agree}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              await hrFetch(`/api/hr/policies/${policy.id}`, { method: 'PATCH', json: {} }).catch(() => undefined);
              setBusy(false);
              onDone();
            }}
          >
            Acknowledge
          </Button>
        </CardBody>
      ) : null}
    </Card>
  );
}

function PolicyQa() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ans, setAns] = useState<{ data: { answer: string; citations: Array<{ policyTitle: string; heading: string }> }; engine: 'bedrock' | 'rules'; disclaimer: string } | null>(null);
  async function ask() {
    setBusy(true);
    setError(null);
    try {
      const r = await hrFetch<{ draft: NonNullable<typeof ans> }>('/api/hr/ai/policy', { method: 'POST', json: { question: q } });
      setAns(r.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not answer');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader title="Ask the handbook" icon={<MessageCircleQuestion />} description="Answers come only from the practice's published policies, with sections cited. Not legal advice." />
      <CardBody className="space-y-3">
        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 2) void ask(); }}>
          <TextInput aria-label="Question" placeholder="How do I request bereavement leave?" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" icon={<Send />} loading={busy} disabled={q.trim().length < 3}>Ask</Button>
        </form>
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {ans ? (
          <div className="space-y-2">
            <p className="whitespace-pre-wrap text-sm text-slate-800">{ans.data.answer}</p>
            {ans.data.citations.length ? (
              <ol className="list-decimal pl-5 text-xs text-slate-500">
                {ans.data.citations.map((c, i) => <li key={i}>[S{i + 1}] {c.policyTitle}: {c.heading}</li>)}
              </ol>
            ) : null}
            <div className="flex items-start gap-2 text-xs text-slate-500"><Sparkles className="h-3.5 w-3.5" aria-hidden /> {ans.disclaimer}</div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function DisciplineAck({ record, onDone }: { record: MyData['discipline'][number]; onDone: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <CardHeader title={`Please acknowledge: ${titleCase(record.actionType)} (${fmtDate(record.issuedOn)})`} description="Acknowledging confirms you received it; you can add your comment." />
      <CardBody className="space-y-3">
        <p className="whitespace-pre-wrap text-sm text-slate-700">{record.summary}</p>
        {record.expectations ? <p className="whitespace-pre-wrap text-sm text-slate-600">Expectations: {record.expectations}</p> : null}
        <TextArea rows={3} aria-label="Your comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex justify-end">
          <Button loading={busy} onClick={async () => { setBusy(true); await hrFetch(`/api/hr/discipline/${record.id}`, { method: 'PATCH', json: { comment: comment || null } }).catch(() => undefined); setBusy(false); onDone(); }}>Acknowledge</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ChangeRequestModal({ record, onClose, onSaved }: { record: MyData['record']; onClose: () => void; onSaved: () => void }) {
  const keys = ['legalFirstName', 'legalMiddleName', 'legalLastName', 'preferredName', 'pronouns', 'personalEmail', 'personalPhone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'] as const;
  const labels: Record<string, string> = { legalFirstName: 'Legal first name', legalMiddleName: 'Legal middle name', legalLastName: 'Legal last name', preferredName: 'Preferred name', pronouns: 'Pronouns', personalEmail: 'Personal email', personalPhone: 'Personal phone', addressLine1: 'Address', addressLine2: 'Address line 2', city: 'City', state: 'State', postalCode: 'ZIP' };
  const [f, setF] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, record[k] == null ? '' : String(record[k])])));
  const [contacts, setContacts] = useState(record.emergencyContacts ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const changes: Record<string, unknown> = {};
    for (const k of keys) {
      const before = record[k] == null ? '' : String(record[k]);
      if (f[k] !== before) changes[k] = f[k] === '' ? null : f[k];
    }
    if (JSON.stringify(contacts) !== JSON.stringify(record.emergencyContacts ?? [])) changes.emergencyContacts = contacts.filter((c) => c.name && c.phone);
    if (!Object.keys(changes).length) return onClose();
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/change-requests', { method: 'POST', json: { changes } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Request profile changes"
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save}>Send to HR</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {keys.map((k) => (
            <Labeled key={k} label={labels[k]}>
              <TextInput value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
            </Labeled>
          ))}
        </div>
        <EmergencyContactsEditor contacts={contacts} onChange={setContacts} />
      </div>
    </Modal>
  );
}
