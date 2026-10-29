import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess, auditRequestMeta } from '@/lib/audit/requestMeta';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { signPacket, staffPacket, voidPacket } from '@/lib/consents/library/store';
import { staffPacketSigningSchema } from '@/lib/consents/library/schema';
import type { StaffEvidenceInput } from '@/lib/consents/library/evidence';
import { chartGate, consentGate, json } from '../../_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

async function clientOf(organizationId: string, id: string) {
  if (!id || id.length > 128) return null;
  return (await prisma.consentPacket.findFirst({ where: { id, organizationId }, select: { clientId: true } }))?.clientId ?? null;
}

/** GET — the packet with each section's text (frozen once signed) for in-office signing / review. */
export async function GET(req: Request, ctx: Ctx) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const clientId = await clientOf(g.gate.organizationId, id);
  if (!clientId) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, clientId, `/api/consents/library/packets/${id}`, 'consentPacket');
  if (denied) return denied;
  const packet = await staffPacket(g.actor, id);
  if (!packet) return json({ success: false, error: 'Not found' }, 404);
  await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'consentPacket', resourceId: id, patientId: clientId, metadata: { status: packet.status, items: packet.items.length } });
  return json({ success: true, packet, clientId });
}

/** POST — the client signs in office on a staff device (one final signature; staff recorded as witness). */
export async function POST(req: Request, ctx: Ctx) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  const clientId = await clientOf(g.gate.organizationId, id);
  if (!clientId) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, clientId, `/api/consents/library/packets/${id}`, 'consentPacket');
  if (denied) return denied;
  if (!(await staffPacket(g.actor, id))) return json({ success: false, error: 'Not found' }, 404);
  const parsed = staffPacketSigningSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  const { evidence, ...submission } = parsed.data;
  const staffInput: StaffEvidenceInput = evidence
    ? { ...evidence, interpreter: evidence.interpreter ? { used: evidence.interpreter.used, language: evidence.interpreter.language ?? null, name: evidence.interpreter.name ?? null } : null }
    : { signatureMethod: 'in_office_tablet' };
  const r = await signPacket(g.gate.organizationId, id, submission, { method: 'in_office', recordedById: g.gate.userId, evidence: { request: auditRequestMeta(req), staffInput } });
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'SIGN',
    resourceType: 'consentPacket',
    resourceId: id,
    patientId: clientId,
    outcome: r.ok ? undefined : 'DENIED',
    metadata: r.ok === true ? { method: 'in_office', signatureMethod: staffInput.signatureMethod, interpreter: Boolean(staffInput.interpreter?.used), signerType: submission.signer.signerType, pdfStored: r.pdfStored } : { status: r.status },
  });
  if (r.ok === false) return json({ success: false, error: r.error, errors: r.errors }, r.status);
  invalidateInboxForOrg(g.gate.organizationId);
  return json({ success: true, pdfStored: r.pdfStored });
}

const voidSchema = z.object({ reason: z.string().trim().min(3).max(300) });

/** DELETE — cancel an unsigned packet (reason required). */
export async function DELETE(req: Request, ctx: Ctx) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const { id } = await ctx.params;
  // Same client + chart gate (org, caseload, Part 2 / sensitive lock) as GET and POST
  const clientId = await clientOf(g.gate.organizationId, id);
  if (!clientId) return json({ success: false, error: 'Not found' }, 404);
  const denied = await chartGate(g.gate, req, clientId, `/api/consents/library/packets/${id}`, 'consentPacket');
  if (denied) return denied;
  const parsed = voidSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: 'Give a reason (3+ characters).' }, 400);
  const r = await voidPacket(g.actor, id, parsed.data.reason);
  await auditPhiAccess({ gate: g.gate, req, action: 'DELETE', resourceType: 'consentPacket', resourceId: id, patientId: r.ok ? r.clientId : null, outcome: r.ok ? undefined : 'DENIED' });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  invalidateInboxForOrg(g.gate.organizationId);
  return json({ success: true });
}
