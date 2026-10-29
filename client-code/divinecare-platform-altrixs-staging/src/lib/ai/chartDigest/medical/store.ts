/**
 * Real dependencies for the medical (primary care) chart history digest. Server only. Reuses the BH
 * digest's store (chart gate, care team, AI consent, text extraction, Bedrock, audit) with
 * ClientChartDigest kind 'medical', and adds the primary-care sources and structured records.
 * Reads are scoped to the organization and the client. Psychotherapy notes are never read.
 */
import { prisma } from '@/lib/db/prisma';
import { loadDigestSources, prismaChartDigestDeps } from '@/lib/ai/chartDigest/store';
import { PRIMARY_CARE_VALANT_FACILITY, primaryCarePatientWhere } from '@/lib/medical/medicalProgram';
import { loadCareFactsBatch, loadPrimaryCareSettings } from '@/lib/medical/primaryCareWorkflowDb';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import type { MedicalDigestDeps, MedicalSourceSet, VisitRow } from '@/lib/ai/chartDigest/medical/service';
import type { StructuredSet } from '@/lib/ai/chartDigest/medical/structured';

type HeaderSource = Request | Headers | { headers: Headers } | null | undefined;

const MAX_VISITS = 400;

/** The patient also has a behavioral health chart: BH progress notes or non-Family-Practice Valant services */
export async function hasBehavioralChart(organizationId: string, clientId: string): Promise<boolean> {
  const hit = await prisma.client.findFirst({
    where: {
      id: clientId,
      organizationId,
      OR: [
        { progressNotes: { some: {} } },
        { valantTransactions: { some: { NOT: { facility: { equals: PRIMARY_CARE_VALANT_FACILITY, mode: 'insensitive' } } } } },
      ],
    },
    select: { id: true },
  });
  return Boolean(hit);
}

/** Primary-care patient (medicalProgram.primaryCarePatientWhere), scoped to the organization */
export async function isPrimaryCareClient(organizationId: string, clientId: string): Promise<boolean> {
  const hit = await prisma.client.findFirst({ where: { AND: [{ id: clientId, organizationId }, primaryCarePatientWhere()] }, select: { id: true } });
  return Boolean(hit);
}

export async function loadMedicalDigestSources(organizationId: string, clientId: string): Promise<MedicalSourceSet> {
  // Documents + Part 2 state from the BH loader (notes there are BH progress notes: not used here)
  const [base, visits, behavioral] = await Promise.all([
    loadDigestSources(organizationId, clientId),
    prisma.medicalVisit.findMany({
      where: { clientId, client: { organizationId }, signedAt: { not: null } },
      select: { id: true, visitType: true, visitDate: true, chiefComplaint: true, subjective: true, objective: true, assessment: true, plan: true, icd10Codes: true, signedAt: true, updatedAt: true },
      orderBy: { visitDate: 'desc' },
      take: MAX_VISITS,
    }),
    hasBehavioralChart(organizationId, clientId),
  ]);
  return { docs: base.docs, visits: visits as VisitRow[], part2Client: base.part2Client, part2ConsentCovers: base.part2ConsentCovers, behavioral };
}

export async function loadMedicalStructured(organizationId: string, clientId: string, now: Date): Promise<StructuredSet> {
  const scoped = { clientId, client: { organizationId } };
  const [problems, meds, allergies, vitals, labs, referrals, client, lastRisk, base, careGaps] = await Promise.all([
    prisma.medicalProblem.findMany({ where: scoped, select: { id: true, name: true, icd10Code: true, status: true, isChronic: true, onsetDate: true, resolvedDate: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 200 }),
    prisma.clientMedication.findMany({
      where: scoped,
      select: { id: true, medicationName: true, drugName: true, dosage: true, dosageText: true, frequency: true, indication: true, startDate: true, endDate: true, stopDate: true, stopReason: true, active: true, status: true, isAntipsychotic: true },
      orderBy: { startDate: 'asc' },
      take: 200,
    }),
    prisma.medicalAllergy.findMany({ where: scoped, select: { id: true, allergen: true, reaction: true, severity: true, status: true, allergenType: true, createdAt: true }, take: 100 }),
    prisma.medicalVital.findMany({ where: scoped, select: { id: true, systolic: true, bpSystolic: true, diastolic: true, bpDiastolic: true, weightLbs: true, bmi: true, recordedAt: true }, orderBy: { recordedAt: 'desc' }, take: 12 }),
    prisma.labResult.findMany({
      where: { order: { organizationId, clientId, status: { not: 'cancelled' } } },
      select: { id: true, testName: true, testKey: true, panelName: true, value: true, unit: true, flag: true, collectedAt: true, createdAt: true, order: { select: { resultedAt: true } } },
      orderBy: { createdAt: 'desc' },
      take: 400,
    }),
    prisma.medicalReferral.findMany({ where: { organizationId, clientId }, select: { id: true, kind: true, target: true, facility: true, reason: true, status: true, sentAt: true, scheduledFor: true }, orderBy: { sentAt: 'desc' }, take: 30 }),
    prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { primaryDiagnosis: true, primaryDiagnosisCode: true, secondaryDiagnoses: true } }),
    // Level and date only: the alert description is never read
    prisma.riskAlert.findFirst({ where: { clientId, client: { organizationId } }, select: { id: true, severity: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    loadDigestSources(organizationId, clientId),
    (async () => {
      const [timeZone, settings] = await Promise.all([getPracticeTimeZone(organizationId), loadPrimaryCareSettings(organizationId)]);
      const facts = await loadCareFactsBatch(organizationId, [clientId], { now, timeZone, disabledGaps: settings.careGapsDisabled });
      return facts.get(clientId)?.careGaps ?? [];
    })().catch(() => []),
  ]);
  return {
    problems,
    meds,
    allergies,
    vitals,
    labs: labs.map(({ order, ...l }) => ({ ...l, resultedAt: order?.resultedAt ?? null })),
    referrals,
    bh: client ? { ...client, lastRisk: lastRisk ? { id: lastRisk.id, severity: String(lastRisk.severity), createdAt: lastRisk.createdAt } : null } : null,
    careGaps,
    part2Client: base.part2Client,
    part2ConsentCovers: base.part2ConsentCovers,
  };
}

export function prismaMedicalDigestDeps(input: { gate: { organizationId: string; userId: string; role: string } | null; req?: HeaderSource; path: string; scriptLabel?: string; organizationId?: string }): MedicalDigestDeps {
  const { loadSources: _bhSources, ...base } = prismaChartDigestDeps({ ...input, kind: 'medical' });
  void _bhSources;
  return {
    ...base,
    loadMedicalSources: loadMedicalDigestSources,
    loadStructured: loadMedicalStructured,
    isPrimaryCare: isPrimaryCareClient,
  };
}
