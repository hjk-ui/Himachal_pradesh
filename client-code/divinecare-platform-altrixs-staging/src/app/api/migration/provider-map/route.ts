import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireImportGate } from '@/lib/migration/referenceImport';
import { buildProviderCodeMap, providerCodeKey, providerCodeRows } from '@/lib/migration/valantProviderMap';
import { PRIMARY_CARE_VALANT_FACILITY } from '@/lib/medical/medicalProgram';
import { isPcpEligible, pcpDisplayName } from '@/lib/medical/pcpAssignment';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Valant provider codes -> staff users (ValantProviderMap). Leadership only (same gate as the
 * Valant imports). No patient data: codes, row counts and staff names.
 *
 * GET  — every provider code in imported Valant transactions with its row counts, its mapping,
 *        and the import's name match as a suggestion (never applied automatically); staff choices.
 * PUT  { providerCode, userId }  — map a code (userId null removes the mapping). Audited.
 */
export async function GET(req: Request) {
  const g = await requireImportGate('provider codes');
  if (g.denied) return g.denied;
  const { gate } = g;
  const orgId = gate.organizationId;
  try {
    const [all, fp, last, mapRows, users] = await Promise.all([
      prisma.valantTransaction.groupBy({ by: ['providerCode', 'providerUserId'], where: { organizationId: orgId }, _count: { _all: true } }),
      prisma.valantTransaction.groupBy({
        by: ['providerCode'],
        where: { organizationId: orgId, category: 'charge', facility: { equals: PRIMARY_CARE_VALANT_FACILITY, mode: 'insensitive' } },
        _count: { _all: true },
      }),
      prisma.valantTransaction.groupBy({ by: ['providerCode'], where: { organizationId: orgId }, _max: { serviceDate: true } }),
      prisma.valantProviderMap.findMany({ where: { organizationId: orgId }, select: { providerCode: true, codeKey: true, userId: true, updatedAt: true } }),
      prisma.user.findMany({
        where: { organizationId: orgId },
        select: { id: true, name: true, email: true, credentials: true, role: true, roles: true, status: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    const fpByKey = new Map<string, number>();
    for (const r of fp) fpByKey.set(providerCodeKey(r.providerCode), (fpByKey.get(providerCodeKey(r.providerCode)) ?? 0) + r._count._all);
    const lastByCode = new Map(last.map((r) => [r.providerCode, r._max.serviceDate]));
    const seenFp = new Set<string>();
    const map = buildProviderCodeMap(mapRows);
    const rows = providerCodeRows(
      all.map((r) => {
        const key = providerCodeKey(r.providerCode);
        // Family Practice count is per code; attach it to the first group of that code only
        const primaryCareCharges = seenFp.has(key) ? 0 : fpByKey.get(key) ?? 0;
        seenFp.add(key);
        return { providerCode: r.providerCode, providerUserId: r.providerUserId, rows: r._count._all, primaryCareCharges, lastServiceDate: lastByCode.get(r.providerCode) ?? null };
      }),
      map
    );
    // A saved mapping whose code is no longer in the imports is still listed (so it can be removed)
    for (const m of mapRows) {
      if (!rows.some((r) => r.codeKey === m.codeKey)) {
        rows.push({ providerCode: m.providerCode, codeKey: m.codeKey, rows: 0, primaryCareCharges: 0, lastServiceDate: null, mappedUserId: m.userId, importMatchUserId: null });
      }
    }
    const staff = users.map((u) => {
      const s = { id: u.id, name: u.name, credentials: u.credentials, role: String(u.role), roles: u.roles.map(String), status: String(u.status) };
      return { id: u.id, name: u.name?.trim() ? pcpDisplayName(s) : u.email || 'Staff member', role: s.role, status: s.status, medicalProvider: isPcpEligible(s) };
    });
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'valantProviderMap', metadata: { codes: rows.length, mapped: mapRows.length } });
    return NextResponse.json({ success: true, rows, staff }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[api/migration/provider-map GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load provider codes' }, { status: 500 });
  }
}

const putSchema = z.object({
  providerCode: z.string().trim().min(1).max(120),
  userId: z.string().trim().min(1).max(64).nullable(),
});

export async function PUT(req: Request) {
  const g = await requireImportGate('provider codes');
  if (g.denied) return g.denied;
  const { gate } = g;
  const orgId = gate.organizationId;
  try {
    const body = putSchema.parse(await req.json());
    const codeKey = providerCodeKey(body.providerCode);
    const existing = await prisma.valantProviderMap.findUnique({ where: { organizationId_codeKey: { organizationId: orgId, codeKey } } });
    if (body.userId === null) {
      if (existing) await prisma.valantProviderMap.delete({ where: { id: existing.id } });
    } else {
      const user = await prisma.user.findFirst({ where: { id: body.userId, organizationId: orgId }, select: { id: true } });
      if (!user) return NextResponse.json({ success: false, error: 'Choose a staff member of this practice' }, { status: 400 });
      await prisma.valantProviderMap.upsert({
        where: { organizationId_codeKey: { organizationId: orgId, codeKey } },
        create: { organizationId: orgId, providerCode: body.providerCode.replace(/\s+/g, ' '), codeKey, userId: user.id, mappedById: gate.userId },
        update: { userId: user.id, mappedById: gate.userId },
      });
    }
    await auditPhiAccess({
      gate,
      req,
      action: 'UPDATE',
      resourceType: 'valantProviderMap',
      resourceId: codeKey,
      metadata: { providerCode: body.providerCode, previousUserId: existing?.userId ?? null, newUserId: body.userId },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Invalid mapping' }, { status: 400 });
    console.error('[api/migration/provider-map PUT]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not save the mapping' }, { status: 500 });
  }
}
