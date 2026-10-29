import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const REVIEW_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER']);
const FILE_ROLES = new Set([
  'FRONT_DESK',
  'PHYSICIAN',
  'MEDICAL_NP',
  'CLINICIAN',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

type IncidentRow = {
  id: string;
  title?: string;
  description?: string;
  reportedById?: string;
  reportedBy?: string;
  [key: string]: unknown;
};

function redact(row: IncidentRow, actorId: string, review: boolean): IncidentRow {
  if (review || row.reportedById === actorId) return row;
  return { ...row, description: '', investigationNotes: '', rootCause: '', immediateAction: '' };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/incidents')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const review = REVIEW_ROLES.has(gate.role);
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'incident:' } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  });
  const own = rows
    .map((row) => row.data as IncidentRow)
    .filter((row) => review || row.reportedById === gate.userId)
    .map((row) => redact(row, gate.userId, review));
  return NextResponse.json({ success: true, review, incidents: own });
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!FILE_ROLES.has(gate.role) || !canAccessPath(gate.role, '/dashboard/incidents')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.title || !body?.description) {
    return NextResponse.json({ success: false, error: 'Title and narrative are required' }, { status: 400 });
  }
  const actor = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true } });
  const id = randomUUID();
  const incident = {
    ...body,
    id,
    reportedById: gate.userId,
    reportedBy: actor?.name || gate.role,
    status: body.status || 'reported',
  };
  await prisma.clinicModuleState.create({
    data: { organizationId: gate.organizationId, module: `incident:${id}`, data: incident },
  });
  return NextResponse.json({ success: true, incident });
}
