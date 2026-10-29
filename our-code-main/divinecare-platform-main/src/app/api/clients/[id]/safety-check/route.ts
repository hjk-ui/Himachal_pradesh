import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

export const ANTIPSYCHOTIC_DRUGS = [
  'aripiprazole', 'abilify',
  'asenapine', 'saphris',
  'brexpiprazole', 'rexulti',
  'cariprazine', 'vraylar',
  'chlorpromazine', 'thorazine',
  'clozapine', 'clozaril',
  'fluphenazine', 'prolixin',
  'haloperidol', 'haldol',
  'iloperidone', 'fanapt',
  'loxapine', 'loxitane',
  'lurasidone', 'latuda',
  'olanzapine', 'zyprexa',
  'paliperidone', 'invega',
  'perphenazine', 'trilafon',
  'pimavanserin', 'nuplazid',
  'quetiapine', 'seroquel',
  'risperidone', 'risperdal',
  'thioridazine', 'mellaril',
  'thiothixene', 'navane',
  'trifluoperazine', 'stelazine',
  'ziprasidone', 'geodon',
];

export function isAntipsychotic(name: string): boolean {
  if (!name) return false;
  const lower = name.toLowerCase();
  return ANTIPSYCHOTIC_DRUGS.some((drug) => lower.includes(drug));
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id: clientId } = await ctx.params;

    // 1. Fetch from ClientMedication table
    const dbMeds = await prisma.clientMedication.findMany({
      where: {
        clientId,
        active: true,
      },
    });

    // 2. Fetch from MedicationSchedule table as fallback / complementary source
    const scheduleMeds = await prisma.medicationSchedule.findMany({
      where: {
        clientId,
        isActive: true,
      },
    });

    const activeMeds = [
      ...dbMeds.map((m) => ({
        id: m.id,
        name: m.medicationName,
        dosage: m.dosage,
        isAntipsychotic: m.isAntipsychotic || isAntipsychotic(m.medicationName),
      })),
      ...scheduleMeds
        .filter((s) => !dbMeds.some((d) => d.medicationName.toLowerCase() === s.medicationName.toLowerCase()))
        .map((s) => ({
          id: s.id,
          name: s.medicationName,
          dosage: s.dosage,
          isAntipsychotic: isAntipsychotic(s.medicationName),
        })),
    ];

    const matchedAntipsychotics = activeMeds.filter((m) => m.isAntipsychotic);
    const count = matchedAntipsychotics.length;
    const needsEkg = count >= 2;

    return NextResponse.json({
      success: true,
      clientId,
      needsEkg,
      antipsychoticCount: count,
      antipsychotics: matchedAntipsychotics,
      totalActiveMedications: activeMeds.length,
      protocol: 'QTc Prolongation Safety Protocol (Baseline EKG Required for >= 2 Antipsychotics)',
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not perform safety check' },
      { status: 500 }
    );
  }
}
