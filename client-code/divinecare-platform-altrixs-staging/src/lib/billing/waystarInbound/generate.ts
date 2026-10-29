/**
 * Outbound inquiry generators — pure; callers pass identifiers and envelope config.
 *
 *  270 Eligibility, Coverage or Benefit Inquiry   ASC X12N 005010X279A1  (GS01 HS)
 *      2000A payer (NM1*PR PI) / 2000B provider (NM1*1P XX NPI) / 2000C subscriber
 *      [/ 2000D dependent]; TRN*1 at the patient's level carries EligibilityCheck.id, which the
 *      271 echoes as TRN*2. DTP*291 date of service, one EQ per service type (30, MH, ...).
 *  276 Health Care Claim Status Request           ASC X12N 005010X212    (GS01 HR)
 *      2000A payer / 2000B submitter (NM1*41 46) / 2000C provider (NM1*1P XX) / 2000D subscriber
 *      (DMG, NM1*IL MI) / 2200D TRN*1 = our CLM01, REF*1K payer ICN, REF*EJ CLM01, AMT*T3, DTP*472.
 *  One ST per inquiry inside one ISA/GS, like the 837 batches.
 */
import { closeSet, genderCode, wrapEnvelope, x12Date, x12Text, x12Time, type EnvelopeConfig } from './x12';
import { ELIGIBILITY_SERVICE_TYPES, type EligibilityServiceType } from './codes';

export type Person = {
  lastName: string;
  firstName: string;
  middleInitial?: string | null;
  dateOfBirth?: string | null; // YYYY-MM-DD
  gender?: string | null;
};

export type EligibilityInquiry = {
  /** EligibilityCheck.id; echoed as TRN*2 in the 271 */
  traceNumber: string;
  payerName: string;
  payerId: string;
  subscriber: Person & { memberId: string; groupNumber?: string | null };
  /** Set when the patient is not the subscriber (child / spouse on someone else's plan) */
  dependent?: Person | null;
  serviceDate: string; // YYYY-MM-DD
  serviceTypes?: EligibilityServiceType[];
};

export type ClaimStatusInquiry = {
  /** Our CLM01; echoed as TRN*2 and REF*EJ in the 277 */
  traceNumber: string;
  claimControlNumber: string;
  payerClaimControlNumber?: string | null;
  payerName: string;
  payerId: string;
  subscriber: Person & { memberId: string };
  chargeAmount: number;
  serviceFrom: string; // YYYY-MM-DD
  serviceTo?: string | null;
};

export type InquiryConfig = EnvelopeConfig & {
  providerName: string;
  providerNpi: string;
  /** TRN03: '1' + 9-digit EIN */
  originatorId: string;
};

export type GeneratedFile = { content: string; controlNumber: string; batchId: string; transactionSets: Array<{ traceNumber: string; stControlNumber: string }> };

const ID_RE = /^[A-Za-z0-9-]{1,80}$/;
const TRACE_RE = /^[A-Za-z0-9-]{1,50}$/;

const d8 = (iso: string) => iso.replace(/-/g, '');

function personName(p: Person) {
  // Always three elements (NM103 last, NM104 first, NM105 middle) so NM108/NM109 land in place
  return `${x12Text(p.lastName, 60)}*${x12Text(p.firstName, 35)}*${x12Text(p.middleInitial, 1)}`;
}

function dmg(p: Person) {
  if (!p.dateOfBirth) return null;
  const g = genderCode(p.gender);
  return `DMG*D8*${d8(p.dateOfBirth)}${g === 'U' ? '' : `*${g}`}`;
}

function checkPerson(prefix: string, p: Person, errors: string[], dobRequired: boolean) {
  if (!p.lastName?.trim() || !p.firstName?.trim()) errors.push(`${prefix} first and last name are required`);
  if (dobRequired && !p.dateOfBirth) errors.push(`${prefix} date of birth is required`);
  if (p.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(p.dateOfBirth)) errors.push(`${prefix} date of birth is not a valid date`);
}

export function validateConfig(cfg: InquiryConfig): string[] {
  const p: string[] = [];
  if (!/^\d{10}$/.test(cfg.providerNpi)) p.push('Billing provider NPI (PRACTICE_GROUP_NPI) is missing or not 10 digits');
  if (!/^1\d{9}$/.test(cfg.originatorId)) p.push('PRACTICE_TIN is required for the TRN originator (1 + EIN)');
  if (!cfg.providerName.trim()) p.push('Practice name (WAYSTAR_SUBMITTER_NAME) is missing');
  return p;
}

export function validateEligibilityInquiry(q: EligibilityInquiry): string[] {
  const errors: string[] = [];
  if (!TRACE_RE.test(q.traceNumber)) errors.push('Trace number must be 1-50 letters / digits');
  if (!q.payerId || !/^[A-Za-z0-9-]{2,15}$/.test(q.payerId)) errors.push('Waystar payer ID is missing or invalid');
  if (!q.payerName?.trim()) errors.push('Payer name is missing');
  if (!q.subscriber.memberId || !ID_RE.test(q.subscriber.memberId)) errors.push('Member ID is missing or has invalid characters');
  checkPerson('Subscriber', q.subscriber, errors, !q.dependent);
  if (q.dependent) checkPerson('Dependent', q.dependent, errors, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.serviceDate)) errors.push('Date of service is invalid');
  const bad = (q.serviceTypes || []).filter((t) => !(ELIGIBILITY_SERVICE_TYPES as readonly string[]).includes(t));
  if (bad.length) errors.push(`Unsupported service type(s): ${bad.join(', ')}`);
  return errors;
}

export function validateClaimStatusInquiry(q: ClaimStatusInquiry): string[] {
  const errors: string[] = [];
  if (!TRACE_RE.test(q.traceNumber)) errors.push('Trace number must be 1-50 letters / digits');
  if (!q.claimControlNumber) errors.push('Claim control number (CLM01) is missing');
  if (!q.payerId || !/^[A-Za-z0-9-]{2,15}$/.test(q.payerId)) errors.push('Waystar payer ID is missing or invalid');
  if (!q.subscriber.memberId || !ID_RE.test(q.subscriber.memberId)) errors.push('Member ID is missing or has invalid characters');
  checkPerson('Patient', q.subscriber, errors, true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(q.serviceFrom)) errors.push('Date of service is missing');
  if (!(q.chargeAmount > 0)) errors.push('Claim charge amount is missing');
  return errors;
}

function batchIdFor(prefix: string, now: Date, ctrl: number) {
  return `ALTRIXS-${prefix}-${x12Date(now)}-${String(ctrl).slice(-4)}`;
}

export function generate270(
  inquiries: EligibilityInquiry[],
  cfg: InquiryConfig,
  opts: { now?: Date; controlNumber?: number } = {}
): GeneratedFile {
  const now = opts.now ?? new Date();
  const ctrl = opts.controlNumber ?? Math.floor(Math.random() * 900_000_000) + 100_000_000;
  const batchId = batchIdFor('270', now, ctrl);
  const sets: string[][] = [];
  const index: GeneratedFile['transactionSets'] = [];
  inquiries.forEach((q, i) => {
    const stCtrl = String(i + 1).padStart(4, '0');
    const types = q.serviceTypes?.length ? q.serviceTypes : (['30', 'MH'] as EligibilityServiceType[]);
    const st: string[] = [];
    st.push(`ST*270*${stCtrl}*005010X279A1`);
    st.push(`BHT*0022*13*${batchId}-${stCtrl}*${x12Date(now)}*${x12Time(now)}`);
    st.push('HL*1**20*1');
    st.push(`NM1*PR*2*${x12Text(q.payerName)}*****PI*${q.payerId.toUpperCase()}`);
    st.push('HL*2*1*21*1');
    st.push(`NM1*1P*2*${x12Text(cfg.providerName)}*****XX*${cfg.providerNpi}`);
    const tail = (who: Person) => {
      const out: string[] = [];
      const demo = dmg(who);
      if (demo) out.push(demo);
      out.push(`DTP*291*D8*${d8(q.serviceDate)}`);
      for (const t of types) out.push(`EQ*${t}`);
      return out;
    };
    if (q.dependent) {
      st.push('HL*3*2*22*1');
      st.push(`NM1*IL*1*${personName(q.subscriber)}***MI*${q.subscriber.memberId.toUpperCase()}`);
      if (q.subscriber.groupNumber) st.push(`REF*6P*${x12Text(q.subscriber.groupNumber, 50)}`);
      st.push('HL*4*3*23*0');
      st.push(`TRN*1*${q.traceNumber}*${cfg.originatorId}`);
      st.push(`NM1*03*1*${personName(q.dependent)}`.replace(/\*+$/, ''));
      st.push(...tail(q.dependent));
    } else {
      st.push('HL*3*2*22*0');
      st.push(`TRN*1*${q.traceNumber}*${cfg.originatorId}`);
      st.push(`NM1*IL*1*${personName(q.subscriber)}***MI*${q.subscriber.memberId.toUpperCase()}`);
      if (q.subscriber.groupNumber) st.push(`REF*6P*${x12Text(q.subscriber.groupNumber, 50)}`);
      st.push(...tail(q.subscriber));
    }
    sets.push(closeSet(st, stCtrl));
    index.push({ traceNumber: q.traceNumber, stControlNumber: stCtrl });
  });
  return {
    content: wrapEnvelope(sets, { functionalId: 'HS', version: '005010X279A1', controlNumber: ctrl, now, cfg }),
    controlNumber: String(ctrl),
    batchId,
    transactionSets: index,
  };
}

export function generate276(
  inquiries: ClaimStatusInquiry[],
  cfg: InquiryConfig,
  opts: { now?: Date; controlNumber?: number } = {}
): GeneratedFile {
  const now = opts.now ?? new Date();
  const ctrl = opts.controlNumber ?? Math.floor(Math.random() * 900_000_000) + 100_000_000;
  const batchId = batchIdFor('276', now, ctrl);
  const sets: string[][] = [];
  const index: GeneratedFile['transactionSets'] = [];
  inquiries.forEach((q, i) => {
    const stCtrl = String(i + 1).padStart(4, '0');
    const st: string[] = [];
    st.push(`ST*276*${stCtrl}*005010X212`);
    st.push(`BHT*0010*13*${batchId}-${stCtrl}*${x12Date(now)}*${x12Time(now)}`);
    st.push('HL*1**20*1');
    st.push(`NM1*PR*2*${x12Text(q.payerName)}*****PI*${q.payerId.toUpperCase()}`);
    st.push('HL*2*1*21*1');
    st.push(`NM1*41*2*${x12Text(cfg.submitterName)}*****46*${cfg.submitterId}`);
    st.push('HL*3*2*19*1');
    st.push(`NM1*1P*2*${x12Text(cfg.providerName)}*****XX*${cfg.providerNpi}`);
    st.push('HL*4*3*22*0');
    const demo = dmg(q.subscriber);
    if (demo) st.push(demo);
    st.push(`NM1*IL*1*${personName(q.subscriber)}***MI*${q.subscriber.memberId.toUpperCase()}`);
    st.push(`TRN*1*${q.traceNumber}`);
    if (q.payerClaimControlNumber) st.push(`REF*1K*${x12Text(q.payerClaimControlNumber, 50)}`);
    st.push(`REF*EJ*${q.claimControlNumber}`);
    st.push(`AMT*T3*${q.chargeAmount.toFixed(2)}`);
    const to = q.serviceTo && q.serviceTo !== q.serviceFrom ? q.serviceTo : null;
    st.push(to ? `DTP*472*RD8*${d8(q.serviceFrom)}-${d8(to)}` : `DTP*472*D8*${d8(q.serviceFrom)}`);
    sets.push(closeSet(st, stCtrl));
    index.push({ traceNumber: q.traceNumber, stControlNumber: stCtrl });
  });
  return {
    content: wrapEnvelope(sets, { functionalId: 'HR', version: '005010X212', controlNumber: ctrl, now, cfg }),
    controlNumber: String(ctrl),
    batchId,
    transactionSets: index,
  };
}
