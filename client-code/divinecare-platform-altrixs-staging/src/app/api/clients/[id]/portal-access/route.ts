import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile, clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  ProxyAccessError,
  convertSelfLoginToGuardian,
  grantProxyAccess,
  listClientPortalAccess,
  listPortalItems,
  setMinorSelfConsent,
  setPortalItemVisibility,
} from '@/patient';

/**
 * Portal proxy access for one client (chart → Portal access card).
 *   GET   the client's own login, every guardian / representative link (state, verification, end
 *         date), age defaults and the clinician's confidential / shared-with-guardian decisions.
 *   POST  { action: 'grant' | 'convert_self' | 'minor_consent' | 'visibility', ... }
 * Rules: src/patient/domain/proxy-policy.ts; guidance: docs/portal-proxy-access.md. Every call is audited.
 */

const verification = z.object({
  method: z.string().min(1).max(40),
  legalDocumentRef: z.string().trim().max(200).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
});

const bodySchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('grant'),
    email: z.string().trim().max(254),
    displayName: z.string().trim().min(2).max(120),
    relationship: z.enum(['parent', 'legal_guardian', 'authorized_representative']),
    accessLevel: z.enum(['full', 'limited']).optional().nullable(),
    accessLevelReason: z.string().trim().max(500).optional().nullable(),
    verification: verification.optional().nullable(),
    expiresAt: z.string().max(40).optional().nullable(),
  }),
  z.object({
    action: z.literal('convert_self'),
    displayName: z.string().trim().min(2).max(120),
    relationship: z.enum(['parent', 'legal_guardian', 'authorized_representative']),
    accessLevel: z.enum(['full', 'limited']).optional().nullable(),
    accessLevelReason: z.string().trim().max(500).optional().nullable(),
    verification,
  }),
  z.object({ action: z.literal('minor_consent'), value: z.boolean() }),
  z.object({
    action: z.literal('visibility'),
    itemType: z.string().max(40),
    itemId: z.string().max(64),
    visibility: z.enum(['confidential', 'shared_with_guardian']).nullable(),
    reason: z.string().trim().max(500).optional().nullable(),
  }),
]);

/** Clinical decisions (what a guardian may see) are not front-desk decisions. */
function canSetClinicalVisibility(role: string | null | undefined) {
  return canEditClientProfile(role) && (role ?? '').toUpperCase() !== 'FRONT_DESK';
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  if (!canEditClientProfile(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'portalAccess', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listClientPortalAccess(gate.organizationId, clientByIdWhere(id, gate.organizationId));
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'portalAccess', resourceId: id, patientId: id, metadata: { links: data.links.length } });
    const clinical = canSetClinicalVisibility(gate.role);
    // Items for the confidential / shared-with-guardian choice (clinical roles, and only when someone has proxy access)
    const items = clinical && data.links.some((l) => l.relationship !== 'self') ? await listPortalItems(gate.organizationId, data.client.id) : [];
    return NextResponse.json({ success: true, ...data, items, canSetClinicalVisibility: clinical });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const { id } = await ctx.params;
  if (!canEditClientProfile(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'portalAccess', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const actor = { organizationId: gate.organizationId, userId: gate.userId };
  const where = clientByIdWhere(id, gate.organizationId);
  try {
    if (body.action === 'grant') {
      const r = await grantProxyAccess(actor, where, body);
      await auditPhiAccess({
        gate, req, action: 'PORTAL_PROXY_GRANT', resourceType: 'portalAccess', resourceId: r.accessId, patientId: id,
        metadata: { relationship: body.relationship, accessLevel: r.accessLevel, verified: r.verified, verificationMethod: body.verification?.method ?? null, newLogin: r.newLogin, notification: r.notification },
      });
      return NextResponse.json({ success: true, ...r });
    }
    if (body.action === 'convert_self') {
      const r = await convertSelfLoginToGuardian(actor, where, body);
      await auditPhiAccess({
        gate, req, action: 'PORTAL_PROXY_CONVERT_SELF', resourceType: 'portalAccess', resourceId: r.portalUserId, patientId: id,
        metadata: { relationship: r.relationship, accessLevel: r.accessLevel, verificationMethod: body.verification.method },
      });
      return NextResponse.json({ success: true, ...r });
    }
    if (!canSetClinicalVisibility(gate.role)) {
      await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'portalAccess', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role', action: body.action } });
      return NextResponse.json({ success: false, error: 'Only clinical staff can change what a guardian may see.' }, { status: 403 });
    }
    if (body.action === 'minor_consent') {
      const r = await setMinorSelfConsent(actor, where, body.value);
      await auditPhiAccess({ gate, req, action: 'PORTAL_MINOR_SELF_CONSENT', resourceType: 'client', resourceId: id, patientId: id, metadata: { value: body.value } });
      return NextResponse.json({ success: true, ...r });
    }
    // visibility: resolve the client inside this org first
    const listed = await listClientPortalAccess(gate.organizationId, where);
    const r = await setPortalItemVisibility(actor, listed.client.id, { itemType: body.itemType, itemId: body.itemId, visibility: body.visibility ?? null, reason: body.reason });
    await auditPhiAccess({ gate, req, action: 'PORTAL_ITEM_VISIBILITY', resourceType: 'portalItemVisibility', resourceId: body.itemId, patientId: id, metadata: { itemType: body.itemType, visibility: body.visibility } });
    return NextResponse.json({ success: true, ...r });
  } catch (err) {
    if (err instanceof ProxyAccessError) {
      await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'portalAccess', resourceId: id, patientId: id, outcome: 'FAILURE', metadata: { action: body.action, status: err.status } });
    }
    return fail(err);
  }
}

function fail(err: unknown) {
  if (err instanceof ProxyAccessError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
  console.error('[portal-access]', err instanceof Error ? err.message : err);
  return NextResponse.json({ success: false, error: 'Something went wrong' }, { status: 500 });
}
