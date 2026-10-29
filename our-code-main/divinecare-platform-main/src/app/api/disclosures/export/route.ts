import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { exportDisclosureAccounting } from '@/lib/privacy/disclosures';

export const runtime = 'nodejs';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const result = await exportDisclosureAccounting({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
  });
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  const header = 'disclosedAt,client,recipient,purpose,recordedRole';
  const lines = result.disclosures.map((row) =>
    [row.disclosedAt, row.clientName, row.recipient, row.purpose, row.recordedRole]
      .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`)
      .join(',')
  );
  return new NextResponse([header, ...lines].join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="disclosure-accounting.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
