'use client';

import { useEffect, useMemo, useState } from 'react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  type ClientPlan,
  type RiskLevel,
  type SafetyContact,
  completedStepCount,
  createBlankPlan,
  normalizePlan,
  planProgress,
} from '@/features/ehr/safetyPlansData';
import { fetchRiskAlerts, type RiskAlert } from '@/features/alerts';
import {
  AlertTriangle,
  CheckCircle2,
  Pencil,
  Phone,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Shield,
  FileDown,
} from 'lucide-react';

const RISK_STYLE: Record<RiskLevel, { bg: string; text: string }> = {
  High: { bg: '#FEE2E2', text: '#991B1B' },
  Moderate: { bg: '#FEF3C7', text: '#92400E' },
  Low: { bg: '#D1FAE5', text: '#065F46' },
};

const ACCENT = '#6868D0';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(d = new Date()) {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function progressBarColor(pct: number) {
  if (pct >= 100) return '#16a34a';
  if (pct >= 67) return '#6868D0';
  if (pct >= 40) return '#ea580c';
  return '#f59e0b';
}

function ContactList({
  contacts,
  editing,
  onChange,
}: {
  contacts: SafetyContact[];
  editing: boolean;
  onChange: (next: SafetyContact[]) => void;
}) {
  if (editing) {
    return (
      <div className="mt-3 space-y-2">
        {contacts.map((c, i) => (
          <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <input
              value={c.name}
              placeholder="Name"
              onChange={(e) => {
                const next = contacts.slice();
                next[i] = { ...c, name: e.target.value };
                onChange(next);
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
            <input
              value={c.relationship}
              placeholder="Relationship"
              onChange={(e) => {
                const next = contacts.slice();
                next[i] = { ...c, relationship: e.target.value };
                onChange(next);
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
            <input
              value={c.phone}
              placeholder="Phone"
              onChange={(e) => {
                const next = contacts.slice();
                next[i] = { ...c, phone: e.target.value };
                onChange(next);
              }}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...contacts, { name: '', relationship: '', phone: '' }])}
          className="text-xs font-semibold"
          style={{ color: ACCENT }}
        >
          + Add contact
        </button>
      </div>
    );
  }
  if (!contacts.length) {
    return <p className="mt-3 text-sm italic text-slate-400">Not documented yet.</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {contacts.map((c, i) => (
        <li key={`${c.name}-${i}`} className="flex items-center gap-3 text-sm">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
            style={{ background: ACCENT }}
          >
            {i + 1}
          </span>
          <span className="font-semibold text-slate-900">{c.name}</span>
          <span className="text-slate-400">|</span>
          <span className="text-slate-500">{c.relationship}</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-slate-700">
            <Phone size={13} className="text-slate-400" />
            {c.phone}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Re-export seed for `scripts/seed-ehr-modules.ts` */
export default function SafetyPlanPage() {
  const [rawPlans, setRawPlans, { loading }] = useModuleList<ClientPlan>('ehr-safety-plans', []);
  const plans = useMemo(() => rawPlans.map((p) => normalizePlan(p)), [rawPlans]);
  const { clients, loading: clientsLoading } = useClients();

  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState<'plans' | 'means'>('plans');
  const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all');
  const [search, setSearch] = useState('');
  const [editingStep, setEditingStep] = useState<number | null>(null);
  const [draftText, setDraftText] = useState('');
  const [draftContacts, setDraftContacts] = useState<SafetyContact[]>([]);
  const [draftMeans, setDraftMeans] = useState<ClientPlan['meansItems']>([]);
  const [draftMeansNotes, setDraftMeansNotes] = useState('');
  const [draftMeansDoc, setDraftMeansDoc] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({
    clientId: '',
    clientName: '',
    risk: 'Moderate' as RiskLevel,
    phq9: '12',
    clinician: 'James Osei, LPC',
  });
  const [saveFlash, setSaveFlash] = useState(false);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);

  useEffect(() => {
    fetchRiskAlerts()
      .then((d) => setAlerts(d.alerts))
      .catch(() => {});
  }, []);

  const thirtyDaysAgo = useMemo(() => Date.now() - 30 * 24 * 60 * 60 * 1000, []);
  const highRiskClientNames = useMemo(() => {
    const set = new Set<string>();
    for (const a of alerts) {
      if (a.severity === 'high' && new Date(a.createdAt).getTime() >= thirtyDaysAgo) {
        set.add(a.clientName.toLowerCase());
      }
    }
    return set;
  }, [alerts, thirtyDaysAgo]);

  const isPlanReviewDue = (p: ClientPlan) => {
    if (p.reviewDue) return true;
    const hasRecentCrisis = highRiskClientNames.has(p.clientName.toLowerCase()) || p.risk === 'High';
    const intervalDays = hasRecentCrisis ? 30 : 90;
    const reviewTime = new Date(p.lastReviewed || p.createdAt).getTime();
    return (Date.now() - reviewTime) > intervalDays * 24 * 60 * 60 * 1000;
  };

  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;

  useEffect(() => {
    if (!selectedId && plans[0]) setSelectedId(plans[0].id);
  }, [plans, selectedId]);

  const persist = (next: ClientPlan[]) => setRawPlans(next);

  const updatePlan = (id: string, patch: Partial<ClientPlan>) => {
    persist(
      plans.map((p) =>
        p.id === id ? normalizePlan({ ...p, ...patch, lastUpdated: todayIso() }) : p
      )
    );
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return plans.filter((p) => {
      if (riskFilter !== 'all' && p.risk !== riskFilter) return false;
      if (!q) return true;
      return (
        p.clientName.toLowerCase().includes(q) ||
        p.clinician.toLowerCase().includes(q) ||
        p.initials.toLowerCase().includes(q)
      );
    });
  }, [plans, riskFilter, search]);

  const stats = useMemo(() => {
    const now = new Date();
    const ym = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const active = plans.filter((p) => !p.withoutPlan).length;
    const updatedMonth = plans.filter((p) => p.lastUpdated.startsWith(ym)).length;
    const highWithout = plans.filter(
      (p) => p.withoutPlan || (p.risk === 'High' && planProgress(p) === 0)
    ).length;
    const reviewed = plans.reduce((s, p) => s + (p.sessionReviews || 0), 0);
    return [
      {
        label: 'Active Safety Plans',
        value: String(active),
        sub: 'Across all clinicians',
        icon: Shield,
        color: '#2563eb',
        bg: '#DBEAFE',
      },
      {
        label: 'Updated This Month',
        value: String(updatedMonth),
        sub: monthLabel(),
        icon: RefreshCw,
        color: '#16a34a',
        bg: '#DCFCE7',
      },
      {
        label: 'High-Risk Without Plan',
        value: String(highWithout),
        sub: highWithout ? 'Action required' : 'None',
        icon: AlertTriangle,
        color: '#dc2626',
        bg: '#FEE2E2',
        subDanger: highWithout > 0,
      },
      {
        label: 'Reviewed in Session',
        value: String(reviewed),
        sub: 'This quarter',
        icon: CheckCircle2,
        color: ACCENT,
        bg: '#E0E2FC',
      },
    ];
  }, [plans]);

  const meansQueue = useMemo(
    () =>
      plans.filter(
        (p) =>
          !p.withoutPlan &&
          (!p.meansCounselingDocumented || p.meansItems.some((m) => !m.done))
      ),
    [plans]
  );

  function startEdit(stepId: number) {
    if (!selected) return;
    const step = selected.steps.find((s) => s.id === stepId);
    setEditingStep(stepId);
    setDraftText(step?.content || '');
    if (stepId === 3) setDraftContacts(selected.distractionContacts.slice());
    if (stepId === 4) setDraftContacts(selected.helpContacts.slice());
    if (stepId === 6) {
      setDraftMeans(selected.meansItems.map((m) => ({ ...m })));
      setDraftMeansNotes(selected.meansNotes);
      setDraftMeansDoc(selected.meansCounselingDocumented);
    }
  }

  function saveStep() {
    if (editingStep == null || !selected) return;
    const id = selected.id;
    if (editingStep === 3) {
      updatePlan(id, {
        distractionContacts: draftContacts.filter((c) => c.name.trim()),
        steps: selected.steps.map((s) =>
          s.id === 3
            ? {
                ...s,
                content: draftContacts
                  .filter((c) => c.name.trim())
                  .map((c) => `${c.name} (${c.relationship})`)
                  .join(', '),
              }
            : s
        ),
      });
    } else if (editingStep === 4) {
      updatePlan(id, {
        helpContacts: draftContacts.filter((c) => c.name.trim()),
        steps: selected.steps.map((s) =>
          s.id === 4
            ? {
                ...s,
                content: draftContacts
                  .filter((c) => c.name.trim())
                  .map((c) => `${c.name} (${c.relationship})`)
                  .join(', '),
              }
            : s
        ),
      });
    } else if (editingStep === 6) {
      updatePlan(id, {
        meansItems: draftMeans,
        meansNotes: draftMeansNotes,
        meansCounselingDocumented: draftMeansDoc,
        steps: selected.steps.map((s) =>
          s.id === 6
            ? {
                ...s,
                content: draftMeans
                  .filter((m) => m.done)
                  .map((m) => m.label)
                  .join(' '),
              }
            : s
        ),
      });
    } else {
      updatePlan(id, {
        steps: selected.steps.map((s) =>
          s.id === editingStep ? { ...s, content: draftText } : s
        ),
      });
    }
    setEditingStep(null);
  }

  function savePlan() {
    if (!selected) return;
    updatePlan(selected.id, {
      lastReviewed: todayIso(),
      sessionReviews: selected.sessionReviews + (selected.lastReviewed === todayIso() ? 0 : 1),
      withoutPlan: planProgress(selected) === 0 ? selected.withoutPlan : false,
    });
    setSaveFlash(true);
    window.setTimeout(() => setSaveFlash(false), 1600);
  }

  function handlePrintRegistry() {
    window.print();
  }

  function createPlan() {
    const name =
      newForm.clientName.trim() ||
      clients.find((c) => c.id === newForm.clientId)?.name ||
      '';
    if (!name) return;
    const plan = createBlankPlan({
      id: `ehr-sp-${Date.now().toString(36)}`,
      clientName: name,
      clinician: newForm.clinician,
      risk: newForm.risk,
      phq9: Number(newForm.phq9) || 10,
    });
    const finalPlan = normalizePlan({
      ...plan,
      clientName: name,
      fullLabel: `${name} — Outpatient`,
    });
    persist([finalPlan, ...plans]);
    setSelectedId(finalPlan.id);
    setShowNew(false);
    setActiveTab('plans');
    setNewForm({
      clientId: '',
      clientName: '',
      risk: 'Moderate',
      phq9: '12',
      clinician: 'James Osei, LPC',
    });
  }

  if (loading && plans.length === 0) {
    return (
      <div className="w-full space-y-6">
        <h1 className="text-2xl font-semibold text-slate-900">Crisis Safety Plans</h1>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">
          Loading safety plans…
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Crisis Safety Plans</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Stanley-Brown Safety Planning Intervention — evidence-based, collaboratively developed with
            clients
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePrintRegistry}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            <Printer size={15} /> Print Registry
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, ${ACCENT})` }}
          >
            <Plus size={15} /> New Safety Plan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 print:hidden">
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
            <p className={`mt-0.5 text-xs ${s.subDanger ? 'font-semibold text-red-600' : 'text-slate-500'}`}>
              {s.sub}
            </p>
          </div>
        ))}
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-sm print:hidden">
        {(
          [
            { id: 'plans' as const, label: 'Safety Plans' },
            { id: 'means' as const, label: 'Means Restriction Counseling' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActiveTab(t.id)}
            className={`rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
              activeTab === t.id ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            style={activeTab === t.id ? { background: ACCENT } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'means' ? (
        <div className="space-y-3 print:hidden">
          <p className="text-sm text-slate-600">
            Plans needing means-restriction follow-up ({meansQueue.length}). Open a plan to complete Step 6
            checklists and document counseling.
          </p>
          {meansQueue.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedId(p.id);
                setActiveTab('plans');
                setEditingStep(6);
                setDraftMeans(p.meansItems.map((m) => ({ ...m })));
                setDraftMeansNotes(p.meansNotes);
                setDraftMeansDoc(p.meansCounselingDocumented);
              }}
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-sm hover:border-slate-300"
            >
              <div>
                <p className="font-semibold text-slate-900">{p.clientName}</p>
                <p className="text-xs text-slate-500">
                  {p.clinician} ·{' '}
                  {p.meansCounselingDocumented ? 'Partial checklist' : 'Counseling not documented'}
                </p>
              </div>
              <span
                className="rounded-full px-2.5 py-1 text-xs font-semibold"
                style={{ background: RISK_STYLE[p.risk].bg, color: RISK_STYLE[p.risk].text }}
              >
                {p.risk}
              </span>
            </button>
          ))}
          {meansQueue.length === 0 ? (
            <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-5 py-8 text-center text-sm text-emerald-800">
              All active plans have means-restriction counseling documented.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm print:hidden">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients..."
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="flex flex-wrap gap-1">
              {(['all', 'High', 'Moderate', 'Low'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRiskFilter(r)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    riskFilter === r ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                  style={riskFilter === r ? { background: ACCENT } : {}}
                >
                  {r === 'all' ? 'All' : r}
                </button>
              ))}
            </div>
            <div className="max-h-[70vh] space-y-2 overflow-y-auto">
              {filtered.map((c) => {
                const pct = planProgress(c);
                const active = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(c.id);
                      setEditingStep(null);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      active ? 'border-indigo-300 bg-indigo-50/40' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900">{c.clientName}</p>
                      <span
                        className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={{ background: RISK_STYLE[c.risk].bg, color: RISK_STYLE[c.risk].text }}
                      >
                        {c.risk}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      PHQ-9 {c.phq9} · {c.clinician}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: progressBarColor(pct) }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-400">
                      <span>{pct}% complete</span>
                      {isPlanReviewDue(c) ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                          Review Due
                        </span>
                      ) : (
                        <span>Reviewed {c.lastReviewed}</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No safety plans match.</p>
              ) : null}
            </div>
          </div>

          {!selected ? (
            <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
              No safety plan selected. Create one with New Safety Plan.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{selected.clientName}</h2>
                      <span
                        className="rounded-full px-2.5 py-1 text-xs font-semibold"
                        style={{
                          background: RISK_STYLE[selected.risk].bg,
                          color: RISK_STYLE[selected.risk].text,
                        }}
                      >
                        {selected.risk} Risk
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      PHQ-9 {selected.phq9} · {selected.clinician} · Created {selected.createdAt} · Last
                      reviewed {selected.lastReviewed}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 print:hidden">
                    <button
                      type="button"
                      onClick={() => window.print()}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <FileDown size={14} /> Export PDF
                    </button>
                    <button
                      type="button"
                      onClick={savePlan}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-white"
                      style={{ background: ACCENT }}
                    >
                      <Save size={14} /> {saveFlash ? 'Saved' : 'Save Plan'}
                    </button>
                  </div>
                </div>

                {isPlanReviewDue(selected) && (
                  <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                    <AlertTriangle className="mt-0.5 shrink-0 text-amber-600" size={18} />
                    <div>
                      <h4 className="font-semibold text-xs text-amber-900">Safety Plan Review Due</h4>
                      <p className="text-xs text-amber-700 mt-0.5">
                        {highRiskClientNames.has(selected.clientName.toLowerCase()) || selected.risk === 'High'
                          ? 'High-risk profile / crisis alert requires safety plan review within 30 days.'
                          : 'Standard CARF / OMHC protocol requires safety plan review every 90 days.'}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs font-medium text-slate-600">
                    <span>
                      {planProgress(selected)}% ({completedStepCount(selected)} / 6 steps complete)
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${planProgress(selected)}%`,
                        background: progressBarColor(planProgress(selected)),
                      }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 print:hidden">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={selected.clientSigned}
                        onChange={(e) => updatePlan(selected.id, { clientSigned: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300"
                        style={{ accentColor: ACCENT }}
                      />
                      Client Signed
                    </label>
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={selected.clinicianSigned}
                        onChange={(e) =>
                          updatePlan(selected.id, { clinicianSigned: e.target.checked })
                        }
                        className="h-4 w-4 rounded border-slate-300"
                        style={{ accentColor: ACCENT }}
                      />
                      Clinician Signed
                    </label>
                  </div>
                </div>
              </div>

              {selected.steps.map((step) => {
                const isEditing = editingStep === step.id;
                const done =
                  step.id === 6
                    ? Boolean(
                        step.content.trim() ||
                          selected.meansItems.some((m) => m.done) ||
                          selected.meansNotes.trim()
                      )
                    : step.id === 3
                      ? selected.distractionContacts.length > 0 || Boolean(step.content.trim())
                      : step.id === 4
                        ? selected.helpContacts.length > 0 || Boolean(step.content.trim())
                        : Boolean(step.content.trim());

                return (
                  <div
                    key={step.id}
                    className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                          style={{
                            background: done ? '#DCFCE7' : '#E0E2FC',
                            color: done ? '#16a34a' : ACCENT,
                          }}
                        >
                          <CheckCircle2 size={16} />
                        </div>
                        <div>
                          <h3 className="font-semibold" style={{ color: ACCENT }}>
                            STEP {step.id}: {step.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500">{step.prompt}</p>
                        </div>
                      </div>
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEdit(step.id)}
                          className="inline-flex items-center gap-1 text-xs font-semibold print:hidden"
                          style={{ color: ACCENT }}
                        >
                          <Pencil size={12} /> Edit
                        </button>
                      ) : null}
                    </div>

                    {isEditing && step.id === 6 ? (
                      <div className="mt-4 space-y-3 print:hidden">
                        {draftMeans.map((m) => (
                          <label key={m.id} className="flex items-start gap-2 text-sm text-slate-700">
                            <input
                              type="checkbox"
                              checked={m.done}
                              onChange={(e) =>
                                setDraftMeans((prev) =>
                                  prev.map((x) =>
                                    x.id === m.id ? { ...x, done: e.target.checked } : x
                                  )
                                )
                              }
                              className="mt-0.5 h-4 w-4"
                              style={{ accentColor: ACCENT }}
                            />
                            {m.label}
                          </label>
                        ))}
                        <label
                          className="flex items-start gap-2 text-sm font-semibold"
                          style={{ color: ACCENT }}
                        >
                          <input
                            type="checkbox"
                            checked={draftMeansDoc}
                            onChange={(e) => setDraftMeansDoc(e.target.checked)}
                            className="mt-0.5 h-4 w-4"
                            style={{ accentColor: ACCENT }}
                          />
                          Means restriction counseling documented for this session
                        </label>
                        <div>
                          <p className="mb-1 text-xs font-medium text-slate-500">
                            Clinician Notes — Means Restriction
                          </p>
                          <textarea
                            rows={3}
                            value={draftMeansNotes}
                            onChange={(e) => setDraftMeansNotes(e.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveStep}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                            style={{ background: ACCENT }}
                          >
                            Save step
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStep(null)}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : isEditing && (step.id === 3 || step.id === 4) ? (
                      <div className="mt-3 print:hidden">
                        <ContactList
                          contacts={draftContacts}
                          editing
                          onChange={setDraftContacts}
                        />
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={saveStep}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                            style={{ background: ACCENT }}
                          >
                            Save step
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStep(null)}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : isEditing ? (
                      <div className="mt-3 space-y-3 print:hidden">
                        <textarea
                          rows={4}
                          value={draftText}
                          onChange={(e) => setDraftText(e.target.value)}
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={saveStep}
                            className="rounded-xl px-4 py-2 text-sm font-semibold text-white"
                            style={{ background: ACCENT }}
                          >
                            Save step
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingStep(null)}
                            className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : step.id === 3 ? (
                      <ContactList
                        contacts={selected.distractionContacts}
                        editing={false}
                        onChange={() => undefined}
                      />
                    ) : step.id === 4 ? (
                      <ContactList
                        contacts={selected.helpContacts}
                        editing={false}
                        onChange={() => undefined}
                      />
                    ) : step.id === 6 ? (
                      <div className="mt-4 space-y-3">
                        {selected.meansItems.map((m) => (
                          <div key={m.id} className="flex items-start gap-2 text-sm text-slate-700">
                            <span
                              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                m.done
                                  ? 'border-emerald-500 bg-emerald-500 text-white'
                                  : 'border-slate-300'
                              }`}
                            >
                              {m.done ? '✓' : ''}
                            </span>
                            {m.label}
                          </div>
                        ))}
                        <div
                          className={`flex items-start gap-2 text-sm font-semibold ${
                            selected.meansCounselingDocumented ? '' : 'text-slate-400'
                          }`}
                          style={
                            selected.meansCounselingDocumented ? { color: ACCENT } : undefined
                          }
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              selected.meansCounselingDocumented
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : 'border-slate-300'
                            }`}
                          >
                            {selected.meansCounselingDocumented ? '✓' : ''}
                          </span>
                          Means restriction counseling documented for this session
                        </div>
                        {selected.meansNotes ? (
                          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                            <p className="mb-1 text-xs font-medium text-slate-500">
                              Clinician Notes — Means Restriction
                            </p>
                            {selected.meansNotes}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                        {step.content || (
                          <span className="italic text-slate-400">Not documented yet.</span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
                <h3 className="mb-3 font-semibold text-slate-900">Crisis Contacts</h3>
                <ul className="divide-y divide-slate-100">
                  {selected.crisisResources.map((r) => (
                    <li
                      key={r.label}
                      className={`flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-sm ${
                        r.urgent ? 'rounded-lg bg-red-50 font-semibold text-red-700' : 'text-slate-700'
                      }`}
                    >
                      <span className={r.urgent ? 'text-red-700' : 'text-slate-500'}>{r.label}</span>
                      <span className="inline-flex items-center gap-1.5">
                        {!r.urgent ? <Phone size={13} className="text-slate-400" /> : null}
                        {r.value}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">New Safety Plan</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Client</label>
                <select
                  value={newForm.clientId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const c = clients.find((x) => x.id === id);
                    setNewForm((f) => ({
                      ...f,
                      clientId: id,
                      clientName: c?.name || f.clientName,
                    }));
                  }}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">Risk</label>
                  <select
                    value={newForm.risk}
                    onChange={(e) =>
                      setNewForm((f) => ({ ...f, risk: e.target.value as RiskLevel }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    <option>High</option>
                    <option>Moderate</option>
                    <option>Low</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">PHQ-9</label>
                  <input
                    type="number"
                    min={0}
                    max={27}
                    value={newForm.phq9}
                    onChange={(e) => setNewForm((f) => ({ ...f, phq9: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Clinician</label>
                <input
                  value={newForm.clinician}
                  onChange={(e) => setNewForm((f) => ({ ...f, clinician: e.target.value }))}
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
                onClick={createPlan}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: ACCENT }}
              >
                Create Plan
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
