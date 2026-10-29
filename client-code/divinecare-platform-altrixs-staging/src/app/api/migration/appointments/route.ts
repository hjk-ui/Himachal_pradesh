import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { matchProvider, parseValantAppointmentRow } from '@/lib/migration/valantAppointments';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.literal('valant').default('valant'),
  dryRun: z.boolean().optional().default(false),
  // Raw CSV cells: Valant's report repeats column names, so rows can't be keyed by header
  rows: z.array(z.array(z.string().max(4000)).max(80)).min(1).max(1000),
  rowOffset: z.number().int().min(0).optional().default(0),
  jobId: z.string().min(1).max(64).optional(),
});

/**
 * POST /api/migration/appointments — import Valant's "Appointments between …" report.
 * Patients are matched by Valant Pt. ID (Client.sourceId from the client import), so
 * clients must be imported first. Rows are written directly, without booking
 * notifications. Re-running skips appointments already imported (same client, start and provider).
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import appointments' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const parsed = body.rows.map((cells) => parseValantAppointmentRow(cells));

    const sourceIds = [
      ...new Set(
        parsed.flatMap((p) => (p.ok && p.value.kind === 'appointment' ? [p.value.sourcePatientId] : []))
      ),
    ];
    const clients = sourceIds.length
      ? await prisma.client.findMany({
          where: { organizationId: gate.organizationId, sourcePlatform: 'valant', sourceId: { in: sourceIds } },
          select: { id: true, sourceId: true, name: true, insurancePayer: true, insuranceMemberId: true },
        })
      : [];
    const clientBySource = new Map(clients.map((c) => [String(c.sourceId).toUpperCase(), c]));

    const staff = await prisma.user.findMany({
      where: { organizationId: gate.organizationId },
      select: { id: true, name: true },
    });

    const existing = clients.length
      ? await prisma.appointment.findMany({
          where: {
            organizationId: gate.organizationId,
            clientId: { in: clients.map((c) => c.id) },
            startsAt: {
              in: parsed.flatMap((p) => (p.ok && p.value.kind === 'appointment' ? [p.value.startsAt] : [])),
            },
          },
          select: { clientId: true, startsAt: true, clinicianName: true },
        })
      : [];
    // A patient can be booked with two providers at the same time (med check + therapy)
    const seen = new Set(existing.map((a) => `${a.clientId}|${a.startsAt.toISOString()}|${a.clinicianName ?? ''}`));

    const errors: { row: number; error: string }[] = [];
    const unmatchedProviders: Record<string, number> = {};
    const preview: Record<string, unknown>[] = [];
    const creates: Prisma.AppointmentCreateManyInput[] = [];
    let blocks = 0;
    let duplicates = 0;
    let cancelled = 0;

    parsed.forEach((p, i) => {
      const row = body.rowOffset + i + 1;
      if (p.ok === false) {
        errors.push({ row, error: p.error });
        return;
      }
      const v = p.value;
      // Provider blocked time (NON-PATIENT) has no client and no place in Appointment
      if (v.kind === 'block') {
        blocks += 1;
        return;
      }
      const client = clientBySource.get(v.sourcePatientId);
      if (!client) {
        errors.push({ row, error: `Patient ${v.sourcePatientId} not found — import Valant clients first` });
        return;
      }
      const clinician = matchProvider(v.provider, staff);
      const key = `${client.id}|${v.startsAt.toISOString()}|${clinician?.name || v.provider || ''}`;
      if (seen.has(key)) {
        duplicates += 1;
        return;
      }
      seen.add(key);

      if (!clinician && v.provider) unmatchedProviders[v.provider] = (unmatchedProviders[v.provider] || 0) + 1;
      if (v.status === 'CANCELLED') cancelled += 1;

      if (preview.length < 10) {
        preview.push({
          row,
          startsAt: v.startsAt.toISOString(),
          type: v.type,
          virtual: v.isVirtual,
          status: v.status,
          provider: v.provider,
          matchedStaff: clinician?.name ?? null,
        });
      }

      creates.push({
        organizationId: gate.organizationId,
        clientId: client.id,
        clientName: client.name,
        clinicianId: clinician?.id ?? null,
        clinicianName: clinician?.name || v.provider || null,
        type: v.type,
        startsAt: v.startsAt,
        endsAt: v.endsAt,
        status: v.status,
        isVirtual: v.isVirtual,
        notes: v.notes,
        insurancePayer: client.insurancePayer,
        memberId: client.insuranceMemberId,
        createdById: gate.userId,
        createdVia: 'import',
      });
    });

    let imported = 0;
    if (!body.dryRun && creates.length) {
      imported = (await prisma.appointment.createMany({ data: creates })).count;
    }

    const summary = {
      totalRows: body.rows.length,
      appointments: creates.length,
      imported: body.dryRun ? 0 : imported,
      cancelled,
      skippedBlockedTime: blocks,
      skippedDuplicates: duplicates,
      errorRows: errors.length,
      unmatchedProviders,
    };

    if (body.dryRun) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'migrationJob',
        metadata: { importType: 'appointments', platform: body.platform, dryRun: true, ...{ totalRows: summary.totalRows, appointments: summary.appointments, imported: summary.imported, cancelled, skippedBlockedTime: blocks, skippedDuplicates: duplicates, errorRows: errors.length, unmatchedProviderCount: Object.keys(unmatchedProviders).length }, clientIds: [...new Set(creates.map((c) => c.clientId))].slice(0, 50) },
      });
      return NextResponse.json({ success: true, dryRun: true, ...summary, preview, errors: errors.slice(0, 50), jobId: null });
    }

    const status = errors.length === 0 ? 'success' : imported > 0 ? 'partial' : 'failed';
    const prior = body.jobId
      ? await prisma.migrationJob.findFirst({
          where: { id: body.jobId, organizationId: gate.organizationId, type: 'appointments' },
        })
      : null;
    const job = prior
      ? await prisma.migrationJob.update({
          where: { id: prior.id },
          data: {
            total: { increment: body.rows.length },
            imported: { increment: imported },
            errors: { increment: errors.length },
            status: prior.status === 'success' && status === 'success' ? 'success'
              : prior.imported + imported > 0 ? 'partial' : 'failed',
            errorJson: errors.length
              ? ([...(Array.isArray(prior.errorJson) ? prior.errorJson : []), ...errors].slice(0, 100) as Prisma.InputJsonValue[])
              : undefined,
          },
        })
      : await prisma.migrationJob.create({
          data: {
            organizationId: gate.organizationId,
            type: 'appointments',
            platform: 'valant',
            total: body.rows.length,
            imported,
            errors: errors.length,
            status,
            createdById: gate.userId,
            errorJson: errors.length ? errors.slice(0, 100) : undefined,
          },
        });

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'migrationJob', resourceId: job.id,
      outcome: status === 'failed' ? 'FAILURE' : 'SUCCESS',
      metadata: { importType: 'appointments', platform: body.platform, dryRun: false, jobId: job.id, status, ...{ totalRows: summary.totalRows, appointments: summary.appointments, imported: summary.imported, cancelled, skippedBlockedTime: blocks, skippedDuplicates: duplicates, errorRows: errors.length, unmatchedProviderCount: Object.keys(unmatchedProviders).length }, clientIds: [...new Set(creates.map((c) => c.clientId))].slice(0, 50) },
    });

    return NextResponse.json({ success: true, dryRun: false, ...summary, preview, errors: errors.slice(0, 50), jobId: job.id, status });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid import payload', details: err.flatten() },
        { status: 400 }
      );
    }
    console.error('[migration/appointments POST]', err);
    return NextResponse.json({ success: false, error: 'Appointment import failed' }, { status: 500 });
  }
}
