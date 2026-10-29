/**
 * Pure mapping between the Altrixs chart and Rcopia problem / allergy /
 * prescription-event records (no database, no network; fixture-tested).
 */
import { createHash } from 'node:crypto';
import { MAX_NDCS_SENT, allergyNeedsCode } from '@/lib/drugs/types';
import type { RcopiaSendMedication } from '@/lib/services/drfirstCommands';
import {
  ICD10_CM_PATTERN,
  type DownloadedAllergy,
  type DownloadedOfficeVisit,
  type DownloadedPatient,
  type DownloadedProblem,
  type PrescriptionEvent,
} from '@/lib/services/drfirstCommands';

export const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);

// ─── Download cursors ────────────────────────────────────────────────────────

/** Format a Date as an Rcopia LastUpdateDate (MM/DD/YYYY HH:MM:SS, UTC). */
export function formatRcopiaCursor(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/**
 * First-run start for a download with no stored cursor: Rcopia's update_* calls
 * reject a request without LastUpdateDate (bad_parameter "LastUpdateDate or
 * LastUpdateID is required"), so the first sweep starts DRFIRST_SYNC_LOOKBACK_DAYS
 * (default 90) back.
 */
export function firstRunCursor(now: Date = new Date(), lookbackDays: string | undefined = process.env.DRFIRST_SYNC_LOOKBACK_DAYS): string {
  const n = Number.parseInt(lookbackDays?.trim() || '', 10);
  const days = Number.isFinite(n) && n > 0 ? n : 90;
  return formatRcopiaCursor(new Date(now.getTime() - days * 24 * 3600 * 1000));
}

// ─── Problems (send_problem: ICD-10-CM only) ─────────────────────────────────

export interface ProblemToSend { code: string; description: string }

/** "f41.1" / "F411" -> "F41.1"; anything that is not an ICD-10-CM code -> null. */
export function normalizeIcd10(raw: string): string | null {
  let code = raw.trim().toUpperCase();
  if (/^[A-Z][0-9][0-9A-Z][0-9A-Z]{1,4}$/.test(code)) code = `${code.slice(0, 3)}.${code.slice(3)}`;
  return ICD10_CM_PATTERN.test(code) ? code : null;
}

/**
 * The client's diagnoses as send_problem items. Client.secondaryDiagnoses is
 * a comma/semicolon list whose items are a code, optionally followed by a
 * description ("F41.1 - Generalized anxiety disorder"). Items whose leading
 * token is not an ICD-10-CM code are returned in `rejected` (never sent:
 * DrFirst refuses free-text problems). Duplicate codes are sent once.
 */
export function diagnosisProblems(
  client: {
    primaryDiagnosisCode?: string | null;
    primaryDiagnosis?: string | null;
    secondaryDiagnoses?: string | null;
  },
  /** ICD-10 code → description from the diagnosis list (secondary entries are stored as codes only) */
  descriptions?: ReadonlyMap<string, string>
): { problems: ProblemToSend[]; rejected: string[] } {
  const problems: ProblemToSend[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  const add = (rawCode: string, description: string, original: string) => {
    const code = normalizeIcd10(rawCode);
    if (!code) { rejected.push(original.trim().slice(0, 80)); return; }
    if (seen.has(code)) return;
    seen.add(code);
    problems.push({ code, description: description.trim() || descriptions?.get(code)?.trim() || code });
  };

  const primary = client.primaryDiagnosisCode?.trim();
  if (primary) add(primary, client.primaryDiagnosis?.trim() || '', primary);

  for (const item of (client.secondaryDiagnoses || '').split(/[,;\n]/)) {
    const text = item.trim();
    if (!text) continue;
    const m = text.match(/^([A-Za-z0-9.]+)\s*(?:[-–:]\s*)?(.*)$/);
    add(m ? m[1] : text, m ? m[2] : '', text);
  }
  return { problems, rejected };
}

// ─── Allergies (send_allergy free-text / NKA) ────────────────────────────────

export interface ChartAllergy {
  id: string;
  allergen: string;
  reaction: string | null;
  severity: string | null;
  status: string | null;
  source?: string | null;
  /** 'drug' | 'food' | 'environmental' | null (not classified) */
  allergenType?: string | null;
  /** RxNorm code (AUM2), from the drug typeahead or the backfill */
  rxnormId?: string | null;
  rxnormTty?: string | null;
  ndcCodes?: string[] | null;
}

export interface AllergyToSend {
  externalId: string;      // our MedicalAllergy id; Rcopia updates by it on resend
  name: string;
  /** AUM2: RxNorm CUI of a coded drug allergy (ingredient, or a product with its NDCs) */
  rxnormId?: string;
  rxnormTty?: string;
  /** AUR1: up to 10 NDCs, comma-separated (product-level codes only) */
  ndcId?: string;
  reaction?: string;
  severity?: string;       // Rcopia severity word (SNOMED-mapped by sendAllergy)
}

/** Up to MAX_NDCS_SENT NDCs as the comma list send_medication / send_allergy accept (MUR1 / AUR1). */
export function ndcList(ndcs?: string[] | null): string | undefined {
  const list = [...new Set((ndcs || []).map(n => n.trim()).filter(n => /^\d{11}$/.test(n)))].slice(0, MAX_NDCS_SENT);
  return list.length ? list.join(',') : undefined;
}

const NKA_RE = /^(nka|nkda|nkma|no known (drug |medication )?allerg(y|ies)( documented)?)\.?$/i;
const INACTIVE = new Set(['inactive', 'resolved', 'entered in error', 'deleted']);

export const isNoKnownAllergyEntry = (allergen: string) => NKA_RE.test(allergen.trim());

/** Local chart severity -> Rcopia severity word (unknown/unspecified -> none). */
export function toRcopiaSeverity(severity?: string | null): string | undefined {
  const s = (severity || '').toLowerCase();
  if (s.startsWith('severe')) return 'Severe';
  if (s === 'moderate') return 'Moderate';
  if (s === 'mild') return 'Mild';
  return undefined;
}

/** Rcopia severity -> the chart's severity vocabulary. */
export function fromRcopiaSeverity(severity?: string): string {
  const s = (severity || '').toLowerCase();
  if (s.includes('severe') || s.includes('life') || s.includes('fatal')) return 'Severe/Anaphylaxis';
  if (s.includes('moderate')) return 'Moderate';
  if (s.includes('mild')) return 'Mild';
  return 'Unspecified';
}

/**
 * What the chart says about allergies:
 *  - 'list': active, locally-recorded allergies (sent free-text by name);
 *  - 'nka' : the chart explicitly records "No known allergies" and nothing else;
 *  - 'none': no allergy information at all — send nothing (never NKA by default).
 * Rows that came from DrFirst are never echoed back.
 */
export function allergyPlan(rows: ChartAllergy[]): { mode: 'list' | 'nka' | 'none'; allergies: AllergyToSend[] } {
  const active = rows.filter(r => r.source !== 'drfirst' && r.allergen?.trim() && !INACTIVE.has((r.status || '').toLowerCase()));
  const real = active.filter(r => !isNoKnownAllergyEntry(r.allergen));
  if (real.length) {
    return {
      mode: 'list',
      allergies: real.map(r => ({
        externalId: r.id,
        name: r.allergen.trim(),
        // Codes only for drug allergies (or unclassified older rows); food / environmental stay free text
        ...(r.rxnormId?.trim() && (!r.allergenType || r.allergenType === 'drug')
          ? {
              rxnormId: r.rxnormId.trim(),
              ...(r.rxnormTty ? { rxnormTty: r.rxnormTty } : {}),
              ...(ndcList(r.ndcCodes) ? { ndcId: ndcList(r.ndcCodes) } : {}),
            }
          : {}),
        ...(r.reaction?.trim() ? { reaction: r.reaction.trim() } : {}),
        ...(toRcopiaSeverity(r.severity) ? { severity: toRcopiaSeverity(r.severity) } : {}),
      })),
    };
  }
  return { mode: active.length ? 'nka' : 'none', allergies: [] };
}

// ─── What was already sent (ClinicModuleState drfirst:sent:<clientId>) ───────

/**
 * Ledger version of `problems`. Before 2 (Oct 16 2026) send_problem used a flat
 * layout that Rcopia acknowledged with "ok" but never stored, so problems
 * recorded by an older ledger were not actually sent and are sent again.
 */
export const PROBLEM_LEDGER_FORMAT = 2;

export interface SentLedger {
  problems: Record<string, string>;   // ICD-10 code -> sent date
  problemFormat?: number;
  /** ICD-10 code -> fingerprint of the code + description sent (a changed description is resent: DURM4) */
  problemFingerprints?: Record<string, string>;
  allergies: Record<string, string>;  // MedicalAllergy id -> fingerprint of what was sent
  /** MedicalAllergy id -> allergen name sent (needed to delete it in Rcopia after the chart row is gone) */
  allergyNames?: Record<string, string>;
  nka?: string;                        // date NKA was sent
  /** Fingerprint of the send_patient demographics last confirmed by Rcopia (PDUM5: resend only on change) */
  patient?: string;
  /** ClientMedication id -> fingerprint of the send_medication item sent (MUM7) */
  medications?: Record<string, string>;
  /** ClientMedication id -> drug name sent (to delete it in Rcopia after the chart row is gone) */
  medicationNames?: Record<string, string>;
}

export function readLedger(data: unknown): SentLedger {
  const d = (data && typeof data === 'object' ? data : {}) as Partial<SentLedger>;
  const currentProblems = d.problemFormat === PROBLEM_LEDGER_FORMAT;
  const obj = (v: unknown) => (v && typeof v === 'object' ? { ...(v as Record<string, string>) } : undefined);
  return {
    problems: currentProblems && d.problems && typeof d.problems === 'object' ? { ...d.problems } : {},
    problemFormat: PROBLEM_LEDGER_FORMAT,
    ...(currentProblems && obj(d.problemFingerprints) ? { problemFingerprints: obj(d.problemFingerprints) } : {}),
    allergies: d.allergies && typeof d.allergies === 'object' ? { ...d.allergies } : {},
    ...(obj(d.allergyNames) ? { allergyNames: obj(d.allergyNames) } : {}),
    ...(typeof d.nka === 'string' ? { nka: d.nka } : {}),
    ...(typeof d.patient === 'string' ? { patient: d.patient } : {}),
    ...(obj(d.medications) ? { medications: obj(d.medications) } : {}),
    ...(obj(d.medicationNames) ? { medicationNames: obj(d.medicationNames) } : {}),
  };
}

/**
 * Items still to send. Problems are keyed by code and sent with
 * problemExternalId(client, code) as ExternalID, so a resend updates the same
 * Rcopia problem; allergies carry our id as ExternalID and are resent when
 * their content changed. NKA is sent once,
 * and never after real allergies have been sent.
 */
export function pendingSends(
  ledger: SentLedger,
  problems: ProblemToSend[],
  plan: ReturnType<typeof allergyPlan>,
): {
  problems: ProblemToSend[]; allergies: AllergyToSend[]; nka: boolean; unchanged: number;
  /** Codes sent before that the chart no longer has: deleted in Rcopia (DURM3) */
  removedProblems: string[];
  /** MedicalAllergy ids sent before that are no longer active in the chart: deleted in Rcopia (AUM4) */
  removedAllergies: string[];
} {
  const p = problems.filter(x => {
    if (!ledger.problems[x.code]) return true;
    const fp = ledger.problemFingerprints?.[x.code];
    return fp !== undefined && fp !== fingerprint(x);
  });
  const a = plan.allergies.filter(x => ledger.allergies[x.externalId] !== fingerprint(x));
  const nka = plan.mode === 'nka' && !ledger.nka && Object.keys(ledger.allergies).length === 0;
  const unchanged = (problems.length - p.length) + (plan.allergies.length - a.length) + (plan.mode === 'nka' && !nka ? 1 : 0);
  const current = new Set(problems.map(x => x.code));
  const activeAllergies = new Set(plan.allergies.map(x => x.externalId));
  return {
    problems: p, allergies: a, nka, unchanged,
    removedProblems: Object.keys(ledger.problems).filter(code => !current.has(code)),
    removedAllergies: Object.keys(ledger.allergies).filter(id => !activeAllergies.has(id)),
  };
}

// ─── Medications (send_medication: local chart medications) ──────────────────

/** Prefix of the ExternalID Altrixs gives the chart medications it sends (unique per practice: GM3). */
export const MEDICATION_EXTERNAL_PREFIX = 'altrixs-med-';

export interface ChartMedication {
  id: string;
  medicationName: string;
  dosage: string | null;
  route: string | null;
  frequency: string | null;
  instructions: string | null;
  indication?: string | null;
  startDate: Date | null;
  endDate: Date | null;
  stopDate: Date | null;
  stopReason: string | null;
  active: boolean;
  status: string | null;
  source: string | null;
  rcopiaMedId: string | null;
  drugName: string | null;
  brandName: string | null;
  genericName: string | null;
  ndcCode: string | null;
  rxnormId: string | null;
  action: string | null;
  dose: string | null;
  doseUnit: string | null;
  quantity: string | null;
  refills: string | null;
  asNeeded: boolean;
  prnReason: string | null;
  schedule: string | null;
  updatedAt: Date;
  // RxNav codification (MUM2-MUM4 / MUR1): set together when the drug was chosen in the typeahead or backfilled
  rxnormTty?: string | null;
  doseForm?: string | null;
  strength?: string | null;
  ndcCodes?: string[] | null;
  drugCodedAt?: Date | null;
}

const DOSE_FORMS = ['extended-release tablet', 'delayed-release capsule', 'extended-release capsule', 'orally disintegrating tablet',
  'chewable tablet', 'tablet', 'capsule', 'oral solution', 'oral suspension', 'solution', 'suspension', 'injection', 'patch',
  'cream', 'ointment', 'inhaler', 'spray', 'syrup', 'drops', 'film', 'lozenge', 'suppository', 'powder', 'gel'];

/** Dose form named in the chart's medication text ("sertraline 50 mg tablet" -> "tablet"); never guessed. */
export function doseFormOf(...texts: (string | null | undefined)[]): string | undefined {
  const t = texts.filter(Boolean).join(' ').toLowerCase();
  return DOSE_FORMS.find(f => new RegExp(`\\b${f.replace(/-/g, '[- ]')}s?\\b`).test(t));
}

/** Strength in the chart's text ("50 mg", "0.5 mg/mL"); never guessed. */
export function strengthOf(...texts: (string | null | undefined)[]): string | undefined {
  const m = texts.filter(Boolean).join(' ').match(/\b(\d+(?:\.\d+)?\s?(?:mg|mcg|g|mL|units?|%|meq)(?:\s?\/\s?(?:\d+(?:\.\d+)?\s?)?(?:mL|hr|actuation|g))?)(?![A-Za-z])/i);
  return m ? m[1].replace(/\s+/g, ' ') : undefined;
}

const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : undefined);

/** Coded from RxNav: RxCUI + RxNorm name parts + form + strength all on the record (MUM4). */
export const isRxNavCoded = (m: Pick<ChartMedication, 'rxnormId' | 'drugCodedAt' | 'doseForm' | 'strength' | 'genericName' | 'brandName'>) =>
  Boolean(m.drugCodedAt && m.rxnormId?.trim() && m.doseForm?.trim() && m.strength?.trim() && (m.genericName?.trim() || m.brandName?.trim()));

/**
 * A local chart medication -> send_medication item. MUM2 / MUM4: sent as a CODED drug when it was coded
 * from RxNav (RxCUI + TTY, brand / generic name, RxNorm form and strength, up to 10 NDCs: MUR1), or when an
 * older record has an RxNorm / NDC code AND its form and strength can be read from its text; otherwise it
 * is sent free-text (uncoded, with the mandatory schedule / supply / compound flags). Inactive medications
 * carry a past StopDate (Rcopia otherwise shows them as active). Sig text is expanded from Latin by
 * sendMedication (MUM5).
 */
export function chartMedicationToRcopia(m: ChartMedication, now = new Date()): RcopiaSendMedication {
  if (isRxNavCoded(m)) {
    const base = chartMedicationBase(m, now);
    // ExternalID first, then the drug, then the sig (stable key order: the fingerprint is JSON)
    return { externalId: base.externalId, ...rxnavDrug(m), ...base };
  }
  const name = (m.drugName || m.medicationName || '').trim();
  const strength = strengthOf(m.dosage, m.drugName, m.medicationName);
  const form = doseFormOf(m.drugName, m.medicationName, m.dosage);
  const coded = Boolean((m.rxnormId?.trim() || m.ndcCode?.trim()) && strength && form);
  return {
    externalId: `${MEDICATION_EXTERNAL_PREFIX}${m.id}`,
    ...(m.brandName?.trim() ? { brandName: m.brandName.trim() } : {}),
    ...(m.genericName?.trim() || !m.brandName?.trim() ? { genericName: (m.genericName?.trim() || name) } : {}),
    ...(coded && m.rxnormId?.trim() ? { rxnormId: m.rxnormId.trim() } : {}),
    ...(coded && !m.rxnormId?.trim() && m.ndcCode?.trim() ? { ndcId: m.ndcCode.trim() } : {}),
    ...(strength ? { strength } : {}),
    ...(form ? { form } : {}),
    ...(!coded ? { schedule: (['2', '3', '4', '5'].includes(m.schedule || '') ? m.schedule : 'nonscheduled') as RcopiaSendMedication['schedule'] } : {}),
    ...chartMedicationBase(m, now),
  };
}

/** Drug fields of an RxNav-coded medication: codes + Name (brand / generic), Form, Strength (MUM2 / MUM4 / MUR1). */
function rxnavDrug(m: ChartMedication): Partial<RcopiaSendMedication> {
  return {
    ...(m.brandName?.trim() ? { brandName: m.brandName.trim() } : {}),
    ...(m.genericName?.trim() ? { genericName: m.genericName.trim() } : {}),
    rxnormId: m.rxnormId!.trim(),
    ...(m.rxnormTty?.trim() ? { rxnormIdType: m.rxnormTty.trim() } : {}),
    ...(ndcList(m.ndcCodes) ? { ndcId: ndcList(m.ndcCodes) } : {}),
    form: m.doseForm!.trim(),
    strength: m.strength!.trim(),
  };
}

/** ExternalID, sig, quantity, dates: the same for coded and free-text medications. */
function chartMedicationBase(m: ChartMedication, now: Date): RcopiaSendMedication {
  const inactive = !m.active || /discontinued|inactive|stopped|completed/i.test(m.status || '');
  const stop = m.stopDate || m.endDate || (inactive ? m.updatedAt : null);
  const yesterday = new Date(now.getTime() - 86_400_000);
  const stopDate = inactive && stop ? (stop > now ? yesterday : stop) : !inactive && m.endDate && m.endDate > now ? m.endDate : undefined;
  return {
    externalId: `${MEDICATION_EXTERNAL_PREFIX}${m.id}`,
    ...(m.action?.trim() ? { action: m.action.trim() } : {}),
    ...(m.dose?.trim() ? { dose: m.dose.trim() } : {}),
    ...(m.doseUnit?.trim() ? { doseUnit: m.doseUnit.trim() } : {}),
    ...(m.route?.trim() ? { route: m.route.trim() } : {}),
    ...(m.frequency?.trim() ? { doseTiming: m.frequency.trim() } : {}),
    ...(m.asNeeded ? { asNeeded: true, doseOther: m.prnReason?.trim() || 'as needed' } : {}),
    // MUR2: free-text instructions only when no discrete sig field carries them
    ...(m.instructions?.trim() && !(m.action || m.dose || m.frequency) ? { patientNotes: m.instructions.trim() } : {}),
    ...(m.quantity?.trim() ? { quantity: m.quantity.trim() } : {}),
    ...(m.refills?.trim() ? { refills: m.refills.trim() } : {}),
    ...(dayOf(m.startDate) ? { startDate: dayOf(m.startDate) } : {}),
    ...(stopDate ? { stopDate: dayOf(stopDate) } : {}),
    ...(inactive && m.stopReason?.trim() ? { stopReason: m.stopReason.trim() } : {}),
    ...(m.source === 'reported' ? { historySource: 'patient' } : {}),
  };
}

// ─── Codification readiness (DrFirst panel) ──────────────────────────────────

export interface CodificationReadiness {
  /** Active local medications (the ones Altrixs sends) */
  medicationsActive: number;
  /** ... of which DrFirst receives as free text (no code with name, form and strength: MUM2 / MUM4) */
  medicationsUncoded: number;
  /** Active local allergies that are drug (or not yet classified) with no RxNorm code (AUM2) */
  allergiesUncoded: number;
  uncodedMedications: { id: string; name: string }[];
  uncodedAllergies: { id: string; name: string; allergenType: string | null }[];
}

export function codificationReadiness(meds: ChartMedication[], allergies: ChartAllergy[]): CodificationReadiness {
  const active = meds.filter(m => !m.rcopiaMedId && (m.drugName || m.medicationName || '').trim()
    && m.active && !/discontinued|inactive|stopped|completed/i.test(m.status || ''));
  const uncodedMeds = active.filter(m => {
    const sent = chartMedicationToRcopia(m);
    return !sent.rxnormId && !sent.ndcId && !sent.fdbMedId;
  });
  const uncodedAllergies = allergies.filter(a => allergyNeedsCode(a));
  return {
    medicationsActive: active.length,
    medicationsUncoded: uncodedMeds.length,
    allergiesUncoded: uncodedAllergies.length,
    uncodedMedications: uncodedMeds.map(m => ({ id: m.id, name: (m.drugName || m.medicationName).trim() + (m.dosage?.trim() ? ` ${m.dosage.trim()}` : '') })),
    uncodedAllergies: uncodedAllergies.map(a => ({ id: a.id, name: a.allergen.trim(), allergenType: a.allergenType ?? null })),
  };
}

/** Which local medications to send (new / changed: MUM7) and which sent ones disappeared from the chart (deleted). */
export function pendingMedicationSends(
  ledger: SentLedger,
  items: { id: string; med: RcopiaSendMedication }[],
): { send: { id: string; med: RcopiaSendMedication; fingerprint: string }[]; removed: string[]; unchanged: number } {
  const sent = ledger.medications || {};
  const withFp = items.map(i => ({ ...i, fingerprint: fingerprint(i.med) }));
  const send = withFp.filter(i => sent[i.id] !== i.fingerprint);
  const present = new Set(items.map(i => i.id));
  return { send, removed: Object.keys(sent).filter(id => !present.has(id)), unchanged: items.length - send.length };
}

// ─── Downloads ───────────────────────────────────────────────────────────────

/**
 * update_allergy row -> MedicalAllergy fields. `null` = nothing to store
 * (no allergen name / no Rcopia id). Deleted or inactive in Rcopia -> Inactive
 * (rows are never deleted).
 */
export function mapDownloadedAllergy(a: DownloadedAllergy): {
  allergen: string; reaction: string | null; severity: string; status: string; rcopiaAllergyId: string;
} | null {
  const allergen = a.allergenName?.trim();
  if (!a.rcopiaId || !allergen) return null;
  const inactive = a.deleted || /inactive|resolved|deleted/i.test(a.status || '');
  return {
    allergen,
    reaction: a.reactions.length ? a.reactions.join(', ').slice(0, 500) : null,
    severity: fromRcopiaSeverity(a.severity),
    status: inactive ? 'Inactive' : 'Active',
    rcopiaAllergyId: a.rcopiaId,
  };
}

/** Chart payload for one update_prescription_events row (ids, codes and dates; no demographics). */
export function prescriptionEventPayload(e: PrescriptionEvent): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source: 'drfirst',
    prescriptionRcopiaId: e.rcopiaId,
    ...(e.externalId ? { externalId: e.externalId } : {}),
    ...(e.prescriberOrderNumber ? { prescriberOrderNumber: e.prescriberOrderNumber } : {}),
    ...(e.status ? { status: e.status } : {}),
    ...(e.needsSigningBy ? { needsSigningBy: e.needsSigningBy } : {}),
    ...(e.error ? { error: e.error } : {}),
    ...(e.sendMethod ? { sendMethod: e.sendMethod } : {}),
    ...(e.sendDate ? { sendDate: e.sendDate } : {}),
    ...(e.transmissionEvents.length ? { transmissionEvents: e.transmissionEvents } : {}),
    ...(e.cancellation ? { cancellation: e.cancellation } : {}),
    ...(e.rxChange ? { rxChange: e.rxChange } : {}),
    ...(e.pdmpReports.length ? { pdmpReports: e.pdmpReports } : {}),
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

// ─── Problems: identifiers + update_problem rows ─────────────────────────────

/** Prefix of the ExternalID Altrixs gives the chart diagnoses it sends with send_problem. */
export const PROBLEM_EXTERNAL_PREFIX = 'altrixs-dx-';

/** Stable per-practice ExternalID for one chart diagnosis (resend = update, not duplicate). */
export function problemExternalId(clientId: string, code: string): string {
  return `${PROBLEM_EXTERNAL_PREFIX}${clientId}-${code}`;
}

/** Rcopia date (MM/DD/YYYY[ HH:MM:SS[ TZ]]) -> Date at UTC midnight; empty / invalid -> null (never "now"). */
export function rcopiaDate(v?: string | null): Date | null {
  const m = (v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const month = Number(m[1]) - 1;
  const d = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  return d.getUTCMonth() === month && d.getUTCDate() === Number(m[2]) ? d : null;
}

export interface MappedProblem {
  icd10Code: string;            // '' when Rcopia sent an ICD-9 / SNOMED-only problem (never converted)
  name: string;
  description: string | null;
  status: 'Active' | 'Resolved' | 'Inactive';
  onsetDate: Date | null;
  notes: string | null;
  rcopiaProblemId: string;
}

/**
 * update_problem row -> MedicalProblem fields (source 'drfirst'). `null` = nothing
 * to store (no Rcopia id, or neither code nor description). Codes are copied as
 * sent: a valid ICD-10-CM code goes in icd10Code; an ICD-9 / SNOMED code is kept
 * in the notes with its code system and icd10Code stays empty (no crosswalk is
 * guessed). Deleted in Rcopia -> Inactive; resolved -> Resolved; never deleted.
 */
export function mapDownloadedProblem(p: DownloadedProblem): MappedProblem | null {
  if (!p.rcopiaId) return null;
  const code = (p.code || '').trim().toUpperCase();
  const description = (p.description || '').trim();
  if (!code && !description) return null;
  const isIcd10 = p.codeSystem === 'ICD10' && ICD10_CM_PATTERN.test(code);
  const status: MappedProblem['status'] = p.deleted || /delet|inactive/.test(p.status || '')
    ? 'Inactive'
    : /resolv/.test(p.status || '') ? 'Resolved' : 'Active';
  const otherCode = !isIcd10 && code ? `${p.codeSystem === 'ICD9' ? 'ICD-9-CM' : p.codeSystem || 'Code'} ${code}` : '';
  return {
    icd10Code: isIcd10 ? code : '',
    name: (description || code).slice(0, 300),
    description: description || null,
    status,
    onsetDate: rcopiaDate(p.onsetDate),
    notes: [otherCode && `${otherCode} (recorded in DrFirst)`, p.deleted ? 'Removed from the DrFirst problem list' : '']
      .filter(Boolean).join('; ') || null,
    rcopiaProblemId: p.rcopiaId,
  };
}

// ─── update_patient: link confirmation + demographic review ──────────────────

export interface ChartDemographics {
  id: string;
  rcopiaPatientId: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  postalCode: string | null;
}

const norm = (v?: string | null) => (v || '').trim().toLowerCase().replace(/\s+/g, ' ');
const sexOf = (v?: string | null): 'm' | 'f' | '' => {
  const s = norm(v);
  if (s === 'm' || s === 'male') return 'm';
  if (s === 'f' || s === 'female') return 'f';
  return '';
};
const isoDay = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');

export type ReviewField = 'firstName' | 'lastName' | 'dateOfBirth' | 'sex' | 'zip';

export interface PatientReview {
  /** set when the chart has no Rcopia id yet (or only the client-id placeholder) and Rcopia confirmed one */
  linkRcopiaId?: string;
  /** chart is linked to a different Rcopia patient than the one carrying our external id */
  linkConflict?: { chartRcopiaId: string; drfirstRcopiaId: string };
  deletedInDrFirst?: boolean;
  /** fields where Rcopia differs from the chart, with the DrFirst value for staff to reconcile */
  differences: { field: ReviewField; drfirst: string }[];
}

/**
 * Compare an update_patient row with the chart. Chart demographics are never
 * changed from this: only the Rcopia id link is confirmed, and every other
 * difference becomes a review item. Fields are compared only when both sides
 * have a value.
 */
export function patientReview(chart: ChartDemographics, p: DownloadedPatient): PatientReview {
  const out: PatientReview = { differences: [] };
  if (p.rcopiaId && p.externalId === chart.id) {
    const current = chart.rcopiaPatientId;
    if (!current || current === chart.id) out.linkRcopiaId = p.rcopiaId;
    else if (current !== p.rcopiaId) out.linkConflict = { chartRcopiaId: current, drfirstRcopiaId: p.rcopiaId };
  }
  if (p.deleted) out.deletedInDrFirst = true;
  const diff = (field: ReviewField, chartValue: string, drValue: string, shown: string) => {
    if (chartValue && drValue && chartValue !== drValue) out.differences.push({ field, drfirst: shown });
  };
  diff('firstName', norm(chart.legalFirstName), norm(p.firstName), (p.firstName || '').trim());
  diff('lastName', norm(chart.legalLastName), norm(p.lastName), (p.lastName || '').trim());
  const dob = rcopiaDate(p.dob);
  diff('dateOfBirth', isoDay(chart.dateOfBirth), isoDay(dob), isoDay(dob));
  diff('sex', sexOf(chart.gender), sexOf(p.sex), sexOf(p.sex).toUpperCase());
  const zip = (v?: string | null) => (v || '').replace(/\D/g, '').slice(0, 5);
  diff('zip', zip(chart.postalCode), zip(p.zip), zip(p.zip));
  return out;
}

/** True when an Rcopia patient matches the chart on last name + date of birth (patient lookup). */
export function matchesNameAndDob(chart: { legalLastName: string | null; dateOfBirth: Date | null }, p: DownloadedPatient): boolean {
  const dob = rcopiaDate(p.dob);
  return Boolean(chart.legalLastName?.trim() && chart.dateOfBirth && dob)
    && norm(chart.legalLastName) === norm(p.lastName)
    && isoDay(chart.dateOfBirth) === isoDay(dob);
}

/** Review-item payload (ClinicalEvent drfirst-patient-review); null when there is nothing to review. */
export function patientReviewPayload(rcopiaId: string, r: PatientReview): Record<string, unknown> | null {
  if (!r.linkConflict && !r.deletedInDrFirst && !r.differences.length) return null;
  const payload: Record<string, unknown> = {
    source: 'drfirst',
    patientRcopiaId: rcopiaId,
    ...(r.linkConflict ? { linkConflict: r.linkConflict } : {}),
    ...(r.deletedInDrFirst ? { deletedInDrFirst: true } : {}),
    differences: r.differences,
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

// ─── Office visits ───────────────────────────────────────────────────────────

/** Prefix of the ExternalID Altrixs gives the visits it sends (send_patient_office_visits). */
export const VISIT_EXTERNAL_PREFIX = 'altrixs-appt-';

/** Chart payload for one downloaded office visit (ids, dates, provider username; no demographics). */
export function officeVisitPayload(v: DownloadedOfficeVisit): Record<string, unknown> {
  const fromAltrixs = Boolean(v.externalId?.startsWith(VISIT_EXTERNAL_PREFIX));
  const payload: Record<string, unknown> = {
    source: 'drfirst',
    visitRcopiaId: v.rcopiaId,
    origin: fromAltrixs ? 'altrixs' : 'drfirst',
    ...(v.externalId ? { externalId: v.externalId } : {}),
    ...(fromAltrixs ? { appointmentId: v.externalId!.slice(VISIT_EXTERNAL_PREFIX.length) } : {}),
    ...(v.visitDate ? { visitDate: v.visitDate } : {}),
    ...(v.transitionOfCareDate ? { transitionOfCareDate: v.transitionOfCareDate } : {}),
    ...(v.renderingProviderUsername ? { renderingProviderUsername: v.renderingProviderUsername } : {}),
    deleted: v.deleted,
  };
  return { ...payload, fingerprint: fingerprint(payload) };
}

/** Visit date (YYYY-MM-DD) of an appointment in the clinic's time zone. */
export function clinicVisitDate(at: Date, timeZone = 'America/New_York'): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** send_patient_office_visits fields for a completed appointment; null when the appointment has no valid start. */
export function appointmentOfficeVisit(a: { appointmentId: string; startsAt: Date | null; clinicianRcopiaUsername: string | null }): {
  externalId: string; visitDate: string; renderingProviderUsername?: string;
} | null {
  if (!a.startsAt || Number.isNaN(a.startsAt.getTime())) return null;
  const username = a.clinicianRcopiaUsername?.trim();
  return {
    externalId: `${VISIT_EXTERNAL_PREFIX}${a.appointmentId}`,
    visitDate: clinicVisitDate(a.startsAt),
    ...(username ? { renderingProviderUsername: username } : {}),
  };
}
