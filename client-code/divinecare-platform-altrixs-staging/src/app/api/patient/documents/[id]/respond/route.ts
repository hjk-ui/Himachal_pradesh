import { z } from 'zod';
import { patientFail, patientOk, patientOptions, patientPost, readPatientJson } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { patientRespond } from '@/lib/ehr/therapy/planStore';
import { patientSignAttestation } from '@/lib/consents/carelon/store';
import { getPatientPacket, patientSignPacket } from '@/lib/consents/library/store2';
import { packetSubmissionSchema } from '@/lib/consents/library/schema';
import { getPatientDocument } from '@/lib/ehr/therapy/planStore';
import { getPatientAttestation } from '@/lib/consents/carelon/store';
import { filterPortalDocuments } from '@/patient/application/proxy/visibility';
import { proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
import { RELATIONSHIP_LABEL, representativeSignerRelationship } from '@/patient/domain/proxy-policy';
import type { PatientContext } from '@/patient/domain';

export function OPTIONS() { return patientOptions(); }

const bodySchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('sign'),
    typedName: z.string().trim().min(2).max(120),
    signerRelationship: z.enum(['Self', 'Parent', 'Legal guardian', 'Guarantor']).default('Self'),
    agree: z.literal(true),
  }),
  z.object({ decision: z.literal('decline'), reason: z.string().trim().min(3).max(1000) }),
  /**
   * Carelon non-overlap attestation, Part A: the participant or their Authorized Representative
   * (relationship + description of legal authority required for a representative).
   */
  z.object({
    decision: z.literal('attest'),
    signerType: z.enum(['participant', 'representative']),
    printedName: z.string().trim().min(2).max(120),
    relationship: z.string().trim().max(80).optional().nullable(),
    authority: z.string().trim().max(300).optional().nullable(),
    signature: z.string().trim().min(2).max(120),
    agree: z.literal(true),
  }),
  /** Consent packet (consent library): an acknowledgment per section + one final typed signature */
  packetSubmissionSchema.extend({ decision: z.literal('consent_packet') }),
  /** Another signer (guardian, guarantor) after the plan is signed */
  z.object({
    decision: z.literal('cosign'),
    typedName: z.string().trim().min(2).max(120),
    signerRelationship: z.enum(['Parent', 'Legal guardian', 'Guarantor']),
    agree: z.literal(true),
  }),
]);

/**
 * POST /api/patient/documents/[id]/respond
 * The patient (or parent / guardian of a minor) e-signs the treatment plan with their typed name
 * and agreement, or declines with a reason. Only while the plan is awaiting their signature.
 * attest: Part A of the Carelon non-overlap attestation (Maryland Medicaid), see src/lib/consents/carelon.
 * cosign: a guardian or the guarantor adds their signature once the plan is signed. Every signer
 * agrees to the Valant attestation ("I participated in the development of this treatment plan
 * and I agree to its content.").
 */
export async function POST(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return patientPost(async ({ ctx }) => {
    if (!id || id.length > 128) return patientFail('VALIDATION_ERROR', 'Invalid document', 400);
    const body = bodySchema.parse(await readPatientJson(req));
    const proxy = ctx.access?.isProxy ? ctx.access : null;
    if (proxy) {
      // A proxy signs only documents it may see, and always AS the representative (never as the patient)
      if (!(await proxyMayRespond(ctx, id))) return patientFail('NOT_FOUND', 'Document not found', 404);
      const asRep = representativeSignerRelationship(proxy.relationship);
      if (body.decision === 'sign' || body.decision === 'cosign') body.signerRelationship = asRep as typeof body.signerRelationship;
      if (body.decision === 'attest') {
        body.signerType = 'representative';
        body.relationship = body.relationship?.trim() || RELATIONSHIP_LABEL[proxy.relationship];
        body.authority = body.authority?.trim() || representativeAuthority(proxy.relationship);
      }
      if (body.decision === 'consent_packet') {
        body.signer.signerType = 'representative';
        body.signer.relationship = body.signer.relationship?.trim() || RELATIONSHIP_LABEL[proxy.relationship];
        body.signer.authority = body.signer.authority?.trim() || representativeAuthority(proxy.relationship);
      }
    }
    // Signer identity for every signature made in the portal: the login that signed and its link
    const signerIdentity = { signedByPortalUserId: ctx.accountId, ...(proxy ? { signedAsRepresentative: true, relationship: proxy.relationship, portalAccessId: proxy.accessId } : {}) };
    if (body.decision === 'consent_packet') {
      const scope = { clientId: ctx.clientId, organizationId: ctx.organizationId };
      const signed = await patientSignPacket(scope, id, { sections: body.sections, signer: body.signer }, {
        request: auditRequestMeta(req),
        portalAccountId: ctx.accountId,
        proxy: proxy ? { relationship: proxy.relationship, portalAccessId: proxy.accessId ?? null } : null,
      });
      await writeAuditLog({
        action: 'SIGN',
        actorUserId: ctx.accountId,
        actorRole: proxy ? 'PATIENT_PROXY' : 'PATIENT',
        organizationId: ctx.organizationId,
        resourceType: 'consentPacket',
        resourceId: id,
        patientId: ctx.clientId,
        outcome: signed.ok ? 'SUCCESS' : 'FAILURE',
        ...auditRequestMeta(req),
        metadata: { portal: 'patient-web', decision: 'consent_packet', signerType: body.signer.signerType, ...signerIdentity, ...(signed.ok === false ? { status: signed.status } : {}) },
      });
      if (signed.ok === false) return patientFail(signed.status === 404 ? 'NOT_FOUND' : signed.status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT', signed.error, signed.status);
      await logPatientAudit({ clientId: ctx.clientId, accountId: ctx.accountId, action: 'CONSENT_PACKET_SIGNED', entityType: 'consentPacket', entityId: id, ...proxyAuditFields(ctx) });
      return patientOk({ document: await getPatientPacket(scope, id) });
    }
    if (body.decision === 'attest') {
      const signed = await patientSignAttestation(
        { clientId: ctx.clientId, organizationId: ctx.organizationId, accountId: ctx.accountId },
        id,
        { signerType: body.signerType, printedName: body.printedName, relationship: body.relationship ?? null, authority: body.authority ?? null, signature: body.signature, agree: body.agree }
      );
      await writeAuditLog({
        action: 'SIGN',
        actorUserId: ctx.accountId,
        actorRole: proxy ? 'PATIENT_PROXY' : 'PATIENT',
        organizationId: ctx.organizationId,
        resourceType: 'carelonAttestation',
        resourceId: id,
        patientId: ctx.clientId,
        outcome: signed.ok ? 'SUCCESS' : 'FAILURE',
        ...auditRequestMeta(req),
        metadata: { portal: 'patient-web', decision: 'attest', signerType: body.signerType, ...signerIdentity, ...(signed.ok === false ? { status: signed.status } : {}) },
      });
      if (signed.ok === false) return patientFail(signed.status === 404 ? 'NOT_FOUND' : signed.status === 400 ? 'VALIDATION_ERROR' : 'CONFLICT', signed.error, signed.status);
      await logPatientAudit({ clientId: ctx.clientId, accountId: ctx.accountId, action: 'CARELON_ATTESTATION_SIGNED', entityType: 'carelonAttestation', entityId: id, ...proxyAuditFields(ctx) });
      return patientOk({ document: signed.document });
    }
    const result = await patientRespond(
      { clientId: ctx.clientId, organizationId: ctx.organizationId },
      id,
      body.decision === 'sign'
        ? { decision: 'sign', typedName: body.typedName, signerRelationship: body.signerRelationship }
        : body.decision === 'cosign'
          ? { decision: 'cosign', typedName: body.typedName, signerRelationship: body.signerRelationship }
          : { decision: 'decline', reason: body.reason }
    );
    await writeAuditLog({
      action: 'SIGN',
      actorUserId: ctx.accountId,
      actorRole: proxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: 'treatmentPlan',
      resourceId: id,
      patientId: ctx.clientId,
      outcome: result.ok ? 'SUCCESS' : 'FAILURE',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-web', decision: body.decision, ...signerIdentity, ...(body.decision !== 'decline' ? { signerRelationship: body.signerRelationship } : {}), ...(result.ok === false ? { status: result.status } : {}) },
    });
    if (result.ok === false) return patientFail(result.status === 404 ? 'NOT_FOUND' : 'CONFLICT', result.error, result.status);
    await logPatientAudit({ clientId: ctx.clientId, accountId: ctx.accountId, action: body.decision === 'decline' ? 'TREATMENT_PLAN_DECLINED' : 'TREATMENT_PLAN_SIGNED', entityType: 'treatmentPlan', entityId: id, ...proxyAuditFields(ctx) });
    return patientOk({ document: result.document });
  }, ['patient-document-sign', 20])(req);
}

function representativeAuthority(relationship: string) {
  return relationship === 'parent'
    ? 'Parent of a minor (authority verified by the clinic for portal access)'
    : 'Legal authority verified by the clinic for portal access (document on file)';
}

/** The document exists for this client AND the proxy rules let this proxy see it. */
async function proxyMayRespond(ctx: PatientContext, id: string) {
  const scope = { clientId: ctx.clientId, organizationId: ctx.organizationId };
  const found = (await getPatientDocument(scope, id)) ?? (await getPatientAttestation(scope, id)) ?? (await getPatientPacket(scope, id));
  if (!found) return true; // not found: the normal path answers 404
  return (await filterPortalDocuments(ctx, [found])).length === 1;
}
