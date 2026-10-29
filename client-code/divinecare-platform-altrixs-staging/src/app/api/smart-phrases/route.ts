import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { prisma } from '@/lib/db/prisma';
import { smartPhraseInputSchema } from '@/lib/ehr/smartPhrases';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

/** Org-wide phrases (ownerId null) may only be created or changed by these roles. */
const SHARED_PHRASE_ROLES = ['ADMIN', 'PRACTICE_DIRECTOR', 'DIRECTOR'];
const MAX_PHRASES_PER_OWNER = 300;

const createSchema = smartPhraseInputSchema.extend({
  shared: z.boolean().optional(),
});

type PhraseRow = {
  id: string;
  ownerId: string | null;
  key: string;
  label: string;
  category: string | null;
  text: string;
  updatedAt: Date;
};

function serialize(row: PhraseRow, userId: string) {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    text: row.text,
    category: row.category,
    mine: row.ownerId === userId,
    shared: row.ownerId === null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** GET /api/smart-phrases — the caller's own phrases first, then the organization's shared ones. */
export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Reading phrases (documentation templates, no client data) is open to every note-writing role
  // that uses the SmartPhraseTextarea, incl. Session AI (crisis responders). Managing them stays
  // on the Smart Phrases page roles (POST / PATCH / DELETE).
  if (
    !canAccessPath(gate.role, '/dashboard/ehr/smart-phrases') &&
    !canAccessPath(gate.role, '/dashboard/ehr/session-ai')
  ) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const rows = await prisma.smartPhrase.findMany({
    where: {
      organizationId: gate.organizationId,
      OR: [{ ownerId: gate.userId }, { ownerId: null }],
    },
    orderBy: [{ key: 'asc' }],
    take: 1000,
  });
  // Personal phrases win over a shared phrase with the same key (expansion takes the first match).
  const mine = rows.filter((r) => r.ownerId === gate.userId);
  const shared = rows.filter((r) => r.ownerId === null);

  return NextResponse.json({
    success: true,
    phrases: [...mine, ...shared].map((r) => serialize(r, gate.userId)),
    canManageShared: SHARED_PHRASE_ROLES.includes(gate.role),
  });
}

/** POST /api/smart-phrases — create a personal phrase, or an org-wide one (`shared: true`, admin/director). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/smart-phrases')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: parsed.error.issues[0]?.message || 'Invalid phrase' },
      { status: 400 }
    );
  }
  const { shared, ...fields } = parsed.data;
  if (shared && !SHARED_PHRASE_ROLES.includes(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only an administrator or practice director can create shared phrases' },
      { status: 403 }
    );
  }
  const ownerId = shared ? null : gate.userId;

  const [duplicate, count] = await Promise.all([
    prisma.smartPhrase.findFirst({
      where: { organizationId: gate.organizationId, ownerId, key: fields.key },
      select: { id: true },
    }),
    prisma.smartPhrase.count({ where: { organizationId: gate.organizationId, ownerId } }),
  ]);
  if (duplicate) {
    return NextResponse.json(
      { success: false, error: `A ${shared ? 'shared' : 'personal'} phrase with key ${fields.key} already exists` },
      { status: 409 }
    );
  }
  if (count >= MAX_PHRASES_PER_OWNER) {
    return NextResponse.json(
      { success: false, error: `Limit of ${MAX_PHRASES_PER_OWNER} phrases reached` },
      { status: 400 }
    );
  }

  const row = await prisma.smartPhrase.create({
    data: {
      organizationId: gate.organizationId,
      ownerId,
      key: fields.key,
      label: fields.label,
      text: fields.text,
      category: fields.category || null,
    },
  });

  await auditPhiAccess({
    gate,
    req,
    action: 'CREATE',
    resourceType: 'smartPhrase',
    resourceId: row.id,
    metadata: { shared: ownerId === null },
  });

  return NextResponse.json({ success: true, phrase: serialize(row, gate.userId) }, { status: 201 });
}
