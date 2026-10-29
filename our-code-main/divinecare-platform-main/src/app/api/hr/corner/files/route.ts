import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canAccessHrCorner, getHrCorner } from '@/lib/hr/corner';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessHrCorner(gate.role) || !canAccessPath(gate.role, '/dashboard/hr')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const kind = new URL(req.url).searchParams.get('kind') || 'stub';
  const data = await getHrCorner(gate.organizationId);
  if ('schemaReady' in data && data.schemaReady === false) {
    return NextResponse.json({ success: false, error: data.error }, { status: 503 });
  }

  if (kind === 'w2') {
    const body = [
      'Form W-2 Wage and Tax Statement — 2025',
      'Employer: Divine Counseling LLC',
      `Employees: ${data.employees.length}`,
      'Copies B/C generated for employee self-service download.',
      '',
      ...data.employees.map((e) => `${e.name} | ${e.email} | ${e.jobTitle}`),
    ].join('\n');
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="w2-2025.txt"',
      },
    });
  }

  const last = data.payroll.find((p) => p.status === 'completed');
  const body = [
    'Pay stub export — Divine Counseling LLC',
    last ? `Period: ${last.period}` : 'No completed run',
    last ? `Gross ${last.gross} | Taxes ${last.taxes} | Benefits ${last.benefits} | Net ${last.net}` : '',
    '',
    ...data.employees.map((e) => `${e.name} — Direct deposit`),
  ].join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pay-stubs.txt"',
    },
  });
}
