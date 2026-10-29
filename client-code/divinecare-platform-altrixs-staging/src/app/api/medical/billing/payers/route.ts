import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import type { PayerSetting } from '@/features/medical/types';
import { isBillingCore } from '@/lib/billing/billingAccess';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const MODULE_KEY = 'medical:payer_settings';

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const row = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
    });

    // Only payer settings this organization saved. Nothing is seeded: an empty list means none
    // have been configured yet (built-in sample payers were removed; they were not real settings).
    const rawData = row?.data as Record<string, unknown> | null;
    const payers: PayerSetting[] = rawData && Array.isArray(rawData.payers) ? (rawData.payers as PayerSetting[]) : [];

    return NextResponse.json({
      success: true,
      payers,
    });
  } catch (err: unknown) {
    console.error('[medical/billing/payers] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load payer settings' }, { status: 500 });
  }
}

/** One payer setting (src/features/medical/types PayerSetting); unknown keys are dropped. */
const payerFields = {
  id: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
  payerId: z.string().trim().min(1).max(40),
  type: z.enum(['Commercial', 'Medicare', 'Medicaid MCO']),
  clearinghouse: z.enum(['Availity', 'Change Healthcare', 'Office Ally']),
  timelyFilingDays: z.number().int().min(1).max(3650),
  timelyFilingWarningDays: z.number().int().min(0).max(3650).optional(),
  autoAttachModifier25: z.boolean(),
  autoAttachModifier59: z.boolean().optional(),
  telehealthModifier: z.enum(['-95', '-GT', '-FQ', '-93']),
  telehealthPos: z.enum(['02', '10', '11']).optional(),
  requireCliaNumber: z.boolean().optional(),
  requiresSupervisorNpi: z.boolean(),
  enforceNpiType2: z.boolean().optional(),
  taxonomyRequired: z.boolean().optional(),
  requirePriorAuth: z.boolean().optional(),
  priorAuthCptCodes: z.array(z.string().trim().min(1).max(20)).max(200).optional(),
  electronicClaimsEnabled: z.boolean(),
  realtimeEligibilityEnabled: z.boolean(),
  acceptElectronicSecondary: z.boolean().optional(),
  autoPostEra835: z.boolean().optional(),
  patientCopayPolicy: z.enum(['Collect at Check-in', 'Bill Post-Adjudication']).optional(),
};
const payerSettingSchema = z.object(payerFields);
/** Partial update of one payer, matched by id or payerId */
const payerPatchSchema = z
  .object(payerFields)
  .partial()
  .refine((p) => Boolean(p.id || p.payerId), { message: 'id or payerId is required' });

const postSchema = z.union([
  z.object({ payers: z.array(payerSettingSchema).max(200) }),
  z.object({ payer: payerPatchSchema }),
  payerPatchSchema,
]);

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Payer rules drive claim scrubbing and filing limits: billing core only
  if (!isBillingCore(gate.role)) {
    await writeAuditLog({
      action: 'medical.payer_settings_update_denied', actorUserId: gate.userId, actorRole: gate.role, organizationId: gate.organizationId,
      resourceType: 'ClinicModuleState', resourceId: MODULE_KEY, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' },
    });
    return NextResponse.json({ success: false, error: 'Only billing staff can change payer settings' }, { status: 403 });
  }

  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid payer settings' }, { status: 400 });
  }
  const body = parsed.data as { payers?: PayerSetting[]; payer?: Partial<PayerSetting> } & Partial<PayerSetting>;

  try {

    let existingPayers: PayerSetting[] = [];
    const row = await prisma.clinicModuleState.findUnique({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
    });
    const rawData = row?.data as Record<string, unknown> | null;
    if (rawData && Array.isArray(rawData.payers)) {
      existingPayers = rawData.payers as PayerSetting[];
    }

    let updatedPayers: PayerSetting[] = [];
    let mode: 'replace_all' | 'upsert_one' = 'upsert_one';
    const patch: Partial<PayerSetting> | null = Array.isArray(body.payers) ? null : body.payer ?? body;
    if (Array.isArray(body.payers)) {
      mode = 'replace_all';
      updatedPayers = body.payers;
    } else if (patch) {
      const idx = existingPayers.findIndex(
        (p) => (patch.id && p.id === patch.id) || (patch.payerId && p.payerId === patch.payerId)
      );
      if (idx >= 0) {
        existingPayers[idx] = { ...existingPayers[idx], ...patch };
      } else {
        // A new payer needs every required field
        const full = payerSettingSchema.safeParse(patch);
        if (!full.success) {
          return NextResponse.json(
            { success: false, error: full.error.issues[0]?.message || 'A new payer needs all required settings' },
            { status: 400 }
          );
        }
        existingPayers.push(full.data);
      }
      updatedPayers = existingPayers;
    }

    await prisma.clinicModuleState.upsert({
      where: {
        organizationId_module: {
          organizationId: gate.organizationId,
          module: MODULE_KEY,
        },
      },
      create: {
        organizationId: gate.organizationId,
        module: MODULE_KEY,
        data: { payers: updatedPayers } as unknown as Prisma.InputJsonValue,
      },
      update: {
        data: { payers: updatedPayers } as unknown as Prisma.InputJsonValue,
      },
    });

    await writeAuditLog({
      action: 'medical.payer_settings_updated', actorUserId: gate.userId, actorRole: gate.role, organizationId: gate.organizationId,
      resourceType: 'ClinicModuleState', resourceId: MODULE_KEY,
      metadata: { mode, payerCount: updatedPayers.length, payerIds: updatedPayers.map((p) => p.payerId).slice(0, 50) },
    });

    return NextResponse.json({ success: true, payers: updatedPayers });
  } catch (err: unknown) {
    console.error('[medical/billing/payers] POST failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not save payer settings' }, { status: 500 });
  }
}
