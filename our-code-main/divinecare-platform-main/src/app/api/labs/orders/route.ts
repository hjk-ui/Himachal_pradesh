import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  LAB_ORDER_STATUSES,
  LAB_VENDORS,
  LABS_PATH,
  canAccessLabs,
  createOrder,
  listOrders,
} from '@/lib/labs/manage';

export const runtime = 'nodejs';

const createSchema = z
  .object({
    clientId: z.string().trim().min(1).max(128),
    lab: z.enum(LAB_VENDORS).optional(),
    priority: z.string().trim().min(1).max(40).optional(),
    specimen: z.string().trim().max(120).optional().nullable(),
    icd10Codes: z.array(z.string().trim().max(32)).max(40).optional(),
    panels: z.array(z.string().trim().max(200)).max(40).optional(),
    otherPanel: z.string().trim().max(200).optional().nullable(),
    clinicalNotes: z.string().trim().max(4000).optional().nullable(),
  })
  .refine(
    (v) => (v.panels?.length ?? 0) > 0 || Boolean(v.otherPanel?.trim()),
    { message: 'Select at least one panel or enter a custom panel', path: ['panels'] }
  );

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status')?.trim();
    const status =
      statusRaw && (LAB_ORDER_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as (typeof LAB_ORDER_STATUSES)[number])
        : undefined;
    const q = url.searchParams.get('q')?.trim() || undefined;

    const orders = await listOrders(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      { status, q }
    );
    return NextResponse.json(
      { success: true, orders },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[labs/orders GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load lab orders' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessLabs(gate.role) || !canAccessPath(gate.role, LABS_PATH)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = createSchema.parse(await req.json());
    const result = await createOrder(
      {
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
      },
      body
    );
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    return NextResponse.json({ success: true, order: result.order }, { status: 201 });
  } catch (err: unknown) {
    const message =
      err instanceof z.ZodError
        ? err.issues[0]?.message || 'Please check the lab order form and try again.'
        : err instanceof Error
          ? err.message
          : 'Could not create lab order';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
