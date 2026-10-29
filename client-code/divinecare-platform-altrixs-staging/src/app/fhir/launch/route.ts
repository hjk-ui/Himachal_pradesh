import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { prisma } from '@/lib/db/prisma';
import {
  canLaunchCrisp,
  CRISP_EQP_URL,
  DEMO_MODE,
  getFhirIss,
} from '@/lib/fhir/config';
import { LAUNCH_TTL_SEC, signJwt, TOKEN_USE_LAUNCH } from '@/lib/fhir/smart';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { MISSING_DOB_MESSAGE, normalizeLaunchDob } from '@/lib/fhir/launchDob';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1).max(128),
  patientFirstName: z.string().min(1).max(80),
  patientLastName: z.string().min(1).max(80),
  patientDob: z.string().max(32).optional().nullable(),
  npi: z.string().max(20).optional().nullable(),
  encounterDate: z.string().max(32).optional().nullable(),
});

/** POST /fhir/launch — staff cookie session + canLaunchCrisp; returns CRISP EQP launchUrl.
 *  Primary auth is NextAuth session cookie (same-origin). Do not require SMART access_token. */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canLaunchCrisp(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid request body';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  // demo-* ids only in DEMO_MODE (never a live CRISP query for a made-up patient)
  if (body.patientId.startsWith('demo-') && !DEMO_MODE) {
    return NextResponse.json({ success: false, error: 'Patient not found in your organization' }, { status: 404 });
  }
  // Real patients: org + 42 CFR Part 2 + caseload / care team (same rule as opening the chart)
  if (!body.patientId.startsWith('demo-')) {
    const access = await gateClientRoute({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientId: body.patientId,
      path: '/fhir/launch',
      roleAllowed: true,
    });
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'crisp_launch', resourceType: 'Client', resourceId: body.patientId, patientId: body.patientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json(
        { success: false, error: access.status === 404 ? 'Patient not found in your organization' : access.error },
        { status: access.status }
      );
    }
  }

  // DOB: the chart is the source of truth for real clients; never substitute a value.
  let patientDob = normalizeLaunchDob(body.patientDob);
  if (!body.patientId.startsWith('demo-')) {
    const client = await prisma.client.findFirst({
      where: { id: body.patientId, organizationId: gate.organizationId },
      select: { dateOfBirth: true },
    });
    patientDob = normalizeLaunchDob(client?.dateOfBirth ?? null);
  }
  if (!patientDob) {
    return NextResponse.json(
      { success: false, error: MISSING_DOB_MESSAGE, code: 'DOB_MISSING' },
      { status: 422 }
    );
  }

  const encounterDate =
    body.encounterDate?.trim() || new Date().toISOString().slice(0, 10);
  const iss = getFhirIss();

  let npi = body.npi?.trim() || '';
  if (!npi) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: gate.userId },
        select: { npi: true },
      });
      npi = user?.npi?.trim() || '';
    } catch {
      /* ignore */
    }
  }

  // HIPAA audit — do not block launch on audit failure
  if (!body.patientId.startsWith('demo-')) {
    await logPatientAudit({
      clientId: body.patientId,
      accountId: gate.userId,
      action: 'crisp_launch',
      entityType: 'Client',
      entityId: body.patientId,
    });
  }

  if (DEMO_MODE) {
    const ts = Date.now();
    const launchToken = `DEMO-LAUNCH-${ts}`;
    const launchUrl = `${CRISP_EQP_URL}?iss=${encodeURIComponent(iss)}&launch=${encodeURIComponent(launchToken)}`;
    return NextResponse.json({
      success: true,
      data: {
        launchUrl,
        launchToken,
        demoMode: true,
        note: 'Set SMART_SIGNING_SECRET and CRISP_EQP_URL env vars to go live with CRISP.',
      },
    });
  }

  const now = Math.floor(Date.now() / 1000);
  const launchToken = signJwt(
    {
      iss,
      token_use: TOKEN_USE_LAUNCH,
      org: gate.organizationId,
      launch_patient: body.patientId,
      launch_encounter: `enc-${body.patientId}-${encounterDate}`,
      launch_user: gate.userId,
      npi: npi || undefined,
      patient_dob: patientDob,
      patient_first: body.patientFirstName,
      patient_last: body.patientLastName,
      iat: now,
    },
    LAUNCH_TTL_SEC
  );

  const launchUrl = `${CRISP_EQP_URL}?iss=${encodeURIComponent(iss)}&launch=${encodeURIComponent(launchToken)}`;

  return NextResponse.json({
    success: true,
    data: {
      launchUrl,
      launchToken,
      expiresIn: LAUNCH_TTL_SEC,
      demoMode: false,
    },
  });
}
