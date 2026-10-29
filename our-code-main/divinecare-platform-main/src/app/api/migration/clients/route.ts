import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { allocateNextMrn } from '@/lib/clients/mrn';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { resolveClientFields, type PlatformId } from '@/lib/migration/fieldMaps';
import { validateClient } from '@/lib/migration/validate';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.string().trim().min(1).max(40).default('generic'),
  dryRun: z.boolean().optional().default(false),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(5000),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import clients' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const platform = body.platform.toLowerCase() as PlatformId;
    const dryRun = body.dryRun === true;

    const locationId = await getPrimaryLocationId(gate.organizationId);
    const errors: { row: number; field?: string; error: string; value?: string }[] = [];
    let imported = 0;
    let skippedRows = 0;
    let validClients = 0;
    const preview: Record<string, unknown>[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      const fields = resolveClientFields(row, platform);
      const validated = validateClient(fields);
      if (validated.ok === false) {
        errors.push({
          row: i + 1,
          field: validated.field,
          error: validated.error,
        });
        continue;
      }
      const v = validated.value;
      validClients += 1;

      let existing = null as { id: string } | null;
      if (v.sourceId) {
        existing = await prisma.client.findFirst({
          where: {
            organizationId: gate.organizationId,
            sourcePlatform: platform,
            sourceId: v.sourceId,
          },
          select: { id: true },
        });
      }
      if (!existing && v.mrn) {
        existing = await prisma.client.findFirst({
          where: {
            organizationId: gate.organizationId,
            mrn: v.mrn,
            dateOfBirth: v.dateOfBirth,
          },
          select: { id: true },
        });
      }

      if (existing) {
        skippedRows += 1;
        if (preview.length < 10) {
          preview.push({
            row: i + 1,
            name: v.name,
            action: 'skip',
            reason: 'duplicate',
          });
        }
        continue;
      }

      if (preview.length < 10) {
        preview.push({
          row: i + 1,
          firstName: v.firstName,
          lastName: v.lastName,
          name: v.name,
          dob: v.dateOfBirth.toISOString().slice(0, 10),
          email: v.email,
          phone: v.phone,
          mrn: v.mrn,
          action: 'create',
        });
      }

      if (dryRun) {
        imported += 1;
        continue;
      }

      try {
        await prisma.$transaction(async (tx) => {
          const mrn = v.mrn || (await allocateNextMrn(gate.organizationId, tx));
          await tx.client.create({
            data: {
              name: v.name,
              email: v.email,
              phone: v.phone,
              organizationId: gate.organizationId,
              mrn,
              sourcePlatform: platform,
              sourceId: v.sourceId,
              importedAt: new Date(),
              dateOfBirth: v.dateOfBirth,
              gender: v.gender,
              addressLine1: v.addressLine1,
              addressLine2: v.addressLine2,
              city: v.city,
              state: v.state,
              postalCode: v.postalCode,
              emergencyContactName: v.emergencyContactName,
              emergencyContactPhone: v.emergencyContactPhone,
              insurancePayer: v.insurancePayer,
              insuranceMemberId: v.insuranceMemberId,
              insuranceGroupNumber: v.insuranceGroupNumber,
              primaryDiagnosis: v.primaryDiagnosis,
              primaryDiagnosisCode: v.primaryDiagnosisCode,
              locationId,
              assignedToId: gate.userId,
              status: 'ACTIVE',
              active: true,
            },
          });
        });
        imported += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Create failed';
        errors.push({ row: i + 1, error: msg });
        validClients -= 1;
      }
    }

    const totalRows = body.rows.length;
    const errorClients = errors.length;
    const status =
      errorClients === 0 ? 'success' : imported > 0 ? 'partial' : 'failed';

    // dryRun: validate only — zero Client inserts and zero MigrationJob rows
    if (dryRun) {
      return NextResponse.json({
        success: true,
        platform,
        totalRows,
        skippedRows,
        validClients,
        errorClients,
        imported: 0,
        dryRun: true,
        preview: preview.slice(0, 10),
        errors: errors.slice(0, 50),
        jobId: null,
        status: 'dry_run',
      });
    }

    const job = await prisma.migrationJob.create({
      data: {
        organizationId: gate.organizationId,
        type: 'clients',
        platform,
        total: totalRows,
        imported,
        errors: errorClients,
        status,
        createdById: gate.userId,
        errorJson: {
          errors: errors.slice(0, 100),
          sections: {
            assignedProvider: { created: imported, updated: 0, skipped: errorClients },
            coverageNotes: { created: 0, updated: 0, skipped: 0 },
            aging: { created: 0, updated: 0, skipped: 0 },
            prepayments: { created: 0, updated: 0, skipped: 0 },
            copays: { created: 0, updated: 0, skipped: 0 },
            transactions: { created: 0, updated: 0, skipped: 0 },
            authorizations: { created: 0, updated: 0, skipped: 0 },
            autopay: { created: 0, updated: 0, skipped: 0 },
            transactionJournal: { created: 0, updated: 0, skipped: 0 },
            treatmentPlans: { created: 0, updated: 0, skipped: 0 },
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      platform,
      totalRows,
      skippedRows,
      validClients,
      errorClients,
      imported,
      dryRun: false,
      preview: preview.slice(0, 10),
      errors: errors.slice(0, 50),
      jobId: job.id,
      status,
    });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/clients POST]', err);
    return NextResponse.json(
      { success: false, error: 'Client import failed' },
      { status: 500 }
    );
  }
}
