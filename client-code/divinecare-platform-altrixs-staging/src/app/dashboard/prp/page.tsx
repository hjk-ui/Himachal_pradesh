'use client';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Users, Target, BarChart3, ClipboardList, GraduationCap, TrendingUp, CreditCard, FileText, AlertTriangle,
  Stethoscope, UserPlus, Send, Download, Plus, CalendarCheck, Inbox, Save, Info, Settings, ShieldCheck,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { Alert, Card, EmptyState, LoadingState, Page, PageHeader, StatCard, StatGrid, StatusBadge, Tabs, buttonClasses, cx, inputClasses, type Tone } from '@/components/ui';
import { QUALIFYING_CODE_GROUPS } from './prpShared';
import { MORS_LEVELS } from '@/lib/prp/billingRule';
import { PRP_BILLING_MODEL_OPTIONS, PRP_BILLING_MODELS, PRP_DISCHARGE_TYPES, dischargeIssues, type PrpAuthSummary, type PrpBillingModel } from '@/lib/prp/standard';

// Every number on this page comes from GET /api/prp/hub or /api/prp/reports (Altrixs records).

type Participant = {
  enrollmentId: string; clientId: string; name: string; displayId: string | null; status: string;
  enrolledDate: string | null; specialistId: string | null; specialist: string | null; diagnosisCode: string;
  irpStatus: 'draft' | 'final' | null; irpReviewDue: string | null; irpReviewState: 'none' | 'overdue' | 'due_30' | 'ok';
  irpGoals: number; lastServiceDate: string | null; encountersThisMonth: number; morsThisMonth: number | null;
  morsDue: boolean; incompleteEncountersThisMonth: number; monthlyMinimum: { state: 'not_set' | 'met' | 'below'; label: string };
  auth: PrpAuthSummary | null;
  dischargedAt: string | null; dischargeReason: string | null; dischargeType: string | null; transitionPlan: string | null; aftercarePlan: string | null;
};
type PrpSettings = {
  billing: { model: PrpBillingModel | null; confirmed: boolean; label: string; detail: string; confirmedByName: string | null; confirmedAt: string | null };
  monthlyMinContacts: number | null; monthlyMinLabel: string;
  irpReviewDays: number; irpReviewDaysChild: number; irpReviewLabel: string;
  policyUpdatedAt: string | null; policyUpdatedByName: string | null;
};
type Referral = { id: string; displayId: string | null; clientId: string | null; name: string; diagnosisCode: string; referralDate: string | null; prescriber: string };
type Group = { id: string; name: string; schedule: string | null; facilitatorId: string | null; facilitator: string | null; location: string | null; active: boolean };
type Hub = {
  month: string;
  stats: {
    activeParticipants: number; encountersThisMonth: number; participantsServedThisMonth: number; referralsAwaiting: number; irpReviewsDue30: number; activeWithoutFinalIrp: number;
    morsDueThisMonth: number | null; incompleteEncountersThisMonth: number;
  };
  participants: Participant[];
  referrals: Referral[];
  groups: Group[];
  goalsByNeed: { need: string; goals: number; finalGoals: number; participants: number }[];
  referralDomains: { domain: string; participants: number }[];
  billingRule: { confirmed: boolean; model: PrpBillingModel | null; label: string; note: string; confirmedByName: string | null; confirmedAt: string | null; sources: readonly { label: string; url: string }[] };
  settings: PrpSettings;
  canEditSettings: boolean;
  canWrite: boolean;
  canChangeStatus: boolean;
};
type RosterRow = {
  enrollmentId: string; name: string; displayId: string | null; present: boolean; minutes: number | null; billable: boolean; note: string | null;
  location: string | null; irpGoal: string | null; intervention: string | null; response: string | null;
};
type Report = {
  type: string; title: string; month: string; columns: { key: string; label: string }[]; rows: Record<string, unknown>[];
  unitRuleLabel?: string; ruleNote?: string; goalStatusNote?: string; recorded?: number;
};
type Specialist = { id: string; name: string };
type Notify = (m: string, e?: boolean) => void;
type Tab = 'participants' | 'referrals' | 'attendance' | 'goals' | 'reports' | 'settings' | 'codes';

const STATUS_LABEL: Record<string, string> = { active: 'Active', on_hold: 'On hold', transitioning: 'Transitioning', discharged: 'Discharged' };
const STATUS_TONE: Record<string, Tone> = {
  active: 'success', on_hold: 'neutral', transitioning: 'warning', discharged: 'neutral',
};

const REPORTS = [
  { type: 'monthly-progress', title: 'Monthly Progress Report', desc: 'Per participant: encounters by type, last service, IRP status and review date, IRP goal counts, MORS', icon: TrendingUp },
  { type: 'billing-summary', title: 'Medicaid PRP Billing Summary', desc: 'Encounters per participant for the month (billable / non-billable). Units are not calculated.', icon: CreditCard },
  { type: 'group-attendance', title: 'Group Attendance Log', desc: 'Sessions held, attendances and unique participants per group', icon: ClipboardList },
  { type: 'transition', title: 'Transition Planning Report', desc: 'Participants transitioning, on hold or discharged (status changes in the month)', icon: GraduationCap },
  { type: 'mors', title: 'Outcome Measures (MORS)', desc: 'Milestones of Recovery Scale rating per participant for the month', icon: BarChart3 },
] as const;

function thisMonth() { return new Date().toISOString().slice(0, 7); }
function today() { return new Date().toISOString().slice(0, 10); }
function errText(e: unknown) { return e instanceof Error ? e.message : 'request failed'; }

export default function PRPPage() {
  const [tab, setTab] = useState<Tab>('participants');
  const [hub, setHub] = useState<Hub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showDischarged, setShowDischarged] = useState(false);
  const [flash, setFlash] = useState<{ msg: string; error?: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHub(await apiJson<Hub>('/api/prp/hub'));
      setError(null);
    } catch (e) {
      setError(`Could not load the PRP program: ${errText(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const notify = useCallback<Notify>((msg, isError = false) => {
    setFlash({ msg, error: isError });
    setTimeout(() => setFlash(null), 4000);
  }, []);

  const participants = hub?.participants ?? [];
  const q = search.toLowerCase();
  const filtered = participants.filter((p) =>
    (showDischarged || p.status !== 'discharged') &&
    (p.name.toLowerCase().includes(q) || (p.specialist ?? '').toLowerCase().includes(q)),
  );

  const stats = hub
    ? [
        { label: 'Active participants', value: hub.stats.activeParticipants, sub: 'active + transitioning enrollments', icon: Users, tone: 'brand' as const },
        { label: 'Encounters this month', value: hub.stats.encountersThisMonth, sub: `${hub.stats.participantsServedThisMonth} participants served · ${hub.stats.incompleteEncountersThisMonth} missing documentation`, icon: CalendarCheck, tone: 'success' as const },
        { label: 'Referrals awaiting enrollment', value: hub.stats.referralsAwaiting, sub: 'PRP referrals with no enrollment', icon: Inbox, tone: 'warning' as const },
        { label: 'IRP reviews due (30 days)', value: hub.stats.irpReviewsDue30, sub: `${hub.stats.activeWithoutFinalIrp} active without a finalized IRP${hub.stats.morsDueThisMonth != null ? ` · MORS due for ${hub.stats.morsDueThisMonth}` : ''}`, icon: Target, tone: 'warning' as const },
      ]
    : [];

  return (
    <Page>
      <PageHeader
        title="PRP Program"
        description="Psychiatric Rehabilitation Program · enrollments, encounters and reports from Altrixs records"
        actions={
          <>
            <Link href="/dashboard/prp/referral" className={buttonClasses({ variant: 'secondary' })}><Send size={16} aria-hidden /> PRP Referral</Link>
            <Link href="/dashboard/prp/assessment" className={buttonClasses({ variant: 'secondary' })}><ClipboardList size={16} aria-hidden /> Rehab Assessment</Link>
            <Link href="/dashboard/prp/irp" className={buttonClasses({ variant: 'secondary' })}><FileText size={16} aria-hidden /> IRP Builder</Link>
            <Link href="/dashboard/prp/enroll" className={buttonClasses()}><UserPlus size={16} aria-hidden /> Enroll Client</Link>
          </>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {flash && <Alert tone={flash.error ? 'danger' : 'success'}>{flash.msg}</Alert>}
      {loading && !hub && <Card><LoadingState label="Loading PRP records…" /></Card>}

      {hub && (
        <StatGrid columns={4}>
          {stats.map((s) => {
            const Icon = s.icon;
            return <StatCard key={s.label} label={s.label} value={s.value} hint={s.sub} icon={<Icon />} tone={s.tone} />;
          })}
        </StatGrid>
      )}

      <Card className="overflow-hidden">
        <Tabs
          label="PRP sections"
          controlsPanels={false}
          value={tab}
          onChange={setTab}
          className="px-2"
          items={([
            ['participants', 'Participants'],
            ['referrals', `Referrals${hub ? ` (${hub.referrals.length})` : ''}`],
            ['attendance', 'Groups & Attendance'],
            ['goals', 'IRP Goal Areas'],
            ['reports', 'Reports'],
            ['settings', 'Program Settings'],
            ['codes', 'Dx Codes'],
          ] as [Tab, string][]).map(([key, label]) => ({ key, label }))}
        />

        {tab === 'participants' && hub && (
          <ParticipantsTab hub={hub} rows={filtered} search={search} setSearch={setSearch} showDischarged={showDischarged} setShowDischarged={setShowDischarged} onChanged={load} notify={notify} />
        )}
        {tab === 'referrals' && hub && <ReferralsTab referrals={hub.referrals} />}
        {tab === 'attendance' && hub && <AttendanceTab hub={hub} onChanged={load} notify={notify} />}
        {tab === 'goals' && hub && <GoalsTab hub={hub} />}
        {tab === 'reports' && hub && <ReportsTab hub={hub} notify={notify} />}
        {tab === 'settings' && hub && <SettingsTab hub={hub} onChanged={load} notify={notify} />}
        {tab === 'codes' && <CodesTab hub={hub} />}
      </Card>
    </Page>
  );
}

// ─── Participants ───────────────────────────────────────────────────────────

function ParticipantsTab({ hub, rows, search, setSearch, showDischarged, setShowDischarged, onChanged, notify }: {
  hub: Hub; rows: Participant[]; search: string; setSearch: (v: string) => void; showDischarged: boolean; setShowDischarged: (v: boolean) => void;
  onChanged: () => Promise<void>; notify: Notify;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState('active');
  const [reason, setReason] = useState('');
  const [dischargeType, setDischargeType] = useState('');
  const [transitionPlan, setTransitionPlan] = useState('');
  const [aftercarePlan, setAftercarePlan] = useState('');
  const [mors, setMors] = useState('');
  const [busy, setBusy] = useState(false);

  const open = (p: Participant) => {
    setEditing(p.enrollmentId === editing ? null : p.enrollmentId);
    setStatus(p.status);
    setReason(p.dischargeReason ?? '');
    setDischargeType(p.dischargeType ?? '');
    setTransitionPlan(p.transitionPlan ?? '');
    setAftercarePlan(p.aftercarePlan ?? '');
    setMors(p.morsThisMonth ? String(p.morsThisMonth) : '');
  };
  const statusMissing = (p: Participant) =>
    status === p.status ? [] : dischargeIssues({ status, dischargeType, dischargeReason: reason, transitionPlan, aftercarePlan });

  const saveStatus = async (p: Participant) => {
    setBusy(true);
    try {
      await apiJson(`/api/prp/enrollments/${p.enrollmentId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status,
          dischargeReason: status === 'discharged' ? reason : null,
          dischargeType: status === 'discharged' ? dischargeType || null : null,
          aftercarePlan: status === 'discharged' ? aftercarePlan || null : null,
          transitionPlan: status === 'transitioning' || status === 'discharged' ? transitionPlan || null : null,
        }),
      });
      notify(`Status saved for ${p.name}`);
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const saveMors = async (p: Participant) => {
    if (!mors) return;
    setBusy(true);
    try {
      await apiJson('/api/prp/mors', { method: 'POST', body: JSON.stringify({ enrollmentId: p.enrollmentId, month: hub.month, rating: Number(mors) }) });
      notify(`MORS ${mors} recorded for ${p.name} (${hub.month})`);
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search participants or specialist…" aria-label="Search participants"
          className={cx(inputClasses, 'w-full min-w-0 sm:min-w-[16rem] sm:max-w-md sm:flex-[1_1_20rem]')} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showDischarged} onChange={(e) => setShowDischarged(e.target.checked)} className="accent-blue-600" /> Show discharged
        </label>
      </div>
      <div className="clinic-scroll-x">
        <table className="w-full min-w-[960px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-3 py-2.5 text-left">Participant</th>
              <th scope="col" className="px-3 py-2.5 text-left">PRP specialist</th>
              <th scope="col" className="px-3 py-2.5 text-left">IRP</th>
              <th scope="col" className="px-3 py-2.5 text-left">Last service</th>
              <th scope="col" className="px-3 py-2.5 text-left">Encounters ({hub.month})</th>
              <th scope="col" className="px-3 py-2.5 text-left">Authorization</th>
              <th scope="col" className="px-3 py-2.5 text-left">Status</th>
              <th scope="col" className="sticky right-0 z-10 bg-slate-50 px-3 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                {hub.participants.length === 0 ? 'No PRP enrollments in your caseload yet. Enroll a client to start.' : 'No participants match.'}
              </td></tr>
            )}
            {rows.map((p) => (
              <Fragment key={p.enrollmentId}>
                <tr className="group hover:bg-slate-50">
                  <td className="sticky left-0 z-10 max-w-[16rem] bg-white px-3 py-3 group-hover:bg-slate-50">
                    <Link href={`/dashboard/clients/${p.clientId}`} className="text-sm font-medium text-slate-900 hover:text-blue-700">{p.name}</Link>
                    <p className="text-xs text-slate-500">{p.displayId ?? 'No PRP ID'} · enrolled {p.enrolledDate ?? 'date not recorded'} · {p.diagnosisCode}</p>
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600">{p.specialist ?? <span className="text-slate-500">Unassigned</span>}</td>
                  <td className="px-3 py-3 text-xs">
                    {p.irpStatus === 'final' ? <span className="text-emerald-700 font-medium">Finalized</span> : p.irpStatus === 'draft' ? <span className="text-amber-700 font-medium">Draft</span> : <span className="text-slate-500">None on file</span>}
                    {p.irpReviewDue && (
                      <p className={p.irpReviewState === 'overdue' ? 'text-rose-600 font-semibold' : p.irpReviewState === 'due_30' ? 'text-amber-700' : 'text-slate-500'}>
                        Review {p.irpReviewState === 'overdue' ? 'overdue' : 'due'} {p.irpReviewDue}
                      </p>
                    )}
                    {p.irpGoals > 0 && <p className="text-slate-500">{p.irpGoals} goal{p.irpGoals === 1 ? '' : 's'}</p>}
                  </td>
                  <td className="px-3 py-3 text-sm text-slate-600">{p.lastServiceDate ?? <span className="text-slate-500">None recorded</span>}</td>
                  <td className="px-3 py-3 text-sm">
                    <p className="font-semibold text-slate-800">{p.encountersThisMonth}</p>
                    {p.status !== 'discharged' && (
                      <p className={`text-[11px] ${p.monthlyMinimum.state === 'below' ? 'text-amber-700 font-medium' : 'text-slate-500'}`}>{p.monthlyMinimum.label}</p>
                    )}
                    {p.incompleteEncountersThisMonth > 0 && <p className="text-[11px] text-rose-600">{p.incompleteEncountersThisMonth} missing documentation</p>}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {p.auth ? (
                      <>
                        <p className="text-slate-700">{p.auth.authNumber ? `#${p.auth.authNumber}` : 'No auth number'} · {p.auth.payer}</p>
                        <p className="text-slate-500">{p.auth.startDate ?? '?'} to {p.auth.endDate ?? '?'}{p.auth.unitsRemaining != null ? ` · ${p.auth.unitsUsed}/${p.auth.unitsApproved} units used` : ''}</p>
                        <p className={p.auth.renewal === 'expired' ? 'text-rose-600 font-semibold' : p.auth.renewal === 'renew_now' ? 'text-amber-700 font-medium' : 'text-slate-500'}>{p.auth.renewalLabel}</p>
                      </>
                    ) : (
                      <span className="text-slate-500">No PRP authorization on file</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge tone={STATUS_TONE[p.status] ?? 'neutral'}>{STATUS_LABEL[p.status] ?? p.status}</StatusBadge>
                    {p.morsThisMonth != null && <p className="text-[11px] text-slate-500 mt-1">MORS {p.morsThisMonth}</p>}
                    {p.morsDue && <p className="text-[11px] text-amber-700 mt-1">MORS due for {hub.month}</p>}
                  </td>
                  <td className="sticky right-0 z-10 bg-white px-3 py-3 text-right group-hover:bg-slate-50">
                    {(hub.canChangeStatus || hub.canWrite) && (
                      <button onClick={() => open(p)} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>{editing === p.enrollmentId ? 'Close' : 'Update'}</button>
                    )}
                  </td>
                </tr>
                {editing === p.enrollmentId && (
                  <tr className="bg-blue-50/40">
                    <td colSpan={8} className="px-3 py-4">
                      <div className="sticky left-3 flex max-w-[calc(100vw-4rem)] flex-wrap gap-6">
                        {hub.canChangeStatus && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-600">Enrollment status</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
                                {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                              {status === 'discharged' && (
                                <>
                                  <select value={dischargeType} onChange={(e) => setDischargeType(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
                                    <option value="">Discharge type…</option>
                                    {PRP_DISCHARGE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                  <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Discharge reason (required)" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-64" />
                                </>
                              )}
                              <button disabled={busy || statusMissing(p).length > 0} onClick={() => void saveStatus(p)}
                                className={buttonClasses({ size: 'sm' })}><Save size={12} /> Save status</button>
                            </div>
                            {(status === 'transitioning' || status === 'discharged') && (
                              <textarea value={transitionPlan} onChange={(e) => setTransitionPlan(e.target.value)} rows={2}
                                placeholder={status === 'transitioning' ? 'Transition plan (required): step-down, next services, target date…' : 'Transition plan (optional at discharge)'}
                                className="block w-full max-w-xl rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                            )}
                            {status === 'discharged' && dischargeType !== 'deceased' && (
                              <textarea value={aftercarePlan} onChange={(e) => setAftercarePlan(e.target.value)} rows={2}
                                placeholder="Aftercare plan (required): referrals, appointments, crisis resources (988)…"
                                className="block w-full max-w-xl rounded-lg border border-slate-300 px-2 py-1.5 text-sm" />
                            )}
                            {statusMissing(p).length > 0 && <p className="text-[11px] text-amber-700">Needed: {statusMissing(p).join(', ')}</p>}
                          </div>
                        )}
                        {hub.canWrite && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-slate-600">MORS rating for {hub.month}</p>
                            <div className="flex flex-wrap items-center gap-2">
                              <select value={mors} onChange={(e) => setMors(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
                                <option value="">Select level…</option>
                                {MORS_LEVELS.map((l) => <option key={l.rating} value={l.rating}>{l.rating} · {l.label}</option>)}
                              </select>
                              <button disabled={busy || !mors} onClick={() => void saveMors(p)}
                                className={buttonClasses({ size: 'sm' })}><Save size={12} /> Save MORS</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Referrals ──────────────────────────────────────────────────────────────

function ReferralsTab({ referrals }: { referrals: Referral[] }) {
  return (
    <div className="p-4 sm:p-6">
      <p className="text-sm text-slate-500 mb-4">PRP referrals on file that do not have an enrollment yet.</p>
      {referrals.length === 0 ? (
        <EmptyState compact title="No referrals are waiting for enrollment." description="New PRP referrals appear here until the client is enrolled." />
      ) : (
        <div className="clinic-scroll-x"><table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <th scope="col" className="px-3 py-2.5 text-left">Client</th><th scope="col" className="px-3 py-2.5 text-left">Referral</th><th scope="col" className="px-3 py-2.5 text-left">Diagnosis</th><th scope="col" className="px-3 py-2.5 text-left">Referred by</th><th scope="col" className="px-3 py-2.5 text-left">Received</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {referrals.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-3 text-sm font-medium text-slate-900">
                  {r.clientId ? <Link href={`/dashboard/clients/${r.clientId}`} className="hover:text-blue-700">{r.name}</Link> : r.name}
                  {!r.clientId && <span className="ml-2 text-[11px] text-amber-700">no chart linked</span>}
                </td>
                <td className="px-3 py-3 text-sm text-slate-600">{r.displayId ?? '—'}</td>
                <td className="px-3 py-3 text-sm font-mono text-slate-700">{r.diagnosisCode}</td>
                <td className="px-3 py-3 text-sm text-slate-600">{r.prescriber}</td>
                <td className="px-3 py-3 text-sm text-slate-600">{r.referralDate ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── Groups & attendance ────────────────────────────────────────────────────

function AttendanceTab({ hub, onChanged, notify }: { hub: Hub; onChanged: () => Promise<void>; notify: Notify }) {
  const activeGroups = hub.groups.filter((g) => g.active);
  const [mode, setMode] = useState<'group' | 'individual' | 'community'>('group');
  const [groupId, setGroupId] = useState(activeGroups[0]?.id ?? '');
  const [date, setDate] = useState(today());
  const [minutes, setMinutes] = useState('');
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [note, setNote] = useState('');
  const [billable, setBillable] = useState(true);
  const [location, setLocation] = useState<'onsite' | 'offsite'>('onsite');
  const [intervention, setIntervention] = useState('');
  const [irpGoal, setIrpGoal] = useState('');
  const [response, setResponse] = useState('');
  const [newGroup, setNewGroup] = useState({ name: '', schedule: '', location: '', facilitatorId: '' });
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const openParticipants = hub.participants.filter((p) => p.status === 'active' || p.status === 'transitioning');

  useEffect(() => {
    if (!groupId && activeGroups[0]) setGroupId(activeGroups[0].id);
  }, [groupId, activeGroups]);
  useEffect(() => { setLocation(mode === 'community' ? 'offsite' : 'onsite'); }, [mode]);

  useEffect(() => {
    if (!hub.canWrite) return;
    apiJson<{ specialists: Specialist[] }>('/api/prp/specialists').then((d) => setSpecialists(d.specialists || [])).catch(() => setSpecialists([]));
  }, [hub.canWrite]);

  const loadRoster = useCallback(async () => {
    if (mode !== 'group' || !groupId || !date) { setRoster([]); return; }
    setRosterLoading(true);
    try {
      const d = await apiJson<{ roster: RosterRow[] }>(`/api/prp/attendance?groupId=${encodeURIComponent(groupId)}&date=${date}`);
      setRoster(d.roster);
    } catch (e) {
      notify(`Could not load roster: ${errText(e)}`, true);
      setRoster([]);
    } finally {
      setRosterLoading(false);
    }
  }, [mode, groupId, date, notify]);
  useEffect(() => { if (hub.canWrite) void loadRoster(); }, [loadRoster, hub.canWrite]);

  const saveRoster = async () => {
    setBusy(true);
    try {
      const r = await apiJson<{ created: number; updated: number; removed: number }>('/api/prp/attendance', {
        method: 'POST',
        body: JSON.stringify({
          serviceDate: date, serviceType: 'group', groupId, minutes: minutes ? Number(minutes) : null, location, intervention: intervention || null,
          entries: roster.map((x) => ({
            enrollmentId: x.enrollmentId, present: x.present, billable: x.billable,
            irpGoal: x.irpGoal || null, response: x.response || null, intervention: x.intervention || null,
          })),
        }),
      });
      notify(`Attendance saved: ${r.created} added, ${r.updated} updated, ${r.removed} removed`);
      await loadRoster();
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const saveSingle = async () => {
    if (!enrollmentId) return;
    setBusy(true);
    try {
      await apiJson('/api/prp/attendance', {
        method: 'POST',
        body: JSON.stringify({
          serviceDate: date, serviceType: mode, minutes: minutes ? Number(minutes) : null, location,
          entries: [{ enrollmentId, present: true, billable, note: note || null, irpGoal: irpGoal || null, intervention: intervention || null, response: response || null }],
        }),
      });
      notify(`${mode === 'individual' ? 'Individual' : 'Community'} encounter saved`);
      setNote('');
      setIrpGoal('');
      setIntervention('');
      setResponse('');
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const addGroup = async () => {
    if (!newGroup.name.trim()) return;
    setBusy(true);
    try {
      await apiJson('/api/prp/groups', { method: 'POST', body: JSON.stringify({ ...newGroup, facilitatorId: newGroup.facilitatorId || null }) });
      setNewGroup({ name: '', schedule: '', location: '', facilitatorId: '' });
      notify('Group added');
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  const toggleGroup = async (g: Group) => {
    try {
      await apiJson(`/api/prp/groups/${g.id}`, { method: 'PATCH', body: JSON.stringify({ active: !g.active }) });
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    }
  };

  const present = roster.filter((r) => r.present).length;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>Each check-off is one PRP encounter for that participant on that date. Document every contact: minutes, onsite / offsite, the IRP goal addressed, the intervention and the participant&apos;s response (COMAR 10.63 PRP). Staff is recorded as you. Write the full narrative in the participant&apos;s PRP Progress Note.</p>
      </div>

      {hub.canWrite ? (
        <div className="rounded-xl border border-slate-200 p-4 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Service</label>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
                <option value="group">Group session (roster)</option>
                <option value="individual">Individual</option>
                <option value="community">Community / off-site</option>
              </select>
            </div>
            {mode === 'group' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Group</label>
                <select value={groupId} onChange={(e) => setGroupId(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto sm:min-w-[12rem]">
                  {activeGroups.length === 0 && <option value="">No active groups yet</option>}
                  {activeGroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Participant</label>
                <select value={enrollmentId} onChange={(e) => setEnrollmentId(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto sm:min-w-[12rem]">
                  <option value="">Select…</option>
                  {openParticipants.map((p) => <option key={p.enrollmentId} value={p.enrollmentId}>{p.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date of service</label>
              <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Minutes</label>
              <input type="number" min={1} max={600} value={minutes} onChange={(e) => setMinutes(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-24" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Location</label>
              <select value={location} onChange={(e) => setLocation(e.target.value as 'onsite' | 'offsite')} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
                <option value="onsite">Onsite</option>
                <option value="offsite">Offsite</option>
              </select>
            </div>
            <div className="w-full sm:w-auto sm:min-w-[14rem] sm:flex-1">
              <label className="block text-xs font-semibold text-slate-600 mb-1">{mode === 'group' ? 'Group topic / intervention' : 'Intervention / activity'}</label>
              <input value={intervention} onChange={(e) => setIntervention(e.target.value)} placeholder="Skill taught or practiced…" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full" />
            </div>
          </div>

          {mode === 'group' && (
            <div>
              {!groupId ? (
                <p className="text-sm text-slate-500">Add a group below to take attendance.</p>
              ) : rosterLoading ? (
                <p className="text-sm text-slate-500">Loading roster…</p>
              ) : roster.length === 0 ? (
                <p className="text-sm text-slate-500">No active PRP participants in your caseload.</p>
              ) : (
                <>
                  <div className="divide-y divide-slate-100 rounded-lg border border-slate-100">
                    {roster.map((r, i) => (
                      <div key={r.enrollmentId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 text-sm">
                        <label className="flex min-h-10 min-w-[12rem] flex-1 items-center gap-3">
                          <input type="checkbox" checked={r.present} onChange={(e) => setRoster((prev) => prev.map((x, j) => (j === i ? { ...x, present: e.target.checked } : x)))} className="accent-blue-600" />
                          <span className="text-slate-800">{r.name} <span className="text-xs text-slate-500">{r.displayId ?? ''}</span></span>
                        </label>
                        {r.present && (
                          <>
                            <input value={r.irpGoal ?? ''} onChange={(e) => setRoster((prev) => prev.map((x, j) => (j === i ? { ...x, irpGoal: e.target.value } : x)))}
                              placeholder="IRP goal addressed" className="h-10 w-full rounded-lg border border-slate-200 px-2 text-xs sm:h-8 sm:w-44" />
                            <input value={r.response ?? ''} onChange={(e) => setRoster((prev) => prev.map((x, j) => (j === i ? { ...x, response: e.target.value } : x)))}
                              placeholder="Participant response" className="h-10 w-full rounded-lg border border-slate-200 px-2 text-xs sm:h-8 sm:w-44" />
                            <label className="flex items-center gap-1 text-xs text-slate-500">
                              <input type="checkbox" checked={r.billable} onChange={(e) => setRoster((prev) => prev.map((x, j) => (j === i ? { ...x, billable: e.target.checked } : x)))} className="accent-blue-600" /> billable
                            </label>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button disabled={busy} onClick={() => void saveRoster()} className={buttonClasses()}><Save size={14} /> Save attendance</button>
                    <span className="text-xs text-slate-500">{present} of {roster.length} marked present. Unticking a saved participant removes their entry for this date.</span>
                  </div>
                </>
              )}
            </div>
          )}

          {mode !== 'group' && (
            <div className="flex flex-wrap items-end gap-3">
              <input value={irpGoal} onChange={(e) => setIrpGoal(e.target.value)} placeholder="IRP goal addressed" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto sm:min-w-[12rem]" />
              <input value={response} onChange={(e) => setResponse(e.target.value)} placeholder="Participant response" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto sm:min-w-[12rem]" />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note (optional, no clinical narrative)" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto sm:min-w-[16rem] sm:flex-1" />
              <label className="flex items-center gap-1 text-sm text-slate-600"><input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} className="accent-blue-600" /> billable</label>
              <button disabled={busy || !enrollmentId} onClick={() => void saveSingle()} className={buttonClasses()}><Save size={14} /> Save encounter</button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-slate-500">Attendance is recorded by PRP specialists and program leadership.</p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-slate-800 mb-2">PRP groups</h3>
        {hub.groups.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No PRP groups set up yet.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {hub.groups.map((g) => (
              <div key={g.id} className={`rounded-xl border p-4 ${g.active ? 'border-slate-100' : 'border-dashed border-slate-200 opacity-60'}`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold text-sm text-slate-900">{g.name}</p>
                  {hub.canWrite && <button onClick={() => void toggleGroup(g)} className="text-xs text-blue-700 hover:underline">{g.active ? 'Deactivate' : 'Reactivate'}</button>}
                </div>
                <p className="text-xs text-slate-500 mt-1">{[g.schedule, g.location, g.facilitator].filter(Boolean).join(' · ') || 'No schedule, location or facilitator recorded'}</p>
              </div>
            ))}
          </div>
        )}
        {hub.canWrite && (
          <div className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <input value={newGroup.name} onChange={(e) => setNewGroup((p) => ({ ...p, name: e.target.value }))} placeholder="Group name" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto" />
            <input value={newGroup.schedule} onChange={(e) => setNewGroup((p) => ({ ...p, schedule: e.target.value }))} placeholder="Schedule (e.g. Mon/Wed 10:00)" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto" />
            <input value={newGroup.location} onChange={(e) => setNewGroup((p) => ({ ...p, location: e.target.value }))} placeholder="Location" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto" />
            <select value={newGroup.facilitatorId} onChange={(e) => setNewGroup((p) => ({ ...p, facilitatorId: e.target.value }))} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto">
              <option value="">Facilitator (optional)</option>
              {specialists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button disabled={busy || !newGroup.name.trim()} onClick={() => void addGroup()} className={buttonClasses({ variant: 'secondary', size: 'sm' })}><Plus size={14} /> Add group</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── IRP goal areas ─────────────────────────────────────────────────────────

function GoalsTab({ hub }: { hub: Hub }) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <p className="text-sm text-slate-500">
        Goals recorded on participants&apos; IRPs (IRP Builder), grouped by need area. Goal completion is not tracked in Altrixs, so no completion rate is shown.
      </p>
      {hub.goalsByNeed.length === 0 ? (
        <EmptyState compact title="No IRP goals recorded yet for open enrollments." description="Goals added in the IRP Builder are grouped here by need area." />
      ) : (
        <div className="clinic-scroll-x"><table className="w-full">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600"><th scope="col" className="px-3 py-2.5 text-left">Need area</th><th scope="col" className="px-3 py-2.5 text-left">Goals</th><th scope="col" className="px-3 py-2.5 text-left">On finalized IRPs</th><th scope="col" className="px-3 py-2.5 text-left">Participants</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {hub.goalsByNeed.map((g) => (
              <tr key={g.need}><td className="px-3 py-2.5 text-sm text-slate-800">{g.need}</td><td className="px-3 py-2.5 text-sm font-semibold">{g.goals}</td><td className="px-3 py-2.5 text-sm">{g.finalGoals}</td><td className="px-3 py-2.5 text-sm">{g.participants}</td></tr>
            ))}
          </tbody>
        </table></div>
      )}
      {hub.referralDomains.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-slate-800 mb-2">Rehabilitation domains recommended at referral</h3>
          <div className="flex flex-wrap gap-2">
            {hub.referralDomains.map((d) => (
              <span key={d.domain} className="rounded-full bg-blue-50 border border-blue-100 px-3 py-1 text-xs text-blue-800">{d.domain} · {d.participants}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Reports ────────────────────────────────────────────────────────────────

function ReportsTab({ hub, notify }: { hub: Hub; notify: Notify }) {
  const [month, setMonth] = useState(thisMonth());
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (type: string) => {
    setBusy(type);
    try {
      setReport(await apiJson<Report>(`/api/prp/reports?type=${type}&month=${month}`));
    } catch (e) {
      notify(`Report failed: ${errText(e)}`, true);
    } finally {
      setBusy(null);
    }
  };
  const csvHref = useMemo(() => (report ? `/api/prp/reports?type=${report.type}&month=${report.month}&format=csv` : '#'), [report]);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <label className="text-xs font-semibold text-slate-600">Month</label>
        <input type="month" value={month} max={thisMonth()} onChange={(e) => { setMonth(e.target.value); setReport(null); }} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-full sm:w-auto" />
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          return (
            <div key={r.type} className="p-4 rounded-xl border border-slate-100 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0"><Icon size={18} className="text-blue-600" /></div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-800">{r.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">{r.desc}</p>
                {r.type === 'billing-summary' && !hub.billingRule.confirmed && (
                  <p className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-amber-700"><AlertTriangle size={11} /> {hub.billingRule.label}</p>
                )}
                <button disabled={!!busy || !month} onClick={() => void run(r.type)} className="mt-2 inline-flex min-h-10 items-center gap-1 text-xs text-blue-700 font-semibold hover:underline disabled:opacity-50 sm:min-h-0">
                  <BarChart3 size={11} /> {busy === r.type ? 'Building…' : `Generate for ${month}`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">Stakeholder report: not built. It needs program-level content (narrative, funder metrics) that Altrixs does not store.</p>

      {report && (
        <div className="rounded-xl border border-blue-100">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-100 px-4 py-3">
            <p className="text-sm font-semibold text-slate-800">{report.title} · {report.month} · {report.rows.length} row{report.rows.length === 1 ? '' : 's'}</p>
            <a href={csvHref} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"><Download size={12} /> Export CSV</a>
          </div>
          {(report.unitRuleLabel || report.goalStatusNote || report.type === 'mors') && (
            <div className="space-y-1 border-b border-slate-100 bg-amber-50/60 px-4 py-2 text-xs text-amber-900">
              {report.unitRuleLabel && <p className="font-semibold">{report.unitRuleLabel}</p>}
              {report.ruleNote && <p>{report.ruleNote}</p>}
              {report.unitRuleLabel && (
                <ul className="list-disc list-inside">
                  {hub.billingRule.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a></li>)}
                </ul>
              )}
              {report.goalStatusNote && <p>{report.goalStatusNote}</p>}
              {report.type === 'mors' && <p>{report.recorded ? `${report.recorded} rating(s) recorded.` : 'MORS not recorded yet for this month. Record ratings from the Participants tab.'}</p>}
            </div>
          )}
          <div className="overflow-x-auto">
            {report.rows.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">No records for {report.month}.</p>
            ) : (
              <table className="w-full text-xs">
                <thead><tr className="border-b border-slate-200 bg-slate-50 text-slate-600">{report.columns.map((c) => <th key={c.key} scope="col" className="text-left px-3 py-2 font-semibold whitespace-nowrap">{c.label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {report.rows.map((row, i) => (
                    <tr key={i}>{report.columns.map((c) => {
                      const v = row[c.key];
                      return <td key={c.key} className="px-3 py-2 text-slate-700 whitespace-nowrap">{v == null || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v)}</td>;
                    })}</tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Program settings (practice policy) ─────────────────────────────────────

function SettingsTab({ hub, onChanged, notify }: { hub: Hub; onChanged: () => Promise<void>; notify: Notify }) {
  const s = hub.settings;
  const [model, setModel] = useState<string>(s.billing.model ?? '');
  const [minimum, setMinimum] = useState(s.monthlyMinContacts != null ? String(s.monthlyMinContacts) : '');
  const [irpDays, setIrpDays] = useState(String(s.irpReviewDays));
  const [busy, setBusy] = useState(false);
  const ro = !hub.canEditSettings;

  const save = async (body: Record<string, unknown>, what: string) => {
    setBusy(true);
    try {
      await apiJson('/api/prp/settings', { method: 'PATCH', body: JSON.stringify(body) });
      notify(`${what} saved`);
      await onChanged();
    } catch (e) {
      notify(`Not saved: ${errText(e)}`, true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900">
        <Info size={14} className="shrink-0 mt-0.5" />
        <p>
          Practice policy for the PRP program. Altrixs does not choose payer numbers: each value below is set and confirmed by practice leadership
          {ro ? ' (view only for your role)' : ''}. Changes are recorded in the audit log.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className={s.billing.confirmed ? 'text-emerald-700' : 'text-amber-700'} />
          <h3 className="text-sm font-semibold text-slate-800">Billing model</h3>
        </div>
        <p className={`text-sm ${s.billing.confirmed ? 'text-emerald-800' : 'text-amber-800'}`}>{s.billing.label}</p>
        {s.billing.confirmed ? (
          <p className="text-xs text-slate-500">Confirmed by {s.billing.confirmedByName ?? 'unknown'}{s.billing.confirmedAt ? ` on ${s.billing.confirmedAt.slice(0, 10)}` : ''}.</p>
        ) : (
          <p className="text-xs text-slate-500">{s.billing.detail}</p>
        )}
        <div className="space-y-2">
          {PRP_BILLING_MODELS.map((m) => (
            <label key={m} className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${model === m ? 'border-blue-400 bg-blue-50/50' : 'border-slate-200'}`}>
              <input type="radio" name="prp-billing-model" value={m} checked={model === m} disabled={ro} onChange={() => setModel(m)} className="mt-1 accent-blue-600" />
              <span>
                <span className="font-medium text-slate-800">{PRP_BILLING_MODEL_OPTIONS[m].label}</span>
                <span className="block text-xs text-slate-500">{PRP_BILLING_MODEL_OPTIONS[m].detail}</span>
              </span>
            </label>
          ))}
        </div>
        <ul className="list-disc list-inside text-xs text-slate-500">
          {hub.billingRule.sources.map((src) => <li key={src.url}><a href={src.url} target="_blank" rel="noreferrer" className="underline">{src.label}</a></li>)}
        </ul>
        {!ro && (
          <div className="flex flex-wrap gap-2">
            <button disabled={busy || !model || model === s.billing.model} onClick={() => void save({ billingModel: model }, 'Billing model confirmation')}
              className={buttonClasses({ size: 'sm' })}><Save size={12} /> Confirm billing model</button>
            {s.billing.confirmed && (
              <button disabled={busy} onClick={() => { setModel(''); void save({ billingModel: null }, 'Billing model confirmation cleared'); }}
                className={buttonClasses({ variant: 'secondary', size: 'sm' })}>Clear confirmation</button>
            )}
          </div>
        )}
        <p className="text-[11px] text-slate-500">Confirming a model sets the codes the Visit Guide suggests for PRP contacts. PRP claims stay blocked in billing until billing turns them on separately; units and case-rate levels are not calculated.</p>
      </section>

      <section className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2"><Settings size={16} className="text-blue-700" /><h3 className="text-sm font-semibold text-slate-800">Monthly contact minimum</h3></div>
        <p className="text-sm text-slate-700">{s.monthlyMinLabel}</p>
        <p className="text-xs text-slate-500">Billable PRP contacts per participant per month that the practice requires. When set, the hub flags participants below it. Leave blank until confirmed against the current PBHS / Carelon requirement.</p>
        {!ro && (
          <div className="flex flex-wrap items-end gap-2">
            <input type="number" min={1} max={31} value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="Not set" className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-28" />
            <button disabled={busy} onClick={() => void save({ monthlyMinContacts: minimum ? Number(minimum) : null }, 'Monthly minimum')}
              className={buttonClasses({ size: 'sm' })}><Save size={12} /> Save</button>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 p-4 space-y-3">
        <div className="flex items-center gap-2"><Target size={16} className="text-blue-700" /><h3 className="text-sm font-semibold text-slate-800">IRP review interval</h3></div>
        <p className="text-sm text-slate-700">{s.irpReviewLabel}</p>
        <p className="text-xs text-slate-500">A finalized IRP without a review date is due this many days after the IRP date; a review date later than this is refused.</p>
        {!ro && (
          <div className="flex flex-wrap items-end gap-2">
            <input type="number" min={30} max={180} value={irpDays} onChange={(e) => setIrpDays(e.target.value)} className="h-10 rounded-lg border border-slate-300 bg-white px-2.5 text-sm w-28" />
            <span className="text-xs text-slate-500">days for adults (30–180)</span>
            <button disabled={busy || !irpDays || Number(irpDays) === s.irpReviewDays} onClick={() => void save({ irpReviewDays: Number(irpDays) }, 'IRP review interval')}
              className={buttonClasses({ size: 'sm' })}><Save size={12} /> Save</button>
          </div>
        )}
      </section>
      {s.policyUpdatedAt && <p className="text-[11px] text-slate-500">Policy last changed {s.policyUpdatedAt.slice(0, 10)} by {s.policyUpdatedByName ?? 'unknown'}.</p>}
    </div>
  );
}

// ─── Dx codes (reference) ───────────────────────────────────────────────────

function CodesTab({ hub }: { hub: Hub | null }) {
  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex items-start gap-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
        <Stethoscope size={16} className="text-blue-600 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">
          ICD-10-CM codes Altrixs accepts for PRP enrollment. Medical necessity is decided by the ASO on the authorization request.
          Diagnosis must be documented by a licensed clinician and present in the member&apos;s active problem list.
        </p>
      </div>
      {QUALIFYING_CODE_GROUPS.map((cat) => (
        <div key={cat.group}>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-blue-600" />
            <h3 className="font-semibold text-slate-800 text-sm">{cat.group}</h3>
            <span className="text-xs text-slate-500">({cat.codes.length} codes)</span>
            {cat.strength === 'conditional' && <span className="text-xs text-amber-700 italic">Verify medical necessity documentation for these diagnoses.</span>}
          </div>
          <div className="clinic-scroll-x rounded-xl border border-slate-200">
            <table className="w-full">
              <caption className="sr-only">{cat.group} codes</caption>
              <thead className="sr-only"><tr><th scope="col">Code</th><th scope="col">Description</th><th scope="col">Note</th></tr></thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {cat.codes.map((c) => (
                  <tr key={c.code}>
                    <td className="px-4 py-2.5 w-28"><span className="font-mono text-sm font-semibold text-blue-700">{c.code}</span></td>
                    <td className="px-4 py-2.5 text-sm text-slate-700">{c.label}</td>
                    <td className="px-4 py-2.5 text-right">
                      {'highRisk' in c && c.highRisk && <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full"><AlertTriangle size={11} /> Use sparingly</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-900 space-y-1">
        <p className="font-semibold">Billing model: {hub?.billingRule.label ?? 'Not loaded'}</p>
        {hub?.billingRule.confirmed && <p>Confirmed by {hub.billingRule.confirmedByName ?? 'unknown'}{hub.billingRule.confirmedAt ? ` on ${hub.billingRule.confirmedAt.slice(0, 10)}` : ''}. Change it on the Program Settings tab.</p>}
        {hub && <p>{hub.billingRule.note}</p>}
        {hub?.billingRule.sources.map((s) => <p key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.label}</a></p>)}
      </div>
    </div>
  );
}
