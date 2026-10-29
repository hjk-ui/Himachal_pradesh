import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const STAFF_CSV_HEADERS = [
  'firstName',
  'lastName',
  'email',
  'role',
  'npi',
  'dea',
  'phone',
  'clinic',
  'supervisorEmail',
  'license_number',
] as const;

const SAMPLE_ROWS = [
  [
    'Jane',
    'Therapist',
    'jane.therapist@example.com',
    'Therapist',
    '',
    '',
    '410-555-0101',
    'Main Clinic',
    'director@example.com',
    'LCPC-12345',
  ],
  [
    'Sam',
    'Psych',
    'sam.psych@example.com',
    'Psychiatrist',
    '1234567890',
    '',
    '410-555-0102',
    'Main Clinic',
    '',
    'MD-98765',
  ],
  [
    'Alex',
    'Case',
    'alex.case@example.com',
    'Case Manager',
    '',
    '',
    '',
    '',
    'supervisor@example.com',
    '',
  ],
];

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const lines = [
    STAFF_CSV_HEADERS.join(','),
    ...SAMPLE_ROWS.map((r) =>
      r.map((cell) => (cell.includes(',') ? `"${cell}"` : cell)).join(',')
    ),
  ];
  const csv = lines.join('\r\n') + '\r\n';

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="staff-import-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
