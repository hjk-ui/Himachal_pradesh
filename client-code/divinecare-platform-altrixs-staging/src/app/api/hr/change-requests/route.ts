import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createChangeRequest, decideChangeRequest, listChangeRequests } from '@/lib/hr/people';
import { auditHr, hrGate, hrJsonError, hrServerError, loadRoster } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';

export const runtime = 'nodejs';

/** GET: HR sees pending requests for everyone; staff see their own. */
export async function GET() {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  try {
    const admin = isHrAdminRole(g.ctx.role);
    const rows = await listChangeRequests(g.ctx.organizationId, admin ? { status: 'pending' } : { userId: g.ctx.userId });
    const roster = admin ? await loadRoster(g.ctx.organizationId) : [];
    const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
    return NextResponse.json({ success: true, requests: rows.map((r) => ({ ...r, name: nameOf.get(r.userId) ?? null })) });
  } catch (err) {
    return hrServerError('change requests', err);
  }
}

const contact = z.object({
  name: z.string().trim().min(1).max(120),
  relationship: z.string().trim().max(60).optional(),
  phone: z.string().trim().min(3).max(30),
  altPhone: z.string().trim().max(30).optional(),
});
const createSchema = z.object({
  changes: z
    .object({
      preferredName: z.string().trim().max(80).nullable().optional(),
      pronouns: z.string().trim().max(40).nullable().optional(),
      personalEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
      personalPhone: z.string().trim().max(30).nullable().optional(),
      addressLine1: z.string().trim().max(120).nullable().optional(),
      addressLine2: z.string().trim().max(120).nullable().optional(),
      city: z.string().trim().max(80).nullable().optional(),
      state: z.string().trim().max(2).nullable().optional(),
      postalCode: z.string().trim().max(10).nullable().optional(),
      legalFirstName: z.string().trim().max(80).nullable().optional(),
      legalMiddleName: z.string().trim().max(80).nullable().optional(),
      legalLastName: z.string().trim().max(80).nullable().optional(),
      emergencyContacts: z.array(contact).max(4).optional(),
    })
    .strict(),
});

/** POST: staff self-service profile edit, pending HR approval. */
export async function POST(req: Request) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the changes', 400);
  }
  try {
    const result = await createChangeRequest(g.ctx, body.changes);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'CREATE', 'hrProfileChangeRequest', result.id, { fields: result.fields });
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (err) {
    return hrServerError('change request create', err);
  }
}

const decideSchema = z.object({
  id: z.string().min(1).max(128),
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).optional().nullable(),
});

/** PATCH: HR approves (applies to the profile) or rejects. */
export async function PATCH(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof decideSchema>;
  try {
    body = decideSchema.parse(await req.json());
  } catch {
    return hrJsonError('Invalid request', 400);
  }
  try {
    const result = await decideChangeRequest(g.ctx, body.id, body.decision, body.note);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrProfileChangeRequest', body.id, { decision: body.decision, staffUserId: result.userId, fields: result.fields });
    return NextResponse.json({ success: true });
  } catch (err) {
    return hrServerError('change request decide', err);
  }
}
