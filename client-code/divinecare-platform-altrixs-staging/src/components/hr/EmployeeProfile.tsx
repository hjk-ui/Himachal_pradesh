'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ExternalLink, LogOut, Pencil, Plus, ShieldAlert, UserPlus } from 'lucide-react';
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
  buttonClasses,
} from '@/components/ui';
import { ExpiryBadge, Field, FieldGrid, Initials, Labeled, ProgressBar, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, fmtDateTime, fmtMoneyCents, hrFetch, PROGRAM_OPTIONS, roleLabel, titleCase, useHrData } from './hrClient';
import { CredentialsPanel, type CredentialBundle, type ExpirationRow } from './CredentialsPanel';
import { DocumentsPanel, type HrDoc } from './DocumentsPanel';
import { ChecklistTasks, type Checklist } from './ChecklistTasks';
import { RecordCompletionModal, type Requirement, type TrainingRow } from './TrainingHub';
import { LedgerEntryModal, RequestList, RequestTimeOffModal, type TimeOffRequest } from './TimeOffHub';
import { GoalsPanel, ReviewList, ReviewModal, type Goal, type Review } from './PerformanceHub';
import { HomebaseStaffPanel } from './HomebaseStaffPanel';

type Access = {
  personal: boolean;
  employment: boolean;
  compensation: boolean;
  separation: boolean;
  credentials: boolean;
  documents: boolean;
  training: boolean;
  timeOff: boolean;
  performance: boolean;
  discipline: boolean;
  editRecord: boolean;
  editCredentials: boolean;
};
type Rec = Record<string, unknown> & {
  userId: string;
  name: string;
  email: string;
  role: string;
  accountStatus: string;
  hrStatus: string;
  jobTitle: string;
  department: string;
  programs: string[];
  employmentType: string;
  managerName: string | null;
  managerUserId: string | null;
  clinicalSupervisorName: string | null;
  clinicalSupervisorUserId: string | null;
  supervisionTrack: { supervisorName: string; targetLicense: string; requiredHours: number } | null;
  locationNames: string[];
  credentialsSuffix: string | null;
  npi: string | null;
  licenseLevel: string | null;
  emergencyContacts?: Array<{ name: string; relationship?: string; phone: string; altPhone?: string }>;
};
type Discipline = { id: string; actionType: string; issuedOn: string; summary: string; expectations: string | null; issuedByName: string | null; sharedWithEmployee: boolean; employeeAckAt: string | null; employeeComment: string | null };
type ProfileData = {
  relationship: string;
  access: Access;
  record: Rec;
  account: { role: string; roles: string[]; status: string; drfirstLinked: boolean; createdAt: string } | null;
  credentials: CredentialBundle | null;
  expirations: ExpirationRow[];
  documents: HrDoc[];
  training: TrainingRow | null;
  requirements: Requirement[];
  timeOff: { requests: TimeOffRequest[]; balance: { pto: number; sick: number }; ledger: Array<{ id: string; bucket: string; entryType: string; hours: number; effectiveOn: string; note: string | null }> } | null;
  reviews: Review[];
  goals: Goal[];
  discipline: Discipline[];
  checklists: Checklist[];
  changeRequests: Array<{ id: string; changes: Record<string, unknown>; status: string; createdAt: string }>;
  people: Array<{ userId: string; name: string; role: string }>;
};

type TabKey = 'overview' | 'compensation' | 'credentials' | 'documents' | 'training' | 'timeoff' | 'performance' | 'onboarding' | 'discipline' | 'homebase' | 'account';

const v = (x: unknown) => (x == null || x === '' ? '—' : String(x));

export function EmployeeProfile({ userId }: { userId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, loading, reload } = useHrData<ProfileData>(`/api/hr/people/${userId}`);
  const [tab, setTab] = useState<TabKey>((params.get('tab') as TabKey) || 'overview');
  const [editing, setEditing] = useState<null | 'personal' | 'employment' | 'compensation' | 'credentialIds'>(null);
  const [recordTraining, setRecordTraining] = useState(false);
  const [ledger, setLedger] = useState(false);
  const [requestOff, setRequestOff] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [addDiscipline, setAddDiscipline] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (loading && !data) return <Page><LoadingState rows={8} /></Page>;
  if (error && !data) return <Page><ErrorState description={error} onRetry={reload} /></Page>;
  if (!data) return null;
  const { access, record: r } = data;
  const hrAdmin = data.relationship === 'hr' || data.relationship === 'leadership';
  const ops = data.relationship === 'office_manager';
  const changeTab = (k: TabKey) => {
    setTab(k);
    router.replace(`/dashboard/hr/people/${userId}?tab=${k}`, { scroll: false });
  };
  const attention = data.expirations.filter((e) => ['expired', 'missing', 'due_30', 'due_60'].includes(e.status));
  const tabs: Array<{ key: TabKey; label: string; count?: number; show: boolean }> = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'compensation', label: 'Compensation', show: access.compensation },
    { key: 'credentials', label: 'Credentials', count: attention.filter((a) => a.status === 'expired' || a.status === 'missing').length || undefined, show: access.credentials },
    { key: 'documents', label: 'Documents', show: access.documents || ops },
    { key: 'training', label: 'Training', show: access.training },
    { key: 'timeoff', label: 'Time off', show: access.timeOff },
    { key: 'performance', label: 'Performance', show: access.performance },
    { key: 'onboarding', label: 'Onboarding', show: hrAdmin || data.checklists.length > 0 },
    { key: 'discipline', label: 'Corrective action', show: access.discipline },
    { key: 'homebase', label: 'Hours (Homebase)', show: hrAdmin },
    { key: 'account', label: 'Altrixs account', show: hrAdmin },
  ];
  const visibleTabs = tabs.filter((t) => t.show);
  const activeTab = visibleTabs.some((t) => t.key === tab) ? tab : 'overview';
  const activeChecklists = data.checklists.filter((c) => c.status === 'active');

  return (
    <Page>
      <PageHeader
        eyebrow={<Link href="/dashboard/hr/people" className="hover:text-blue-700">People</Link>}
        title={
          <span className="flex items-center gap-3">
            <Initials name={r.name} size={44} />
            <span className="min-w-0 break-words">
              {r.name}
              {r.credentialsSuffix ? <span className="text-lg font-normal text-slate-500">, {r.credentialsSuffix}</span> : null}
            </span>
          </span>
        }
        badges={
          <>
            <StatusBadge tone={r.hrStatus === 'Active' ? 'success' : r.hrStatus === 'Terminated' ? 'neutral' : 'info'}>{r.hrStatus}</StatusBadge>
            {r.accountStatus === 'DEACTIVATED' ? <StatusBadge tone="neutral">Account deactivated</StatusBadge> : null}
          </>
        }
        description={[r.jobTitle || roleLabel(r.role), r.department, r.locationNames.join(', ')].filter(Boolean).join(' · ')}
        actions={
          hrAdmin ? (
            <>
              {!activeChecklists.some((c) => c.kind === 'onboarding') && r.hrStatus !== 'Terminated' ? (
                <Link className={buttonClasses({ variant: 'secondary' })} href="/dashboard/hr/onboarding"><UserPlus className="h-4 w-4" aria-hidden /> Onboarding</Link>
              ) : null}
              {r.hrStatus !== 'Terminated' && !activeChecklists.some((c) => c.kind === 'offboarding') ? (
                <Link className={buttonClasses({ variant: 'secondary' })} href="/dashboard/hr/offboarding"><LogOut className="h-4 w-4" aria-hidden /> Offboard</Link>
              ) : null}
            </>
          ) : null
        }
      />
      {notice ? <Alert tone="warning" actions={<Button size="sm" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice}</Alert> : null}
      {attention.length && access.credentials ? (
        <Alert tone={attention.some((a) => a.status === 'expired' || a.status === 'missing') ? 'danger' : 'warning'} title={`${attention.length} item${attention.length === 1 ? '' : 's'} need attention`}>
          {attention.slice(0, 5).map((a) => `${a.label} (${a.status === 'missing' ? 'missing' : `${a.status === 'expired' ? 'expired' : 'due'} ${fmtDate(a.dueOn)}`})`).join('; ')}
          {attention.length > 5 ? '…' : ''}
        </Alert>
      ) : null}
      <Tabs label="Employee record" value={activeTab} onChange={changeTab} items={visibleTabs.map((t) => ({ key: t.key, label: t.label, count: t.count }))} />

      {activeTab === 'overview' ? (
        <div className="space-y-6">
          {access.personal ? (
            <Card>
              <CardHeader title="Personal" actions={access.editRecord ? <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing('personal')}>Edit</Button> : null} />
              <CardBody>
                <FieldGrid>
                  <Field label="Legal name">{[r.legalFirstName, r.legalMiddleName, r.legalLastName].filter(Boolean).join(' ') || '—'}</Field>
                  <Field label="Preferred name">{v(r.preferredName)}</Field>
                  <Field label="Pronouns">{v(r.pronouns)}</Field>
                  <Field label="Date of birth">{fmtDate(r.dateOfBirth as string | null)}</Field>
                  <Field label="Personal email">{v(r.personalEmail)}</Field>
                  <Field label="Personal phone">{v(r.personalPhone)}</Field>
                  <Field label="Home address" className="sm:col-span-2">{[r.addressLine1, r.addressLine2, [r.city, r.state, r.postalCode].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</Field>
                </FieldGrid>
                <div className="mt-5">
                  <p className="text-xs font-medium text-slate-500">Emergency contacts</p>
                  {r.emergencyContacts?.length ? (
                    <ul className="mt-1 space-y-1 text-sm">
                      {r.emergencyContacts.map((c, i) => <li key={i}>{c.name}{c.relationship ? ` (${c.relationship})` : ''} · {c.phone}{c.altPhone ? ` · ${c.altPhone}` : ''}</li>)}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-500">None on file</p>
                  )}
                </div>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Employment" actions={access.editRecord ? <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing('employment')}>Edit</Button> : null} />
            <CardBody>
              <FieldGrid>
                <Field label="Job title">{v(r.jobTitle)}</Field>
                <Field label="Department">{v(r.department)}</Field>
                <Field label="Programs">{r.programs.length ? r.programs.join(', ') : '—'}</Field>
                <Field label="Locations">{r.locationNames.length ? r.locationNames.join(', ') : '—'}</Field>
                <Field label="Work email">{r.email}</Field>
                <Field label="Work phone">{v(r.workPhone)}</Field>
                {access.employment ? (
                  <>
                    <Field label="Employment">{v(r.employmentType)}</Field>
                    <Field label="Worker type">{r.workerType === 'W2' ? 'W-2' : r.workerType === 'PER_DIEM' ? 'Per diem' : v(r.workerType)}</Field>
                    <Field label="FTE">{v(r.fte)}</Field>
                    <Field label="Employee number">{v(r.employeeNumber)}</Field>
                    <Field label="Hire date">{fmtDate(r.hireDate as string | null)}</Field>
                    <Field label="End date">{fmtDate(r.terminationDate as string | null)}</Field>
                  </>
                ) : null}
                {access.separation && r.terminationDate ? (
                  <>
                    <Field label="Separation type">{titleCase(r.separationType as string | null)}</Field>
                    <Field label="Eligible for rehire">{r.rehireEligible == null ? '—' : r.rehireEligible ? 'Yes' : 'No'}</Field>
                  </>
                ) : null}
                <Field label="Manager">{r.managerUserId ? <Link className="text-blue-700 hover:underline" href={`/dashboard/hr/people/${r.managerUserId}`}>{r.managerName}</Link> : v(r.managerName)}</Field>
                <Field label="Clinical supervisor">{r.clinicalSupervisorName ?? (r.supervisionTrack ? r.supervisionTrack.supervisorName : '—')}</Field>
                <Field label="License level">{r.licenseLevel ? titleCase(r.licenseLevel) : 'Derived from credentials'}</Field>
                {r.supervisionTrack ? <Field label="Licensure track">{r.supervisionTrack.targetLicense} · {r.supervisionTrack.requiredHours} supervised hours</Field> : null}
              </FieldGrid>
            </CardBody>
          </Card>
          {access.credentials ? (
            <Card>
              <CardHeader title="Credentialing identifiers" actions={access.editRecord ? <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing('credentialIds')}>Edit</Button> : null} />
              <CardBody>
                <FieldGrid>
                  <Field label="NPI (Type 1)">{r.npi ? <a className="inline-flex items-center gap-1 text-blue-700 hover:underline" target="_blank" rel="noreferrer" href={`https://npiregistry.cms.hhs.gov/provider-view/${r.npi}`}>{r.npi} <ExternalLink className="h-3 w-3" aria-hidden /></a> : '—'}</Field>
                  <Field label="CAQH ID">{v(r.caqhId)}</Field>
                  <Field label="Maryland Medicaid (ePREP) number">{v(r.medicaidProviderId)}</Field>
                  <Field label="DEA number">{v(r.deaNumber)}</Field>
                </FieldGrid>
              </CardBody>
            </Card>
          ) : null}
          {hrAdmin && data.changeRequests.some((c) => c.status === 'pending') ? (
            <Alert tone="info" title="Profile changes waiting for approval">Approve or reject them from the HR dashboard.</Alert>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'compensation' ? (
        <Card>
          <CardHeader title="Compensation summary" description="HR and leadership only. Bank accounts, SSN and tax forms stay in the payroll system; Altrixs keeps the payroll reference." actions={access.editRecord ? <Button size="sm" variant="secondary" icon={<Pencil />} onClick={() => setEditing('compensation')}>Edit</Button> : null} />
          <CardBody>
            <FieldGrid>
              <Field label="Pay type">{titleCase(r.payType as string | null)}</Field>
              <Field label="Rate">{r.payRateCents == null ? '—' : `${fmtMoneyCents(r.payRateCents as number)}${r.payType === 'hourly' ? ' / hour' : r.payType === 'per_visit' ? ' / visit' : r.payType === 'salary' ? ' / year' : ''}`}</Field>
              <Field label="Effective">{fmtDate(r.compEffectiveOn as string | null)}</Field>
              <Field label="Payroll system">{v(r.payrollSystem)}</Field>
              <Field label="Payroll employee ID">{v(r.payrollExternalId)}</Field>
            </FieldGrid>
          </CardBody>
        </Card>
      ) : null}

      {activeTab === 'credentials' && data.credentials ? (
        <CredentialsPanel userId={userId} bundle={data.credentials} expirations={data.expirations} editable={access.editCredentials} canScan={access.editCredentials} onChanged={reload} />
      ) : null}

      {activeTab === 'documents' ? (
        <DocumentsPanel userId={userId} docs={data.documents} mode={hrAdmin ? 'hr' : ops ? 'ops' : 'read'} expirations={data.expirations} onChanged={reload} />
      ) : null}

      {activeTab === 'training' ? (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Required trainings"
              description={data.training?.compliancePct != null ? `Compliance ${data.training.compliancePct}%` : undefined}
              actions={hrAdmin || ops ? <Button size="sm" icon={<Plus />} onClick={() => setRecordTraining(true)}>Record completion</Button> : null}
            />
            <CardBody flush>
              {!data.training || data.requirements.filter((x) => x.active).length === 0 ? (
                <EmptyState compact title="No required trainings set up" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {data.requirements.filter((x) => x.active).map((req) => {
                    const c = data.training!.cells[req.id];
                    if (!c || c.status === 'not_required') return null;
                    return (
                      <li key={req.id} className="flex items-center justify-between gap-2 px-5 py-2.5 text-sm">
                        <span>{req.name}<span className="block text-xs text-slate-500">{c.lastCompletedOn ? `Completed ${fmtDate(c.lastCompletedOn)}` : 'Not completed'}</span></span>
                        <ExpiryBadge status={c.status} dueOn={c.dueOn} size="sm" />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
          {data.training?.ceu.length ? (
            <Card>
              <CardHeader title="CEUs per license cycle" />
              <CardBody className="space-y-3">
                {data.training.ceu.map((c) => (
                  <div key={c.credentialId}>
                    <p className="text-sm">{c.title} <span className="text-xs text-slate-500">({fmtDate(c.cycleStart)} to {fmtDate(c.cycleEnd)})</span></p>
                    {c.required == null ? <p className="text-xs text-amber-700">{c.earned} h earned · CEU target not set for this license type</p> : <ProgressBar pct={c.pct ?? 0} label={`${c.title} CEUs`} tone={(c.pct ?? 0) >= 100 ? 'success' : 'warning'} />}
                  </div>
                ))}
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Completion history" />
            <CardBody flush>
              {data.training?.completions.length ? (
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.training.completions.map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span>{c.title}<span className="block text-xs text-slate-500">{fmtDate(c.completedOn)}{c.hours ? ` · ${c.hours} h` : ''}{c.ceuEligible ? ' · CEU' : ''}{c.provider ? ` · ${c.provider}` : ''}</span></span>
                      {c.status === 'pending_review' ? <StatusBadge size="sm" tone="warning">Waiting for HR</StatusBadge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState compact title="No completions recorded" />
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {activeTab === 'timeoff' && data.timeOff ? (
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Balances"
              actions={
                <>
                  {hrAdmin ? <Button size="sm" variant="secondary" onClick={() => setLedger(true)}>Accrue / adjust</Button> : null}
                  {hrAdmin ? <Button size="sm" icon={<Plus />} onClick={() => setRequestOff(true)}>Enter request</Button> : null}
                </>
              }
            />
            <CardBody>
              <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                <span>PTO <strong className="text-lg tabular-nums">{data.timeOff.balance.pto} h</strong></span>
                <span>Sick & safe leave <strong className="text-lg tabular-nums">{data.timeOff.balance.sick} h</strong></span>
              </div>
            </CardBody>
          </Card>
          <RequestList requests={data.timeOff.requests} onChanged={reload} onNotice={setNotice} compact />
          {data.timeOff.ledger.length ? (
            <Card>
              <CardHeader title="Balance history" />
              <CardBody flush>
                <ul className="divide-y divide-slate-100 text-sm">
                  {data.timeOff.ledger.map((l) => (
                    <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2">
                      <span>{fmtDate(l.effectiveOn)} · {l.bucket === 'pto' ? 'PTO' : 'Sick'} {titleCase(l.entryType)}{l.note ? ` · ${l.note}` : ''}</span>
                      <span className={l.hours < 0 ? 'tabular-nums text-rose-700' : 'tabular-nums text-emerald-700'}>{l.hours > 0 ? '+' : ''}{l.hours} h</span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {activeTab === 'performance' ? (
        <div className="space-y-6">
          <ReviewList reviews={data.reviews} onOpen={setReview} hideName />
          <GoalsPanel goals={data.goals} people={[{ userId, name: r.name }]} fixedUserId={userId} onChanged={reload} />
        </div>
      ) : null}

      {activeTab === 'onboarding' ? (
        data.checklists.length === 0 ? (
          <Card><EmptyState title="No onboarding or offboarding checklist" action={hrAdmin ? <Link className={buttonClasses({})} href="/dashboard/hr/onboarding">Start onboarding</Link> : undefined} /></Card>
        ) : (
          <div className="space-y-6">
            {data.checklists.map((c) => (
              <Card key={c.id}>
                <CardHeader title={`${titleCase(c.kind)}: ${c.templateName}`} description={`${c.kind === 'onboarding' ? 'Start' : 'Last day'} ${fmtDate(c.startOn)} · ${titleCase(c.status)}`} />
                <CardBody>
                  <ChecklistTasks checklist={c} today={new Date().toISOString().slice(0, 10)} viewer={{ userId: '', role: '', hrAdmin }} onChanged={reload} />
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {activeTab === 'discipline' ? (
        <Card>
          <CardHeader
            title="Corrective action"
            icon={<ShieldAlert />}
            description="HR and leadership only. Records marked shared are shown to the employee to acknowledge."
            actions={<Button size="sm" icon={<Plus />} onClick={() => setAddDiscipline(true)}>Add record</Button>}
          />
          <CardBody flush>
            {data.discipline.length === 0 ? (
              <EmptyState compact title="No corrective action on file" />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.discipline.map((d) => (
                  <li key={d.id} className="space-y-1 px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900">{titleCase(d.actionType)}</span>
                      <span className="text-xs text-slate-500">{fmtDate(d.issuedOn)} · {d.issuedByName}</span>
                      {d.sharedWithEmployee ? (d.employeeAckAt ? <StatusBadge size="sm" tone="success">Acknowledged {fmtDateTime(d.employeeAckAt)}</StatusBadge> : <StatusBadge size="sm" tone="warning">Waiting for acknowledgment</StatusBadge>) : <StatusBadge size="sm">Not shared</StatusBadge>}
                    </div>
                    <p className="whitespace-pre-wrap text-slate-700">{d.summary}</p>
                    {d.expectations ? <p className="whitespace-pre-wrap text-slate-600">Expectations: {d.expectations}</p> : null}
                    {d.employeeComment ? <p className="text-xs text-slate-500">Employee comment: {d.employeeComment}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      ) : null}

      {activeTab === 'homebase' && hrAdmin ? <HomebaseStaffPanel userId={userId} /> : null}

      {activeTab === 'account' && data.account ? (
        <Card>
          <CardHeader title="Altrixs account" description="Role and access are managed by an administrator in Staff admin." actions={<Link className={buttonClasses({ variant: 'secondary', size: 'sm' })} href="/dashboard/admin">Open staff admin</Link>} />
          <CardBody>
            <FieldGrid>
              <Field label="Role">{roleLabel(data.account.role)}</Field>
              <Field label="Other roles">{data.account.roles.filter((x) => x !== data.account!.role).map(roleLabel).join(', ') || '—'}</Field>
              <Field label="Account status">{titleCase(data.account.status)}</Field>
              <Field label="DrFirst (Rcopia) linked">{data.account.drfirstLinked ? 'Yes' : 'No'}</Field>
              <Field label="Account created">{fmtDateTime(data.account.createdAt)}</Field>
            </FieldGrid>
          </CardBody>
        </Card>
      ) : null}

      {editing ? <EditRecordModal section={editing} record={r} people={data.people.filter((p) => p.userId !== userId)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
      {recordTraining && data.training ? (
        <RecordCompletionModal
          people={[{ userId, name: r.name, licenses: data.training.ceu.map((c) => ({ id: c.credentialId, title: c.title })) }]}
          requirements={data.requirements.filter((x) => x.active)}
          initial={{ userId }}
          onClose={() => setRecordTraining(false)}
          onSaved={() => { setRecordTraining(false); reload(); }}
        />
      ) : null}
      {ledger ? <LedgerEntryModal userId={userId} name={r.name} sickRate={null} onClose={() => setLedger(false)} onSaved={() => { setLedger(false); reload(); }} /> : null}
      {requestOff ? (
        <RequestTimeOffModal
          types={[{ key: 'pto', label: 'PTO / vacation' }, { key: 'sick', label: 'Sick & safe leave' }, { key: 'unpaid', label: 'Unpaid leave' }, { key: 'bereavement', label: 'Bereavement' }, { key: 'jury_duty', label: 'Jury duty' }, { key: 'fmla', label: 'FMLA / medical leave' }, { key: 'other', label: 'Other' }]}
          people={[{ userId, name: r.name }]}
          onClose={() => setRequestOff(false)}
          onSaved={() => { setRequestOff(false); reload(); }}
        />
      ) : null}
      {review ? <ReviewModal review={review} goals={data.goals} aiEnabled onClose={() => setReview(null)} onChanged={() => { setReview(null); reload(); }} /> : null}
      {addDiscipline ? <DisciplineModal userId={userId} onClose={() => setAddDiscipline(false)} onSaved={() => { setAddDiscipline(false); reload(); }} /> : null}
    </Page>
  );
}

function EditRecordModal({
  section,
  record,
  people,
  onClose,
  onSaved,
}: {
  section: 'personal' | 'employment' | 'compensation' | 'credentialIds';
  record: Rec;
  people: Array<{ userId: string; name: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const s = (k: string) => (record[k] == null ? '' : String(record[k]));
  const [f, setF] = useState<Record<string, string>>(() => {
    const keys: Record<string, string[]> = {
      personal: ['legalFirstName', 'legalMiddleName', 'legalLastName', 'preferredName', 'pronouns', 'dateOfBirth', 'personalEmail', 'personalPhone', 'addressLine1', 'addressLine2', 'city', 'state', 'postalCode'],
      employment: ['jobTitle', 'department', 'employmentType', 'workerType', 'fte', 'employeeNumber', 'hrStatus', 'hireDate', 'terminationDate', 'separationType', 'managerUserId', 'clinicalSupervisorUserId', 'workPhone'],
      compensation: ['payType', 'payRateCents', 'compEffectiveOn', 'payrollSystem', 'payrollExternalId'],
      credentialIds: ['npi', 'caqhId', 'medicaidProviderId', 'deaNumber'],
    };
    const init: Record<string, string> = {};
    for (const k of keys[section]) init[k] = k === 'payRateCents' ? (record.payRateCents == null ? '' : String((record.payRateCents as number) / 100)) : s(k);
    return init;
  });
  const [programs, setPrograms] = useState<string[]>(record.programs ?? []);
  const [contacts, setContacts] = useState(record.emergencyContacts ?? []);
  const [rehire, setRehire] = useState<string>(record.rehireEligible == null ? '' : String(record.rehireEligible));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, val: string) => setF((x) => ({ ...x, [k]: val }));
  const text = (k: string, label: string, type = 'text') => (
    <Labeled label={label}><TextInput type={type} value={f[k] ?? ''} onChange={(e) => set(k, e.target.value)} /></Labeled>
  );

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(f)) {
        if (k === 'fte') body[k] = val === '' ? null : Number(val);
        else if (k === 'payRateCents') body[k] = val === '' ? null : Math.round(Number(val) * 100);
        else body[k] = val === '' ? null : val;
      }
      if (section === 'employment') {
        body.programs = programs;
        body.rehireEligible = rehire === '' ? null : rehire === 'true';
        if (!body.jobTitle) body.jobTitle = '';
        if (!body.department) body.department = '';
        if (!['Full-Time', 'Part-Time', 'Per Diem', 'Contract'].includes(String(body.employmentType))) delete body.employmentType;
        if (!body.hrStatus) delete body.hrStatus;
      }
      if (section === 'personal') body.emergencyContacts = contacts.filter((c) => c.name && c.phone);
      if (section === 'credentialIds' && body.npi == null) body.npi = '';
      await hrFetch(`/api/hr/people/${record.userId}`, { method: 'PATCH', json: body });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const titles = { personal: 'Edit personal information', employment: 'Edit employment', compensation: 'Edit compensation summary', credentialIds: 'Edit credentialing identifiers' };
  return (
    <Modal
      title={titles[section]}
      size="lg"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {section === 'personal' ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {text('legalFirstName', 'Legal first name')}
              {text('legalMiddleName', 'Legal middle name')}
              {text('legalLastName', 'Legal last name')}
              {text('preferredName', 'Preferred name')}
              {text('pronouns', 'Pronouns')}
              {text('dateOfBirth', 'Date of birth', 'date')}
              {text('personalEmail', 'Personal email', 'email')}
              {text('personalPhone', 'Personal phone', 'tel')}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {text('addressLine1', 'Address')}
              {text('addressLine2', 'Address line 2')}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {text('city', 'City')}
              {text('state', 'State')}
              {text('postalCode', 'ZIP')}
            </div>
            <EmergencyContactsEditor contacts={contacts} onChange={setContacts} />
          </>
        ) : null}
        {section === 'employment' ? (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {text('jobTitle', 'Job title')}
              {text('department', 'Department')}
              {text('workPhone', 'Work phone', 'tel')}
              <Labeled label="Employment">
                <Select value={f.employmentType} onChange={(e) => set('employmentType', e.target.value)}>
                  {['Full-Time', 'Part-Time', 'Per Diem', 'Contract'].map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Labeled>
              <Labeled label="Worker type">
                <Select value={f.workerType} onChange={(e) => set('workerType', e.target.value)}>
                  <option value="">Not set</option>
                  <option value="W2">W-2</option>
                  <option value="1099">1099</option>
                  <option value="PER_DIEM">Per diem</option>
                </Select>
              </Labeled>
              {text('fte', 'FTE (0.1 to 1.0)', 'number')}
              {text('employeeNumber', 'Employee number')}
              <Labeled label="HR status">
                <Select value={f.hrStatus} onChange={(e) => set('hrStatus', e.target.value)}>
                  {['Active', 'On Leave', 'Onboarding', 'Offboarding', 'Terminated'].map((x) => <option key={x}>{x}</option>)}
                </Select>
              </Labeled>
              {text('hireDate', 'Hire date', 'date')}
              {text('terminationDate', 'End date', 'date')}
              <Labeled label="Separation type">
                <Select value={f.separationType} onChange={(e) => set('separationType', e.target.value)}>
                  <option value="">Not set</option>
                  {['voluntary', 'involuntary', 'retirement', 'end_of_contract', 'other'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
                </Select>
              </Labeled>
              <Labeled label="Eligible for rehire">
                <Select value={rehire} onChange={(e) => setRehire(e.target.value)}>
                  <option value="">Not set</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </Labeled>
              <Labeled label="Manager">
                <Select value={f.managerUserId} onChange={(e) => set('managerUserId', e.target.value)}>
                  <option value="">Not set</option>
                  {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
              </Labeled>
              <Labeled label="Clinical supervisor" hint="Pre-licensed staff">
                <Select value={f.clinicalSupervisorUserId} onChange={(e) => set('clinicalSupervisorUserId', e.target.value)}>
                  <option value="">Not set</option>
                  {people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
                </Select>
              </Labeled>
            </div>
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Programs</legend>
              <div className="flex flex-wrap gap-3">
                {PROGRAM_OPTIONS.map((p) => (
                  <label key={p} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" checked={programs.includes(p)} onChange={(e) => setPrograms(e.target.checked ? [...programs, p] : programs.filter((x) => x !== p))} />
                    {p}
                  </label>
                ))}
              </div>
            </fieldset>
            <p className="text-xs text-slate-500">Locations and Altrixs roles are set by an administrator in Staff admin.</p>
          </>
        ) : null}
        {section === 'compensation' ? (
          <>
            <Alert tone="info">Do not enter bank, routing or Social Security numbers. Keep them in the payroll system and record its employee ID here.</Alert>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Labeled label="Pay type">
                <Select value={f.payType} onChange={(e) => set('payType', e.target.value)}>
                  <option value="">Not set</option>
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary (annual)</option>
                  <option value="per_visit">Per visit</option>
                </Select>
              </Labeled>
              {text('payRateCents', 'Rate (USD)', 'number')}
              {text('compEffectiveOn', 'Effective', 'date')}
              {text('payrollSystem', 'Payroll system')}
              {text('payrollExternalId', 'Payroll employee ID')}
            </div>
          </>
        ) : null}
        {section === 'credentialIds' ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {text('npi', 'NPI (10 digits)')}
            {text('caqhId', 'CAQH ID')}
            {text('medicaidProviderId', 'Maryland Medicaid (ePREP) number')}
            {text('deaNumber', 'DEA number')}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export function EmergencyContactsEditor({
  contacts,
  onChange,
}: {
  contacts: Array<{ name: string; relationship?: string; phone: string; altPhone?: string }>;
  onChange: (c: Array<{ name: string; relationship?: string; phone: string; altPhone?: string }>) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-700">Emergency contacts</legend>
      {contacts.map((c, i) => (
        <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <TextInput aria-label="Name" placeholder="Name" value={c.name} onChange={(e) => onChange(contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
          <TextInput aria-label="Relationship" placeholder="Relationship" value={c.relationship ?? ''} onChange={(e) => onChange(contacts.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)))} />
          <TextInput aria-label="Phone" placeholder="Phone" value={c.phone} onChange={(e) => onChange(contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} />
          <Button size="sm" variant="ghost" onClick={() => onChange(contacts.filter((_, j) => j !== i))}>Remove</Button>
        </div>
      ))}
      {contacts.length < 4 ? <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => onChange([...contacts, { name: '', relationship: '', phone: '' }])}>Add contact</Button> : null}
    </fieldset>
  );
}

function DisciplineModal({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ actionType: 'written_warning', issuedOn: new Date().toISOString().slice(0, 10), summary: '', expectations: '', sharedWithEmployee: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await hrFetch('/api/hr/discipline', { method: 'POST', json: { userId, ...f, expectations: f.expectations || null } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Corrective action record"
      size="md"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.summary.trim()}>Save</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Action">
            <Select value={f.actionType} onChange={(e) => setF({ ...f, actionType: e.target.value })}>
              {['coaching', 'verbal_warning', 'written_warning', 'final_warning', 'pip', 'suspension', 'termination'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Date"><TextInput type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} /></Labeled>
        </div>
        <Labeled label="What happened (facts, dates; no client identifiers)"><TextArea rows={5} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Labeled>
        <Labeled label="Expectations and next steps"><TextArea rows={3} value={f.expectations} onChange={(e) => setF({ ...f, expectations: e.target.value })} /></Labeled>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.sharedWithEmployee} onChange={(e) => setF({ ...f, sharedWithEmployee: e.target.checked })} /> Share with the employee for acknowledgment</label>
      </div>
    </Modal>
  );
}
