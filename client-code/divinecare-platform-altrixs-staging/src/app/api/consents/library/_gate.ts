/** Shared gate for /api/consents/library/* (staff consent roles; chart access for client routes). */
import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessConsents } from '@/lib/consents/manage';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function consentGate() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: json({ success: false, error: gate.error }, gate.status) };
  if (!canAccessConsents(gate.role)) return { ok: false as const, res: json({ success: false, error: 'Forbidden' }, 403) };
  return { ok: true as const, gate, actor: { organizationId: gate.organizationId, userId: gate.userId, role: gate.role as string } };
}

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/** Chart access (sensitive / Part 2 records) for a client; audits the denial. */
export async function chartGate(gate: Gate, req: Request, clientId: string, path: string, resourceType: string) {
  const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId, path);
  if (access.ok === false) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType, resourceId: clientId, patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
    return json({ success: false, error: 'Not found' }, 404);
  }
  return null;
}

export function pdfResponse(bytes: Uint8Array, fileName: string) {
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(bytes.byteLength),
      'Content-Disposition': `attachment; filename="${fileName}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
