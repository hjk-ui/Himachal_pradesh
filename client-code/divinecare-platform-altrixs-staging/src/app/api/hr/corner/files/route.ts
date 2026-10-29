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
    // Roster only — Altrixs does not generate W-2 forms; never claim it does.
    const body = [
      'Employee roster for W-2 preparation',
      'This is not a W-2 form. File W-2s through your payroll provider.',
      `Employees: ${data.employees.length}`,
      '',
      ...data.employees.map((e) => `${e.name} | ${e.email} | ${e.jobTitle}`),
    ].join('\n');
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': 'attachment; filename="w2-prep-roster.txt"',
      },
    });
  }

  const last = data.payroll.find((p) => p.status === 'completed');
  const body = [
    'Pay run summary (not individual pay stubs)',
    last ? `Period: ${last.period}` : 'No completed run',
    last ? `Gross ${last.gross} | Taxes ${last.taxes} | Benefits ${last.benefits} | Net ${last.net}` : '',
    '',
    ...data.employees.map((e) => e.name),
  ].join('\n');
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename="pay-run-summary.txt"',
    },
  });
}
