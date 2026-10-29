import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canEditClientProfile } from '@/lib/clients/orgScope';
import { canRevealSsn, formatSsn, maskSsn, normalizeSsn, ssnError, ssnLast4 } from '@/lib/clients/ssn';
import { decryptField, encryptField, fieldEncryptionConfigured } from '@/lib/security/fieldCrypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const H = { 'Cache-Control': 'private, no-store' };
type Ctx = { params: Promise<{ id: string }> };

async function gateFor(req: Request, id: string) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: NextResponse.json({ success: false, error: gate.error }, { status: gate.status, headers: H }) };
  const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id, `/api/clients/${id}/ssn`);
  if (access.ok === false) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientSsn', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: access.reason } });
    return { ok: false as const, res: NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: H }) };
  }
  return { ok: true as const, gate };
}

/**
 * GET /api/clients/[id]/ssn — masked SSN (***-**-1234) for anyone with chart access.
 * GET ?reveal=1 — the full number, only for SSN_REVEAL_ROLES (billing / administration); audited.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await gateFor(req, id);
  if (!g.ok) return g.res;
  const c = await prisma.client.findFirst({ where: { id, organizationId: g.gate.organizationId }, select: { ssnLast4: true, ssnEncrypted: true } });
  if (!c) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: H });
  const reveal = new URL(req.url).searchParams.get('reveal') === '1';
  const canReveal = canRevealSsn(g.gate.role);
  if (reveal) {
    if (!canReveal) {
      await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'clientSsn', resourceId: id, patientId: id, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
      return NextResponse.json({ success: false, error: 'Your role cannot view the full Social Security Number.' }, { status: 403, headers: H });
    }
    const plain = decryptField(c.ssnEncrypted);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'clientSsn', resourceId: id, patientId: id, metadata: { reveal: true, available: Boolean(plain) } });
    return NextResponse.json({ success: true, ssn: plain ? formatSsn(plain) : null, masked: maskSsn(c.ssnLast4), note: plain ? null : 'Only the last four digits are on file.' }, { headers: H });
  }
  return NextResponse.json({ success: true, masked: maskSsn(c.ssnLast4), onFile: Boolean(c.ssnLast4), fullOnFile: Boolean(c.ssnEncrypted), canReveal, encryptionConfigured: fieldEncryptionConfigured() }, { headers: H });
}

const putSchema = z.object({ ssn: z.string().max(20).nullable() });

/** PUT — set or clear the SSN (optional field). Stored encrypted; only the last four are kept in clear. */
export async function PUT(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const g = await gateFor(req, id);
  if (!g.ok) return g.res;
  if (!canEditClientProfile(g.gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403, headers: H });
  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400, headers: H });
  const err = ssnError(parsed.data.ssn);
  if (err) return NextResponse.json({ success: false, error: err }, { status: 400, headers: H });
  const digits = normalizeSsn(parsed.data.ssn);
  const encrypted = digits ? encryptField(digits) : null;
  const res = await prisma.client.updateMany({ where: { id, organizationId: g.gate.organizationId }, data: { ssnLast4: digits ? ssnLast4(digits) : null, ssnEncrypted: encrypted } });
  if (!res.count) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404, headers: H });
  await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'clientSsn', resourceId: id, patientId: id, metadata: { cleared: !digits, encrypted: Boolean(encrypted) } });
  return NextResponse.json(
    { success: true, masked: maskSsn(digits ? ssnLast4(digits) : null), fullStored: Boolean(encrypted), note: digits && !encrypted ? 'Field encryption is not configured on this server (PHI_FIELD_ENCRYPTION_KEY), so only the last four digits were saved.' : null },
    { headers: H }
  );
}
