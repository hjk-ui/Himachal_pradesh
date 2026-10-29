'use client';

import React, { useMemo, useState, useEffect } from 'react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
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

interface CrisisTeam {
  id: string;
  name: string;
  members: string;
  status: 'available' | 'on-scene';
  eta: string;
}

// No hardcoded crisis units or rosters — configured teams will populate this.
const CRISIS_TEAMS: CrisisTeam[] = [];

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

// 'pending' = opened (e.g. from telehealth) but no unit dispatched
type EpisodeStatus = 'pending' | 'dispatched' | 'enroute' | 'onscene' | 'resolved' | 'closed';

interface TimelineEvent {
  time: string;
  label: string;
  note?: string;
  kind: 'status' | 'doc' | 'notify' | 'followup';
}

interface Episode {
  id: string;
  /** Database id of the stored CrisisEpisode, once persisted. */
  serverId?: string;
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
  ems: { bg: 'bg-rose-100', border: 'border-rose-600', text: 'text-rose-900', Icon: Ambulance },
  police: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-800', Icon: ShieldAlert },
  dispatch1: { bg: 'bg-rose-50', border: 'border-rose-400', text: 'text-rose-800', Icon: Siren },
  dispatch2: { bg: 'bg-amber-50', border: 'border-amber-400', text: 'text-amber-800', Icon: Siren },
  telehealth: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-800', Icon: Video },
  refer: { bg: 'bg-emerald-50', border: 'border-emerald-300', text: 'text-emerald-800', Icon: CalendarCheck },
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
            ? 'border-rose-400 bg-rose-50'
            : 'border-amber-300 bg-amber-50'
          : value === 'no'
          ? 'border-emerald-200'
          : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-slate-800 font-medium leading-snug">{question}</p>
          {hint && <p className="text-xs text-slate-500 mt-0.5">{hint}</p>}
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => onChange('yes')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'yes'
                ? 'bg-rose-500 border-rose-500 text-white'
                : 'border-slate-200 text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700'
            }`}
          >
            Yes
          </button>
          <button
            onClick={() => onChange('no')}
            className={`px-5 py-2 rounded-lg border-2 text-sm font-semibold transition-all ${
              value === 'no'
                ? 'bg-emerald-500 border-emerald-500 text-white'
                : 'border-slate-200 text-slate-500 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700'
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
  1: { label: 'Priority 1 — Imminent', cls: 'bg-rose-100 text-rose-700 border-rose-300' },
  2: { label: 'Priority 2 — Urgent', cls: 'bg-amber-100 text-amber-700 border-amber-300' },
  3: { label: 'Priority 3 — Routine', cls: 'bg-blue-100 text-blue-700 border-blue-300' },
};

const STATUS_BADGE: Record<EpisodeStatus, { label: string; cls: string }> = {
  pending: { label: 'Opened — not dispatched', cls: 'bg-rose-100 text-rose-700' },
  dispatched: { label: 'Dispatched', cls: 'bg-blue-100 text-blue-700' },
  enroute: { label: 'En Route', cls: 'bg-blue-100 text-blue-700' },
  onscene: { label: 'On Scene', cls: 'bg-amber-100 text-amber-700' },
  resolved: { label: 'Resolved — Post-Intervention', cls: 'bg-sky-100 text-sky-700' },
  closed: { label: 'Closed', cls: 'bg-slate-100 text-slate-600' },
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
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const { clients } = useClients();
  const { user } = useAuth();
  // The residential / crisis billing queue is billing work (billing roles + Office Manager)
  const canOpenChargeQueue = canAccessPath(user?.role, '/dashboard/billing/residential-crisis');
  const clientNames = useMemo(
    () => clients.map((c) => c.name).filter((n): n is string => Boolean(n)),
    [clients]
  );

  useEffect(() => {
    fetch('/api/crisis/episodes')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.episodes) && data.episodes.length > 0) {
          const mapped: Episode[] = data.episodes.map((ep: any) => ({
            id: ep.episodeNumber || ep.id,
            serverId: ep.id,
            client: ep.clientName || 'Anonymous Client',
            location: ep.location || 'Location not recorded',
            priority: (Number(ep.priority) || 2) as Priority,
            status: (ep.status in STATUS_BADGE ? ep.status : 'pending') as EpisodeStatus,
            team: ep.assignedTeam || 'Unassigned',
            startedAt: ep.startedAt ? new Date(ep.startedAt).toTimeString().slice(0, 5) : '—',
            dispatchedAt: ep.dispatchedAt || '',
            arrivedAt: ep.arrivedAt || undefined,
            resolvedAt: ep.resolvedAt || undefined,
            responseMinutes: ep.responseMinutes ?? undefined,
            disposition: ep.disposition || undefined,
            timeline: Array.isArray(ep.timeline) ? ep.timeline : [],
            interventions: Array.isArray(ep.interventions) ? ep.interventions : [],
            mse: {
              appearance: ep.mseAppearance || '',
              mood: ep.mseMood || '',
              thought: ep.mseThought || '',
              orientation: ep.mseOrientation || '',
            },
            lraNarrative: ep.lraNarrative || '',
            clientVoice: ep.clientVoice || '',
            docComplete: Boolean(ep.docComplete),
            notificationsSent: Boolean(ep.notificationsSent),
            followUp24h: ep.followUp24hStatus || 'pending',
            followUp72h: ep.followUp72hStatus || 'pending',
            chargeRouted: Boolean(ep.chargeRouted),
          }));
          setEpisodes(mapped);
          if (mapped[0]) setActiveId(mapped[0].id);
        } else {
          setEpisodes([]);
          setActiveId('');
        }
      })
      .catch((err) => console.warn('Could not load crisis episodes from DB:', err));
  }, []);

  // Triage wizard state
  const [triageStep, setTriageStep] = useState(0);
  const [answers, setAnswers] = useState<TriageAnswers>(EMPTY_TRIAGE);
  const [selectedTeam, setSelectedTeam] = useState('');

  // Episode documentation drafts
  const [eventNote, setEventNote] = useState('');

  // Crisis team paging — /api/crisis/paging records every attempt. Automated
  // SMS/push/SNS delivery is not connected yet, so the server answers 503
  // "unavailable" and staff must be phoned; the UI must never say "paged".
  const [pageAttempt, setPageAttempt] = useState<{ at: string; recorded: boolean; notified: boolean; error?: string } | null>(null);
  const [paging, setPaging] = useState(false);

  /** Records a page attempt (optionally linked to an episode). Returns the outcome. */
  const pageTeam = async (ep?: Episode) => {
    setPaging(true);
    try {
      // Link by database id when known; otherwise by the episode number the POST stored.
      const link = ep ? (ep.serverId ? { episodeId: ep.serverId } : { episodeNumber: ep.id }) : {};
      const res = await fetch('/api/crisis/paging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: 'manual_override', ...link }),
      });
      const data = await res.json().catch(() => ({}));
      const notified = res.ok && data?.notificationsSent === true;
      const outcome = {
        at: nowStr(),
        recorded: Boolean(data?.page) || notified,
        notified,
        error: notified ? undefined : (data?.error as string | undefined) ?? `Request failed (${res.status})`,
      };
      setPageAttempt(outcome);
      return outcome;
    } catch (err) {
      const outcome = { at: nowStr(), recorded: false, notified: false, error: err instanceof Error ? err.message : 'Network error' };
      setPageAttempt(outcome);
      return outcome;
    } finally {
      setPaging(false);
    }
  };

  // AWS Bedrock AI drafts. `*FromAi` records whether the text really came from
  // Bedrock (provider 'aws-bedrock') or was assembled locally from the record.
  const [aiRationale, setAiRationale] = useState('');
  const [aiRationaleFromAi, setAiRationaleFromAi] = useState(false);
  const [aiRationaleLoading, setAiRationaleLoading] = useState(false);
  const [aiSummaries, setAiSummaries] = useState<Record<string, string>>({});
  const [aiSummaryFromAi, setAiSummaryFromAi] = useState<Record<string, boolean>>({});
  const [aiSummaryLoading, setAiSummaryLoading] = useState('');

  const active = episodes.find((e) => e.id === activeId) ?? episodes[0];

  const decision = computeDecision(answers);
  const decisionStyle = DECISION_STYLE[decision.kind];

  const set = <K extends keyof TriageAnswers>(key: K, val: TriageAnswers[K]) =>
    setAnswers((prev) => ({ ...prev, [key]: val }));

  const updateEpisode = (id: string, fn: (e: Episode) => Episode) => {
    setEpisodes((prev) => {
      const next = prev.map((e) => (e.id === id ? fn(e) : e));
      const updated = next.find((e) => e.id === id);
      if (updated) {
        fetch(`/api/crisis/episodes/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: updated.status,
            docComplete: updated.docComplete,
            interventions: updated.interventions,
            lraNarrative: updated.lraNarrative,
            clientVoice: updated.clientVoice,
            timeline: updated.timeline,
            followUp24hStatus: updated.followUp24h,
            followUp72hStatus: updated.followUp72h,
          }),
        }).catch(() => {});
      }
      return next;
    });
  };

  const addTimeline = (id: string, ev: Omit<TimelineEvent, 'time'>) =>
    updateEpisode(id, (e) => ({ ...e, timeline: [...e.timeline, { ...ev, time: nowStr() }] }));

  // --- derived metrics -----------------------------------------------------
  const metrics = useMemo(() => {
    const responded = episodes.filter((e) => e.responseMinutes !== undefined);
    const avg = responded.length
      ? Math.round(responded.reduce((s, e) => s + (e.responseMinutes ?? 0), 0) / responded.length)
      : null;
    const withinStd = responded.filter(
      (e) => (e.responseMinutes ?? 999) <= (e.priority === 1 ? 60 : e.priority === 2 ? 120 : 1440)
    ).length;
    const fu = episodes.filter((e) => e.status === 'closed' || e.status === 'resolved');
    const fuDone = fu.filter((e) => e.followUp24h !== 'pending').length;
    const docDone = episodes.filter((e) => e.docComplete).length;
    return {
      activeCount: episodes.filter((e) => ['pending', 'dispatched', 'enroute', 'onscene'].includes(e.status)).length,
      avgResponse: avg,
      // null = no episodes to measure yet (shown as "—", never 0%)
      pctWithin: responded.length ? Math.round((withinStd / responded.length) * 100) : null,
      pctFollowUp: fu.length ? Math.round((fuDone / fu.length) * 100) : null,
      pctDocComplete: episodes.length ? Math.round((docDone / episodes.length) * 100) : null,
    };
  }, [episodes]);

  // --- AI drafting (/api/crisis/triage-ai and /api/crisis/ai-summary; 503 when Bedrock is unavailable) ---
  const draftRationale = async () => {
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

    try {
      const res = await fetch('/api/crisis/triage-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symptoms: risks.join(', ') || 'Crisis call intake',
          callerType: answers.callerType || 'Hotline',
          weapons: answers.weaponViolence === 'yes',
          violence: answers.harmOthers === 'yes',
          location: answers.location || '',
          answers,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.provider === 'aws-bedrock' && data.clinicalRationale) {
        setAiRationale(data.clinicalRationale);
        setAiRationaleFromAi(true);
        return;
      }
    } catch (err) {
      console.warn('Crisis triage AI call error, using local rationale formulation:', err instanceof Error ? err.message : 'unknown');
    } finally {
      setAiRationaleLoading(false);
    }

    // Local fallback — not AI; labelled as such in the UI
    setAiRationaleFromAi(false);
    setAiRationale(
      `Disposition: ${decision.label}. ` +
        (risks.length
          ? `Risk factors identified during structured triage: ${risks.join('; ')}. `
          : 'No acute risk factors were endorsed during structured triage. ') +
        (protect.length
          ? `Protective factors: ${protect.join('; ')}. `
          : 'Protective factors could not be confirmed on the call. ') +
        `${decision.detail} AI was unavailable — this text was assembled from the structured triage answers, not by Bedrock. The clinician must review it and retains final judgment.`
    );
  };

  const draftSummary = async (ep: Episode) => {
    setAiSummaryLoading(ep.id);
    try {
      const res = await fetch('/api/crisis/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode: ep }),
      });
      const data = await res.json();
      if (res.ok && data.success && data.provider === 'aws-bedrock' && data.summary) {
        setAiSummaries((prev) => ({
          ...prev,
          [ep.id]: data.summary,
        }));
        setAiSummaryFromAi((prev) => ({ ...prev, [ep.id]: true }));
        return;
      }
    } catch (err) {
      console.warn('Crisis summary AI call error, using local formulation:', err instanceof Error ? err.message : 'unknown');
    } finally {
      setAiSummaryLoading('');
    }

    // Local fallback — record extract only, not AI; labelled as such in the UI
    setAiSummaryFromAi((prev) => ({ ...prev, [ep.id]: false }));
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
        `\nAI was unavailable — this summary was assembled from the episode record, not by Bedrock. Must be reviewed by the responding clinician.`,
    }));
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

  const [dispatching, setDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);

  /** Saves the episode first; it appears on the board only once the server stored it and assigned its number. */
  const handleDispatch = async () => {
    if (dispatching) return;
    const priority: Priority = decision.kind === 'dispatch2' ? 2 : decision.kind === 'telehealth' || decision.kind === 'refer' ? 3 : 1;
    const team =
      decision.kind === 'telehealth'
        ? 'Telehealth de-escalation'
        : CRISIS_TEAMS.find((t) => t.id === selectedTeam)?.name ?? CRISIS_TEAMS[0]?.name ?? 'Unassigned crisis unit';
    const client = answers.client || 'Unidentified caller';
    const startedAt = nowStr();
    setDispatching(true);
    setDispatchError(null);
    let saved: { id: string; episodeNumber: string } | null = null;
    try {
      const res = await fetch('/api/crisis/episodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: client,
          location: answers.location,
          priority,
          assignedTeam: team,
          status: 'dispatched',
          dispatchedAt: startedAt,
          callerName: answers.callerType,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data.episode?.id && data.episode?.episodeNumber) {
        saved = { id: data.episode.id, episodeNumber: data.episode.episodeNumber };
      } else {
        setDispatchError(
          `${data?.error || 'The crisis episode was not saved'}. Nothing was recorded — try again, and contact the crisis team by phone now.`
        );
      }
    } catch {
      setDispatchError('Network error — the crisis episode was not saved. Contact the crisis team by phone now and try again.');
    } finally {
      setDispatching(false);
    }
    if (!saved) return;

    const ep: Episode = {
      id: saved.episodeNumber,
      serverId: saved.id,
      client,
      location: answers.location,
      priority,
      status: 'dispatched',
      team,
      startedAt,
      dispatchedAt: startedAt,
      timeline: [
        { time: startedAt, label: `Crisis call received — smart triage completed (Priority ${priority})`, kind: 'status' },
        { time: startedAt, label: `${decision.label} — ${team}`, kind: 'status' },
        {
          time: startedAt,
          label:
            decision.kind === 'telehealth' || decision.kind === 'refer'
              ? 'Automated notification not connected — contact the on-call clinician by phone'
              : `Automated paging not connected — contact ${team} and the on-call supervisor by phone`,
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
    setActiveId(ep.id);
    setAnswers(EMPTY_TRIAGE);
    setSelectedTeam('');
    setTriageStep(0);
    setTab('episode');
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="shrink-0 p-2.5 bg-rose-100 rounded-xl">
            <Siren className="h-6 w-6 text-rose-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900 leading-tight">Mobile Crisis Response</h1>
            <p className="text-xs text-slate-500">
              24/7 crisis triage, dispatch & stabilization — aligned with CARF Behavioral Health Crisis Program standards
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="tel:988"
            className="inline-flex min-h-10 items-center gap-2 px-3.5 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-xs font-bold hover:bg-rose-100 transition-colors"
          >
            <PhoneCall className="h-3.5 w-3.5" /> 988 Lifeline
          </a>
          <button
            onClick={() => { setTab('triage'); setTriageStep(0); }}
            className="inline-flex min-h-10 items-center gap-2 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors shadow-sm"
          >
            <Radio className="h-4 w-4" /> New Crisis Call
          </button>
        </div>
      </div>

      {/* Metric tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Active Episodes', value: String(metrics.activeCount), sub: 'dispatched / en route / on scene', Icon: Activity, cls: 'text-rose-600 bg-rose-50' },
          { label: 'Avg Response Time', value: metrics.avgResponse == null ? '—' : `${metrics.avgResponse} min`, sub: 'face-to-face, this month', Icon: Timer, cls: 'text-blue-600 bg-blue-50' },
          { label: 'Within Response Standard', value: metrics.pctWithin == null ? '—' : `${metrics.pctWithin}%`, sub: 'P1 ≤ 60 min · P2 ≤ 2 hrs', Icon: TrendingUp, cls: 'text-sky-700 bg-sky-50' },
          { label: '24-hr Follow-Up Rate', value: metrics.pctFollowUp == null ? '—' : `${metrics.pctFollowUp}%`, sub: 'post-intervention contacts', Icon: BadgeCheck, cls: 'text-blue-600 bg-blue-50' },
        ].map((m) => (
          <div key={m.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${m.cls}`}>
              <m.Icon className="h-4 w-4" />
            </div>
            <p className="text-2xl font-semibold text-slate-900">{m.value}</p>
            <p className="text-xs font-semibold text-slate-600">{m.label}</p>
            <p className="text-[11px] text-slate-500">{m.sub}</p>
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
                : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
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
            <h2 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Crisis Episodes</h2>
            {episodes.map((e) => {
              const pb = PRIORITY_BADGE[e.priority];
              const sb = STATUS_BADGE[e.status];
              const checklist = carfChecklist(e);
              const doneCount = checklist.filter((c) => c.done).length;
              return (
                <button
                  key={e.id}
                  onClick={() => { setActiveId(e.id); setTab('episode'); }}
                  className="w-full text-left bg-white rounded-xl border border-slate-200 p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                >
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-mono font-bold text-slate-500">{e.id}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${pb.cls}`}>{pb.label}</span>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${sb.cls}`}>{sb.label}</span>
                    <span className="ml-auto text-xs text-slate-500 flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {e.startedAt}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                      {e.client.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{e.client}</p>
                      <p className="text-xs text-slate-500 flex items-center gap-1 truncate">
                        <MapPin className="h-3 w-3 shrink-0" /> {e.location} · <Users className="h-3 w-3 shrink-0" /> {e.team}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[11px] text-slate-500 mb-0.5">CARF checklist</p>
                      <p className={`text-xs font-bold ${doneCount === checklist.length ? 'text-emerald-700' : 'text-amber-700'}`}>
                        {doneCount}/{checklist.length} complete
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Team availability + protocol */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-3 flex items-center gap-2">
                <Users className="h-4 w-4 text-blue-500" /> Crisis Team Availability
              </h3>
              <div className="space-y-2.5">
                {CRISIS_TEAMS.length === 0 && (
                  <p className="text-xs text-slate-500">No crisis teams configured yet.</p>
                )}
                {CRISIS_TEAMS.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'available' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800">{t.name}</p>
                      <p className="text-[11px] text-slate-500 truncate">{t.members}</p>
                    </div>
                    <span className={`text-[11px] font-bold shrink-0 ${t.status === 'available' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {t.status === 'available' ? `ETA ${t.eta}` : 'On scene'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Crisis team paging — Pinpoint SMS + push + SNS */}
            <div className="bg-white rounded-xl border-2 border-rose-200 p-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-2">
                <Bell className="h-4 w-4 text-rose-600" /> Page On-Call Team
              </h3>
              <div className="space-y-1.5 mb-3">
                {[
                  { ch: 'Pinpoint SMS → unit duty phones', Icon: MessageSquare },
                  { ch: 'Mobile push → crisis responder app', Icon: Radio },
                  { ch: 'SNS high-priority → on-call supervisor', Icon: ShieldAlert },
                ].map((c) => (
                  <p key={c.ch} className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <c.Icon className={`h-3 w-3 shrink-0 ${pageAttempt?.notified ? 'text-emerald-700' : 'text-slate-500'}`} /> {c.ch}
                    {!pageAttempt?.notified && <span className="text-[11px] text-slate-500">(not connected)</span>}
                  </p>
                ))}
              </div>
              {pageAttempt && !pageAttempt.notified && (
                <div className="rounded-lg bg-amber-50 border border-amber-300 p-2.5 mb-2">
                  <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5" /> No one was notified automatically
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    {pageAttempt.recorded
                      ? `Page attempt logged at ${pageAttempt.at}, but SMS/push/SNS delivery is not connected yet.`
                      : `Page attempt at ${pageAttempt.at} could not be recorded (${pageAttempt.error}).`}{' '}
                    Call the on-call crisis team now.
                  </p>
                </div>
              )}
              {pageAttempt?.notified && (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-2.5 mb-2">
                  <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Page delivered at {pageAttempt.at}
                  </p>
                </div>
              )}
              <button
                onClick={() => { void pageTeam(); }}
                disabled={paging}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 shadow-sm disabled:opacity-60"
              >
                <Siren className="h-4 w-4" /> {paging ? 'Recording page…' : pageAttempt ? 'Page again' : 'Page On-Call Team Now'}
              </button>
              <p className="mt-2 text-[11px] text-slate-500">
                Automated SMS/push/SNS paging is not connected yet — this records the attempt for the audit trail only.
                Always phone the on-call team as well. No PHI is included in any page record.
              </p>
            </div>

            <div className="bg-slate-900 rounded-xl p-4 text-white">
              <h3 className="text-sm font-bold uppercase tracking-wider mb-3 flex items-center gap-2 text-slate-200">
                <ShieldAlert className="h-4 w-4 text-rose-600" /> Response Standards
              </h3>
              <ul className="space-y-2 text-xs text-slate-500">
                <li className="flex gap-2"><span className="text-rose-600 font-bold shrink-0">P1</span> Imminent risk — face-to-face within 60 minutes, supportive line held until arrival.</li>
                <li className="flex gap-2"><span className="text-amber-700 font-bold shrink-0">P2</span> Urgent — face-to-face within 2 hours.</li>
                <li className="flex gap-2"><span className="text-blue-600 font-bold shrink-0">P3</span> Routine — telehealth or same-day contact, appointment within 48 hours.</li>
                <li className="flex gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 shrink-0 mt-0.5" /> Post-intervention: clinician notification, 24-hr contact, 72-hr stabilization check.</li>
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
                      ? 'bg-rose-600 border-rose-600 text-white'
                      : isDone
                      ? 'bg-rose-50 border-rose-200 text-rose-700'
                      : skipAssessment
                      ? 'bg-slate-50 border-slate-100 text-slate-500 line-through'
                      : 'bg-slate-50 border-slate-200 text-slate-500'
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
              <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <Phone className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Caller Type
                    </label>
                    <select
                      value={answers.callerType}
                      onChange={(e) => set('callerType', e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      <option value="">Select…</option>
                      {['Person in crisis (self)', 'Family / support person', '988 / crisis line referral', 'Provider / clinician', 'School', 'Law enforcement', 'Other community member'].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <User className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Person in Crisis
                    </label>
                    <select
                      value={answers.client}
                      onChange={(e) => set('client', e.target.value)}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-500"
                    >
                      <option value="">Not in system / unknown</option>
                      {clientNames.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <MapPin className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Current Location
                    </label>
                    <input
                      value={answers.location}
                      onChange={(e) => set('location', e.target.value)}
                      placeholder="Street address, landmark, or 'unknown'"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      <PhoneCall className="inline h-3.5 w-3.5 mr-1 -mt-0.5" /> Callback Number
                    </label>
                    <input
                      value={answers.callbackNumber}
                      onChange={(e) => set('callbackNumber', e.target.value)}
                      placeholder="(___) ___-____"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-rose-500"
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
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-lg font-semibold text-sm hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Next: Safety Gates <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 1 — Safety gates */}
          {triageStep === 1 && (
            <div className="space-y-3">
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 flex gap-3">
                <AlertOctagon className="h-4 w-4 text-rose-600 mt-0.5 shrink-0" />
                <p className="text-sm text-rose-700">
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
                      <p className="text-xs text-slate-600 mt-0.5">{decision.detail}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-between pt-1">
                <button
                  onClick={() => setTriageStep(0)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setTriageStep(safetyGateTriggered ? 3 : 2)}
                  disabled={!canLeaveSafety}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-lg font-semibold text-sm hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
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
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-1">Risk to self</p>
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
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-2">Risk to others & acuity</p>
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
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider pt-2">Protective factors</p>
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
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <button
                  onClick={() => setTriageStep(3)}
                  disabled={!assessmentComplete}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-rose-600 text-white rounded-lg font-semibold text-sm hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Compute Disposition <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — Disposition & dispatch */}
          {triageStep === 3 && (
            <div className="space-y-4">
              <div className={`rounded-xl border-2 p-6 ${decisionStyle.bg} ${decisionStyle.border}`}>
                <div className="flex items-center gap-4">
                  <div className="p-3 rounded-xl bg-white/70 shrink-0">
                    <decisionStyle.Icon className={`h-8 w-8 ${decisionStyle.text}`} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Computed Disposition</p>
                    <h2 className={`text-2xl font-semibold leading-tight ${decisionStyle.text}`}>{decision.label}</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm text-slate-700 bg-white/70 rounded-lg p-3 border border-white">{decision.detail}</p>
                <p className="mt-3 text-[11px] text-slate-500">
                  Disposition is decision support based on the triage responses — the crisis clinician confirms or
                  overrides it, and the override reason is documented in the episode record.
                </p>
              </div>

              {/* AI clinical rationale — Bedrock when available, else a labelled local extract */}
              <div className="bg-white rounded-xl border-2 border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkles className="h-4 w-4 text-blue-500" />
                  <h3 className="text-sm font-bold text-slate-700 flex-1">AI Clinical Rationale</h3>
                  {aiRationale && (
                    <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                      {aiRationaleFromAi ? 'AWS Bedrock · AI draft' : 'Assembled from triage answers (AI unavailable)'}
                    </span>
                  )}
                </div>
                {aiRationale ? (
                  <>
                    <textarea
                      value={aiRationale}
                      onChange={(e) => setAiRationale(e.target.value)}
                      rows={5}
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      {aiRationaleFromAi
                        ? 'AI-drafted from the triage responses'
                        : 'Assembled from the triage responses without AI'}{' '}
                      — review and edit; it files with the episode as the documented dispatch justification.
                    </p>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-xs text-slate-500 flex-1">
                      Draft the written medical-necessity justification for this disposition from the triage responses.
                    </p>
                    <button
                      onClick={draftRationale}
                      disabled={aiRationaleLoading}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-60 shrink-0"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      {aiRationaleLoading ? 'Drafting…' : 'Draft Rationale'}
                    </button>
                  </div>
                )}
              </div>

              {/* Team selection for dispatch dispositions */}
              {qualifiesForDispatch && (
                <div className="bg-white rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                    <Navigation className="h-4 w-4 text-blue-500" /> Select Crisis Unit
                  </h3>
                  <div className="space-y-2">
                    {CRISIS_TEAMS.length === 0 && (
                      <p className="text-xs text-slate-500">No crisis units configured yet.</p>
                    )}
                    {CRISIS_TEAMS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTeam(t.id)}
                        disabled={t.status !== 'available'}
                        className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all ${
                          selectedTeam === t.id
                            ? 'border-blue-400 bg-blue-50'
                            : t.status === 'available'
                            ? 'border-slate-200 hover:border-slate-300'
                            : 'border-slate-100 bg-slate-50 opacity-50 cursor-not-allowed'
                        }`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${t.status === 'available' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                          <p className="text-xs text-slate-500">{t.members}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-500 shrink-0">
                          {t.status === 'available' ? `ETA ${t.eta}` : 'On scene'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {dispatchError ? (
                <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                  {dispatchError}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-between gap-3">
                <button
                  onClick={() => setTriageStep(safetyGateTriggered ? 1 : 2)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-semibold text-sm hover:bg-slate-200"
                >
                  <ChevronLeft className="h-4 w-4" /> Back
                </button>
                <div className="flex gap-2">
                  {!qualifiesForDispatch && (
                    <button
                      onClick={() => void handleDispatch()}
                      disabled={dispatching}
                      className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 shadow-sm"
                    >
                      {decision.kind === 'telehealth' ? <Video className="h-4 w-4" /> : <CalendarCheck className="h-4 w-4" />}
                      {decision.kind === 'telehealth' ? 'Start Telehealth Episode' : 'Create Referral Episode'}
                    </button>
                  )}
                  {qualifiesForDispatch && (
                    <button
                      onClick={() => void handleDispatch()}
                      disabled={dispatching || (!selectedTeam && decision.kind !== 'ems' && CRISIS_TEAMS.length > 0)}
                      className="inline-flex items-center gap-2 px-6 py-2.5 bg-rose-600 text-white rounded-lg font-bold text-sm hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                    >
                      <Siren className="h-4 w-4" /> Dispatch Crisis Unit
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Aria Triage Copilot — rule-based prompts from the triage answers (no AI call) */}
        <aside className="space-y-4">
          <div className="bg-slate-900 rounded-xl p-4 text-white">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <Bot className="h-4 w-4 text-blue-300" />
              </div>
              <h3 className="text-sm font-bold text-slate-100 flex-1">Aria Triage Copilot</h3>
            </div>
            <p className="text-[11px] font-semibold text-blue-300 bg-blue-500/10 inline-block px-2 py-0.5 rounded-full mb-3">
              Rule-based prompts from triage answers
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
                      <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Risk signals detected</p>
                      <div className="flex flex-wrap gap-1">
                        {signals.map((s) => (
                          <span key={s} className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300">{s}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">Suggested next moves</p>
                  <ul className="space-y-2">
                    {probes.map((p) => (
                      <li key={p} className="text-xs text-slate-500 flex gap-2">
                        <Sparkles className="h-3 w-3 text-blue-600 shrink-0 mt-0.5" /> {p}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
            <p className="mt-3 pt-3 border-t border-white/10 text-[11px] text-slate-500">
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
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Episode</label>
              <select
                value={activeId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                <p className="flex items-center gap-1.5"><User className="h-3 w-3" /> {active.client}</p>
                <p className="flex items-center gap-1.5"><MapPin className="h-3 w-3" /> {active.location}</p>
                <p className="flex items-center gap-1.5"><Users className="h-3 w-3" /> {active.team}</p>
                {active.responseMinutes !== undefined && (
                  <p className="flex items-center gap-1.5"><Timer className="h-3 w-3" /> Response: {active.responseMinutes} min</p>
                )}
              </div>
            </div>

            {/* Live timeline */}
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Clock className="h-4 w-4 text-blue-500" /> Episode Timeline
              </h3>
              <div className="space-y-0">
                {active.timeline.map((ev, i) => (
                  <div key={i} className="flex gap-3 relative pb-4 last:pb-0">
                    {i < active.timeline.length - 1 && (
                      <span className="absolute left-[5px] top-4 bottom-0 w-px bg-slate-200" />
                    )}
                    <span
                      className={`w-[11px] h-[11px] rounded-full mt-1 shrink-0 border-2 border-white ring-1 ${
                        ev.kind === 'notify' ? 'bg-blue-500 ring-blue-200'
                        : ev.kind === 'followup' ? 'bg-sky-500 ring-sky-200'
                        : ev.kind === 'doc' ? 'bg-blue-500 ring-blue-200'
                        : 'bg-rose-500 ring-rose-200'
                      }`}
                    />
                    <div className="min-w-0">
                      <p className="text-xs text-slate-500 font-mono">{ev.time}</p>
                      <p className="text-xs font-medium text-slate-800 leading-snug">{ev.label}</p>
                      {ev.note && <p className="text-[11px] text-slate-500 italic">{ev.note}</p>}
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
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                  <Radio className="h-4 w-4 text-rose-600" /> Live Status Updates
                </h3>
                <div className="flex flex-wrap gap-2">
                  {([
                    { to: 'enroute' as EpisodeStatus, label: 'Unit En Route', Icon: Navigation, show: ['pending', 'dispatched'].includes(active.status) },
                    { to: 'onscene' as EpisodeStatus, label: 'Arrived On Scene', Icon: MapPin, show: ['pending', 'dispatched', 'enroute'].includes(active.status) },
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
                    disabled={paging}
                    onClick={async () => {
                      const outcome = await pageTeam(active);
                      // The server appends the same entry to the stored timeline when the
                      // episode is linked; mirror it locally without another PUT.
                      setEpisodes((prev) => prev.map((e) => e.id === active.id ? {
                        ...e,
                        timeline: [...e.timeline, {
                          time: outcome.at,
                          label: outcome.notified
                            ? `Team re-paged — ${active.team}`
                            : 'Crisis team paging attempted — notification delivery unavailable; contact responders by phone',
                          kind: 'notify',
                        }],
                      } : e));
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-rose-200 bg-rose-50 text-rose-700 text-xs font-semibold hover:bg-rose-100 disabled:opacity-60"
                  >
                    <Bell className="h-3.5 w-3.5" /> {paging ? 'Recording…' : 'Re-Page Team'}
                  </button>
                  <div className="flex-1 min-w-[200px] flex gap-2">
                    <input
                      value={eventNote}
                      onChange={(e) => setEventNote(e.target.value)}
                      placeholder="Log a timestamped field note…"
                      className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button
                      onClick={() => {
                        if (!eventNote.trim()) return;
                        addTimeline(active.id, { label: eventNote.trim(), kind: 'doc' });
                        setEventNote('');
                      }}
                      className="px-3 py-2 rounded-lg bg-brand-600 text-white text-xs font-semibold hover:bg-brand-700"
                    >
                      Log
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* On-scene clinical documentation */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-5">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-500" /> On-Scene Clinical Documentation
                {active.docComplete && (
                  <span className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Complete
                  </span>
                )}
              </h3>

              {/* MSE chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {(Object.entries(MSE_OPTIONS) as [keyof typeof MSE_OPTIONS, string[]][]).map(([key, opts]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      {key === 'thought' ? 'Thought Process' : key.charAt(0).toUpperCase() + key.slice(1)}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {opts.map((o) => (
                        <button
                          key={o}
                          onClick={() => updateEpisode(active.id, (e) => ({ ...e, mse: { ...e.mse, [key]: o } }))}
                          className={`px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all ${
                            active.mse[key] === o
                              ? 'bg-brand-600 border-blue-600 text-white'
                              : 'border-slate-200 text-slate-500 hover:border-blue-200 hover:bg-blue-50'
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
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Interventions Provided</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  {INTERVENTION_OPTIONS.map((opt) => {
                    const checked = active.interventions.includes(opt);
                    return (
                      <label
                        key={opt}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer text-xs transition-all ${
                          checked ? 'border-sky-300 bg-sky-50 text-sky-800 font-medium' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
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
                          className="w-3.5 h-3.5 rounded text-sky-700 focus:ring-sky-500"
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
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Least Restrictive Alternative — Justification
                  </p>
                  <textarea
                    value={active.lraNarrative}
                    onChange={(e) => updateEpisode(active.id, (ep) => ({ ...ep, lraNarrative: e.target.value }))}
                    rows={4}
                    placeholder="What less-restrictive options were considered, and why was this disposition the least restrictive effective one?"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Person-Served Voice & Preferences
                  </p>
                  <textarea
                    value={active.clientVoice}
                    onChange={(e) => updateEpisode(active.id, (ep) => ({ ...ep, clientVoice: e.target.value }))}
                    rows={4}
                    placeholder="In the person's own words: what do they want, who do they want involved, cultural or language preferences…"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2">
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 text-sm font-semibold hover:bg-slate-200"
                >
                  <Printer className="h-4 w-4" /> Print
                </button>
                <button
                  onClick={() => {
                    updateEpisode(active.id, (e) => ({ ...e, docComplete: true }));
                    addTimeline(active.id, { label: 'On-scene clinical documentation saved to chart', kind: 'doc' });
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
                >
                  <Save className="h-4 w-4" /> Save Documentation
                </button>
              </div>
            </div>

            {/* Post-intervention panel — appears once resolved */}
            {(active.status === 'resolved' || active.status === 'closed') && (
              <div className="bg-white rounded-xl border-2 border-sky-200 p-5 space-y-5">
                <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                  <Bell className="h-4 w-4 text-sky-700" /> Post-Intervention — Notifications & Follow-Up
                </h3>

                {active.disposition ? (
                  <div className="bg-sky-50 border border-sky-200 rounded-lg p-3 text-sm text-sky-800">
                    <strong>Disposition:</strong> {active.disposition}
                  </div>
                ) : (
                  <div>
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Final Disposition</p>
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
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-800"
                        >
                          {d}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinician notifications */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Care Team Notification {active.notificationsSent && <span className="text-emerald-700">— sent {nowStr()}</span>}
                  </p>
                  <div className="space-y-1.5">
                    {[
                      { who: 'Primary Therapist', via: 'Secure SMS + encrypted email summary', Icon: MessageSquare },
                      { who: 'Psychiatrist (On-Call Supervisor)', via: 'SNS high-priority alert', Icon: ShieldAlert },
                      { who: 'Referral source (988 Regional Center)', via: 'Disposition callback — consent on file', Icon: Share2 },
                    ].map((n) => (
                      <div key={n.who} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50 border border-slate-100">
                        <n.Icon className={`h-4 w-4 shrink-0 ${active.notificationsSent ? 'text-emerald-700' : 'text-slate-500'}`} />
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800">{n.who}</p>
                          <p className="text-[11px] text-slate-500">{n.via}</p>
                        </div>
                        {active.notificationsSent ? (
                          <span className="text-[11px] font-bold text-emerald-700 inline-flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> Delivered
                          </span>
                        ) : (
                          <span className="text-[11px] font-bold text-amber-700">Not sent</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {!active.notificationsSent && (
                    <button
                      disabled
                      title="Automated post-intervention notifications (SMS/email/SNS) are not connected yet. Notify these contacts by phone or secure message and log it in the timeline."
                      className="mt-2.5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-white text-sm font-semibold opacity-50 cursor-not-allowed"
                    >
                      <Send className="h-4 w-4" /> Send Notifications (not connected)
                    </button>
                  )}
                  <p className="mt-2 text-[11px] text-slate-500">
                    No PHI in SMS — messages contain a secure link to the episode summary. All sends are audit-logged.
                  </p>
                </div>

                {/* AI episode summary — Bedrock when available, else a labelled record extract */}
                <div className="rounded-xl border-2 border-slate-200 p-4 bg-white">
                  <div className="flex items-center gap-2 mb-2">
                    <Bot className="h-4 w-4 text-blue-500" />
                    <p className="text-sm font-bold text-slate-700 flex-1">AI Episode Summary</p>
                    {aiSummaries[active.id] && (
                      <span className="text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                        {aiSummaryFromAi[active.id] ? 'Scribe · AWS Bedrock AI draft' : 'Record extract (AI unavailable)'}
                      </span>
                    )}
                  </div>
                  {aiSummaries[active.id] ? (
                    <>
                      <textarea
                        value={aiSummaries[active.id]}
                        onChange={(e) => setAiSummaries((prev) => ({ ...prev, [active.id]: e.target.value }))}
                        rows={9}
                        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {aiSummaryFromAi[active.id]
                          ? 'AI-drafted from the episode timeline, MSE, and interventions.'
                          : 'Assembled from the episode record without AI; fields not documented read "not recorded".'}{' '}
                        Review and edit before filing.
                      </p>
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <p className="text-xs text-slate-500 flex-1">
                        One click drafts the post-intervention summary note from everything already documented — timeline,
                        MSE, interventions, disposition, and the person&apos;s own words.
                      </p>
                      <button
                        onClick={() => draftSummary(active)}
                        disabled={aiSummaryLoading === active.id}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-xs font-bold hover:bg-brand-700 disabled:opacity-60 shrink-0"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        {aiSummaryLoading === active.id ? 'Drafting…' : 'Draft Summary'}
                      </button>
                    </div>
                  )}
                </div>

                {/* Charge capture — drafted from timeline timestamps */}
                <div className="rounded-xl border border-slate-200 p-4 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Charge Capture</p>
                  {(() => {
                    const mins = minutesBetween(active.dispatchedAt, active.resolvedAt);
                    const telehealth = active.team === 'Telehealth de-escalation';
                    const units = telehealth ? 1 : Math.max(1, Math.ceil(mins / 15));
                    const code = telehealth ? '90839 (crisis psychotherapy)' : `H2011 × ${units} units`;
                    const amount = telehealth ? 220 : units * 34;
                    return (
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[200px]">
                          <p className="text-sm font-bold text-slate-800">{code} — ${amount.toLocaleString()}</p>
                          <p className="text-[11px] text-slate-500">
                            Computed from the episode timeline ({active.dispatchedAt}–{active.resolvedAt ?? 'now'}
                            {!telehealth && `, ${mins} min`}) · {telehealth ? 'POS 10' : 'POS 15 (mobile unit)'}
                          </p>
                        </div>
                        {active.chargeRouted ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
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
                        {canOpenChargeQueue && (
                          <a href="/dashboard/billing/residential-crisis" className="text-[11px] font-semibold text-blue-600 hover:underline">
                            Open charge queue →
                          </a>
                        )}
                      </div>
                    );
                  })()}
                  <p className="mt-2 text-[11px] text-slate-500">
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
                          state === 'completed' ? 'border-emerald-300 bg-emerald-50' : state === 'scheduled' ? 'border-sky-200 bg-sky-50' : 'border-slate-200'
                        }`}
                      >
                        <p className="text-sm font-bold text-slate-800">{f.label}</p>
                        <p className="text-[11px] text-slate-500 mb-3">{f.sub}</p>
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
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" /> Mark Completed
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
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
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Home className="h-4 w-4" /> Close Episode
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* CARF checklist for this episode */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" /> CARF Episode Checklist
              </h3>
              <div className="space-y-1.5">
                {carfChecklist(active).map((c) => (
                  <div key={c.label} className="flex items-center gap-3 py-1.5 border-b border-slate-50 last:border-0">
                    {c.done ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-slate-500 shrink-0" />
                    )}
                    <span className={`text-sm flex-1 ${c.done ? 'text-slate-700' : 'text-slate-500'}`}>{c.label}</span>
                    <span className="text-[11px] font-semibold text-blue-500 bg-blue-50 px-2 py-0.5 rounded-full shrink-0 hidden sm:inline">
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
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-blue-500" /> Episode Compliance Dashboard
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Every episode is measured against the crisis program&apos;s CARF conformance targets — exceptions feed the QI plan.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="sticky left-0 z-10 bg-white px-5 py-2.5 font-semibold">Episode</th>
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
                        <span className={`inline-flex items-center gap-1 text-xs font-bold ${ok ? 'text-emerald-700' : 'text-amber-700'}`}>
                          {ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          {label ?? (ok ? 'Yes' : 'Open')}
                        </span>
                      </td>
                    );
                    return (
                      <tr key={e.id} className="group border-b border-slate-50 last:border-0 hover:bg-slate-50">
                        <td className="sticky left-0 z-10 bg-white px-5 py-3 group-hover:bg-slate-50">
                          <p className="font-semibold text-slate-900 text-xs">{e.id}</p>
                          <p className="text-[11px] text-slate-500">{e.client} · P{e.priority}</p>
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
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-bold text-slate-700 mb-3">CARF Crisis Program — How This Module Conforms</h3>
              <ul className="space-y-2.5 text-sm text-slate-600">
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
                    <BadgeCheck className="h-4 w-4 text-blue-500 shrink-0 mt-0.5" />
                    <span><strong className="text-slate-800">{title}.</strong> {body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-[11px] text-slate-500">
                Map each item to your current CARF Behavioral Health standards manual during survey preparation — standard
                numbering varies by manual year and program designation.
              </p>
            </div>

            {/* Survey readiness */}
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-700 mb-3">Accreditation Survey Readiness</h3>
                {(
                  [
                    { label: 'Response-time conformance (90-day rolling)', pct: metrics.pctWithin, empty: 'No responses recorded' },
                    { label: '24-hour follow-up completion', pct: metrics.pctFollowUp, empty: 'No resolved episodes' },
                    { label: 'Documentation completed within 24 hrs', pct: metrics.pctDocComplete, empty: 'No episodes' },
                    // No staff training records exist in HR yet: not tracked, never a computed 0%
                    { label: 'Staff crisis-response training current', pct: null, empty: 'Not tracked in HR' },
                  ] as Array<{ label: string; pct: number | null; empty: string }>
                ).map((m) => (
                  <div key={m.label} className="mb-3 last:mb-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-600 font-medium">{m.label}</span>
                      {m.pct == null ? (
                        <span className="font-bold text-slate-500" title={m.empty}>—</span>
                      ) : (
                        <span className={`font-bold ${m.pct >= 90 ? 'text-emerald-700' : 'text-amber-700'}`}>{m.pct}%</span>
                      )}
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      {m.pct != null ? (
                        <div
                          className={`h-full rounded-full ${m.pct >= 90 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                          style={{ width: `${m.pct}%` }}
                        />
                      ) : null}
                    </div>
                    {m.pct == null ? <p className="mt-0.5 text-[11px] text-slate-500">{m.empty}</p> : null}
                  </div>
                ))}
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
                <TrendingUp className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                <p className="text-sm text-blue-800">
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
