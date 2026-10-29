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
import { LAUNCH_TTL_SEC, signJwt } from '@/lib/fhir/smart';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import { isPrimaryCareRole, staffLocationIds } from '@/lib/clients/locationScope';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';

export const runtime = 'nodejs';

const bodySchema = z.object({
  patientId: z.string().min(1).max(128),
  patientFirstName: z.string().min(1).max(80),
  patientLastName: z.string().min(1).max(80),
  patientDob: z.string().min(4).max(32),
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

  // Tenant isolation: real patients must belong to caller's clinic (demo-* allowed for UI tests)
  if (!body.patientId.startsWith('demo-')) {
    const inOrg = await prisma.client.findFirst({
      where: clientByIdWhere(body.patientId, gate.organizationId),
      select: { id: true, assignedToId: true, locationId: true },
    });
    if (!inOrg) {
      return NextResponse.json(
        { success: false, error: 'Patient not found in your organization' },
        { status: 404 }
      );
    }
    if (gate.role === 'PHYSICIAN' || gate.role === 'MEDICAL_NP') {
      const locations = await staffLocationIds(gate.userId);
      const member = await prisma.clientTreatmentTeamMember.findFirst({
        where: { clientId: inOrg.id, providerId: gate.userId },
        select: { id: true },
      });
      const onTeam = inOrg.assignedToId === gate.userId || Boolean(member);
      const atLocation = !inOrg.locationId || locations.length === 0 || locations.includes(inOrg.locationId);
      if (!onTeam || !atLocation) {
        return NextResponse.json(
          { success: false, error: 'CRISP opens only for a patient on your care team at your location.' },
          { status: 403 }
        );
      }
    }
    if (isPrimaryCareRole(gate.role) && gate.role === 'MEDICAL_ASSISTANT') {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }
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
      launch_patient: body.patientId,
      launch_encounter: `enc-${body.patientId}-${encounterDate}`,
      launch_user: gate.userId,
      npi: npi || undefined,
      patient_dob: body.patientDob,
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
