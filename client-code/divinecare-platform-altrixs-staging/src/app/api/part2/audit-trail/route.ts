import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { parseAuditDate } from '@/lib/audit/auditFilters';
import { clientLabelMap, staffNameMap } from '@/lib/audit/clientLabels';
import { isSensitivePrivilegedRole } from '@/lib/privacy/sensitiveRoles';
import { part2ClientIds } from '@/lib/privacy/part2Disclosures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * GET /api/part2/audit-trail — read-only audit trail for 42 CFR Part 2 clients:
 * AuditLog events whose patient is a Part 2 client, plus protected-record opens
 * (SensitiveAccessLog). Same viewer rule as protected-record access logs
 * (isSensitivePrivilegedRole: ADMIN / PRACTICE_DIRECTOR). Optional: clientId, from, to, page.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!isSensitivePrivilegedRole(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'part2AuditTrail', outcome: 'DENIED' });
    return NextResponse.json(
      { success: false, error: 'Only Admin / Practice Director can view the Part 2 audit trail' },
      { status: 403 }
    );
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim().slice(0, 191) || null;
  const from = parseAuditDate(url.searchParams.get('from')?.trim() || undefined);
  const to = parseAuditDate(url.searchParams.get('to')?.trim() || undefined, true);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);

  try {
    const { ids, source } = await part2ClientIds(gate.organizationId);
    const scope = clientId ? ids.filter((id) => id === clientId) : ids;
    const range = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

    const [events, total, denied, sensitive] = scope.length
      ? await Promise.all([
          prisma.auditLog.findMany({
            where: { organizationId: gate.organizationId, patientId: { in: scope }, ...(range ? { createdAt: range } : {}) },
            select: { id: true, createdAt: true, actorUserId: true, actorRole: true, action: true, resourceType: true, patientId: true, outcome: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * PAGE_SIZE,
            take: PAGE_SIZE,
          }),
          prisma.auditLog.count({
            where: { organizationId: gate.organizationId, patientId: { in: scope }, ...(range ? { createdAt: range } : {}) },
          }),
          prisma.auditLog.count({
            where: { organizationId: gate.organizationId, patientId: { in: scope }, outcome: 'DENIED', ...(range ? { createdAt: range } : {}) },
          }),
          prisma.sensitiveAccessLog.findMany({
            where: { organizationId: gate.organizationId, clientId: { in: scope }, ...(range ? { timestamp: range } : {}) },
            select: { id: true, clientId: true, userId: true, accessType: true, timestamp: true },
            orderBy: { timestamp: 'desc' },
            take: 200,
          }),
        ])
      : [[], 0, 0, []];

    const [names, clients] = await Promise.all([
      staffNameMap(gate.organizationId, [...events.map((e) => e.actorUserId), ...sensitive.map((s) => s.userId)]),
      clientLabelMap({ ...gate, clientIds: ids }),
    ]);

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'part2AuditTrail',
      patientId: clientId,
      metadata: { page, returned: events.length, sensitiveReturned: sensitive.length, part2Clients: ids.length },
    });

    return NextResponse.json({
      success: true,
      page,
      pageSize: PAGE_SIZE,
      total,
      denied,
      clients: ids
        .map((id) => ({ id, ...(clients.get(id) ?? { label: 'Unknown client', mrn: null, protected: true, locked: true }), sources: source.get(id) ?? [] }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      events: events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        actorName: e.actorUserId ? names.get(e.actorUserId) ?? null : null,
        clientLabel: e.patientId ? clients.get(e.patientId)?.label ?? null : null,
      })),
      sensitiveAccess: sensitive.map((s) => ({
        ...s,
        timestamp: s.timestamp.toISOString(),
        userName: names.get(s.userId) ?? null,
        clientLabel: clients.get(s.clientId)?.label ?? null,
      })),
    });
  } catch (err) {
    console.error('[part2 audit-trail GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load Part 2 audit trail' }, { status: 500 });
  }
}
