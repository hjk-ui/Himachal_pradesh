import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  BILL_TO_IDS,
  COLLECTION_SITE_IDS,
  LAB_ORDER_STATUSES,
  LAB_VENDORS,
  createOrder,
  listOrders,
} from '@/lib/labs/manage';
import { labPermissions } from '@/lib/labs/access';
import { listStandingOrders } from '@/lib/labs/standingDb';
import { labError, labGate } from '@/lib/labs/routeGate';

export const runtime = 'nodejs';

const icd = z.string().trim().min(3).max(10);

const createSchema = z
  .object({
    clientId: z.string().trim().min(1).max(128),
    lab: z.enum(LAB_VENDORS).optional(),
    priority: z.enum(['Routine', 'STAT', 'ASAP']).optional(),
    specimen: z.string().trim().max(120).optional().nullable(),
    icd10Codes: z.array(icd).max(40).optional(),
    panels: z.array(z.string().trim().max(200)).max(40).optional(),
    otherPanel: z.string().trim().max(200).optional().nullable(),
    clinicalNotes: z.string().trim().max(4000).optional().nullable(),
    tests: z
      .array(z.object({ key: z.string().trim().max(80).optional().nullable(), name: z.string().trim().min(1).max(200), icd10Codes: z.array(icd).max(12) }))
      .max(40)
      .optional(),
    diagnoses: z.array(z.object({ code: icd, description: z.string().trim().max(300).optional().nullable() })).max(40).optional(),
    fastingRequired: z.boolean().optional(),
    collectionSite: z.enum(COLLECTION_SITE_IDS).optional().nullable(),
    billTo: z.enum(BILL_TO_IDS).optional().nullable(),
    abnRequired: z.boolean().optional(),
    abnNote: z.string().trim().max(1000).optional().nullable(),
    standingOrderId: z.string().trim().max(128).optional().nullable(),
  })
  .refine((v) => (v.tests?.length ?? 0) > 0 || (v.panels?.length ?? 0) > 0 || Boolean(v.otherPanel?.trim()), {
    message: 'Select at least one test',
    path: ['tests'],
  })
  // Medical necessity: every order carries ICD-10 codes (per test on the order form)
  .refine((v) => (v.tests?.length ? v.tests.every((t) => t.icd10Codes.length > 0) : (v.icd10Codes?.length ?? 0) > 0), {
    message: 'Each test needs at least one ICD-10 diagnosis (medical necessity)',
    path: ['tests'],
  })
  .refine((v) => !v.abnRequired || Boolean(v.abnNote?.trim()), { message: 'Add a note for the ABN (why the test may not be covered)', path: ['abnNote'] });

/** GET /api/labs/orders?status=&q=&clientId=&program=medical — worklist rows + standing orders */
export async function GET(req: Request) {
  const g = await labGate(req, 'view');
  if (g.denied) return g.denied;
  const { gate, actor } = g;
  try {
    const url = new URL(req.url);
    const statusRaw = url.searchParams.get('status')?.trim();
    const status =
      statusRaw && (LAB_ORDER_STATUSES as readonly string[]).includes(statusRaw)
        ? (statusRaw as (typeof LAB_ORDER_STATUSES)[number])
        : undefined;
    const q = url.searchParams.get('q')?.trim() || undefined;
    const clientId = url.searchParams.get('clientId')?.trim() || undefined;
    const program = url.searchParams.get('program') === 'medical' ? ('medical' as const) : undefined;

    const [orders, standing] = await Promise.all([
      listOrders(actor, { status, q, clientId, program }),
      listStandingOrders(actor, { clientId }),
    ]);
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'labOrder', patientId: clientId ?? null,
      metadata: { count: orders.length, standingCount: standing.length, status: status ?? null, searched: Boolean(q), program: program ?? null },
    });
    return NextResponse.json(
      { success: true, orders, standingOrders: standing, permissions: labPermissions(gate.role) },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    return labError(err, 'labs/orders GET', 'Failed to load lab orders');
  }
}

/** POST /api/labs/orders — place (sign) a lab order. Prescribers only, under their own NPI. */
export async function POST(req: Request) {
  const g = await labGate(req, 'order');
  if (g.denied) return g.denied;
  const { gate, actor } = g;
  try {
    const body = createSchema.parse(await req.json());
    const result = await createOrder(actor, body);
    if (result.ok === false) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'labOrder', patientId: body.clientId,
        outcome: 'DENIED', metadata: { reason: result.error.slice(0, 120), status: result.status },
      });
      return NextResponse.json({ success: false, error: result.error }, { status: result.status });
    }
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'labOrder', resourceId: result.order.id, patientId: result.order.clientId,
      metadata: {
        lab: result.order.lab,
        priority: result.order.priority,
        testCount: result.order.testLines.length || result.order.panels.length,
        testKeys: result.order.testLines.map((l) => l.key).filter(Boolean),
        abn: result.order.abnRequired,
        standingOrderId: result.order.standingOrderId,
      },
    });
    return NextResponse.json({ success: true, order: result.order }, { status: 201 });
  } catch (err) {
    return labError(err, 'labs/orders POST', 'Could not create lab order');
  }
}
