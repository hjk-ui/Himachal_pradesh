import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { evaluateAotEligibility, type AotCriteria } from '@/services/aotEligibility';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const body = await req.json();

    const criteria: AotCriteria = {
      isAdult: body.isAdult !== undefined ? Boolean(body.isAdult) : true,
      meetsInpatient: Boolean(body.meetsInpatient),
      willVoluntarilyEngage: Boolean(body.willVoluntarilyEngage),
      hasSmi: Boolean(body.hasSmi),
      needsSafetySupervision: Boolean(body.needsSafetySupervision),
      historyHospitalizations: Boolean(body.historyHospitalizations),
      historyViolence: Boolean(body.historyViolence),
      unlikelyAdhereVoluntary: Boolean(body.unlikelyAdhereVoluntary),
      leastRestrictiveAlt: Boolean(body.leastRestrictiveAlt),
    };

    const determination = evaluateAotEligibility(criteria);

    return NextResponse.json({
      success: true,
      determination,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'AOT screening error' },
      { status: 500 }
    );
  }
}
