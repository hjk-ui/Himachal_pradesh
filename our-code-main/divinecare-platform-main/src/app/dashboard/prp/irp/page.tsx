'use client';

import { useState, useCallback, useEffect } from 'react';
import { PRP_CLIENTS, PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, type PrpDraft } from '../prpShared';
import {
  Plus,
  X,
  Save,
  CheckCircle2,
  Target,
  User,
  Calendar,
  FileText,
  ClipboardList,
  AlertTriangle,
  ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/features/auth';

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoalRow {
  id: string;
  need: string;
  clientNeeds: string;
  targetDate: string;
  longTermGoal: string;
  shortTermGoal: string;
  intervention: string;
}

interface ProblemArea {
  key: string;
  label: string;
  checked: boolean;
  deficit: string;
}

interface DischargeGoal {
  key: string;
  label: string;
  checked: boolean;
  specify?: string;
}

interface SupportSystem {
  key: string;
  label: string;
  checked: boolean;
  byDate?: string;
}

interface SignatureBlock {
  name: string;
  signature: string;
  date: string;
}

interface IRPForm {
  // Section 1
  clientId: string;
  clientName: string;
  dob: string;
  date: string;
  gafScore: string;
  gafChange: string;
  // Section 2
  strengths: string;
  needs: string;
  abilities: string;
  preferences: string;
  naturalSupports: string;
  // Section 3
  primaryDiagnoses: string;
  behavioralDiagnoses: string;
  // Section 4
  problemAreas: ProblemArea[];
  // Section 5
  goals: GoalRow[];
  // Section 6
  clientGoals: string;
  clientResponsibilities: string;
  frequencyPerMonth: string;
  // Section 7
  dischargeGoals: DischargeGoal[];
  dischargeRecoveryGoals: string;
  // Section 8
  transitionPlan: string;
  dischargeFromPRPDate: string;
  reducePRPTimes: string;
  reducePRPDate: string;
  supportSystems: SupportSystem[];
  otherCommunitySupport: string;
  nextReferral: string;
  nextIRPReviewDate: string;
  // Section 9
  participatedInPlanning: string;
  copyOffered: string;
  clientInitials: string;
  signatures: {
    client: SignatureBlock;
    guardian: SignatureBlock;
    prescriber: SignatureBlock;
    therapist: SignatureBlock;
    prpCounselor: SignatureBlock;
    prpCoordinator: SignatureBlock;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMO_CLIENTS = [{ id: '', name: '-- Select Client --', dob: '' }, ...PRP_CLIENTS.map(c => ({ id: c.id, name: c.name, dob: c.dob }))];

const NEED_OPTIONS = [
  'Housing',
  'Entitlement',
  'Legal problems/court orders',
  'Transportation',
  'Medical conditions',
  'Problems with primary support system',
  'Problems related to social environment',
  'Educational',
  'Occupational',
  'Self-care',
  'Independent Living Skills',
  'Medication Compliance',
  'Other',
];

const ALLOWED_ROLES = ['prp_specialist', 'case_manager', 'practice_director'] as const;

const TODAY = new Date().toISOString().split('T')[0];

// ─── Default Form State ───────────────────────────────────────────────────────

const DEFAULT_PROBLEM_AREAS: ProblemArea[] = [
  { key: 'housing', label: 'Housing Problems', checked: false, deficit: '' },
  { key: 'entitlement', label: 'Entitlement', checked: false, deficit: '' },
  { key: 'legal', label: 'Legal Problems / Court orders', checked: false, deficit: '' },
  { key: 'transportation', label: 'Transportation', checked: false, deficit: '' },
  { key: 'medical', label: 'Medical Conditions / Concerns', checked: false, deficit: '' },
  { key: 'primary_support', label: 'Problems with primary support system', checked: false, deficit: '' },
  { key: 'social_env', label: 'Problems related to the social environment', checked: false, deficit: '' },
  { key: 'educational', label: 'Educational', checked: false, deficit: '' },
  { key: 'occupational', label: 'Occupational', checked: false, deficit: '' },
  { key: 'self_care', label: 'Self-care problems', checked: false, deficit: '' },
  { key: 'living_skills', label: 'Individual living skills', checked: false, deficit: '' },
  { key: 'medication', label: 'Medication compliance', checked: false, deficit: '' },
];

const DEFAULT_DISCHARGE_GOALS: DischargeGoal[] = [
  { key: 'obtain_housing', label: 'Obtain housing', checked: false },
  { key: 'applied_entitlement', label: 'Applied for entitlements, specify:', checked: false, specify: '' },
  { key: 'received_entitlement', label: 'Received entitlement', checked: false },
  { key: 'freedom_legal', label: 'Freedom from legal problems', checked: false },
  { key: 'transportation_skills', label: 'Acquired transportation skills and support', checked: false },
  { key: 'medical_care', label: 'Accessed/utilized needed medical care', checked: false },
  { key: 'support_systems', label: 'Accessed/utilized support systems (e.g. AA, NA, afterschool)', checked: false },
  { key: 'school', label: 'Improved school attendance and performance', checked: false },
  { key: 'vocational', label: 'Acquired adequate vocational skills / Obtain employment', checked: false },
  { key: 'self_care', label: 'Improved self-care', checked: false },
  { key: 'independent_skills', label: 'Improved independent skills', checked: false },
  { key: 'med_adherence', label: 'Increased medication adherence', checked: false },
  { key: 'med_compliance', label: 'Improved medication compliance', checked: false },
  { key: 'other', label: 'Other, specify:', checked: false, specify: '' },
];

const DEFAULT_SUPPORT_SYSTEMS: SupportSystem[] = [
  { key: 'aa', label: 'To continue AA by date', checked: false, byDate: '' },
  { key: 'na', label: 'To continue NA by date', checked: false, byDate: '' },
  { key: 'afterschool', label: 'To continue after school program by date', checked: false, byDate: '' },
  { key: 'social_skills', label: 'To continue social skills program', checked: false },
  { key: 'family', label: 'Empower family to serve as support system', checked: false },
];

const DEMO_GOALS: GoalRow[] = [
  {
    id: 'g1',
    need: 'Housing',
    clientNeeds: 'Client is currently in unstable housing situation and needs assistance finding permanent, affordable housing.',
    targetDate: '2027-03-01',
    longTermGoal: 'Client will secure stable, permanent housing within 6 months of enrollment.',
    shortTermGoal: 'Client will attend 2 housing resource appointments per month and complete housing application within 30 days.',
    intervention: 'PRP counselor will assist client in identifying housing resources, completing applications, and providing transportation support as needed.',
  },
  {
    id: 'g2',
    need: 'Medication Compliance',
    clientNeeds: 'Client has difficulty remembering to take prescribed medications consistently and reports missing doses 3-4 times per week.',
    targetDate: '2026-12-01',
    longTermGoal: 'Client will take medications as prescribed at least 90% of the time, as reported at monthly medication reviews.',
    shortTermGoal: 'Client will use medication reminder app daily and report adherence rate at each session.',
    intervention: 'PRP counselor will conduct weekly medication adherence check-ins, assist with pharmacy coordination, and educate client on medication management strategies.',
  },
  {
    id: 'g3',
    need: 'Problems related to social environment',
    clientNeeds: 'Client reports social isolation and lack of meaningful community connections, contributing to depressive symptoms.',
    targetDate: '2026-12-15',
    longTermGoal: 'Client will participate in at least 2 community activities per month and report improved sense of social connectedness.',
    shortTermGoal: 'Client will identify one community group or activity to join within 2 weeks and attend at least once before the next session.',
    intervention: 'PRP counselor will identify appropriate community resources, accompany client to initial visit if needed, and process experiences in session.',
  },
];

function buildDefaultForm(): IRPForm {
  return {
    clientId: '',
    clientName: '',
    dob: '',
    date: TODAY,
    gafScore: '',
    gafChange: '',
    strengths: '',
    needs: '',
    abilities: '',
    preferences: '',
    naturalSupports: '',
    primaryDiagnoses: '',
    behavioralDiagnoses: '',
    problemAreas: DEFAULT_PROBLEM_AREAS,
    goals: [],
    clientGoals: '',
    clientResponsibilities: '',
    frequencyPerMonth: '',
    dischargeGoals: DEFAULT_DISCHARGE_GOALS,
    dischargeRecoveryGoals: '',
    transitionPlan: '',
    dischargeFromPRPDate: '',
    reducePRPTimes: '',
    reducePRPDate: '',
    supportSystems: DEFAULT_SUPPORT_SYSTEMS,
    otherCommunitySupport: '',
    nextReferral: '',
    nextIRPReviewDate: '',
    participatedInPlanning: '',
    copyOffered: '',
    clientInitials: '',
    signatures: {
      client: { name: '', signature: '', date: '' },
      guardian: { name: '', signature: '', date: '' },
      prescriber: { name: '', signature: '', date: '' },
      therapist: { name: '', signature: '', date: '' },
      prpCounselor: { name: '', signature: '', date: '' },
      prpCoordinator: { name: '', signature: '', date: '' },
    },
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5">
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center mt-0.5">
        <Icon className="w-5 h-5 text-purple-700" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function PillToggle({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex gap-1 flex-wrap">
      {options.map(opt => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`px-3 py-1.5 text-sm rounded-full border font-medium transition-all ${
            value === opt
              ? 'bg-purple-700 border-purple-700 text-white'
              : 'bg-white border-gray-300 text-gray-600 hover:border-purple-400 hover:text-purple-700'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function FormField({ label, required, children, hint }: { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 italic">{hint}</p>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function IRPPage() {
  const { user, loading } = useAuth();
  const [form, setForm] = useState<IRPForm>(buildDefaultForm);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);
  const [finalized, setFinalized] = useState(false);
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  useEffect(() => {
    const d = loadPrpDraft();
    setDraft(d);
    if (d?.clientId && !finalized) {
      const client = DEMO_CLIENTS.find(c => c.id === d.clientId);
      if (client && client.id) {
        setForm(prev => prev.clientId ? prev : ({ ...prev, clientId: client.id, clientName: client.name, dob: client.dob }));
        showToast('Prefilled from ' + (d.stage === 'assessed' ? 'the rehab assessment' : 'enrollment') + ' — ' + client.name);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Access Control ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-purple-300 border-t-purple-700 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user || !(ALLOWED_ROLES as readonly string[]).includes(user.role)) {
    return (
      <div className="max-w-lg mx-auto mt-16 p-8 bg-white border border-red-200 rounded-xl text-center shadow-sm">
        <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-900 mb-1">Access Restricted</h2>
        <p className="text-sm text-gray-500">
          The Initial Rehabilitation Plan is accessible to PRP Specialists, Case Managers, and Practice Directors only.
        </p>
      </div>
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  const set = (field: keyof IRPForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleClientChange = (id: string) => {
    const client = DEMO_CLIENTS.find(c => c.id === id);
    if (client) {
      setForm(prev => ({ ...prev, clientId: id, clientName: client.name, dob: client.dob }));
    }
  };

  const handleProblemArea = (key: string, field: 'checked' | 'deficit', value: boolean | string) => {
    setForm(prev => ({
      ...prev,
      problemAreas: prev.problemAreas.map(p => p.key === key ? { ...p, [field]: value } : p),
    }));
  };

  const handleDischargeGoal = (key: string, field: 'checked' | 'specify', value: boolean | string) => {
    setForm(prev => ({
      ...prev,
      dischargeGoals: prev.dischargeGoals.map(d => d.key === key ? { ...d, [field]: value } : d),
    }));
  };

  const handleSupportSystem = (key: string, field: 'checked' | 'byDate', value: boolean | string) => {
    setForm(prev => ({
      ...prev,
      supportSystems: prev.supportSystems.map(s => s.key === key ? { ...s, [field]: value } : s),
    }));
  };

  const handleGoalChange = (id: string, field: keyof GoalRow, value: string) => {
    setForm(prev => ({
      ...prev,
      goals: prev.goals.map(g => g.id === id ? { ...g, [field]: value } : g),
    }));
  };

  const addGoalRow = () => {
    const newRow: GoalRow = {
      id: `g${Date.now()}`,
      need: '',
      clientNeeds: '',
      targetDate: '',
      longTermGoal: '',
      shortTermGoal: '',
      intervention: '',
    };
    setForm(prev => ({ ...prev, goals: [...prev.goals, newRow] }));
  };

  const removeGoalRow = (id: string) => {
    setForm(prev => ({ ...prev, goals: prev.goals.filter(g => g.id !== id) }));
  };

  const handleSignature = (
    role: keyof IRPForm['signatures'],
    field: keyof SignatureBlock,
    value: string
  ) => {
    setForm(prev => ({
      ...prev,
      signatures: {
        ...prev.signatures,
        [role]: { ...prev.signatures[role], [field]: value },
      },
    }));
  };

  const handleSaveDraft = () => {
    showToast('IRP draft saved successfully.');
  };

  const handleFinalize = () => {
    setFinalized(true);
    savePrpDraft({ stage: 'irp', clientId: form.clientId, clientName: form.clientName, clientDob: form.dob });
    showToast('IRP finalized and submitted for review.');
  };

  // ─── Progress calculation ─────────────────────────────────────────────────────
  const sections = [
    !!form.clientName,
    !!(form.strengths && form.needs),
    !!(form.primaryDiagnoses || form.behavioralDiagnoses),
    form.problemAreas.some(p => p.checked),
    form.goals.length > 0,
    !!(form.clientGoals && form.frequencyPerMonth),
    !!(form.dischargeRecoveryGoals),
    !!(form.transitionPlan),
    !!(form.signatures.client.signature || form.signatures.prpCounselor.signature),
  ];
  const progress = Math.round((sections.filter(Boolean).length / sections.length) * 100);

  // ─── Shared input classes ──────────────────────────────────────────────────────
  const inputCls = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent transition-shadow';
  const textareaCls = `${inputCls} resize-none`;
  const sectionCls = 'bg-white border border-gray-100 rounded-xl shadow-sm p-6 mb-5';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sticky header + progress */}
      <div className="sticky top-0 z-30 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-bold text-gray-900 leading-tight">
              Initial Individual Rehabilitation Plan (IRP)
            </h1>
            <p className="text-xs text-gray-500">Complete within 30 days of enrollment · review every 6 months · {PRP_REG_LINE}</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end">
              <span className="text-xs text-gray-500 mb-1">Form Completion</span>
              <div className="w-36 h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-purple-600 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-purple-700 font-semibold mt-0.5">{progress}%</span>
            </div>
            {finalized ? (
              <span className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-green-700 bg-green-100 rounded-full">
                <CheckCircle2 className="w-3.5 h-3.5" /> Finalized
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
                >
                  <Save className="w-4 h-4" />
                  Save Draft
                </button>
                <button
                  type="button"
                  onClick={handleFinalize}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold text-white bg-purple-700 rounded-lg hover:bg-purple-800 transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Finalize IRP
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
          }`}
        >
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {toast.msg}
        </div>
      )}

      <div className="max-w-5xl mx-auto px-4 py-6">

        <PrpWorkflowBar current="irp" draft={draft} />

        {/* ── Section 1: Client Information ───────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader icon={User} title="Section 1: Client Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Select Client">
              <div className="relative">
                <select
                  value={form.clientId}
                  onChange={e => handleClientChange(e.target.value)}
                  className={`${inputCls} appearance-none pr-8`}
                >
                  {DEMO_CLIENTS.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
            </FormField>
            <FormField label="Client Name" required>
              <input
                type="text"
                value={form.clientName}
                onChange={e => set('clientName', e.target.value)}
                className={inputCls}
                placeholder="Full legal name"
              />
            </FormField>
            <FormField label="Date of Birth" required>
              <input
                type="date"
                value={form.dob}
                onChange={e => set('dob', e.target.value)}
                className={inputCls}
              />
            </FormField>
            <FormField label="IRP Date" required>
              <input
                type="date"
                value={form.date}
                onChange={e => set('date', e.target.value)}
                className={inputCls}
              />
            </FormField>
            <FormField label="GAF Score (1–100)" hint="Global Assessment of Functioning">
              <input
                type="number"
                min={1}
                max={100}
                value={form.gafScore}
                onChange={e => set('gafScore', e.target.value)}
                className={inputCls}
                placeholder="e.g. 52"
              />
            </FormField>
            <FormField label="GAF Change Since Last IRP">
              <PillToggle
                value={form.gafChange}
                options={['Increased', 'Decreased', 'Not changed', 'Unknown', 'N/A']}
                onChange={v => set('gafChange', v)}
              />
            </FormField>
          </div>
        </div>

        {/* ── Section 2: Client Profile ────────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={FileText}
            title="Section 2: Client Profile"
            subtitle="As stated by client"
          />
          <div className="grid grid-cols-1 gap-4">
            <FormField label="Client's Strengths">
              <textarea
                rows={3}
                value={form.strengths}
                onChange={e => set('strengths', e.target.value)}
                className={textareaCls}
                placeholder="Describe the client's identified strengths..."
              />
            </FormField>
            <FormField label="Client's Needs">
              <textarea
                rows={3}
                value={form.needs}
                onChange={e => set('needs', e.target.value)}
                className={textareaCls}
                placeholder="Describe the client's identified needs..."
              />
            </FormField>
            <FormField label="Client's Abilities">
              <textarea
                rows={3}
                value={form.abilities}
                onChange={e => set('abilities', e.target.value)}
                className={textareaCls}
                placeholder="Describe the client's current abilities..."
              />
            </FormField>
            <FormField label="Client's Preferences">
              <textarea
                rows={3}
                value={form.preferences}
                onChange={e => set('preferences', e.target.value)}
                className={textareaCls}
                placeholder="Describe the client's preferences for services and activities..."
              />
            </FormField>
            <FormField label="Client's Natural Supports">
              <textarea
                rows={3}
                value={form.naturalSupports}
                onChange={e => set('naturalSupports', e.target.value)}
                className={textareaCls}
                placeholder="Describe family, friends, community supports..."
              />
            </FormField>
          </div>
        </div>

        {/* ── Section 3: Diagnoses ─────────────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader icon={ClipboardList} title="Section 3: Diagnoses" />
          <div className="grid grid-cols-1 gap-4">
            <FormField label="Primary Medical Diagnoses / Disabilities">
              <textarea
                rows={3}
                value={form.primaryDiagnoses}
                onChange={e => set('primaryDiagnoses', e.target.value)}
                className={textareaCls}
                placeholder="List ICD-10 codes and descriptions..."
              />
            </FormField>
            <FormField label="Behavioral Health Diagnoses">
              <textarea
                rows={3}
                value={form.behavioralDiagnoses}
                onChange={e => set('behavioralDiagnoses', e.target.value)}
                className={textareaCls}
                placeholder="List behavioral health ICD-10 codes and descriptions..."
              />
            </FormField>
          </div>
        </div>

        {/* ── Section 4: Problem Areas ─────────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={AlertTriangle}
            title="Section 4: Problem Areas"
            subtitle="Check all that apply and describe the client's deficit in each area"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {form.problemAreas.map(area => (
              <div
                key={area.key}
                className={`p-3 border rounded-lg transition-colors ${
                  area.checked ? 'border-purple-300 bg-purple-50' : 'border-gray-200 bg-gray-50'
                }`}
              >
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <div className="relative flex-shrink-0 mt-0.5">
                    <input
                      type="checkbox"
                      checked={area.checked}
                      onChange={e => handleProblemArea(area.key, 'checked', e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-4.5 h-4.5 w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors ${
                        area.checked ? 'bg-purple-700 border-purple-700' : 'bg-white border-gray-300'
                      }`}
                    >
                      {area.checked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-medium ${area.checked ? 'text-purple-800' : 'text-gray-700'}`}>
                    {area.label}
                  </span>
                </label>
                {area.checked && (
                  <input
                    type="text"
                    value={area.deficit}
                    onChange={e => handleProblemArea(area.key, 'deficit', e.target.value)}
                    placeholder="Describe client's deficit..."
                    className="mt-2 w-full px-2.5 py-1.5 text-xs border border-purple-200 rounded-md bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 5: IRP Goals Table ───────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={Target}
            title="Section 5: IRP Goals"
            subtitle="Core rehabilitation plan — add specific, measurable, achievable goals"
          />

          {/* Desktop Table */}
          <div className="hidden lg:block overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-xs">
              <thead className="bg-purple-700 text-white">
                <tr>
                  <th className="px-3 py-3 text-left font-semibold w-32">Need Area</th>
                  <th className="px-3 py-3 text-left font-semibold">Client's Needs</th>
                  <th className="px-3 py-3 text-left font-semibold w-28">Target Date</th>
                  <th className="px-3 py-3 text-left font-semibold">Long-Term Goal</th>
                  <th className="px-3 py-3 text-left font-semibold">Short-Term Goal</th>
                  <th className="px-3 py-3 text-left font-semibold">Intervention</th>
                  <th className="px-2 py-3 w-8" />
                </tr>
              </thead>
              <tbody>
                {form.goals.map((goal, idx) => (
                  <tr
                    key={goal.id}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-purple-50/40'}
                  >
                    <td className="px-2 py-2 align-top">
                      <select
                        value={goal.need}
                        onChange={e => handleGoalChange(goal.id, 'need', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      >
                        <option value="">Select...</option>
                        {NEED_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </td>
                    <td className="px-2 py-2 align-top">
                      <textarea
                        rows={3}
                        value={goal.clientNeeds}
                        onChange={e => handleGoalChange(goal.id, 'clientNeeds', e.target.value)}
                        placeholder="Describe client's need..."
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="date"
                        value={goal.targetDate}
                        onChange={e => handleGoalChange(goal.id, 'targetDate', e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <textarea
                        rows={3}
                        value={goal.longTermGoal}
                        onChange={e => handleGoalChange(goal.id, 'longTermGoal', e.target.value)}
                        placeholder="Long-term goal related to rehab assessment..."
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <textarea
                        rows={3}
                        value={goal.shortTermGoal}
                        onChange={e => handleGoalChange(goal.id, 'shortTermGoal', e.target.value)}
                        placeholder="Specific, measurable, individualized, achievable..."
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <textarea
                        rows={3}
                        value={goal.intervention}
                        onChange={e => handleGoalChange(goal.id, 'intervention', e.target.value)}
                        placeholder="Intervention related to goals..."
                        className="w-full px-2 py-1.5 border border-gray-200 rounded text-xs bg-white resize-none focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    </td>
                    <td className="px-1 py-2 align-top">
                      <button
                        type="button"
                        onClick={() => removeGoalRow(goal.id)}
                        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Remove row"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Card Layout */}
          <div className="lg:hidden space-y-4">
            {form.goals.map((goal, idx) => (
              <div key={goal.id} className="border border-gray-200 rounded-lg p-4 bg-white">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-bold text-purple-700 uppercase tracking-wide">
                    Goal {idx + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeGoalRow(goal.id)}
                    className="w-7 h-7 flex items-center justify-center rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-3">
                  <FormField label="Need Area">
                    <select
                      value={goal.need}
                      onChange={e => handleGoalChange(goal.id, 'need', e.target.value)}
                      className={inputCls}
                    >
                      <option value="">Select need area...</option>
                      {NEED_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                  </FormField>
                  <FormField label="Client's Needs">
                    <textarea rows={2} value={goal.clientNeeds} onChange={e => handleGoalChange(goal.id, 'clientNeeds', e.target.value)} placeholder="Describe client's need..." className={textareaCls} />
                  </FormField>
                  <FormField label="Target Date">
                    <input type="date" value={goal.targetDate} onChange={e => handleGoalChange(goal.id, 'targetDate', e.target.value)} className={inputCls} />
                  </FormField>
                  <FormField label="Long-Term Goal" hint="Must be related to the rehabilitation assessment">
                    <textarea rows={2} value={goal.longTermGoal} onChange={e => handleGoalChange(goal.id, 'longTermGoal', e.target.value)} placeholder="Long-term goal..." className={textareaCls} />
                  </FormField>
                  <FormField label="Short-Term Goal" hint="Must be specific, measurable, individualized, achievable">
                    <textarea rows={2} value={goal.shortTermGoal} onChange={e => handleGoalChange(goal.id, 'shortTermGoal', e.target.value)} placeholder="Short-term goal..." className={textareaCls} />
                  </FormField>
                  <FormField label="Intervention" hint="Must be related to the goals">
                    <textarea rows={2} value={goal.intervention} onChange={e => handleGoalChange(goal.id, 'intervention', e.target.value)} placeholder="Intervention..." className={textareaCls} />
                  </FormField>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addGoalRow}
            className="mt-4 flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 border border-purple-300 rounded-lg hover:bg-purple-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Goal Row
          </button>
        </div>

        {/* ── Section 6: Client Goals & Responsibilities ───────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={User}
            title="Section 6: Client Goals & Responsibilities"
          />
          <div className="grid grid-cols-1 gap-4">
            <FormField label="Client's Goals (as stated by client)">
              <textarea
                rows={3}
                value={form.clientGoals}
                onChange={e => set('clientGoals', e.target.value)}
                className={textareaCls}
                placeholder="In the client's own words, what are their goals for this program..."
              />
            </FormField>
            <FormField label="Client's Responsibilities in Facilitating Own Recovery">
              <textarea
                rows={3}
                value={form.clientResponsibilities}
                onChange={e => set('clientResponsibilities', e.target.value)}
                className={textareaCls}
                placeholder="What the client agrees to do to support their own recovery..."
              />
            </FormField>
            <FormField label="Frequency of Services">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={form.frequencyPerMonth}
                  onChange={e => set('frequencyPerMonth', e.target.value)}
                  className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <span className="text-sm text-gray-600">times per month</span>
              </div>
            </FormField>
          </div>
        </div>

        {/* ── Section 7: Discharge / Recovery Goals ───────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={CheckCircle2}
            title="Section 7: Discharge / Recovery Goals"
            subtitle="Check all that apply"
          />
          <div className="space-y-2 mb-5">
            {form.dischargeGoals.map(goal => (
              <div key={goal.key}>
                <label className="flex items-center gap-2.5 cursor-pointer group">
                  <div className="relative flex-shrink-0">
                    <input
                      type="checkbox"
                      checked={goal.checked}
                      onChange={e => handleDischargeGoal(goal.key, 'checked', e.target.checked)}
                      className="sr-only"
                    />
                    <div
                      className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors ${
                        goal.checked ? 'bg-purple-700 border-purple-700' : 'bg-white border-gray-300 group-hover:border-purple-400'
                      }`}
                    >
                      {goal.checked && (
                        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                          <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <span className={`text-sm ${goal.checked ? 'text-purple-800 font-medium' : 'text-gray-700'}`}>
                    {goal.label}
                  </span>
                  {'specify' in goal && goal.checked && (
                    <input
                      type="text"
                      value={goal.specify ?? ''}
                      onChange={e => handleDischargeGoal(goal.key, 'specify', e.target.value)}
                      placeholder="Specify..."
                      className="ml-2 flex-1 px-2.5 py-1 text-xs border border-purple-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  )}
                </label>
              </div>
            ))}
          </div>

          <div className="pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-500 italic mb-3">
              By the end of this authorization period, we hope to achieve the following goals in order to discharge/transition client to the next lower level of services:
            </p>
            <FormField label="Discharge / Recovery Goals">
              <textarea
                rows={4}
                value={form.dischargeRecoveryGoals}
                onChange={e => set('dischargeRecoveryGoals', e.target.value)}
                className={textareaCls}
                placeholder="Describe specific discharge and recovery goals for this authorization period..."
              />
            </FormField>
          </div>
        </div>

        {/* ── Section 8: Transition Plan ───────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={Calendar}
            title="Section 8: Transition Plan"
          />
          <div className="grid grid-cols-1 gap-4">
            <FormField label="Action and Support Systems Needed">
              <textarea
                rows={3}
                value={form.transitionPlan}
                onChange={e => set('transitionPlan', e.target.value)}
                className={textareaCls}
                placeholder="Describe the transition action plan and support systems needed..."
              />
            </FormField>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                Check Action to Be Taken
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700">Discharge from PRP by:</span>
                  <input
                    type="date"
                    value={form.dischargeFromPRPDate}
                    onChange={e => set('dischargeFromPRPDate', e.target.value)}
                    className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">Reduce PRP to</span>
                  <input
                    type="number"
                    min={1}
                    value={form.reducePRPTimes}
                    onChange={e => set('reducePRPTimes', e.target.value)}
                    placeholder="N"
                    className="w-14 px-2 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                  <span className="text-sm text-gray-700">times/month by</span>
                  <input
                    type="date"
                    value={form.reducePRPDate}
                    onChange={e => set('reducePRPDate', e.target.value)}
                    className="px-2 py-1.5 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                Support Systems Needed
              </p>
              <div className="space-y-2">
                {form.supportSystems.map(s => (
                  <div key={s.key} className="flex items-center gap-2.5 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer group">
                      <div className="relative flex-shrink-0">
                        <input
                          type="checkbox"
                          checked={s.checked}
                          onChange={e => handleSupportSystem(s.key, 'checked', e.target.checked)}
                          className="sr-only"
                        />
                        <div
                          className={`w-[18px] h-[18px] rounded border-2 flex items-center justify-center transition-colors ${
                            s.checked ? 'bg-purple-700 border-purple-700' : 'bg-white border-gray-300 group-hover:border-purple-400'
                          }`}
                        >
                          {s.checked && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 12 12">
                              <path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          )}
                        </div>
                      </div>
                      <span className={`text-sm ${s.checked ? 'text-purple-800 font-medium' : 'text-gray-700'}`}>
                        {s.label}
                      </span>
                    </label>
                    {'byDate' in s && s.checked && (
                      <input
                        type="date"
                        value={s.byDate ?? ''}
                        onChange={e => handleSupportSystem(s.key, 'byDate', e.target.value)}
                        className="px-2 py-1.5 text-xs border border-purple-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                      />
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-gray-700">Other community support systems:</span>
                  <input
                    type="text"
                    value={form.otherCommunitySupport}
                    onChange={e => set('otherCommunitySupport', e.target.value)}
                    placeholder="Specify..."
                    className="flex-1 px-2.5 py-1 text-xs border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>
              </div>
            </div>

            <FormField label="Next Referral / Recommendation to Other Programs">
              <textarea
                rows={2}
                value={form.nextReferral}
                onChange={e => set('nextReferral', e.target.value)}
                className={textareaCls}
                placeholder="Specify referrals or recommendations..."
              />
            </FormField>
            <FormField
              label="Next IRP Review Date"
              hint="3 months for adolescent clients; 6 months for adult clients"
            >
              <input
                type="date"
                value={form.nextIRPReviewDate}
                onChange={e => set('nextIRPReviewDate', e.target.value)}
                className={inputCls}
              />
            </FormField>
          </div>
        </div>

        {/* ── Section 9: Signatures ────────────────────────────────────────────── */}
        <div className={sectionCls}>
          <SectionHeader
            icon={FileText}
            title="Section 9: Signatures"
            subtitle="All parties must sign to acknowledge participation in IRP planning"
          />

          <div className="mb-5 flex flex-col sm:flex-row gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Client/Caregiver Participated in Planning
              </p>
              <PillToggle
                value={form.participatedInPlanning}
                options={['Yes', 'No']}
                onChange={v => set('participatedInPlanning', v)}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Copy of IRP Was Explained and Offered — Copy Was
              </p>
              <PillToggle
                value={form.copyOffered}
                options={['Accepted', 'Declined']}
                onChange={v => set('copyOffered', v)}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
                Client's Initials
              </p>
              <input
                type="text"
                value={form.clientInitials}
                onChange={e => set('clientInitials', e.target.value)}
                maxLength={4}
                placeholder="e.g. MT"
                className="w-20 px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white text-center uppercase font-semibold focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {(
              [
                { role: 'client', label: 'Client' },
                { role: 'guardian', label: 'Client Guardian / Parent' },
                { role: 'prescriber', label: 'Prescriber' },
                { role: 'therapist', label: 'Therapist' },
                { role: 'prpCounselor', label: 'PRP Counselor' },
                { role: 'prpCoordinator', label: 'PRP Coordinator' },
              ] as const
            ).map(({ role, label }) => (
              <div
                key={role}
                className="border border-gray-200 rounded-lg p-4 bg-gray-50"
              >
                <p className="text-xs font-bold text-purple-700 uppercase tracking-wide mb-3">
                  {label}
                </p>
                <div className="flex flex-col gap-2">
                  <FormField label="Printed Name">
                    <input
                      type="text"
                      value={form.signatures[role].name}
                      onChange={e => handleSignature(role, 'name', e.target.value)}
                      placeholder="Full name..."
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  </FormField>
                  <FormField label="Signature" hint="Type full name as signature">
                    <input
                      type="text"
                      value={form.signatures[role].signature}
                      onChange={e => handleSignature(role, 'signature', e.target.value)}
                      placeholder="Sign here (type full name)..."
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded bg-white italic text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400"
                      style={{ fontFamily: 'cursive' }}
                    />
                  </FormField>
                  <FormField label="Date">
                    <input
                      type="date"
                      value={form.signatures[role].date}
                      onChange={e => handleSignature(role, 'date', e.target.value)}
                      className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                    />
                  </FormField>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Bottom Action Bar ────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 py-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">
            Form last updated by <span className="font-medium text-gray-700">{user.displayName}</span> ({user.role}) on {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          {!finalized ? (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleSaveDraft}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-gray-700 border border-gray-300 rounded-lg hover:border-gray-400 transition-colors"
              >
                <Save className="w-4 h-4" />
                Save Draft
              </button>
              <button
                type="button"
                onClick={handleFinalize}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-purple-700 rounded-lg hover:bg-purple-800 transition-colors shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                Finalize IRP
              </button>
            </div>
          ) : (
            <span className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-green-700 bg-green-100 rounded-lg">
              <CheckCircle2 className="w-4 h-4" />
              IRP Finalized
            </span>
          )}
        </div>

      </div>
    </div>
  );
}
