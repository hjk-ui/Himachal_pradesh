import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BILLING_ARCHIVE_STATUS, canViewBillingArchive, PRACTICE_BILLING_MATCH } from '@/lib/migration/valantDocuments';
import { filterBillingArchive, toBillingArchiveRow } from '@/lib/billing/valantBillingArchive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
const MAX_ROWS = 20000;

/**
 * GET /api/billing/valant-archive?q=&from=&to=&page= — practice billing records from the Valant
 * documents import (ERA exceptions, claims, remittance, EOB): no client, never in the review queue.
 * Billing roles and leadership; Office Manager reads. Every list is audited; each file opens through
 * /api/files/intake-docs (same role rule, audited per file).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canViewBillingArchive(String(gate.role))) {
    return NextResponse.json({ success: false, error: 'Billing access required' }, { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const q = (sp.get('q') || '').trim().slice(0, 100);
  const date = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(sp.get(k) || '') ? (sp.get(k) as string) : null);
  const from = date('from');
  const to = date('to');
  const page = Math.max(0, Math.min(1000, Number(sp.get('page')) || 0));
  try {
    const docs = await prisma.documentIntake.findMany({
      where: { organizationId: gate.organizationId, status: BILLING_ARCHIVE_STATUS, matchStatus: PRACTICE_BILLING_MATCH, suggestedClientId: null },
      select: { id: true, fileName: true, fileSize: true, s3RawKey: true, extractedFields: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    const rows = filterBillingArchive(docs.map(toBillingArchiveRow), { q, from, to });
    const pageRows = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'valantBillingArchive',
      metadata: { total: docs.length, matching: rows.length, page, filtered: Boolean(q || from || to) },
    });
    return NextResponse.json({ success: true, count: rows.length, total: docs.length, page, pageSize: PAGE_SIZE, rows: pageRows });
  } catch (err) {
    console.error('[valant-archive GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the billing archive' }, { status: 500 });
  }
}
