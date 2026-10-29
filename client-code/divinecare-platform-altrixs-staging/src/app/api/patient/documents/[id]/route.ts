import { patientFail, patientGet, patientOk, patientOptions } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { getPatientDocument } from '@/lib/ehr/therapy/planStore';
import { getPatientAttestation } from '@/lib/consents/carelon/store';
import { getPatientPacket, markPatientPacketViewed } from '@/lib/consents/library/store2';
import { filterPortalDocuments } from '@/patient/application/proxy/visibility';

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/documents/[id] — the treatment plan exactly as the clinician signed it, or the Carelon attestation form. */
export async function GET(req: Request, route: { params: Promise<{ id: string }> }) {
  const { id } = await route.params;
  return patientGet(async ({ ctx }) => {
    const scope = { clientId: ctx.clientId, organizationId: ctx.organizationId };
    const plan = id && id.length <= 128 ? await getPatientDocument(scope, id) : null;
    const attestation = plan ? null : id && id.length <= 128 ? await getPatientAttestation(scope, id) : null;
    const found = plan ?? attestation ?? (id && id.length <= 128 ? await getPatientPacket(scope, id) : null);
    // Hidden from this proxy = not found (never reveal that a confidential / Part 2 item exists)
    const document = found && (await filterPortalDocuments(ctx, [found])).length === 1 ? found : null;
    await writeAuditLog({
      action: 'READ',
      actorUserId: ctx.accountId,
      actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
      organizationId: ctx.organizationId,
      resourceType: document?.kind === 'carelon-attestation' ? 'carelonAttestation' : document?.kind === 'consent-packet' ? 'consentPacket' : 'treatmentPlan',
      resourceId: id,
      patientId: ctx.clientId,
      outcome: document ? 'SUCCESS' : 'DENIED',
      ...auditRequestMeta(req),
      metadata: { portal: 'patient-web', purpose: 'document_to_sign', ...(ctx.access?.isProxy ? { proxy: true, relationship: ctx.access.relationship, portalAccessId: ctx.access.accessId, ...(found && !document ? { hiddenFromProxy: true } : {}) } : {}) },
    });
    if (!document) return patientFail('NOT_FOUND', 'Document not found', 404);
    // Consent packet "viewed" tracking (shown to staff on the Packets list and in the PDF audit trail)
    if (document.kind === 'consent-packet') await markPatientPacketViewed(scope, id);
    return patientOk({ document });
  }, ['patient-document', 60])(req);
}
