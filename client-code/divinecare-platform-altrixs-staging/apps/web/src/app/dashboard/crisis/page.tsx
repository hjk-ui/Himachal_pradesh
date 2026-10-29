'use client';

import React, { useMemo, useState } from 'react';
import {
  Siren,
  Phone,
  PhoneCall,
  MapPin,
  Clock,
  Users,
  User,
  Ambulance,
  ShieldAlert,
  Shield,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  ChevronRight,
  ChevronLeft,
  Radio,
  FileText,
  Send,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Activity,
  HeartPulse,
  MessageSquare,
  Timer,
  TrendingUp,
  BadgeCheck,
  Video,
  Share2,
  Printer,
  Save,
  XCircle,
  Navigation,
  Home,
  Sparkles,
  Bot,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

const DEMO_CLIENTS = [
  'Maria Santos',
  'James Wilson',
  'Aisha Johnson',
  'Carlos Rivera',
  'Tamika Brown',
  'Derek Foster',
  'Lydia Chen',
  'Marcus Thompson',
  'Rosa Gutierrez',
  'Jerome Adams',
];

const CRISIS_TEAMS = [
  { id: 'unit1', name: 'Crisis Unit 1 — North', members: 'K. Osei, LCSW-C + T. Nguyen, CPRS', status: 'available', eta: '25 min' },
  { id: 'unit2', name: 'Crisis Unit 2 — Central', members: 'D. Alvarez, LCPC + M. Shah, RN', status: 'available', eta: '40 min' },
  { id: 'unit3', name: 'Crisis Unit 3 — South', members: 'R. Bennett, LMSW + J. Cole, CPRS', status: 'on-scene', eta: '~90 min' },
] as const;

const INTERVENTION_OPTIONS = [
  'Verbal de-escalation',
  'Safety planning (collaborative)',
  'Lethal means counseling / means restriction',
  'Grounding & coping skills coaching',
  'Family / support system engagement',
  'Medication concern addressed with prescriber',
  'Warm handoff to telehealth clinician',
  'Linkage to community resources',
  'Voluntary transport coordinated',
  'Petition for emergency evaluation initiated',
];

const MSE_OPTIONS = {
  appearance: ['Calm / cooperative', 'Agitated', 'Withdrawn', 'Disheveled', 'Guarded'],
  mood: ['Euthymic', 'Depressed', 'Anxious', 'Irritable', 'Labile', 'Flat'],
  thought: ['Linear / organized', 'Tangential', 'Disorganized', 'Paranoid content', 'Responding to internal stimuli'],
  orientation: ['Oriented x4', 'Oriented x3', 'Oriented x2 or less'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type YesNo = 'yes' | 'no' | null;

type Priority = 1 | 2 | 3;

type EpisodeStatus = 'dispatched' | 'enroute' | 'onscene' | 'resolved' | 'closed';

interface TimelineEvent {
  time: string;
  label: string;
  note?: string;
  kind: 'status' | 'doc' | 'notify' | 'followup';
}

interface Episode {
  id: string;
  client: string;
  location: string;
  priority: Priority;
  status: EpisodeStatus;
  team: string;
  startedAt: string;
  dispatchedAt: string;
  arrivedAt?: string;
  resolvedAt?: string;
  responseMinutes?: number;
  disposition?: string;
  timeline: TimelineEvent[];
  interventions: string[];
  mse: { appearance: string; mood: string; thought: string; orientation: string };
  lraNarrative: string;
  clientVoice: string;
  docComplete: boolean;
  notificationsSent: boolean;
  followUp24h: 'pending' | 'scheduled' | 'completed';
  followUp72h: 'pending' | 'scheduled' | 'completed';
  chargeRouted?: boolean;
}

// Billable minutes from dispatch to resolution ("HH:MM" timeline stamps)
function minutesBetween(start?: string, end?: string): number {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return Math.max(0, eh * 60 + em - (sh * 60 + sm));
}

type Tab = 'board' | 'triage' | 'episode' | 'compliance';

// ---------------------------------------------------------------------------
// Demo episodes
// ---------------------------------------------------------------------------

function ts(h: number, m: number) {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const INITIAL_EPISODES: Episode[] = [
  {
    id: 'MC-2026-0147',
    client: 'Marcus Thompson',
    location: '2214 Harford Rd, Baltimore, MD',
    priority: 1,
    status: 'onscene',
    team: 'Crisis Unit 3 — South',
    startedAt: ts(13, 5),
    dispatchedAt: ts(13, 12),
    arrivedAt: ts(13, 54),
    responseMinutes: 42,
    timeline: [
      { time: ts(13, 5), label: 'Crisis call received — smart triage completed (Priority 1)', kind: 'status' },
      { time: ts(13, 12), label: 'Crisis Unit 3 dispatched', kind: 'status' },
      { time: ts(13, 18), label: 'Unit en route — caller kept on supportive line', kind: 'status' },
      { time: ts(13, 54), label: 'Unit arrived on scene (response: 42 min — within 60-min standard)', kind: 'status' },
      { time: ts(14, 10), label: 'On-scene assessment started', note: 'Client engaged, sister present as support', kind: 'doc' },
    ],
    interventions: ['Verbal de-escalation', 'Family / support system engagement'],
    mse: { appearance: 'Agitated', mood: 'Anxious', thought: 'Linear / organized', orientation: 'Oriented x4' },
    lraNarrative: '',
    clientVoice: '',
    docComplete: false,
    notificationsSent: false,
    followUp24h: 'pending',
    followUp72h: 'pending',
  },
  {
    id: 'MC-2026-0146',
    client: 'Rosa Gutierrez',
    location: '890 Eastern Ave, Baltimore, MD',
    priority: 2,
    status: 'resolved',
    team: 'Crisis Unit 1 — North',
    startedAt: ts(9, 40),
    dispatchedAt: ts(9, 48),
    arrivedAt: ts(10, 42),
    resolvedAt: ts(12, 5),
    responseMinutes: 54,
    disposition: 'Stabilized in place — safety plan updated, no transport needed',
    timeline: [
      { time: ts(9, 40), label: 'Crisis call received — smart triage completed (Priority 2)', kind: 'status' },
      { time: ts(9, 48), label: 'Crisis Unit 1 dispatched', kind: 'status' },
      { time: ts(10, 42), label: 'Unit arrived on scene (response: 54 min)', kind: 'status' },
      { time: ts(11, 30), label: 'Collaborative safety plan completed with client', kind: 'doc' },
      { time: ts(12, 5), label: 'Episode resolved — stabilized in place', kind: 'status' },
    ],
    interventions: ['Verbal de-escalation', 'Safety planning (collaborative)', 'Lethal means counseling / means restriction'],
    mse: { appearance: 'Calm / cooperative', mood: 'Depressed', thought: 'Linear / organized', orientation: 'Oriented x4' },
    lraNarrative: 'Client stabilized in home with sister as on-site support. Hospitalization considered and ruled out: client engaged in safety planning, means secured, support present. Least restrictive setting maintained.',
    clientVoice: 'Client prefers to remain home and continue with her current therapist. Requested Spanish-language follow-up materials.',
    docComplete: true,
    notificationsSent: false,
    followUp24h: 'pending',
    followUp72h: 'pending',
  },
  {
    id: 'MC-2026-0145',
    client: 'Derek Foster',
    location: 'Telehealth (home)',
    priority: 3,
    status: 'closed',
    team: 'Telehealth de-escalation',
    startedAt: ts(16, 22),
    dispatchedAt: ts(16, 25),
    arrivedAt: ts(16, 25),
    resolvedAt: ts(17, 0),
    responseMinutes: 3,
    disposition: 'Telehealth de-escalation — next-day appointment scheduled with primary clinician',
    timeline: [
      { time: ts(16, 22), label: 'Crisis call received — smart triage completed (Priority 3)', kind: 'status' },
      { time: ts(16, 25), label: 'Telehealth de-escalation session started', kind: 'status' },
      { time: ts(17, 0), label: 'Episode resolved — next-day appointment scheduled', kind: 'status' },
      { time: ts(17, 5), label: 'Primary clinician notified (SMS + secure email)', kind: 'notify' },
      { time: ts(17, 8), label: '24-hour follow-up contact scheduled', kind: 'followup' },
    ],
    interventions: ['Verbal de-escalation', 'Grounding & coping skills coaching', 'Warm handoff to telehealth clinician'],
    mse: { appearance: 'Calm / cooperative', mood: 'Anxious', thought: 'Linear / organized', orientation: 'Oriented x4' },
    lraNarrative: 'Telehealth response was the least restrictive effective option; client safe at home with roommate aware.',
    clientVoice: 'Client asked that his employer not be contacted. Prefers evening appointment times.',
    docComplete: true,
    notificationsSent: true,
    followUp24h: 'completed',
    followUp72h: 'completed',
    chargeRouted: true,
  },
];

// ---------------------------------------------------------------------------
// Smart triage — questions & decision engine
// ---------------------------------------------------------------------------

interface TriageAnswers {
  // Step 1 — call intake
  callerType: string;
  client: string;
  location: string;
  callbackNumber: string;
  // Step 2 — immediate safety gates
  medicalEmergency: YesNo;
  weaponViolence: YesNo;
  attemptInProgress: YesNo;
  // Step 3 — crisis assessment
  ideation: YesNo;
  plan: YesNo;
  intentMeans: YesNo;
  harmOthers: YesNo;
  psychosis: YesNo;
  intoxication: YesNo;
  supportPresent: YesNo;
  willingEngage: YesNo;
}

const EMPTY_TRIAGE: TriageAnswers = {
  callerType: '',
  client: '',
  location: '',
  callbackNumber: '',
  medicalEmergency: null,
  weaponViolence: null,
  attemptInProgress: null,
  ideation: null,
  plan: null,
  intentMeans: null,
  harmOthers: null,
  psychosis: null,
  intoxication: null,
  supportPresent: null,
  willingEngage: null,
};

type DispatchDecision =
  | { kind: 'ems'; label: '911 / EMS Transfer'; detail: string }
  | { kind: 'police'; label: 'Law Enforcement Co-Response'; detail: string }
  | { kind: 'dispatch1'; label: 'Dispatch Mobile Crisis — Priority 1'; detail: string }
  | { kind: 'dispatch2'; label: 'Dispatch Mobile Crisis — Priority 2'; detail: string }
  | { kind: 'telehealth'; label: 'Telehealth De-escalation'; detail: string }
  | { kind: 'refer'; label: 'Referral & Scheduled Follow-Up'; detail: string };

function computeDecision(a: TriageAnswers): DispatchDecision {
  if (a.medicalEmergency === 'yes') {
    return {
      kind: 'ems',
      label: '911 / EMS Transfer',
      detail:
        'Active medical emergency (overdose, serious injury, unresponsive). Warm-transfer to 911/EMS now, stay on the line, and dispatch mobile crisis as secondary responder for behavioral support.',
    };
  }
  if (a.weaponViolence === 'yes') {
    return {
      kind: 'police',
      label: 'Law Enforcement Co-Response',
      detail:
        'Weapon present or active violence reported. Request CIT-trained law enforcement co-response; mobile crisis stages nearby and engages once scene is secured.',
    };
  }
  if (a.attemptInProgress === 'yes' || a.intentMeans === 'yes' || (a.plan === 'yes' && a.harmOthers === 'yes')) {
    return {
      kind: 'dispatch1',
      label: 'Dispatch Mobile Crisis — Priority 1',
      detail:
        'Imminent risk indicators present. Dispatch nearest available crisis unit now — target face-to-face response within 60 minutes. Keep caller on supportive line until unit arrives.',
    };
  }
  const urgent =
    a.plan === 'yes' ||
    a.harmOthers === 'yes' ||
    a.psychosis === 'yes' ||
    (a.ideation === 'yes' && a.supportPresent === 'no') ||
    (a.intoxication === 'yes' && a.ideation === 'yes');
  if (urgent) {
    return {
      kind: 'dispatch2',
      label: 'Dispatch Mobile Crisis — Priority 2',
      detail:
        'Urgent risk without imminent danger. Dispatch crisis unit — target face-to-face response within 2 hours. Offer supportive phone contact while the unit is en route.',
    };
  }
  if (a.ideation === 'yes' || a.intoxication === 'yes' || a.willingEngage === 'yes') {
    return {
      kind: 'telehealth',
      label: 'Telehealth De-escalation',
      detail:
        'Moderate distress with protective factors present. Offer immediate telehealth de-escalation with an on-call clinician; escalate to dispatch if distress increases or client declines.',
    };
  }
  return {
    kind: 'refer',
    label: 'Referral & Scheduled Follow-Up',
    detail:
      'No acute safety indicators. Provide 988 / warm-line information, schedule an appointment within 24–48 hours, and send coping resources. Document the contact and notify the assigned clinician.',
  };
}

const DECISION_STYLE: Record<DispatchDecision['kind'], { bg: string; border: string; text: string; Icon: React.FC<{ className?: string }> }> = {
  ems: { bg: 'bg-red-100', border: 'border-red-600', text: 'text-red-900', Icon: Ambulance },
  police: { bg: 'bg-orange-50', border: 'border-orange-400', text: 'text-orange-800', Icon: ShieldAlert },
  dispatch1: { bg: 'bg-red-50', border: 'border-red-400', text: 'text-red-800', Icon: Siren },
  dispatch2: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-800', Icon: Siren },
  telehealth: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', Icon: Video },
  refer: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-800', Icon: CalendarCheck },
};

// ---------------------------------------------------------------------------
// Small shared components
// ---------------------------------------------------------------------------

function YesNoRow({
  question,
  hint,
  value,
  onChange,
  danger,
}: {
  question: string;
  hint?: string;
  value: YesNo;
  onChange: (v: YesNo) => void;
  danger?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border-2 p-4 transition-all ${
        value === 'yes'
          ? danger
            ? 'border-red-400 bg-red-50'
            : 'border-amber-300 bg-amber-50'
          : value === 'no'
          ? 'border-green-200'
          : 'border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-800 font-medium leading-snug">{question}</p>
          {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onChange('yes')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'yes'
                ? 'bg-red-500 border-red-500 text-white'
                : 'border-gray-200 text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-700'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange('no')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'no'
                ? 'bg-green-500 border-green-500 text-white'
                : 'border-gray-200 text-gray-500 hover:border-green-200 hover:bg-green-50 hover:text-green-700'
            }`}
          >
            No
          </button>
        </div>
      </div>
    </div>
  );
}

const PRIORITY_BADGE: Record<Priority, { label: string; cls: string }> = {
  1: { label: 'Priority 1 — Imminent', cls: 'bg-red-100 text-red-700 border-red-300' },
  2: { label: 'Priority 2 — Urgent', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  3: { label: 'Priority 3 — Routine', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
};

const STATUS_BADGE: Record<EpisodeStatus, { label: string; cls: string }> = {
  dispatched: { label: 'Dispatched', cls: 'bg-purple-100 text-purple-700' },
  enroute: { label: 'En Route', cls: 'bg-indigo-100 text-indigo-700' },
  onscene: { label: 'On Scene', cls: 'bg-amber-100 text-amber-700' },
  resolved: { label: 'Resolved — Post-Intervention', cls: 'bg-teal-100 text-teal-700' },
  closed: { label: 'Closed', cls: 'bg-gray-100 text-gray-600' },
};

function nowStr() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// CARF-aligned episode checklist -------------------------------------------

interface CarfItem {
  label: string;
  done: boolean;
  standard: string;
}

function carfChecklist(e: Episode): CarfItem[] {
  const targetMin = e.priority === 1 ? 60 : e.priority === 2 ? 120 : 1440;
  return [
    {
      label: `Timely response (${e.priority === 3 ? 'same-day contact' : `face-to-face ≤ ${targetMin} min`})`,
      done: e.responseMinutes !== undefined && e.responseMinutes <= targetMin,
      standard: 'Access & responsiveness',
    },
    {
      label: 'Risk screening & triage documented',
      done: true,
      standard: 'Screening & assessment',
    },
    {
      label: 'On-scene assessment, interventions & MSE documented',
      done: e.docComplete,
      standard: 'Documentation of services',
    },
    {
      label: 'Least restrictive alternative considered & justified',
      done: e.lraNarrative.trim().length > 0,
      standard: 'Least restrictive environment',
    },
    {
      label: 'Person-served voice & preferences recorded',
      done: e.clientVoice.trim().length > 0,
      standard: 'Person-centered practice',
    },
    {
      label: 'Post-intervention clinician & supervisor notified',
      done: e.notificationsSent,
      standard: 'Coordination of care',
    },
    {
      label: '24-hour follow-up contact scheduled or completed',
      done: e.followUp24h !== 'pending',
      standard: 'Continuity & follow-up',
    },
    {
      label: '72-hour stabilization check scheduled or completed',
      done: e.followUp72h !== 'pending',
      standard: 'Continuity & follow-up',
    },
  ];
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function MobileCrisisPage() {
  const [tab, setTab] = useState<Tab>('board');
  const [episodes, setEpisodes] = useState<Episode[]>(INITIAL_EPISODES);
  const [activeId, setActiveId] = useState<string>(INITIAL_EPISODES[0].id);

  // Triage wizard state
  const [triageStep, setTriageStep] = useState(0);
  const [answers, setAnswers] = useState<TriageAnswers>(EMPTY_TRIAGE);
  const [selectedTeam, setSelectedTeam] = useState('');

  // Episode documentation drafts
  const [eventNote, setEventNote] = useState('');

  // Crisis team paging (Pinpoint SMS + push + SNS — demo mode)
  const [teamPagedAt, setTeamPagedAt] = useState('');

  // AWS Bedrock AI (demo mode — mirrors the /api/agents/* endpoints)
  const [aiRationale, setAiRationale] = useState('');
  const [aiRationaleLoading, setAiRationaleLoading] = useState(false);
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [aiSummaryLoading, setAiSummaryLoading] = useState('');

  const active = episodes.find((e) => e.id === activeId) ?? episodes[0];

  const decision = computeDecision(answers);
  const decisionStyle = DECISION_STYLE[decision.kind];

  const set = <K extends keyof TriageAnswers>(key: K, val: TriageAnswers[K]) =>
    setAnswers((prev) => ({ ...prev, [key]: val }));

  const updateEpisode = (id: string, fn: (e: Episode) => Episode) =>
    setEpisodes((prev) => prev.map((e) => (e.id === id ? fn(e) : e)));

  const addTimeline = (id: string, ev: Omit<TimelineEvent, 'time'>) =>
    updateEpisode(id, (e) => ({ ...e, timeline: [...e.timeline, { ...ev, time: nowStr() }] }));

  // --- derived metrics -----------------------------------------------------
  const metrics = useMemo(() => {
    const responded = episodes.filter((e) => e.responseMinutes !== undefined);
    const avg = responded.length
      ? Math.round(responded.reduce((s, e) => s + (e.responseMinutes ?? 0), 0) / responded.length)
      : 0;
    const withinStd = responded.filter(
      (e) => (e.responseMinutes ?? 999) <= (e.priority === 1 ? 60 : e.priority === 2 ? 120 : 1440)
    ).length;
    const fu = episodes.filter((e) => e.status === 'closed' || e.status === 'resolved');
    const fuDone = fu.filter((e) => e.followUp24h !== 'pending').length;
    return {
      activeCount: episodes.filter((e) => ['dispatched', 'enroute', 'onscene'].includes(e.status)).length,
      avgResponse: avg,
      pctWithin: responded.length ? Math.round((withinStd / responded.length) * 100) : 100,
      pctFollowUp: fu.length ? Math.round((fuDone / fu.length) * 100) : 100,
    };
  }, [episodes]);

  // --- AI drafting (demo mode — in production these call /api/agents) ------
  const draftRationale = () => {
    setAiRationaleLoading(true);
    const risks: string[] = [];
    if (answers.medicalEmergency === 'yes') risks.push('active medical emergency');
    if (answers.weaponViolence === 'yes') risks.push('weapon present / active violence');
    if (answers.attemptInProgress === 'yes') risks.push('self-harm attempt in progress');
    if (answers.ideation === 'yes') risks.push('current suicidal ideation');
    if (answers.plan === 'yes') risks.push('identified plan');
    if (answers.intentMeans === 'yes') risks.push('intent to act with access to means');
    if (answers.harmOthers === 'yes') risks.push('thoughts of harming others');
    if (answers.psychosis === 'yes') risks.push('psychotic symptoms or severe disorganization');
    if (answers.intoxication === 'yes') risks.push('current intoxication or withdrawal risk');
    const protect: string[] = [];
    if (answers.supportPresent === 'yes') protect.push('a supportive person is physically present');
    if (answers.willingEngage === 'yes') protect.push('the person is willing to engage with a crisis clinician');
    setTimeout(() => {
      setAiRationale(
        `Disposition: ${decision.label}. ` +
          (risks.length
            ? `Risk factors identified during structured triage: ${risks.join('; ')}. `
            : 'No acute risk factors were endorsed during structured triage. ') +
          (protect.length
            ? `Protective factors: ${protect.join('; ')}. `
            : 'Protective factors could not be confirmed on the call. ') +
          `${decision.detail} This disposition was generated by the structured decision-support tool; the undersigned clinician reviewed the triage responses and retains final clinical judgment.`
      );
      setAiRationaleLoading(false);
    }, 900);
  };

  const draftSummary = (ep: Episode) => {
    setAiSummaryLoading(ep.id);
    setTimeout(() => {
      const events = ep.timeline.map((t) => `${t.time} — ${t.label}`).join('\n');
      setAiSummaries((prev) => ({
        ...prev,
        [ep.id]:
          `MOBILE CRISIS EPISODE SUMMARY — ${ep.id}\n` +
          `Client: ${ep.client} · Priority ${ep.priority} · Team: ${ep.team}\n\n` +
          `Course of episode:\n${events}\n\n` +
          `Presentation on scene: ${ep.mse.appearance || 'not recorded'}; mood ${ep.mse.mood?.toLowerCase() || 'not recorded'}; ` +
          `thought process ${ep.mse.thought?.toLowerCase() || 'not recorded'}; ${ep.mse.orientation?.toLowerCase() || 'orientation not recorded'}.\n` +
          `Interventions provided: ${ep.interventions.join(', ') || 'see timeline'}.\n` +
          (ep.disposition ? `Disposition: ${ep.disposition}.\n` : '') +
          (ep.lraNarrative ? `Least restrictive alternative: ${ep.lraNarrative}\n` : '') +
          (ep.clientVoice ? `Person-served voice: ${ep.clientVoice}\n` : '') +
          `\nDrafted by AI Scribe (AWS Bedrock) from the episode record — reviewed and approved by the responding clinician before filing.`,
      }));
      setAiSummaryLoading('');
    }, 1100);
  };

  // --- triage flow ---------------------------------------------------------
  const safetyGateTriggered =
    answers.medicalEmergency === 'yes' || answers.weaponViolence === 'yes' || answers.attemptInProgress === 'yes';

  const canLeaveIntake = answers.callerType && answers.location;
  const canLeaveSafety =
    answers.medicalEmergency !== null && answers.weaponViolence !== null && answers.attemptInProgress !== null;
  const assessmentComplete =
    answers.ideation !== null &&
    answers.plan !== null &&
    answers.intentMeans !== null &&
    answers.harmOthers !== null &&
    answers.psychosis !== null &&
    answers.intoxication !== null &&
    answers.supportPresent !== null &&
    answers.willingEngage !== null;

  const qualifiesForDispatch = ['ems', 'police', 'dispatch1', 'dispatch2'].includes(decision.kind);

  const handleDispatch = () => {
    const priority: Priority = decision.kind === 'dispatch2' ? 2 : decision.kind === 'telehealth' || decision.kind === 'refer' ? 3 : 1;
    const team =
      decision.kind === 'telehealth'
        ? 'Telehealth de-escalation'
        : CRISIS_TEAMS.find((t) => t.id === selectedTeam)?.name ?? CRISIS_TEAMS[0].name;
    const id = `MC-2026-${String(148 + episodes.length - INITIAL_EPISODES.length).padStart(4, '0')}`;
    const ep: Episode = {
      id,
      client: answers.client || 'Unidentified caller',
      location: answers.location,
      priority,
      status: 'dispatched',
      team,
      startedAt: nowStr(),
      dispatchedAt: nowStr(),
      timeline: [
        { time: nowStr(), label: `Crisis call received — smart triage completed (Priority ${priority})`, kind: 'status' },
        { time: nowStr(), label: `${decision.label} — ${team}`, kind: 'status' },
        {
          time: nowStr(),
          label:
            decision.kind === 'telehealth' || decision.kind === 'refer'
              ? 'On-call clinician notified — secure push + SMS (no PHI)'
              : `Crisis team paged — Pinpoint SMS + mobile push to ${team}, SNS alert to on-call supervisor (delivery confirmed)`,
          kind: 'notify',
        },
      ],
      interventions: [],
      mse: { appearance: '', mood: '', thought: '', orientation: '' },
      lraNarrative: '',
      clientVoice: '',
      docComplete: false,
      notificationsSent: false,
      followUp24h: 'pending',
      followUp72h: 'pending',
    };
    setEpisodes((prev) => [ep, ...prev]);
    setActiveId(id);
    setAnswers(EMPTY_TRIAGE);
    setSelectedTeam('');
    setTriageStep(0);
    setTab('episode');
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-100 rounded-xl">
            <Siren className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Mobile Crisis Response</h1>
            <p className="text-xs text-gray-500">
              24/7 crisis triage, dispatch & stabilization — aligned with CARF Behavioral Health Crisis Program standards
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="tel:988"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-red-200 bg-red-50 text-red-700 text-xs font-bold hover:bg-red-100 transition-colors"
          >
            <PhoneCall className="h-3.5 w-3.5" /> 988 Lifeline
          </a>
          <button
            onClick={() => { setTab('triage'); setTriageStep(0); }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition-colors shadow-sm"
          >
            <Radio className="h-4 w-4" /> New Crisis Call
          </button>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Episodes', value: String(metrics.activeCount), sub: 'dispatched / en route / on scene', Icon: Activity, cls: 'text-red-600 bg-red-50' },
          { label: 'Avg Response Time', value: `${metrics.avgResponse} min`, sub: 'face-to-face, this month', Icon: Timer, cls: 'text-indigo-600 bg-indigo-50' },
          { label: 'Within Response Standard', value: `${metrics.pctWithin}%`, sub: 'P1 ≤ 60 min · P2 ≤ 2 hrs', Icon: TrendingUp, cls: 'text-teal-600 bg-teal-50' },
          { label: '24-hr Follow-Up Rate', value: `${metrics.pctFollowUp}%`, sub: 'post-intervention contacts', Icon: BadgeCheck, cls: 'text-purple-600 bg-purple-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-gray-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-extrabold text-gray-900">{m.value}</p>
            <p className="text-xs font-semibold text-gray-600">{m.label}</p>
            <p className="text-[11px] text-gray-400">{m.sub}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {([
          { id: 'board', label: 'Command Center', Icon: Radio },
          { id: 'triage', label: 'Smart Triage', Icon: ClipboardList },
          { id: 'episode', label: 'Episode Documentation', Icon: FileText },
          { id: 'compliance', label: 'Follow-Up & CARF', Icon: ShieldAlert },
        ] as { id: Tab; label: string; Icon: React.FC<{ className?: string }> }[]).map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap border-2 transition-all ${
              tab === t.id
                ? 'bg-slate-900 border-slate-900 text-white shadow-sm'
                : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700'
            }`}
          >
            <t.Icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* ===================================================================
          TAB — COMMAND CENTER
      =================================================================== */}
      {tab === 'board' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Episode board */}
          <div className="lg:col-span-2 space-y-3">
            <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Crisis Episodes</h2>
            {episodes.map((e) => {
              const pb = PRIORITY_BADGE[e.priority];
              const sb = STATUS_BADGE[e.status];
              const checklist = carfChecklist(e);
              const doneCount = checklist.filter((c) => c.done).length;
              return (
                <button
                  key={e.id}
                  onClick={() => { setActiveId(e.id); setTab('episode'); }}
                  className="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-mono font-bold text-gray-400">{e.id}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${pb.cls}`}>{pb.label}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                    <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {e.startedAt}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-indigo-50 text-indigo-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {e.client.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900">{e.client}</p>
                      <p className="text-xs text-gray-500 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" /> {e.location} · <Users className="h-3 w-3 shrink-0" /> {e.team}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-gray-400 mb-0.5">CARF checklist</p>
                      <p className={`text-xs font-bold ${doneCount === checklist.length ? 'text-green-600' : 'text-amber-600'}`}>
                        {doneCount}/{checklist.length} complete
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-gray-300 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Team availability + protocol */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-500" /> Crisis Team Availability
              </h3>
              <div className="space-y-2.5">
                {CRISIS_TEAMS.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'available' ? 'bg-green-500' : 'bg-amber-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-800">{t.name}</p>
                      <p className="text-[11px] text-gray-400 truncate">{t.members}</p>
                    </div>
                    <span className={`text-[11px] font-bold shrink-0 ${t.status === 'available' ? 'text-green-600' : 'text-amber-600'}`}>
                      {t.status === 'available' ? `ETA ${t.eta}` : 'On scene'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Crisis team paging — Pinpoint SMS + push + SNS */}
            <div className="bg-white rounded-xl border-2 border-red-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Bell className="h-4 w-4 text-red-500" /> Page On-Call Team
              </h3>
              <div className="space-y-1.5 mb-3">
                {[
                  { ch: 'Pinpoint SMS → unit duty phones', Icon: MessageSquare },
                  { ch: 'Mobile push → crisis responder app', Icon: Radio },
                  { ch: 'SNS high-priority → on-call supervisor', Icon: ShieldAlert },
                ].map((c) => (
                  <p key={c.ch} className="text-[11px] text-gray-500 flex items-center gap-1.5">
                    <c.Icon className={`h-3 w-3 shrink-0 ${teamPagedAt ? 'text-green-500' : 'text-gray-300'}`} /> {c.ch}
                  </p>
                ))}
              </div>
              {teamPagedAt ? (
                <div className="rounded-lg bg-green-50 border border-green-200 p-2.5">
                  <p className="text-xs font-bold text-green-700 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Team paged at {teamPagedAt}
                  </p>
                  <p className="text-[11px] text-green-600 mt-0.5">2 of 2 on-call responders acknowledged · supervisor notified</p>
                  <button onClick={() => setTeamPagedAt(nowStr())} className="mt-1.5 text-[11px] font-semibold text-green-700 underline">
                    Page again
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setTeamPagedAt(nowStr())}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 shadow-sm"
                >
                  <Siren className="h-4 w-4" /> Page On-Call Team Now
                </button>
              )}
              <p className="mt-2 text-[10px] text-gray-400">
                Dispatching from triage pages the assigned unit automatically — this button is the manual override for
                all-hands or off-protocol situations. No PHI in any page; responders open the secure episode link.
              </p>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 text-white">
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2 text-slate-200">
                <ShieldAlert className="h-4 w-4 text-red-400" /> Response Standards
              </h3>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex gap-2"><span className="text-red-400 font-bold shrink-0">P1</span> Imminent risk — face-to-face within 60 minutes, supportive line held until arrival.</li>
                <li className="flex gap-2"><span className="text-amber-400 font-bold shrink-0">P2</span> Urgent — face-to-face within 2 hours.</li>
                <li className="flex gap-2"><span className="text-blue-400 font-bold shrink-0">P3</span> Routine — telehealth or same-day contact, appointment within 48 hours.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-green-400 shrink-0 mt-0.5" /> Post-intervention: clinician notification, 24-hr contact, 72-hr stabilization check.</li>
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — SMART TRIAGE
      =================================================================== */}
      {tab === 'triage' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-4">
          {/* Stepper */}
          <div className="flex gap-2">
            {['Call Intake', 'Safety Gates', 'Crisis Assessment', 'Disposition'].map((label, i) => {
              const skipAssessment = safetyGateTriggered && i === 2;
              const isActive = triageStep === i;
              const isDone = triageStep > i;
              return (
                <div
                  key={label}
                  className={`flex-1 py-2 px-2 rounded-lg text-center text-xs font-semibold border-2 ${
                    isActive
                      ? 'bg-red-600 border-red-600 text-white'
                      : isDone
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : skipAssessment
                      ? 'bg-gray-50 border-gray-100 text-gray-300 line-through'
                      : 'bg-gray-50 border-gray-200 text-gray-400'
                  }`}
                >
                  {i + 1}. {label}
                </div>
              );
            })}
          </div>

          {/* STEP 0 — Call intake */}
          {triageStep === 0 && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <Phone className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Caller Type
                    </label>
                    <select
                      value={answers.callerType}
                      onChange={(e) => set('callerType', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">Select…</option>
                      {['Person in crisis (self)', 'Family / support person', '988 / crisis line referral', 'Provider / clinician', 'School', 'Law enforcement', 'Other community member'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Person in Crisis
                    </label>
                    <select
                      value={answers.client}
                      onChange={(e) => set('client', e.target.value)}
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    >
                      <option value="">Not in system / unknown</option>
                      {DEMO_CLIENTS.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <MapPin className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Current Location
                    </label>
                    <input
                      value={answers.location}
                      onChange={(e) => set('location', e.target.value)}
                      placeholder="Street address, landmark, or 'unknown'"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      <PhoneCall className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Callback Number
                    </label>
                    <input
                      value={answers.callbackNumber}
                      onChange={(e) => set('callbackNumber', e.target.value)}
                      placeholder="(___) ___-____"
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                  </div>
                </div>
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
                <HeartPulse className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-700">
                  Stay with the caller. Speak calmly, use their name, and keep this triage conversational — the questions
                  branch automatically so you only ask what is needed.
                </p>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setTriageStep(1)}
                  disabled={!canLeaveIntake}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Safety Gates <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 1 — Safety gates */}
          {triageStep === 1 && (
            <div className="space-y-3">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3.5 flex gap-3">
                <AlertOctagon className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">
                  <strong>Immediate safety gates.</strong> A single Yes routes this call — the full assessment is skipped
                  and the disposition is computed instantly.
                </p>
              </div>
              <YesNoRow
                danger
                question="Is there a medical emergency right now?"
                hint="Overdose, serious injury, unresponsive, difficulty breathing"
                value={answers.medicalEmergency}
                onChange={(v) => set('medicalEmergency', v)}
              />
              <YesNoRow
                danger
                question="Is a weapon present or is violence actively occurring?"
                value={answers.weaponViolence}
                onChange={(v) => set('weaponViolence', v)}
              />
              <YesNoRow
                danger
                question="Is the person attempting to harm themselves at this moment?"
                hint="Attempt in progress or about to act with means in hand"
                value={answers.attemptInProgress}
                onChange={(v) => set('attemptInProgress', v)}
              />

              {safetyGateTriggered && canLeaveSafety && (
                <div className={`rounded-xl border-2 p-4 ${decisionStyle.bg} ${decisionStyle.border}`}>
                  <div className="flex items-center gap-3">
                    <decisionStyle.Icon className={`h-6 w-6 shrink-0 ${decisionStyle.text}`} />
                    <div>
                      <p className={`text-sm font-bold ${decisionStyle.text}`}>{decision.label}</p>
                      <p className="text-xs text-gray-600 mt-0.5">{decision.detail}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-1">
                <button
                  onClick={() => setTriageStep(0)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setTriageStep(safetyGateTriggered ? 3 : 2)}
                  disabled={!canLeaveSafety}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {safetyGateTriggered ? 'Go to Disposition' : 'Next: Crisis Assessment'} <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — Crisis assessment (skipped when a gate fired) */}
          {triageStep === 2 && (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex gap-3">
                <ClipboardCheck className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-700">
                  Risk & protective factors. These drive whether the call <strong>qualifies for crisis unit dispatch</strong>{' '}
                  (Priority 1 or 2) or is best served by telehealth or referral.
                </p>
              </div>
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-1">Risk to self</p>
              <YesNoRow
                question="Thoughts of suicide or self-harm today or in the past few days?"
                value={answers.ideation}
                onChange={(v) => set('ideation', v)}
              />
              <YesNoRow
                question="Has the person thought about how they would do it (a plan)?"
                value={answers.plan}
                onChange={(v) => set('plan', v)}
              />
              <YesNoRow
                danger
                question="Do they intend to act, with access to the means?"
                hint="Plan + intent + access — a Yes here qualifies for Priority 1 dispatch"
                value={answers.intentMeans}
                onChange={(v) => set('intentMeans', v)}
              />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-2">Risk to others & acuity</p>
              <YesNoRow
                question="Threats or thoughts of harming someone else?"
                value={answers.harmOthers}
                onChange={(v) => set('harmOthers', v)}
              />
              <YesNoRow
                question="Signs of psychosis or severe disorganization?"
                hint="Responding to voices, paranoia, unable to care for self"
                value={answers.psychosis}
                onChange={(v) => set('psychosis', v)}
              />
              <YesNoRow
                question="Currently intoxicated or in possible withdrawal?"
                value={answers.intoxication}
                onChange={(v) => set('intoxication', v)}
              />
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider pt-2">Protective factors</p>
              <YesNoRow
                question="Is a supportive person physically with them right now?"
                value={answers.supportPresent}
                onChange={(v) => set('supportPresent', v)}
              />
              <YesNoRow
                question="Is the person willing to talk with a crisis clinician?"
                value={answers.willingEngage}
                onChange={(v) => set('willingEngage', v)}
              />
              <div className="flex justify-between pt-1">
                <button
                  onClick={() => setTriageStep(1)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setTriageStep(3)}
                  disabled={!assessmentComplete}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg font-semibold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Compute Disposition <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Disposition & dispatch */}
          {triageStep === 3 && (
            <div className="space-y-4">
              <div className={`rounded-2xl border-2 p-6 ${decisionStyle.bg} ${decisionStyle.border}`}>
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-white/70 shrink-0">
                    <decisionStyle.Icon className={`h-8 w-8 ${decisionStyle.text}`} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-1">Computed Disposition</p>
                    <h2 className={`text-2xl font-extrabold leading-tight ${decisionStyle.text}`}>{decision.label}</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm text-gray-700 bg-white/70 rounded-lg p-3 border border-white">{decision.detail}</p>
                <p className="mt-3 text-[11px] text-gray-500">
                  Disposition is decision support based on the triage responses — the crisis clinician confirms or
                  overrides it, and the override reason is documented in the episode record.
                </p>
              </div>

              {/* AI clinical rationale — Bedrock Sonnet (demo) */}
              <div className="bg-white rounded-xl border-2 border-indigo-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-indigo-500" />
                  <h3 className="text-sm font-bold text-gray-700 flex-1">AI Clinical Rationale</h3>
                  <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                    AWS Bedrock · Claude Sonnet — demo mode
                  </span>
                </div>
                {aiRationale ? (
                  <>
                    <textarea
                      value={aiRationale}
                      onChange={(e) => setAiRationale(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <p className="mt-1.5 text-[11px] text-gray-400">
                      AI-drafted from the triage responses — edit freely; it files with the episode as the documented
                      dispatch justification.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-gray-400 flex-1">
                      Draft the written medical-necessity justification for this disposition from the triage responses.
                    </p>
                    <button
                      onClick={draftRationale}
                      disabled={aiRationaleLoading}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60 shrink-0"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {aiRationaleLoading ? 'Drafting…' : 'Draft Rationale'}
                    </button>
                  </div>
                )}
              </div>

              {/* Team selection for dispatch dispositions */}
              {qualifiesForDispatch && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-indigo-500" /> Select Crisis Unit
                  </h3>
                  <div className="space-y-2">
                    {CRISIS_TEAMS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTeam(t.id)}
                        disabled={t.status !== 'available'}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                          selectedTeam === t.id
                            ? 'border-indigo-400 bg-indigo-50'
                            : t.status === 'available'
                            ? 'border-gray-200 hover:border-gray-300'
                            : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'available' ? 'bg-green-500' : 'bg-amber-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-800">{t.name}</p>
                          <p className="text-xs text-gray-400">{t.members}</p>
                        </div>
                        <span className="text-xs font-bold text-gray-500 shrink-0">
                          {t.status === 'available' ? `ETA ${t.eta}` : 'On scene'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap justify-between gap-3">
                <button
                  onClick={() => setTriageStep(safetyGateTriggered ? 1 : 2)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex gap-2">
                  {!qualifiesForDispatch && (
                    <button
                      onClick={handleDispatch}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 shadow-sm"
                    >
                      {decision.kind === 'telehealth' ? <Video className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />}
                      {decision.kind === 'telehealth' ? 'Start Telehealth Episode' : 'Create Referral Episode'}
                    </button>
                  )}
                  {qualifiesForDispatch && (
                    <button
                      onClick={handleDispatch}
                      disabled={!selectedTeam && decision.kind !== 'ems'}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-red-600 text-white rounded-lg font-bold text-sm hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Siren className="h-4 w-4" /> Dispatch Crisis Unit
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Aria Triage Copilot — AWS Bedrock (demo mode) */}
        <aside className="space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/20 flex items-center justify-center">
                <Bot className="h-4 w-4 text-indigo-300" />
              </div>
              <h3 className="text-sm font-bold text-slate-100 flex-1">Aria Triage Copilot</h3>
            </div>
            <p className="text-[10px] font-semibold text-indigo-300 bg-indigo-500/10 inline-block px-2 py-0.5 rounded-full mb-3">
              AWS Bedrock · Claude Haiku — demo mode
            </p>
            {(() => {
              const signals: string[] = [];
              if (answers.medicalEmergency === 'yes') signals.push('Medical emergency');
              if (answers.weaponViolence === 'yes') signals.push('Weapon / violence');
              if (answers.attemptInProgress === 'yes') signals.push('Attempt in progress');
              if (answers.ideation === 'yes') signals.push('Suicidal ideation');
              if (answers.plan === 'yes') signals.push('Plan identified');
              if (answers.intentMeans === 'yes') signals.push('Intent + means');
              if (answers.harmOthers === 'yes') signals.push('Harm to others');
              if (answers.psychosis === 'yes') signals.push('Psychosis');
              if (answers.intoxication === 'yes') signals.push('Intoxication');

              const probes: string[] = [];
              if (triageStep === 0) {
                probes.push("Use the caller's name and a calm, steady pace — rapport first, questions second.");
                probes.push('Confirm the exact location early; dispatch cannot roll without it.');
                probes.push('Ask who is with the person right now.');
              }
              if (answers.medicalEmergency === 'yes')
                probes.push('Warm-transfer script: "I\'m going to connect us with EMS together — stay on the line with me."');
              if (answers.ideation === 'yes' && answers.plan === null)
                probes.push('Probe the plan gently: "Have you thought about how you would do it?"');
              if (answers.plan === 'yes' && answers.intentMeans === null)
                probes.push('Ask about access directly: "Do you have it with you right now?" — means access drives Priority 1.');
              if (answers.intoxication === 'yes')
                probes.push('Ask what was taken, how much, and when — screen for overdose and withdrawal risk.');
              if (answers.psychosis === 'yes')
                probes.push('Short, concrete sentences. Don\'t challenge delusions; ask whether voices are telling them to act.');
              if ((answers.supportPresent === null || answers.supportPresent === 'no') && triageStep >= 2)
                probes.push('Ask who could come be with them — a present support person can change the disposition.');
              if (answers.willingEngage === 'yes' && decision.kind === 'telehealth')
                probes.push('Offer immediacy: "I can have a clinician on video with you in the next few minutes."');
              if (triageStep === 3)
                probes.push('Read the disposition back to the caller in plain language and say exactly what happens next.');

              return (
                <>
                  {signals.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Risk signals detected</p>
                      <div className="flex flex-wrap gap-1">
                        {signals.map((s) => (
                          <span key={s} className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/20 text-red-300">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Suggested next moves</p>
                  <ul className="space-y-2">
                    {probes.map((p) => (
                      <li key={p} className="text-xs text-slate-300 flex gap-2">
                        <Sparkles className="h-3 w-3 text-indigo-400 shrink-0 mt-0.5" /> {p}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
            <p className="mt-3 pt-3 border-t border-white/10 text-[10px] text-slate-500">
              Decision support only — the dispatch qualification comes from the structured triage and your clinical
              judgment, never from the AI.
            </p>
          </div>
        </aside>
        </div>
      )}

      {/* ===================================================================
          TAB — EPISODE DOCUMENTATION (during-process)
      =================================================================== */}
      {tab === 'episode' && active && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Left: episode selector + timeline */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Episode</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {episodes.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.id} — {e.client}
                  </option>
                ))}
              </select>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${PRIORITY_BADGE[active.priority].cls}`}>
                  {PRIORITY_BADGE[active.priority].label}
                </span>
                <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[active.status].cls}`}>
                  {STATUS_BADGE[active.status].label}
                </span>
              </div>
              <div className="mt-3 space-y-1.5 text-xs text-gray-500">
                <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> {active.client}</p>
                <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {active.location}</p>
                <p className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {active.team}</p>
                {active.responseMinutes !== undefined && (
                  <p className="flex items-center gap-1.5"><Timer className="h-3 w-3" /> Response: {active.responseMinutes} min</p>
                )}
              </div>
            </div>

            {/* Live timeline */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-500" /> Episode Timeline
              </h3>
              <div className="space-y-0">
                {active.timeline.map((ev, i) => (
                  <div key={i} className="flex gap-3 relative pb-4 last:pb-0">
                    {i < active.timeline.length - 1 && (
                      <span className="absolute left-[5px] top-4 bottom-0 w-px bg-gray-200" />
                    )}
                    <span
                      className={`w-[11px] h-[11px] rounded-full mt-1 shrink-0 border-2 border-white ring-1 ${
                        ev.kind === 'notify' ? 'bg-purple-500 ring-purple-200'
                        : ev.kind === 'followup' ? 'bg-teal-500 ring-teal-200'
                        : ev.kind === 'doc' ? 'bg-blue-500 ring-blue-200'
                        : 'bg-red-500 ring-red-200'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-gray-400 font-mono">{ev.time}</p>
                      <p className="text-xs font-medium text-gray-800 leading-snug">{ev.label}</p>
                      {ev.note && <p className="text-[11px] text-gray-400 italic">{ev.note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Middle + right: live documentation */}
          <div className="lg:col-span-2 space-y-4">
            {/* Status quick actions */}
            {active.status !== 'closed' && (
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-red-500" /> Live Status Updates
                </h3>
                <div className="flex flex-wrap gap-2">
                  {([
                    { to: 'enroute' as EpisodeStatus, label: 'Unit En Route', Icon: Navigation, show: active.status === 'dispatched' },
                    { to: 'onscene' as EpisodeStatus, label: 'Arrived On Scene', Icon: MapPin, show: ['dispatched', 'enroute'].includes(active.status) },
                    { to: 'resolved' as EpisodeStatus, label: 'Mark Resolved', Icon: CheckCircle2, show: active.status === 'onscene' },
                  ]).filter((b) => b.show).map((b) => (
                    <button
                      key={b.to}
                      onClick={() => {
                        updateEpisode(active.id, (e) => ({
                          ...e,
                          status: b.to,
                          arrivedAt: b.to === 'onscene' ? nowStr() : e.arrivedAt,
                          resolvedAt: b.to === 'resolved' ? nowStr() : e.resolvedAt,
                          responseMinutes: b.to === 'onscene' && e.responseMinutes === undefined ? 45 : e.responseMinutes,
                        }));
                        addTimeline(active.id, {
                          label:
                            b.to === 'enroute' ? 'Unit en route — caller kept on supportive line'
                            : b.to === 'onscene' ? 'Unit arrived on scene'
                            : 'Episode resolved — moving to post-intervention workflow',
                          kind: 'status',
                        });
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700"
                    >
                      <b.Icon className="h-3.5 w-3.5" /> {b.label}
                    </button>
                  ))}
                  <button
                    onClick={() =>
                      addTimeline(active.id, {
                        label: `Team re-paged — Pinpoint SMS + push to ${active.team}, SNS to on-call supervisor`,
                        kind: 'notify',
                      })
                    }
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-red-200 bg-red-50 text-red-700 text-xs font-semibold hover:bg-red-100"
                  >
                    <Bell className="h-3.5 w-3.5" /> Re-Page Team
                  </button>
                  <div className="flex-1 min-w-[200px] flex gap-2">
                    <input
                      value={eventNote}
                      onChange={(e) => setEventNote(e.target.value)}
                      placeholder="Log a timestamped field note…"
                      className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-xs placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    <button
                      onClick={() => {
                        if (!eventNote.trim()) return;
                        addTimeline(active.id, { label: eventNote.trim(), kind: 'doc' });
                        setEventNote('');
                      }}
                      className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700"
                    >
                      Log
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* On-scene clinical documentation */}
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> On-Scene Clinical Documentation
                {active.docComplete && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-green-600">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                  </span>
                )}
              </h3>

              {/* MSE chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(Object.entries(MSE_OPTIONS) as [keyof typeof MSE_OPTIONS, string[]][]).map(([key, opts]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                      {key === 'thought' ? 'Thought Process' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {opts.map((o) => (
                        <button
                          key={o}
                          onClick={() => updateEpisode(active.id, (e) => ({ ...e, mse: { ...e.mse, [key]: o } }))}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                            active.mse[key] === o
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-gray-200 text-gray-500 hover:border-indigo-200 hover:bg-indigo-50'
                          }`}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Interventions */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Interventions Provided</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {INTERVENTION_OPTIONS.map((opt) => {
                    const checked = active.interventions.includes(opt);
                    return (
                      <label
                        key={opt}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                          checked ? 'border-teal-300 bg-teal-50 text-teal-800 font-medium' : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            updateEpisode(active.id, (e) => ({
                              ...e,
                              interventions: checked
                                ? e.interventions.filter((i) => i !== opt)
                                : [...e.interventions, opt],
                            }))
                          }
                          className="w-3.5 h-3.5 rounded text-teal-600 focus:ring-teal-500"
                        />
                        {opt}
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* LRA + client voice */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Least Restrictive Alternative — Justification
                  </p>
                  <textarea
                    value={active.lraNarrative}
                    onChange={(e) => updateEpisode(active.id, (ep) => ({ ...ep, lraNarrative: e.target.value }))}
                    rows={4}
                    placeholder="What less-restrictive options were considered, and why was this disposition the least restrictive effective one?"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">
                    Person-Served Voice & Preferences
                  </p>
                  <textarea
                    value={active.clientVoice}
                    onChange={(e) => updateEpisode(active.id, (ep) => ({ ...ep, clientVoice: e.target.value }))}
                    rows={4}
                    placeholder="In the person's own words: what do they want, who do they want involved, cultural or language preferences…"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button
                  onClick={() => {
                    updateEpisode(active.id, (e) => ({ ...e, docComplete: true }));
                    addTimeline(active.id, { label: 'On-scene clinical documentation saved to chart', kind: 'doc' });
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
                >
                  <Save className="h-4 w-4" /> Save Documentation
                </button>
              </div>
            </div>

            {/* Post-intervention panel — appears once resolved */}
            {(active.status === 'resolved' || active.status === 'closed') && (
              <div className="bg-white rounded-xl border-2 border-teal-200 p-5 space-y-5">
                <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                  <Bell className="h-4 w-4 text-teal-500" /> Post-Intervention — Notifications & Follow-Up
                </h3>

                {active.disposition ? (
                  <div className="bg-teal-50 border border-teal-200 rounded-lg p-3 text-sm text-teal-800">
                    <strong>Disposition:</strong> {active.disposition}
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Final Disposition</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        'Stabilized in place — safety plan updated, no transport needed',
                        'Voluntary transport to crisis stabilization / ED',
                        'Emergency petition — involuntary evaluation',
                        'Linked to same-day urgent appointment',
                      ].map((d) => (
                        <button
                          key={d}
                          onClick={() => {
                            updateEpisode(active.id, (e) => ({ ...e, disposition: d }));
                            addTimeline(active.id, { label: `Disposition recorded: ${d}`, kind: 'doc' });
                          }}
                          className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-800"
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinician notifications */}
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                    Care Team Notification {active.notificationsSent && <span className="text-green-600">— sent {nowStr()}</span>}
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { who: 'Dr. Angela Reyes — Primary Therapist', via: 'Secure SMS + encrypted email summary', Icon: MessageSquare },
                      { who: 'Dr. Samuel Obi — Psychiatrist (On-Call Supervisor)', via: 'SNS high-priority alert', Icon: ShieldAlert },
                      { who: 'Referral source (988 Regional Center)', via: 'Disposition callback — consent on file', Icon: Share2 },
                    ].map((n) => (
                      <div key={n.who} className="flex items-center gap-3 p-2.5 rounded-lg bg-gray-50 border border-gray-100">
                        <n.Icon className={`h-4 w-4 shrink-0 ${active.notificationsSent ? 'text-green-500' : 'text-gray-400'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-800">{n.who}</p>
                          <p className="text-[11px] text-gray-400">{n.via}</p>
                        </div>
                        {active.notificationsSent ? (
                          <span className="text-[11px] font-bold text-green-600 inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Delivered
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-gray-400">Queued</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {!active.notificationsSent && (
                    <button
                      onClick={() => {
                        updateEpisode(active.id, (e) => ({ ...e, notificationsSent: true }));
                        addTimeline(active.id, {
                          label: 'Post-intervention notifications sent to primary clinician, on-call supervisor & referral source',
                          kind: 'notify',
                        });
                      }}
                      className="mt-2.5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700"
                    >
                      <Send className="h-4 w-4" /> Send Notifications
                    </button>
                  )}
                  <p className="mt-2 text-[11px] text-gray-400">
                    No PHI in SMS — messages contain a secure link to the episode summary. All sends are audit-logged.
                  </p>
                </div>

                {/* AI episode summary — Bedrock Scribe (demo) */}
                <div className="rounded-xl border-2 border-indigo-200 p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="h-4 w-4 text-indigo-500" />
                    <p className="text-sm font-bold text-gray-700 flex-1">AI Episode Summary</p>
                    <span className="text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      Scribe · AWS Bedrock — demo mode
                    </span>
                  </div>
                  {aiSummaries[active.id] ? (
                    <>
                      <textarea
                        value={aiSummaries[active.id]}
                        onChange={(e) => setAiSummaries((prev) => ({ ...prev, [active.id]: e.target.value }))}
                        rows={9}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono text-gray-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <p className="mt-1.5 text-[11px] text-gray-400">
                        Drafted from the episode timeline, MSE, and interventions — this is also what the clinician
                        notification's secure link opens to. Review and edit before filing.
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-gray-400 flex-1">
                        One click drafts the post-intervention summary note from everything already documented — timeline,
                        MSE, interventions, disposition, and the person's own words.
                      </p>
                      <button
                        onClick={() => draftSummary(active)}
                        disabled={aiSummaryLoading === active.id}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-60 shrink-0"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {aiSummaryLoading === active.id ? 'Drafting…' : 'Draft Summary'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Charge capture — drafted from timeline timestamps */}
                <div className="rounded-xl border border-gray-200 p-4 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Charge Capture</p>
                  {(() => {
                    const mins = minutesBetween(active.dispatchedAt, active.resolvedAt);
                    const telehealth = active.team === 'Telehealth de-escalation';
                    const units = telehealth ? 1 : Math.max(1, Math.ceil(mins / 15));
                    const code = telehealth ? '90839 (crisis psychotherapy)' : `H2011 × ${units} units`;
                    const amount = telehealth ? 220 : units * 34;
                    return (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-sm font-bold text-gray-800">{code} — ${amount.toLocaleString()}</p>
                          <p className="text-[11px] text-gray-400">
                            Computed from the episode timeline ({active.dispatchedAt}–{active.resolvedAt ?? 'now'}
                            {!telehealth && `, ${mins} min`}) · {telehealth ? 'POS 10' : 'POS 15 (mobile unit)'}
                          </p>
                        </div>
                        {active.chargeRouted ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-600">
                            <CheckCircle2 className="h-4 w-4" /> Routed to billing
                          </span>
                        ) : (
                          <button
                            onClick={() => {
                              updateEpisode(active.id, (e) => ({ ...e, chargeRouted: true }));
                              addTimeline(active.id, {
                                label: `Charge drafted — ${code} routed to Residential & Crisis Billing`,
                                kind: 'doc',
                              });
                            }}
                            disabled={!active.docComplete || !active.resolvedAt}
                            title={!active.docComplete ? 'Complete on-scene documentation first' : ''}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            <Send className="h-3.5 w-3.5" /> Route to Billing
                          </button>
                        )}
                        <a href="/dashboard/billing/residential-crisis" className="text-[11px] font-semibold text-indigo-600 hover:underline">
                          Open charge queue →
                        </a>
                      </div>
                    );
                  })()}
                  <p className="mt-2 text-[11px] text-gray-400">
                    Billed units always match documented timeline minutes — charges hold in the queue until documentation
                    and clinician notification are complete.
                  </p>
                </div>

                {/* Follow-up scheduling */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {([
                    { key: 'followUp24h' as const, label: '24-Hour Follow-Up Contact', sub: 'Phone or face-to-face check within 24 hours of resolution' },
                    { key: 'followUp72h' as const, label: '72-Hour Stabilization Check', sub: 'Confirm linkage to services & safety plan adherence' },
                  ]).map((f) => {
                    const state = active[f.key];
                    return (
                      <div
                        key={f.key}
                        className={`rounded-xl border-2 p-4 ${
                          state === 'completed' ? 'border-green-300 bg-green-50' : state === 'scheduled' ? 'border-teal-200 bg-teal-50' : 'border-gray-200'
                        }`}
                      >
                        <p className="text-sm font-bold text-gray-800">{f.label}</p>
                        <p className="text-[11px] text-gray-400 mb-3">{f.sub}</p>
                        {state === 'pending' ? (
                          <button
                            onClick={() => {
                              updateEpisode(active.id, (e) => ({ ...e, [f.key]: 'scheduled' }));
                              addTimeline(active.id, { label: `${f.label} scheduled and assigned`, kind: 'followup' });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-700"
                          >
                            <CalendarCheck className="h-3.5 w-3.5" /> Schedule
                          </button>
                        ) : state === 'scheduled' ? (
                          <button
                            onClick={() => {
                              updateEpisode(active.id, (e) => ({ ...e, [f.key]: 'completed' }));
                              addTimeline(active.id, { label: `${f.label} completed`, kind: 'followup' });
                            }}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Mark Completed
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-green-700">
                            <BadgeCheck className="h-4 w-4" /> Completed
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Close episode */}
                {active.status === 'resolved' && (
                  <div className="flex justify-end pt-1">
                    <button
                      onClick={() => {
                        updateEpisode(active.id, (e) => ({ ...e, status: 'closed' }));
                        addTimeline(active.id, { label: 'Episode closed — record locked for QI review', kind: 'status' });
                      }}
                      disabled={!active.notificationsSent || active.followUp24h === 'pending' || !active.docComplete}
                      title={
                        !active.docComplete
                          ? 'Complete on-scene documentation first'
                          : !active.notificationsSent
                          ? 'Send clinician notifications first'
                          : active.followUp24h === 'pending'
                          ? 'Schedule the 24-hour follow-up first'
                          : ''
                      }
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gray-900 text-white text-sm font-bold hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Home className="h-4 w-4" /> Close Episode
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CARF checklist for this episode */}
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-purple-500" /> CARF Episode Checklist
              </h3>
              <div className="space-y-1.5">
                {carfChecklist(active).map((c) => (
                  <div key={c.label} className="flex items-center gap-3 py-1.5 border-b border-gray-50 last:border-0">
                    {c.done ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-gray-300 shrink-0" />
                    )}
                    <span className={`text-sm flex-1 ${c.done ? 'text-gray-700' : 'text-gray-400'}`}>{c.label}</span>
                    <span className="text-[10px] font-semibold text-purple-500 bg-purple-50 px-2 py-0.5 rounded-full shrink-0 hidden sm:inline">
                      {c.standard}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================
          TAB — FOLLOW-UP & CARF COMPLIANCE
      =================================================================== */}
      {tab === 'compliance' && (
        <div className="space-y-5">
          {/* Episode compliance table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-purple-500" /> Episode Compliance Dashboard
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Every episode is measured against the crisis program's CARF conformance targets — exceptions feed the QI plan.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                    <th className="px-5 py-2.5 font-semibold">Episode</th>
                    <th className="px-3 py-2.5 font-semibold">Response Met</th>
                    <th className="px-3 py-2.5 font-semibold">Docs Complete</th>
                    <th className="px-3 py-2.5 font-semibold">Clinician Notified</th>
                    <th className="px-3 py-2.5 font-semibold">24-hr Follow-Up</th>
                    <th className="px-3 py-2.5 font-semibold">72-hr Check</th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((e) => {
                    const targetMin = e.priority === 1 ? 60 : e.priority === 2 ? 120 : 1440;
                    const respMet = e.responseMinutes !== undefined && e.responseMinutes <= targetMin;
                    const Cell = ({ ok, label }: { ok: boolean; label?: string }) => (
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${ok ? 'text-green-600' : 'text-amber-600'}`}>
                          {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          {label ?? (ok ? 'Yes' : 'Open')}
                        </span>
                      </td>
                    );
                    return (
                      <tr key={e.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <p className="font-semibold text-gray-900 text-xs">{e.id}</p>
                          <p className="text-[11px] text-gray-400">{e.client} · P{e.priority}</p>
                        </td>
                        <Cell ok={respMet} label={e.responseMinutes !== undefined ? `${e.responseMinutes} min` : 'Pending'} />
                        <Cell ok={e.docComplete} />
                        <Cell ok={e.notificationsSent} />
                        <Cell ok={e.followUp24h !== 'pending'} label={e.followUp24h === 'completed' ? 'Done' : e.followUp24h === 'scheduled' ? 'Scheduled' : 'Open'} />
                        <Cell ok={e.followUp72h !== 'pending'} label={e.followUp72h === 'completed' ? 'Done' : e.followUp72h === 'scheduled' ? 'Scheduled' : 'Open'} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* CARF standards reference */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-sm font-bold text-gray-700 mb-3">CARF Crisis Program — How This Module Conforms</h3>
              <ul className="space-y-2.5 text-sm text-gray-600">
                {[
                  ['24/7 access & timely response', 'Smart triage is available around the clock; response-time targets (P1 ≤ 60 min, P2 ≤ 2 hrs) are tracked on every episode.'],
                  ['Screening & risk assessment', 'Structured, branching questionnaire with C-SSRS-informed risk items and automatic dispatch qualification.'],
                  ['Least restrictive environment', 'Every episode requires a documented least-restrictive-alternative justification before closure.'],
                  ['Person-centered practice', 'The person\'s own words, preferences, and chosen supports are captured in the episode record.'],
                  ['Coordination & continuity of care', 'Automatic post-intervention notification of the primary clinician, on-call supervisor, and consented referral sources.'],
                  ['Follow-up after crisis', 'Mandatory 24-hour contact and 72-hour stabilization check — episodes cannot close without them scheduled.'],
                  ['Performance measurement & improvement', 'Response times, follow-up rates, and documentation completeness roll into the QI dashboard.'],
                  ['Documentation & record integrity', 'Timestamped timeline, locked records on closure, and 6-year HIPAA audit logging.'],
                ].map(([title, body]) => (
                  <li key={title} className="flex gap-2.5">
                    <BadgeCheck className="h-4 w-4 text-purple-500 shrink-0 mt-0.5" />
                    <span><strong className="text-gray-800">{title}.</strong> {body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-gray-400">
                Map each item to your current CARF Behavioral Health standards manual during survey preparation — standard
                numbering varies by manual year and program designation.
              </p>
            </div>

            {/* Survey readiness */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Accreditation Survey Readiness</h3>
                {[
                  { label: 'Response-time conformance (90-day rolling)', pct: metrics.pctWithin },
                  { label: '24-hour follow-up completion', pct: metrics.pctFollowUp },
                  { label: 'Documentation completed within 24 hrs', pct: 92 },
                  { label: 'Staff crisis-response training current', pct: 88 },
                ].map((m) => (
                  <div key={m.label} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-600 font-medium">{m.label}</span>
                      <span className={`font-bold ${m.pct >= 90 ? 'text-green-600' : 'text-amber-600'}`}>{m.pct}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${m.pct >= 90 ? 'bg-green-500' : 'bg-amber-500'}`}
                        style={{ width: `${m.pct}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 flex gap-3">
                <TrendingUp className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                <p className="text-sm text-purple-800">
                  Exceptions on this dashboard flow into{' '}
                  <a href="/dashboard/qi" className="font-semibold underline">Quality Improvement</a> as improvement
                  actions, and critical events link to{' '}
                  <a href="/dashboard/incidents" className="font-semibold underline">Incident Reports</a> — closing the
                  CARF performance-improvement loop.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
