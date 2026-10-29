'use client';

/**
 * One intensive program episode: screening and admission (criteria, LOCUS / ASAM, consents,
 * authorization, PHP psychiatric evaluation, team), weekly hours with the weekly team review (PHP:
 * psychiatrist / NP review), attendance, missed-day outreach, discharge / step-down with the
 * post-discharge follow-up window. Data: GET / PATCH /api/intensive/enrollments/[id].
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ClipboardCheck, FileText, LogOut, Save, Stethoscope, Users, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { criteriaFor, CARE_LEVEL_LABEL, DISCHARGE_REASON_LABEL, type CareLevel, type ProgramType } from '@/lib/intensive/types';
import { stepDownOptions } from '@/lib/intensive/rules';
import {
  AuthCell, Badge, Card, FOLLOWUP_LABEL, PLAN_LABEL, Part2Badge, STATUS_CLS, STATUS_LABEL, WEEK_CLS, WEEK_LABEL,
  btnPrimary, btnSecondary, errText, inputCls, type EnrollmentRow, type Program, type WeekC,
} from '../shared';
import { Alert, Card as UiCard, LoadingState, Page, PageHeader } from '@/components/ui';

type Screening = { criteria?: Record<string, boolean>; criteriaOverride?: string | null; locusRecordId?: string | null; asamScores?: Record<string, number> | null; levelNote?: string | null; screenedAt?: string; screenedByName?: string | null };
type Detail = {
  today: string;
  program: Program;
  enrollment: EnrollmentRow & {
    referralSource: string | null; referralReason: string | null; screening: Screening; priorAuthId: string | null;
    psychEvalDate: string | null; psychEvalNoteId: string | null; primaryClinicianId: string | null; prescriberId: string | null; caseManagerId: string | null;
    treatmentPlanId: string | null; aftercarePlan: string | null; dischargeSummaryNoteId: string | null; followUpAppointmentId: string | null;
    followUpDate: string | null; followUpProvider: string | null; transitionNotes: string | null; clientAgeYears: number | null;
  };
  readiness: { items: { key: string; label: string; ok: boolean; blocking: boolean }[]; canAdmit: boolean; blockers: string[] } | null;
  weeks: Array<WeekC & { review: { id: string; summary: string; by: string | null; prescriberBy: string | null; prescriberAt: string | null } | null; teamDone: boolean; prescriberRequired: boolean; prescriberDone: boolean; missing: string[] }>;
  attendance: Array<{ id: string; serviceDate: string; blockKey: string; sessionType: string; status: string; minutes: number | null; progressNoteId: string | null; counted: number }>;
  followUps: Array<{ id: string; serviceDate: string; dueAt: string; status: string; outcome: string | null; attempts: Array<{ at: string; byName: string | null; method: string; outcome: string; note: string | null }> }>;
  options: {
    auths: Array<{ id: string; payer: string; authNumber: string | null; unitsApproved: number; unitsUsed: number; codes: string[]; startDate: string | null; endDate: string | null; status: string }>;
    locus: Array<{ id: string; type: string; date: string; score: number; level: string }>;
    notes: Array<{ id: string; type: string | null; date: string }>;
    plans: Array<{ id: string; title: string; status: string; signedOn: string | null }>;
    appointments: Array<{ id: string; type: string; date: string; status: string; clinician: string | null }>;
  };
};
type Staff = { id: string; name: string; role: string };

const PSYCH_EVAL_TYPES = /psych(iatric)? (eval|intake)|psych intake|re-?eval/i;

export default function IntensiveEnrollmentPage() {
  const { enrollmentId } = useParams<{ enrollmentId: string }>();
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [d, setD] = useState<Detail | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ data: Detail }>(`/api/intensive/enrollments/${encodeURIComponent(enrollmentId)}`);
      setD(r.data);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  }, [enrollmentId]);
  useEffect(() => {
    void load();
    apiJson<{ options: { staff: Staff[] } }>('/api/intensive/options').then((r) => setStaff(r.options.staff)).catch(() => setStaff([]));
  }, [load]);

  const patch = async (body: Record<string, unknown>, msg: string) => {
    setErr(null);
    try {
      await apiJson(`/api/intensive/enrollments/${encodeURIComponent(enrollmentId)}`, { method: 'PATCH', body: JSON.stringify(body) });
      setNotice(msg);
      setTimeout(() => setNotice(null), 4000);
      await load();
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  };

  if (!d) {
    return (
      <Page className="max-w-5xl">
        <Link href="/dashboard/programs/intensive" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"><ArrowLeft size={14} aria-hidden /> Programs</Link>
        {err ? <Alert tone="danger">{err}</Alert> : <UiCard><LoadingState label="Loading…" /></UiCard>}
      </Page>
    );
  }
  const e = d.enrollment;
  const open = e.status === 'referred' || e.status === 'screening';
  const decide = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP'].includes(role);

  return (
    <Page className="max-w-5xl">
      <Link href="/dashboard/programs/intensive" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline"><ArrowLeft size={14} aria-hidden /> Programs</Link>
      <PageHeader
        title={canAccessPath(role, '/dashboard/clients') ? <Link href={`/dashboard/clients/${e.clientId}`} className="hover:text-blue-700">{e.clientName}</Link> : e.clientName}
        badges={<>{e.part2 && <Part2Badge />}<Badge cls={STATUS_CLS[e.status]}>{STATUS_LABEL[e.status]}</Badge></>}
        description={<>{d.program.name} · {d.program.typeLabel} · {d.program.ageGroup} · referred {e.referralDate}{e.admissionDate ? ` · admitted ${e.admissionDate}` : ''}{e.dischargeDate ? ` · discharged ${e.dischargeDate}` : ''}</>}
      />
      {err && <Alert tone="danger">{err}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}

      {open && <Admission d={d} staff={staff} decide={decide} patch={patch} role={role} />}
      {!open && e.status !== 'declined' && <Team d={d} staff={staff} decide={decide} patch={patch} />}
      {(e.status === 'admitted' || e.status === 'discharged') && <Weeks d={d} role={role} decide={decide} patch={patch} />}
      {(e.status === 'admitted' || e.status === 'discharged') && <Attendance d={d} />}
      {e.status === 'admitted' && decide && <Discharge d={d} patch={patch} />}
      {e.status === 'discharged' && <DischargeSummary d={d} />}
      {e.status === 'declined' && <Card title="Not admitted"><p className="text-sm text-slate-700">{e.transitionNotes ?? e.dischargeReason}</p></Card>}
    </Page>
  );
}

type Patch = (body: Record<string, unknown>, msg: string) => Promise<boolean>;

function StaffSelect({ label, value, onChange, staff, roles }: { label: string; value: string; onChange: (v: string) => void; staff: Staff[]; roles: string[] }) {
  return (
    <label className="text-xs font-medium text-slate-600">{label}
      <select className={`${inputCls} mt-1`} value={value} onChange={(ev) => onChange(ev.target.value)}>
        <option value="">Not assigned</option>
        {staff.filter((s) => roles.includes(s.role)).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.role.toLowerCase().replace('_', ' ')})</option>)}
      </select>
    </label>
  );
}

const CLIN = ['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

// ─── Screening & admission ──────────────────────────────────────────────────

function Admission({ d, staff, decide, patch, role }: { d: Detail; staff: Staff[]; decide: boolean; patch: Patch; role: string }) {
  const e = d.enrollment;
  const type = d.program.programType as ProgramType;
  const s = e.screening ?? {};
  const [criteria, setCriteria] = useState<Record<string, boolean>>(s.criteria ?? {});
  const [override, setOverride] = useState(s.criteriaOverride ?? '');
  const [locusId, setLocusId] = useState(s.locusRecordId ?? '');
  const [asam, setAsam] = useState<Record<string, string>>(() => Object.fromEntries(['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'].map((k) => [k, s.asamScores?.[k] !== undefined ? String(s.asamScores?.[k]) : ''])));
  const [levelNote, setLevelNote] = useState(s.levelNote ?? '');
  const [authId, setAuthId] = useState(e.priorAuthId ?? '');
  const [newAuth, setNewAuth] = useState({ payer: 'Carelon (Maryland PBHS)', authNumber: '', unitsApproved: '', startDate: d.today, endDate: '' });
  const [addAuth, setAddAuth] = useState(false);
  const [psychEvalDate, setPsychEvalDate] = useState(e.psychEvalDate ?? '');
  const [psychEvalNoteId, setPsychEvalNoteId] = useState(e.psychEvalNoteId ?? '');
  const [admissionDate, setAdmissionDate] = useState(e.admissionDate ?? '');
  const [primary, setPrimary] = useState(e.primaryClinicianId ?? '');
  const [prescriber, setPrescriber] = useState(e.prescriberId ?? '');
  const [cm, setCm] = useState(e.caseManagerId ?? '');
  const [declineReason, setDeclineReason] = useState('');
  const sud = type === 'SUD_IOP' || e.part2;
  const asamFilled = Object.values(asam).filter((v) => v !== '').length;

  const save = () => {
    const asamScores = asamFilled === 6 ? Object.fromEntries(Object.entries(asam).map(([k, v]) => [k, Number(v)])) : null;
    return patch(
      {
        action: 'update',
        ...(decide ? { screening: { criteria, criteriaOverride: override || null, locusRecordId: locusId || null, asamScores, levelNote: levelNote || null } } : {}),
        ...(addAuth && newAuth.unitsApproved && newAuth.endDate
          ? { newAuth: { payer: newAuth.payer, authNumber: newAuth.authNumber || null, unitsApproved: Number(newAuth.unitsApproved), startDate: newAuth.startDate, endDate: newAuth.endDate } }
          : { priorAuthId: authId || null }),
        psychEvalDate: psychEvalDate || null,
        psychEvalNoteId: psychEvalNoteId || null,
        ...(decide ? { admissionDate: admissionDate || null, primaryClinicianId: primary || null, prescriberId: prescriber || null } : {}),
        caseManagerId: cm || null,
      },
      'Saved.',
    );
  };

  return (
    <>
      <Card title="Level-of-care screening" icon={<ClipboardCheck size={16} className="text-blue-700" aria-hidden />} right={s.screenedAt ? <span className="text-xs text-slate-500">Last saved {s.screenedAt.slice(0, 10)}{s.screenedByName ? ` by ${s.screenedByName}` : ''}</span> : null}>
        {e.referralReason && <p className="mb-2 text-sm text-slate-700"><span className="font-semibold">Referral:</span> {e.referralReason}{e.referralSource ? ` (from ${e.referralSource})` : ''}</p>}
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Admission criteria (practice checklist; the clinician&apos;s level-of-care decision decides)</p>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {criteriaFor(type).map((c) => (
            <label key={c.key} className="flex items-start gap-2 text-sm"><input type="checkbox" disabled={!decide} className="mt-0.5 accent-blue-700" checked={Boolean(criteria[c.key])} onChange={(ev) => setCriteria({ ...criteria, [c.key]: ev.target.checked })} /> {c.label}</label>
          ))}
        </div>
        <label className="mt-2 block text-xs font-medium text-slate-600">Clinical override (when a criterion is not met but this level is still indicated)
          <textarea className={`${inputCls} mt-1`} rows={2} disabled={!decide} value={override} onChange={(ev) => setOverride(ev.target.value)} />
        </label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-slate-600">LOCUS / CALOCUS record
            <select className={`${inputCls} mt-1`} disabled={!decide} value={locusId} onChange={(ev) => setLocusId(ev.target.value)}>
              <option value="">None linked</option>
              {d.options.locus.map((l) => <option key={l.id} value={l.id}>{l.type} {l.date} · score {l.score} · {l.level}</option>)}
            </select>
            <Link href="/dashboard/ehr/locus" className="mt-1 inline-block text-[11px] text-blue-700 hover:underline">Complete a LOCUS / CALOCUS</Link>
          </label>
          <div className="text-xs font-medium text-slate-600">ASAM dimensions 1-6 (0-4){sud ? ' · required for SUD' : ''}
            <div className="mt-1 grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-6">
              {Object.keys(asam).map((k, i) => (
                <select key={k} aria-label={`ASAM dimension ${i + 1}`} disabled={!decide} className="h-10 rounded-lg border border-slate-200 bg-white px-1 text-xs sm:h-8" value={asam[k]} onChange={(ev) => setAsam({ ...asam, [k]: ev.target.value })}>
                  <option value="">D{i + 1}</option>
                  {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>D{i + 1}: {n}</option>)}
                </select>
              ))}
            </div>
            {asamFilled > 0 && asamFilled < 6 && <p className="mt-1 text-[11px] text-amber-800">Rate all six dimensions, or leave all blank.</p>}
          </div>
        </div>
        <label className="mt-2 block text-xs font-medium text-slate-600">Level-of-care note<textarea className={`${inputCls} mt-1`} rows={2} disabled={!decide} value={levelNote} onChange={(ev) => setLevelNote(ev.target.value)} /></label>
      </Card>

      <Card title="Authorization, evaluation and team" icon={<Users size={16} className="text-blue-700" aria-hidden />}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-xs font-medium text-slate-600">Authorization (Carelon / payer)
            {!addAuth ? (
              <>
                <select className={`${inputCls} mt-1`} value={authId} onChange={(ev) => setAuthId(ev.target.value)}>
                  <option value="">None yet</option>
                  {d.options.auths.map((a) => <option key={a.id} value={a.id}>{a.payer} {a.authNumber ?? ''} · {a.unitsApproved} units · {a.startDate ?? '?'} to {a.endDate ?? '?'} ({a.status.toLowerCase()})</option>)}
                </select>
                <button type="button" className="mt-1 text-[11px] text-blue-700 hover:underline" onClick={() => setAddAuth(true)}>Record a new authorization</button>
              </>
            ) : (
              <div className="mt-1 grid grid-cols-2 gap-1">
                <input className={inputCls} value={newAuth.payer} onChange={(ev) => setNewAuth({ ...newAuth, payer: ev.target.value })} aria-label="Payer" />
                <input className={inputCls} value={newAuth.authNumber} placeholder="Auth number" onChange={(ev) => setNewAuth({ ...newAuth, authNumber: ev.target.value })} aria-label="Authorization number" />
                <input className={inputCls} type="number" min={1} value={newAuth.unitsApproved} placeholder="Units approved" onChange={(ev) => setNewAuth({ ...newAuth, unitsApproved: ev.target.value })} aria-label="Units approved" />
                <span />
                <input className={inputCls} type="date" value={newAuth.startDate} onChange={(ev) => setNewAuth({ ...newAuth, startDate: ev.target.value })} aria-label="Start date" />
                <input className={inputCls} type="date" value={newAuth.endDate} onChange={(ev) => setNewAuth({ ...newAuth, endDate: ev.target.value })} aria-label="End date" />
                <button type="button" className="col-span-2 text-left text-[11px] text-blue-700 hover:underline" onClick={() => setAddAuth(false)}>Pick an existing authorization instead</button>
              </div>
            )}
          </div>
          <div className="text-xs font-medium text-slate-600">Psychiatric evaluation{type === 'PHP' ? ' (required for PHP)' : ''}
            <div className="mt-1 grid grid-cols-2 gap-1">
              <input type="date" className={inputCls} value={psychEvalDate} max={d.today} onChange={(ev) => setPsychEvalDate(ev.target.value)} aria-label="Evaluation date" />
              <select className={inputCls} value={psychEvalNoteId} onChange={(ev) => { setPsychEvalNoteId(ev.target.value); const n = d.options.notes.find((x) => x.id === ev.target.value); if (n) setPsychEvalDate(n.date); }} aria-label="Evaluation note">
                <option value="">Link the note</option>
                {d.options.notes.filter((n) => PSYCH_EVAL_TYPES.test(n.type ?? '')).map((n) => <option key={n.id} value={n.id}>{n.type} {n.date}</option>)}
              </select>
            </div>
          </div>
          <label className="text-xs font-medium text-slate-600">Admission date<input type="date" disabled={!decide} className={`${inputCls} mt-1`} value={admissionDate} onChange={(ev) => setAdmissionDate(ev.target.value)} /></label>
          <StaffSelect label="Primary clinician" value={primary} onChange={setPrimary} staff={staff} roles={CLIN} />
          <StaffSelect label={`Psychiatrist / NP${type === 'PHP' ? ' (required for PHP)' : ''}`} value={prescriber} onChange={setPrescriber} staff={staff} roles={['PSYCHIATRIST', 'NP']} />
          <StaffSelect label="Case manager" value={cm} onChange={setCm} staff={staff} roles={['CASE_MANAGER', ...CLIN]} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {canAccessPath(role, '/dashboard/ehr/consents') && <Link href={`/dashboard/ehr/consents?clientId=${e.clientId}`} className="text-blue-700 hover:underline">Consents (treatment{e.part2 ? ', 42 CFR Part 2' : ''}, group confidentiality)</Link>}
        </div>
        <div className="mt-3 flex justify-end"><button className={btnPrimary} onClick={save}><Save size={14} aria-hidden /> Save</button></div>
      </Card>

      {d.readiness && (
        <Card title="Admission checklist" icon={<CheckCircle2 size={16} className="text-blue-700" aria-hidden />}>
          <ul className="grid gap-1 sm:grid-cols-2">
            {d.readiness.items.map((i) => (
              <li key={i.key} className="flex items-start gap-2 text-sm">
                {i.ok ? <CheckCircle2 size={15} className="mt-0.5 text-emerald-700" aria-hidden /> : <XCircle size={15} className={`mt-0.5 ${i.blocking ? 'text-rose-600' : 'text-amber-700'}`} aria-hidden />}
                <span>{i.label}{!i.ok && !i.blocking ? ' (recommended)' : ''}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-500">Save first; the checklist reflects saved data and signed consents on file.</p>
          {decide && (
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-0 sm:flex-1 sm:flex-row sm:items-end">
                <input className={`${inputCls} sm:min-w-[16rem] sm:flex-1`} placeholder="Reason not admitted (and where referred)" value={declineReason} onChange={(ev) => setDeclineReason(ev.target.value)} aria-label="Reason not admitted" />
                <button className={btnSecondary} disabled={!declineReason.trim()} onClick={() => patch({ action: 'decline', reason: declineReason }, 'Recorded as not admitted.')}>Not admitted</button>
              </div>
              <button className={btnPrimary} disabled={!d.readiness.canAdmit} onClick={() => patch({ action: 'admit' }, 'Admitted.')}>Admit</button>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ─── Team & plan (admitted / discharged) ────────────────────────────────────

function Team({ d, staff, decide, patch }: { d: Detail; staff: Staff[]; decide: boolean; patch: Patch }) {
  const e = d.enrollment;
  const [primary, setPrimary] = useState(e.primaryClinicianId ?? '');
  const [prescriber, setPrescriber] = useState(e.prescriberId ?? '');
  const [cm, setCm] = useState(e.caseManagerId ?? '');
  const [planId, setPlanId] = useState(e.treatmentPlanId ?? '');
  const [authId, setAuthId] = useState(e.priorAuthId ?? '');
  const editable = e.status === 'admitted' && decide;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Team and treatment plan" icon={<Users size={16} className="text-blue-700" aria-hidden />}>
        {editable ? (
          <div className="grid gap-2">
            <StaffSelect label="Primary clinician" value={primary} onChange={setPrimary} staff={staff} roles={CLIN} />
            <StaffSelect label="Psychiatrist / NP" value={prescriber} onChange={setPrescriber} staff={staff} roles={['PSYCHIATRIST', 'NP']} />
            <StaffSelect label="Case manager" value={cm} onChange={setCm} staff={staff} roles={['CASE_MANAGER', ...CLIN]} />
            <label className="text-xs font-medium text-slate-600">Program treatment plan
              <select className={`${inputCls} mt-1`} value={planId} onChange={(ev) => setPlanId(ev.target.value)}>
                <option value="">Newest plan signed after admission</option>
                {d.options.plans.map((p) => <option key={p.id} value={p.id}>{p.title} · {p.status.toLowerCase()}{p.signedOn ? ` · signed ${p.signedOn}` : ''}</option>)}
              </select>
            </label>
            <button className={btnSecondary} onClick={() => patch({ action: 'update', primaryClinicianId: primary || null, prescriberId: prescriber || null, caseManagerId: cm || null, treatmentPlanId: planId || null }, 'Team saved.')}><Save size={13} aria-hidden /> Save team</button>
          </div>
        ) : (
          <ul className="text-sm text-slate-700">
            <li>Primary clinician: {e.team.primaryClinician ?? '—'}</li>
            <li>Psychiatrist / NP: {e.team.prescriber ?? '—'}</li>
            <li>Case manager: {e.team.caseManager ?? '—'}</li>
          </ul>
        )}
        <div className="mt-3 text-sm">
          {e.plan.initialState !== 'done' ? (
            <p>Initial treatment plan due <strong>{e.plan.initialDue}</strong> <Badge cls={e.plan.initialState === 'overdue' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>{PLAN_LABEL[e.plan.initialState]}</Badge></p>
          ) : (
            <p>Plan review due <strong>{e.plan.nextReviewDue}</strong> <Badge cls={e.plan.reviewState === 'overdue' ? 'bg-rose-100 text-rose-800' : e.plan.reviewState === 'due' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}>{PLAN_LABEL[e.plan.reviewState]}</Badge></p>
          )}
          <Link href={`/dashboard/ehr/treatment-plans?clientId=${e.clientId}`} className="text-xs text-blue-700 hover:underline">Open treatment plans</Link>
        </div>
      </Card>
      <Card title="Authorization" icon={<FileText size={16} className="text-blue-700" aria-hidden />}>
        <AuthCell a={e.auth} />
        {e.auth?.reasons.length ? <ul className="mt-2 list-disc pl-5 text-xs text-rose-700">{e.auth.reasons.map((r) => <li key={r}>{r}</li>)}</ul> : null}
        {editable && (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <select className={`${inputCls} min-w-0 sm:flex-1`} value={authId} onChange={(ev) => setAuthId(ev.target.value)} aria-label="Authorization">
              <option value="">None</option>
              {d.options.auths.map((a) => <option key={a.id} value={a.id}>{a.payer} {a.authNumber ?? ''} · {a.unitsApproved} units · to {a.endDate ?? '?'}</option>)}
            </select>
            <button className={btnSecondary} onClick={() => patch({ action: 'update', priorAuthId: authId || null }, 'Authorization linked.')}>Link</button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Units used = the larger of claim units and charge-draft units for the codes the authorization covers. Renewal lead time {d.program.policy.authRenewalLeadDays.value} days{d.program.policy.authRenewalLeadDays.isDefault ? ' (practice policy — confirm)' : ''}.</p>
        <Link href="/dashboard/billing/authorizations" className="text-xs text-blue-700 hover:underline">Authorizations</Link>
      </Card>
    </div>
  );
}

// ─── Weekly hours & review ──────────────────────────────────────────────────

function Weeks({ d, role, decide, patch }: { d: Detail; role: string; decide: boolean; patch: Patch }) {
  const [week, setWeek] = useState<string | null>(null);
  const [summary, setSummary] = useState('');
  const [planChanges, setPlanChanges] = useState('');
  const [loc, setLoc] = useState('');
  const prescriber = role === 'PSYCHIATRIST' || role === 'NP';
  return (
    <Card title={`Weekly hours (minimum ${d.program.policy.minWeeklyHours.value} h${d.program.policy.minWeeklyHours.isDefault ? ', practice policy — confirm' : ''}) and team review`} icon={<Stethoscope size={16} className="text-blue-700" aria-hidden />}>
      <div className="clinic-scroll-x"><table className="w-full min-w-[680px] text-sm">
        <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600"><th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2">Week of</th><th scope="col" className="px-3 py-2">Hours</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2">Team review</th><th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-slate-50">
          {d.weeks.map((w) => (
            <tr key={w.weekStart} className="align-top">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-2">{w.weekStart}</td>
              <td className="px-3 py-2">{w.hours} / {w.requiredHours} h <span className="text-xs text-slate-500">({w.eligibleDays} of {w.programDays} program days)</span></td>
              <td className="px-3 py-2"><Badge cls={WEEK_CLS[w.status]}>{WEEK_LABEL[w.status]}</Badge></td>
              <td className="px-3 py-2 text-xs">
                {w.review ? <span>{w.review.summary.slice(0, 120)}{w.review.summary.length > 120 ? '…' : ''} <span className="text-slate-500">({w.review.by})</span></span> : <span className="text-slate-500">None</span>}
                {w.prescriberRequired && (w.prescriberDone ? <p className="text-emerald-700">Psychiatrist / NP review: {w.review?.prescriberBy}</p> : <p className="text-rose-700">Psychiatrist / NP review required (PHP)</p>)}
              </td>
              <td className="px-3 py-2 text-right">
                {d.enrollment.status === 'admitted' && (decide || prescriber) && (
                  <button className={btnSecondary} onClick={() => { setWeek(w.weekStart); setSummary(w.review?.summary ?? ''); }}>{w.review ? 'Update' : 'Write review'}</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
      {week && (
        <div className="mt-3 space-y-2 rounded-xl border border-blue-100 p-3">
          <p className="text-xs font-semibold text-slate-700">Team review, week of {week}</p>
          <textarea className={inputCls} rows={3} placeholder="Progress, attendance, risk, goals" value={summary} onChange={(ev) => setSummary(ev.target.value)} disabled={!decide} aria-label="Review summary" />
          <input className={inputCls} placeholder="Plan changes" value={planChanges} onChange={(ev) => setPlanChanges(ev.target.value)} disabled={!decide} aria-label="Plan changes" />
          <input className={inputCls} placeholder="Level of care decision (continue / step down / step up)" value={loc} onChange={(ev) => setLoc(ev.target.value)} disabled={!decide} aria-label="Level of care decision" />
          <div className="flex flex-wrap justify-end gap-2">
            <button className={btnSecondary} onClick={() => setWeek(null)}>Cancel</button>
            {decide && <button className={btnPrimary} disabled={!summary.trim()} onClick={async () => { if (await patch({ action: 'review', weekStart: week, summary, planChanges: planChanges || null, levelOfCareDecision: loc || null }, 'Weekly review saved.')) setWeek(null); }}>Save review</button>}
            {prescriber && <button className={btnPrimary} onClick={async () => { if (await patch({ action: 'review', weekStart: week, summary: summary || null, prescriberSign: true }, 'Psychiatrist / NP review signed.')) setWeek(null); }}>Sign as psychiatrist / NP</button>}
          </div>
        </div>
      )}
    </Card>
  );
}

function Attendance({ d }: { d: Detail }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Recent attendance">
        {!d.attendance.length ? <p className="text-sm text-slate-500">No attendance recorded.</p> : (
          <ul className="max-h-72 space-y-1 overflow-auto text-sm">
            {d.attendance.slice(0, 60).map((a) => (
              <li key={a.id} className="flex justify-between gap-2"><span>{a.serviceDate} · {a.blockKey} · {a.sessionType}</span><span className="text-slate-600">{a.status.replace('_', ' ')}{a.counted ? ` · ${a.counted} min` : ''}</span></li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Missed-day outreach">
        {!d.followUps.length ? <p className="text-sm text-slate-500">No missed days.</p> : (
          <ul className="max-h-72 space-y-2 overflow-auto text-sm">
            {d.followUps.map((f) => (
              <li key={f.id}>
                <p>{f.serviceDate} · <Badge cls={f.status === 'open' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}>{f.status === 'open' ? 'Open' : 'Done'}</Badge> {f.outcome ?? ''}</p>
                <ul className="pl-3 text-xs text-slate-600">{f.attempts.map((a) => <li key={a.at}>{a.at.slice(0, 16).replace('T', ' ')} · {a.method.replace('_', ' ')} · {a.outcome}{a.byName ? ` (${a.byName})` : ''}</li>)}</ul>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-slate-500">Log attempts from the Missed-day outreach tab on the program page.</p>
      </Card>
    </div>
  );
}

// ─── Discharge ──────────────────────────────────────────────────────────────

function Discharge({ d, patch }: { d: Detail; patch: Patch }) {
  const type = d.program.programType as ProgramType;
  const levels = stepDownOptions(type);
  const [date, setDate] = useState(d.today);
  const [reason, setReason] = useState('completed');
  const [level, setLevel] = useState<CareLevel>(levels[0]);
  const [aftercare, setAftercare] = useState('');
  const [summaryNote, setSummaryNote] = useState('');
  const [apptId, setApptId] = useState('');
  const [fuDate, setFuDate] = useState('');
  const [fuProvider, setFuProvider] = useState('');
  const [transition, setTransition] = useState('');
  const windowDays = d.program.policy.followUpWindowDays;
  return (
    <Card title="Discharge / step-down" icon={<LogOut size={16} className="text-blue-700" aria-hidden />}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-xs font-medium text-slate-600">Discharge date<input type="date" className={`${inputCls} mt-1`} value={date} max={d.today} onChange={(ev) => setDate(ev.target.value)} /></label>
        <label className="text-xs font-medium text-slate-600">Reason
          <select className={`${inputCls} mt-1`} value={reason} onChange={(ev) => setReason(ev.target.value)}>
            {Object.entries(DISCHARGE_REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600">Next level of care
          <select className={`${inputCls} mt-1`} value={level} onChange={(ev) => setLevel(ev.target.value as CareLevel)}>
            {levels.map((l) => <option key={l} value={l}>{CARE_LEVEL_LABEL[l]}</option>)}
          </select>
        </label>
        <label className="text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-3">Aftercare plan (services, appointments, medications hand-off, crisis resources including 988)
          <textarea className={`${inputCls} mt-1`} rows={3} value={aftercare} onChange={(ev) => setAftercare(ev.target.value)} />
        </label>
        <label className="text-xs font-medium text-slate-600">Discharge summary note
          <select className={`${inputCls} mt-1`} value={summaryNote} onChange={(ev) => setSummaryNote(ev.target.value)}>
            <option value="">Not linked yet</option>
            {d.options.notes.filter((n) => /discharge/i.test(n.type ?? '')).map((n) => <option key={n.id} value={n.id}>{n.type} {n.date}</option>)}
          </select>
          <Link href={`/dashboard/ehr/notes?clientId=${d.enrollment.clientId}`} className="mt-1 inline-block text-[11px] text-blue-700 hover:underline">Write the Discharge Summary note</Link>
        </label>
        <label className="text-xs font-medium text-slate-600">Follow-up appointment (within {windowDays.value} days{windowDays.isDefault ? ', practice policy — confirm' : ''})
          <select className={`${inputCls} mt-1`} value={apptId} onChange={(ev) => setApptId(ev.target.value)}>
            <option value="">Not booked here</option>
            {d.options.appointments.filter((a) => a.date > date).map((a) => <option key={a.id} value={a.id}>{a.date} · {a.type}{a.clinician ? ` · ${a.clinician}` : ''}</option>)}
          </select>
          <Link href={`/dashboard/appointments?clientId=${d.enrollment.clientId}`} className="mt-1 inline-block text-[11px] text-blue-700 hover:underline">Book a follow-up</Link>
        </label>
        {!apptId && (
          <div className="text-xs font-medium text-slate-600">Follow-up with another provider
            <div className="mt-1 grid grid-cols-2 gap-1">
              <input type="date" className={inputCls} value={fuDate} onChange={(ev) => setFuDate(ev.target.value)} aria-label="Follow-up date" />
              <input className={inputCls} value={fuProvider} placeholder="Provider" onChange={(ev) => setFuProvider(ev.target.value)} aria-label="Follow-up provider" />
            </div>
          </div>
        )}
        <label className="text-xs font-medium text-slate-600 sm:col-span-2 lg:col-span-3">Transition of care (records sent, receiving provider contact; Part 2 records need a consent)
          <textarea className={`${inputCls} mt-1`} rows={2} value={transition} onChange={(ev) => setTransition(ev.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          className={btnPrimary}
          disabled={!aftercare.trim()}
          onClick={() =>
            patch(
              {
                action: 'discharge',
                dischargeDate: date,
                reason,
                stepDownLevel: level,
                aftercarePlan: aftercare,
                dischargeSummaryNoteId: summaryNote || null,
                followUpAppointmentId: apptId || null,
                followUpDate: apptId ? null : fuDate || null,
                followUpProvider: fuProvider || null,
                transitionNotes: transition || null,
              },
              'Discharged.',
            )
          }
        >
          <LogOut size={14} aria-hidden /> Discharge
        </button>
      </div>
    </Card>
  );
}

function DischargeSummary({ d }: { d: Detail }) {
  const e = d.enrollment;
  return (
    <Card title="Discharge" icon={<LogOut size={16} className="text-blue-700" aria-hidden />}>
      <ul className="space-y-1 text-sm text-slate-700">
        <li>Discharged {e.dischargeDate} · {DISCHARGE_REASON_LABEL[e.dischargeReason as keyof typeof DISCHARGE_REASON_LABEL] ?? e.dischargeReason}</li>
        <li>Next level: {CARE_LEVEL_LABEL[e.stepDownLevel as CareLevel] ?? e.stepDownLevel ?? '—'}</li>
        <li>Aftercare: {e.aftercarePlan}</li>
        <li>Discharge summary note: {e.dischargeSummaryNoteId ? 'linked' : <span className="text-amber-700">not linked</span>}</li>
        <li>
          Follow-up: {e.followUpDate ?? 'not recorded'}{e.followUpProvider ? ` with ${e.followUpProvider}` : ''}{' '}
          {e.followUp && <Badge cls={e.followUp.state === 'met' || e.followUp.state === 'scheduled' ? 'bg-emerald-100 text-emerald-800' : e.followUp.state === 'not_expected' ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-800'}>{FOLLOWUP_LABEL[e.followUp.state]} (window ends {e.followUp.windowEnd})</Badge>}
        </li>
        {e.transitionNotes && <li>Transition: {e.transitionNotes}</li>}
      </ul>
    </Card>
  );
}
