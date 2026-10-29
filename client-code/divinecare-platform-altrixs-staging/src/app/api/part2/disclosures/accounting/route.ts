import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { staffNameMap } from '@/lib/audit/clientLabels';
import { parseAuditDate } from '@/lib/audit/auditFilters';
import { csvRow } from '@/lib/audit/csv';
import { DISCLOSURE_SELECT, checkPart2ClientAccess, disclosureView } from '@/lib/privacy/part2Disclosures';
import { disclosureBasisLabel, disclosureMethodLabel } from '@/lib/privacy/part2DisclosureTypes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_YEARS = 6;

/**
 * GET /api/part2/disclosures/accounting?clientId=…&from=…&to=…[&format=csv]
 * Accounting of disclosures for one client over a date range (default: the past 6 years).
 * Read rule (checkPart2ClientAccess mode 'read'): ADMIN / PD or a treating clinician with the client
 * on their caseload, plus the protected-record lock; the release desk (Billing, Front Desk, Office
 * Manager) can record disclosures but not run the accounting. Every run is audited (READ, or EXPORT for CSV).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId')?.trim().slice(0, 191);
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const csv = url.searchParams.get('format') === 'csv';
  const now = new Date();
  const to = parseAuditDate(url.searchParams.get('to')?.trim() || undefined, true) ?? now;
  const from =
    parseAuditDate(url.searchParams.get('from')?.trim() || undefined) ??
    new Date(Date.UTC(now.getUTCFullYear() - DEFAULT_YEARS, now.getUTCMonth(), now.getUTCDate()));
  if (from > to) return NextResponse.json({ success: false, error: '"From" must be before "to"' }, { status: 400 });

  try {
    const access = await checkPart2ClientAccess({ ...gate, clientId, path: '/api/part2/disclosures/accounting' });
    if (access.ok === false) {
      if (access.denied) {
        await auditPhiAccess({
          gate,
          req,
          action: csv ? 'EXPORT' : 'READ',
          resourceType: 'part2DisclosureAccounting',
          patientId: clientId,
          outcome: 'DENIED',
        });
      }
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const rows = await prisma.part2Disclosure.findMany({
      where: { organizationId: gate.organizationId, clientId, disclosedAt: { gte: from, lte: to } },
      select: DISCLOSURE_SELECT,
      orderBy: [{ disclosedAt: 'asc' }, { createdAt: 'asc' }],
      take: 5000,
    });
    const names = await staffNameMap(gate.organizationId, [...rows.map((r) => r.disclosedById), gate.userId]);
    const disclosures = rows.map((r) => disclosureView(r, names));

    await auditPhiAccess({
      gate,
      req,
      action: csv ? 'EXPORT' : 'READ',
      resourceType: 'part2DisclosureAccounting',
      patientId: clientId,
      metadata: { format: csv ? 'csv' : 'json', rows: rows.length, from: from.toISOString(), to: to.toISOString() },
    });

    if (!csv) {
      return NextResponse.json({
        success: true,
        client: access.client,
        from: from.toISOString(),
        to: to.toISOString(),
        generatedAt: now.toISOString(),
        disclosures,
      });
    }

    let out = '﻿';
    out += csvRow(['Accounting of disclosures — 42 CFR Part 2 substance use disorder records']);
    out += csvRow(['Patient', access.client.name]);
    out += csvRow(['MRN', access.client.mrn ?? '']);
    out += csvRow(['Period', `${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`]);
    out += csvRow(['Generated', now.toISOString(), 'by', names.get(gate.userId) ?? gate.userId]);
    out += csvRow(['Disclosures', disclosures.length]);
    out += csvRow([]);
    out += csvRow(['Date disclosed', 'Disclosed to', 'Purpose', 'Information disclosed', 'Basis', 'Consent', 'Method', 'Recorded by', 'Recorded at']);
    for (const d of disclosures) {
      out += csvRow([
        d.disclosedAt,
        d.disclosedTo,
        d.purpose,
        d.informationDisclosed,
        disclosureBasisLabel(d.basis),
        d.consentFormId ? `Consent form ${d.consentFormId}` : d.consentReference ?? '',
        disclosureMethodLabel(d.method),
        d.disclosedByName ?? d.disclosedById,
        d.createdAt,
      ]);
    }
    return new Response(out, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="part2-accounting-${access.client.mrn || access.client.id}-${now.toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[part2 accounting GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not build accounting of disclosures' }, { status: 500 });
  }
}
