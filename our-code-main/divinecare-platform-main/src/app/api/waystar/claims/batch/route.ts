import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { submitClaimBatch, type ClaimForBatch } from '@/lib/services/waystarSftpService';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPayerBilling } from '@/lib/auth/roleAccess';

export const dynamic = 'force-dynamic';

const lineSchema = z.object({
  cpt: z.string().min(4).max(6),
  modifiers: z.array(z.string().length(2)).max(4).optional(),
  units: z.number().int().positive(),
  chargeAmount: z.number().positive(),
  serviceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  posCode: z.string().min(2).max(2),
  diagnosisPointers: z.array(z.number().int().positive()).min(1),
});

const claimSchema = z.object({
  claimId: z.string().min(1),
  patientLastName: z.string().min(1),
  patientFirstName: z.string().min(1),
  patientMiddleInitial: z.string().max(1).optional(),
  patientDob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  patientGender: z.enum(['M', 'F', 'U']),
  memberId: z.string().min(1),
  payerName: z.string().min(1),
  payerId: z.string().min(1),
  renderingNpi: z.string().length(10),
  renderingLastName: z.string().min(1),
  renderingFirstName: z.string().min(1),
  diagnoses: z.array(z.string().min(3)).min(1).max(12),
  lines: z.array(lineSchema).min(1).max(50),
});

const batchSchema = z.object({
  claims: z.array(claimSchema).min(1).max(500),
});

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPayerBilling(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const json = await req.json();
    const parsed = batchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid claim batch', details: parsed.error.flatten() }, { status: 400 });
    }

    const userId = gate.userId;
    const result = await submitClaimBatch(parsed.data.claims as ClaimForBatch[], userId);

    // Save batch record to PostgreSQL database
    try {
      await prisma.$executeRaw(Prisma.sql`
        INSERT INTO waystar_claim_batches (
          batch_control_number,
          s3_key,
          claim_count,
          total_charges,
          status,
          transfer_id,
          transferred_at
        ) VALUES (${result.batchId}, ${result.s3Key}, ${result.claimCount}, ${result.totalCharges}, ${result.status === 'sent' ? 'transferred' : result.status === 'demo' ? 'demo' : 'staged'}, ${result.transferId}, NOW())
        ON CONFLICT (batch_control_number) DO UPDATE
        SET status = EXCLUDED.status, transfer_id = EXCLUDED.transfer_id, transferred_at = NOW()
      `);
    } catch (dbErr) {
      console.warn('[waystar-batch] Warning: failed to save waystar_claim_batches to DB:', dbErr);
    }

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err: any) {
    console.error('[waystar-batch] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to submit claim batch' }, { status: 500 });
  }
}
