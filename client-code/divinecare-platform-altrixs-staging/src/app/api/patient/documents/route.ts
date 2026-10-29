import { patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { listPatientDocuments } from '@/lib/ehr/therapy/planStore';
import { listPatientAttestations } from '@/lib/consents/carelon/store';
import { listPatientPackets } from '@/lib/consents/library/store2';
import { filterPortalDocuments } from '@/patient/application/proxy/visibility';

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/documents — documents the clinic sent this patient to sign (treatment plans, Carelon attestation, consent packets). */
export const GET = patientGet(async ({ req, ctx }) => {
  const scope = { clientId: ctx.clientId, organizationId: ctx.organizationId };
  const [plans, attestations, packets] = await Promise.all([listPatientDocuments(scope), listPatientAttestations(scope), listPatientPackets(scope)]);
  // A proxy (guardian) sees only what the proxy rules allow (src/patient/domain/proxy-policy.ts)
  const documents = (await filterPortalDocuments(ctx, [...plans, ...attestations, ...packets])).sort((a, b) => (b.sentAt ?? '').localeCompare(a.sentAt ?? ''));
  await writeAuditLog({
    action: 'LIST',
    actorUserId: ctx.accountId,
    actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'treatmentPlan',
    patientId: ctx.clientId,
    outcome: 'SUCCESS',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', purpose: 'documents_to_sign', ...(ctx.access?.isProxy ? { proxy: true, relationship: ctx.access.relationship, portalAccessId: ctx.access.accessId } : {}), count: documents.length, carelonAttestations: attestations.length, consentPackets: packets.length },
  });
  return patientOk({ documents });
}, ['patient-documents', 60]);
