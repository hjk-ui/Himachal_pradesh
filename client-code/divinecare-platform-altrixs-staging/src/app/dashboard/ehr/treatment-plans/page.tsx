'use client';
import { CLINICAL_DEMO_CLIENTS, CLINICAL_DEMO_PLANS } from '@/features/ehr/clinicalDemo';
import { PreviewNotice } from '@/components/clinic/PreviewNotice';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DIAGNOSIS_OPTIONS, DIAGNOSIS_GROUPS, EMPTY_PLAN_CARE, type PlanCare, type PracticeTemplate } from '@/lib/ehr/planLibrary';
import { PlanCareFields, PlanCareDetail } from '@/features/ehr/PlanCareFields';
import { Part2Notice } from '@/components/clinic/Part2Notice';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';
import { ClipboardList, CheckCircle2, AlertTriangle, Plus, X, ChevronUp, ChevronDown } from 'lucide-react';
import {
  createTreatmentPlan,
  fetchTreatmentPlan,
  fetchTreatmentPlans,
  updateTreatmentPlan,
  type TreatmentPlanRecord,
  type TreatmentPlanStatus,
} from '@/features/ehr/treatmentPlansApi';
import { ImportedPlanBadge, ImportedPlanNotice } from '@/features/ehr/ImportedPlanNotice';
import { ImportedPlanDetail } from '@/features/ehr/ImportedPlanDetail';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import { importedPlanWorklist, planDateView, rewriteHref } from '@/lib/ehr/importedPlans';
import { clinicDate } from '@/lib/workflows/dates';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { apiJson } from '@/lib/api-client';
import { PlanSignaturePanel, type PlanSignatures } from '@/components/therapy/PlanSignaturePanel';
import { PATIENT_SIGNATURE_LABELS, planReviewReminder } from '@/lib/ehr/therapy/rules';
import { TherapyWorkflowSettingsCard } from '@/components/therapy/TherapyWorkflowSettingsCard';
import { PlanPendingWorklist } from '@/components/therapy/PlanPendingWorklist';
import { buttonClasses, cardClasses, cx, PageHeader, StatCard, StatGrid, Alert } from '@/components/ui';

type PlanStatus = 'Active' | 'Under Review' | 'Completed' | 'Archived';
type FormMode = 'closed' | 'create' | 'edit';

interface Goal {
  id: string;
  text: string;
  targetDate: string;
  objectives: string[];
  interventions: string[];
  progress: number;
}

interface TreatmentPlan {
  clinicalDetails: PlanCare;
  id: string;
  clientId: string;
  client: string;
  primaryDx: string;
  icd10: string;
  secondaryDx?: string;
  startDate: string;
  reviewDate: string;
  goals: Goal[];
  status: PlanStatus;
  dbStatus: TreatmentPlanStatus;
  clinician: string;
  clientSigned: boolean;
  presentingProblems: string;
  strengths: string;
  /** Imported from Valant: goals were not exported */
  source?: ImportedPlanSource | null;
  clinicianId?: string | null;
  hasTemplate?: boolean;
  planKind?: string;
  signatures?: PlanSignatures;
  /** Plan this one replaces (review, or rewrite of an imported Valant plan) */
  supersedesId?: string | null;
  createdAt?: string | null;
}

type PlanFormGoal = {
  id: string;
  text: string;
  targetDate: string;
  objectives: string[];
  interventions: string[];
  progress: number;
};

type PlanForm = {
  clinicalDetails: PlanCare;
  clientId: string;
  primaryDx: string;
  icd10: string;
  secondaryDx: string;
  problemStatement: string;
  strengths: string;
  reviewDate: string;
  status: TreatmentPlanStatus;
  clientSigned: boolean;
  goals: PlanFormGoal[];
};

interface GoalBankTemplateGoal {
  goalId: string;
  category: string;
  goalText: string;
  objectives: { objectiveId: string; text: string; frequency: string; target: string }[];
}

interface GoalBankTemplate {
  templateId: string;
  patientName: string;
  createdAt: string;
  goals: GoalBankTemplateGoal[];
}

const STATUS_STYLES: Record<PlanStatus, string> = {
  Active: 'bg-blue-50 text-blue-700 border-blue-200',
  'Under Review': 'bg-amber-100 text-amber-700 border-amber-200',
  Completed: 'bg-blue-100 text-blue-700 border-blue-200',
  Archived: 'bg-slate-100 text-slate-600 border-slate-200',
};


const STATUS_OPTIONS: { value: TreatmentPlanStatus; label: PlanStatus }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'NEEDS_REVIEW', label: 'Under Review' },
  { value: 'CLOSED', label: 'Completed' },
  { value: 'EXPIRED', label: 'Archived' },
  { value: 'DRAFT', label: 'Under Review' },
];

function addDays(days: number, base = new Date()) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next.toISOString().split('T')[0];
}

function dateInput(value: string | null | undefined) {
  if (!value) return '';
  return value.slice(0, 10);
}

function newGoalId() {
  return `g${Math.random().toString(36).slice(2, 10)}`;
}

function emptyGoal(progress = 0): PlanFormGoal {
  return {
    id: newGoalId(),
    text: '',
    targetDate: '',
    objectives: [''],
    interventions: [''],
    progress,
  };
}

function emptyForm(): PlanForm {
  return {
    clinicalDetails: { ...EMPTY_PLAN_CARE, planType: 'Individual Therapy' },
    clientId: '',
    primaryDx: '',
    icd10: '',
    secondaryDx: '',
    problemStatement: '',
    strengths: '',
    reviewDate: addDays(90),
    status: 'ACTIVE',
    clientSigned: false,
    goals: [emptyGoal()],
  };
}

function toUiStatus(status: TreatmentPlanStatus): PlanStatus {
  switch (status) {
    case 'NEEDS_REVIEW':
    case 'DRAFT':
      return 'Under Review';
    case 'CLOSED':
      return 'Completed';
    case 'EXPIRED':
      return 'Archived';
    default:
      return 'Active';
  }
}

function mapRecord(row: TreatmentPlanRecord): TreatmentPlan {
  return {
    clinicalDetails: row.clinicalDetails ?? { ...EMPTY_PLAN_CARE },
    id: row.id,
    clientId: row.clientId,
    client: row.clientName,
    primaryDx: row.title,
    icd10: row.diagnosisCodes[0] || '',
    secondaryDx: row.secondaryDx || undefined,
    startDate: row.startDate,
    reviewDate: dateInput(row.reviewDueAt),
    goals: row.goals,
    status: toUiStatus(row.status),
    dbStatus: row.status,
    // An imported plan whose Valant owner is not linked to staff shows the owner's name
    clinician: !row.clinicianId && row.source?.owner ? row.source.owner : row.clinicianName,
    clientSigned: row.clientSigned,
    presentingProblems: row.presentingProblems || '',
    strengths: row.strengths || '',
    source: row.source ?? null,
    clinicianId: row.clinicianId,
    hasTemplate: Boolean(row.hasTemplate),
    planKind: row.planKind,
    signatures: row.signatures,
    supersedesId: row.supersedesId ?? null,
    createdAt: row.createdAt ?? null,
  };
}

function formFromPlan(plan: TreatmentPlan): PlanForm {
  return {
    clinicalDetails: { ...plan.clinicalDetails },
    clientId: plan.clientId,
    primaryDx: plan.primaryDx,
    icd10: plan.icd10,
    secondaryDx: plan.secondaryDx || '',
    problemStatement: plan.presentingProblems,
    strengths: plan.strengths,
    reviewDate: plan.reviewDate || addDays(90),
    status: plan.dbStatus,
    clientSigned: plan.clientSigned,
    goals:
      plan.goals.length > 0
        ? plan.goals.map((g) => ({
            id: g.id || newGoalId(),
            text: g.text,
            targetDate: dateInput(g.targetDate),
            objectives: g.objectives.length ? [...g.objectives] : [''],
            interventions: g.interventions.length ? [...g.interventions] : [''],
            progress: g.progress,
          }))
        : [emptyGoal()],
  };
}

function goalsPayload(form: PlanForm) {
  return form.goals
    .filter((g) => g.text.trim())
    .map((g, i) => ({
      id: g.id || `G${i + 1}`,
      text: g.text.trim(),
      targetDate: dateInput(g.targetDate),
      objectives: g.objectives.map((o) => o.trim()).filter(Boolean),
      interventions: g.interventions.map((o) => o.trim()).filter(Boolean),
      progress: g.progress,
    }));
}

export default function TreatmentPlansPage() {
  const { clients: liveClients } = useClients();
  const [preview] = useState(false); // Demo Preview removed: always the live chart
  const [previewPlans, setPreviewPlans] = useState<TreatmentPlan[]>(() => CLINICAL_DEMO_PLANS.map(mapRecord));
  const clients = preview ? CLINICAL_DEMO_CLIENTS : liveClients;
  const [statusFilter, setStatusFilter] = useState<'All' | PlanStatus>('All');
  /** Go-live worklist: imported Valant plans to rewrite, and plans past their review date */
  const [worklistFilter, setWorklistFilter] = useState<'none' | 'valant' | 'overdue' | 'dueSoon'>('none');
  const [today] = useState(() => clinicDate());
  const [search, setSearch] = useState('');
  /** ?clientId= (Visit Guide "Treatment plan"): show only that client's plans (rows are already scoped by the API) */
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  useEffect(() => {
    setClientFilter(new URLSearchParams(window.location.search).get('clientId')?.trim() || null);
  }, []);
  const [livePlans, setLivePlans] = useState<TreatmentPlan[]>([]);
  const plans = preview ? previewPlans : livePlans;
  const setPlans = preview ? setPreviewPlans : setLivePlans;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [liveGoalTemplates] = useModuleList<GoalBankTemplate>('goal-bank-templates', []);
  const goalTemplates = preview ? [] : liveGoalTemplates;
  const [selectedPlan, setSelectedPlan] = useState<TreatmentPlan | null>(null);
  const { user } = useAuth();
  /** Plans by pre-licensed clinicians waiting for this user's supervisor signature */
  const [cosignQueue, setCosignQueue] = useState<{ id: string; title: string; clientId: string; clientName: string; authorName: string | null }[]>([]);
  useEffect(() => {
    if (preview) return;
    apiJson<{ success: true; plans: { id: string; title: string; clientId: string; clientName: string; authorName: string | null }[] }>('/api/ehr/treatment-plans/cosign-queue')
      .then((res) => setCosignQueue(res.plans))
      .catch(() => setCosignQueue([]));
  }, [preview]);
  const [formMode, setFormMode] = useState<FormMode>('closed');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedGoals, setExpandedGoals] = useState<string[]>([]);
  const [form, setForm] = useState<PlanForm>(emptyForm);
  const rosterOptions = clients.length > 0 ? clients : [];

  const closePlanForm = () => {
    setFormMode('closed');
    setEditingId(null);
    setForm(emptyForm());
    setFormError(null);
  };

  const openCreatePlan = (seed?: Partial<PlanForm>) => {
    setSelectedPlan(null);
    setEditingId(null);
    const preselect = clientFilter && clients.some((c) => c.id === clientFilter) ? { clientId: clientFilter } : {};
    setForm({ ...emptyForm(), ...preselect, ...seed });
    setFormError(null);
    setFormMode('create');
  };

  const openEditPlan = async (plan: TreatmentPlan) => {
    setSelectedPlan(null);
    setEditingId(plan.id);
    setForm(formFromPlan(plan));
    setFormError(null);
    setFormMode('edit');
    if (preview) return;
    try {
      const latest = mapRecord(await fetchTreatmentPlan(plan.id));
      setForm(formFromPlan(latest));
      setPlans((prev) => prev.map((p) => (p.id === latest.id ? latest : p)));
    } catch {
      // keep local copy if refresh fails
    }
  };

  const reloadPlans = useCallback(async () => {
    try {
      const rows = await fetchTreatmentPlans();
      setLivePlans(rows.map(mapRecord));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load treatment plans');
    }
  }, []);

  useEffect(() => {
    void reloadPlans();
  }, [reloadPlans]);

  const worklist = useMemo(
    () => importedPlanWorklist(plans.map((p) => ({ id: p.id, status: p.dbStatus, reviewDueAt: p.reviewDate || null, source: p.source ?? null, supersedesId: p.supersedesId ?? null })), today),
    [plans, today]
  );
  const isOverdue = (p: TreatmentPlan) => p.dbStatus !== 'CLOSED' && Boolean(p.reviewDate) && p.reviewDate < today;
  const valantCount = worklist.size;
  const valantOverdueCount = [...worklist.values()].filter((t) => t.overdue || t.noReviewDate).length;
  const overdueCount = plans.filter(isOverdue).length;
  /** Review due within 7 days (the plan owner's reminder window), not yet overdue */
  const isDueSoon = (p: TreatmentPlan) => {
    if (p.dbStatus === 'CLOSED' || p.dbStatus === 'DRAFT' || p.source || !p.reviewDate) return false;
    const r = planReviewReminder(p.reviewDate, today, 7);
    return Boolean(r && !r.overdue);
  };
  const dueSoonCount = plans.filter(isDueSoon).length;

  const filtered = plans.filter((p) => {
    const matchStatus = statusFilter === 'All' || p.status === statusFilter;
    const matchSearch = p.client.toLowerCase().includes(search.toLowerCase());
    if (clientFilter && p.clientId !== clientFilter) return false;
    const matchWorklist =
      worklistFilter === 'none' || (worklistFilter === 'valant' ? worklist.has(p.id) : worklistFilter === 'dueSoon' ? isDueSoon(p) : isOverdue(p));
    return matchStatus && matchSearch && matchWorklist;
  });

  const toggleGoal = (id: string) => {
    setExpandedGoals((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  };

  const addGoal = () => {
    setForm((p) => ({ ...p, goals: [...p.goals, emptyGoal()] }));
  };

  const removeGoal = (idx: number) => {
    setForm((p) => ({
      ...p,
      goals: p.goals.length > 1 ? p.goals.filter((_, i) => i !== idx) : [emptyGoal()],
    }));
  };

  const updateGoal = (idx: number, patch: Partial<PlanFormGoal>) => {
    setForm((p) => {
      const goals = p.goals.map((g, i) => (i === idx ? { ...g, ...patch } : g));
      return { ...p, goals };
    });
  };

  const addListItem = (goalIdx: number, field: 'objectives' | 'interventions') => {
    setForm((p) => {
      const goals = p.goals.map((g, i) =>
        i === goalIdx ? { ...g, [field]: [...g[field], ''] } : g
      );
      return { ...p, goals };
    });
  };

  const updateListItem = (
    goalIdx: number,
    field: 'objectives' | 'interventions',
    itemIdx: number,
    value: string
  ) => {
    setForm((p) => {
      const goals = p.goals.map((g, i) => {
        if (i !== goalIdx) return g;
        const next = [...g[field]];
        next[itemIdx] = value;
        return { ...g, [field]: next };
      });
      return { ...p, goals };
    });
  };

  const handleSavePlan = async () => {
    if (saving) return;
    if (!form.clientId) {
      setFormError('Select a client.');
      return;
    }
    if (!form.primaryDx) {
      setFormError('Select a primary diagnosis.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      const payload = {
        clinicalDetails: form.clinicalDetails,
        title: form.primaryDx,
        diagnosisCodes: form.icd10 ? [form.icd10] : [],
        presentingProblems: form.problemStatement || null,
        strengths: form.strengths || null,
        secondaryDx: form.secondaryDx || null,
        reviewDueAt: form.reviewDate || addDays(90),
        status: form.status,
        clientSigned: form.clientSigned,
        goals: goalsPayload(form),
      };
      if (preview) {
        const mapped: TreatmentPlan = { id: editingId || 'preview-plan-' + crypto.randomUUID(), clientId: form.clientId, client: clients.find((client) => client.id === form.clientId)?.name || 'Demo client', primaryDx: form.primaryDx, icd10: form.icd10, secondaryDx: form.secondaryDx, startDate: new Date().toISOString().slice(0, 10), reviewDate: form.reviewDate, goals: goalsPayload(form), status: toUiStatus(form.status), dbStatus: form.status, clinician: 'Demo clinician', clientSigned: form.clientSigned, presentingProblems: form.problemStatement, strengths: form.strengths, clinicalDetails: { ...form.clinicalDetails } };
        setPlans((rows) => [mapped, ...rows.filter((row) => row.id !== mapped.id)]);
        setSelectedPlan(mapped);
      } else if (formMode === 'edit' && editingId) {
        const updated = await updateTreatmentPlan(editingId, payload);
        const mapped = mapRecord(updated);
        setPlans((prev) => prev.map((p) => (p.id === mapped.id ? mapped : p)));
        setSelectedPlan(mapped);
      } else {
        const created = await createTreatmentPlan({
          clientId: form.clientId,
          ...payload,
        });
        const mapped = mapRecord(created);
        setPlans((prev) => [mapped, ...prev.filter((p) => p.id !== mapped.id)]);
        setSelectedPlan(mapped);
      }
      closePlanForm();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save treatment plan');
    } finally {
      setSaving(false);
    }
  };

  const applyPracticeTemplate = (template: PracticeTemplate) => {
    const dx = DIAGNOSIS_OPTIONS.find((item) => item.icd === template.icd);
    setForm((previous) => ({ ...previous, primaryDx: dx?.dsm || previous.primaryDx, icd10: template.icd,
      clinicalDetails: { ...previous.clinicalDetails, planType: template.planType, levelOfCare: 'Outpatient', serviceFrequency: 'Weekly', expectedDuration: template.name === 'PTSD Trauma Recovery' ? '180 days' : '90 days' },
      goals: [...previous.goals.filter((goal) => goal.text.trim()), ...template.goals.map((goal) => ({ ...goal, id: newGoalId(), targetDate: previous.reviewDate, objectives: [...goal.objectives], interventions: [...goal.interventions], progress: 0 }))],
    }));
  };

  const completeGoal = async (plan: TreatmentPlan, goalId: string, checked: boolean) => {
    if (saving) return;
    setSaving(true);
    setFormError(null);
    try {
      if (preview) {
        const updated = { ...plan, goals: plan.goals.map((goal) => goal.id === goalId ? { ...goal, progress: checked ? 100 : 0 } : goal) };
        setSelectedPlan(updated);
        setPlans((rows) => rows.map((row) => row.id === updated.id ? updated : row));
        return;
      }
      const updated = mapRecord(await updateTreatmentPlan(plan.id, { goals: plan.goals.map((goal) => goal.id === goalId ? { ...goal, progress: checked ? 100 : 0 } : goal) }));
      setSelectedPlan(updated);
      setPlans((rows) => rows.map((row) => row.id === updated.id ? updated : row));
    } catch (error) { setFormError(error instanceof Error ? error.message : 'Could not update goal'); }
    finally { setSaving(false); }
  };

  const handleDxSelect = (dx: { icd: string; dsm: string }) => {
    setForm((p) => ({ ...p, primaryDx: dx.dsm, icd10: dx.icd }));
  };

  const reviewCutoff = useMemo(() => {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + 30);
    return cutoff.toISOString().split('T')[0];
  }, []);

  const stats = useMemo(() => {
    const goalCount = plans.reduce((sum, plan) => sum + plan.goals.length, 0);
    const due = plans.filter((plan) => plan.reviewDate && plan.reviewDate <= reviewCutoff).length;
    const achieved = plans.reduce(
      (sum, plan) => sum + plan.goals.filter((goal) => goal.progress >= 90).length,
      0
    );
    return [
      {
        label: 'Active Plans',
        value: String(plans.filter((plan) => plan.status === 'Active').length),
        icon: 'clipboard',
        tone: 'brand' as const,
      },
      { label: 'Goals Achieved (MTD)', value: String(achieved), icon: 'check', tone: 'success' as const },
      { label: 'Due for Review', value: String(due), icon: 'alert', tone: 'warning' as const },
      { label: 'New This Month', value: String(goalCount), icon: 'plus', tone: 'info' as const },
    ];
  }, [plans, reviewCutoff]);

  const importTemplate = (template: GoalBankTemplate) => {
    setForm((p) => ({
      ...p,
      goals: template.goals.map((goal) => ({
        id: newGoalId(),
        text: goal.goalText,
        targetDate: '',
        objectives: goal.objectives.map(
          (objective) => `${objective.text} (${objective.frequency} · ${objective.target})`
        ),
        interventions: [goal.category],
        progress: 0,
      })),
    }));
  };

  return (
    <div className="space-y-6">
      {preview && <PreviewNotice />}
      {/* Demo Preview (local, unsaved "signing" of fictional records) removed: notes and plans are signed only through the server. */}
      <PageHeader
        title="Treatment Plans"
        description={<>Goals, objectives & clinical interventions — DSM-5 / ICD-10</>}
        actions={<>
          <div className="flex flex-wrap gap-2">
          <Link
            href="/dashboard/ehr/treatment-plans/therapy"
            className={buttonClasses({ variant: 'primary' })}
          >
            + Treatment Plan (therapist template)
          </Link>
          <button
            onClick={() => openCreatePlan()}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-blue-600 border border-blue-600/40 bg-white hover:bg-blue-50 transition-all"
          >
            + Blank plan
          </button>
        </div>
        </>}
      />
      {!preview ? <TherapyWorkflowSettingsCard /> : null}
      {!preview && cosignQueue.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-semibold">
            {cosignQueue.length} treatment plan{cosignQueue.length === 1 ? '' : 's'} from pre-licensed clinicians awaiting your signature
          </p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {cosignQueue.slice(0, 8).map((q) => (
              <li key={q.id}>
                <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(q.clientId)}&planId=${encodeURIComponent(q.id)}`} className="font-semibold underline">
                  {q.clientName}
                </Link>
                {` — ${q.title}${q.authorName ? ` · ${q.authorName}` : ''}`}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <StatGrid columns={4}>
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} tone={s.tone} icon={s.icon === 'clipboard' ? <ClipboardList /> : s.icon === 'check' ? <CheckCircle2 /> : s.icon === 'alert' ? <AlertTriangle /> : <Plus />} />
        ))}
      </StatGrid>

      {loadError && !preview && (
        <Alert tone="warning">
          {loadError}
        </Alert>
      )}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5 flex flex-col sm:flex-row gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name…"
          className="min-w-0 flex-1 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {clientFilter ? (
          <div className="flex flex-wrap items-center gap-2 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-600">
            <span>
              Client: {clients.find((c) => c.id === clientFilter)?.name ?? plans.find((p) => p.clientId === clientFilter)?.client ?? 'selected client'}
            </span>
            {clients.some((c) => c.id === clientFilter) && !plans.some((p) => p.clientId === clientFilter && p.dbStatus !== 'CLOSED') ? (
              <button type="button" onClick={() => openCreatePlan({ clientId: clientFilter })} className="underline">
                New plan for this client
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                window.history.replaceState(null, '', window.location.pathname);
                setClientFilter(null);
              }}
              className="underline"
            >
              Show all clients
            </button>
          </div>
        ) : null}
        <div className="flex gap-1.5 flex-wrap">
          {(['All', 'Active', 'Under Review', 'Completed', 'Archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all
                ${statusFilter === s ? 'bg-blue-600 text-white' : 'text-slate-500 bg-slate-100 hover:bg-slate-200'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {dueSoonCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3">
          <p className="text-xs text-sky-900">Plan reviews due in the next 7 days (the plan owner also gets an Inbox reminder).</p>
          <button
            type="button"
            aria-pressed={worklistFilter === 'dueSoon'}
            onClick={() => setWorklistFilter(worklistFilter === 'dueSoon' ? 'none' : 'dueSoon')}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${worklistFilter === 'dueSoon' ? 'bg-blue-600 text-white' : 'bg-white text-sky-900 border border-sky-200'}`}
          >
            Review due within 7 days ({dueSoonCount})
          </button>
        </div>
      ) : null}
      {valantCount > 0 || overdueCount > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-semibold text-amber-900">Before go-live</p>
          <p className="mt-0.5 text-xs text-amber-800">
            Plans imported from Valant carry no goals in Altrixs. Rewrite each one with the therapist template; signing the new plan closes the Valant
            plan. An imported plan past its review date (or with none) does not count as active, so therapy progress notes for that client cannot be
            signed until the rewrite is signed.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              type="button"
              aria-pressed={worklistFilter === 'valant'}
              onClick={() => setWorklistFilter(worklistFilter === 'valant' ? 'none' : 'valant')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${worklistFilter === 'valant' ? 'bg-blue-600 text-white' : 'bg-white text-amber-900 border border-amber-200'}`}
            >
              Imported from Valant — needs rewrite ({valantCount}
              {valantOverdueCount ? `, ${valantOverdueCount} overdue or no review date` : ''})
            </button>
            <button
              type="button"
              aria-pressed={worklistFilter === 'overdue'}
              onClick={() => setWorklistFilter(worklistFilter === 'overdue' ? 'none' : 'overdue')}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold ${worklistFilter === 'overdue' ? 'bg-blue-600 text-white' : 'bg-white text-rose-800 border border-rose-200'}`}
            >
              Review overdue ({overdueCount})
            </button>
          </div>
        </div>
      ) : null}
      {!preview ? <PlanPendingWorklist /> : null}

      {goalTemplates.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-blue-900">Goal Bank templates ready</p>
            <p className="text-xs text-blue-700">
              {goalTemplates.length} draft template{goalTemplates.length !== 1 ? 's' : ''} saved
              from the Goal Bank.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const template = goalTemplates[0];
              if (!template) return;
              const next = emptyForm();
              next.goals = template.goals.map((goal) => ({
                id: newGoalId(),
                text: goal.goalText,
                targetDate: '',
                objectives: goal.objectives.map(
                  (objective) => `${objective.text} (${objective.frequency} · ${objective.target})`
                ),
                interventions: [goal.category],
                progress: 0,
              }));
              setSelectedPlan(null);
              setEditingId(null);
              setFormError(null);
              setForm(next);
              setFormMode('create');
            }}
            className={buttonClasses({ variant: 'primary' })}
          >
            Import latest template
          </button>
        </div>
      )}

      <div className={cx(cardClasses, 'overflow-hidden')}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th scope="col" className="text-left px-5 py-3 font-semibold">Client</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Primary Dx (ICD-10)</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Start Date</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Review Date</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Goals</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Status</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Signatures</th>
                <th scope="col" className="text-left px-5 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((p) => {
                const totalGoals = p.goals.length;
                const avgProgress = totalGoals
                  ? Math.round(p.goals.reduce((acc, g) => acc + g.progress, 0) / totalGoals)
                  : 0;
                return (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className={buttonClasses({ variant: 'primary', size: 'sm', className: 'w-7 justify-center' })}
                        >
                          {p.client[0]}
                        </div>
                        <span className="text-sm font-medium text-slate-900">{p.client}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {p.source ? (
                        <>
                          <p className="text-xs text-slate-500">Not in Valant export (see chart)</p>
                          <div className="mt-1"><ImportedPlanBadge /></div>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-slate-700 font-medium">{p.primaryDx}</p>
                          <p className="text-xs text-slate-500">{p.icd10 || '—'}</p>
                        </>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{p.startDate || (p.source ? <span className="text-xs text-slate-500">Not in Valant export</span> : '—')}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">
                      {p.reviewDate || (p.source ? <span className="text-xs text-slate-500">Not in Valant export</span> : '—')}
                      {isOverdue(p) ? <span className="ml-1 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-bold text-rose-700">OVERDUE</span> : null}
                      {isDueSoon(p) ? <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[11px] font-bold text-sky-800">DUE SOON</span> : null}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 min-w-16">
                          <div
                            className="h-1.5 rounded-full bg-blue-600 transition-all"
                            style={{ width: `${avgProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{avgProgress}%</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {p.source && totalGoals === 0
                          ? 'Goals in Valant'
                          : `${totalGoals} goal${totalGoals !== 1 ? 's' : ''}`}
                      </p>
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${STATUS_STYLES[p.status]}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {p.source ? (
                        <span className="text-xs text-slate-500">In Valant</span>
                      ) : (
                      <div className="text-xs space-y-0.5">
                        <div className="flex items-center gap-1">
                          <CheckCircle2 size={13} className={p.signatures?.clinicianSignedAt ? 'text-blue-500' : 'text-slate-500'} />
                          <span className="text-slate-500">{p.signatures?.clinicianSignedAt ? 'Clinician' : 'Clinician — not signed'}</span>
                        </div>
                        {p.signatures?.supervisorRequired ? (
                          <div className="flex items-center gap-1">
                            <CheckCircle2 size={13} className={p.signatures.supervisorSignedAt ? 'text-blue-500' : 'text-amber-700'} />
                            <span className="text-slate-500">{p.signatures.supervisorSignedAt ? 'Supervisor' : 'Supervisor — pending'}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1">
                          <CheckCircle2
                            size={13}
                            className={p.signatures?.patientStatus === 'SIGNED' || p.signatures?.patientStatus === 'VERBAL' || p.clientSigned ? 'text-blue-500' : 'text-slate-500'}
                          />
                          <span className="text-slate-500">{p.signatures ? PATIENT_SIGNATURE_LABELS[p.signatures.patientStatus] : 'Client'}</span>
                        </div>
                      </div>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            closePlanForm();
                            setSelectedPlan(p);
                          }}
                          className="text-xs px-2.5 py-1 rounded-lg text-blue-600 border border-slate-300 hover:bg-blue-50 transition-colors font-semibold"
                        >
                          View
                        </button>
                        {p.source ? (
                          p.dbStatus !== 'CLOSED' && !preview ? (
                            <Link
                              href={rewriteHref(p.clientId, p.id, worklist.get(p.id)?.rewriteDraftId ?? null)}
                              className={buttonClasses({ variant: 'primary', size: 'sm' })}
                            >
                              {worklist.get(p.id)?.rewriteDraftId ? 'Continue rewrite' : 'Rewrite'}
                            </Link>
                          ) : null
                        ) : (
                        <>
                        <button
                          onClick={() => { if (p.hasTemplate || p.signatures?.clinicianSignedAt) { closePlanForm(); setSelectedPlan(p); } else void openEditPlan(p); }}
                          className={buttonClasses({ variant: 'primary', size: 'sm' })}
                        >
                          Edit
                        </button>
                        {!preview ? (
                          <Link
                            href={`/dashboard/ehr/treatment-plans/${encodeURIComponent(p.id)}/document`}
                            className="text-xs px-2.5 py-1 rounded-lg text-blue-600 border border-slate-300 hover:bg-blue-50 font-semibold whitespace-nowrap"
                          >
                            Document
                          </Link>
                        ) : null}
                        </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-500">No treatment plans match your filters</div>
          )}
        </div>
      </div>

      {selectedPlan && formMode === 'closed' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Treatment Plan — {selectedPlan.client}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedPlan.clinician} ·{' '}
                  {(() => {
                    const d = planDateView({
                      source: selectedPlan.source ?? null,
                      createdAt: selectedPlan.startDate || selectedPlan.createdAt || null,
                      reviewDueAt: selectedPlan.reviewDate || null,
                      status: selectedPlan.dbStatus,
                      today,
                    });
                    return (
                      <>
                        {d.startLabel}
                        {d.lastUpdatedLabel ? ` · ${d.lastUpdatedLabel}` : ''} ·{' '}
                        <span className={d.overdue ? 'font-bold text-rose-700' : ''}>{d.reviewLabel}</span>
                      </>
                    );
                  })()}
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className="text-slate-500 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p role="alert" className="text-sm text-rose-700">{formError}</p>}
              {selectedPlan.source ? (
                <ImportedPlanDetail
                  preview={preview}
                  plan={{ id: selectedPlan.id, clientId: selectedPlan.clientId, reviewDueAt: selectedPlan.reviewDate || null, status: selectedPlan.dbStatus, source: selectedPlan.source }}
                />
              ) : (
              <>
              <PlanCareDetail care={selectedPlan.clinicalDetails} />
              {selectedPlan.clinicalDetails.planType === 'Substance Use Disorder (SUD)' && <Part2Notice />}
              <div className="bg-blue-50 rounded-xl p-4">
                <p className="text-xs font-bold text-blue-500 uppercase mb-2">Diagnoses</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-1.5 py-0.5 bg-blue-200 text-blue-800 rounded">
                      Primary
                    </span>
                    <span className="text-sm font-semibold text-slate-800">{selectedPlan.primaryDx}</span>
                    <span className="text-xs text-blue-600">{selectedPlan.icd10 || '—'}</span>
                  </div>
                  {selectedPlan.secondaryDx && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold px-1.5 py-0.5 bg-slate-200 text-slate-700 rounded">
                        Secondary
                      </span>
                      <span className="text-sm text-slate-700">{selectedPlan.secondaryDx}</span>
                    </div>
                  )}
                </div>
              </div>

              {(selectedPlan.presentingProblems || selectedPlan.strengths) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedPlan.presentingProblems ? (
                    <div className="border border-slate-200 rounded-xl p-3">
                      <p className="text-xs font-bold text-slate-500 uppercase mb-1">
                        Presenting concerns
                      </p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">
                        {selectedPlan.presentingProblems}
                      </p>
                    </div>
                  ) : null}
                  {selectedPlan.strengths ? (
                    <div className="border border-slate-200 rounded-xl p-3">
                      <p className="text-xs font-bold text-slate-500 uppercase mb-1">Strengths</p>
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">
                        {selectedPlan.strengths}
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              <div>
                <p className="text-sm font-bold text-slate-700 mb-3">Treatment Goals</p>
                <div className="space-y-3">
                  {selectedPlan.goals.length === 0 && (
                    <p className="text-sm text-slate-500">
                      {selectedPlan.source
                        ? 'Goals, objectives and interventions for this plan are in Valant. Add them here when the plan is rewritten in Altrixs.'
                        : 'No goals on this plan yet.'}
                    </p>
                  )}
                  {selectedPlan.goals.map((goal, i) => (
                    <div key={goal.id} className="border border-slate-200/80 rounded-xl overflow-hidden">
                      <label className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-600"><input type="checkbox" checked={goal.progress === 100} disabled={saving} onChange={(event) => void completeGoal(selectedPlan, goal.id, event.target.checked)} className="accent-blue-600" />Goal {i + 1} completed</label>
                      <button
                        onClick={() => toggleGoal(goal.id)}
                        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 text-left"
                      >
                        <div
                          className={buttonClasses({ variant: 'primary', size: 'sm', className: 'w-6 justify-center' })}
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{goal.text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${goal.progress}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{goal.progress}%</span>
                          </div>
                        </div>
                        <span aria-hidden className="text-slate-500">
                          {expandedGoals.includes(goal.id) ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </span>
                      </button>
                      {expandedGoals.includes(goal.id) && (
                        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-slate-100 bg-slate-50">
                          <p className="text-xs text-slate-500 pt-3">
                            Target: {goal.targetDate || '—'}
                          </p>
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase mb-1">
                              Measurable Objectives
                            </p>
                            <ul className="space-y-1.5">
                              {goal.objectives.map((obj, j) => (
                                <li key={j} className="flex items-start gap-2 text-sm text-slate-700">
                                  <span>{obj}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <p className="text-xs font-bold text-slate-500 uppercase mb-1">
                              Clinical Interventions
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                              {goal.interventions.map((inv, j) => (
                                <span
                                  key={j}
                                  className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-lg"
                                >
                                  {inv}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {!preview && selectedPlan.signatures ? (
                <PlanSignaturePanel
                  plan={{ id: selectedPlan.id, status: selectedPlan.dbStatus, clinicianId: selectedPlan.clinicianId ?? null, signatures: selectedPlan.signatures }}
                  currentUserId={user?.id ?? null}
                  onChanged={() => {
                    void fetchTreatmentPlan(selectedPlan.id).then((row) => {
                      const mapped = mapRecord(row);
                      setSelectedPlan(mapped);
                      setLivePlans((rows) => rows.map((r) => (r.id === mapped.id ? mapped : r)));
                    });
                  }}
                />
              ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="border rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">Clinician Signature</p>
                  <p className="text-sm text-blue-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={13} /> {selectedPlan.clinician}
                  </p>
                  <p className="text-xs text-slate-500">{selectedPlan.startDate}</p>
                </div>
                <div className="border rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">Client Signature</p>
                  {selectedPlan.clientSigned ? (
                    <p className="text-sm text-blue-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 size={13} /> Signed
                    </p>
                  ) : (
                    <p className="text-sm text-amber-700 font-semibold flex items-center gap-1">
                      <AlertTriangle size={13} /> Pending
                    </p>
                  )}
                </div>
              </div>
              )}
              </>
              )}

              <div className="flex flex-wrap gap-2">
                {selectedPlan.source ? null : selectedPlan.hasTemplate || selectedPlan.signatures?.clinicianSignedAt ? (
                  <>
                    {selectedPlan.hasTemplate ? (
                      <Link
                        href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(selectedPlan.clientId)}&planId=${encodeURIComponent(selectedPlan.id)}`}
                        className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
                      >
                        {selectedPlan.signatures?.clinicianSignedAt ? 'Open plan' : 'Edit in template'}
                      </Link>
                    ) : null}
                    {selectedPlan.signatures?.clinicianSignedAt && selectedPlan.dbStatus !== 'CLOSED' ? (
                      <Link
                        href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(selectedPlan.clientId)}&kind=Review`}
                        className="px-4 py-2.5 rounded-xl text-sm font-semibold text-blue-600 border border-blue-600/40"
                      >
                        Start review
                      </Link>
                    ) : null}
                  </>
                ) : (
                <button
                  type="button"
                  onClick={() => void openEditPlan(selectedPlan)}
                  className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
                >
                  Edit Plan
                </button>
                )}
                <button
                  onClick={() => setSelectedPlan(null)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {formMode !== 'closed' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {formMode === 'edit' ? 'Edit Treatment Plan' : 'New Treatment Plan'}
              </h2>
              <button aria-label="Close"
                onClick={closePlanForm}
                className="text-slate-500 hover:text-slate-600 text-xl font-bold"
              ><X size={18} aria-hidden /></button>
            </div>
            <div className="p-6 space-y-5">
              {(() => {
                const editingSource = formMode === 'edit' ? plans.find((p) => p.id === editingId)?.source : null;
                return editingSource ? <ImportedPlanNotice source={editingSource} compact /> : null;
              })()}
              <PlanCareFields value={form.clinicalDetails} onChange={(clinicalDetails) => setForm((previous) => ({ ...previous, clinicalDetails }))} onTemplate={applyPracticeTemplate} />
              {form.clinicalDetails.planType === 'Substance Use Disorder (SUD)' && <Part2Notice />}
              {formError && (
                <Alert tone="warning">
                  {formError}
                </Alert>
              )}
              {goalTemplates.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-500 uppercase">Goal Bank templates</p>
                      <p className="text-sm text-slate-600 mt-1">
                        Import a Goal Bank template, then refine goals and objectives for this client.
                      </p>
                    </div>
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const template = goalTemplates.find((t) => t.templateId === e.target.value);
                        if (template) importTemplate(template);
                      }}
                      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      <option value="" disabled>
                        Select template…
                      </option>
                      {goalTemplates.map((template) => (
                        <option key={template.templateId} value={template.templateId}>
                          {template.patientName} - {template.goals.length} goals
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Client *</label>
                  <select
                    value={form.clientId}
                    aria-label="Plan client"
                    disabled={formMode === 'edit'}
                    onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
                  >
                    <option value="">Select client…</option>
                    {rosterOptions.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Primary Diagnosis *
                  </label>
                  <select
                    value={form.icd10}
                    aria-label="Primary Diagnosis"
                    onChange={(e) => {
                      const dx = DIAGNOSIS_OPTIONS.find((d) => d.icd === e.target.value);
                      if (dx) handleDxSelect(dx);
                    }}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Select diagnosis…</option>
                    {form.icd10 && !DIAGNOSIS_OPTIONS.some((d) => d.icd === form.icd10) && (
                      <option value={form.icd10}>
                        {form.icd10} — {form.primaryDx}
                      </option>
                    )}
                    {DIAGNOSIS_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.diagnoses.map((d) => <option key={d.icd} value={d.icd}>{d.icd} - {d.dsm}</option>)}</optgroup>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Review due date
                  </label>
                  <input
                    type="date"
                    value={form.reviewDate}
                    onChange={(e) => setForm((p) => ({ ...p, reviewDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    value={form.status}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, status: e.target.value as TreatmentPlanStatus }))
                    }
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {STATUS_OPTIONS.filter((s) => s.value !== 'DRAFT').map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                    {form.status === 'DRAFT' && <option value="DRAFT">Draft / Under Review</option>}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Secondary Diagnosis (optional)
                  </label>
                  <select
                    value={form.secondaryDx}
                    onChange={(e) => setForm((p) => ({ ...p, secondaryDx: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">None</option>
                    {DIAGNOSIS_GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.diagnoses.map((d) => <option key={d.icd} value={`${d.dsm} (${d.icd})`}>{d.icd} - {d.dsm}</option>)}</optgroup>)}
                  </select>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Problem Statement / Presenting Concerns
                  </label>
                  <textarea
                    value={form.problemStatement}
                    onChange={(e) => setForm((p) => ({ ...p, problemStatement: e.target.value }))}
                    placeholder="Describe the client's presenting problems and clinical concerns…"
                    rows={3}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Strengths & Assets
                  </label>
                  <textarea
                    value={form.strengths}
                    onChange={(e) => setForm((p) => ({ ...p, strengths: e.target.value }))}
                    placeholder="Client strengths, supports, and protective factors…"
                    rows={2}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
                  />
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.clientSigned}
                    onChange={(e) => setForm((p) => ({ ...p, clientSigned: e.target.checked }))}
                    className="accent-blue-600"
                  />
                  Client has signed this plan
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-slate-700">Treatment Goals</p>
                  <button
                    type="button"
                    onClick={addGoal}
                    className="inline-flex min-h-10 items-center text-xs font-semibold text-blue-600 border border-slate-300 px-2.5 rounded-lg hover:bg-blue-50 md:min-h-8"
                  >
                    + Add Goal
                  </button>
                </div>
                <div className="space-y-4">
                  {form.goals.map((goal, i) => (
                    <div key={goal.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-slate-500 uppercase">Goal {i + 1}</p>
                        <button
                          type="button"
                          onClick={() => removeGoal(i)}
                          className="inline-flex min-h-10 items-center px-1 text-xs text-slate-500 hover:text-rose-600 md:min-h-8"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Goal Statement
                          </label>
                          <input
                            value={goal.text}
                            onChange={(e) => updateGoal(i, { text: e.target.value })}
                            placeholder="Long-term treatment goal…"
                            className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Target Date
                          </label>
                          <input
                            type="date"
                            value={goal.targetDate}
                            onChange={(e) => updateGoal(i, { targetDate: e.target.value })}
                            className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                        </div>
                      </div>
                      {formMode === 'edit' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Progress ({goal.progress}%)
                          </label>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={goal.progress}
                            onChange={(e) => updateGoal(i, { progress: Number(e.target.value) })}
                            className="w-full"
                          />
                        </div>
                      )}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-600">
                            Measurable Objectives
                          </label>
                          <button
                            type="button"
                            onClick={() => addListItem(i, 'objectives')}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            + Add
                          </button>
                        </div>
                        {goal.objectives.map((obj, j) => (
                          <input
                            key={`${goal.id}-obj-${j}`}
                            value={obj}
                            onChange={(e) => updateListItem(i, 'objectives', j, e.target.value)}
                            placeholder={`Objective ${j + 1}...`}
                            className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-1.5"
                          />
                        ))}
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-semibold text-slate-600">
                            Clinical Interventions
                          </label>
                          <button
                            type="button"
                            onClick={() => addListItem(i, 'interventions')}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            + Add
                          </button>
                        </div>
                        {goal.interventions.map((inv, j) => (
                          <input
                            key={`${goal.id}-inv-${j}`}
                            value={inv}
                            onChange={(e) => updateListItem(i, 'interventions', j, e.target.value)}
                            placeholder={`Intervention ${j + 1}...`}
                            className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 mb-1.5"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => void handleSavePlan()}
                  disabled={saving}
                  className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
                >
                  {saving
                    ? 'Saving…'
                    : formMode === 'edit'
                      ? 'Save Changes'
                      : 'Create Treatment Plan'}
                </button>
                <button
                  onClick={closePlanForm}
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
