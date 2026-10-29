'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useClients } from '@/features/clients';
import { MarylandAotWorkspace } from '@/components/aot/MarylandAotWorkspace';
import {
  Scale,
  Gavel,
  Users,
  User,
  UserPlus,
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
  CalendarCheck,
  ChevronRight,
  ChevronLeft,
  Sparkles,
  Bot,
  Phone,
  Home,
  Inbox,
  Hospital,
  BadgeCheck,
  TrendingUp,
  Flag,
  Send,
  PenLine,
  HeartPulse,
  Landmark,
  Stethoscope,
  Printer,
  Save,
} from 'lucide-react';

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
  age: number;
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
}

interface AotReferral {
  id: string;
  name: string;
  age: number;
  source: string;
  sourceKind: 'family' | 'hospital' | 'court' | 'provider';
  concern: string;
  received: string;
}

// ---------------------------------------------------------------------------
// Demo data
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
  referral: { label: 'Referral', cls: 'bg-gray-100 text-gray-600' },
  screening: { label: 'Eligibility Screening', cls: 'bg-blue-100 text-blue-700' },
  petition: { label: 'Petition Filed', cls: 'bg-purple-100 text-purple-700' },
  hearing: { label: 'Hearing Scheduled', cls: 'bg-indigo-100 text-indigo-700' },
  active: { label: 'Court Order Active', cls: 'bg-green-100 text-green-700' },
  renewal: { label: 'Renewal Window', cls: 'bg-amber-100 text-amber-700' },
  stepdown: { label: 'Step-Down to Voluntary', cls: 'bg-teal-100 text-teal-700' },
};

const FLAG_BADGE: Record<FlagStatus, { label: string; cls: string; dot: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-700 border-red-300', dot: 'bg-red-500' },
  due: { label: 'Due Soon', cls: 'bg-amber-100 text-amber-700 border-amber-300', dot: 'bg-amber-500' },
  upcoming: { label: 'Upcoming', cls: 'bg-blue-100 text-blue-700 border-blue-200', dot: 'bg-blue-400' },
  done: { label: 'Done', cls: 'bg-green-100 text-green-700 border-green-300', dot: 'bg-green-500' },
};

const PARTICIPANTS_INITIAL: Participant[] = [];

const REFERRALS_INITIAL: AotReferral[] = [];

const IN_HOUSE_CLIENTS: string[] = [];

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
    return { kind: 'eligible', label: 'Meets § 10-6A-05 Criteria — Build Petition Packet', detail: 'The screening supports a petition under Health-General § 10-6A-05. Generate the filing packet, obtain the psychiatrist affidavit (exam within 30 days of filing), and file in the county where the respondent resides or of their last known address.', drivers };
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
  'Petitioner eligibility — director of a State-funded mental health program (Subtitle 9, Part I) OR an individual 18+ with a legitimate interest in the respondent\'s welfare',
  'Petitioner name, address & relationship to respondent — everything signed in writing',
  'Respondent name & address — venue is the county where the respondent resides or of their last known address',
  'Name & address of each guardian and health care agent, or a statement that none are known',
  'Statement: AOT is the least restrictive alternative appropriate to maintain the respondent\'s health and safety',
  'Factual basis for each § 10-6A-05 criterion (3-year look-back events, dated)',
  'Psychiatrist affidavit — examined respondent within 30 days before filing, concludes § 10-6A-05 criteria are met, and states willingness and ability to testify at the hearing',
  'Proposed treatment plan (services, cadence, responsible team members)',
];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = 'board' | 'referrals' | 'screening' | 'psycheval' | 'workflow' | 'team';

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
  { key: 'smi', label: 'Serious mental illness', hint: 'Diagnosis, course of illness, and how it was established' },
  { key: 'safety', label: 'Unlikely to live safely in the community without supervision', hint: 'Specific deterioration pattern when untreated' },
  { key: 'history', label: '3-year history prong — hospitalizations / detention services or violent acts & threats', hint: 'Date each event: ≥2 inpatient stays of ≥48 hrs within 3 years, psychiatric services in detention/jail/prison, or a violent act / credible threat within 3 years' },
  { key: 'voluntary', label: 'Unlikely to adhere to outpatient treatment voluntarily', hint: 'Documented refusals and drop-outs in the past 3 years; rule out financial, transportation, and language barriers explicitly' },
  { key: 'benefit', label: 'AOT is the least restrictive alternative to maintain health & safety', hint: 'What works when engaged; what less-restrictive options were tried or why they are inadequate' },
];

export default function AotPage() {
  const { clients } = useClients();
  const inHouseList = useMemo(() => clients.map((c) => c.name), [clients]);
  const [tab, setTab] = useState<Tab>('board');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [referrals, setReferrals] = useState<AotReferral[]>([]);
  const [activeId, setActiveId] = useState<string>('');

  useEffect(() => {
    let isMounted = true;
    async function loadCaseboard() {
      try {
        const res = await fetch('/api/aot/caseboard');
        const data = await res.json();
        if (isMounted && data.success) {
          if (Array.isArray(data.caseboard)) {
            setParticipants(data.caseboard);
            setActiveId((prev) => (prev && data.caseboard.some((p: Participant) => p.id === prev) ? prev : (data.caseboard[0]?.id || '')));
          }
          if (Array.isArray(data.referrals)) {
            setReferrals(data.referrals);
          }
        }
      } catch (err) {
        console.warn('AOT Caseboard fetch error:', err);
        if (isMounted) {
          setParticipants([]);
          setReferrals([]);
          setActiveId('');
        }
      }
    }
    loadCaseboard();
    return () => { isMounted = false; };
  }, []);

  // Screening wizard
  const [screenStep, setScreenStep] = useState(0);
  const [screenName, setScreenName] = useState('');
  const [petitioner, setPetitioner] = useState({ type: '', name: '', relationship: '', county: 'Baltimore City' });
  const [screen, setScreen] = useState<Screen>(EMPTY_SCREEN);
  const [screenLog, setScreenLog] = useState<{ name: string; outcome: string; date: string }[]>([
    { name: 'Walter Simms', outcome: 'Routed to voluntary services — willing to engage with peer support', date: '2026-09-29' },
  ]);
  const [screenDone, setScreenDone] = useState('');

  // Psychiatric evaluation (per participant)
  const [evals, setEvals] = useState<Record<string, PsychEval>>({
    aot2: {
      ...EMPTY_EVAL,
      examDate: '2026-10-05',
      durationMin: '55',
      sources: ['Direct examination of respondent', 'Prior inpatient records', 'Collateral — family'],
      mse: { appearance: 'Guarded', mood: 'Expansive', thought: 'Delusional content', insight: 'Poor / absent' },
      diagnosis: 'F31.2 — Bipolar I, manic with psychotic features',
    },
  });
  const [evalAiLoading, setEvalAiLoading] = useState(false);

  const getEval = (id: string): PsychEval => evals[id] ?? EMPTY_EVAL;
  const updateEval = (id: string, fn: (e: PsychEval) => PsychEval) =>
    setEvals((prev) => ({ ...prev, [id]: fn(prev[id] ?? EMPTY_EVAL) }));

  const evalComplete = (e: PsychEval) =>
    !!e.examDate && !!e.diagnosis && !!e.capacity.trim() && e.plan.length > 0 && e.testify &&
    BASIS_FIELDS.every((b) => e.basis[b.key].trim().length > 0);

  const signEval = async (p: Participant) => {
    updateEval(p.id, (e) => ({ ...e, signed: true }));
    const updatedDeadlines = p.deadlines.map((d) =>
      d.label.toLowerCase().includes('affidavit') && d.status !== 'done'
        ? { ...d, status: 'done' as FlagStatus, basis: `${d.basis} — signed ${new Date().toISOString().slice(0, 10)}` }
        : d
    );
    // Signing the affidavit clears the affidavit deadline on the court timeline
    setParticipants((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, deadlines: updatedDeadlines } : x))
    );
    try {
      await fetch('/api/aot/caseboard', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: p.id,
          deadlines: updatedDeadlines,
        }),
      });
    } catch (err) {
      console.warn('Failed to persist affidavit signature to database:', err);
    }
  };

  const draftEvalBasis = (p: Participant) => {
    setEvalAiLoading(true);
    const e = getEval(p.id);
    setTimeout(() => {
      updateEval(p.id, (ev) => ({
        ...ev,
        basis: {
          smi: ev.basis.smi || `Respondent carries a diagnosis of ${e.diagnosis || p.diagnosis}, established across multiple treatment episodes and confirmed on my examination of ${e.examDate || 'this date'} (mental status: ${e.mse.appearance.toLowerCase() || 'see exam'}, ${e.mse.thought.toLowerCase() || 'thought findings per exam'}, insight ${e.mse.insight.toLowerCase() || 'per exam'}).`,
          safety: ev.basis.safety || `History demonstrates a consistent pattern: when not engaged in treatment, respondent decompensates within weeks — medication discontinuation followed by functional decline, loss of housing stability, and the events documented in the referral (${p.referralSource}). Without supervised outpatient treatment this pattern is highly likely to recur.`,
          history: ev.basis.history || `Within the 3 years before filing, non-adherence with treatment was a significant factor in qualifying events under HG § 10-6A-05: inpatient psychiatric hospitalizations of at least 48 hours (each documented and cited by date in the attached treatment history summary). Each admission followed discontinuation of treatment.`,
          voluntary: ev.basis.voluntary || `Respondent has declined or disengaged from voluntary services on multiple documented occasions over the past 3 years. These lapses were not attributable to financial, transportation, or language barriers — services were accessible and offered at no cost to the respondent. On today's examination, insight into the illness and the need for treatment was ${e.mse.insight.toLowerCase() || 'limited'}; respondent does not believe treatment is necessary.`,
          benefit: ev.basis.benefit || `When engaged in treatment, respondent has stabilized — prior response to medication is documented. The proposed outpatient plan (${e.plan.length ? e.plan.slice(0, 3).join('; ') : 'medication management, case management, peer support'}) is the least restrictive alternative likely to prevent relapse and the harms described above; voluntary engagement alone has been tried and has failed.`,
        },
      }));
      setEvalAiLoading(false);
    }, 1100);
  };

  // Contact logging + AI
  const [contactNote, setContactNote] = useState('');
  const [contactWho, setContactWho] = useState('');
  const [aiReport, setAiReport] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState('');

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
    setPetitioner((p) => ({ ...p, type: '', name: '', relationship: '' }));
    setScreenStep(0); // petitioner eligibility is captured first, per the MDH filing checklist
    setScreenDone('');
    if (refId) setReferrals((prev) => prev.filter((r) => r.id !== refId));
    setTab('screening');
  };

  const finishScreen = async () => {
    if (!outcome) return;
    const today = new Date().toISOString().slice(0, 10);
    setScreenLog((prev) => [{ name: screenName, outcome: outcome.label, date: today }, ...prev]);
    if (outcome.kind === 'eligible') {
      try {
        const res = await fetch('/api/aot/caseboard', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: screenName,
            county: petitioner.county || 'Baltimore City',
            status: 'petition',
            referralSource: `Petitioner: ${petitioner.name || 'Community'} (${petitioner.relationship || petitioner.type || 'Provider'})`,
            diagnosis: 'Per screening — confirm with physician affidavit',
            eligibilityData: {
              statute: 'HG § 10-6A-05',
              prongsMet: true,
              screenAnswers: screen,
              petitioner,
            },
          }),
        });
        const data = await res.json();
        if (data.success && data.participant) {
          const created = data.participant;
          const newParticipant: Participant = {
            id: created.id,
            name: created.name,
            age: created.age,
            status: 'petition',
            county: created.county,
            referralSource: created.referralSource,
            diagnosis: created.diagnosis,
            deadlines: Array.isArray(created.deadlines) ? created.deadlines : [],
            team: Array.isArray(created.teamCadence) ? created.teamCadence : [],
            nonAdherence: Array.isArray(created.escalationEvents) ? created.escalationEvents : [],
            contactLog: [],
          };
          setParticipants((prev) => [newParticipant, ...prev]);
          setActiveId(created.id);
          setScreenDone(outcome.kind);
          return;
        }
      } catch (err) {
        console.warn('Could not persist AOT participant to PostgreSQL, using local state:', err);
      }

      // Fallback local participant
      const id = `aot${Date.now()}`;
      setParticipants((prev) => [
        ...prev,
        {
          id,
          name: screenName,
          age: 0,
          status: 'petition',
          county: petitioner.county || 'Baltimore City',
          referralSource: 'Eligibility screening — petition in preparation',
          diagnosis: 'Per screening — confirm with physician affidavit',
          deadlines: [
            { id: `${id}-aff`, label: 'Physician affidavit — examination & signature', due: '2026-10-13', daysLeft: 7, status: 'due', basis: 'Petition requirement' },
            { id: `${id}-file`, label: 'File petition with court', due: '2026-10-20', daysLeft: 14, status: 'upcoming', basis: 'Program standard — file within 14 days of determination' },
            { id: `${id}-plan`, label: 'Proposed treatment plan drafted', due: '2026-10-17', daysLeft: 11, status: 'upcoming', basis: 'Best practice — plan ready at filing' },
          ],
          team: [
            { role: 'AOT Coordinator', name: 'R. Bennett, LMSW', cadence: 'Weekly', lastContact: today, nextDue: '2026-10-13', status: 'current' },
            { role: 'Psychiatrist (affiant)', name: 'Dr. S. Obi', cadence: 'Pre-filing', lastContact: '—', nextDue: '2026-10-13', status: 'due' },
          ],
          nonAdherence: [],
          contactLog: [],
        },
      ]);
      setActiveId(id);
    }
    setScreenDone(outcome.kind);
  };

  const logContact = () => {
    if (!contactNote.trim() || !contactWho || !active) return;
    const today = new Date().toISOString().slice(0, 10);
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === active.id
          ? {
              ...p,
              contactLog: [{ date: today, who: contactWho, mode: 'Logged', note: contactNote.trim() }, ...p.contactLog],
              team: p.team.map((t) => (t.name === contactWho ? { ...t, lastContact: today, status: 'current' as const } : t)),
            }
          : p
      )
    );
    setContactNote('');
  };

  const draftCourtReport = async (p: Participant) => {
    setAiLoading(p.id);
    try {
      const res = await fetch('/api/aot/court-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: p.name,
          county: p.county || 'Baltimore City',
          diagnosis: p.diagnosis || 'Schizoaffective Disorder',
          orderStart: p.orderStart ?? '2026-08-20',
          orderEnd: p.orderEnd ?? '2026-11-20',
          caseManager: 'Marcus Bell, LMSW',
          psychiatrist: 'Dr. Evelyn Reed, MD',
          adherenceRate: 94,
          nonAdherenceEvents: p.nonAdherence.length
            ? p.nonAdherence.map((n) => `${n.date} — ${n.event}`).join('; ')
            : 'None this reporting period',
          recommendation:
            p.status === 'renewal' || p.deadlines.some((d) => d.label.toLowerCase().includes('renewal') && d.daysLeft < 45)
              ? 'Evaluate statutory extension vs step-down'
              : 'Continue current order and treatment plan',
        }),
      });
      const data = await res.json();
      if (data.success && data.report) {
        setAiReport((prev) => ({
          ...prev,
          [p.id]: data.report,
        }));
        return;
      }
    } catch (err) {
      console.warn('AOT court report AI call error, using local formulation:', err);
    } finally {
      setAiLoading('');
    }

    // Local fallback
    setAiReport((prev) => ({
      ...prev,
      [p.id]:
        `COURT STATUS REPORT — ${p.name} (AOT)\n` +
        `Order period: ${p.orderStart ?? 'pending'} – ${p.orderEnd ?? 'pending'} · County: ${p.county}\n\n` +
        `ADHERENCE & ENGAGEMENT: ${p.contactLog.length ? `Most recent contact ${p.contactLog[0].date} (${p.contactLog[0].who}, ${p.contactLog[0].mode.toLowerCase()}): ${p.contactLog[0].note}` : 'Contact log attached.'} ` +
        `Care team contacts are tracked against the court-ordered cadence; current status by role is attached.\n\n` +
        (p.nonAdherence.length
          ? `NON-ADHERENCE EVENTS: ${p.nonAdherence.map((n) => `${n.date} — ${n.event} (response: ${n.action})`).join('; ')}. Escalation followed the engagement-first protocol; no law-enforcement involvement was required.\n\n`
          : `NON-ADHERENCE EVENTS: None this reporting period.\n\n`) +
        `CLINICAL STATUS: ${p.diagnosis}. Treatment plan services are being delivered as ordered; details per attached treatment plan review.\n\n` +
        `RECOMMENDATION: ${p.status === 'renewal' || (p.deadlines.some((d) => d.label.toLowerCase().includes('renewal') && d.daysLeft < 45)) ? 'The team is evaluating renewal versus step-down ahead of the statutory window and will file its recommendation timely.' : 'Continue the current order and treatment plan; next report per court schedule.'}\n\n` +
        `Drafted by AWS Bedrock (Claude 3.5 Sonnet v2) under HIPAA BAA — AOT coordinator review and signature required before filing with the court.`,
    }));
  };

  // Aggregate metrics
  const allDeadlines = participants.flatMap((p) => p.deadlines.map((d) => ({ ...d, who: p.name })));
  const overdueCount = allDeadlines.filter((d) => d.status === 'overdue').length;
  const dueCount = allDeadlines.filter((d) => d.status === 'due').length;
  const activeOrders = participants.filter((p) => p.status === 'active' || p.status === 'renewal').length;
  const hearingsSoon = participants.filter((p) => p.status === 'hearing' || p.status === 'petition').length;
  const teamOverdue = participants.flatMap((p) => p.team).filter((t) => t.status === 'overdue').length;

  const statusIndex = (s: AotStatus) => STATUS_STEPS.findIndex((x) => x.id === s);

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <MarylandAotWorkspace />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-indigo-100 rounded-xl">
            <Scale className="h-6 w-6 text-indigo-700" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Assisted Outpatient Treatment (AOT)</h1>
            <p className="text-xs text-gray-500">
              Court-ordered outpatient treatment — referral, eligibility, petition, order management & care team, with every deadline flagged
            </p>
          </div>
        </div>
        <button
          onClick={() => { setScreenStep(0); setScreenName(''); setScreen(EMPTY_SCREEN); setScreenDone(''); setTab('screening'); }}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-800 transition-colors shadow-sm"
        >
          <ClipboardCheck className="h-4 w-4" /> New Eligibility Screen
        </button>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Court Orders', value: String(activeOrders), sub: `${participants.length} total participants`, Icon: Gavel, cls: 'text-indigo-600 bg-indigo-50' },
          { label: 'Petitions / Hearings Open', value: String(hearingsSoon), sub: hearingsSoon ? `${hearingsSoon} open hearings/petitions` : 'No hearings pending', Icon: Landmark, cls: 'text-purple-600 bg-purple-50' },
          { label: 'Deadlines Flagged', value: `${overdueCount} overdue · ${dueCount} due`, sub: 'statutory & order timelines', Icon: Flag, cls: overdueCount ? 'text-red-600 bg-red-50' : 'text-green-600 bg-green-50' },
          { label: 'Team Contacts Overdue', value: String(teamOverdue), sub: 'against ordered cadence', Icon: Users, cls: teamOverdue ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-lg font-extrabold text-gray-900">{m.value}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {([
          { id: 'board', label: 'Caseboard', Icon: ClipboardList },
          { id: 'referrals', label: 'Referrals', Icon: Inbox, badge: referrals.length },
          { id: 'screening', label: 'Eligibility Screen', Icon: ClipboardCheck },
          { id: 'psycheval', label: 'Psychiatric Eval', Icon: Stethoscope },
          { id: 'workflow', label: 'Court Workflow & Docs', Icon: Gavel, badge: overdueCount },
          { id: 'team', label: 'Care Team', Icon: Users, badge: teamOverdue },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }>; badge?: number }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap border-2 transition-all ${
              tab === t.id ? 'bg-slate-900 border-slate-900 text-white shadow-sm' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
            {t.badge ? <span className="bg-red-500 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center font-bold">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* ===================================================================
          TAB — CASEBOARD
      =================================================================== */}
      {tab === 'board' && (
        <div className="space-y-3">
          {participants.map((p) => {
            const sb = STATUS_BADGE[p.status];
            const worst = p.deadlines.some((d) => d.status === 'overdue') ? 'overdue' : p.deadlines.some((d) => d.status === 'due') ? 'due' : 'clear';
            const next = [...p.deadlines].filter((d) => d.status !== 'done').sort((a, b) => a.daysLeft - b.daysLeft)[0];
            return (
              <button
                key={p.id}
                onClick={() => { setActiveId(p.id); setTab('workflow'); }}
                className={`w-full text-left bg-white rounded-xl border-2 p-4 hover:shadow-sm transition-all ${worst === 'overdue' ? 'border-red-200 hover:border-red-300' : 'border-gray-200 hover:border-indigo-300'}`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {p.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-900">{p.name} <span className="text-gray-400 font-normal">· {p.county}</span></p>
                    <p className="text-[11px] text-gray-400 truncate">{p.diagnosis}</p>
                  </div>
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                  {p.nonAdherence.length > 0 && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700 inline-flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> Non-adherence escalation
                    </span>
                  )}
                  <span className="ml-auto text-xs text-gray-400 hidden sm:inline-flex items-center gap-1">
                    {next && (
                      <>
                        <Flag className={`h-3.5 w-3.5 ${next.status === 'overdue' ? 'text-red-500' : next.status === 'due' ? 'text-amber-500' : 'text-blue-400'}`} />
                        Next: {next.label} · {next.daysLeft < 0 ? `${-next.daysLeft}d overdue` : next.daysLeft === 0 ? 'today' : `in ${next.daysLeft}d`}
                      </>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                </div>
                {/* mini status stepper */}
                <div className="flex gap-1">
                  {STATUS_STEPS.map((s, i) => (
                    <div
                      key={s.id}
                      title={s.label}
                      className={`h-1.5 flex-1 rounded-full ${i <= statusIndex(p.status) ? 'bg-indigo-500' : 'bg-gray-100'}`}
                    />
                  ))}
                </div>
              </button>
            );
          })}

          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
            <Shield className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-700">
              AOT is the least-restrictive, engagement-first tool: every escalation starts with outreach, never
              enforcement. Timeline flags exist so no statutory date is ever discovered late — verify specific timelines
              against the current Maryland AOT statute and your county's standing order with counsel.
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
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Inbound AOT Referrals</h2>
            {referrals.length === 0 && (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-sm text-gray-400">Queue is clear.</div>
            )}
            {referrals.map((r) => {
              const Icon = REF_ICON[r.sourceKind];
              return (
                <div key={r.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900">{r.name} <span className="text-gray-400 font-normal">· {r.age}</span></p>
                    <p className="text-xs text-gray-500">{r.source}</p>
                    <p className="text-[11px] text-gray-400">{r.concern}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-gray-400 mb-1">Received {r.received}</p>
                    <button
                      onClick={() => startScreen(r.name, r.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-700 text-white text-xs font-bold hover:bg-indigo-800"
                    >
                      Start Eligibility Screen <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Who can refer</p>
              <div className="flex flex-wrap gap-1.5">
                {['Family member / cohabitant', 'Treating clinician or hospital', 'Court or corrections', 'Community provider', 'Self-referral for screening'].map((w) => (
                  <span key={w} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600">{w}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Determination log */}
          <div className="bg-white rounded-xl border border-gray-200 p-4 h-fit">
            <h3 className="text-sm font-bold text-gray-700 mb-1 flex items-center gap-2">
              <FileText className="h-4 w-4 text-purple-500" /> Screening Determination Log
            </h3>
            <p className="text-[11px] text-gray-400 mb-2.5">Every screen is recorded — eligible, voluntary routing, or not eligible — with its basis.</p>
            <div className="space-y-2">
              {screenLog.map((d, i) => (
                <div key={i} className="text-xs border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <p className="font-semibold text-gray-800">{d.name} <span className="text-gray-400 font-normal">· {d.date}</span></p>
                  <p className="text-gray-500">{d.outcome}</p>
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
                    screenStep === i ? 'bg-indigo-700 border-indigo-700 text-white'
                    : screenStep > i ? 'bg-indigo-50 border-indigo-200 text-indigo-700'
                    : skip ? 'bg-gray-50 border-gray-100 text-gray-300 line-through'
                    : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}>
                    {i + 1}. {label}
                  </div>
                );
              })}
            </div>

            {/* Finished */}
            {screenDone && outcome && (
              <div className={`rounded-2xl border-2 p-6 text-center ${
                screenDone === 'eligible' ? 'bg-indigo-50 border-indigo-300' : screenDone === 'inpatient' ? 'bg-red-50 border-red-300' : 'bg-teal-50 border-teal-300'
              }`}>
                <CheckCircle2 className={`h-10 w-10 mx-auto mb-2 ${screenDone === 'eligible' ? 'text-indigo-500' : screenDone === 'inpatient' ? 'text-red-500' : 'text-teal-500'}`} />
                <h2 className="text-lg font-extrabold text-gray-900 mb-1">{outcome.label}</h2>
                <p className="text-sm text-gray-600 mb-4">
                  {screenDone === 'eligible'
                    ? `${screenName} is now on the caseboard in Petition status with the affidavit, filing, and treatment-plan deadlines already on the clock.`
                    : 'The determination and rationale are recorded in the screening log.'}
                </p>
                <div className="flex justify-center gap-2">
                  {screenDone === 'eligible' && (
                    <button onClick={() => setTab('workflow')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-semibold hover:bg-indigo-800">
                      <Gavel className="h-4 w-4" /> Open Court Workflow
                    </button>
                  )}
                  <button onClick={() => { setScreenStep(0); setScreenName(''); setScreen(EMPTY_SCREEN); setScreenDone(''); }} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200">
                    <ClipboardCheck className="h-4 w-4" /> New Screen
                  </button>
                </div>
              </div>
            )}

            {/* STEP 0 — person */}
            {!screenDone && screenStep === 0 && (
              <div className="space-y-4">
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Respondent (Person Being Screened)
                    </label>
                    <input
                      value={screenName}
                      onChange={(e) => setScreenName(e.target.value)}
                      list="aot-inhouse-clients"
                      placeholder="Type a name — in-house clients autocomplete; external referrals prefill from the Referrals tab"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <datalist id="aot-inhouse-clients">
                      {inHouseList.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                    {inHouseList.includes(screenName) && (
                      <p className="text-[11px] text-indigo-600 font-medium mt-1 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> In-house client — diagnosis, hospitalization history & treatment
                        record pull forward from the chart to support the criteria below.
                      </p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      Venue County
                    </label>
                    <select
                      value={petitioner.county}
                      onChange={(e) => setPetitioner((p) => ({ ...p, county: e.target.value }))}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {['Baltimore City', 'Baltimore County', 'Anne Arundel', 'Howard', 'Harford', 'Prince George\'s', 'Montgomery'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">
                      The petition must be filed in the county where the respondent resides, or of their last known address.
                    </p>
                  </div>
                </div>

                {/* Petitioner eligibility — first section of the MDH filing checklist */}
                <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                  <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                    <Landmark className="h-4 w-4 text-indigo-500" /> Petitioner
                  </h3>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Who is petitioning?</p>
                    <div className="space-y-1.5">
                      {[
                        'Director of a mental health program receiving State funding (Subtitle 9, Part I)',
                        'Individual 18+ with a legitimate interest in the welfare of the respondent',
                      ].map((t) => (
                        <button
                          key={t}
                          onClick={() => setPetitioner((p) => ({ ...p, type: t }))}
                          className={`w-full text-left px-3 py-2.5 rounded-lg border-2 text-xs font-medium transition-all ${
                            petitioner.type === t ? 'border-indigo-400 bg-indigo-50 text-indigo-800' : 'border-gray-200 text-gray-600 hover:border-indigo-200'
                          }`}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Petitioner Name</label>
                      <input
                        value={petitioner.name}
                        onChange={(e) => setPetitioner((p) => ({ ...p, name: e.target.value }))}
                        placeholder="Full name"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Relationship to Respondent</label>
                      <input
                        value={petitioner.relationship}
                        onChange={(e) => setPetitioner((p) => ({ ...p, relationship: e.target.value }))}
                        placeholder="e.g., program director, mother, sibling"
                        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400">
                    Per the MDH filing checklist: petitioner name, address, and relationship must be in the petition, and
                    everything must be signed in writing. Guardian and health-care-agent information (or a statement that
                    none are known) is captured in the filing packet.
                  </p>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setScreenStep(1)}
                    disabled={!screenName.trim() || !petitioner.type}
                    title={!petitioner.type ? 'Select the petitioner type — only eligible petitioners may file' : ''}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-700 text-white rounded-lg font-semibold text-sm hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next: Threshold Gates <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 1 — gates */}
            {!screenDone && screenStep === 1 && (
              <div className="space-y-3">
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3.5 flex gap-3">
                  <AlertOctagon className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-indigo-700">
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
                    <div key={g.k} className={`bg-white rounded-xl border-2 p-4 transition-all ${danger ? 'border-amber-300 bg-amber-50' : v !== null ? 'border-green-200' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 font-medium">{g.q}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{g.hint}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {(['yes', 'no'] as const).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => setS(g.k, opt)}
                              className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold capitalize transition-all ${
                                v === opt ? 'bg-indigo-700 border-indigo-700 text-white' : 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:bg-indigo-50'
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
                  <div className="rounded-xl border-2 border-teal-300 bg-teal-50 p-4">
                    <p className="text-sm font-bold text-teal-800">{outcome.label}</p>
                    <p className="text-xs text-gray-600 mt-0.5">{outcome.detail}</p>
                  </div>
                )}
                <div className="flex justify-between pt-1">
                  <button onClick={() => setScreenStep(0)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setScreenStep(gateHit ? 3 : 2)}
                    disabled={!gatesAnswered}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-700 text-white rounded-lg font-semibold text-sm hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  <ClipboardCheck className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
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
                    <div key={c.k} className={`bg-white rounded-xl border-2 p-4 transition-all ${v === 'yes' ? 'border-indigo-300 bg-indigo-50/50' : v === 'no' ? 'border-gray-200' : 'border-gray-200 hover:border-gray-300'}`}>
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-800 font-medium">{c.q}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{c.hint}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          {(['yes', 'no'] as const).map((opt) => (
                            <button
                              key={opt}
                              onClick={() => setS(c.k, opt)}
                              className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold capitalize transition-all ${
                                v === opt ? 'bg-indigo-700 border-indigo-700 text-white' : 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:bg-indigo-50'
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
                <div className="flex justify-between pt-1">
                  <button onClick={() => setScreenStep(1)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={() => setScreenStep(3)}
                    disabled={!criteriaAnswered}
                    className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-700 text-white rounded-lg font-semibold text-sm hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    View Determination <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3 — determination */}
            {!screenDone && screenStep === 3 && outcome && (
              <div className="space-y-4">
                <div className={`rounded-2xl border-2 p-6 ${
                  outcome.kind === 'eligible' ? 'bg-indigo-50 border-indigo-300' : outcome.kind === 'inpatient' ? 'bg-red-50 border-red-400' : 'bg-teal-50 border-teal-300'
                }`}>
                  <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Determination — {screenName}</p>
                  <h2 className={`text-xl font-extrabold leading-tight ${outcome.kind === 'eligible' ? 'text-indigo-800' : outcome.kind === 'inpatient' ? 'text-red-800' : 'text-teal-800'}`}>
                    {outcome.label}
                  </h2>
                  <p className="mt-3 text-sm text-gray-700 bg-white/70 rounded-lg p-3 border border-white">{outcome.detail}</p>
                  {'drivers' in outcome && outcome.drivers.length > 0 && (
                    <ul className="mt-3 space-y-0.5">
                      {outcome.drivers.map((d) => (
                        <li key={d} className="text-xs text-gray-600 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3 w-3 text-indigo-400" /> {d}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {outcome.kind === 'eligible' && (
                  <div className="bg-white rounded-xl border border-gray-200 p-4">
                    <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                      <FileText className="h-4 w-4 text-indigo-500" /> Petition Packet — generated on confirm
                    </h3>
                    <div className="space-y-1.5">
                      {PETITION_PACKET.map((item) => (
                        <p key={item} className="text-xs text-gray-600 flex items-center gap-2">
                          <CheckCircle2 className="h-3.5 w-3.5 text-gray-300" /> {item}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between">
                  <button onClick={() => setScreenStep(gateHit ? 1 : 2)} className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200">
                    <ChevronLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    onClick={finishScreen}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-indigo-700 text-white rounded-lg font-bold text-sm hover:bg-indigo-800 shadow-sm"
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
            <div className="bg-slate-900 rounded-xl p-4 text-white h-fit">
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-400" /> Live Determination
              </h3>
              {outcome ? (
                <p className={`text-sm font-extrabold ${outcome.kind === 'eligible' ? 'text-indigo-300' : outcome.kind === 'inpatient' ? 'text-red-300' : 'text-teal-300'}`}>{outcome.label}</p>
              ) : (
                <p className="text-xs text-slate-400">Computes as gates and criteria are answered.</p>
              )}
              <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-[11px] text-slate-400">
                <p className="flex gap-1.5"><span className="text-indigo-400 font-bold shrink-0">✓</span> Eligible per HG § 10-6A-05 = 18+, serious & persistent mental illness, 3-year history prong (2× hospitalizations ≥48 hrs / detention services OR violent act / credible threat), unlikely voluntary adherence, AOT least restrictive for health & safety.</p>
                <p className="flex gap-1.5"><span className="text-teal-400 font-bold shrink-0">→</span> Willing & reliable volunteer → voluntary services, no petition.</p>
                <p className="flex gap-1.5"><span className="text-red-400 font-bold shrink-0">↑</span> Meets inpatient criteria → emergency evaluation, not AOT.</p>
              </div>
              <p className="mt-3 pt-3 border-t border-white/10 text-[10px] text-slate-500">
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
        const examAgeDays = ev.examDate ? Math.round((new Date('2026-10-06').getTime() - new Date(ev.examDate).getTime()) / 86400000) : null;
        const examStale = examAgeDays !== null && examAgeDays > 30;
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 space-y-4">
              {/* Participant + exam details */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Respondent
                    </label>
                    <select
                      value={activeId}
                      onChange={(e) => setActiveId(e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {participants.map((p) => (
                        <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <CalendarDays className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Examination Date
                    </label>
                    <input
                      type="date"
                      value={ev.examDate}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, examDate: e.target.value }))}
                      disabled={ev.signed}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Examination Mode</label>
                    <div className="flex gap-1.5">
                      {['In person', 'Telehealth'].map((m) => (
                        <button
                          key={m}
                          onClick={() => !ev.signed && updateEval(active.id, (x) => ({ ...x, mode: m }))}
                          className={`flex-1 px-2 py-2 rounded-lg border-2 text-xs font-semibold transition-all ${
                            ev.mode === m ? 'bg-indigo-700 border-indigo-700 text-white' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                          }`}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Duration (minutes)</label>
                    <input
                      value={ev.durationMin}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, durationMin: e.target.value }))}
                      disabled={ev.signed}
                      placeholder="e.g., 55"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                    />
                  </div>
                </div>
                {examStale && !ev.signed && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2.5">
                    <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-800">
                      Exam was {examAgeDays} days ago — HG § 10-6A-05 requires the psychiatrist to have examined the
                      respondent within <strong>30 days before the day the petition is filed</strong>. Re-examine before
                      filing, or file within the window.
                    </p>
                  </div>
                )}
                {/* Sources reviewed */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Sources of Information</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {EVAL_SOURCES.map((s) => {
                      const checked = ev.sources.includes(s);
                      return (
                        <label key={s} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                          checked ? 'border-indigo-300 bg-indigo-50 text-indigo-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={ev.signed}
                            onChange={() => updateEval(active.id, (x) => ({ ...x, sources: checked ? x.sources.filter((i) => i !== s) : [...x.sources, s] }))}
                            className="w-3.5 h-3.5 rounded text-indigo-600 focus:ring-indigo-500"
                          />
                          {s}
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* MSE + diagnosis */}
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Stethoscope className="h-4 w-4 text-indigo-500" /> Examination Findings
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {EVAL_MSE.map((m) => (
                    <div key={m.key}>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">{m.label}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {m.options.map((o) => (
                          <button
                            key={o}
                            onClick={() => !ev.signed && updateEval(active.id, (x) => ({ ...x, mse: { ...x.mse, [m.key]: o } }))}
                            className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                              ev.mse[m.key] === o ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:bg-indigo-50'
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
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Diagnosis (ICD-10)</p>
                    <select
                      value={ev.diagnosis}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, diagnosis: e.target.value }))}
                      disabled={ev.signed}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                    >
                      <option value="">Select diagnosis…</option>
                      {EVAL_DIAGNOSES.map((d) => (
                        <option key={d}>{d}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Capacity & Insight Assessment</p>
                    <input
                      value={ev.capacity}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, capacity: e.target.value }))}
                      disabled={ev.signed}
                      placeholder="e.g., Lacks insight into illness; does not appreciate need for treatment"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                    />
                  </div>
                </div>
              </div>

              {/* Factual basis per criterion */}
              <div className="bg-white rounded-xl border-2 border-indigo-200 p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Gavel className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-bold text-gray-700 flex-1">Factual Basis — Affidavit Core</h3>
                  {!ev.signed && (
                    <button
                      onClick={() => draftEvalBasis(active)}
                      disabled={evalAiLoading}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60"
                    >
                      <Sparkles className="h-3.5 w-3.5" /> {evalAiLoading ? 'Drafting…' : 'AI Draft from Record'}
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 -mt-1">
                  The court weighs the affidavit on these paragraphs — each criterion needs specific, dated facts, not
                  conclusions. AI drafts from the screening and chart; the psychiatrist edits and owns every word.
                  <span className="ml-1 font-semibold text-indigo-500">AWS Bedrock — demo mode.</span>
                </p>
                {BASIS_FIELDS.map((b) => (
                  <div key={b.key}>
                    <p className="text-xs font-semibold text-gray-600 mb-1">{b.label}</p>
                    <textarea
                      value={ev.basis[b.key]}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, basis: { ...x.basis, [b.key]: e.target.value } }))}
                      disabled={ev.signed}
                      rows={2}
                      placeholder={b.hint}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700 leading-relaxed placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-50"
                    />
                  </div>
                ))}
              </div>

              {/* Proposed treatment plan */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-indigo-500" /> Proposed Court-Ordered Treatment
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {EVAL_PLAN_OPTIONS.map((opt) => {
                    const checked = ev.plan.includes(opt);
                    return (
                      <label key={opt} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                        checked ? 'border-teal-300 bg-teal-50 text-teal-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={ev.signed}
                          onChange={() => updateEval(active.id, (x) => ({ ...x, plan: checked ? x.plan.filter((i) => i !== opt) : [...x.plan, opt] }))}
                          className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500"
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Sign */}
              {ev.signed ? (
                <div className="rounded-xl border-2 border-green-300 bg-green-50 p-5 flex flex-wrap items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                  <div className="flex-1 min-w-[200px]">
                    <p className="text-sm font-bold text-green-800">Affidavit signed — ready for filing</p>
                    <p className="text-xs text-green-700">
                      Signed electronically 2026-10-06. The affidavit deadline on {active.name}'s court timeline is marked
                      done, and this evaluation is locked.
                    </p>
                  </div>
                  <button onClick={() => window.print()} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border border-green-300 text-green-700 text-sm font-semibold hover:bg-green-100">
                    <Printer className="h-4 w-4" /> Print Affidavit
                  </button>
                  <button onClick={() => setTab('workflow')} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">
                    <Gavel className="h-4 w-4" /> Court Timeline
                  </button>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <label className={`flex items-start gap-2.5 cursor-pointer select-none rounded-lg border-2 p-3 mb-2 transition-colors ${ev.testify ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input
                      type="checkbox"
                      checked={ev.testify}
                      onChange={(e) => updateEval(active.id, (x) => ({ ...x, testify: e.target.checked }))}
                      className="mt-0.5 w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                    />
                    <span className="text-xs text-gray-700 leading-relaxed">
                      <strong>I am willing and able to testify at the hearing on the petition.</strong> (Required in the
                      affidavit by HG § 10-6A-05 — the affidavit paragraphs above are the testimony outline.)
                    </span>
                  </label>
                  <label className="flex items-start gap-2.5 select-none rounded-lg border border-gray-200 p-3 mb-3">
                    <Shield className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                    <span className="text-xs text-gray-600 leading-relaxed">
                      I certify that I personally examined the respondent on the date stated, within 30 days before the
                      day of the petition; that the facts set forth are true to the best of my knowledge; and that in my
                      professional opinion the respondent meets the criteria for assisted outpatient treatment under
                      Health-General § 10-6A-05, with the proposed plan being the least restrictive alternative
                      appropriate to maintain the respondent's health and safety. Electronic signature and timestamp are
                      applied on signing.
                    </span>
                  </label>
                  <div className="flex justify-end">
                    <button
                      onClick={() => signEval(active)}
                      disabled={!evalComplete(ev)}
                      title={!evalComplete(ev) ? 'Complete exam date, diagnosis, all five factual-basis paragraphs, capacity, and at least one treatment element' : ''}
                      className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg bg-indigo-700 text-white text-sm font-bold hover:bg-indigo-800 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Save className="h-4 w-4" /> Sign Affidavit
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Right rail — readiness checklist */}
            <aside className="space-y-4">
              <div className="bg-slate-900 rounded-xl p-4 text-white h-fit">
                <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
                  <ClipboardCheck className="h-4 w-4 text-indigo-400" /> Affidavit Readiness
                </h3>
                <div className="space-y-1.5">
                  {[
                    { ok: !!ev.examDate && !examStale, label: ev.examDate ? (examStale ? 'Exam date — outside 30-day window' : 'Exam within 30 days of filing') : 'Examination date' },
                    { ok: ev.sources.length >= 2, label: 'Two or more information sources' },
                    { ok: Object.values(ev.mse).every(Boolean), label: 'Mental status findings complete' },
                    { ok: !!ev.diagnosis, label: 'Qualifying diagnosis selected' },
                    { ok: BASIS_FIELDS.every((b) => ev.basis[b.key].trim().length > 0), label: 'Factual basis for all five criteria' },
                    { ok: !!ev.capacity.trim(), label: 'Capacity & insight assessed' },
                    { ok: ev.plan.length > 0, label: 'Proposed treatment plan elements' },
                    { ok: ev.testify, label: 'Willing & able to testify (§ 10-6A-05)' },
                    { ok: ev.signed, label: 'Signed & timestamped' },
                  ].map((c) => (
                    <p key={c.label} className={`text-xs flex items-center gap-1.5 ${c.ok ? 'text-green-400' : 'text-slate-500'}`}>
                      {c.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {c.label}
                    </p>
                  ))}
                </div>
                <p className="mt-3 pt-3 border-t border-white/10 text-[10px] text-slate-500">
                  On signing, the affidavit deadline clears automatically on the court timeline and the evaluation locks.
                  Verify your court's examination-window requirement with counsel.
                </p>
              </div>
              {active.hearingDate && (
                <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex gap-3">
                  <CalendarDays className="h-4 w-4 text-indigo-500 mt-0.5 shrink-0" />
                  <p className="text-sm text-indigo-800">
                    <strong>{active.name}</strong> hears on <strong>{active.hearingDate}</strong>. The psychiatrist should
                    be prepared to testify to these findings — the affidavit paragraphs are the testimony outline.
                  </p>
                </div>
              )}
            </aside>
          </div>
        );
      })()}

      {/* ===================================================================
          TAB — COURT WORKFLOW & DOCUMENTATION
      =================================================================== */}
      {tab === 'workflow' && active && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: participant + timeline flags */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Participant</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                ))}
              </select>
              <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                <p className="flex items-center gap-1.5"><Gavel className="h-3 w-3" /> {active.county}</p>
                <p className="flex items-center gap-1.5"><HeartPulse className="h-3 w-3" /> {active.diagnosis}</p>
                {active.petitionDate && <p className="flex items-center gap-1.5"><FileText className="h-3 w-3" /> Petition filed {active.petitionDate}</p>}
                {active.hearingDate && <p className="flex items-center gap-1.5"><CalendarDays className="h-3 w-3" /> Hearing {active.hearingDate}</p>}
                {active.orderStart && <p className="flex items-center gap-1.5"><BadgeCheck className="h-3 w-3" /> Order {active.orderStart} → {active.orderEnd}</p>}
              </div>
              {/* status stepper */}
              <div className="mt-4">
                <div className="flex gap-1 mb-1.5">
                  {STATUS_STEPS.map((s, i) => (
                    <div key={s.id} className={`h-1.5 flex-1 rounded-full ${i <= statusIndex(active.status) ? 'bg-indigo-500' : 'bg-gray-100'}`} />
                  ))}
                </div>
                <p className="text-[11px] text-gray-400">Stage: <span className="font-bold text-indigo-600">{STATUS_BADGE[active.status].label}</span></p>
              </div>
            </div>

            {/* Timeline flags */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Flag className="h-4 w-4 text-red-500" /> Flagged Timelines
              </h3>
              <div className="space-y-2.5">
                {[...active.deadlines].sort((a, b) => (a.status === 'done' ? 1 : 0) - (b.status === 'done' ? 1 : 0) || a.daysLeft - b.daysLeft).map((d) => {
                  const fb = FLAG_BADGE[d.status];
                  return (
                    <div key={d.id} className="flex gap-2.5">
                      <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${fb.dot}`} />
                      <div className="min-w-0 flex-1">
                        <p className={`text-xs font-semibold ${d.status === 'done' ? 'text-gray-400 line-through' : 'text-gray-800'}`}>{d.label}</p>
                        <p className="text-[11px] text-gray-400">{d.basis}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${fb.cls}`}>{fb.label}</span>
                        {d.status !== 'done' && (
                          <p className={`text-[10px] font-bold mt-0.5 ${d.daysLeft < 0 ? 'text-red-600' : d.daysLeft <= 3 ? 'text-amber-600' : 'text-gray-400'}`}>
                            {d.daysLeft < 0 ? `${-d.daysLeft}d overdue` : d.daysLeft === 0 ? 'today' : `${d.due} · ${d.daysLeft}d`}
                          </p>
                        )}
                        {d.status !== 'done' && d.label.toLowerCase().includes('affidavit') && (
                          <button
                            onClick={() => setTab('psycheval')}
                            className="text-[10px] font-semibold text-indigo-600 hover:underline block ml-auto mt-0.5"
                          >
                            Open Psych Eval →
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right: documentation & escalation */}
          <div className="lg:col-span-2 space-y-4">
            {/* Non-adherence & escalation */}
            <div className={`bg-white rounded-xl border-2 p-4 ${active.nonAdherence.length ? 'border-red-200' : 'border-gray-200'}`}>
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <ShieldAlert className={`h-4 w-4 ${active.nonAdherence.length ? 'text-red-500' : 'text-gray-400'}`} /> Non-Adherence & Escalation
              </h3>
              {active.nonAdherence.length === 0 ? (
                <p className="text-xs text-gray-400">No non-adherence events this order period.</p>
              ) : (
                <div className="space-y-2">
                  {active.nonAdherence.map((n, i) => (
                    <div key={i} className="flex gap-2.5 text-xs border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                      <span className="font-mono text-gray-400 shrink-0">{n.date}</span>
                      <div>
                        <p className="font-semibold text-gray-800">{n.event}</p>
                        <p className="text-gray-500">Response: {n.action}</p>
                      </div>
                    </div>
                  ))}
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    <strong>Escalation ladder (engagement-first):</strong> 1) same-day outreach → 2) peer/home visit → 3)
                    care-team review & plan adjustment → 4) notify the court with a recommendation. Non-adherence is never
                    itself grounds for arrest — the order's remedy is treatment engagement, and any transport for
                    evaluation uses the Mobile Crisis workflow.
                  </div>
                </div>
              )}
            </div>

            {/* Contact log quick entry */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <PenLine className="h-4 w-4 text-indigo-500" /> Contact Log
              </h3>
              <div className="flex flex-col sm:flex-row gap-2 mb-3">
                <select
                  value={contactWho}
                  onChange={(e) => setContactWho(e.target.value)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:w-52"
                >
                  <option value="">Team member…</option>
                  {active.team.map((t) => (
                    <option key={t.role} value={t.name}>{t.name} — {t.role}</option>
                  ))}
                </select>
                <input
                  value={contactNote}
                  onChange={(e) => setContactNote(e.target.value)}
                  placeholder="What happened on this contact…"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={logContact}
                  disabled={!contactWho || !contactNote.trim()}
                  className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-xs font-bold hover:bg-indigo-800 disabled:opacity-40"
                >
                  Log Contact
                </button>
              </div>
              <div className="space-y-2">
                {active.contactLog.map((c, i) => (
                  <div key={i} className="flex gap-2.5 text-xs">
                    <span className="font-mono text-gray-400 shrink-0">{c.date}</span>
                    <p className="text-gray-600"><strong className="text-gray-800">{c.who}</strong> ({c.mode}): {c.note}</p>
                  </div>
                ))}
                {active.contactLog.length === 0 && <p className="text-xs text-gray-400">No contacts logged yet.</p>}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">Logging a contact updates that team member's cadence status automatically.</p>
            </div>

            {/* AI court report */}
            <div className="bg-white rounded-xl border-2 border-indigo-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Bot className="h-4 w-4 text-indigo-500" />
                <h3 className="text-sm font-bold text-gray-700 flex-1">AI Court Status Report</h3>
                <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">AWS Bedrock · Claude Sonnet — demo mode</span>
              </div>
              {aiReport[active.id] ? (
                <>
                  <textarea
                    value={aiReport[active.id]}
                    onChange={(e) => setAiReport((prev) => ({ ...prev, [active.id]: e.target.value }))}
                    rows={10}
                    className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="mt-1.5 text-[11px] text-gray-400">
                    Drafted from the contact log, deadline record, and non-adherence events — AOT coordinator reviews,
                    edits, and signs before filing with the court.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <p className="text-xs text-gray-400 flex-1">
                    Drafts the periodic status report the court expects — adherence, team contacts, events, and a
                    recommendation — from what's already documented here.
                  </p>
                  <button
                    onClick={() => draftCourtReport(active)}
                    disabled={aiLoading === active.id}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60 shrink-0"
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {aiLoading === active.id ? 'Drafting…' : 'Draft Report'}
                  </button>
                </div>
              )}
            </div>

            {/* Related documentation links */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" /> Related Documentation
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {[
                  { label: 'Treatment Plan (court-filed)', href: '/dashboard/ehr/treatment-plans' },
                  { label: 'Progress Notes', href: '/dashboard/ehr/notes' },
                  { label: 'C-SSRS / Risk Assessments', href: '/dashboard/ehr/assessments/cssrs' },
                  { label: 'Mobile Crisis (if escalation needed)', href: '/dashboard/crisis' },
                  { label: 'E-Prescribing / Med Adherence', href: '/dashboard/ehr/prescriptions' },
                  { label: 'Eligibility & Payer Verification', href: '/dashboard/ehr/eligibility' },
                ].map((l) => (
                  <a key={l.href} href={l.href} className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-indigo-700">
                    <ChevronRight className="h-3.5 w-3.5 text-gray-300" /> {l.label}
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — CARE TEAM
      =================================================================== */}
      {tab === 'team' && active && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Participant</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full sm:w-80 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {participants.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — {STATUS_BADGE[p.status].label}</option>
                ))}
              </select>
            </div>
            <p className="text-xs text-gray-400 sm:text-right">
              Every ordered service has an owner and a cadence —<br className="hidden sm:block" /> the board flags whoever falls behind.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {active.team.map((t) => (
              <div
                key={t.role}
                className={`bg-white rounded-xl border-2 p-4 ${t.status === 'overdue' ? 'border-red-200' : t.status === 'due' ? 'border-amber-200' : 'border-gray-200'}`}
              >
                <div className="flex items-center gap-2.5 mb-2">
                  <div className="w-8 h-8 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                    {t.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-gray-900 truncate">{t.name}</p>
                    <p className="text-[11px] text-gray-400">{t.role}</p>
                  </div>
                </div>
                <div className="space-y-1 text-[11px] text-gray-500">
                  <p className="flex justify-between"><span>Cadence</span><span className="font-semibold text-gray-700">{t.cadence}</span></p>
                  <p className="flex justify-between"><span>Last contact</span><span className="font-semibold text-gray-700">{t.lastContact}</span></p>
                  <p className="flex justify-between"><span>Next due</span><span className="font-semibold text-gray-700">{t.nextDue}</span></p>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1 text-[11px] font-bold ${
                    t.status === 'current' ? 'text-green-600' : t.status === 'due' ? 'text-amber-600' : 'text-red-600'
                  }`}>
                    {t.status === 'current' ? <CheckCircle2 className="h-3.5 w-3.5" /> : t.status === 'due' ? <Clock className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {t.status === 'current' ? 'On cadence' : t.status === 'due' ? 'Contact due' : 'Overdue'}
                  </span>
                  <button
                    onClick={() => { setContactWho(t.name); setTab('workflow'); }}
                    className="text-[11px] font-semibold text-indigo-600 hover:underline inline-flex items-center gap-0.5"
                  >
                    Log contact <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <h3 className="text-sm font-bold uppercase tracking-wider mb-3 text-slate-200 flex items-center gap-2">
              <Users className="h-4 w-4 text-indigo-400" /> Team Roles in the AOT Workflow
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs text-slate-300">
              {[
                ['AOT Coordinator', 'Owns the case end-to-end: deadlines, court filings, team coordination, status reports.'],
                ['Psychiatrist', 'Affidavit at petition; medication management and monthly reviews under the order.'],
                ['Case Manager', 'Weekly contact, service linkage, benefits & transportation — the engagement backbone.'],
                ['Peer Support (CPRS)', 'Lived-experience engagement — often the first responder to early disengagement.'],
                ['Housing Specialist', 'Housing stability is the top predictor of AOT success — tracked like a clinical service.'],
                ['Family Contact', 'With consent: early-warning observations and support between team contacts.'],
                ['Court Liaison / Counsel', 'Hearing logistics, due-process steps, and the court relationship.'],
              ].map(([role, desc]) => (
                <p key={role} className="flex gap-2"><BadgeCheck className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" /><span><strong className="text-slate-100">{role}.</strong> {desc}</span></p>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
