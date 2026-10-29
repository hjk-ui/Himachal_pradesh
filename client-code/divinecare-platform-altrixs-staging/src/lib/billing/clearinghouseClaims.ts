import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { canAccessClaims, listClaims, readyBlockers, type ClaimActor } from './claims';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import {
  clearinghouseMode,
  clearinghouseRequest,
  statusEndpoint,
  newControlNumber,
  ClearinghouseError,
} from '@/lib/integrations/clearinghouse';
import {
  buildWaystar837P,
  claimClearinghouseMode,
  waystarControlNumber,
  waystarRequest,
  waystarStatusEndpoint,
} from '@/lib/integrations/waystar';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { recordPriorAuthUsage } from './priorAuthUsage';
import { submissionLinesFor, type SubmissionLine } from './claimLines';
import { validateIcd10Codes } from '@/lib/icd10/validate';

export const claimSubmissionSchema = z.object({
  payerId: z.string().trim().min(1).max(100),
  diagnosisCodes: z
    .array(z.string().regex(/^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/))
    .min(1)
    .max(12)
    // FY2027 ICD-10-CM: each code must exist and be billable
    .superRefine((codes, ctx) => {
      for (const e of validateIcd10Codes(codes, { requireBillable: true }).errors) ctx.addIssue({ code: 'custom', message: e });
    }),
  placeOfService: z.string().regex(/^\d{2}$/).default('11'),
  // 005010 SBR09 claim filing indicator codes (Waystar payer mappings may use any of them, e.g. HM)
  claimFilingCode: z
    .enum(['11', '12', '13', '14', '15', '16', '17', 'AM', 'BL', 'CH', 'CI', 'DS', 'FI', 'HM', 'LM', 'MA', 'MB', 'MC', 'OF', 'TV', 'VA', 'WC', 'ZZ'])
    .default('CI'),
});

export type SubmissionDetails = z.infer<typeof claimSubmissionSchema>;

function scope(actor: ClaimActor, id: string) {
  // Submit / edit submission details / clearinghouse status: billing core only (Office Manager is
  // read-only on claims and does not submit, including from the Claim Scrubber).
  if (!canAccessClaims(actor.actorRole)) {
    throw new ClearinghouseError('Forbidden', 403);
  }
  return { id, organizationId: actor.organizationId, client: clientAccessWhere(actor) };
}

export function claimTrackingId(claim: {
  clearinghouseClaimId?: string | null;
  availityClaimId?: string | null;
}) {
  return claim.clearinghouseClaimId ?? claim.availityClaimId ?? null;
}

export async function saveClaimSubmissionDetails(actor: ClaimActor, id: string, input: unknown) {
  const data = claimSubmissionSchema.parse(input);
  const claim = await prisma.claim.findFirst({ where: scope(actor, id) });
  if (!claim) throw new ClearinghouseError('Claim not found', 404);
  if (!['DRAFT', 'READY', 'DENIED'].includes(claim.status) || claim.submissionInProgress) {
    throw new ClearinghouseError('Submitted claims cannot be edited', 409);
  }
  // Keep extra keys (memberId, modifiers, per-line metadata) written when the claim was built.
  const existing =
    claim.submissionData && typeof claim.submissionData === 'object' && !Array.isArray(claim.submissionData)
      ? (claim.submissionData as Record<string, unknown>)
      : {};
  await prisma.claim.update({ where: { id: claim.id }, data: { submissionData: { ...existing, ...data } as object } });
  return data;
}

export function buildProfessionalClaim(input: {
  controlNumber: string;
  details: SubmissionDetails;
  memberId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  cpt: string;
  amount: number;
  units: number;
  serviceDate: string;
  npi: string;
  organizationName: string;
  taxId: string;
  renderingNpi?: string;
  /** Only passed for claims with more than one service line. */
  lines?: SubmissionLine[];
}) {
  const [procedureCode, ...modifiers] = input.cpt.split('-');
  const renderingProvider = input.renderingNpi ? { renderingProvider: { npi: input.renderingNpi } } : {};
  return {
    controlNumber: input.controlNumber,
    tradingPartnerServiceId: input.details.payerId,
    provider: { npi: input.npi, organizationName: input.organizationName, taxId: input.taxId },
    subscriber: {
      memberId: input.memberId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
    },
    claim: {
      claimFilingCode: input.details.claimFilingCode,
      serviceDate: input.serviceDate,
      totalChargeAmount: input.amount,
      placeOfServiceCode: input.details.placeOfService,
      diagnoses: input.details.diagnosisCodes.map((value, i) => ({
        qualifierCode: i ? 'ABF' : 'ABK',
        value,
      })),
      serviceLines: input.lines
        ? input.lines.map((line) => ({
            procedureCode: line.procedureCode,
            ...(line.modifiers.length ? { modifiers: line.modifiers } : {}),
            serviceDate: line.serviceDate,
            chargeAmount: line.chargeAmount,
            units: line.units,
            diagnosisPointers: line.diagnosisPointers.map(String),
            ...renderingProvider,
          }))
        : [
            {
              procedureCode,
              ...(modifiers.length ? { modifiers } : {}),
              serviceDate: input.serviceDate,
              chargeAmount: input.amount,
              units: input.units,
              diagnosisPointers: ['1'],
              ...renderingProvider,
            },
          ],
    },
  };
}

function providerCredentials(provider: 'waystar' | 'availity' | 'demo') {
  if (provider === 'waystar') {
    return {
      npi: process.env.WAYSTAR_NPI || process.env.AVAILITY_NPI || '',
      organizationName: process.env.WAYSTAR_ORG_NAME || process.env.AVAILITY_ORG_NAME || '',
      taxId: process.env.WAYSTAR_TAX_ID || process.env.AVAILITY_TAX_ID || '',
    };
  }
  return {
    npi: process.env.AVAILITY_NPI || '',
    organizationName: process.env.AVAILITY_ORG_NAME || '',
    taxId: process.env.AVAILITY_TAX_ID || '',
  };
}

function demoTrackingId(claimCh: string, key: string) {
  const prefix = claimCh === 'demo' ? 'WAYSTAR' : claimCh.toUpperCase();
  return `${prefix}-DEMO-${key}`;
}

export async function submitClaim(actor: ClaimActor, id: string) {
  const claim = await prisma.claim.findFirst({
    where: scope(actor, id),
    include: {
      client: true,
      progressNote: { include: { workflow: true } },
      appointment: { include: { clinician: true } },
      serviceLines: true,
    },
  });
  if (!claim) throw new ClearinghouseError('Claim not found', 404);
  if (claim.submissionInProgress) {
    throw new ClearinghouseError(
      'Submission pending or unconfirmed. Review the clearinghouse portal before retrying.',
      409
    );
  }
  if (!['DRAFT', 'READY', 'DENIED'].includes(claim.status)) {
    throw new ClearinghouseError('Claim is already submitted', 409);
  }
  if (!['SIGNED', 'LOCKED'].includes(claim.progressNote?.workflow?.status ?? '')) {
    throw new ClearinghouseError('A signed progress note is required', 400);
  }
  // Same gates as marking READY: supervisor co-signature, PRP billing model, payer-denied resend
  const blockers = await readyBlockers(claim, claim.serviceLines.length ? claim.serviceLines.map((l) => l.cptCode) : undefined);
  if (blockers.length) throw new ClearinghouseError(blockers.join(' '), 400);

  const details = claimSubmissionSchema.safeParse(claim.submissionData);
  if (!details.success) {
    throw new ClearinghouseError('Save the payer ID and diagnosis codes in claim details first', 400);
  }

  const { claimCh, demoMode } = claimClearinghouseMode();

  // Availity claims only when Waystar is not preferred and Availity claims endpoint is configured
  if (claimCh === 'availity') {
    const availityClaimsMode = clearinghouseMode('Availity', 'claims');
    if (availityClaimsMode === 'unconfigured' && !demoMode) {
      throw new ClearinghouseError('Availity claims are not configured', 503);
    }
  }
  if (claimCh === 'waystar' && !demoMode) {
    if (!process.env.WAYSTAR_CLIENT_SECRET || !process.env.WAYSTAR_TOKEN_URL || !process.env.WAYSTAR_CLAIMS_URL) {
      throw new ClearinghouseError('Waystar claims are not configured', 503);
    }
  }

  const patient = claim.client;
  const [firstName, ...lastNameParts] = patient.name.trim().split(/\s+/);
  if (
    !patient.dateOfBirth ||
    !patient.insuranceMemberId ||
    !lastNameParts.length ||
    !claim.amountCents ||
    !claim.appointment
  ) {
    throw new ClearinghouseError(
      'Complete the patient name, DOB, member ID, service appointment and charge before submission',
      400
    );
  }

  const provider = claimCh === 'demo' ? 'waystar' : claimCh;
  const { npi, organizationName, taxId } = providerCredentials(provider);
  if (!demoMode && (!/^\d{10}$/.test(npi) || !organizationName || !taxId)) {
    throw new ClearinghouseError('Billing provider NPI, name and tax ID are required', 503);
  }

  const key =
    claim.submittedAt
      ? claimCh === 'waystar'
        ? waystarControlNumber()
        : newControlNumber()
      : claim.submissionKey ||
        (claimCh === 'waystar' ? waystarControlNumber() : newControlNumber());

  const [procedureCode, ...cptModifiers] = claim.cptCode.split('-');
  const storedMods = Array.isArray((claim.submissionData as { modifiers?: string[] } | null)?.modifiers)
    ? ((claim.submissionData as { modifiers: string[] }).modifiers || [])
    : [];
  const modifiers = Array.from(
    new Set([...cptModifiers, ...storedMods].map((m) => m.trim().toUpperCase()).filter(Boolean))
  );
  const serviceDate =
    claim.appointment?.startsAt?.toISOString().slice(0, 10) ||
    (claim.submissionData as { serviceDate?: string } | null)?.serviceDate ||
    claim.createdAt.toISOString().slice(0, 10);
  const amount = claim.amountCents / 100;
  const lastName = lastNameParts.join(' ');
  const dob = patient.dateOfBirth.toISOString().slice(0, 10);
  // A rendering NPI chosen in the claim editor wins over the appointment clinician's.
  const renderingNpi =
    (claim.renderingNpi && /^\d{10}$/.test(claim.renderingNpi) ? claim.renderingNpi : undefined) ??
    claim.appointment.clinician?.npi ??
    undefined;

  // Multi-line claims send every ClaimServiceLine in loop 2400. Single-line claims
  // (0 or 1 rows) keep the original one-line payload unchanged.
  const lines =
    claim.serviceLines.length > 1
      ? submissionLinesFor(claim.serviceLines, claim.submissionData, {
          serviceDate,
          diagnosisCount: details.data.diagnosisCodes.length,
        })
      : null;
  if (lines) {
    const lineCents = lines.reduce((t, l) => t + Math.round(l.chargeAmount * 100), 0);
    if (lineCents !== claim.amountCents) {
      throw new ClearinghouseError('Service line charges do not add up to the claim total. Re-save the claim lines first.', 400);
    }
  }

  const reserved = await prisma.claim.updateMany({
    where: {
      id: claim.id,
      organizationId: actor.organizationId,
      status: claim.status,
      submissionInProgress: false,
    },
    data: { submissionInProgress: true, submissionKey: key, submissionError: null },
  });
  if (!reserved.count) throw new ClearinghouseError('Another submission is already in progress', 409);

  try {
    let trackingId: string;
    const clearinghouseProvider = demoMode ? 'demo' : claimCh;

    if (demoMode) {
      trackingId = demoTrackingId(claimCh, key);
    } else if (claimCh === 'waystar') {
      const payload = buildWaystar837P({
        controlNumber: key.length === 9 ? key : waystarControlNumber(),
        tradingPartnerServiceId: details.data.payerId,
        submitterInfo: { organizationName, npi, taxId },
        subscriber: {
          memberId: patient.insuranceMemberId,
          firstName,
          lastName,
          dateOfBirth: dob,
        },
        payerName: claim.payer,
        claimFilingIndicator: details.data.claimFilingCode,
        serviceDate,
        totalChargeAmount: amount,
        placeOfServiceCode: details.data.placeOfService,
        diagnosisCodes: details.data.diagnosisCodes,
        procedureCode,
        modifiers,
        units: claim.units,
        renderingNpi,
      });
      if (lines) {
        const telehealthPos = details.data.placeOfService === '02' || details.data.placeOfService === '10';
        payload.claim.serviceLines = lines.map((line) => {
          const lineMods = [...line.modifiers];
          if (telehealthPos) {
            for (const mod of ['GT', '95']) {
              if (!lineMods.includes(mod)) lineMods.push(mod);
            }
          }
          return {
            procedureCode: line.procedureCode,
            ...(lineMods.length ? { modifiers: lineMods } : {}),
            serviceDate: line.serviceDate,
            chargeAmount: line.chargeAmount,
            units: line.units,
            diagnosisPointers: line.diagnosisPointers.map(String),
            ...(renderingNpi ? { renderingProvider: { npi: renderingNpi } } : {}),
          };
        });
      }
      const result = await waystarRequest(process.env.WAYSTAR_CLAIMS_URL, payload, key);
      const id =
        result.id ?? result.claimId ?? result.trackingId ?? result.controlNumber ?? payload.controlNumber;
      if (typeof id !== 'string' || !id) {
        throw new ClearinghouseError('Missing tracking ID. Review clearinghouse portal before retrying.');
      }
      trackingId = id;
    } else {
      const payload = buildProfessionalClaim({
        controlNumber: key,
        details: details.data,
        memberId: patient.insuranceMemberId,
        firstName,
        lastName,
        dateOfBirth: dob,
        cpt: claim.cptCode,
        amount,
        units: claim.units,
        serviceDate,
        npi,
        organizationName,
        taxId,
        renderingNpi,
        ...(lines ? { lines } : {}),
      });
      const result = await clearinghouseRequest('Availity', process.env.AVAILITY_CLAIMS_URL, payload, key);
      const id = result.id ?? result.claimId ?? result.controlNumber;
      if (typeof id !== 'string' || !id) {
        throw new ClearinghouseError('Missing tracking ID. Review clearinghouse portal before retrying.');
      }
      trackingId = id;
    }

    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        clearinghouseClaimId: trackingId,
        clearinghouseProvider,
        // Keep availityClaimId populated for legacy UI when Availity was the channel
        ...(clearinghouseProvider === 'availity' ? { availityClaimId: trackingId } : {}),
        status: demoMode ? claim.status : 'SUBMITTED',
        clearinghouseDemo: demoMode,
        submittedAt: demoMode ? null : new Date(),
        submittedBy: demoMode ? null : actor.actorUserId,
        submissionInProgress: false,
        submissionError: null,
      },
    });
    if (!demoMode && claim.priorAuthNumber) {
      // Count the auth units this claim uses (once per claim; released on denial / void)
      const authLines = claim.serviceLines.length
        ? claim.serviceLines.map((l) => ({ cpt: l.cptCode, units: l.units }))
        : [{ cpt: claim.cptCode, units: claim.units }];
      await recordPriorAuthUsage({ organizationId: actor.organizationId, claimId: claim.id, authNumber: claim.priorAuthNumber, lines: authLines, actorUserId: actor.actorUserId });
    }

    await writeAuditLog({
      action: 'claim_submit_837p',
      actorUserId: actor.actorUserId,
      organizationId: actor.organizationId,
      resourceType: 'Claim',
      resourceId: claim.id,
      metadata: {
        clearinghouseProvider,
        trackingId,
        demoMode,
        claimCh,
      },
    });

    return {
      claimId: id,
      trackingId,
      demoMode,
      claimCh: clearinghouseProvider,
      success: true,
    };
  } catch (error) {
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        submissionError:
          'Submission could not be confirmed. Review the clearinghouse portal before retrying.',
      },
    });
    throw error;
  }
}

export async function checkClaimStatus(actor: ClaimActor, id: string) {
  const claim = await prisma.claim.findFirst({ where: scope(actor, id) });
  const trackingId = claim ? claimTrackingId(claim) : null;
  if (!claim || !trackingId) {
    throw new ClearinghouseError('No clearinghouse tracking ID exists for this claim', 400);
  }
  if (claim.clearinghouseDemo || claim.clearinghouseProvider === 'demo') {
    return { claimId: id, payerStatus: 'DEMO — no payer submission', demoMode: true };
  }

  if (claim.clearinghouseProvider === 'waystar_sftp') {
    // SFTP claims have no status API: report the last 999 / 277CA applied by "Check Waystar responses"
    const info = (claim.submissionData as { waystarSftp?: { batchId?: string; responses?: Array<{ type: string; accepted: boolean | null; reason: string }> } } | null)?.waystarSftp;
    const last = info?.responses?.length ? info.responses[info.responses.length - 1] : null;
    const payerStatus = last
      ? `${last.type} ${last.accepted === true ? 'accepted' : last.accepted === false ? 'rejected' : 'received'}: ${last.reason}`
      : `Sent in Waystar batch ${info?.batchId ?? trackingId}; no 999/277CA applied yet. Use "Check Waystar responses".`;
    return { claimId: id, payerStatus, demoMode: false, provider: 'waystar_sftp' };
  }

  const provider = claim.clearinghouseProvider || 'availity';
  let result: Record<string, unknown>;
  if (provider === 'waystar') {
    result = await waystarRequest(waystarStatusEndpoint(trackingId));
  } else {
    result = await clearinghouseRequest(
      'Availity',
      statusEndpoint(process.env.AVAILITY_CLAIM_STATUS_URL, trackingId)
    );
  }

  const payerStatus = String(result.status ?? result.claimStatus ?? result.payerStatus ?? 'Unknown');
  const normalized = payerStatus.toUpperCase();
  const status = ['PAID', 'APPROVED', 'ACCEPTED', 'FINALIZED — APPROVED'].includes(normalized)
    ? 'ACCEPTED'
    : ['DENIED', 'FINALIZED — DENIED'].includes(normalized)
      ? 'DENIED'
      : null;
  if (status && claim.status !== 'PAID') {
    await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status,
        ...(status === 'DENIED'
          ? { denialReason: String(result.denialReason ?? 'Denied by payer') }
          : {}),
      },
    });
  }
  return { claimId: id, payerStatus, demoMode: false, provider };
}

/**
 * Retired: the JSON ERA webhook set claims PAID unconditionally and matched claims across
 * organizations. 835s are posted by the ERA pipeline (waystarInbound/era.ts apply835File).
 */
export async function processEraWebhook(_raw: unknown): Promise<never> {
  void _raw;
  throw new ClearinghouseError('The JSON ERA webhook is retired; 835s are posted by the Waystar 835 pipeline', 410);
}

export async function findSerializedClaim(actor: ClaimActor, id: string) {
  return (await listClaims(actor)).find((claim) => claim.id === id);
}
