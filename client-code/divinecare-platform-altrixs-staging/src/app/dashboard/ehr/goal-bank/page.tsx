'use client';
import { useEffect, useState, useMemo } from 'react';
import { Search, Check, ChevronDown, ChevronUp, ClipboardList, X } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';
import { TreatmentLibraryPanel } from '@/components/therapy/TreatmentLibraryPanel';
import { buttonClasses, PageHeader, StatusBadge } from '@/components/ui';

interface Objective {
  objectiveId: string;
  text: string;
  frequency: string;
  target: string;
}

interface Goal {
  goalId: string;
  category: string;
  diagnosisCodes: string[];
  goalText: string;
  objectives: Objective[];
}

interface GoalPlanTemplate {
  templateId: string;
  patientName: string;
  clientId?: string;
  createdAt: string;
  goals: Goal[];
}

const GOALS: Goal[] = [
  { goalId: 'g-dep-1', category: 'Depression', diagnosisCodes: ['F32', 'F33', 'F34.1'], goalText: 'Reduce depressive symptoms and improve mood stability', objectives: [
    { objectiveId: 'o1', text: 'Client will track mood daily using a 1–10 scale and share logs in session', frequency: 'Daily', target: '4 consecutive weeks' },
    { objectiveId: 'o2', text: 'Client will identify and use 3 behavioral activation strategies per week', frequency: '3×/week', target: '60 days' },
    { objectiveId: 'o3', text: 'Client will report PHQ-9 score reduction of ≥5 points from baseline', frequency: 'Monthly', target: '60 days' },
  ]},
  { goalId: 'g-dep-2', category: 'Depression', diagnosisCodes: ['F32', 'F33'], goalText: 'Develop healthy coping strategies to manage depressive episodes', objectives: [
    { objectiveId: 'o1', text: 'Client will practice 1 mindfulness or relaxation technique daily', frequency: 'Daily', target: '30 days' },
    { objectiveId: 'o2', text: 'Client will identify 3 cognitive distortions contributing to depression weekly in session', frequency: 'Weekly', target: '6 sessions' },
    { objectiveId: 'o3', text: 'Client will engage in at least 3 pleasant activities per week', frequency: '3×/week', target: '4 weeks' },
  ]},
  { goalId: 'g-dep-3', category: 'Depression', diagnosisCodes: ['F32', 'F33'], goalText: 'Improve social functioning and reduce isolation', objectives: [
    { objectiveId: 'o1', text: 'Client will initiate at least 1 social interaction per week outside the home', frequency: 'Weekly', target: '6 weeks' },
    { objectiveId: 'o2', text: 'Client will contact a support person (family or friend) at least 2× per week', frequency: '2×/week', target: '4 weeks' },
    { objectiveId: 'o3', text: 'Client will attend 1 community activity or group per month', frequency: 'Monthly', target: '3 months' },
  ]},
  { goalId: 'g-dep-4', category: 'Depression', diagnosisCodes: ['F32', 'F33', 'F34.1'], goalText: 'Develop and maintain a consistent daily routine to support mood stability', objectives: [
    { objectiveId: 'o1', text: 'Client will maintain consistent sleep schedule (bedtime and wake time within 30 min) for 4 consecutive weeks', frequency: 'Daily', target: '4 weeks' },
    { objectiveId: 'o2', text: 'Client will engage in at least 30 minutes of physical activity 3× per week', frequency: '3×/week', target: '4 weeks' },
    { objectiveId: 'o3', text: 'Client will report completion of basic ADLs daily for 3 consecutive weeks', frequency: 'Daily', target: '3 weeks' },
  ]},
  { goalId: 'g-anx-1', category: 'Anxiety', diagnosisCodes: ['F41.1', 'F41.0', 'F40.10'], goalText: 'Reduce anxiety symptoms and physiological reactivity', objectives: [
    { objectiveId: 'o1', text: 'Client will practice diaphragmatic breathing for 10 minutes daily', frequency: 'Daily', target: '30 days' },
    { objectiveId: 'o2', text: 'Client will report GAD-7 score reduction of ≥5 points from baseline', frequency: 'Monthly', target: '60 days' },
    { objectiveId: 'o3', text: 'Client will identify anxiety triggers with 80% accuracy as measured in session', frequency: 'Weekly', target: '6 sessions' },
  ]},
  { goalId: 'g-anx-2', category: 'Anxiety', diagnosisCodes: ['F41.1', 'F41.0'], goalText: 'Develop effective anxiety management strategies for daily use', objectives: [
    { objectiveId: 'o1', text: 'Client will utilize grounding techniques (5-4-3-2-1) during acute anxiety episodes', frequency: 'As needed', target: '4 weeks' },
    { objectiveId: 'o2', text: 'Client will practice progressive muscle relaxation 3× per week', frequency: '3×/week', target: '4 weeks' },
    { objectiveId: 'o3', text: 'Client will complete a worry journal 5 days per week', frequency: '5×/week', target: '4 weeks' },
  ]},
  { goalId: 'g-anx-3', category: 'Anxiety', diagnosisCodes: ['F41.1', 'F40.10'], goalText: 'Increase tolerance of uncertainty and reduce avoidance behaviors', objectives: [
    { objectiveId: 'o1', text: 'Client will complete 1 exposure hierarchy step per week as collaboratively assigned', frequency: 'Weekly', target: '8 sessions' },
    { objectiveId: 'o2', text: 'Client will identify 3 avoidance behaviors maintaining anxiety by session 3', frequency: 'Ongoing', target: 'Session 3' },
    { objectiveId: 'o3', text: 'Client will engage in 1 previously avoided activity per week', frequency: 'Weekly', target: '6 weeks' },
  ]},
  { goalId: 'g-ptsd-1', category: 'PTSD / Trauma', diagnosisCodes: ['F43.10', 'F43.11', 'F43.12'], goalText: 'Reduce PTSD symptom severity and frequency of intrusive experiences', objectives: [
    { objectiveId: 'o1', text: 'Client will report PCL-5 score reduction of ≥10 points from baseline within 90 days', frequency: 'Monthly', target: '90 days' },
    { objectiveId: 'o2', text: 'Client will implement 1 grounding technique when experiencing intrusive thoughts or flashbacks', frequency: 'As needed', target: '4 weeks' },
    { objectiveId: 'o3', text: 'Client will practice trauma-informed breathing exercises daily for 10 minutes', frequency: 'Daily', target: '4 weeks' },
  ]},
  { goalId: 'g-ptsd-2', category: 'PTSD / Trauma', diagnosisCodes: ['F43.10', 'F43.11'], goalText: 'Process traumatic experiences and develop a coherent trauma narrative', objectives: [
    { objectiveId: 'o1', text: 'Client will identify 3 cognitive distortions related to trauma (self-blame, trust, safety) by session 4', frequency: 'Weekly', target: 'Session 4' },
    { objectiveId: 'o2', text: 'Client will engage in trauma processing (EMDR or CPT) targeting 1 trauma memory per month', frequency: 'Monthly', target: '3 months' },
    { objectiveId: 'o3', text: 'Client will report decreased distress (SUDS reduction) when discussing traumatic material', frequency: 'Per processing session', target: '3 months' },
  ]},
  { goalId: 'g-bip-1', category: 'Bipolar Disorders', diagnosisCodes: ['F31.0', 'F31.1', 'F31.2', 'F31.3'], goalText: 'Achieve and maintain mood stability through consistent self-monitoring', objectives: [
    { objectiveId: 'o1', text: 'Client will complete daily mood charts using a validated tool for 8 consecutive weeks', frequency: 'Daily', target: '8 weeks' },
    { objectiveId: 'o2', text: 'Client will identify 5 personal early warning signs of both manic and depressive episodes', frequency: 'Weekly', target: 'Session 4' },
    { objectiveId: 'o3', text: 'Client will maintain medication compliance as evidenced by self-report and collateral information', frequency: 'Weekly', target: 'Ongoing' },
  ]},
  { goalId: 'g-sud-1', category: 'Substance Use', diagnosisCodes: ['F10', 'F11', 'F12', 'F14', 'F15'], goalText: 'Achieve and maintain sobriety or reduced substance use', objectives: [
    { objectiveId: 'o1', text: 'Client will report 0 days of substance use in the past 30 days by end of month 3', frequency: 'Monthly', target: '3 months' },
    { objectiveId: 'o2', text: 'Client will attend at least 3 AA/NA/peer recovery group meetings per week', frequency: '3×/week', target: 'Ongoing' },
    { objectiveId: 'o3', text: 'Client will report medication-assisted treatment (MAT) compliance if applicable', frequency: 'Weekly', target: 'Ongoing' },
  ]},
  { goalId: 'g-sud-2', category: 'Substance Use', diagnosisCodes: ['F10', 'F11', 'F14'], goalText: 'Identify and develop strategies to manage substance use triggers and cravings', objectives: [
    { objectiveId: 'o1', text: 'Client will identify 5 high-risk people, places, and things that trigger substance use by session 3', frequency: 'Weekly', target: 'Session 3' },
    { objectiveId: 'o2', text: 'Client will create a written relapse prevention plan by session 4 and review it monthly', frequency: 'Monthly', target: 'Session 4' },
    { objectiveId: 'o3', text: 'Client will practice urge surfing technique and report use when experiencing cravings', frequency: 'As needed', target: '4 weeks' },
  ]},
  { goalId: 'g-adhd-1', category: 'ADHD', diagnosisCodes: ['F90.0', 'F90.1', 'F90.2'], goalText: 'Improve executive functioning, organization, and task completion', objectives: [
    { objectiveId: 'o1', text: 'Client will use a daily planner or organizational system consistently for 4 consecutive weeks', frequency: 'Daily', target: '4 weeks' },
    { objectiveId: 'o2', text: 'Client will break tasks into smaller steps using a written list daily', frequency: 'Daily', target: '3 weeks' },
    { objectiveId: 'o3', text: 'Client will report completing at least 70% of planned daily tasks per week', frequency: 'Weekly', target: '4 weeks' },
  ]},
  { goalId: 'g-adhd-2', category: 'ADHD', diagnosisCodes: ['F90.0', 'F90.2'], goalText: 'Improve emotional regulation and reduce impulsive decision-making', objectives: [
    { objectiveId: 'o1', text: 'Client will practice a pause strategy (stop, breathe, think, act) before responding impulsively', frequency: 'As needed', target: '4 weeks' },
    { objectiveId: 'o2', text: 'Client will identify 3 emotional regulation triggers per week in session', frequency: 'Weekly', target: '6 sessions' },
    { objectiveId: 'o3', text: 'Client will report reduction in impulsive actions from baseline using a self-monitoring log', frequency: 'Weekly', target: '2 months' },
  ]},
  { goalId: 'g-bpd-1', category: 'Borderline Personality', diagnosisCodes: ['F60.3'], goalText: 'Develop emotion regulation skills to reduce emotional intensity and reactivity', objectives: [
    { objectiveId: 'o1', text: 'Client will complete DBT emotion regulation homework 4 days per week and review in session', frequency: '4×/week', target: '8 sessions' },
    { objectiveId: 'o2', text: 'Client will identify and name emotions using the DBT feeling wheel during session', frequency: 'Each session', target: '4 sessions' },
    { objectiveId: 'o3', text: 'Client will practice PLEASE skills (physical health, eating, avoiding mood-altering substances, sleep, exercise) daily', frequency: 'Daily', target: '4 weeks' },
  ]},
  { goalId: 'g-bpd-2', category: 'Borderline Personality', diagnosisCodes: ['F60.3'], goalText: 'Improve interpersonal effectiveness and reduce interpersonal chaos', objectives: [
    { objectiveId: 'o1', text: 'Client will practice DEAR MAN skills in at least 1 interpersonal situation per week', frequency: 'Weekly', target: '8 sessions' },
    { objectiveId: 'o2', text: 'Client will identify splitting (black-and-white thinking) patterns in 1 relationship per week in session', frequency: 'Weekly', target: '6 sessions' },
    { objectiveId: 'o3', text: 'Client will demonstrate GIVE skills (Gentle, Interested, Validate, Easy manner) in 1 relationship weekly', frequency: 'Weekly', target: '6 weeks' },
  ]},
  { goalId: 'g-ocd-1', category: 'OCD', diagnosisCodes: ['F42', 'F42.2', 'F42.4'], goalText: 'Reduce frequency and distress associated with obsessive thoughts and compulsive rituals', objectives: [
    { objectiveId: 'o1', text: 'Client will complete 1 ERP exposure hierarchy step per week as collaboratively assigned', frequency: 'Weekly', target: '8 sessions' },
    { objectiveId: 'o2', text: 'Client will reduce total daily ritual/compulsion time by 10% per month from baseline', frequency: 'Monthly', target: '3 months' },
    { objectiveId: 'o3', text: 'Client will report Y-BOCS score reduction of ≥8 points from baseline within 90 days', frequency: 'Monthly', target: '90 days' },
  ]},
  { goalId: 'g-psych-1', category: 'Psychotic Disorders', diagnosisCodes: ['F20', 'F25', 'F22'], goalText: 'Improve medication adherence and reduce psychiatric symptom severity', objectives: [
    { objectiveId: 'o1', text: 'Client will take prescribed antipsychotic medications as directed, confirmed by self-report and collateral', frequency: 'Daily', target: 'Ongoing' },
    { objectiveId: 'o2', text: 'Client will attend all psychiatric medication management appointments', frequency: 'Per schedule', target: 'Ongoing' },
    { objectiveId: 'o3', text: 'Client will report BPRS score reduction of ≥20% from baseline within 90 days', frequency: 'Monthly', target: '90 days' },
  ]},
  { goalId: 'g-grief-1', category: 'Grief / Adjustment', diagnosisCodes: ['F43.21', 'F43.22', 'F43.23'], goalText: 'Process grief and loss while maintaining daily functioning', objectives: [
    { objectiveId: 'o1', text: 'Client will identify and express 3 distinct grief-related emotions per session', frequency: 'Each session', target: '8 sessions' },
    { objectiveId: 'o2', text: 'Client will maintain basic self-care (sleep, meals, hygiene) during bereavement period', frequency: 'Daily', target: '4 weeks' },
    { objectiveId: 'o3', text: 'Client will identify at least 2 memories of the deceased that bring comfort rather than only pain', frequency: 'Monthly', target: '2 months' },
  ]},
];

const SEEDED_TEMPLATES: GoalPlanTemplate[] = [];

const CATEGORIES = [...new Set(GOALS.map(g => g.category))];

export default function GoalBankPage() {
  const { clients } = useClients();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [cart, setCart] = useState<string[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [saved, setSaved] = useState(false);
  const [templates, setTemplates] = useModuleList<GoalPlanTemplate>('goal-bank-templates', SEEDED_TEMPLATES);
  const clientNames = useMemo(
    () => clients.map((client) => client.name).filter(Boolean),
    [clients]
  );
  const patientOptions = clientNames.length > 0 ? clientNames : ['No clients available'];

  useEffect(() => {
    if (!patientName && clientNames[0]) setPatientName(clientNames[0]);
  }, [clientNames, patientName]);

  const filtered = useMemo(() => {
    let g = [...GOALS];
    if (selectedCategory) g = g.filter(gl => gl.category === selectedCategory);
    if (search) {
      const q = search.toLowerCase();
      g = g.filter(gl => gl.goalText.toLowerCase().includes(q) || gl.category.toLowerCase().includes(q) || gl.diagnosisCodes.some(c => c.toLowerCase().includes(q)));
    }
    return g;
  }, [selectedCategory, search]);

  const inCart = (id: string) => cart.includes(id);
  const toggleCart = (id: string) => setCart(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const cartGoals = GOALS.filter(g => cart.includes(g.goalId));
  const recentTemplate = templates[0];

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-6">
      {/* Header */}
      <PageHeader
        title="DSM-5 Goal Bank"
        description={<>{GOALS.length} evidence-based goals across {CATEGORIES.length} diagnostic categories</>}
        actions={<>
          <button onClick={() => setShowCart(true)} className={buttonClasses({ variant: 'primary' })}>
          <ClipboardList size={15} /> Add to Treatment Plan
          {cart.length > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-amber-400 text-white text-[11px] font-bold flex items-center justify-center">{cart.length}</span>
          )}
        </button>
        </>}
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Saved templates</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{templates.length}</p>
          <p className="text-xs text-slate-500 mt-1">Available in Treatment Plans as draft scaffolds.</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Selected goals</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{cart.length}</p>
          <p className="text-xs text-slate-500 mt-1">Add goals to a reusable treatment template.</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Latest template</p>
          <p className="text-sm font-semibold text-slate-900 mt-1">{recentTemplate ? recentTemplate.patientName : 'None yet'}</p>
          <p className="text-xs text-slate-500 mt-1">{recentTemplate ? `${recentTemplate.goals.length} goals saved` : 'Use the cart to create one.'}</p>
        </div>
      </div>

      {/* Practice / Personal libraries used by the treatment plan editor */}
      <TreatmentLibraryPanel />

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search goals, diagnoses, or ICD-10 codes…"
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 bg-white" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Category sidebar */}
        <div className="lg:col-span-1 space-y-1">
          <button onClick={() => setSelectedCategory(null)}
            className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${!selectedCategory ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
            All Categories <span className="text-xs opacity-70">({GOALS.length})</span>
          </button>
          {CATEGORIES.map(cat => {
            const count = GOALS.filter(g => g.category === cat).length;
            const isActive = selectedCategory === cat;
            return (
              <button key={cat} onClick={() => setSelectedCategory(isActive ? null : cat)}
                className={`w-full text-left px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${isActive ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                <span className="truncate">{cat}</span>
                <span className={`text-xs shrink-0 font-semibold px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* Goal list */}
        <div className="lg:col-span-3 space-y-3">
          {filtered.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200/80 p-8 text-center text-slate-500 text-sm">No goals found matching your search.</div>
          )}
          {filtered.map(goal => {
            const isExpanded = expanded === goal.goalId;
            const selected = inCart(goal.goalId);
            return (
              <div key={goal.goalId} className={`bg-white rounded-xl border shadow-xs transition-all ${selected ? 'border-blue-300' : 'border-slate-200/80'}`}>
                <div className="px-5 py-4 flex items-start gap-4">
                  <button onClick={() => toggleCart(goal.goalId)}
                    aria-pressed={selected}
                    aria-label={selected ? 'Remove goal from plan' : 'Add goal to plan'}
                    className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition-all ${selected ? 'border-blue-600 bg-blue-600' : 'border-slate-300'}`}>
                    {selected && <Check size={12} className="text-white" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 mb-1">{goal.goalText}</p>
                        <div className="flex flex-wrap gap-1.5 items-center">
                          <StatusBadge tone="brand" size="sm">
                            {goal.category}
                          </StatusBadge>
                          {goal.diagnosisCodes.map(c => (
                            <span key={c} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-mono">{c}</span>
                          ))}
                        </div>
                      </div>
                      <button onClick={() => setExpanded(isExpanded ? null : goal.goalId)}
                        className="text-slate-500 hover:text-slate-600 shrink-0 mt-0.5">
                        {isExpanded ? <ChevronUp size={16} />:<ChevronDown size={16} />}
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="mt-3 space-y-2">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Measurable Objectives</p>
                        {goal.objectives.map((obj, i) => (
                          <div key={obj.objectiveId} className="bg-slate-50 rounded-xl px-3 py-2.5 flex items-start gap-2">
                            <span className="text-xs font-bold text-slate-500 shrink-0 mt-0.5">{i + 1}.</span>
                            <div className="flex-1">
                              <p className="text-xs text-slate-700">{obj.text}</p>
                              <div className="flex gap-3 mt-1">
                                <span className="text-[11px] text-slate-500">Frequency: <span className="font-medium text-slate-600">{obj.frequency}</span></span>
                                <span className="text-[11px] text-slate-500">Target: <span className="font-medium text-slate-600">{obj.target}</span></span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Add to plan modal */}
      {showCart && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xs w-full max-w-2xl max-h-[85vh] flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Add Goals to Treatment Plan</h2>
                <p className="text-xs text-slate-500">{cart.length} goal{cart.length !== 1 ? 's' : ''} selected</p>
              </div>
              <button onClick={() => setShowCart(false)} className="text-slate-500 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="px-6 py-4 border-b border-slate-200/80">
              <label className="text-xs font-medium text-slate-500 block mb-1">Patient</label>
              <select value={patientName} onChange={e => setPatientName(e.target.value)}
                className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                <option value="">Select client…</option>
                {patientOptions.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
              {cartGoals.length === 0 && (
                <p className="text-sm text-slate-500 text-center py-8">No goals selected. Check the boxes next to goals to add them.</p>
              )}
              {cartGoals.map(g => (
                <div key={g.goalId} className="border border-slate-200/80 rounded-xl p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-medium text-slate-800">{g.goalText}</p>
                    <button onClick={() => toggleCart(g.goalId)} className="text-slate-500 hover:text-rose-600 shrink-0">
                      <X size={14} />
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">{g.objectives.length} objectives · {g.category}</p>
                </div>
              ))}
            </div>
            <div className="px-6 py-4 border-t border-slate-200/80 flex gap-3">
              <button onClick={() => setShowCart(false)} className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              {saved ? (
                <div className="flex-1 py-2.5 rounded-xl text-sm font-medium bg-blue-50 text-blue-700 flex items-center justify-center gap-1.5">
                  <Check size={14} /> Added to {patientName}&apos;s Plan
                </div>
              ) : (
              <button onClick={() => {
                const selectedGoals = cartGoals;
                if (selectedGoals.length === 0 || !patientName) return;
                setTemplates((prev) => [
                  {
                    templateId: `tpl-${Date.now()}`,
                    patientName,
                    clientId: clients.find((c) => c.name === patientName)?.id,
                    createdAt: new Date().toISOString(),
                    goals: selectedGoals,
                  },
                  ...prev,
                ]);
                setSaved(true);
                setTimeout(() => { setShowCart(false); setSaved(false); setCart([]); }, 1800);
              }}
                disabled={cart.length === 0 || !patientName}
                className={buttonClasses({ variant: 'primary', className: 'flex-1' })}>
                Add {cart.length > 0 ? `${cart.length} ` : ''}Goal{cart.length !== 1 ? 's' : ''} to Treatment Plan
              </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
