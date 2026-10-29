import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canUsePart2Page, checkPart2ClientAccess } from '@/lib/privacy/part2Disclosures';
import { validDisclosureConsents } from '@/lib/consents/library/store2';
import { json } from '../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/consents/library/disclosure-consents?clientId= — the client's signed, unexpired and not
 * revoked ROI / Part 2 consents (the disclosure form only offers these; the POST re-checks).
 * Read rule (checkPart2ClientAccess mode 'read'): ADMIN / PD or a treating clinician on the caseload,
 * plus the protected-record lock. The release desk records disclosures with a consent reference.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status);
  if (!canUsePart2Page(gate.role)) return json({ success: false, error: 'Forbidden' }, 403);
  const clientId = new URL(req.url).searchParams.get('clientId') ?? '';
  if (!clientId || clientId.length > 128) return json({ success: false, error: 'clientId is required' }, 400);
  const access = await checkPart2ClientAccess({ ...gate, clientId, path: '/api/consents/library/disclosure-consents' });
  if (access.ok === false) {
    if (access.denied) await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'disclosureConsents', patientId: clientId, outcome: 'DENIED' });
    return json({ success: false, error: access.error }, access.status);
  }
  const consents = await validDisclosureConsents(gate.organizationId, clientId);
  await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'disclosureConsents', patientId: clientId, metadata: { count: consents.length } });
  return json({ success: true, consents });
}
