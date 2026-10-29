/**
 * TMS case workflow (owner's TMS steps, Oct 27 2026). Pure and client-safe: the TMS page, the TMS
 * workflow APIs, the billing hand-off task and the tests share these rules.
 *
 * Owner's steps:
 *  1. Identify referral: a referral + intake packet from another provider -> review the packet, then
 *     insurance verification; no referral -> schedule medication management first (TMS intake docs).
 *  2. Intake packet: referral, PHQ-9, medication history, proof of diagnosis (+ consents).
 *  3. Information transfer: insurance information to the billing team (hand-off task).
 *  4. Verify & authorize: billing verifies and identifies any authorization needed.
 *  5. Schedule: psychiatrist / NP (the necessary provider), then 5 days a week, 20 minutes a day.
 *  6. TMS appointment: the patient receives TMS.
 *
 * Nothing here is payer or clinical data the owner did not give. Payer prescriber rules are
 * practice settings seeded from the owner's list only (OWNER_PAYER_RULE_SEEDS); the session count
 * comes from the authorization or the prescriber's order, never a built-in number.
 */
import type { StaffRole } from '@/types/roles';
import { normalizeUserRoles } from '@/lib/auth/userRoles';

// ─── Stages ──────────────────────────────────────────────────────────────────

export const TMS_STAGES = [
  { value: 'referral', label: 'Referral' },
  { value: 'intake_packet', label: 'Intake packet' },
  { value: 'insurance_sent', label: 'Insurance sent to billing' },
  { value: 'verification', label: 'Verification / authorization' },
  { value: 'evaluation', label: 'Evaluation & consent' },
  { value: 'scheduled', label: 'Scheduled course' },
  { value: 'in_treatment', label: 'In treatment' },
  { value: 'completed', label: 'Completed' },
  { value: 'discontinued', label: 'Discontinued' },
] as const;
export type TmsStage = (typeof TMS_STAGES)[number]['value'];
export const TMS_STAGE_VALUES = TMS_STAGES.map((s) => s.value) as TmsStage[];

export function isTmsStage(v: unknown): v is TmsStage {
  return typeof v === 'string' && (TMS_STAGE_VALUES as string[]).includes(v);
}

export function stageLabel(v: string | null | undefined): string {
  return TMS_STAGES.find((s) => s.value === v)?.label ?? 'Referral';
}

export type StageEntry = { stage: TmsStage; at: string; byId?: string | null; byName?: string | null };

/** Whole days in the current stage (practice dates are close enough for a tracker). */
export function daysInStage(enteredAt: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!enteredAt) return null;
  const t = new Date(enteredAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
}

/** Days spent in each stage from the history (the last stage runs to `now`). */
export function stageDurations(history: readonly StageEntry[], now: Date = new Date()): { stage: TmsStage; enteredAt: string; days: number }[] {
  return history.map((h, i) => {
    const end = i + 1 < history.length ? new Date(history[i + 1].at) : now;
    return { stage: h.stage, enteredAt: h.at, days: Math.max(0, Math.floor((end.getTime() - new Date(h.at).getTime()) / 86_400_000)) };
  });
}

// ─── Referral + intake packet ────────────────────────────────────────────────

export const TMS_PACKET_ITEMS = [
  { key: 'referral', label: 'Referral from the provider' },
  { key: 'phq9', label: 'PHQ-9' },
  { key: 'medHistory', label: 'Medication history' },
  { key: 'proofOfDx', label: 'Proof of diagnosis' },
  { key: 'consents', label: 'Consent forms (incl. TMS informed consent)' },
] as const;

/** The consent library template for TMS (src/lib/consents/library/proposed.ts): the packet "consents" item and the evaluation consent gate link to it. */
export const TMS_CONSENT_TEMPLATE_KEY = 'tms-informed-consent';

export function tmsConsentHref(clientId: string): string {
  return `/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}?template=${TMS_CONSENT_TEMPLATE_KEY}`;
}
export type TmsPacketKey = (typeof TMS_PACKET_ITEMS)[number]['key'];
export type TmsPacket = Partial<Record<TmsPacketKey, boolean>>;

export function packetMissing(p: TmsPacket | null | undefined): string[] {
  return TMS_PACKET_ITEMS.filter((i) => !p?.[i.key]).map((i) => i.label);
}

/** external = referral + packet from another provider; none = schedule medication management first. */
export type TmsReferralSource = 'external' | 'none';

/** The next action for the referral step. */
export function referralNextStep(source: TmsReferralSource | null | undefined, medMgmtBooked: boolean): string {
  if (source === 'external') return 'Review the intake packet for all documents and consent forms, then send insurance to billing.';
  if (source === 'none') {
    return medMgmtBooked
      ? 'Medication management visit booked: the TMS intake documents are completed there.'
      : 'No referral or intake packet: schedule medication management first to complete the TMS intake documents.';
  }
  return 'Record whether the patient has a referral and intake packet from another provider.';
}

// ─── Payer prescriber rule ───────────────────────────────────────────────────

export const TMS_PRESCRIBER_RULES = [
  { value: 'psychiatrist_only', label: 'Psychiatrist only' },
  { value: 'psychiatrist_or_np', label: 'Psychiatrist or NP' },
  { value: 'plan_specific', label: 'Plan specific (verify with the plan)' },
] as const;
export type TmsPrescriberRule = (typeof TMS_PRESCRIBER_RULES)[number]['value'];
export const TMS_PRESCRIBER_RULE_VALUES = TMS_PRESCRIBER_RULES.map((r) => r.value) as TmsPrescriberRule[];

export function prescriberRuleLabel(v: string | null | undefined): string {
  return TMS_PRESCRIBER_RULES.find((r) => r.value === v)?.label ?? 'No rule on file';
}

export type TmsPayerRuleRow = {
  payerKey: string;
  payerLabel: string;
  /** Case-insensitive words / phrases matched against the client's payer name */
  matchTerms: string[];
  /** Client.insuranceType / PayerRegistry.payerType values that also match (e.g. medicare) */
  payerTypes: string[];
  rule: TmsPrescriberRule;
  note?: string | null;
  active?: boolean;
  /** Payer minimum number of failed / not-tolerated antidepressant trials; null = not set (no pass / fail) */
  minFailedTrials?: number | null;
};

export const OWNER_RULE_SOURCE = 'owner_2026_10_27';
/** Seeds upgraded with the Maryland Medicaid / HealthChoice terms (Oct 28 2026). */
export const OWNER_RULE_SOURCE_V2 = 'owner_2026_10_28';

/**
 * Maryland Medicaid: specialty behavioral health (including TMS) is administered through the ASO,
 * Carelon Behavioral Health of Maryland, not the HealthChoice MCOs. The MCO names match the Medicaid
 * rule so a client on e.g. "UnitedHealthcare Community Plan" is not read as commercial UHC.
 */
export const MD_MEDICAID_MATCH_TERMS = [
  'medicaid',
  'maryland medicaid',
  'medical assistance',
  'healthchoice',
  'carelon',
  'aetna better health',
  'aetna better health of maryland',
  'carefirst community health plan',
  'carefirst community health plan maryland',
  'jai medical systems',
  'kaiser permanente medicaid',
  'maryland physicians care',
  'medstar family choice',
  'priority partners',
  'unitedhealthcare community plan',
  'united healthcare community plan',
  'uhc community plan',
  'wellpoint maryland',
] as const;

/**
 * The owner's list (Oct 27 2026), seeded as editable practice settings. Nothing else is seeded.
 * Aetna: psychiatrist or NP. Medicare: psychiatrist only. CareFirst BCBS, Cigna, Medicaid,
 * UnitedHealthcare: plan specific. Match terms are the payer names (Medicaid adds the Maryland
 * Medicaid / HealthChoice names above; Medicaid / Medicare also match on the client's insurance type).
 * No payer minimum for failed trials is seeded (staff enter it from the plan's policy).
 */
export const OWNER_PAYER_RULE_SEEDS: readonly TmsPayerRuleRow[] = [
  { payerKey: 'aetna', payerLabel: 'Aetna', matchTerms: ['aetna'], payerTypes: [], rule: 'psychiatrist_or_np' },
  { payerKey: 'medicare', payerLabel: 'Medicare', matchTerms: ['medicare'], payerTypes: ['medicare'], rule: 'psychiatrist_only' },
  { payerKey: 'carefirst', payerLabel: 'CareFirst BCBS', matchTerms: ['carefirst'], payerTypes: [], rule: 'plan_specific' },
  { payerKey: 'cigna', payerLabel: 'Cigna', matchTerms: ['cigna'], payerTypes: [], rule: 'plan_specific' },
  { payerKey: 'medicaid', payerLabel: 'Medicaid', matchTerms: [...MD_MEDICAID_MATCH_TERMS], payerTypes: ['medicaid'], rule: 'plan_specific' },
  { payerKey: 'uhc', payerLabel: 'UnitedHealthcare', matchTerms: ['unitedhealthcare', 'united healthcare', 'uhc'], payerTypes: [], rule: 'plan_specific' },
];

/** Display-only hints per payer rule key. */
export const TMS_PAYER_RULE_HINTS: Readonly<Record<string, string>> = Object.freeze({
  medicaid: 'Prior authorization through Carelon Behavioral Health (ASO)',
});

export function payerRuleHint(payerKey: string | null | undefined): string | null {
  return (payerKey && TMS_PAYER_RULE_HINTS[payerKey]) || null;
}

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** The longest term of the rule found in the payer name (word boundary), with its position. */
function bestTermHit(name: string, terms: readonly string[]): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (const raw of terms) {
    const t = norm(raw);
    if (!t) continue;
    const i = name.indexOf(` ${t} `);
    if (i < 0) continue;
    const hit = { start: i + 1, end: i + 1 + t.length };
    if (!best || hit.end - hit.start > best.end - best.start) best = hit;
  }
  return best;
}

/**
 * Rules whose term appears in the payer name (word boundary) or whose payer type matches. When one
 * rule's matched term contains another rule's matched term ("UnitedHealthcare Community Plan" vs
 * "UnitedHealthcare", "Aetna Better Health" vs "Aetna"), the more specific match wins. Rules that
 * match different parts of the name ("Aetna Medicare Advantage") all stay, and the prescriber check
 * asks staff to verify with the plan.
 */
export function matchPayerRules(payer: { name?: string | null; type?: string | null }, rules: readonly TmsPayerRuleRow[]): TmsPayerRuleRow[] {
  const name = ` ${norm(payer.name)} `;
  const type = norm(payer.type).replace(/ /g, '_');
  const hits: { rule: TmsPayerRuleRow; hit: { start: number; end: number } | null }[] = [];
  for (const r of rules) {
    if (r.active === false) continue;
    const byType = Boolean(type && r.payerTypes.some((t) => norm(t).replace(/ /g, '_') === type));
    const hit = name.trim() !== '' ? bestTermHit(name, r.matchTerms) : null;
    if (byType || hit) hits.push({ rule: r, hit });
  }
  return hits
    .filter((h) => {
      const mine = h.hit;
      if (!mine) return true;
      // Dropped when another rule matched a strictly longer term covering the same words
      return !hits.some((o) => o !== h && o.hit && o.hit.start <= mine.start && o.hit.end >= mine.end && o.hit.end - o.hit.start > mine.end - mine.start);
    })
    .map((h) => h.rule);
}

/** The strictest payer minimum of failed trials among the matched rules; null = none set. */
export function payerMinFailedTrials(matched: readonly TmsPayerRuleRow[]): number | null {
  const mins = matched.map((m) => m.minFailedTrials).filter((n): n is number => typeof n === 'number' && n > 0);
  return mins.length ? Math.max(...mins) : null;
}

export type ProviderKind = 'psychiatrist' | 'np' | 'other';

export function providerKindForRole(role: string | null | undefined): ProviderKind {
  if (role === 'PSYCHIATRIST') return 'psychiatrist';
  if (role === 'NP') return 'np';
  return 'other';
}

/**
 * Provider kind from ALL of a user's roles (User.role plus User.roles): psychiatrist when any role is
 * PSYCHIATRIST, else NP when any role is NP. Every TMS determination and payer-rule check uses this.
 */
export function providerKindForUser(user: { role?: string | null; roles?: readonly string[] | null } | null | undefined): ProviderKind {
  if (!user) return 'other';
  const all: string[] = normalizeUserRoles(user.role as StaffRole | null, (user.roles ?? []) as StaffRole[]);
  if (all.includes('PSYCHIATRIST')) return 'psychiatrist';
  if (all.includes('NP')) return 'np';
  return 'other';
}

/** Psychiatrist or NP by any assigned role. */
export function isTmsPrescriber(user: { role?: string | null; roles?: readonly string[] | null } | null | undefined): boolean {
  return providerKindForUser(user) !== 'other';
}

export type PrescriberCheck = {
  /** The effective rule (strictest of the matched rules), or null when no rule matched */
  rule: TmsPrescriberRule | null;
  matched: string[];
  /** true = the provider may order / supervise under the rule as recorded */
  ok: boolean;
  /** Plan specific, conflicting rules, or no rule: staff must verify with the plan before scheduling */
  needsVerification: boolean;
  message: string;
};

/**
 * Does the ordering / scheduled provider meet the payer's rule? Several matching rules (e.g. a
 * Medicare plan sold by Aetna) use the strictest and require verification with the plan.
 */
export function checkPrescriber(matched: readonly TmsPayerRuleRow[], provider: ProviderKind | null): PrescriberCheck {
  const labels = matched.map((m) => m.payerLabel);
  if (!provider) return { rule: null, matched: labels, ok: false, needsVerification: false, message: 'Choose the ordering / supervising provider.' };
  if (provider === 'other') {
    return { rule: null, matched: labels, ok: false, needsVerification: false, message: 'TMS is ordered / supervised by a psychiatrist or an NP: choose one.' };
  }
  if (!matched.length) {
    return { rule: null, matched: labels, ok: true, needsVerification: true, message: 'No TMS prescriber rule on file for this payer: verify with the plan who may order / supervise.' };
  }
  const rules = new Set(matched.map((m) => m.rule));
  const conflicting = rules.size > 1;
  const rule: TmsPrescriberRule = rules.has('psychiatrist_only') ? 'psychiatrist_only' : rules.has('plan_specific') ? 'plan_specific' : 'psychiatrist_or_np';
  if (rule === 'psychiatrist_only' && provider !== 'psychiatrist') {
    return { rule, matched: labels, ok: false, needsVerification: conflicting, message: `${labels.join(' / ')}: TMS must be ordered / supervised by a psychiatrist.` };
  }
  if (rule === 'plan_specific' || conflicting) {
    return { rule, matched: labels, ok: true, needsVerification: true, message: `${labels.join(' / ')}: ${conflicting ? 'more than one rule matches' : 'plan specific'}. Verify with the plan that this provider may order / supervise TMS.` };
  }
  return { rule, matched: labels, ok: true, needsVerification: false, message: `${labels.join(' / ')}: ${prescriberRuleLabel(rule)}.` };
}

// ─── Evaluation & safety screening ───────────────────────────────────────────

export const TMS_INDICATIONS = [
  { value: 'mdd', label: 'Major depressive disorder (MDD)' },
  { value: 'ocd', label: 'Obsessive-compulsive disorder (OCD)' },
] as const;
export type TmsIndication = (typeof TMS_INDICATIONS)[number]['value'];

export type TmsEvaluation = {
  // Diagnosis + presentation
  dxConfirmed?: boolean;
  dxCode?: string;
  symptoms?: string;
  functionalImpact?: string;
  // Prior treatment (antidepressant trials are the course's ADT table: medication, dose, duration, response / tolerability)
  adtReviewed?: boolean;
  psychHistory?: string;
  currentTreatment?: string;
  currentMedications?: string;
  substanceUse?: string;
  // Safety screening
  seizureRisk?: 'none' | 'present';
  seizureDetail?: string;
  neuroHistory?: string;
  implantsMetal?: 'none' | 'present';
  implantsDetail?: string;
  deviceScreenDone?: boolean;
  pregnancy?: 'not_applicable' | 'not_pregnant' | 'pregnant' | 'unknown';
  otherMedical?: string;
  // Risk
  suicideRisk?: 'none' | 'low' | 'moderate' | 'high';
  escalationPlan?: string;
  // Consent
  protocolExplained?: boolean;
  consentObtained?: boolean;
  consentDate?: string;
  // Payer medical-necessity documentation (common elements of payer TMS policies)
  /** mdd_single_severe | mdd_recurrent_severe (both without psychotic features) | ocd | other */
  criteriaDx?: 'mdd_single_severe' | 'mdd_recurrent_severe' | 'ocd' | 'other';
  /** Trials span at least 2 antidepressant classes, each at adequate dose and duration (failed or not tolerated) */
  adtAdequacyConfirmed?: boolean;
  psychotherapyTrial?: 'yes' | 'no';
  psychotherapyDates?: string;
  /** Baseline standardized score (score only; the clinic's licensed form for HAM-D / MADRS / Y-BOCS) */
  baselineInstrument?: 'phq-9' | 'ham-d' | 'madrs' | 'ybocs';
  baselineScore?: number;
  activePsychosis?: 'none' | 'present';
  /** Treatment plan: planned number of sessions and the taper */
  planSessions?: number;
  planTaper?: string;
  // Before start
  prescriberDetermination?: boolean;
  determinationBy?: string;
  determinationAt?: string;
  treatmentPlanDocumented?: boolean;
  monitoringPlan?: boolean;
};

export const TMS_PREGNANCY = [
  { value: 'not_applicable', label: 'Not applicable' },
  { value: 'not_pregnant', label: 'Not pregnant' },
  { value: 'pregnant', label: 'Pregnant (risk / benefit discussed)' },
  { value: 'unknown', label: 'Unknown' },
] as const;

export const TMS_SUICIDE_RISK = [
  { value: 'none', label: 'None identified' },
  { value: 'low', label: 'Low' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'high', label: 'High' },
] as const;

/** Missing evaluation items (plain language). */
export function evaluationMissing(e: TmsEvaluation | null | undefined): string[] {
  const v = e ?? {};
  const out: string[] = [];
  const t = (s?: string) => Boolean(s && s.trim());
  if (!v.dxConfirmed) out.push('Diagnosis confirmed');
  if (!t(v.symptoms) || !t(v.functionalImpact)) out.push('Current symptoms and functional impact');
  if (!v.adtReviewed) out.push('Prior antidepressant trials reviewed (medication, dose, duration, response, tolerability)');
  if (!t(v.psychHistory) || !t(v.currentTreatment) || !t(v.currentMedications) || !t(v.substanceUse)) {
    out.push('Psychiatric history, current treatment, medications and substance use');
  }
  if (!v.seizureRisk || (v.seizureRisk === 'present' && !t(v.seizureDetail))) out.push('Seizure risk screen');
  if (!t(v.neuroHistory)) out.push('Neurological history');
  if (!v.implantsMetal || (v.implantsMetal === 'present' && !t(v.implantsDetail))) out.push('Implanted devices / metal screen');
  if (!v.deviceScreenDone) out.push('Device-specific contraindication screen');
  if (!v.pregnancy) out.push('Pregnancy status');
  if (!v.suicideRisk || !t(v.escalationPlan)) out.push('Risk assessment (suicidality) and escalation plan');
  if (!v.protocolExplained) out.push('Protocol, frequency, benefits, risks, alternatives and follow-up explained');
  return out;
}

export type StartCourseInput = {
  evaluation: TmsEvaluation | null | undefined;
  indication: TmsIndication | null | undefined;
  deviceName: string | null | undefined;
  deviceClearedForIndication: boolean | null | undefined;
  /** Payer medical-necessity checklist items still incomplete (criteriaChecklist) */
  criteriaIncomplete?: readonly string[];
  /** The checklist is required (a matched payer rule is plan specific); default: the effective rule is plan specific */
  criteriaRequired?: boolean;
  /** approved | not_required | pending | null */
  authStatus: string | null | undefined;
  prescriber: PrescriberCheck;
  payerVerified: boolean | null | undefined;
  payerVerifyNote: string | null | undefined;
  /** Absolute contraindications ticked on the course's screening checklist */
  absoluteContraindications?: number;
};

/** What blocks "Schedule TMS course" / starting treatment. [] = may start. */
export function startCourseBlockers(i: StartCourseInput): string[] {
  const out: string[] = [];
  const e = i.evaluation ?? {};
  const screen = evaluationMissing(e);
  if (screen.length) out.push(`Complete the evaluation and safety screening (${screen.length} item${screen.length === 1 ? '' : 's'} missing).`);
  if (i.absoluteContraindications && i.absoluteContraindications > 0) out.push('An absolute contraindication is ticked on the screening checklist: the prescriber must resolve it before TMS.');
  if (!i.indication) out.push('Record the indication (MDD or OCD).');
  if (!i.deviceName?.trim()) out.push('Record the TMS device.');
  if (i.indication && !i.deviceClearedForIndication) {
    out.push(`Confirm the device is cleared for this indication (${i.indication === 'ocd' ? 'OCD' : 'MDD'}) per the device's labeling.`);
  }
  if (!e.consentObtained) out.push('Obtain and record informed consent.');
  if (i.authStatus !== 'approved' && i.authStatus !== 'not_required') out.push('Billing must record the authorization (approved) or "not required".');
  if (!e.prescriberDetermination) out.push('Record the prescriber’s determination that TMS is indicated.');
  if (!e.treatmentPlanDocumented) out.push('Document the TMS treatment plan.');
  if (!i.prescriber.ok) out.push(i.prescriber.message);
  else if (i.prescriber.needsVerification && !(i.payerVerified && i.payerVerifyNote?.trim())) {
    out.push('Plan specific: tick "Verified with plan" and add a note (who you spoke with, reference number) before scheduling.');
  }
  // Plan specific payers: the medical-necessity documentation checklist is required
  const crit = i.criteriaIncomplete ?? [];
  if ((i.criteriaRequired ?? i.prescriber.rule === 'plan_specific') && crit.length) {
    out.push(`Plan specific: complete the payer medical-necessity checklist (${crit.length} item${crit.length === 1 ? '' : 's'} incomplete).`);
  }
  return out;
}

// ─── TMS device ──────────────────────────────────────────────────────────────

/**
 * FDA-cleared TMS systems (picklist only). Which indications each system is cleared for is NOT
 * recorded here: staff confirm "Cleared for this indication per the device's labeling" per case and
 * note the cleared indications / coil in free text.
 */
export const TMS_DEVICES = [
  'NeuroStar Advanced Therapy (Neuronetics)',
  'BrainsWay Deep TMS',
  'MagVenture TMS Therapy',
  'Magstim Horizon',
  'Nexstim NBT',
  'Apollo TMS Therapy',
  'CloudTMS',
] as const;
export const TMS_DEVICE_OTHER = 'other';
export const TMS_DEVICE_CLEARANCE_LABEL = "Cleared for this indication per the device's labeling";

/** Picklist value for a stored device name: a listed system, 'other' (free text), or '' (none). */
export function devicePickValue(deviceName: string | null | undefined): string {
  const v = (deviceName ?? '').trim();
  if (!v) return '';
  return (TMS_DEVICES as readonly string[]).includes(v) ? v : TMS_DEVICE_OTHER;
}

// ─── Course target ───────────────────────────────────────────────────────────

/** The course's session target: entered on the course, else booked, else authorized; null = "Not set" (never assumed). */
export function courseTargetSessions(c: { targetSessions?: number | null; scheduledSessions?: number | null; authorizedSessions?: number | null }): number | null {
  for (const n of [c.targetSessions, c.scheduledSessions, c.authorizedSessions]) {
    if (typeof n === 'number' && n > 0) return n;
  }
  return null;
}

export function courseTargetLabel(n: number | null | undefined): string {
  return typeof n === 'number' && n > 0 ? `${n} sessions` : 'Not set';
}

// ─── Payer medical-necessity checklist ───────────────────────────────────────

export const TMS_CRITERIA_DX = [
  { value: 'mdd_single_severe', label: 'MDD, single episode, severe without psychotic features' },
  { value: 'mdd_recurrent_severe', label: 'MDD, recurrent, severe without psychotic features' },
  { value: 'ocd', label: 'Obsessive-compulsive disorder (OCD)' },
  { value: 'other', label: 'Other / does not match' },
] as const;

/** Baseline instruments (score only): PHQ-9 or HAM-D / MADRS for MDD; Y-BOCS for OCD. */
export const TMS_BASELINE_INSTRUMENTS = [
  { value: 'phq-9', label: 'PHQ-9 (0-27)', max: 27 },
  { value: 'ham-d', label: 'HAM-D total (0-52), score only', max: 52 },
  { value: 'madrs', label: 'MADRS total (0-60), score only', max: 60 },
  { value: 'ybocs', label: 'Y-BOCS total (0-40), score only', max: 40 },
] as const;

export type CriteriaItem = { key: string; label: string; ok: boolean; detail: string };

export type CriteriaInput = {
  evaluation: TmsEvaluation | null | undefined;
  indication: TmsIndication | null | undefined;
  ageYears: number | null | undefined;
  /** Prior antidepressant trials listed (the course's ADT table, rows with a medication) */
  failedTrials: number;
  /** Payer minimum from the matched payer rule(s); null = not set */
  payerMinimum: number | null;
  /** Baseline scores recorded on the course (milestone "baseline"), by instrument */
  baselineScores?: readonly { instrument: string; score: number }[];
  absoluteContraindications?: number;
};

/** Count of prior antidepressant trials listed (rows with a medication name). */
export function countAdtTrials(adt: unknown): number {
  return Array.isArray(adt) ? adt.filter((t) => t && typeof t === 'object' && String((t as { medication?: unknown }).medication ?? '').trim()).length : 0;
}

/** Whole years from a date of birth (null when unknown). */
export function ageYearsFrom(dob: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) age -= 1;
  return age;
}

/**
 * The common elements of payer TMS medical-necessity policies, as a documentation checklist. Plan
 * specifics vary: no pass / fail number is built in (the payer minimum of failed trials comes from
 * the payer rule, blank by default).
 */
export function criteriaChecklist(i: CriteriaInput): CriteriaItem[] {
  const e = i.evaluation ?? {};
  const t = (s?: string) => Boolean(s && s.trim());
  const ocd = i.indication === 'ocd' || e.criteriaDx === 'ocd';
  const dxOk = Boolean(e.criteriaDx && e.criteriaDx !== 'other');
  const age = i.ageYears;
  const baselineRecorded = (i.baselineScores ?? []).find((b) => (ocd ? b.instrument === 'ybocs' : b.instrument !== 'ybocs'));
  const baselineEntered = e.baselineInstrument && typeof e.baselineScore === 'number' && (ocd ? e.baselineInstrument === 'ybocs' : e.baselineInstrument !== 'ybocs');
  const meetsMin = i.payerMinimum == null || i.failedTrials >= i.payerMinimum;
  const safetyOk = e.activePsychosis === 'none' && e.seizureRisk === 'none' && e.implantsMetal === 'none' && !(i.absoluteContraindications && i.absoluteContraindications > 0);
  return [
    {
      key: 'diagnosis',
      label: 'Diagnosis: MDD (single or recurrent episode, severe without psychotic features) or OCD',
      ok: dxOk,
      detail: e.criteriaDx === 'other' ? 'Recorded diagnosis does not match the common criteria: check the payer policy.' : dxOk ? TMS_CRITERIA_DX.find((d) => d.value === e.criteriaDx)!.label : 'Choose the diagnosis.',
    },
    {
      key: 'age',
      label: 'Age 18 or older (most policies; adolescent use per device labeling)',
      ok: typeof age === 'number' && age >= 18,
      detail: age == null ? 'No date of birth on the client record.' : age >= 18 ? `Age ${age}.` : `Age ${age}: under 18. Adolescent use per the device labeling; check the payer policy.`,
    },
    {
      key: 'trials',
      label: 'Failed or not-tolerated antidepressant trials: at least 2 classes, each at adequate dose and duration',
      ok: i.failedTrials > 0 && Boolean(e.adtAdequacyConfirmed) && meetsMin,
      detail: `${i.failedTrials} trial${i.failedTrials === 1 ? '' : 's'} listed · Payer minimum: ${i.payerMinimum ?? '__'}${!meetsMin ? ' (below the payer minimum)' : ''}${e.adtAdequacyConfirmed ? '' : ' · confirm classes, dose and duration'}`,
    },
    {
      key: 'psychotherapy',
      label: 'Trial of evidence-based psychotherapy',
      ok: e.psychotherapyTrial === 'yes' && t(e.psychotherapyDates),
      detail: e.psychotherapyTrial === 'yes' ? (t(e.psychotherapyDates) ? `Yes: ${e.psychotherapyDates}` : 'Yes: add the dates.') : e.psychotherapyTrial === 'no' ? 'No psychotherapy trial documented.' : 'Record yes / no and the dates.',
    },
    {
      key: 'baseline',
      label: ocd ? 'Baseline standardized score: Y-BOCS (OCD)' : 'Baseline standardized score: PHQ-9, HAM-D or MADRS',
      ok: Boolean(baselineRecorded || baselineEntered),
      detail: baselineEntered ? `${e.baselineInstrument!.toUpperCase()} ${e.baselineScore}` : baselineRecorded ? `${baselineRecorded.instrument.toUpperCase()} ${baselineRecorded.score} (course baseline)` : 'Record the baseline score.',
    },
    {
      key: 'safety',
      label: 'No active psychosis, no seizure disorder, no contraindicated implants',
      ok: safetyOk,
      detail: safetyOk ? 'Screening documented.' : 'Complete the safety screening (psychosis, seizure, implants) and the contraindication checklist.',
    },
    {
      key: 'plan',
      label: 'Treatment plan with the session count and taper',
      ok: Boolean(e.treatmentPlanDocumented) && typeof e.planSessions === 'number' && e.planSessions > 0 && t(e.planTaper),
      detail: typeof e.planSessions === 'number' && e.planSessions > 0 ? `${e.planSessions} sessions${t(e.planTaper) ? ` · taper: ${e.planTaper}` : ' · add the taper'}` : 'Record the planned session count and taper.',
    },
  ];
}

export function criteriaIncomplete(items: readonly CriteriaItem[]): string[] {
  return items.filter((c) => !c.ok).map((c) => c.label);
}

// ─── Course scheduling ───────────────────────────────────────────────────────

/** Owner's schedule: 5 days a week (Mon-Fri), 20 minutes per day. */
export const TMS_WEEKDAYS = [1, 2, 3, 4, 5] as const;
export const TMS_SESSION_MINUTES = 20;
/** Appointment series hold at most 26 visits (src/lib/scheduling/recurrence.ts); longer courses book as consecutive series. */
export const SERIES_CHUNK = 26;

/** Default course length: the authorized count; null = staff must enter it (never a built-in number). */
export function defaultSessionCount(authorizedSessions: number | null | undefined): number | null {
  return typeof authorizedSessions === 'number' && authorizedSessions > 0 ? authorizedSessions : null;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The first `count` weekday dates (Mon-Fri) on or after startDate (YYYY-MM-DD). */
export function courseDates(startDate: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${startDate}T12:00:00Z`);
  while (out.length < count) {
    const wd = d.getUTCDay();
    if (wd >= 1 && wd <= 5) out.push(ymd(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Series to book: consecutive chunks of at most 26 weekday visits. */
export function courseSeriesChunks(startDate: string, count: number): { startDate: string; count: number; lastDate: string }[] {
  const dates = courseDates(startDate, count);
  const out: { startDate: string; count: number; lastDate: string }[] = [];
  for (let i = 0; i < dates.length; i += SERIES_CHUNK) {
    const part = dates.slice(i, i + SERIES_CHUNK);
    out.push({ startDate: part[0], count: part.length, lastDate: part[part.length - 1] });
  }
  return out;
}

// ─── Monitoring ──────────────────────────────────────────────────────────────

/**
 * Weekly outcome measure by indication: PHQ-9 for MDD; Y-BOCS total for OCD. Y-BOCS is copyrighted:
 * Altrixs records the clinician-entered total only (score only, administered from the clinic's
 * licensed form); no items are reproduced.
 */
export function weeklyMeasureFor(indication: TmsIndication | null | undefined): { instrumentId: string | null; label: string; note: string | null } {
  if (indication === 'ocd') {
    return { instrumentId: 'ybocs', label: 'Y-BOCS', note: "Y-BOCS is score only: give it from the clinic's licensed form and enter the total (0-40) under Tracking." };
  }
  return { instrumentId: 'phq-9', label: 'PHQ-9', note: null };
}

/** Score-only course measures (clinician-entered totals; no items stored or shown). */
export const TMS_SCORE_INSTRUMENTS = [
  { value: 'phq-9', label: 'PHQ-9', max: 27, baselineOnly: false },
  { value: 'ybocs', label: 'Y-BOCS total', max: 40, baselineOnly: false },
  { value: 'ham-d', label: 'HAM-D total', max: 52, baselineOnly: true },
  { value: 'madrs', label: 'MADRS total', max: 60, baselineOnly: true },
] as const;
export type TmsScoreInstrument = (typeof TMS_SCORE_INSTRUMENTS)[number]['value'];

export function scoreInstrument(v: string | null | undefined) {
  return TMS_SCORE_INSTRUMENTS.find((x) => x.value === v) ?? null;
}

/** Course score milestones; the course length is never assumed ("end" = end of course); legacy rows keep their stored milestone. */
export const TMS_SCORE_MILESTONES = ['baseline', 'weekly', '10', '15', '20', '25', 'end', 'custom'] as const;

/** Published Y-BOCS severity bands (total 0-40). */
export function ybocsSeverity(score: number): string {
  if (score <= 7) return 'Subclinical';
  if (score <= 15) return 'Mild';
  if (score <= 23) return 'Moderate';
  if (score <= 31) return 'Severe';
  return 'Extreme';
}

/** A Y-BOCS rise of 5 or more points is flagged to the prescriber, mirroring PHQ-9. */
export const YBOCS_WORSENING_POINTS = 5;

/** Rise from baseline or from the previous score by `points` or more. */
export function scoreWorsening(scores: readonly number[], points: number): { worse: boolean; from: number | null; to: number | null } {
  if (scores.length < 2) return { worse: false, from: null, to: null };
  const latest = scores[scores.length - 1];
  const baseline = scores[0];
  const previous = scores[scores.length - 2];
  if (latest - baseline >= points) return { worse: true, from: baseline, to: latest };
  if (latest - previous >= points) return { worse: true, from: previous, to: latest };
  return { worse: false, from: null, to: null };
}

/**
 * A PHQ-9 rise of 5 or more points is the commonly used threshold for a clinically meaningful
 * change (Lowe et al., Med Care 2004). Used only to flag for the prescriber's review.
 */
export const PHQ9_WORSENING_POINTS = 5;

export function phq9Worsening(scores: readonly number[]): { worse: boolean; from: number | null; to: number | null } {
  return scoreWorsening(scores, PHQ9_WORSENING_POINTS);
}

export function ybocsWorsening(scores: readonly number[]): { worse: boolean; from: number | null; to: number | null } {
  return scoreWorsening(scores, YBOCS_WORSENING_POINTS);
}

export const TMS_ATTENDANCE = [
  { value: 'attended', label: 'Attended' },
  { value: 'no_show', label: 'No-show' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'held', label: 'Held by provider' },
] as const;
export type TmsAttendance = (typeof TMS_ATTENDANCE)[number]['value'];

// ─── Help panel ──────────────────────────────────────────────────────────────

export const TMS_WORKFLOW_HELP = [
  'Identify referral. With a referral and intake packet from another provider, review the packet for all documents and consent forms, then verify insurance. With no referral or packet, schedule medication management first to complete the TMS intake documents.',
  'Intake packet: referral from the provider, PHQ-9, medication history, proof of diagnosis, consents.',
  'Information transfer: send the insurance information to billing (creates a billing To-Do).',
  'Verify & authorize: billing verifies coverage and records the authorization (approved, or not required) and the authorized number of sessions.',
  'Evaluate & consent: the psychiatrist / NP completes the evaluation, safety screening, the payer medical-necessity checklist and the TMS informed consent (consent library) and records the determination. The payer rule decides who may order / supervise (any of the user\'s roles counts).',
  'Schedule: book the course 5 days a week, 20 minutes a day, for the authorized or ordered number of sessions. The course target shows "Not set" until a count is authorized or entered (a typical acute course is several weeks of daily weekday sessions plus a taper; the count always comes from the order / authorization).',
  'Treat & monitor: log each session (treater, motor threshold, side effects, attendance); weekly PHQ-9 (MDD) or Y-BOCS total (OCD, score only); a rise of 5 or more points or new suicidal ideation is flagged to the prescriber.',
] as const;
