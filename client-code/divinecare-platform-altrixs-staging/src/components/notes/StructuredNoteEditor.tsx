'use client';

/**
 * Structured note editor for the template-based note types:
 *  - Psychiatric Med Management (Valant template 21774)
 *  - Child Psychiatry Intake (Valant template 18772, initial evaluation)
 *  - Child Psychiatry Re-Eval (Valant template 46444; stored key 'Child Psych Intake')
 *  - Adult Psychiatry Intake (Valant template 18771)
 *  - Adult Psychiatry Re-Eval (Valant template 22019)
 *
 * Owns the structured inputs for each section and reports the rendered section
 * texts to the Progress Notes page, which saves them as an ordinary note body
 * (one heading per section), so the note prints, reads in the chart and copies
 * forward like any other note.
 *
 * No fabrication: chart data is pre-filled only from the read-only note-context
 * endpoint, always labeled with its source and removable; prior-note text comes
 * in only on the clinician's click, marked "(from <date> — review)"; nothing
 * clinical is pre-selected.
 */

import Link from 'next/link';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  AlertTriangle,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FlaskConical,
  History,
  Mic,
  MicOff,
  Phone,
  Pill,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { canPrescribe } from '@/types/roles';
import { SmartPhraseTextarea } from '@/components/notes/SmartPhraseTextarea';
import { EMPTY_MSE_VALUE, MentalStatusExamWidget, type MseValue } from '@/components/clinical/MentalStatusExamWidget';
import { DiagnosisAutocomplete, type SelectedDiagnosis } from '@/components/clinical/DiagnosisAutocomplete';
import { requestGroundedSectionDraft } from '@/components/scribe/sectionDraftClient';
import { NOTE_LABELS, noteTypeBadge, sectionPlaceholder, type NoteType } from '@/lib/ehr/noteTemplates';
import type { StructuredNoteContext } from '@/lib/ehr/structuredNoteContext';
import {
  TEMPLATE_CONFIG,
  bringForwardAll,
  broughtForwardBlock,
  countPendingCarryForward,
  markReviewedNoChanges,
  stripCarryMarkers,
  structuredSignBlockers,
  type StructuredNoteType,
} from '@/lib/ehr/structuredNotes';
import { CHILD_PSYCH_INITIAL_INTAKE, CPI, addOnAllowed } from '@/lib/ehr/childPsychIntake';
import { ADULT_PSYCH_INTAKE } from '@/lib/ehr/adultPsychIntake';
import {
  ADULT_PSYCH_REEVAL,
  APR,
  priorEvalReference,
  renderIntervalChanges,
  renderMeasuresSinceEval,
  summarizeMeasuresSinceEval,
  type IntervalChanges,
} from '@/lib/ehr/adultPsychReEval';
import {
  EMPTY_SAFETY_PLAN,
  MED_ACTIONS,
  PMM,
  PSYCH_LABS,
  PSYCH_MED_MGMT,
  RETURN_INTERVALS,
  SAFETY_PLAN_FIELDS,
  SIDE_EFFECTS,
  SIDE_EFFECT_RATINGS,
  SI_QUESTIONS,
  controlledChanges,
  formatApptTime,
  isControlledSubstance,
  isoDate,
  joinBlocks,
  medLine,
  parseChartDiagnoses,
  renderDiagnoses,
  renderHeader,
  addOnTimeIssue,
  psychotherapyMinutesFromHeader,
  renderLabs,
  renderLabsOrdered,
  renderMeasures,
  renderMedChanges,
  renderMedsAllergies,
  renderMse,
  renderNextAppointment,
  renderSafetyPlan,
  renderSideEffects,
  renderSiScreen,
  safetyPlanDocumented,
  siScreenStatus,
  summarizeMeasures,
  type MedAction,
  type MedChangeRow,
  type PmmDiagnosis,
  type SafetyPlanFields,
  type SiAnswers,
  type SideEffectState,
  type VisitType,
} from '@/lib/ehr/psychMedMgmt';
import { useChildIntake } from '@/components/notes/childIntakeSections';
import { IdentifyingInfoEditor } from '@/components/notes/IdentifyingInfoEditor';
import { IDENTIFYING_INFO_HEADING, identifyingInfoIssues, type ScribeLine } from '@/lib/ehr/identifyingInfo';
import { ChoiceChips, SourceTag, inputCls, pillBtn, smallBtn } from '@/components/notes/structuredNoteUi';
import { useDictation } from '@/components/notes/useDictation';
import { NO_MED_CHANGES_LABEL, NO_MED_CHANGES_TEXT, applyNoMedChanges, hasNoMedChanges, stripNoMedChanges } from '@/lib/ehr/noMedChanges';

const PURPLE = '#5C2D91';
/** Interval-change chips shown in the warning tone */
const WARN_CHOICES = new Set([
  'Worsened',
  'Yes',
  'Increased',
  'New use',
  'Stopped / not taking',
  'Side effects',
  'New concern',
  'Suspension / expulsion',
  'Not attending',
  'New conflict / stressor',
  'Change in custody / placement',
]);

export type StructuredNoteEditorHandle = {
  /** Append text (e.g. a smart phrase) to a section's clinician text. */
  insertText: (heading: string, text: string) => void;
};

type Props = {
  noteType: StructuredNoteType;
  clientId: string;
  /** Saved draft being edited (excluded from prior-note lookups) */
  editingNoteId: string | null;
  /** True when the editor opened on a saved draft: chart blocks start unchecked to avoid duplicating saved text */
  fromDraft: boolean;
  preview: boolean;
  /** Section texts at open (saved draft body split by heading, or blank template) */
  initialTexts: Record<string, string>;
  onTextsChange: (texts: Record<string, string>) => void;
  onFieldFocus?: (heading: string) => void;
  /** Called on any clinician input (drives autosave) */
  onUserEdit?: () => void;
  /** An AI draft was inserted (sets the note's aiDrafted flag) */
  onAiDrafted?: () => void;
  dateOfService: string;
  durationMinutes: string;
  onDurationChange: (value: string) => void;
  cptCode: string;
  onCptCodeChange: (value: string) => void;
  telehealth: boolean;
  onTelehealthChange: (value: boolean) => void;
  placeOfService: string;
  onPlaceOfServiceChange: (value: string) => void;
  saving: boolean;
  /** e.g. "Draft saved 2:41 PM" */
  saveStatus?: string | null;
  onSaveDraft: () => void;
  onSaveAndSign: () => Promise<void>;
  /** Switch the open note to another structured template (e.g. initial intake -> re-eval); text carries over by heading */
  onSwitchNoteType?: (type: StructuredNoteType) => void;
  /** Psychotherapy add-on and its minutes changed: saved as the note's addOnCptCode / psychotherapyMinutes (the claim's second line) */
  onAddOnChange?: (addOnCode: string, psychotherapyMinutes: number | null) => void;
  /** Add-on planned at booking (appointment planned codes); preselected once when the note has none. Time is still documented here. */
  plannedAddOnCode?: string | null;
  /** Started from a scheduled visit: in person / telehealth is already known from the appointment */
  visitPreset?: boolean;
  /** Service details say audio-only: the header names the payer audio-only modifier, not 95 */
  audioOnly?: boolean;
  /** Telehealth: the patient's state from the appointment / service details (Identifying Information) */
  patientLocationState?: string | null;
  /** AI Scribe transcript lines drafted into this note (Identifying Information suggestions only) */
  scribeLines?: ScribeLine[] | null;
};

type SectionStatus = 'done' | 'required' | 'empty';
type Issue = { message: string; heading: string | null };

const sectionDomId = (heading: string) => `sn-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

function addOnFromHeader(text: string): string {
  const m = text.match(/Psychotherapy add-on:\s*\+?(\d{5})/);
  return m ? m[1] : '';
}

function locationFromHeader(text: string): string {
  const m = text.match(/^Location:\s*(.+)$/m);
  const v = m ? m[1].trim() : '';
  return v === 'None on file' ? '' : v;
}

/** Sections whose content comes from the header/meta rather than free text */
const HEADER = 'Header';
/** Identifying Information: its own editor renders the whole section text */
const IDENT = IDENTIFYING_INFO_HEADING;

export const StructuredNoteEditor = forwardRef<StructuredNoteEditorHandle, Props>(function StructuredNoteEditor(props, ref) {
  const {
    noteType,
    clientId,
    editingNoteId,
    fromDraft,
    preview,
    initialTexts,
    onTextsChange,
    onFieldFocus,
    onUserEdit,
    onAiDrafted,
    dateOfService,
    durationMinutes,
    onDurationChange,
    cptCode,
    onCptCodeChange,
    telehealth,
    onTelehealthChange,
    placeOfService,
    onPlaceOfServiceChange,
    saving,
    saveStatus,
    onSaveDraft,
    onSaveAndSign,
    onSwitchNoteType,
    onAddOnChange,
    plannedAddOnCode,
    visitPreset,
    audioOnly,
    patientLocationState,
    scribeLines,
  } = props;
  const config = TEMPLATE_CONFIG[noteType];
  const sections = config.sections;
  /** Child or adult psychiatry intake (shared intake sections; adult variant changes wording / fields) */
  const isChild = noteType !== PSYCH_MED_MGMT;
  /** Adult or child re-evaluation (prior-evaluation reference, interval prompts, "Bring forward all") */
  const reEvalCfg = config.reEval;
  const isReEval = Boolean(reEvalCfg);
  const isAdult = noteType === ADULT_PSYCH_INTAKE || noteType === ADULT_PSYCH_REEVAL;
  const population = isAdult ? 'adult' : 'child';
  const priorEvalWhat =
    population === 'adult'
      ? 'adult psychiatric evaluation (Adult Psychiatry Intake, Adult Psychiatry Re-Eval, Psych Eval or Intake)'
      : 'child psychiatric evaluation (Child Psychiatry Intake, Child Psychiatry Re-Eval, Psych Eval or Intake)';
  const { user } = useAuth();
  const roleStr = String(user?.role || '');
  // Patient-context DrFirst launch: prescribers only (src/lib/drfirst/ssoPolicy.ts)
  const isPrescriber = canPrescribe(roleStr);

  // ── Chart context ────────────────────────────────────────────────────────
  const [ctx, setCtx] = useState<StructuredNoteContext | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  /** First saved id: refetching after autosave would only change prior-note exclusion */
  const contextNoteId = useRef(editingNoteId);

  useEffect(() => {
    if (!clientId || preview) {
      setCtx(null);
      setCtxError(preview ? 'Chart data is not loaded in Demo Preview.' : null);
      return;
    }
    let cancelled = false;
    setCtxLoading(true);
    setCtxError(null);
    const exclude = contextNoteId.current;
    const qs = `?noteType=${encodeURIComponent(noteType)}${exclude ? `&excludeNoteId=${encodeURIComponent(exclude)}` : ''}`;
    apiJson<{ success: true; context: StructuredNoteContext }>(`/api/clients/${encodeURIComponent(clientId)}/note-context${qs}`)
      .then((res) => {
        if (!cancelled) setCtx(res.context);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCtxError(err instanceof Error ? err.message : 'Could not load chart data');
      })
      .finally(() => {
        if (!cancelled) setCtxLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, noteType, preview, reloadKey]);
  /** Most recent signed prior evaluation of this template's source types (re-evals; child intake hint) */
  const priorEvalSource = config.priorEvalSourceTypes ? ctx?.reEvalSource ?? null : null;
  /** Re-eval: the prior evaluation used as reference + "Bring forward" source */
  const reEvalSource = isReEval ? priorEvalSource : null;

  // ── Clinician free text per section ───────────────────────────────────────
  const savedHeader = initialTexts[HEADER] || '';
  const firstTextSection = isChild ? CPI.chiefComplaint : PMM.hpi;
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const h of sections) out[h] = h === HEADER || h === IDENT ? '' : (initialTexts[h] || '').trim();
    // "No medication changes" is the checkbox's sentence, not free text (restored as the checkbox below)
    if (out[PMM.medChanges] && hasNoMedChanges(out[PMM.medChanges])) out[PMM.medChanges] = stripNoMedChanges(out[PMM.medChanges]);
    // Text carried over from another note type lands in Header (regenerated): keep it.
    if (!fromDraft && savedHeader.trim()) out[firstTextSection] = joinBlocks(savedHeader, out[firstTextSection]);
    // Unknown headings from a saved body (e.g. a section added to the template later) are kept
    for (const [h, v] of Object.entries(initialTexts)) {
      if (!sections.includes(h) && v.trim()) out[firstTextSection] = joinBlocks(out[firstTextSection], `${h}\n${v.trim()}`);
    }
    return out;
  });
  const setComment = useCallback((heading: string, value: string) => {
    setComments((prev) => ({ ...prev, [heading]: value }));
  }, []);
  const [identText, setIdentText] = useState(() => (initialTexts[IDENT] || '').trim());
  const textRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [detached, setDetached] = useState<Set<string>>(() => new Set());

  useImperativeHandle(
    ref,
    () => ({
      insertText: (heading: string, text: string) => {
        const target = sections.includes(heading) && heading !== HEADER && heading !== IDENT ? heading : firstTextSection;
        setComments((prev) => {
          const cur = prev[target] || '';
          return { ...prev, [target]: cur.trim() ? `${cur.trim()} ${text}` : text };
        });
        onUserEdit?.();
        requestAnimationFrame(() => textRefs.current[target]?.focus());
      },
    }),
    [sections, firstTextSection, onUserEdit]
  );

  // ── Header ────────────────────────────────────────────────────────────────
  const [visitChosen, setVisitChosen] = useState(fromDraft || Boolean(visitPreset));
  const visitType: VisitType = visitChosen ? (telehealth ? 'telehealth' : 'in-person') : '';
  const [addOnCode, setAddOnCode] = useState(() => (fromDraft ? addOnFromHeader(savedHeader) : ''));
  const [psyMinutes, setPsyMinutes] = useState(() => (fromDraft ? psychotherapyMinutesFromHeader(savedHeader) : ''));
  useEffect(() => {
    onAddOnChange?.(addOnCode, addOnCode ? Number(psyMinutes) || null : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addOnCode, psyMinutes]);
  const [location, setLocation] = useState(() => (fromDraft ? locationFromHeader(savedHeader) : ''));
  const [locationSource, setLocationSource] = useState(fromDraft && location ? 'saved draft' : '');
  useEffect(() => {
    if (!ctx || location) return;
    if (ctx.patient.locationName) {
      setLocation(ctx.patient.locationName);
      setLocationSource("patient's chart location");
    } else if (ctx.provider.primaryLocationName) {
      setLocation(ctx.provider.primaryLocationName);
      setLocationSource('your primary location');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);
  useEffect(() => {
    if (addOnCode && cptCode && !addOnAllowed(cptCode)) setAddOnCode('');
  }, [cptCode, addOnCode]);
  // Planned add-on from the appointment: preselect once, only while no add-on is chosen and the code allows one
  const plannedAddOnApplied = useRef(false);
  useEffect(() => {
    if (plannedAddOnApplied.current || !plannedAddOnCode || addOnCode) return;
    if (!cptCode || !addOnAllowed(cptCode)) return;
    if (!config.addOnOptions.some((o) => o.code === plannedAddOnCode)) return;
    plannedAddOnApplied.current = true;
    setAddOnCode(plannedAddOnCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plannedAddOnCode, cptCode]);

  // ── Shared clinical state ─────────────────────────────────────────────────
  const [mse, setMse] = useState<MseValue>(EMPTY_MSE_VALUE);
  const measures = useMemo(() => summarizeMeasures(ctx?.measures.records || []), [ctx]);
  const [includeMeasures, setIncludeMeasures] = useState(!fromDraft);
  const measuresSinceEval = useMemo(
    () => (reEvalSource ? summarizeMeasuresSinceEval(ctx?.measures.records || [], reEvalSource.date) : []),
    [ctx, reEvalSource]
  );
  const [intervalChanges, setIntervalChanges] = useState<IntervalChanges>({});
  const [siAnswers, setSiAnswers] = useState<SiAnswers>({});
  const [siTimeframe, setSiTimeframe] = useState('since last visit');
  const [crisisReviewed, setCrisisReviewed] = useState(false);
  const siStatus = siScreenStatus(siAnswers);
  const [plan, setPlan] = useState<SafetyPlanFields>(EMPTY_SAFETY_PLAN);
  const [planNotIndicated, setPlanNotIndicated] = useState(false);
  const [planSource, setPlanSource] = useState('');
  const pullSafetyPlan = () => {
    const sp = ctx?.safetyPlan;
    if (!sp) return;
    setPlan({ ...sp.fields });
    setPlanNotIndicated(false);
    setPlanSource(
      `Source: patient's saved safety plan in Altrixs${sp.lastUpdated ? ` (last updated ${sp.lastUpdated})` : ''}${
        sp.matchedBy === 'name' ? ', matched by patient name' : ''
      }; reviewed and edited by clinician.`
    );
  };
  useEffect(() => {
    if (siStatus === 'positive') setPlanNotIndicated(false);
  }, [siStatus]);
  const safetyPlanBlock = useMemo(() => renderSafetyPlan({ fields: plan, notIndicated: false, sourceNote: planSource }), [plan, planSource]);

  const chartDx = useMemo<PmmDiagnosis[]>(
    () =>
      ctx
        ? parseChartDiagnoses({
            primaryCode: ctx.patient.primaryDiagnosisCode,
            primaryName: ctx.patient.primaryDiagnosis,
            secondary: ctx.patient.secondaryDiagnoses,
          })
        : [],
    [ctx]
  );
  const chartDxSelected = useCallback(
    (): SelectedDiagnosis[] => chartDx.map((d, i) => ({ code: d.code || `(uncoded ${i + 1})`, description: d.description, isPrimary: d.isPrimary, specifier: '' })),
    [chartDx]
  );
  const [dxList, setDxList] = useState<SelectedDiagnosis[] | null>(null);
  useEffect(() => {
    if (!ctx || dxList !== null || fromDraft) return;
    setDxList(chartDxSelected());
  }, [ctx, dxList, fromDraft, chartDxSelected]);
  const chartCodes = useMemo(() => new Set(chartDxSelected().map((d) => d.code)), [chartDxSelected]);

  const [includeMeds, setIncludeMeds] = useState(!fromDraft);
  const [reconciled, setReconciled] = useState(false);
  const [drFirstMsg, setDrFirstMsg] = useState<string | null>(null);
  const [sideEffects, setSideEffects] = useState<SideEffectState>({});
  const [sideOther, setSideOther] = useState('');
  const [noSideEffects, setNoSideEffects] = useState(false);
  const [excludedLabs, setExcludedLabs] = useState<Set<string>>(() => new Set());
  const [includeLabs, setIncludeLabs] = useState(!fromDraft);
  const [labsOrdered, setLabsOrdered] = useState<string[]>([]);
  const [labsOther, setLabsOther] = useState('');
  const [noLabsOrdered, setNoLabsOrdered] = useState(false);
  const [medRows, setMedRows] = useState<MedChangeRow[]>([]);
  const medRowsSeeded = useRef(false);
  useEffect(() => {
    if (!ctx || medRowsSeeded.current) return;
    medRowsSeeded.current = true;
    setMedRows(
      ctx.medications.map((m) => ({
        key: `med-${m.id}`,
        medId: m.id,
        name: m.name,
        currentDose: [m.dosage, m.route, m.frequency].filter(Boolean).join(' '),
        action: '',
        newDose: '',
        sig: '',
        reason: '',
        controlled: m.controlled,
      }))
    );
  }, [ctx]);
  const [pdmpReviewed, setPdmpReviewed] = useState(false);
  /** "No medication changes" (the prescriber ticks it; the AI never does): restored from a saved draft */
  const [noMedChanges, setNoMedChanges] = useState(() => fromDraft && hasNoMedChanges(initialTexts[PMM.medChanges]));
  const updateRow = (key: string, patch: Partial<MedChangeRow>) =>
    setMedRows((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (!r.medId && patch.name !== undefined) next.controlled = isControlledSubstance(next.name);
        return next;
      })
    );
  const addStartRow = () =>
    setMedRows((rows) => [
      ...rows,
      { key: `start-${Date.now().toString(36)}-${rows.length}`, medId: null, name: '', currentDose: '', action: 'Start', newDose: '', sig: '', reason: '', controlled: false },
    ]);
  const [returnWeeks, setReturnWeeks] = useState<number | null>(null);
  const [includeScheduled, setIncludeScheduled] = useState(!fromDraft);
  const [attested, setAttested] = useState(false);

  const child = useChildIntake({
    ctx,
    fromDraft,
    safetyPlanBlock,
    variant: isAdult ? 'adult' : 'child',
    savedHeader,
    reEval: isReEval ? { prior: reEvalSource ? { date: reEvalSource.date, noteType: reEvalSource.noteType } : null } : undefined,
    initialEval: noteType === CHILD_PSYCH_INITIAL_INTAKE,
  });

  // ── Generated blocks ──────────────────────────────────────────────────────
  const header = useMemo(() => {
    if (!ctx && fromDraft && savedHeader.trim()) return savedHeader.trim();
    return renderHeader({
      patientName: ctx?.patient.name ?? null,
      dateOfBirth: ctx?.patient.dateOfBirth ?? null,
      mrn: ctx?.patient.mrn ?? null,
      dateOfService,
      providerName: ctx?.provider.name ?? user?.name ?? null,
      providerRole: ctx?.provider.roleLabel ?? null,
      providerCredentials: ctx?.provider.credentials ?? [],
      providerNpi: ctx?.provider.npi ?? null,
      location,
      visitType,
      placeOfService: telehealth ? placeOfService : '11',
      durationMinutes: Number(durationMinutes) || null,
      emCode: cptCode,
      addOnCode,
      psychotherapyMinutes: Number(psyMinutes) || null,
      audioOnly: Boolean(audioOnly),
      codeLabel: config.codeLabel,
      extraLines: isChild ? child.headerLines : [],
    });
  }, [ctx, fromDraft, savedHeader, dateOfService, user?.name, location, visitType, telehealth, placeOfService, durationMinutes, cptCode, addOnCode, psyMinutes, audioOnly, config.codeLabel, isChild, child.headerLines]);

  const generated = useMemo<Record<string, string>>(() => {
    const dxRender: PmmDiagnosis[] = (dxList || []).map((d) => ({
      code: d.code.startsWith('(uncoded') ? '' : d.code,
      description: [d.description, d.specifier?.trim()].filter(Boolean).join(', '),
      isPrimary: d.isPrimary,
      fromChart: chartCodes.has(d.code),
    }));
    const labs = (ctx?.labs.results || []).filter((r) => !excludedLabs.has(r.id));
    const shared: Record<string, string> = {
      [PMM.exam]: renderMse(mse),
      [PMM.diagnoses]: dxList === null ? '' : renderDiagnoses(dxRender),
      [PMM.meds]:
        ctx && includeMeds
          ? renderMedsAllergies({ meds: ctx.medications, allergies: ctx.allergies, reconciled })
          : reconciled
            ? 'Medication list reviewed and reconciled with patient this visit.'
            : '',
      [PMM.medChanges]: noMedChanges ? NO_MED_CHANGES_TEXT : renderMedChanges({ rows: medRows, pdmpReviewed }),
      [PMM.nextAppt]: renderNextAppointment({ returnWeeks, next: ctx?.nextAppointment ?? null, includeScheduled: Boolean(ctx) && includeScheduled }),
    };
    const labsOrderedText = renderLabsOrdered({ selected: labsOrdered, other: labsOther, noneOrdered: noLabsOrdered });
    const measuresText =
      ctx && ctx.measures.available && includeMeasures
        ? reEvalSource
          ? renderMeasuresSinceEval(measuresSinceEval, reEvalSource.date)
          : renderMeasures(measures)
        : '';
    if (reEvalCfg) {
      const interval = renderIntervalChanges(reEvalSource?.date ?? null, intervalChanges, reEvalCfg.intervalDomains);
      // Child re-eval (46444) has no Measure Review section: the change since the prior evaluation goes in Interval History
      if (!isAdult) return { ...shared, ...child.generated, [CPI.interval]: joinBlocks(interval, measuresText) };
      return {
        ...shared,
        ...child.generated,
        [APR.interval]: interval,
        [APR.measures]: measuresText,
        [APR.labsOrdered]: labsOrderedText,
      };
    }
    if (isChild) return { ...shared, ...child.generated };
    return {
      ...shared,
      [PMM.measures]: measuresText,
      [PMM.si]: renderSiScreen({ answers: siAnswers, timeframe: siTimeframe, crisisResourcesReviewed: crisisReviewed }),
      [PMM.safetyPlan]: renderSafetyPlan({ fields: plan, notIndicated: planNotIndicated, sourceNote: planSource }),
      [PMM.sideEffects]: renderSideEffects({ state: sideEffects, otherLabel: sideOther, noneReported: noSideEffects }),
      [PMM.labs]: ctx && includeLabs ? renderLabs(labs, ctx.labs.available) : '',
      [PMM.labsOrdered]: labsOrderedText,
    };
  }, [
    ctx, mse, includeMeasures, measures, siAnswers, siTimeframe, crisisReviewed, plan, planNotIndicated, planSource,
    dxList, chartCodes, includeMeds, reconciled, sideEffects, sideOther, noSideEffects, includeLabs, excludedLabs,
    labsOrdered, labsOther, noLabsOrdered, medRows, pdmpReviewed, noMedChanges, returnWeeks, includeScheduled, isChild, child.generated,
    reEvalCfg, isAdult, reEvalSource, intervalChanges, measuresSinceEval,
  ]);

  const texts = useMemo(() => {
    const out: Record<string, string> = {};
    for (const h of sections) out[h] = h === HEADER ? header : h === IDENT ? identText : joinBlocks(detached.has(h) ? '' : generated[h], comments[h]);
    return out;
  }, [sections, header, identText, generated, comments, detached]);

  const onTextsChangeRef = useRef(onTextsChange);
  onTextsChangeRef.current = onTextsChange;
  useEffect(() => {
    onTextsChangeRef.current(texts);
  }, [texts]);

  const detach = (heading: string) => {
    const block = generated[heading] || '';
    setComments((prev) => ({ ...prev, [heading]: joinBlocks(block, prev[heading]) }));
    setDetached((prev) => new Set(prev).add(heading));
  };
  const relink = (heading: string) =>
    setDetached((prev) => {
      const next = new Set(prev);
      next.delete(heading);
      return next;
    });

  // ── Sign readiness ────────────────────────────────────────────────────────
  const body = useMemo(() => sections.map((h) => `${h}\n${texts[h] || ''}`).join('\n\n'), [sections, texts]);
  const blockers: Issue[] = useMemo(() => structuredSignBlockers({ noteType, body, cptCode }), [noteType, body, cptCode]);
  const warnings: Issue[] = useMemo(() => {
    const w: Issue[] = [];
    if (!visitChosen) w.push({ message: 'Visit type (in person / telehealth) not selected.', heading: HEADER });
    if (!Number(durationMinutes)) w.push({ message: 'Total time not entered.', heading: HEADER });
    const addOnIssue = addOnTimeIssue({ addOnCode, psychotherapyMinutes: Number(psyMinutes) || null, totalMinutes: Number(durationMinutes) || null });
    if (addOnIssue) w.push({ message: addOnIssue, heading: HEADER });
    const hpi = isChild ? CPI.hpi : PMM.hpi;
    if (!texts[hpi]?.trim()) w.push({ message: `${hpi} is empty.`, heading: hpi });
    if (!texts[PMM.exam]?.trim()) w.push({ message: 'Mental status exam not documented.', heading: PMM.exam });
    if (!isChild) {
      if (siStatus === 'not-started' && !texts[PMM.si]?.trim()) w.push({ message: 'Suicidal ideation screen not completed.', heading: PMM.si });
      if (siStatus === 'incomplete') w.push({ message: 'Suicidal ideation screen is incomplete.', heading: PMM.si });
    } else {
      w.push(...child.warnings);
    }
    if (isReEval && reEvalSource && !texts[APR.interval]?.trim()) {
      w.push({ message: `Interval history since the prior evaluation (${reEvalSource.date}) is empty.`, heading: APR.interval });
    }
    const noAction = noMedChanges ? 0 : medRows.filter((r) => r.medId && !r.action).length;
    if (noAction) {
      w.push({
        message: `${noAction} current medication${noAction === 1 ? ' has' : 's have'} no plan action (Continue / Increase / Decrease / Stop).`,
        heading: PMM.medChanges,
      });
    }
    if (controlledChanges(medRows).length && !pdmpReviewed) {
      w.push({ message: 'Controlled substance change: Maryland PDMP (CRISP) review not documented.', heading: PMM.medChanges });
    }
    for (const i of identifyingInfoIssues(noteType, body)) w.push({ message: i.message, heading: i.heading });
    if (ctxError && !preview) w.push({ message: `Chart data could not be loaded (${ctxError}).`, heading: null });
    return w;
  }, [noteType, body, visitChosen, durationMinutes, addOnCode, psyMinutes, texts, isChild, isReEval, reEvalSource, siStatus, child.warnings, medRows, pdmpReviewed, noMedChanges, ctxError, preview]);

  const blockerHeadings = useMemo(() => new Set(blockers.map((b) => b.heading)), [blockers]);
  const status = (heading: string): SectionStatus => {
    const filled = Boolean(texts[heading]?.trim());
    if (heading === HEADER) return cptCode && visitChosen ? 'done' : 'required';
    if (heading === 'Review') return blockers.length === 0 && attested ? 'done' : blockers.length ? 'required' : 'empty';
    if (blockerHeadings.has(heading)) return 'required';
    if (!isChild && heading === PMM.safetyPlan && siStatus === 'positive') return safetyPlanDocumented(texts[heading] || '') ? 'done' : 'required';
    return filled ? 'done' : 'empty';
  };

  // ── Navigation ────────────────────────────────────────────────────────────
  const [active, setActive] = useState<string>(HEADER);
  const [collapseDone, setCollapseDone] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const goTo = useCallback((heading: string) => {
    setActive(heading);
    setExpanded((prev) => new Set(prev).add(heading));
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionDomId(heading));
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    });
  }, []);
  const step = useCallback(
    (dir: 1 | -1) => {
      const idx = sections.indexOf(active);
      goTo(sections[Math.min(sections.length - 1, Math.max(0, idx + dir))]);
    },
    [sections, active, goTo]
  );
  const statusRef = useRef(status);
  statusRef.current = status;
  const nextIncomplete = () => {
    const idx = sections.indexOf(active);
    const order = [...sections.slice(idx + 1), ...sections.slice(0, idx + 1)];
    const next = order.find((h) => statusRef.current(h) === 'required') || order.find((h) => statusRef.current(h) !== 'done');
    if (next) goTo(next);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      step(e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  // Ctrl/Cmd+Enter = next section, Ctrl/Cmd+S = save draft (while the editor is open)
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        saveDraftRef.current();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        step(e.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [step]);

  // ── DrFirst (same flow as the client chart's E-Prescribe) ─────────────────
  const openDrFirst = async () => {
    setDrFirstMsg(null);
    const win = window.open('about:blank', '_blank');
    try {
      const res = await fetch(`/api/drfirst/sso?patient=${encodeURIComponent(clientId)}&screen=patient`);
      const data = (await res.json().catch(() => ({}))) as { url?: string; demo?: boolean; error?: string; patientSynced?: boolean };
      if (res.ok === false) {
        win?.close();
        setDrFirstMsg(data.error || `DrFirst could not be opened (HTTP ${res.status}).`);
        return;
      }
      if (data.url && !data.demo) {
        if (data.patientSynced === false) setDrFirstMsg('This client is not in DrFirst yet, so DrFirst opens on patient search.');
        if (win) win.location.href = data.url;
        else window.open(data.url, '_blank');
        return;
      }
      win?.close();
      setDrFirstMsg('DrFirst is not configured on this server. Use the Prescriptions page instead.');
    } catch (err) {
      win?.close();
      setDrFirstMsg(err instanceof Error ? `DrFirst could not be opened: ${err.message}` : 'DrFirst could not be opened.');
    }
  };
  const drFirstButton = (label: string) =>
    isPrescriber && !preview ? (
      <button type="button" onClick={() => void openDrFirst()} className={smallBtn}>
        <Pill size={13} /> {label} <ExternalLink size={11} />
      </button>
    ) : (
      <span className="text-[11px] text-slate-500">DrFirst opens for prescribers only.</span>
    );

  // ── AI help (HPI / interval history only) ─────────────────────────────────
  const [aiOpen, setAiOpen] = useState<string | null>(null);
  const [aiInput, setAiInput] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiConsent, setAiConsent] = useState<string | null>(null);
  const dictation = useDictation((text) => setAiInput((prev) => (prev ? `${prev}\n${text}` : text)), { clientId });
  const runAi = async (heading: string) => {
    const input = aiInput.trim();
    if (input.length < 10) {
      setAiError('Dictate or type at least a few bullet points first. Nothing was sent.');
      return;
    }
    setAiBusy(true);
    setAiError(null);
    try {
      // Grounded: every sentence cites a line of the dictation; unsupported sentences are withheld
      const res = await requestGroundedSectionDraft({ clientId, heading, noteLabel: noteType, scope: 'history', input });
      if (res.ok === false) {
        setAiError(res.error);
        return;
      }
      setAiConsent(res.notice);
      const drafted = res.text.trim();
      if (!drafted) {
        setAiError('None of the AI sentences were supported by your points, so nothing was inserted. Write the section yourself.');
        return;
      }
      setComment(heading, joinBlocks(comments[heading], drafted));
      onAiDrafted?.();
      onUserEdit?.();
      setAiInput('');
      // Keep the panel open when something was withheld or weak, so the clinician sees why
      if (!res.notice) setAiOpen(null);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI drafting failed. Write the section manually.');
    } finally {
      setAiBusy(false);
    }
  };
  const aiPanel = (heading: string) => {
    if (!config.aiSections.includes(heading) || preview) return null;
    if (aiOpen !== heading) {
      return (
        <button type="button" className={smallBtn} onClick={() => { setAiOpen(heading); setAiError(null); }}>
          <Bot size={13} /> Draft from dictation (AI)
        </button>
      );
    }
    return (
      <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
        <p className="text-[11px] text-blue-900">
          Dictate or type bullet points. AI drafts the narrative for this section only; every sentence must cite one of your points, and unsupported sentences are left out. The draft is inserted with the AI DRAFT marker, which you remove after reviewing. Not used for exam, risk or plan.
        </p>
        <textarea value={aiInput} onChange={(e) => setAiInput(e.target.value)} rows={4} placeholder="- sleeping 5 h, mood low since school started&#10;- taking sertraline daily, mild nausea first week" className={`${inputCls} resize-y`} />
        <div className="flex flex-wrap gap-2">
          <button type="button" className={smallBtn} onClick={() => (dictation.listening ? dictation.stop() : dictation.start())}>
            {dictation.listening ? <MicOff size={13} /> : <Mic size={13} />} {dictation.listening ? 'Stop dictation' : 'Dictate'}
          </button>
          <button type="button" disabled={aiBusy} className={`${smallBtn} border-blue-300 text-blue-800`} onClick={() => void runAi(heading)}>
            <Bot size={13} /> {aiBusy ? 'Drafting…' : 'Draft with AI'}
          </button>
          <button type="button" className={smallBtn} onClick={() => { dictation.stop(); setAiOpen(null); }}>
            Cancel
          </button>
        </div>
        {dictation.error ? <p className="text-[11px] text-amber-700">{dictation.error}</p> : null}
        {aiConsent ? <p className="text-[11px] text-amber-700">{aiConsent}</p> : null}
        {aiError ? <p className="text-[11px] text-rose-700">{aiError}</p> : null}
      </div>
    );
  };

  // ── Carry-forward ─────────────────────────────────────────────────────────
  const prior =
    config.carrySource === 'priorEvaluation'
      ? reEvalSource
        ? { date: reEvalSource.date, sections: reEvalSource.sections }
        : null
      : ctx?.priorSameType || null;
  const carryBar = (heading: string) => {
    if (!config.carryForward.includes(heading) || !prior) return null;
    const priorText = stripCarryMarkers(prior.sections[heading] || '');
    if (!priorText) return null;
    const pending = countPendingCarryForward(comments[heading] || '');
    return (
      <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/60 p-2.5 text-xs text-sky-900">
        <div className="flex flex-wrap items-center gap-2">
          <History size={13} />
          <span className="font-semibold">{isReEval ? 'Prior evaluation' : 'Prior note'} {prior.date}</span>
          <button
            type="button"
            className={smallBtn}
            disabled={(comments[heading] || '').includes(`(from ${prior.date}`)}
            onClick={() => setComment(heading, joinBlocks(comments[heading], broughtForwardBlock(prior.date, priorText)))}
          >
            Bring forward from {prior.date}
          </button>
          <button
            type="button"
            className={pillBtn(false, 'good')}
            onClick={() => setComment(heading, markReviewedNoChanges(comments[heading] || '', prior.date, priorText))}
          >
            Reviewed, no changes
          </button>
          {pending ? <span className="font-semibold text-amber-700">Needs review before signing</span> : null}
        </div>
        <details>
          <summary className="cursor-pointer text-[11px] font-semibold">Show prior text</summary>
          <pre className="mt-1 whitespace-pre-wrap font-sans text-[11px] text-slate-700">{priorText}</pre>
        </details>
      </div>
    );
  };

  // ── Re-eval: "Bring forward all history from <date>" (click only) ────────
  const [bringAllMsg, setBringAllMsg] = useState<string | null>(null);
  const bringAllHeadings = reEvalCfg?.bringForwardAll ?? [];
  const bringAllAvailable = reEvalSource
    ? bringAllHeadings.filter(
        (h) => stripCarryMarkers(reEvalSource.sections[h] || '') && !(comments[h] || '').includes(`(from ${reEvalSource.date} — `)
      )
    : [];
  const pendingReview = sections.filter((h) => countPendingCarryForward(comments[h] || '') > 0);
  const bringAll = () => {
    if (!reEvalSource) return;
    const r = bringForwardAll(comments, reEvalSource.date, reEvalSource.sections, bringAllHeadings);
    setComments(r.texts);
    onUserEdit?.();
    setBringAllMsg(
      [
        r.brought.length ? `Brought forward ${r.brought.length} section${r.brought.length === 1 ? '' : 's'}; each is marked for review.` : 'Nothing new to bring forward.',
        r.noPriorText.length ? `No text in the prior evaluation for: ${r.noPriorText.join(', ')}.` : '',
      ]
        .filter(Boolean)
        .join(' ')
    );
    if (r.brought.length) goTo(r.brought[0]);
  };
  const bringAllBanner =
    isReEval && ctx ? (
      reEvalSource ? (
        <div className="space-y-2 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900">
          <div className="flex flex-wrap items-center gap-2">
            <History size={14} />
            <span className="font-semibold">
              Prior evaluation {reEvalSource.date} · {noteTypeBadge(reEvalSource.noteType)} (signed)
            </span>
            <button type="button" className={`${smallBtn} border-sky-300 text-sky-800`} disabled={!bringAllAvailable.length} onClick={bringAll}>
              <History size={13} /> Bring forward all history from {reEvalSource.date}
            </button>
            {pendingReview.length ? (
              <button type="button" className={`${smallBtn} border-amber-300 text-amber-800`} onClick={() => goTo(pendingReview[0])}>
                Next to review ({pendingReview.length} section{pendingReview.length === 1 ? '' : 's'})
              </button>
            ) : null}
          </div>
          <p className="text-[11px]">
            Adds the prior text of the stable history sections (Inpatient / Outpatient, Psychiatric Med, Abuse, Past Medical, Allergies, Substance, Family,
            Developmental / Educational, Social, Legal, Violence, {population === 'child' ? 'Trauma / Stressors, ' : ''}Stressors), each marked &quot;(from {reEvalSource.date} — review)&quot;. Confirm each with
            &quot;Reviewed, no changes&quot; or edit it; signing stays blocked until every one is reviewed. Suicide / self-harm and pregnancy history are
            re-assessed (bring them forward one at a time if appropriate).
          </p>
          {bringAllMsg ? <p className="text-[11px] font-semibold">{bringAllMsg}</p> : null}
        </div>
      ) : (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          No prior signed {priorEvalWhat} on file, so nothing can be brought forward. Complete this note as an initial {population} evaluation.
        </p>
      )
    ) : !isReEval && config.reEvalAlternative && priorEvalSource ? (
      // Initial evaluation with a signed prior evaluation on file: suggest the re-eval template (nothing changes without a click)
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-3 text-xs text-sky-900">
        <History size={14} />
        <span>
          A prior evaluation exists from {priorEvalSource.date} ({noteTypeBadge(priorEvalSource.noteType)}, signed) — consider{' '}
          {NOTE_LABELS[config.reEvalAlternative as NoteType]}.
        </span>
        {onSwitchNoteType ? (
          <button type="button" className={`${smallBtn} border-sky-300 text-sky-800`} onClick={() => onSwitchNoteType(config.reEvalAlternative as StructuredNoteType)}>
            Switch to {NOTE_LABELS[config.reEvalAlternative as NoteType]}
          </button>
        ) : null}
      </div>
    ) : null;

  // ── Rendering helpers ─────────────────────────────────────────────────────
  const commentBox =(heading: string, rows = 3, label = 'Clinician text') => (
    <div>
      <label htmlFor={`sn-text-${sectionDomId(heading)}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <SmartPhraseTextarea
        id={`sn-text-${sectionDomId(heading)}`}
        ref={(el) => {
          textRefs.current[heading] = el;
        }}
        value={comments[heading] || ''}
        onFocus={() => {
          setActive(heading);
          onFieldFocus?.(heading);
        }}
        onChange={(v) => setComment(heading, v)}
        rows={rows}
        placeholder={sectionPlaceholder(noteType as NoteType, heading)}
        className={`${inputCls} resize-y`}
      />
    </div>
  );

  const generatedPreview = (heading: string) => {
    const block = generated[heading];
    if (detached.has(heading)) {
      return (
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
          Selections above are no longer linked to the note text; edit the text below.{' '}
          <button type="button" className="font-semibold text-[#5C2D91] hover:underline" onClick={() => relink(heading)}>
            Re-link selections
          </button>{' '}
          (adds a new generated block; remove any duplicate text).
        </p>
      );
    }
    if (!block) return null;
    return (
      <div className="rounded-lg border border-violet-100 bg-violet-50/50 p-3">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5C2D91]">Goes into the note</p>
          <button type="button" className={smallBtn} onClick={() => detach(heading)}>
            Edit as text
          </button>
        </div>
        <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700">{block}</pre>
      </div>
    );
  };

  const safetyPlanEditor = (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {ctx?.safetyPlan ? (
          <button type="button" className={smallBtn} onClick={pullSafetyPlan}>
            <RefreshCw size={12} /> Pull saved safety plan
          </button>
        ) : ctx ? (
          <span className="text-[11px] text-slate-500">No saved safety plan on file</span>
        ) : null}
        <Link href="/dashboard/ehr/safety-plan" target="_blank" className={smallBtn}>
          Open Safety Plans <ExternalLink size={11} />
        </Link>
      </div>
      {ctx?.safetyPlan?.matchedBy === 'name' ? (
        <p className="text-[11px] text-amber-700">The saved plan is matched by patient name only. Confirm it belongs to this patient before pulling it.</p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {SAFETY_PLAN_FIELDS.map((f) => (
          <label key={f.key} className="text-xs font-semibold text-slate-600">
            {f.label}
            <textarea
              rows={2}
              value={plan[f.key]}
              onChange={(e) => setPlan((p) => ({ ...p, [f.key]: e.target.value }))}
              className={`mt-1 ${inputCls} resize-y`}
              placeholder={f.key === 'professionals' ? 'e.g. treating clinician and clinic phone; 988 Suicide & Crisis Lifeline; nearest ER' : ''}
            />
          </label>
        ))}
      </div>
    </div>
  );

  const ctxNotice = ctxLoading ? (
    <p className="text-xs text-slate-500">Loading chart data…</p>
  ) : ctxError ? (
    <p className="text-xs text-amber-700">
      {ctxError}{' '}
      {!preview ? (
        <button type="button" className="font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </button>
      ) : null}
    </p>
  ) : null;

  const crisisBanner = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      <Phone size={13} />
      <span>
        <strong>988</strong> Suicide &amp; Crisis Lifeline (call or text 988, chat 988lifeline.org) · <strong>911</strong> for imminent danger · Crisis Text Line: text HOME to 741741
      </span>
    </div>
  );

  // ── Section bodies ────────────────────────────────────────────────────────
  const n = (heading: string) => sections.indexOf(heading) + 1;
  const lastVisit = ctx?.lastVisit;

  const headerBody = (
    <>
      <dl className="grid gap-x-6 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
        <div><dt className="inline font-semibold">Patient: </dt><dd className="inline">{ctx?.patient.name || 'Not loaded'}</dd></div>
        <div><dt className="inline font-semibold">DOB: </dt><dd className="inline">{ctx?.patient.dateOfBirth ? isoDate(ctx.patient.dateOfBirth) : 'None on file'}</dd></div>
        <div><dt className="inline font-semibold">MRN: </dt><dd className="inline">{ctx?.patient.mrn || 'None on file'}</dd></div>
        <div><dt className="inline font-semibold">Date of service: </dt><dd className="inline">{dateOfService || 'Not entered'}</dd></div>
        <div className="sm:col-span-2">
          <dt className="inline font-semibold">Provider: </dt>
          <dd className="inline">
            {[ctx?.provider.name || user?.name, ctx?.provider.roleLabel, ...(ctx?.provider.credentials || []), ctx?.provider.npi ? `NPI ${ctx.provider.npi}` : '']
              .filter(Boolean)
              .join(', ') || 'Not loaded'}
          </dd>
        </div>
      </dl>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600">
          Location {locationSource ? <span className="font-normal text-teal-700">(from {locationSource})</span> : null}
          <input value={location} onChange={(e) => { setLocation(e.target.value); setLocationSource(''); }} placeholder="Clinic location" className={`mt-1 ${inputCls}`} />
        </label>
        <div className="text-xs font-semibold text-slate-600">
          Visit type *
          <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-label="Visit type">
            <button type="button" aria-pressed={visitType === 'in-person'} className={pillBtn(visitType === 'in-person')} onClick={() => { setVisitChosen(true); onTelehealthChange(false); }}>
              In person
            </button>
            <button type="button" aria-pressed={visitType === 'telehealth'} className={pillBtn(visitType === 'telehealth')} onClick={() => { setVisitChosen(true); onTelehealthChange(true); }}>
              Telehealth
            </button>
            {visitType === 'telehealth' ? (
              <select aria-label="Telehealth place of service" value={placeOfService} onChange={(e) => onPlaceOfServiceChange(e.target.value)} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs">
                <option value="10">POS 10 — patient home</option>
                <option value="02">POS 02 — other than home</option>
              </select>
            ) : null}
          </div>
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Total time (min)
          <input type="number" inputMode="numeric" min={1} max={240} value={durationMinutes} onChange={(e) => onDurationChange(e.target.value)} placeholder="Minutes" className={`mt-1 ${inputCls}`} />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          {config.codeLabel} (CPT) *
          <select aria-label={config.codeLabel} value={cptCode} onChange={(e) => onCptCodeChange(e.target.value)} className={`mt-1 ${inputCls}`}>
            <option value="">— Choose —</option>
            {cptCode && !config.codeOptions.some((o) => o.code === cptCode) ? <option value={cptCode}>{cptCode}</option> : null}
            {config.codeOptions.map((o) => (
              <option key={o.code} value={o.code}>{o.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-slate-600 sm:col-span-2">
          Psychotherapy add-on (optional)
          <select aria-label="Psychotherapy add-on" value={addOnCode} disabled={Boolean(cptCode) && !addOnAllowed(cptCode)} onChange={(e) => setAddOnCode(e.target.value)} className={`mt-1 ${inputCls} disabled:opacity-50`}>
            <option value="">None</option>
            {config.addOnOptions.map((o) => (
              <option key={o.code} value={o.code}>{o.label}</option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] font-normal text-slate-500">
            E/M visits only. Billed as a second claim line from the psychotherapy minutes below (16–37 min +90833, 38–52 +90836, 53+ +90838).
          </span>
        </label>
        {addOnCode ? (
          <label className="text-xs font-semibold text-slate-600">
            Psychotherapy minutes *
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={240}
              value={psyMinutes}
              onChange={(e) => { setPsyMinutes(e.target.value); onUserEdit?.(); }}
              placeholder="Separate from E/M time"
              className={`mt-1 ${inputCls}`}
            />
          </label>
        ) : null}
      </div>
      {isChild ? child.headerUi : null}
    </>
  );

  const pmmHpiBody = (
    <>
      {lastVisit ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Last visit — {lastVisit.dateOfService || isoDate(lastVisit.createdAt)}
              {lastVisit.clinicianName ? ` · ${lastVisit.clinicianName}` : ''} · {lastVisit.noteType} ({lastVisit.status.toLowerCase()})
            </p>
            <button
              type="button"
              className={smallBtn}
              onClick={() =>
                setComment(
                  PMM.hpi,
                  joinBlocks(
                    comments[PMM.hpi],
                    `Last visit (${lastVisit.dateOfService || isoDate(lastVisit.createdAt)}) plan for reference:\n${joinBlocks(lastVisit.plan, lastVisit.medChanges) || 'None documented'}`
                  )
                )
              }
            >
              Insert as reference
            </button>
          </div>
          <p className="font-semibold">Plan</p>
          <p className="whitespace-pre-wrap">{lastVisit.plan || 'None documented'}</p>
          {lastVisit.noteType === PSYCH_MED_MGMT ? (
            <>
              <p className="mt-1 font-semibold">Med changes</p>
              <p className="whitespace-pre-wrap">{lastVisit.medChanges || 'None documented'}</p>
            </>
          ) : null}
        </div>
      ) : ctx ? (
        <p className="text-xs text-slate-500">No previous medication-management note on file.</p>
      ) : null}
      {aiPanel(PMM.hpi)}
      {commentBox(PMM.hpi, 5, 'Interval history')}
    </>
  );

  const priorEval = ctx?.priorEval;
  /** Read-only prior evaluation (diagnoses + plan); "Insert as reference" adds it to `target` on click only. */
  const priorEvalRef = (target: string) =>
    priorEval ? (
      <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold">Prior evaluation — {priorEval.date} · {noteTypeBadge(priorEval.noteType)}</p>
          <button
            type="button"
            className={smallBtn}
            onClick={() =>
              setComment(
                target,
                joinBlocks(comments[target], `Prior evaluation (${priorEval.date}) for reference:\nDiagnoses: ${priorEval.diagnoses || 'None documented'}\nPlan: ${priorEval.plan || 'None documented'}`)
              )
            }
          >
            Insert as reference
          </button>
        </div>
        <p className="font-semibold">Diagnoses</p>
        <p className="whitespace-pre-wrap">{priorEval.diagnoses || 'None documented'}</p>
        <p className="mt-1 font-semibold">Plan</p>
        <p className="whitespace-pre-wrap">{priorEval.plan || 'None documented'}</p>
      </div>
    ) : null;
  /** Adult / child intake have no interval-history section: the prior evaluation reference sits in HPI (only when one exists). */
  const intakeHpiBody = (
    <>
      {priorEvalRef(CPI.hpi)}
      {aiPanel(CPI.hpi)}
      {commentBox(CPI.hpi, 5, 'History of present illness')}
    </>
  );
  /** Rating-scale table (+ include checkbox). Re-evals compare with the score at the prior evaluation. */
  const measuresTable = (
    <>
      {ctx && !ctx.measures.available ? (
        <p className="text-xs text-slate-500">Rating scales are not available for your role.</p>
      ) : ctx ? (
        measures.length ? (
          <>
            {reEvalSource ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-500">
                      <th className="py-1.5 pr-3">Measure</th>
                      <th className="py-1.5 pr-3">Latest</th>
                      <th className="py-1.5 pr-3">Date</th>
                      <th className="py-1.5 pr-3">At prior eval ({reEvalSource.date})</th>
                      <th className="py-1.5">Change since eval</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measuresSinceEval.map((m) => (
                      <tr key={m.instrument} className="border-b border-slate-50">
                        <td className="py-1.5 pr-3 font-semibold text-slate-800">{m.instrument}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{m.latest.score ?? '—'}{m.latest.severity ? ` · ${m.latest.severity}` : ''}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{m.latest.date}</td>
                        <td className="py-1.5 pr-3 tabular-nums">{m.atEval ? `${m.atEval.score ?? '—'} (${m.atEval.date})` : 'None on or before'}</td>
                        <td className={`py-1.5 tabular-nums ${m.change != null && m.change > 0 ? 'text-rose-600' : m.change != null && m.change < 0 ? 'text-emerald-700' : ''}`}>
                          {m.change == null ? '—' : m.change > 0 ? `+${m.change}` : m.change}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-500">
                    <th className="py-1.5 pr-3">Measure</th>
                    <th className="py-1.5 pr-3">Latest</th>
                    <th className="py-1.5 pr-3">Date</th>
                    <th className="py-1.5 pr-3">Previous</th>
                    <th className="py-1.5">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {measures.map((m) => (
                    <tr key={m.instrument} className="border-b border-slate-50">
                      <td className="py-1.5 pr-3 font-semibold text-slate-800">{m.instrument}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{m.latest.score ?? '—'}{m.latest.severity ? ` · ${m.latest.severity}` : ''}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{m.latest.date}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{m.previous ? `${m.previous.score ?? '—'} (${m.previous.date})` : '—'}</td>
                      <td className={`py-1.5 tabular-nums ${m.change != null && m.change > 0 ? 'text-rose-600' : m.change != null && m.change < 0 ? 'text-emerald-700' : ''}`}>
                        {m.change == null ? '—' : m.change > 0 ? `+${m.change}` : m.change}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            <label className="flex items-center gap-2 text-xs text-slate-700">
              <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeMeasures} onChange={(e) => setIncludeMeasures(e.target.checked)} />
              Include this summary in the note
            </label>
          </>
        ) : (
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeMeasures} onChange={(e) => setIncludeMeasures(e.target.checked)} />
            No rating scales on file — write &quot;Rating scales: None on file&quot; in the note
          </label>
        )
      ) : null}
      <Link href="/dashboard/ehr/assessments" target="_blank" className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:underline">
        Administer a measure <ExternalLink size={11} />
      </Link>
    </>
  );
  /** Re-eval: prior evaluation read-only (diagnoses, plan, med changes) + "what changed since <date>" chips. */
  const reEvalIntervalBody = (
    <>
      {reEvalSource ? (
        <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-xs text-teal-900">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              Prior evaluation — {reEvalSource.date} · {noteTypeBadge(reEvalSource.noteType)} (signed, read-only)
            </p>
            <button
              type="button"
              className={smallBtn}
              onClick={() => setComment(APR.interval, joinBlocks(comments[APR.interval], priorEvalReference(reEvalSource)))}
            >
              Insert as reference
            </button>
          </div>
          <p className="font-semibold">Diagnoses</p>
          <p className="whitespace-pre-wrap">{reEvalSource.diagnoses || 'None documented'}</p>
          <p className="mt-1 font-semibold">Plan</p>
          <p className="whitespace-pre-wrap">{reEvalSource.plan || 'None documented'}</p>
          <p className="mt-1 font-semibold">Med changes</p>
          <p className="whitespace-pre-wrap">{reEvalSource.medChanges || 'None documented'}</p>
        </div>
      ) : ctx ? (
        <p className="text-xs text-slate-500">No prior signed {priorEvalWhat} on file. Document the presenting history in HPI as for an initial evaluation.</p>
      ) : null}
      <div className="space-y-1.5 rounded-lg border border-slate-200 p-3">
        <p className="text-xs font-semibold text-slate-700">{reEvalSource ? `What changed since ${reEvalSource.date}` : 'Interval changes'}</p>
        {(reEvalCfg?.intervalDomains ?? []).map((d) => {
          const a = intervalChanges[d.key] || { choice: '', details: '' };
          const set = (patch: Partial<typeof a>) => setIntervalChanges((prev) => ({ ...prev, [d.key]: { ...a, ...patch } }));
          return (
            <div key={d.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <span className="w-48 shrink-0 text-xs font-semibold text-slate-700">{d.label}</span>
              <ChoiceChips<string>
                options={d.options}
                value={a.choice}
                onChange={(v) => set({ choice: v })}
                ariaLabel={d.label}
                tone={(o) => (WARN_CHOICES.has(o) ? 'warn' : 'brand')}
              />
              <input
                value={a.details}
                onChange={(e) => set({ details: e.target.value })}
                placeholder="Details"
                aria-label={`${d.label} details`}
                className="min-h-[36px] min-w-0 flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
              />
            </div>
          );
        })}
      </div>
      {!isAdult ? measuresTable : null}
      {generatedPreview(APR.interval)}
      {aiPanel(APR.interval)}
      {commentBox(APR.interval, 4, 'Interval history since prior evaluation')}
    </>
  );

  const examBody = (
    <>
      <p className="text-[11px] text-slate-500">Nothing is pre-selected. Only the findings you choose are written into the note.</p>
      <MentalStatusExamWidget value={mse} onChange={setMse} allowUnset />
      {generatedPreview(PMM.exam)}
      {commentBox(PMM.exam, 2, 'Additional exam text')}
    </>
  );

  const measuresBody = (
    <>
      {measuresTable}
      {generatedPreview(PMM.measures)}
      {commentBox(PMM.measures, 2, 'Comment')}
    </>
  );

  const siBody = (
    <>
      {crisisBanner}
      <label className="block text-xs font-semibold text-slate-600">
        Screening timeframe
        <select value={siTimeframe} onChange={(e) => setSiTimeframe(e.target.value)} className={`mt-1 ${inputCls} sm:max-w-xs`}>
          <option value="since last visit">Since last visit</option>
          <option value="past month">Past month</option>
          <option value="lifetime and past month">Lifetime and past month</option>
        </select>
      </label>
      <ol className="space-y-1.5">
        {SI_QUESTIONS.map((q, i) => {
          const a = siAnswers[q.id] || '';
          return (
            <li key={q.id} className="flex flex-col gap-1.5 rounded-lg border border-slate-100 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-slate-700">
                <strong className="text-slate-900">{i + 1}. {q.label}</strong> — {q.question}
              </span>
              <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={q.label}>
                {(['yes', 'no'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={a === v}
                    onClick={() => setSiAnswers((prev) => ({ ...prev, [q.id]: prev[q.id] === v ? '' : v }))}
                    className={pillBtn(a === v, v === 'yes' ? 'bad' : 'good')}
                  >
                    {v === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallBtn} onClick={() => setSiAnswers((prev) => Object.fromEntries(SI_QUESTIONS.map((q) => [q.id, prev[q.id] || 'no'])))}>
          Mark unanswered items No
        </button>
        <button type="button" className={smallBtn} onClick={() => setSiAnswers({})}>
          Clear screen
        </button>
      </div>
      {siStatus === 'positive' ? (
        <div className="flex items-start gap-2 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs font-medium text-rose-800">
          <ShieldAlert size={15} className="mt-0.5 shrink-0" />
          <span>Positive screen. Complete the Suicide Prevention Plan (section 7) before signing, follow the clinic crisis protocol, and review 988 / crisis resources with the patient.</span>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={crisisReviewed} onChange={(e) => setCrisisReviewed(e.target.checked)} />
        I reviewed 988 and crisis resources with the patient
      </label>
      {generatedPreview(PMM.si)}
      {commentBox(PMM.si, 2, 'Risk assessment detail')}
    </>
  );

  const safetyPlanBody = (
    <>
      {siStatus === 'positive' ? (
        <p className="text-xs font-semibold text-rose-700">Required: the suicidal ideation screen is positive.</p>
      ) : (
        <button type="button" aria-pressed={planNotIndicated} className={pillBtn(planNotIndicated, 'good')} onClick={() => setPlanNotIndicated(!planNotIndicated)}>
          Reviewed, not indicated (screen not positive)
        </button>
      )}
      {safetyPlanEditor}
      {generatedPreview(PMM.safetyPlan)}
      {commentBox(PMM.safetyPlan, 2, 'Additional plan text')}
    </>
  );

  const diagnosesBody = (
    <>
      {dxList === null ? (
        <button type="button" className={smallBtn} disabled={!ctx} onClick={() => setDxList(chartDxSelected())}>
          Load chart diagnoses
        </button>
      ) : (
        <>
          {dxList.length === 0 ? <p className="text-xs text-slate-500">No diagnoses on the chart. Search to add.</p> : null}
          <DiagnosisAutocomplete value={dxList} onChange={(v) => setDxList(v.map((d) => ({ ...d })))} clientId={preview ? null : clientId} />
          <p className="text-[11px] text-slate-500">
            Diagnoses marked [on chart] come from the client record; changes here are documented in this note only (update the chart in the client record).
          </p>
        </>
      )}
      {generatedPreview(PMM.diagnoses)}
      {commentBox(PMM.diagnoses, 3, 'Assessment / formulation')}
    </>
  );

  const medsBody = (
    <>
      {drFirstMsg ? <p className="text-xs text-amber-700">{drFirstMsg}</p> : null}
      {ctx ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active medications</p>
            {ctx.medications.length ? (
              <ul className="space-y-1 text-xs text-slate-700">
                {ctx.medications.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-1.5">
                    <span>{medLine(m)}</span>
                    {m.drFirst ? <span className="rounded bg-sky-50 px-1.5 text-[10px] font-semibold text-sky-700">DrFirst</span> : null}
                    {m.controlled ? <span className="rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">Controlled</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">None on file</p>
            )}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Allergies</p>
            {ctx.allergies.length ? (
              <ul className="space-y-1 text-xs text-slate-700">
                {ctx.allergies.map((a, i) => (
                  <li key={`${a.allergen}-${i}`}>{a.allergen}{a.reaction ? ` — ${a.reaction}` : ''}{a.severity ? ` (${a.severity})` : ''}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">None on file</p>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeMeds} onChange={(e) => setIncludeMeds(e.target.checked)} disabled={!ctx} />
          Include medication and allergy list in the note
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={reconciled} onChange={(e) => setReconciled(e.target.checked)} />
          I reviewed and reconciled the medication list with the patient
        </label>
      </div>
      {generatedPreview(PMM.meds)}
      {commentBox(PMM.meds, 2, 'Reconciliation comments')}
    </>
  );

  const sideEffectsBody = (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <tbody>
            {SIDE_EFFECTS.map((k) => {
              const s = sideEffects[k] || { rating: '' as const, comment: '' };
              return (
                <tr key={k} className="border-b border-slate-50">
                  <td className="py-1.5 pr-3 font-semibold text-slate-800">
                    {k === 'Other' ? (
                      <input value={sideOther} onChange={(e) => setSideOther(e.target.value)} placeholder="Other (describe)" className="w-36 rounded-lg border border-slate-200 p-1 text-xs" />
                    ) : (
                      k
                    )}
                  </td>
                  <td className="py-1.5 pr-3">
                    <span className="flex flex-wrap gap-1" role="radiogroup" aria-label={`${k} severity`}>
                      {SIDE_EFFECT_RATINGS.map((r) => (
                        <button
                          key={r}
                          type="button"
                          role="radio"
                          aria-checked={s.rating === r}
                          onClick={() => {
                            setSideEffects((prev) => ({ ...prev, [k]: { ...s, rating: s.rating === r ? '' : r } }));
                            if (r !== 'None') setNoSideEffects(false);
                          }}
                          className={pillBtn(s.rating === r, r === 'None' ? 'good' : r === 'Severe' ? 'bad' : 'warn')}
                        >
                          {r}
                        </button>
                      ))}
                    </span>
                  </td>
                  <td className="py-1.5">
                    <input value={s.comment} aria-label={`${k} comment`} onChange={(e) => setSideEffects((prev) => ({ ...prev, [k]: { ...s, comment: e.target.value } }))} placeholder="Comment" className="min-h-[36px] w-full min-w-[140px] rounded-lg border border-slate-200 p-1 text-xs" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {generatedPreview(PMM.sideEffects)}
      {commentBox(PMM.sideEffects, 2, 'Additional side-effect detail')}
    </>
  );

  const labsBody = (
    <>
      {ctx && !ctx.labs.available ? (
        <p className="text-xs text-slate-500">Lab results are not available for your role.</p>
      ) : ctx ? (
        ctx.labs.results.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-500">
                  <th className="py-1.5 pr-2"><span className="sr-only">Include</span></th>
                  <th className="py-1.5 pr-3">Date</th>
                  <th className="py-1.5 pr-3">Test</th>
                  <th className="py-1.5 pr-3">Value</th>
                  <th className="py-1.5 pr-3">Ref</th>
                  <th className="py-1.5">Flag</th>
                </tr>
              </thead>
              <tbody>
                {ctx.labs.results.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2">
                      <input
                        type="checkbox"
                        aria-label={`Include ${r.testName}`}
                        className="h-4 w-4 accent-[#5C2D91]"
                        checked={!excludedLabs.has(r.id)}
                        onChange={(e) =>
                          setExcludedLabs((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.delete(r.id);
                            else next.add(r.id);
                            return next;
                          })
                        }
                      />
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums">{isoDate(r.date)}</td>
                    <td className="py-1.5 pr-3 font-semibold text-slate-800">{r.testName}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{r.value}{r.unit ? ` ${r.unit}` : ''}</td>
                    <td className="py-1.5 pr-3">{r.refRange || '—'}</td>
                    <td className={`py-1.5 font-semibold ${r.flag && r.flag !== 'N' ? 'text-rose-600' : 'text-slate-500'}`}>{r.flag || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-slate-500">None on file</p>
        )
      ) : null}
      {ctx?.labs.available ? (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeLabs} onChange={(e) => setIncludeLabs(e.target.checked)} />
          Include lab results in the note
        </label>
      ) : null}
      {generatedPreview(PMM.labs)}
      {commentBox(PMM.labs, 2, 'Interpretation')}
    </>
  );

  const labsOrderedBody = (
    <>
      <div className="flex flex-wrap gap-1.5">
        {PSYCH_LABS.map((lab) => {
          const on = labsOrdered.includes(lab);
          return (
            <button key={lab} type="button" aria-pressed={on} className={pillBtn(on)} onClick={() => { setLabsOrdered((prev) => (on ? prev.filter((l) => l !== lab) : [...prev, lab])); setNoLabsOrdered(false); }}>
              {lab}
            </button>
          );
        })}
      </div>
      <label className="block text-xs font-semibold text-slate-600">
        Other labs (separate with ;)
        <input value={labsOther} onChange={(e) => { setLabsOther(e.target.value); setNoLabsOrdered(false); }} className={`mt-1 ${inputCls}`} />
      </label>
      <button
        type="button"
        aria-pressed={noLabsOrdered}
        disabled={labsOrdered.length > 0 || Boolean(labsOther.trim())}
        className={pillBtn(noLabsOrdered, 'good')}
        onClick={() => setNoLabsOrdered(!noLabsOrdered)}
      >
        No labs ordered this visit
      </button>
      <p className="text-[11px] text-slate-500">This documents the order in the note. Create the requisition in Lab Orders (Quest / LabCorp).</p>
      {generatedPreview(PMM.labsOrdered)}
      {commentBox(PMM.labsOrdered, 2, 'Monitoring comments')}
    </>
  );

  const toggleNoMedChanges = (checked: boolean) => {
    setNoMedChanges(checked);
    if (checked) {
      // The sentence replaces the plan rows and the free text
      setMedRows((rows) => applyNoMedChanges(rows));
      setPdmpReviewed(false);
      setComment(PMM.medChanges, '');
    }
  };
  const noMedChangesBox = (
    <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700">
      <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={noMedChanges} onChange={(e) => toggleNoMedChanges(e.target.checked)} />
      {NO_MED_CHANGES_LABEL}
      <span className="font-normal text-slate-500">— writes “{NO_MED_CHANGES_TEXT}”</span>
    </label>
  );
  const medChangesBody = noMedChanges ? (
    <>
      {noMedChangesBox}
      {generatedPreview(PMM.medChanges)}
      <p className="text-[11px] text-slate-500">Untick to document a start, change or stop. Prescriptions are sent in DrFirst Rcopia.</p>
    </>
  ) : (
    <>
      {noMedChangesBox}
      {drFirstMsg ? <p className="text-xs text-amber-700">{drFirstMsg}</p> : null}
      {medRows.length === 0 ? <p className="text-xs text-slate-500">{ctx ? 'No active medications on file.' : 'Medication list not loaded.'}</p> : null}
      <div className="space-y-2">
        {medRows.map((r) => (
          <div key={r.key} className="rounded-lg border border-slate-200 p-2.5">
            <div className="flex flex-wrap items-center gap-2">
              {r.medId ? (
                <span className="text-xs font-semibold text-slate-800">
                  {r.name}
                  {r.currentDose ? <span className="font-normal text-slate-500"> · {r.currentDose}</span> : null}
                </span>
              ) : (
                <input value={r.name} onChange={(e) => updateRow(r.key, { name: e.target.value })} placeholder="New medication (drug name)" aria-label="New medication name" className="min-h-[36px] min-w-[180px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs" />
              )}
              {r.controlled ? <span className="rounded bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">Controlled</span> : null}
              <span className="flex flex-wrap gap-1 sm:ml-auto" role="radiogroup" aria-label={`Action for ${r.name || 'new medication'}`}>
                {(r.medId ? MED_ACTIONS : (['Start'] as const)).map((a) => (
                  <button key={a} type="button" role="radio" aria-checked={r.action === a} className={pillBtn(r.action === a)} onClick={() => updateRow(r.key, { action: (r.action === a && r.medId ? '' : a) as MedAction })}>
                    {a}
                  </button>
                ))}
                {!r.medId ? (
                  <button type="button" className={smallBtn} onClick={() => setMedRows((rows) => rows.filter((x) => x.key !== r.key))}>
                    Remove
                  </button>
                ) : null}
              </span>
            </div>
            {r.action && r.action !== 'Continue' ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {r.action !== 'Stop' ? (
                  <input value={r.newDose} onChange={(e) => updateRow(r.key, { newDose: e.target.value })} placeholder={r.action === 'Start' ? 'Dose (e.g. 50 mg)' : 'New dose'} aria-label="New dose" className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
                ) : null}
                {r.action !== 'Stop' ? (
                  <input value={r.sig} onChange={(e) => updateRow(r.key, { sig: e.target.value })} placeholder="Sig (e.g. 1 tab PO qHS)" aria-label="Sig" className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
                ) : null}
                <input value={r.reason} onChange={(e) => updateRow(r.key, { reason: e.target.value })} placeholder="Reason" aria-label="Reason" className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
              </div>
            ) : null}
            {!r.medId ? (
              <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-600">
                <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={r.controlled} onChange={(e) => setMedRows((rows) => rows.map((x) => (x.key === r.key ? { ...x, controlled: e.target.checked } : x)))} />
                Controlled substance (Schedule II–V)
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallBtn} onClick={addStartRow}>+ Start new medication</button>
        {medRows.some((r) => r.medId && !r.action) ? (
          <button type="button" className={smallBtn} onClick={() => setMedRows((rows) => rows.map((r) => (r.medId && !r.action ? { ...r, action: 'Continue' } : r)))}>
            Continue all unchanged
          </button>
        ) : null}
      </div>
      {controlledChanges(medRows).length ? (
        <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Controlled substance started or changed. Maryland requires a PDMP (CRISP) query before prescribing. This note does not check the PDMP.
          </p>
          <label className="flex items-center gap-2">
            <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={pdmpReviewed} onChange={(e) => setPdmpReviewed(e.target.checked)} />
            I reviewed the Maryland PDMP (CRISP) for this prescription
          </label>
        </div>
      ) : null}
      <p className="text-[11px] text-slate-500">Prescriptions are sent in DrFirst Rcopia. This section documents the plan only.</p>
      {generatedPreview(PMM.medChanges)}
      {commentBox(PMM.medChanges, 2, 'Rationale / risks, benefits, alternatives discussed')}
    </>
  );

  const nextApptBody = (
    <>
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Return interval">
        <span className="mr-1 text-xs font-semibold text-slate-600">Return in</span>
        {RETURN_INTERVALS.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={returnWeeks === w} className={pillBtn(returnWeeks === w)} onClick={() => setReturnWeeks(returnWeeks === w ? null : w)}>
            {w} wk
          </button>
        ))}
      </div>
      {ctx ? (
        <p className="text-xs text-slate-700">
          Next scheduled:{' '}
          {ctx.nextAppointment
            ? `${formatApptTime(ctx.nextAppointment.startsAt)} ET — ${ctx.nextAppointment.type}${ctx.nextAppointment.isVirtual ? ' (telehealth)' : ''}`
            : 'None on file'}
        </p>
      ) : null}
      {ctx ? (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeScheduled} onChange={(e) => setIncludeScheduled(e.target.checked)} />
          Include the next scheduled appointment in the note
        </label>
      ) : null}
      {generatedPreview(PMM.nextAppt)}
      {commentBox(PMM.nextAppt, 2, 'Follow-up comments')}
    </>
  );

  const issueList = (items: Issue[]) => (
    <ul className="space-y-1">
      {items.map((b) => (
        <li key={`${b.heading}-${b.message}`}>
          {b.heading ? (
            <button type="button" className="text-left underline decoration-dotted underline-offset-2 hover:decoration-solid" onClick={() => goTo(b.heading as string)}>
              {b.message}
            </button>
          ) : (
            b.message
          )}
        </li>
      ))}
    </ul>
  );

  const reviewBody = (
    <>
      {blockers.length ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="mb-1 font-semibold">Required before signing (click to jump)</p>
          {issueList(blockers)}
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={14} /> All required items are complete.
        </p>
      )}
      {warnings.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="mb-1 font-semibold">Check before signing</p>
          {issueList(warnings)}
        </div>
      ) : null}
      {commentBox('Review', 2, 'Review comments (optional)')}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-xs text-slate-700">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 accent-[#5C2D91]" />
        <span>
          <strong className="font-semibold text-slate-900">Clinical Attestation:</strong> I have reviewed, verified, and assume full clinical responsibility for this note per CARF &amp; OMHC documentation standards.
        </span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!attested || blockers.length > 0 || saving}
          onClick={() => void onSaveAndSign()}
          className="min-h-[44px] flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
        >
          {saving ? 'Saving…' : 'Save & Sign Note'}
        </button>
        <button type="button" disabled={saving} onClick={onSaveDraft} className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Save draft
        </button>
      </div>
      <p className="text-[11px] text-slate-500">Signing saves the note, then applies your signature. Signed notes are corrected with an addendum.</p>
    </>
  );

  const childUi = { commentBox, generatedPreview, safetyPlanEditor };

  const bodyFor = (heading: string): ReactNode => {
    if (heading === HEADER) return headerBody;
    if (heading === IDENT) {
      return (
        <IdentifyingInfoEditor
          noteType={noteType}
          clientId={clientId}
          editingNoteId={editingNoteId}
          preview={preview}
          initialText={initialTexts[IDENT] || ''}
          dateOfService={dateOfService}
          visit={{ known: visitChosen, telehealth, audioOnly: Boolean(audioOnly), patientLocationState: patientLocationState ?? null }}
          onTextChange={setIdentText}
          onUserEdit={onUserEdit}
          scribeLines={scribeLines}
        />
      );
    }
    if (heading === 'Review') return reviewBody;
    if (heading === PMM.exam) return examBody;
    if (heading === PMM.diagnoses) return diagnosesBody;
    if (heading === PMM.meds) return medsBody;
    if (heading === PMM.medChanges) return medChangesBody;
    if (heading === PMM.nextAppt) return nextApptBody;
    if (heading === PMM.plan) return commentBox(PMM.plan, 4, 'Plan');
    if (!isChild) {
      switch (heading) {
        case PMM.hpi: return pmmHpiBody;
        case PMM.measures: return measuresBody;
        case PMM.si: return siBody;
        case PMM.safetyPlan: return safetyPlanBody;
        case PMM.sideEffects: return sideEffectsBody;
        case PMM.labs: return labsBody;
        case PMM.labsOrdered: return labsOrderedBody;
        default: break;
      }
    } else {
      if (isReEval) {
        if (heading === APR.interval) return reEvalIntervalBody;
        if (heading === APR.hpi) return (<>{aiPanel(APR.hpi)}{commentBox(APR.hpi, 5, 'History of present illness')}</>);
        if (heading === APR.measures) return measuresBody;
        if (heading === APR.labsOrdered) return labsOrderedBody;
      }
      if (heading === CPI.hpi) return intakeHpiBody;
      if (heading === CPI.chiefComplaint) return commentBox(CPI.chiefComplaint, 2, 'Chief complaint');
      const childBody = child.renderBody(heading, childUi);
      if (childBody) return childBody;
    }
    return commentBox(heading, 3);
  };

  const asideFor = (heading: string): ReactNode => {
    if (heading === HEADER) return ctx ? <SourceTag text="chart demographics + your profile" /> : null;
    if (heading === PMM.meds) return drFirstButton('Reconcile in DrFirst');
    if (heading === PMM.medChanges) return drFirstButton('Prescribe in DrFirst');
    if (heading === PMM.diagnoses) return ctx ? <SourceTag text="chart diagnoses" /> : null;
    if (heading === PMM.nextAppt) {
      return (
        <Link href="/dashboard/appointments" target="_blank" className={smallBtn}>
          <CalendarDays size={12} /> Schedule <ExternalLink size={11} />
        </Link>
      );
    }
    if (isReEval && heading === APR.measures) return ctx?.measures.available ? <SourceTag text="Altrixs assessments" /> : null;
    if (isReEval && heading === APR.labsOrdered) {
      return (
        <Link href="/dashboard/ehr/labs" target="_blank" className={smallBtn}>
          <FlaskConical size={12} /> Open Lab Orders <ExternalLink size={11} />
        </Link>
      );
    }
    if (isChild) return child.aside(heading);
    if (heading === PMM.measures) return ctx?.measures.available ? <SourceTag text="Altrixs assessments" /> : null;
    if (heading === PMM.labs) return ctx?.labs.available ? <SourceTag text="Altrixs lab results" /> : null;
    if (heading === PMM.labsOrdered) {
      return (
        <Link href="/dashboard/ehr/labs" target="_blank" className={smallBtn}>
          <FlaskConical size={12} /> Open Lab Orders <ExternalLink size={11} />
        </Link>
      );
    }
    if (heading === PMM.si) {
      return (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${siStatus === 'positive' ? 'bg-rose-100 text-rose-700' : siStatus === 'negative' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {siStatus === 'positive' ? 'Screen positive' : siStatus === 'negative' ? 'Screen negative' : siStatus === 'incomplete' ? 'Incomplete' : 'Not started'}
        </span>
      );
    }
    if (heading === PMM.sideEffects) {
      return (
        <button
          type="button"
          className={pillBtn(noSideEffects, 'good')}
          aria-pressed={noSideEffects}
          onClick={() => {
            const next = !noSideEffects;
            setNoSideEffects(next);
            if (next) setSideEffects(Object.fromEntries(SIDE_EFFECTS.map((k) => [k, { rating: 'None' as const, comment: sideEffects[k]?.comment || '' }])));
          }}
        >
          No side effects reported
        </button>
      );
    }
    return null;
  };

  const renderSection = (heading: string) => {
    const st = status(heading);
    const collapsed = collapseDone && st === 'done' && !expanded.has(heading);
    const id = sectionDomId(heading);
    return (
      <section
        key={heading}
        id={id}
        data-section={heading}
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        onFocusCapture={() => setActive(heading)}
        className={`scroll-mt-24 rounded-xl border bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20 ${
          st === 'required' ? 'border-rose-200' : 'border-slate-200'
        } ${collapsed ? 'p-3' : 'space-y-3 p-4'}`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="text-sm font-bold" style={{ color: PURPLE }}>
            {collapseDone && st === 'done' ? (
              <button
                type="button"
                className="mr-1 inline-flex items-center align-middle text-slate-500"
                aria-label={collapsed ? `Expand ${heading}` : `Collapse ${heading}`}
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(heading)) next.delete(heading);
                    else next.add(heading);
                    return next;
                  })
                }
              >
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : null}
            {n(heading)}. {heading}
            {st === 'required' ? <span className="ml-2 text-[11px] font-semibold text-rose-600">Required</span> : null}
            {st === 'done' ? <CheckCircle2 size={13} className="ml-2 inline text-emerald-600" aria-label="complete" /> : null}
          </h3>
          {collapsed ? null : asideFor(heading)}
        </div>
        {collapsed ? (
          <p className="truncate text-xs text-slate-500">{(texts[heading] || '').split('\n').find((l) => l.trim()) || ''}</p>
        ) : (
          <>
            {carryBar(heading)}
            {bodyFor(heading)}
          </>
        )}
      </section>
    );
  };

  const dotCls = (st: SectionStatus) => (st === 'done' ? 'bg-emerald-500' : st === 'required' ? 'bg-rose-500' : 'bg-slate-300');
  const doneCount = sections.filter((h) => status(h) === 'done').length;

  const markEdit = (target: EventTarget) => {
    const el = target as HTMLElement;
    if (el.closest?.('[data-section]') && (el.closest('button') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
      onUserEdit?.();
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]" onKeyDown={onKeyDown}>
      {/* Section navigator */}
      <nav aria-label="Note sections" className="sticky top-16 z-[5] -mx-1 bg-white/95 px-1 py-1 backdrop-blur md:top-24 md:mx-0 md:self-start md:bg-transparent md:p-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={nextIncomplete} className={`${smallBtn} border-[#5C2D91]/40 text-[#5C2D91]`}>
            Next incomplete
          </button>
          <button type="button" aria-pressed={collapseDone} onClick={() => { setCollapseDone(!collapseDone); setExpanded(new Set()); }} className={pillBtn(collapseDone)}>
            Collapse completed
          </button>
          <span className="text-[11px] text-slate-500">
            {doneCount}/{sections.length} sections
            {saveStatus ? <> · {saveStatus}</> : null}
          </span>
        </div>
        <ol className="flex max-h-[none] gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-2 md:max-h-[calc(90vh-12rem)] md:flex-col md:overflow-y-auto md:overflow-x-visible">
          {sections.map((h, i) => {
            const st = status(h);
            return (
              <li key={h} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(h)}
                  aria-current={active === h ? 'true' : undefined}
                  className={`flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/30 ${
                    active === h ? 'bg-white font-semibold text-[#5C2D91] shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${dotCls(st)}`} aria-hidden />
                  <span className="whitespace-nowrap md:whitespace-normal">{i + 1}. {h}</span>
                  <span className="sr-only">{st === 'done' ? '(complete)' : st === 'required' ? '(required)' : '(empty)'}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 hidden text-[11px] leading-4 text-slate-500 md:block">
          Ctrl/Cmd + Enter: next section · Ctrl/Cmd + S: save draft · Alt + Up/Down: move. Green = has content, red = required.
        </p>
      </nav>

      <div className="min-w-0 space-y-4" onChangeCapture={(e) => markEdit(e.target)} onClickCapture={(e) => markEdit(e.target)}>
        {ctxNotice}
        {bringAllBanner}
        {sections.map((h) => renderSection(h))}
      </div>
    </div>
  );
});
