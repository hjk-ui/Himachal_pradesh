'use client';
import { PreviewNotice } from '@/components/clinic/PreviewNotice';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DIAGNOSIS_OPTIONS, DIAGNOSIS_GROUPS, EMPTY_PLAN_CARE, type PlanCare, type PracticeTemplate } from '@/lib/ehr/planLibrary';
import { PlanCareFields, PlanCareDetail } from '@/features/ehr/PlanCareFields';
import { Part2Notice } from '@/components/clinic/Part2Notice';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';
import { ClipboardList, CheckCircle2, AlertTriangle, Plus } from 'lucide-react';
import {
  createTreatmentPlan,
  fetchTreatmentPlan,
  fetchTreatmentPlans,
  updateTreatmentPlan,
  type TreatmentPlanRecord,
  type TreatmentPlanStatus,
} from '@/features/ehr/treatmentPlansApi';

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
    clinician: row.clinicianName,
    clientSigned: row.clientSigned,
    presentingProblems: row.presentingProblems || '',
    strengths: row.strengths || '',
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
  const preview = false;
  const [previewPlans, setPreviewPlans] = useState<TreatmentPlan[]>([]);
  const clients = liveClients;
  const [statusFilter, setStatusFilter] = useState<'All' | PlanStatus>('All');
  const [search, setSearch] = useState('');
  const [livePlans, setLivePlans] = useState<TreatmentPlan[]>([]);
  const plans = preview ? previewPlans : livePlans;
  const setPlans = preview ? setPreviewPlans : setLivePlans;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [liveGoalTemplates] = useModuleList<GoalBankTemplate>('goal-bank-templates', []);
  const goalTemplates = preview ? [] : liveGoalTemplates;
  const [selectedPlan, setSelectedPlan] = useState<TreatmentPlan | null>(null);
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
    setForm({ ...emptyForm(), ...seed });
    setFormError(null);
    setFormMode('create');
  };

  const openEditPlan = async (plan: TreatmentPlan) => {
    if (plan.dbStatus === 'CLOSED' || plan.dbStatus === 'EXPIRED') {
      setFormError('This archived import is not the plan you edit. Mark one plan as the live plan.');
      return;
    }
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

  const filtered = plans.filter((p) => {
    const matchStatus = statusFilter === 'All' || p.status === statusFilter;
    const matchSearch = p.client.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
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
        color: '#6868D0',
      },
      { label: 'Goals Achieved (MTD)', value: String(achieved), icon: 'check', color: '#6868D0' },
      { label: 'Due for Review', value: String(due), icon: 'alert', color: '#ea580c' },
      { label: 'New This Month', value: String(goalCount), icon: 'plus', color: '#D4A017' },
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Treatment Plans</h1>
          <p className="text-slate-500 text-sm mt-1">
            Goals, objectives & clinical interventions — DSM-5 / ICD-10
          </p>
        </div>
        <button
          onClick={() => openCreatePlan()}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-all"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
        >
          + New Treatment Plan
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: s.color + '18' }}
            >
              {s.icon === 'clipboard' && <ClipboardList size={20} style={{ color: s.color }} />}
              {s.icon === 'check' && <CheckCircle2 size={20} style={{ color: s.color }} />}
              {s.icon === 'alert' && <AlertTriangle size={20} style={{ color: s.color }} />}
              {s.icon === 'plus' && <Plus size={20} style={{ color: s.color }} />}
            </div>
            <p className="text-2xl font-semibold mt-2" style={{ color: s.color }}>
              {s.value}
            </p>
            <p className="text-xs font-semibold text-slate-700 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {loadError && !preview && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          {loadError}
        </p>
      )}
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 flex flex-col sm:flex-row gap-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by client name..."
          className="flex-1 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex gap-1.5 flex-wrap">
          {(['All', 'Active', 'Under Review', 'Completed', 'Archived'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all
                ${statusFilter === s ? 'text-white' : 'text-slate-500 bg-slate-100 hover:bg-slate-200'}`}
              style={statusFilter === s ? { background: '#6868D0' } : {}}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

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
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white"
            style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
          >
            Import latest template
          </button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-50 text-xs text-slate-400 uppercase">
                <th className="text-left px-5 py-3 font-semibold">Client</th>
                <th className="text-left px-5 py-3 font-semibold">Primary Dx (ICD-10)</th>
                <th className="text-left px-5 py-3 font-semibold">Start Date</th>
                <th className="text-left px-5 py-3 font-semibold">Review Date</th>
                <th className="text-left px-5 py-3 font-semibold">Goals</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
                <th className="text-left px-5 py-3 font-semibold">Signatures</th>
                <th className="text-left px-5 py-3 font-semibold">Actions</th>
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
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                        >
                          {p.client[0]}
                        </div>
                        <span className="text-sm font-medium text-slate-900">{p.client}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <p className="text-sm text-slate-700 font-medium">{p.primaryDx}</p>
                      <p className="text-xs text-slate-400">{p.icd10 || '—'}</p>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{p.startDate}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{p.reviewDate || '—'}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-100 rounded-full h-1.5 min-w-16">
                          <div
                            className="h-1.5 rounded-full transition-all"
                            style={{ width: `${avgProgress}%`, background: '#6868D0' }}
                          />
                        </div>
                        <span className="text-xs text-slate-500">{avgProgress}%</span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {totalGoals} goal{totalGoals !== 1 ? 's' : ''}
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
                      <div className="text-xs space-y-0.5">
                        <div className="flex items-center gap-1">
                          <CheckCircle2
                            size={13}
                            className={p.clientSigned ? 'text-blue-500' : 'text-slate-300'}
                          />
                          <span className="text-slate-500">Client</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <CheckCircle2 size={13} className="text-blue-500" />
                          <span className="text-slate-500">Clinician</span>
                        </div>
                      </div>
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
                        <button
                          type="button"
                          onClick={() => void updateTreatmentPlan(p.id, { action: 'make-live' }).then((plan) => {
                            const mapped = mapRecord(plan);
                            setPlans((prev) => prev.map((row) => row.clientId === p.clientId ? (row.id === mapped.id ? mapped : { ...row, dbStatus: 'CLOSED', status: 'Completed' }) : row));
                          })}
                          className="text-xs px-2.5 py-1 rounded-lg border border-slate-300 font-semibold text-slate-700"
                        >
                          Use as live plan
                        </button>
                        <button
                          onClick={() => void openEditPlan(p)}
                          className="text-xs px-2.5 py-1 rounded-lg text-white font-semibold"
                          style={{ background: '#6868D0' }}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-slate-400">No treatment plans match your filters</div>
          )}
        </div>
      </div>

      {selectedPlan && formMode === 'closed' && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">
                  Treatment Plan — {selectedPlan.client}
                </h2>
                <p className="text-xs text-slate-500">
                  {selectedPlan.clinician} · {selectedPlan.startDate} to {selectedPlan.reviewDate || '—'}
                </p>
              </div>
              <button
                onClick={() => setSelectedPlan(null)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-4">
              {formError && <p role="alert" className="text-sm text-red-700">{formError}</p>}
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
                    <p className="text-sm text-slate-400">No goals on this plan yet.</p>
                  )}
                  {selectedPlan.goals.map((goal, i) => (
                    <div key={goal.id} className="border border-slate-200/80 rounded-xl overflow-hidden">
                      <label className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs text-slate-600"><input type="checkbox" checked={goal.progress === 100} disabled={saving} onChange={(event) => void completeGoal(selectedPlan, goal.id, event.target.checked)} className="accent-[#6B5CC8]" />Goal {i + 1} completed</label>
                      <button
                        onClick={() => toggleGoal(goal.id)}
                        className="w-full flex items-center gap-3 p-4 hover:bg-slate-50 text-left"
                      >
                        <div
                          className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                          style={{ background: '#6868D0' }}
                        >
                          {i + 1}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{goal.text}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                              <div
                                className="h-1.5 rounded-full"
                                style={{ width: `${goal.progress}%`, background: '#6868D0' }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{goal.progress}%</span>
                          </div>
                        </div>
                        <span className="text-slate-400 text-xs font-bold">
                          {expandedGoals.includes(goal.id) ? '▲' : '▼'}
                        </span>
                      </button>
                      {expandedGoals.includes(goal.id) && (
                        <div className="px-4 pb-4 pt-0 space-y-3 border-t border-slate-50 bg-slate-50">
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

              <div className="grid grid-cols-2 gap-3">
                <div className="border rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">Clinician Signature</p>
                  <p className="text-sm text-blue-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 size={13} /> {selectedPlan.clinician}
                  </p>
                  <p className="text-xs text-slate-400">{selectedPlan.startDate}</p>
                </div>
                <div className="border rounded-xl p-3">
                  <p className="text-xs font-bold text-slate-500 mb-1">Client Signature</p>
                  {selectedPlan.clientSigned ? (
                    <p className="text-sm text-blue-600 font-semibold flex items-center gap-1">
                      <CheckCircle2 size={13} /> Signed
                    </p>
                  ) : (
                    <p className="text-sm text-amber-500 font-semibold flex items-center gap-1">
                      <AlertTriangle size={13} /> Pending
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void openEditPlan(selectedPlan)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  Edit Plan
                </button>
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
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {formMode === 'edit' ? 'Edit Treatment Plan' : 'New Treatment Plan'}
              </h2>
              <button
                onClick={closePlanForm}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="p-6 space-y-5">
              <PlanCareFields value={form.clinicalDetails} onChange={(clinicalDetails) => setForm((previous) => ({ ...previous, clinicalDetails }))} onTemplate={applyPracticeTemplate} />
              {form.clinicalDetails.planType === 'Substance Use Disorder (SUD)' && <Part2Notice />}
              {formError && (
                <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
                  {formError}
                </p>
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
                        Select template...
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
                    <option value="">Select client...</option>
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
                    <option value="">Select diagnosis...</option>
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
                    placeholder="Describe the client's presenting problems and clinical concerns..."
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
                    placeholder="Client strengths, supports, and protective factors..."
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
                    className="text-xs font-semibold text-blue-600 border border-slate-300 px-2.5 py-1 rounded-lg hover:bg-blue-50"
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
                          className="text-xs text-slate-500 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-slate-600 mb-1">
                            Goal Statement
                          </label>
                          <input
                            value={goal.text}
                            onChange={(e) => updateGoal(i, { text: e.target.value })}
                            placeholder="Long-term treatment goal..."
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
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  {saving
                    ? 'Saving…'
                    : formMode === 'edit'
                      ? 'Save Changes'
                      : 'Create Treatment Plan'}
                </button>
                <button
                  onClick={closePlanForm}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
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
