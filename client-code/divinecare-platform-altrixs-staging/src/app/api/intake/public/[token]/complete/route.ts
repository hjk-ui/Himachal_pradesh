import { NextResponse } from 'next/server';
import { z } from 'zod';
import { completeIntakeInvite, intakeInviteContext } from '@/lib/intake/manage';
import { recordIntakePacket, validateIntakePacket, intakePacketPreview, type IntakeAnswers } from '@/lib/consents/library/store';
import { packetSubmissionSchema } from '@/lib/consents/library/schema';
import { SERVICES_INTERESTED } from '@/lib/consents/library/composer';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { legalNameFields } from '@/lib/clients/legalName';
import { addressContactFields, demographicFields, normalizeUsPhone } from '@/lib/clients/demographics';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { recordIntakeAttestation } from '@/lib/consents/carelon/store';

export const runtime = 'nodejs';

const paramsSchema = z.object({ token: z.string().min(8).max(128) });

const completeSchema = z.object({
  demographics: z.object({
    firstName: z.string().trim().min(1).max(80),
    middleInitial: legalNameFields.middleInitial,
    lastName: z.string().trim().min(1).max(80),
    dateOfBirth: z.string().trim().min(4).max(32),
    // Coded answers (src/lib/clients/demographics.ts); a free-text pronoun from an older form is ignored
    pronouns: z.string().trim().max(40).optional().nullable(),
    administrativeSex: demographicFields.administrativeSex,
    genderIdentity: demographicFields.genderIdentity,
    race: demographicFields.race,
    ethnicity: demographicFields.ethnicity,
    preferredLanguage: demographicFields.preferredLanguage,
    interpreterNeeded: demographicFields.interpreterNeeded,
    addressLine1: z.string().trim().max(200).optional().nullable(),
    addressLine2: z.string().trim().max(200).optional().nullable(),
    city: z.string().trim().max(80).optional().nullable(),
    state: addressContactFields.state,
    postalCode: addressContactFields.postalCode,
    phone: z.string().trim().min(7).max(40).refine((v) => normalizeUsPhone(v) !== null, { message: 'Phone must be a valid 10-digit US number' }),
    email: z.string().trim().email().max(200),
    emergencyContactName: z.string().trim().max(120).optional().nullable(),
    emergencyContactRelationship: z.string().trim().max(80).optional().nullable(),
    emergencyContactPhone: z.string().trim().max(40).optional().nullable(),
  }),
  insurance: z.object({
    primaryPayer: z.string().trim().min(1).max(120),
    memberId: z.string().trim().max(80).optional().nullable(),
    groupNumber: z.string().trim().max(80).optional().nullable(),
    subscriberName: z.string().trim().max(120).optional().nullable(),
    subscriberDob: z.string().trim().max(32).optional().nullable(),
    subscriberRelationship: z.string().trim().max(40).optional().nullable(),
    secondaryPayer: z.string().trim().max(120).optional().nullable(),
    secondaryMemberId: z.string().trim().max(80).optional().nullable(),
    secondaryGroupNumber: z.string().trim().max(80).optional().nullable(),
  }),
  medicalHistory: z.record(z.string(), z.unknown()).optional(),
  consents: z.record(z.string(), z.boolean()).optional(),
  /** Carelon non-overlap attestation Part A (Maryland Medicaid clients; src/lib/consents/carelon) */
  carelonAttestation: z
    .object({
      signerType: z.enum(['participant', 'representative']),
      printedName: z.string().trim().min(2).max(120),
      relationship: z.string().trim().max(80).optional().nullable(),
      authority: z.string().trim().max(300).optional().nullable(),
      signature: z.string().trim().min(2).max(120),
      agree: z.literal(true),
    })
    .optional(),
  /** Optional (review note 4): stored encrypted, shown masked */
  identity: z.object({ ssn: z.string().trim().max(20).optional().nullable() }).optional(),
  guardian: z
    .object({
      hasGuardian: z.boolean(),
      name: z.string().trim().max(120).optional().nullable(),
      relationship: z.string().trim().max(80).optional().nullable(),
      phone: z.string().trim().max(40).optional().nullable(),
      email: z.string().trim().max(200).optional().nullable(),
    })
    .optional(),
  servicesInterested: z.array(z.enum(SERVICES_INTERESTED.map((x) => x.value) as [string, ...string[]])).max(10).optional(),
  wantsTelehealth: z.boolean().optional().nullable(),
  /** Consent library packet: an acknowledgment per section + one final signature */
  consentPacket: packetSubmissionSchema.optional(),
  signature: z.object({
    fullName: z.string().trim().min(2).max(120),
    signedAt: z.string().trim().min(4).max(64),
  }),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = paramsSchema.parse(await ctx.params);
    const body = completeSchema.parse(await req.json());
    // Consent packet: re-composed on the server from the answers and validated BEFORE the chart is
    // created, so an incomplete packet never creates a chart.
    const invite = await intakeInviteContext(token);
    const answers: IntakeAnswers | null = invite
      ? {
          dateOfBirth: body.demographics.dateOfBirth,
          servicesInterested: body.servicesInterested ?? [],
          telehealth: invite.appointmentType === 'Telehealth' || Boolean(body.wantsTelehealth),
          insurancePayer: body.insurance.primaryPayer,
          emergencyContact: body.demographics.emergencyContactName?.trim()
            ? { name: body.demographics.emergencyContactName.trim(), relationship: body.demographics.emergencyContactRelationship ?? null, phone: body.demographics.emergencyContactPhone ?? null }
            : null,
        }
      : null;
    if (invite && answers) {
      if (body.consentPacket) {
        const errors = await validateIntakePacket(invite.organizationId, answers, body.consentPacket);
        if (errors.length) return NextResponse.json({ success: false, error: errors[0], errors }, { status: 400 });
      } else if ((await intakePacketPreview(invite.organizationId, answers)).items.length) {
        return NextResponse.json({ success: false, error: 'Please review and acknowledge each section of the consent packet.' }, { status: 400 });
      }
    }
    const result = await completeIntakeInvite(token, body);
    if (result.ok === false) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    // Public route: the actor is the token-holding patient (no account / org gate).
    // Org is looked up for the audit row only; the token itself is never logged.
    const auditOrg = result.clientId
      ? await prisma.client
          .findUnique({ where: { id: result.clientId }, select: { organizationId: true } })
          .then((c) => c?.organizationId ?? null)
          .catch(() => null)
      : null;
    await writeAuditLog({
      action: 'CREATE',
      actorUserId: null,
      actorRole: 'PATIENT',
      organizationId: auditOrg,
      resourceType: 'intakeSubmission',
      resourceId: result.invite.id,
      patientId: result.clientId,
      ...auditRequestMeta(req),
      metadata: {
        portal: 'public-intake',
        sections: Object.keys(body),
        consentKeys: body.consents ? Object.keys(body.consents) : [],
        consentPacketSections: body.consentPacket ? Object.keys(body.consentPacket.sections) : [],
        ssnProvided: Boolean(body.identity?.ssn),
      },
    });

    // Consent library packet: one ConsentForm row per section with the frozen text + version
    if (body.consentPacket && answers && invite && result.clientId && auditOrg) {
      const rec = await recordIntakePacket({
        organizationId: auditOrg,
        clientId: result.clientId,
        intakeInviteId: invite.id,
        staffOwnerId: null,
        answers,
        submission: body.consentPacket,
        request: auditRequestMeta(req),
      }).catch((e) => ({ ok: false as const, reason: e instanceof Error ? e.name : 'error' }));
      await writeAuditLog({
        action: 'SIGN',
        actorUserId: null,
        actorRole: 'PATIENT',
        organizationId: auditOrg,
        resourceType: 'consentPacket',
        resourceId: rec.ok ? rec.packetId : null,
        patientId: result.clientId,
        outcome: rec.ok ? 'SUCCESS' : 'FAILURE',
        ...auditRequestMeta(req),
        metadata: { portal: 'public-intake', method: 'intake', signerType: body.consentPacket.signer.signerType, sections: Object.keys(body.consentPacket.sections).length, ...(rec.ok ? {} : { reason: (rec as { reason: string }).reason }) },
      });
      invalidateInboxForOrg(auditOrg);
      // The intake's assigned clinician sees the new client on their caseload views right away
      invalidateCaseloadScopedCaches(auditOrg);
    }

    // Maryland Medicaid: Part A of the Carelon non-overlap attestation signed in the intake packet
    if (body.carelonAttestation && result.clientId && auditOrg) {
      const att = await recordIntakeAttestation({
        organizationId: auditOrg,
        clientId: result.clientId,
        staffOwnerId: null,
        partA: { ...body.carelonAttestation, relationship: body.carelonAttestation.relationship ?? null, authority: body.carelonAttestation.authority ?? null },
      }).catch(() => ({ ok: false as const, reason: 'error' }));
      await writeAuditLog({
        action: 'SIGN',
        actorUserId: null,
        actorRole: 'PATIENT',
        organizationId: auditOrg,
        resourceType: 'carelonAttestation',
        resourceId: att.ok ? att.id : null,
        patientId: result.clientId,
        outcome: att.ok ? 'SUCCESS' : 'FAILURE',
        ...auditRequestMeta(req),
        metadata: { portal: 'public-intake', method: 'intake', signerType: body.carelonAttestation.signerType, ...(att.ok ? {} : { reason: (att as { reason: string }).reason }) },
      });
    }

    return NextResponse.json({
      success: true,
      clientId: result.clientId,
      invite: result.invite,
    });
  } catch (err: unknown) {
    // Public caller: our own validation messages are safe to show; anything else is logged only.
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: err.issues[0]?.message || 'Please check the intake form and try again.' },
        { status: 400 }
      );
    }
    console.error('[intake/public complete]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not complete intake' }, { status: 400 });
  }
}
