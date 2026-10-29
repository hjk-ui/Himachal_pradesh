import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { sha256 } from '@/lib/documents/clientZip';

export const runtime = 'nodejs';

const bodySchema = z.object({
  path: z.string().min(1).max(500),
  clientId: z.string().min(1),
  /** Optional content digest from prior dry-run; generates placeholder if absent */
  contentSha: z.string().optional().nullable(),
});

/**
 * Rematch an unmatched Valant ZIP path to a client chart (never guess — staff picks).
 */
export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/doc-intake')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid rematch' }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, organizationId: gate.organizationId },
    select: { id: true, name: true },
  });
  if (!client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  const digest =
    parsed.data.contentSha?.trim() ||
    sha256(Buffer.from(`${gate.organizationId}:${parsed.data.path}:${client.id}`));
  const module = `chart-doc:${client.id}:${digest}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId: gate.organizationId, module } },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ success: true, skipped: true, module });
  }

  await prisma.clinicModuleState.create({
    data: {
      organizationId: gate.organizationId,
      module,
      data: {
        path: parsed.data.path,
        name: parsed.data.path.split('/').pop(),
        clientId: client.id,
        rematched: true,
        rematchedAt: new Date().toISOString(),
        rematchedById: gate.userId,
        sha256: digest,
      },
    },
  });

  return NextResponse.json({
    success: true,
    filed: true,
    clientId: client.id,
    clientName: client.name,
    module,
  });
}
