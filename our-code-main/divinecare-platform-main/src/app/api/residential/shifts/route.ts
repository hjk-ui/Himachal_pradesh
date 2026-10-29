import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { searchParams } = new URL(req.url);
    const residentId = searchParams.get('residentId');
    const shift = searchParams.get('shift');

    const notes = await prisma.residentialShiftNote.findMany({
      where: {
        ...(residentId ? { residentId } : {}),
        ...(shift ? { shift } : {}),
      },
      include: {
        resident: { select: { name: true, room: true, program: true } },
      },
      orderBy: { shiftDate: 'desc' },
      take: 50,
    });

    return NextResponse.json({ success: true, notes });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not fetch shift notes' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    const created = await prisma.residentialShiftNote.create({
      data: {
        residentId: body.residentId,
        shift: body.shift || 'Day',
        author: body.author || 'Staff Milieu Specialist',
        shiftDate: body.shiftDate ? new Date(body.shiftDate) : new Date(),
        milieu: body.milieu || 'Active & Cooperative',
        adherence: body.adherence || '100% Compliant',
        sleep: body.sleep || 'Uninterrupted (7.5 hrs)',
        notes: body.notes || 'Patient participated actively in morning mindfulness and group therapy.',
      },
    });

    return NextResponse.json({ success: true, note: created }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not save shift note' },
      { status: 500 }
    );
  }
}
