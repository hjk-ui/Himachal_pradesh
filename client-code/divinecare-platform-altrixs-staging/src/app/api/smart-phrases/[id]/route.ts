import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { smartPhraseInputSchema } from '@/lib/ehr/smartPhrases';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** Org-wide phrases (ownerId null) may only be changed by these roles. */
const SHARED_PHRASE_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR'];

const paramsSchema = z.object({
  id: z.string().min(1).max(128),
});

const patchSchema = smartPhraseInputSchema.partial();

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/** Loads the phrase in the caller's org and checks the caller may change it. */
async function loadEditable(gate: Gate, id: string) {
  const row = await prisma.smartPhrase.findFirst({
    where: { id, organizationId: gate.organizationId },
  });
  if (!row) return { ok: false as const, status: 404, error: 'Phrase not found' };
  const allowed =
    row.ownerId === null ? SHARED_PHRASE_ROLES.includes(gate.role) : row.ownerId === gate.userId;
  // Someone else's personal phrase is reported as not found rather than forbidden.
  if (!allowed) {
    return row.ownerId === null
      ? { ok: false as const, status: 403, error: 'Only an administrator or practice director can change shared phrases' }
      : { ok: false as const, status: 404, error: 'Phrase not found' };
  }
  return { ok: true as const, row };
}

async function gateRequest(ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/smart-phrases')) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  const params = paramsSchema.safeParse(await ctx.params);
  if (!params.success) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 }) };
  }
  return { ok: true as const, gate, id: params.data.id };
}

/** PATCH /api/smart-phrases/[id] — owner edits a personal phrase; admin/director edits a shared one. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateRequest(ctx);
  if (!g.ok) return g.response;
  const { gate, id } = g;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid phrase' },
      { status: 400 }
    );
  }

  const found = await loadEditable(gate, id);
  if (!found.ok) {
    return NextResponse.json({ success: false, error: found.error }, { status: found.status });
  }
  const { row } = found;
  const data = parsed.data;

  if (data.key && data.key !== row.key) {
    const duplicate = await prisma.smartPhrase.findFirst({
      where: { organizationId: gate.organizationId, ownerId: row.ownerId, key: data.key, NOT: { id: row.id } },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { success: false, error: `A phrase with key ${data.key} already exists` },
        { status: 409 }
      );
    }
  }

  const updated = await prisma.smartPhrase.update({
    where: { id: row.id },
    data: {
      ...(data.key !== undefined ? { key: data.key } : {}),
      ...(data.label !== undefined ? { label: data.label } : {}),
      ...(data.text !== undefined ? { text: data.text } : {}),
      ...(data.category !== undefined ? { category: data.category || null } : {}),
    },
  });

  await auditPhiAccess({
    gate,
    req,
    action: 'WRITE',
    resourceType: 'smartPhrase',
    resourceId: row.id,
    metadata: { shared: row.ownerId === null },
  });

  return NextResponse.json({
    success: true,
    phrase: {
      id: updated.id,
      key: updated.key,
      label: updated.label,
      text: updated.text,
      category: updated.category,
      mine: updated.ownerId === gate.userId,
      shared: updated.ownerId === null,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

/** DELETE /api/smart-phrases/[id] */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await gateRequest(ctx);
  if (!g.ok) return g.response;
  const { gate, id } = g;

  const found = await loadEditable(gate, id);
  if (!found.ok) {
    return NextResponse.json({ success: false, error: found.error }, { status: found.status });
  }

  await prisma.smartPhrase.delete({ where: { id: found.row.id } });

  await auditPhiAccess({
    gate,
    req,
    action: 'DELETE',
    resourceType: 'smartPhrase',
    resourceId: found.row.id,
    metadata: { shared: found.row.ownerId === null },
  });

  return NextResponse.json({ success: true });
}
