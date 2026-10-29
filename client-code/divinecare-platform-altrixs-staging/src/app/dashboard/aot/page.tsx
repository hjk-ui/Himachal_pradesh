'use client';

import React, { useState, useEffect } from 'react';
import {
  Gavel,
  Users,
  User,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Shield,
  ShieldAlert,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  XCircle,
  Clock,
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Bot,
  Inbox,
  Hospital,
  BadgeCheck,
  Flag,
  PenLine,
  HeartPulse,
  Landmark,
  Stethoscope,
  Printer,
  Save,
  Info,
  Mail,
  Phone,
  Check, ArrowRight, ArrowUp,
} from 'lucide-react';
import AotFormsWorkspace from '@/components/aot/AotFormsWorkspace';
import PetitionChecklist from '@/components/aot/PetitionChecklist';
import {
  MARYLAND_JURISDICTIONS,
  MDH_988_TEXT,
  MDH_AFFIDAVIT_TIMING_CAVEAT,
  MDH_AFFIDAVIT_TIMING_TEXT,
  MDH_AOT_EMAIL,
  MDH_AOT_QUESTIONS_TEXT,
  MDH_PARTICIPANT_TEXT,
  MDH_PETITIONER_TEXT,
  NO_CCT_NOTE,
  PETITIONER_ADULT_ATTESTATION,
  PETITIONER_TYPES,
  countyRecorded,
  hasOperationalCct,
  maxOrderEnd,
  orderTermProblem,
  personLabel,
  petitionChecklistFlags,
  petitionerProblems,
  petitionerTypeLabel,
  type ChecklistFlag,
  type PetitionChecklist as PetitionChecklistState,
} from '@/lib/aot/mdh';
import { COMPLAINT_SUBMIT_TO } from '@/lib/aot/forms/complaint';
import { Alert, Button, buttonClasses, Card, EmptyState, LoadingState, Page, PageHeader, StatCard, StatGrid, Tabs, type Tone } from '@/components/ui';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AotStatus = 'referral' | 'screening' | 'petition' | 'hearing' | 'active' | 'renewal' | 'stepdown';

type FlagStatus = 'overdue' | 'due' | 'upcoming' | 'done';

interface Deadline {
  id: string;
  label: string;
  due: string;
  daysLeft: number; // negative = overdue
  status: FlagStatus;
  basis: string; // statutory / program basis
}

interface TeamMember {
  role: string;
  name: string;
  cadence: string;
  lastContact: string;
  nextDue: string;
  status: 'current' | 'due' | 'overdue';
}

interface NonAdherenceEvent {
  date: string;
  event: string;
  action: string;
}

interface Participant {
  id: string;
  name: string;
  age: number | null;
  status: AotStatus;
  county: string;
  referralSource: string;
  diagnosis: string;
  petitionDate?: string;
  hearingDate?: string;
  orderStart?: string;
  orderEnd?: string;
  deadlines: Deadline[];
  team: TeamMember[];
  nonAdherence: NonAdherenceEvent[];
  contactLog: { date: string; who: string; mode: string; note: string }[];
  /** MDH form deadlines computed by the caseboard API (never stored in deadlines) */
  formFlags?: FormFlag[];
  lastEmergencyPetition?: { date: string | null; signedAt: string | null } | null;
  /** MDH petition steps (eligibilityData.petitionChecklist) and the open-step flags (petition / hearing stage) */
  petitionChecklist?: PetitionChecklistState;
  checklistFlags?: ChecklistFlag[];
  /** False when MDH lists no operational CCT for the county */
  cctOperational?: boolean;
}

interface FormFlag {
  id: string;
  formType: string;
  label: string;
  due: string | null;
  daysLeft: number | null;
  status: 'overdue' | 'due' | 'upcoming';
  basis: string;
}

interface AotReferral {
  id: string;
  name: string;
  age: number | null;
  source: string;
  sourceKind: 'family' | 'hospital' | 'court' | 'provider';
  concern: string;
  received: string;
}

// ---------------------------------------------------------------------------
// Reference lists (no participant data: participants come from /api/aot/caseboard)
// ---------------------------------------------------------------------------

const STATUS_STEPS: { id: AotStatus; label: string }[] = [
  { id: 'referral', label: 'Referral' },
  { id: 'screening', label: 'Eligibility' },
  { id: 'petition', label: 'Petition Filed' },
  { id: 'hearing', label: 'Hearing' },
  { id: 'active', label: 'Order Active' },
  { id: 'renewal', label: 'Renewal' },
  { id: 'stepdown', label: 'Step-Down' },
];

const STATUS_BADGE: Record<AotStatus, { label: string; cls: string }> = {
  referral: { label: 'Referral', cls: 'bg-slate-100 text-slate-600' },
  screening: { label: 'Eligibility Screening', cls: 'bg-blue-100 text-blue-700' },
  petition: { label: 'Petition Filed', cls: 'bg-blue-100 text-blue-700' },
  hearing: { label: 'Hearing Scheduled', cls: 'bg-blue-100 text-blue-700' },
  active: { label: 'Court Order Active', cls: 'bg-emerald-100 text-emerald-700' },
  renewal: { label: 'Renewal Window', cls: 'bg-amber-100 text-amber-700' },
  stepdown: { label: 'Step-Down to Voluntary', cls: 'bg-sky-100 text-sky-700' },
};

const FLAG_BADGE: Record<FlagStatus, { label: string; cls: string; dot: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-rose-100 text-rose-700 border-rose-300', dot: 'bg-rose-500' },
  due: { label: 'Due Soon', cls: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', cls: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-400' },
  done: { label: 'Done', cls: 'bg-emerald-100 text-emerald-700 border-emerald-300', dot: 'bg-emerald-500' },
};

type RosterClient = { id: string; name: string };

const REF_ICON: Record<AotReferral['sourceKind'], React.FC<{ className?: string }>> = {
  family: Users,
  hospital: Hospital,
  court: Gavel,
  provider: User,
};

// ---------------------------------------------------------------------------
// Eligibility screening — gates + criteria + decision engine
// ---------------------------------------------------------------------------

type YesNo = 'yes' | 'no' | null;

interface Screen {
  adult: YesNo;
  inpatientCriteria: YesNo;
  voluntaryReliable: YesNo;
  smi: YesNo;
  unsafeWithoutSupervision: YesNo;
  priorHospitalizations: YesNo;
  violenceHistory: YesNo;
  unlikelyVoluntary: YesNo;
  likelyBenefit: YesNo;
}

const EMPTY_SCREEN: Screen = {
  adult: null,
  inpatientCriteria: null,
  voluntaryReliable: null,
  smi: null,
  unsafeWithoutSupervision: null,
  priorHospitalizations: null,
  violenceHistory: null,
  unlikelyVoluntary: null,
  likelyBenefit: null,
};

type ScreenOutcome =
  | { kind: 'inpatient'; label: string; detail: string }
  | { kind: 'voluntary'; label: string; detail: string }
  | { kind: 'eligible'; label: string; detail: string; drivers: string[] }
  | { kind: 'not-eligible'; label: string; detail: string; drivers: string[] }
  | null;

function computeScreen(s: Screen): ScreenOutcome {
  if (s.adult === 'no') {
    return { kind: 'not-eligible', label: 'Not Eligible — Adult Program', detail: 'AOT applies to adults. Route to child/adolescent services and family support.', drivers: ['Under 18'] };
  }
  if (s.inpatientCriteria === 'yes') {
    return { kind: 'inpatient', label: 'Refer — Inpatient Evaluation', detail: 'The person currently meets inpatient commitment criteria. AOT is an outpatient alternative — pursue emergency evaluation now and reassess AOT at discharge planning.' };
  }
  if (s.voluntaryReliable === 'yes') {
    return { kind: 'voluntary', label: 'Route — Voluntary Services', detail: 'AOT is a last-resort, least-restrictive tool. If the person will reliably engage voluntarily, enroll them in voluntary services and document the engagement plan — no petition.' };
  }
  const core = [s.smi, s.unsafeWithoutSupervision, s.unlikelyVoluntary, s.likelyBenefit];
  const history = s.priorHospitalizations === 'yes' || s.violenceHistory === 'yes';
  if (core.some((c) => c === null) || (s.priorHospitalizations === null && s.violenceHistory === null)) return null;
  const drivers: string[] = [];
  if (s.smi === 'yes') drivers.push('Serious and persistent mental illness documented');
  if (s.unsafeWithoutSupervision === 'yes') drivers.push('AOT needed to maintain health and safety');
  if (s.priorHospitalizations === 'yes') drivers.push('≥2 inpatient hospitalizations ≥48 hrs in 3 years tied to non-adherence, or detention-based psychiatric services');
  if (s.violenceHistory === 'yes') drivers.push('Serious violent behavior or credible threat/attempt within 3 years');
  if (s.unlikelyVoluntary === 'yes') drivers.push('Unlikely to adhere voluntarily (3-year history; financial/transportation/language barriers ruled out)');
  if (s.likelyBenefit === 'yes') drivers.push('AOT is the least restrictive alternative appropriate to maintain health and safety');
  const eligible = core.every((c) => c === 'yes') && history;
  if (eligible) {
    return { kind: 'eligible', label: 'Meets § 10-6A-05 Criteria — Build Petition Packet', detail: 'The screening supports a petition under Health-General § 10-6A-05. Generate the filing packet, obtain the AOT Psychiatrist\'s Affidavit (exam timing per MDH; confirm with counsel), and file it with the petition in the Circuit Court of the county where the respondent resides or was last known to reside.', drivers };
  }
  const missing: string[] = [];
  if (s.smi !== 'yes') missing.push('serious and persistent mental illness not established');
  if (s.unsafeWithoutSupervision !== 'yes') missing.push('health-and-safety criterion not met');
  if (!history) missing.push('3-year history prong (hospitalizations/detention or violence) not met');
  if (s.unlikelyVoluntary !== 'yes') missing.push('voluntary adherence not ruled out (or non-adherence is due to financial/transportation/language barriers)');
  if (s.likelyBenefit !== 'yes') missing.push('least-restrictive-alternative statement not supported');
  return { kind: 'not-eligible', label: 'Does Not Meet AOT Criteria', detail: `Criteria not satisfied: ${missing.join('; ')}. Document the determination and offer an assertive voluntary engagement plan; re-screen if circumstances change.`, drivers };
}

// Mirrors the MDH "AOT Petitioner Filing Checklist" (HG § 10-6A-05)
const PETITION_PACKET = [
  'Petitioner eligibility — the director of a State-funded mental health program OR any individual at least 18 years old who has a legitimate interest in the wellbeing of the respondent',
  'Petitioner name, address & relationship to respondent — everything signed in writing',
  'Respondent name & address — venue is the county where the respondent resides or of their last known address',
  'Name & address of each guardian and health care agent, or a statement that none are known',
  'Statement: AOT is the least restrictive alternative appropriate to maintain the respondent\'s health and safety',
  'Factual basis for each § 10-6A-05 criterion (3-year look-back events, dated)',
  'AOT Psychiatrist\'s Affidavit, filed along with the petition — examination timing per MDH (confirm with counsel), concludes § 10-6A-05 criteria are met, and states willingness to attest in court',
  'Proposed treatment plan (services, cadence, responsible team members)',
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'board' | 'referrals' | 'screening' | 'psycheval' | 'workflow' | 'forms' | 'team';

// ---------------------------------------------------------------------------
// Psychiatric evaluation (court affidavit instrument)
// ---------------------------------------------------------------------------

interface PsychEval {
  examDate: string;
  mode: string;
  durationMin: string;
  sources: string[];
  mse: { appearance: string; mood: string; thought: string; insight: string };
  diagnosis: string;
  basis: { smi: string; safety: string; history: string; voluntary: string; benefit: string };
  capacity: string;
  plan: string[];
  testify: boolean;
  signed: boolean;
}

const EMPTY_EVAL: PsychEval = {
  examDate: '',
  mode: 'In person',
  durationMin: '',
  sources: [],
  mse: { appearance: '', mood: '', thought: '', insight: '' },
  diagnosis: '',
  basis: { smi: '', safety: '', history: '', voluntary: '', benefit: '' },
  capacity: '',
  plan: [],
  testify: false,
  signed: false,
};

const EVAL_MSE: { key: keyof PsychEval['mse']; label: string; options: string[] }[] = [
  { key: 'appearance', label: 'Appearance & Behavior', options: ['Cooperative', 'Guarded', 'Agitated', 'Disheveled', 'Withdrawn'] },
  { key: 'mood', label: 'Mood / Affect', options: ['Euthymic', 'Irritable', 'Expansive', 'Depressed', 'Anxious', 'Flat'] },
  { key: 'thought', label: 'Thought Process / Content', options: ['Organized', 'Tangential', 'Disorganized', 'Delusional content', 'Responding to internal stimuli'] },
  { key: 'insight', label: 'Insight & Judgment', options: ['Good', 'Fair', 'Limited', 'Poor / absent'] },
];

const EVAL_SOURCES = [
  'Direct examination of respondent',
  'Prior inpatient records',
  'Outpatient treatment records',
  'Collateral — family',
  'Collateral — case manager / provider',
  'Court / arrest records',
];

const EVAL_DIAGNOSES = [
  'F20.9 — Schizophrenia, unspecified',
  'F25.0 — Schizoaffective disorder, bipolar type',
  'F31.2 — Bipolar I, manic with psychotic features',
  'F29 — Unspecified psychosis',
  'F33.3 — MDD, recurrent severe with psychotic features',
];

const EVAL_PLAN_OPTIONS = [
  'Medication management — monthly psychiatric review',
  'Long-acting injectable antipsychotic (consider / continue)',
  'Individual therapy',
  'Case management — weekly contact',
  'Peer support services',
  'Housing support services',
  'SUD counseling (co-occurring)',
  'Lab monitoring (levels, metabolic)',
];

const BASIS_FIELDS: { key: keyof PsychEval['basis']; label: string; hint: string }[] = [
  // Labels follow the MDH Psychiatrist Affidavit (MDH#0004BHA) items; the paragraphs prefill that form.
  { key: 'smi', label: '2b. Serious and persistent mental illness', hint: 'Diagnosis, course of illness, and how it was established' },
  { key: 'safety', label: '2d. Needs AOT to prevent a relapse or deterioration that would likely result in a substantial risk of serious harm to self or others', hint: 'Specific deterioration pattern when untreated' },
  { key: 'history', label: '2c. Lack of adherence — (i) at least twice in the past 36 months: inpatient psychiatric admission over 48 hours or psychiatric services in a correctional facility; or (ii) at least once in the 36 months before filing: serious violent behavior toward self or others, or threats / attempts of serious physical harm', hint: 'Date each event and say which of (i) / (ii) it supports' },
  { key: 'voluntary', label: '2e. Unlikely to adequately adhere to outpatient treatment voluntarily (non-adherence in the prior 36 months not due to financial, transportation or language access issues)', hint: 'Documented refusals and drop-outs in the past 36 months; rule out financial, transportation and language access explicitly' },
  { key: 'benefit', label: 'AOT is the least restrictive alternative to maintain health & safety', hint: 'What works when engaged; what less-restrictive options were tried or why they are inadequate' },
];

export default function AotPage() {
  const [tab, setTab] = useState<Tab>('board');
  // Reference time for the exam-window check (captured once; render must stay pure)
  const [pageOpenedAt] = useState(() => Date.now());
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [referrals, setReferrals] = useState<AotReferral[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [evals, setEvals] = useState<Record<string, PsychEval>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [caseboardLoading, setCaseboardLoading] = useState(true);
  // In-house clients (org roster) so a screen can be linked to the client's chart.
  const [roster, setRoster] = useState<RosterClient[]>([]);
  const [screenClientId, setScreenClientId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    async function loadCaseboard() {
      try {
        const res = await fetch('/api/aot/caseboard');
        const data = await res.json();
        if (isMounted && !data.success) setLoadError(data.error || `Could not load the AOT caseboard (${res.status})`);
        if (isMounted && data.success) {
          const caseboard: Participant[] = Array.isArray(data.caseboard) ? data.caseboard : [];
          setParticipants(caseboard);
          const qs = new URLSearchParams(window.location.search);
          const linked = qs.get('participant');
          const linkedTab = qs.get('tab');
          if (linked && caseboard.some((p) => p.id === linked)) {
            setActiveId(linked);
            if (linkedTab === 'forms' || linkedTab === 'workflow' || linkedTab === 'team' || linkedTab === 'psycheval') setTab(linkedTab);
          } else {
            setActiveId((prev) => (prev && caseboard.some((p) => p.id === prev) ? prev : caseboard[0]?.id || ''));
          }
          setReferrals(Array.isArray(data.referrals) ? data.referrals : []);
        }
      } catch (err) {
        console.warn('AOT Caseboard fetch error:', err);
        if (isMounted) setLoadError('Could not load the AOT caseboard. Nothing shown here is a substitute.');
      } finally {
        if (isMounted) setCaseboardLoading(false);
      }
    }
    loadCaseboard();
    return () => { isMounted = false; };
  }, []);

  // Saved evaluation (psychiatristAffidavit) is PHI-heavy, so it loads per participant from the
  // org-scoped participant route rather than with the caseboard list.
  const [loadedEvalIds, setLoadedEvalIds] = useState<Record<string, true>>({});
  useEffect(() => {
    if (!activeId || loadedEvalIds[activeId]) return;
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch(`/api/aot/participants/${encodeURIComponent(activeId)}`);
        const data = await res.json().catch(() => null);
        if (!isMounted || !res.ok || !data?.success) return;
        setLoadedEvalIds((prev) => ({ ...prev, [activeId]: true }));
        const aff = data.participant?.psychiatristAffidavit;
        if (aff && typeof aff === 'object' && aff.basis && typeof aff.basis === 'object') {
          const restored: PsychEval = { ...EMPTY_EVAL, ...aff, mse: { ...EMPTY_EVAL.mse, ...aff.mse }, basis: { ...EMPTY_EVAL.basis, ...aff.basis } };
          // A signed affidavit always wins; an unsigned saved copy never overwrites local edits.
          setEvals((prev) => (restored.signed || !prev[activeId] ? { ...prev, [activeId]: restored } : prev));
        }
      } catch (err) {
        console.warn('AOT evaluation load failed for participant', activeId, err instanceof Error ? err.message : '');
      }
    })();
    return () => { isMounted = false; };
  }, [activeId, loadedEvalIds]);

  // Screening wizard
  const [screenStep, setScreenStep] = useState(0);
  const [screenName, setScreenName] = useState('');
  const [petitioner, setPetitioner] = useState({ type: '', name: '', relationship: '', county: 'Baltimore City', attestedAdult: false });
  const [screen, setScreen] = useState<Screen>(EMPTY_SCREEN);
  const [screenLog, setScreenLog] = useState<{ name: string; outcome: string; date: string }[]>([]);
  const [screenDone, setScreenDone] = useState('');

  useEffect(() => {
    let cancelled = false;
    // Roster for linking a screen to an in-house chart, plus ?clientId= (Service Eligibility Scanner "Refer").
    (async () => {
      try {
        const res = await fetch('/api/clients?limit=500');
        const data = await res.json().catch(() => null);
        const list: RosterClient[] = Array.isArray(data?.clients)
          ? data.clients.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))
          : [];
        if (cancelled) return;
        setRoster(list);
        const preset = new URLSearchParams(window.location.search).get('clientId');
        const match = preset ? list.find((c) => c.id === preset) : undefined;
        if (match) {
          setScreenName(match.name);
          setScreenClientId(match.id);
          setTab('screening');
        }
      } catch {
        /* roster is optional: screens can still be started for external referrals */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Psychiatric evaluation (per participant) — state declared above the caseboard loader.
  const [evalAiLoading, setEvalAiLoading] = useState(false);
  const [evalAiError, setEvalAiError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const getEval = (id: string): PsychEval => evals[id] ?? EMPTY_EVAL;
  const updateEval = (id: string, fn: (e: PsychEval) => PsychEval) =>
    setEvals((prev) => ({ ...prev, [id]: fn(prev[id] ?? EMPTY_EVAL) }));

  const evalComplete = (e: PsychEval) =>
    !!e.examDate && !!e.diagnosis && !!e.capacity.trim() && e.plan.length > 0 && e.testify &&
    BASIS_FIELDS.every((b) => e.basis[b.key].trim().length > 0);

  const signEval = async (p: Participant) => {
    if (signing) return;
    setSigning(true);
    setSignError(null);
    // The affidavit deadline clears when the MDH Psychiatrist Affidavit (MDH#0004BHA) is signed, not this worksheet.
    try {
      const res = await fetch(`/api/aot/participants/${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // The server checks the signer's role and stamps signer + time itself.
          psychiatristAffidavit: getEval(p.id),
          signAffidavit: true,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Save failed (${res.status})`);
      const savedAff = data.participant?.psychiatristAffidavit;
      updateEval(p.id, (e) => ({ ...e, ...(savedAff && typeof savedAff === 'object' ? savedAff : {}), signed: true }));
    } catch (err: unknown) {
      setSignError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSigning(false);
    }
  };

  // Bedrock drafts only the empty paragraphs, from the psychiatrist's exam entries and the participant record.
  const draftEvalBasis = async (p: Participant) => {
    setEvalAiLoading(true);
    setEvalAiError(null);
    const e = getEval(p.id);
    try {
      const res = await fetch('/api/aot/eval-basis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantId: p.id,
          eval: {
            examDate: e.examDate,
            mode: e.mode,
            sources: e.sources,
            mse: e.mse,
            diagnosis: e.diagnosis,
            capacity: e.capacity,
            plan: e.plan,
            basis: e.basis,
          },
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.basis) throw new Error(data?.error || `AI draft failed (${res.status})`);
      const drafted = data.basis as Partial<PsychEval['basis']>;
      updateEval(p.id, (ev) => ({
        ...ev,
        basis: {
          smi: ev.basis.smi || drafted.smi || '',
          safety: ev.basis.safety || drafted.safety || '',
          history: ev.basis.history || drafted.history || '',
          voluntary: ev.basis.voluntary || drafted.voluntary || '',
          benefit: ev.basis.benefit || drafted.benefit || '',
        },
      }));
    } catch (err: unknown) {
      setEvalAiError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setEvalAiLoading(false);
    }
  };

  // Order dates (MDH: a term not to exceed one year), drafts keyed by participant
  const [orderDraft, setOrderDraft] = useState<Record<string, { start: string; end: string }>>({});
  const [orderBusy, setOrderBusy] = useState(false);
  const [orderMsg, setOrderMsg] = useState<{ id: string; text: string; error: boolean } | null>(null);

  const saveOrderDates = async (p: Participant) => {
    const d = orderDraft[p.id] ?? { start: p.orderStart ?? '', end: p.orderEnd ?? '' };
    if (orderBusy || !d.start || !d.end) return;
    const problem = orderTermProblem(d.start, d.end);
    if (problem) {
      setOrderMsg({ id: p.id, text: problem, error: true });
      return;
    }
    setOrderBusy(true);
    setOrderMsg(null);
    try {
      const res = await fetch(`/api/aot/participants/${encodeURIComponent(p.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderStart: d.start, orderEnd: d.end }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Save failed (${res.status})`);
      setParticipants((prev) => prev.map((x) => (x.id === p.id ? { ...x, orderStart: d.start, orderEnd: d.end } : x)));
      setOrderMsg({ id: p.id, text: 'Order dates saved.', error: false });
    } catch (err: unknown) {
      setOrderMsg({ id: p.id, text: `Not saved: ${err instanceof Error ? err.message : 'request failed'}`, error: true });
    } finally {
      setOrderBusy(false);
    }
  };

  // Contact logging + AI
  const [contactWho, setContactWho] = useState('');
  const [contactBusy, setContactBusy] = useState(false);
  const [contactMsg, setContactMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [aiReport, setAiReport] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [screenError, setScreenError] = useState<string | null>(null);
  const [screenBusy, setScreenBusy] = useState(false);

  const active = participants.find((p) => p.id === activeId) ?? participants[0];
  const outcome = computeScreen(screen);

  const setS = <K extends keyof Screen>(k: K, v: Screen[K]) => setScreen((prev) => ({ ...prev, [k]: v }));

  const gateHit = screen.adult === 'no' || screen.inpatientCriteria === 'yes' || screen.voluntaryReliable === 'yes';
  const gatesAnswered = screen.adult !== null && screen.inpatientCriteria !== null && screen.voluntaryReliable !== null;
  const criteriaAnswered =
    screen.smi !== null && screen.unsafeWithoutSupervision !== null && screen.priorHospitalizations !== null &&
    screen.violenceHistory !== null && screen.unlikelyVoluntary !== null && screen.likelyBenefit !== null;

  const startScreen = (name: string, refId?: string) => {
    setScreenName(name);
    setScreen(EMPTY_SCREEN);
    setPetitioner((p) => ({ ...p, type: '', name: '', relationship: '', attestedAdult: false }));
    setScreenStep(0); // petitioner eligibility is captured first, per the MDH filing checklist
    setScreenDone('');
    if (refId) setReferrals((prev) => prev.filter((r) => r.id !== refId));
    setTab('screening');
  };

  const finishScreen = async () => {
    if (!outcome || screenBusy) return;
    const today = new Date().toISOString().slice(0, 10);
    setScreenError(null);
    if (outcome.kind === 'eligible') {
      setScreenBusy(true);
      try {
        const res = await fetch('/api/aot/caseboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: screenName,
            clientId: screenClientId,
            county: petitioner.county || undefined,
            status: 'petition',
            referralSource: `Petitioner: ${petitioner.name || 'not recorded'} (${petitioner.relationship || petitionerTypeLabel(petitioner.type) || 'relationship not recorded'})`,
            diagnosis: 'Per screening — confirm with physician affidavit',
            eligibilityData: {
              statute: 'HG § 10-6A-05',
              prongsMet: true,
              screenAnswers: screen,
              petitioner: {
                type: petitioner.type,
                name: petitioner.name,
                relationship: petitioner.relationship,
                county: petitioner.county,
                attestedAdult: petitioner.type === 'individual' ? petitioner.attestedAdult : false,
              },
            },
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success || !data.participant) throw new Error(data?.error || `Save failed (${res.status})`);
        const created = data.participant;
        const newParticipant: Participant = {
          id: created.id,
          name: created.name,
          age: created.age > 0 ? created.age : null,
          status: 'petition',
          county: created.county,
          referralSource: created.referralSource,
          diagnosis: created.diagnosis,
          deadlines: Array.isArray(created.deadlines) ? created.deadlines : [],
          team: Array.isArray(created.teamCadence) ? created.teamCadence : [],
          nonAdherence: Array.isArray(created.escalationEvents) ? created.escalationEvents : [],
          contactLog: [],
          petitionChecklist: {},
          cctOperational: hasOperationalCct(created.county),
        };
        setParticipants((prev) => [newParticipant, ...prev]);
        setActiveId(created.id);
      } catch (err: unknown) {
        // Never put an unsaved participant on the caseboard.
        setScreenError(err instanceof Error ? err.message : 'Save failed');
        setScreenBusy(false);
        return;
      }
      setScreenBusy(false);
    }
    setScreenLog((prev) => [{ name: screenName, outcome: outcome.label, date: today }, ...prev]);
    setScreenDone(outcome.kind);
  };

  // Persists the contact date + cadence status on the team record. Contact narrative belongs in a progress note
  // (there is no AOT contact-note store yet).
  const logContact = async () => {
    if (!contactWho || !active || contactBusy) return;
    const today = new Date().toISOString().slice(0, 10);
    const team = active.team.map((t) => (t.name === contactWho ? { ...t, lastContact: today, status: 'current' as const } : t));
    setContactBusy(true);
    setContactMsg(null);
    try {
      const res = await fetch(`/api/aot/participants/${encodeURIComponent(active.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamCadence: team }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Save failed (${res.status})`);
      setParticipants((prev) => prev.map((p) => (p.id === active.id ? { ...p, team } : p)));
      setContactMsg({ text: `Contact on ${today} saved for ${contactWho}. Document what happened in a progress note.`, error: false });
      setContactWho('');
    } catch (err: unknown) {
      setContactMsg({ text: `Not saved: ${err instanceof Error ? err.message : 'request failed'}`, error: true });
    } finally {
      setContactBusy(false);
    }
  };

  const draftCourtReport = async (p: Participant) => {
    setAiLoading(p.id);
    setReportError(null);
    try {
      const res = await fetch('/api/aot/court-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // The server loads the participant record; the draft uses stored facts only.
        body: JSON.stringify({ participantId: p.id }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success || !data.report) throw new Error(data?.error || `AI draft failed (${res.status})`);
      setAiReport((prev) => ({
        ...prev,
        [p.id]: data.report,
      }));
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : 'AI draft failed');
    } finally {
      setAiLoading('');
    }
  };

  // Aggregate metrics
  const allDeadlines = participants.flatMap((p) => p.deadlines.map((d) => ({ ...d, who: p.name })));
  const allFormFlags = participants.flatMap((p) => p.formFlags ?? []);
  const formFlagCount = allFormFlags.filter((f) => f.status !== 'upcoming').length;
  const overdueCount = allDeadlines.filter((d) => d.status === 'overdue').length + allFormFlags.filter((f) => f.status === 'overdue').length;
  const checklistOpen = participants.reduce((n, p) => n + (p.checklistFlags ?? []).length, 0);
  const dueCount = allDeadlines.filter((d) => d.status === 'due').length + allFormFlags.filter((f) => f.status === 'due').length + checklistOpen;
  const activeOrders = participants.filter((p) => p.status === 'active' || p.status === 'renewal').length;
  const hearingsSoon = participants.filter((p) => p.status === 'hearing' || p.status === 'petition').length;
  const teamOverdue = participants.flatMap((p) => p.team).filter((t) => t.status === 'overdue').length;
  const nextHearing = participants
    .filter((p) => (p.status === 'hearing' || p.status === 'petition') && p.hearingDate)
    .sort((a, b) => (a.hearingDate || '').localeCompare(b.hearingDate || ''))[0];

  const statusIndex = (s: AotStatus) => STATUS_STEPS.findIndex((x) => x.id === s);

  return (
    <Page>
      <PageHeader
        title="Assisted Outpatient Treatment (AOT)"
        description="Court-ordered outpatient treatment — referral, eligibility, petition, order management & care team, with every deadline flagged"
        actions={
          <Button
            icon={<ClipboardCheck />}
            onClick={() => { setScreenStep(0); setScreenName(''); setScreenClientId(null); setScreen(EMPTY_SCREEN); setScreenDone(''); setTab('screening'); }}
          >
            New Eligibility Screen
          </Button>
        }
      />

      {loadError && <Alert tone="danger">{loadError}</Alert>}
      {caseboardLoading && <Card><LoadingState label="Loading the AOT caseboard…" /></Card>}

      {/* Metric tiles */}
      <StatGrid columns={4}>
        {[
          { label: 'Active Court Orders', value: String(activeOrders), sub: `${participants.length} total cases (respondents and participants)`, Icon: Gavel, tone: 'brand' as Tone },
          { label: 'Petitions / Hearings Open', value: String(hearingsSoon), sub: nextHearing ? `${nextHearing.name} hears ${nextHearing.hearingDate}` : 'No hearings scheduled', Icon: Landmark, tone: 'brand' as Tone },
          { label: 'Deadlines Flagged', value: `${overdueCount} overdue · ${dueCount} due`, sub: 'statutory, order, MDH form & petition-step timelines', Icon: Flag, tone: (overdueCount ? 'danger' : 'success') as Tone },
          { label: 'Team Contacts Overdue', value: String(teamOverdue), sub: 'against ordered cadence', Icon: Users, tone: (teamOverdue ? 'warning' : 'success') as Tone },
        ].map((m) => (
          <StatCard key={m.label} label={m.label} value={m.value} hint={m.sub} icon={<m.Icon />} tone={m.tone} />
        ))}
      </StatGrid>

      {/* Tabs */}
      <Tabs
        label="AOT sections"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={([
          { id: 'board', label: 'Caseboard', Icon: ClipboardList },
          { id: 'referrals', label: 'Referrals', Icon: Inbox, badge: referrals.length },
          { id: 'screening', label: 'Eligibility Screen', Icon: ClipboardCheck },
          { id: 'psycheval', label: 'Psychiatric Eval', Icon: Stethoscope },
          { id: 'workflow', label: 'Court Workflow & Docs', Icon: Gavel, badge: overdueCount },
          { id: 'forms', label: 'Forms & Outreach', Icon: FileText, badge: formFlagCount },
          { id: 'team', label: 'Care Team', Icon: Users, badge: teamOverdue },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }>; badge?: number }[]).map((t) => ({
          key: t.id,
          label: t.label,
          icon: <t.Icon />,
          count: t.badge || undefined,
          countTone: 'attention' as const,
        }))}
      />

      {/* ===================================================================
          TAB — CASEBOARD
      =================================================================== */}
      {tab === 'board' && (
        <div className="space-y-3">
          {participants.length === 0 && !caseboardLoading && (
            <Card><EmptyState icon={<Gavel />} title="No AOT cases yet." description="Complete an eligibility screen to open a case." /></Card>
          )}
          {participants.map((p) => {
            const sb = STATUS_BADGE[p.status];
            const worst = p.deadlines.some((d) => d.status === 'overdue') ? 'overdue' : p.deadlines.some((d) => d.status === 'due') ? 'due' : 'clear';
            const next = [...p.deadlines].filter((d) => d.status !== 'done').sort((a, b) => a.daysLeft - b.daysLeft)[0];
            return (
              <button
                key={p.id}
                onClick={() => { setActiveId(p.id); setTab('workflow'); }}
                className={`w-full text-left bg-white rounded-xl border-2 p-4 hover:shadow-sm transition-all ${worst === 'overdue' ? 'border-rose-200 hover:border-rose-300' : 'border-slate-200 hover:border-blue-300'}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{p.name} <span className="text-slate-500 font-normal">· {personLabel(p.status)} · {p.county}</span></p>
                    <p className="text-[11px] text-slate-500 truncate">{p.diagnosis}</p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                  {p.nonAdherence.length > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Non-adherence escalation
                    </span>
                  )}
                  {p.lastEmergencyPetition && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-rose-600 text-white inline-flex items-center gap-1">
                      <AlertOctagon className="h-3 w-3" /> Emergency petition {p.lastEmergencyPetition.date ?? ''}
                    </span>
                  )}
                  {p.cctOperational === false && countyRecorded(p.county) && (
                    <span title={NO_CCT_NOTE} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 inline-flex items-center gap-1">
                      <Info className="h-3 w-3" /> No MDH CCT listed for {p.county}
                    </span>
                  )}
                  {(p.checklistFlags ?? []).length > 0 && (
                    <span
                      title={(p.checklistFlags ?? []).map((f) => f.label).join('\n')}
                      className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 inline-flex items-center gap-1"
                    >
                      <ClipboardCheck className="h-3 w-3" /> {(p.checklistFlags ?? []).length} petition step{(p.checklistFlags ?? []).length === 1 ? '' : 's'} open
                    </span>
                  )}
                  {(p.formFlags ?? []).map((f) => (
                    <span
                      key={f.id}
                      title={f.basis}
                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${f.status === 'overdue' ? 'bg-rose-100 text-rose-700' : f.status === 'due' ? 'bg-amber-100 text-amber-800' : 'bg-blue-50 text-blue-700'}`}
                    >
                      <FileText className="h-3 w-3" /> {f.label}
                      {f.due ? ` · ${f.daysLeft !== null && f.daysLeft < 0 ? `${-f.daysLeft}d overdue` : f.due}` : ''}
                    </span>
                  ))}
                  <span className="ml-auto text-xs text-slate-500 hidden sm:inline-flex items-center gap-1">
                    {next && (
                      <>
                        <Flag className={`h-3.5 w-3.5 ${next.status === 'overdue' ? 'text-rose-600' : next.status === 'due' ? 'text-amber-700' : 'text-blue-600'}`} />
                        Next: {next.label} · {next.daysLeft < 0 ? `${-next.daysLeft}d overdue` : next.daysLeft === 0 ? 'today' : `in ${next.daysLeft}d`}
                      </>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                </div>
                {/* mini status stepper */}
                <div className="flex gap-1">
                  {STATUS_STEPS.map((s, i) => (
                    <div
                      key={s.id}
                      title={s.label}
                      className={`h-1.5 flex-1 rounded-full ${i <= statusIndex(p.status) ? 'bg-blue-500' : 'bg-slate-100'}`}
                    />
                  ))}
                </div>
              </button>
            );
          })}

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
            <Shield className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700">
              AOT is the least-restrictive, engagement-first tool: every escalation starts with outreach, never
              enforcement. Timeline flags exist so no statutory date is ever discovered late — verify specific timelines
              against the current Maryland AOT statute and your county&apos;s standing order with counsel.
            </p>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — REFERRALS
      =================================================================== */}
      {tab === 'referrals' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 uppercase tracking-wider">Inbound AOT Referrals</h2>
            {referrals.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">Queue is clear.</div>
            )}
            {referrals.map((r) => {
              const Icon = REF_ICON[r.sourceKind];
              return (
                <div key={r.id} className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{r.name} <span className="text-slate-500 font-normal">· {r.age ?? 'Age not recorded'}</span></p>
                    <p className="text-xs text-slate-500">{r.source}</p>
                    <p className="text-[11px] text-slate-500">{r.concern}</p>
                  </div>
                  <div className="w-full sm:w-auto sm:shrink-0 sm:text-right">
                    <p className="text-[11px] text-slate-500 mb-1">Received {r.received}</p>
                    <button
                      onClick={() => startScreen(r.name, r.id)}
                      className={buttonClasses({ size: 'sm' })}
                    >
                      Start Eligibility Screen <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Who can refer</p>
              <div className="flex flex-wrap gap-1.5">
                {['Family member / cohabitant', 'Treating clinician or hospital', 'Court or corrections', 'Community provider', 'Self-referral for screening'].map((w) => (
                  <span key={w} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-600">{w}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Determination log */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 h-fit">
            <h3 className="text-sm font-semibold text-slate-700 mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4 text-blue-500" /> Screening Determination Log
            </h3>
            <p className="text-[11px] text-slate-500 mb-2.5">Every screen is recorded — eligible, voluntary routing, or not eligible — with its basis.</p>
            <div className="space-y-2">
              {screenLog.length === 0 && <p className="text-xs text-slate-500">No screens recorded yet.</p>}
              {screenLog.map((d, i) => (
                <div key={i} className="text-xs border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                  <p className="font-semibold text-slate-800">{d.name} <span className="text-slate-500 font-normal">· {d.date}</span></p>
                  <p className="text-slate-500">{d.outcome}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — ELIGIBILITY SCREENING (smart questionnaire)
      =================================================================== */}
      {tab === 'screening' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-4">
            {/* Stepper */}
            <div className="flex gap-1.5">
              {['Person', 'Threshold Gates', 'AOT Criteria', 'Determination'].map((label, i) => {
                const skip = gateHit && i === 2;
                return (
                  <div key={label} className={`flex-1 py-2 px-1 rounded-lg text-center text-[11px] font-semibold border-2 ${
                    screenStep === i ? 'bg-blue-700 border-blue-700 text-white'
                    : screenStep > i ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : skip ? 'bg-slate-50 border-slate-100 text-slate-500 line-through'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                  }`}>
                    {i + 1}. {label}
                  </div>
                );
              })}
            </div>

            {/* Finished */}
            {screenDone && outcome && (
              <div className={`rounded-xl border-2 p-6 text-center ${
                screenDone === 'eligible' ? 'bg-blue-50 border-blue-300' : screenDone === 'inpatient' ? 'bg-rose-50 border-rose-300' : 'bg-sky-50 border-sky-300'
              }`}>
                <CheckCircle2 className={`h-10 w-10 mx-auto mb-2 ${screenDone === 'eligible' ? 'text-blue-500' : screenDone === 'inpatient' ? 'text-rose-600' : 'text-sky-700'}`} />
                <h2 className="text-lg font-semibold text-slate-900 mb-1">{outcome.label}</h2>
                <p className="text-sm text-slate-600 mb-4">
                  {screenDone === 'eligible'
                    ? `${screenName} is saved to the caseboard in Petition status with the affidavit, filing, and treatment-plan deadlines on the clock.`
                    : 'The determination is listed in this session\'s screening log only — it is not saved. Record the outcome in the client chart.'}
                </p>
                <div className="flex justify-center gap-2">
                  {screenDone === 'eligible' && (
                    <button onClick={() => setTab('workflow')} className={buttonClasses()}>
                      <Gavel className="h-4 w-4" /> Open Court Workflow
                    </button>
                  )}
                  <button onClick={() => { setScreenStep(0); setScreenName(''); setScreenClientId(null); setScreen(EMPTY_SCREEN); setScreenDone(''); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200">
                    <ClipboardCheck className="h-4 w-4" /> New Screen
                  </button>
                </div>
              </div>
            )}

            {/* STEP 0 — person */}
            {!screenDone && screenStep === 0 && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Respondent (Person Being Screened)
                    </label>
                    <input
                      value={screenName}
                      onChange={(e) => {
                        setScreenName(e.target.value);
                        setScreenClientId(roster.find((c) => c.name === e.target.value)?.id ?? null);
                      }}
                      list="aot-inhouse-clients"
                      placeholder="Type a name — in-house clients autocomplete; external referrals prefill from the Referrals tab"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <datalist id="aot-inhouse-clients">
                      {roster.map((c) => (
                        <option key={c.id} value={c.name} />
                      ))}
                    </datalist>
                    {screenClientId && (
                      <p className="text-[11px] text-blue-600 font-medium mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> In-house client: the AOT record will be linked to this chart.
                        Review the chart for diagnosis and hospitalization history; nothing is copied automatically.
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500 mt-1">
                      Candidates flagged from charts:{' '}
                      <a href="/dashboard/ehr/scanner?program=aot" className="text-blue-600 hover:underline">Service Eligibility Scanner</a>
                    </p>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Venue County
                    </label>
                    <select
                      value={petitioner.county}
                      onChange={(e) => setPetitioner((p) => ({ ...p, county: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {MARYLAND_JURISDICTIONS.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-slate-500 mt-1">
                      The petition and the psychiatrist&apos;s affidavit are filed in the Circuit Court in the county the
                      respondent resides in or was last known to reside in.
                    </p>
                    {!hasOperationalCct(petitioner.county) && (
                      <p className="text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 mt-1.5 flex gap-1.5">
                        <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {NO_CCT_NOTE}
                      </p>
                    )}
                  </div>
                </div>

                {/* Petitioner eligibility — first section of the MDH filing checklist */}
                <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                  <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-blue-500" /> Petitioner
                  </h3>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Who is petitioning?</p>
                    <div className="space-y-1.5">
                      {PETITIONER_TYPES.map((t) => (
                        <button
                          key={t.value}
                          onClick={() => setPetitioner((p) => ({ ...p, type: t.value, attestedAdult: t.value === 'individual' ? p.attestedAdult : false }))}
                          aria-pressed={petitioner.type === t.value}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-xs font-medium transition-all ${
                            petitioner.type === t.value ? 'border-blue-400 bg-blue-50 text-blue-800' : 'border-slate-200 text-slate-600 hover:border-blue-200'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">MDH: &ldquo;{MDH_PETITIONER_TEXT}&rdquo;</p>
                    {petitioner.type === 'individual' && (
                      <label className="mt-2 flex items-start gap-2 rounded-lg border border-slate-200 p-2.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={petitioner.attestedAdult}
                          onChange={(e) => setPetitioner((p) => ({ ...p, attestedAdult: e.target.checked }))}
                          className="mt-0.5 w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                        />
                        <span>{PETITIONER_ADULT_ATTESTATION} <span className="text-slate-500">(required)</span></span>
                      </label>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Petitioner Name</label>
                      <input
                        value={petitioner.name}
                        onChange={(e) => setPetitioner((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Full name"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Relationship to Respondent (required)</label>
                      <input
                        value={petitioner.relationship}
                        onChange={(e) => setPetitioner((p) => ({ ...p, relationship: e.target.value }))}
                        placeholder="e.g., program director, mother, sibling"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Per the MDH filing checklist: petitioner name, address, and relationship must be in the petition, and
                    everything must be signed in writing. Guardian and health-care-agent information (or a statement that
                    none are known) is captured in the filing packet.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setScreenStep(1)}
                    disabled={!screenName.trim() || petitionerProblems(petitioner).length > 0}
                    title={petitionerProblems(petitioner).join('; ')}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    Next: Threshold Gates <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 1 — gates */}
            {!screenDone && screenStep === 1 && (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
                  <AlertOctagon className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    <strong>Threshold gates.</strong> These route the person before the full criteria — AOT is an adult,
                    outpatient, last-resort tool.
                  </p>
                </div>
                {([
                  { k: 'adult' as const, q: 'Is the person 18 or older?', hint: 'AOT is an adult program', invert: true },
                  { k: 'inpatientCriteria' as const, q: 'Do they currently meet inpatient commitment criteria?', hint: 'Imminent danger requiring hospital level of care — pursue emergency evaluation instead' },
                  { k: 'voluntaryReliable' as const, q: 'Will they reliably engage in voluntary treatment?', hint: 'If yes, AOT is unnecessary — route to voluntary services with an engagement plan' },
                ]).map((g) => {
                  const v = screen[g.k];
                  const danger = g.invert ? v === 'no' : v === 'yes';
                  return (
                    <div key={g.k} className={`bg-white rounded-xl border-2 p-4 transition-all ${danger ? 'border-amber-300 bg-amber-50' : v !== null ? 'border-emerald-200' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 font-medium">{g.q}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{g.hint}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {(['yes', 'no'] as const).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => setS(g.k, opt)}
                              className={`min-h-10 px-5 py-2 rounded-lg border-2 text-sm font-semibold capitalize transition-all ${
                                v === opt ? 'bg-blue-700 border-blue-700 text-white' : 'border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {gateHit && gatesAnswered && outcome && (
                  <div className="rounded-xl border-2 border-sky-300 bg-sky-50 p-4">
                    <p className="text-sm font-semibold text-sky-800">{outcome.label}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{outcome.detail}</p>
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button onClick={() => setScreenStep(0)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setScreenStep(gateHit ? 3 : 2)}
                    disabled={!gatesAnswered}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    {gateHit ? 'Go to Determination' : 'Next: AOT Criteria'} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2 — criteria */}
            {!screenDone && screenStep === 2 && (
              <div className="space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
                  <ClipboardCheck className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-700">
                    Criteria per Health-General § 10-6A-05 (mirrors the MDH Petitioner Filing Checklist). Each criterion
                    must be supportable with dated documentation — the petition cites the factual basis for every Yes.
                    The determination computes live in the panel on the right.
                  </p>
                </div>
                {([
                  { k: 'smi' as const, q: 'Serious and persistent mental illness?', hint: 'Documented diagnosis, e.g., schizophrenia spectrum, bipolar with psychosis' },
                  { k: 'unsafeWithoutSupervision' as const, q: 'Is AOT needed to maintain the respondent\'s health and safety?', hint: 'Pattern of deterioration when not under treatment supervision' },
                  { k: 'priorHospitalizations' as const, q: 'Non-adherence was a significant factor in ≥2 inpatient psychiatric hospitalizations of ≥48 hours in the 3 years before filing — or psychiatric services received while in detention, jail, or prison?', hint: 'Statutory history prong A — count and date each qualifying event' },
                  { k: 'violenceHistory' as const, q: 'OR: at least once in the 3 years before filing — serious violent behavior toward self or others, or a credible threat or attempt of serious physical harm?', hint: 'Statutory history prong B — either prong A or B suffices' },
                  { k: 'unlikelyVoluntary' as const, q: 'Unlikely to adhere to outpatient treatment voluntarily, per the 3-year non-adherence history?', hint: 'Non-adherence must NOT be due to financial, transportation, or language issues — rule those out and document it' },
                  { k: 'likelyBenefit' as const, q: 'Is AOT the least restrictive alternative appropriate to maintain health and safety?', hint: 'The petition must state this — document the less-restrictive options tried or why they are inadequate' },
                ]).map((c) => {
                  const v = screen[c.k];
                  return (
                    <div key={c.k} className={`bg-white rounded-xl border-2 p-4 transition-all ${v === 'yes' ? 'border-blue-300 bg-blue-50/50' : v === 'no' ? 'border-slate-200' : 'border-slate-200 hover:border-slate-300'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-slate-800 font-medium">{c.q}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{c.hint}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {(['yes', 'no'] as const).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => setS(c.k, opt)}
                              className={`min-h-10 px-5 py-2 rounded-lg border-2 text-sm font-semibold capitalize transition-all ${
                                v === opt ? 'bg-blue-700 border-blue-700 text-white' : 'border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50'
                              }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                  <button onClick={() => setScreenStep(1)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setScreenStep(3)}
                    disabled={!criteriaAnswered}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    View Determination <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3 — determination */}
            {!screenDone && screenStep === 3 && outcome && (
              <div className="space-y-4">
                <div className={`rounded-xl border-2 p-6 ${
                  outcome.kind === 'eligible' ? 'bg-blue-50 border-blue-300' : outcome.kind === 'inpatient' ? 'bg-rose-50 border-rose-400' : 'bg-sky-50 border-sky-300'
                }`}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-1">Determination — {screenName}</p>
                  <h2 className={`text-xl font-semibold leading-tight ${outcome.kind === 'eligible' ? 'text-blue-800' : outcome.kind === 'inpatient' ? 'text-rose-800' : 'text-sky-800'}`}>
                    {outcome.label}
                  </h2>
                  <p className="mt-3 text-sm text-slate-700 bg-white/70 rounded-lg p-3 border border-white">{outcome.detail}</p>
                  {'drivers' in outcome && outcome.drivers.length > 0 && (
                    <ul className="mt-3 space-y-0.5">
                      {outcome.drivers.map((d) => (
                        <li key={d} className="text-xs text-slate-600 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 text-blue-600" /> {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {outcome.kind === 'eligible' && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-blue-500" /> Petition Packet — generated on confirm
                    </h3>
                    <div className="space-y-1.5">
                      {PETITION_PACKET.map((item) => (
                        <p key={item} className="text-xs text-slate-600 flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-slate-500" /> {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button onClick={() => setScreenStep(gateHit ? 1 : 2)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  {screenError && <p className="text-xs text-rose-600 self-center">Not saved: {screenError}</p>}
                  <button
                    onClick={finishScreen}
                    disabled={screenBusy}
                    className={buttonClasses({ size: 'lg' })}
                  >
                    {outcome.kind === 'eligible' ? <Gavel className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                    {outcome.kind === 'eligible' ? 'Confirm & Start Petition' : 'Record Determination'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Live panel */}
          <aside className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs h-fit">
              <h3 className="text-sm font-semibold mb-3 text-slate-900 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-600" /> Live Determination
              </h3>
              {outcome ? (
                <p className={`text-sm font-semibold ${outcome.kind === 'eligible' ? 'text-blue-700' : outcome.kind === 'inpatient' ? 'text-rose-700' : 'text-sky-800'}`}>{outcome.label}</p>
              ) : (
                <p className="text-xs text-slate-500">Computes as gates and criteria are answered.</p>
              )}
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-[11px] text-slate-500">
                <p className="flex gap-1.5"><Check className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" aria-hidden /> Eligible per HG § 10-6A-05 = 18+, serious & persistent mental illness, 3-year history prong (2× hospitalizations ≥48 hrs / detention services OR violent act / credible threat), unlikely voluntary adherence, AOT least restrictive for health & safety.</p>
                <p className="flex gap-1.5"><ArrowRight className="h-3.5 w-3.5 shrink-0 mt-0.5 text-sky-700" aria-hidden /> Willing & reliable volunteer → voluntary services, no petition.</p>
                <p className="flex gap-1.5"><ArrowUp className="h-3.5 w-3.5 shrink-0 mt-0.5 text-rose-600" aria-hidden /> Meets inpatient criteria → emergency evaluation, not AOT.</p>
              </div>
              <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                Wording follows Health-General § 10-6A-05 and the MDH AOT Petitioner Filing Checklist — confirm the
                current statute and county practice with program counsel before filing.
              </p>
            </div>
          </aside>
        </div>
      )}

      {/* ===================================================================
          TAB — PSYCHIATRIC EVALUATION (court affidavit instrument)
      =================================================================== */}
      {tab === 'psycheval' && active && (() => {
        const ev = getEval(active.id);
        const examAgeDays = ev.examDate ? Math.round((pageOpenedAt - new Date(ev.examDate).getTime()) / 86400000) : null;
        const examStale = examAgeDays !== null && examAgeDays > 30;
        return (
          <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex flex-wrap items-center gap-3">
            <FileText className="h-4 w-4 text-blue-600 shrink-0" />
            <p className="text-sm text-blue-800 flex-1">
              This is the examination worksheet. The court filing is the MDH Psychiatrist Affidavit (MDH#0004BHA),
              signed by a psychiatrist in Forms &amp; Outreach; it prefills from the exam date and paragraphs below.
            </p>
            <button onClick={() => setTab('forms')} className="text-xs font-semibold text-blue-700 hover:underline">Open MDH forms</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {/* Participant + exam details */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> {personLabel(active.status)}
                    </label>
                    <select
                      value={activeId}
                      onChange={(e) => setActiveId(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {participants.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <CalendarDays className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Examination Date
                    </label>
                    <input
                      type="date"
                      value={ev.examDate}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, examDate: e.target.value }))}
                      disabled={ev.signed}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Examination Mode</label>
                    <div className="flex gap-1.5">
                      {['In person', 'Telehealth'].map((m) => (
                        <button
                          key={m}
                          onClick={() => !ev.signed && updateEval(active.id, (x) => ({ ...x, mode: m }))}
                          className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                            ev.mode === m ? 'bg-blue-700 border-blue-700 text-white' : 'border-slate-200 text-slate-500 hover:border-slate-300'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Duration (minutes)</label>
                    <input
                      value={ev.durationMin}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, durationMin: e.target.value }))}
                      disabled={ev.signed}
                      placeholder="e.g., 55"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                    />
                  </div>
                </div>
                {examStale && !ev.signed && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      Exam was {examAgeDays} days ago. MDH: &ldquo;{MDH_AFFIDAVIT_TIMING_TEXT}&rdquo;{' '}
                      <strong>{MDH_AFFIDAVIT_TIMING_CAVEAT}</strong> This is a warning only; nothing is blocked.
                    </p>
                  </div>
                )}
                {/* Sources reviewed */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Sources of Information</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {EVAL_SOURCES.map((s) => {
                      const checked = ev.sources.includes(s);
                      return (
                        <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                          checked ? 'border-blue-300 bg-blue-50 text-blue-800 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={ev.signed}
                            onChange={() => updateEval(active.id, (x) => ({ ...x, sources: checked ? x.sources.filter((i) => i !== s) : [...x.sources, s] }))}
                            className="w-3.5 h-3.5 rounded text-blue-600 focus:ring-blue-500"
                          />
                          {s}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* MSE + diagnosis */}
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-blue-500" /> Examination Findings
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {EVAL_MSE.map((m) => (
                    <div key={m.key}>
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{m.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.options.map((o) => (
                          <button
                            key={o}
                            onClick={() => !ev.signed && updateEval(active.id, (x) => ({ ...x, mse: { ...x.mse, [m.key]: o } }))}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                              ev.mse[m.key] === o ? 'bg-blue-600 border-blue-600 text-white' : 'border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50'
                            }`}
                          >
                            {o}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Diagnosis (ICD-10)</p>
                    <select
                      value={ev.diagnosis}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, diagnosis: e.target.value }))}
                      disabled={ev.signed}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                    >
                      <option value="">Select diagnosis…</option>
                      {EVAL_DIAGNOSES.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Capacity & Insight Assessment</p>
                    <input
                      value={ev.capacity}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, capacity: e.target.value }))}
                      disabled={ev.signed}
                      placeholder="e.g., Lacks insight into illness; does not appreciate need for treatment"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                    />
                  </div>
                </div>
              </div>

              {/* Factual basis per criterion */}
              <div className="bg-white rounded-xl border-2 border-slate-200 p-5 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Gavel className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-semibold text-slate-700 min-w-0 flex-1">Factual Basis — Affidavit Core</h3>
                  {!ev.signed && (
                    <button
                      onClick={() => draftEvalBasis(active)}
                      disabled={evalAiLoading}
                      className={buttonClasses({ size: 'sm' })}
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {evalAiLoading ? 'Drafting…' : 'AI Draft from Record'}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500 -mt-1">
                  The court weighs the affidavit on these paragraphs — each criterion needs specific, dated facts, not
                  conclusions. AI drafts from the screening and chart; the psychiatrist edits and owns every word.
                  <span className="ml-1 font-semibold text-blue-500">AWS Bedrock — fills only empty paragraphs.</span>
                </p>
                {evalAiError && <p className="text-xs text-rose-600">No AI draft: {evalAiError}</p>}
                {BASIS_FIELDS.map((b) => (
                  <div key={b.key}>
                    <p className="text-xs font-semibold text-slate-600 mb-1">{b.label}</p>
                    <textarea
                      value={ev.basis[b.key]}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, basis: { ...x.basis, [b.key]: e.target.value } }))}
                      disabled={ev.signed}
                      rows={2}
                      placeholder={b.hint}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-700 leading-relaxed placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50"
                    />
                  </div>
                ))}
              </div>

              {/* Proposed treatment plan */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-blue-500" /> Proposed Court-Ordered Treatment
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {EVAL_PLAN_OPTIONS.map((opt) => {
                    const checked = ev.plan.includes(opt);
                    return (
                      <label key={opt} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                        checked ? 'border-sky-300 bg-sky-50 text-sky-800 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={ev.signed}
                          onChange={() => updateEval(active.id, (x) => ({ ...x, plan: checked ? x.plan.filter((i) => i !== opt) : [...x.plan, opt] }))}
                          className="w-3.5 h-3.5 rounded text-sky-700 focus:ring-sky-500"
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Sign */}
              {ev.signed ? (
                <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 p-5 flex flex-wrap items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700 shrink-0" />
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-semibold text-emerald-800">Evaluation worksheet signed</p>
                    <p className="text-xs text-emerald-700">
                      Signed electronically and locked. File the MDH Psychiatrist Affidavit (MDH#0004BHA) from
                      Forms &amp; Outreach; signing it clears the affidavit deadline.
                    </p>
                  </div>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-emerald-300 text-emerald-700 text-sm font-semibold hover:bg-emerald-100">
                    <Printer className="h-4 w-4" /> Print Affidavit
                  </button>
                  <button onClick={() => setTab('workflow')} className={buttonClasses()}>
                    <Gavel className="h-4 w-4" /> Court Timeline
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <label className={`flex items-start gap-2.5 cursor-pointer select-none rounded-lg border-2 p-3 mb-2 transition-colors ${ev.testify ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <input
                      type="checkbox"
                      checked={ev.testify}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, testify: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-xs text-slate-700 leading-relaxed">
                      <strong>I am willing and able to testify at the hearing on the petition.</strong> (Required in the
                      affidavit by HG § 10-6A-05 — the affidavit paragraphs above are the testimony outline.)
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 select-none rounded-lg border border-slate-200 p-3 mb-3">
                    <Shield className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-slate-600 leading-relaxed">
                      I certify that I personally examined the respondent on the date stated; that the facts set forth
                      are true to the best of my knowledge; and that in my
                      professional opinion the respondent meets the criteria for assisted outpatient treatment under
                      Health-General § 10-6A-05, with the proposed plan being the least restrictive alternative
                      appropriate to maintain the respondent&apos;s health and safety. Electronic signature and timestamp are
                      applied on signing.
                    </span>
                  </label>
                  <div className="flex justify-end">
                    {signError && <p className="text-xs text-rose-600 self-center mr-3">Not signed: {signError}</p>}
                    <button
                      onClick={() => signEval(active)}
                      disabled={!evalComplete(ev) || signing}
                      title={!evalComplete(ev) ? 'Complete exam date, diagnosis, all five factual-basis paragraphs, capacity, and at least one treatment element' : ''}
                      className={buttonClasses({ size: 'lg' })}
                    >
                      <Save className="h-4 w-4" /> {signing ? 'Saving…' : 'Sign Evaluation Worksheet'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail — readiness checklist */}
            <aside className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs h-fit">
                <h3 className="text-sm font-semibold mb-3 text-slate-900 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-blue-600" /> Evaluation Readiness
                </h3>
                <div className="space-y-1.5">
                  {[
                    { ok: !!ev.examDate && !examStale, label: ev.examDate ? (examStale ? 'Exam date over 30 days ago (warning; confirm timing with counsel)' : 'Exam date recorded (confirm timing with counsel)') : 'Examination date' },
                    { ok: ev.sources.length >= 2, label: 'Two or more information sources' },
                    { ok: Object.values(ev.mse).every(Boolean), label: 'Mental status findings complete' },
                    { ok: !!ev.diagnosis, label: 'Qualifying diagnosis selected' },
                    { ok: BASIS_FIELDS.every((b) => ev.basis[b.key].trim().length > 0), label: 'Factual basis for all five criteria' },
                    { ok: !!ev.capacity.trim(), label: 'Capacity & insight assessed' },
                    { ok: ev.plan.length > 0, label: 'Proposed treatment plan elements' },
                    { ok: ev.testify, label: 'Willing & able to testify (§ 10-6A-05)' },
                    { ok: ev.signed, label: 'Signed & timestamped' },
                  ].map((c) => (
                    <p key={c.label} className={`text-xs flex items-center gap-1.5 ${c.ok ? 'text-emerald-700' : 'text-slate-500'}`}>
                      {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {c.label}
                    </p>
                  ))}
                </div>
                <p className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-500">
                  Signing locks this worksheet. The court affidavit is the MDH Psychiatrist Affidavit (MDH#0004BHA) in
                  Forms &amp; Outreach; it prefills from these paragraphs, and signing it clears the affidavit deadline.
                  {MDH_AFFIDAVIT_TIMING_CAVEAT}
                </p>
              </div>
              {active.hearingDate && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                  <CalendarDays className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                  <p className="text-sm text-blue-800">
                    <strong>{active.name}</strong> hears on <strong>{active.hearingDate}</strong>. The psychiatrist should
                    be prepared to testify to these findings — the affidavit paragraphs are the testimony outline.
                  </p>
                </div>
              )}
            </aside>
          </div>
          </div>
        );
      })()}

      {/* ===================================================================
          TAB — COURT WORKFLOW & DOCUMENTATION
      =================================================================== */}
      {(tab === 'psycheval' || tab === 'workflow' || tab === 'forms' || tab === 'team') && !active && (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
          No AOT cases yet. Complete an eligibility screen to open a case.
        </div>
      )}

      {tab === 'workflow' && active && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: participant + timeline flags */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{personLabel(active.status)}</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                ))}
              </select>
              <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                <p className="flex items-center gap-1.5"><Gavel className="h-3 w-3" /> {active.county}</p>
                <p className="flex items-center gap-1.5"><HeartPulse className="h-3 w-3" /> {active.diagnosis}</p>
                {active.petitionDate && <p className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Petition filed {active.petitionDate}</p>}
                {active.hearingDate && <p className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" /> Hearing {active.hearingDate}</p>}
                {active.orderStart && <p className="flex items-center gap-1.5"><BadgeCheck className="h-3 w-3" /> Order {active.orderStart} → {active.orderEnd}</p>}
              </div>
              {active.cctOperational === false && countyRecorded(active.county) && (
                <p className="mt-2 text-[11px] text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5 flex gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" /> {NO_CCT_NOTE}
                </p>
              )}
              {['hearing', 'active', 'renewal', 'stepdown'].includes(active.status) && (() => {
                const d = orderDraft[active.id] ?? { start: active.orderStart ?? '', end: active.orderEnd ?? '' };
                const problem = orderTermProblem(d.start, d.end);
                const latest = maxOrderEnd(d.start);
                const setD = (patch: Partial<{ start: string; end: string }>) => setOrderDraft((prev) => ({ ...prev, [active.id]: { ...d, ...patch } }));
                return (
                  <div className="mt-3 pt-3 border-t border-slate-100">
                    <p className="text-xs font-semibold text-slate-600 mb-1">Order term</p>
                    <p className="text-[11px] text-slate-500 mb-2">MDH: &ldquo;{MDH_PARTICIPANT_TEXT}&rdquo;</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-[11px] text-slate-500">
                        Start
                        <input type="date" value={d.start} onChange={(e) => setD({ start: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800" />
                      </label>
                      <label className="text-[11px] text-slate-500">
                        End
                        <input type="date" value={d.end} max={latest ?? undefined} onChange={(e) => setD({ end: e.target.value })} className="mt-0.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-800" />
                      </label>
                    </div>
                    {latest && <p className="text-[11px] text-slate-500 mt-1">Latest allowed end date: {latest}</p>}
                    {problem && <p className="text-[11px] text-rose-600 mt-1">{problem}</p>}
                    {orderMsg && orderMsg.id === active.id && (
                      <p className={`text-[11px] mt-1 ${orderMsg.error ? 'text-rose-600' : 'text-emerald-700'}`}>{orderMsg.text}</p>
                    )}
                    <button
                      onClick={() => saveOrderDates(active)}
                      disabled={orderBusy || !d.start || !d.end || !!problem}
                      className={buttonClasses({ size: 'sm', className: 'mt-2' })}
                    >
                      {orderBusy ? 'Saving…' : 'Save order dates'}
                    </button>
                  </div>
                );
              })()}
              {/* status stepper */}
              <div className="mt-4">
                <div className="flex gap-1 mb-1.5">
                  {STATUS_STEPS.map((s, i) => (
                    <div key={s.id} className={`h-1.5 flex-1 rounded-full ${i <= statusIndex(active.status) ? 'bg-blue-500' : 'bg-slate-100'}`} />
                  ))}
                </div>
                <p className="text-[11px] text-slate-500">Stage: <span className="font-semibold text-blue-600">{STATUS_BADGE[active.status].label}</span></p>
              </div>
            </div>

            {/* Timeline flags */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <Flag className="h-4 w-4 text-rose-600" /> Flagged Timelines
              </h3>
              <div className="space-y-2.5">
                {[...active.deadlines].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.daysLeft - b.daysLeft).map((d) => {
                  const fb = FLAG_BADGE[d.status];
                  return (
                    <div key={d.id} className="flex gap-2.5">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${fb.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-semibold ${d.status === 'done' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{d.label}</p>
                        <p className="text-[11px] text-slate-500">{d.basis}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full border ${fb.cls}`}>{fb.label}</span>
                        {d.status !== 'done' && (
                          <p className={`text-[11px] font-semibold mt-0.5 ${d.daysLeft < 0 ? 'text-rose-600' : d.daysLeft <= 3 ? 'text-amber-700' : 'text-slate-500'}`}>
                            {d.daysLeft < 0 ? `${-d.daysLeft}d overdue` : d.daysLeft === 0 ? 'today' : `${d.due} · ${d.daysLeft}d`}
                          </p>
                        )}
                        {d.status !== 'done' && d.label.toLowerCase().includes('affidavit') && (
                          <button
                            onClick={() => setTab('psycheval')}
                            className="text-[11px] font-semibold text-blue-600 hover:underline block ml-auto mt-0.5"
                          >
                            Open Psych Eval <ChevronRight className="inline h-3 w-3" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MDH forms for this participant */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" /> MDH AOT Forms
              </h3>
              {(active.formFlags ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">No form deadlines flagged.</p>
              ) : (
                <ul className="space-y-1 mb-2">
                  {(active.formFlags ?? []).map((f) => (
                    <li key={f.id} className={`text-xs ${f.status === 'overdue' ? 'text-rose-700' : f.status === 'due' ? 'text-amber-800' : 'text-slate-700'}`}>
                      {f.label}{f.due ? ` · due ${f.due}` : ''}
                    </li>
                  ))}
                </ul>
              )}
              <button
                onClick={() => setTab('forms')}
                className="mt-1 text-xs font-semibold text-blue-700 hover:underline inline-flex items-center gap-1"
              >
                Open Forms &amp; Outreach <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* Right: documentation & escalation */}
          <div className="lg:col-span-2 space-y-4">
            <PetitionChecklist
              key={active.id}
              participantId={active.id}
              status={active.status}
              initial={active.petitionChecklist ?? {}}
              onSaved={(c) =>
                setParticipants((prev) =>
                  prev.map((x) =>
                    x.id === active.id
                      ? {
                          ...x,
                          petitionChecklist: c,
                          checklistFlags: petitionChecklistFlags(x.status, c),
                        }
                      : x,
                  ),
                )
              }
            />
            {/* Non-adherence & escalation */}
            <div className={`bg-white rounded-xl border-2 p-4 ${active.nonAdherence.length ? 'border-rose-200' : 'border-slate-200'}`}>
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <ShieldAlert className={`h-4 w-4 ${active.nonAdherence.length ? 'text-rose-600' : 'text-slate-500'}`} /> Non-Adherence & Escalation
              </h3>
              {active.nonAdherence.length === 0 ? (
                <p className="text-xs text-slate-500">No non-adherence events this order period.</p>
              ) : (
                <div className="space-y-2">
                  {active.nonAdherence.map((n, i) => (
                    <div key={i} className="flex gap-2.5 text-xs border-b border-slate-50 last:border-0 pb-2 last:pb-0">
                      <span className="font-mono text-slate-500 shrink-0">{n.date}</span>
                      <div>
                        <p className="font-semibold text-slate-800">{n.event}</p>
                        <p className="text-slate-500">Response: {n.action}</p>
                      </div>
                    </div>
                  ))}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    <strong>Escalation ladder (engagement-first):</strong> 1) same-day outreach → 2) peer/home visit → 3)
                    care-team review & plan adjustment → 4) notify the court with a recommendation. Non-adherence is never
                    itself grounds for arrest — the order&apos;s remedy is treatment engagement, and any transport for
                    evaluation uses the Mobile Crisis workflow.
                  </div>
                </div>
              )}
            </div>

            {/* Contact log quick entry */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                <PenLine className="h-4 w-4 text-blue-500" /> Contact Log
              </h3>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <select
                  value={contactWho}
                  onChange={(e) => setContactWho(e.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 sm:w-52"
                >
                  <option value="">Team member…</option>
                  {active.team.map((t) => (
                    <option key={t.role} value={t.name}>{t.name} — {t.role}</option>
                  ))}
                </select>
                <button
                  onClick={logContact}
                  disabled={!contactWho || contactBusy}
                  className={buttonClasses({ size: 'sm' })}
                >
                  {contactBusy ? 'Saving…' : 'Log Contact'}
                </button>
              </div>
              {contactMsg && (
                <p className={`text-xs ${contactMsg.error ? 'text-rose-600' : 'text-emerald-700'}`}>{contactMsg.text}</p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Logging a contact saves today&apos;s date as that team member&apos;s last contact and updates their cadence status.
                Contact details go in a <a href="/dashboard/ehr/notes" className="underline">progress note</a> — AOT contact notes are not stored here yet.
              </p>
            </div>

            {/* AI court report */}
            <div className="bg-white rounded-xl border-2 border-slate-200 p-4">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-blue-500" />
                <h3 className="text-sm font-semibold text-slate-700 min-w-0 flex-1">AI Court Status Report</h3>
                <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">AWS Bedrock · AI draft</span>
              </div>
              {reportError && <p className="text-xs text-rose-600 mb-2">No AI draft: {reportError}</p>}
              {aiReport[active.id] ? (
                <>
                  <textarea
                    value={aiReport[active.id]}
                    onChange={(e) => setAiReport((prev) => ({ ...prev, [active.id]: e.target.value }))}
                    rows={10}
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Drafted from the contact log, deadline record, and non-adherence events — AOT coordinator reviews,
                    edits, and signs before filing with the court.
                  </p>
                </>
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <p className="text-xs text-slate-500 sm:flex-1">
                    Drafts the periodic status report the court expects — adherence, team contacts, events, and a
                    recommendation — from what&apos;s already documented here.
                  </p>
                  <button
                    onClick={() => draftCourtReport(active)}
                    disabled={aiLoading === active.id}
                    className={buttonClasses({ size: 'sm', className: 'shrink-0' })}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {aiLoading === active.id ? 'Drafting…' : 'Draft Report'}
                  </button>
                </div>
              )}
            </div>

            {/* Related documentation links */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-slate-500" /> Related Documentation
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {[
                  { label: 'MDH AOT forms (treatment plan, affidavit, letters)', href: `/dashboard/aot?participant=${encodeURIComponent(active.id)}&tab=forms` },
                  { label: 'Chart treatment plans', href: '/dashboard/ehr/treatment-plans' },
                  { label: 'Progress Notes', href: '/dashboard/ehr/notes' },
                  { label: 'C-SSRS / Risk Assessments', href: '/dashboard/ehr/assessments/cssrs' },
                  { label: 'Mobile Crisis (if escalation needed)', href: '/dashboard/crisis' },
                  { label: 'E-Prescribing / Med Adherence', href: '/dashboard/ehr/prescriptions' },
                  { label: 'Eligibility & Payer Verification', href: '/dashboard/ehr/eligibility' },
                ].map((l) => (
                  <a key={l.href} href={l.href} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-blue-700">
                    <ChevronRight className="h-3.5 w-3.5 text-slate-500" /> {l.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — FORMS & OUTREACH (MDH AOT forms, revised 06/25/2026)
      =================================================================== */}
      {tab === 'forms' && active && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{personLabel(active.status)}</label>
              <select
                value={active.id}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 sm:text-right">
              Maryland Department of Health AOT forms. Staff review, sign,<br className="hidden sm:block" /> print or save as PDF and send them; nothing goes to the state automatically.
            </p>
          </div>
          <AotFormsWorkspace key={active.id} participantId={active.id} participantName={active.name} />
        </div>
      )}

      {/* ===================================================================
          TAB — CARE TEAM
      =================================================================== */}
      {tab === 'team' && active && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{personLabel(active.status)}</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full sm:w-80 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-slate-500 sm:text-right">
              Every ordered service has an owner and a cadence —<br className="hidden sm:block" /> the board flags whoever falls behind.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.team.map((t) => (
              <div
                key={t.role}
                className={`bg-white rounded-xl border-2 p-4 ${t.status === 'overdue' ? 'border-rose-200' : t.status === 'due' ? 'border-amber-200' : 'border-slate-200'}`}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-semibold shrink-0">
                    {t.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">{t.name}</p>
                    <p className="text-[11px] text-slate-500">{t.role}</p>
                  </div>
                </div>
                <div className="space-y-1 text-[11px] text-slate-500">
                  <p className="flex justify-between"><span>Cadence</span><span className="font-semibold text-slate-700">{t.cadence}</span></p>
                  <p className="flex justify-between"><span>Last contact</span><span className="font-semibold text-slate-700">{t.lastContact}</span></p>
                  <p className="flex justify-between"><span>Next due</span><span className="font-semibold text-slate-700">{t.nextDue}</span></p>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${
                    t.status === 'current' ? 'text-emerald-700' : t.status === 'due' ? 'text-amber-700' : 'text-rose-600'
                  }`}>
                    {t.status === 'current' ? <CheckCircle2 className="h-3.5 w-3.5" /> : t.status === 'due' ? <Clock className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {t.status === 'current' ? 'On cadence' : t.status === 'due' ? 'Contact due' : 'Overdue'}
                  </span>
                  <button
                    onClick={() => { setContactWho(t.name); setTab('workflow'); }}
                    className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    Log contact <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
            <h3 className="text-sm font-semibold mb-3 text-slate-900 flex items-center gap-2">
              <Users className="h-4 w-4 text-blue-600" /> Team Roles in the AOT Workflow
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-500">
              {[
                ['AOT Coordinator', 'Owns the case end-to-end: deadlines, court filings, team coordination, status reports.'],
                ['Psychiatrist', 'Affidavit at petition; medication management and monthly reviews under the order.'],
                ['Case Manager', 'Weekly contact, service linkage, benefits & transportation — the engagement backbone.'],
                ['Peer Support (CPRS)', 'Lived-experience engagement — often the first responder to early disengagement.'],
                ['Housing Specialist', 'Housing stability is the top predictor of AOT success — tracked like a clinical service.'],
                ['Family Contact', 'With consent: early-warning observations and support between team contacts.'],
                ['Court Liaison / Counsel', 'Hearing logistics, due-process steps, and the court relationship.'],
              ].map(([role, desc]) => (
                <p key={role} className="flex gap-2"><BadgeCheck className="h-3.5 w-3.5 text-blue-600 shrink-0 mt-0.5" /><span><strong className="text-slate-100">{role}.</strong> {desc}</span></p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MDH contacts (MDH AOT Resource Center) */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-600">
        <p className="flex gap-2">
          <Mail className="h-4 w-4 text-blue-600 shrink-0" />
          <span>
            {MDH_AOT_QUESTIONS_TEXT.replace(MDH_AOT_EMAIL + '.', '')}
            <a href={`mailto:${MDH_AOT_EMAIL}`} className="font-semibold text-blue-700 hover:underline">{MDH_AOT_EMAIL}</a>.
          </span>
        </p>
        <p className="flex gap-2">
          <FileText className="h-4 w-4 text-blue-600 shrink-0" />
          <span>
            AOT complaints and incidents: staff submit the signed AOT Complaint/Incident Report (Forms &amp; Outreach) to{' '}
            <a href={`mailto:${COMPLAINT_SUBMIT_TO}`} className="font-semibold text-blue-700 hover:underline">{COMPLAINT_SUBMIT_TO}</a>.
          </span>
        </p>
        <p className="flex gap-2">
          <Phone className="h-4 w-4 text-blue-600 shrink-0" />
          <span>{MDH_988_TEXT}</span>
        </p>
      </div>
    </Page>
  );
}
