import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath, canAccessPayerBilling } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { inclusiveDays, isMissingSchema, parseDay } from '@/lib/billing/patientReference';

export const runtime = 'nodejs';

const PATH = '/dashboard/programs/intensive/billing';
const PROGRAMS: Record<string, { name: string; code: string; minutes: number }> = {
  'mh-iop': { name: 'Mental-health IOP', code: 'H0015', minutes: 180 },
  'sud-iop': { name: 'SUD IOP', code: 'H0015', minutes: 180 },
  php: { name: 'PHP', code: 'H0035', minutes: 300 },
};

function denied(role: string) {
  return !canAccessPayerBilling(role) || !canAccessPath(role, PATH);
}

function dayName(date: Date) {
  return date.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (denied(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const url = new URL(req.url);
  const from = parseDay(url.searchParams.get('from'));
  const to = parseDay(url.searchParams.get('to'));
  if (!from || !to || to < from) {
    return NextResponse.json({ success: false, error: 'from and to are required as YYYY-MM-DD' }, { status: 400 });
  }
  const programId = (url.searchParams.get('programId') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  try {
    const rows = await prisma.intensiveChargeDraft.findMany({
      where: {
        organizationId: gate.organizationId,
        serviceDate: { gte: from, lte: to },
        ...(programId ? { programId } : {}),
        ...(status ? { status } : {}),
      },
      include: { client: { select: { name: true, mrn: true, sensitiveRecord: { select: { id: true } } } } },
      orderBy: { serviceDate: 'asc' },
    });
    const charges = rows.map((row) => {
      const locked = Boolean(row.client.sensitiveRecord);
      return {
        id: row.id,
        programId: row.programId,
        programName: PROGRAMS[row.programId]?.name || row.programId,
        clientId: locked ? null : row.clientId,
        clientName: locked ? 'Protected record' : row.client.name,
        mrn: locked ? null : row.client.mrn,
        serviceDate: row.serviceDate.toISOString().slice(0, 10),
        code: row.code,
        units: row.units,
        minutes: row.minutes,
        status: row.status,
        holdReasons: row.holdReasons,
        part2: row.part2,
      };
    });
    const programs = [...new Set(charges.map((row) => row.programId))].map((id) => ({
      id,
      name: PROGRAMS[id]?.name || id,
    }));
    return NextResponse.json({ success: true, charges, programs, canGenerate: true });
  } catch (err) {
    if (!isMissingSchema(err)) {
      console.error('[intensive charges GET]', err);
      return NextResponse.json({ success: false, error: 'Could not load intensive charges' }, { status: 500 });
    }
    return NextResponse.json({ success: true, charges: [], programs: [], canGenerate: true });
  }
}

const postSchema = z.object({
  programId: z.string().min(1),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (denied(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid charge request' }, { status: 400 });
  const from = parseDay(parsed.data.from);
  const to = parseDay(parsed.data.to);
  const today = parseDay(new Date().toISOString().slice(0, 10));
  if (!from || !to || !today || to < from || inclusiveDays(from, to) > 31 || to > today) {
    return NextResponse.json({ success: false, error: 'Date range must be at most 31 days and not in the future' }, { status: 400 });
  }
  const program = PROGRAMS[parsed.data.programId];
  if (!program) return NextResponse.json({ success: false, error: 'Unknown program' }, { status: 400 });
  const enrollments = await prisma.clinicModuleState.findMany({
    where: { organizationId: gate.organizationId, module: { startsWith: 'intensive:' } },
  });
  let created = 0;
  for (const row of enrollments) {
    const enrollment = row.data as { id?: string; clientId?: string; track?: string; days?: string[]; status?: string; part2?: boolean };
    if (!enrollment.id || !enrollment.clientId || enrollment.track !== parsed.data.programId || enrollment.status === 'waitlist') continue;
    for (let cursor = from.getTime(); cursor <= to.getTime(); cursor += 86_400_000) {
      const serviceDate = new Date(cursor);
      if (!(enrollment.days || []).includes(dayName(serviceDate))) continue;
      const sourceKey = `attendance:${enrollment.id}:${serviceDate.toISOString().slice(0, 10)}`;
      const existing = await prisma.intensiveChargeDraft.findFirst({
        where: { enrollmentId: enrollment.id, serviceDate, code: program.code, sourceKey },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.intensiveChargeDraft.create({
        data: {
          organizationId: gate.organizationId,
          programId: parsed.data.programId,
          enrollmentId: enrollment.id,
          clientId: enrollment.clientId,
          serviceDate,
          code: program.code,
          units: 1,
          minutes: program.minutes,
          sourceKey,
          status: 'draft',
          part2: Boolean(enrollment.part2),
          createdById: gate.userId,
        },
      });
      created += 1;
    }
  }
  return NextResponse.json({ success: true, created });
}

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(['void', 'restore']),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (denied(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid charge update' }, { status: 400 });
  const row = await prisma.intensiveChargeDraft.findFirst({
    where: { id: parsed.data.id, organizationId: gate.organizationId },
  });
  if (!row) return NextResponse.json({ success: false, error: 'Charge draft not found' }, { status: 404 });
  const status = parsed.data.action === 'void' ? 'void' : 'draft';
  const updated = await prisma.intensiveChargeDraft.update({
    where: { id: row.id },
    data: { status },
  });
  return NextResponse.json({ success: true, id: updated.id, status: updated.status });
}
