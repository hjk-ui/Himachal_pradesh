import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { buildRcopiaSsoUrl } from '@/lib/services/drfirstRcopiaService';

export const runtime = 'nodejs';

const bodySchema = z.object({ screen: z.enum(['message', 'report']) });

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (gate.role !== 'ADMIN') return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Choose the message or report screen' }, { status: 400 });
  const user = await prisma.user.findFirst({
    where: { id: gate.userId, organizationId: gate.organizationId, role: 'ADMIN' },
    select: { email: true },
  });
  if (!user?.email) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { getAppBaseUrl } = await import('@/lib/staff/invite');
  const { drfirstLogoutUrl } = await import('@/lib/drfirst/returnAccess');
  const launchUrl = buildRcopiaSsoUrl({
    rcopiaUsername: user.email,
    startupScreen: parsed.data.screen,
    logoutUrl: drfirstLogoutUrl(getAppBaseUrl()),
  });
  if (!launchUrl) {
    return NextResponse.json({ success: false, error: 'The vendor is not configured for this admin username.' }, { status: 503 });
  }
  return NextResponse.json({ success: true, launchUrl });
}
