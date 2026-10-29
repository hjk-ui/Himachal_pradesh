import 'server-only';

import type { ClaimStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { chargeAmountCents, cptDescription } from '@/lib/constants/cpt';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { claimClearinghouseMode } from '@/lib/integrations/waystar';
import { ClearinghouseError } from '@/lib/integrations/clearinghouse';
import { submitClaim } from '@/lib/billing/clearinghouseClaims';
import type { ClaimActor } from '@/lib/billing/claims';

export type ScrubSeverity = 'error' | 'warning' | 'tip';
export type ScrubStatus = 'ready' | 'errors' | 'warnings';

export type ScrubFinding = {
  code: string;
  severity: ScrubSeverity;
  message: string;
};

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
  };
  appointment: {
    startsAt: Date;
    clinician: { npi: string | null } | null;
  } | null;
  progressNote: {
    workflow: { status: string } | null;
  } | null;
};

export function evaluateClaimScrub(claim: ScrubClaimRow): {
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
      message: 'Charge amount must be greater than zero.',
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
      ? (claim.submissionData as { diagnosisCodes?: unknown; payerId?: unknown })
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

  const npi = claim.appointment?.clinician?.npi?.trim() || '';
  if (!npi) {
    findings.push({
      code: 'NPI_RENDERING',
      severity: 'warning',
      message: 'Rendering provider NPI is not set on the linked appointment clinician.',
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

  const serviceDate = claim.appointment?.startsAt ?? claim.createdAt;
  const ageDays = daysBetween(serviceDate);
  if (ageDays > 90) {
    findings.push({
      code: 'TIMELY_FILING',
      severity: 'warning',
      message: `Service date is ${ageDays} days old — check payer timely-filing limits.`,
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
        },
      },
      appointment: {
        select: {
          startsAt: true,
          clinician: { select: { npi: true } },
        },
      },
      progressNote: {
        select: {
          workflow: { select: { status: true } },
        },
      },
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
    npi: claim.appointment?.clinician?.npi ?? null,
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

    for (const claim of claims) {
      const evaluated = evaluateClaimScrub(claim);
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
        const evaluated = evaluateClaimScrub(claim);
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
          },
        },
        appointment: {
          select: {
            startsAt: true,
            clinician: { select: { npi: true } },
          },
        },
        progressNote: {
          select: { workflow: { select: { status: true } } },
        },
      },
    });
    if (!claim) {
      return { ok: false as const, error: 'Claim not found', status: 404 as const };
    }
    const evaluated = evaluateClaimScrub(claim);
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
