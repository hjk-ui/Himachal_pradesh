import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEditPayerMaster } from '@/lib/billing/payerMaster';
import { PayerMasterError, createPayer, listPayerMaster, listValantPayerOptions } from '@/lib/billing/payerMasterDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = '/dashboard/billing/payer-settings';

function fail(error: unknown, fallback: string) {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0];
    return NextResponse.json({ success: false, error: issue?.message || 'Invalid payer', field: issue?.path?.[0] ?? null }, { status: 400 });
  }
  if (error instanceof PayerMasterError) {
    return NextResponse.json({ success: false, error: error.message, existingId: error.existingId ?? null }, { status: error.status });
  }
  console.error('[billing/payers]', error instanceof Error ? error.message : 'unknown error');
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}

/**
 * GET /api/billing/payers — the payer master (PayerRegistry) with each payer's linked Waystar
 * claim rules and Valant insurance companies, plus the Valant list for "Start from Valant".
 * Payer reference data only (no PHI).
 */
export async function GET() {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  try {
    const [payers, valant] = await Promise.all([listPayerMaster(gate.organizationId), listValantPayerOptions(gate.organizationId)]);
    return NextResponse.json(
      { success: true, canEdit: canEditPayerMaster(gate.role), payers, valant },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return fail(error, 'Could not load payers (has the 20261027_payer_master migration run?)');
  }
}

const postSchema = z.object({ payer: z.unknown(), valantPayerId: z.string().trim().min(1).max(64).optional().nullable() });

/** POST /api/billing/payers — add a payer (billing + leadership). Audits the field names set. */
export async function POST(req: Request) {
  const gate = await requireClinicalContext(PAGE);
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canEditPayerMaster(gate.role)) {
    return NextResponse.json({ success: false, error: 'Only billing or practice leadership can add payers' }, { status: 403 });
  }
  try {
    const body = postSchema.parse(await req.json().catch(() => ({})));
    const result = await createPayer(gate.organizationId, gate.userId, body.payer, body.valantPayerId);
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'PayerRegistry', resourceId: result.row.id,
      metadata: {
        change: 'payer_created', fields: result.fields, fromValant: result.valantLinked,
        ...(result.valantLinked ? { valantPayerId: body.valantPayerId, sameAsValantEdi: result.sameAsValantEdi } : {}),
      },
    });
    return NextResponse.json({ success: true, id: result.row.id, payers: await listPayerMaster(gate.organizationId) });
  } catch (error) {
    return fail(error, 'Could not save the payer');
  }
}
