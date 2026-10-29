'use client';

import Link from 'next/link';
import { Alert, Button, buttonClasses, ConfirmDialog, Page, PageHeader } from '@/components/ui';
import { CLINICAL_DEMO_CLIENTS, CLINICAL_DEMO_NOTES } from '@/features/ehr/clinicalDemo';
import { PreviewNotice } from '@/components/clinic/PreviewNotice';
import { Part2Notice } from '@/components/clinic/Part2Notice';
import { CPT_CATALOG } from '@/features/billing/billingHubData';
import {
  NOTE_TYPES,
  NOTE_LABELS,
  NOTE_SECTIONS,
  NOTE_FIELD_INPUTS,
  EMDR_PHASES,
  noteTemplate,
  normalizeNoteType,
  noteTypeBadge,
  structuredNoteSections,
  hasNoteContent,
  isSudNote,
  sectionPlaceholder,
  type NoteType,
} from '@/lib/ehr/noteTemplates';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { countAiDraftMarkers } from '@/lib/ai/noteDraftFormats';
import { SmartPhraseTextarea, useSmartPhrases } from '@/components/notes/SmartPhraseTextarea';
import { StructuredNoteEditor, type StructuredNoteEditorHandle } from '@/components/notes/StructuredNoteEditor';
import { IdentifyingInfoEditor } from '@/components/notes/IdentifyingInfoEditor';
import { IDENTIFYING_INFO_HEADING, type ScribeLine } from '@/lib/ehr/identifyingInfo';
import { TEMPLATE_CONFIG, asStructuredNoteType, isTherapyTemplate, structuredSignBlockers } from '@/lib/ehr/structuredNotes';
import { TherapyNoteEditor } from '@/components/notes/TherapyNoteEditor';
import { MeasuresNarrativeOffer } from '@/components/measures/MeasuresNarrativeOffer';
import { appendNarrative } from '@/lib/measures/narrative';
import { PlanGateNotice } from '@/components/therapy/PlanGateNotice';
import { NoteQualityPanel } from '@/components/ai/NoteQualityPanel';
import { SUD_INTAKE, THERAPY_INTAKE } from '@/lib/ehr/therapy/sections';
import { ADDENDUM_REASONS, type NoteMeta } from '@/lib/notes/noteMeta';
import { apiJson } from '@/lib/api-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Bot, ClipboardList, History, PenLine, Plus, ShieldAlert, Trash2, Undo2, X, Check } from 'lucide-react';
import { VisitGuidePanel, VisitGuideSignWarnings } from '@/components/visits/VisitGuidePanel';
import { loadVisitGuide, useVisitGuide } from '@/components/visits/useVisitGuide';
import { bookFollowUpHref, firstAllowedCpt, followUpLabel, followUpTypeForKind, guideProgress, withLiveNoteSteps } from '@/components/visits/visitGuideHelpers';
import { AfterSignBanner, type AfterSignState } from '@/components/notes/AfterSignBanner';
import { afterSignActions, intakeDiagnosisReviewAction } from '@/lib/notes/afterSign';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import {
  createClientNote,
  fetchClientNotes,
  fetchClients,
  fetchEhrProgressNotes,
  type Client,
  type EhrProgressNote,
} from '@/features/clients';
import { fetchRiskAlerts, type RiskAlert } from '@/features/alerts';
import { RiskWatchBanner } from '@/lib/ai/riskWatch/RiskWatchBanner';
import { updateProgressNoteStatus } from '@/lib/notes/workflow';
import { PLAN_PENDING_LABEL } from '@/lib/ehr/therapy/rules';
import { NotesWorklist, WORKLIST_TAB_KEYS, type WorklistRow } from '@/components/notes/NotesWorklist';
import { NoteServiceDetails } from '@/components/notes/NoteServiceDetails';
import { PrpNoteFields } from '@/components/notes/PrpNoteFields';
import { EMPTY_PRP_DETAIL, contactTypeFromNote, defaultPrpLocation, noteFieldsForContactType, type PrpContactType, type PrpNoteDetail } from '@/lib/prp/progressNote';
import type { PrpNoteContext } from '@/lib/prp/progressNoteDb';
import { NoteStandardPanel } from '@/components/notes/NoteStandardPanel';
import { NotePolicyCard } from '@/components/notes/NotePolicyCard';
import { broughtForwardBlock } from '@/lib/ehr/structuredNotes';
import type { ServiceContext, ServiceDetail } from '@/lib/notes/serviceDetail';
import { cptAfterTypeChange, isCarriedOverHeading, isNoteTypeChange, remapSectionsForTypeChange, splitCarriedOver, typeChangeConfirmText } from '@/lib/notes/typeChange';
import { VisitTypeControl, type VisitTypeChanged } from '@/components/visits/VisitTypeControl';
import { DismissNoteDialog } from '@/components/notes/DismissNoteDialog';
import { ScribeDock, type ScribeFill } from '@/components/scribe/ScribeDock';
import { ChartHistoryCard, createChartDigestCache } from '@/components/ai/ChartHistoryCard';
import { SessionSideTabs, type SessionSideTab } from '@/components/ai/SessionSideTabs';
import { canSeeChartHistoryTab, canSeeMedicalHistoryTab } from '@/lib/ai/chartDigest/panelOrder';
import { applySuggestion, type DraftSuggestion } from '@/lib/scribe/suggestions';
import { RiskAttestationField, isRiskGateError, riskAttestationReady, riskGateMessage } from '@/components/scribe/RiskAttestationField';
import { AiReviewBar } from '@/components/scribe/AiReviewBar';
import { acceptAllSections, acceptSection, clearMarkerIfEdited, fillDraftInPlace } from '@/lib/scribe/review';
import { notePrefillFromPlan, plannedPrimaryCode, scheduledCodeHint } from '@/lib/appointments/plannedCodes';

const EMPTY_DETAIL: ServiceDetail = {
  startTime: null,
  endTime: null,
  telehealthModality: null,
  patientLocationType: null,
  patientLocationState: null,
  telehealthConsent: null,
  diagnosisCodes: [],
};

type ComprehendEntity = { text: string; category: string; type: string; score: number };
type ComprehendCode = { code: string; description: string; score: number };

type NoteAddendum = {
  id: string;
  reason: string;
  text: string;
  authorName: string | null;
  createdAt: string;
};

/** Progress note row as returned by /api/ehr/notes (metadata columns + addenda). */
type NoteRow = EhrProgressNote & {
  clinicianId?: string | null;
  dateOfService?: string | null;
  cptCode?: string | null;
  part2?: boolean;
  aiDrafted?: boolean;
  addenda?: NoteAddendum[];
  /** Signed under the go-live transition with the treatment plan pending (YYYY-MM-DD) */
  planPendingUntil?: string | null;
  /** Primary code planned at booking on the linked appointment (hint only; the note's code bills) */
  scheduledCode?: string | null;
  /** Dismissed unsigned note (opened read-only from All notes › Include dismissed) */
  dismissedAt?: string | null;
  dismissedByName?: string | null;
  dismissReason?: string | null;
  canUndoDismiss?: boolean;
};

function PlanPendingChip({ until, size = 'sm' }: { until: string; size?: 'sm' | 'md' }) {
  return (
    <span
      title={`Signed without an active treatment plan under the go-live transition. Plan needed by ${until}.`}
      className={`inline-flex items-center gap-1 border border-amber-300 bg-amber-50 font-semibold text-amber-900 ${size === 'md' ? 'rounded-full px-2.5 py-1 text-xs' : 'mt-1 rounded px-1.5 py-0.5 text-[11px]'}`}
    >
      <AlertTriangle size={size === 'md' ? 13 : 10} /> {PLAN_PENDING_LABEL}
    </span>
  );
}

const FREE_TEXT_SECTION = 'Clinical Documentation';

function isKnownNoteType(type: string): type is NoteType {
  return (NOTE_TYPES as readonly string[]).includes(type);
}

/** Editor sections for a type; notes of an unknown type (e.g. chart notes) edit as one field. */
function headingsFor(type: string): readonly string[] {
  return isKnownNoteType(type) ? NOTE_SECTIONS[type] : [FREE_TEXT_SECTION];
}

/** Service codes the editor offers for a note type (structured templates have their own list). */
function cptOptionsFor(type: string): string[] {
  const structured = asStructuredNoteType(type);
  return structured ? TEMPLATE_CONFIG[structured].codeOptions.map((o) => o.code) : Object.keys(CPT_CATALOG);
}

/** Note section element for a Visit Guide "Go to section" action (plain, structured and therapy editors). */
function findSectionElement(section: string): HTMLElement | null {
  const slug = section.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const id of [`note-field-${section}`, `sn-text-sn-${slug}`, `tn-text-tn-${slug}`, `sn-${slug}`, `tn-${slug}`]) {
    const el = document.getElementById(id);
    if (el) return el;
  }
  return null;
}

function extractComprehendText(noteType: string, body: string): string {
  const sections = structuredNoteSections(noteType, body);
  const assessment = sections.find((s) => s.title.toLowerCase() === 'assessment')?.text?.trim() || '';
  // Source: Comprehend for SOAP/DAP when Assessment length ≥ 30
  if ((noteType === 'SOAP' || noteType === 'DAP') && assessment.length >= 30) return assessment;
  if (assessment.length >= 30) return assessment;
  return '';
}

function composeBodyFromSections(type: string, texts: Record<string, string>): string {
  if (!isKnownNoteType(type)) return (texts[FREE_TEXT_SECTION] || '').trim();
  // "Carried over from <old type>" (note type changed) is composed last, after the template
  const carried = Object.keys(texts).filter((h) => isCarriedOverHeading(h) && texts[h].trim());
  return [...NOTE_SECTIONS[type], ...carried].map((h) => `${h}\n${(texts[h] || '').trim()}`).join('\n\n');
}

/**
 * Split a saved body into editor fields. Text that does not sit under one of the
 * type's headings is kept (moved into the first field) instead of dropped.
 */
function sectionsToRecord(type: string, body: string): Record<string, string> {
  if (!isKnownNoteType(type)) return { [FREE_TEXT_SECTION]: body.trim() };
  const headings = NOTE_SECTIONS[type];
  const out: Record<string, string> = {};
  for (const h of headings) out[h] = '';
  const orphans: string[] = [];
  // Text kept from an earlier note type stays in its own labelled section
  const { main, carried } = splitCarriedOver(body);
  for (const c of carried) if (c.text) out[c.heading] = out[c.heading] ? `${out[c.heading]}\n\n${c.text}` : c.text;
  for (const s of structuredNoteSections(type, main)) {
    if (headings.includes(s.title)) out[s.title] = out[s.title] ? `${out[s.title]}\n${s.text}` : s.text;
    else if (s.text.trim()) orphans.push(s.text.trim());
  }
  if (orphans.length) {
    const first = headings[0];
    out[first] = [...orphans, out[first]].filter(Boolean).join('\n\n');
  }
  return out;
}

function formatNoteDate(value: string) {
  const d = new Date(value);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const STATUS_STYLES: Record<'Draft' | 'Signed' | 'Locked', string> = {
  Draft: 'bg-amber-100 text-amber-700 border-amber-200',
  Signed: 'bg-blue-100 text-blue-700 border-blue-200',
  Locked: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const TYPE_COLORS: Record<string, string> = {
  'Therapy Intake': 'bg-blue-100 text-blue-800',
  'Substance Abuse Intake': 'bg-amber-100 text-amber-900',
  'Therapy Progress': 'bg-emerald-100 text-emerald-800',
  SOAP: 'bg-blue-100 text-blue-700',
  DAP: 'bg-sky-100 text-sky-700',
  BIRP: 'bg-emerald-100 text-emerald-700',
  GIRP: 'bg-sky-100 text-sky-700',
  PIE: 'bg-sky-100 text-sky-700',
  CBT: 'bg-blue-100 text-blue-700',
  DBT: 'bg-blue-100 text-blue-700',
  MFT: 'bg-rose-100 text-rose-700',
  EMDR: 'bg-rose-100 text-rose-700',
  Intake: 'bg-rose-100 text-rose-700',
  'Psych Eval': 'bg-blue-100 text-blue-700',
  'Med Mgmt': 'bg-sky-100 text-sky-700',
  'Psych Med Mgmt': 'bg-blue-100 text-blue-600',
  'Child Psych Initial Intake': 'bg-blue-100 text-blue-800',
  'Child Psych Intake': 'bg-blue-100 text-blue-900',
  'Adult Psych Intake': 'bg-blue-100 text-blue-800',
  'Adult Psych Re-Eval': 'bg-blue-100 text-blue-900',
  SUD: 'bg-amber-100 text-amber-800',
  PRP: 'bg-sky-100 text-sky-800',
  'Peer Support': 'bg-emerald-100 text-emerald-800',
  Group: 'bg-amber-100 text-amber-700',
  Crisis: 'bg-rose-100 text-rose-800',
  Collateral: 'bg-sky-100 text-sky-800',
  Telephone: 'bg-slate-100 text-slate-700',
  'No-Show': 'bg-amber-100 text-amber-700',
  Discharge: 'bg-slate-100 text-slate-700',
};

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
  if (normalized.includes('psychosocial history') || normalized.includes('treatment recommendations'))
    return 'Intake';
  if (normalized.includes('psychiatric evaluation') || normalized.includes('chief complaint'))
    return 'Psych Eval';
  if (normalized.includes('medication management') || normalized.includes('current medications'))
    return 'Med Mgmt';
  if (normalized.includes('substance use') || normalized.includes('relapse prevention')) return 'SUD';
  if (normalized.includes('group topic') || normalized.includes('group therapy')) return 'Group';
  if (normalized.includes('contact attempts')) return 'No-Show';
  if (normalized.includes('reason for call') || normalized.includes('telephone')) return 'Telephone';
  if (normalized.includes('discharge') || normalized.includes('aftercare')) return 'Discharge';
  return 'SOAP';
}

export default function NotesPage() {
  const searchParams = useSearchParams();
  const presetClientId = searchParams.get('clientId') || '';
  // Started from an appointment (appointment popover "Note"): the note links to it so the claim can
  // cross-check clinician and date. Only sent when the note is first created.
  const presetAppointmentId = searchParams.get('appointmentId') || '';
  const presetDos = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('dos') || '') ? (searchParams.get('dos') as string) : '';
  const presetTelehealth = searchParams.get('telehealth') === '1';
  /** Started with "Start visit": open the note type the Visit Guide resolves and show the guide beside it */
  const guideMode = searchParams.get('guide') === '1';
  /** "Start session" (StartSessionButton): open the visit's note with the AI Scribe docked in the editor */
  const scribeMode = searchParams.get('scribe') === '1';
  /** ?capture=<id>: open that AI Scribe capture (e.g. the telehealth recording) in the dock and draft in place */
  const scribeCaptureId = searchParams.get('capture');
  const presetHandled = useRef(false);
  /** Opened from AI Scribe "Create draft note": open that note once the list loads */
  const openNoteId = searchParams.get('openNote') || '';
  const openNoteHandled = useRef(false);
  /** Chart "All notes for this client" / note view link: the worklist opens filtered to this client */
  const filterClientId = searchParams.get('filterClient') || '';
  // Deep link to a worklist queue (e.g. ?tab=escalated from the home "Overdue > 7 days" tile)
  const presetTab = WORKLIST_TAB_KEYS.find((k) => k === searchParams.get('tab'));
  const [linkedAppointmentId, setLinkedAppointmentId] = useState('');
  /** Client the linked appointment belongs to (URL preset or a worklist "Start note") */
  const linkedAppointmentClientRef = useRef('');
  /** Bumped after every save / sign so the worklist reloads */
  const [worklistKey, setWorklistKey] = useState(0);
  const notesLoadedOnce = useRef(false);
  /** Service details (billing elements) for the open note, and what the chart / appointment offer */
  const [serviceDetail, setServiceDetail] = useState<ServiceDetail>(EMPTY_DETAIL);
  const [serviceContext, setServiceContext] = useState<ServiceContext | null>(null);
  /** Server-side sign blockers for the note open in the view (standard panel) */
  const [standardBlockers, setStandardBlockers] = useState<string[]>([]);
  // Signing now would be a late entry (past the practice deadline): reason required (min chars)
  const [lateRule, setLateRule] = useState<{ required: boolean; minChars: number }>({ required: false, minChars: 10 });
  const [lateReason, setLateReason] = useState('');
  const [serviceDetailError, setServiceDetailError] = useState<string | null>(null);
  /** PRP progress note contact fields (PRP notes only) and their context (IRP objectives, next visit) */
  const [prpDetail, setPrpDetail] = useState<PrpNoteDetail>(EMPTY_PRP_DETAIL);
  const [prpContext, setPrpContext] = useState<PrpNoteContext | null>(null);
  const [prpError, setPrpError] = useState<string | null>(null);
  const [serviceLoadKey, setServiceLoadKey] = useState(0);
  /** Which note / visit the service details load for (set by openEditor) */
  const serviceLoadRef = useRef<{ noteId: string | null; appointmentId: string | null }>({ noteId: null, appointmentId: null });
  /** Id of the draft this editor session created (autosave), so later saves PATCH it */
  const createdNoteIdRef = useRef<string | null>(null);
  /** Note open in the view, readable inside async loaders */
  const detailRef = useRef<{ id: string; clientId: string } | null>(null);
  /** Visit the open note belongs to (Visit Guide beside the editor); null = no guide */
  const [guideCtx, setGuideCtx] = useState<{ clientId: string; appointmentId: string | null } | null>(null);
  const [guideDrawerOpen, setGuideDrawerOpen] = useState(false);
  /** Side panel tab beside the editor (Visit guide / Chart history); the drawer below lg shows the same tabs */
  const [sideTab, setSideTab] = useState<'guide' | 'history' | 'medical'>('guide');
  /** Clients whose chart-digest response offered a "Medical history" tab (integrated BH + primary care) */
  const [medicalKindIds, setMedicalKindIds] = useState<string[]>([]);
  /** Chart history side panel opened from the header when the note has no visit guide (lg and up) */
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  /** Clients whose chart-digest GET answered 403 this page session: the tab is hidden for them */
  const [chartDeniedIds, setChartDeniedIds] = useState<string[]>([]);
  /** Chart history digests already loaded this page session (per client): reopening the tab does not refetch */
  const [chartDigestCache] = useState(createChartDigestCache);
  const [liveClients, setClients] = useState<Client[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [liveNotes, setNotes] = useState<NoteRow[]>([]);
  const [preview] = useState(false); // Demo Preview removed: always the live chart
  const [previewNotes, setPreviewNotes] = useState<NoteRow[]>(CLINICAL_DEMO_NOTES);
  const clients = preview ? CLINICAL_DEMO_CLIENTS : liveClients;
  const notes = preview ? previewNotes : liveNotes;
  const [notesError, setNotesError] = useState<string | null>(null);
  const [showNewNote, setShowNewNote] = useState(false);
  /** Set when the editor is open on an existing draft */
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [showNoteDetail, setShowNoteDetail] = useState<NoteRow | null>(null);
  useEffect(() => {
    detailRef.current = showNoteDetail ? { id: showNoteDetail.id, clientId: showNoteDetail.clientId } : null;
  }, [showNoteDetail]);
  const [noteClientId, setNoteClientId] = useState('');
  const [noteType, setNoteType] = useState<string>('SOAP');
  const [billingCode, setBillingCode] = useState('');
  // Planned codes from the appointment (booking): prefill a note with no code; the signed note's codes bill
  const [plannedPrimary, setPlannedPrimary] = useState<string | null>(null);
  const [plannedAddOn, setPlannedAddOn] = useState<string | null>(null);
  const [codesPrefilled, setCodesPrefilled] = useState(false);
  const plannedPrefillRef = useRef(false);
  const [telehealth, setTelehealth] = useState(false);
  const [telehealthPos, setTelehealthPos] = useState('10');
  const [sudConfidential, setSudConfidential] = useState(false);
  const [aiDrafted, setAiDrafted] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
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
  const [activePhraseField, setActivePhraseField] = useState<string | null>(null);
  const [sectionTexts, setSectionTexts] = useState<Record<string, string>>({});
  const [noteDos, setNoteDos] = useState('');
  const [noteDuration, setNoteDuration] = useState('');
  const [emdrPhase, setEmdrPhase] = useState<(typeof EMDR_PHASES)[number]>(EMDR_PHASES[3]);
  const sectionRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  /** Structured templates (Psych Med Mgmt, Child / Adult Psych Intake and Re-Eval): remounted (fresh state) each time the editor opens */
  const pmmRef = useRef<StructuredNoteEditorHandle | null>(null);
  const [pmmKey, setPmmKey] = useState(0);
  const [pmmFromDraft, setPmmFromDraft] = useState(false);
  const { user: authUser } = useAuth();
  /** AI Scribe docked in the editor (Start session, or the editor's "AI Scribe" button) */
  const [scribeOpen, setScribeOpen] = useState(false);
  /** Transcript lines of the AI Scribe draft placed in this note (Identifying Information suggestions only) */
  const [scribeLines, setScribeLines] = useState<ScribeLine[] | null>(null);
  const canScribe = canAccessPath(String(authUser?.role || ''), '/dashboard/scribe');
  /** Just signed from the editor: claim result + next actions (book follow-up, next note, schedule) */
  const [afterSign, setAfterSign] = useState<AfterSignState | null>(null);
  /** The sign was refused as a late entry: the reason is asked for right here (no detour to the worklist) */
  const [lateSignNoteId, setLateSignNoteId] = useState<string | null>(null);
  const [editorLateReason, setEditorLateReason] = useState('');
  /** The sign was refused by the AI Scribe transcript-risk gate: attestation asked for here (editor + note view) */
  const [riskSignNoteId, setRiskSignNoteId] = useState<string | null>(null);
  const [riskAttestation, setRiskAttestation] = useState('');
  /** Psychiatric E/M note: psychotherapy add-on + its minutes (claim line 2), reported by the structured editor */
  const addOnRef = useRef<{ code: string; minutes: number | null }>({ code: '', minutes: null });
  /** The open note was started from a scheduled visit (in person / telehealth already known) */
  const [visitPreset, setVisitPreset] = useState(false);
  /** Shown after a therapist intake is signed: the treatment plan comes next */
  const [planPrompt, setPlanPrompt] = useState<{ clientId: string; clientName: string; noteId: string } | null>(null);
  /** Autosave for structured templates (debounced, to the existing draft path) */
  const [autosave, setAutosave] = useState<{ at: Date | null; error: string | null; saving: boolean }>({ at: null, error: null, saving: false });
  const [dirtyTick, setDirtyTick] = useState(0);
  const structuredDirtyRef = useRef(false);
  const autosaveBusyRef = useRef(false);
  const quietSaveRef = useRef<() => Promise<void>>(async () => undefined);
  const comprehendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comprehendReqRef = useRef(0);
  const { phrases } = useSmartPhrases();

  /** The note text exactly as it will be saved */
  const noteBody = useMemo(() => composeBodyFromSections(noteType, sectionTexts), [noteType, sectionTexts]);

  const [alerts, setAlerts] = useState<RiskAlert[]>([]);
  const [attestationChecked, setAttestationChecked] = useState(false);
  const [signing, setSigning] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [showAddendum, setShowAddendum] = useState(false);
  const [addendumReason, setAddendumReason] = useState('');
  const [addendumText, setAddendumText] = useState('');
  const [addendumSaving, setAddendumSaving] = useState(false);
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  /** Note type change waiting for confirmation (typed text is remapped; the rest is carried over) */
  const [pendingType, setPendingType] = useState<{ type: string; toReEval?: boolean } | null>(null);
  /** Appointment the open note documents (Visit type control in the editor header); null = none */
  const [editorAppointmentId, setEditorAppointmentId] = useState<string | null>(null);
  /** Visit type changed: the note template that matches the new type, offered once (one confirm) */
  const [pendingVisitNoteType, setPendingVisitNoteType] = useState<string | null>(null);
  /** Bumped by the Visit Guide "Change visit type" link to open the editor's control */
  const [visitTypeOpenTick, setVisitTypeOpenTick] = useState(0);
  /** Note whose "Dismiss note" dialog is open (editor or note view) */
  const [dismissTarget, setDismissTarget] = useState<{ id: string; clientName: string | null; from: 'editor' | 'detail' } | null>(null);
  const [undoingDismiss, setUndoingDismiss] = useState(false);

  /** Visit Guide beside the editor: only for a note that belongs to a visit, for the same client */
  const guideParams = useMemo(
    () =>
      showNewNote && !preview && guideCtx && guideCtx.clientId === noteClientId
        ? { clientId: guideCtx.clientId, appointmentId: guideCtx.appointmentId, noteId: editingNoteId }
        : null,
    [showNewNote, preview, guideCtx, noteClientId, editingNoteId]
  );
  const guideVisible = Boolean(guideParams);
  /** Chart history side tab: roles the API gates out never see it; a 403 hides it for that client */
  const chartTabAvailable = Boolean(
    showNewNote && !preview && noteClientId && canSeeChartHistoryTab(authUser?.role ? String(authUser.role) : null) && !chartDeniedIds.includes(noteClientId)
  );
  /** Medical history tab: BH prescribers / leadership, for a patient who is also in primary care (the API lists the kind) */
  const medicalTabAvailable = Boolean(
    chartTabAvailable && noteClientId && canSeeMedicalHistoryTab(authUser?.role ? String(authUser.role) : null) && medicalKindIds.includes(noteClientId) && !chartDeniedIds.includes(`medical:${noteClientId}`)
  );
  const activeSideTab: 'guide' | 'history' | 'medical' =
    sideTab === 'medical' && medicalTabAvailable ? 'medical' : !guideVisible ? 'history' : sideTab === 'history' && chartTabAvailable ? 'history' : 'guide';
  /** Side panel beside the editor (lg and up): the visit guide, or chart history opened from the header */
  const sidePanelVisible = guideVisible || (chartTabAvailable && historyPanelOpen);
  const sideDrawerVisible = guideVisible || chartTabAvailable;
  const guideCtrl = useVisitGuide(guideParams);
  const guideRemaining = useMemo(
    () => (guideCtrl.guide ? guideProgress(withLiveNoteSteps(guideCtrl.guide.steps, sectionTexts)).remaining : null),
    [guideCtrl.guide, sectionTexts]
  );
  /** Sign-time guide reminders on an appointment-linked draft (detail view) */
  const detailGuideParams = useMemo(() => {
    const n = showNoteDetail;
    if (!n || preview || (n.workflowStatus || 'Draft') !== 'Draft' || !n.appointmentId || n.dismissedAt) return null;
    return { clientId: n.clientId, appointmentId: n.appointmentId, noteId: n.id };
  }, [showNoteDetail, preview]);
  const detailGuideCtrl = useVisitGuide(detailGuideParams);
  const focusNoteSection = useCallback((section: string) => {
    setGuideDrawerOpen(false);
    const el = findSectionElement(section);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus({ preventScroll: true });
  }, []);

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
      // A preset client (?clientId=) is opened by openPreset once the notes are loaded too
      if (!presetClientId && !noteClientId && data.length) {
        setNoteClientId(data[0].id);
      }
      return data;
    } catch (error) {
      setClientsError(error instanceof Error ? error.message : 'Failed to load clients');
      return null;
    } finally {
      setClientsLoading(false);
    }
  };

  const loadNotes = async () => {
    setNotesError(null);
    // Perf: the worklist loads itself on mount; only later reloads (after a save / sign / dismiss)
    // refresh it. Bumping it on the first load fetched the worklist twice on every page open.
    if (notesLoadedOnce.current) setWorklistKey((k) => k + 1);
    notesLoadedOnce.current = true;
    try {
      const data = await fetchEhrProgressNotes();
      const rows = data.notes as NoteRow[];
      setNotes(rows);
      setShowNoteDetail((current) => current ? rows.find((note) => note.id === current.id) || current : null);
      // A note opened from outside the feed (older than the latest 100): refresh it from the client's notes
      const open = detailRef.current;
      if (open && !rows.some((n) => n.id === open.id)) {
        void fetchClientNotes(open.clientId)
          .then((own) => {
            const fresh = own.find((n) => n.id === open.id);
            if (fresh) setShowNoteDetail((cur) => (cur?.id === open.id ? ({ ...cur, ...fresh } as NoteRow) : cur));
          })
          .catch(() => undefined);
      }
      if (openNoteId && !openNoteHandled.current) {
        let hit = rows.find((n) => n.id === openNoteId);
        // Chart deep link (?filterClient=&openNote=): the note may be older than the feed
        if (!hit && filterClientId) {
          const own = await fetchClientNotes(filterClientId).catch(() => []);
          const found = own.find((n) => n.id === openNoteId);
          if (found) hit = { ...found, clientId: filterClientId, clientName: rows.find((n) => n.clientId === filterClientId)?.clientName || '' } as NoteRow;
        }
        if (hit) {
          openNoteHandled.current = true;
          if ((hit.workflowStatus || 'Draft') === 'Draft') openEditor({ note: hit });
          else openDetail(hit);
        }
      }
      return rows;
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : 'Failed to load notes');
      return [] as NoteRow[];
    }
  };

  /**
   * New note for a visit: the note type (and first service code) the Visit Guide resolves for it,
   * SOAP when there is no guide. Used by the URL preset and the worklist's "Start note".
   */
  const startVisitNote = async (v: { clientId: string; appointmentId: string; dos: string; telehealth: boolean; withGuide: boolean }) => {
    let type = 'SOAP';
    // No pre-selected CPT unless the visit protocol suggests one the note type offers
    let cpt = '';
    if (v.withGuide && !preview) {
      try {
        const guide = await loadVisitGuide({ clientId: v.clientId, appointmentId: v.appointmentId || null });
        const resolved = normalizeNoteType(guide.noteType);
        if (isKnownNoteType(resolved)) {
          type = resolved;
          // An E/M level is the prescriber's choice (MDM or total time): never preselected
          const suggested = firstAllowedCpt(guide.cpt, cptOptionsFor(resolved));
          cpt = /^992/.test(suggested) ? '' : suggested;
        }
      } catch {
        // Guide unavailable: open the plain note; the panel says so
      }
    }
    openEditor({ clientId: v.clientId, type, appointmentId: v.appointmentId || null });
    setNoteDos(v.dos || todayIso());
    setBillingCode(cpt);
    if (v.telehealth) setTelehealth(true);
    setVisitPreset(Boolean(v.appointmentId));
    setLinkedAppointmentId(v.appointmentId);
    linkedAppointmentClientRef.current = v.appointmentId ? v.clientId : '';
    setGuideCtx(v.withGuide ? { clientId: v.clientId, appointmentId: v.appointmentId || null } : null);
  };

  /** Worklist row: the full note comes from the loaded feed, else from the client's notes. */
  const openNoteFromWorklist = async (row: WorklistRow, mode: 'edit' | 'view') => {
    if (!row.noteId) return;
    // Dismissed notes are out of the feeds: read-only from the audited note view
    if (row.dismissedAt) {
      try {
        const res = await apiJson<{ success: true; note: NoteRow & { status: string } }>(`/api/notes/${encodeURIComponent(row.noteId)}`);
        openDetail({ ...res.note, clientImage: row.clientImage, workflowStatus: 'Draft', addenda: res.note.addenda || [] });
      } catch (error) {
        setNotesError(error instanceof Error ? error.message : 'Could not open the note');
      }
      return;
    }
    let note = notes.find((n) => n.id === row.noteId);
    if (!note) {
      try {
        const own = await fetchClientNotes(row.clientId);
        const hit = own.find((n) => n.id === row.noteId);
        if (hit) note = { ...hit, clientId: row.clientId, clientName: row.clientName, clientImage: row.clientImage } as NoteRow;
      } catch (error) {
        setNotesError(error instanceof Error ? error.message : 'Could not open the note');
        return;
      }
    }
    if (!note) {
      setNotesError('That note could not be opened. Refresh and try again.');
      return;
    }
    if (mode === 'edit' && (note.workflowStatus || 'Draft') === 'Draft') openEditor({ note });
    else openDetail(note);
  };

  /** Worklist "To write" row: start the note for that visit (Visit Guide on). */
  const startNoteFromWorklist = (row: WorklistRow) => {
    if (!row.appointmentId) return;
    void startVisitNote({ clientId: row.clientId, appointmentId: row.appointmentId, dos: row.dateOfService || todayIso(), telehealth: row.telehealth, withGuide: true });
  };

  /**
   * Opened with ?clientId= (appointment "Start visit", chart, telehealth). A note already linked to the
   * appointment is reopened instead of starting a second one. Otherwise a new note opens with the type
   * (and first service code) the Visit Guide resolves for this visit; SOAP when there is no guide.
   */
  const openPreset = async (rows: NoteRow[]) => {
    if (!presetClientId || presetHandled.current) return;
    presetHandled.current = true;
    if (openNoteId && openNoteHandled.current) return;
    if (presetAppointmentId) {
      let existing = rows.find((n) => n.appointmentId === presetAppointmentId);
      if (!existing) {
        try {
          const own = await fetchClientNotes(presetClientId);
          const hit = own.find((n) => n.appointmentId === presetAppointmentId);
          if (hit) {
            existing = {
              ...hit,
              clientId: presetClientId,
              clientName: rows.find((n) => n.clientId === presetClientId)?.clientName || '',
            };
          }
        } catch {
          // Lookup failed: start a new note as before
        }
      }
      if (existing) {
        if ((existing.workflowStatus || 'Draft') === 'Draft') {
          openEditor({ note: existing });
          if (scribeMode) setScribeOpen(true);
        } else openDetail(existing);
        return;
      }
    }
    await startVisitNote({
      clientId: presetClientId,
      appointmentId: presetAppointmentId,
      dos: presetDos,
      telehealth: presetTelehealth,
      withGuide: guideMode || Boolean(presetAppointmentId),
    });
    if (scribeMode) setScribeOpen(true);
  };

  useEffect(() => {
    if (!showNewNote || editingNoteId || !noteClientId || preview) {
      setCopyForwardOffer(null);
      return;
    }
    let cancelled = false;
    apiJson<{
      success: boolean;
      found: boolean;
      displayBody: string | null;
      noteType: string | null;
      createdAt: string | null;
    }>(
      // 42 CFR Part 2: SUD notes are offered only when this note is itself a Part 2 note
      `/api/notes/copy-forward?clientId=${encodeURIComponent(noteClientId)}&noteType=${encodeURIComponent(noteType)}${isSudNote(noteType, sudConfidential) ? '&part2=1' : ''}`
    )
      .then((res) => {
        if (!cancelled) {
          const content = res.displayBody?.trim() || null;
          setCopyForwardOffer({
            found: Boolean(res.found) && Boolean(content),
            displayBody: content,
            createdAt: res.createdAt,
            noteType: res.noteType,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setCopyForwardOffer(null);
      });
    return () => {
      cancelled = true;
    };
  }, [showNewNote, editingNoteId, noteClientId, noteType, preview, sudConfidential]);

  // PRP progress note: saved contact fields, IRP objectives (+ last note's as a suggestion), next visit
  useEffect(() => {
    if (!showNewNote || !noteClientId || preview || normalizeNoteType(noteType) !== 'PRP') {
      setPrpContext(null);
      return;
    }
    let cancelled = false;
    const { noteId, appointmentId } = serviceLoadRef.current;
    void (async () => {
      try {
        const qs = new URLSearchParams({ clientId: noteClientId, ...(noteId ? { noteId } : {}), ...(appointmentId ? { appointmentId } : {}) });
        const [ctx, saved] = await Promise.all([
          apiJson<{ success: true } & PrpNoteContext>(`/api/notes/prp-context?${qs.toString()}`),
          noteId
            ? apiJson<{ success: true; detail: PrpNoteDetail }>(`/api/notes/${encodeURIComponent(noteId)}/prp-detail`).then((r) => r.detail).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setPrpContext(ctx);
        // A new contact starts from the visit (location); objectives from the last note are offered, not applied
        setPrpDetail(saved ?? { ...EMPTY_PRP_DETAIL, location: defaultPrpLocation(ctx.appointment) });
      } catch {
        if (!cancelled) setPrpContext(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNewNote, noteClientId, noteType, preview, serviceLoadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Service details: chart diagnoses + visit defaults, and the saved values for an existing draft
  useEffect(() => {
    if (!showNewNote || !noteClientId || preview) {
      setServiceContext(null);
      return;
    }
    let cancelled = false;
    const { noteId, appointmentId } = serviceLoadRef.current;
    void (async () => {
      try {
        const qs = new URLSearchParams({ clientId: noteClientId, ...(appointmentId ? { appointmentId } : {}) });
        const ctx = await apiJson<{ success: true } & ServiceContext>(`/api/notes/service-context?${qs.toString()}`);
        const saved = noteId
          ? await apiJson<{ success: true; detail: ServiceDetail }>(`/api/notes/${encodeURIComponent(noteId)}/service-detail`)
              .then((r) => r.detail)
              .catch(() => null)
          : null;
        if (cancelled) return;
        setServiceContext({ diagnoses: ctx.diagnoses, appointment: ctx.appointment });
        const planned = ctx.appointment?.plannedCodes ?? [];
        setPlannedPrimary(plannedPrimaryCode(planned));
        const prefill = plannedPrefillRef.current ? notePrefillFromPlan(null, planned) : null;
        plannedPrefillRef.current = false;
        if (prefill && cptOptionsFor(noteType).includes(prefill.cptCode)) {
          setBillingCode(prefill.cptCode);
          setCodesPrefilled(true);
          if (prefill.addOnCptCode) setPlannedAddOn(prefill.addOnCptCode);
        }
        const hasSaved = Boolean(saved && (saved.diagnosisCodes.length || saved.startTime || saved.telehealthModality || saved.patientLocationState));
        if (hasSaved && saved) {
          setServiceDetail(saved);
          return;
        }
        // Defaults from the visit and the chart (shown to the clinician, who confirms or changes them)
        const appt = ctx.appointment;
        const primary = ctx.diagnoses.find((d) => d.rank === 'primary' && d.code)?.code;
        setServiceDetail({
          startTime: appt?.startTime ?? null,
          endTime: appt?.endTime ?? null,
          telehealthModality: appt?.telehealth ? (appt.audioOnly ? 'audio_only' : 'audio_video') : null,
          patientLocationType: appt?.patientLocationType ?? null,
          patientLocationState: appt?.patientLocationState ?? null,
          // Ticked only when a signed, current telehealth consent is on the chart (the clinician can untick)
          telehealthConsent: appt?.telehealth && ctx.telehealthConsentOnFile ? true : null,
          diagnosisCodes: primary ? [primary] : [],
        });
        // POS follows where the client was (check-in), so it is not chosen a second time in the note
        if (appt?.telehealth && appt.patientLocationType) setTelehealthPos(appt.patientLocationType === 'home' ? '10' : '02');
      } catch {
        if (!cancelled) setServiceContext({ diagnoses: [], appointment: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showNewNote, noteClientId, preview, serviceLoadKey]);

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
    void (async () => {
      const [clientRows, noteRows] = await Promise.all([loadClients(), loadNotes()]);
      if (clientRows) await openPreset(noteRows);
    })();
    void loadAlerts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  /** Open the editor: blank (new), from an AI draft, or on an existing draft note. */
  const openEditor = (opts: {
    clientId?: string;
    type?: string;
    texts?: Record<string, string>;
    note?: NoteRow;
    aiDrafted?: boolean;
    part2?: boolean;
    /** New note for a visit: service details default from this appointment */
    appointmentId?: string | null;
  } = {}) => {
    const note = opts.note;
    // Service details reload for this note / visit (effect below)
    serviceLoadRef.current = { noteId: note?.id ?? null, appointmentId: note?.appointmentId ?? opts.appointmentId ?? null };
    // Only a note with no code yet takes the appointment's planned codes (documented codes are never replaced)
    plannedPrefillRef.current = !(note?.cptCode || note?.billingCode);
    setPlannedPrimary(null);
    setPlannedAddOn(null);
    setCodesPrefilled(false);
    setEditorAppointmentId(note?.appointmentId ?? opts.appointmentId ?? null);
    setPendingVisitNoteType(null);
    createdNoteIdRef.current = null;
    setServiceDetail(EMPTY_DETAIL);
    setServiceDetailError(null);
    setServiceLoadKey((k) => k + 1);
    const type = note ? inferNoteType(note) : opts.type || noteType;
    const texts = note
      ? sectionsToRecord(type, note.body)
      : opts.texts
        ? { ...sectionsToRecord(type, ''), ...opts.texts }
        : sectionsToRecord(type, noteTemplate(isKnownNoteType(type) ? type : 'SOAP'));
    if (!note && type === 'EMDR' && !texts.Phase) texts.Phase = emdrPhase;
    const clientId = note?.clientId || opts.clientId || noteClientId;
    if (clientId) setNoteClientId(clientId);
    else if (clients[0]) setNoteClientId(clients[0].id);
    setEditingNoteId(note?.id ?? null);
    setNoteType(type);
    setSectionTexts(texts);
    setNoteDos(note?.dateOfService || (note ? note.createdAt.slice(0, 10) : todayIso()));
    const pmm = Boolean(asStructuredNoteType(type));
    // Time is never defaulted (a 50-minute default contradicted 90837's 53+ rule); structured templates
    // also leave the service code to the clinician.
    setNoteDuration(note?.durationMinutes != null ? String(note.durationMinutes) : '');
    setBillingCode(note ? note.cptCode || note.billingCode || '' : pmm ? '' : '90837');
    setPmmKey((k) => k + 1);
    setPmmFromDraft(Boolean(note));
    addOnRef.current = { code: '', minutes: null };
    setVisitPreset(false);
    structuredDirtyRef.current = false;
    setAutosave({ at: null, error: null, saving: false });
    setTelehealth(Boolean(note?.telehealth));
    setTelehealthPos(note?.placeOfService === '02' ? '02' : '10');
    setSudConfidential(Boolean(note ? note.part2 ?? note.sudConfidential : opts.part2) || type === 'SUD');
    setAiDrafted(Boolean(note?.aiDrafted || opts.aiDrafted));
    setEditorError(null);
    setPhrasesOpen(false);
    setPhraseSearch('');
    setActivePhraseField(headingsFor(type)[0] || null);
    setAddedIcd(new Set());
    setAddedMeds(new Set());
    // A draft that documents an appointment keeps its Visit Guide; a blank New Note has none
    setGuideCtx(note?.appointmentId ? { clientId: note.clientId, appointmentId: note.appointmentId } : null);
    setGuideDrawerOpen(false);
    setScribeOpen(false);
    setShowNewNote(true);
  };

  const editorMeta = (): NoteMeta => ({
    noteType,
    dateOfService: noteDos || null,
    durationMinutes: Number(noteDuration) || null,
    cptCode: billingCode || null,
    telehealth,
    placeOfService: telehealth ? telehealthPos : '11',
    // Modality from Service details drives the payer audio-only modifier on the claim
    audioOnly: telehealth && serviceDetail.telehealthModality === 'audio_only',
    // Structured psychiatric E/M notes only: the add-on is the claim's second line (never sent for other notes)
    ...(asStructuredNoteType(noteType)
      ? {
          addOnCptCode: (['90833', '90836', '90838'].includes(addOnRef.current.code) ? addOnRef.current.code : '') as NoteMeta['addOnCptCode'],
          psychotherapyMinutes: addOnRef.current.code ? addOnRef.current.minutes : null,
        }
      : {}),
    part2: isSudNote(noteType, sudConfidential),
    aiDrafted,
  });

  /** Service details changed in the editor: keep POS in step with where the client was. */
  const changeServiceDetail = (next: ServiceDetail) => {
    if (next.patientLocationType && next.patientLocationType !== serviceDetail.patientLocationType) {
      setTelehealthPos(next.patientLocationType === 'home' ? '10' : '02');
    }
    setServiceDetail(next);
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  };

  /** PRP contact type sets the note's own telehealth flag + modality (one source of truth). */
  const changePrpContactType = (t: PrpContactType) => {
    const f = noteFieldsForContactType(t);
    setTelehealth(f.telehealth);
    changeServiceDetail({ ...serviceDetail, telehealthModality: f.telehealthModality });
  };

  const changePrpDetail = (next: PrpNoteDetail) => {
    setPrpDetail(next);
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  };

  /** Save PRP contact fields with a PRP note. Non-fatal: the note itself is already saved. */
  const persistPrpDetail = async (noteId: string) => {
    if (preview || normalizeNoteType(noteType) !== 'PRP') return;
    try {
      const { patientSignedAt: _signedAt, ...body } = prpDetail;
      void _signedAt;
      const r = await apiJson<{ success: true; detail: PrpNoteDetail }>(`/api/notes/${encodeURIComponent(noteId)}/prp-detail`, { method: 'PUT', body: JSON.stringify(body) });
      setPrpDetail((cur) => ({ ...cur, patientSignedAt: r.detail.patientSignedAt }));
      setPrpError(null);
    } catch (error) {
      setPrpError(error instanceof Error ? `PRP contact fields not saved: ${error.message}` : 'PRP contact fields not saved');
    }
  };

  /** Save service details with the note. Non-fatal: the note itself is already saved. */
  const persistServiceDetail = async (noteId: string) => {
    if (preview) return;
    try {
      await apiJson(`/api/notes/${encodeURIComponent(noteId)}/service-detail`, { method: 'PUT', body: JSON.stringify(serviceDetail) });
      setServiceDetailError(null);
    } catch (error) {
      setServiceDetailError(error instanceof Error ? `Service details not saved: ${error.message}` : 'Service details not saved');
    }
  };

  /**
   * Change the open note's type (src/lib/notes/typeChange.ts). Sections with the same heading move
   * across; text in sections the new template doesn't have goes to "Carried over from <old type>".
   * The service code is kept only when the new type offers it; the Visit Guide suggests one otherwise.
   * The next save sends the new type (server: known type, unsigned only, audited).
   */
  const changeNoteType = (type: string, opts: { toReEval?: boolean } = {}) => {
    const current = composeBodyFromSections(noteType, sectionTexts);
    const typed = hasNoteContent(noteType, current);
    const texts = typed
      ? remapSectionsForTypeChange({ fromType: noteType, toHeadings: headingsFor(type), texts: sectionTexts }).texts
      : sectionsToRecord(type, noteTemplate(isKnownNoteType(type) ? type : 'SOAP'));
    if (opts.toReEval) {
      // "Switch to ... Re-Eval" from an initial intake: the header is regenerated. A saved draft keeps its
      // header extras (informants, guardian) with the evaluation type the clinician just chose.
      if (!editingNoteId) texts.Header = '';
      else if (texts.Header) texts.Header = texts.Header.replace(/^Evaluation type: .*$/m, 'Evaluation type: Re-evaluation');
    }
    if (type === 'EMDR' && !texts.Phase) texts.Phase = emdrPhase;
    setNoteType(type);
    setSectionTexts(texts);
    setActivePhraseField(headingsFor(type)[0] || null);
    if (type === 'SUD') setSudConfidential(true);
    const keptCode = cptAfterTypeChange(billingCode, type, cptOptionsFor(type));
    if (asStructuredNoteType(type)) {
      // Prescriber chooses time and service code; no default code
      setBillingCode('');
      setNoteDuration('');
      setPmmFromDraft(Boolean(editingNoteId));
      setPmmKey((k) => k + 1);
    } else if (keptCode !== billingCode) {
      // Code the new type doesn't use (e.g. 90791 on a progress note): the visit protocol's code, never an E/M level
      const suggested = guideCtrl.guide ? firstAllowedCpt(guideCtrl.guide.cpt, cptOptionsFor(type)) : '';
      setBillingCode(keptCode || (/^992/.test(suggested) ? '' : suggested));
    }
    // Saved with the next autosave (sign checks re-run for the new type)
    if (editingNoteId || createdNoteIdRef.current) {
      structuredDirtyRef.current = true;
      setDirtyTick((t) => t + 1);
    }
  };

  /** Note type control: confirm first when something is typed (nothing is lost; see changeNoteType). */
  const requestNoteTypeChange = (type: string, opts: { toReEval?: boolean } = {}) => {
    if (type === noteType) return;
    if (hasNoteContent(noteType, composeBodyFromSections(noteType, sectionTexts))) setPendingType({ type, ...opts });
    else changeNoteType(type, opts);
  };

  /**
   * Visit type changed from the editor header (src/components/visits/VisitTypeControl.tsx): POS /
   * telehealth follow the new setting (saved with the next autosave, so the claim drafted at sign
   * uses them), the Visit Guide reloads for the new type, and the matching note template is offered.
   */
  /** Visit Guide link: close the mobile drawer, scroll to the editor's Visit type control and open it */
  const openVisitTypeControl = () => {
    setGuideDrawerOpen(false);
    setVisitTypeOpenTick((t) => t + 1);
    document.getElementById('visit-type-control')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const onVisitTypeChanged = (r: VisitTypeChanged) => {
    if (r.changed.includes('isVirtual')) {
      setTelehealth(r.place.telehealth);
      if (r.place.placeOfService === '10' || r.place.placeOfService === '02') setTelehealthPos(r.place.placeOfService);
      setServiceDetail((d) => ({
        ...d,
        telehealthModality: r.place.telehealth ? d.telehealthModality ?? (r.place.audioOnly ? 'audio_only' : 'audio_video') : null,
      }));
      structuredDirtyRef.current = true;
      setDirtyTick((t) => t + 1);
    }
    guideCtrl.reload();
    const matched = r.noteType ? normalizeNoteType(r.noteType) : '';
    if (matched && isKnownNoteType(matched) && isNoteTypeChange(noteType, matched)) setPendingVisitNoteType(matched);
  };

  /** Dismissed from the editor or the note view: nothing left to autosave; the queues refresh. */
  const afterDismiss = async (from: 'editor' | 'detail') => {
    if (from === 'editor') {
      structuredDirtyRef.current = false;
      createdNoteIdRef.current = null;
      resetEditor();
    } else setShowNoteDetail(null);
    await loadNotes();
  };

  const undoDismissFromDetail = async (note: NoteRow) => {
    if (undoingDismiss) return;
    setUndoingDismiss(true);
    setDetailError(null);
    try {
      await apiJson(`/api/notes/${encodeURIComponent(note.id)}/dismiss`, { method: 'DELETE' });
      setShowNoteDetail(null);
      await loadNotes();
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Could not undo the dismissal');
    } finally {
      setUndoingDismiss(false);
    }
  };

  const closeEditor = () => {
    // Keep unsaved edits (saved as a draft) when the editor closes
    if (structuredDirtyRef.current && !preview) void quietSaveRef.current();
    structuredDirtyRef.current = false;
    setShowNewNote(false);
    setEditingNoteId(null);
    setEditorError(null);
  };

  /** Create or update the note being edited; returns its id. */
  const persistNote = async (): Promise<string> => {
    const meta = editorMeta();
    const body = noteBody.trim();
    if (preview) {
        const row: NoteRow = {
          id: editingNoteId || `preview-note-${crypto.randomUUID()}`,
          clientId: noteClientId,
          clientName: clients.find((client) => client.id === noteClientId)?.name || 'Demo client',
          body,
          createdAt: new Date().toISOString(),
          noteType,
          dateOfService: meta.dateOfService,
          billingCode: meta.cptCode,
          cptCode: meta.cptCode,
          telehealth,
          placeOfService: meta.placeOfService,
          sudConfidential: meta.part2,
          part2: meta.part2,
          aiDrafted,
          workflowStatus: 'Draft',
          durationMinutes: meta.durationMinutes,
          clinicianName: 'Demo clinician',
        };
        setPreviewNotes((rows) =>
          editingNoteId ? rows.map((r) => (r.id === editingNoteId ? { ...r, ...row, createdAt: r.createdAt } : r)) : [row, ...rows]
        );
        return row.id;
    }
    // An autosave may have created the draft since this render: never create a second note
    const existingId = editingNoteId || createdNoteIdRef.current;
    if (existingId) {
      await apiJson(`/api/notes/${encodeURIComponent(existingId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ body, status: 'draft', ...meta }),
      });
      await persistServiceDetail(existingId);
      await persistPrpDetail(existingId);
      return existingId;
    }
    const created = await createClientNote(noteClientId, body, {
      ...meta,
      ...(linkedAppointmentId && noteClientId === linkedAppointmentClientRef.current ? { appointmentId: linkedAppointmentId } : {}),
    });
    setLinkedAppointmentId('');
    createdNoteIdRef.current = created.id;
    await persistServiceDetail(created.id);
    await persistPrpDetail(created.id);
    return created.id;
  };

  const resetEditor = () => {
    closeEditor();
    setSectionTexts({});
    setNoteType('SOAP');
    setBillingCode('');
    setTelehealth(false);
    setSudConfidential(false);
    setAiDrafted(false);
  };

  const handleSaveNote = async () => {
    if (!noteClientId || !noteDos || !hasNoteContent(noteType, noteBody) || noteSaving) return;
    setNoteSaving(true);
    setEditorError(null);
    // Wait for an in-flight autosave so this save does not create a second note
    for (let i = 0; i < 50 && autosaveBusyRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      await persistNote();
      structuredDirtyRef.current = false;
      if (!preview) await loadNotes();
      resetEditor();
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Could not save note');
    } finally {
      setNoteSaving(false);
    }
  };

  /** Structured-template autosave / Ctrl+S: save the draft without closing the editor. */
  const quietSave = async () => {
    if (preview || !noteClientId || !noteDos || !hasNoteContent(noteType, noteBody)) return;
    if (autosaveBusyRef.current || noteSaving) {
      setDirtyTick((t) => t + 1);
      return;
    }
    autosaveBusyRef.current = true;
    structuredDirtyRef.current = false;
    setAutosave((a) => ({ ...a, saving: true }));
    try {
      const wasNew = !editingNoteId;
      const id = await persistNote();
      if (wasNew) {
        // First save created the draft; later saves PATCH it
        setEditingNoteId(id);
        void loadNotes().catch(() => undefined);
      }
      setAutosave({ at: new Date(), error: null, saving: false });
    } catch (error) {
      structuredDirtyRef.current = true;
      setAutosave((a) => ({ ...a, saving: false, error: error instanceof Error ? error.message : 'Autosave failed' }));
    } finally {
      autosaveBusyRef.current = false;
    }
  };
  quietSaveRef.current = quietSave;

  const markStructuredEdit = useCallback(() => {
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  }, []);

  /** Structured template Review section: save, then sign with the attestation the clinician just confirmed. */
  const handleSaveAndSign = async () => {
    if (!noteClientId || !noteDos || !hasNoteContent(noteType, noteBody) || noteSaving) return;
    const [blocker] = structuredSignBlockers({ noteType, body: noteBody, cptCode: billingCode, durationMinutes: Number(noteDuration) || null });
    if (blocker) {
      setEditorError(blocker.message);
      return;
    }
    setNoteSaving(true);
    setEditorError(null);
    let savedId: string | null = null;
    // Wait for an in-flight autosave so the sign path does not create a second note
    for (let i = 0; i < 50 && autosaveBusyRef.current; i++) await new Promise((r) => setTimeout(r, 100));
    try {
      savedId = await persistNote();
      // Saved: nothing left for autosave (and never PATCH the note once it is signed)
      structuredDirtyRef.current = false;
      // Later retries update this note instead of creating another one
      setEditingNoteId(savedId);
      if (preview) {
        const id = savedId;
        setPreviewNotes((rows) => rows.map((row) => (row.id === id ? { ...row, workflowStatus: 'Signed' } : row)));
      } else {
        const signed = await updateProgressNoteStatus(savedId, 'Signed', {
          attested: true,
          ...(lateSignNoteId === savedId && editorLateReason.trim() ? { lateEntryReason: editorLateReason.trim() } : {}),
          ...(riskSignNoteId === savedId && riskAttestationReady(riskAttestation) ? { riskAttestation: riskAttestation.trim() } : {}),
        });
        await loadNotes();
        const isIntake = noteType === THERAPY_INTAKE || noteType === SUD_INTAKE;
        // Follow-up from the Visit Guide (interval already shortened for risk / a med change)
        const g = guideCtrl.guide;
        const days = g?.followUp.suggestedDays ?? null;
        const followUpHref = linkedAppointmentId || g
          ? bookFollowUpHref({ clientId: noteClientId, days, from: noteDos || todayIso(), type: followUpTypeForKind(g?.kind) })
          : null;
        setAfterSign({
          clientName: clients.find((c) => c.id === noteClientId)?.name || 'this client',
          noteType,
          claimMessage: signed.claim?.message ?? null,
          cosignRequired: Boolean(signed.cosignRequired),
          actions: afterSignActions({
            clientId: noteClientId,
            noteType,
            claimId: signed.claim?.claimId ?? null,
            followUpHref,
            followUpLabel: days != null ? `Book follow-up in ${followUpLabel(days)}` : 'Book follow-up',
            nextBooked: Boolean(g?.followUp.nextBooked),
            canOpenClaims: canAccessPath(String(authUser?.role || ''), '/dashboard/billing/claims'),
          })
            .filter((a) => !(isIntake && a.id === 'treatment_plan'))
            .concat(intakeDiagnosisReviewAction({ clientId: noteClientId, noteType }) ?? []),
        });
      }
      if (noteType === THERAPY_INTAKE || noteType === SUD_INTAKE) {
        setPlanPrompt({ clientId: noteClientId, clientName: clients.find((c) => c.id === noteClientId)?.name || 'this client', noteId: savedId });
      }
      setLateSignNoteId(null);
      setEditorLateReason('');
      setRiskSignNoteId(null);
      setRiskAttestation('');
      resetEditor();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign note';
      // Late entry: ask for the reason right here, then "Save & Sign" again
      const late = /late-entry reason/i.test(message);
      if (late && savedId) setLateSignNoteId(savedId);
      const risk = isRiskGateError(message);
      if (risk && savedId) setRiskSignNoteId(savedId);
      const hint = late ? ' Enter the late-entry reason below and sign again.' : risk ? ' Document the risk assessment, or record the attestation below and sign again.' : '';
      const shown = risk ? riskGateMessage(message) : message;
      setEditorError(savedId ? `Saved as a draft, but not signed: ${shown}${hint}` : shown);
      if (savedId && !preview) await loadNotes().catch(() => undefined);
    } finally {
      setNoteSaving(false);
    }
  };

  const getNoteStatus = (note: NoteRow) => note.workflowStatus || 'Draft';

  const openDetail = (note: NoteRow) => {
    setAttestationChecked(false);
    setDetailError(null);
    setShowAddendum(false);
    setAddendumReason('');
    setAddendumText('');
    setStandardBlockers([]);
    setLateRule({ required: false, minChars: 10 });
    setLateReason('');
    setShowNoteDetail(note);
  };

  /** Why this note cannot be signed yet (null when it can). */
  const signBlocker = (note: NoteRow): string | null => {
    const [templateBlocker] = structuredSignBlockers({
      noteType: inferNoteType(note),
      body: note.body,
      cptCode: note.cptCode || note.billingCode,
      durationMinutes: note.durationMinutes ?? null,
    });
    if (templateBlocker) return `${templateBlocker.message} Edit the draft to complete it.`;
    const blanks = findUnfilledBlanks(note.body);
    if (blanks > 0) {
      return `${blanks} unfilled [___] blank${blanks === 1 ? ' remains' : 's remain'}. Edit the draft and fill ${blanks === 1 ? 'it' : 'them'} before signing.`;
    }
    const markers = countAiDraftMarkers(note.body);
    if (markers > 0) {
      return `${markers} section${markers === 1 ? ' still carries' : 's still carry'} the AI DRAFT marker. Edit the draft, review each section and remove the marker before signing.`;
    }
    // Required billing / compliance elements (server check, src/lib/notes/standard.ts)
    if (standardBlockers.length && showNoteDetail?.id === note.id) return `${standardBlockers[0]} Edit the draft to complete it.`;
    return null;
  };

  const handleSign = async (note: NoteRow) => {
    if (signing) return;
    const blocker = signBlocker(note);
    if (blocker) {
      setDetailError(blocker);
      return;
    }
    if (!attestationChecked) {
      setDetailError('Confirm the clinical attestation before signing.');
      return;
    }
    if (lateRule.required && lateReason.trim().length < lateRule.minChars) {
      setDetailError(`This note is past the practice sign deadline: enter a late-entry reason (at least ${lateRule.minChars} characters).`);
      return;
    }
    setSigning(true);
    setDetailError(null);
    try {
      if (preview) {
        setPreviewNotes((rows) => rows.map((row) => row.id === note.id ? { ...row, workflowStatus: 'Signed' } : row));
        setShowNoteDetail((row) => row?.id === note.id ? { ...row, workflowStatus: 'Signed' } : row);
      } else {
        const signed = await updateProgressNoteStatus(note.id, 'Signed', {
          attested: true,
          ...(lateRule.required ? { lateEntryReason: lateReason.trim() } : {}),
          ...(riskSignNoteId === note.id && riskAttestationReady(riskAttestation) ? { riskAttestation: riskAttestation.trim() } : {}),
        });
        await loadNotes();
        const g = detailGuideCtrl.guide;
        const days = g?.followUp.suggestedDays ?? null;
        setAfterSign({
          clientName: note.clientName || 'this client',
          noteType: note.noteType || '',
          claimMessage: signed.claim?.message ?? null,
          cosignRequired: Boolean(signed.cosignRequired),
          actions: afterSignActions({
            clientId: note.clientId,
            noteType: note.noteType || null,
            claimId: signed.claim?.claimId ?? null,
            followUpHref: note.appointmentId
              ? bookFollowUpHref({ clientId: note.clientId, days, from: note.dateOfService || todayIso(), type: followUpTypeForKind(g?.kind) })
              : null,
            followUpLabel: days != null ? `Book follow-up in ${followUpLabel(days)}` : 'Book follow-up',
            nextBooked: Boolean(g?.followUp.nextBooked),
            canOpenClaims: canAccessPath(String(authUser?.role || ''), '/dashboard/billing/claims'),
          }).concat(intakeDiagnosisReviewAction({ clientId: note.clientId, noteType: note.noteType || null }) ?? []),
        });
      }
      setAttestationChecked(false);
      setLateReason('');
      setRiskSignNoteId(null);
      setRiskAttestation('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not sign note';
      if (isRiskGateError(message)) {
        setRiskSignNoteId(note.id);
        setDetailError(riskGateMessage(message));
      } else setDetailError(message);
    } finally {
      setSigning(false);
    }
  };

  const handleLock = async (note: NoteRow) => {
    try {
      if (preview) {
        setPreviewNotes((rows) => rows.map((item) => item.id === note.id ? { ...item, workflowStatus: 'Locked' } : item));
        setShowNoteDetail((row) => row?.id === note.id ? { ...row, workflowStatus: 'Locked' } : row);
      } else { await updateProgressNoteStatus(note.id, 'Locked'); await loadNotes(); }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not lock note';
      if (showNoteDetail?.id === note.id) setDetailError(message);
      else setNotesError(message);
    }
  };

  const handleSaveAddendum = async (note: NoteRow) => {
    const text = addendumText.trim();
    if (!addendumReason || !text || addendumSaving) return;
    setAddendumSaving(true);
    setDetailError(null);
    try {
      if (preview) {
        const addendum: NoteAddendum = {
          id: `preview-addendum-${crypto.randomUUID()}`,
          reason: addendumReason,
          text,
          authorName: 'Demo clinician',
          createdAt: new Date().toISOString(),
        };
        const add = (row: NoteRow) => ({ ...row, addenda: [...(row.addenda || []), addendum] });
        setPreviewNotes((rows) => rows.map((row) => (row.id === note.id ? add(row) : row)));
        setShowNoteDetail((row) => (row?.id === note.id ? add(row) : row));
      } else {
        await apiJson(`/api/notes/${encodeURIComponent(note.id)}/addenda`, {
          method: 'POST',
          body: JSON.stringify({ reason: addendumReason, text }),
        });
        await loadNotes();
      }
      setShowAddendum(false);
      setAddendumReason('');
      setAddendumText('');
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Could not save addendum');
    } finally {
      setAddendumSaving(false);
    }
  };

  const setSection = (heading: string, value: string) => {
    // Editing the words of an AI section counts as reviewing it: its AI DRAFT marker clears (review.ts)
    setSectionTexts((prev) => ({ ...prev, [heading]: clearMarkerIfEdited(prev[heading] || '', value) }));
    // Plain templates autosave too (debounced effect below)
    structuredDirtyRef.current = true;
  };

  /** Phrases panel: append to the last-focused field. */
  const applyPhrase = (text: string) => {
    const field = activePhraseField || headingsFor(noteType)[0];
    if (!field) return;
    if (asStructuredNoteType(noteType)) {
      pmmRef.current?.insertText(field, text);
      return;
    }
    setSectionTexts((prev) => {
      const cur = prev[field] || '';
      return { ...prev, [field]: cur.trim() ? `${cur.trim()} ${text}` : text };
    });
    structuredDirtyRef.current = true;
    requestAnimationFrame(() => sectionRefs.current[field]?.focus());
  };

  const filteredPhrases = useMemo(() => {
    const q = phraseSearch.trim().toLowerCase();
    if (!q) return phrases;
    return phrases.filter(
      (p) =>
        p.key.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        p.text.toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
    );
  }, [phraseSearch, phrases]);

  const phraseGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredPhrases>();
    for (const p of filteredPhrases) {
      const cat = p.mine ? 'My phrases' : p.category || 'Other';
      groups.set(cat, [...(groups.get(cat) || []), p]);
    }
    return [...groups.entries()];
  }, [filteredPhrases]);

  const structuredType = asStructuredNoteType(noteType);

  /** Structured / therapy editors keep their own field state: re-open them on the new texts */
  const remountStructured = () => {
    if (!asStructuredNoteType(noteType)) return;
    setPmmFromDraft(true);
    setPmmKey((k) => k + 1);
  };

  /** Docked AI Scribe finished: place the draft in the note's sections, in place, and autosave */
  const applyScribeFill = (fill: ScribeFill) => {
    const drafted = sectionsToRecord(noteType, fill.body);
    const template = sectionsToRecord(noteType, noteTemplate(isKnownNoteType(noteType) ? noteType : 'SOAP'));
    const { texts } = fillDraftInPlace({ current: sectionTexts, drafted, template, headings: headingsFor(noteType) });
    setSectionTexts(texts);
    setAiDrafted(true);
    setScribeLines(fill.lines ?? null);
    if (fill.part2) setSudConfidential(true);
    if (fill.minutes && !noteDuration) setNoteDuration(String(fill.minutes));
    remountStructured();
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  };

  /** A withheld AI suggestion the clinician chose to insert (ScribeDock): into its section, MSE line in place */
  const insertScribeSuggestion = (s: DraftSuggestion) => {
    if (!headingsFor(noteType).includes(s.heading)) return;
    setSectionTexts((prev) => ({ ...prev, [s.heading]: applySuggestion(prev[s.heading] || '', s) }));
    remountStructured();
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  };

  /** "Accept" one AI section / "Accept all reviewed" (review.ts) */
  const acceptAiSections = (headings: string[]) => {
    setSectionTexts((prev) => (headings.length === 1 ? acceptSection(prev, headings[0]) : acceptAllSections(prev, headings)));
    remountStructured();
    structuredDirtyRef.current = true;
    setDirtyTick((t) => t + 1);
  };

  // Debounced autosave for every note type (only after the clinician edits something)
  useEffect(() => {
    if (!showNewNote || preview || !structuredDirtyRef.current) return;
    const timer = setTimeout(() => void quietSaveRef.current(), 2500);
    return () => clearTimeout(timer);
  }, [noteBody, billingCode, noteDuration, telehealth, telehealthPos, noteDos, showNewNote, structuredType, preview, dirtyTick, serviceDetail]);

  const saveStatusText = preview
    ? 'Demo Preview: not autosaved'
    : autosave.saving
      ? 'Saving…'
      : autosave.error
        ? `Autosave failed: ${autosave.error}`
        : autosave.at
          ? `Draft saved ${autosave.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
          : 'Autosaves as you work · Ctrl+S saves now';

  const noteTypeOptions: string[] = isKnownNoteType(noteType) ? [...NOTE_TYPES] : [noteType, ...NOTE_TYPES];

  /** Side panel / drawer tabs. Only the active tab is mounted: chart history is fetched when its tab opens */
  const sessionSideTabs = (inDrawer: boolean): SessionSideTab[] => {
    const tabs: SessionSideTab[] = [];
    if (guideVisible && guideParams) {
      tabs.push({
        id: 'guide',
        label: 'Visit guide',
        icon: <ClipboardList size={12} aria-hidden />,
        render: () => (
          <VisitGuidePanel
            clientId={guideParams.clientId}
            appointmentId={guideParams.appointmentId}
            noteId={editingNoteId}
            controller={guideCtrl}
            noteSections={sectionTexts}
            onFocusSection={focusNoteSection}
            visitDate={noteDos || undefined}
            collapsible={inDrawer ? false : undefined}
            onChangeVisitType={editorAppointmentId ? openVisitTypeControl : undefined}
          />
        ),
      });
    }
    if (chartTabAvailable && noteClientId) {
      tabs.push({
        id: 'history',
        label: 'Chart history',
        icon: <History size={12} aria-hidden />,
        render: () => (
          <ChartHistoryCard
            key={noteClientId}
            variant="panel"
            clientId={noteClientId}
            role={authUser?.role ? String(authUser.role) : null}
            cache={chartDigestCache}
            onDenied={() => setChartDeniedIds((prev) => (prev.includes(noteClientId) ? prev : [...prev, noteClientId]))}
            onKinds={(kinds) => {
              if (kinds.includes('medical')) setMedicalKindIds((prev) => (prev.includes(noteClientId) ? prev : [...prev, noteClientId]));
            }}
          />
        ),
      });
    }
    if (medicalTabAvailable && noteClientId) {
      tabs.push({
        id: 'medical',
        label: 'Medical history',
        icon: <History size={12} aria-hidden />,
        render: () => (
          <ChartHistoryCard
            key={`medical:${noteClientId}`}
            kind="medical"
            variant="panel"
            clientId={noteClientId}
            role={authUser?.role ? String(authUser.role) : null}
            cache={chartDigestCache}
            onDenied={() => setChartDeniedIds((prev) => (prev.includes(`medical:${noteClientId}`) ? prev : [...prev, `medical:${noteClientId}`]))}
          />
        ),
      });
    }
    return tabs;
  };

  return (
    <Page width="full">
      {preview && <PreviewNotice />}
      {afterSign ? <AfterSignBanner state={afterSign} onClose={() => setAfterSign(null)} /> : null}
      {planPrompt ? (
        <Alert
          tone="brand"
          title="Intake signed. Next: the treatment plan."
          actions={
            <>
              <Link
                href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(planPrompt.clientId)}&fromNoteId=${encodeURIComponent(planPrompt.noteId)}`}
                className={buttonClasses({ size: 'sm' })}
              >
                Create treatment plan
              </Link>
              <Button size="sm" variant="secondary" onClick={() => setPlanPrompt(null)}>
                Later
              </Button>
            </>
          }
        >
          A signed treatment plan is required before progress notes for {planPrompt.clientName} can be signed. It is pre-filled from this intake.
        </Alert>
      ) : null}
      <PageHeader
        title="Clinical Notes"
        description={`Your documentation queue: visits to document, drafts, signatures, co-signatures and corrections. ${NOTE_TYPES.length} note templates, from therapy and psychiatry to crisis, collateral, group and no-show notes.`}
        actions={
          <>
            {/* Demo Preview (local, unsaved "signing" of fictional records) removed: notes and plans are signed only through the server. */}
            {/* AI drafting is one workflow: AI Scribe (live capture, dictation, or paste / import), grounded with
                citations, then "Create draft note" opens the unsigned draft here for review and signature. */}
            <Link
              href={`/dashboard/scribe?mode=paste${presetClientId ? `&clientId=${encodeURIComponent(presetClientId)}` : ''}`}
              title="Draft with AI Scribe: every sentence cites the transcript or your summary; you review and sign here"
              className={buttonClasses({ variant: 'secondary' })}
            >
              <Bot className="h-4 w-4" aria-hidden /> AI Draft Note
            </Link>
            <Button icon={<Plus />} onClick={() => openEditor()}>
              New Note
            </Button>
          </>
        }
      />

      {notesError && !preview ? <Alert tone="danger">{notesError}</Alert> : null}

      {/* My notes queue: tabs, filters, counts, pagination (GET /api/notes/worklist) */}
      <NotesWorklist
        clients={clients.map((c) => ({ id: c.id, name: c.name }))}
        initialClientId={filterClientId || undefined}
        initialTab={presetTab}
        refreshKey={worklistKey}
        onOpenNote={(row, mode) => void openNoteFromWorklist(row, mode)}
        onStartVisit={startNoteFromWorklist}
        onNotesChanged={() => void loadNotes()}
      />
      {!preview ? <NotePolicyCard /> : null}

      {showNewNote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            className={`max-h-[90vh] w-full ${
              sidePanelVisible ? (structuredType ? 'max-w-[96rem]' : 'max-w-6xl') : structuredType ? 'max-w-6xl' : 'max-w-3xl'
            } overflow-y-auto rounded-xl bg-white shadow-clinic-md`}
            onKeyDown={(e) => {
              // Ctrl+S / Cmd+S: save the draft now without closing. Structured / therapy editors bind
              // their own Ctrl+S (window listener): handling it here too saved twice per keypress.
              if (!structuredType && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                e.preventDefault();
                structuredDirtyRef.current = true;
                void quietSaveRef.current();
              }
            }}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{editingNoteId ? 'Edit Draft Note' : 'New Progress Note'}</h2>
                <p className="text-xs text-slate-500">
                  {editingNoteId ? 'Only drafts can be edited. Signed notes are corrected with an addendum.' : 'Saved notes appear in the client record and EHR feed.'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* AI Scribe docked in this editor (one click to record; the draft fills the sections in place) */}
                {noteClientId && !preview && canScribe && !scribeOpen ? (
                  <button
                    type="button"
                    onClick={() => setScribeOpen(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-200 px-3 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50"
                    title="Record, upload or dictate this visit; AI Scribe drafts the note sections here for your review"
                  >
                    <Bot size={13} aria-hidden />
                    AI Scribe
                  </button>
                ) : null}
                {guideVisible ? (
                  <button
                    type="button"
                    onClick={() => setGuideDrawerOpen(true)}
                    aria-expanded={guideDrawerOpen}
                    aria-controls="visit-guide-drawer"
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-600/40 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 lg:hidden"
                  >
                    <ClipboardList size={13} aria-hidden />
                    Visit guide{guideRemaining != null ? ` (${guideRemaining} left)` : ''}
                  </button>
                ) : null}
                {/* Chart history (AI digest of prior chart documents): side tab, loaded only when opened */}
                {chartTabAvailable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSideTab('history');
                      setGuideDrawerOpen(true);
                    }}
                    aria-expanded={guideDrawerOpen && activeSideTab === 'history'}
                    aria-controls="visit-guide-drawer"
                    className="inline-flex items-center gap-1 rounded-lg border border-blue-600/40 px-3 py-1.5 text-xs font-bold text-blue-600 hover:bg-blue-50 lg:hidden"
                  >
                    <History size={13} aria-hidden />
                    Chart history
                  </button>
                ) : null}
                {chartTabAvailable && !guideVisible ? (
                  <button
                    type="button"
                    onClick={() => setHistoryPanelOpen((v) => !v)}
                    aria-pressed={historyPanelOpen}
                    title="Cited history from prior chart documents, beside the note"
                    className={`hidden items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold lg:inline-flex ${
                      historyPanelOpen ? 'bg-blue-600 text-white' : 'border border-blue-600/40 text-blue-600 hover:bg-blue-50'
                    }`}
                  >
                    <History size={13} aria-hidden />
                    Chart history
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => setPhrasesOpen((v) => !v)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                    phrasesOpen
                      ? 'bg-blue-600 text-white'
                      : 'border border-blue-600/40 text-blue-600 hover:bg-blue-50'
                  }`}
                >
                  Phrases
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  className="text-xl font-bold text-slate-500 hover:text-slate-600"
                  aria-label="Close"
                ><X size={18} aria-hidden /></button>
              </div>
            </div>
            <div className={sidePanelVisible ? 'lg:flex lg:items-start' : undefined}>
            <div className="min-w-0 flex-1 space-y-4 p-6">
              {/* Completed measures since the last note: one line into the template's assessment / measures section (never the top) */}
              {noteClientId && !preview ? (
                <MeasuresNarrativeOffer
                  clientId={noteClientId}
                  noteType={noteType}
                  noteId={editingNoteId}
                  headings={headingsFor(noteType)}
                  onInsert={(section, text) => {
                    if (asStructuredNoteType(noteType)) pmmRef.current?.insertText(section, text);
                    else setSectionTexts((prev) => ({ ...prev, [section]: appendNarrative(prev[section], text) }));
                    structuredDirtyRef.current = true;
                  }}
                />
              ) : null}
              {editorError && (
                <Alert tone="danger">
                  {editorError}
                </Alert>
              )}
              {scribeOpen && noteClientId && !preview ? (
                <ScribeDock
                  clientId={noteClientId}
                  clientName={clients.find((c) => c.id === noteClientId)?.name || 'the client'}
                  appointmentId={guideCtx?.clientId === noteClientId ? guideCtx.appointmentId : null}
                  noteType={noteType}
                  noteId={editingNoteId || createdNoteIdRef.current}
                  telehealth={telehealth}
                  onFill={applyScribeFill}
                  onInsertSuggestion={insertScribeSuggestion}
                  onClose={() => setScribeOpen(false)}
                  captureId={scribeCaptureId}
                />
              ) : null}
              <AiReviewBar
                texts={sectionTexts}
                order={headingsFor(noteType)}
                onAccept={(h) => acceptAiSections([h])}
                onAcceptAll={acceptAiSections}
                onGoTo={focusNoteSection}
              />
              {riskSignNoteId && riskSignNoteId === editingNoteId ? (
                <RiskAttestationField id="editor-risk-attestation" value={riskAttestation} onChange={setRiskAttestation} />
              ) : null}
              {lateSignNoteId && lateSignNoteId === editingNoteId ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <label htmlFor="editor-late-reason" className="font-semibold">
                    Late-entry reason (at least 10 characters; printed with the note)
                  </label>
                  <textarea
                    id="editor-late-reason"
                    rows={2}
                    maxLength={500}
                    value={editorLateReason}
                    onChange={(e) => setEditorLateReason(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-amber-200 bg-white p-2 text-sm text-slate-800 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    placeholder="e.g. Session ran into the end of day; documented the next morning."
                  />
                  <p className="mt-1">Then use Save &amp; Sign again.</p>
                </div>
              ) : null}
              {aiDrafted && (
                <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                  <Bot size={15} className="mt-0.5 shrink-0" />
                  <span>
                    This note includes an AI draft. Review every section, correct anything inaccurate, then Accept each AI section (editing a section also accepts it). Signing is blocked until every AI section is accepted.
                  </span>
                </div>
              )}
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Client *</label>
                <select
                  value={noteClientId}
                  aria-label="Note client"
                  onChange={(event) => {
                    setNoteClientId(event.target.value);
                    // Chart data in a structured note belongs to one patient: start over for a different one
                    if (structuredType && !editingNoteId) {
                      setSectionTexts(sectionsToRecord(structuredType, noteTemplate(structuredType)));
                      setPmmKey((k) => k + 1);
                      structuredDirtyRef.current = false;
                    }
                  }}
                  disabled={(clientsLoading && !preview) || Boolean(editingNoteId)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-60"
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
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-amber-700" />
                    <div>
                      <strong className="font-semibold">Safety Plan Review Due:</strong> This client has had a high-severity risk alert within the last 30 days. Please review and update the Crisis Safety Plan during this encounter.
                    </div>
                  </div>
                )}
              </div>
              {editorAppointmentId && !preview ? (
                <VisitTypeControl
                  key={editorAppointmentId}
                  appointmentId={editorAppointmentId}
                  openSignal={visitTypeOpenTick}
                  onChanged={onVisitTypeChanged}
                />
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">Note Type *
                  <select
                    aria-label="Note Type"
                    value={noteType}
                    onChange={(event) => requestNoteTypeChange(event.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  >
                    {noteTypeOptions.map((type) => (
                      <option key={type} value={type}>
                        {isKnownNoteType(type) ? NOTE_LABELS[type] : type}
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
              {noteType === 'EMDR' ? (
                <label className="block text-xs font-semibold text-slate-600">
                  EMDR Phase
                  <select
                    aria-label="EMDR Phase"
                    value={emdrPhase}
                    onChange={(e) => {
                      const phase = e.target.value as (typeof EMDR_PHASES)[number];
                      setEmdrPhase(phase);
                      setSection('Phase', phase);
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
              {!structuredType ? (<>
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
                    <option value="">— No CPT code —</option>
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
                    className="accent-blue-600"
                  />
                  Telehealth ({telehealth && serviceDetail.telehealthModality === 'audio_only' ? 'audio-only: payer audio-only modifier' : 'modifier 95'} · POS {telehealth ? telehealthPos : '10 or 02'})
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
              </>) : null}
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={sudConfidential}
                  onChange={(event) => setSudConfidential(event.target.checked)}
                  className="accent-blue-600"
                />
                Substance Use Disorder (SUD) / Chemical Dependency record
              </label>
              {isSudNote(noteType, sudConfidential) && <Part2Notice />}

              {!preview ? (
                <>
                  <NoteServiceDetails
                    value={serviceDetail}
                    onChange={changeServiceDetail}
                    context={serviceContext}
                    telehealth={telehealth}
                    showTimes={!structuredType}
                  />
                  {serviceDetailError ? <p className="text-xs text-rose-600">{serviceDetailError}</p> : null}
                  {normalizeNoteType(noteType) === 'PRP' && noteClientId ? (
                    <>
                      <PrpNoteFields
                        value={prpDetail}
                        onChange={changePrpDetail}
                        context={prpContext}
                        contactType={contactTypeFromNote(telehealth, serviceDetail.telehealthModality)}
                        onContactType={changePrpContactType}
                        clientId={noteClientId}
                        dateOfService={noteDos || todayIso()}
                      />
                      {prpError ? <p className="text-xs text-rose-600">{prpError}</p> : null}
                    </>
                  ) : null}
                </>
              ) : null}

              {!structuredType && copyForwardOffer?.found && copyForwardOffer.displayBody ? (
                <div
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm"
                >
                  <p className="font-semibold text-sky-900">
                    Previous {copyForwardOffer.noteType ? normalizeNoteType(copyForwardOffer.noteType) : 'progress'} note —{' '}
                    {copyForwardOffer.createdAt
                      ? new Date(copyForwardOffer.createdAt).toLocaleDateString()
                      : 'prior visit'}
                  </p>
                  <p className="mt-0.5 text-xs text-sky-900">
                    Copy content forward as a starting point. Each copied section is marked &quot;review&quot; and blocks signing until you
                    update it for today and remove the marker. Addenda, psychotherapy notes and (unless this is a Part 2 note) SUD notes are never copied.
                  </p>
                  <button
                    type="button"
                    className={buttonClasses({ variant: 'primary', size: 'sm', className: 'mt-2' })}
                    onClick={() => {
                      const body = copyForwardOffer.displayBody || '';
                      const priorDate = (copyForwardOffer.createdAt || new Date().toISOString()).slice(0, 10);
                      const copied = sectionsToRecord(noteType, body);
                      // Free-text sections carry the pending carry-forward marker; picklist fields copy as is
                      for (const [heading, text] of Object.entries(copied)) {
                        if (text.trim() && !NOTE_FIELD_INPUTS[heading]) copied[heading] = broughtForwardBlock(priorDate, text);
                      }
                      setSectionTexts(copied);
                      structuredDirtyRef.current = true;
                      setCopyForwardOffer(null);
                    }}
                  >
                    Copy Forward
                  </button>
                </div>
              ) : null}

              {phrasesOpen ? (
                <div
                  className="rounded-lg border border-blue-200 bg-blue-50 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold text-blue-600">Smart Phrases</p>
                    <input
                      value={phraseSearch}
                      onChange={(e) => setPhraseSearch(e.target.value)}
                      placeholder="Search phrases…"
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs outline-none focus:border-blue-600"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-blue-700">
                    Inserting into:{' '}
                    <strong>{activePhraseField || 'select a field'}</strong>…
                  </p>
                  <div className="mt-2 max-h-48 space-y-3 overflow-y-auto">
                    {phraseGroups.length === 0 ? (
                      <p className="text-[11px] text-slate-500">No phrases match.</p>
                    ) : null}
                    {phraseGroups.map(([cat, items]) => (
                      <div key={cat}>
                        <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-blue-600">
                          {cat}
                        </p>
                        <div className="space-y-1">
                          {items.map((p) => (
                            <button
                              key={p.key}
                              type="button"
                              onClick={() => applyPhrase(p.text)}
                              className="block w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left hover:border-blue-600/40"
                            >
                              <span className="font-mono text-[11px] font-bold text-blue-600">
                                {p.key}
                              </span>
                              <span className="ml-2 text-[11px] font-semibold text-slate-700">
                                {p.label}
                              </span>
                              <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                                {p.text.slice(0, 120)}
                                {p.text.length > 120 ? '…' : ''}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-blue-600">
                    Click any field to set the insertion target, then click a phrase to append it. You can also type a phrase key (e.g. .mse) followed by Space in any field. Fill every [___] blank before signing.
                  </p>
                </div>
              ) : null}

              {plannedPrimary && !preview ? (
                <p className="text-xs text-slate-600">
                  {codesPrefilled && billingCode === plannedPrimary
                    ? `Service code ${plannedPrimary}${plannedAddOn ? ` + ${plannedAddOn}` : ''} prefilled from the appointment's planned codes. Change it if the visit was different; the signed note's code is what bills.`
                    : scheduledCodeHint(billingCode, plannedPrimary)
                      ? `${scheduledCodeHint(billingCode, plannedPrimary)} at booking. The code you sign is what bills.`
                      : null}
                </p>
              ) : null}

              {structuredType && isTherapyTemplate(structuredType) ? (
                <TherapyNoteEditor
                  key={pmmKey}
                  ref={pmmRef}
                  noteType={structuredType}
                  clientId={noteClientId}
                  editingNoteId={editingNoteId}
                  fromDraft={pmmFromDraft}
                  preview={preview}
                  initialTexts={sectionTexts}
                  onTextsChange={setSectionTexts}
                  onFieldFocus={setActivePhraseField}
                  onUserEdit={markStructuredEdit}
                  onAiDrafted={() => setAiDrafted(true)}
                  dateOfService={noteDos}
                  durationMinutes={noteDuration}
                  onDurationChange={setNoteDuration}
                  cptCode={billingCode}
                  onCptCodeChange={setBillingCode}
                  telehealth={telehealth}
                  onTelehealthChange={setTelehealth}
                  placeOfService={telehealthPos}
                  onPlaceOfServiceChange={setTelehealthPos}
                  saving={noteSaving}
                  saveStatus={
                    preview
                      ? 'Demo Preview: not autosaved'
                      : autosave.saving
                        ? 'Saving…'
                        : autosave.error
                          ? `Autosave failed: ${autosave.error}`
                          : autosave.at
                            ? `Draft saved ${autosave.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                            : 'Autosaves as you work'
                  }
                  onSaveDraft={() => void quietSaveRef.current()}
                  onSaveAndSign={handleSaveAndSign}
                  onSwitchNoteType={(type) => requestNoteTypeChange(type)}
                  visitPreset={visitPreset}
                  audioOnly={telehealth && serviceDetail.telehealthModality === 'audio_only'}
                  appointmentTimes={visitPreset && serviceContext?.appointment ? { start: serviceContext.appointment.startTime, end: serviceContext.appointment.endTime } : null}
                  patientLocationState={serviceDetail.patientLocationState}
                  scribeLines={scribeLines}
                />
              ) : structuredType ? (
                <StructuredNoteEditor
                  key={pmmKey}
                  ref={pmmRef}
                  noteType={structuredType}
                  clientId={noteClientId}
                  editingNoteId={editingNoteId}
                  fromDraft={pmmFromDraft}
                  preview={preview}
                  initialTexts={sectionTexts}
                  onTextsChange={setSectionTexts}
                  onFieldFocus={setActivePhraseField}
                  onUserEdit={markStructuredEdit}
                  onAiDrafted={() => setAiDrafted(true)}
                  dateOfService={noteDos}
                  durationMinutes={noteDuration}
                  onDurationChange={setNoteDuration}
                  cptCode={billingCode}
                  onCptCodeChange={setBillingCode}
                  telehealth={telehealth}
                  onTelehealthChange={setTelehealth}
                  placeOfService={telehealthPos}
                  onPlaceOfServiceChange={setTelehealthPos}
                  saving={noteSaving}
                  saveStatus={
                    preview
                      ? 'Demo Preview: not autosaved'
                      : autosave.saving
                        ? 'Saving…'
                        : autosave.error
                          ? `Autosave failed: ${autosave.error}`
                          : autosave.at
                            ? `Draft saved ${autosave.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
                            : 'Autosaves as you work'
                  }
                  onSaveDraft={() => void quietSaveRef.current()}
                  onSaveAndSign={handleSaveAndSign}
                  onSwitchNoteType={(type) => requestNoteTypeChange(type, { toReEval: true })}
                  onAddOnChange={(code, minutes) => {
                    addOnRef.current = { code, minutes };
                  }}
                  plannedAddOnCode={codesPrefilled ? plannedAddOn : null}
                  visitPreset={visitPreset}
                  audioOnly={telehealth && serviceDetail.telehealthModality === 'audio_only'}
                  patientLocationState={serviceDetail.patientLocationState}
                  scribeLines={scribeLines}
                />
              ) : (
              <div className="space-y-3">
                {headingsFor(noteType).map((heading) => {
                  const field = NOTE_FIELD_INPUTS[heading];
                  const value = sectionTexts[heading] || '';
                  if (heading === IDENTIFYING_INFO_HEADING) {
                    return (
                      <div key={heading} className="rounded-xl border border-slate-200 p-3">
                        <p className="mb-2 text-xs font-semibold text-slate-600">{heading}</p>
                        <IdentifyingInfoEditor
                          key={`${editingNoteId || 'new'}-${noteClientId}-${pmmKey}`}
                          noteType={noteType}
                          clientId={noteClientId}
                          editingNoteId={editingNoteId}
                          preview={preview}
                          initialText={value}
                          dateOfService={noteDos}
                          visit={{ known: visitPreset || Boolean(editingNoteId), telehealth, audioOnly: telehealth && serviceDetail.telehealthModality === 'audio_only', patientLocationState: serviceDetail.patientLocationState }}
                          onTextChange={(t) => setSectionTexts((prev) => (prev[heading] === t ? prev : { ...prev, [heading]: t }))}
                          onUserEdit={markStructuredEdit}
                          scribeLines={scribeLines}
                        />
                      </div>
                    );
                  }
                  return (
                    <div key={heading}>
                      <label className="mb-1 block text-xs font-semibold text-slate-600" htmlFor={`note-field-${heading}`}>
                        {heading}
                      </label>
                      {field?.kind === 'select' ? (
                        <select
                          id={`note-field-${heading}`}
                          value={value}
                          onChange={(e) => setSection(heading, e.target.value)}
                          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        >
                          <option value="">— Select —</option>
                          {value && !field.options.includes(value) ? <option value={value}>{value}</option> : null}
                          {field.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field?.kind === 'input' ? (
                        <input
                          id={`note-field-${heading}`}
                          value={value}
                          onChange={(e) => setSection(heading, e.target.value.replace(/\n/g, ' '))}
                          placeholder={sectionPlaceholder(noteType as NoteType, heading)}
                          className="w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        />
                      ) : (
                        <SmartPhraseTextarea
                          id={`note-field-${heading}`}
                          ref={(el) => {
                            sectionRefs.current[heading] = el;
                          }}
                          value={value}
                          onFocus={() => setActivePhraseField(heading)}
                          onChange={(v) => setSection(heading, v)}
                          rows={heading === FREE_TEXT_SECTION ? 10 : heading.toLowerCase() === 'assessment' ? 5 : 3}
                          placeholder={sectionPlaceholder(noteType as NoteType, heading)}
                          className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        />
                      )}
                    </div>
                  );
                })}
                {Object.keys(sectionTexts).filter(isCarriedOverHeading).map((heading) => (
                  <div key={heading} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                    <label className="mb-1 block text-xs font-semibold text-amber-900" htmlFor={`note-field-${heading}`}>
                      {heading}
                    </label>
                    <p className="mb-1 text-[11px] text-amber-800">
                      Text from sections the new note type doesn&apos;t have. Move what belongs into the sections above and delete the rest; it is saved with the note as written.
                    </p>
                    <SmartPhraseTextarea
                      id={`note-field-${heading}`}
                      value={sectionTexts[heading] || ''}
                      onFocus={() => setActivePhraseField(heading)}
                      onChange={(v) => setSection(heading, v)}
                      rows={4}
                      className="w-full resize-y rounded-xl border border-amber-200 bg-white p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                    />
                  </div>
                ))}
                {findUnfilledBlanks(noteBody) > 0 ? (
                  <p className="text-xs font-medium text-amber-700">
                    {findUnfilledBlanks(noteBody)} unfilled [___] blank{findUnfilledBlanks(noteBody) === 1 ? '' : 's'} — you can save the draft, but fill them before signing.
                  </p>
                ) : null}
                {countAiDraftMarkers(noteBody) > 0 ? (
                  <p className="text-xs font-medium text-blue-700">
                    {countAiDraftMarkers(noteBody)} section{countAiDraftMarkers(noteBody) === 1 ? ' still carries' : 's still carry'} an AI DRAFT marker — review and Accept each AI section (above) before signing.
                  </p>
                ) : null}
              </div>
              )}

              {(noteType === 'SOAP' || noteType === 'DAP') &&
              (comprehend.loading ||
                (comprehend.icd10 && comprehend.icd10.length > 0) ||
                (comprehend.medications && comprehend.medications.length > 0) ||
                comprehend.error ||
                extractComprehendText(noteType, noteBody).length >= 30) ? (
                <div
                  className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900"
                >
                  <button
                    type="button"
                    className="flex w-full flex-wrap items-center gap-2 text-left"
                    onClick={() => setComprehendOpen((v) => !v)}
                  >
                    <span className="font-semibold text-sky-900">
                      Comprehend Medical
                    </span>
                    {comprehend.loading ? (
                      <span className="text-sky-700">Analyzing…</span>
                    ) : (
                      <span
                        className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-sky-800 ring-1 ring-inset ring-sky-200"
                      >
                        {comprehend.icd10?.length || 0} ICD-10 · {comprehend.medications?.length || 0}{' '}
                        Meds
                      </span>
                    )}
                    {comprehend.demoMode ? (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                        Demo mode
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
                          <p className="mb-1 font-bold text-sky-800">ICD-10-CM Suggestions</p>
                          <ul className="space-y-1.5">
                            {comprehend.icd10.slice(0, 8).map((x) => {
                              const added = addedIcd.has(x.code);
                              const pct = Math.round((x.score || 0) * 100);
                              return (
                                <li
                                  key={x.code}
                                  className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5"
                                >
                                  <span className="font-mono font-bold text-sky-900">{x.code}</span>
                                  <span className="flex-1 text-sky-800">{x.description}</span>
                                  <span className="tabular-nums text-sky-700">{pct}%</span>
                                  <button
                                    type="button"
                                    className="rounded border border-sky-200 px-1.5 py-0.5 text-[11px] font-semibold text-sky-700"
                                    onClick={() => void navigator.clipboard?.writeText(x.code)}
                                  >
                                    Copy
                                  </button>
                                  <button
                                    type="button"
                                    disabled={added}
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white disabled:opacity-70 ${added ? 'bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                    onClick={() => {
                                      setAddedIcd((prev) => new Set(prev).add(x.code));
                                      const planKey =
                                        headingsFor(noteType).find((h) =>
                                          /plan/i.test(h)
                                        ) || headingsFor(noteType)[headingsFor(noteType).length - 1];
                                      setSectionTexts((prev) => {
                                        const cur = prev[planKey] || '';
                                        const line = `${x.code} — ${x.description}`;
                                        const nextVal = cur.includes(x.code)
                                          ? cur
                                          : cur.trim()
                                            ? `${cur.trim()}\n${line}`
                                            : line;
                                        return { ...prev, [planKey]: nextVal };
                                      });
                                    }}
                                  >
                                    {added ? <><Check size={12} aria-hidden /> Added</> : '+ Add'}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      {Array.isArray(comprehend.medications) && comprehend.medications.length > 0 ? (
                        <div>
                          <p className="mb-1 font-bold text-sky-800">Medications Detected</p>
                          <ul className="space-y-1.5">
                            {comprehend.medications.slice(0, 8).map((x) => {
                              const id = x.code || x.description;
                              const added = addedMeds.has(id);
                              return (
                                <li
                                  key={id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg bg-white/80 px-2 py-1.5"
                                >
                                  <span className="flex-1 font-medium text-sky-900">
                                    {x.description || x.code}
                                  </span>
                                  <button
                                    type="button"
                                    disabled={added}
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold text-white ${added ? 'bg-emerald-700' : 'bg-blue-600 hover:bg-blue-700'}`}
                                    onClick={() => setAddedMeds((prev) => new Set(prev).add(id))}
                                  >
                                    {added ? <><Check size={12} aria-hidden /> Added</> : '+Rx'}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ) : null}
                      <p className="text-[11px] text-sky-700">
                        Powered by Amazon Comprehend Medical — review before adding to chart
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {guideVisible ? <VisitGuideSignWarnings controller={guideCtrl} noteSections={sectionTexts} /> : null}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleSaveNote}
                  disabled={!noteClientId || !noteDos || !hasNoteContent(noteType, noteBody) || noteSaving}
                  className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
                >
                  {noteSaving ? 'Saving…' : editingNoteId ? 'Save Draft Changes' : 'Save as Draft'}
                </button>
                <button
                  type="button"
                  onClick={closeEditor}
                  title="Close the editor. Edits are kept as a draft."
                  className={buttonClasses({ variant: 'secondary' })}
                >
                  Close
                </button>
                {editingNoteId && !preview ? (
                  <button
                    type="button"
                    onClick={() => setDismissTarget({ id: editingNoteId, clientName: clients.find((c) => c.id === noteClientId)?.name ?? null, from: 'editor' })}
                    title="Not needed (created in error, duplicate, visit didn't happen): kept read-only for the record, undo within 30 days"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                  >
                    <Trash2 size={14} aria-hidden /> Dismiss note
                  </button>
                ) : null}
              </div>
              <p className="text-right text-[11px] text-slate-500" aria-live="polite">{saveStatusText}</p>
            </div>
            {sidePanelVisible ? (
              <aside className="hidden w-[22rem] shrink-0 py-4 pr-4 lg:sticky lg:top-[73px] lg:block lg:max-h-[calc(90vh-80px)] lg:overflow-y-auto">
                <SessionSideTabs
                  tabs={sessionSideTabs(false)}
                  active={activeSideTab}
                  onChange={(id) => setSideTab(id === 'history' ? 'history' : id === 'medical' ? 'medical' : 'guide')}
                  onClose={!guideVisible ? () => setHistoryPanelOpen(false) : undefined}
                />
              </aside>
            ) : null}
            </div>
          </div>
          {sideDrawerVisible && guideDrawerOpen ? (
            <div className="fixed inset-0 z-[60] flex justify-end bg-black/30 lg:hidden" role="presentation" onClick={() => setGuideDrawerOpen(false)}>
              <div
                id="visit-guide-drawer"
                role="dialog"
                aria-modal="true"
                aria-label={activeSideTab === 'history' ? 'Chart history' : activeSideTab === 'medical' ? 'Medical history' : 'Visit guide'}
                className="h-full w-full max-w-md overflow-y-auto bg-white p-3 shadow-xs"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setGuideDrawerOpen(false);
                }}
              >
                <div className="mb-2 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setGuideDrawerOpen(false)}
                    className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Close
                  </button>
                </div>
                <SessionSideTabs
                  tabs={sessionSideTabs(true)}
                  active={activeSideTab}
                  onChange={(id) => setSideTab(id === 'history' ? 'history' : id === 'medical' ? 'medical' : 'guide')}
                />
              </div>
            </div>
          ) : null}
        </div>
      )}

      {showNoteDetail && (() => {
        const note = showNoteDetail;
        const dismissed = Boolean(note.dismissedAt);
        const status = getNoteStatus(note);
        // Unsigned and live: can be signed, edited or dismissed (a dismissed note is read-only)
        const draft = status === 'Draft' && !dismissed;
        const blocker = draft ? signBlocker(note) : null;
        const typeLabel = inferNoteType(note);
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-clinic-md">
            <div className="sticky top-0 flex items-center justify-between border-b border-slate-200/80 bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <ClientAvatar name={note.clientName} image={note.clientImage ?? null} />
                <div>
                  <h2 className="text-lg font-semibold text-slate-900">{note.clientName} - Progress Note</h2>
                  <p className="text-xs text-slate-500">
                    {note.dateOfService ? `Date of service ${note.dateOfService} · ` : ''}Documented {formatNoteDate(note.createdAt)} - {note.clinicianName || note.clinicianEmail || 'Clinical staff'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowNoteDetail(null)}
                className="text-xl font-bold text-slate-500 hover:text-slate-600"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${dismissed ? 'border-slate-300 bg-slate-100 text-slate-700' : STATUS_STYLES[status]}`}>
                  {dismissed ? 'Dismissed' : status}
                </span>
                <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${TYPE_COLORS[typeLabel] || 'bg-slate-100 text-slate-600'}`}>
                  {noteTypeBadge(typeLabel)}
                </span>
                {note.aiDrafted && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                    <Bot size={13} /> AI-assisted draft
                  </span>
                )}
                {note.planPendingUntil ? <PlanPendingChip until={note.planPendingUntil} size="md" /> : null}
                {highRiskClientIds.has(note.clientId) && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    <ShieldAlert size={13} className="text-amber-700" />
                    Safety Plan Review Due
                  </span>
                )}
              </div>

              {dismissed ? (
                <Alert
                  tone="warning"
                  title="Dismissed: not part of the documentation queue"
                  actions={
                    note.canUndoDismiss ? (
                      <Button size="sm" variant="secondary" icon={<Undo2 />} disabled={undoingDismiss} onClick={() => void undoDismissFromDetail(note)}>
                        Undo dismiss
                      </Button>
                    ) : undefined
                  }
                >
                  Dismissed {note.dismissedAt?.slice(0, 10)}{note.dismissedByName ? ` by ${note.dismissedByName}` : ''}{note.dismissReason ? `. Reason: ${note.dismissReason}` : ''}. Read-only; kept for the record.
                </Alert>
              ) : null}

              {/* Links (chart, appointment, claim, plan, print), timeliness / late entry, required
                  elements, cloned-note check, return for correction, psychotherapy notes, amendments */}
              {!preview ? (
                <NoteStandardPanel
                  key={`${note.id}-${(note.addenda || []).length}-${status}`}
                  noteId={note.id}
                  onBlockers={setStandardBlockers}
                  onLateReason={setLateRule}
                  onChanged={() => void loadNotes()}
                  onAddAddendum={() => setShowAddendum(true)}
                />
              ) : null}

              {isSudNote(typeLabel, note.part2 ?? note.sudConfidential) && <Part2Notice />}
              {!preview && <RiskWatchBanner kind="note" noteId={note.id} />}
              <div className="flex flex-wrap gap-2 text-xs text-slate-600">
                {(note.cptCode || note.billingCode) && <span className="rounded-full bg-blue-50 px-3 py-1">CPT / HCPCS {note.cptCode || note.billingCode}</span>}
                {scheduledCodeHint(note.cptCode || note.billingCode, note.scheduledCode) && (note.cptCode || note.billingCode) ? (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800" title="Planned at booking; the signed note's code is what bills">
                    {scheduledCodeHint(note.cptCode || note.billingCode, note.scheduledCode)}
                  </span>
                ) : null}
                {note.durationMinutes != null && <span className="rounded-full bg-slate-100 px-3 py-1">{note.durationMinutes} min</span>}
                {note.telehealth && <span className="rounded-full bg-blue-50 px-3 py-1">Telehealth · {(note as { audioOnly?: boolean }).audioOnly ? 'Audio-only (payer audio-only modifier)' : 'Modifier 95'} · POS {note.placeOfService || '10'}</span>}
              </div>
              {structuredNoteSections(typeLabel, note.body).map((section, index) => <section key={`${section.title}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="mb-2 text-xs font-bold uppercase text-blue-600">{section.title}</h3><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{section.text || 'Not documented'}</p></section>)}

              {(note.addenda?.length ?? 0) > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase text-slate-500">Addenda</h3>
                  {note.addenda!.map((addendum) => (
                    <div key={addendum.id} className="rounded-xl border border-blue-200 bg-blue-50/50 p-3">
                      <p className="text-[11px] font-semibold text-blue-600">
                        {addendum.reason} · {addendum.authorName || 'Clinical staff'} · {formatNoteDate(addendum.createdAt)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{addendum.text}</p>
                    </div>
                  ))}
                </div>
              )}

              {draft && !preview ? (
                <PlanGateNotice clientId={note.clientId} noteType={typeLabel} cptCode={note.cptCode || note.billingCode || null} />
              ) : null}
              {detailError && (
                <Alert tone="danger">
                  {detailError}
                </Alert>
              )}

              {(status === 'Signed' || status === 'Locked') && (
                <div>
                  {!showAddendum ? (
                    <button
                      type="button"
                      onClick={() => setShowAddendum(true)}
                      className="text-sm font-semibold text-blue-600 hover:underline"
                    >
                      + Add Addendum
                    </button>
                  ) : (
                    <div className="space-y-2 border-t border-slate-200 pt-4">
                      <p className="text-sm font-bold text-slate-700">Addendum</p>
                      <p className="text-xs text-slate-500">
                        The signed note is not changed. The addendum is saved separately with your name and the time.
                      </p>
                      <label className="block text-xs font-semibold text-slate-600">
                        Reason for Addendum *
                        <select
                          value={addendumReason}
                          onChange={(e) => setAddendumReason(e.target.value)}
                          className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                        >
                          <option value="">Select reason…</option>
                          {ADDENDUM_REASONS.map((reason) => (
                            <option key={reason} value={reason}>
                              {reason}
                            </option>
                          ))}
                        </select>
                      </label>
                      <SmartPhraseTextarea
                        value={addendumText}
                        onChange={setAddendumText}
                        aria-label="Addendum text"
                        placeholder="Enter addendum text…"
                        rows={3}
                        maxLength={8000}
                        className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
                      />
                      <div className="flex gap-2">
                        <button
                          type="button"
                          disabled={!addendumReason || !addendumText.trim() || addendumSaving}
                          onClick={() => void handleSaveAddendum(note)}
                          className={buttonClasses({ variant: 'primary' })}
                        >
                          {addendumSaving ? 'Saving…' : 'Save Addendum'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowAddendum(false)}
                          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Pre-sign checklist for the author (and the supervisor's returned checklist on signed notes) */}
              {!preview && <NoteQualityPanel key={note.id} noteId={note.id} mode="presign" />}
              {draft && detailGuideParams ? (
                <VisitGuideSignWarnings controller={detailGuideCtrl} noteSections={sectionsToRecord(typeLabel, note.body)} />
              ) : null}

              {draft && blocker && (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>{blocker}</span>
                </div>
              )}

              {draft && (
                <label className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={attestationChecked}
                    onChange={(e) => setAttestationChecked(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                  />
                  <span>
                    <strong className="font-semibold text-slate-900">Clinical Attestation:</strong> I have reviewed, verified, and assume full clinical responsibility for this note per CARF &amp; OMHC documentation standards.
                  </span>
                </label>
              )}

              {draft && riskSignNoteId === note.id ? <RiskAttestationField id="detail-risk-attestation" value={riskAttestation} onChange={setRiskAttestation} /> : null}

              {draft && lateRule.required ? (
                <label className="block rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900">
                  <span className="font-semibold">Late entry — reason required</span>
                  <span className="mt-0.5 block text-amber-800">
                    This note is past the practice sign deadline. It will be labeled a late entry; the reason is printed with the label.
                  </span>
                  <textarea
                    value={lateReason}
                    onChange={(e) => setLateReason(e.target.value)}
                    maxLength={500}
                    rows={2}
                    placeholder="e.g. Clinician out sick Oct 21–23; documented from session notes on return."
                    className="mt-2 w-full rounded-lg border border-amber-200 bg-white p-2 text-sm text-slate-800"
                  />
                  <span className="mt-0.5 block text-[11px] text-amber-800">
                    {lateReason.trim().length < lateRule.minChars ? `At least ${lateRule.minChars} characters.` : `${lateReason.trim().length} / 500`}
                  </span>
                </label>
              ) : null}

              <div className="flex gap-2 pt-2">
                {draft && (
                  <>
                    <button
                      type="button"
                      disabled={!attestationChecked || Boolean(blocker) || signing || (lateRule.required && lateReason.trim().length < lateRule.minChars)}
                      onClick={() => { void handleSign(note); }}
                      className={buttonClasses({ variant: 'primary' })}
                    >
                      {signing ? 'Signing…' : 'Sign Note'}
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowNoteDetail(null); openEditor({ note }); }}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      <PenLine size={14} /> Edit
                    </button>
                    {!preview ? (
                      <button
                        type="button"
                        onClick={() => setDismissTarget({ id: note.id, clientName: note.clientName || null, from: 'detail' })}
                        title="Not needed (created in error, duplicate, visit didn't happen): kept read-only for the record, undo within 30 days"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50"
                      >
                        <Trash2 size={14} aria-hidden /> Dismiss note
                      </button>
                    ) : null}
                  </>
                )}
                {status === 'Signed' && (
                  <button
                    type="button"
                    onClick={() => { void handleLock(note); }}
                    className={buttonClasses({ variant: 'primary' })}
                  >
                    Lock Note
                  </button>
                )}
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
        );
      })()}

      {pendingType ? (
        <ConfirmDialog
          title="Change note type"
          confirmLabel="Change type"
          onCancel={() => setPendingType(null)}
          onConfirm={() => {
            changeNoteType(pendingType.type, { toReEval: pendingType.toReEval });
            setPendingType(null);
          }}
        >
          {typeChangeConfirmText(noteType, pendingType.type)}
        </ConfirmDialog>
      ) : null}
      {pendingVisitNoteType ? (
        <ConfirmDialog
          title="Switch the note template too?"
          confirmLabel="Switch template"
          cancelLabel="Keep this note type"
          onCancel={() => setPendingVisitNoteType(null)}
          onConfirm={() => {
            changeNoteType(pendingVisitNoteType);
            setPendingVisitNoteType(null);
          }}
        >
          The visit type changed. {typeChangeConfirmText(noteType, pendingVisitNoteType)}
        </ConfirmDialog>
      ) : null}
      {dismissTarget ? (
        <DismissNoteDialog
          noteId={dismissTarget.id}
          clientName={dismissTarget.clientName}
          onCancel={() => setDismissTarget(null)}
          onDismissed={() => {
            const from = dismissTarget.from;
            setDismissTarget(null);
            void afterDismiss(from);
          }}
        />
      ) : null}
    </Page>
  );
}
