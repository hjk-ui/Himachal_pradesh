'use client';

/**
 * Child Psychiatry Intake, Child Psychiatry Re-Eval, Adult Psychiatry Intake and Adult
 * Psychiatry Re-Eval: state, generated text and section bodies for the intake-specific
 * sections (one hook; `variant` switches the adult wording and fields, `reEval`
 * adds the re-evaluation header, `initialEval` fixes the child initial evaluation type). Shared sections (Header, Exam, Diagnoses,
 * Meds & Allergies, Plan, Med Changes, Next Appointment, Review) are rendered by
 * StructuredNoteEditor.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import type { StructuredNoteContext } from '@/lib/ehr/structuredNoteContext';
import { isoDate, renderAllergies } from '@/lib/ehr/psychMedMgmt';
import {
  ABUSE_TYPES,
  ATTENDANCE,
  CPI,
  CUSTODY,
  EMPTY_CHECKLIST,
  EMPTY_DEV,
  EMPTY_HISTORY,
  EMPTY_MENSES,
  EMPTY_ROWS,
  FAMILY_CONDITIONS,
  FAMILY_REL_FIELDS,
  INFORMANTS,
  INPATIENT_FIELDS,
  LEGAL_TYPES,
  MED_HX_FIELDS,
  MILESTONE_DOMAINS,
  MILESTONE_STATUS,
  OUTPATIENT_FIELDS,
  RELATIVES,
  RISK_LEVELS,
  ROS_SYSTEMS,
  SCHOOL_SUPPORTS,
  SOCIAL_FIELDS,
  SOURCES_OF_RISK,
  STRESSOR_TYPES,
  SUBSTANCES,
  SUBSTANCE_CONSEQUENCES,
  SUBSTANCE_TX_FIELDS,
  SUBSTANCE_USE,
  SUICIDE_HX_TYPES,
  SUICIDE_PROTECTIVE_FACTORS,
  SUICIDE_RISK_FACTORS,
  TRAUMA_TYPES,
  VIOLENCE_TYPES,
  abuseExtraLines,
  childHeaderLines,
  mensesApplies,
  renderChecklist,
  renderDevelopmental,
  renderFamilyGrid,
  renderHistoryItem,
  renderLabeled,
  renderMenses,
  renderOverallRisk,
  renderRos,
  renderRows,
  renderSubstanceGrid,
  type AbuseExtra,
  type Checklist,
  type DevState,
  type EvalKind,
  type FamilyGrid,
  type HistoryItem,
  type LabeledFields,
  type MensesState,
  type RiskLevel,
  type RosState,
  type RowsState,
  type SubstanceGrid,
  type SubstanceRow,
  parseIntakeHeader,
} from '@/lib/ehr/childPsychIntake';
import {
  ADULT_ABUSE_TYPES,
  ADULT_DEFAULT_INFORMANTS,
  ADULT_FAMILY_REL_FIELDS,
  ADULT_INFORMANTS,
  ADULT_LEGAL_TYPES,
  ADULT_RELATIVES,
  ADULT_SOCIAL_FIELDS,
  ADULT_SOURCES_OF_RISK,
  ADULT_STRESSOR_TYPES,
  ADULT_SUBSTANCE_CONSEQUENCES,
  ADULT_SUICIDE_PROTECTIVE_FACTORS,
  ADULT_SUICIDE_RISK_FACTORS,
  ADULT_TRAUMA_TYPES,
  CHILDHOOD_DEV,
  EDUCATION_LEVELS,
  EMPLOYMENT_STATUS,
  EMPTY_ADULT_DEV,
  EMPTY_ADULT_MENSES,
  MARITAL_STATUS,
  MENOPAUSE_STATUS,
  MILITARY_BRANCHES,
  PREGNANCY_STATUS,
  adultHeaderLines,
  pregnancyCaution,
  renderAdultDevelopmental,
  renderAdultMenses,
  type AdultDevState,
  type AdultMensesState,
} from '@/lib/ehr/adultPsychIntake';
import { priorEvalHeaderLine } from '@/lib/ehr/adultPsychReEval';
import { noteTypeBadge } from '@/lib/ehr/noteTemplates';
import {
  ChecklistEditor,
  ChoiceChips,
  MultiChips,
  RowsEditor,
  SourceTag,
  TriChips,
  inputCls,
  pillBtn,
  smallBtn,
} from '@/components/notes/structuredNoteUi';

export type ChildUi = {
  commentBox: (heading: string, rows?: number, label?: string) => ReactNode;
  generatedPreview: (heading: string) => ReactNode;
  safetyPlanEditor: ReactNode;
};

type Warning = { message: string; heading: string | null };

const EMPTY_FAMILY: FamilyGrid = { cells: {}, none: false, unknown: false, otherCondition: '' };
const EMPTY_SUBSTANCE: SubstanceGrid = { rows: {}, otherName: '' };
const EMPTY_SUB_ROW: SubstanceRow = { use: '', firstUse: '', lastUse: '', frequency: '' };

export type IntakeVariant = 'child' | 'adult';

export function useChildIntake(input: {
  ctx: StructuredNoteContext | null;
  fromDraft: boolean;
  safetyPlanBlock: string;
  /** 'adult' = Adult Psychiatry Intake (Valant 18771) wording and fields */
  variant?: IntakeVariant;
  /** Saved draft's Header text (restores informants / contact on reopen) */
  savedHeader?: string;
  /**
   * Adult / Child Psychiatry Re-Eval: the prior evaluation used as reference (null = none on file).
   * Omit for the other templates.
   */
  reEval?: { prior: { date: string; noteType: string } | null };
  /** Child Psychiatry Intake (18772): the evaluation type is always "Initial evaluation". */
  initialEval?: boolean;
}) {
  const { ctx, fromDraft, safetyPlanBlock } = input;
  const adult = input.variant === 'adult';

  // Header extras: restored from a saved draft; the adult note starts with the patient as history source
  const [savedExtras] = useState(() => (fromDraft ? parseIntakeHeader(input.savedHeader || '') : null));
  const initialEval = Boolean(input.initialEval);
  const [evalKind, setEvalKind] = useState<EvalKind>(initialEval ? 'Initial evaluation' : savedExtras?.evalKind ?? '');
  const [informants, setInformants] = useState<string[]>(() => savedExtras?.informants ?? (adult && !fromDraft ? [...ADULT_DEFAULT_INFORMANTS] : []));
  const [informantOther, setInformantOther] = useState(savedExtras?.informantOther ?? '');
  /** Child: guardian / informant present. Adult: optional collateral contact. */
  const [guardianName, setGuardianName] = useState(savedExtras?.contactName ?? '');
  const [guardianRel, setGuardianRel] = useState(savedExtras?.contactRelationship ?? '');
  const reEval = Boolean(input.reEval);
  const priorDate = input.reEval?.prior?.date ?? null;
  const priorType = input.reEval?.prior?.noteType ?? null;
  const reEvalPrior = useMemo(() => (priorDate && priorType ? { date: priorDate, noteType: priorType } : null), [priorDate, priorType]);
  // Re-eval: evaluation type defaults to Re-evaluation once a prior evaluation is found (never when
  // none exists: the note is then completed like an initial intake). Clinician can change it.
  const evalKindDefaulted = useRef(fromDraft);
  useEffect(() => {
    if (!reEval || !ctx || evalKindDefaulted.current) return;
    evalKindDefaulted.current = true;
    if (reEvalPrior) setEvalKind((k) => k || 'Re-evaluation');
  }, [reEval, ctx, reEvalPrior]);

  // Histories
  const [inpatient, setInpatient] = useState<RowsState>(EMPTY_ROWS);
  const [outpatient, setOutpatient] = useState<RowsState>(EMPTY_ROWS);
  const [medHx, setMedHx] = useState<RowsState>(EMPTY_ROWS);
  const medHxSeeded = useRef(false);
  useEffect(() => {
    if (!ctx || medHxSeeded.current || fromDraft) return;
    medHxSeeded.current = true;
    if (!ctx.inactiveMedications.length) return;
    setMedHx({
      none: false,
      rows: ctx.inactiveMedications.map((m) => ({
        med: m.name,
        dose: [m.dosage, m.frequency].filter(Boolean).join(' '),
        dates: [isoDate(m.startDate), isoDate(m.stopDate)].filter(Boolean).join(' to '),
        response: '',
        stopped: m.stopReason || '',
        _source: 'chart medication list',
      })),
    });
  }, [ctx, fromDraft]);
  const [suicideHx, setSuicideHx] = useState<HistoryItem>(EMPTY_HISTORY);
  const [abuse, setAbuse] = useState<HistoryItem>(EMPTY_HISTORY);
  const [abuseExtra, setAbuseExtra] = useState<AbuseExtra>({ perpetrator: '', reported: '' });
  const [violence, setViolence] = useState<HistoryItem>(EMPTY_HISTORY);
  const [legal, setLegal] = useState<HistoryItem>(EMPTY_HISTORY);
  const [trauma, setTrauma] = useState<HistoryItem>(EMPTY_HISTORY);
  const [stressors, setStressors] = useState<Checklist>(EMPTY_CHECKLIST);
  const [includeProblems, setIncludeProblems] = useState(!fromDraft);
  const [includeAllergies, setIncludeAllergies] = useState(!fromDraft);
  const [menses, setMenses] = useState<MensesState>(EMPTY_MENSES);
  const [mensesOpen, setMensesOpen] = useState(false);
  const [substance, setSubstance] = useState<SubstanceGrid>(EMPTY_SUBSTANCE);
  const [consequences, setConsequences] = useState<Checklist>(EMPTY_CHECKLIST);
  const [substanceTx, setSubstanceTx] = useState<RowsState>(EMPTY_ROWS);
  const [family, setFamily] = useState<FamilyGrid>(EMPTY_FAMILY);
  const [familyRel, setFamilyRel] = useState<LabeledFields>({});
  const [dev, setDev] = useState<DevState>(EMPTY_DEV);
  const [social, setSocial] = useState<LabeledFields>({});
  const [ros, setRos] = useState<RosState>({});
  const [sourcesOfRisk, setSourcesOfRisk] = useState<Checklist>(EMPTY_CHECKLIST);
  const [riskFactors, setRiskFactors] = useState<Checklist>(EMPTY_CHECKLIST);
  const [protective, setProtective] = useState<Checklist>(EMPTY_CHECKLIST);
  const [adultDev, setAdultDev] = useState<AdultDevState>(EMPTY_ADULT_DEV);
  const [adultMenses, setAdultMenses] = useState<AdultMensesState>(EMPTY_ADULT_MENSES);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>('');
  const [riskRationale, setRiskRationale] = useState('');
  const [planReference, setPlanReference] = useState('');

  const mensesShown = !ctx || mensesApplies(ctx.patient.gender);

  const headerLines = useMemo(
    () =>
      adult
        ? [
            ...(reEval ? [`Evaluation type: ${evalKind || 'Not selected'}`, ctx ? priorEvalHeaderLine(reEvalPrior) : ''].filter(Boolean) : []),
            ...adultHeaderLines({ informants, informantOther, collateralName: guardianName, collateralRelationship: guardianRel }),
          ]
        : childHeaderLines({ evalKind, informants, informantOther, guardianName, guardianRelationship: guardianRel }).flatMap((l, i) =>
            // Child re-eval: the prior evaluation reference follows the evaluation type line
            i === 0 && reEval && ctx ? [l, priorEvalHeaderLine(reEvalPrior)] : [l]
          ),
    [adult, reEval, ctx, reEvalPrior, evalKind, informants, informantOther, guardianName, guardianRel]
  );

  // Adult wording / option lists
  const abuseTypes = adult ? ADULT_ABUSE_TYPES : ABUSE_TYPES;
  const legalTypes = adult ? ADULT_LEGAL_TYPES : LEGAL_TYPES;
  const legalLabel = adult ? 'Client legal history' : 'Legal history';
  const consequenceOptions = adult ? ADULT_SUBSTANCE_CONSEQUENCES : SUBSTANCE_CONSEQUENCES;
  const relatives: readonly string[] = adult ? ADULT_RELATIVES : RELATIVES;
  const familyRelFields = adult ? ADULT_FAMILY_REL_FIELDS : FAMILY_REL_FIELDS;
  const socialFields = adult ? ADULT_SOCIAL_FIELDS : SOCIAL_FIELDS;
  const sourcesOptions = adult ? ADULT_SOURCES_OF_RISK : SOURCES_OF_RISK;
  const riskFactorOptions = adult ? ADULT_SUICIDE_RISK_FACTORS : SUICIDE_RISK_FACTORS;
  const protectiveOptions = adult ? ADULT_SUICIDE_PROTECTIVE_FACTORS : SUICIDE_PROTECTIVE_FACTORS;

  const generated = useMemo<Record<string, string>>(() => {
    const problems = ctx?.problems || [];
    return {
      [CPI.inpatient]: renderRows(INPATIENT_FIELDS, inpatient),
      [CPI.outpatient]: renderRows(OUTPATIENT_FIELDS, outpatient),
      [CPI.suicideHx]: renderHistoryItem('Suicide / self-harm history', suicideHx),
      [CPI.psychMedHx]: renderRows(MED_HX_FIELDS, medHx),
      [CPI.abuse]: renderHistoryItem('Abuse history', abuse, abuse.answer === 'Endorses' ? abuseExtraLines(abuseExtra) : []),
      [CPI.pastMedical]:
        ctx && includeProblems
          ? problems.length
            ? [
                'Problem list:',
                ...problems.map((p) => `- ${[p.code, p.name].filter(Boolean).join(' — ')} (${p.status}${p.onset ? `, onset ${p.onset}` : ''})`),
                'Source: Altrixs problem list.',
              ].join('\n')
            : 'Problem list: None on file'
          : '',
      [CPI.menstruation]: adult ? renderAdultMenses(adultMenses) : renderMenses(menses),
      [CPI.allergies]:
        ctx && includeAllergies
          ? renderAllergies(ctx.allergies)
          : '',
      [CPI.substanceHx]: renderSubstanceGrid(substance),
      [CPI.substanceConsequences]: renderChecklist('Consequences of use', consequences, 'None reported'),
      [CPI.substanceTx]: renderRows(SUBSTANCE_TX_FIELDS, substanceTx),
      [CPI.familyHx]: renderFamilyGrid(family),
      [CPI.familyRelationships]: renderLabeled(familyRelFields, familyRel),
      [CPI.developmental]: adult ? renderAdultDevelopmental(adultDev) : renderDevelopmental(dev),
      [CPI.social]: renderLabeled(socialFields, social),
      [CPI.legal]: renderHistoryItem(legalLabel, legal),
      [CPI.violence]: renderHistoryItem('Violence history', violence),
      // Adult: no Trauma/Stressors section; trauma exposure is written under Stressors
      ...(adult ? {} : { [CPI.trauma]: renderHistoryItem('Trauma history', trauma) }),
      [CPI.stressors]: [
        renderChecklist('Current stressors', stressors, 'None reported'),
        adult ? renderHistoryItem('Trauma exposure', trauma) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      [CPI.ros]: renderRos(ros),
      [CPI.sourcesOfRisk]: renderChecklist('Sources of risk', sourcesOfRisk),
      [CPI.riskFactors]: renderChecklist('Suicide risk factors present', riskFactors),
      [CPI.protectiveFactors]: [
        renderChecklist('Protective factors present', protective),
        renderOverallRisk({ level: riskLevel, rationale: riskRationale, safetyPlanBlock, safetyPlanReference: planReference }),
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }, [
    ctx, inpatient, outpatient, suicideHx, medHx, abuse, abuseExtra, includeProblems, menses, includeAllergies, substance,
    consequences, substanceTx, family, familyRel, dev, social, legal, violence, trauma, stressors, ros, sourcesOfRisk,
    riskFactors, protective, riskLevel, riskRationale, safetyPlanBlock, planReference, adult, adultMenses, adultDev,
    familyRelFields, socialFields, legalLabel,
  ]);

  const warnings: Warning[] = [];
  if ((!adult || reEval) && !evalKind) warnings.push({ message: 'Evaluation type (initial / re-evaluation) not selected.', heading: CPI.header });
  if (!informants.length) warnings.push({ message: 'Informants (who provided history) not documented.', heading: CPI.header });
  if (!riskLevel) warnings.push({ message: 'Overall suicide risk level not chosen.', heading: CPI.protectiveFactors });
  if (adult && pregnancyCaution(adultMenses)) {
    warnings.push({ message: 'Pregnant, possibly pregnant or breastfeeding: review medication safety before prescribing.', heading: CPI.medChanges });
  }

  const emergencyContactNote = (useLabel: string, suffix: string) =>
    ctx?.patient.emergencyContact ? (
      <>
        {' '}Emergency contact on file: {ctx.patient.emergencyContact.name}
        {ctx.patient.emergencyContact.relationship ? ` (${ctx.patient.emergencyContact.relationship})` : ''}
        {ctx.patient.emergencyContact.phone ? `, ${ctx.patient.emergencyContact.phone}` : ''}{suffix}{' '}
        <button
          type="button"
          className="font-semibold text-[#5C2D91] hover:underline"
          onClick={() => {
            setGuardianName(ctx.patient.emergencyContact?.name || '');
            setGuardianRel(ctx.patient.emergencyContact?.relationship || '');
          }}
        >
          {useLabel}
        </button>
      </>
    ) : null;

  const adultHeaderUi = (
    <div className="grid gap-3 sm:grid-cols-2">
      {reEval ? (
        <div className="text-xs font-semibold text-slate-600 sm:col-span-2">
          Evaluation type
          <div className="mt-1">
            <ChoiceChips options={['Initial evaluation', 'Re-evaluation'] as const} value={evalKind} onChange={(v) => setEvalKind(v as EvalKind)} ariaLabel="Evaluation type" />
          </div>
          {ctx ? (
            <p className="mt-1 font-normal text-slate-500">
              {reEvalPrior
                ? `Prior evaluation used as reference: ${reEvalPrior.date} (${noteTypeBadge(reEvalPrior.noteType)}, signed).`
                : 'No prior signed adult psychiatric evaluation on file: complete this note as an initial adult intake.'}
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="text-xs font-semibold text-slate-600 sm:col-span-2">
        History obtained from
        <div className="mt-1">
          <MultiChips options={ADULT_INFORMANTS} values={informants} onChange={setInformants} ariaLabel="History sources" />
        </div>
        {informants.includes('Other') ? (
          <input value={informantOther} onChange={(e) => setInformantOther(e.target.value)} placeholder="Other source" className={`mt-1 ${inputCls}`} />
        ) : null}
      </div>
      <label className="text-xs font-semibold text-slate-600">
        Collateral contact (optional)
        <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="Name" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        Relationship to patient
        <input value={guardianRel} onChange={(e) => setGuardianRel(e.target.value)} placeholder="e.g. Spouse, sibling, guardian" className={`mt-1 ${inputCls}`} />
      </label>
      {ctx?.patient.emergencyContact ? (
        <p className="text-[11px] text-slate-500 sm:col-span-2">{emergencyContactNote('Use as collateral contact', '.')}</p>
      ) : null}
    </div>
  );

  const childHeaderUi = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="text-xs font-semibold text-slate-600">
        Evaluation type
        {initialEval ? (
          <p className="mt-1 font-normal text-slate-700">Initial evaluation (Child Psychiatry Intake)</p>
        ) : (
          <div className="mt-1">
            <ChoiceChips options={['Initial evaluation', 'Re-evaluation'] as const} value={evalKind} onChange={(v) => setEvalKind(v as EvalKind)} ariaLabel="Evaluation type" />
          </div>
        )}
        {reEval && ctx ? (
          <p className="mt-1 font-normal text-slate-500">
            {reEvalPrior
              ? `Prior evaluation used as reference: ${reEvalPrior.date} (${noteTypeBadge(reEvalPrior.noteType)}, signed).`
              : 'No prior signed child psychiatric evaluation on file: complete this note as an initial child evaluation.'}
          </p>
        ) : null}
      </div>
      <div className="text-xs font-semibold text-slate-600">
        History obtained from
        <div className="mt-1">
          <MultiChips options={INFORMANTS} values={informants} onChange={setInformants} ariaLabel="Informants" />
        </div>
        {informants.includes('Other') ? (
          <input value={informantOther} onChange={(e) => setInformantOther(e.target.value)} placeholder="Other informant" className={`mt-1 ${inputCls}`} />
        ) : null}
      </div>
      <label className="text-xs font-semibold text-slate-600">
        Guardian / informant present
        <input value={guardianName} onChange={(e) => setGuardianName(e.target.value)} placeholder="Name" className={`mt-1 ${inputCls}`} />
      </label>
      <label className="text-xs font-semibold text-slate-600">
        Relationship to patient
        <input value={guardianRel} onChange={(e) => setGuardianRel(e.target.value)} placeholder="e.g. Mother, legal guardian" className={`mt-1 ${inputCls}`} />
      </label>
      <p className="text-[11px] text-slate-500 sm:col-span-2">
        Guardian on file: none recorded (the chart does not store a legal guardian).
        {emergencyContactNote('Use as informant', ' — not necessarily the legal guardian.')}
      </p>
    </div>
  );
  const headerUi = adult ? adultHeaderUi : childHeaderUi;

  const historyItem = (label: string, item: HistoryItem, set: (v: HistoryItem) => void, types: string[], extra?: ReactNode) => (
    <div className="space-y-2">
      <TriChips label={label} value={item.answer} onChange={(answer) => set({ ...item, answer })} />
      {item.answer === 'Endorses' ? (
        <div className="space-y-2 rounded-lg border border-rose-100 bg-rose-50/40 p-2.5">
          <MultiChips options={types} values={item.types} onChange={(t) => set({ ...item, types: t })} ariaLabel={`${label} types`} />
          {extra}
          <textarea value={item.details} onChange={(e) => set({ ...item, details: e.target.value })} rows={2} placeholder="Details (dates, context, severity)" className={`${inputCls} resize-y`} />
        </div>
      ) : null}
    </div>
  );

  const labeled = (fields: { key: string; label: string }[], v: LabeledFields, set: (x: LabeledFields) => void) => (
    <div className="grid gap-2 sm:grid-cols-2">
      {fields.map((f) => (
        <label key={f.key} className="text-xs font-semibold text-slate-600">
          {f.label}
          <input value={v[f.key] || ''} onChange={(e) => set({ ...v, [f.key]: e.target.value })} className={`mt-1 ${inputCls}`} />
        </label>
      ))}
    </div>
  );

  const renderBody = (heading: string, ui: ChildUi): ReactNode | null => {
    const tail = (rows = 2, label = 'Additional text') => (
      <>
        {ui.generatedPreview(heading)}
        {ui.commentBox(heading, rows, label)}
      </>
    );
    switch (heading) {
      case CPI.inpatient:
        return (<><RowsEditor fields={INPATIENT_FIELDS} state={inpatient} onChange={setInpatient} addLabel="Add hospitalization" />{tail()}</>);
      case CPI.outpatient:
        return (<><RowsEditor fields={OUTPATIENT_FIELDS} state={outpatient} onChange={setOutpatient} addLabel="Add outpatient treatment" />{tail()}</>);
      case CPI.psychMedHx:
        return (
          <>
            {ctx?.inactiveMedications.length && !fromDraft ? (
              <p className="text-[11px] text-teal-700">Past medications from the chart medication list are pre-listed; edit or remove them.</p>
            ) : null}
            <RowsEditor fields={MED_HX_FIELDS} state={medHx} onChange={setMedHx} addLabel="Add medication trial" />
            {tail()}
          </>
        );
      case CPI.suicideHx:
        return (<>{historyItem('Suicide / self-harm history', suicideHx, setSuicideHx, SUICIDE_HX_TYPES)}{tail()}</>);
      case CPI.abuse:
        return (
          <>
            {historyItem(
              'Abuse history',
              abuse,
              setAbuse,
              abuseTypes,
              <div className="space-y-2">
                <input value={abuseExtra.perpetrator} onChange={(e) => setAbuseExtra({ ...abuseExtra, perpetrator: e.target.value })} placeholder="Perpetrator relationship" className={inputCls} />
                <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-600">
                  Reported to CPS / authorities
                  <ChoiceChips options={['Yes', 'No', 'Unknown'] as const} value={abuseExtra.reported} onChange={(v) => setAbuseExtra({ ...abuseExtra, reported: v })} ariaLabel="Reported to CPS" />
                </div>
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  <span>
                    {adult
                      ? 'If a child or vulnerable adult is currently being abused or neglected, a report may be required (Maryland mandated reporting). This note does not file a report.'
                      : 'Suspected child abuse or neglect must be reported (Maryland mandated reporting). This note does not file a report.'}{' '}
                    <Link href="/dashboard/ehr/mandatory-reporting" target="_blank" className="font-semibold underline">
                      Open Mandatory Reporting
                    </Link>
                  </span>
                </p>
              </div>
            )}
            {tail()}
          </>
        );
      case CPI.violence:
        return (<>{historyItem('Violence history', violence, setViolence, VIOLENCE_TYPES)}{tail()}</>);
      case CPI.legal:
        return (<>{historyItem(legalLabel, legal, setLegal, legalTypes)}{tail()}</>);
      case CPI.trauma:
        return (<>{historyItem('Trauma history', trauma, setTrauma, TRAUMA_TYPES)}{tail()}</>);
      case CPI.stressors:
        return (
          <>
            <ChecklistEditor options={adult ? ADULT_STRESSOR_TYPES : STRESSOR_TYPES} value={stressors} onChange={setStressors} label="Stressors" noneLabel="None reported" />
            {adult ? historyItem('Trauma exposure', trauma, setTrauma, ADULT_TRAUMA_TYPES) : null}
            {tail()}
          </>
        );
      case CPI.pastMedical:
        return (
          <>
            {ctx ? (
              <div className="text-xs text-slate-700">
                {ctx.problems.length ? (
                  <ul className="space-y-0.5">
                    {ctx.problems.map((p, i) => (
                      <li key={`${p.code}-${i}`}>{[p.code, p.name].filter(Boolean).join(' — ')} ({p.status})</li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-slate-500">Problem list: None on file</p>
                )}
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeProblems} onChange={(e) => setIncludeProblems(e.target.checked)} />
                  Include the chart problem list in the note
                </label>
              </div>
            ) : null}
            {tail(3, 'Past medical history')}
          </>
        );
      case CPI.menstruation:
        if (!mensesShown && !mensesOpen) {
          return (
            <p className="text-xs text-slate-500">
              Not applicable by chart sex ({ctx?.patient.gender}).{' '}
              <button type="button" className="font-semibold text-[#5C2D91] hover:underline" onClick={() => setMensesOpen(true)}>
                Document anyway
              </button>
            </p>
          );
        }
        if (adult) {
          const setM = (patch: Partial<AdultMensesState>) => setAdultMenses({ ...adultMenses, ...patch, notApplicable: false });
          return (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-xs font-semibold text-slate-600">LMP<input value={adultMenses.lmp} onChange={(e) => setM({ lmp: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
                <label className="text-xs font-semibold text-slate-600">Contraception<input value={adultMenses.contraception} onChange={(e) => setM({ contraception: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
                <div className="text-xs font-semibold text-slate-600 sm:col-span-2">Pregnancy status<div className="mt-1"><ChoiceChips options={PREGNANCY_STATUS} value={adultMenses.pregnancy} onChange={(v) => setM({ pregnancy: v })} ariaLabel="Pregnancy status" tone={(o) => (o === 'Pregnant' || o === 'Possibly pregnant' ? 'warn' : 'brand')} /></div></div>
                <div className="text-xs font-semibold text-slate-600">Breastfeeding<div className="mt-1"><ChoiceChips options={['Yes', 'No', 'Not assessed'] as const} value={adultMenses.breastfeeding} onChange={(v) => setM({ breastfeeding: v })} ariaLabel="Breastfeeding" tone={(o) => (o === 'Yes' ? 'warn' : 'brand')} /></div></div>
                <div className="text-xs font-semibold text-slate-600">Menopausal status<div className="mt-1"><ChoiceChips options={MENOPAUSE_STATUS} value={adultMenses.menopause} onChange={(v) => setM({ menopause: v })} ariaLabel="Menopausal status" /></div></div>
              </div>
              {pregnancyCaution(adultMenses) ? (
                <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
                  <ShieldAlert size={13} className="mt-0.5 shrink-0" />
                  <span>Review medication safety in pregnancy / lactation before prescribing (Plan - Med Changes).</span>
                </p>
              ) : null}
              <button type="button" aria-pressed={adultMenses.notApplicable} className={pillBtn(adultMenses.notApplicable)} onClick={() => setAdultMenses({ ...EMPTY_ADULT_MENSES, notApplicable: !adultMenses.notApplicable })}>
                Not applicable
              </button>
              {tail()}
            </>
          );
        }
        return (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Menarche (age)<input value={menses.menarche} onChange={(e) => setMenses({ ...menses, menarche: e.target.value, notApplicable: false })} className={`mt-1 ${inputCls}`} /></label>
              <label className="text-xs font-semibold text-slate-600">LMP<input value={menses.lmp} onChange={(e) => setMenses({ ...menses, lmp: e.target.value, notApplicable: false })} className={`mt-1 ${inputCls}`} /></label>
              <div className="text-xs font-semibold text-slate-600">Cycles<div className="mt-1"><ChoiceChips options={['Regular', 'Irregular', 'Not assessed'] as const} value={menses.regular} onChange={(v) => setMenses({ ...menses, regular: v, notApplicable: false })} ariaLabel="Cycles" /></div></div>
              <div className="text-xs font-semibold text-slate-600">Pregnancy history<div className="mt-1"><TriChips label="Pregnancy history" value={menses.pregnancy} onChange={(v) => setMenses({ ...menses, pregnancy: v, notApplicable: false })} /></div></div>
              <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Contraception<input value={menses.contraception} onChange={(e) => setMenses({ ...menses, contraception: e.target.value, notApplicable: false })} className={`mt-1 ${inputCls}`} /></label>
            </div>
            <button type="button" aria-pressed={menses.notApplicable} className={pillBtn(menses.notApplicable)} onClick={() => setMenses({ ...EMPTY_MENSES, notApplicable: !menses.notApplicable })}>
              Not applicable
            </button>
            {tail()}
          </>
        );
      case CPI.allergies:
        return (
          <>
            {ctx ? (
              <div className="text-xs text-slate-700">
                {ctx.allergies.length ? ctx.allergies.map((a, i) => <p key={i}>{a.allergen}{a.reaction ? ` — ${a.reaction}` : ''}</p>) : <p className="text-slate-500">None on file</p>}
                <label className="mt-2 flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#5C2D91]" checked={includeAllergies} onChange={(e) => setIncludeAllergies(e.target.checked)} />
                  Include the chart allergy list in the note
                </label>
              </div>
            ) : null}
            {tail(2, 'Allergy comments')}
          </>
        );
      case CPI.substanceHx:
        return (
          <>
            <div className="space-y-2">
              {SUBSTANCES.map((s) => {
                const r = substance.rows[s] || EMPTY_SUB_ROW;
                const set = (patch: Partial<SubstanceRow>) => setSubstance((g) => ({ ...g, rows: { ...g.rows, [s]: { ...r, ...patch } } }));
                return (
                  <div key={s} className="rounded-lg border border-slate-100 p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="w-40 text-xs font-semibold text-slate-800">
                        {s === 'Other' ? (
                          <input value={substance.otherName} onChange={(e) => setSubstance((g) => ({ ...g, otherName: e.target.value }))} placeholder="Other substance" className="w-36 rounded-lg border border-slate-200 p-1 text-xs" />
                        ) : s}
                      </span>
                      <ChoiceChips options={SUBSTANCE_USE} value={r.use} onChange={(v) => set({ use: v })} ariaLabel={`${s} use`} tone={(o) => (o === 'Current' ? 'bad' : o === 'Never' ? 'good' : 'brand')} />
                    </div>
                    {r.use === 'Past' || r.use === 'Current' ? (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <input value={r.firstUse} onChange={(e) => set({ firstUse: e.target.value })} placeholder="First use (age/date)" aria-label={`${s} first use`} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
                        <input value={r.lastUse} onChange={(e) => set({ lastUse: e.target.value })} placeholder="Last use" aria-label={`${s} last use`} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
                        <input value={r.frequency} onChange={(e) => set({ frequency: e.target.value })} placeholder="Frequency / amount" aria-label={`${s} frequency`} className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className={smallBtn}
              onClick={() => setSubstance((g) => ({ ...g, rows: Object.fromEntries(SUBSTANCES.map((s) => [s, g.rows[s]?.use ? g.rows[s] : { ...EMPTY_SUB_ROW, use: 'Never' as const }])) }))}
            >
              Mark unanswered substances Never
            </button>
            {tail()}
          </>
        );
      case CPI.substanceConsequences:
        return (<><ChecklistEditor options={consequenceOptions} value={consequences} onChange={setConsequences} label="Consequences" noneLabel="None reported" />{tail()}</>);
      case CPI.substanceTx:
        return (<><RowsEditor fields={SUBSTANCE_TX_FIELDS} state={substanceTx} onChange={setSubstanceTx} addLabel="Add treatment episode" />{tail()}</>);
      case CPI.familyHx:
        return (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-slate-500">
                    <th className="py-1 pr-2">Condition</th>
                    {relatives.map((r) => <th key={r} className="px-1 py-1 text-center">{r}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {FAMILY_CONDITIONS.map((c) => (
                    <tr key={c} className="border-t border-slate-50">
                      <td className="py-1 pr-2 font-semibold text-slate-800">
                        {c === 'Other' ? (
                          <input value={family.otherCondition} onChange={(e) => setFamily((f) => ({ ...f, otherCondition: e.target.value }))} placeholder="Other condition" className="w-32 rounded-lg border border-slate-200 p-1 text-xs" />
                        ) : c}
                      </td>
                      {relatives.map((r) => {
                        const on = (family.cells[c] || []).includes(r);
                        return (
                          <td key={r} className="px-1 py-1 text-center">
                            <button
                              type="button"
                              aria-pressed={on}
                              aria-label={`${c}: ${r}`}
                              onClick={() =>
                                setFamily((f) => {
                                  const cur = f.cells[c] || [];
                                  return { ...f, none: false, unknown: false, cells: { ...f.cells, [c]: on ? cur.filter((x) => x !== r) : [...cur, r] } };
                                })
                              }
                              className={`h-9 w-9 rounded-lg border text-xs font-bold focus:outline-none focus:ring-2 focus:ring-[#5C2D91]/30 ${on ? 'border-[#5C2D91] bg-[#5C2D91] text-white' : 'border-slate-200 bg-white text-slate-300 hover:bg-violet-50'}`}
                            >
                              {on ? 'Y' : ''}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={family.none} className={pillBtn(family.none, 'good')} onClick={() => setFamily({ ...EMPTY_FAMILY, none: !family.none })}>None reported</button>
              <button type="button" aria-pressed={family.unknown} className={pillBtn(family.unknown)} onClick={() => setFamily({ ...EMPTY_FAMILY, unknown: !family.unknown })}>Unknown / adopted</button>
            </div>
            {tail()}
          </>
        );
      case CPI.familyRelationships:
        if (adult) return (<>{labeled(ADULT_FAMILY_REL_FIELDS, familyRel, setFamilyRel)}{tail()}</>);
        return (
          <>
            <div className="text-xs font-semibold text-slate-600">
              Custody
              <div className="mt-1">
                <ChoiceChips options={CUSTODY} value={(CUSTODY as readonly string[]).includes(familyRel.custody || '') ? (familyRel.custody as (typeof CUSTODY)[number]) : ''} onChange={(v) => setFamilyRel({ ...familyRel, custody: v })} ariaLabel="Custody" />
              </div>
            </div>
            {labeled(FAMILY_REL_FIELDS.filter((f) => f.key !== 'custody'), familyRel, setFamilyRel)}
            {tail()}
          </>
        );
      case CPI.developmental:
        if (adult) {
          const setD = (patch: Partial<AdultDevState>) => setAdultDev({ ...adultDev, ...patch });
          return (
            <>
              <div className="text-xs font-semibold text-slate-600">
                Childhood development (delays / complications)
                <div className="mt-1">
                  <ChoiceChips options={CHILDHOOD_DEV} value={adultDev.childhood} onChange={(v) => setD({ childhood: v })} ariaLabel="Childhood development" tone={(o) => (o === 'Delays / complications reported' ? 'warn' : 'brand')} />
                </div>
                {adultDev.childhood === 'Delays / complications reported' ? (
                  <input value={adultDev.childhoodDetails} onChange={(e) => setD({ childhoodDetails: e.target.value })} placeholder="Details (prematurity, speech delay, early intervention…)" className={`mt-1 ${inputCls}`} />
                ) : null}
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Highest education level
                <div className="mt-1"><ChoiceChips options={EDUCATION_LEVELS} value={(adultDev.education as (typeof EDUCATION_LEVELS)[number]) || ''} onChange={(v) => setD({ education: v })} ariaLabel="Highest education level" /></div>
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Learning disability / special education history
                <div className="mt-1"><TriChips label="Learning disability / special education" value={adultDev.learning} onChange={(v) => setD({ learning: v })} /></div>
                {adultDev.learning === 'Endorses' ? (
                  <input value={adultDev.learningDetails} onChange={(e) => setD({ learningDetails: e.target.value })} placeholder="Details (IEP, diagnosis, accommodations)" className={`mt-1 ${inputCls}`} />
                ) : null}
              </div>
              <div className="space-y-2 text-xs font-semibold text-slate-600">
                Military service
                <div className="mt-1"><ChoiceChips options={['Yes', 'No'] as const} value={adultDev.military} onChange={(v) => setD({ military: v })} ariaLabel="Military service" /></div>
                {adultDev.military === 'Yes' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-2.5">
                    <ChoiceChips options={MILITARY_BRANCHES} value={(adultDev.branch as (typeof MILITARY_BRANCHES)[number]) || ''} onChange={(v) => setD({ branch: v })} ariaLabel="Branch" />
                    <input value={adultDev.discharge} onChange={(e) => setD({ discharge: e.target.value })} placeholder="Discharge type (e.g. honorable), years of service" aria-label="Discharge" className={inputCls} />
                    <div className="flex flex-wrap items-center gap-2">
                      Combat exposure
                      <ChoiceChips options={['Yes', 'No', 'Unknown'] as const} value={adultDev.combat} onChange={(v) => setD({ combat: v })} ariaLabel="Combat exposure" />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="text-xs font-semibold text-slate-600">
                Current employment
                <div className="mt-1"><ChoiceChips options={EMPLOYMENT_STATUS} value={(adultDev.employment as (typeof EMPLOYMENT_STATUS)[number]) || ''} onChange={(v) => setD({ employment: v })} ariaLabel="Employment" /></div>
                <input value={adultDev.occupation} onChange={(e) => setD({ occupation: e.target.value })} placeholder="Occupation" aria-label="Occupation" className={`mt-1 ${inputCls}`} />
              </div>
              {tail()}
            </>
          );
        }
        return (
          <>
            <div className="text-xs font-semibold text-slate-600">
              Prenatal / birth complications
              <div className="mt-1"><TriChips label="Birth complications" value={dev.birth} onChange={(v) => setDev({ ...dev, birth: v })} /></div>
              {dev.birth === 'Endorses' ? <input value={dev.birthDetails} onChange={(e) => setDev({ ...dev, birthDetails: e.target.value })} placeholder="Details (prematurity, exposures, NICU…)" className={`mt-1 ${inputCls}`} /> : null}
            </div>
            <div className="space-y-1.5">
              {MILESTONE_DOMAINS.map((m) => (
                <div key={m} className="flex flex-wrap items-center gap-2">
                  <span className="w-36 text-xs font-semibold text-slate-700">{m}</span>
                  <ChoiceChips options={MILESTONE_STATUS} value={(dev.milestones[m] as (typeof MILESTONE_STATUS)[number]) || ''} onChange={(v) => setDev({ ...dev, milestones: { ...dev.milestones, [m]: v } })} ariaLabel={`${m} milestones`} tone={(o) => (o === 'Delayed' ? 'warn' : o === 'On time' ? 'good' : 'brand')} />
                </div>
              ))}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">School<input value={dev.school} onChange={(e) => setDev({ ...dev, school: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
              <label className="text-xs font-semibold text-slate-600">Grade<input value={dev.grade} onChange={(e) => setDev({ ...dev, grade: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
            </div>
            <div className="text-xs font-semibold text-slate-600">IEP / 504<div className="mt-1"><ChoiceChips options={SCHOOL_SUPPORTS} value={(dev.supports as (typeof SCHOOL_SUPPORTS)[number]) || ''} onChange={(v) => setDev({ ...dev, supports: v })} ariaLabel="IEP / 504" /></div></div>
            <div className="text-xs font-semibold text-slate-600">Attendance<div className="mt-1"><ChoiceChips options={ATTENDANCE} value={(dev.attendance as (typeof ATTENDANCE)[number]) || ''} onChange={(v) => setDev({ ...dev, attendance: v })} ariaLabel="Attendance" /></div></div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-600">Grades / performance<input value={dev.grades} onChange={(e) => setDev({ ...dev, grades: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
              <label className="text-xs font-semibold text-slate-600">Behavior at school<input value={dev.behavior} onChange={(e) => setDev({ ...dev, behavior: e.target.value })} className={`mt-1 ${inputCls}`} /></label>
            </div>
            {tail()}
          </>
        );
      case CPI.social:
        if (adult) {
          return (
            <>
              <div className="text-xs font-semibold text-slate-600">
                Marital / relationship status
                <div className="mt-1">
                  <ChoiceChips options={MARITAL_STATUS} value={(MARITAL_STATUS as readonly string[]).includes(social.marital || '') ? (social.marital as (typeof MARITAL_STATUS)[number]) : ''} onChange={(v) => setSocial({ ...social, marital: v })} ariaLabel="Marital status" />
                </div>
              </div>
              {labeled(ADULT_SOCIAL_FIELDS.filter((f) => f.key !== 'marital'), social, setSocial)}
              {tail()}
            </>
          );
        }
        return (<>{labeled(SOCIAL_FIELDS, social, setSocial)}{tail()}</>);
      case CPI.ros:
        return (
          <>
            <div className="space-y-1.5">
              {ROS_SYSTEMS.map((sys) => {
                const r = ros[sys] || { value: '' as const, comment: '' };
                return (
                  <div key={sys} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                    <span className="w-44 text-xs font-semibold text-slate-700">{sys}</span>
                    <ChoiceChips options={['Positive', 'Negative'] as const} value={r.value} onChange={(v) => setRos({ ...ros, [sys]: { ...r, value: v } })} ariaLabel={`${sys} review`} tone={(o) => (o === 'Positive' ? 'bad' : 'good')} />
                    {r.value === 'Positive' ? (
                      <input value={r.comment} onChange={(e) => setRos({ ...ros, [sys]: { ...r, comment: e.target.value } })} placeholder="Details" aria-label={`${sys} details`} className="min-h-[36px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs" />
                    ) : null}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              className={smallBtn}
              onClick={() => setRos(Object.fromEntries(ROS_SYSTEMS.map((s) => [s, ros[s]?.value ? ros[s] : { value: 'Negative' as const, comment: '' }])))}
            >
              Mark systems not yet rated Negative (reviewed)
            </button>
            {tail()}
          </>
        );
      case CPI.sourcesOfRisk:
        return (<><ChecklistEditor options={sourcesOptions} value={sourcesOfRisk} onChange={setSourcesOfRisk} label="Sources of risk" />{tail()}</>);
      case CPI.riskFactors:
        return (<><ChecklistEditor options={riskFactorOptions} value={riskFactors} onChange={setRiskFactors} label="Suicide risk factors" />{tail()}</>);
      case CPI.protectiveFactors:
        return (
          <>
            <ChecklistEditor options={protectiveOptions} value={protective} onChange={setProtective} label="Protective factors" />
            <div className="space-y-2 rounded-lg border border-slate-200 p-3">
              <p className="text-xs font-semibold text-slate-700">Overall suicide risk (clinician judgment) *</p>
              <ChoiceChips options={RISK_LEVELS} value={riskLevel} onChange={(v) => setRiskLevel(v as RiskLevel)} ariaLabel="Overall suicide risk" tone={(o) => (o === 'High' ? 'bad' : o === 'Moderate' ? 'warn' : 'good')} />
              <textarea value={riskRationale} onChange={(e) => setRiskRationale(e.target.value)} rows={2} placeholder="Rationale (weighing risk and protective factors)" className={`${inputCls} resize-y`} />
              {riskLevel === 'High' || riskLevel === 'Moderate' ? (
                <div className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/40 p-2.5">
                  <p className="text-xs font-semibold text-rose-700">
                    {riskLevel === 'High' ? 'Required: document the safety plan below, or reference the saved plan.' : 'Recommended: document or reference a safety plan.'} 988 Suicide &amp; Crisis Lifeline (call/text 988).
                  </p>
                  <label className="block text-xs font-semibold text-slate-600">
                    Safety plan reference
                    <input value={planReference} onChange={(e) => setPlanReference(e.target.value)} placeholder={adult ? 'e.g. Safety plan updated today in Safety Plans; copy given to patient' : 'e.g. Safety plan updated today in Safety Plans; copy given to guardian'} className={`mt-1 ${inputCls}`} />
                  </label>
                  {ui.safetyPlanEditor}
                </div>
              ) : null}
            </div>
            {tail()}
          </>
        );
      default:
        return null;
    }
  };

  const aside = (heading: string): ReactNode => {
    if (heading === CPI.pastMedical || heading === CPI.allergies) return ctx ? <SourceTag text={heading === CPI.allergies ? 'chart allergies' : 'chart problem list'} /> : null;
    if (heading === CPI.abuse) {
      return (
        <Link href="/dashboard/ehr/mandatory-reporting" target="_blank" className={smallBtn}>
          Mandatory reporting <ExternalLink size={11} />
        </Link>
      );
    }
    return null;
  };

  return { generated, headerLines, headerUi, renderBody, aside, warnings, riskLevel };
}
