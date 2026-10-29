'use client';

import { useMemo, useState } from 'react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  type DischargeCase,
  type DischargeStatus,
  DISCHARGE_CASES_SEED,
  checklistDoneCount,
  createBlankDischarge,
  monthsBetween,
  normalizeCase,
  signaturePending,
} from '@/features/ehr/dischargeData';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Filter,
  Plus,
  TrendingUp,
  UserRound,
} from 'lucide-react';

const ACCENT = '#6868D0';

const REASONS = [
  'All Reasons',
  'Mutually agreed — treatment goals met',
  'Transfer to higher level of care',
  'Client request',
  'Administrative / insurance',
] as const;

function scoreTone(score: number) {
  if (score <= 9) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (score <= 14) return 'bg-amber-50 text-amber-800 border-amber-100';
  return 'bg-red-50 text-red-700 border-red-100';
}

function monthKey(iso: string) {
  return iso.slice(0, 7);
}

function monthLabelFromKey(ym: string) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m || 1) - 1, 1));
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export default function DischargePlanningPage() {
  const [rawCases, setRawCases, { loading }] = useModuleList<DischargeCase>(
    'ehr-discharge-cases',
    []
  );
  const cases = useMemo(() => rawCases.map((c) => normalizeCase(c)), [rawCases]);
  const { clients, loading: clientsLoading } = useClients();

  const [tab, setTab] = useState<'pending' | 'completed' | 'followup'>('pending');
  const [reasonFilter, setReasonFilter] = useState<string>('All Reasons');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aftercareDraft, setAftercareDraft] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    clientId: '',
    clinician: 'Priya Menon, LCSW-C',
    reason: 'Mutually agreed — treatment goals met',
    diagnosis: '',
    targetDischarge: new Date().toISOString().slice(0, 10),
  });

  const persist = (next: DischargeCase[]) => setRawCases(next);

  const updateCase = (id: string, patch: Partial<DischargeCase>) => {
    persist(cases.map((c) => (c.id === id ? normalizeCase({ ...c, ...patch }) : c)));
  };

  const pending = useMemo(
    () => cases.filter((c) => c.status === 'planning' || c.status === 'ready'),
    [cases]
  );
  const completed = useMemo(
    () => cases.filter((c) => c.status === 'discharged' || c.status === 'follow_up'),
    [cases]
  );

  const stats = useMemo(() => {
    const pendingCount = pending.length;
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    // Prefer current month; if empty, fall back to busiest recent month among completed
    let completedMonth = completed.filter((c) => monthKey(c.targetDischarge) === ym);
    let labelYm = ym;
    if (completedMonth.length === 0 && completed.length) {
      const counts = new Map<string, number>();
      for (const c of completed) {
        const k = monthKey(c.targetDischarge);
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      labelYm = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0][0];
      completedMonth = completed.filter((c) => monthKey(c.targetDischarge) === labelYm);
    }

    const day30 = completed.flatMap((c) => c.milestones.filter((m) => m.day === 30));
    const day30Rate =
      day30.length === 0
        ? 0
        : Math.round((day30.filter((m) => m.completed).length / day30.length) * 100);

    const losValues = completed.map((c) => monthsBetween(c.admitDate, c.targetDischarge));
    const avgLos =
      losValues.length === 0
        ? 0
        : Math.round((losValues.reduce((s, n) => s + n, 0) / losValues.length) * 10) / 10;

    return [
      {
        label: 'Pending Discharges',
        value: String(pendingCount),
        sub: 'Awaiting finalization',
        icon: Clock,
        color: '#D97706',
        bg: '#FEF3C7',
      },
      {
        label: 'Completed This Month',
        value: String(completedMonth.length),
        sub: monthLabelFromKey(labelYm),
        icon: CheckCircle2,
        color: '#16a34a',
        bg: '#DCFCE7',
      },
      {
        label: '30-Day Follow-up Rate',
        value: `${day30Rate}%`,
        sub: day30Rate >= 80 ? 'Above 80% CARF threshold' : 'Below 80% CARF threshold',
        subGood: day30Rate >= 80,
        icon: TrendingUp,
        color: '#2563eb',
        bg: '#DBEAFE',
      },
      {
        label: 'Avg LOS at Discharge',
        value: String(avgLos || '—'),
        sub: 'months',
        icon: Calendar,
        color: ACCENT,
        bg: '#E0E2FC',
      },
    ];
  }, [pending, completed]);

  const followUpOpen = useMemo(() => {
    return completed.filter((c) => c.milestones.some((m) => !m.completed)).length;
  }, [completed]);

  const listBase = tab === 'pending' ? pending : tab === 'completed' ? completed : completed;

  const filtered = useMemo(() => {
    let rows = listBase;
    if (tab === 'followup') {
      rows = completed.filter((c) => c.milestones.some((m) => !m.completed));
    }
    if (reasonFilter !== 'All Reasons') {
      rows = rows.filter((c) => c.reason === reasonFilter || c.reason.includes(reasonFilter));
    }
    return rows;
  }, [listBase, tab, completed, reasonFilter]);

  function toggleCheck(caseId: string, itemId: string) {
    const row = cases.find((c) => c.id === caseId);
    if (!row) return;
    updateCase(caseId, {
      checklist: row.checklist.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i)),
    });
  }

  function toggleMilestone(caseId: string, day: 30 | 60 | 90) {
    const row = cases.find((c) => c.id === caseId);
    if (!row) return;
    updateCase(caseId, {
      milestones: row.milestones.map((m) =>
        m.day === day
          ? {
              ...m,
              completed: !m.completed,
              notes: !m.completed
                ? `Completed ${new Date().toISOString().slice(0, 10)} — PHQ-9 ${row.phq9Latest}, GAD-7 ${row.gad7Latest}`
                : m.notes,
            }
          : m
      ),
    });
  }

  function advanceStatus(caseId: string) {
    const order: DischargeStatus[] = ['planning', 'ready', 'discharged', 'follow_up'];
    const row = cases.find((c) => c.id === caseId);
    if (!row) return;
    const idx = order.indexOf(row.status);
    updateCase(caseId, { status: order[Math.min(idx + 1, order.length - 1)] });
  }

  function addAftercare(caseId: string) {
    if (!aftercareDraft.trim()) return;
    const row = cases.find((c) => c.id === caseId);
    if (!row) return;
    updateCase(caseId, { aftercare: [...row.aftercare, aftercareDraft.trim()] });
    setAftercareDraft('');
  }

  function createDischarge() {
    const client = clients.find((c) => c.id === newForm.clientId);
    if (!client) return;
    const row = createBlankDischarge({
      id: `ehr-dc-${Date.now().toString(36)}`,
      clientName: client.name,
      clinician: newForm.clinician,
      reason: newForm.reason,
      diagnosis: newForm.diagnosis || 'To be documented',
      targetDischarge: newForm.targetDischarge,
    });
    persist([row, ...cases]);
    setExpandedId(row.id);
    setTab('pending');
    setShowNew(false);
    setNewForm({
      clientId: '',
      clinician: 'Priya Menon, LCSW-C',
      reason: 'Mutually agreed — treatment goals met',
      diagnosis: '',
      targetDischarge: new Date().toISOString().slice(0, 10),
    });
  }

  if (loading && cases.length === 0) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Discharge &amp; Transition Planning</h1>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Loading discharge cases…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Discharge &amp; Transition Planning</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Structured discharge summaries, aftercare planning, and 30-day follow-up tracking
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          style={{ background: ACCENT }}
        >
          <Plus size={15} /> New Discharge Summary
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: s.bg, color: s.color }}
            >
              <s.icon size={20} />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{s.value}</p>
            <p className="text-sm font-semibold text-slate-800">{s.label}</p>
            <p
              className={`mt-0.5 text-xs ${
                'subGood' in s && s.subGood
                  ? 'font-semibold text-emerald-600'
                  : 'subGood' in s && s.subGood === false
                    ? 'font-semibold text-amber-700'
                    : 'text-slate-500'
              }`}
            >
              {s.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="border-b border-slate-200">
        <div className="flex flex-wrap gap-6">
          {(
            [
              { id: 'pending' as const, label: 'Pending Discharges', count: pending.length },
              { id: 'completed' as const, label: 'Completed Discharges', count: completed.length },
              { id: 'followup' as const, label: 'Follow-up Tracker', count: followUpOpen },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`relative pb-3 text-sm font-semibold transition-colors ${
                tab === t.id ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <span className="inline-flex items-center gap-2">
                {t.label}
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    tab === t.id ? 'text-white' : 'bg-slate-100 text-slate-600'
                  }`}
                  style={tab === t.id ? { background: ACCENT } : {}}
                >
                  {t.count}
                </span>
              </span>
              {tab === t.id ? (
                <span
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-full"
                  style={{ background: ACCENT }}
                />
              ) : null}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
        <Filter size={15} className="text-slate-400" />
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700"
        >
          {REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <span className="text-slate-400">{filtered.length} record(s)</span>
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500">
            No discharge records in this view. Create one with New Discharge Summary.
          </div>
        ) : null}

        {filtered.map((c) => {
          const open = expandedId === c.id;
          const done = checklistDoneCount(c);
          const total = c.checklist.length || 7;
          const pendingSig = signaturePending(c) && (c.status === 'planning' || c.status === 'ready');
          return (
            <div
              key={c.id}
              className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm"
            >
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : c.id)}
                className="flex w-full items-stretch gap-4 p-5 text-left hover:bg-slate-50/80"
              >
                <div
                  className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
                  style={{ background: '#E0E2FC', color: ACCENT }}
                >
                  <UserRound size={18} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-slate-900">{c.clientName}</h3>
                    <span className="text-xs text-slate-500">DOB {c.dob}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        c.status === 'planning' || c.status === 'ready'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {c.status === 'planning' || c.status === 'ready' ? 'Pending' : 'Completed'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">
                    <span className="font-medium text-slate-500">Diagnosis:</span> {c.diagnosis}
                    {c.extraDiagnoses > 0 ? (
                      <span className="text-slate-400"> +{c.extraDiagnoses} more</span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    <span className="font-medium text-slate-500">Reason:</span> {c.reason}
                  </p>
                  <p className="mt-0.5 text-sm text-slate-600">
                    <span className="font-medium text-slate-500">Clinician:</span> {c.clinician}
                  </p>
                  {pendingSig ? (
                    <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
                      <AlertTriangle size={13} /> Client signature pending
                    </p>
                  ) : null}
                </div>

                <div className="hidden shrink-0 grid-cols-2 gap-x-6 gap-y-2 text-right sm:grid lg:grid-cols-4">
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Anticipated Discharge
                    </p>
                    <p className="text-sm font-semibold text-slate-800">{c.targetDischarge}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Goals Met
                    </p>
                    <p className="text-sm font-semibold text-slate-800">{c.goalsMet}%</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                      Checklist
                    </p>
                    <p className="text-sm font-semibold text-slate-800">
                      {done}/{total}
                    </p>
                  </div>
                  <div className="flex items-end justify-end gap-2">
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-bold ${scoreTone(c.phq9Latest)}`}
                    >
                      PHQ-9 {c.phq9Latest}
                    </span>
                    <span
                      className={`rounded-lg border px-2 py-1 text-xs font-bold ${scoreTone(c.gad7Latest)}`}
                    >
                      GAD-7 {c.gad7Latest}
                    </span>
                  </div>
                </div>

                <div className="flex shrink-0 items-center text-slate-400">
                  {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </div>
              </button>

              {open ? (
                <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-5">
                  {c.summary ? (
                    <p className="text-sm leading-relaxed text-slate-700">{c.summary}</p>
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => advanceStatus(c.id)}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Advance status
                    </button>
                    <span className="self-center text-xs text-slate-400">
                      Current: {c.status.replace('_', ' ')} · Admit {c.admitDate}
                    </span>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <h4 className="text-sm font-semibold text-slate-800">Discharge checklist</h4>
                        <span className="text-xs font-semibold text-slate-500">
                          {done}/{total}
                        </span>
                      </div>
                      <div className="mb-3 h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.round((done / Math.max(1, total)) * 100)}%`,
                            background: ACCENT,
                          }}
                        />
                      </div>
                      <div className="space-y-1.5">
                        {c.checklist.map((item) => (
                          <label
                            key={item.id}
                            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50"
                          >
                            <input
                              type="checkbox"
                              checked={item.done}
                              onChange={() => toggleCheck(c.id, item.id)}
                              className="h-4 w-4 rounded border-slate-300"
                              style={{ accentColor: ACCENT }}
                            />
                            <span
                              className={`text-sm ${item.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}
                            >
                              {item.label}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="mb-3 text-sm font-semibold text-slate-800">Aftercare plan</h4>
                      <ul className="mb-3 space-y-2">
                        {c.aftercare.map((a) => (
                          <li key={a} className="flex items-start gap-2 text-sm text-slate-700">
                            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-emerald-600" />
                            {a}
                          </li>
                        ))}
                        {c.aftercare.length === 0 ? (
                          <li className="text-sm italic text-slate-400">No aftercare items yet.</li>
                        ) : null}
                      </ul>
                      <div className="flex gap-2">
                        <input
                          value={expandedId === c.id ? aftercareDraft : ''}
                          onChange={(e) => setAftercareDraft(e.target.value)}
                          placeholder="Add aftercare item…"
                          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                        <button
                          type="button"
                          onClick={() => addAftercare(c.id)}
                          className="rounded-xl px-3 py-2 text-sm font-semibold text-white"
                          style={{ background: ACCENT }}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4">
                    <h4 className="mb-3 text-sm font-semibold text-slate-800">30 / 60 / 90 day tracker</h4>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {c.milestones.map((m) => (
                        <div
                          key={m.day}
                          className={`rounded-xl border p-3 ${
                            m.completed ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200'
                          }`}
                        >
                          <div className="mb-1 flex items-center justify-between">
                            <span className="font-bold text-slate-900">Day {m.day}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                m.completed
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {m.completed ? 'Done' : 'Pending'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500">Scheduled {m.scheduled}</p>
                          <p className="mt-1 text-sm text-slate-700">{m.notes}</p>
                          <button
                            type="button"
                            onClick={() => toggleMilestone(c.id, m.day)}
                            className="mt-2 w-full rounded-lg border border-slate-200 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {m.completed ? 'Mark pending' : 'Mark complete'}
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">New Discharge Summary</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Client</label>
                <select
                  value={newForm.clientId}
                  onChange={(e) => setNewForm((f) => ({ ...f, clientId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                >
                  <option value="">{clientsLoading ? 'Loading…' : 'Select client…'}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Reason</label>
                <select
                  value={newForm.reason}
                  onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                >
                  {REASONS.filter((r) => r !== 'All Reasons').map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Clinician</label>
                  <input
                    value={newForm.clinician}
                    onChange={(e) => setNewForm((f) => ({ ...f, clinician: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Anticipated discharge
                  </label>
                  <input
                    type="date"
                    value={newForm.targetDischarge}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, targetDischarge: e.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Diagnosis</label>
                <input
                  value={newForm.diagnosis}
                  onChange={(e) => setNewForm((f) => ({ ...f, diagnosis: e.target.value }))}
                  placeholder="e.g. Major Depressive Disorder (F33.1)"
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!newForm.clientId}
                onClick={createDischarge}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                Create Summary
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
