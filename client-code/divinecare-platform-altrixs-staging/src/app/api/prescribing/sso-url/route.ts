import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import { findDrFirstClient } from '@/app/api/drfirst/_lib/access';
import { createHmac } from 'node:crypto';
import { canPrescribe } from '@/types/roles';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

// Prescriber identity (id, NPI, DEA) always comes from the caller's own records, never the request.
// Patient: the prescriber's caseload only (drFirstClientWhere: assigned, treatment team or appointment;
// the verified Medical Director is org-wide) and the 42 CFR Part 2 / sensitive-record lock.
const ssoSchema = z.object({
  clientId: z.string().min(1),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  // CRITICAL RULE: Only psychiatrist and np roles may prescribe.
  // Test Scenario — Role enforcement: When POST /api/prescribing/sso-url is called by therapist or other non-prescribing role -> return 403 Forbidden.
  if (!canPrescribe(String(gate.role))) {
    return NextResponse.json(
      { success: false, error: 'Forbidden. Only prescribers may prescribe.' },
      { status: 403 }
    );
  }

  try {
    const body = ssoSchema.parse(await req.json());
    const clinicianId = gate.userId;

    const found = await findDrFirstClient(
      { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) },
      body.clientId,
      { id: true, name: true },
      '/api/prescribing/sso-url',
    );
    if (found.response) return found.response;
    const client = found.client;

    const [clinician, hrProfile] = await Promise.all([
      prisma.user.findFirst({
        where: { id: clinicianId, organizationId: gate.organizationId },
        select: { id: true, name: true, npi: true },
      }),
      prisma.staffHrProfile.findUnique({ where: { userId: clinicianId }, select: { deaNumber: true, organizationId: true } }),
    ]);

    // DrFirst is optional until the clinic decides to go live.
    // Medication schedules for patients work without DrFirst (Postgres + /api/clinical/medications).
    const drFirstEnabled =
      (process.env.DRFIRST_ENABLED || '').trim().toLowerCase() === 'true';
    const drFirstEnv = (process.env.DRFIRST_ENV || 'mock').trim().toLowerCase();
    const secret = process.env.DRFIRST_SECRET?.trim();

    if (!drFirstEnabled || drFirstEnv === 'mock' || !secret) {
      return NextResponse.json({
        success: true,
        demoMode: true,
        ssoUrl: null,
        token: null,
        clinician: clinician?.name || 'Prescriber',
        client: client.name,
        message:
          'DrFirst e-prescribing is not active yet. Use in-app medication schedules for this patient.',
      });
    }

    const npi = clinician?.npi?.trim();
    if (!npi) {
      return NextResponse.json(
        { success: false, error: 'Your NPI is not set on your staff profile. Ask an administrator to add it.' },
        { status: 409 }
      );
    }
    const dea = hrProfile?.organizationId === gate.organizationId ? hrProfile.deaNumber?.trim() || undefined : undefined;

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
      JSON.stringify({
        iss: 'altrixs-platform',
        sub: clinicianId,
        role: gate.role,
        npi,
        ...(dea ? { dea } : {}),
        patientId: client.id,
        iat: now,
        exp: now + 3600,
      })
    ).toString('base64url');

    const signature = createHmac('sha256', secret)
      .update(`${header}.${payload}`)
      .digest('base64url');

    const token = `${header}.${payload}.${signature}`;
    const ssoUrl = `/api/integrations/drfirst/launch/frame?token=${token}&clientId=${client.id}`;

    await writeAuditLog({
      action: 'DRFIRST_SSO_LAUNCH',
      actorUserId: gate.userId,
      actorRole: String(gate.role),
      organizationId: gate.organizationId,
      resourceType: 'prescription',
      resourceId: 'prescribing-sso-url',
      patientId: client.id,
      ...auditRequestMeta(req),
      metadata: { hasDea: Boolean(dea) },
    });

    return NextResponse.json({
      success: true,
      demoMode: false,
      ssoUrl,
      token,
      clinician: clinician?.name || 'Prescriber',
      client: client.name,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not generate SSO URL' },
      { status: 400 }
    );
  }
}
