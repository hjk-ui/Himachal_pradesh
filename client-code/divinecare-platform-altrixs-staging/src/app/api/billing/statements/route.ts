import type { Role } from '@prisma/client';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessStatements,
  generateStatements,
  listStatements,
} from '@/lib/billing/statements';

export const runtime = 'nodejs';

function actorFrom(gate: { organizationId: string; userId: string; role: Role }) {
  return { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
}

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessStatements(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/statements')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const data = await listStatements(actorFrom(gate));
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[billing statements GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load statements' }, { status: 500 });
  }
}

const generateSchema = z.object({
  periodLabel: z.string().trim().min(1).max(120),
  includeClientIds: z.array(z.string().min(1).max(128)).max(500).nullable().optional(),
  delivery: z.enum(['email', 'sms', 'both', 'portal']).default('email'),
  minBalanceCents: z.number().int().min(0).max(10_000_000).default(0),
  paymentLink: z
    .union([z.string().url().max(500), z.literal(''), z.null()])
    .optional(),
  skipPaymentPlans: z.boolean().default(true),
  sendNow: z.boolean().default(true),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessStatements(gate.role) || !canAccessPath(gate.role, '/dashboard/billing/statements')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const raw = await req.json();
    const body = generateSchema.parse(raw);
    const result = await generateStatements(actorFrom(gate), {
      periodLabel: body.periodLabel,
      includeClientIds: body.includeClientIds ?? null,
      delivery: body.delivery,
      minBalanceCents: body.minBalanceCents,
      paymentLink: body.paymentLink || null,
      skipPaymentPlans: body.skipPaymentPlans,
      sendNow: body.sendNow,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof z.ZodError ? 'Invalid statement generate request' : (err as Error).message;
    console.error('[billing statements POST]', err);
    return NextResponse.json({ success: false, error: message || 'Could not generate statements' }, { status: 400 });
  }
}
