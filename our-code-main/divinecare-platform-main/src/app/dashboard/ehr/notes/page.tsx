'use client';

import Link from 'next/link';
import { CLINICAL_DEMO_CLIENTS, CLINICAL_DEMO_NOTES } from '@/features/ehr/clinicalDemo';
import { PreviewNotice } from '@/components/clinic/PreviewNotice';
import { VisitGuide } from '@/components/visits/VisitGuide';
import { AfterSignBanner } from '@/components/ehr/AfterSignBanner';
import { MyNotesQueue } from '@/components/ehr/MyNotesQueue';
import { Part2Notice } from '@/components/clinic/Part2Notice';
import { DismissNoteDialog } from '@/components/notes/DismissNoteDialog';
import { IdentifyingInformationSection } from '@/components/notes/IdentifyingInformationSection';
import { hasIdentifyingInformation } from '@/lib/identifying-info/fields';
import toast from 'react-hot-toast';
import { CPT_CATALOG } from '@/features/billing/billingHubData';
import {
  NOTE_TYPES,
  NOTE_LABELS,
  NOTE_SECTIONS,
  EMDR_PHASES,
  noteTemplate,
  normalizeNoteType,
  structuredNoteSections,
  hasNoteContent,
  isSudNote,
  encodeNoteBody,
  sectionPlaceholder,
  type NoteType,
} from '@/lib/ehr/noteTemplates';
import {
  SMART_PHRASES,
  SMART_PHRASE_CATEGORIES,
  getSmartPhrase,
} from '@/lib/ehr/smartPhrases';
import { apiJson } from '@/lib/api-client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  Archive,
  Bot,
  CalendarDays,
  Clock,
  FileText,
  PenLine,
  ShieldAlert,
} from 'lucide-react';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import {
  createClientNote,
  fetchClients,
  fetchEhrProgressNotes,
  type Client,
  type EhrProgressNote,
} from '@/features/clients';
import { fetchRiskAlerts, type RiskAlert } from '@/features/alerts';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';

type ComprehendEntity = { text: string; category: string; type: string; score: number };
type ComprehendCode = { code: string; description: string; score: number };

function extractComprehendText(noteType: NoteType, body: string): string {
  const sections = structuredNoteSections(noteType, body);
  const assessment = sections.find((s) => s.title.toLowerCase() === 'assessment')?.text?.trim() || '';
  // Source: Comprehend for SOAP/DAP when Assessment length ≥ 30
  if ((noteType === 'SOAP' || noteType === 'DAP') && assessment.length >= 30) return assessment;
  if (assessment.length >= 30) return assessment;
  return '';
}

function composeBodyFromSections(type: NoteType, texts: Record<string, string>): string {
  const headings = NOTE_SECTIONS[type] || [];
  return headings.map((h) => `${h}\n${(texts[h] || '').trim()}`).join('\n\n');
}

function sectionsToRecord(type: NoteType, body: string): Record<string, string> {
  const headings = NOTE_SECTIONS[type] || [];
  const parsed = structuredNoteSections(type, body);
  const out: Record<string, string> = {};
  for (const h of headings) out[h] = '';
  for (const s of parsed) {
    if (s.title in out || headings.includes(s.title)) out[s.title] = s.text;
  }
  return out;
}

interface AIContext {
  clientId: string;
  noteType: NoteType;
  topics: string[];
  interventions: string[];
  presentation: string;
  riskStatus: string;
  additionalContext: string;
}

interface AIGeneratedNote {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  data?: string;
  behavior?: string;
  intervention?: string;
  response?: string;
}

const SESSION_TOPICS = [
  'Depressive symptoms',
  'Anxiety / worry',
  'Trauma processing',
  'Sleep difficulties',
  'Substance use',
  'Medication adherence',
  'Coping strategies reviewed',
  'Safety planning',
  'Relationship issues',
  'Work/occupational stress',
  'Grief / loss',
  'Self-esteem',
  'Behavioral activation',
  'Thought restructuring',
  'Goal setting',
  'Mindfulness practice',
];

const SESSION_INTERVENTIONS = [
  'Cognitive Behavioral Therapy (CBT)',
  'Dialectical Behavior Therapy (DBT)',
  'Motivational Interviewing (MI)',
  'EMDR / Trauma Processing',
  'Psychoeducation',
  'Mindfulness-Based Techniques',
  'Behavioral Activation',
  'Exposure and Response Prevention (ERP)',
  'Problem-Solving Therapy',
  'Supportive Counseling',
  'Safety Planning',
  'Relapse Prevention',
  'Interpersonal Therapy (IPT)',
  'Acceptance & Commitment Therapy (ACT)',
];

const PRESENTATION_OPTIONS = [
  'Alert and cooperative',
  'Engaged and motivated',
  'Mildly anxious',
  'Moderately distressed',
  'Flat/restricted affect',
  'Tearful at times',
  'Guarded initially, opened during session',
  'Dysphoric mood, congruent affect',
  'Irritable, improved during session',
  'Bright affect, euthymic mood',
];

const RISK_OPTIONS = [
  'No current SI/HI. Safety plan in place and reviewed.',
  'Passive SI present (no plan, intent, or means). Safety plan reinforced.',
  'Active SI with plan - safety plan updated, emergency contacts notified.',
  'No safety concerns identified at this time.',
  'Client reports increased anxiety but denies SI/HI.',
];

const DEFAULT_AI_CONTEXT: AIContext = {
  clientId: '',
  noteType: 'SOAP',
  topics: [],
  interventions: [],
  presentation: '',
  riskStatus: '',
  additionalContext: '',
};

const CLIENT_CONTEXT: Record<string, { dx: string; issues: string; pronoun: string }> = {};

function formatNoteDate(value: string) {
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

const STATUS_STYLES: Record<'Draft' | 'Signed' | 'Locked', string> = {
  Draft: 'bg-orange-100 text-orange-700 border-orange-200',
  Signed: 'bg-blue-100 text-blue-700 border-blue-200',
  Locked: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const TYPE_COLORS: Record<string, string> = {
  SOAP: 'bg-violet-100 text-violet-700',
  DAP: 'bg-sky-100 text-sky-700',
  BIRP: 'bg-emerald-100 text-emerald-700',
  GIRP: 'bg-teal-100 text-teal-700',
  PIE: 'bg-cyan-100 text-cyan-700',
  CBT: 'bg-indigo-100 text-indigo-700',
  DBT: 'bg-fuchsia-100 text-fuchsia-700',
  MFT: 'bg-pink-100 text-pink-700',
  EMDR: 'bg-rose-100 text-rose-700',
  'Psych Eval': 'bg-violet-100 text-violet-700',
  'Med Mgmt': 'bg-teal-100 text-teal-700',
  SUD: 'bg-amber-100 text-amber-800',
  Group: 'bg-orange-100 text-orange-700',
  Telephone: 'bg-slate-100 text-slate-700',
  Discharge: 'bg-gray-100 text-gray-700',
};

const TYPE_FILTERS = ['All', ...NOTE_TYPES] as const;
const STATUS_FILTERS = ['All', 'Draft', 'Signed', 'Locked'] as const;

function inferNoteType(note: { body: string; noteType?: string | null }): string {
  if (note.noteType) return normalizeNoteType(note.noteType);
  const normalized = note.body.toLowerCase();
  if (normalized.includes('b - behavior') || normalized.includes('i - intervention')) return 'BIRP';
  if (normalized.includes('d - data')) return 'DAP';
  if (normalized.includes('goals\n') && normalized.includes('intervention')) return 'GIRP';
  if (normalized.includes('problem\n') && normalized.includes('evaluation')) return 'PIE';
  if (normalized.includes('automatic thoughts') || normalized.includes('cognitive interventions'))
    return 'CBT';
  if (normalized.includes('diary card') || normalized.includes('distress tolerance')) return 'DBT';
  if (normalized.includes('systemic assessment') || normalized.includes('participants')) return 'MFT';
  if (normalized.includes('suds') || normalized.includes('target memory')) return 'EMDR';
  if (normalized.includes('psychiatric evaluation') || normalized.includes('chief complaint'))
    return 'Psych Eval';
  if (normalized.includes('medication management') || normalized.includes('current medications'))
    return 'Med Mgmt';
  if (normalized.includes('substance use') || normalized.includes('relapse prevention')) return 'SUD';
  if (normalized.includes('group topic') || normalized.includes('group therapy')) return 'Group';
  if (normalized.includes('reason for call') || normalized.includes('telephone')) return 'Telephone';
  if (normalized.includes('discharge') || normalized.includes('aftercare')) return 'Discharge';
  return 'SOAP';
}

function generateAINote(ctx: AIContext, clientName: string): AIGeneratedNote {
  const clientCtx = CLIENT_CONTEXT[clientName] || {
    dx: 'diagnoses per chart',
    issues: 'presenting concerns',
    pronoun: 'Client',
  };
  const { dx, issues, pronoun } = clientCtx;
  const topicStr = ctx.topics.length ? ctx.topics.slice(0, 3).join(', ').toLowerCase() : issues;
  const intStr = ctx.interventions.length ? ctx.interventions.slice(0, 3).join(', ') : 'supportive counseling';
  const firstName = clientName.split(' ')[0];

  if (ctx.noteType === 'SOAP') {
    return {
      subjective: `${firstName} presented for scheduled individual therapy session. ${pronoun} reported ${topicStr}. ${pronoun} stated, "I've been working on what we discussed last session." ${pronoun === 'She' ? 'Her' : 'His'} primary presenting concern today involved ${ctx.topics[0]?.toLowerCase() || issues}. ${firstName} denied any significant changes in medications or medical history since last visit.`,
      objective: `${firstName} appeared ${ctx.presentation.toLowerCase()}. ${pronoun} was well-groomed and appropriately dressed. Speech was normal in rate, rhythm, and volume. Thought process was linear and goal-directed. Insight and judgment appeared intact. ${ctx.riskStatus} Session duration: ${ctx.additionalContext ? `${ctx.additionalContext} minutes` : '50 minutes'}.`,
      assessment: `${firstName} continues to meet criteria for ${dx}. ${pronoun} demonstrates ${ctx.topics.includes('Coping strategies reviewed') ? 'improved coping skill utilization' : 'partial response to current treatment'}. Today's session focused on ${topicStr}. ${pronoun === 'She' ? 'Her' : 'His'} functional impairment remains ${ctx.presentation.includes('distressed') ? 'moderate' : 'mild to moderate'}. Overall treatment trajectory is ${ctx.presentation.includes('motivated') || ctx.presentation.includes('engaged') ? 'positive' : 'guarded but stable'}.`,
      plan: `1. Continue weekly individual therapy. 2. ${intStr} as primary treatment modality. 3. ${ctx.topics.includes('Behavioral activation') ? 'Client to complete behavioral activation log between sessions. ' : ''}${ctx.topics.includes('Mindfulness practice') ? 'Daily mindfulness practice encouraged (5-10 min). ' : ''}${ctx.topics.includes('Safety planning') ? 'Safety plan reviewed and updated. ' : ''}4. ${ctx.riskStatus.includes('SI') ? 'Follow up on safety plan adherence at next session. ' : 'Continue to monitor safety at each contact. '}5. Return in 1 week for follow-up session.`,
    };
  }

  if (ctx.noteType === 'DAP') {
    return {
      data: `${firstName} attended scheduled individual therapy. Reported ${topicStr}. ${pronoun} appeared ${ctx.presentation.toLowerCase()}. ${ctx.riskStatus} ${pronoun === 'She' ? 'Her' : 'His'} mood was consistent with ${dx}. ${pronoun} engaged openly and participated actively in session.`,
      assessment: `${firstName} demonstrates ${ctx.presentation.includes('motivated') ? 'strong engagement and motivation for change' : 'continued effort toward treatment goals'}. Current challenges related to ${topicStr} are consistent with ${dx}. ${pronoun === 'She' ? 'Her' : 'His'} response to ${intStr} continues to be ${ctx.presentation.includes('distressed') ? 'moderate' : 'positive'}. Short-term goals are ${ctx.topics.length > 2 ? 'progressing' : 'partially met'}.`,
      plan: `Continue ${intStr}. ${ctx.topics.includes('Safety planning') ? 'Safety plan reviewed. ' : ''}${ctx.topics.includes('Coping strategies reviewed') ? 'Coping strategies reinforced for home practice. ' : ''}Scheduled follow-up in 1 week. ${ctx.riskStatus.includes('passive') ? 'Crisis plan on file; client instructed to use if needed.' : ''}`,
    };
  }

  return {
    behavior: `${firstName} presented for individual therapy. ${pronoun} reported ${topicStr}. ${pronoun} appeared ${ctx.presentation.toLowerCase()}. ${pronoun === 'She' ? 'Her' : 'His'} verbalizations were consistent with ongoing impact of ${dx}. ${ctx.riskStatus}`,
    intervention: `Clinician utilized ${intStr}. ${ctx.topics.includes('Thought restructuring') ? 'Cognitive restructuring techniques applied to maladaptive thought patterns. ' : ''}${ctx.topics.includes('Safety planning') ? 'Safety plan reviewed and updated collaboratively. ' : ''}${ctx.topics.includes('Mindfulness practice') ? 'Mindfulness exercise practiced in-session. ' : ''}Clinician provided psychoeducation regarding ${ctx.topics[0]?.toLowerCase() || issues}. Rapport building and validation utilized throughout.`,
    response: `${firstName} responded ${ctx.presentation.includes('distressed') ? 'with some difficulty initially, though affect improved during session' : 'positively to interventions'}. ${pronoun} demonstrated ${ctx.presentation.includes('motivated') ? 'active engagement and willingness to apply skills' : 'openness to therapeutic techniques'}. ${pronoun === 'She' ? 'Her' : 'His'} insight into ${ctx.topics[0]?.toLowerCase() || 'presenting concerns'} ${ctx.presentation.includes('guarded') ? 'increased over the course of the session' : 'remained intact'}.`,
    plan: `Continue individual therapy weekly. ${ctx.topics.includes('Behavioral activation') ? 'Complete assigned behavioral activation activities. ' : ''}${ctx.topics.includes('Coping strategies reviewed') ? 'Practice identified coping strategies daily. ' : ''}Return for follow-up in 1 week. ${ctx.riskStatus.includes('SI') ? 'Safety plan in place. Crisis line information provided.' : 'No safety concerns at this time.'}`,
  };
}

function formatGeneratedBody(noteType: NoteType, note: AIGeneratedNote) {
  if (
    noteType === 'Psych Eval' ||
    noteType === 'Med Mgmt' ||
    noteType === 'Group'
  ) {
    return 'Field structure requires clinical confirmation before generation.';
  }
  if (noteType === 'SOAP') {
    return [
      note.subjective && `S - Subjective\n${note.subjective}`,
      note.objective && `O - Objective\n${note.objective}`,
      note.assessment && `A - Assessment\n${note.assessment}`,
      note.plan && `P - Plan\n${note.plan}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  if (noteType === 'DAP') {
    return [
      note.data && `D - Data\n${note.data}`,
      note.assessment && `A - Assessment\n${note.assessment}`,
      note.plan && `P - Plan\n${note.plan}`,
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  return [
    note.behavior && `B - Behavior\n${note.behavior}`,
    note.intervention && `I - Intervention\n${note.intervention}`,
    note.response && `R - Response\n${note.response}`,
    note.plan && `P - Plan\n${note.plan}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export default function NotesPage() {
  const searchParams = useSearchParams();
  const presetClientId = searchParams.get('clientId') || '';
  const [liveClients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [liveNotes, setNotes] = useState<EhrProgressNote[]>([]);
  const [noteStats, setNoteStats] = useState({ today: 0, unsigned: 0, thisWeek: 0, total: 0 });
  /** Oct 23: always live chart — no Demo Preview. */
  const preview = false;
  const [previewNotes, setPreviewNotes] = useState<EhrProgressNote[]>(CLINICAL_DEMO_NOTES);
  const clients = liveClients;
  const notes = liveNotes;
  const [includeDismissed, setIncludeDismissed] = useState(false);
  const [dismissTarget, setDismissTarget] = useState<EhrProgressNote | null>(null);
  const [dismissBusy, setDismissBusy] = useState(false);
  const [typeChangeOpen, setTypeChangeOpen] = useState(false);
  const [typeChangeTo, setTypeChangeTo] = useState<NoteType | null>(null);
  const [typeChangeBusy, setTypeChangeBusy] = useState(false);
  const [notesLoading, setNotesLoading] = useState(true);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('All');
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('All');
  const [showNewNote, setShowNewNote] = useState(false);
  const [showNoteDetail, setShowNoteDetail] = useState<EhrProgressNote | null>(null);
  const [afterSign, setAfterSign] = useState<{
    noteId: string;
    clientId: string;
    exceptionLabel?: string | null;
  } | null>(null);
  const [noteClientId, setNoteClientId] = useState('');
  const [noteBody, setNoteBody] = useState('');
  const [noteType, setNoteType] = useState<NoteType>('SOAP');
  const [billingCode, setBillingCode] = useState('');
  const [telehealth, setTelehealth] = useState(false);
  const [telehealthPos, setTelehealthPos] = useState('10');
  const [sudConfidential, setSudConfidential] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [copyForwardOffer, setCopyForwardOffer] = useState<{
    found: boolean;
    displayBody: string | null;
    createdAt: string | null;
    noteType?: string | null;
  } | null>(null);
  const [comprehend, setComprehend] = useState<{
    loading: boolean;
    demoMode?: boolean;
    entities?: ComprehendEntity[];
    icd10?: ComprehendCode[];
    medications?: ComprehendCode[];
    error?: string | null;
  }>({ loading: false });
  const [comprehendOpen, setComprehendOpen] = useState(true);
  const [addedIcd, setAddedIcd] = useState<Set<string>>(() => new Set());
  const [addedMeds, setAddedMeds] = useState<Set<string>>(() => new Set());
  const [phrasesOpen, setPhrasesOpen] = useState(false);
  const [phraseSearch, setPhraseSearch] = useState('');
  const [addendumText, setAddendumText] = useState('');
  const [addendumReason, setAddendumReason] = useState('');
  const [noteActionMessage, setNoteActionMessage] = useState('');
  const [activePhraseField, setActivePhraseField] = useState<string | null>(null);
  const [sectionTexts, setSectionTexts] = useState<Record<string, string>>({});
  const [noteDos, setNoteDos] = useState('');
  const [noteDuration, setNoteDuration] = useState('50');
  const [emdrPhase, setEmdrPhase] = useState<(typeof EMDR_PHASES)[number]>(EMDR_PHASES[3]);
  const noteBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const noteCursorRef = useRef<number | null>(null);
  const sectionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const comprehendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comprehendReqRef = useRef(0);

  const [showAIGenerator, setShowAIGenerator] = useState(false);
  const [aiGenerating, setAIGenerating] = useState(false);
  const [aiGenerated, setAIGenerated] = useState<AIGeneratedNote | null>(null);
  const [aiContext, setAIContext] = useState<AIContext>(DEFAULT_AI_CONTEXT);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [attestationChecked, setAttestationChecked] = useState(false);
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  const loadAlerts = async () => {
    try {
      const data = await fetchRiskAlerts();
      setAlerts(data.alerts);
    } catch {
      // Non-blocking
    }
  };

  const loadClients = async () => {
    setClientsLoading(true);
    setClientsError(null);
    try {
      const data = await fetchClients();
      setClients(data);
      if (presetClientId) {
        setNoteClientId(presetClientId);
        setShowNewNote(true);
      } else if (!noteClientId && data.length) {
        setNoteClientId(data[0].id);
      }
    } catch (error) {
      setClientsError(error instanceof Error ? error.message : 'Failed to load clients');
    } finally {
      setClientsLoading(false);
    }
  };

  const loadNotes = async () => {
    setNotesLoading(true);
    setNotesError(null);
    try {
      const data = await fetchEhrProgressNotes({ includeDismissed });
      setNotes(data.notes);
      setShowNoteDetail((current) => current ? data.notes.find((note) => note.id === current.id) || current : null);
      setNoteStats(data.stats);
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : 'Failed to load notes');
    } finally {
      setNotesLoading(false);
    }
  };

  useEffect(() => {
    if (!showNewNote || !noteClientId || preview) {
      setCopyForwardOffer(null);
      return;
    }
    let cancelled = false;
    apiJson<{
      success: boolean;
      found: boolean;
      displayBody: string | null;
      body: string | null;
      createdAt: string | null;
    }>(`/api/notes/copy-forward?clientId=${encodeURIComponent(noteClientId)}&noteType=${encodeURIComponent(noteType)}`)
      .then((res) => {
        if (!cancelled) {
          const content = res.displayBody?.trim() || res.body?.replace(/<!--ehr\s+[^>]*-->/, '').trim() || null;
          setCopyForwardOffer({
            found: Boolean(res.found) && Boolean(content),
            displayBody: content,
            createdAt: res.createdAt,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCopyForwardOffer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showNewNote, noteClientId, noteType, preview]);

  useEffect(() => {
    const analyzeText = extractComprehendText(noteType, noteBody).slice(0, 10000);
    if (!showNewNote || analyzeText.length < 10 || preview) {
      setComprehend({ loading: false });
      return;
    }
    if (comprehendTimerRef.current) clearTimeout(comprehendTimerRef.current);
    comprehendTimerRef.current = setTimeout(() => {
      const reqId = ++comprehendReqRef.current;
      setComprehend((c) => ({ ...c, loading: true, error: null }));
      apiJson<{
        success: boolean;
        demoMode?: boolean;
        entities?: ComprehendEntity[];
        icd10?: ComprehendCode[];
        medications?: ComprehendCode[];
        error?: string;
      }>('/api/comprehend/analyze', {
        method: 'POST',
        body: JSON.stringify({
          text: analyzeText,
          clientId: noteClientId || undefined,
          noteType,
        }),
      })
        .then((res) => {
          if (reqId !== comprehendReqRef.current) return;
          setComprehend({
            loading: false,
            demoMode: res.demoMode,
            entities: res.entities,
            icd10: res.icd10,
            medications: res.medications,
            error: null,
          });
        })
        .catch((err) => {
          if (reqId !== comprehendReqRef.current) return;
          setComprehend({
            loading: false,
            error: err instanceof Error ? err.message : 'Comprehend unavailable',
          });
        });
    }, 1400);
    return () => {
      if (comprehendTimerRef.current) clearTimeout(comprehendTimerRef.current);
    };
  }, [noteBody, showNewNote, noteClientId, noteType, preview]);

  useEffect(() => {
    setCurrentTime(Date.now());
    void loadClients();
    void loadNotes();
    void loadAlerts();
    return () => {
      if (aiTimerRef.current) {
        clearTimeout(aiTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void loadNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [includeDismissed]);

  const thirtyDaysAgo = (currentTime ?? 0) - 30 * 24 * 60 * 60 * 1000;
  const highRiskClientIds = useMemo(() => {
    const set = new Set<string>();
    for (const a of alerts) {
      if (a.severity === 'high' && new Date(a.createdAt).getTime() >= thirtyDaysAgo) {
        set.add(a.clientId);
      }
    }
    return set;
  }, [alerts, thirtyDaysAgo]);

  const isLateEntryNote = (note: EhrProgressNote) => {
    const createdTime = new Date(note.createdAt).getTime();
    return currentTime !== null && (currentTime - createdTime) > 24 * 60 * 60 * 1000;
  };

  const aiSelectedClient = useMemo(
    () => clients.find((client) => client.id === aiContext.clientId) ?? null,
    [clients, aiContext.clientId]
  );

  const filteredNotes = useMemo(() => {
    const query = search.trim().toLowerCase();

    return notes.filter((note) => {
      const noteType = inferNoteType(note);
      const status = note.workflowStatus || 'Draft';
      if (typeFilter !== 'All' && noteType !== typeFilter) return false;
      if (statusFilter !== 'All' && status !== statusFilter) return false;
      if (!query) return true;
      return (
        note.clientName.toLowerCase().includes(query) ||
        (note.clinicianName || '').toLowerCase().includes(query) ||
        (note.clinicianEmail || '').toLowerCase().includes(query) ||
        note.body.toLowerCase().includes(query)
      );
    });
  }, [notes, search, typeFilter, statusFilter]);

  const stats = useMemo(() => {
    if (preview) return [
      { label: 'Preview Notes', value: String(notes.length), color: '#6B5CC8', bgColor: 'bg-violet-100', Icon: FileText },
      { label: 'Unsigned', value: String(notes.filter((note) => note.workflowStatus === 'Draft').length), color: '#EA580C', bgColor: 'bg-orange-100', Icon: AlertTriangle },
      { label: 'Note Types', value: '17', color: '#0F766E', bgColor: 'bg-teal-100', Icon: CalendarDays },
      { label: 'Demo Clients', value: '8', color: '#CA8A04', bgColor: 'bg-yellow-100', Icon: Archive },
    ];
    return [
      { label: 'Notes Today', value: String(noteStats.today), color: '#5C2D91', bgColor: 'bg-violet-100', Icon: FileText },
      { label: 'Unsigned', value: String(noteStats.unsigned), color: '#E8673A', bgColor: 'bg-orange-100', Icon: AlertTriangle },
      { label: 'This Week', value: String(noteStats.thisWeek), color: '#00897B', bgColor: 'bg-teal-100', Icon: CalendarDays },
      { label: 'Total', value: noteStats.total.toLocaleString(), color: '#D4A017', bgColor: 'bg-yellow-100', Icon: Archive },
    ];
  }, [noteStats, notes, preview]);

  const handleGenerateNote = () => {
    if (!aiContext.clientId) return;
    const clientName = aiSelectedClient?.name || 'Client';
    setAIGenerating(true);
    setAIGenerated(null);
    aiTimerRef.current = setTimeout(() => {
      setAIGenerated(generateAINote(aiContext, clientName));
      setAIGenerating(false);
    }, 2200);
  };

  const handleUseAINote = () => {
    if (!aiGenerated || !aiContext.clientId) return;
    setNoteClientId(aiContext.clientId);
    setNoteType(aiContext.noteType);
    setSudConfidential(aiContext.topics.includes('Substance use'));
    setNoteBody(formatGeneratedBody(aiContext.noteType, aiGenerated));
    setShowAIGenerator(false);
    setAIGenerated(null);
    setShowNewNote(true);
  };

  const handleSaveNote = async () => {
    if (!noteClientId || !hasNoteContent(noteType, noteBody) || noteSaving) return;
    setNoteSaving(true);
    setNotesError(null);
    try {
      if (preview) {
        setPreviewNotes((rows) => [{ id: `preview-note-${crypto.randomUUID()}`, clientId: noteClientId, clientName: clients.find((client) => client.id === noteClientId)?.name || 'Demo client', body: noteBody.trim(), createdAt: noteDos ? `${noteDos}T12:00:00.000Z` : new Date().toISOString(), noteType, billingCode, telehealth, placeOfService: telehealth ? telehealthPos : '11', sudConfidential, workflowStatus: 'Draft', durationMinutes: Number(noteDuration) || 50, clinicianName: 'Demo clinician' }, ...rows]);
      } else {
        await createClientNote(noteClientId, encodeNoteBody(noteBody.trim(), { noteType, durationMinutes: Number(noteDuration) || 50, billingCode, telehealth, placeOfService: telehealth ? telehealthPos : '11', sudConfidential }));
        await loadNotes();
      }
      setShowNewNote(false);
      setNoteBody('');
      setNoteType('SOAP');
      setBillingCode('');
      setTelehealth(false);
      setSudConfidential(false);
      setNoteClientId(clients[0]?.id || '');
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : 'Could not save note');
    } finally {
      setNoteSaving(false);
    }
  };

  const getNoteStatus = (note: EhrProgressNote) => note.workflowStatus || 'Draft';

  const handleSign = async (noteId: string) => {
    try {
      const target = notes.find((n) => n.id === noteId);
      if (preview) {
        setPreviewNotes((rows) => rows.map((note) => note.id === noteId ? { ...note, workflowStatus: 'Signed' } : note));
        setShowNoteDetail((note) => note?.id === noteId ? { ...note, workflowStatus: 'Signed' } : note);
        setAfterSign({
          noteId,
          clientId: target?.clientId || '',
          exceptionLabel: null,
        });
      } else {
        const signed = await updateProgressNoteStatus(noteId, 'Signed');
        await loadNotes();
        setAfterSign({
          noteId,
          clientId: target?.clientId || '',
          exceptionLabel: signed.exceptionLabel,
        });
      }
      setShowNoteDetail((note) => note?.id === noteId ? { ...note, workflowStatus: 'Signed' } : note);
      setAttestationChecked(false);
    } catch (error) { setNotesError(error instanceof Error ? error.message : 'Could not sign note'); }
  };

  const handleLock = async (note: EhrProgressNote) => {
    try {
      if (preview) {
        setPreviewNotes((rows) => rows.map((item) => item.id === note.id ? { ...item, workflowStatus: 'Locked' } : item));
        setShowNoteDetail({ ...note, workflowStatus: 'Locked' });
      } else { await updateProgressNoteStatus(note.id, 'Locked'); await loadNotes(); }
      setShowNoteDetail({ ...note, workflowStatus: 'Locked' });
    } catch (error) { setNotesError(error instanceof Error ? error.message : 'Could not lock note'); }
  };

  const syncBodyFromSections = (type: NoteType, texts: Record<string, string>) => {
    const next = composeBodyFromSections(type, texts);
    setNoteBody(next);
    return next;
  };

  const applyPhrase = (key: string) => {
    const phrase = getSmartPhrase(key);
    if (!phrase) return;
    const field = activePhraseField;
    if (field && field !== 'body') {
      setSectionTexts((prev) => {
        const cur = prev[field] || '';
        const nextVal = cur.trim() ? `${cur.trim()} ${phrase.text}` : phrase.text;
        const next = { ...prev, [field]: nextVal };
        syncBodyFromSections(noteType, next);
        return next;
      });
      requestAnimationFrame(() => sectionRefs.current[field]?.focus());
      return;
    }
    const el = noteBodyRef.current;
    const cursor = noteCursorRef.current ?? el?.selectionStart ?? undefined;
    setNoteBody((body) => {
      if (cursor == null) {
        return body.trim() ? `${body.trim()} ${phrase.text}` : phrase.text;
      }
      const before = body.slice(0, cursor);
      const after = body.slice(cursor);
      const pad = before.length && !before.endsWith(' ') && !before.endsWith('\n') ? ' ' : '';
      return `${before}${pad}${phrase.text}${after}`;
    });
    requestAnimationFrame(() => el?.focus());
  };

  const openNewNote = () => {
    if (!clients.some((client) => client.id === noteClientId) && clients[0]) {
      setNoteClientId(clients[0].id);
    }
    const today = new Date().toISOString().slice(0, 10);
    setNoteDos(today);
    setNoteDuration('50');
    if (!billingCode) setBillingCode('90837');
    const texts = sectionsToRecord(noteType, noteBody.trim() ? noteBody : noteTemplate(noteType));
    setSectionTexts(texts);
    setNoteBody(composeBodyFromSections(noteType, texts));
    setPhrasesOpen(false);
    setPhraseSearch('');
    setActivePhraseField(NOTE_SECTIONS[noteType]?.[0] || 'body');
    setAddedIcd(new Set());
    setAddedMeds(new Set());
    setShowNewNote(true);
  };

  const filteredPhrases = useMemo(() => {
    const q = phraseSearch.trim().toLowerCase();
    if (!q) return SMART_PHRASES;
    return SMART_PHRASES.filter(
      (p) =>
        p.key.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
    );
  }, [phraseSearch]);

  return (
    <div className="space-y-6">
      {preview && <PreviewNotice />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[#1A1A2E]">Clinical Notes</h1>
          <p className="mt-1 text-sm text-slate-500">
            SOAP · DAP · BIRP · GIRP · PIE · CBT · DBT · MFT · EMDR · Psych Eval · Med Mgmt · SUD · Group · Telephone · Discharge
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={includeDismissed}
              onChange={(e) => setIncludeDismissed(e.target.checked)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
            />
            Include dismissed
          </label>
          <button
            type="button"
            onClick={() => {
              setShowAIGenerator(true);
              setAIGenerated(null);
              setAIContext(DEFAULT_AI_CONTEXT);
            }}
            className="flex items-center gap-2 rounded-xl border-2 border-[#5C2D91] bg-white px-4 py-2.5 text-sm font-semibold text-[#5C2D91] transition hover:bg-violet-50"
          >
            <Bot size={16} /> AI Draft Note
          </button>
          <button
            type="button"
            onClick={openNewNote}
            className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95"
            style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
          >
            + New Note
          </button>
        </div>
      </div>

      <VisitGuide
        visitType={noteType || 'Individual Therapy'}
        clientId={noteClientId || null}
        telehealth={telehealth}
        missing={[
          !noteClientId ? 'Client' : '',
          !noteBody.trim() ? 'Note text' : '',
          !billingCode ? 'Billing code' : '',
        ].filter(Boolean)}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm">
            <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${stat.bgColor}`}>
              <stat.Icon size={20} style={{ color: stat.color }} />
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: stat.color }}>
              {stat.value}
            </p>
            <p className="mt-0.5 text-xs font-semibold text-slate-700">{stat.label}</p>
          </div>
        ))}
      </div>

      {afterSign ? (
        <AfterSignBanner
          noteId={afterSign.noteId}
          clientId={afterSign.clientId}
          exceptionLabel={afterSign.exceptionLabel}
          onDismiss={() => setAfterSign(null)}
        />
      ) : null}

      <MyNotesQueue
        notes={notes.map((n) => ({
          id: n.id,
          clientName: n.clientName,
          noteType: n.noteType,
          createdAt: n.createdAt,
          workflowStatus: n.workflowStatus,
        }))}
        onOpen={(id) => {
          const note = notes.find((n) => n.id === id);
          if (note) setShowNoteDetail(note);
        }}
      />

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:gap-4">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by client name..."
          className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-[#5C2D91] focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20 lg:max-w-xs"
        />
        <select aria-label="Filter note type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="max-w-full rounded-xl border border-slate-200 p-2.5 text-sm">
          {TYPE_FILTERS.map((type) => <option key={type} value={type}>{type === 'All' ? 'All note types' : NOTE_LABELS[type] || type}</option>)}
        </select>
        <div className="flex flex-wrap gap-1.5 lg:ml-auto">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                statusFilter === s
                  ? 'bg-[#7C3AED] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
        <div className="border-b border-slate-50 px-5 py-4">
          <p className="text-sm font-medium text-slate-500">{filteredNotes.length} notes</p>
        </div>
        {notesLoading && !preview ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">Loading notes...</div>
        ) : notesError && !preview ? (
          <div className="px-5 py-12 text-center text-sm text-rose-600">{notesError}</div>
        ) : filteredNotes.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">
            No notes match your filters
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xs uppercase text-slate-400">
                  <th className="px-5 py-3 text-left font-semibold">Client</th>
                  <th className="px-5 py-3 text-left font-semibold">Date / Time</th>
                  <th className="px-5 py-3 text-left font-semibold">Type</th>
                  <th className="px-5 py-3 text-left font-semibold">Duration</th>
                  <th className="px-5 py-3 text-left font-semibold">Clinician</th>
                  <th className="px-5 py-3 text-left font-semibold">Status</th>
                  <th className="px-5 py-3 text-left font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredNotes.map((note) => {
                  const noteType = inferNoteType(note);
                  const status = getNoteStatus(note);
                  const duration =
                    note.durationMinutes != null ? `${note.durationMinutes} min` : '50 min';

                  return (
                    <tr key={note.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <ClientAvatar
                            name={note.clientName}
                            image={note.clientImage ?? null}
                            size="sm"
                          />
                          <div>
                            <p className="text-sm font-medium text-slate-900">{note.clientName}</p>
                            {highRiskClientIds.has(note.clientId) && (
                              <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 border border-amber-200">
                                <ShieldAlert size={10} className="text-amber-600" />
                                SP Review Due
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 text-sm tabular-nums text-slate-600">
                        <div>{formatNoteDate(note.createdAt)}</div>
                        {isLateEntryNote(note) && (
                          <span className="mt-0.5 inline-flex items-center gap-1 rounded bg-orange-50 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800 border border-orange-200">
                            <Clock size={10} /> Late Entry
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={`rounded-lg px-2 py-1 text-xs font-semibold ${TYPE_COLORS[noteType] || 'bg-slate-100 text-slate-600'}`}
                        >
                          {noteType}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-sm text-slate-600">{duration}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">
                        {note.clinicianName || note.clinicianEmail || 'Clinical staff'}
                      </td>
                      <td className="px-5 py-3">
                        {note.dismissedAt ? (
                          <span className="rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
                            Dismissed
                          </span>
                        ) : (
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[status]}`}
                          >
                            {status}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => { setAttestationChecked(false); setShowNoteDetail(note); }}
                            className="rounded-lg px-2.5 py-1 text-xs font-semibold text-[#5C2D91] transition-colors hover:bg-violet-50"
                          >
                            View
                          </button>
                          {status === 'Draft' && !note.dismissedAt && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleSign(note.id);
                              }}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-blue-600 transition-colors hover:bg-blue-50"
                            >
                              Sign
                            </button>
                          )}
                          {status === 'Draft' && !note.dismissedAt && (
                            <button
                              type="button"
                              onClick={() => setDismissTarget(note)}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50"
                            >
                              Dismiss note
                            </button>
                          )}
                          {note.dismissedAt && (
                            <button
                              type="button"
                              onClick={() => {
                                void fetch(`/api/notes/${note.id}/dismiss`, { method: 'DELETE' })
                                  .then(async (res) => {
                                    const data = await res.json().catch(() => ({}));
                                    if (!res.ok) {
                                      toast.error(data.error || 'Undo failed');
                                      return;
                                    }
                                    toast.success('Dismiss undone');
                                    await loadNotes();
                                  })
                                  .catch(() => toast.error('Undo failed'));
                              }}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100"
                            >
                              Undo dismiss
                            </button>
                          )}
                          {status === 'Signed' && (
                            <button
                              type="button"
                              onClick={() => {
                                void handleLock(note);
                              }}
                              className="rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-600 transition-colors hover:bg-emerald-50"
                            >
                              Lock
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNewNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-clinic-md">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">New Progress Note</h2>
                <p className="text-xs text-slate-500">Saved notes appear in the client record and EHR feed.</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPhrasesOpen((v) => !v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    phrasesOpen
                      ? 'bg-[#5C2D91] text-white'
                      : 'border border-[#5C2D91]/40 text-[#5C2D91] hover:bg-violet-50'
                  }`}
                >
                  Phrases
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewNote(false)}
                  className="text-xl font-bold text-slate-400 hover:text-slate-600"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="space-y-4 p-6">
              {notesError && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {notesError}
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Client *</label>
                <select
                  value={noteClientId}
                  aria-label="Note client"
                  onChange={(event) => setNoteClientId(event.target.value)}
                  disabled={clientsLoading && !preview}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/30 disabled:opacity-60"
                >
                  <option value="">{clientsLoading ? 'Loading clients…' : '— Select client —'}</option>
                  {clients.map((client) => (
                    <option key={client.id} value={client.id}>
                      {client.name}
                    </option>
                  ))}
                </select>
                {clientsError && !preview && <p className="mt-1 text-xs text-rose-600">{clientsError}</p>}
                {noteClientId && highRiskClientIds.has(noteClientId) && (
                  <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <div>
                      <strong className="font-semibold">Safety Plan Review Due:</strong> This client has had a high-severity risk alert within the last 30 days. Please review and update the Crisis Safety Plan during this encounter.
                    </div>
                  </div>
                )}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Note Type *
                  <select
                    aria-label="Note Type"
                    value={noteType}
                    onChange={(event) => {
                      const type = event.target.value as NoteType;
                      setNoteType(type);
                      const texts = sectionsToRecord(type, noteTemplate(type));
                      if (type === 'EMDR') {
                        texts.Phase = emdrPhase;
                      }
                      setSectionTexts(texts);
                      setNoteBody(composeBodyFromSections(type, texts));
                      setActivePhraseField(NOTE_SECTIONS[type]?.[0] || 'body');
                      if (type === 'SUD') setSudConfidential(true);
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    {NOTE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {NOTE_LABELS[type] || type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs font-semibold text-slate-600">Date of Service *
                  <input
                    type="date"
                    aria-label="Date of Service"
                    value={noteDos}
                    onChange={(e) => setNoteDos(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  />
                </label>
              </div>
              {hasIdentifyingInformation(noteType) && noteClientId ? (
                <IdentifyingInformationSection
                  clientId={noteClientId}
                  noteType={noteType}
                  appointmentId={null}
                  onChange={(next) => {
                    if (!next.text) return;
                    setSectionTexts((prev) => {
                      const updated = { ...prev, 'Identifying Information': next.text };
                      setNoteBody(composeBodyFromSections(noteType, updated));
                      return updated;
                    });
                  }}
                />
              ) : null}
              {noteType === 'EMDR' ? (
                <label className="block text-xs font-semibold text-slate-600">
                  EMDR Phase
                  <select
                    aria-label="EMDR Phase"
                    value={emdrPhase}
                    onChange={(e) => {
                      const phase = e.target.value as (typeof EMDR_PHASES)[number];
                      setEmdrPhase(phase);
                      setSectionTexts((prev) => {
                        const next = { ...prev, Phase: phase };
                        syncBodyFromSections('EMDR', next);
                        return next;
                      });
                    }}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    {EMDR_PHASES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Duration (min)
                  <input
                    type="number"
                    min={5}
                    max={240}
                    aria-label="Duration"
                    value={noteDuration}
                    onChange={(e) => setNoteDuration(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-slate-600">CPT / Billing Code
                  <select
                    aria-label="CPT / Billing Code"
                    value={billingCode}
                    onChange={(event) => setBillingCode(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    <option value="90837">90837 — Psychotherapy, 60 min</option>
                    {Object.entries(CPT_CATALOG).map(([code, entry]) => (
                      <option key={code} value={code}>
                        {code} — {entry.description}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={telehealth}
                    onChange={(event) => setTelehealth(event.target.checked)}
                    className="accent-[#5C2D91]"
                  />
                  Telehealth (modifier 95 · POS {telehealth ? telehealthPos : '10 or 02'})
                </label>
                {telehealth && (
                  <select
                    aria-label="Telehealth place of service"
                    value={telehealthPos}
                    onChange={(event) => setTelehealthPos(event.target.value)}
                    className="rounded-xl border border-slate-200 p-2 text-sm"
                  >
                    <option value="10">POS 10 — Telehealth Home</option>
                    <option value="02">POS 02 — Telehealth Other</option>
                  </select>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sudConfidential}
                  onChange={(event) => setSudConfidential(event.target.checked)}
                  className="accent-[#5C2D91]"
                />
                Substance Use Disorder (SUD) / Chemical Dependency record
              </label>
              {isSudNote(noteType, sudConfidential) && <Part2Notice />}

              {copyForwardOffer?.found && copyForwardOffer.displayBody ? (
                <div
                  className="rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: '#F0FDFA', border: '1px solid #99F6E4' }}
                >
                  <p className="font-semibold" style={{ color: '#0F766E' }}>
                    Previous {noteType} note —{' '}
                    {copyForwardOffer.createdAt
                      ? new Date(copyForwardOffer.createdAt).toLocaleDateString()
                      : 'prior visit'}
                  </p>
                  <p className="mt-0.5 text-xs" style={{ color: '#115E59' }}>
                    Copy content forward as a starting point, then edit as needed
                  </p>
                  <button
                    type="button"
                    className="mt-2 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm"
                    style={{ background: '#0D9488' }}
                    onClick={() => {
                      const body = copyForwardOffer.displayBody || '';
                      const texts = sectionsToRecord(noteType, body);
                      setSectionTexts(texts);
                      setNoteBody(composeBodyFromSections(noteType, texts));
                      setCopyForwardOffer(null);
                    }}
                  >
                    Copy Forward
                  </button>
                </div>
              ) : null}

              {phrasesOpen ? (
                <div
                  className="rounded-xl border p-3"
                  style={{ borderColor: '#DDD6FE', background: '#F5F3FF' }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-[#5C2D91]">Smart Phrases</p>
                    <input
                      value={phraseSearch}
                      onChange={(e) => setPhraseSearch(e.target.value)}
                      placeholder="Search phrases…"
                      className="rounded-lg border border-violet-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-[#5C2D91]"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-violet-700">
                    Inserting into:{' '}
                    <strong>{activePhraseField || 'select a field'}</strong>…
                  </p>
                  <div className="mt-2 max-h-48 space-y-3 overflow-y-auto">
                    {SMART_PHRASE_CATEGORIES.map((cat) => {
                      const items = filteredPhrases.filter((p) => p.category === cat);
                      if (!items.length) return null;
                      return (
                        <div key={cat}>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-[#5C2D91]">
                            {cat}
                          </p>
                          <div className="space-y-1">
                            {items.map((p) => (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => applyPhrase(p.key)}
                                className="block w-full rounded-lg border border-violet-100 bg-white px-2.5 py-2 text-left hover:border-[#5C2D91]/40"
                              >
                                <span className="font-mono text-[11px] font-bold text-[#5C2D91]">
                                  {p.key}
                                </span>
                                <span className="ml-2 text-[11px] font-semibold text-slate-700">
                                  {p.label}
                                </span>
                                <span className="mt-0.5 block text-[10px] leading-snug text-slate-500">
                                  {p.text.slice(0, 120)}
                                  {p.text.length > 120 ? '…' : ''}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[10px] text-violet-600">
                    Click any textarea to set the insertion target, then click a phrase to append it
                  </p>
                </div>
              ) : null}

              <div className="space-y-3">
                {(NOTE_SECTIONS[noteType] || ['Clinical Documentation']).map((heading) => (
                  <div key={heading}>
                    <label className="mb-1 block text-xs font-semibold text-slate-600">
                      {heading}
                    </label>
                    <textarea
                      ref={(el) => {
                        sectionRefs.current[heading] = el;
                      }}
                      value={sectionTexts[heading] || ''}
                      aria-label={heading}
                      onFocus={() => setActivePhraseField(heading)}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSectionTexts((prev) => {
                          const next = { ...prev, [heading]: val };
                          syncBodyFromSections(noteType, next);
                          return next;
                        });
                      }}
                      rows={heading.toLowerCase() === 'assessment' ? 5 : 3}
                      placeholder={sectionPlaceholder(noteType, heading)}
                      className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm focus:border-[#5C2D91] focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20"
                    />
                  </div>
                ))}
              </div>

              {(noteType === 'SOAP' || noteType === 'DAP') &&
              (comprehend.loading ||
                (comprehend.icd10 && comprehend.icd10.length > 0) ||
                (comprehend.medications && comprehend.medications.length > 0) ||
                comprehend.error ||
                extractComprehendText(noteType, noteBody).length >= 30) ? (
                <div
                  className="rounded-xl px-3 py-2.5 text-xs"
                  style={{ background: '#F0FDFA', border: '1px solid #99F6E4', color: '#134E4A' }}
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => setComprehendOpen((v) => !v)}
                  >
                    <span className="font-bold" style={{ color: '#0F766E' }}>
                      Comprehend Medical
                    </span>
                    {comprehend.loading ? (
                      <span className="text-teal-600">Analyzing…</span>
                    ) : (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                        style={{ background: '#0D9488' }}
                      >
                        {comprehend.icd10?.length || 0} ICD-10 · {comprehend.medications?.length || 0}{' '}
                        Meds
                      </span>
                    )}
                    {comprehend.demoMode ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                        demoMode
                      </span>
                    ) : null}
                  </button>
                  {comprehendOpen ? (
                    <div className="mt-2 space-y-3">
                      {comprehend.error ? (
                        <p className="text-rose-600">{comprehend.error}</p>
                      ) : null}
                      {Array.isArray(comprehend.icd10) && comprehend.icd10.length > 0 ? (
                        <div>
                          <p className="mb-1 font-bold text-teal-800">ICD-10-CM Suggestions</p>
                          <ul className="space-y-1.5">
                            {comprehend.icd10.slice(0, 8).map((x) => {
                              const added = addedIcd.has(x.code);
                              const pct = Math.round((x.score || 0) * 100);
                              return (
                                <li
                                  key={x.code}
                                  className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5"
                                >
                                  <span className="font-mono font-bold text-teal-900">{x.code}</span>
                                  <span className="flex-1 text-teal-800">{x.description}</span>
                                  <span className="tabular-nums text-teal-600">{pct}%</span>
                                  <button
                                    type="button"
                                    className="rounded border border-teal-200 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700"
                                    onClick={() => void navigator.clipboard?.writeText(x.code)}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    disabled={added}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white disabled:opacity-70"
                                    style={{ background: added ? '#059669' : '#0D9488' }}
                                    onClick={() => {
                                      setAddedIcd((prev) => new Set(prev).add(x.code));
                                      const planKey =
                                        (NOTE_SECTIONS[noteType] || []).find((h) =>
                                          /plan/i.test(h)
                                        ) || 'Plan';
                                      setSectionTexts((prev) => {
                                        const cur = prev[planKey] || '';
                                        const line = `${x.code} — ${x.description}`;
                                        const nextVal = cur.includes(x.code)
                                          ? cur
                                          : cur.trim()
                                            ? `${cur.trim()}\n${line}`
                                            : line;
                                        const next = { ...prev, [planKey]: nextVal };
                                        syncBodyFromSections(noteType, next);
                                        return next;
                                      });
                                    }}
                                  >
                                    {added ? 'Added ✓' : '+ Add'}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {Array.isArray(comprehend.medications) && comprehend.medications.length > 0 ? (
                        <div>
                          <p className="mb-1 font-bold text-teal-800">Medications Detected</p>
                          <ul className="space-y-1.5">
                            {comprehend.medications.slice(0, 8).map((x) => {
                              const id = x.code || x.description;
                              const added = addedMeds.has(id);
                              return (
                                <li
                                  key={id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5"
                                >
                                  <span className="flex-1 font-medium text-teal-900">
                                    {x.description || x.code}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={added}
                                    className="rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                                    style={{ background: added ? '#059669' : '#0D9488' }}
                                    onClick={() => setAddedMeds((prev) => new Set(prev).add(id))}
                                  >
                                    {added ? 'Added ✓' : '+Rx'}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-[10px] text-teal-700">
                        Powered by Amazon Comprehend Medical — review before adding to chart
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={!noteClientId || !noteDos || !hasNoteContent(noteType, noteBody) || noteSaving}
                  className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
                >
                  {noteSaving ? 'Saving…' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewNote(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showAIGenerator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-clinic-md">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <Bot size={20} className="text-blue-600" />
                  <h2 className="text-lg font-semibold text-slate-900">AI Session Note Generator</h2>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                    Beta
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">Powered by Amazon Bedrock / Claude — review before saving</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowAIGenerator(false);
                  if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
                }}
                className="text-xl font-bold text-slate-400 hover:text-slate-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div className="rounded-xl bg-amber-50 p-3 ring-1 ring-inset ring-amber-100">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                  <p className="text-xs font-medium text-amber-700">
                    AI-generated notes are a draft only. Always review, edit, and sign clinical documentation before use.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Client *</label>
                  <select
                    value={aiContext.clientId}
                    onChange={(event) => setAIContext((current) => ({ ...current, clientId: event.target.value }))}
                    disabled={clientsLoading && !preview}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-60"
                  >
                    <option value="">{clientsLoading ? 'Loading clients...' : 'Select client...'}</option>
                    {clients.map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Note Format *</label>
                  <select
                    value={aiContext.noteType}
                    onChange={(event) =>
                      setAIContext((current) => ({
                        ...current,
                        noteType: event.target.value as NoteType,
                      }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="SOAP">SOAP Note</option>
                    <option value="DAP">DAP Note</option>
                    <option value="BIRP">BIRP Note</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">
                  Session Topics (select all that apply)
                </label>
                <div className="flex flex-wrap gap-2">
                  {SESSION_TOPICS.map((topic) => (
                    <button
                      key={topic}
                      type="button"
                      onClick={() =>
                        setAIContext((current) => ({
                          ...current,
                          topics: current.topics.includes(topic)
                            ? current.topics.filter((item) => item !== topic)
                            : [...current.topics, topic],
                        }))
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                        aiContext.topics.includes(topic)
                          ? 'border-blue-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                      style={aiContext.topics.includes(topic) ? { background: '#6868D0', borderColor: '#6868D0' } : {}}
                    >
                      {topic}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-xs font-semibold text-slate-600">Interventions Used</label>
                <div className="flex flex-wrap gap-2">
                  {SESSION_INTERVENTIONS.map((intervention) => (
                    <button
                      key={intervention}
                      type="button"
                      onClick={() =>
                        setAIContext((current) => ({
                          ...current,
                          interventions: current.interventions.includes(intervention)
                            ? current.interventions.filter((item) => item !== intervention)
                            : [...current.interventions, intervention],
                        }))
                      }
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                        aiContext.interventions.includes(intervention)
                          ? 'border-blue-600 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                      }`}
                      style={
                        aiContext.interventions.includes(intervention)
                          ? { background: '#6868D0', borderColor: '#6868D0' }
                          : {}
                      }
                    >
                      {intervention}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Client Presentation / Affect</label>
                  <select
                    value={aiContext.presentation}
                    onChange={(event) =>
                      setAIContext((current) => ({ ...current, presentation: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Select...</option>
                    {PRESENTATION_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Risk Status</label>
                  <select
                    value={aiContext.riskStatus}
                    onChange={(event) =>
                      setAIContext((current) => ({ ...current, riskStatus: event.target.value }))
                    }
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option value="">Select...</option>
                    {RISK_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Additional Context</label>
                <input
                  value={aiContext.additionalContext}
                  onChange={(event) =>
                    setAIContext((current) => ({ ...current, additionalContext: event.target.value }))
                  }
                  placeholder="e.g. Session ran 60 minutes, family discussed..."
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {!aiGenerated && (
                <button
                  type="button"
                  onClick={handleGenerateNote}
                  disabled={!aiContext.clientId || aiGenerating}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  {aiGenerating ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Drafting clinical note...
                    </>
                  ) : (
                    <>
                      <Bot size={16} />
                      Generate AI Draft Note
                    </>
                  )}
                </button>
              )}

              {aiGenerated && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 py-2">
                    <div className="h-2 w-2 rounded-full bg-blue-500" />
                    <p className="text-sm font-bold text-blue-700">Note drafted successfully - review carefully before use</p>
                  </div>

                  {[{ label: aiContext.noteType, content: formatGeneratedBody(aiContext.noteType, aiGenerated) }]
                    .filter((item) => item.content)
                    .map((item) => (
                      <div key={item.label} className="rounded-xl border border-slate-200/80 bg-blue-50/50 p-4">
                        <p className="mb-2 text-xs font-bold uppercase text-blue-600">{item.label} Draft</p>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{item.content}</p>
                      </div>
                    ))}

                  <div className="flex gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleUseAINote}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                    >
                      <PenLine size={15} /> Open in Note Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => setAIGenerated(null)}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Regenerate
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAIGenerator(false)}
                      className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showNoteDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-clinic-md">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <ClientAvatar name={showNoteDetail.clientName} image={showNoteDetail.clientImage ?? null} />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{showNoteDetail.clientName} - Progress Note</h2>
                  <p className="text-xs text-slate-500">
                    {formatNoteDate(showNoteDetail.createdAt)} - {showNoteDetail.clinicianName || showNoteDetail.clinicianEmail || 'Clinical staff'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNoteDetail(null)}
                className="text-xl font-bold text-slate-400 hover:text-slate-600"
              >
                x
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[getNoteStatus(showNoteDetail)]}`}>
                  {getNoteStatus(showNoteDetail)}
                </span>
                <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${TYPE_COLORS[inferNoteType(showNoteDetail)] || 'bg-slate-100 text-slate-600'}`}>
                  {inferNoteType(showNoteDetail)}
                </span>
                {highRiskClientIds.has(showNoteDetail.clientId) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    <ShieldAlert size={13} className="text-amber-600" />
                    Safety Plan Review Due
                  </span>
                )}
                {isLateEntryNote(showNoteDetail) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-semibold text-orange-800">
                    <Clock size={13} className="text-orange-600" />
                    Late Entry — documented {formatNoteDate(showNoteDetail.createdAt)}
                  </span>
                )}
                {!preview && <Link
                  href={`/dashboard/clients/${showNoteDetail.clientId}`}
                  className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Open client record
                </Link>}
              </div>

              {isSudNote(inferNoteType(showNoteDetail), showNoteDetail.sudConfidential) && <Part2Notice />}
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {showNoteDetail.billingCode && <span className="rounded-full bg-violet-50 px-3 py-1">CPT / HCPCS {showNoteDetail.billingCode}</span>}
                {showNoteDetail.telehealth && <span className="rounded-full bg-blue-50 px-3 py-1">Telehealth · Modifier 95 · POS {showNoteDetail.placeOfService || '10'}</span>}
              </div>
              {structuredNoteSections(inferNoteType(showNoteDetail), showNoteDetail.body).map((section, index) => <section key={`${section.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-2 text-xs font-bold uppercase text-[#6B5CC8]">{section.title}</h3><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{section.text || 'Not documented'}</p></section>)}

              {showNoteDetail.dismissedAt ? (
                <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  This note was dismissed. Undo the dismissal before editing or signing.
                </p>
              ) : null}

              {getNoteStatus(showNoteDetail) === 'Draft' && !showNoteDetail.dismissedAt && (
                <label className="flex items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attestationChecked}
                    onChange={(e) => setAttestationChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#5C2D91] focus:ring-[#5C2D91]"
                  />
                  <span>
                    <strong className="font-semibold text-slate-900">Clinical Attestation:</strong> I have reviewed, verified, and assume full clinical responsibility for this note per CARF &amp; OMHC documentation standards.
                  </span>
                </label>
              )}

              <div className="flex flex-wrap gap-2 pt-2">
                {getNoteStatus(showNoteDetail) === 'Draft' && !showNoteDetail.dismissedAt && (
                  <button
                    type="button"
                    disabled={!attestationChecked}
                    onClick={() => { void handleSign(showNoteDetail.id); }}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition"
                    style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                  >
                    Sign Note
                  </button>
                )}
                {getNoteStatus(showNoteDetail) === 'Draft' && !showNoteDetail.dismissedAt && (
                  <button
                    type="button"
                    onClick={() => setDismissTarget(showNoteDetail)}
                    className="rounded-lg border border-rose-200 bg-rose-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-800"
                  >
                    Dismiss note
                  </button>
                )}
                {getNoteStatus(showNoteDetail) === 'Draft' && !showNoteDetail.dismissedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      setTypeChangeTo(null);
                      setTypeChangeOpen(true);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Change type
                  </button>
                )}
                {showNoteDetail.dismissedAt && (
                  <button
                    type="button"
                    onClick={() => {
                      void fetch(`/api/notes/${showNoteDetail.id}/dismiss`, { method: 'DELETE' })
                        .then(async (res) => {
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            toast.error(data.error || 'Undo failed');
                            return;
                          }
                          toast.success('Dismiss undone');
                          await loadNotes();
                        })
                        .catch(() => toast.error('Undo failed'));
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700"
                  >
                    Undo dismiss
                  </button>
                )}
                {getNoteStatus(showNoteDetail) === 'Signed' && (
                  <button
                    type="button"
                    onClick={() => { void handleLock(showNoteDetail); }}
                    className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white"
                    style={{ background: 'linear-gradient(135deg, #6868D0, #00695C)' }}
                  >
                    Lock Note
                  </button>
                )}
                {getNoteStatus(showNoteDetail) === 'Locked' && (
                  <button
                    type="button"
                    onClick={() => {
                      void fetch('/api/billing/claims/from-note', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ noteId: showNoteDetail.id, markReady: false }),
                      })
                        .then(async (response) => {
                          const data = await response.json().catch(() => ({}));
                          setNoteActionMessage(response.ok ? `Claim stays ${data.claim?.status || 'DRAFT'}.` : (data.error || 'Claim was not created.'));
                        })
                        .catch(() => setNoteActionMessage('Claim was not created.'));
                    }}
                    className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-800"
                  >
                    Create draft claim
                  </button>
                )}
                {getNoteStatus(showNoteDetail) === 'Signed' || getNoteStatus(showNoteDetail) === 'Locked' ? (
                  <div className="w-full space-y-2 rounded-xl border border-slate-200 p-3">
                    <p className="text-xs font-semibold text-slate-700">Addendum</p>
                    <input className="w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Reason" value={addendumReason} onChange={(event) => setAddendumReason(event.target.value)} />
                    <textarea className="min-h-20 w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Addendum text" value={addendumText} onChange={(event) => setAddendumText(event.target.value)} />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                        onClick={() => {
                          void fetch(`/api/notes/${showNoteDetail.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ addendum: { text: addendumText, reason: addendumReason } }),
                          }).then(async (response) => {
                            const data = await response.json().catch(() => ({}));
                            setNoteActionMessage(response.ok ? 'Addendum saved.' : data.error || 'Addendum was not saved.');
                          });
                        }}
                      >
                        Save addendum
                      </button>
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold"
                        onClick={() => {
                          void fetch(`/api/notes/${showNoteDetail.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ cosign: true }),
                          }).then(async (response) => {
                            const data = await response.json().catch(() => ({}));
                            setNoteActionMessage(response.ok ? 'Co-signed.' : data.error || 'Co-sign was refused.');
                          });
                        }}
                      >
                        Co-sign
                      </button>
                      <a className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold" href="/dashboard/ehr/supervisor-review">Supervisor Review</a>
                    </div>
                    {noteActionMessage ? <p className="text-xs text-slate-600">{noteActionMessage}</p> : null}
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => setShowNoteDetail(null)}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <DismissNoteDialog
        open={Boolean(dismissTarget)}
        clientName={dismissTarget?.clientName}
        busy={dismissBusy}
        onCancel={() => setDismissTarget(null)}
        onConfirm={({ reason, details }) => {
          if (!dismissTarget) return;
          setDismissBusy(true);
          void fetch(`/api/notes/${dismissTarget.id}/dismiss`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason, details }),
          })
            .then(async (res) => {
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                toast.error(data.error || 'Dismiss failed');
                return;
              }
              toast.success('Note dismissed');
              setDismissTarget(null);
              setShowNoteDetail(null);
              await loadNotes();
            })
            .catch(() => toast.error('Dismiss failed'))
            .finally(() => setDismissBusy(false));
        }}
      />

      {typeChangeOpen && showNoteDetail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white shadow-xs">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-sm font-semibold text-slate-900">Change note type</h2>
            </div>
            <div className="space-y-3 px-5 py-4">
              <p className="text-sm text-slate-700">
                Current type: {inferNoteType(showNoteDetail)}
              </p>
              <label className="block text-sm font-medium text-slate-700">
                New type <span className="text-rose-600">*</span>
              </label>
              <select
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                value={typeChangeTo || ''}
                onChange={(e) => setTypeChangeTo(e.target.value as NoteType)}
              >
                <option value="">Select…</option>
                {NOTE_TYPES.filter((t) => t !== inferNoteType(showNoteDetail)).map((t) => (
                  <option key={t} value={t}>
                    {NOTE_LABELS[t] || t}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700"
                onClick={() => setTypeChangeOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!typeChangeTo || typeChangeBusy}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => {
                  if (!typeChangeTo || !showNoteDetail) return;
                  setTypeChangeBusy(true);
                  void fetch(`/api/notes/${showNoteDetail.id}/type`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toType: typeChangeTo }),
                  })
                    .then(async (res) => {
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        toast.error(data.error || 'Type change failed');
                        return;
                      }
                      toast.success('Note type changed');
                      setTypeChangeOpen(false);
                      await loadNotes();
                    })
                    .catch(() => toast.error('Type change failed'))
                    .finally(() => setTypeChangeBusy(false));
                }}
              >
                Change type
              </button>
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
