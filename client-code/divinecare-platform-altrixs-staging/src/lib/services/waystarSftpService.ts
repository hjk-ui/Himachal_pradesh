'use strict';
/**
 * Waystar clearinghouse exchange — AWS Transfer Family SFTP connector + S3
 *
 * Waystar's recommended integration is SFTP: we drop X12 837P claim batches
 * on their server and pull back 999 acknowledgments, 277CA claim statuses,
 * and 835 remittances. Instead of running FileZilla or an SFTP box, this
 * service uses an AWS Transfer Family SFTP CONNECTOR — a fully managed
 * outbound client that moves files between our S3 staging bucket and
 * Waystar's SFTP server. HIPAA-eligible, covered under the existing BAA.
 *
 * Flow:
 *   Outbound: billing approves batch → generate837P() → S3 (KMS-encrypted)
 *             → StartFileTransfer(SendFilePaths) → Waystar /inbound
 *   Inbound:  scheduled poll → StartDirectoryListing on Waystar /outbound
 *             → StartFileTransfer(RetrieveFilePaths) → S3 → parse + post
 *
 * Everything lands in S3 first, so there is a complete, immutable audit
 * trail of every file exchanged with the clearinghouse.
 *
 * DEMO MODE: when AWS credentials or the connector are not configured,
 * all functions return realistic mock data so the full claim-submission
 * workflow can be exercised locally and in demos.
 */

import { awsClientConfig } from '@/lib/aws/clientConfig';
import {
  TransferClient,
  StartFileTransferCommand,
  StartDirectoryListingCommand,
  DescribeConnectorCommand,
  ListFileTransferResultsCommand,
} from '@aws-sdk/client-transfer';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { writeAuditLog } from './auditService';
import { AWS_LIVE } from './awsMode';

// ─── Config ───────────────────────────────────────────────────────────────────
const REGION = process.env.AWS_REGION || 'us-east-1';

const CONNECTOR_ID       = process.env.WAYSTAR_SFTP_CONNECTOR_ID || '';   // e.g. c-1234567890abcdef0
const STAGING_BUCKET     = process.env.WAYSTAR_S3_BUCKET || '';           // e.g. altrixs-waystar-edi
const OUTBOUND_PREFIX    = process.env.WAYSTAR_S3_OUTBOUND_PREFIX || 'outbound/837';   // our claims, pre-send
const INBOUND_PREFIX     = process.env.WAYSTAR_S3_INBOUND_PREFIX  || 'inbound';        // 835 / 999 / 277CA
const REMOTE_INBOUND_DIR  = process.env.WAYSTAR_REMOTE_INBOUND_DIR  || '/Upload';      // Waystar's claim drop
const REMOTE_OUTBOUND_DIR = process.env.WAYSTAR_REMOTE_OUTBOUND_DIR || '/Download';    // Waystar's responses (collected files move to /Download/Archive)
const KMS_KEY_ID          = process.env.WAYSTAR_KMS_KEY_ID || undefined;               // without it S3 falls back to the AWS-managed aws/s3 key

const DEMO_MODE = !AWS_LIVE || !CONNECTOR_ID || !STAGING_BUCKET;

// Practice identifiers used in the X12 envelope (override via env at go-live).
// Billing providers (2010AA) come from the billing_providers table per claim;
// the PRACTICE_* values below are only the fallback for a claim without one.
const SUBMITTER_NAME = process.env.WAYSTAR_SUBMITTER_NAME || 'MD BEHAVIORAL HEALTH';
const SUBMITTER_ID   = process.env.WAYSTAR_SUBMITTER_ID   || 'ALTRIXS01';
// No placeholders: when these are unset the pre-send check blocks sending
const GROUP_NPI      = process.env.PRACTICE_GROUP_NPI     || '';
const PRACTICE_TIN   = process.env.PRACTICE_TIN           || '';
const RECEIVER_ID    = process.env.WAYSTAR_RECEIVER_ID    || 'WAYSTAR';
// 2010AA billing provider address — 5010 requires a 9-digit ZIP here
const BILLING_ADDRESS = process.env.PRACTICE_BILLING_ADDRESS || '';
const BILLING_CITY    = process.env.PRACTICE_BILLING_CITY    || '';
const BILLING_STATE   = process.env.PRACTICE_BILLING_STATE   || 'MD';
const BILLING_ZIP     = (process.env.PRACTICE_BILLING_ZIP || '').replace(/\D/g, '');
const BILLING_PHONE   = (process.env.PRACTICE_BILLING_PHONE || '').replace(/\D/g, '');
// 1000A PER submitter contact; falls back to the claim's billing provider phone
const SUBMITTER_PHONE = (process.env.WAYSTAR_SUBMITTER_PHONE || process.env.PRACTICE_BILLING_PHONE || '').replace(/\D/g, '');
// ISA15 usage indicator — 'T' (test) unless production is explicitly switched on,
// so claims sent to the Waystar test account are never treated as live
const USAGE_INDICATOR = process.env.WAYSTAR_USAGE_INDICATOR === 'P' ? 'P' : 'T';

/** Non-secret config summary for status lines and pre-send checks. */
export function waystarSftpConfig() {
  return {
    configured: Boolean(CONNECTOR_ID && STAGING_BUCKET),
    live: !DEMO_MODE,
    usageIndicator: USAGE_INDICATOR as 'T' | 'P',
    groupNpi: GROUP_NPI,
    groupNpiFromEnv: Boolean(process.env.PRACTICE_GROUP_NPI),
    submitterId: SUBMITTER_ID,
    receiverId: RECEIVER_ID,
    remoteUploadDir: REMOTE_INBOUND_DIR,
    remoteDownloadDir: REMOTE_OUTBOUND_DIR,
  };
}

const transferClient = DEMO_MODE ? null : new TransferClient({ region: REGION, ...awsClientConfig() });
const s3Client       = DEMO_MODE ? null : new S3Client({ region: REGION, ...awsClientConfig() });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ClaimLine {
  cpt: string;
  modifiers?: string[];
  units: number;
  chargeAmount: number;   // dollars
  serviceDate: string;    // YYYY-MM-DD
  posCode: string;        // e.g. '11', '02', '10'
  diagnosisPointers: number[]; // 1-based pointers into claim diagnoses
}

/** 2010AA billing provider: an organization (Type 2) NPI with its NPPES address. */
export interface BillingProviderForBatch {
  npi: string;
  name: string;
  taxId: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  /** ZIP+4, 9 digits */
  zip: string;
  phone?: string;
}

/** One CAS reason/amount (group CO contractual, PR patient responsibility, OA other, PI payer initiated, CR correction). */
export type CasAdjustment = { group: 'CO' | 'CR' | 'OA' | 'PI' | 'PR'; reason: string; amount: number };

/** A payer that adjudicated the claim before the payer billed now (2320 / 2330A / 2330B / 2430). */
export interface OtherPayerForBatch {
  /** 2320 SBR01: that payer's responsibility (P when billing the secondary) */
  responsibility: 'P' | 'S' | 'T';
  /** 2320 SBR02: patient's relationship to that policy's subscriber */
  relationship: string;
  groupNumber?: string;
  claimFilingCode: string;
  subscriberLastName: string;
  subscriberFirstName: string;
  subscriberMiddleInitial?: string;
  memberId: string;
  payerName: string;
  payerId: string;
  /** 2320 AMT*D: what that payer paid on the claim */
  paidAmount: number;
  /** Adjudication / remittance date, YYYY-MM-DD */
  paidDate: string;
  /** Claim-level adjustments (2320 CAS) */
  adjustments: CasAdjustment[];
  /** Line-level adjudication (2430); lineNumber is 1-based in claim line order */
  lines?: Array<{ lineNumber: number; paidAmount: number; adjustments: CasAdjustment[]; paidDate?: string }>;
}

export interface ClaimForBatch {
  /** Altrixs Claim.id (used to map ST control numbers back to claims) */
  claimId: string;
  /** CLM01 / BHT03 claim control number (<= 20 chars). Falls back to claimId when absent. */
  controlNumber?: string;
  /** CLM05-3: 1 original, 7 replacement, 8 void */
  frequencyCode?: '1' | '7' | '8';
  /** 2300 REF*F8: payer's claim control number of the claim being replaced or voided */
  payerClaimControlNumber?: string;
  /** 2000B SBR01: P primary, S secondary, T tertiary */
  payerResponsibility?: 'P' | 'S' | 'T';
  patientLastName: string;
  patientFirstName: string;
  patientMiddleInitial?: string;
  /** NM107 name suffix (Jr., III) */
  patientNameSuffix?: string;
  patientDob: string;          // YYYY-MM-DD
  patientGender: 'M' | 'F' | 'U';
  /** N301 / N302, N401-N403 (ZIP 5 or 9 digits) */
  patientAddress: { line1: string; line2?: string; city: string; state: string; zip: string };
  /** 2010BA NM109: the subscriber's member ID (the ID on the card) */
  memberId: string;
  /** 2000B SBR03 */
  groupNumber?: string;
  /**
   * Set when the subscriber is someone other than the patient (relationship != 18).
   * The patient then goes in 2000C / 2010CA with PAT01 = relationship.
   */
  subscriber?: { relationship: string; lastName: string; firstName: string; middleInitial?: string };
  payerName: string;
  payerId: string;             // Waystar payer ID
  // SBR09 claim filing indicator (MC Medicaid, MB Medicare B, BL BCBS, CI commercial)
  claimFilingCode?: string;
  /** 2300 REF*G1 prior authorization number */
  priorAuthNumber?: string;
  /** 2010AA. Falls back to the PRACTICE_* env billing provider when absent. */
  billingProvider?: BillingProviderForBatch;
  /** 2000A PRV*BI*PXC billing provider taxonomy */
  billingTaxonomy?: string;
  // 2310B — omit when the billing provider is also the rendering provider
  renderingNpi?: string;
  renderingLastName?: string;
  renderingFirstName?: string;
  /** 2310B PRV*PE*PXC rendering provider taxonomy */
  renderingTaxonomy?: string;
  /** 2310C service facility (NM1*77 + N3/N4), when it differs from the 2010AA address */
  serviceFacility?: { name: string; npi?: string; address1: string; address2?: string; city: string; state: string; zip: string };
  /** 2310D supervising provider (NM1*DQ): supervisor of a pre-licensed rendering clinician */
  supervisingProvider?: { npi: string; lastName: string; firstName: string };
  diagnoses: string[];         // ICD-10-CM, no dots required
  lines: ClaimLine[];
  /** Previous payers' adjudication, for secondary / tertiary claims (COB) */
  otherPayers?: OtherPayerForBatch[];
}

export interface BatchResult {
  batchId: string;
  /** ISA13 / GS06 control number; a 999's AK1 references it */
  controlNumber: string;
  /** ST02 per claim, in file order; a 999's AK2 references it */
  transactionSets: Array<{ claimId: string; controlNumber: string; claimControlNumber: string }>;
  fileName: string;
  s3Key: string;
  transferId: string;
  claimCount: number;
  totalCharges: number;
  status: 'sent' | 'queued' | 'demo';
  demo: boolean;
  sentAt: string;
}

export interface InboundFile {
  fileName: string;
  type: '835' | '999' | '277CA' | 'unknown';
  receivedAt: string;
  s3Key: string;
  summary: string;
  demo: boolean;
}

// ─── X12 837P generation ─────────────────────────────────────────────────────
// 005010X222A1 837P. Segment terminator '~', element separator '*', component
// separator ':', repetition separator '^'. Each claim is its own ST/SE
// transaction set (so a 999 rejection isolates one claim) and carries the
// 2000A billing provider resolved for that claim, so one file can hold claims
// for any number of billing NPIs. Transaction sets are ordered by billing NPI.

function pad(n: number, w: number) { return String(n).padStart(w, '0'); }
function x12Date(d: Date) { return `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`; }
function x12DateShort(d: Date) { return x12Date(d).slice(2); }
function x12Time(d: Date) { return `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`; }
function cleanDate(iso: string) { return iso.replace(/-/g, ''); }
function money(n: number) { return (Math.round(n * 100) / 100).toFixed(2); }

/** Upper-cases free text and removes the X12 delimiters (* ~ : ^) so a name can't break a segment. */
export function x12Text(value: string | null | undefined) {
  return String(value ?? '').replace(/[*~:^\r\n]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Builds a segment, dropping trailing empty elements (X12 rule). */
function seg(...elements: Array<string | number | null | undefined>) {
  const parts = elements.map((e) => (e == null ? '' : String(e)));
  while (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  return parts.join('*');
}

/** CAS segments: one per adjustment group, at most 6 reason/amount/quantity triplets each. */
function casSegments(adjustments: CasAdjustment[]): string[] {
  const byGroup = new Map<string, CasAdjustment[]>();
  for (const a of adjustments) byGroup.set(a.group, [...(byGroup.get(a.group) || []), a]);
  const out: string[] = [];
  for (const [group, list] of byGroup) {
    for (let i = 0; i < list.length; i += 6) {
      out.push(seg('CAS', group, ...list.slice(i, i + 6).flatMap((a) => [a.reason, money(a.amount), ''])));
    }
  }
  return out;
}

/** NPI check digit: Luhn over the number prefixed with 80840 (CMS NPI standard). */
export function isValidNpi(npi: string): boolean {
  if (!/^\d{10}$/.test(npi)) return false;
  const digits = ('80840' + npi).split('').map(Number);
  let sum = 0;
  for (let i = digits.length - 1, dbl = false; i >= 0; i--, dbl = !dbl) {
    let d = digits[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** The PRACTICE_* env billing provider (used only when a claim has no configured billing provider). */
export function envBillingProvider(): BillingProviderForBatch {
  return {
    npi: GROUP_NPI,
    name: SUBMITTER_NAME,
    taxId: PRACTICE_TIN.replace(/\D/g, ''),
    address1: BILLING_ADDRESS,
    city: BILLING_CITY,
    state: BILLING_STATE,
    zip: BILLING_ZIP,
    phone: BILLING_PHONE,
  };
}

/** Problems with a 2010AA billing provider record. Empty = OK. */
export function billingProviderProblems(bp: BillingProviderForBatch, label = `Billing provider ${bp.npi || '(no NPI)'}`): string[] {
  const p: string[] = [];
  if (!isValidNpi(bp.npi)) p.push(`${label}: NPI ${bp.npi || '(blank)'} fails the NPI check digit`);
  if (!x12Text(bp.name)) p.push(`${label}: organization name is missing`);
  if (!/^\d{9}$/.test(bp.taxId.replace(/\D/g, '')) || bp.taxId === '821234567') p.push(`${label}: tax ID missing or placeholder`);
  if (!x12Text(bp.address1) || !x12Text(bp.city)) p.push(`${label}: street address / city not set`);
  if (/^P\.?\s*O\.?\s*BOX\b/i.test(bp.address1)) p.push(`${label}: 2010AA address cannot be a PO box`);
  if (!/^[A-Z]{2}$/.test(bp.state.toUpperCase())) p.push(`${label}: state must be a 2-letter code`);
  if (bp.zip.replace(/\D/g, '').length !== 9) p.push(`${label}: ZIP must be ZIP+4 (9 digits)`);
  return p;
}

/**
 * Problems that would get the file rejected (or a claim sent under placeholder IDs). Empty = OK.
 * With no claims (status banner) nothing is reported: billing providers are per claim.
 */
export function billingConfigProblems(claims: ClaimForBatch[] = []): string[] {
  const p: string[] = [];
  const seen = new Set<string>();
  const add = (list: string[]) => list.forEach((x) => { if (!seen.has(x)) { seen.add(x); p.push(x); } });
  claims.forEach(c => {
    if (c.billingProvider) {
      add(billingProviderProblems(c.billingProvider));
    } else {
      add(billingProviderProblems(envBillingProvider(), 'PRACTICE_GROUP_NPI / PRACTICE_* billing provider'));
    }
    // 1000A PER: submitter contact phone (env, else the billing provider's)
    const phone = SUBMITTER_PHONE || (c.billingProvider?.phone || '').replace(/\D/g, '');
    if (phone.length !== 10 || phone.startsWith('301555')) add(['Submitter phone (WAYSTAR_SUBMITTER_PHONE / PRACTICE_BILLING_PHONE or the billing provider phone) missing or placeholder']);
    if (c.renderingNpi && !isValidNpi(c.renderingNpi)) p.push(`claim ${c.claimId}: rendering NPI ${c.renderingNpi} fails the NPI check digit`);
    if (!/^\d{5}(\d{4})?$/.test(c.patientAddress.zip.replace(/\D/g, ''))) p.push(`claim ${c.claimId}: patient ZIP must be 5 or 9 digits`);
    if ((c.controlNumber || c.claimId).length > 38) p.push(`claim ${c.claimId}: CLM01 is longer than 38 characters`);
  });
  return p;
}

/** NM1 person: NM103 last, NM104 first, NM105 middle, NM106 prefix (unused), NM107 suffix, NM108 / NM109 id */
function nm1Person(entity: string, last: string, first: string, mi: string | undefined, qualifier?: string, id?: string, suffix?: string) {
  return seg('NM1', entity, '1', x12Text(last), x12Text(first), x12Text(mi), '', x12Text(suffix).replace(/\./g, ''), qualifier, id);
}

/** One 837P transaction set (ST..SE) for one claim. */
function claimTransaction(c: ClaimForBatch, stCtrl: string, now: Date): string[] {
  const bp = c.billingProvider ?? envBillingProvider();
  const clm01 = c.controlNumber || c.claimId;
  const claimTotal = c.lines.reduce((t, l) => t + Math.round(l.chargeAmount * 100), 0) / 100;
  const dependent = Boolean(c.subscriber && c.subscriber.relationship !== '18');
  const freq = c.frequencyCode || '1';
  const st: string[] = [];

  st.push(`ST*837*${stCtrl}*005010X222A1`);
  // BHT: 0019 = billing hierarchy, 00 = original transmission, BHT03 = originator reference (our CLM01), CH = chargeable
  st.push(seg('BHT', '0019', '00', clm01, x12Date(now), x12Time(now), 'CH'));
  // 1000A Submitter (NM1*41 + PER*IC) / 1000B Receiver (NM1*40)
  st.push(seg('NM1', '41', '2', x12Text(SUBMITTER_NAME), '', '', '', '', '46', SUBMITTER_ID));
  st.push(seg('PER', 'IC', 'BILLING', 'TE', SUBMITTER_PHONE || (bp.phone || '').replace(/\D/g, '')));
  st.push(seg('NM1', '40', '2', 'WAYSTAR', '', '', '', '', '46', RECEIVER_ID));

  // 2000A Billing provider hierarchical level (HL03 = 20), HL04 = 1: a subscriber level follows
  st.push('HL*1**20*1');
  // 2000A PRV billing provider specialty (BI = billing, PXC = NUCC taxonomy)
  if (c.billingTaxonomy) st.push(seg('PRV', 'BI', 'PXC', c.billingTaxonomy));
  // 2010AA Billing provider: NM1*85 (XX = NPI), N3/N4 (ZIP+4 required, no PO box), REF*EI tax ID
  st.push(seg('NM1', '85', '2', x12Text(bp.name), '', '', '', '', 'XX', bp.npi));
  st.push(seg('N3', x12Text(bp.address1), x12Text(bp.address2)));
  st.push(seg('N4', x12Text(bp.city), bp.state.toUpperCase(), bp.zip.replace(/\D/g, '')));
  st.push(seg('REF', 'EI', bp.taxId.replace(/\D/g, '')));

  // 2000B Subscriber level (HL03 = 22). HL04 = 1 when a 2000C patient level follows.
  st.push(`HL*2*1*22*${dependent ? 1 : 0}`);
  // SBR01 payer responsibility; SBR02 = 18 only when the subscriber is the patient (omitted otherwise);
  // SBR03 group number; SBR09 claim filing indicator
  st.push(seg('SBR', c.payerResponsibility || 'P', dependent ? '' : '18', x12Text(c.groupNumber), '', '', '', '', '', c.claimFilingCode || 'MC'));
  if (dependent) {
    // 2010BA Subscriber name. N3/N4/DMG are required only when the patient is the subscriber.
    const s = c.subscriber!;
    st.push(nm1Person('IL', s.lastName, s.firstName, s.middleInitial, 'MI', c.memberId));
  } else {
    // 2010BA Subscriber = patient: NM1*IL, N3, N4, DMG
    st.push(nm1Person('IL', c.patientLastName, c.patientFirstName, c.patientMiddleInitial, 'MI', c.memberId, c.patientNameSuffix));
    st.push(seg('N3', x12Text(c.patientAddress.line1), x12Text(c.patientAddress.line2)));
    st.push(seg('N4', x12Text(c.patientAddress.city), c.patientAddress.state.toUpperCase(), c.patientAddress.zip.replace(/\D/g, '')));
    st.push(seg('DMG', 'D8', cleanDate(c.patientDob), c.patientGender));
  }
  // 2010BB Payer name (PI = payer ID)
  st.push(seg('NM1', 'PR', '2', x12Text(c.payerName), '', '', '', '', 'PI', c.payerId));

  if (dependent) {
    // 2000C Patient level (HL03 = 23, parent = subscriber HL 2), PAT01 = relationship to subscriber
    st.push('HL*3*2*23*0');
    st.push(seg('PAT', c.subscriber!.relationship));
    // 2010CA Patient name (5010: no patient member ID here), N3, N4, DMG
    st.push(nm1Person('QC', c.patientLastName, c.patientFirstName, c.patientMiddleInitial, undefined, undefined, c.patientNameSuffix));
    st.push(seg('N3', x12Text(c.patientAddress.line1), x12Text(c.patientAddress.line2)));
    st.push(seg('N4', x12Text(c.patientAddress.city), c.patientAddress.state.toUpperCase(), c.patientAddress.zip.replace(/\D/g, '')));
    st.push(seg('DMG', 'D8', cleanDate(c.patientDob), c.patientGender));
  }

  // 2300 Claim: CLM01 control number, CLM02 total, CLM05 = POS : B : frequency (1 original / 7 replacement / 8 void),
  // CLM06 provider signature Y, CLM07 assignment A, CLM08 benefits assigned Y, CLM09 release of information Y
  st.push(seg('CLM', clm01, money(claimTotal), '', '', `${c.lines[0]?.posCode || '11'}:B:${freq}`, 'Y', 'A', 'Y', 'Y'));
  // 2300 REF*G1 prior authorization (IG order: G1 before F8)
  if (c.priorAuthNumber) st.push(seg('REF', 'G1', x12Text(c.priorAuthNumber)));
  // 2300 REF*F8 payer claim control number: required for replacement (7) and void (8)
  if ((freq === '7' || freq === '8') && c.payerClaimControlNumber) st.push(seg('REF', 'F8', x12Text(c.payerClaimControlNumber)));
  // 2300 HI: ABK principal diagnosis, ABF other diagnoses
  st.push(`HI*${c.diagnoses.map((d, i) => `${i === 0 ? 'ABK' : 'ABF'}:${d.replace('.', '')}`).join('*')}`);
  // 2310B Rendering provider (person, XX = NPI)
  if (c.renderingNpi) {
    st.push(nm1Person('82', c.renderingLastName ?? '', c.renderingFirstName ?? '', undefined, 'XX', c.renderingNpi));
    // 2310B PRV rendering provider specialty (PE = performing)
    if (c.renderingTaxonomy) st.push(seg('PRV', 'PE', 'PXC', c.renderingTaxonomy));
  }
  // 2310C Service facility location (organization; NPI only when the site has its own verified NPI)
  if (c.serviceFacility) {
    const f = c.serviceFacility;
    st.push(f.npi ? seg('NM1', '77', '2', x12Text(f.name), '', '', '', '', 'XX', f.npi) : seg('NM1', '77', '2', x12Text(f.name)));
    st.push(seg('N3', x12Text(f.address1), x12Text(f.address2)));
    st.push(seg('N4', x12Text(f.city), f.state.toUpperCase(), f.zip.replace(/\D/g, '')));
  }
  // 2310D Supervising provider (person, XX = NPI)
  if (c.supervisingProvider) {
    const sp = c.supervisingProvider;
    st.push(nm1Person('DQ', sp.lastName, sp.firstName, undefined, 'XX', sp.npi));
  }

  // 2320 Other subscriber information / 2330A other subscriber / 2330B other payer (COB)
  for (const o of c.otherPayers || []) {
    const lineLevel = Boolean(o.lines?.length);
    st.push(seg('SBR', o.responsibility, o.relationship, x12Text(o.groupNumber), '', '', '', '', '', o.claimFilingCode));
    st.push(...casSegments(o.adjustments));
    // AMT*D payer paid amount (required when the other payer adjudicated the claim)
    st.push(seg('AMT', 'D', money(o.paidAmount)));
    // OI03 benefits assignment Y, OI06 release of information Y
    st.push('OI***Y***Y');
    st.push(nm1Person('IL', o.subscriberLastName, o.subscriberFirstName, o.subscriberMiddleInitial, 'MI', o.memberId));
    st.push(seg('NM1', 'PR', '2', x12Text(o.payerName), '', '', '', '', 'PI', o.payerId));
    // 2330B DTP*573 adjudication date: required when the payer adjudicated and 2430 DTP*573 is not used
    if (!lineLevel) st.push(seg('DTP', '573', 'D8', cleanDate(o.paidDate)));
  }

  // 2400 Service lines: LX, SV1 (HC:procedure:modifiers, charge, UN units, pointers), DTP*472 date of service
  c.lines.forEach((l, li) => {
    const proc = ['HC', l.cpt, ...(l.modifiers || [])].join(':');
    st.push(`LX*${li + 1}`);
    st.push(seg('SV1', proc, money(l.chargeAmount), 'UN', l.units, '', '', l.diagnosisPointers.join(':')));
    st.push(seg('DTP', '472', 'D8', cleanDate(l.serviceDate)));
    // 2430 Line adjudication by each other payer: SVD, CAS, DTP*573
    for (const o of c.otherPayers || []) {
      const adj = o.lines?.find((x) => x.lineNumber === li + 1);
      if (!adj) continue;
      st.push(seg('SVD', o.payerId, money(adj.paidAmount), proc, '', l.units));
      st.push(...casSegments(adj.adjustments));
      st.push(seg('DTP', '573', 'D8', cleanDate(adj.paidDate || o.paidDate)));
    }
  });
  st.push(`SE*${st.length + 1}*${stCtrl}`);
  return st;
}

/**
 * One 837P file. `controlNumber` is the ISA13 / GS06 interchange control number: it comes from
 * the waystar_interchange_control_seq database sequence (nextInterchangeControlNumber in
 * waystarSftpSubmit.ts) so it is unique and increasing. It is never random.
 */
export function generate837P(claims: ClaimForBatch[], controlNumber: number): {
  content: string; batchId: string; totalCharges: number; controlNumber: string;
  transactionSets: Array<{ claimId: string; controlNumber: string; claimControlNumber: string }>;
} {
  if (!Number.isInteger(controlNumber) || controlNumber < 1 || controlNumber > 999999999) {
    throw new Error('837 interchange control number (ISA13) must be a sequence value from 1 to 999999999');
  }
  const now = new Date();
  const ctrl = controlNumber;
  // Full control number: batch ids (waystar_claim_batches.batch_control_number) stay unique
  const batchId = `ALTRIXS-${x12Date(now)}-${pad(ctrl, 9)}`;
  const seg0: string[] = [];

  seg0.push(`ISA*00*          *00*          *ZZ*${SUBMITTER_ID.padEnd(15)}*ZZ*${RECEIVER_ID.padEnd(15)}*${x12DateShort(now)}*${x12Time(now)}*^*00501*${pad(ctrl % 1000000000, 9)}*0*${USAGE_INDICATOR}*:`);
  seg0.push(`GS*HC*${SUBMITTER_ID}*${RECEIVER_ID}*${x12Date(now)}*${x12Time(now)}*${ctrl}*X*005010X222A1`);

  // Group transaction sets by billing provider NPI (stable within a provider)
  const ordered = claims
    .map((c, i) => ({ c, i, npi: (c.billingProvider ?? envBillingProvider()).npi }))
    .sort((a, b) => (a.npi === b.npi ? a.i - b.i : a.npi < b.npi ? -1 : 1))
    .map((x) => x.c);

  let totalCharges = 0;
  const transactionSets: Array<{ claimId: string; controlNumber: string; claimControlNumber: string }> = [];
  ordered.forEach((c, idx) => {
    const stCtrl = pad(idx + 1, 4);
    totalCharges += c.lines.reduce((t, l) => t + Math.round(l.chargeAmount * 100), 0) / 100;
    transactionSets.push({ claimId: c.claimId, controlNumber: stCtrl, claimControlNumber: c.controlNumber || c.claimId });
    seg0.push(...claimTransaction(c, stCtrl, now));
  });

  seg0.push(`GE*${ordered.length}*${ctrl}`);
  seg0.push(`IEA*1*${pad(ctrl % 1000000000, 9)}`);

  return { content: seg0.join('~\n') + '~', batchId, totalCharges: Math.round(totalCharges * 100) / 100, controlNumber: String(ctrl), transactionSets };
}

// ─── Outbound: submit a claim batch to Waystar ───────────────────────────────

export async function submitClaimBatch(claims: ClaimForBatch[], userId: string, opts: { controlNumber: number }): Promise<BatchResult> {
  const problems = billingConfigProblems(claims);
  if (problems.length && !DEMO_MODE) throw new Error(`837 not sent: ${problems.join('; ')}`);
  const { content, batchId, totalCharges, controlNumber, transactionSets } = generate837P(claims, opts.controlNumber);
  const fileName = `${batchId}.837`;
  const s3Key = `${OUTBOUND_PREFIX}/${fileName}`;
  const sentAt = new Date().toISOString();

  await writeAuditLog({
    actorUid: userId,
    actorRole: 'billing_specialist',
    action: 'EXPORT',
    resourceType: 'claim',
    resourceId: batchId,
    patientId: 'none',
    ipAddress: 'server',
    userAgent: 'waystar-sftp-service',
    outcome: 'SUCCESS',
    details: { event: 'claim_batch_submitted', fileName, claimCount: claims.length, totalCharges, demo: DEMO_MODE },
  });

  if (DEMO_MODE) {
    return {
      batchId, controlNumber, transactionSets, fileName, s3Key,
      transferId: `demo-transfer-${Date.now().toString(36)}`,
      claimCount: claims.length, totalCharges,
      status: 'demo', demo: true, sentAt,
    };
  }

  // 1) Stage the batch in S3 (bucket policy enforces KMS encryption)
  await s3Client!.send(new PutObjectCommand({
    Bucket: STAGING_BUCKET,
    Key: s3Key,
    Body: content,
    ContentType: 'text/plain',
    ServerSideEncryption: 'aws:kms',
    SSEKMSKeyId: KMS_KEY_ID,
  }));

  // 2) Push to Waystar via the Transfer Family SFTP connector
  const transfer = await transferClient!.send(new StartFileTransferCommand({
    ConnectorId: CONNECTOR_ID,
    SendFilePaths: [`/${STAGING_BUCKET}/${s3Key}`],
    RemoteDirectoryPath: REMOTE_INBOUND_DIR,
  }));

  return {
    batchId, controlNumber, transactionSets, fileName, s3Key,
    transferId: transfer.TransferId || 'unknown',
    claimCount: claims.length, totalCharges,
    status: 'sent', demo: false, sentAt,
  };
}

// ─── Inbound: poll Waystar's outbound folder for responses ───────────────────

const DEMO_INBOUND: InboundFile[] = [
  {
    fileName: '999_ALTRIXS-20261014-0001.txt', type: '999',
    receivedAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
    s3Key: `${INBOUND_PREFIX}/999/999_ALTRIXS-20261014-0001.txt`,
    summary: 'Functional acknowledgment — batch accepted, 12 of 12 transactions accepted', demo: true,
  },
  {
    fileName: '277CA_ALTRIXS-20261014-0001.txt', type: '277CA',
    receivedAt: new Date(Date.now() - 90 * 60e3).toISOString(),
    s3Key: `${INBOUND_PREFIX}/277ca/277CA_ALTRIXS-20261014-0001.txt`,
    summary: 'Claim status — 11 accepted for adjudication, 1 rejected (invalid member ID, claim CLM-2611)', demo: true,
  },
  {
    fileName: '835_OPTUMMD_CK884201.txt', type: '835',
    receivedAt: new Date(Date.now() - 20 * 60e3).toISOString(),
    s3Key: `${INBOUND_PREFIX}/835/835_OPTUMMD_CK884201.txt`,
    summary: 'Remittance — Optum Maryland check #884201, $4,312.50 across 9 claims (2 with patient responsibility)', demo: true,
  },
];

export async function pollInboundFiles(userId: string): Promise<{ files: InboundFile[]; listingId: string; demo: boolean }> {
  await writeAuditLog({
    actorUid: userId,
    actorRole: 'billing_specialist',
    action: 'READ',
    resourceType: 'claim',
    resourceId: 'waystar-outbound-listing',
    patientId: 'none',
    ipAddress: 'server',
    userAgent: 'waystar-sftp-service',
    outcome: 'SUCCESS',
    details: { event: 'inbound_poll', demo: DEMO_MODE },
  });

  if (DEMO_MODE) {
    return { files: DEMO_INBOUND, listingId: `demo-listing-${Date.now().toString(36)}`, demo: true };
  }

  // Asynchronous listing: Transfer Family writes the directory listing to S3;
  // an S3 event (or the next poll) retrieves new files via RetrieveFilePaths.
  const listing = await transferClient!.send(new StartDirectoryListingCommand({
    ConnectorId: CONNECTOR_ID,
    RemoteDirectoryPath: REMOTE_OUTBOUND_DIR,
    OutputDirectoryPath: `/${STAGING_BUCKET}/${INBOUND_PREFIX}/listings`,
  }));

  return { files: [], listingId: listing.ListingId || 'pending', demo: false };
}

export async function retrieveInboundFiles(remotePaths: string[], userId: string): Promise<{ transferId: string; retrieved: string[]; demo: boolean }> {
  await writeAuditLog({
    actorUid: userId,
    actorRole: 'billing_specialist',
    action: 'READ',
    resourceType: 'claim',
    resourceId: 'waystar-inbound-retrieve',
    patientId: 'none',
    ipAddress: 'server',
    userAgent: 'waystar-sftp-service',
    outcome: 'SUCCESS',
    details: { event: 'inbound_retrieve', count: remotePaths.length, demo: DEMO_MODE },
  });

  if (DEMO_MODE) {
    return { transferId: `demo-retrieve-${Date.now().toString(36)}`, retrieved: remotePaths, demo: true };
  }

  // StartFileTransfer accepts at most 10 paths per call
  const transferIds: string[] = [];
  for (let i = 0; i < remotePaths.length; i += 10) {
    const transfer = await transferClient!.send(new StartFileTransferCommand({
      ConnectorId: CONNECTOR_ID,
      RetrieveFilePaths: remotePaths.slice(i, i + 10),
      LocalDirectoryPath: `/${STAGING_BUCKET}/${INBOUND_PREFIX}`,
    }));
    transferIds.push(transfer.TransferId || 'unknown');
  }
  return { transferId: transferIds.join(','), retrieved: remotePaths, demo: false };
}

// ─── Transfer results and listings (Claims page send / response check) ───────

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type TransferFileState = {
  filePath: string;
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'UNKNOWN';
  failure?: string;
};

/**
 * Waits up to waitMs for a connector transfer to finish. `error` is set when the
 * results cannot be read (for example a missing transfer:ListFileTransferResults
 * permission); callers then treat delivery as unconfirmed, not failed.
 */
export async function waitForTransfer(transferId: string, waitMs = 20_000): Promise<{ files: TransferFileState[]; error?: string }> {
  if (DEMO_MODE) return { files: [] };
  const deadline = Date.now() + waitMs;
  let files: TransferFileState[] = [];
  for (;;) {
    try {
      const out = await transferClient!.send(new ListFileTransferResultsCommand({ ConnectorId: CONNECTOR_ID, TransferId: transferId }));
      files = (out.FileTransferResults || []).map((r) => ({
        filePath: r.FilePath || '',
        status: (['QUEUED', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(String(r.StatusCode)) ? r.StatusCode : 'UNKNOWN') as TransferFileState['status'],
        failure: [r.FailureCode, r.FailureMessage].filter(Boolean).join(': ') || undefined,
      }));
    } catch (err) {
      return { files, error: err instanceof Error ? err.message : String(err) };
    }
    const pending = files.length === 0 || files.some((f) => f.status === 'QUEUED' || f.status === 'IN_PROGRESS');
    if (!pending || Date.now() >= deadline) return { files };
    await sleep(2000);
  }
}

export type RemoteFile = { remotePath: string; fileName: string; size?: number; modified?: string };

/**
 * Lists Waystar's response folder (/Download) and waits for the connector to
 * write the listing JSON to S3. Sub-folders such as /Download/Archive are not
 * descended into.
 */
export async function listRemoteResponseFiles(userId: string, waitMs = 20_000): Promise<{
  files: RemoteFile[]; listingId: string; truncated: boolean; demo: boolean; error?: string;
}> {
  await writeAuditLog({
    actorUid: userId,
    actorRole: 'billing_specialist',
    action: 'READ',
    resourceType: 'claim',
    resourceId: 'waystar-outbound-listing',
    patientId: 'none',
    ipAddress: 'server',
    userAgent: 'waystar-sftp-service',
    outcome: 'SUCCESS',
    details: { event: 'inbound_listing', demo: DEMO_MODE },
  });
  if (DEMO_MODE) return { files: [], listingId: 'demo', truncated: false, demo: true };

  const listing = await transferClient!.send(new StartDirectoryListingCommand({
    ConnectorId: CONNECTOR_ID,
    RemoteDirectoryPath: REMOTE_OUTBOUND_DIR,
    OutputDirectoryPath: `/${STAGING_BUCKET}/${INBOUND_PREFIX}/listings`,
  }));
  const listingId = listing.ListingId || 'unknown';
  const key = `${INBOUND_PREFIX}/listings/${listing.OutputFileName || `${CONNECTOR_ID}-${listingId}.json`}`;
  const deadline = Date.now() + waitMs;
  let lastError = '';
  for (;;) {
    const text = await readS3Text(key);
    if (text.ok) {
      try {
        const json = JSON.parse(text.content) as { files?: Array<{ filePath?: string; size?: number; modifiedTimestamp?: string }>; truncated?: boolean };
        const files = (json.files || [])
          .filter((f) => typeof f.filePath === 'string' && f.filePath)
          .map((f) => ({
            remotePath: f.filePath as string,
            fileName: (f.filePath as string).split('/').pop() || (f.filePath as string),
            size: f.size,
            modified: f.modifiedTimestamp,
          }));
        return { files, listingId, truncated: Boolean(json.truncated), demo: false };
      } catch {
        return { files: [], listingId, truncated: false, demo: false, error: 'Directory listing JSON could not be parsed' };
      }
    }
    lastError = 'error' in text ? text.error : '';
    if (Date.now() >= deadline) {
      return { files: [], listingId, truncated: false, demo: false, error: `Directory listing not available yet (${lastError})` };
    }
    await sleep(2000);
  }
}

/** S3 key a retrieved response file lands at (retrieveInboundFiles writes to the inbound prefix). */
export function inboundS3Key(fileName: string) {
  return `${INBOUND_PREFIX}/${fileName}`;
}

/** Reads a staged S3 object without throwing (missing objects and permission errors come back as `ok: false`). */
export async function readS3Text(key: string): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  if (DEMO_MODE) return { ok: false, error: 'demo mode' };
  try {
    const obj = await s3Client!.send(new GetObjectCommand({ Bucket: STAGING_BUCKET, Key: key }));
    return { ok: true, content: (await obj.Body?.transformToString()) || '' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.name || err.message : String(err) };
  }
}

/** Polls S3 until each key exists or waitMs passes. Returns the contents that arrived. */
export async function waitForS3Objects(keys: string[], waitMs = 25_000): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (DEMO_MODE) return found;
  const deadline = Date.now() + waitMs;
  for (;;) {
    for (const key of keys) {
      if (found.has(key)) continue;
      const text = await readS3Text(key);
      if (text.ok) found.set(key, text.content);
    }
    if (found.size === keys.length || Date.now() >= deadline) return found;
    await sleep(2500);
  }
}

// ─── Status / connection health ──────────────────────────────────────────────

export async function getConnectionStatus(): Promise<{
  demo: boolean; region: string; connectorId: string; bucket: string;
  connectorStatus: string; remoteHost: string;
}> {
  if (DEMO_MODE) {
    return {
      demo: true, region: REGION,
      connectorId: 'not configured — demo mode',
      bucket: STAGING_BUCKET || 'not configured',
      connectorStatus: 'DEMO',
      remoteHost: 'sftp.waystar.com (pending kickoff credentials)',
    };
  }
  const described = await transferClient!.send(new DescribeConnectorCommand({ ConnectorId: CONNECTOR_ID }));
  return {
    demo: false, region: REGION,
    connectorId: CONNECTOR_ID,
    bucket: STAGING_BUCKET,
    connectorStatus: described.Connector?.SftpConfig ? 'CONFIGURED' : 'UNKNOWN',
    remoteHost: described.Connector?.Url || 'unknown',
  };
}

// ─── 835 quick parse (summary for the billing dashboard) ─────────────────────

export function parse835Summary(content: string): { checkNumber: string; totalPaid: number; claimCount: number; payerName: string } {
  const get = (re: RegExp) => (content.match(re) || [])[1] || '';
  const bpr = content.match(/BPR\*[A-Z]\*([\d.]+)\*/);
  const trn = content.match(/TRN\*1\*([^*~]+)/);
  const payer = content.match(/N1\*PR\*([^*~]+)/);
  const clpCount = (content.match(/CLP\*/g) || []).length;
  void get;
  return {
    checkNumber: trn ? trn[1] : 'unknown',
    totalPaid: bpr ? parseFloat(bpr[1]) : 0,
    claimCount: clpCount,
    payerName: payer ? payer[1] : 'unknown',
  };
}

export async function getS3FileContent(key: string): Promise<string> {
  if (DEMO_MODE) return 'DEMO MODE — file contents available once the Transfer Family connector is configured.';
  const obj = await s3Client!.send(new GetObjectCommand({ Bucket: STAGING_BUCKET, Key: key }));
  return (await obj.Body?.transformToString()) || '';
}
