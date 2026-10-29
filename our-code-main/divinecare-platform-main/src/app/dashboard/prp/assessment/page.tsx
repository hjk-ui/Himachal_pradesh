'use client';
import { useState, useMemo, useEffect, useCallback } from 'react';
import {
  User, ClipboardList, Save, CheckCircle2, AlertTriangle, Plus, X,
  Home, MessageCircle, Users, Shield, Scale, Wine, Heart, GraduationCap,
  Briefcase, Brain, ChevronDown, Clock, Pill, Lock,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { PRP_CLIENTS, PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, type PrpDraft } from '../prpShared';

// ─── Types ────────────────────────────────────────────────────────────────────
type YesNo = 'yes' | 'no' | 'na' | '';

interface MedRow { name: string; strength: string; frequency: string; compliance: string; }
interface RehabNeed { checked: boolean; comment: string; }

interface FormState {
  patientInfo: {
    clientId: string; patientName: string; dob: string; maNumber: string;
    gender: string; dateOfAssessment: string; adultMinor: string;
    accompaniedBy: string; relationshipToPatient: string;
  };
  medicalHealth: {
    medications: MedRow[]; helpWithMedication: YesNo; helpWithMedicationWho: string;
    servicesReceiving: { individual: boolean; family: boolean; group: boolean; iop: boolean; methadone: boolean; other: boolean; otherText: string };
    treatmentHistory: string; healthConcerns: YesNo; healthConcernsExplain: string;
    pregnant: YesNo; pregnantDueDate: string; adaptiveEquipment: string;
  };
  housing: {
    managingSafeHousing: YesNo; housingSafeType: string; housingUnsafeExplain: string;
    meetNeeds: YesNo; meetNeedsExplain: string; whoLivesWith: string;
    housekeeping: YesNo; basicHygiene: YesNo; basicHygieneExplain: string;
  };
  communication: {
    difficultyExpressing: YesNo; difficultyExplain: string;
    feelIsolated: YesNo; makeDecisions: YesNo; makeDecisionsExplain: string;
    currentMedsList: string; pastMedsList: string; medicationEfficacy: string;
    spiritualBeliefs: string; traumaHistory: YesNo; traumaExplain: string;
  };
  socialRecreational: {
    prefersAlone: YesNo; understandsOthers: YesNo; getsAlongOthers: YesNo;
    interactsFamily: YesNo; interactsTeachers: YesNo;
    churchActivities: YesNo; churchActivitiesWhat: string; leisureActivities: string;
    hasDailyRoutine: YesNo; troubleConcentrating: YesNo; troubleSleeping: YesNo;
    regularIncome: YesNo; incomeSource: string; meetsMonthlyExpenses: YesNo;
    meetsBasicNeeds: YesNo; basicNeedsExplain: string;
    spendsRegret: YesNo; groceryCooking: YesNo;
  };
  safety: {
    difficultiesSafe: YesNo; difficultiesSafeExplain: string;
    harmThoughts: YesNo; lifeThoughts: YesNo; harmExplain: string;
    plannedHow: YesNo; plannedExplain: string; hasMeans: YesNo;
  };
  legal: {
    onProbation: YesNo; negativeEncounters: YesNo; arrestedPast30: YesNo;
    custodyOrder: YesNo; dssInvolvement: YesNo; legalHistory: string;
    dangerousBehaviors: YesNo; dangerousExplain: string; abuseExperience: YesNo;
  };
  alcoholDrug: {
    smokes: YesNo; alcoholDrinks: string; illicitDrugs: YesNo; drugsExplain: string;
  };
  sexuality: {
    intimateRelationship: YesNo; relationshipConcerns: YesNo; concernsWhat: string;
    medicationsAffect: YesNo; medicationConcerns: string;
    safeSex: YesNo; birthControl: YesNo;
  };
  familyTransportation: {
    presentingNeeds: string; depression: string; spiritualImpact: string; culturalImpact: string;
    familyNearby: YesNo; familyWho: string; familyStrained: YesNo;
    familyPeerSummary: string; transportNeed: YesNo; transportMeans: string;
  };
  academic: {
    enrolledSchool: YesNo; attendsRegularly: YesNo; hasIEP: YesNo;
    completesHomework: YesNo; completesTasks: YesNo; followsDirections: YesNo;
    worksIndependently: YesNo; canReadWrite: YesNo;
    learningDisability: YesNo; disabilityDescribe: string;
    suspendedExpelled: YesNo; suspendedWhen: string;
    schoolName: string; educationLevel: string;
  };
  employment: {
    currentlyWork: YesNo; expectReturn: YesNo;
    vocationTraining: YesNo; vocationProgram: string;
  };
  snap: {
    strengths: string; needs: string; abilities: string; preferences: string;
    goals: string; challenges: string; interpreSummary: string;
    dla20: YesNo; level1Measure: YesNo;
  };
  rehabNeeds: Record<string, RehabNeed>;
  signature: {
    prpVisits: string; completedBy: string; completedSigned: boolean;
    completedDate: string; supervisor: string; supervisorSigned: boolean; supervisorDate: string;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = ['prp_specialist', 'case_manager', 'practice_director'] as const;

const DEMO_CLIENTS = [{ id: '', name: '-- Select Client --', dob: '' }, ...PRP_CLIENTS.map(c => ({ id: c.id, name: c.name, dob: c.dob }))];

const REHAB_NEEDS_LIST = [
  'Entitlements', 'Legal', 'Transportation', 'Health/Medical',
  'Family/Friends/Community Supports', 'Social Skills', 'Educational',
  'Occupational', 'Self-Care', 'Independent Living Skills',
  'Medication Compliance', 'Others',
];

const EDUCATION_LEVELS = [
  'No formal education', 'Some elementary', 'Elementary graduate',
  'Some middle school', 'Middle school graduate', 'Some high school',
  'High school diploma/GED', 'Some college', "Associate's degree",
  "Bachelor's degree", 'Graduate degree',
];

const today = new Date().toISOString().split('T')[0];
const EMPTY_MED: MedRow = { name: '', strength: '', frequency: '', compliance: '' };
const initRehabNeeds = (): Record<string, RehabNeed> =>
  Object.fromEntries(REHAB_NEEDS_LIST.map(n => [n, { checked: false, comment: '' }]));

const INITIAL_FORM: FormState = {
  patientInfo: {
    clientId: '', patientName: '', dob: '', maNumber: '',
    gender: '', dateOfAssessment: today, adultMinor: '',
    accompaniedBy: '', relationshipToPatient: '',
  },
  medicalHealth: {
    medications: [{ ...EMPTY_MED }, { ...EMPTY_MED }, { ...EMPTY_MED }, { ...EMPTY_MED }],
    helpWithMedication: '', helpWithMedicationWho: '',
    servicesReceiving: { individual: false, family: false, group: false, iop: false, methadone: false, other: false, otherText: '' },
    treatmentHistory: '', healthConcerns: '', healthConcernsExplain: '',
    pregnant: '', pregnantDueDate: '', adaptiveEquipment: '',
  },
  housing: {
    managingSafeHousing: '', housingSafeType: '', housingUnsafeExplain: '',
    meetNeeds: '', meetNeedsExplain: '', whoLivesWith: '',
    housekeeping: '', basicHygiene: '', basicHygieneExplain: '',
  },
  communication: {
    difficultyExpressing: '', difficultyExplain: '',
    feelIsolated: '', makeDecisions: '', makeDecisionsExplain: '',
    currentMedsList: '', pastMedsList: '', medicationEfficacy: '',
    spiritualBeliefs: '', traumaHistory: '', traumaExplain: '',
  },
  socialRecreational: {
    prefersAlone: '', understandsOthers: '', getsAlongOthers: '',
    interactsFamily: '', interactsTeachers: '',
    churchActivities: '', churchActivitiesWhat: '', leisureActivities: '',
    hasDailyRoutine: '', troubleConcentrating: '', troubleSleeping: '',
    regularIncome: '', incomeSource: '', meetsMonthlyExpenses: '',
    meetsBasicNeeds: '', basicNeedsExplain: '', spendsRegret: '', groceryCooking: '',
  },
  safety: {
    difficultiesSafe: '', difficultiesSafeExplain: '',
    harmThoughts: '', lifeThoughts: '', harmExplain: '',
    plannedHow: '', plannedExplain: '', hasMeans: '',
  },
  legal: {
    onProbation: '', negativeEncounters: '', arrestedPast30: '',
    custodyOrder: '', dssInvolvement: '', legalHistory: '',
    dangerousBehaviors: '', dangerousExplain: '', abuseExperience: '',
  },
  alcoholDrug: { smokes: '', alcoholDrinks: '', illicitDrugs: '', drugsExplain: '' },
  sexuality: {
    intimateRelationship: '', relationshipConcerns: '', concernsWhat: '',
    medicationsAffect: '', medicationConcerns: '', safeSex: '', birthControl: '',
  },
  familyTransportation: {
    presentingNeeds: '', depression: '', spiritualImpact: '', culturalImpact: '',
    familyNearby: '', familyWho: '', familyStrained: '',
    familyPeerSummary: '', transportNeed: '', transportMeans: '',
  },
  academic: {
    enrolledSchool: '', attendsRegularly: '', hasIEP: '',
    completesHomework: '', completesTasks: '', followsDirections: '',
    worksIndependently: '', canReadWrite: '',
    learningDisability: '', disabilityDescribe: '',
    suspendedExpelled: '', suspendedWhen: '', schoolName: '', educationLevel: '',
  },
  employment: { currentlyWork: '', expectReturn: '', vocationTraining: '', vocationProgram: '' },
  snap: {
    strengths: '', needs: '', abilities: '', preferences: '',
    goals: '', challenges: '', interpreSummary: '',
    dla20: '', level1Measure: '',
  },
  rehabNeeds: initRehabNeeds(),
  signature: {
    prpVisits: '', completedBy: '', completedSigned: false,
    completedDate: today, supervisor: '', supervisorSigned: false, supervisorDate: today,
  },
};

// ─── Sub-Components ───────────────────────────────────────────────────────────
function SectionHeader({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ size?: number; className?: string }>; title: string; subtitle?: string }) {
  return (
    <div className="flex items-start gap-3 mb-5 pb-3 border-b border-slate-100">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: '#EDE9F7' }}>
        <Icon size={16} className="text-[#5C2D91]" />
      </div>
      <div>
        <h2 className="font-bold text-slate-900 text-base">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}

function FormSection({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-slate-200 p-6 ${className ?? ''}`}
      style={{ borderLeft: '3px solid #5C2D91' }}>
      {children}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-slate-700 mb-1.5">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function TextInput({ value, onChange, placeholder, className }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder-slate-300 transition-all ${className ?? ''}`}
    />
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 transition-all"
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 placeholder-slate-300 resize-none transition-all"
    />
  );
}

function SelectInput({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 transition-all bg-white"
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

type YesNoOption = 'yes' | 'no' | 'na';
function YesNoToggle({ value, onChange, withNA = false, labels }: {
  value: YesNo; onChange: (v: YesNo) => void; withNA?: boolean;
  labels?: { yes?: string; no?: string; na?: string };
}) {
  const opts: { v: YesNoOption; label: string }[] = [
    { v: 'yes', label: labels?.yes ?? 'Yes' },
    { v: 'no', label: labels?.no ?? 'No' },
    ...(withNA ? [{ v: 'na' as YesNoOption, label: labels?.na ?? 'N/A' }] : []),
  ];
  return (
    <div className="flex gap-2">
      {opts.map(o => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(value === o.v ? '' : o.v)}
          className={`px-4 py-1.5 rounded-full text-sm font-medium border transition-all ${
            value === o.v
              ? 'text-white border-transparent'
              : 'bg-white text-slate-600 border-slate-300 hover:border-purple-400 hover:text-purple-700'
          }`}
          style={value === o.v ? { backgroundColor: '#5C2D91', borderColor: '#5C2D91' } : {}}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function QuestionRow({ label, value, onChange, withNA, children, yesLabels }: {
  label: string; value: YesNo; onChange: (v: YesNo) => void;
  withNA?: boolean; children?: React.ReactNode;
  yesLabels?: { yes?: string; no?: string; na?: string };
}) {
  return (
    <div className="py-3 border-b border-slate-50 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <span className="text-sm text-slate-700 flex-1 leading-relaxed">{label}</span>
        <YesNoToggle value={value} onChange={onChange} withNA={withNA} labels={yesLabels} />
      </div>
      {children && <div className="mt-2 ml-2">{children}</div>}
    </div>
  );
}

function ConditionalField({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return (
    <div className="mt-2 pl-4 border-l-2 border-purple-200 animate-in fade-in duration-200">
      {children}
    </div>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3.5 rounded-xl shadow-xl border border-green-200 bg-green-50 animate-in slide-in-from-bottom-2 duration-300">
      <CheckCircle2 size={18} className="text-green-600 shrink-0" />
      <span className="text-sm font-medium text-green-800">{message}</span>
      <button onClick={onClose} className="ml-2 text-green-500 hover:text-green-700">
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
function useProgress(form: FormState): number {
  return useMemo(() => {
    const fields: (string | boolean | YesNo)[] = [
      // Patient Info
      form.patientInfo.patientName, form.patientInfo.dob, form.patientInfo.gender,
      form.patientInfo.adultMinor, form.patientInfo.maNumber,
      // Medical
      form.medicalHealth.helpWithMedication, form.medicalHealth.healthConcerns, form.medicalHealth.pregnant,
      // Housing
      form.housing.managingSafeHousing, form.housing.meetNeeds, form.housing.housekeeping, form.housing.basicHygiene,
      // Communication
      form.communication.difficultyExpressing, form.communication.feelIsolated,
      form.communication.makeDecisions, form.communication.traumaHistory,
      // Social
      form.socialRecreational.prefersAlone, form.socialRecreational.understandsOthers,
      form.socialRecreational.getsAlongOthers, form.socialRecreational.interactsFamily,
      form.socialRecreational.churchActivities, form.socialRecreational.hasDailyRoutine,
      form.socialRecreational.troubleConcentrating, form.socialRecreational.troubleSleeping,
      form.socialRecreational.regularIncome, form.socialRecreational.meetsMonthlyExpenses,
      form.socialRecreational.meetsBasicNeeds, form.socialRecreational.spendsRegret,
      form.socialRecreational.groceryCooking,
      // Safety
      form.safety.difficultiesSafe, form.safety.harmThoughts,
      // Legal
      form.legal.onProbation, form.legal.negativeEncounters, form.legal.arrestedPast30,
      form.legal.custodyOrder, form.legal.dssInvolvement, form.legal.dangerousBehaviors, form.legal.abuseExperience,
      // Alcohol/Drug
      form.alcoholDrug.smokes, form.alcoholDrug.illicitDrugs,
      // Sexuality
      form.sexuality.intimateRelationship,
      // Family/Transport
      form.familyTransportation.familyNearby, form.familyTransportation.familyStrained, form.familyTransportation.transportNeed,
      // Academic
      form.academic.enrolledSchool,
      // Employment
      form.employment.currentlyWork,
      // SNAP
      form.snap.strengths, form.snap.needs, form.snap.goals, form.snap.dla20, form.snap.level1Measure,
      // Signature
      form.signature.completedBy, form.signature.prpVisits,
    ];
    const filled = fields.filter(f => f !== '' && f !== false && f !== undefined).length;
    return Math.round((filled / fields.length) * 100);
  }, [form]);
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PRPAssessmentPage() {
  const { user, loading } = useAuth();
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [toast, setToast] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  useEffect(() => {
    const d = loadPrpDraft();
    setDraft(d);
    if (d?.clientId && (d.stage === 'enrolled' || d.stage === 'referral')) {
      const client = DEMO_CLIENTS.find(c => c.id === d.clientId);
      if (client && client.id) {
        setForm(f => f.patientInfo.clientId ? f : ({ ...f, patientInfo: { ...f.patientInfo, clientId: client.id, patientName: client.name, dob: client.dob } }));
        setToast('Prefilled from ' + (d.stage === 'enrolled' ? 'enrollment' : 'referral') + ' — ' + client.name);
        setTimeout(() => setToast(null), 3500);
      }
    }
  }, []);
  const progress = useProgress(form);

  // Typed setters
  const setPatientInfo = useCallback(<K extends keyof FormState['patientInfo']>(key: K, val: FormState['patientInfo'][K]) => {
    setForm(f => ({ ...f, patientInfo: { ...f.patientInfo, [key]: val } }));
  }, []);
  const setMedHealth = useCallback(<K extends keyof FormState['medicalHealth']>(key: K, val: FormState['medicalHealth'][K]) => {
    setForm(f => ({ ...f, medicalHealth: { ...f.medicalHealth, [key]: val } }));
  }, []);
  const setHousing = useCallback(<K extends keyof FormState['housing']>(key: K, val: FormState['housing'][K]) => {
    setForm(f => ({ ...f, housing: { ...f.housing, [key]: val } }));
  }, []);
  const setComm = useCallback(<K extends keyof FormState['communication']>(key: K, val: FormState['communication'][K]) => {
    setForm(f => ({ ...f, communication: { ...f.communication, [key]: val } }));
  }, []);
  const setSocial = useCallback(<K extends keyof FormState['socialRecreational']>(key: K, val: FormState['socialRecreational'][K]) => {
    setForm(f => ({ ...f, socialRecreational: { ...f.socialRecreational, [key]: val } }));
  }, []);
  const setSafety = useCallback(<K extends keyof FormState['safety']>(key: K, val: FormState['safety'][K]) => {
    setForm(f => ({ ...f, safety: { ...f.safety, [key]: val } }));
  }, []);
  const setLegal = useCallback(<K extends keyof FormState['legal']>(key: K, val: FormState['legal'][K]) => {
    setForm(f => ({ ...f, legal: { ...f.legal, [key]: val } }));
  }, []);
  const setAlcohol = useCallback(<K extends keyof FormState['alcoholDrug']>(key: K, val: FormState['alcoholDrug'][K]) => {
    setForm(f => ({ ...f, alcoholDrug: { ...f.alcoholDrug, [key]: val } }));
  }, []);
  const setSexuality = useCallback(<K extends keyof FormState['sexuality']>(key: K, val: FormState['sexuality'][K]) => {
    setForm(f => ({ ...f, sexuality: { ...f.sexuality, [key]: val } }));
  }, []);
  const setFamily = useCallback(<K extends keyof FormState['familyTransportation']>(key: K, val: FormState['familyTransportation'][K]) => {
    setForm(f => ({ ...f, familyTransportation: { ...f.familyTransportation, [key]: val } }));
  }, []);
  const setAcademic = useCallback(<K extends keyof FormState['academic']>(key: K, val: FormState['academic'][K]) => {
    setForm(f => ({ ...f, academic: { ...f.academic, [key]: val } }));
  }, []);
  const setEmployment = useCallback(<K extends keyof FormState['employment']>(key: K, val: FormState['employment'][K]) => {
    setForm(f => ({ ...f, employment: { ...f.employment, [key]: val } }));
  }, []);
  const setSnap = useCallback(<K extends keyof FormState['snap']>(key: K, val: FormState['snap'][K]) => {
    setForm(f => ({ ...f, snap: { ...f.snap, [key]: val } }));
  }, []);
  const setSig = useCallback(<K extends keyof FormState['signature']>(key: K, val: FormState['signature'][K]) => {
    setForm(f => ({ ...f, signature: { ...f.signature, [key]: val } }));
  }, []);

  // Medication table
  const updateMed = (idx: number, field: keyof MedRow, val: string) => {
    setForm(f => {
      const meds = [...f.medicalHealth.medications];
      meds[idx] = { ...meds[idx], [field]: val };
      return { ...f, medicalHealth: { ...f.medicalHealth, medications: meds } };
    });
  };
  const addMedRow = () => {
    setForm(f => ({ ...f, medicalHealth: { ...f.medicalHealth, medications: [...f.medicalHealth.medications, { ...EMPTY_MED }] } }));
  };
  const removeMedRow = (idx: number) => {
    setForm(f => {
      const meds = f.medicalHealth.medications.filter((_, i) => i !== idx);
      return { ...f, medicalHealth: { ...f.medicalHealth, medications: meds.length ? meds : [{ ...EMPTY_MED }] } };
    });
  };

  // Rehab needs
  const updateRehabNeed = (need: string, field: 'checked' | 'comment', val: boolean | string) => {
    setForm(f => ({
      ...f,
      rehabNeeds: { ...f.rehabNeeds, [need]: { ...f.rehabNeeds[need], [field]: val } },
    }));
  };

  // Client selector
  const handleClientSelect = (id: string) => {
    const client = DEMO_CLIENTS.find(c => c.id === id);
    if (!client) return;
    setForm(f => ({
      ...f,
      patientInfo: { ...f.patientInfo, clientId: id, patientName: client.name, dob: client.dob },
    }));
  };

  // Save handlers
  const handleSaveDraft = () => setToast('Draft saved successfully.');
  const handleComplete = () => {
    setSigned(true);
    savePrpDraft({ stage: 'assessed', clientId: form.patientInfo.clientId, clientName: form.patientInfo.patientName, clientDob: form.patientInfo.dob });
    setToast('Assessment completed and signed. Record saved to EHR.');
  };

  // Role gate
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <div key={d} className="w-2 h-2 rounded-full bg-purple-400 animate-bounce" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    );
  }

  if (user && !ALLOWED_ROLES.includes(user.role as typeof ALLOWED_ROLES[number])) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: '#EDE9F7' }}>
          <Lock size={24} style={{ color: '#5C2D91' }} />
        </div>
        <div className="text-center">
          <h2 className="font-bold text-slate-900 text-lg mb-1">Access Restricted</h2>
          <p className="text-slate-500 text-sm max-w-xs">
            PRP Comprehensive Assessments are available to PRP Specialists, Case Managers, and Practice Directors only.
          </p>
        </div>
      </div>
    );
  }

  const { patientInfo: pi, medicalHealth: mh, housing: ho, communication: co,
    socialRecreational: sr, safety: sa, legal: le, alcoholDrug: ad,
    sexuality: sx, familyTransportation: ft, academic: ac, employment: em,
    snap, signature: sig } = form;

  return (
    <div className="max-w-4xl mx-auto pb-20">
      {/* ── Sticky Progress Bar ──────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-0 py-3 -mx-6 px-6 mb-6 shadow-sm">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} style={{ color: '#5C2D91' }} />
            <span className="text-sm font-semibold text-slate-700">PRP Comprehensive Rehabilitation Assessment</span>
            {signed && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold text-green-700 bg-green-100 border border-green-200">
                <CheckCircle2 size={11} /> Signed
              </span>
            )}
          </div>
          <span className="text-xs font-bold" style={{ color: '#5C2D91' }}>{progress}% complete</span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, backgroundColor: '#5C2D91' }}
          />
        </div>
      </div>

      <PrpWorkflowBar current="assessment" draft={draft} />

      {/* ── Page Header ──────────────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">PRP Comprehensive Rehabilitation Assessment</h1>
        <p className="text-slate-500 text-sm mt-1">Psychiatric Rehabilitation Program — H2017 · {PRP_REG_LINE}</p>
      </div>

      {/* ── Client Selector ──────────────────────────────────────────────────── */}
      <div className="mb-6 p-4 bg-purple-50 border border-purple-200 rounded-xl flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2 shrink-0">
          <User size={16} style={{ color: '#5C2D91' }} />
          <span className="text-sm font-semibold text-purple-900">Select Client</span>
        </div>
        <div className="flex-1 min-w-[200px] relative">
          <select
            value={pi.clientId}
            onChange={e => handleClientSelect(e.target.value)}
            className="w-full pl-3 pr-8 py-2 text-sm border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 bg-white appearance-none"
          >
            {DEMO_CLIENTS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none" />
        </div>
        {pi.clientId && (
          <div className="flex items-center gap-2 text-xs text-purple-700">
            <Clock size={13} />
            <span>Assessment date: {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>
        )}
      </div>

      <div className="space-y-6">

        {/* ══ SECTION 1: Patient Information ══════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={User} title="Section 1: Patient Information" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label required>Patient Name</Label>
              <TextInput value={pi.patientName} onChange={v => setPatientInfo('patientName', v)} placeholder="Full legal name" />
            </div>
            <div>
              <Label required>Date of Birth</Label>
              <DateInput value={pi.dob} onChange={v => setPatientInfo('dob', v)} />
            </div>
            <div>
              <Label>MA# / Medicaid Number</Label>
              <TextInput value={pi.maNumber} onChange={v => setPatientInfo('maNumber', v)} placeholder="Medicaid ID" />
            </div>
            <div>
              <Label required>Gender</Label>
              <SelectInput
                value={pi.gender}
                onChange={v => setPatientInfo('gender', v)}
                placeholder="Select gender"
                options={[{ value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }]}
              />
            </div>
            <div>
              <Label required>Date of Assessment</Label>
              <DateInput value={pi.dateOfAssessment} onChange={v => setPatientInfo('dateOfAssessment', v)} />
            </div>
            <div>
              <Label required>Adult / Minor</Label>
              <div className="flex gap-2 mt-1">
                {['Adult', 'Minor'].map(opt => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setPatientInfo('adultMinor', pi.adultMinor === opt ? '' : opt)}
                    className={`px-5 py-2 rounded-full text-sm font-medium border transition-all ${pi.adultMinor === opt ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-300 hover:border-purple-400'}`}
                    style={pi.adultMinor === opt ? { backgroundColor: '#5C2D91', borderColor: '#5C2D91' } : {}}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {pi.adultMinor === 'Minor' && (
            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Accompanied By</Label>
                <TextInput value={pi.accompaniedBy} onChange={v => setPatientInfo('accompaniedBy', v)} placeholder="Guardian / parent name" />
              </div>
              <div>
                <Label>Relationship to Patient</Label>
                <TextInput value={pi.relationshipToPatient} onChange={v => setPatientInfo('relationshipToPatient', v)} placeholder="e.g. Mother, Legal Guardian" />
              </div>
            </div>
          )}
        </FormSection>

        {/* ══ SECTION 2: Medical & Behavioral Health ═════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Pill} title="Section 2: Medical & Behavioral Health" />

          {/* Medication Table */}
          <div className="mb-5">
            <Label>Current Medications</Label>
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    {['Medication Name', 'Strength', 'How Often', '% Time Taken as Prescribed'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {mh.medications.map((med, i) => (
                    <tr key={i} className="border-b border-slate-100 last:border-0">
                      {(['name', 'strength', 'frequency', 'compliance'] as const).map(field => (
                        <td key={field} className="px-2 py-1.5">
                          <input
                            type="text"
                            value={med[field]}
                            onChange={e => updateMed(i, field, e.target.value)}
                            placeholder={field === 'compliance' ? 'e.g. 90%' : '—'}
                            className="w-full px-2 py-1 text-sm border border-transparent rounded focus:border-purple-300 focus:ring-1 focus:ring-purple-200 focus:outline-none transition-all placeholder-slate-300 min-w-[100px]"
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <button onClick={() => removeMedRow(i)} className="p-1 rounded text-slate-300 hover:text-red-400 hover:bg-red-50 transition-colors">
                          <X size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addMedRow} className="mt-2 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-dashed border-purple-300 text-purple-700 hover:bg-purple-50 transition-colors">
              <Plus size={13} /> Add Medication Row
            </button>
          </div>

          <div className="space-y-1 divide-y divide-slate-50">
            <QuestionRow label="Does anyone help with medication schedule?" value={mh.helpWithMedication} onChange={v => setMedHealth('helpWithMedication', v)}>
              <ConditionalField show={mh.helpWithMedication === 'yes'}>
                <TextInput value={mh.helpWithMedicationWho} onChange={v => setMedHealth('helpWithMedicationWho', v)} placeholder="Who helps?" />
              </ConditionalField>
            </QuestionRow>
          </div>

          {/* Services checkboxes */}
          <div className="mt-4">
            <Label>Type of services currently receiving</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {(['individual', 'family', 'group', 'iop', 'methadone', 'other'] as const).map(svc => {
                const labels: Record<string, string> = { individual: 'Individual', family: 'Family', group: 'Group', iop: 'IOP', methadone: 'Methadone Clinic', other: 'Other' };
                return (
                  <label key={svc} className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm border cursor-pointer transition-all ${mh.servicesReceiving[svc] ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-300 hover:border-purple-400'}`}
                    style={mh.servicesReceiving[svc] ? { backgroundColor: '#5C2D91' } : {}}>
                    <input type="checkbox" className="sr-only" checked={mh.servicesReceiving[svc]}
                      onChange={e => setMedHealth('servicesReceiving', { ...mh.servicesReceiving, [svc]: e.target.checked })} />
                    {labels[svc]}
                  </label>
                );
              })}
            </div>
            {mh.servicesReceiving.other && (
              <div className="mt-2">
                <TextInput value={mh.servicesReceiving.otherText} onChange={v => setMedHealth('servicesReceiving', { ...mh.servicesReceiving, otherText: v })} placeholder="Specify other service" />
              </div>
            )}
          </div>

          <div className="mt-4 space-y-3">
            <div>
              <Label>Treatment History</Label>
              <Textarea value={mh.treatmentHistory} onChange={v => setMedHealth('treatmentHistory', v)} placeholder="Prior hospitalizations, programs, providers..." rows={3} />
            </div>
            <QuestionRow label="Any health concerns, allergies, neurological disorders, or communicable diseases?" value={mh.healthConcerns} onChange={v => setMedHealth('healthConcerns', v)}>
              <ConditionalField show={mh.healthConcerns === 'yes'}>
                <Textarea value={mh.healthConcernsExplain} onChange={v => setMedHealth('healthConcernsExplain', v)} placeholder="Describe concerns..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Currently pregnant?" value={mh.pregnant} onChange={v => setMedHealth('pregnant', v)} withNA yesLabels={{ na: 'N/A' }}>
              <ConditionalField show={mh.pregnant === 'yes'}>
                <div>
                  <Label>Estimated Due Date</Label>
                  <DateInput value={mh.pregnantDueDate} onChange={v => setMedHealth('pregnantDueDate', v)} />
                </div>
              </ConditionalField>
            </QuestionRow>
            <div>
              <Label>Adaptive equipment or resources needed</Label>
              <Textarea value={mh.adaptiveEquipment} onChange={v => setMedHealth('adaptiveEquipment', v)} placeholder="Describe any equipment or accommodations needed..." rows={2} />
            </div>
          </div>
        </FormSection>

        {/* ══ SECTION 3: Housing ══════════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Home} title="Section 3: Housing" />
          <div className="space-y-1">
            <QuestionRow label="Managing safe and affordable housing?" value={ho.managingSafeHousing} onChange={v => setHousing('managingSafeHousing', v)}>
              <ConditionalField show={ho.managingSafeHousing === 'yes'}>
                <TextInput value={ho.housingSafeType} onChange={v => setHousing('housingSafeType', v)} placeholder="Type of housing (apartment, house, shelter, etc.)" />
              </ConditionalField>
              <ConditionalField show={ho.managingSafeHousing === 'no'}>
                <Textarea value={ho.housingUnsafeExplain} onChange={v => setHousing('housingUnsafeExplain', v)} placeholder="Explain housing situation..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Does this housing meet your needs?" value={ho.meetNeeds} onChange={v => setHousing('meetNeeds', v)}>
              <ConditionalField show={ho.meetNeeds === 'no'}>
                <Textarea value={ho.meetNeedsExplain} onChange={v => setHousing('meetNeedsExplain', v)} placeholder="Explain unmet housing needs..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <div className="py-3 border-b border-slate-50">
              <Label>Who else lives with you?</Label>
              <TextInput value={ho.whoLivesWith} onChange={v => setHousing('whoLivesWith', v)} placeholder="List household members and relationship" />
            </div>
            <QuestionRow label="Routinely completes housekeeping?" value={ho.housekeeping} onChange={v => setHousing('housekeeping', v)} yesLabels={{ no: 'Needs Assistance' }} />
            <QuestionRow label="Can perform basic environmental and personal hygiene independently?" value={ho.basicHygiene} onChange={v => setHousing('basicHygiene', v)}>
              <ConditionalField show={ho.basicHygiene === 'no'}>
                <Textarea value={ho.basicHygieneExplain} onChange={v => setHousing('basicHygieneExplain', v)} placeholder="Explain hygiene barriers..." rows={2} />
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 4: Communication ════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={MessageCircle} title="Section 4: Communication" />
          <div className="space-y-1">
            <QuestionRow label="Difficulty expressing thoughts or feelings?" value={co.difficultyExpressing} onChange={v => setComm('difficultyExpressing', v)}>
              <ConditionalField show={co.difficultyExpressing === 'yes'}>
                <Textarea value={co.difficultyExplain} onChange={v => setComm('difficultyExplain', v)} placeholder="Describe communication difficulties..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Ever feel isolated from others?" value={co.feelIsolated} onChange={v => setComm('feelIsolated', v)} />
            <QuestionRow label="Can make decisions easily when faced with problems?" value={co.makeDecisions} onChange={v => setComm('makeDecisions', v)}>
              <ConditionalField show={co.makeDecisions === 'no'}>
                <Textarea value={co.makeDecisionsExplain} onChange={v => setComm('makeDecisionsExplain', v)} placeholder="Describe decision-making barriers..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="History of trauma (abuse, neglect, violence, sexual assault)?" value={co.traumaHistory} onChange={v => setComm('traumaHistory', v)}>
              <ConditionalField show={co.traumaHistory === 'yes'}>
                <Textarea value={co.traumaExplain} onChange={v => setComm('traumaExplain', v)} placeholder="Describe trauma history (as client chooses to share)..." rows={3} />
              </ConditionalField>
            </QuestionRow>
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4">
            <div>
              <Label>List of Current Medications</Label>
              <Textarea value={co.currentMedsList} onChange={v => setComm('currentMedsList', v)} placeholder="List medications currently prescribed..." rows={2} />
            </div>
            <div>
              <Label>List of Past Medications</Label>
              <Textarea value={co.pastMedsList} onChange={v => setComm('pastMedsList', v)} placeholder="List previously used medications..." rows={2} />
            </div>
            <div>
              <Label>Efficacy of Past and Present Medications</Label>
              <Textarea value={co.medicationEfficacy} onChange={v => setComm('medicationEfficacy', v)} placeholder="How effective have medications been?" rows={2} />
            </div>
            <div>
              <Label>Spiritual Beliefs</Label>
              <Textarea value={co.spiritualBeliefs} onChange={v => setComm('spiritualBeliefs', v)} placeholder="Describe spiritual or religious beliefs..." rows={2} />
            </div>
          </div>
        </FormSection>

        {/* ══ SECTION 5: Social / Recreational ═══════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Users} title="Section 5: Social / Recreational" />

          <div className="mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Social Functioning</p>
            <div className="space-y-1">
              <QuestionRow label="Prefers to be alone?" value={sr.prefersAlone} onChange={v => setSocial('prefersAlone', v)} />
              <QuestionRow label="Understands clearly what others tell them?" value={sr.understandsOthers} onChange={v => setSocial('understandsOthers', v)} />
              <QuestionRow label="Gets along well with others?" value={sr.getsAlongOthers} onChange={v => setSocial('getsAlongOthers', v)} />
              <QuestionRow label="Interacts well with family members?" value={sr.interactsFamily} onChange={v => setSocial('interactsFamily', v)} />
              <QuestionRow label="Interacts well with teachers (if applicable)?" value={sr.interactsTeachers} onChange={v => setSocial('interactsTeachers', v)} withNA />
            </div>
          </div>

          <div className="space-y-1">
            <QuestionRow label="Currently involved in church, support groups, or community activities?" value={sr.churchActivities} onChange={v => setSocial('churchActivities', v)}>
              <ConditionalField show={sr.churchActivities === 'yes'}>
                <TextInput value={sr.churchActivitiesWhat} onChange={v => setSocial('churchActivitiesWhat', v)} placeholder="Describe activities and organizations..." />
              </ConditionalField>
            </QuestionRow>
            <div className="py-3">
              <Label>List Leisure Activities</Label>
              <Textarea value={sr.leisureActivities} onChange={v => setSocial('leisureActivities', v)} placeholder="Hobbies, sports, creative outlets..." rows={2} />
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Managing Time and Money</p>
            <div className="space-y-1">
              <QuestionRow label="Has a daily routine?" value={sr.hasDailyRoutine} onChange={v => setSocial('hasDailyRoutine', v)} />
              <QuestionRow label="Trouble concentrating?" value={sr.troubleConcentrating} onChange={v => setSocial('troubleConcentrating', v)} />
              <QuestionRow label="Trouble falling or staying asleep?" value={sr.troubleSleeping} onChange={v => setSocial('troubleSleeping', v)} />
              <QuestionRow label="Has a regular income?" value={sr.regularIncome} onChange={v => setSocial('regularIncome', v)}>
                <ConditionalField show={sr.regularIncome === 'yes'}>
                  <TextInput value={sr.incomeSource} onChange={v => setSocial('incomeSource', v)} placeholder="Source of income (SSI, SSDI, employment, etc.)" />
                </ConditionalField>
              </QuestionRow>
              <QuestionRow label="Routinely meets monthly expenses?" value={sr.meetsMonthlyExpenses} onChange={v => setSocial('meetsMonthlyExpenses', v)} withNA yesLabels={{ na: 'Receives Assistance' }} />
              <QuestionRow label="Able to meet basic needs of food, shelter, and clothing?" value={sr.meetsBasicNeeds} onChange={v => setSocial('meetsBasicNeeds', v)}>
                <ConditionalField show={sr.meetsBasicNeeds === 'no'}>
                  <Textarea value={sr.basicNeedsExplain} onChange={v => setSocial('basicNeedsExplain', v)} placeholder="Describe immediate unmet needs..." rows={2} />
                </ConditionalField>
              </QuestionRow>
              <QuestionRow label="Often spends money on things later regretted?" value={sr.spendsRegret} onChange={v => setSocial('spendsRegret', v)} />
              <QuestionRow label="Does grocery shopping and cooking on own?" value={sr.groceryCooking} onChange={v => setSocial('groceryCooking', v)} />
            </div>
          </div>
        </FormSection>

        {/* ══ SECTION 6: Safety ═══════════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Shield} title="Section 6: Safety" subtitle="HIPAA Sensitive — Complete fully for all clients" />

          <div className="p-3 mb-4 rounded-lg bg-amber-50 border border-amber-200 flex gap-2 text-xs text-amber-800">
            <AlertTriangle size={14} className="shrink-0 mt-0.5 text-amber-600" />
            <span>If client reports active suicidal ideation with plan and means, complete a Safety Plan immediately and notify supervisor. Direct client to call 988 (Suicide &amp; Crisis Lifeline).</span>
          </div>

          <div className="space-y-1">
            <QuestionRow label="Difficulties keeping safe in the community?" value={sa.difficultiesSafe} onChange={v => setSafety('difficultiesSafe', v)}>
              <ConditionalField show={sa.difficultiesSafe === 'yes'}>
                <Textarea value={sa.difficultiesSafeExplain} onChange={v => setSafety('difficultiesSafeExplain', v)} placeholder="Describe safety concerns..." rows={2} />
              </ConditionalField>
            </QuestionRow>

            <QuestionRow label="In the past 30 days, thought about harming yourself or others?" value={sa.harmThoughts} onChange={v => setSafety('harmThoughts', v)}>
              <ConditionalField show={sa.harmThoughts === 'yes'}>
                <div className="space-y-3 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div>
                    <p className="text-xs font-semibold text-red-700 mb-2">Follow-up required when answer is Yes:</p>
                  </div>
                  <QuestionRow label="Thought about ending your life?" value={sa.lifeThoughts} onChange={v => setSafety('lifeThoughts', v)} />
                  <div>
                    <Label>Describe thoughts</Label>
                    <Textarea value={sa.harmExplain} onChange={v => setSafety('harmExplain', v)} placeholder="Client's own words about thoughts of harm..." rows={2} />
                  </div>
                  <QuestionRow label="Planned how to carry this out?" value={sa.plannedHow} onChange={v => setSafety('plannedHow', v)} yesLabels={{ yes: 'Yes — Complete Safety Plan' }}>
                    <ConditionalField show={sa.plannedHow === 'yes'}>
                      <Textarea value={sa.plannedExplain} onChange={v => setSafety('plannedExplain', v)} placeholder="Describe the plan..." rows={2} />
                    </ConditionalField>
                  </QuestionRow>
                  <QuestionRow label="Has means to carry this out?" value={sa.hasMeans} onChange={v => setSafety('hasMeans', v)} />
                </div>
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 7: Legal Status ═════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Scale} title="Section 7: Legal Status" />
          <div className="space-y-1">
            <QuestionRow label="Currently on probation?" value={le.onProbation} onChange={v => setLegal('onProbation', v)} />
            <QuestionRow label="Negative encounters with law enforcement?" value={le.negativeEncounters} onChange={v => setLegal('negativeEncounters', v)} />
            <QuestionRow label="Arrested in the past 30 days?" value={le.arrestedPast30} onChange={v => setLegal('arrestedPast30', v)} />
            <QuestionRow label="Custody order or custody agreement?" value={le.custodyOrder} onChange={v => setLegal('custodyOrder', v)} />
            <QuestionRow label="Involvement with DSS, DJS, or Drug Court?" value={le.dssInvolvement} onChange={v => setLegal('dssInvolvement', v)} />
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <Label>Summarize most recent legal history</Label>
              <Textarea value={le.legalHistory} onChange={v => setLegal('legalHistory', v)} placeholder="Charges, court dates, legal supervision..." rows={3} />
            </div>
            <QuestionRow label="Behaviors potentially dangerous to patient or others?" value={le.dangerousBehaviors} onChange={v => setLegal('dangerousBehaviors', v)}>
              <ConditionalField show={le.dangerousBehaviors === 'yes'}>
                <Textarea value={le.dangerousExplain} onChange={v => setLegal('dangerousExplain', v)} placeholder="Describe dangerous behaviors..." rows={2} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Physical, sexual, or emotional abuse experienced or witnessed?" value={le.abuseExperience} onChange={v => setLegal('abuseExperience', v)} yesLabels={{ no: 'None Disclosed' }} />
          </div>
        </FormSection>

        {/* ══ SECTION 8: Alcohol / Drug Use ══════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Wine} title="Section 8: Alcohol / Drug Use" />
          <div className="space-y-1">
            <QuestionRow label="Do you smoke?" value={ad.smokes} onChange={v => setAlcohol('smokes', v)} />
            <div className="py-3 border-b border-slate-50">
              <Label>Number of alcoholic drinks consumed in past 7 days</Label>
              <input
                type="number"
                min="0"
                value={ad.alcoholDrinks}
                onChange={e => setAlcohol('alcoholDrinks', e.target.value)}
                placeholder="0"
                className="w-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 transition-all"
              />
            </div>
            <QuestionRow label="Used illicit drugs or misused prescription drugs recently?" value={ad.illicitDrugs} onChange={v => setAlcohol('illicitDrugs', v)}>
              <ConditionalField show={ad.illicitDrugs === 'yes'}>
                <Textarea value={ad.drugsExplain} onChange={v => setAlcohol('drugsExplain', v)} placeholder="Substances used, frequency, route..." rows={2} />
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 9: Sexuality ════════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Heart} title="Section 9: Sexuality" subtitle="This section is optional — complete only if clinically relevant" />
          <div className="p-2.5 mb-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
            This section is optional. Client may decline to answer any or all questions. Document refusal in clinical notes if applicable.
          </div>
          <div className="space-y-1">
            <QuestionRow label="Currently in a sexually intimate relationship?" value={sx.intimateRelationship} onChange={v => setSexuality('intimateRelationship', v)}>
              <ConditionalField show={sx.intimateRelationship === 'yes'}>
                <div className="space-y-3">
                  <QuestionRow label="Concerns about intimate relationships and sexual health?" value={sx.relationshipConcerns} onChange={v => setSexuality('relationshipConcerns', v)}>
                    <ConditionalField show={sx.relationshipConcerns === 'yes'}>
                      <Textarea value={sx.concernsWhat} onChange={v => setSexuality('concernsWhat', v)} placeholder="Describe concerns..." rows={2} />
                    </ConditionalField>
                  </QuestionRow>
                  <QuestionRow label="Do medications affect sexual health?" value={sx.medicationsAffect} onChange={v => setSexuality('medicationsAffect', v)}>
                    <ConditionalField show={sx.medicationsAffect === 'yes'}>
                      <Textarea value={sx.medicationConcerns} onChange={v => setSexuality('medicationConcerns', v)} placeholder="Describe concerns..." rows={2} />
                    </ConditionalField>
                  </QuestionRow>
                  <QuestionRow label="Practice safe sex?" value={sx.safeSex} onChange={v => setSexuality('safeSex', v)} />
                  <QuestionRow label="Use birth control?" value={sx.birthControl} onChange={v => setSexuality('birthControl', v)} withNA />
                </div>
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 10: Family History & Transportation ═════════════════════ */}
        <FormSection>
          <SectionHeader icon={Users} title="Section 10: Family History & Transportation" />
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label>Presenting Needs</Label>
              <Textarea value={ft.presentingNeeds} onChange={v => setFamily('presentingNeeds', v)} placeholder="What brings the client to PRP services?" rows={2} />
            </div>
            <div>
              <Label>Moments of Depression</Label>
              <Textarea value={ft.depression} onChange={v => setFamily('depression', v)} placeholder="Describe depression experiences..." rows={2} />
            </div>
            <div>
              <Label>Impact of Spiritual Beliefs on Treatment</Label>
              <Textarea value={ft.spiritualImpact} onChange={v => setFamily('spiritualImpact', v)} placeholder="How do spiritual beliefs influence care?" rows={2} />
            </div>
            <div>
              <Label>Impact of Cultural Beliefs on Treatment</Label>
              <Textarea value={ft.culturalImpact} onChange={v => setFamily('culturalImpact', v)} placeholder="Cultural considerations for treatment planning..." rows={2} />
            </div>
          </div>
          <div className="mt-4 space-y-1">
            <QuestionRow label="Family members nearby providing support?" value={ft.familyNearby} onChange={v => setFamily('familyNearby', v)}>
              <ConditionalField show={ft.familyNearby === 'yes'}>
                <TextInput value={ft.familyWho} onChange={v => setFamily('familyWho', v)} placeholder="Who provides support and their relationship..." />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Relationships with immediate family strained?" value={ft.familyStrained} onChange={v => setFamily('familyStrained', v)} />
          </div>
          <div className="mt-4 space-y-4">
            <div>
              <Label>Family / Peer Support Summary</Label>
              <Textarea value={ft.familyPeerSummary} onChange={v => setFamily('familyPeerSummary', v)} placeholder="Summarize family and peer support network..." rows={3} />
            </div>
            <QuestionRow label="Need transportation assistance to attend services?" value={ft.transportNeed} onChange={v => setFamily('transportNeed', v)}>
              <ConditionalField show={ft.transportNeed === 'no'}>
                <TextInput value={ft.transportMeans} onChange={v => setFamily('transportMeans', v)} placeholder="Primary means of transportation (car, bus, rideshare, etc.)" />
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 11: Academic Achievement ═══════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={GraduationCap} title="Section 11: Academic Achievement" />
          <div className="space-y-1">
            <QuestionRow label="Currently enrolled in school?" value={ac.enrolledSchool} onChange={v => setAcademic('enrolledSchool', v)} withNA yesLabels={{ na: 'N/A' }}>
              <ConditionalField show={ac.enrolledSchool === 'yes'}>
                <div className="space-y-3">
                  <QuestionRow label="Attends school regularly?" value={ac.attendsRegularly} onChange={v => setAcademic('attendsRegularly', v)} />
                  <QuestionRow label="Has a current or former IEP?" value={ac.hasIEP} onChange={v => setAcademic('hasIEP', v)} />
                  <QuestionRow label="Completes homework?" value={ac.completesHomework} onChange={v => setAcademic('completesHomework', v)} />
                  <QuestionRow label="Completes tasks?" value={ac.completesTasks} onChange={v => setAcademic('completesTasks', v)} />
                  <QuestionRow label="Follows directions?" value={ac.followsDirections} onChange={v => setAcademic('followsDirections', v)} />
                  <QuestionRow label="Works independently?" value={ac.worksIndependently} onChange={v => setAcademic('worksIndependently', v)} />
                  <QuestionRow label="Can read and write?" value={ac.canReadWrite} onChange={v => setAcademic('canReadWrite', v)} />
                  <QuestionRow label="Has a learning disability?" value={ac.learningDisability} onChange={v => setAcademic('learningDisability', v)}>
                    <ConditionalField show={ac.learningDisability === 'yes'}>
                      <TextInput value={ac.disabilityDescribe} onChange={v => setAcademic('disabilityDescribe', v)} placeholder="Describe learning disability..." />
                    </ConditionalField>
                  </QuestionRow>
                  <QuestionRow label="Ever suspended or expelled?" value={ac.suspendedExpelled} onChange={v => setAcademic('suspendedExpelled', v)}>
                    <ConditionalField show={ac.suspendedExpelled === 'yes'}>
                      <TextInput value={ac.suspendedWhen} onChange={v => setAcademic('suspendedWhen', v)} placeholder="When and why?" />
                    </ConditionalField>
                  </QuestionRow>
                  <div>
                    <Label>School Name</Label>
                    <TextInput value={ac.schoolName} onChange={v => setAcademic('schoolName', v)} placeholder="Name of school currently attending" />
                  </div>
                </div>
              </ConditionalField>
            </QuestionRow>
            <div className="py-3">
              <Label>Current Educational Level</Label>
              <SelectInput
                value={ac.educationLevel}
                onChange={v => setAcademic('educationLevel', v)}
                placeholder="Select educational level"
                options={EDUCATION_LEVELS.map(l => ({ value: l, label: l }))}
              />
            </div>
          </div>
        </FormSection>

        {/* ══ SECTION 12: Employment ══════════════════════════════════════════ */}
        <FormSection>
          <SectionHeader icon={Briefcase} title="Section 12: Employment" />
          <div className="space-y-1">
            <QuestionRow label="Currently working?" value={em.currentlyWork} onChange={v => setEmployment('currentlyWork', v)}>
              <ConditionalField show={em.currentlyWork === 'no'}>
                <QuestionRow label="Expect to return to work?" value={em.expectReturn} onChange={v => setEmployment('expectReturn', v)} />
              </ConditionalField>
            </QuestionRow>
            <QuestionRow label="Would like assistance with vocational training?" value={em.vocationTraining} onChange={v => setEmployment('vocationTraining', v)}>
              <ConditionalField show={em.vocationTraining === 'yes'}>
                <TextInput value={em.vocationProgram} onChange={v => setEmployment('vocationProgram', v)} placeholder="Which vocational program (DORS, Ticket to Work, etc.)?" />
              </ConditionalField>
            </QuestionRow>
          </div>
        </FormSection>

        {/* ══ SECTION 13: SNAP / Clinical Interpretive Summary ════════════════ */}
        <FormSection>
          <SectionHeader icon={Brain} title="Section 13: SNAP / Clinical Interpretive Summary" subtitle="Strengths, Needs, Abilities, Preferences" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <Label>Strengths (as stated by patient)</Label>
              <Textarea value={snap.strengths} onChange={v => setSnap('strengths', v)} placeholder="What does the client identify as their strengths?" rows={3} />
            </div>
            <div>
              <Label>Needs (as stated by patient)</Label>
              <Textarea value={snap.needs} onChange={v => setSnap('needs', v)} placeholder="What does the client identify as their needs?" rows={3} />
            </div>
            <div>
              <Label>Abilities (as stated by patient)</Label>
              <Textarea value={snap.abilities} onChange={v => setSnap('abilities', v)} placeholder="What can the client do well?" rows={3} />
            </div>
            <div>
              <Label>Preferences (as stated by patient)</Label>
              <Textarea value={snap.preferences} onChange={v => setSnap('preferences', v)} placeholder="Client's preferences for services and supports" rows={3} />
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <Label>Patient&apos;s Goals While in Program</Label>
              <Textarea value={snap.goals} onChange={v => setSnap('goals', v)} placeholder="What does the client hope to achieve in PRP?" rows={3} />
            </div>
            <div>
              <Label>Factors That May Challenge Rehabilitation</Label>
              <Textarea value={snap.challenges} onChange={v => setSnap('challenges', v)} placeholder="Barriers, risk factors, or challenges to treatment engagement..." rows={3} />
            </div>
            <div>
              <Label>Professional&apos;s Interpretive Summary</Label>
              <Textarea value={snap.interpreSummary} onChange={v => setSnap('interpreSummary', v)} placeholder="Clinician's clinical interpretation of assessment findings, prognosis, and treatment recommendations..." rows={5} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100">
              <QuestionRow label="DLA-20 completed?" value={snap.dla20} onChange={v => setSnap('dla20', v)} withNA yesLabels={{ na: 'Not Applicable' }} />
              <QuestionRow label="Level 1 Cross-Cutting Symptom Measure completed?" value={snap.level1Measure} onChange={v => setSnap('level1Measure', v)} withNA yesLabels={{ na: 'Not Applicable' }} />
            </div>
          </div>
        </FormSection>

        {/* ══ SECTION 14: Rehabilitation Needs Table ══════════════════════════ */}
        <FormSection>
          <SectionHeader icon={ClipboardList} title="Section 14: Rehabilitation Needs" subtitle="Check all identified needs and add comments" />
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 w-6">
                    <span className="sr-only">Selected</span>
                  </th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Need Area</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-600">Comments</th>
                </tr>
              </thead>
              <tbody>
                {REHAB_NEEDS_LIST.map(need => {
                  const row = form.rehabNeeds[need];
                  return (
                    <tr key={need} className={`border-b border-slate-100 last:border-0 transition-colors ${row.checked ? 'bg-purple-50/40' : ''}`}>
                      <td className="px-4 py-2.5">
                        <button
                          type="button"
                          onClick={() => updateRehabNeed(need, 'checked', !row.checked)}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${row.checked ? 'border-transparent' : 'border-slate-300 bg-white hover:border-purple-400'}`}
                          style={row.checked ? { backgroundColor: '#5C2D91', borderColor: '#5C2D91' } : {}}
                        >
                          {row.checked && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                        </button>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-sm ${row.checked ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>{need}</span>
                      </td>
                      <td className="px-3 py-2 w-1/2">
                        <input
                          type="text"
                          value={row.comment}
                          onChange={e => updateRehabNeed(need, 'comment', e.target.value)}
                          placeholder="Add comments..."
                          className="w-full px-2 py-1 text-sm border border-transparent rounded focus:border-purple-300 focus:ring-1 focus:ring-purple-200 focus:outline-none transition-all placeholder-slate-300"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* PRP Visit Frequency */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-3">
              <Label>PRP Visits Recommended</Label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={sig.prpVisits}
                  onChange={e => setSig('prpVisits', e.target.value)}
                  placeholder="—"
                  className="w-20 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 text-center"
                />
                <span className="text-sm text-slate-600">times per month</span>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Assessment Completed By</p>
              <div>
                <Label>Name</Label>
                <TextInput value={sig.completedBy} onChange={v => setSig('completedBy', v)} placeholder="Full name and credentials" />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setSig('completedSigned', !sig.completedSigned)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${sig.completedSigned ? 'border-transparent' : 'border-slate-300 bg-white'}`}
                    style={sig.completedSigned ? { backgroundColor: '#5C2D91', borderColor: '#5C2D91' } : {}}
                  >
                    {sig.completedSigned && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <span className="text-sm text-slate-700">Signature attested</span>
                </label>
              </div>
              <div>
                <Label>Date</Label>
                <DateInput value={sig.completedDate} onChange={v => setSig('completedDate', v)} />
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Supervisor Review</p>
              <div>
                <Label>Supervisor Name</Label>
                <TextInput value={sig.supervisor} onChange={v => setSig('supervisor', v)} placeholder="Supervisor name and credentials" />
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <div
                    onClick={() => setSig('supervisorSigned', !sig.supervisorSigned)}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all cursor-pointer ${sig.supervisorSigned ? 'border-transparent' : 'border-slate-300 bg-white'}`}
                    style={sig.supervisorSigned ? { backgroundColor: '#5C2D91', borderColor: '#5C2D91' } : {}}
                  >
                    {sig.supervisorSigned && <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 5L4.5 7.5L8 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <span className="text-sm text-slate-700">Supervisor signature attested</span>
                </label>
              </div>
              <div>
                <Label>Date</Label>
                <DateInput value={sig.supervisorDate} onChange={v => setSig('supervisorDate', v)} />
              </div>
            </div>
          </div>
        </FormSection>

      </div>{/* end sections */}

      {/* ── Action Bar ────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200 px-6 py-3.5 flex items-center justify-between gap-4 shadow-lg lg:pl-64">
        <div className="text-xs text-slate-500">
          {pi.patientName ? (
            <span>Client: <span className="font-semibold text-slate-700">{pi.patientName}</span></span>
          ) : (
            <span className="text-slate-400">No client selected</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveDraft}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-all"
          >
            <Save size={15} />
            Save Draft
          </button>
          <button
            type="button"
            onClick={handleComplete}
            disabled={signed}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ backgroundColor: signed ? '#7c3aed' : '#5C2D91' }}
          >
            <CheckCircle2 size={15} />
            {signed ? 'Assessment Signed' : 'Complete & Sign'}
          </button>
        </div>
      </div>

      {/* ── Toast ─────────────────────────────────────────────────────────────── */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </div>
  );
}
