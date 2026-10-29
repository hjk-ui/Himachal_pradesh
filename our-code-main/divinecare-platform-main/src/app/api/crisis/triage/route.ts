import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { evaluateCrisisTriage, type TriageInput } from '@/services/crisisTriage';
import { generateTriageProbe } from '@/lib/aiAssists';
import { validateClientBelongsToOrg } from '@/lib/crisis/tenantIsolation';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    if (body.clientId) {
      const isValid = await validateClientBelongsToOrg(body.clientId, gate.organizationId);
      if (!isValid) {
        return NextResponse.json(
          { success: false, error: 'Client not found in this organization' },
          { status: 400 }
        );
      }
    }

    const triageInput: TriageInput = {
      medicalEmergency: Boolean(body.medicalEmergency),
      weaponViolence: Boolean(body.weaponViolence),
      attemptInProgress: Boolean(body.attemptInProgress),
      suicidalIdeation: Boolean(body.suicidalIdeation),
      hasPlan: Boolean(body.hasPlan),
      intentAndMeans: Boolean(body.intentAndMeans),
      harmOthers: Boolean(body.harmOthers),
      psychosisSigns: Boolean(body.psychosisSigns),
      intoxicationSigns: Boolean(body.intoxicationSigns),
      supportPresent: Boolean(body.supportPresent),
      willingToEngage: Boolean(body.willingToEngage),
    };

    const decision = evaluateCrisisTriage(triageInput);

    const probe = await generateTriageProbe({
      symptoms: body.symptoms || decision.label,
      location: body.location,
      callerType: body.callerType,
      weapons: triageInput.weaponViolence,
      violence: triageInput.harmOthers,
    });

    return NextResponse.json({
      success: true,
      decision,
      probe,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Triage evaluation error' },
      { status: 500 }
    );
  }
}
