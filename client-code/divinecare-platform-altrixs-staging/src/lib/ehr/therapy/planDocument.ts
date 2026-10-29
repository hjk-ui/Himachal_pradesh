/**
 * The treatment plan document, laid out like the practice's Valant "Valant Treatment Plan"
 * template: primary header "Treatment Plan", practice logo, patient block (name in Valant's
 * format, Patient ID, provider, DOB, age, address, main phone, Documentation ID, insurance 1–3,
 * diagnosis), the plan fields, the Problem → Goal → Objective → Intervention body, and signature
 * blocks with Valant's attestation text for each kind of signer.
 *
 * Built on the server when the clinician signs and frozen on the plan (TreatmentPlan.signedDocument),
 * so the print view and the patient portal show exactly what was signed. Pure: no Prisma, no React.
 */
import { valantPatientName, type DisplayNameParts } from '@/lib/clients/legalName';
import { ageOn, isoDate } from '@/lib/ehr/psychMedMgmt';
import { arrVal, strVal, type TemplateCtx, type Values } from '@/lib/ehr/therapy/engine';
import { planProblems, renderProblems, type PlanProblem } from '@/lib/ehr/therapy/planHierarchy';
import { PLAN_PRIMARY_HEADER, planDates, planDiagnoses, renderPlanSections, type PlanDiagnosis } from '@/lib/ehr/therapy/planTemplate';
import { TP, TREATMENT_PLAN_SECTIONS } from '@/lib/ehr/therapy/sections';

// ─── Attestations (exact text from the practice's Valant template) ──────────

/** Patient, guardian(s), guarantor and other (non-provider) signers */
export const PATIENT_SIGNER_ATTESTATION = 'I participated in the development of this treatment plan and I agree to its content.';
/** Owner, supervisor and other providers */
export const PROVIDER_SIGNER_ATTESTATION =
  "I have reviewed this client's individualized treatment plan and agree that the goals, objectives, and/or interventions listed in this treatment plan are clinically indicated.";

export type ProviderSignerRole = 'Owner' | 'Supervisor' | 'Other provider';
export type PersonSignerRole = 'Patient' | 'Guardian' | 'Guarantor' | 'Other signer';
export type SignerRole = ProviderSignerRole | PersonSignerRole;

export const PERSON_SIGNER_ROLES: readonly PersonSignerRole[] = ['Patient', 'Guardian', 'Guarantor', 'Other signer'];

export function attestationFor(role: SignerRole): string {
  return role === 'Owner' || role === 'Supervisor' || role === 'Other provider' ? PROVIDER_SIGNER_ATTESTATION : PATIENT_SIGNER_ATTESTATION;
}

/** 42 CFR 2.32 notice (abbreviated form) printed on plans with a substance use disorder diagnosis */
export const PART2_NOTICE = '42 CFR part 2 prohibits unauthorized use or disclosure of these records.';

// ─── Document model ─────────────────────────────────────────────────────────

export type PlanInsurance = { rank: 1 | 2 | 3; payerName: string; memberId: string | null; groupNumber: string | null };

export type PlanDocumentHeader = {
  primaryHeader: string;
  practiceName: string | null;
  logoUrl: string | null;
  /** Valant format: "Preferred [First] M. Last, Suffix (PatientID)" */
  patientName: string;
  patientId: string | null;
  provider: string | null;
  dateOfBirth: string | null;
  age: number | null;
  address: string[];
  mainPhone: string | null;
  /** Documentation ID = the plan id */
  documentationId: string;
  insurances: PlanInsurance[];
  diagnoses: PlanDiagnosis[];
};

export type PlanDocument = {
  version: 1;
  header: PlanDocumentHeader;
  plan: {
    kind: 'Initial' | 'Review';
    startDate: string | null;
    effectiveUntil: string | null;
    reviewDate: string | null;
    patientInstructions: string;
    globalComments: string;
    /** Checked participation boxes (exact wording) */
    participation: string[];
  };
  problems: PlanProblem[];
  /** The other plan sections (clinic ITP form content), as rendered text */
  sections: { heading: string; text: string }[];
  /** Substance use disorder diagnosis on the plan: the Part 2 notice prints */
  part2: boolean;
  generatedAt: string;
};

export type PlanDocumentClient = DisplayNameParts & {
  mrn: string | null;
  dateOfBirth: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
};

/** Insurance 1–3 from the client's coverages (P/S/T); the intake's primary insurance when none. */
export function planInsurances(
  coverages: { rank: string; payerName: string | null; memberId: string | null; groupNumber: string | null; active?: boolean }[],
  fallback: { insurancePayer: string | null; insuranceMemberId: string | null; insuranceGroupNumber: string | null } | null
): PlanInsurance[] {
  const order: Record<string, 1 | 2 | 3> = { P: 1, S: 2, T: 3 };
  const out = coverages
    .filter((c) => c.active !== false && order[c.rank] && (c.payerName || c.memberId))
    .map((c) => ({ rank: order[c.rank], payerName: c.payerName?.trim() || 'Payer not named', memberId: c.memberId?.trim() || null, groupNumber: c.groupNumber?.trim() || null }))
    .sort((a, b) => a.rank - b.rank);
  if (!out.length && fallback?.insurancePayer?.trim()) {
    out.push({ rank: 1, payerName: fallback.insurancePayer.trim(), memberId: fallback.insuranceMemberId?.trim() || null, groupNumber: fallback.insuranceGroupNumber?.trim() || null });
  }
  return out.slice(0, 3);
}

export function addressLines(c: Pick<PlanDocumentClient, 'addressLine1' | 'addressLine2' | 'city' | 'state' | 'postalCode'>): string[] {
  const t = (v: string | null | undefined) => (v || '').trim();
  const cityLine = [t(c.city), [t(c.state), t(c.postalCode)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [t(c.addressLine1), t(c.addressLine2), cityLine].filter(Boolean);
}

export function buildPlanDocument(input: {
  planId: string;
  values: Values;
  ctx: TemplateCtx;
  client: PlanDocumentClient;
  providerName: string | null;
  practice: { name: string | null; logoUrl: string | null };
  insurances: PlanInsurance[];
  /** YYYY-MM-DD the document is produced (age is computed on this day) */
  today: string;
  now?: Date;
}): PlanDocument {
  const { values } = input;
  const dob = input.client.dateOfBirth ? isoDate(input.client.dateOfBirth) : null;
  const diagnoses = planDiagnoses(values);
  const dates = planDates(values);
  const rendered = renderPlanSections(values, input.ctx);
  const review = strVal(values, 'reviewDate');
  return {
    version: 1,
    header: {
      primaryHeader: PLAN_PRIMARY_HEADER,
      practiceName: input.practice.name?.trim() || null,
      logoUrl: input.practice.logoUrl && /^(https:\/\/|\/)/.test(input.practice.logoUrl) ? input.practice.logoUrl : null,
      patientName: valantPatientName({ ...input.client, patientId: input.client.mrn }),
      patientId: input.client.mrn?.trim() || null,
      provider: input.providerName?.trim() || null,
      dateOfBirth: dob,
      age: ageOn(dob, input.today),
      address: addressLines(input.client),
      mainPhone: input.client.phone?.trim() || null,
      documentationId: input.planId,
      insurances: input.insurances.slice(0, 3),
      diagnoses,
    },
    plan: {
      kind: strVal(values, 'planKind') === 'Review' ? 'Review' : 'Initial',
      startDate: dates.startDate,
      effectiveUntil: dates.effectiveUntil,
      reviewDate: /^\d{4}-\d{2}-\d{2}$/.test(review) ? review : null,
      patientInstructions: strVal(values, 'patientInstructions'),
      globalComments: strVal(values, 'globalComments'),
      participation: arrVal(values, 'tpParticipation'),
    },
    problems: planProblems(values),
    // Hierarchy, instructions and participation are laid out separately; diagnoses are in the header
    sections: TREATMENT_PLAN_SECTIONS.filter((h) => h !== TP.goals && h !== TP.instructions)
      .map((heading) => ({ heading, text: (rendered[heading] || '').trim() }))
      .filter((s) => s.text),
    part2: diagnoses.some((d) => /^F1\d/.test(d.code)),
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

/** A stored document (TreatmentPlan.signedDocument), or null when absent / not this shape. */
export function parsePlanDocument(raw: unknown): PlanDocument | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const d = raw as Partial<PlanDocument>;
  if (d.version !== 1 || !d.header || !d.plan || !Array.isArray(d.problems)) return null;
  return { ...(d as PlanDocument), problems: planProblems({ tpProblems: d.problems }) };
}

// ─── Signatures ─────────────────────────────────────────────────────────────

export type OtherSignature = {
  id: string;
  role: PersonSignerRole | 'Other provider';
  /** Typed name (person signers) or the provider's name */
  name: string;
  relationship: string | null;
  method: 'portal' | 'in-office' | 'in-app';
  signedAt: string;
  /** Staff who recorded an in-office signature (name) */
  recordedBy: string | null;
  attestation: string;
};

export function parseOtherSignatures(raw: unknown): OtherSignature[] {
  if (!Array.isArray(raw)) return [];
  const roles = [...PERSON_SIGNER_ROLES, 'Other provider'];
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r) => ({
      id: typeof r.id === 'string' ? r.id : '',
      role: (roles.includes(String(r.role)) ? r.role : 'Other signer') as OtherSignature['role'],
      name: typeof r.name === 'string' ? r.name.slice(0, 120) : '',
      relationship: typeof r.relationship === 'string' && r.relationship ? r.relationship.slice(0, 60) : null,
      method: (['portal', 'in-office', 'in-app'].includes(String(r.method)) ? r.method : 'in-office') as OtherSignature['method'],
      signedAt: typeof r.signedAt === 'string' ? r.signedAt : '',
      recordedBy: typeof r.recordedBy === 'string' && r.recordedBy ? r.recordedBy.slice(0, 120) : null,
      attestation: typeof r.attestation === 'string' ? r.attestation : '',
    }))
    .filter((r) => r.id && r.name && r.signedAt)
    .slice(0, 20);
}

export type SignatureBlock = {
  role: SignerRole;
  label: string;
  attestation: string;
  status: 'signed' | 'pending' | 'declined' | 'verbal' | 'not-sent';
  name: string | null;
  signedAt: string | null;
  detail: string | null;
};

export type PlanSignatureColumns = {
  clinicianSignedAt: Date | string | null;
  clinicianSignedByName: string | null;
  supervisorRequired: boolean;
  supervisorSignedAt: Date | string | null;
  supervisorSignedByName: string | null;
  patientSignatureStatus: string;
  patientSentAt: Date | string | null;
  patientSignedAt: Date | string | null;
  patientSignedName: string | null;
  patientDeclinedAt: Date | string | null;
  patientDeclineReason: string | null;
  patientVerbalBy: string | null;
};

const iso = (v: Date | string | null | undefined) => (v ? (typeof v === 'string' ? v : v.toISOString()) : null);

/** Signature blocks in document order: owner, supervisor (pre-licensed author), patient, then guardian(s) / guarantor / others. */
export function buildSignatureBlocks(p: PlanSignatureColumns, others: OtherSignature[]): SignatureBlock[] {
  const blocks: SignatureBlock[] = [
    {
      role: 'Owner',
      label: 'Provider (plan owner)',
      attestation: PROVIDER_SIGNER_ATTESTATION,
      status: p.clinicianSignedAt ? 'signed' : 'pending',
      name: p.clinicianSignedByName,
      signedAt: iso(p.clinicianSignedAt),
      detail: p.clinicianSignedAt ? 'Signed in Altrixs' : null,
    },
  ];
  if (p.supervisorRequired) {
    blocks.push({
      role: 'Supervisor',
      label: 'Supervisor',
      attestation: PROVIDER_SIGNER_ATTESTATION,
      status: p.supervisorSignedAt ? 'signed' : 'pending',
      name: p.supervisorSignedByName,
      signedAt: iso(p.supervisorSignedAt),
      detail: p.supervisorSignedAt ? 'Signed in Altrixs (author is pre-licensed)' : 'Required: the author is pre-licensed',
    });
  }
  const patientInOffice = others.find((o) => o.role === 'Patient');
  const st = p.patientSignatureStatus;
  blocks.push({
    role: 'Patient',
    label: 'Patient',
    attestation: PATIENT_SIGNER_ATTESTATION,
    status: st === 'SIGNED' ? 'signed' : st === 'VERBAL' ? 'verbal' : st === 'DECLINED' ? 'declined' : st === 'AWAITING' ? 'pending' : 'not-sent',
    name: st === 'SIGNED' ? p.patientSignedName : null,
    signedAt: st === 'SIGNED' || st === 'VERBAL' ? iso(p.patientSignedAt) : st === 'DECLINED' ? iso(p.patientDeclinedAt) : null,
    detail:
      st === 'SIGNED'
        ? patientInOffice
          ? `Signed in office${patientInOffice.recordedBy ? ` (recorded by ${patientInOffice.recordedBy})` : ''}`
          : 'Signed in the patient portal'
        : st === 'VERBAL'
          ? `Verbal consent (telehealth) obtained by ${p.patientVerbalBy || 'staff'}`
          : st === 'DECLINED'
            ? `Declined${p.patientDeclineReason ? `: “${p.patientDeclineReason}”` : ''}`
            : st === 'AWAITING'
              ? 'Sent to the patient portal'
              : null,
  });
  for (const o of others) {
    if (o.role === 'Patient') continue;
    blocks.push({
      role: o.role,
      label: o.role === 'Guardian' ? 'Guardian' : o.role === 'Guarantor' ? 'Guarantor' : o.role === 'Other provider' ? 'Other provider' : 'Other signer',
      attestation: attestationFor(o.role),
      status: 'signed',
      name: o.relationship ? `${o.name} (${o.relationship})` : o.name,
      signedAt: o.signedAt,
      detail: o.method === 'portal' ? 'Signed in the patient portal' : o.method === 'in-app' ? 'Signed in Altrixs' : `Signed in office${o.recordedBy ? ` (recorded by ${o.recordedBy})` : ''}`,
    });
  }
  return blocks;
}

// ─── Text (signed snapshot) ─────────────────────────────────────────────────


/** Plain-text plan document (TreatmentPlan.signedSnapshot; what the portal showed before this release). */
export function renderPlanDocumentText(doc: PlanDocument): string {
  const h = doc.header;
  const lines: string[] = [h.primaryHeader];
  if (h.practiceName) lines.push(h.practiceName);
  lines.push(
    `Patient: ${h.patientName}`,
    `Patient ID: ${h.patientId || 'None on file'}`,
    `Provider: ${h.provider || 'Not on file'}`,
    `DOB: ${h.dateOfBirth || 'None on file'}${h.age != null ? ` (age ${h.age})` : ''}`,
    `Address: ${h.address.length ? h.address.join(', ') : 'None on file'}`,
    `Main phone: ${h.mainPhone || 'None on file'}`,
    `Documentation ID: ${h.documentationId}`
  );
  if (h.insurances.length) {
    h.insurances.forEach((i) => lines.push(`Insurance ${i.rank}: ${i.payerName}${i.memberId ? ` — ID # ${i.memberId}` : ''}${i.groupNumber ? ` — Group # ${i.groupNumber}` : ''}`));
  } else {
    lines.push('Insurance: None on file');
  }
  lines.push(
    `Diagnosis: ${h.diagnoses.length ? h.diagnoses.map((d) => `${d.code}${d.description ? ` ${d.description}` : ''}${d.isPrimary ? ' (primary)' : ''}`).join('; ') : 'None listed'}`
  );
  const p = doc.plan;
  lines.push(
    '',
    `Plan type: ${p.kind === 'Review' ? 'Treatment Plan Review' : 'Initial treatment plan'}`,
    `Start Date: ${p.startDate || 'Not set'}`,
    `Effective Until: ${p.effectiveUntil || 'Not set'}`,
    `Next review: ${p.reviewDate || 'Not set'}`
  );
  if (p.patientInstructions) lines.push('', 'Patient Instructions', p.patientInstructions);
  if (p.globalComments) lines.push('', 'Global Comments', p.globalComments);
  const body = renderProblems(doc.problems);
  lines.push('', TP.goals, body || 'None entered');
  for (const s of doc.sections) lines.push('', s.heading, s.text);
  if (p.participation.length) lines.push('', ...p.participation.map((x) => `[x] ${x}`));
  lines.push('', 'Signatures', `Patient / Guardian(s) / Guarantor / Other signers: ${PATIENT_SIGNER_ATTESTATION}`, `Owner / Supervisor / Other providers: ${PROVIDER_SIGNER_ATTESTATION}`);
  if (doc.part2) lines.push('', PART2_NOTICE);
  return lines.join('\n');
}
