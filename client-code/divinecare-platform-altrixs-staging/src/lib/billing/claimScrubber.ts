import 'server-only';

import type { ClaimStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { loadPrpSettingsRow } from '@/lib/prp/settings';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { chargeAmountCents, cptDescription, cptFeeMissing, missingFeeMessage } from '@/lib/constants/cpt';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { claimClearinghouseMode } from '@/lib/integrations/waystar';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
import { submitClaim } from '@/lib/billing/clearinghouseClaims';
import type { ClaimActor } from '@/lib/billing/claims';
import { selfPayFeeProblem } from '@/lib/billing/feeSchedule';
import { planPendingClaimWarning } from '@/lib/ehr/therapy/rules';
import {
  codingEditFindings,
  noteClaimFindings,
  notePracticeDate,
  prpClaimBlock,
  timelyFiling,
} from '@/lib/billing/claimRules';
import { loadPayerMappings } from '@/lib/billing/waystarConfig';
import { findPayerMapping } from '@/lib/billing/waystarSftpClaims';

/** Payer mapping lookup for per-payer rules (timely filing); empty when the table is missing. */
async function payerLimitLookup(organizationId: string) {
  const mappings = await loadPayerMappings(organizationId).catch(() => []);
  return (payer: string | null) => findPayerMapping(mappings, payer)?.filingLimitDays ?? null;
}
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { extractNoteCpt } from '@/lib/billing/noteCoding';
import { claimReadiness, describeGaps, type DemographicsInput } from '@/lib/clients/demographics';
import { claimDiagnosisFindings } from '@/lib/diagnoses/rules';
import { isMarylandPbhsClaimPayer } from '@/lib/consents/carelon/medicaid';
import { loadDiagnosisListsFor } from '@/lib/diagnoses/store';
import type { DiagnosisRow } from '@/lib/diagnoses/model';

export type ScrubSeverity = 'error' | 'warning' | 'tip';
export type ScrubStatus = 'ready' | 'errors' | 'warnings';

export type ScrubFinding = {
  code: string;
  severity: ScrubSeverity;
  message: string;
};

/** Billing + leadership. Office Manager removed 2026-10-22 (owner: patient-side billing only). */
const SCRUB_ROLES: Role[] = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];

export const SCRUB_RULES = [
  { code: 'PAYER_REQUIRED', label: 'Payer present' },
  { code: 'CPT_REQUIRED', label: 'Valid CPT code' },
  { code: 'AMOUNT_REQUIRED', label: 'Charge amount > 0' },
  { code: 'UNITS_VALID', label: 'Units between 1 and 24' },
  { code: 'MEMBER_ID', label: 'Insurance member ID' },
  { code: 'DOB_REQUIRED', label: 'Patient date of birth' },
  { code: 'ICD10_REQUIRED', label: 'Diagnosis / ICD-10' },
  { code: 'NPI_RENDERING', label: 'Rendering NPI' },
  { code: 'NOTE_SIGNED', label: 'Signed progress note' },
  { code: 'TIMELY_FILING', label: 'Timely filing window' },
  { code: 'PLAN_PENDING', label: 'Treatment plan on file for the note' },
  { code: 'COSIGN_PENDING', label: 'Supervisor co-signature on the note' },
  { code: 'NOTE_CPT_MISSING', label: 'CPT recorded on the signed note' },
  { code: 'APPT_MISMATCH', label: 'Note matches its appointment (clinician, date)' },
  { code: 'PRP_PENDING', label: 'PRP billing model confirmed' },
  { code: 'CODING_EDITS', label: 'Minutes vs CPT, add-ons, NCCI pairs, per-day caps' },
  { code: 'RENDERING_LEGAL_NAME', label: 'Rendering provider legal name' },
  { code: 'PATIENT_DEMOGRAPHICS', label: 'Patient legal name, sex, address and ZIP (837P 2010BA / 2010CA)' },
  { code: 'DX_STANDARD', label: 'Diagnoses: billable FY2027 codes, max 12, primary current on the chart for the DOS, sequencing, BH primary' },
] as const;

export type ScrubActor = {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
};

export function canAccessClaimScrubber(role: Role | undefined | null) {
  return Boolean(role && SCRUB_ROLES.includes(role));
}

function isMissingTable(err: unknown) {
  const code =
    typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2010' || /does not exist/i.test(message);
}

function displayClaimId(id: string) {
  return `CLM-${id.replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase()}`;
}

function daysBetween(from: Date, to = new Date()) {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function statusFromFindings(findings: ScrubFinding[]): ScrubStatus {
  if (findings.some((f) => f.severity === 'error')) return 'errors';
  if (findings.some((f) => f.severity === 'warning')) return 'warnings';
  return 'ready';
}

type ScrubClaimRow = {
  id: string;
  clientId?: string;
  /** Claim diagnosis column (837P builder reads it first) */
  icd10Codes?: string[];
  cptCode: string;
  units: number;
  amountCents: number | null;
  payer: string | null;
  status: ClaimStatus;
  submissionData: unknown;
  createdAt: Date;
  denialReason: string | null;
  client: {
    name: string;
    insuranceMemberId: string | null;
    dateOfBirth: Date | null;
    primaryDiagnosisCode: string | null;
  } & Partial<Pick<DemographicsInput,
    'legalFirstName' | 'legalLastName' | 'needsNameReview' | 'administrativeSex' | 'gender' | 'addressLine1' | 'city' | 'state' | 'postalCode'
  >>;
  appointment: {
    id?: string;
    startsAt: Date;
    clinicianId?: string | null;
    clinician: { npi: string | null } | null;
  } | null;
  progressNote: {
    id?: string;
    clinicianId?: string | null;
    dateOfService?: Date | null;
    durationMinutes?: number | null;
    psychotherapyMinutes?: number | null;
    cptCode?: string | null;
    body?: string;
    appointmentId?: string | null;
    clinician?: { npi: string | null; legalFirstName: string | null; legalLastName: string | null } | null;
    workflow: { status: string; planPendingUntil?: Date | null; cosignRequired?: boolean; cosignedAt?: Date | null } | null;
  } | null;
  serviceLines?: Array<{ cptCode: string; units: number }>;
};

export function evaluateClaimScrub(
  claim: ScrubClaimRow,
  opts: {
    timeZone?: string;
    filingLimitDays?: number | null;
    prpBillingModel?: string | null;
    /** The client's diagnosis list (src/lib/diagnoses); null / absent = codes-only checks */
    chartDiagnoses?: DiagnosisRow[] | null;
  } = {}
): {
  status: ScrubStatus;
  findings: ScrubFinding[];
  amountCents: number;
} {
  const findings: ScrubFinding[] = [];
  const amountCents =
    claim.amountCents && claim.amountCents > 0
      ? claim.amountCents
      : chargeAmountCents(claim.cptCode, claim.units || 1);

  if (!(claim.payer || '').trim()) {
    findings.push({
      code: 'PAYER_REQUIRED',
      severity: 'error',
      message: 'Payer is missing — assign a payer before submission.',
    });
  }

  // Self-pay / non-billable fee schedule items never go on an 837
  const selfPayFee = selfPayFeeProblem(claim.submissionData, claim.payer);
  if (selfPayFee) findings.push({ code: 'SELF_PAY_FEE', severity: 'error', message: selfPayFee });

  if (!claim.cptCode?.trim()) {
    findings.push({
      code: 'CPT_REQUIRED',
      severity: 'error',
      message: 'CPT code is required.',
    });
  }

  if (!amountCents || amountCents <= 0) {
    findings.push({
      code: 'AMOUNT_REQUIRED',
      severity: 'error',
      // A code with no fee set (e.g. 99212) says so instead of reporting a bare $0
      message: claim.cptCode && cptFeeMissing(claim.cptCode)
        ? `${missingFeeMessage(claim.cptCode)}; the claim has no charge amount.`
        : 'Charge amount must be greater than zero.',
    });
  }

  if (!claim.units || claim.units < 1 || claim.units > 24) {
    findings.push({
      code: 'UNITS_VALID',
      severity: 'error',
      message: 'Units must be between 1 and 24.',
    });
  }

  if (!claim.client.insuranceMemberId?.trim()) {
    findings.push({
      code: 'MEMBER_ID',
      severity: 'warning',
      message: 'Insurance member ID is missing on the client record.',
    });
  }

  if (!claim.client.dateOfBirth) {
    findings.push({
      code: 'DOB_REQUIRED',
      severity: 'warning',
      message: 'Patient date of birth is missing.',
    });
  }

  const submission =
    claim.submissionData && typeof claim.submissionData === 'object' && !Array.isArray(claim.submissionData)
      ? (claim.submissionData as { diagnosisCodes?: unknown; payerId?: unknown; claimFilingCode?: unknown })
      : null;
  const diagnosisCodes = Array.isArray(submission?.diagnosisCodes)
    ? submission!.diagnosisCodes.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    : [];
  const hasIcd = diagnosisCodes.length > 0 || Boolean(claim.client.primaryDiagnosisCode?.trim());
  if (!hasIcd) {
    findings.push({
      code: 'ICD10_REQUIRED',
      severity: 'error',
      message: 'At least one ICD-10 diagnosis is required (claim details or client primary diagnosis).',
    });
  } else if (diagnosisCodes.length === 0) {
    findings.push({
      code: 'ICD10_REQUIRED',
      severity: 'tip',
      message: 'Using client primary diagnosis — confirm codes in claim submission details before send.',
    });
  }
  if (hasIcd) {
    // The codes the 837P will carry: the claim column, else submission details, else the chart primary
    const effective = claim.icd10Codes?.length
      ? claim.icd10Codes
      : diagnosisCodes.length
        ? diagnosisCodes
        : [claim.client.primaryDiagnosisCode!.trim()];
    const sd = submission as { serviceDate?: unknown } | null;
    const dos =
      (typeof sd?.serviceDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(sd.serviceDate) ? sd.serviceDate.slice(0, 10) : null) ??
      (claim.progressNote?.dateOfService ? claim.progressNote.dateOfService.toISOString().slice(0, 10) : null) ??
      (claim.appointment?.startsAt ? claim.appointment.startsAt.toISOString().slice(0, 10) : null);
    for (const f of claimDiagnosisFindings({
      codes: effective,
      chart: opts.chartDiagnoses ?? null,
      cptCodes: [claim.cptCode, ...(claim.serviceLines ?? []).map((l) => l.cptCode)].filter(Boolean),
      dateOfService: dos,
      marylandPbhsPayer: isMarylandPbhsClaimPayer({
        payer: claim.payer,
        claimFilingCode: typeof submission?.claimFilingCode === 'string' ? submission.claimFilingCode : null,
      }),
    })) {
      findings.push(f);
    }
  }

  // Patient demographics for 837P 2010BA / 2010CA (same checks as src/lib/clients/demographics.ts).
  // DOB and member ID have their own rules above; evaluated when the row carries the demographic columns.
  if ('legalFirstName' in claim.client) {
    const gaps = claimReadiness({ ...claim.client, insurancePayer: claim.payer })
      .missing.filter((g) => g.severity === 'required' && !['dateOfBirth', 'insuranceMemberId', 'insurancePayer'].includes(g.field));
    if (gaps.length) {
      findings.push({
        code: 'PATIENT_DEMOGRAPHICS',
        severity: 'error',
        message: `Patient demographics incomplete for claims: ${describeGaps(gaps)}. Update the client profile.`,
      });
    }
  }

  // Rendering provider = the note's clinician (the appointment is only a cross-check)
  const noteClinician = claim.progressNote?.clinician ?? null;
  const npi = (noteClinician ? noteClinician.npi : claim.appointment?.clinician?.npi)?.trim() || '';
  if (noteClinician && (!noteClinician.legalFirstName?.trim() || !noteClinician.legalLastName?.trim())) {
    findings.push({
      code: 'RENDERING_LEGAL_NAME',
      severity: 'error',
      message: "Rendering provider's legal first and last name are missing on the staff profile (sent in NM1; display names are not used).",
    });
  }
  if (!npi) {
    findings.push({
      code: 'NPI_RENDERING',
      severity: 'warning',
      message: "Rendering provider NPI is not set on the note clinician's staff profile.",
    });
  } else if (!/^\d{10}$/.test(npi)) {
    findings.push({
      code: 'NPI_RENDERING',
      severity: 'warning',
      message: 'Rendering NPI should be a 10-digit number.',
    });
  }

  const noteStatus = claim.progressNote?.workflow?.status ?? null;
  if (claim.progressNote && noteStatus && !['SIGNED', 'LOCKED'].includes(noteStatus)) {
    findings.push({
      code: 'NOTE_SIGNED',
      severity: 'error',
      message: 'Progress note must be signed or locked before clearinghouse submit.',
    });
  } else if (!claim.progressNote) {
    findings.push({
      code: 'NOTE_SIGNED',
      severity: 'warning',
      message: 'No linked progress note — clearinghouse submit may be blocked.',
    });
  }

  // Note signed under the go-live transition without an active treatment plan: warn, not block
  const planPending = planPendingClaimWarning(claim.progressNote?.workflow);
  if (planPending) {
    findings.push({ code: 'PLAN_PENDING', severity: 'warning', message: planPending });
  }

  // Note-driven checks: co-signature, CPT on the note, appointment cross-check, PRP, coding edits
  const note = claim.progressNote;
  if (note?.id) {
    for (const f of noteClaimFindings(
      {
        id: note.id,
        clinicianId: note.clinicianId ?? null,
        dateOfService: note.dateOfService ?? null,
        cptCode: note.cptCode || (note.body ? extractNoteCpt(note.body) : null),
        workflow: note.workflow,
      },
      note.appointmentId && claim.appointment?.startsAt && claim.appointment.clinicianId !== undefined
        ? { id: claim.appointment.id ?? '', clinicianId: claim.appointment.clinicianId ?? null, startsAt: claim.appointment.startsAt }
        : null,
      { timeZone: opts.timeZone }
    )) {
      findings.push({ code: f.code.startsWith('APPT_') ? 'APPT_MISMATCH' : f.code, severity: f.severity, message: f.message });
    }
  }
  const lines = claim.serviceLines?.length ? claim.serviceLines : [{ cptCode: claim.cptCode, units: claim.units }];
  const prp = prpClaimBlock(lines.map((l) => l.cptCode), opts.prpBillingModel);
  if (prp) findings.push({ code: 'PRP_PENDING', severity: 'error', message: prp });
  if (note?.id) {
    for (const f of codingEditFindings(lines.map((l) => ({ cpt: l.cptCode, units: l.units })), {
      minutes: note.durationMinutes ?? null,
      psychotherapyMinutes: note.psychotherapyMinutes ?? null,
    })) {
      findings.push({ code: 'CODING_EDITS', severity: f.severity, message: f.message });
    }
  }

  const noteDos = notePracticeDate(note?.dateOfService);
  const serviceDate = noteDos ? new Date(`${noteDos}T12:00:00Z`) : claim.appointment?.startsAt ?? claim.createdAt;
  const ageDays = daysBetween(serviceDate);
  // Per-payer limit from the Waystar payer mapping (verify against the contract); else a 90-day reminder
  const tf = opts.filingLimitDays ? timelyFiling(serviceDate.toISOString().slice(0, 10), opts.filingLimitDays) : null;
  if (tf?.status === 'past') {
    findings.push({ code: 'TIMELY_FILING', severity: 'error', message: `Service date is ${tf.age} days old, past the payer's ${tf.limitDays}-day timely filing limit.` });
  } else if (tf?.status === 'near') {
    findings.push({ code: 'TIMELY_FILING', severity: 'warning', message: `${tf.daysLeft} day(s) left of the payer's ${tf.limitDays}-day timely filing limit.` });
  } else if (!tf && ageDays > 90) {
    findings.push({
      code: 'TIMELY_FILING',
      severity: 'warning',
      message: `Service date is ${ageDays} days old — check payer timely-filing limits (no limit configured on the payer mapping).`,
    });
  }

  if (claim.status === 'DENIED' && claim.denialReason) {
    findings.push({
      code: 'PRIOR_DENIAL',
      severity: 'tip',
      message: `Prior denial on file: ${claim.denialReason}`,
    });
  }

  if (!submission?.payerId && (claim.payer || '').trim()) {
    findings.push({
      code: 'PAYER_ID_TIP',
      severity: 'tip',
      message: 'Save clearinghouse payer ID in claim details for a clean 837P submit.',
    });
  }

  return {
    status: statusFromFindings(findings),
    findings,
    amountCents,
  };
}

export type ScrubClaimCard = {
  claimId: string;
  displayId: string;
  clientName: string;
  cptCode: string;
  cptDescription: string;
  units: number;
  amountCents: number;
  payer: string | null;
  claimStatus: ClaimStatus;
  scrubStatus: ScrubStatus;
  findings: ScrubFinding[];
  npi: string | null;
  icd10: string[];
  scrubbedAt: string;
  canSubmit: boolean;
};

export type ClaimScrubSnapshot = {
  schemaReady: boolean;
  ruleCount: number;
  clearinghouse: 'waystar' | 'availity' | 'demo';
  waystarEnabled: boolean;
  stats: {
    ready: number;
    errors: number;
    warnings: number;
    cleanAmountCents: number;
  };
  firstPass: {
    ready: number;
    warnings: number;
    errors: number;
  };
  claims: ScrubClaimCard[];
};

/** Appointment, note (DOS, clinician, minutes, co-signature) and lines the scrubber checks. */
const SCRUB_DEMOGRAPHIC_SELECT = {
  legalFirstName: true,
  legalLastName: true,
  needsNameReview: true,
  administrativeSex: true,
  gender: true,
  addressLine1: true,
  city: true,
  state: true,
  postalCode: true,
} as const;

const scrubNoteInclude = {
  appointment: {
    select: {
      id: true,
      startsAt: true,
      clinicianId: true,
      clinician: { select: { npi: true } },
    },
  },
  progressNote: {
    select: {
      id: true,
      clinicianId: true,
      dateOfService: true,
      durationMinutes: true,
      psychotherapyMinutes: true,
      cptCode: true,
      // Older notes keep the clinician's CPT in a metadata comment at the top of the body
      body: true,
      appointmentId: true,
      clinician: { select: { npi: true, legalFirstName: true, legalLastName: true } },
      workflow: { select: { status: true, planPendingUntil: true, cosignRequired: true, cosignedAt: true } },
    },
  },
  serviceLines: { select: { cptCode: true, units: true } },
} as const;

async function loadScrubCandidates(actor: ScrubActor) {
  return prisma.claim.findMany({
    where: {
      organizationId: actor.organizationId,
      client: clientAccessWhere(actor),
      status: { in: ['DRAFT', 'READY', 'DENIED'] },
    },
    include: {
      client: {
        select: {
          name: true,
          insuranceMemberId: true,
          dateOfBirth: true,
          primaryDiagnosisCode: true,
          ...SCRUB_DEMOGRAPHIC_SELECT,
        },
      },
      ...scrubNoteInclude,
    },
    orderBy: { updatedAt: 'desc' },
    take: 500,
  });
}

function cardFromClaim(
  claim: ScrubClaimRow & { scrubbedAt?: Date },
  evaluated: ReturnType<typeof evaluateClaimScrub>
): ScrubClaimCard {
  const submission =
    claim.submissionData && typeof claim.submissionData === 'object' && !Array.isArray(claim.submissionData)
      ? (claim.submissionData as { diagnosisCodes?: unknown })
      : null;
  const fromSubmission = Array.isArray(submission?.diagnosisCodes)
    ? submission!.diagnosisCodes.filter((c): c is string => typeof c === 'string' && Boolean(c.trim()))
    : [];
  const icd10 =
    fromSubmission.length > 0
      ? fromSubmission
      : claim.client.primaryDiagnosisCode
        ? [claim.client.primaryDiagnosisCode]
        : [];

  return {
    claimId: claim.id,
    displayId: displayClaimId(claim.id),
    clientName: claim.client.name,
    cptCode: claim.cptCode,
    cptDescription: cptDescription(claim.cptCode),
    units: claim.units,
    amountCents: evaluated.amountCents,
    payer: claim.payer,
    claimStatus: claim.status,
    scrubStatus: evaluated.status,
    findings: evaluated.findings,
    npi: claim.progressNote?.clinician?.npi ?? claim.appointment?.clinician?.npi ?? null,
    icd10,
    scrubbedAt: (claim.scrubbedAt ?? new Date()).toISOString(),
    canSubmit: evaluated.status !== 'errors',
  };
}

export async function reScrubAllClaims(actor: ScrubActor): Promise<ClaimScrubSnapshot> {
  try {
    const claims = await loadScrubCandidates(actor);
    const cards: ScrubClaimCard[] = [];
    const now = new Date();
    const timeZone = await getPracticeTimeZone(actor.organizationId);
    const limitFor = await payerLimitLookup(actor.organizationId);
    const prpBillingModel = (await loadPrpSettingsRow(actor.organizationId))?.prpBillingModel ?? null;

    const dxLists = await loadDiagnosisListsFor(actor.organizationId, claims.map((c) => c.clientId));
    for (const claim of claims) {
      const evaluated = evaluateClaimScrub(claim, { timeZone, filingLimitDays: limitFor(claim.payer), prpBillingModel, chartDiagnoses: dxLists.get(claim.clientId) ?? null });
      await prisma.claimScrubResult.upsert({
        where: {
          organizationId_claimId: {
            organizationId: actor.organizationId,
            claimId: claim.id,
          },
        },
        create: {
          organizationId: actor.organizationId,
          claimId: claim.id,
          status: evaluated.status,
          findingsJson: evaluated.findings,
          amountCents: evaluated.amountCents,
          scrubbedAt: now,
        },
        update: {
          status: evaluated.status,
          findingsJson: evaluated.findings,
          amountCents: evaluated.amountCents,
          scrubbedAt: now,
        },
      });
      cards.push(cardFromClaim({ ...claim, scrubbedAt: now }, evaluated));
    }

    await writeAuditLog({
      action: 'claim_scrub.re_scrub_all',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      metadata: { count: cards.length },
    });

    return snapshotFromCards(cards);
  } catch (err) {
    if (isMissingTable(err)) return emptyScrubSnapshot(false);
    throw err;
  }
}

export async function getClaimScrubSnapshot(actor: ScrubActor): Promise<ClaimScrubSnapshot> {
  try {
    const claims = await loadScrubCandidates(actor);
    const existing = await prisma.claimScrubResult.findMany({
      where: {
        organizationId: actor.organizationId,
        claimId: { in: claims.map((c) => c.id) },
      },
    });
    const byClaim = new Map(existing.map((row) => [row.claimId, row]));

    // Auto-scrub any claim missing a result so the page is never empty of analysis when claims exist
    const cards: ScrubClaimCard[] = [];
    for (const claim of claims) {
      const stored = byClaim.get(claim.id);
      if (stored) {
        const findings = Array.isArray(stored.findingsJson)
          ? (stored.findingsJson as ScrubFinding[])
          : [];
        const evaluated = {
          status: (stored.status as ScrubStatus) || statusFromFindings(findings),
          findings,
          amountCents: stored.amountCents,
        };
        cards.push(cardFromClaim({ ...claim, scrubbedAt: stored.scrubbedAt }, evaluated));
      } else {
        const evaluated = evaluateClaimScrub(claim, {
          timeZone: await getPracticeTimeZone(actor.organizationId),
          filingLimitDays: (await payerLimitLookup(actor.organizationId))(claim.payer),
          prpBillingModel: (await loadPrpSettingsRow(actor.organizationId))?.prpBillingModel ?? null,
          chartDiagnoses: (await loadDiagnosisListsFor(actor.organizationId, [claim.clientId])).get(claim.clientId) ?? null,
        });
        const now = new Date();
        await prisma.claimScrubResult.create({
          data: {
            organizationId: actor.organizationId,
            claimId: claim.id,
            status: evaluated.status,
            findingsJson: evaluated.findings,
            amountCents: evaluated.amountCents,
            scrubbedAt: now,
          },
        });
        cards.push(cardFromClaim({ ...claim, scrubbedAt: now }, evaluated));
      }
    }

    return snapshotFromCards(cards);
  } catch (err) {
    if (isMissingTable(err)) return emptyScrubSnapshot(false);
    throw err;
  }
}

function snapshotFromCards(cards: ScrubClaimCard[]): ClaimScrubSnapshot {
  const { claimCh, waystarEnabled } = claimClearinghouseMode();
  const ready = cards.filter((c) => c.scrubStatus === 'ready').length;
  const errors = cards.filter((c) => c.scrubStatus === 'errors').length;
  const warnings = cards.filter((c) => c.scrubStatus === 'warnings').length;
  const cleanAmountCents = cards
    .filter((c) => c.scrubStatus === 'ready')
    .reduce((sum, c) => sum + c.amountCents, 0);

  return {
    schemaReady: true,
    ruleCount: SCRUB_RULES.length,
    clearinghouse: claimCh,
    waystarEnabled,
    stats: { ready, errors, warnings, cleanAmountCents },
    firstPass: { ready, warnings, errors },
    claims: cards,
  };
}

function emptyScrubSnapshot(schemaReady: boolean): ClaimScrubSnapshot {
  const { claimCh, waystarEnabled } = claimClearinghouseMode();
  return {
    schemaReady,
    ruleCount: SCRUB_RULES.length,
    clearinghouse: claimCh,
    waystarEnabled,
    stats: { ready: 0, errors: 0, warnings: 0, cleanAmountCents: 0 },
    firstPass: { ready: 0, warnings: 0, errors: 0 },
    claims: [],
  };
}

export async function submitScrubbedClaim(actor: ScrubActor, claimId: string) {
  const scrub = await prisma.claimScrubResult.findFirst({
    where: { organizationId: actor.organizationId, claimId },
  });
  if (!scrub) {
    // Evaluate on the fly
    const claim = await prisma.claim.findFirst({
      where: {
        id: claimId,
        organizationId: actor.organizationId,
        client: clientAccessWhere(actor),
      },
      include: {
        client: {
          select: {
            name: true,
            insuranceMemberId: true,
            dateOfBirth: true,
            primaryDiagnosisCode: true,
            ...SCRUB_DEMOGRAPHIC_SELECT,
          },
        },
        ...scrubNoteInclude,
      },
    });
    if (!claim) {
      return { ok: false as const, error: 'Claim not found', status: 404 as const };
    }
    const evaluated = evaluateClaimScrub(claim, {
      timeZone: await getPracticeTimeZone(actor.organizationId),
      filingLimitDays: (await payerLimitLookup(actor.organizationId))(claim.payer),
      prpBillingModel: (await loadPrpSettingsRow(actor.organizationId))?.prpBillingModel ?? null,
      chartDiagnoses: (await loadDiagnosisListsFor(actor.organizationId, [claim.clientId])).get(claim.clientId) ?? null,
    });
    if (evaluated.status === 'errors') {
      return {
        ok: false as const,
        error: 'Submit blocked — resolve scrub errors before sending to the clearinghouse.',
        status: 400 as const,
        scrubStatus: evaluated.status,
        findings: evaluated.findings,
      };
    }
  } else if (scrub.status === 'errors') {
    return {
      ok: false as const,
      error: 'Submit blocked — resolve scrub errors before sending to the clearinghouse.',
      status: 400 as const,
      scrubStatus: scrub.status as ScrubStatus,
    };
  }

  const claimActor: ClaimActor = {
    organizationId: actor.organizationId,
    actorUserId: actor.actorUserId,
    actorRole: actor.actorRole,
  };

  const { waystarEnabled, availityEnabled, demoMode, claimCh } = claimClearinghouseMode();
  if (demoMode || (!waystarEnabled && !availityEnabled)) {
    return {
      ok: false as const,
      error:
        'Clearinghouse is not configured. Set WAYSTAR_CLIENT_ID (preferred) or AVAILITY_CLIENT_ID to submit claims. No fake submission was recorded.',
      status: 503 as const,
      demoMode: true as const,
      claimCh,
    };
  }

  try {
    const result = await submitClaim(claimActor, claimId);
    await writeAuditLog({
      action: 'claim_scrub.submit',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'Claim',
      resourceId: claimId,
      metadata: { demoMode: Boolean(result.demoMode), claimCh: result.claimCh },
    });
    if (result.demoMode) {
      return {
        ok: false as const,
        error:
          'Clearinghouse returned demo mode — credentials appear incomplete. No payer submission was confirmed.',
        status: 503 as const,
        demoMode: true as const,
      };
    }
    return { ok: true as const, ...result };
  } catch (err) {
    if (err instanceof ClearinghouseError) {
      return { ok: false as const, error: err.message, status: err.status as number };
    }
    const message = err instanceof Error ? err.message : 'Claim submission failed';
    return { ok: false as const, error: message, status: 502 as const };
  }
}
