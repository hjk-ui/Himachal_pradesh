/**
 * Enriched previsit brief: structured chart facts for the Visit guide "brief" tab.
 * Facts only — every line comes from a chart record; nothing is inferred or invented.
 * The primary-care audience never sees SUD diagnoses (F10–F19) or SUD-indicated medications.
 */
import { prisma } from '@/lib/db/prisma';
import { CURRENT_DIAGNOSIS_STATUSES } from '@/lib/diagnoses/types';
import { loadStoredDigest } from '@/lib/chart-digest/build';

export const PREVISIT_EMPTY = 'Chart history will be prepared before the next visit.';
export const PREVISIT_NOT_GENERATED = 'Not generated yet.';

export type PrevisitAudience = 'bh' | 'pc';

export type BriefDiagnosis = { code: string; description: string; status: string };
export type BriefMedication = {
  name: string;
  dosage?: string | null;
  frequency?: string | null;
  indication?: string | null;
};
export type BriefVisit = { date: string; type: string; status: string };
export type BriefLab = { line: string; date: string | null };
export type BriefCareTeamMember = { name: string; role: string; isPrimary: boolean };
export type BriefOpenItem = { label: string };

export type EnrichedBriefInput = {
  diagnoses: BriefDiagnosis[];
  medications: BriefMedication[];
  visits: BriefVisit[];
  labs: BriefLab[];
  careTeam: BriefCareTeamMember[];
  openItems: BriefOpenItem[];
  /** ISO time of the stored chart history digest, or null when none has been generated */
  digestGeneratedAt: string | null;
};

export type BriefSection = {
  key: 'diagnoses' | 'medications' | 'visits' | 'labs' | 'careTeam' | 'openItems';
  title: string;
  items: string[];
};

export type EnrichedBrief = {
  audience: PrevisitAudience;
  sections: BriefSection[];
  /** Set when the chart has no facts at all */
  emptyMessage: string | null;
  /** "Not generated yet." or the generated time */
  chartHistoryStatus: string;
};

/** Any ICD-10 F10–F19 code. Broader than the Part 2 helper on purpose: primary care never sees these. */
const SUD_RANGE = /^F1\d/i;
const SUD_INDICATION = /substance use|\bSUD\b|alcohol use disorder|opioid use disorder|\bF1\d/i;

export function isSudCodeF10toF19(code: string | null | undefined): boolean {
  return SUD_RANGE.test((code ?? '').trim());
}

export function buildEnrichedBrief(input: EnrichedBriefInput, audience: PrevisitAudience): EnrichedBrief {
  const hideSud = audience === 'pc';

  const diagnoses = input.diagnoses
    .filter((d) => !(hideSud && isSudCodeF10toF19(d.code)))
    .map((d) => `${d.code} ${d.description}`.trim());

  const medications = input.medications
    .filter((m) => !(hideSud && m.indication && SUD_INDICATION.test(m.indication)))
    .map((m) => [m.name, m.dosage, m.frequency].filter(Boolean).join(' '));

  const visits = input.visits.map((v) => `${v.date} · ${v.type} (${v.status})`);
  const labs = input.labs.map((l) => (l.date ? `${l.line} (${l.date})` : l.line));
  const careTeam = input.careTeam.map((c) => `${c.name} · ${c.role}${c.isPrimary ? ' (primary)' : ''}`);
  const openItems = input.openItems.map((o) => o.label);

  const sections: BriefSection[] = [
    { key: 'diagnoses', title: 'Diagnoses', items: diagnoses },
    { key: 'medications', title: 'Medications', items: medications },
    { key: 'visits', title: 'Recent visits', items: visits },
    { key: 'labs', title: 'Labs', items: labs },
    { key: 'careTeam', title: 'Care team', items: careTeam },
    { key: 'openItems', title: 'Open items', items: openItems },
  ];

  const hasFacts = sections.some((s) => s.items.length > 0);
  return {
    audience,
    sections,
    emptyMessage: hasFacts ? null : PREVISIT_EMPTY,
    chartHistoryStatus: input.digestGeneratedAt ? `Generated ${input.digestGeneratedAt.slice(0, 10)}` : PREVISIT_NOT_GENERATED,
  };
}

const VISIT_LIMIT = 5;
const LAB_LIMIT = 10;

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Loads the chart facts for a client. Open items (primary care only) = care-gap records that are due or overdue. */
export async function loadEnrichedBrief(input: {
  organizationId: string;
  clientId: string;
  audience: PrevisitAudience;
}): Promise<EnrichedBrief> {
  const { organizationId, clientId, audience } = input;

  const [dx, meds, appts, orders, team, gaps, digest] = await Promise.all([
    prisma.clientDiagnosis.findMany({
      where: { organizationId, clientId, status: { in: [...CURRENT_DIAGNOSIS_STATUSES] } },
      orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }],
      select: { code: true, description: true, status: true },
    }),
    prisma.clientMedication.findMany({
      where: { clientId, active: true },
      orderBy: { startDate: 'desc' },
      take: 50,
      select: { medicationName: true, dosage: true, frequency: true, indication: true },
    }),
    prisma.appointment.findMany({
      where: { clientId, startsAt: { lte: new Date() }, status: { in: ['COMPLETED', 'NO_SHOW', 'LATE_CANCEL'] } },
      orderBy: { startsAt: 'desc' },
      take: VISIT_LIMIT,
      select: { startsAt: true, type: true, status: true },
    }),
    prisma.labOrder.findMany({
      where: { organizationId, clientId },
      orderBy: { orderedAt: 'desc' },
      take: 3,
      select: {
        orderedAt: true,
        resultedAt: true,
        results: { select: { testName: true, value: true, unit: true, flag: true } },
      },
    }),
    prisma.clientTreatmentTeamMember.findMany({
      where: { clientId },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { name: true, role: true, isPrimary: true },
    }),
    prisma.medicalCareGap.findMany({
      where: { organizationId, clientId, status: { in: ['due', 'overdue'] } },
      select: { label: true, status: true },
    }),
    loadStoredDigest(organizationId, clientId, audience === 'pc' ? 'medical' : 'bh'),
  ]);

  const labs: BriefLab[] = orders
    .flatMap((o) =>
      o.results.map((r) => ({
        line: `${r.testName} ${r.value}${r.unit ? ` ${r.unit}` : ''}${r.flag && r.flag !== 'N' ? ` (flag ${r.flag})` : ''}`,
        date: day(o.resultedAt ?? o.orderedAt),
      }))
    )
    .slice(0, LAB_LIMIT);

  return buildEnrichedBrief(
    {
      diagnoses: dx,
      medications: meds.map((m) => ({
        name: m.medicationName,
        dosage: m.dosage,
        frequency: m.frequency,
        indication: m.indication,
      })),
      visits: appts.map((a) => ({ date: day(a.startsAt), type: a.type, status: a.status.toLowerCase().replace(/_/g, ' ') })),
      labs,
      careTeam: team,
      openItems: audience === 'pc' ? gaps.map((g) => ({ label: `${g.label}: ${g.status}` })) : [],
      digestGeneratedAt: digest?.generatedAt ?? null,
    },
    audience
  );
}
