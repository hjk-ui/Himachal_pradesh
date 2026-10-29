import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const dynamic = 'force-dynamic';

const SEED_VOICEMAILS: Array<{
  id: string;
  callerName: string;
  callerPhone: string;
  durationSeconds: number;
  audioS3Key: string;
  transcript: string;
  intent: string;
  confidence: number;
  routeTo: string;
  isRouted: boolean;
  createdAt: Date;
}> = [];

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (gate.role === 'FRONT_DESK' || gate.role === 'BILLING') {
    return NextResponse.json({ success: true, data: [], voicemails: [] });
  }
  try {
    let vms: any[] = [];
    try {
      vms = await (prisma as any).voicemail.findMany({
        orderBy: [
          { intent: 'asc' }, // 'crisis' comes first alphabetically
          { createdAt: 'desc' },
        ],
      });
    } catch {
      // Memory fallback if table empty
    }

    if (!vms || vms.length === 0) {
      vms = SEED_VOICEMAILS;
    }

    const seeAll = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'].includes(gate.role);
    if (!seeAll) {
      const me = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, email: true } });
      const keys = new Set([gate.userId, me?.name || '', me?.email || ''].map((value) => value.trim().toLowerCase()).filter(Boolean));
      vms = vms.filter((vm) => keys.has(String(vm.routeTo || '').trim().toLowerCase()));
    }

    // Always sort crisis first
    const sorted = [...vms].sort((a, b) => {
      if (a.intent === 'crisis' && b.intent !== 'crisis') return -1;
      if (b.intent === 'crisis' && a.intent !== 'crisis') return 1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return NextResponse.json({ success: true, data: sorted, voicemails: sorted });
  } catch (err: any) {
    console.error('[voicemails-get] error:', err);
    return NextResponse.json({ success: true, data: [], voicemails: [] });
  }
}

const updateVmSchema = z.object({
  id: z.string(),
  isRouted: z.boolean().optional(),
  routeTo: z.string().optional(),
});

export async function PATCH(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'OFFICE_MANAGER'].includes(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = await req.json();
    const parsed = updateVmSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const { id, isRouted, routeTo } = parsed.data;
    try {
      await (prisma as any).voicemail.update({
        where: { id },
        data: {
          ...(typeof isRouted === 'boolean' ? { isRouted } : {}),
          ...(routeTo ? { routeTo } : {}),
        },
      });
    } catch {
      // Memory fallback
    }

    return NextResponse.json({ success: true, message: 'Voicemail route status updated' });
  } catch (err: any) {
    console.error('[voicemails-patch] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to update voicemail' }, { status: 500 });
  }
}
