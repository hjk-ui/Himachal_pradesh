'use client';

/**
 * Editor for the therapist / counselor templates:
 *  - MD Therapy Adult & Child Intake (90791)
 *  - Substance Abuse Intake (90791, 42 CFR Part 2)
 *  - Therapy Progress Adult & Child (90832 / 90834 / 90837, family 90846 / 90847)
 *
 * Same contract as StructuredNoteEditor: it reports one text per section to the Progress Notes
 * page, which saves them as an ordinary note body. Fields come from the declarative template
 * (src/lib/ehr/therapy/templates.ts); sign rules are the shared text-based rules the server
 * applies. Chart data is shown with its source; nothing clinical is pre-selected.
 */

import Link from 'next/link';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  History,
  Mic,
  MicOff,
  Phone,
  RefreshCw,
  ShieldAlert,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useAuth } from '@/features/auth';
import { SmartPhraseTextarea } from '@/components/notes/SmartPhraseTextarea';
import { IdentifyingInfoEditor } from '@/components/notes/IdentifyingInfoEditor';
import { identifyingInfoIssues, type ScribeLine } from '@/lib/ehr/identifyingInfo';
import { EMPTY_MSE_VALUE, MentalStatusExamWidget, type MseValue } from '@/components/clinical/MentalStatusExamWidget';
import { DiagnosisAutocomplete, type SelectedDiagnosis } from '@/components/clinical/DiagnosisAutocomplete';
import { requestGroundedSectionDraft } from '@/components/scribe/sectionDraftClient';
import { NOTE_LABELS, sectionPlaceholder, type NoteType } from '@/lib/ehr/noteTemplates';
import type { StructuredNoteContext } from '@/lib/ehr/structuredNoteContext';
import {
  TEMPLATE_CONFIG,
  broughtForwardBlock,
  countPendingCarryForward,
  markReviewedNoChanges,
  stripCarryMarkers,
  structuredSignBlockers,
} from '@/lib/ehr/structuredNotes';
import {
  EMPTY_SAFETY_PLAN,
  SAFETY_PLAN_FIELDS,
  SI_QUESTIONS,
  ageOn,
  isoDate,
  joinBlocks,
  medLine,
  parseChartDiagnoses,
  renderDiagnoses,
  renderMedsAllergies,
  renderMse,
  renderSafetyPlan,
  renderSiScreen,
  siScreenStatus,
  type PmmDiagnosis,
  type SafetyPlanFields,
  type SiAnswers,
} from '@/lib/ehr/psychMedMgmt';
import {
  missingFromValues,
  renderSection,
  restoreValues,
  strVal,
  visibleFromValues,
  type FieldDef,
  type SectionDef,
  type Values,
} from '@/lib/ehr/therapy/engine';
import { CPT_TIME_RULE_TEXT, PLAN_PENDING_LABEL, SESSION_TYPE_LABELS, minutesBetween, suggestTherapyCpt, type TherapySessionType } from '@/lib/ehr/therapy/rules';
import { SUD_INTAKE, THERAPY_INTAKE, THERAPY_PROGRESS, TS, type TherapyNoteType } from '@/lib/ehr/therapy/sections';
import { SUD_SCREEN_POSITIVE_FIELDS, THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { therapySignWarnings } from '@/lib/ehr/therapy/blockers';
import {
  ASAM_DIMENSIONS,
  ASAM_RATING_LABELS,
  ASAM_RISK_RATINGS,
  GOAL_PROGRESS,
  asamSuggestion,
  renderAsam,
  renderPlanGoals,
  renderSessionBlock,
  type ActivePlanSummary,
  type AsamValue,
  type GoalProgressValue,
} from '@/lib/ehr/therapy/widgets';
import { PLAN_PROGRESS } from '@/lib/ehr/therapy/planHierarchy';
import { ChoiceChips, SourceTag, inputCls, pillBtn, smallBtn } from '@/components/notes/structuredNoteUi';
import { GeneratedPreview, TemplateField } from '@/components/therapy/TemplateFields';
import { useDictation } from '@/components/notes/useDictation';

const PURPLE = '#5C2D91';

export type TherapyNoteEditorHandle = { insertText: (heading: string, text: string) => void };

type Props = {
  noteType: TherapyNoteType;
  clientId: string;
  editingNoteId: string | null;
  fromDraft: boolean;
  preview: boolean;
  initialTexts: Record<string, string>;
  onTextsChange: (texts: Record<string, string>) => void;
  onFieldFocus?: (heading: string) => void;
  onUserEdit?: () => void;
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
  saveStatus?: string | null;
  onSaveDraft: () => void;
  onSaveAndSign: () => Promise<void>;
  onSwitchNoteType?: (type: TherapyNoteType) => void;
  /** Started from a scheduled visit: in person / telehealth is already known from the appointment */
  visitPreset?: boolean;
  /** Service details say audio-only: the claim takes the payer's audio-only modifier, not 95 */
  audioOnly?: boolean;
  /** Scheduled start / end (HH:MM, practice clock) of the visit this note documents: prefilled, editable */
  appointmentTimes?: { start: string; end: string } | null;
  /** Telehealth: the patient's state from the appointment / service details (Identifying Information) */
  patientLocationState?: string | null;
  /** AI Scribe transcript lines drafted into this note (Identifying Information suggestions only) */
  scribeLines?: ScribeLine[] | null;
};

type PlanStatusResponse = {
  success: true;
  gate: {
    ok: boolean;
    required: boolean;
    planId: string | null;
    message: string;
    /** Signing allowed without a plan only by the go-live transition (Valant client) */
    transition?: { reason: 'golive_transition'; until: string };
  };
  active: (ActivePlanSummary & { activity: { reason: string } }) | null;
  settings: { requirePlanForProgressNotes: boolean; requirePatientSignature: boolean };
};

type Issue = { message: string; heading: string | null };
const sectionDomId = (heading: string) => `tn-${heading.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

/** Session widget lines regenerated on every render (dropped from a reopened draft's free text). */
const SESSION_LINES = ['Patient:', 'DOB:', 'MRN:', 'Date of service:', 'Provider:', 'Location:', 'Visit type:', 'Session type:', 'Start time:', 'End time:', 'Session time:', 'Service code:', 'Time rule:', 'Source:'];

const lineOf = (text: string, label: string) => text.match(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (.+)$`, 'm'))?.[1]?.trim() || '';

export const TherapyNoteEditor = forwardRef<TherapyNoteEditorHandle, Props>(function TherapyNoteEditor(props, ref) {
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
    visitPreset,
    audioOnly,
    appointmentTimes,
    patientLocationState,
    scribeLines,
  } = props;
  const tpl = THERAPY_TEMPLATES[noteType];
  const config = TEMPLATE_CONFIG[noteType];
  const isProgress = noteType === THERAPY_PROGRESS;
  const isIntake = noteType === THERAPY_INTAKE || noteType === SUD_INTAKE;
  const { user } = useAuth();

  // ── Chart context ──────────────────────────────────────────────────────────
  const [ctx, setCtx] = useState<StructuredNoteContext | null>(null);
  const [ctxError, setCtxError] = useState<string | null>(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
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
    apiJson<{ success: true; context: StructuredNoteContext }>(
      `/api/clients/${encodeURIComponent(clientId)}/note-context?noteType=${encodeURIComponent(noteType)}${exclude ? `&excludeNoteId=${encodeURIComponent(exclude)}` : ''}`
    )
      .then((res) => !cancelled && setCtx(res.context))
      .catch((err: unknown) => !cancelled && setCtxError(err instanceof Error ? err.message : 'Could not load chart data'))
      .finally(() => !cancelled && setCtxLoading(false));
    return () => {
      cancelled = true;
    };
  }, [clientId, noteType, preview, reloadKey]);

  // ── Treatment plan status (progress notes) ─────────────────────────────────
  const [planStatus, setPlanStatus] = useState<PlanStatusResponse | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planReload, setPlanReload] = useState(0);
  useEffect(() => {
    if (!isProgress || !clientId || preview) {
      setPlanStatus(null);
      return;
    }
    let cancelled = false;
    setPlanError(null);
    apiJson<PlanStatusResponse>(`/api/clients/${encodeURIComponent(clientId)}/treatment-plan-status?noteType=${encodeURIComponent(noteType)}`)
      .then((res) => !cancelled && setPlanStatus(res))
      .catch((err: unknown) => !cancelled && setPlanError(err instanceof Error ? err.message : 'Could not load the treatment plan'));
    return () => {
      cancelled = true;
    };
  }, [isProgress, clientId, noteType, preview, planReload]);
  const activePlan = planStatus?.active ?? null;

  // ── Values (restored from a reopened draft) ────────────────────────────────
  const restored = useMemo(
    () => restoreValues(tpl.sections, initialTexts, { [TS.session]: SESSION_LINES }),
    // Only at open: later text changes come from this editor
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [values, setValues] = useState<Values>(() => (fromDraft ? restored.values : {}));
  const set = useCallback((id: string, value: unknown) => setValues((prev) => ({ ...prev, [id]: value })), []);
  const [comments, setComments] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const s of tpl.sections) out[s.heading] = fromDraft ? restored.leftover[s.heading] || '' : (initialTexts[s.heading] || '').trim();
    if (!fromDraft) out[TS.session] = '';
    // Identifying Information: its editor parses and regenerates the whole section text
    out[TS.identifying] = '';
    // Text from another note type (switch) that has no matching heading lands in the first narrative section
    const firstText = isProgress ? TS.interval : TS.referral;
    for (const [h, v] of Object.entries(initialTexts)) {
      if (!tpl.sections.some((s) => s.heading === h) && v.trim()) out[firstText] = joinBlocks(out[firstText], `${h}\n${v.trim()}`);
    }
    return out;
  });
  const setComment = useCallback((heading: string, value: string) => setComments((prev) => ({ ...prev, [heading]: value })), []);
  const [identText, setIdentText] = useState(() => (initialTexts[TS.identifying] || '').trim());
  const textRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  useImperativeHandle(
    ref,
    () => ({
      insertText: (heading: string, text: string) => {
        const target = tpl.sections.some((s) => s.heading === heading) && heading !== TS.session && heading !== TS.identifying ? heading : isProgress ? TS.interval : TS.referral;
        setComments((prev) => ({ ...prev, [target]: prev[target]?.trim() ? `${prev[target].trim()} ${text}` : text }));
        onUserEdit?.();
        requestAnimationFrame(() => textRefs.current[target]?.focus());
      },
    }),
    [tpl.sections, isProgress, onUserEdit]
  );

  // ── Session ────────────────────────────────────────────────────────────────
  const savedSession = initialTexts[TS.session] || '';
  const [startTime, setStartTime] = useState(() => (fromDraft ? lineOf(savedSession, 'Start time') : ''));
  const [endTime, setEndTime] = useState(() => (fromDraft ? lineOf(savedSession, 'End time') : ''));
  const [sessionType, setSessionType] = useState<TherapySessionType>(() => {
    const label = fromDraft ? lineOf(savedSession, 'Session type') : '';
    return (Object.entries(SESSION_TYPE_LABELS).find(([, l]) => l === label)?.[0] as TherapySessionType) || 'individual';
  });
  const [visitChosen, setVisitChosen] = useState(fromDraft || Boolean(visitPreset));
  // New note for a scheduled visit: start / end default to the appointment (one source with Service
  // details; the clinician corrects them to the actual session times)
  const [timesFromAppointment, setTimesFromAppointment] = useState(false);
  useEffect(() => {
    if (fromDraft || !appointmentTimes || startTime || endTime) return;
    setStartTime(appointmentTimes.start);
    setEndTime(appointmentTimes.end);
    setTimesFromAppointment(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentTimes?.start, appointmentTimes?.end]);
  const [location, setLocation] = useState(() => {
    const v = fromDraft ? lineOf(savedSession, 'Location') : '';
    return v === 'None on file' ? '' : v;
  });
  const [locationSource, setLocationSource] = useState(location ? 'saved draft' : '');
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
  const sessionMinutes = minutesBetween(startTime, endTime);
  useEffect(() => {
    if (sessionMinutes != null && String(sessionMinutes) !== durationMinutes) onDurationChange(String(sessionMinutes));
  }, [sessionMinutes, durationMinutes, onDurationChange]);
  const duration = Number(durationMinutes) || null;
  const suggestion = tpl.timeBased ? suggestTherapyCpt(duration, sessionType) : null;
  /** Clinician chose a code different from the time rule (needs a reason) */
  const [codeOverridden, setCodeOverridden] = useState(() => fromDraft && Boolean(cptCode));
  useEffect(() => {
    if (!tpl.timeBased) {
      if (!cptCode && tpl.codes.length === 1) onCptCodeChange(tpl.codes[0]);
      return;
    }
    if (!codeOverridden && suggestion?.code && suggestion.code !== cptCode) onCptCodeChange(suggestion.code);
  }, [tpl.timeBased, tpl.codes, cptCode, codeOverridden, suggestion?.code, onCptCodeChange]);
  const codeMismatch = Boolean(tpl.timeBased && cptCode && suggestion && suggestion.code !== cptCode);

  const age = ageOn(ctx?.patient.dateOfBirth ?? null, dateOfService);
  const [minorOverride, setMinorOverride] = useState<boolean | null>(null);
  const minor = age != null ? age < 18 : minorOverride === true;
  const tctx = useMemo(() => ({ minor, telehealth: visitChosen && telehealth }), [minor, visitChosen, telehealth]);

  // ── Widgets ────────────────────────────────────────────────────────────────
  const [mse, setMse] = useState<MseValue>(EMPTY_MSE_VALUE);
  const chartDx = useMemo<PmmDiagnosis[]>(
    () =>
      ctx
        ? parseChartDiagnoses({ primaryCode: ctx.patient.primaryDiagnosisCode, primaryName: ctx.patient.primaryDiagnosis, secondary: ctx.patient.secondaryDiagnoses })
        : [],
    [ctx]
  );
  const chartCodes = useMemo(() => new Set(chartDx.map((d) => d.code).filter(Boolean)), [chartDx]);
  const [dxList, setDxList] = useState<SelectedDiagnosis[] | null>(null);
  useEffect(() => {
    if (!ctx || dxList !== null || fromDraft) return;
    setDxList(chartDx.map((d, i) => ({ code: d.code || `(uncoded ${i + 1})`, description: d.description, isPrimary: d.isPrimary, specifier: '' })));
  }, [ctx, dxList, fromDraft, chartDx]);
  const [siAnswers, setSiAnswers] = useState<SiAnswers>({});
  const [siTimeframe, setSiTimeframe] = useState(isProgress ? 'since last visit' : 'lifetime and past month');
  const [crisisReviewed, setCrisisReviewed] = useState(false);
  const siStatus = siScreenStatus(siAnswers);
  const [safety, setSafety] = useState<SafetyPlanFields>(EMPTY_SAFETY_PLAN);
  const [safetySource, setSafetySource] = useState('');
  const [includeMeds, setIncludeMeds] = useState(!fromDraft);
  const [reconciled, setReconciled] = useState(false);
  const [goalProgress, setGoalProgress] = useState<GoalProgressValue>({});
  const [asam, setAsam] = useState<AsamValue>({});

  const widgets = useMemo<Record<string, string>>(() => {
    const dxRender: PmmDiagnosis[] = (dxList || []).map((d) => ({
      code: d.code.startsWith('(uncoded') ? '' : d.code,
      description: [d.description, d.specifier?.trim()].filter(Boolean).join(', '),
      isPrimary: d.isPrimary,
      fromChart: chartCodes.has(d.code),
    }));
    return {
      session:
        !ctx && fromDraft
          ? ''
          : renderSessionBlock({
              patientName: ctx?.patient.name ?? null,
              dateOfBirth: ctx?.patient.dateOfBirth ?? null,
              mrn: ctx?.patient.mrn ?? null,
              dateOfService,
              providerName: ctx?.provider.name ?? user?.name ?? null,
              providerRole: ctx?.provider.roleLabel ?? null,
              providerCredentials: ctx?.provider.credentials ?? [],
              providerNpi: ctx?.provider.npi ?? null,
              location,
              visitChosen,
              telehealth,
              placeOfService,
              startTime,
              endTime,
              durationMinutes: duration,
              sessionType: isProgress ? sessionType : null,
              cptCode,
              timeRule: tpl.timeBased,
            }),
      mse: renderMse(mse),
      diagnoses: dxList === null || !dxList.length ? '' : renderDiagnoses(dxRender),
      cssrs: renderSiScreen({ answers: siAnswers, timeframe: siTimeframe, crisisResourcesReviewed: crisisReviewed }),
      safetyPlan: renderSafetyPlan({ fields: safety, notIndicated: false, sourceNote: safetySource }),
      chartMeds:
        ctx && includeMeds
          ? renderMedsAllergies({ meds: ctx.medications, allergies: ctx.allergies, reconciled })
          : reconciled
            ? 'Medication list reviewed with the client this visit.'
            : '',
      planGoals: isProgress ? renderPlanGoals(activePlan, goalProgress, { planLoaded: Boolean(planStatus) }) : '',
      asam: renderAsam(asam),
      identifyingInfo: identText,
    };
  }, [
    identText,
    ctx, fromDraft, dateOfService, user?.name, location, visitChosen, telehealth, placeOfService, startTime, endTime, duration, isProgress, sessionType,
    cptCode, tpl.timeBased, mse, dxList, chartCodes, siAnswers, siTimeframe, crisisReviewed, safety, safetySource, includeMeds, reconciled, activePlan,
    goalProgress, planStatus, asam,
  ]);

  const generated = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of tpl.sections) out[s.heading] = renderSection(s, values, tctx, widgets);
    return out;
  }, [tpl.sections, values, tctx, widgets]);

  const texts = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of tpl.sections) out[s.heading] = visibleFromValues(s.when, tctx, values) ? joinBlocks(generated[s.heading], comments[s.heading]) : '';
    return out;
  }, [tpl.sections, generated, comments, tctx, values]);
  const onTextsChangeRef = useRef(onTextsChange);
  onTextsChangeRef.current = onTextsChange;
  useEffect(() => {
    onTextsChangeRef.current(texts);
  }, [texts]);

  // ── Sign readiness ─────────────────────────────────────────────────────────
  const body = useMemo(() => tpl.sections.map((s) => `${s.heading}\n${texts[s.heading] || ''}`).join('\n\n'), [tpl.sections, texts]);
  const blockers: Issue[] = useMemo(
    () => structuredSignBlockers({ noteType, body, cptCode, durationMinutes: duration }),
    [noteType, body, cptCode, duration]
  );
  const planBlocked = isProgress && planStatus ? !planStatus.gate.ok : false;
  const planTransition = isProgress && planStatus?.gate.ok ? planStatus.gate.transition ?? null : null;
  const planTransitionBanner = planTransition ? (
    <div role="status" className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
      <p className="flex items-start gap-2 font-semibold">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        No active treatment plan — allowed until {planTransition.until} (go-live transition). Write the plan in Altrixs.
      </p>
      <p>Signing marks this note “{PLAN_PENDING_LABEL}”, records the override in the audit log, lists the client under Before go-live and in your Inbox, and flags the claim.</p>
      <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={`${smallBtn} border-amber-300 text-amber-900`}>
        <ClipboardList size={12} /> Rewrite / create treatment plan <ExternalLink size={11} />
      </Link>
    </div>
  ) : null;
  const sudScreenPositive = noteType === THERAPY_INTAKE && SUD_SCREEN_POSITIVE_FIELDS.some((id) => strVal(values, id) === 'Current use');
  const warnings: Issue[] = useMemo(() => {
    const w: Issue[] = therapySignWarnings({ type: noteType, body });
    for (const i of identifyingInfoIssues(noteType, body)) w.push({ message: i.message, heading: i.heading });
    if (!visitChosen) w.unshift({ message: 'Visit type (in person / telehealth) not selected.', heading: TS.session });
    if (sudScreenPositive && !strVal(values, 'screenFollowUp')) {
      w.push({ message: 'Substance use screen is positive: choose a follow-up (screener, Substance Abuse Intake, or not indicated).', heading: TS.substanceScreen });
    }
    if (strVal(values, 'riskLevel') === 'Moderate' && !widgets.safetyPlan) w.push({ message: 'Moderate risk: consider documenting a safety plan.', heading: isProgress ? TS.riskCheck : TS.risk });
    if (ctxError && !preview) w.push({ message: `Chart data could not be loaded (${ctxError}).`, heading: null });
    if (planError && isProgress && !preview) w.push({ message: `Treatment plan status could not be loaded (${planError}). The server still checks it when you sign.`, heading: TS.planGoals });
    return w;
  }, [noteType, body, visitChosen, sudScreenPositive, values, widgets.safetyPlan, isProgress, ctxError, planError, preview]);
  const missingByHeading = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const x of missingFromValues(tpl.sections, values, tctx, widgets)) {
      if (!x.required) continue;
      if (!m.has(x.heading)) m.set(x.heading, new Set());
      m.get(x.heading)!.add(x.fieldId);
    }
    return m;
  }, [tpl.sections, values, tctx, widgets]);
  const blockerHeadings = useMemo(() => new Set(blockers.map((b) => b.heading)), [blockers]);
  const [attested, setAttested] = useState(false);
  const visibleSections = tpl.sections.filter((s) => visibleFromValues(s.when, tctx, values));
  const status = (heading: string): 'done' | 'required' | 'empty' => {
    if (heading === TS.review) return blockers.length === 0 && attested && !planBlocked ? 'done' : blockers.length || planBlocked ? 'required' : 'empty';
    if (blockerHeadings.has(heading) || (heading === TS.planGoals && planBlocked)) return 'required';
    return texts[heading]?.trim() ? 'done' : 'empty';
  };

  // ── Navigation ─────────────────────────────────────────────────────────────
  const [active, setActive] = useState<string>(TS.session);
  const goTo = useCallback((heading: string) => {
    setActive(heading);
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionDomId(heading));
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.focus({ preventScroll: true });
    });
  }, []);
  const nextIncomplete = () => {
    const order = visibleSections.map((s) => s.heading);
    const idx = order.indexOf(active);
    const rotated = [...order.slice(idx + 1), ...order.slice(0, idx + 1)];
    const next = rotated.find((h) => status(h) === 'required') || rotated.find((h) => status(h) !== 'done');
    if (next) goTo(next);
  };
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveDraftRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── AI draft (narrative sections only) ─────────────────────────────────────
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
      const res = await requestGroundedSectionDraft({
        clientId,
        heading,
        noteLabel: NOTE_LABELS[noteType as NoteType] || noteType,
        scope: 'narrative',
        input,
      });
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
    if (!tpl.aiSections.includes(heading) || preview) return null;
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
          Dictate or type bullet points. AI drafts this narrative only (needs the client’s AI consent); every sentence must cite one of your points, and unsupported sentences are left out. The draft carries the AI DRAFT marker, which you remove after reviewing. Never used for risk, diagnosis or plan.
        </p>
        <textarea value={aiInput} onChange={(e) => setAiInput(e.target.value)} rows={4} className={`${inputCls} resize-y`} placeholder="- worked on thought records; mood 6/10&#10;- conflict with mother over curfew" />
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

  // ── Carry-forward ──────────────────────────────────────────────────────────
  const prior = ctx?.priorSameType || null;
  const carryBar = (heading: string) => {
    if (!config.carryForward.includes(heading) || !prior) return null;
    const priorText = stripCarryMarkers(prior.sections[heading] || '');
    if (!priorText) return null;
    const pending = countPendingCarryForward(comments[heading] || '');
    return (
      <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50/60 p-2.5 text-xs text-sky-900">
        <div className="flex flex-wrap items-center gap-2">
          <History size={13} />
          <span className="font-semibold">Prior {NOTE_LABELS[noteType as NoteType]} {prior.date}</span>
          <button
            type="button"
            className={smallBtn}
            disabled={(comments[heading] || '').includes(`(from ${prior.date}`)}
            onClick={() => setComment(heading, joinBlocks(comments[heading], broughtForwardBlock(prior.date, priorText)))}
          >
            Bring forward from {prior.date}
          </button>
          <button type="button" className={pillBtn(false, 'good')} onClick={() => setComment(heading, markReviewedNoChanges(comments[heading] || '', prior.date, priorText))}>
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

  // ── Section pieces ─────────────────────────────────────────────────────────
  const commentBox = (heading: string, label = 'Additional text', rows = 2) => (
    <div>
      <label htmlFor={`tn-text-${sectionDomId(heading)}`} className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <SmartPhraseTextarea
        id={`tn-text-${sectionDomId(heading)}`}
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

  const crisisBanner = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
      <Phone size={13} />
      <span>
        <strong>988</strong> Suicide &amp; Crisis Lifeline (call or text 988) · <strong>911</strong> for imminent danger · Crisis Text Line: text HOME to 741741
      </span>
    </div>
  );

  const sessionWidget = (
    <div className="space-y-3">
      <dl className="grid gap-x-6 gap-y-1 text-xs text-slate-700 sm:grid-cols-2">
        <div><dt className="inline font-semibold">Client: </dt><dd className="inline">{ctx?.patient.name || (ctxLoading ? 'Loading…' : 'Not loaded')}</dd></div>
        <div><dt className="inline font-semibold">DOB: </dt><dd className="inline">{ctx?.patient.dateOfBirth ? `${isoDate(ctx.patient.dateOfBirth)}${age != null ? ` (age ${age})` : ''}` : 'None on file'}</dd></div>
        <div><dt className="inline font-semibold">Date of service: </dt><dd className="inline">{dateOfService || 'Not entered'}</dd></div>
        <div><dt className="inline font-semibold">Clinician: </dt><dd className="inline">{[ctx?.provider.name || user?.name, ...(ctx?.provider.credentials || [])].filter(Boolean).join(', ') || 'Not loaded'}</dd></div>
      </dl>
      {ctx && age == null ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-amber-800">
          <AlertTriangle size={13} /> No date of birth on the chart.
          <button type="button" aria-pressed={minorOverride === true} className={pillBtn(minorOverride === true, 'warn')} onClick={() => setMinorOverride(minorOverride === true ? null : true)}>
            Client is under 18
          </button>
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-xs font-semibold text-slate-600">
          Visit type *
          <div className="mt-1 flex flex-wrap items-center gap-2" role="group" aria-label="Visit type">
            <button type="button" aria-pressed={visitChosen && !telehealth} className={pillBtn(visitChosen && !telehealth)} onClick={() => { setVisitChosen(true); onTelehealthChange(false); }}>
              In person
            </button>
            <button type="button" aria-pressed={visitChosen && telehealth} className={pillBtn(visitChosen && telehealth)} onClick={() => { setVisitChosen(true); onTelehealthChange(true); }}>
              Telehealth
            </button>
            {visitChosen && telehealth ? (
              <select aria-label="Telehealth place of service" value={placeOfService} onChange={(e) => onPlaceOfServiceChange(e.target.value)} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs">
                <option value="10">POS 10 — patient home</option>
                <option value="02">POS 02 — other than home</option>
              </select>
            ) : null}
          </div>
          {visitChosen && telehealth ? (
            <p className="mt-1 text-[11px] font-normal text-slate-500">
              {audioOnly ? "Audio-only: billed with the payer's audio-only modifier (93 / FQ) where the payer accepts it." : 'Billed with modifier 95 (synchronous audio-video).'}
            </p>
          ) : null}
        </div>
        <label className="text-xs font-semibold text-slate-600">
          Location {locationSource ? <span className="font-normal text-teal-700">(from {locationSource})</span> : null}
          <input value={location} onChange={(e) => { setLocation(e.target.value); setLocationSource(''); }} className={`mt-1 ${inputCls}`} placeholder="Clinic location" />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          Start time{tpl.timeBased ? ' *' : ''}{' '}
          {timesFromAppointment ? <span className="font-normal text-teal-700">(scheduled time: confirm the actual time)</span> : null}
          <input type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setTimesFromAppointment(false); }} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="text-xs font-semibold text-slate-600">
          End time{tpl.timeBased ? ' *' : ''}
          <input type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setTimesFromAppointment(false); }} className={`mt-1 ${inputCls}`} />
        </label>
      </div>
      {isProgress ? (
        <div className="text-xs font-semibold text-slate-600">
          Session type
          <div className="mt-1">
            <ChoiceChips
              options={Object.values(SESSION_TYPE_LABELS)}
              value={SESSION_TYPE_LABELS[sessionType]}
              onChange={(label) => {
                const key = (Object.entries(SESSION_TYPE_LABELS).find(([, l]) => l === label)?.[0] as TherapySessionType) || 'individual';
                setSessionType(key);
              }}
              ariaLabel="Session type"
            />
          </div>
        </div>
      ) : null}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
        <div className="flex flex-wrap items-center gap-3">
          <span>
            <strong>Session time:</strong> {duration ? `${duration} min` : startTime || endTime ? 'Enter both times' : 'Not entered'}
          </span>
          <label className="flex items-center gap-2 font-semibold">
            Service code *
            <select
              aria-label="Service code"
              value={cptCode}
              onChange={(e) => {
                onCptCodeChange(e.target.value);
                setCodeOverridden(Boolean(suggestion?.code ? e.target.value !== suggestion.code : e.target.value));
              }}
              className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs font-normal"
            >
              <option value="">— Choose —</option>
              {cptCode && !config.codeOptions.some((o) => o.code === cptCode) ? <option value={cptCode}>{cptCode}</option> : null}
              {config.codeOptions.map((o) => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
          </label>
          {codeMismatch && suggestion?.code ? (
            <button type="button" className={smallBtn} onClick={() => { onCptCodeChange(suggestion.code!); setCodeOverridden(false); }}>
              Use {suggestion.code}
            </button>
          ) : null}
        </div>
        {tpl.timeBased ? (
          <>
            <p className="mt-2">{suggestion?.rule}</p>
            <details className="mt-1">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">How the code is picked</summary>
              <p className="mt-1 text-[11px] text-slate-600">{CPT_TIME_RULE_TEXT}</p>
            </details>
          </>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">Intake / diagnostic evaluation: 90791.</p>
        )}
      </div>
    </div>
  );

  const meds = ctx?.medications ?? [];
  const chartMedsWidget = (
    <div className="space-y-2">
      {ctx ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Active medications</p>
            {meds.length ? (
              <ul className="space-y-1 text-xs text-slate-700">
                {meds.map((m) => (
                  <li key={m.id}>
                    {medLine(m)} {m.drFirst ? <span className="rounded bg-sky-50 px-1.5 text-[10px] font-semibold text-sky-700">DrFirst</span> : null}
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
                  <li key={`${a.allergen}-${i}`}>{a.allergen}{a.reaction ? ` — ${a.reaction}` : ''}</li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">None on file</p>
            )}
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={includeMeds} className={pillBtn(includeMeds)} disabled={!ctx} onClick={() => setIncludeMeds(!includeMeds)}>
          {includeMeds ? 'Chart list included' : 'Include chart list in note'}
        </button>
        <button type="button" aria-pressed={reconciled} className={pillBtn(reconciled, 'good')} onClick={() => setReconciled(!reconciled)}>
          Reviewed with client
        </button>
      </div>
      <p className="text-[11px] text-slate-500">Medications are prescribed and reconciled by the prescriber in DrFirst; this list is read from the chart.</p>
    </div>
  );

  const cssrsWidget = (
    <div className="space-y-2 rounded-lg border border-rose-100 bg-rose-50/30 p-3">
      <p className="text-xs font-semibold text-rose-800">C-SSRS screener (suicidal ideation endorsed)</p>
      <label className="block text-xs font-semibold text-slate-600">
        Timeframe
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
            <li key={q.id} className="flex flex-col gap-1.5 rounded-lg border border-slate-100 bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-xs text-slate-700">
                <strong className="text-slate-900">{i + 1}. {q.label}</strong> — {q.question}
              </span>
              <span className="flex shrink-0 gap-1" role="radiogroup" aria-label={q.label}>
                {(['yes', 'no'] as const).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={a === v} onClick={() => setSiAnswers((prev) => ({ ...prev, [q.id]: prev[q.id] === v ? '' : v }))} className={pillBtn(a === v, v === 'yes' ? 'bad' : 'good')}>
                    {v === 'yes' ? 'Yes' : 'No'}
                  </button>
                ))}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Link href={`/dashboard/ehr/assessments/cssrs?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={smallBtn}>
          Full C-SSRS <ExternalLink size={11} />
        </Link>
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={crisisReviewed} onChange={(e) => setCrisisReviewed(e.target.checked)} />
          Reviewed 988 and crisis resources with the client
        </label>
      </div>
      {siStatus === 'positive' ? (
        <p className="flex items-start gap-2 text-xs font-medium text-rose-800">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" /> Positive screen: document a safety plan below before signing and follow the clinic crisis protocol.
        </p>
      ) : null}
    </div>
  );

  const riskLevel = strVal(values, 'riskLevel');
  const safetyNeeded = siStatus === 'positive' || riskLevel === 'High';
  const showSafety = safetyNeeded || riskLevel === 'Moderate' || Boolean(widgets.safetyPlan);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const pullSafetyPlan = () => {
    const sp = ctx?.safetyPlan;
    if (!sp) return;
    setSafety({ ...sp.fields });
    setSafetySource(`Source: client's saved safety plan in Altrixs${sp.lastUpdated ? ` (last updated ${sp.lastUpdated})` : ''}; reviewed with the client.`);
  };
  const safetyWidget =
    showSafety || safetyOpen ? (
      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-semibold ${safetyNeeded ? 'text-rose-700' : 'text-slate-700'}`}>
            Safety plan{safetyNeeded ? ' — required (positive screen or High risk)' : ''}
          </span>
          {ctx?.safetyPlan ? (
            <button type="button" className={smallBtn} onClick={pullSafetyPlan}>
              <RefreshCw size={12} /> Pull saved safety plan
            </button>
          ) : ctx ? (
            <span className="text-[11px] text-slate-500">No saved safety plan on file</span>
          ) : null}
          <Link href={`/dashboard/ehr/safety-plan?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={smallBtn}>
            Safety Plans <ExternalLink size={11} />
          </Link>
        </div>
        {ctx?.safetyPlan?.matchedBy === 'name' ? <p className="text-[11px] text-amber-700">The saved plan is matched by client name only. Confirm it belongs to this client.</p> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          {SAFETY_PLAN_FIELDS.map((f) => (
            <label key={f.key} className="text-xs font-semibold text-slate-600">
              {f.label}
              <textarea rows={2} value={safety[f.key]} onChange={(e) => setSafety((p) => ({ ...p, [f.key]: e.target.value }))} className={`mt-1 ${inputCls} resize-y`} />
            </label>
          ))}
        </div>
      </div>
    ) : (
      <button type="button" className={smallBtn} onClick={() => setSafetyOpen(true)}>
        Add safety plan
      </button>
    );

  const diagnosesWidget = (
    <div className="space-y-2">
      {dxList === null ? (
        <button type="button" className={smallBtn} disabled={!ctx} onClick={() => setDxList(chartDx.map((d, i) => ({ code: d.code || `(uncoded ${i + 1})`, description: d.description, isPrimary: d.isPrimary, specifier: '' })))}>
          Load chart diagnoses
        </button>
      ) : (
        <>
          <DiagnosisAutocomplete value={dxList} onChange={(v) => setDxList(v.map((d) => ({ ...d })))} clientId={preview ? null : clientId} />
          <p className="text-[11px] text-slate-500">
            [on chart] diagnoses come from the client record; additions here are documented in this note (update the chart diagnoses in the client record).
            {noteType === SUD_INTAKE ? ' Substance use disorders: F10–F19.' : ''}
          </p>
        </>
      )}
    </div>
  );

  const asamWidget = (
    <div className="space-y-2">
      {ASAM_DIMENSIONS.map((d) => (
        <div key={d.n} className="flex flex-col gap-1.5 rounded-lg border border-slate-100 p-2 sm:flex-row sm:items-center">
          <span className="text-xs font-semibold text-slate-700 sm:w-72">{d.n}. {d.label}</span>
          <ChoiceChips
            options={ASAM_RISK_RATINGS}
            value={(asam[d.n]?.rating as (typeof ASAM_RISK_RATINGS)[number]) || ''}
            onChange={(r) => setAsam((prev) => ({ ...prev, [d.n]: { rating: r, note: prev[d.n]?.note || '' } }))}
            ariaLabel={`Dimension ${d.n} rating`}
            tone={(o) => (Number(o) >= 3 ? 'bad' : Number(o) === 2 ? 'warn' : 'brand')}
          />
          <input
            aria-label={`Dimension ${d.n} note`}
            value={asam[d.n]?.note || ''}
            onChange={(e) => setAsam((prev) => ({ ...prev, [d.n]: { rating: prev[d.n]?.rating || '', note: e.target.value } }))}
            placeholder="Note"
            className="min-h-[36px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
          />
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Ratings: {Object.entries(ASAM_RATING_LABELS).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
      {asamSuggestion(asam) ? (
        <p className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
          Suggestion (decision support only): {asamSuggestion(asam)}. Choose the level of care in Recommendations.
        </p>
      ) : null}
    </div>
  );

  const planGoalsWidget = (
    <div className="space-y-2">
      {planTransitionBanner}
      {preview ? <p className="text-xs text-slate-500">Treatment plans are not loaded in Demo Preview.</p> : null}
      {planError ? (
        <p className="text-xs text-amber-700">
          {planError}{' '}
          <button type="button" className="font-semibold underline" onClick={() => setPlanReload((k) => k + 1)}>Retry</button>
        </p>
      ) : null}
      {planStatus && !planStatus.gate.ok ? (
        <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="flex items-start gap-2 font-semibold">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" /> Signing is blocked: no active, signed treatment plan.
          </p>
          <p>{planStatus.gate.message}</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={`${smallBtn} border-rose-300 text-rose-800`}>
              <ClipboardList size={12} /> Create treatment plan <ExternalLink size={11} />
            </Link>
            <button type="button" className={smallBtn} onClick={() => setPlanReload((k) => k + 1)}>
              <RefreshCw size={12} /> Check again
            </button>
          </div>
          <p className="text-[11px]">You can still save this note as a draft.</p>
        </div>
      ) : null}
      {activePlan ? (
        <>
          <p className="text-xs text-slate-600">
            <strong>{activePlan.title}</strong>
            {activePlan.reviewDueAt ? ` · review due ${isoDate(activePlan.reviewDueAt)}` : ''}
          </p>
          {activePlan.goals.length ? (
            <ol className="space-y-2">
              {activePlan.goals.map((g, i) => {
                const p = goalProgress[g.id] || { status: '' as const, note: '' };
                return (
                  <li key={g.id} className="space-y-1.5 rounded-lg border border-slate-200 p-2.5">
                    <p className="text-xs font-semibold text-slate-800">Goal {i + 1}: {g.text}</p>
                    {g.objectives.length ? <p className="text-[11px] text-slate-500">Objectives: {g.objectives.join('; ')}</p> : null}
                    {g.progress || g.history?.length ? (
                      <p className="text-[11px] text-slate-500">
                        {g.progress ? `On the plan: ${g.progress}` : ''}
                        {g.progress && g.history?.length ? ' · ' : ''}
                        {g.history?.length
                          ? `Recent notes: ${g.history
                              .slice(0, 4)
                              .map((h) => `${h.date} ${h.status}${h.level ? ` (${h.level})` : ''}`)
                              .join('; ')}`
                          : ''}
                      </p>
                    ) : null}
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <ChoiceChips
                        options={GOAL_PROGRESS}
                        value={p.status}
                        onChange={(status) => setGoalProgress((prev) => ({ ...prev, [g.id]: { ...prev[g.id], status, note: prev[g.id]?.note || '' } }))}
                        ariaLabel={`Goal ${i + 1} progress`}
                        tone={(o) => (o === 'Progress made' ? 'good' : o === 'Regression' ? 'bad' : 'brand')}
                      />
                      <input
                        aria-label={`Goal ${i + 1} note`}
                        value={p.note}
                        onChange={(e) => setGoalProgress((prev) => ({ ...prev, [g.id]: { ...prev[g.id], status: prev[g.id]?.status || '', note: e.target.value } }))}
                        placeholder="Evidence / what was worked on"
                        className="min-h-[36px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
                      />
                    </div>
                    {p.status ? (
                      <div className="space-y-1">
                        <p className="text-[11px] text-slate-500">Overall progress toward this goal (optional; shown on the plan review)</p>
                        <ChoiceChips
                          options={PLAN_PROGRESS}
                          value={p.level || ''}
                          onChange={(level) => setGoalProgress((prev) => ({ ...prev, [g.id]: { status: prev[g.id]?.status || '', note: prev[g.id]?.note || '', level: level || undefined } }))}
                          ariaLabel={`Goal ${i + 1} overall progress`}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="text-xs text-amber-700">The active plan has no goals listed. Document goal work in the text below.</p>
          )}
        </>
      ) : null}
    </div>
  );

  const widgetUi = (f: Extract<FieldDef, { kind: 'widget' }>): ReactNode => {
    switch (f.widget) {
      case 'session':
        return sessionWidget;
      case 'mse':
        return (
          <>
            <p className="text-[11px] text-slate-500">Nothing is pre-selected. Only the findings you choose are written.</p>
            <MentalStatusExamWidget value={mse} onChange={setMse} allowUnset />
          </>
        );
      case 'diagnoses':
        return diagnosesWidget;
      case 'cssrs':
        return cssrsWidget;
      case 'safetyPlan':
        return safetyWidget;
      case 'chartMeds':
        return chartMedsWidget;
      case 'planGoals':
        return planGoalsWidget;
      case 'asam':
        return asamWidget;
      case 'identifyingInfo':
        return (
          <IdentifyingInfoEditor
            noteType={noteType}
            clientId={clientId}
            editingNoteId={editingNoteId}
            preview={preview}
            initialText={initialTexts[TS.identifying] || ''}
            dateOfService={dateOfService}
            visit={{ known: visitChosen, telehealth, audioOnly: Boolean(audioOnly), patientLocationState: patientLocationState ?? null }}
            onTextChange={setIdentText}
            onUserEdit={onUserEdit}
            scribeLines={scribeLines}
          />
        );
      default:
        return null;
    }
  };

  const sectionExtras = (s: SectionDef): ReactNode => {
    if (s.heading === TS.risk || s.heading === TS.riskCheck) return crisisBanner;
    if (s.heading === TS.substanceScreen && sudScreenPositive) {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle size={13} /> Current substance use reported. Consider an AUDIT / DAST-10 / CAGE-AID screen or the Substance Abuse Intake.
          <Link href={`/dashboard/ehr/assessments/sud?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={smallBtn}>
            SUD screeners <ExternalLink size={11} />
          </Link>
          {onSwitchNoteType ? (
            <button type="button" className={smallBtn} onClick={() => onSwitchNoteType(SUD_INTAKE)}>
              Switch to Substance Abuse Intake
            </button>
          ) : null}
        </div>
      );
    }
    if (s.heading === TS.screening) {
      const recs = (ctx?.measures.records || []).filter((r) => /audit|dast|cage/i.test(r.instrument)).slice(0, 6);
      return (
        <div className="space-y-1 text-xs text-slate-600">
          <Link href={`/dashboard/ehr/assessments/sud?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={smallBtn}>
            Open SUD screeners <ExternalLink size={11} />
          </Link>
          {recs.length ? (
            <ul className="mt-1 space-y-0.5">
              {recs.map((r, i) => (
                <li key={i}>
                  <SourceTag text={r.source} /> {r.instrument} {r.score ?? '—'} {r.severity ? `(${r.severity})` : ''} · {isoDate(r.date)}
                </li>
              ))}
            </ul>
          ) : ctx ? (
            <p className="text-[11px] text-slate-500">No AUDIT / DAST / CAGE-AID scores on file.</p>
          ) : null}
          <p className="text-[11px] text-slate-500">Cut-offs: AUDIT 8+ hazardous, 16+ harmful, 20+ possible dependence · DAST-10 3–5 moderate, 6+ substantial · CAGE-AID 2+ clinically significant.</p>
        </div>
      );
    }
    if (s.heading === TS.part2) {
      return (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Link href="/dashboard/ehr/consents" target="_blank" className={smallBtn}>
            Consents <ExternalLink size={11} />
          </Link>
          <Link href="/dashboard/ehr/part2" target="_blank" className={smallBtn}>
            Part 2 disclosures <ExternalLink size={11} />
          </Link>
        </div>
      );
    }
    if (s.heading === TS.recommendations && isIntake) {
      return <p className="text-[11px] text-slate-500">After you sign, you will be prompted to create the treatment plan (pre-filled with these diagnoses, goals and frequency).</p>;
    }
    return null;
  };

  const reviewBody = (
    <>
      {planTransitionBanner}
      {planBlocked ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="font-semibold">Treatment plan required</p>
          <p className="mt-1">{planStatus?.gate.message}</p>
          <Link href={`/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(clientId)}`} target="_blank" className={`mt-2 ${smallBtn} border-rose-300 text-rose-800`}>
            <ClipboardList size={12} /> Create treatment plan <ExternalLink size={11} />
          </Link>
        </div>
      ) : null}
      {blockers.length ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          <p className="mb-1 font-semibold">Required before signing</p>
          <ul className="space-y-1">
            {blockers.map((b, i) => (
              <li key={i}>
                {b.heading ? (
                  <button type="button" className="text-left hover:underline" onClick={() => goTo(b.heading!)}>{b.message}</button>
                ) : (
                  b.message
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <CheckCircle2 size={14} /> All required items are complete.
        </p>
      )}
      {warnings.length ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="mb-1 font-semibold">Check before signing</p>
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i}>
                {w.heading ? (
                  <button type="button" className="text-left hover:underline" onClick={() => goTo(w.heading!)}>{w.message}</button>
                ) : (
                  w.message
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {commentBox(TS.review, 'Review comments (optional)')}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-xs text-slate-700">
        <input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} className="mt-0.5 h-5 w-5 rounded border-slate-300 accent-[#5C2D91]" />
        <span>
          <strong className="font-semibold text-slate-900">Clinical Attestation:</strong> I provided this service, reviewed and verified this note, and assume clinical responsibility for it per OMHC documentation standards.
        </span>
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="button"
          disabled={!attested || blockers.length > 0 || planBlocked || saving}
          onClick={() => void onSaveAndSign()}
          className="min-h-[44px] flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
        >
          {saving ? 'Saving…' : 'Save & Sign Note'}
        </button>
        <button type="button" disabled={saving} onClick={onSaveDraft} className="min-h-[44px] rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Save draft
        </button>
        {!preview && clientId && (
          // Resource library opened for this client (context = note; SUD note types are recorded as Part 2)
          <Link
            href={`/dashboard/resources?clientId=${encodeURIComponent(clientId)}&context=note${editingNoteId ? `&contextId=${encodeURIComponent(editingNoteId)}` : ''}${/sud|substance/i.test(noteType) ? '&sud=1' : ''}`}
            target="_blank"
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-[#5C2D91] hover:bg-slate-50"
          >
            Send a resource
          </Link>
        )}
      </div>
      <p className="text-[11px] text-slate-500">
        Signing saves the note, then applies your signature. Pre-licensed clinicians’ notes go to their supervisor for co-signature. Signed notes are corrected with an addendum.
      </p>
    </>
  );

  const sectionCard = (s: SectionDef, n: number) => {
    const st = status(s.heading);
    const id = sectionDomId(s.heading);
    const missing = missingByHeading.get(s.heading);
    return (
      <section
        key={s.heading}
        id={id}
        data-section={s.heading}
        tabIndex={-1}
        aria-labelledby={`${id}-title`}
        onFocusCapture={() => setActive(s.heading)}
        className={`scroll-mt-24 space-y-3 rounded-xl border bg-white p-4 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/20 ${st === 'required' ? 'border-rose-200' : 'border-slate-200'}`}
      >
        <h3 id={`${id}-title`} className="text-sm font-bold" style={{ color: PURPLE }}>
          {n}. {s.heading}
          {st === 'required' ? <span className="ml-2 text-[11px] font-semibold text-rose-600">Required</span> : null}
          {st === 'done' ? <CheckCircle2 size={13} className="ml-2 inline text-emerald-600" aria-label="complete" /> : null}
        </h3>
        {s.intro ? <p className="text-[11px] text-slate-500">{s.intro}</p> : null}
        {s.heading === TS.review ? (
          reviewBody
        ) : (
          <>
            {carryBar(s.heading)}
            {sectionExtras(s)}
            <div className="space-y-3">
              {s.fields
                .filter((f) => visibleFromValues(f.when, tctx, values))
                .filter((f) => !(f.id === 'overrideReason' && !codeMismatch && !strVal(values, 'overrideReason')))
                .map((f) =>
                  f.kind === 'widget' ? (
                    <div key={f.id}>{widgetUi(f)}</div>
                  ) : (
                    <TemplateField key={f.id} field={f} values={values} set={set} missing={missing?.has(f.id) ? 'required' : null} />
                  )
                )}
            </div>
            {aiPanel(s.heading)}
            {s.heading === TS.session || s.heading === TS.identifying ? null : <GeneratedPreview text={generated[s.heading] || ''} />}
            {s.heading === TS.identifying ? null : commentBox(s.heading)}
          </>
        )}
      </section>
    );
  };

  const markEdit = (target: EventTarget) => {
    const el = target as HTMLElement;
    if (el.closest?.('[data-section]') && (el.closest('button') || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) onUserEdit?.();
  };
  const doneCount = visibleSections.filter((s) => status(s.heading) === 'done').length;

  return (
    <div className="grid gap-4 md:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Note sections" className="sticky top-16 z-[5] -mx-1 bg-white/95 px-1 py-1 backdrop-blur md:top-24 md:mx-0 md:self-start md:bg-transparent md:p-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={nextIncomplete} className={`${smallBtn} border-[#5C2D91]/40 text-[#5C2D91]`}>
            Next incomplete
          </button>
          <span className="text-[11px] text-slate-500">
            {doneCount}/{visibleSections.length} sections{saveStatus ? <> · {saveStatus}</> : null}
          </span>
        </div>
        <ol className="flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-2 md:max-h-[calc(90vh-12rem)] md:flex-col md:overflow-y-auto md:overflow-x-visible">
          {visibleSections.map((s, i) => {
            const st = status(s.heading);
            return (
              <li key={s.heading} className="shrink-0">
                <button
                  type="button"
                  onClick={() => goTo(s.heading)}
                  aria-current={active === s.heading ? 'true' : undefined}
                  className={`flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/30 ${
                    active === s.heading ? 'bg-white font-semibold text-[#5C2D91] shadow-sm' : 'text-slate-600 hover:bg-white'
                  }`}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${st === 'done' ? 'bg-emerald-500' : st === 'required' ? 'bg-rose-500' : 'bg-slate-300'}`} aria-hidden />
                  <span className="whitespace-nowrap md:whitespace-normal">{i + 1}. {s.heading}</span>
                  <span className="sr-only">{st === 'done' ? '(complete)' : st === 'required' ? '(required)' : '(empty)'}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 hidden text-[11px] leading-4 text-slate-500 md:block">Ctrl/Cmd + S: save draft. Green = has content, red = required to sign.</p>
      </nav>
      <div className="min-w-0 space-y-4" onChangeCapture={(e) => markEdit(e.target)} onClickCapture={(e) => markEdit(e.target)}>
        {ctxLoading ? <p className="text-xs text-slate-500">Loading chart data…</p> : null}
        {ctxError ? (
          <p className="text-xs text-amber-700">
            {ctxError}{' '}
            {!preview ? (
              <button type="button" className="font-semibold underline" onClick={() => setReloadKey((k) => k + 1)}>Retry</button>
            ) : null}
          </p>
        ) : null}
        {fromDraft ? (
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Reopened draft: answers saved as field lines are selected again; widget text (exam, screens, diagnoses, medications) stays in each section’s text box so nothing is written twice.
          </p>
        ) : null}
        {noteType === SUD_INTAKE ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" /> 42 CFR Part 2: this note is saved as Part 2 protected. It is excluded from carry-forward into other notes and needs patient consent for disclosure.
          </p>
        ) : null}
        {visibleSections.map((s, i) => sectionCard(s, i + 1))}
      </div>
    </div>
  );
});
