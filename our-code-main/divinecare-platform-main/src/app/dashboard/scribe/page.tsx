'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Mic, Bot, Lightbulb, CalendarDays, BarChart3, ClipboardList, AlertTriangle, CreditCard, FileText, PenLine, Lock, CheckCircle2, Plus } from 'lucide-react';
import { useClients } from '@/features/clients/hooks/useClients';
import { createClientNote, fetchEhrProgressNotes } from '@/features/clients/api/clientsApi';
import type { Client, EhrProgressNote } from '@/features/clients/types';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { generateClaimFromNote } from '@/features/billing/claimsApi';
import { useModuleList } from '@/lib/modules/useModuleList';
import { apiJson } from '@/lib/api-client';
import { VisitGuide } from '@/components/visits/VisitGuide';
import { VisitSessionTabs } from '@/components/visits/VisitSessionTabs';
import { TemplateCues } from '@/components/scribe/TemplateCues';
import { RecordingStatusBar } from '@/components/scribe/RecordingStatusBar';
import { DraftSuggestions } from '@/components/scribe/DraftSuggestions';
import { buildDraftGroups } from '@/lib/scribe-feedback/draftGroups';
import { applyMseAliases } from '@/lib/scribe-feedback/mseAliases';
import {
  NO_MED_CHANGES_LABEL,
  applyNoMedChanges,
  hasNoMedChanges,
  showsNoMedChanges,
} from '@/lib/scribe-feedback/noMedChanges';
import { MAX_RECONNECT_ATTEMPTS, isNoAudio } from '@/lib/scribe-feedback/recordingStatus';
import {
  insertWithheld,
  withholdDraftSections,
  type WithheldSuggestion,
} from '@/lib/scribe-feedback/withheld';
import {
  DismissScribeDialog,
  DISMISS_SCRIBE_AFTER,
  DISMISS_SCRIBE_BTN,
} from '@/components/scribe/DismissScribeDialog';
import {
  SCRIBE_FORMATS,
  defaultScribeFormat,
  type ScribeFormatKey,
} from '@/lib/scribe/formats';
import { useAuth } from '@/features/auth';
import toast from 'react-hot-toast';

type Phase = 'setup' | 'recording' | 'processing' | 'results';
type NoteFormat = ScribeFormatKey;
type ResultTab = 'note' | 'suggestions' | 'transcript' | 'coding';
type SourceMode = 'live' | 'telehealth' | 'dictation';
type SuggestionCategory = 'scheduling' | 'assessment' | 'treatment' | 'risk' | 'billing' | 'homework';
type Priority = 'high' | 'medium' | 'low';

interface Suggestion {
  id: string;
  category: SuggestionCategory;
  priority: Priority;
  title: string;
  detail: string;
  actionLabel?: string;
  actionHref?: string;
  accepted?: boolean;
  dismissed?: boolean;
}

interface GeneratedNote {
  format: NoteFormat;
  sections: Record<string, string>;
  confidence: number;
  billingCode: string;
  duration: string;
}

interface ScribeClient {
  name: string;
  dx: string;
  pronoun: string;
  lastPHQ: number;
  phqTrend: 'up' | 'down' | 'stable';
  lastSession: string;
  planGoal: string;
  notes: EhrProgressNote[];
}

const SESSION_TYPES = [
  'Individual Therapy',
  'Group Therapy',
  'Medication Review',
  'Crisis Intervention',
  'Initial Intake',
  'Telehealth Session',
];

function buildSuggestions(client: ScribeClient, sessionType: string): Suggestion[] {
  const suggestions: Suggestion[] = [];
  const firstName = client.name.split(' ')[0];

  // Scheduling
  const scheduleInterval = client.dx.includes('severe') || client.phqTrend === 'up' ? '3–4 days' : '7 days';
  suggestions.push({
    id: 'sched-1',
    category: 'scheduling',
    priority: client.phqTrend === 'up' ? 'high' : 'medium',
    title: `Schedule follow-up in ${scheduleInterval}`,
    detail: client.phqTrend === 'up'
      ? `PHQ-9 trending upward. More frequent contact recommended to monitor stability.`
      : `Standard weekly follow-up aligns with ${firstName}'s current treatment plan.`,
    actionLabel: 'Schedule Now',
    actionHref: '/dashboard/appointments',
  });

  // Assessment
  if (client.lastPHQ > 28) {
    suggestions.push({
      id: 'assess-1',
      category: 'assessment',
      priority: 'high',
      title: `PHQ-9 overdue (${client.lastPHQ} days ago)`,
      detail: `Standard reassessment window is 28 days. Administer at next session to track depression severity.`,
      actionLabel: 'Open Assessment',
      actionHref: '/dashboard/ehr/assessments',
    });
  }
  if (client.dx.includes('PTSD')) {
    suggestions.push({
      id: 'assess-2',
      category: 'assessment',
      priority: 'medium',
      title: 'PCL-5 due next session',
      detail: 'PTSD Checklist for DSM-5 recommended every 30 days during active trauma processing.',
      actionLabel: 'Open Assessment',
      actionHref: '/dashboard/ehr/assessments',
    });
  }
  if (client.dx.includes('AUD') || client.dx.includes('Bipolar')) {
    suggestions.push({
      id: 'assess-3',
      category: 'assessment',
      priority: 'medium',
      title: client.dx.includes('AUD') ? 'AUDIT-C follow-up recommended' : 'MDQ mood tracking suggested',
      detail: client.dx.includes('AUD')
        ? 'Alcohol use reassessment aligns with relapse prevention protocol.'
        : 'Mood Disorder Questionnaire helps track cycling patterns between sessions.',
      actionLabel: 'Open Assessment',
      actionHref: '/dashboard/ehr/assessments',
    });
  }

  // Treatment plan
  const goalAtRisk = client.planGoal.includes('at risk') || client.planGoal.includes('partial');
  suggestions.push({
    id: 'tx-1',
    category: 'treatment',
    priority: goalAtRisk ? 'high' : 'low',
    title: goalAtRisk ? `Treatment goal needs attention` : 'Treatment plan on track',
    detail: `${client.planGoal}. ${goalAtRisk ? 'Consider modifying intervention strategy or adjusting goal timeline.' : 'Continue current approach.'}`,
    actionLabel: 'View Treatment Plan',
    actionHref: '/dashboard/ehr/treatment-plans',
  });

  // Risk
  if (client.phqTrend === 'up' || client.dx.includes('severe')) {
    suggestions.push({
      id: 'risk-1',
      category: 'risk',
      priority: client.dx.includes('severe') ? 'high' : 'medium',
      title: client.dx.includes('severe') ? 'Elevated risk — safety plan review' : 'Mood deterioration noted',
      detail: client.dx.includes('severe')
        ? `${firstName}'s PHQ-9 trend and diagnosis warrant safety plan review at each contact. Consider psychiatric consultation.`
        : `PHQ-9 score has increased over the past ${Math.round(client.lastPHQ / 7)} sessions. Increase monitoring frequency.`,
      actionLabel: 'View Risk Alerts',
      actionHref: '/dashboard/alerts',
    });
  }

  // Billing
  const cpt = sessionType === 'Individual Therapy' ? '90837'
    : sessionType === 'Group Therapy' ? '90853'
    : sessionType === 'Medication Review' ? '99213'
    : sessionType === 'Initial Intake' ? '90791'
    : '90837';
  const cptDesc = sessionType === 'Individual Therapy' ? 'Individual therapy, 53+ min'
    : sessionType === 'Group Therapy' ? 'Group psychotherapy'
    : sessionType === 'Medication Review' ? 'Office visit, established patient'
    : sessionType === 'Initial Intake' ? 'Psychiatric diagnostic eval'
    : 'Individual therapy, 53+ min';
  suggestions.push({
    id: 'bill-1',
    category: 'billing',
    priority: 'low',
    title: `Billing: ${cpt} — ${cptDesc}`,
    detail: `Session duration and type support ${cpt}. Documentation in the generated note satisfies medical necessity requirements for this code.`,
    actionLabel: 'View Billing',
    actionHref: '/dashboard/billing',
  });

  // Homework / between-session
  suggestions.push({
    id: 'hw-1',
    category: 'homework',
    priority: 'low',
    title: 'Between-session task suggested',
    detail: client.dx.includes('MDD') || client.dx.includes('Anxiety')
      ? `Behavioral activation log, daily mood tracking (1–10 scale), and 10-min mindfulness practice.`
      : client.dx.includes('PTSD')
      ? `Grounding practice (5-4-3-2-1) when triggered. Journal: one safe memory per day.`
      : `Review coping card created in session. Use skills when distress rises above 5/10.`,
  });

  return suggestions;
}

function generateNote(client: ScribeClient, format: NoteFormat, transcript: string[], sessionType: string): GeneratedNote {
  const firstName = client.name.split(' ')[0];
  const pronoun = client.pronoun;
  const he_she = pronoun === 'He' ? 'He' : 'She';
  const his_her = pronoun === 'He' ? 'His' : 'Her';
  const him_her = pronoun === 'He' ? 'him' : 'her';

  const sessionDuration = '53 minutes';
  const intervention = client.dx.includes('PTSD') ? 'EMDR and trauma-focused CBT' :
    client.dx.includes('Bipolar') ? 'DBT skills and psychoeducation' :
    client.dx.includes('AUD') ? 'Motivational Interviewing and relapse prevention' :
    'Cognitive Behavioral Therapy (CBT) and behavioral activation';

  const riskStatement = 'Client denied current suicidal ideation, homicidal ideation, or intent to harm self or others. Safety plan reviewed and remains in place.';

  if (format === 'SOAP') {
    return {
      format,
      confidence: 94,
      billingCode: sessionType === 'Individual Therapy' ? '90837' : '90853',
      duration: sessionDuration,
      sections: {
        Subjective: `${firstName} presented for scheduled ${sessionType.toLowerCase()}. ${he_she} reported ongoing challenges with ${client.dx.toLowerCase().includes('mdd') ? 'depressive symptoms and low motivation' : client.dx.toLowerCase().includes('ptsd') ? 'trauma-related hypervigilance and avoidance' : 'mood instability and interpersonal difficulties'}. ${he_she} noted ${client.phqTrend === 'up' ? 'worsening of symptoms' : client.phqTrend === 'down' ? 'some improvement' : 'symptoms consistent with previous session'}. ${firstName} endorsed disrupted sleep and reduced engagement in previously enjoyed activities. ${he_she} stated, "I've been trying to use what we worked on." No significant changes in medications or medical history reported since last contact.`,
        Objective: `${firstName} presented as ${client.phqTrend === 'up' ? 'moderately distressed, tearful at times' : 'cooperative and engaged, mildly anxious'}. Appearance was well-groomed and appropriate. Speech was normal in rate, rhythm, and volume. Thought process was linear and goal-directed. Insight and judgment appeared intact. ${riskStatement} Session duration: ${sessionDuration}.`,
        Assessment: `${firstName} continues to meet diagnostic criteria for ${client.dx}. ${he_she} demonstrates ${client.planGoal.includes('progressing') ? 'gradual progress toward treatment goals' : 'variable progress with identified barriers to goal attainment'}. ${his_her} response to ${intervention} has been ${client.phqTrend === 'up' ? 'partial, with continued functional impairment' : 'positive, with emerging skill application'}. PHQ-9 trend: ${client.phqTrend === 'up' ? 'increasing — monitoring closely' : client.phqTrend === 'down' ? 'decreasing — positive trajectory' : 'stable'}. Overall clinical trajectory: ${client.phqTrend === 'up' ? 'guarded, increased monitoring indicated' : 'improving, continue current approach'}.`,
        Plan: `1. Continue ${sessionType.toLowerCase()} on ${client.phqTrend === 'up' ? 'increased frequency (3–4 days)' : 'weekly basis'}. 2. Primary intervention: ${intervention}. 3. ${firstName} to complete between-session practice: ${client.dx.includes('MDD') ? 'behavioral activation log, daily mood rating' : client.dx.includes('PTSD') ? 'grounding exercises, safe memory journaling' : 'coping skills practice as outlined in session'}. 4. ${riskStatement} 5. Reassess PHQ-9 at next session (overdue ${client.lastPHQ} days). 6. Return for follow-up in ${client.phqTrend === 'up' ? '3–4' : '7'} days.`,
      },
    };
  }

  if (format === 'DAP') {
    return {
      format,
      confidence: 91,
      billingCode: sessionType === 'Individual Therapy' ? '90837' : '90853',
      duration: sessionDuration,
      sections: {
        Data: `${firstName} attended scheduled ${sessionType.toLowerCase()}. ${he_she} reported ${client.phqTrend === 'up' ? 'worsening depression and anxiety' : 'continued progress with intermittent setbacks'}. ${he_she} appeared ${client.phqTrend === 'up' ? 'moderately distressed with tearful affect' : 'cooperative, mild anxiety noted'}. Denied SI/HI. Identified challenges included ${client.dx.includes('MDD') ? 'low energy, isolation, and negative self-talk' : client.dx.includes('PTSD') ? 'hypervigilance, intrusive thoughts, and avoidance behaviors' : 'mood cycling, impulse control, and interpersonal conflict'}. ${he_she} reported partial completion of between-session homework.`,
        Assessment: `${firstName} demonstrates ${client.planGoal}. Current symptom severity is ${client.phqTrend === 'up' ? 'moderate to severe' : 'mild to moderate'}, consistent with ${client.dx}. ${his_her} engagement in ${intervention} reflects ${client.phqTrend === 'up' ? 'effortful participation despite significant distress' : 'growing confidence in skill application'}. Short-term treatment goals are ${client.planGoal.includes('progressing') ? 'progressing as expected' : 'in need of reassessment and possible modification'}.`,
        Plan: `Continue ${intervention} as primary modality. Assign between-session practice. Reassess PHQ-9 next session. Return in ${client.phqTrend === 'up' ? '3–4 days' : '1 week'}. ${riskStatement}`,
      },
    };
  }

  // BIRP
  return {
    format,
    confidence: 92,
    billingCode: sessionType === 'Individual Therapy' ? '90837' : '90853',
    duration: sessionDuration,
    sections: {
      Behavior: `${firstName} presented for ${sessionType.toLowerCase()} reporting ${client.phqTrend === 'up' ? 'increased distress and symptom worsening' : 'ongoing challenges with intermittent improvement'}. ${he_she} appeared ${client.phqTrend === 'up' ? 'moderately anxious and tearful' : 'cooperative and engaged'}. Verbalizations were consistent with ${client.dx}. ${riskStatement}`,
      Intervention: `Clinician utilized ${intervention}. Cognitive restructuring techniques applied to maladaptive thought patterns. Between-session homework reviewed and reinforced. Psychoeducation provided regarding symptom management. ${client.dx.includes('PTSD') ? 'Grounding skills practiced in session. EMDR processing continued.' : client.dx.includes('AUD') ? 'Relapse prevention planning updated. MI techniques used to strengthen commitment to sobriety.' : 'Behavioral activation log reviewed and updated. Activity scheduling for coming week completed.'}`,
      Response: `${firstName} responded ${client.phqTrend === 'up' ? 'with initial resistance, gradually becoming more engaged as session progressed' : 'positively to interventions, demonstrating insight and willingness to apply skills'}. ${he_she} demonstrated emerging ability to ${client.dx.includes('PTSD') ? 'use grounding in response to triggers' : 'identify and challenge cognitive distortions'}. Affect improved over course of session.`,
      Plan: `Return in ${client.phqTrend === 'up' ? '3–4 days' : '1 week'}. Continue ${intervention}. Complete assigned between-session practice. ${riskStatement} Reassess PHQ-9 at next contact.`,
    },
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
type CatConfig = { label: string; IconComponent: React.ElementType; color: string; bg: string; border: string };
const CAT_CONFIG: Record<SuggestionCategory, CatConfig> = {
  scheduling: { label: 'Scheduling',     IconComponent: CalendarDays, color: '#6868D0', bg: '#F5F3FF', border: '#C4B5FD' },
  assessment: { label: 'Assessment',     IconComponent: BarChart3,    color: '#5555B8', bg: '#EEF0FE', border: '#BFDBFE' },
  treatment:  { label: 'Treatment Plan', IconComponent: ClipboardList, color: '#5555B8', bg: '#EEF0FE', border: '#C5C7F8' },
  risk:       { label: 'Risk',           IconComponent: AlertTriangle, color: '#B45309', bg: '#FFFBEB', border: '#FDE68A' },
  billing:    { label: 'Billing',        IconComponent: CreditCard,   color: '#4B5563', bg: '#F9FAFB', border: '#E5E7EB' },
  homework:   { label: 'Client Task',    IconComponent: FileText,     color: '#6868D0', bg: '#F5F3FF', border: '#DDD6FE' },
};

const PRI_DOT: Record<Priority, string> = { high: '#EF4444', medium: '#F59E0B', low: '#6B7280' };

function Waveform({ active }: { active: boolean }) {
  const bars = Array.from({ length: 32 }, (_, i) => 8 + ((i * 7) % 32));
  return (
    <div className="flex items-center justify-center gap-0.5 h-12">
      {bars.map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all"
          style={{
            width: 3,
            backgroundColor: active ? '#6868D0' : '#E5E7EB',
            height: active ? `${bars[i]}px` : '4px',
            animation: active ? `wave ${0.5 + (i % 5) * 0.1}s ease-in-out infinite alternate` : 'none',
            animationDelay: `${i * 0.04}s`,
          }}
        />
      ))}
      <style>{`@keyframes wave { from { transform: scaleY(0.3); } to { transform: scaleY(1); } }`}</style>
    </div>
  );
}
const PROCESSING_STEPS = [
  'Analyzing session transcript…',
  'Calling AI Scribe (Bedrock)…',
  'Identifying chief complaints and themes…',
  'Detecting intervention techniques used…',
  'Assessing risk language and safety content…',
  'Running Comprehend Medical — ICD-10 & RxNorm coding…',
  'Generating clinical documentation…',
  'Suggesting follow-up actions…',
];

type TelehealthOption = {
  id: string;
  clientId: string;
  clientName: string;
  type: string;
  sessionDate: string;
  status: string;
  notesSummary: string | null;
};

type ComprehendCoding = {
  demoMode: boolean;
  entities: Array<{ text: string; category: string; type: string; score: number }>;
  icd10: Array<{ code: string; description: string; score: number }>;
  medications: Array<{ code: string; description: string; score: number }>;
};

function daysSince(dateIso?: string | null) {
  if (!dateIso) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(dateIso).getTime()) / 86_400_000));
}

function buildTranscriptPreview(notes: EhrProgressNote[], clientName: string) {
  const raw = notes
    .slice(0, 2)
    .map((note) => note.body)
    .join(' ')
    .trim();

  if (!raw) {
    return [
      `Clinician: Reviewing progress and recent chart updates for ${clientName}.`,
      'Client: I want to keep the plan simple and consistent.',
      'Clinician: Let us focus on sleep, routine, and safety today.',
      'Client: That feels manageable.',
    ];
  }

  const sentences = raw.split(/(?<=[.!?])\s+/).map((part) => part.trim()).filter(Boolean).slice(0, 8);
  return sentences.map((sentence, index) => `${index % 2 === 0 ? 'Clinician' : 'Client'}: ${sentence}`);
}

function toScribeClient(client: Client, notes: EhrProgressNote[]) {
  const diagnosis = client.primaryDiagnosis || 'Behavioral health follow-up';
  const riskTrend = client.risk === 'high'
    ? 'up'
    : (client.avgMood ?? 5) >= 7 && (client.streak ?? 0) >= 3
      ? 'down'
      : 'stable';

  return {
    name: client.name,
    dx: diagnosis,
    pronoun: client.gender && /male/i.test(client.gender) ? 'He' : 'She',
    lastPHQ: daysSince(client.lastCheckIn) || 7,
    phqTrend: riskTrend,
    lastSession: client.lastCheckIn ? `${daysSince(client.lastCheckIn)} days ago` : 'recently',
    planGoal:
      client.risk === 'high'
        ? 'Safety planning and close follow-up'
        : diagnosis.toLowerCase().includes('ptsd')
          ? 'Trauma processing and grounding practice'
          : diagnosis.toLowerCase().includes('substance') || diagnosis.toLowerCase().includes('aud')
            ? 'Relapse prevention and recovery support'
            : 'Behavioral activation and routine consistency',
    notes,
  };
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function ScribePage() {
  const { user } = useAuth();
  const { clients, loading: clientsLoading } = useClients();
  const [phase, setPhase] = useState<Phase>('setup');
  const [selectedClient, setSelectedClient] = useState('');
  const [sessionType, setSessionType] = useState('Individual Therapy');
  const [noteFormat, setNoteFormat] = useState<NoteFormat>(() =>
    defaultScribeFormat(user?.role)
  );
  const [dismissScribeOpen, setDismissScribeOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [transcript, setTranscript] = useState<string[]>([]);
  const [processingStep, setProcessingStep] = useState(0);
  const [resultTab, setResultTab] = useState<ResultTab>('note');
  const [generatedNote, setGeneratedNote] = useState<GeneratedNote | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [, setAcceptedSuggestions] = useModuleList<{
    id: string;
    title: string;
    category: SuggestionCategory;
    clientId: string;
    noteId: string | null;
    acceptedAt: string;
  }>('scribe-accepted-suggestions', []);
  const [noteSections, setNoteSections] = useState<Record<string, string>>({});
  const [noteSigned, setNoteSigned] = useState(false);
  const [lockBusy, setLockBusy] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [lockedNoteId, setLockedNoteId] = useState<string | null>(null);
  const [useRealMic, setUseRealMic] = useState(false);
  const [ehrNotes, setEhrNotes] = useState<EhrProgressNote[]>([]);
  const [sourceMode, setSourceMode] = useState<SourceMode>('live');
  const [telehealthSessions, setTelehealthSessions] = useState<TelehealthOption[]>([]);
  const [selectedTelehealthId, setSelectedTelehealthId] = useState('');
  const [comprehend, setComprehend] = useState<ComprehendCoding | null>(null);
  const [comprehendError, setComprehendError] = useState<string | null>(null);
  const [scribeMeta, setScribeMeta] = useState<{
    source: 'bedrock' | 'local';
    demoMode?: boolean;
    error?: string | null;
  }>({ source: 'local' });

  const [withheld, setWithheld] = useState<WithheldSuggestion[]>([]);
  const [insertedIds, setInsertedIds] = useState<string[]>([]);
  const [reconnect, setReconnect] = useState<{ reason: string; attempt: number } | null>(null);
  const [noAudio, setNoAudio] = useState(false);

  const lastAudioAtRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const transcriptTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);
  const scribeDraftRef = useRef<{
    sections?: Record<string, string>;
    billingCode?: string;
    confidence?: number;
  } | null>(null);

  const clientData = clients.find((c) => c.id === selectedClient);
  const clientNotes = ehrNotes.filter((note) => note.clientId === selectedClient);
  const scribeClient = clientData ? toScribeClient(clientData, clientNotes) : null;
  const completedTelehealth = telehealthSessions.filter(
    (s) => s.status === 'completed' && (!selectedClient || s.clientId === selectedClient)
  );
  const selectedTelehealth = telehealthSessions.find((s) => s.id === selectedTelehealthId);

  useEffect(() => {
    let cancelled = false;
    fetchEhrProgressNotes()
      .then((res) => {
        if (!cancelled) setEhrNotes(res.notes);
      })
      .catch(() => {
        if (!cancelled) setEhrNotes([]);
      });
    apiJson<{ success: true; sessions: TelehealthOption[] }>('/api/telehealth/sessions?scope=history')
      .then((res) => {
        if (!cancelled) {
          setTelehealthSessions(res.sessions || []);
        }
      })
      .catch(() => {
        if (!cancelled) setTelehealthSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedClient && clients.length > 0) {
      setSelectedClient(clients[0].id);
    } else if (selectedClient && !clients.some((client) => client.id === selectedClient) && clients.length > 0) {
      setSelectedClient(clients[0].id);
    }
  }, [clients, selectedClient]);

  // Timer
  useEffect(() => {
    if (recording && !paused) {
      timerRef.current = setInterval(() => {
        setElapsed(e => e + 1);
        // NO_AUDIO: only meaningful when a real microphone is feeding the transcript
        if (recognitionRef.current && lastAudioAtRef.current > 0) {
          setNoAudio(isNoAudio((Date.now() - lastAudioAtRef.current) / 1000));
        }
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [recording, paused]);

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
  }, [transcript]);

  const startRecording = useCallback(() => {
    setRecording(true);
    setPaused(false);
    setElapsed(0);
    setTranscript([]);
    setComprehend(null);
    setComprehendError(null);
    setReconnect(null);
    setNoAudio(false);
    reconnectAttemptsRef.current = 0;
    lastAudioAtRef.current = 0;
    setPhase('recording');

    const micOn = sourceMode === 'dictation' || useRealMic;

    if (sourceMode === 'telehealth' && selectedTelehealth) {
      const summary = selectedTelehealth.notesSummary?.trim();
      const lines = summary
        ? summary.split(/\n+/).map((l) => l.trim()).filter(Boolean)
        : [
            `Clinician: Telehealth session (${selectedTelehealth.type}) completed.`,
            `Client: Discussed ongoing symptoms and treatment plan follow-up.`,
          ];
      setTranscript(lines);
      return;
    }

    if (micOn && 'webkitSpeechRecognition' in window) {
      const SpeechRecognition = (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      let lastError = '';
      recognition.onresult = (event: any) => {
        lastAudioAtRef.current = Date.now();
        reconnectAttemptsRef.current = 0;
        setNoAudio(false);
        setReconnect(null);
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            const text = event.results[i][0].transcript.trim();
            if (text) setTranscript(prev => [...prev, text]);
          }
        }
      };
      recognition.onerror = (event: any) => {
        lastError = String(event?.error || '');
      };
      recognition.onend = () => {
        // Stop / dismiss clear recognitionRef first, so only an unexpected end reconnects.
        if (recognitionRef.current !== recognition) return;
        const attempt = reconnectAttemptsRef.current + 1;
        if (attempt > MAX_RECONNECT_ATTEMPTS) {
          setReconnect({ reason: lastError || 'speech service stopped', attempt: MAX_RECONNECT_ATTEMPTS });
          return;
        }
        reconnectAttemptsRef.current = attempt;
        setReconnect({ reason: lastError || 'speech service stopped', attempt });
        setTimeout(() => {
          if (recognitionRef.current !== recognition) return;
          try {
            recognition.start();
          } catch {
            /* next onend retries */
          }
        }, 1000);
      };
      lastAudioAtRef.current = Date.now();
      recognition.start();
      recognitionRef.current = recognition;
    } else {
      const lines = buildTranscriptPreview(clientNotes, clientData?.name || 'the client');
      let idx = 0;
      transcriptTimerRef.current = setInterval(() => {
        if (idx < lines.length) {
          setTranscript(prev => [...prev, lines[idx]]);
          idx++;
        } else {
          if (transcriptTimerRef.current) clearInterval(transcriptTimerRef.current);
        }
      }, 3200);
    }
  }, [clientData?.name, clientNotes, useRealMic, sourceMode, selectedTelehealth]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (transcriptTimerRef.current) clearInterval(transcriptTimerRef.current);
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }

    setReconnect(null);
    setNoAudio(false);
    setPhase('processing');
    setProcessingStep(0);
    setComprehendError(null);
    setScribeMeta({ source: 'local' });
    scribeDraftRef.current = null;

    const transcriptText = transcript.filter(Boolean).join('\n');
    const analyzeText =
      transcriptText.length >= 10
        ? transcriptText.slice(0, 10000)
        : `${sessionType} session for ${scribeClient?.name || 'client'}. ${transcriptText || 'Clinical discussion of symptoms, interventions, and plan.'}`.slice(
            0,
            10000
          );

    const scribeTranscript =
      transcriptText.trim().length >= 20
        ? transcriptText.slice(0, 20000)
        : `${analyzeText}\nSession type: ${sessionType}. Format: ${noteFormat}.`.slice(0, 20000);

    void apiJson<{
      success: true;
      demoMode: boolean;
      entities: ComprehendCoding['entities'];
      icd10: ComprehendCoding['icd10'];
      medications: ComprehendCoding['medications'];
    }>('/api/comprehend/analyze', {
      method: 'POST',
      body: JSON.stringify({
        text: analyzeText,
        clientId: selectedClient || undefined,
        noteType: noteFormat,
      }),
    })
      .then((res) => {
        setComprehend({
          demoMode: res.demoMode,
          entities: res.entities,
          icd10: res.icd10,
          medications: res.medications,
        });
      })
      .catch((err) => {
        setComprehendError(err instanceof Error ? err.message : 'Comprehend analysis failed');
        setComprehend(null);
      });

    void apiJson<{
      success: boolean;
      demoMode?: boolean;
      error?: string;
      note?: {
        format?: NoteFormat;
        sections?: Record<string, string>;
        billingCode?: string;
        confidence?: number;
        duration?: string;
      };
      sections?: Record<string, string>;
    }>('/api/agents/scribe', {
      method: 'POST',
      body: JSON.stringify({
        transcript: scribeTranscript,
        noteFormat,
        clientId: selectedClient || undefined,
        sessionType,
        sourceMode,
      }),
    })
      .then((res) => {
        const sections = res.note?.sections || res.sections;
        if (res.success && sections && Object.keys(sections).length > 0) {
          scribeDraftRef.current = {
            sections,
            billingCode: res.note?.billingCode,
            confidence: res.note?.confidence,
          };
          setScribeMeta({ source: 'bedrock', demoMode: res.demoMode });
        } else {
          setScribeMeta({
            source: 'local',
            demoMode: res.demoMode,
            error: res.error || 'AI Scribe returned no draft',
          });
        }
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : 'AI Scribe unavailable';
        setScribeMeta({
          source: 'local',
          demoMode: /bedrock|demo|503|unavailable/i.test(message),
          error: message,
        });
      });

    let step = 0;
    const stepTimer = setInterval(() => {
      step++;
      setProcessingStep(step);
      if (step >= PROCESSING_STEPS.length) {
        clearInterval(stepTimer);
        setTimeout(() => {
          if (!scribeClient) return;
          const apiDraft = scribeDraftRef.current;
          setInsertedIds([]);
          if (apiDraft?.sections) {
            // Clinician-only headings are blanked; their AI text waits behind "Insert suggestion".
            const split = withholdDraftSections(applyMseAliases(apiDraft.sections));
            const note: GeneratedNote = {
              format: noteFormat,
              sections: split.sections,
              confidence: apiDraft.confidence ?? 90,
              billingCode: apiDraft.billingCode || '90837',
              duration: `${Math.max(1, Math.round(elapsed / 60)) || 50} minutes`,
            };
            setGeneratedNote(note);
            setNoteSections({ ...note.sections });
            setWithheld(split.withheld);
          } else {
            const note = generateNote(scribeClient as any, noteFormat, transcript, sessionType);
            setGeneratedNote(note);
            setNoteSections({ ...note.sections });
            setWithheld([]);
          }
          setSuggestions(buildSuggestions(scribeClient as any, sessionType));
          setResultTab('note');
          setPhase('results');
        }, 600);
      }
    }, 420);
  }, [
    noteFormat,
    scribeClient,
    transcript,
    sessionType,
    selectedClient,
    sourceMode,
    elapsed,
  ]);

  const formatLockedNoteBody = () => {
    const sections = Object.entries(noteSections)
      .map(([section, content]) => `${section.toUpperCase()}\n${content.trim()}`)
      .join('\n\n');
    const header = [
      `${noteFormat} note — ${sessionType}`,
      `Client: ${scribeClient?.name || selectedClient}`,
      generatedNote?.billingCode ? `CPT: ${generatedNote.billingCode}` : '',
      generatedNote?.duration ? `Duration: ${generatedNote.duration}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    return `${header}\n\n${sections}`.slice(0, 12000);
  };

  const handleSignAndLock = async () => {
    if (!selectedClient || noteSigned || lockBusy) return;
    setLockBusy(true);
    setLockError(null);
    try {
      const created = await createClientNote(selectedClient, formatLockedNoteBody());
      await updateProgressNoteStatus(created.id, 'Signed');
      await updateProgressNoteStatus(created.id, 'Locked');
      setLockedNoteId(created.id);
      setNoteSigned(true);
      const billing = suggestions.find((s) => s.category === 'billing' && s.accepted);
      if (billing && generatedNote?.billingCode) {
        await generateClaimFromNote(created.id, {
          cptCode: generatedNote.billingCode,
          markReady: true,
        }).catch(() => undefined);
      }
    } catch (err) {
      setLockError(err instanceof Error ? err.message : 'Could not save and lock the note');
    } finally {
      setLockBusy(false);
    }
  };

  const acceptSuggestion = async (id: string) => {
    const target = suggestions.find((s) => s.id === id);
    setSuggestions((prev) => prev.map((s) => (s.id === id ? { ...s, accepted: true } : s)));
    if (!target) return;
    setAcceptedSuggestions((prev) => [
      {
        id: `${id}-${Date.now()}`,
        title: target.title,
        category: target.category,
        clientId: selectedClient,
        noteId: lockedNoteId,
        acceptedAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    if (target.category === 'billing' && lockedNoteId && generatedNote?.billingCode) {
      try {
        await generateClaimFromNote(lockedNoteId, {
          cptCode: generatedNote.billingCode,
          markReady: true,
        });
      } catch {
        /* suggestion is already persisted on the client chart */
      }
    }
  };
  const insertWithheldSuggestion = (id: string) => {
    const target = withheld.find((w) => w.id === id);
    if (!target || noteSigned) return;
    setNoteSections((prev) => insertWithheld(prev, target));
    setInsertedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  };

  const assignSpokenMeasures = async (keys: string[], dueDate: string) => {
    if (!selectedClient) return;
    try {
      for (const instrumentKey of keys) {
        await apiJson('/api/clinical/measure-assignments', {
          method: 'POST',
          body: JSON.stringify({
            clientId: selectedClient,
            instrumentKey,
            frequency: 'once',
            nextDueAt: new Date(`${dueDate}T12:00:00`).toISOString(),
          }),
        });
      }
      toast.success(`Assigned ${keys.length} measure${keys.length === 1 ? '' : 's'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not assign measures');
      throw err;
    }
  };

  const dismissSuggestion = (id: string) => setSuggestions(prev => prev.map(s => s.id === id ? { ...s, dismissed: true } : s));

  const highCount = suggestions.filter(s => s.priority === 'high' && !s.dismissed).length;

  // ── SETUP ──────────────────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">AI Scribe</h1>
          <p className="text-slate-500 text-sm mt-1">Record your session — Altrixs generates the clinical note and post-session recommendations automatically.</p>
        </div>

        {/* Feature callouts */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { Icon: Mic, label: 'Live transcription', sub: 'Real-time capture', bg: '#EEF0FE', color: '#6868D0' },
            { Icon: Bot, label: 'AI documentation', sub: 'SOAP · DAP · BIRP', bg: '#EEF0FE', color: '#6868D0' },
            { Icon: Lightbulb, label: 'Clinical suggestions', sub: 'Scheduling, assessments, risk', bg: '#FEF9E7', color: '#D4A017' },
          ].map(f => (
            <div key={f.label} className="bg-white rounded-xl border border-slate-200/80 p-4 text-center shadow-sm">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2" style={{ backgroundColor: f.bg }}>
                <f.Icon size={20} style={{ color: f.color }} />
              </div>
              <p className="text-xs font-semibold text-slate-900">{f.label}</p>
              <p className="text-xs text-slate-400 mt-0.5">{f.sub}</p>
            </div>
          ))}
        </div>

        <VisitSessionTabs clientId={selectedClient || null} role={user?.role}>
          <VisitGuide
            visitType={sessionType}
            clientId={selectedClient || null}
            telehealth={sourceMode === 'telehealth'}
            missing={[!selectedClient ? 'Client' : ''].filter(Boolean)}
          />
        </VisitSessionTabs>

        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-slate-900">Session Setup</h2>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Client *</label>
              <select value={selectedClient} onChange={e => setSelectedClient(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                <option value="">Select client…</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Session Type *</label>
              <select value={sessionType} onChange={e => setSessionType(e.target.value)}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                {SESSION_TYPES.map(t =><option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Source mode</label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { id: 'live' as const, label: 'Live' },
                    { id: 'telehealth' as const, label: 'Telehealth Transcript' },
                    { id: 'dictation' as const, label: 'Voice Dictation' },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setSourceMode(mode.id);
                      if (mode.id === 'dictation') setUseRealMic(true);
                    }}
                    className={`rounded-xl border-2 px-3 py-2 text-xs font-bold transition-all ${
                      sourceMode === mode.id
                        ? 'border-transparent text-white'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                    style={sourceMode === mode.id ? { background: '#6868D0' } : {}}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>
            {sourceMode === 'telehealth' && (
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  Completed telehealth session *
                </label>
                <select
                  value={selectedTelehealthId}
                  onChange={(e) => {
                    setSelectedTelehealthId(e.target.value);
                    const session = telehealthSessions.find((s) => s.id === e.target.value);
                    if (session?.clientId) setSelectedClient(session.clientId);
                  }}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select a completed session…</option>
                  {completedTelehealth.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.clientName} — {s.type} — {new Date(s.sessionDate).toLocaleDateString()}
                    </option>
                  ))}
                </select>
                {completedTelehealth.length === 0 && (
                  <p className="mt-1 text-xs text-amber-700">
                    No completed telehealth sessions found for this caseload.
                  </p>
                )}
              </div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Note Format</label>
              <select
                value={noteFormat}
                onChange={(e) => setNoteFormat(e.target.value as NoteFormat)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              >
                <optgroup label="Your templates">
                  {SCRIBE_FORMATS.filter((f) => f.group === 'Your templates').map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="More templates">
                  {SCRIBE_FORMATS.filter((f) => f.group === 'More templates').map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              </select>
              <div className="mt-3">
                <TemplateCues visitGuideLabel={sessionType} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Date & Time</label>
              <input type="text" readOnly
                value={new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-slate-50 text-slate-500" />
            </div>
          </div>

          {/* Microphone toggle — live / dictation */}
          {sourceMode !== 'telehealth' && (
          <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: useRealMic ? '#EEF0FE' : '#EEF0FE' }}>
              {useRealMic || sourceMode === 'dictation' ? <Mic size={18} className="text-blue-600" />:<Bot size={18} className="text-blue-600" />}
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold text-slate-900">
                {sourceMode === 'dictation' || useRealMic ? 'Voice capture' : 'Chart preview mode'}
              </p>
              <p className="text-xs text-slate-500">
                {sourceMode === 'dictation' || useRealMic
                  ? 'Uses browser speech recognition (Chrome recommended)'
                  : 'Builds a transcript preview from recent chart notes'}
              </p>
            </div>
            {sourceMode === 'live' && (
              <button onClick={() => setUseRealMic(v => !v)}
                className={`w-12 h-6 rounded-full transition-all ${useRealMic ? 'bg-blue-600' : 'bg-slate-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${useRealMic ? 'translate-x-6' : ''}`} />
              </button>
            )}
          </div>
          )}

          {/* Client context preview */}
          {clientData && (
            <div className="rounded-xl border border-slate-300 bg-blue-50 p-4">
              <p className="text-xs font-bold text-blue-700 mb-2">Client Context — loaded from chart</p>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-700">
                <span><strong>Dx:</strong> {scribeClient?.dx}</span>
                <span><strong>Last session:</strong> {scribeClient?.lastSession}</span>
                <span><strong>Trend:</strong><span className={scribeClient?.phqTrend === 'up' ? 'text-red-600 font-bold' : scribeClient?.phqTrend === 'down' ? 'text-blue-600 font-bold' : ''}>{scribeClient?.phqTrend === 'up' ? 'Worsening' : scribeClient?.phqTrend === 'down' ? 'Improving' : 'Stable'}</span></span>
                <span><strong>Days since check-in:</strong> {scribeClient?.lastPHQ}</span>
                <span className="col-span-2"><strong>Active goal:</strong> {scribeClient?.planGoal}</span>
              </div>
            </div>
          )}

          <button
            onClick={startRecording}
            disabled={
              !selectedClient ||
              clientsLoading ||
              (sourceMode === 'telehealth' && !selectedTelehealthId)
            }
            className="w-full py-4 rounded-xl text-white font-bold text-base transition-all hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-3"
            style={{ background: 'linear-gradient(135deg, #DC2626, #B91C1C)' }}>
            <span className="w-3 h-3 rounded-full bg-white animate-pulse" />
            {sourceMode === 'telehealth' ? 'Process Telehealth Transcript' : sourceMode === 'dictation' ? 'Start Voice Dictation' : 'Start Recording Session'}
          </button>
        </div>
      </div>
    );
  }

  // ── RECORDING ──────────────────────────────────────────────────────────────
  if (phase === 'recording') {
    return (
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Recording — {selectedClient}</h1>
            <p className="text-sm text-slate-500">{sessionType} · {noteFormat} note · Dr. Sarah Smith</p>
          </div>
        </div>

        <RecordingStatusBar
          elapsedSeconds={elapsed}
          paused={paused}
          onPause={() => setPaused(true)}
          onResume={() => {
            lastAudioAtRef.current = Date.now();
            setPaused(false);
          }}
          onStop={stopRecording}
          reconnect={reconnect}
          noAudio={noAudio}
        />

        {/* Recorder card */}
        <div className="bg-white rounded-xl border-2 border-red-200 shadow-sm p-6 text-center space-y-4">
          <Waveform active={recording && !paused} />
          <p className="text-sm text-slate-500">{paused ? 'Paused — click Resume to continue' : useRealMic ? 'Listening… speak naturally' : 'Streaming chart-based transcript preview…'}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => setDismissScribeOpen(true)}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold bg-rose-700 text-white hover:bg-rose-800"
            >
              {DISMISS_SCRIBE_BTN}
            </button>
          </div>
        </div>

        {/* Live transcript */}
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200/80 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Live Transcript</p>
            <span className="text-xs text-slate-400">{transcript.length} lines captured</span>
          </div>
          <div ref={transcriptRef} className="p-5 space-y-2.5 max-h-80 overflow-y-auto">
            {transcript.length === 0 && (
              <p className="text-sm text-slate-400 italic text-center py-8">Transcript will appear here as the session progresses…</p>
            )}
            {transcript.map((line, i) => {
              const isClinic = line.startsWith('Clinician:');
              return (
                <div key={i} className={`flex gap-2 ${isClinic ? '' : 'justify-end'}`}>
                  {isClinic && <span className="text-xs font-bold text-blue-600 shrink-0 mt-0.5">DR</span>}
                  <p className={`text-sm rounded-xl px-3 py-2 max-w-sm ${isClinic ? 'bg-blue-50 text-slate-800' : 'bg-slate-100 text-slate-700'}`}>{line.replace(/^(Clinician:|[A-Za-z]+:)\s*/, '')}</p>
                  {!isClinic && <span className="text-xs font-bold text-slate-400 shrink-0 mt-0.5">PT</span>}
                </div>
              );
            })}
          </div>
        </div>

        <DismissScribeDialog
          open={dismissScribeOpen}
          onKeep={() => setDismissScribeOpen(false)}
          onDiscard={() => {
            if (timerRef.current) clearInterval(timerRef.current);
            if (transcriptTimerRef.current) clearInterval(transcriptTimerRef.current);
            const recognition = recognitionRef.current;
            recognitionRef.current = null;
            try {
              recognition?.stop?.();
            } catch {
              /* ignore */
            }
            setReconnect(null);
            setNoAudio(false);
            setRecording(false);
            setPaused(false);
            setElapsed(0);
            setTranscript([]);
            setGeneratedNote(null);
            setNoteSections({});
            setSuggestions([]);
            setDismissScribeOpen(false);
            setPhase('setup');
            toast.success(DISMISS_SCRIBE_AFTER);
            console.info('[SCRIBE_DISMISS]', { reason: 'user_discard' });
          }}
        />
      </div>
    );
  }

  // ── PROCESSING ─────────────────────────────────────────────────────────────
  if (phase === 'processing') {
    return (
      <div className="max-w-2xl mx-auto flex flex-col items-center justify-center min-h-96 space-y-8">
        <div className="text-center">
          <div className="w-20 h-20 rounded-xl flex items-center justify-center mx-auto mb-4" style={{ background: 'linear-gradient(135deg, #6868D0, #5555B8)' }}>
            <Bot size={36} className="text-white" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900">Analyzing Session</h2>
          <p className="text-sm text-slate-500 mt-1">Altrixs is generating your documentation…</p>
        </div>
        <div className="w-full bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-3">
          {PROCESSING_STEPS.map((step, i) => (
            <div key={i} className={`flex items-center gap-3 transition-all ${i < processingStep ? 'opacity-100' : 'opacity-30'}`}>
              <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs ${i < processingStep ? 'bg-blue-500' : 'bg-slate-200'}`}>
                {i < processingStep ? <CheckCircle2 size={12} className="text-white" />:<span className="text-slate-400">{i + 1}</span>}
              </div>
              <p className={`text-sm ${i < processingStep ? 'text-slate-900 font-semibold' : 'text-slate-400'}`}>{step}</p>
              {i === processingStep - 1 && <div className="ml-auto w-3 h-3 rounded-full bg-blue-500 animate-ping" />}
            </div>
          ))}
        </div>
        <div className="w-full bg-slate-100 rounded-full h-2">
          <div className="bg-blue-600 h-2 rounded-full transition-all duration-500"
            style={{ width: `${(processingStep / PROCESSING_STEPS.length) * 100}%` }} />
        </div>
      </div>
    );
  }

  // ── RESULTS ────────────────────────────────────────────────────────────────
  const activeSuggestions = suggestions.filter(s => !s.dismissed);

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-900">Session Complete — {scribeClient?.name || selectedClient}</h1>
            {comprehend?.demoMode && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">DEMO</span>
            )}
            {highCount > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-bold">{highCount} high priority</span>
            )}
          </div>
          <p className="text-sm text-slate-500 mt-0.5">{sessionType} · {noteFormat} · {generatedNote?.duration} · {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
          {scribeMeta.source === 'bedrock' ? (
            <p className="text-xs text-emerald-700 mt-1 font-semibold">Note drafted via /api/agents/scribe (Bedrock)</p>
          ) : scribeMeta.error ? (
            <p className="text-xs text-amber-800 mt-1">
              AI Scribe API unavailable — showing structured local draft from transcript.
              {scribeMeta.demoMode ? ' (demoMode / fail-closed)' : ''} {scribeMeta.error}
            </p>
          ) : null}
          {comprehendError && (
            <p className="text-xs text-rose-600 mt-1">Comprehend: {comprehendError}</p>
          )}
        </div>
        <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setPhase('setup'); setNoteSigned(false); setTranscript([]); setElapsed(0); setLockedNoteId(null); setLockError(null); }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
            <Plus size={14} />
            New Session
          </button>
          {!noteSigned && (
            <button
              type="button"
              disabled={lockBusy}
              onClick={() => void handleSignAndLock()}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-60"
              style={{ background: '#6868D0' }}>
              <PenLine size={14} />
              {lockBusy ? 'Saving…' : 'Sign & Lock Note'}
            </button>
          )}
          {noteSigned && (
            <span className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-blue-50 text-blue-700 text-sm font-bold ring-1 ring-inset ring-blue-100">
              <Lock size={14} />
              Signed & Locked
            </span>
          )}
        </div>
      </div>

      {/* Confidence + billing banner */}
      {generatedNote && (
        <div className="flex flex-wrap gap-3">
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/80 px-4 py-2 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">AI Confidence</div>
            <div className="w-24 bg-slate-100 rounded-full h-2">
              <div className="h-2 rounded-full" style={{ width: `${generatedNote.confidence}%`, background: '#6868D0' }} />
            </div>
            <span className="text-sm font-bold" style={{ color: '#6868D0' }}>{generatedNote.confidence}%</span>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/80 px-4 py-2 shadow-sm text-sm">
            <span className="text-slate-500">Suggested billing:</span>
            <span className="font-semibold text-slate-900">CPT {generatedNote.billingCode}</span>
          </div>
          <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/80 px-4 py-2 shadow-sm text-sm">
            <span className="text-slate-500">Session duration:</span>
            <span className="font-semibold text-slate-900">{generatedNote.duration}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'note' as const, label: 'Clinical Note', Icon: FileText },
          { key: 'suggestions' as const, label: `Suggestions${highCount > 0 ? ` (${highCount} high)` : ` (${activeSuggestions.length})`}`, Icon: Lightbulb },
          { key: 'coding' as const, label: 'ICD-10 / RxNorm', Icon: ClipboardList },
          { key: 'transcript' as const, label: `Transcript (${transcript.length} lines)`, Icon: Mic },
        ]).map(t => (
          <button key={t.key} onClick={() => setResultTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${resultTab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            <t.Icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {resultTab === 'coding' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6 space-y-4">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-slate-900">Comprehend Medical coding</p>
            {comprehend?.demoMode && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">demoMode</span>
            )}
          </div>
          {!comprehend && !comprehendError && (
            <p className="text-sm text-slate-400">No coding results yet.</p>
          )}
          {comprehend && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-bold uppercase text-slate-500 mb-2">Entities</p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {comprehend.entities.slice(0, 12).map((e, i) => (
                    <li key={i}>{e.text} <span className="text-xs text-slate-400">({e.category})</span></li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-500 mb-2">ICD-10</p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {comprehend.icd10.slice(0, 12).map((c, i) => (
                    <li key={i}><span className="font-mono font-semibold">{c.code}</span> — {c.description}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-bold uppercase text-slate-500 mb-2">RxNorm</p>
                <ul className="space-y-1 text-sm text-slate-700">
                  {comprehend.medications.length === 0 && <li className="text-slate-400">None detected</li>}
                  {comprehend.medications.slice(0, 12).map((m, i) => (
                    <li key={i}><span className="font-mono font-semibold">{m.code}</span> — {m.description}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Clinical Note */}
      {resultTab === 'note' && generatedNote && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
            <div>
                  <p className="font-semibold text-slate-900">{generatedNote.format} Note — {scribeClient?.name || selectedClient}</p>
              <p className="text-xs text-slate-400 mt-0.5">Auto-generated from session recording · Review before signing</p>
            </div>
            {noteSigned && (
              <span className="flex items-center gap-1.5 text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-700 font-bold ring-1 ring-inset ring-blue-100">
                <Lock size={11} /> Locked
              </span>
            )}
          </div>
          <div className="p-6 space-y-5">
            {Object.entries(noteSections).map(([section, content]) => (
              <div key={section}>
                <label className="block text-xs font-bold text-blue-700 uppercase tracking-wider mb-2">{section}</label>
                <textarea
                  readOnly={noteSigned}
                  value={content}
                  onChange={e => setNoteSections(prev => ({ ...prev, [section]: e.target.value }))}
                  rows={section === 'Plan' || section === 'Assessment' ? 5 : 4}
                  className={`w-full border rounded-xl px-4 py-3 text-sm leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-blue-300 ${noteSigned ? 'bg-slate-50 text-slate-500 cursor-not-allowed border-slate-200/80' : 'border-slate-200'}`}
                />
              </div>
            ))}
          </div>
          {showsNoMedChanges(noteFormat) && (
            <label className="mx-6 mb-4 flex min-h-11 items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                disabled={noteSigned}
                checked={hasNoMedChanges(noteSections)}
                onChange={(e) => setNoteSections((prev) => applyNoMedChanges(prev, e.target.checked))}
              />
              {NO_MED_CHANGES_LABEL}
            </label>
          )}
          <DraftSuggestions
            className="mx-6 mb-5"
            groups={buildDraftGroups({ withheld, transcript })}
            insertedIds={insertedIds}
            onInsert={insertWithheldSuggestion}
            onAssignMeasures={assignSpokenMeasures}
            readOnly={noteSigned}
          />
          {!noteSigned && (
            <div className="px-6 pb-5 flex flex-col gap-2">
              {lockError ? <p className="text-sm text-rose-600">{lockError}</p> : null}
              <div className="flex gap-3">
              <button
                type="button"
                disabled={lockBusy}
                onClick={() => void handleSignAndLock()}
                className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl text-white text-sm font-bold hover:opacity-90 transition-all disabled:opacity-60"
                style={{ background: '#6868D0' }}>
                <PenLine size={14} />
                {lockBusy ? 'Saving…' : 'Sign & Lock'}
              </button>
              <Link href="/dashboard/ehr/notes"
                className="px-5 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all">
                Open in Notes
              </Link>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab: Post-session Suggestions */}
      {resultTab === 'suggestions' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">AI-powered recommendations based on this session, client history, and treatment plan.</p>
            <span className="text-xs text-slate-400">{activeSuggestions.filter(s => s.accepted).length} of {activeSuggestions.length} accepted</span>
          </div>

          {(['high', 'medium', 'low'] as Priority[]).map(pri => {
            const group = activeSuggestions.filter(s => s.priority === pri && !s.dismissed);
            if (!group.length) return null;
            return (
              <div key={pri}>
                <p className="text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                  style={{ color: pri === 'high' ? '#DC2626' : pri === 'medium' ? '#B45309' : '#6B7280' }}>
                  <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: PRI_DOT[pri] }} />
                  {pri === 'high' ? 'High Priority' : pri === 'medium' ? 'Recommended' : 'Optional'}
                </p>
                <div className="space-y-2">
                  {group.map(s => {
                    const cfg = CAT_CONFIG[s.category];
                    const CatIcon = cfg.IconComponent;
                    return (
                      <div key={s.id} className={`rounded-xl border p-4 transition-all ${s.accepted ? 'opacity-60' : ''}`}
                        style={{ backgroundColor: cfg.bg, borderColor: cfg.border }}>
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ backgroundColor: cfg.color + '20' }}>
                            <CatIcon size={16} style={{ color: cfg.color }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-slate-900">{s.title}</p>
                              <span className="text-xs px-2 py-0.5 rounded-full font-semibold"
                                style={{ backgroundColor: cfg.color + '20', color: cfg.color }}>
                                {cfg.label}
                              </span>
                              {s.accepted && (
                                <span className="flex items-center gap-1 text-xs text-blue-600 font-bold">
                                  <CheckCircle2 size={11} /> Accepted
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-slate-600 mt-1">{s.detail}</p>
                          </div>
                          {!s.accepted && (
                            <div className="flex gap-2 shrink-0">
                              {s.actionLabel && s.actionHref && (
                                <Link href={s.actionHref}
                                  onClick={() => void acceptSuggestion(s.id)}
                                  className="text-xs px-3 py-1.5 rounded-lg font-bold text-white transition-all hover:opacity-90"
                                  style={{ backgroundColor: cfg.color }}>
                                  {s.actionLabel}
                                </Link>
                              )}
                              {!s.actionHref && (
                                <button onClick={() => void acceptSuggestion(s.id)}
                                  className="text-xs px-3 py-1.5 rounded-lg font-bold text-white transition-all hover:opacity-90"
                                  style={{ backgroundColor: cfg.color }}>
                                  Accept
                                </button>
                              )}
                              <button onClick={() => dismissSuggestion(s.id)}
                                className="text-xs px-2 py-1.5 rounded-lg font-semibold text-slate-400 hover:bg-slate-100 transition-all leading-none">
                                &times;
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tab: Transcript */}
      {resultTab === 'transcript' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200/80 flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-900">Session Transcript</p>
            <span className="text-xs text-slate-400">{transcript.length} exchanges · {formatTime(elapsed)} recorded</span>
          </div>
          <div className="p-5 space-y-3 max-h-[600px] overflow-y-auto">
            {transcript.map((line, i) => {
              const isClinic = line.startsWith('Clinician:');
              return (
                <div key={i} className={`flex gap-2 ${isClinic ? '' : 'justify-end'}`}>
                  {isClinic && <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: '#6868D0' }}>DR</div>}
                  <div className={`rounded-xl px-4 py-2.5 max-w-lg text-sm ${isClinic ? 'bg-blue-50 text-slate-800' : 'bg-slate-100 text-slate-700'}`}>
                    <p className="text-xs font-bold mb-0.5" style={{ color: isClinic ? '#6868D0' : '#6B7280' }}>{isClinic ? 'Clinician' : 'Client'}</p>
                    {line.replace(/^(Clinician:|[A-Za-z]+:)\s*/, '')}
                  </div>
                  {!isClinic && <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white bg-slate-400">PT</div>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
