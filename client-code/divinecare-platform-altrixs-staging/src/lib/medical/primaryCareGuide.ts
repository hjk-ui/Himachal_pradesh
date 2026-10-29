/**
 * Primary care additions to the Visit Guide (server only): auto checks for rooming, vitals,
 * screenings and care gaps, care gaps / screenings as due items, and the warm-handoff condition.
 * Reads primary-care data only (see primaryCareWorkflowDb.ts).
 */
import 'server-only';
import { prisma } from '@/lib/db/prisma';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { practiceTodayBounds } from '@/lib/dashboard/practiceDay';
import type { DueItem } from '@/lib/visits/types';
import { bhHandoffSuggestion, openCareGaps, unaddressedGaps, type CareGapGroup } from './primaryCareWorkflow';
import { loadPatientCareFacts, loadPrimaryCareSettings, type Viewer } from './primaryCareWorkflowDb';

export type PrimaryCareGuideFacts = {
  autoChecks: Record<'rooming_complete' | 'vitals' | 'pc_screenings' | 'care_gaps', { done: boolean; detail: string }>;
  due: DueItem[];
  positiveBhScreen: boolean;
  scores: { instrument: string; latest: number | null; previous: number | null; date: string | null }[];
  briefLines: string[];
};

const BASIS: Record<CareGapGroup, string> = {
  cancer_screening: 'uspstf_screening',
  diabetes: 'ada_diabetes_care',
  immunization: 'acip_immunization',
};

export async function loadPrimaryCareGuideFacts(input: {
  viewer: Viewer;
  clientId: string;
  appointmentId: string | null;
  now: Date;
  timeZone: string;
}): Promise<PrimaryCareGuideFacts> {
  const { viewer, clientId, appointmentId, now, timeZone } = input;
  const org = viewer.organizationId;
  const settings = await loadPrimaryCareSettings(org);
  const { start, end } = practiceTodayBounds(timeZone, now);
  const [facts, rooming, vitalToday] = await Promise.all([
    loadPatientCareFacts(viewer, clientId, { now, timeZone, disabledGaps: settings.careGapsDisabled }),
    appointmentId ? prisma.medicalRooming.findUnique({ where: { appointmentId } }).catch(() => null) : Promise.resolve(null),
    prisma.medicalVital.findFirst({ where: { clientId, recordedAt: { gte: start, lt: end } }, select: { recordedAt: true }, orderBy: { recordedAt: 'desc' } }),
  ]);
  const day = (d: Date) => toPracticeWallTime(d, timeZone).date;
  const time = (d: Date) => toPracticeWallTime(d, timeZone).time;

  const open = openCareGaps(facts.careGaps);
  const today = day(now);
  const visitActions = facts.actions
    .filter((a) => (appointmentId ? a.appointmentId === appointmentId : !a.appointmentId && day(a.createdAt) === today))
    .map((a) => ({ gapKey: a.gapKey, action: a.action }));
  const unaddressed = unaddressedGaps(open, visitActions);

  const declined = new Set<string>(((rooming?.checks as { screenings?: { declined?: string[] } } | null)?.screenings?.declined) ?? []);
  const screensDue = facts.screenings.filter((s) => s.due && !declined.has(s.key));

  const roomingReady = rooming && (rooming.status === 'ready' || rooming.status === 'in_room');
  const autoChecks: PrimaryCareGuideFacts['autoChecks'] = {
    rooming_complete: {
      done: Boolean(roomingReady),
      detail: roomingReady
        ? `ready ${rooming!.roomedAt ? time(rooming!.roomedAt) : ''}${rooming!.roomedByName ? ` by ${rooming!.roomedByName}` : ''}`.trim()
        : rooming
          ? 'rooming in progress'
          : appointmentId
            ? 'not roomed yet'
            : 'no appointment: rooming not available',
    },
    vitals: {
      done: Boolean(rooming?.vitalIds.length) || Boolean(vitalToday),
      detail: rooming?.vitalIds.length ? 'recorded at rooming' : vitalToday ? `recorded ${time(vitalToday.recordedAt)}` : 'no vitals recorded today',
    },
    pc_screenings: {
      done: screensDue.length === 0,
      detail: screensDue.length ? `due: ${screensDue.map((s) => s.label.toLowerCase()).join(', ')}` : 'no screening due today',
    },
    care_gaps: {
      done: unaddressed.length === 0,
      detail: open.length === 0 ? 'no care gap due' : unaddressed.length ? `${open.length - unaddressed.length} of ${open.length} addressed; open: ${unaddressed.map((g) => g.label).join(', ')}` : `all ${open.length} addressed at this visit`,
    },
  };

  const due: DueItem[] = [
    ...open.map((g) => ({
      id: `gap_${g.key}`,
      label: g.label,
      reason: `${g.reason} (screening guidance: ${g.basis})${g.patientReported ? `; patient reports done ${g.patientReported.date ?? 'date unknown'} at ${g.patientReported.source}: verify` : ''}`,
      severity: g.status === 'overdue' ? ('overdue' as const) : ('due' as const),
      basis: [BASIS[g.group]],
    })),
    // SDOH already comes from the shared due rules
    ...screensDue
      .filter((s) => s.key !== 'sdoh')
      .map((s) => ({ id: `screen_${s.key}`, label: s.label, reason: `${s.reason}; ${s.instrument}`, severity: 'due' as const, basis: ['uspstf_screening'] })),
  ];

  const handoff = bhHandoffSuggestion({ phq9: facts.scores.phq9, gad7: facts.scores.gad7 });
  const scores = (
    [
      ['PHQ-9 (primary care)', facts.scores.phq9],
      ['GAD-7 (primary care)', facts.scores.gad7],
      ['AUDIT-C (primary care)', facts.scores.auditC],
    ] as const
  )
    .filter(([, s]) => Boolean(s))
    .map(([instrument, s]) => ({ instrument, latest: s!.score, previous: null, date: s!.date }));

  const briefLines: string[] = [];
  if (rooming?.chiefComplaint) briefLines.push(`Chief complaint (rooming): ${rooming.chiefComplaint}`);
  if (handoff.suggested) briefLines.push(`Warm handoff suggested: ${handoff.reasons.join('; ')}`);
  return { autoChecks, due, positiveBhScreen: handoff.suggested, scores, briefLines };
}
