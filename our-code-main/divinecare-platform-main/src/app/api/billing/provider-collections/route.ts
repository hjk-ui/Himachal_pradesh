import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { excludedCollectionCategory, isMissingSchema, parseDay } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPayerBilling(gate.role) || gate.role === 'OFFICE_MANAGER' || gate.role === 'FRONT_DESK') {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const url = new URL(req.url);
  const from = parseDay(url.searchParams.get('from'));
  const to = parseDay(url.searchParams.get('to'));
  if (!from || !to || to < from) {
    return NextResponse.json({ success: false, error: 'from and to are required as YYYY-MM-DD' }, { status: 400 });
  }
  const provider = (url.searchParams.get('provider') || '').trim();
  const section = (url.searchParams.get('section') || '').trim().toLowerCase();
  const format = url.searchParams.get('format');
  const toEnd = new Date(to.getTime() + 86_400_000);

  try {
    const [org, rows, undatedRows, maps] = await Promise.all([
      prisma.organization.findUnique({ where: { id: gate.organizationId }, select: { name: true } }),
      prisma.valantTransaction.findMany({
        where: {
          organizationId: gate.organizationId,
          serviceDate: { gte: from, lt: toEnd },
        },
      }),
      prisma.valantTransaction.count({
        where: { organizationId: gate.organizationId, serviceDate: null },
      }),
      prisma.valantProviderMap.findMany({ where: { organizationId: gate.organizationId } }),
    ]);
    const mapByCode = new Map(maps.map((row) => [row.codeKey, row.providerUserId]));
    const grouped = new Map<string, { providerCode: string; providerUserId: string | null; code: string; category: string; amountCents: number; count: number }>();
    const unmapped = new Set<string>();
    let excludedAmount = 0;
    let excludedCount = 0;
    for (const row of rows) {
      const codeKey = row.providerCode || '';
      const mapped = mapByCode.get(codeKey);
      const providerUserId = mapped || row.providerUserId || null;
      if (!mapped && !row.providerUserId && codeKey) unmapped.add(codeKey);
      if (provider && providerUserId !== provider && codeKey !== provider) continue;
      const category = row.category || '';
      if (excludedCollectionCategory(category)) {
        excludedAmount += row.amountCents;
        excludedCount += 1;
        continue;
      }
      if (section && category.toLowerCase() !== section) continue;
      const key = `${providerUserId || codeKey}|${row.code || ''}|${category}`;
      const current = grouped.get(key) || {
        providerCode: codeKey,
        providerUserId,
        code: row.code || '',
        category,
        amountCents: 0,
        count: 0,
      };
      current.amountCents += row.amountCents;
      current.count += 1;
      grouped.set(key, current);
    }
    const lines = [...grouped.values()];
    const sections = [...new Set(lines.map((line) => line.category))].map((category) => ({
      category,
      rows: lines.filter((line) => line.category === category),
      amountCents: lines.filter((line) => line.category === category).reduce((sum, line) => sum + line.amountCents, 0),
    }));
    const summary = {
      amountCents: lines.reduce((sum, line) => sum + line.amountCents, 0),
      rowCount: lines.reduce((sum, line) => sum + line.count, 0),
    };
    const providers = [...new Set(lines.map((line) => line.providerUserId || line.providerCode).filter(Boolean))];
    const body = {
      success: true,
      organizationName: org?.name || '',
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      dateBasisNote: 'Totals use ValantTransaction.serviceDate. Undated rows are counted separately and are not in the money sections.',
      undatedRows,
      sections,
      summary,
      providers,
      unmappedCodes: [...unmapped],
      excluded: { amountCents: excludedAmount, count: excludedCount, categories: ['charge', 'fee'] },
    };
    if (format === 'csv') {
      const header = 'category,providerCode,providerUserId,code,amountCents,count';
      const csv = [
        header,
        ...lines.map((line) =>
          [line.category, line.providerCode, line.providerUserId || '', line.code, line.amountCents, line.count]
            .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
            .join(',')
        ),
      ].join('\n');
      return new NextResponse(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
    }
    return NextResponse.json(body);
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[provider-collections]', err);
      return NextResponse.json({ success: false, error: 'Could not load provider collections' }, { status: 500 });
    }
    return NextResponse.json({
      success: true,
      organizationName: '',
      from: url.searchParams.get('from'),
      to: url.searchParams.get('to'),
      dateBasisNote: 'Totals use ValantTransaction.serviceDate. Undated rows are counted separately and are not in the money sections.',
      undatedRows: 0,
      sections: [],
      summary: { amountCents: 0, rowCount: 0 },
      providers: [],
      unmappedCodes: [],
      excluded: { amountCents: 0, count: 0, categories: ['charge', 'fee'] },
    });
  }
}
