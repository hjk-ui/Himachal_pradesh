import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db';
import {
  getOrCreateSchedulingSettings,
  saveSchedulingSettings,
} from '@/lib/scheduling/manage';
import { schedulingSettingsPutSchema } from '@/lib/scheduling/types';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const PATH = '/dashboard/admin/scheduling-settings';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const [settings, org] = await Promise.all([
    getOrCreateSchedulingSettings(gate.organizationId),
    prisma.organization.findUnique({
      where: { id: gate.organizationId },
      select: { slug: true, name: true },
    }),
  ]);

  const slug = org?.slug || '';
  const bookingUrl = slug ? `/schedule?org=${encodeURIComponent(slug)}` : '/schedule';

  return NextResponse.json({
    success: true,
    settings,
    slug,
    organizationName: org?.name || null,
    bookingUrl,
  });
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = schedulingSettingsPutSchema.parse(await req.json());
    const settings = await saveSchedulingSettings(gate.organizationId, {
      ...body,
      hours: body.hours as Record<string, { enabled: boolean; start: string; end: string }> | undefined,
    });
    await writeAuditLog({
      action: 'scheduling_settings_updated',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'SchedulingSettings',
      metadata: { changedSections: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined).sort() },
    });
    return NextResponse.json({ success: true, settings });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? 'Please check the scheduling settings and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not save scheduling settings';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
