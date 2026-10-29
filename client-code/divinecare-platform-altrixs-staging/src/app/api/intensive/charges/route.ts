import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { chargeGenerateSchema, chargePatchSchema, day, errorResponse, fail, intensiveGate, ok } from '@/lib/intensive/http';
import { canGenerateCharges } from '@/lib/intensive/access';
import { chargePrograms, generateCharges, listCharges, voidCharge } from '@/lib/intensive/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Intensive program charge DRAFTS. Drafts are never submitted from here: billing reviews them and
 * builds claims with the existing claim tools. Held drafts list why (no auth, minimum minutes not
 * set, policy unconfirmed, ...). No fee is stored or shown.
 */

/** GET /api/intensive/charges?from=&to=&programId=&status= */
export async function GET(req: Request) {
  const g = await intensiveGate({ billing: true });
  if (!g.ok) return g.res;
  try {
    const url = new URL(req.url);
    const from = url.searchParams.get('from') ?? '';
    const to = url.searchParams.get('to') ?? '';
    if (!day.safeParse(from).success || !day.safeParse(to).success) return fail('from and to (YYYY-MM-DD) are required', 400);
    const rows = await listCharges(g.actor, { from, to, programId: url.searchParams.get('programId'), status: url.searchParams.get('status') });
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: 'intensiveChargeDraft',
      metadata: { count: rows.length, from, to, patientIds: rows.map((r) => r.clientId).filter(Boolean).slice(0, 50) },
    });
    return ok({ charges: rows, programs: await chargePrograms(g.actor), canGenerate: canGenerateCharges(g.actor.role) });
  } catch (e) {
    return errorResponse(e, 'Could not load charge drafts');
  }
}

/** POST /api/intensive/charges { programId, from, to }: (re)generate drafts from attendance. */
export async function POST(req: Request) {
  const g = await intensiveGate({ billing: true, write: true });
  if (!g.ok) return g.res;
  if (!canGenerateCharges(g.actor.role)) return fail('Only billing or leadership generate charge drafts', 403);
  try {
    const body = chargeGenerateSchema.parse(await req.json());
    const r = await generateCharges(g.actor, body.programId, body.from, body.to);
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: 'intensiveChargeDraft', metadata: { programId: body.programId, from: body.from, to: body.to, created: r.created, updated: r.updated, held: r.held } });
    return ok({ result: r });
  } catch (e) {
    return errorResponse(e, 'Could not generate charge drafts');
  }
}

/** PATCH /api/intensive/charges { id, action: void | restore } */
export async function PATCH(req: Request) {
  const g = await intensiveGate({ billing: true, write: true });
  if (!g.ok) return g.res;
  try {
    const body = chargePatchSchema.parse(await req.json());
    const r = await voidCharge(g.actor, body.id, body.action === 'restore');
    await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'intensiveChargeDraft', resourceId: r.id, patientId: r.clientId, metadata: { action: body.action } });
    return ok({ id: r.id, status: r.status });
  } catch (e) {
    return errorResponse(e, 'Could not update the charge draft');
  }
}
