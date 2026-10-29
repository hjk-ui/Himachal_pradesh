/**
 * Chart context for a scribe session (server only): active treatment-plan goals, chart diagnoses,
 * the last note's plan / homework, recent PHQ-9 / GAD-7 scores, which measures are due, and the
 * client's active medication list (name, dose, sig; DrFirst-linked flag; medications.ts). Used by
 * the pre-session panel and as numbered chart facts (c1…) for drafting. Org + caseload scoped
 * through the existing loaders. Part 2 notes are not read for the last plan.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { loadClientPlanStatus } from '@/lib/ehr/therapy/planStore';
import { parseChartDiagnoses } from '@/lib/ehr/psychMedMgmt';
import { extractPlanSection } from '@/lib/ai/previsit/facts';
import type { ChartFacts } from './draft';

export type ScribeContext = ChartFacts & {
  planTitle: string | null;
  lastPlanDate: string | null;
  measuresDue: { instrument: string; detail: string }[];
  minor: boolean;
};

const DAY = 86_400_000;

export function measuresDue(
  latest: { instrument: 'PHQ-9' | 'GAD-7'; date: Date | null }[],
  intervals: { phq9: number; gad7: number },
  now: Date
): { instrument: string; detail: string }[] {
  const out: { instrument: string; detail: string }[] = [];
  for (const m of latest) {
    const interval = m.instrument === 'PHQ-9' ? intervals.phq9 : intervals.gad7;
    if (!m.date) out.push({ instrument: m.instrument, detail: 'none on file' });
    else {
      const days = Math.floor((now.getTime() - m.date.getTime()) / DAY);
      if (days >= interval) out.push({ instrument: m.instrument, detail: `last ${days} days ago; practice interval ${interval} days` });
    }
  }
  return out;
}

export async function loadScribeContext(input: { organizationId: string; userId: string; role: Role | string; clientId: string; now?: Date }): Promise<ScribeContext> {
  const now = input.now ?? new Date();
  const actor = { organizationId: input.organizationId, actorUserId: input.userId, actorRole: input.role as Role };
  const [client, planStatus, settings, lastNote, assessments, meds] = await Promise.all([
    prisma.client.findFirst({
      where: { id: input.clientId, organizationId: input.organizationId },
      select: { primaryDiagnosis: true, primaryDiagnosisCode: true, secondaryDiagnoses: true, dateOfBirth: true },
    }),
    loadClientPlanStatus(actor, input.clientId).catch(() => null),
    prisma.practiceSettings.findUnique({ where: { organizationId: input.organizationId }, select: { phq9IntervalDays: true, gad7IntervalDays: true } }).catch(() => null),
    // Last plan / homework only from a SIGNED note: unsigned AI drafts are not the record of care
    prisma.progressNote.findFirst({
      where: {
        clientId: input.clientId,
        part2: false,
        client: { organizationId: input.organizationId },
        workflow: { status: { in: ['SIGNED', 'LOCKED'] } },
      },
      orderBy: [{ dateOfService: 'desc' }, { createdAt: 'desc' }],
      select: { body: true, dateOfService: true, createdAt: true },
    }),
    prisma.clinicalAssessmentRecord.findMany({
      where: { organizationId: input.organizationId, clientId: input.clientId, OR: [{ instrumentId: { in: ['phq9', 'PHQ-9', 'gad7', 'GAD-7'] } }, { instrumentName: { contains: 'PHQ-9' } }, { instrumentName: { contains: 'GAD-7' } }] },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { instrumentId: true, instrumentName: true, totalScore: true, createdAt: true },
    }),
    prisma.clientMedication
      .findMany({
        where: { clientId: input.clientId, active: true, client: { organizationId: input.organizationId } },
        orderBy: { createdAt: 'asc' },
        take: 40,
        select: { medicationName: true, drugName: true, dosage: true, dosageText: true, strength: true, frequency: true, instructions: true, rcopiaMedId: true, status: true },
      })
      .catch(() => []),
  ]);

  const active = planStatus && planStatus.ok ? planStatus.active : null;
  const goals = (active?.goals ?? []).map((g) => ({ id: g.id, text: g.text, objectives: g.objectives ?? [] }));
  const diagnoses = client
    ? parseChartDiagnoses({ primaryCode: client.primaryDiagnosisCode, primaryName: client.primaryDiagnosis, secondary: client.secondaryDiagnoses }).map((d) => ({
        code: d.code || null,
        description: d.description || null,
      }))
    : [];
  const lastPlan = lastNote
    ? extractPlanSection(lastNote.body)
        .replace(/\[AI DRAFT[^\]]*\]\s*/gi, '')
        .trim()
        .slice(0, 400) || null
    : null;
  const isPhq = (a: { instrumentId: string; instrumentName: string }) => /phq-?9/i.test(`${a.instrumentId} ${a.instrumentName}`);
  const isGad = (a: { instrumentId: string; instrumentName: string }) => /gad-?7/i.test(`${a.instrumentId} ${a.instrumentName}`);
  const phq = assessments.find(isPhq);
  const gad = assessments.find(isGad);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const scores = [phq, gad]
    .filter((a): a is NonNullable<typeof a> => Boolean(a) && a!.totalScore != null)
    .map((a) => `${isPhq(a) ? 'PHQ-9' : 'GAD-7'} ${a.totalScore} on ${iso(a.createdAt)}`);
  const age = client?.dateOfBirth ? Math.floor((now.getTime() - client.dateOfBirth.getTime()) / (365.25 * DAY)) : null;
  const medications = meds
    .filter((m) => !m.status || m.status === 'active')
    .map((m) => ({
      name: (m.drugName || m.medicationName || '').trim(),
      dose: (m.strength || m.dosage || '').trim() || null,
      sig: (m.dosageText || [m.frequency, m.instructions].filter(Boolean).join('; ') || '').trim() || null,
      drFirst: Boolean(m.rcopiaMedId),
    }))
    .filter((m) => m.name);
  return {
    goals,
    diagnoses,
    lastPlan,
    scores,
    medications,
    planTitle: active?.title ?? null,
    lastPlanDate: lastNote ? iso(lastNote.dateOfService ?? lastNote.createdAt) : null,
    measuresDue: measuresDue(
      [
        { instrument: 'PHQ-9', date: phq?.createdAt ?? null },
        { instrument: 'GAD-7', date: gad?.createdAt ?? null },
      ],
      { phq9: settings?.phq9IntervalDays ?? 30, gad7: settings?.gad7IntervalDays ?? 30 },
      now
    ),
    minor: age != null && age < 18,
  };
}
