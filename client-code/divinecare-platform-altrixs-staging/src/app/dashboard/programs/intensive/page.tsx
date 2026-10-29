'use client';

/**
 * IOP / PHP programs hub. Today's roster (attendance with minutes per session block), clients with
 * weekly hours against the program minimum, admissions pipeline, missed-day outreach, discharges
 * with the post-discharge follow-up window, the program-director view (leadership only) and program
 * setup (leadership only). Every number comes from /api/intensive/* (Altrixs records).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity, AlertTriangle, BarChart3, CalendarCheck, ClipboardList, CreditCard, Inbox, LogOut, PhoneCall, PlayCircle,
  Plus, Save, Settings2, ShieldCheck, Users,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  AuthCell, Badge, Card, FOLLOWUP_LABEL, PLAN_LABEL, Part2Badge, STATUS_CLS, STATUS_LABEL, WeekBadge,
  btnPrimary, btnSecondary, errText, inputCls, stickyTd, stickyTh, type EnrollmentRow, type Program,
} from './shared';
import { ProgramSetup } from './ProgramSetup';
import { Alert, Card as UiCard, LoadingState, Page, PageHeader, Tabs } from '@/components/ui';

type Rollup = {
  perProgram: Array<{
    programId: string; name: string; programType: string; census: number; referralsOpen: number; attendancePct: number | null; sessionsRecorded28d: number;
    underMinimumLastWeek: number; atRiskThisWeek: number; authsRenewalDue: number; noAuth: number; reviewsMissing: number; plansOverdue: number;
  }>;
  followUp7: { discharges30d: number; expected: number; num: number | null; den: number; pct: number | null; suppressed: boolean };
  outcomes: {
    cohortNote: string;
    phq9: { n: number; suppressed: boolean; meanFirst: number | null; meanLatest: number | null; improvedPct: number | null };
    gad7: { n: number; suppressed: boolean; meanFirst: number | null; meanLatest: number | null; improvedPct: number | null };
    bam: { n: number; suppressed: boolean; improvedPct: number | null };
  };
};
type Outreach = { id: string; enrollmentId: string; clientName: string; programName: string; serviceDate: string; dueAt: string; overdue: boolean; mine: boolean; attempts: number };
type Hub = {
  today: string;
  leader: boolean;
  canManage: boolean;
  canDecide: boolean;
  canBill: boolean;
  programs: Program[];
  todayPrograms: Array<{ id: string; name: string; programType: string; blocks: number; perDayMinutes: number }>;
  myClients: EnrollmentRow[];
  enrollments: EnrollmentRow[];
  outreach: Outreach[];
  rollups: Rollup | null;
};
type Tab = 'today' | 'clients' | 'admissions' | 'outreach' | 'discharges' | 'director' | 'setup';

export default function IntensiveProgramsPage() {
  const { user } = useAuth();
  const role = String(user?.role || '');
  const [hub, setHub] = useState<Hub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('today');

  const load = useCallback(async () => {
    try {
      const r = await apiJson<{ data: Hub }>('/api/intensive/hub');
      setHub(r.data);
      setError(null);
    } catch (e) {
      setError(errText(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const notify = (m: string) => {
    setNotice(m);
    setTimeout(() => setNotice(null), 4000);
  };

  const tabs: { key: Tab; label: string; icon: typeof Users; show: boolean; count?: number }[] = [
    { key: 'today', label: 'Today’s roster', icon: CalendarCheck, show: true },
    { key: 'clients', label: hub?.leader ? 'Census & weekly hours' : 'My program clients', icon: Users, show: true },
    { key: 'admissions', label: 'Referrals & admissions', icon: ClipboardList, show: true, count: hub?.enrollments.filter((e) => e.status === 'referred' || e.status === 'screening').length },
    { key: 'outreach', label: 'Missed-day outreach', icon: PhoneCall, show: true, count: hub?.outreach.length },
    { key: 'discharges', label: 'Discharges', icon: LogOut, show: true },
    { key: 'director', label: 'Program director', icon: BarChart3, show: Boolean(hub?.leader) },
    { key: 'setup', label: 'Program setup', icon: Settings2, show: Boolean(hub?.canManage) },
  ];

  return (
    <Page>
      <PageHeader
        title={<span className="flex items-center gap-2"><Activity size={22} className="text-blue-600" aria-hidden /> IOP / PHP Programs</span>}
        description="Intensive outpatient (MH IOP, SUD IOP ASAM 2.1) and partial hospitalization · attendance, weekly hours, authorizations, discharge"
        actions={
          <>
            {hub?.canBill && canAccessPath(role, '/dashboard/programs/intensive/billing') && (
              <Link href="/dashboard/programs/intensive/billing" className={btnSecondary}><CreditCard size={16} aria-hidden /> Charge drafts</Link>
            )}
            <Link href="/dashboard/ehr/group-sessions" className={btnSecondary}><Users size={16} aria-hidden /> Group sessions</Link>
          </>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      {!hub && !error && <UiCard><LoadingState label="Loading programs…" /></UiCard>}

      {hub && (
        <>
          {hub.programs.length === 0 && (
            <Alert tone="warning">
              No intensive programs are set up yet.{hub.canManage ? ' Add one under Program setup.' : ' Practice leadership sets programs up.'}
            </Alert>
          )}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
            <Tabs
              label="Program sections"
              controlsPanels={false}
              value={tab}
              onChange={setTab}
              className="px-2"
              items={tabs.filter((t) => t.show).map((t) => {
                const Icon = t.icon;
                return { key: t.key, label: t.label, icon: <Icon />, count: t.count || undefined };
              })}
            />
            <div className="p-4 sm:p-5">
              {tab === 'today' && <TodayRoster hub={hub} role={role} onSaved={(m) => { notify(m); void load(); }} />}
              {tab === 'clients' && <ClientsTable rows={hub.leader ? hub.enrollments.filter((e) => e.status === 'admitted') : hub.myClients} />}
              {tab === 'admissions' && <Admissions hub={hub} onSaved={(m) => { notify(m); void load(); }} />}
              {tab === 'outreach' && <OutreachList rows={hub.outreach} onSaved={(m) => { notify(m); void load(); }} />}
              {tab === 'discharges' && <Discharges rows={hub.enrollments.filter((e) => e.status === 'discharged')} />}
              {tab === 'director' && hub.rollups && <Director r={hub.rollups} />}
              {tab === 'setup' && hub.canManage && <ProgramSetup programs={hub.programs} onSaved={(m) => { notify(m); void load(); }} />}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}

// ─── Today's roster ─────────────────────────────────────────────────────────

type Mark = { status: string; minutes: number | null; progressNoteId: string | null; groupSessionId: string | null; source: 'program' | 'group' };
type Roster = {
  program: Program;
  date: string;
  programDay: boolean;
  blocks: Program['schedule']['blocks'];
  clients: Array<{ enrollmentId: string; clientId: string; clientName: string; mrn: string | null; marks: Record<string, Mark>; followUpOpen: boolean }>;
};

function TodayRoster({ hub, role, onSaved }: { hub: Hub; role: string; onSaved: (m: string) => void }) {
  const active = hub.programs.filter((p) => p.active);
  const [programId, setProgramId] = useState(hub.todayPrograms[0]?.id ?? active[0]?.id ?? '');
  const [date, setDate] = useState(hub.today);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [edits, setEdits] = useState<Record<string, { status: string; minutes: string }>>({});
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!programId) return;
    try {
      const r = await apiJson<{ data: Roster }>(`/api/intensive/attendance?programId=${encodeURIComponent(programId)}&date=${date}`);
      setRoster(r.data);
      setEdits({});
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    }
  }, [programId, date]);
  useEffect(() => {
    void load();
  }, [load]);

  const keyOf = (enrollmentId: string, block: string) => `${enrollmentId}|${block}`;
  const valueOf = (c: Roster['clients'][number], b: Roster['blocks'][number]) => {
    const e = edits[keyOf(c.enrollmentId, b.key)];
    if (e) return e;
    const m = c.marks[b.key];
    return { status: m?.status ?? '', minutes: m?.minutes != null ? String(m.minutes) : '' };
  };
  const setCell = (c: Roster['clients'][number], b: Roster['blocks'][number], patch: Partial<{ status: string; minutes: string }>) => {
    const cur = valueOf(c, b);
    const next = { ...cur, ...patch };
    if (patch.status === 'present' && !cur.minutes) next.minutes = String(b.minutes);
    if (patch.status === 'absent' || patch.status === 'excused') next.minutes = '';
    setEdits((s) => ({ ...s, [keyOf(c.enrollmentId, b.key)]: next }));
  };
  const markAllPresent = () => {
    if (!roster) return;
    const next: typeof edits = { ...edits };
    for (const c of roster.clients) for (const b of roster.blocks) if (!c.marks[b.key] && !next[keyOf(c.enrollmentId, b.key)]) next[keyOf(c.enrollmentId, b.key)] = { status: 'present', minutes: String(b.minutes) };
    setEdits(next);
  };

  const save = async () => {
    if (!roster) return;
    const marks = Object.entries(edits)
      .filter(([, v]) => v.status)
      .map(([k, v]) => {
        const [enrollmentId, blockKey] = k.split('|');
        return { enrollmentId, blockKey, status: v.status, minutes: v.minutes === '' ? null : Number(v.minutes) };
      });
    if (!marks.length) return;
    setSaving(true);
    try {
      const r = await apiJson<{ saved: number; followUpsOpened: number }>('/api/intensive/attendance', {
        method: 'POST',
        body: JSON.stringify({ programId: roster.program.id, date: roster.date, marks }),
      });
      onSaved(`Saved ${r.saved} attendance mark${r.saved === 1 ? '' : 's'}${r.followUpsOpened ? `; ${r.followUpsOpened} missed-day outreach task${r.followUpsOpened === 1 ? '' : 's'} opened` : ''}.`);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setSaving(false);
    }
  };

  if (!active.length) return <p className="text-sm text-slate-500">No active programs.</p>;
  const canNotes = canAccessPath(role, '/dashboard/ehr/notes');
  const groupHref = roster?.program.part2 ? '/dashboard/ehr/sud-groups/sessions/' : '/dashboard/ehr/group-sessions/sessions/';
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="w-full text-xs font-medium text-slate-600 sm:w-auto">Program
          <select className={`${inputCls} mt-1 sm:min-w-[16rem]`} value={programId} onChange={(e) => setProgramId(e.target.value)}>
            {active.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.typeLabel}</option>)}
          </select>
        </label>
        <label className="w-full text-xs font-medium text-slate-600 sm:w-auto">Date
          <input type="date" className={`${inputCls} mt-1`} value={date} max={hub.today} onChange={(e) => setDate(e.target.value)} />
        </label>
        <button className={btnSecondary} onClick={markAllPresent} disabled={!roster?.clients.length}>Mark unmarked present</button>
        <button className={btnPrimary} onClick={save} disabled={saving || !Object.keys(edits).length}><Save size={14} aria-hidden /> Save attendance</button>
      </div>
      {err && <p className="text-sm text-rose-700">{err}</p>}
      {roster && !roster.programDay && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">This date is not a scheduled program day for {roster.program.name}. Attendance can still be recorded (e.g. a make-up session).</p>}
      {roster?.program.part2 && <p className="flex items-center gap-2 text-xs text-blue-800"><Part2Badge /> SUD program records: disclose only with a 42 CFR Part 2 consent.</p>}
      {roster && (
        <div className="clinic-scroll-x">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
                <th scope="col" className={`${stickyTh} px-3 py-2`}>Client</th>
                {roster.blocks.map((b) => (
                  <th key={b.key} scope="col" className="px-3 py-2">{b.label}<span className="block font-normal normal-case text-slate-500">{b.start} · {b.minutes} min · {b.sessionType}</span></th>
                ))}
                <th scope="col" className="sticky right-0 z-10 bg-slate-50 px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {!roster.clients.length && <tr><td colSpan={roster.blocks.length + 2} className="py-8 text-center text-slate-500">No admitted clients in your scope on this date.</td></tr>}
              {roster.clients.map((c) => (
                <tr key={c.enrollmentId} className="align-top">
                  <td className={`${stickyTd} max-w-[14rem] px-3 py-2`}>
                    <Link href={`/dashboard/programs/intensive/${c.enrollmentId}`} className="font-medium text-slate-900 hover:text-blue-700">{c.clientName}</Link>
                    <p className="text-xs text-slate-500">{c.mrn ?? 'No MRN'}</p>
                    {c.followUpOpen && <Badge cls="bg-rose-100 text-rose-800"><AlertTriangle size={11} aria-hidden /> Missed day: outreach open</Badge>}
                  </td>
                  {roster.blocks.map((b) => {
                    const v = valueOf(c, b);
                    const m = c.marks[b.key];
                    return (
                      <td key={b.key} className="py-2 pr-3">
                        <select aria-label={`${c.clientName} ${b.label} attendance`} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs sm:h-8" value={v.status} onChange={(e) => setCell(c, b, { status: e.target.value })}>
                          <option value="">Not marked</option>
                          <option value="present">Present</option>
                          <option value="late">Late</option>
                          <option value="left_early">Left early</option>
                          <option value="absent">Absent</option>
                          <option value="excused">Excused</option>
                        </select>
                        {['present', 'late', 'left_early'].includes(v.status) && (
                          <input aria-label={`${c.clientName} ${b.label} minutes`} type="number" min={0} max={600} className="ml-1 mt-1 h-10 w-16 rounded-lg border border-slate-200 px-2 text-xs sm:mt-0 sm:h-8" value={v.minutes} onChange={(e) => setCell(c, b, { minutes: e.target.value })} placeholder="min" />
                        )}
                        {m?.source === 'group' && m.groupSessionId && (
                          <Link href={`${groupHref}${m.groupSessionId}`} className="mt-1 block text-[11px] text-blue-700 hover:underline">From group session</Link>
                        )}
                      </td>
                    );
                  })}
                  <td className="sticky right-0 z-10 bg-white px-3 py-2 text-right">
                    {canNotes && (
                      <Link
                        href={`/dashboard/ehr/notes?clientId=${encodeURIComponent(c.clientId)}&dos=${roster.date}&guide=1`}
                        className="inline-flex min-h-10 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 sm:min-h-0"
                      >
                        <PlayCircle size={13} aria-hidden /> Start visit
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-slate-500">
            Group blocks fill from linked group sessions when attendance was taken there. &ldquo;Start visit&rdquo; opens the note with the {roster.program.level} Visit Guide; group notes are written on the group session.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Clients / census ───────────────────────────────────────────────────────

function ClientsTable({ rows }: { rows: EnrollmentRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No admitted clients in your scope.</p>;
  return (
    <div className="clinic-scroll-x">
      <table className="w-full min-w-[880px] text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
            <th scope="col" className={`${stickyTh} px-3 py-2`}>Client</th><th scope="col" className="px-3 py-2">This week</th><th scope="col" className="px-3 py-2">Last week</th><th scope="col" className="px-3 py-2">Authorization</th>
            <th scope="col" className="px-3 py-2">Treatment plan</th><th scope="col" className="px-3 py-2">Weekly review</th><th scope="col" className="px-3 py-2">Outreach</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map((r) => (
            <tr key={r.id} className="align-top">
              <td className={`${stickyTd} max-w-[14rem] px-3 py-2`}>
                <Link href={`/dashboard/programs/intensive/${r.id}`} className="font-medium text-slate-900 hover:text-blue-700">{r.clientName}</Link>
                <p className="text-xs text-slate-500">{r.programName} · admitted {r.admissionDate}</p>
                {r.part2 && <Part2Badge />}
              </td>
              <td className="px-3 py-2"><WeekBadge w={r.weeks?.current} /></td>
              <td className="px-3 py-2"><WeekBadge w={r.weeks?.previous} /></td>
              <td className="px-3 py-2"><AuthCell a={r.auth} /></td>
              <td className="px-3 py-2 text-xs">
                {r.plan.initialState !== 'done' ? (
                  <Badge cls={r.plan.initialState === 'overdue' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>Initial plan {PLAN_LABEL[r.plan.initialState]} {r.plan.initialDue}</Badge>
                ) : (
                  <span>Review {r.plan.nextReviewDue} <Badge cls={r.plan.reviewState === 'overdue' ? 'bg-rose-100 text-rose-800' : r.plan.reviewState === 'due' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}>{PLAN_LABEL[r.plan.reviewState]}</Badge></span>
                )}
              </td>
              <td className="px-3 py-2 text-xs">
                {!r.review ? <span className="text-slate-500">First week</span> : r.review.missing.length ? <Badge cls="bg-rose-100 text-rose-800">{r.review.missing.join('; ')}</Badge> : <Badge cls="bg-emerald-100 text-emerald-800">Done</Badge>}
              </td>
              <td className="px-3 py-2 text-xs">{r.outreachOpen ? <Badge cls={r.outreachOverdue ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>{r.outreachOpen} open</Badge> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Admissions ─────────────────────────────────────────────────────────────

function Admissions({ hub, onSaved }: { hub: Hub; onSaved: (m: string) => void }) {
  const pipeline = hub.enrollments.filter((e) => e.status === 'referred' || e.status === 'screening');
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState(hub.programs.find((p) => p.active)?.id ?? '');
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Array<{ id: string; name: string; mrn: string | null }>>([]);
  const [clientId, setClientId] = useState('');
  const [referralDate, setReferralDate] = useState(hub.today);
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(async () => {
      try {
        const r = await apiJson<{ clients: Array<{ id: string; name: string; mrn: string | null }> }>(`/api/intensive/options?q=${encodeURIComponent(q.trim())}`);
        setFound(r.clients);
      } catch {
        setFound([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const submit = async () => {
    setErr(null);
    try {
      await apiJson('/api/intensive/enrollments', { method: 'POST', body: JSON.stringify({ programId, clientId, referralDate, referralSource: source || null, referralReason: reason || null }) });
      setOpen(false);
      setClientId('');
      setQ('');
      onSaved('Referral added. Open it to screen and admit.');
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className={btnPrimary} onClick={() => setOpen((v) => !v)} disabled={!hub.programs.some((p) => p.active)}><Plus size={14} aria-hidden /> New referral</button>
      </div>
      {open && (
        <Card title="New program referral" icon={<Inbox size={16} className="text-blue-700" aria-hidden />}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-600">Program
              <select className={`${inputCls} mt-1`} value={programId} onChange={(e) => setProgramId(e.target.value)}>
                {hub.programs.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} · {p.typeLabel}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">Referral date
              <input type="date" className={`${inputCls} mt-1`} value={referralDate} max={hub.today} onChange={(e) => setReferralDate(e.target.value)} />
            </label>
            <label className="text-xs font-medium text-slate-600 sm:col-span-2">Client (your caseload; name or MRN)
              <input className={`${inputCls} mt-1`} value={q} onChange={(e) => { setQ(e.target.value); setClientId(''); }} placeholder="Type at least 2 characters" />
              {found.length > 0 && !clientId && (
                <ul className="mt-1 max-h-40 overflow-auto rounded-lg border border-slate-200">
                  {found.map((c) => (
                    <li key={c.id}><button type="button" className="w-full px-3 py-1.5 text-left text-sm hover:bg-blue-50" onClick={() => { setClientId(c.id); setQ(`${c.name}${c.mrn ? ` (${c.mrn})` : ''}`); }}>{c.name} <span className="text-xs text-slate-500">{c.mrn}</span></button></li>
                  ))}
                </ul>
              )}
            </label>
            <label className="text-xs font-medium text-slate-600">Referral source
              <input className={`${inputCls} mt-1`} value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Outpatient therapist, inpatient unit, self" />
            </label>
            <label className="text-xs font-medium text-slate-600">Reason for referral
              <input className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
          </div>
          {err && <p className="mt-2 text-sm text-rose-700">{err}</p>}
          <div className="mt-3 flex justify-end"><button className={btnPrimary} disabled={!clientId || !programId} onClick={submit}>Add referral</button></div>
        </Card>
      )}
      {!pipeline.length ? (
        <p className="text-sm text-slate-500">No open referrals in your scope.</p>
      ) : (
        <div className="clinic-scroll-x"><table className="w-full min-w-[520px] text-sm">
          <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600"><th scope="col" className="px-3 py-2">Client</th><th scope="col" className="px-3 py-2">Program</th><th scope="col" className="px-3 py-2">Referred</th><th scope="col" className="px-3 py-2">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-50">
            {pipeline.map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2"><Link href={`/dashboard/programs/intensive/${r.id}`} className="font-medium text-slate-900 hover:text-blue-700">{r.clientName}</Link></td>
                <td className="px-3 py-2 text-xs">{r.programName} {r.part2 && <Part2Badge />}</td>
                <td className="px-3 py-2 text-xs">{r.referralDate}</td>
                <td className="px-3 py-2"><Badge cls={STATUS_CLS[r.status]}>{STATUS_LABEL[r.status]}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}

// ─── Outreach ───────────────────────────────────────────────────────────────

function OutreachList({ rows, onSaved }: { rows: Outreach[]; onSaved: (m: string) => void }) {
  const [active, setActive] = useState<string | null>(null);
  const [method, setMethod] = useState('phone');
  const [outcome, setOutcome] = useState('');
  const [note, setNote] = useState('');
  const [resolve, setResolve] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submit = async (id: string) => {
    setErr(null);
    try {
      await apiJson('/api/intensive/outreach', { method: 'POST', body: JSON.stringify({ followUpId: id, method, outcome, note: note || null, resolve }) });
      setActive(null);
      setOutcome('');
      setNote('');
      setResolve(false);
      onSaved(resolve ? 'Outreach logged and closed.' : 'Outreach attempt logged.');
    } catch (e) {
      setErr(errText(e));
    }
  };
  if (!rows.length) return <p className="text-sm text-slate-500">No open missed-day outreach in your scope.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {rows.map((o) => (
        <li key={o.id} className="py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <Link href={`/dashboard/programs/intensive/${o.enrollmentId}`} className="font-medium text-slate-900 hover:text-blue-700">{o.clientName}</Link>
              <p className="text-xs text-slate-500">{o.programName} · missed {o.serviceDate} · due {new Date(o.dueAt).toLocaleString()} · {o.attempts} attempt{o.attempts === 1 ? '' : 's'}{o.mine ? ' · assigned to you' : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {o.overdue && <Badge cls="bg-rose-100 text-rose-800">Overdue</Badge>}
              <button className={btnSecondary} onClick={() => setActive(active === o.id ? null : o.id)}>Log outreach</button>
            </div>
          </div>
          {active === o.id && (
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <select className={inputCls} value={method} onChange={(e) => setMethod(e.target.value)} aria-label="Outreach method">
                <option value="phone">Phone call</option><option value="text">Text message</option><option value="portal_message">Portal message</option>
                <option value="email">Email</option><option value="letter">Letter</option><option value="in_person">In person</option><option value="emergency_contact">Emergency contact</option>
              </select>
              <input className={inputCls} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Outcome (reached, voicemail, ...)" aria-label="Outcome" />
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (no clinical detail in texts)" aria-label="Note" />
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" className="accent-blue-700" checked={resolve} onChange={(e) => setResolve(e.target.checked)} /> Close task</label>
                <button className={btnPrimary} disabled={!outcome.trim()} onClick={() => submit(o.id)}>Save</button>
              </div>
              {err && <p className="text-sm text-rose-700 sm:col-span-4">{err}</p>}
              <p className="text-xs text-slate-500 sm:col-span-4">High-risk client not reached: follow the crisis policy (welfare check, 988).</p>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

// ─── Discharges ─────────────────────────────────────────────────────────────

function Discharges({ rows }: { rows: EnrollmentRow[] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No discharges in the last 30 days in your scope.</p>;
  return (
    <div className="clinic-scroll-x"><table className="w-full min-w-[560px] text-sm">
      <thead><tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600"><th scope="col" className="px-3 py-2">Client</th><th scope="col" className="px-3 py-2">Discharged</th><th scope="col" className="px-3 py-2">Next level</th><th scope="col" className="px-3 py-2">Follow-up</th></tr></thead>
      <tbody className="divide-y divide-slate-50">
        {rows.map((r) => (
          <tr key={r.id}>
            <td className="px-3 py-2"><Link href={`/dashboard/programs/intensive/${r.id}`} className="font-medium text-slate-900 hover:text-blue-700">{r.clientName}</Link><p className="text-xs text-slate-500">{r.programName}</p></td>
            <td className="px-3 py-2 text-xs">{r.dischargeDate}</td>
            <td className="px-3 py-2 text-xs">{r.stepDownLevel ?? '—'}</td>
            <td className="px-3 py-2 text-xs">
              {r.followUp ? (
                <Badge cls={r.followUp.state === 'met' || r.followUp.state === 'scheduled' ? 'bg-emerald-100 text-emerald-800' : r.followUp.state === 'not_expected' ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-800'}>
                  {FOLLOWUP_LABEL[r.followUp.state]} (by {r.followUp.windowEnd})
                </Badge>
              ) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}

// ─── Program director ───────────────────────────────────────────────────────

function Director({ r }: { r: Rollup }) {
  const fmt = (v: number | null, suffix = '') => (v === null ? '—' : `${v}${suffix}`);
  const supp = <span className="text-xs text-slate-500">Suppressed (fewer than 10 clients)</span>;
  const totals = useMemo(() => r.perProgram.reduce((s, p) => s + p.census, 0), [r]);
  return (
    <div className="space-y-5">
      <div className="clinic-scroll-x">
        <table className="w-full min-w-[1000px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-600">
              <th scope="col" className={`${stickyTh} px-3 py-2`}>Program</th><th scope="col" className="px-3 py-2">Census</th><th scope="col" className="px-3 py-2">Open referrals</th><th scope="col" className="px-3 py-2">Attendance (28 d)</th>
              <th scope="col" className="px-3 py-2">Under minimum last week</th><th scope="col" className="px-3 py-2">At risk this week</th><th scope="col" className="px-3 py-2">Auth renewal due / none</th>
              <th scope="col" className="px-3 py-2">Weekly reviews missing</th><th scope="col" className="px-3 py-2">Plans overdue</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {r.perProgram.map((p) => (
              <tr key={p.programId}>
                <td className={`${stickyTd} px-3 py-2 font-medium text-slate-900`}>{p.name}</td>
                <td className="px-3 py-2">{p.census}</td>
                <td className="px-3 py-2">{p.referralsOpen}</td>
                <td className="px-3 py-2">{fmt(p.attendancePct, '%')} <span className="text-xs text-slate-500">({p.sessionsRecorded28d} marks)</span></td>
                <td className="px-3 py-2">{p.underMinimumLastWeek}</td>
                <td className="px-3 py-2">{p.atRiskThisWeek}</td>
                <td className="px-3 py-2">{p.authsRenewalDue} / {p.noAuth}</td>
                <td className="px-3 py-2">{p.reviewsMissing}</td>
                <td className="px-3 py-2">{p.plansOverdue}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-slate-500">Total census {totals}. Attendance % = attended session marks / all recorded marks.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Follow-up within the window after discharge (30 days)" icon={<ShieldCheck size={16} className="text-blue-700" aria-hidden />}>
          <p className="text-sm text-slate-700">{r.followUp7.discharges30d} discharges, {r.followUp7.expected} expecting outpatient follow-up.</p>
          {r.followUp7.suppressed ? supp : <p className="mt-1 text-2xl font-semibold text-blue-800">{fmt(r.followUp7.pct, '%')} <span className="text-sm font-normal text-slate-500">({r.followUp7.num} of {r.followUp7.den} decided)</span></p>}
        </Card>
        <Card title="Outcomes (first vs latest score)" icon={<BarChart3 size={16} className="text-blue-700" aria-hidden />}>
          <ul className="space-y-1 text-sm">
            <li><span className="font-semibold">PHQ-9</span> (n={r.outcomes.phq9.n}): {r.outcomes.phq9.suppressed ? supp : `${r.outcomes.phq9.meanFirst} → ${r.outcomes.phq9.meanLatest}; ${r.outcomes.phq9.improvedPct}% improved`}</li>
            <li><span className="font-semibold">GAD-7</span> (n={r.outcomes.gad7.n}): {r.outcomes.gad7.suppressed ? supp : `${r.outcomes.gad7.meanFirst} → ${r.outcomes.gad7.meanLatest}; ${r.outcomes.gad7.improvedPct}% improved`}</li>
            <li><span className="font-semibold">BAM risk level</span> (SUD, n={r.outcomes.bam.n}): {r.outcomes.bam.suppressed ? supp : `${r.outcomes.bam.improvedPct}% lower risk level than at admission`}</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">{r.outcomes.cohortNote}</p>
        </Card>
      </div>
    </div>
  );
}
