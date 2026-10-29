import { randomBytes } from 'crypto';
import { hash } from 'bcryptjs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { createStaffInvite } from '@/lib/staff/invite';
import { validateStaff } from '@/lib/migration/validate';

export const runtime = 'nodejs';

const LEADERSHIP = new Set(['PRACTICE_DIRECTOR', 'ADMIN']);

const bodySchema = z.object({
  platform: z.string().trim().min(1).max(40).optional().default('generic'),
  dryRun: z.boolean().optional().default(false),
  rows: z.array(z.record(z.string(), z.unknown())).min(1).max(2000),
});

function tempPassword(): string {
  return `Tmp-${randomBytes(9).toString('base64url')}!`;
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!LEADERSHIP.has(gate.role)) {
    return NextResponse.json(
      { success: false, error: 'Only Practice Director or Admin can import staff' },
      { status: 403 }
    );
  }

  try {
    const body = bodySchema.parse(await req.json());
    const platform = body.platform.toLowerCase();
    const dryRun = body.dryRun === true;

    const errors: { row: number; field?: string; error: string }[] = [];
    let imported = 0;
    let skippedRows = 0;
    let validStaff = 0;
    const created: {
      row: number;
      email: string;
      name: string;
      role: Role;
      temporaryPassword?: string;
      emailMode?: string;
    }[] = [];
    const preview: Record<string, unknown>[] = [];

    for (let i = 0; i < body.rows.length; i++) {
      const validated = validateStaff(body.rows[i]);
      if (validated.ok === false) {
        errors.push({
          row: i + 1,
          field: validated.field,
          error: validated.error,
        });
        continue;
      }
      const v = validated.value;
      validStaff += 1;

      if (v.role === 'SUPER_ADMIN') {
        errors.push({ row: i + 1, error: 'Cannot import platform admins', field: 'role' });
        validStaff -= 1;
        continue;
      }

      const existing = await prisma.user.findUnique({
        where: { email: v.email },
        select: { id: true, organizationId: true, status: true },
      });

      if (existing) {
        if (existing.organizationId && existing.organizationId !== gate.organizationId) {
          errors.push({
            row: i + 1,
            error: `Email belongs to another organization: ${v.email}`,
            field: 'email',
          });
          validStaff -= 1;
          continue;
        }
        skippedRows += 1;
        continue;
      }

      if (preview.length < 10) {
        preview.push({
          row: i + 1,
          firstName: v.firstName,
          lastName: v.lastName,
          name: v.name,
          email: v.email,
          role: v.role,
          npi: v.npi,
          supervisorEmail: v.supervisorEmail,
        });
      }

      if (dryRun) {
        imported += 1;
        created.push({ row: i + 1, email: v.email, name: v.name, role: v.role });
        continue;
      }

      try {
        // Welcome email via existing invite flow
        const invite = await createStaffInvite({
          name: v.name,
          email: v.email,
          role: v.role,
          roles: [v.role],
          invitedById: gate.userId,
          organizationId: gate.organizationId,
        });

        if (!invite.ok) {
          errors.push({ row: i + 1, error: invite.error });
          validStaff -= 1;
          continue;
        }

        // Also set bcrypt temp password (INVITED) + NPI / license
        const plain = tempPassword();
        const passwordHash = await hash(plain, 12);
        await prisma.user.update({
          where: { id: invite.user.id },
          data: {
            passwordHash,
            npi: v.npi,
            licenseNumber: v.licenseNumber,
          },
        });

        imported += 1;
        created.push({
          row: i + 1,
          email: v.email,
          name: v.name,
          role: v.role,
          temporaryPassword: plain,
          emailMode: invite.emailMode,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Create failed';
        errors.push({ row: i + 1, error: msg });
        validStaff -= 1;
      }
    }

    const totalRows = body.rows.length;
    const errorClients = errors.length;
    const status =
      errorClients === 0 ? 'success' : imported > 0 ? 'partial' : 'failed';

    // dryRun: validate only — zero User inserts and zero MigrationJob rows
    if (dryRun) {
      return NextResponse.json({
        success: true,
        platform,
        totalRows,
        skippedRows,
        validStaff,
        errorClients,
        imported: 0,
        dryRun: true,
        preview: preview.slice(0, 10),
        errors: errors.slice(0, 50),
        created: created.map(({ temporaryPassword: _t, ...rest }) => rest),
        jobId: null,
        status: 'dry_run',
      });
    }

    const job = await prisma.migrationJob.create({
      data: {
        organizationId: gate.organizationId,
        type: 'staff',
        platform,
        total: totalRows,
        imported,
        errors: errorClients,
        status,
        createdById: gate.userId,
        errorJson: errors.length ? errors.slice(0, 100) : undefined,
      },
    });

    return NextResponse.json({
      success: true,
      platform,
      totalRows,
      skippedRows,
      validStaff,
      errorClients,
      imported,
      dryRun: false,
      preview: preview.slice(0, 10),
      errors: errors.slice(0, 50),
      created,
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
    console.error('[migration/staff POST]', err);
    return NextResponse.json(
      { success: false, error: 'Staff import failed' },
      { status: 500 }
    );
  }
}
