import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { LAB_VENDORS } from '@/lib/labs/manage';
import { STANDING_INTERVAL_UNITS } from '@/lib/labs/standing';
import { createStandingOrder, listStandingOrders } from '@/lib/labs/standingDb';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const icd = z.string().trim().min(3).max(10);
const createSchema = z.object({
  clientId: z.string().trim().min(1).max(128),
  tests: z
    .array(z.object({ key: z.string().trim().max(80).nullable().optional(), name: z.string().trim().min(1).max(200), icd10Codes: z.array(icd).min(1, 'Each standing test needs an ICD-10 diagnosis').max(12) }))
    .min(1)
    .max(20),
  intervalUnit: z.enum(STANDING_INTERVAL_UNITS),
  intervalCount: z.number().int().min(1).max(60),
  startDate: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
  firstDueAt: z.string().trim().max(40).optional().nullable(),
  orderSetKey: z.string().trim().max(60).optional().nullable(),
  lab: z.enum(LAB_VENDORS).optional(),
  note: z.string().trim().max(1000).optional().nullable(),
});

/** GET /api/labs/standing-orders?clientId= */
export async function GET(req: Request) {
  const g = await labGate(req, 'view', 'labStandingOrder');
  if (g.denied) return g.denied;
  try {
    const clientId = new URL(req.url).searchParams.get('clientId')?.trim() || undefined;
    const standing = await listStandingOrders(g.actor, { clientId, activeOnly: true });
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'labStandingOrder', patientId: clientId ?? null, metadata: { count: standing.length } });
    return NextResponse.json({ success: true, standingOrders: standing }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return labError(err, 'labs/standing-orders GET', 'Could not load standing orders');
  }
}

/** POST /api/labs/standing-orders — prescribers only (a standing order is a recurring order intent) */
export async function POST(req: Request) {
  const g = await labGate(req, 'order', 'labStandingOrder');
  if (g.denied) return g.denied;
  try {
    const body = createSchema.parse(await req.json());
    const me = await prisma.user.findUnique({ where: { id: g.gate.userId }, select: { name: true, email: true } });
    const result = await createStandingOrder(
      g.actor,
      { ...body, tests: body.tests.map((t) => ({ key: t.key ?? null, name: t.name, icd10Codes: t.icd10Codes.map((c) => c.toUpperCase()) })) },
      me?.name?.trim() || me?.email || null
    );
    if (result.ok === false) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    await auditPhiAccess({
      gate: g.gate, req, action: 'CREATE', resourceType: 'labStandingOrder', resourceId: result.standing.id, patientId: result.standing.clientId,
      metadata: { interval: `${body.intervalCount} ${body.intervalUnit}`, testKeys: body.tests.map((t) => t.key).filter(Boolean), orderSetKey: body.orderSetKey ?? null },
    });
    return NextResponse.json({ success: true, standing: result.standing }, { status: 201 });
  } catch (err) {
    return labError(err, 'labs/standing-orders POST', 'Could not create the standing order');
  }
}
