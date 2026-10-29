import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  buildCollectionsCsv,
  buildCollectionsReport,
  DATE_BASIS_NOTE,
  PROVIDER_COLLECTIONS_PATH,
  SECTION_ORDER,
  type SectionKey,
} from '@/lib/billing/providerCollections';
import { buildProviderCodeMap, collectionsProviderUserId } from '@/lib/migration/valantProviderMap';

export const runtime = 'nodejs';

function dateParam(v: string | null, endOfDay = false): Date | null {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0));
}

/**
 * GET /api/billing/provider-collections?from&to&provider&section[&format=csv] — Valant's "Payments, Refunds
 * and Adjustments" by provider, from imported Valant transactions (by date of service). One groupBy over
 * provider × code; no patient-level rows leave the database. Billing roles + leadership + office manager.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, PROVIDER_COLLECTIONS_PATH)) {
    return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  }
  try {
    const sp = new URL(req.url).searchParams;
    const orgId = gate.organizationId;
    const fromRaw = sp.get('from');
    const toRaw = sp.get('to');
    const from = dateParam(fromRaw);
    const to = dateParam(toRaw, true);
    if ((fromRaw && !from) || (toRaw && !to)) {
      return NextResponse.json({ success: false, error: 'from / to must be YYYY-MM-DD' }, { status: 400 });
    }
    const provider = (sp.get('provider') ?? '').trim().slice(0, 200) || null;
    const sectionRaw = (sp.get('section') ?? '').trim();
    const section = sectionRaw ? (SECTION_ORDER.includes(sectionRaw as SectionKey) ? (sectionRaw as SectionKey) : undefined) : null;
    if (section === undefined) return NextResponse.json({ success: false, error: 'Unknown section' }, { status: 400 });
    const csv = sp.get('format') === 'csv';

    const where: Prisma.ValantTransactionWhereInput = { organizationId: orgId };
    if (from || to) where.serviceDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };

    const [rawGroups, undatedRows, org, mapRows] = await Promise.all([
      prisma.valantTransaction.groupBy({
        by: ['providerCode', 'providerUserId', 'code', 'category'],
        where,
        _sum: { amountCents: true },
        _count: { _all: true },
      }),
      from || to ? prisma.valantTransaction.count({ where: { organizationId: orgId, serviceDate: null } }) : Promise.resolve(0),
      prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
      // Before 20261020_valant_provider_map.sql is applied: no mappings (the import's match is used as before)
      prisma.valantProviderMap
        .findMany({ where: { organizationId: orgId }, select: { codeKey: true, userId: true } })
        .catch(() => [] as { codeKey: string; userId: string }[]),
    ]);
    // Admin > Data import > Valant provider codes: a mapped code wins over the import's name match
    const codeMap = buildProviderCodeMap(mapRows);
    const groups = rawGroups.map((g) => ({ ...g, providerUserId: collectionsProviderUserId(g.providerCode, g.providerUserId, codeMap).userId }));
    const userIds = [...new Set(groups.map((g) => g.providerUserId).filter((x): x is string => Boolean(x)))];
    const staff = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds }, organizationId: orgId }, select: { id: true, name: true } })
      : [];
    const report = buildCollectionsReport(
      groups.map((g) => ({
        providerCode: g.providerCode, providerUserId: g.providerUserId, code: g.code, category: g.category,
        cents: g._sum.amountCents ?? 0, count: g._count._all,
      })),
      new Map(staff.map((s) => [s.id, s.name])),
      { provider, section }
    );

    await auditPhiAccess({
      gate, req, action: csv ? 'EXPORT' : 'READ', resourceType: 'valantProviderCollections',
      metadata: {
        view: 'provider_collections', format: csv ? 'csv' : 'json', from: fromRaw, to: toRaw,
        providerFilter: Boolean(provider), section: section ?? 'all', groups: groups.length, unmappedCodes: report.unmappedCodes.length,
      },
    });

    const fromIso = from ? fromRaw : null;
    const toIso = to ? toRaw : null;
    if (csv) {
      return new NextResponse(buildCollectionsCsv(report, { from: fromIso, to: toIso, organizationName: org?.name ?? null }), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="provider-collections-${fromIso ?? 'all'}-to-${toIso ?? 'all'}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json({
      success: true,
      organizationName: org?.name ?? null,
      from: fromIso,
      to: toIso,
      dateBasisNote: DATE_BASIS_NOTE,
      undatedRows,
      ...report,
    });
  } catch (err) {
    console.error('[provider-collections GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load provider collections' }, { status: 500 });
  }
}
