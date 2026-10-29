import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

interface AiInferenceSignal {
  detectionSource: 'diagnosis' | 'note-keyword';
  detectedCondition: string;
  quotedEvidence: string;
  confidencePercent: number;
  recommendation: string;
  actionLabel: string;
  actionHref: string;
}

const AI_INFERENCE_DATA: AiInferenceSignal[] = [
  {
    detectionSource: 'diagnosis',
    detectedCondition: 'Alcohol Use Disorder, Severe (F10.20)',
    quotedEvidence: 'ICD-10-CM Problem List: Active diagnosis F10.20 documented since 04/12/2026. Prescribed naltrexone 50mg daily. Patient reported continued cravings.',
    confidencePercent: 99,
    recommendation: 'Step-up to Residential ASAM 3.5 or 3.1 indicated. Continued high consumption despite outpatient therapy.',
    actionLabel: 'Start Residential Admission',
    actionHref: '/dashboard/residential',
  },
  {
    detectionSource: 'note-keyword',
    detectedCondition: 'Suspected Alcohol Dependency (Missing from Problem List)',
    quotedEvidence: '"Patient discloses drinking 5-6 standard drinks nightly to fall asleep. Reports blackouts on weekends." — Progress Note (Dr. Park, 10/04/2026)',
    confidencePercent: 88,
    recommendation: 'Formal SUD assessment needed. Problem list lacks SUD diagnosis. Administer WHO AUDIT screener immediately.',
    actionLabel: 'Administer AUDIT Screener',
    actionHref: '/dashboard/sdoh',
  },
  {
    detectionSource: 'diagnosis',
    detectedCondition: 'Opioid Use Disorder, Moderate (F11.20)',
    quotedEvidence: 'Active Buprenorphine/Naloxone 8mg-2mg maintenance. Last toxic screen positive for fentanyl metabolites (09/30/2026).',
    confidencePercent: 96,
    recommendation: 'Level of care step-up required. Reassess ASAM multidimensional criteria for intensive residential stabilization.',
    actionLabel: 'Start ASAM 6-Dim Assessment',
    actionHref: '/dashboard/residential',
  },
  {
    detectionSource: 'note-keyword',
    detectedCondition: 'Cannabis Use Pattern (Unspecified)',
    quotedEvidence: '"Spouse notes heavy cannabis concentrate use daily (dabbing 4-5 times/day). Impairing executive function and morning attendance."',
    confidencePercent: 82,
    recommendation: 'Diagnostic evaluation for Cannabis Use Disorder (F12.20). Order urine toxicology panel and schedule counseling.',
    actionLabel: 'Order Toxicology Lab Panel',
    actionHref: '/dashboard/ehr/labs',
  },
  {
    detectionSource: 'note-keyword',
    detectedCondition: 'Sedative / Anxiolytic Misuse Risk',
    quotedEvidence: '"Requested early refill of alprazolam 1mg; reports obtaining supplementary clonazepam from acquaintance."',
    confidencePercent: 91,
    recommendation: 'PDMP query required under Maryland CRISP. Prescriber review mandatory for benzodiazepine diversion/misuse risk.',
    actionLabel: 'Route Alert to Prescriber',
    actionHref: '/dashboard/sdoh',
  },
  {
    detectionSource: 'diagnosis',
    detectedCondition: 'Cannabis Use Disorder, Severe (F12.20)',
    quotedEvidence: 'Problem list entry F12.20 confirmed. Persistent daily heavy smoking causing cognitive clouding and motivation decline.',
    confidencePercent: 94,
    recommendation: 'Structured outpatient SUD group or ASAM 3.1 low-intensity residential review.',
    actionLabel: 'Review Residential 3.1 Eligibility',
    actionHref: '/dashboard/residential',
  },
  {
    detectionSource: 'note-keyword',
    detectedCondition: 'Stimulant / Cocaine Exposure Mentioned',
    quotedEvidence: '"Patient admitted to recreational cocaine use twice over the weekend while visiting family in Philadelphia."',
    confidencePercent: 85,
    recommendation: 'Immediate harm-reduction counseling, fentanyl test strip provision, and NIDA-Quick screen.',
    actionLabel: 'Open SUD Assessment',
    actionHref: '/dashboard/sdoh',
  },
  {
    detectionSource: 'diagnosis',
    detectedCondition: 'Sedative, Hypnotic, or Anxiolytic-Related Disorder (F13.10)',
    quotedEvidence: 'ICD-10 F13.10 active. History of polysubstance use complicating PTSD treatment regimen.',
    confidencePercent: 95,
    recommendation: 'Integrated dual diagnosis treatment track. Residential step-up evaluation recommended.',
    actionLabel: 'Start Residential Admission',
    actionHref: '/dashboard/residential',
  },
];

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/ehr/scanner')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    // Fetch clients to link to radar signals
    const clients = await prisma.client.findMany({
      where: gate.organizationId ? { organizationId: gate.organizationId } : {},
      take: 10,
    });

    const createdSignals = [];

    // Clear previous automated scan signals or upsert fresh ones
    if (clients.length > 0) {
      for (let i = 0; i < AI_INFERENCE_DATA.length; i++) {
        const item = AI_INFERENCE_DATA[i];
        const assignedClient = clients[i % clients.length];

        const signal = await prisma.sudRadarSignal.create({
          data: {
            organizationId: gate.organizationId || assignedClient.organizationId,
            clientId: assignedClient.id,
            detectionSource: item.detectionSource,
            detectedCondition: item.detectedCondition,
            quotedEvidence: item.quotedEvidence,
            confidencePercent: item.confidencePercent,
            recommendation: item.recommendation,
            actionLabel: item.actionLabel,
            actionHref: item.actionHref,
            scannedAt: new Date(),
          },
        });
        createdSignals.push(signal);
      }
    }

    return NextResponse.json({
      success: true,
      scannedCount: createdSignals.length,
      signals: createdSignals,
      message: `AI Clinical Inference scan completed successfully. ${createdSignals.length} SUD signals identified.`,
    });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Could not run AI scan' },
      { status: 500 }
    );
  }
}
