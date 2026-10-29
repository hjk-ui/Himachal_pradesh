import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canViewValantBalances } from '@/lib/billing/valantBalances';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

const PAGE = 100;

function dateParam(v: string | null, endOfDay = false): Date | null {
  const m = v?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0));
}

/**
 * GET /api/billing/valant-balances/transactions — Valant transaction history (reference only).
 * Filters: q (patient name / MRN / Valant ID), clientId, from, to (YYYY-MM-DD service date),
 * category, provider (code), billingId, page. With a single patient (clientId, or q that is one
 * Valant ID) each row carries that patient's running balance in service-date order.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canViewValantBalances(gate.role)) return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  try {
    const sp = new URL(req.url).searchParams;
    const orgId = gate.organizationId;
    const where: Prisma.ValantTransactionWhereInput = { organizationId: orgId };
    const clientId = sp.get('clientId');
    const q = (sp.get('q') ?? '').trim().slice(0, 80);
    let singlePatient = false;
    if (clientId) {
      where.clientId = clientId;
      singlePatient = true;
    } else if (q) {
      const clients = await prisma.client.findMany({
        where: {
          organizationId: orgId,
          OR: [{ name: { contains: q, mode: 'insensitive' } }, { mrn: { equals: q, mode: 'insensitive' } }],
        },
        select: { id: true },
        take: 200,
      });
      where.OR = [{ valantPatientId: q.toUpperCase() }, ...(clients.length ? [{ clientId: { in: clients.map((c) => c.id) } }] : [])];
      const ids = await prisma.valantTransaction.findMany({ where, distinct: ['valantPatientId'], select: { valantPatientId: true }, take: 2 });
      singlePatient = ids.length === 1;
    }
    const from = dateParam(sp.get('from'));
    const to = dateParam(sp.get('to'), true);
    if (from || to) where.serviceDate = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    const category = sp.get('category');
    if (category) where.category = category;
    const provider = sp.get('provider');
    if (provider) where.providerCode = provider;
    const billingId = sp.get('billingId');
    if (billingId) where.billingId = billingId.trim();
    const page = Math.max(0, Number(sp.get('page') ?? 0) || 0);

    const orderBy: Prisma.ValantTransactionOrderByWithRelationInput[] = singlePatient
      ? [{ serviceDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]
      : [{ serviceDate: 'desc' }, { valantPatientId: 'asc' }, { id: 'asc' }];
    const [count, byCategory, rows, providers] = await Promise.all([
      prisma.valantTransaction.count({ where }),
      prisma.valantTransaction.groupBy({ by: ['category'], where, _sum: { amountCents: true }, _count: { _all: true } }),
      prisma.valantTransaction.findMany({
        where,
        orderBy,
        skip: page * PAGE,
        take: PAGE,
        include: { client: { select: { id: true, name: true, mrn: true } } },
      }),
      prisma.valantTransaction.findMany({ where: { organizationId: orgId }, distinct: ['providerCode'], select: { providerCode: true }, orderBy: { providerCode: 'asc' } }),
    ]);

    // Running balance: everything before this page (same filters), then row by row
    let running: number | null = null;
    if (singlePatient) {
      if (page > 0) {
        const before = await prisma.valantTransaction.findMany({ where, orderBy, take: page * PAGE, select: { amountCents: true } });
        running = before.reduce((s, r) => s + r.amountCents, 0);
      } else running = 0;
    }
    const out = rows.map((r) => {
      if (running !== null) running += r.amountCents;
      return {
        id: r.id, clientId: r.clientId, clientName: r.client?.name ?? null, mrn: r.client?.mrn ?? null, valantPatientId: r.valantPatientId,
        billingId: r.billingId, serviceDate: isoDate(r.serviceDate), providerCode: r.providerCode, pos: r.pos, diagnosis: r.diagnosis,
        code: r.code, codeBase: r.codeBase, codeSuffix: r.codeSuffix, category: r.category, amountCents: r.amountCents, note: r.note,
        facility: r.facility, insurance: r.insurance,
        runningBalanceCents: running,
      };
    });
    const latest = await prisma.valantReferenceImport.findFirst({
      where: { organizationId: orgId, reportType: 'transactions' },
      orderBy: { importedAt: 'desc' },
      select: { importedAt: true, totalsJson: true },
    });
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'valantTransaction', patientId: clientId,
      metadata: { view: 'transactions', count, page, filters: { q: Boolean(q), from: Boolean(from), to: Boolean(to), category: Boolean(category), provider: Boolean(provider), billingId: Boolean(billingId) } },
    });
    return NextResponse.json({
      success: true,
      count,
      page,
      pageSize: PAGE,
      singlePatient,
      rows: out,
      totalsByCategory: byCategory.map((c) => ({ category: c.category, rows: c._count._all, cents: c._sum.amountCents ?? 0 })),
      providers: providers.map((p) => p.providerCode).filter(Boolean),
      latestImport: latest ? { importedAt: latest.importedAt.toISOString(), totals: latest.totalsJson } : null,
    });
  } catch (err) {
    console.error('[valant-balances transactions GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load transactions' }, { status: 500 });
  }
}
