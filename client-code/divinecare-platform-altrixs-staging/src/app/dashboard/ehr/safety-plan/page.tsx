'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  type ClientPlan,
  type RiskLevel,
  type SafetyContact,
  SAFETY_PLAN_SEED,
  completedStepCount,
  createBlankPlan,
  dateLabel,
  normalizePlan,
  planProgress,
  riskLabel,
  scoreLabel,
} from '@/features/ehr/safetyPlansData';
import { fetchRiskAlerts, type RiskAlert } from '@/features/alerts';
import { AlertTriangle, CheckCircle2, Pencil, Phone, Plus, Printer, RefreshCw, Save, Shield, FileDown, Check } from 'lucide-react';
import { buttonClasses, PageHeader, StatCard, StatGrid, StatusBadge, type Tone, LoadingState } from '@/components/ui';

const RISK_STYLE: Record<RiskLevel, { tone: Tone }> = {
  High: { tone: 'danger' },
  Moderate: { tone: 'warning' },
  Low: { tone: 'success' },
};

/** Neutral badge when risk has not been assessed — never coloured as a risk tier. */
const UNASSESSED_STYLE: { tone: Tone } = { tone: 'neutral' };

function riskStyle(risk: RiskLevel | null) {
  return risk ? RISK_STYLE[risk] : UNASSESSED_STYLE;
}

/** Parse an optional 0–max score from a form field; blank/invalid = not recorded. */
function parseScore(v: string, max: number): number | null {
  if (!v.trim()) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}


function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function monthLabel(d = new Date()) {
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function progressBarColor(pct: number) {
  if (pct >= 100) return 'bg-emerald-600';
  if (pct >= 67) return 'bg-blue-600';
  if (pct >= 40) return 'bg-amber-600';
  return 'bg-amber-500';
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
          className="text-xs font-semibold text-blue-700"
        >
          + Add contact
        </button>
      </div>
    );
  }
  if (!contacts.length) {
    return <p className="mt-3 text-sm italic text-slate-500">Not documented yet.</p>;
  }
  return (
    <ul className="mt-3 space-y-2">
      {contacts.map((c, i) => (
        <li key={`${c.name}-${i}`} className="flex items-center gap-3 text-sm">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white bg-blue-600"
          >
            {i + 1}
          </span>
          <span className="font-semibold text-slate-900">{c.name}</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-500">{c.relationship}</span>
          <span className="ml-auto inline-flex items-center gap-1.5 font-medium text-slate-700">
            <Phone size={13} className="text-slate-500" />
            {c.phone}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Re-export seed for `scripts/seed-ehr-modules.ts` */
export { SAFETY_PLAN_SEED };

export default function SafetyPlanPage() {
  const [rawPlans, setRawPlans, { loading }] = useModuleList<ClientPlan>('ehr-safety-plans', []);
  const plans = useMemo(() => rawPlans.map((p) => normalizePlan(p)), [rawPlans]);
  const { clients, loading: clientsLoading } = useClients();

  const [selectedId, setSelectedId] = useState('');
  const [activeTab, setActiveTab] = useState<'plans' | 'means'>('plans');
  const [riskFilter, setRiskFilter] = useState<'all' | 'unassessed' | RiskLevel>('all');
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
    risk: '' as RiskLevel | '',
    phq9: '',
    clinician: '',
  });
  const [saveFlash, setSaveFlash] = useState(false);
  const [alerts, setAlerts] = useState<RiskAlert[]>([]);

  useEffect(() => {
    fetchRiskAlerts()
      .then((d) => setAlerts(d.alerts))
      .catch(() => {});
  }, []);

  const [nowMs] = useState(() => Date.now());
  const thirtyDaysAgo = nowMs - 30 * 24 * 60 * 60 * 1000;
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
    // No known review or creation date: treat as due so a clinician confirms the plan.
    if (Number.isNaN(reviewTime)) return true;
    return (nowMs - reviewTime) > intervalDays * 24 * 60 * 60 * 1000;
  };

  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;

  // ?clientId= (Visit Guide "Safety plan"): open that client's plan, or start a new one for them.
  // Only clients in the user's client list (useClients scope) are started; otherwise the page behaves as usual.
  const clientParamHandled = useRef(false);
  useEffect(() => {
    if (clientParamHandled.current || loading || clientsLoading) return;
    clientParamHandled.current = true;
    const requested = new URLSearchParams(window.location.search).get('clientId');
    if (!requested) return;
    const client = clients.find((c) => c.id === requested);
    const existing =
      plans.find((p) => p.clientId === requested) ??
      (client ? plans.find((p) => !p.clientId && p.clientName.toLowerCase() === client.name.toLowerCase()) : undefined);
    if (existing) {
      setActiveTab('plans');
      setSelectedId(existing.id);
    } else if (client) {
      setNewForm((f) => ({ ...f, clientId: client.id, clientName: client.name }));
      setShowNew(true);
    }
  }, [loading, clientsLoading, clients, plans]);

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
      if (riskFilter === 'unassessed' && p.risk !== null) return false;
      if (riskFilter !== 'all' && riskFilter !== 'unassessed' && p.risk !== riskFilter) return false;
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
        tone: 'info' as const,
      },
      {
        label: 'Updated This Month',
        value: String(updatedMonth),
        sub: monthLabel(),
        icon: RefreshCw,
        tone: 'success' as const,
      },
      {
        label: 'High-Risk Without Plan',
        value: String(highWithout),
        sub: highWithout ? 'Action required' : 'None',
        icon: AlertTriangle,
        tone: 'danger' as const,
        subDanger: highWithout > 0,
      },
      {
        label: 'Reviewed in Session',
        value: String(reviewed),
        sub: 'This quarter',
        icon: CheckCircle2,
        tone: 'brand' as const,
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
      clientId: newForm.clientId || undefined,
      clientName: name,
      clinician: newForm.clinician,
      risk: newForm.risk || null,
      phq9: parseScore(newForm.phq9, 27),
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
      risk: '',
      phq9: '',
      clinician: '',
    });
  }

  if (loading && plans.length === 0) {
    return (
      <div className="w-full space-y-6">
        <PageHeader title="Crisis Safety Plans" />
        <LoadingState label="Loading safety plans…" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <PageHeader
        title="Crisis Safety Plans"
        description={<>Stanley-Brown Safety Planning Intervention — evidence-based, collaboratively developed with clients</>}
        actions={<>
          <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handlePrintRegistry}
            className={buttonClasses({ variant: 'secondary', className: 'inline-flex' })}
          >
            <Printer size={15} /> Print Registry
          </button>
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className={buttonClasses({ variant: 'primary' })}
          >
            <Plus size={15} /> New Safety Plan
          </button>
        </div>
        </>}
      />

      <div className="print:hidden">
        <StatGrid columns={4}>
          {stats.map((s) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              tone={s.tone}
              icon={<s.icon />}
              hint={<span className={s.subDanger ? 'font-semibold text-rose-700' : undefined}>{s.sub}</span>}
            />
          ))}
        </StatGrid>
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-slate-200/80 bg-white p-1.5 shadow-xs print:hidden">
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
              activeTab === t.id ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
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
              className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-5 py-4 text-left shadow-xs hover:border-slate-300"
            >
              <div>
                <p className="font-semibold text-slate-900">{p.clientName}</p>
                <p className="text-xs text-slate-500">
                  {p.clinician || 'Clinician not recorded'} ·{' '}
                  {p.meansCounselingDocumented ? 'Partial checklist' : 'Counseling not documented'}
                </p>
              </div>
              <StatusBadge tone={riskStyle(p.risk).tone}>
                {riskLabel(p.risk)}
              </StatusBadge>
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
          <div className="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs print:hidden">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clients…"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <div className="flex flex-wrap gap-1">
              {(['all', 'High', 'Moderate', 'Low', 'unassessed'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRiskFilter(r)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    riskFilter === r ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {r === 'all' ? 'All' : r === 'unassessed' ? 'Not assessed' : r}
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
                      active ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-slate-900">{c.clientName}</p>
                      <StatusBadge tone={riskStyle(c.risk).tone} className="shrink-0">
                        {riskLabel(c.risk)}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      PHQ-9 {scoreLabel(c.phq9)} · {c.clinician || 'Clinician not recorded'}
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all ${progressBarColor(pct)}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-500">
                      <span>{pct}% complete</span>
                      {isPlanReviewDue(c) ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                          Review Due
                        </span>
                      ) : (
                        <span>Reviewed {dateLabel(c.lastReviewed)}</span>
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
              <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold text-slate-900">{selected.clientName}</h2>
                      <StatusBadge tone={riskStyle(selected.risk).tone}>
                        {selected.risk ? `${selected.risk} Risk` : 'Risk not assessed'}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      PHQ-9 {scoreLabel(selected.phq9)} · GAD-7 {scoreLabel(selected.gad7)} ·{' '}
                      {selected.clinician || 'Clinician not recorded'} · Created {dateLabel(selected.createdAt)} · Last
                      reviewed {selected.lastReviewed ? selected.lastReviewed : 'not yet reviewed'}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-600 print:hidden">
                      <label className="inline-flex items-center gap-1.5">
                        Risk
                        <select
                          value={selected.risk ?? ''}
                          onChange={(e) =>
                            updatePlan(selected.id, { risk: (e.target.value || null) as RiskLevel | null })
                          }
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        >
                          <option value="">Not assessed</option>
                          <option>High</option>
                          <option>Moderate</option>
                          <option>Low</option>
                        </select>
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        PHQ-9
                        <input
                          type="number"
                          min={0}
                          max={27}
                          value={selected.phq9 ?? ''}
                          placeholder="Not recorded"
                          onChange={(e) => updatePlan(selected.id, { phq9: parseScore(e.target.value, 27) })}
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        />
                      </label>
                      <label className="inline-flex items-center gap-1.5">
                        GAD-7
                        <input
                          type="number"
                          min={0}
                          max={21}
                          value={selected.gad7 ?? ''}
                          placeholder="Not recorded"
                          onChange={(e) => updatePlan(selected.id, { gad7: parseScore(e.target.value, 21) })}
                          className="w-28 rounded-lg border border-slate-200 px-2 py-1 text-xs"
                        />
                      </label>
                    </div>
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
                      className={buttonClasses({ variant: 'primary', size: 'sm' })}
                    >
                      <Save size={14} /> {saveFlash ? 'Saved' : 'Save Plan'}
                    </button>
                  </div>
                </div>

                {isPlanReviewDue(selected) && (
                  <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-900">
                    <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={18} />
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
                      className={`h-full rounded-full ${progressBarColor(planProgress(selected))}`}
                      style={{ width: `${planProgress(selected)}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-4 print:hidden">
                    <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={selected.clientSigned}
                        onChange={(e) => updatePlan(selected.id, { clientSigned: e.target.checked })}
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
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
                        className="h-4 w-4 rounded border-slate-300 accent-blue-600"
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
                    className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3">
                        <div
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${done ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}
                        >
                          <CheckCircle2 size={16} />
                        </div>
                        <div>
                          <h3 className="font-semibold text-blue-700">
                            STEP {step.id}: {step.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-500">{step.prompt}</p>
                        </div>
                      </div>
                      {!isEditing ? (
                        <button
                          type="button"
                          onClick={() => startEdit(step.id)}
                          className="inline-flex items-center gap-1 text-xs font-semibold print:hidden text-blue-700"
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
                              className="mt-0.5 h-4 w-4 accent-blue-600"
                            />
                            {m.label}
                          </label>
                        ))}
                        <label
                          className="flex items-start gap-2 text-sm font-semibold text-blue-700"
                        >
                          <input
                            type="checkbox"
                            checked={draftMeansDoc}
                            onChange={(e) => setDraftMeansDoc(e.target.checked)}
                            className="mt-0.5 h-4 w-4 accent-blue-600"
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
                            className={buttonClasses({ variant: 'primary' })}
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
                            className={buttonClasses({ variant: 'primary' })}
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
                            className={buttonClasses({ variant: 'primary' })}
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
                              {m.done ? <Check size={12} aria-hidden /> : null}
                            </span>
                            {m.label}
                          </div>
                        ))}
                        <div
                          className={`flex items-start gap-2 text-sm font-semibold ${
                            selected.meansCounselingDocumented ? 'text-blue-700' : 'text-slate-500'
                          }`}
                          
                        >
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              selected.meansCounselingDocumented
                                ? 'border-emerald-500 bg-emerald-500 text-white'
                                : 'border-slate-300'
                            }`}
                          >
                            {selected.meansCounselingDocumented ? <Check size={12} aria-hidden /> : null}
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
                          <span className="italic text-slate-500">Not documented yet.</span>
                        )}
                      </p>
                    )}
                  </div>
                );
              })}

              <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-xs">
                <h3 className="mb-3 font-semibold text-slate-900">Crisis Contacts</h3>
                <ul className="divide-y divide-slate-100">
                  {selected.crisisResources.map((r) => (
                    <li
                      key={r.label}
                      className={`flex flex-wrap items-center justify-between gap-2 px-2 py-2.5 text-sm ${
                        r.urgent ? 'rounded-lg bg-rose-50 font-semibold text-rose-700' : 'text-slate-700'
                      }`}
                    >
                      <span className={r.urgent ? 'text-rose-700' : 'text-slate-500'}>{r.label}</span>
                      <span className="inline-flex items-center gap-1.5">
                        {!r.urgent ? <Phone size={13} className="text-slate-500" /> : null}
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
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xs">
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
                      setNewForm((f) => ({ ...f, risk: e.target.value as RiskLevel | '' }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    <option value="">Not assessed</option>
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
                    placeholder="Not recorded"
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
                className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
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
