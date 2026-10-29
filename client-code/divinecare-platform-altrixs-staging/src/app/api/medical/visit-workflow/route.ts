import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { classifyMed } from '@/lib/visits/due';
import {
  bhHandoffSuggestion,
  bmiFromImperial,
  bpRecheckState,
  canViewPrimaryCareWorkflow,
  isMedicarePayer,
  isPrimaryCareProvider,
  openCareGaps,
  screeningSafetyFlags,
  vitalFlags,
  type RoomingVitals,
} from '@/lib/medical/primaryCareWorkflow';
import { bhInvolvement, loadPatientCareFacts, loadPrimaryCareSettings, referralViews } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowClientGate, workflowGate } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalVisitWorkflow';
const DAY_MS = 86_400_000;

/**
 * GET /api/medical/visit-workflow?clientId=&appointmentId= — what the provider needs around a
 * primary care visit: MA intake (vitals with flags, chief complaint, reviews, screenings), care gaps
 * with this visit's actions, referrals / handoffs, results awaiting review, the BH involvement signal
 * (yes / last date only) and the facts behind the E/M suggestion. Primary-care data only.
 */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'READ', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId') || '';
  const appointmentId = params.get('appointmentId') || null;
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const c = await workflowClientGate(req, g.gate, g.viewer, clientId, { action: 'READ', resourceType: RESOURCE });
  if (c.ok === false) return c.response;
  const v = g.viewer;
  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(v.organizationId);
    const day = (d: Date | null | undefined) => (d ? toPracticeWallTime(d, timeZone).date : null);
    const settings = await loadPrimaryCareSettings(v.organizationId);
    const org = v.organizationId;
    const appt = appointmentId
      ? await prisma.appointment.findFirst({
          where: { id: appointmentId, clientId, OR: [{ organizationId: org }, { organizationId: null, client: { organizationId: org } }] },
          select: { id: true, type: true, startsAt: true, isVirtual: true, insurancePayer: true },
        })
      : null;
    if (appointmentId && !appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });

    const [facts, rooming, client, referralRows, awaitingReview, priorVisits, awv, meds, pdmp, bh] = await Promise.all([
      loadPatientCareFacts(v, clientId, { now, timeZone, disabledGaps: settings.careGapsDisabled }),
      appt ? prisma.medicalRooming.findUnique({ where: { appointmentId: appt.id } }) : Promise.resolve(null),
      prisma.client.findFirst({ where: { id: clientId, organizationId: org }, select: { insurancePayer: true, insuranceType: true } }),
      prisma.medicalReferral.findMany({ where: { organizationId: org, clientId }, orderBy: { sentAt: 'desc' }, take: 50 }),
      prisma.labOrder.count({ where: { organizationId: org, clientId, status: { in: ['resulted', 'critical'] }, reviewedAt: null } }),
      prisma.medicalVisit.count({ where: { clientId, visitDate: { gte: new Date(now.getTime() - 3 * 365 * DAY_MS), lt: appt?.startsAt ?? now } } }),
      prisma.medicalVisit.findFirst({ where: { clientId, cptCode: { in: ['G0438', 'G0439'] } }, select: { visitDate: true }, orderBy: { visitDate: 'desc' } }),
      prisma.clientMedication.findMany({ where: { clientId, active: true }, select: { medicationName: true, drugName: true, schedule: true }, take: 100 }),
      prisma.marylandPdmpAudit.findFirst({ where: { clientId }, select: { consultationTimestamp: true }, orderBy: { consultationTimestamp: 'desc' } }).catch(() => null),
      bhInvolvement(org, clientId, now),
    ]);
    const referrals = await referralViews(org, referralRows, timeZone);
    const vitals = (rooming?.vitals ?? null) as RoomingVitals | null;
    const checks = (rooming?.checks ?? null) as { screenings?: { phq9?: { item9?: number } | null } | null } | null;
    const handoff = bhHandoffSuggestion({ phq9: facts.scores.phq9, gad7: facts.scores.gad7 });
    const openHandoff = referrals.find((r) => r.kind === 'internal_bh' && (r.status === 'sent' || r.status === 'scheduled')) ?? null;
    const controlled = meds.filter((m) => classifyMed(`${m.medicationName} ${m.drugName ?? ''}`, { schedule: m.schedule }).controlled).map((m) => m.medicationName);

    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: RESOURCE, patientId: clientId, metadata: { appointmentId, rooming: rooming?.status ?? 'none' } });
    return NextResponse.json({
      success: true,
      canAct: isPrimaryCareProvider(v.role),
      intake: rooming
        ? {
            status: rooming.status,
            chiefComplaint: rooming.chiefComplaint,
            identityConfirmed: rooming.identityConfirmed,
            identifiers: rooming.identifiers,
            vitals,
            bmi: vitals ? bmiFromImperial(vitals.weightLbs, vitals.heightIn) : null,
            flags: [...(vitals ? vitalFlags(vitals) : []), ...screeningSafetyFlags(checks?.screenings)],
            recheck: vitals ? bpRecheckState(vitals, now) : { state: 'not_needed' },
            checks: rooming.checks,
            vitalsFiled: rooming.vitalIds.length > 0,
            roomedByName: rooming.roomedByName,
            roomedAt: rooming.roomedAt?.toISOString() ?? null,
            inRoomAt: rooming.inRoomAt?.toISOString() ?? null,
          }
        : null,
      scores: facts.scores,
      screenings: facts.screenings,
      careGaps: facts.careGaps,
      openGapKeys: openCareGaps(facts.careGaps).map((x) => x.key),
      thisVisitActions: appt
        ? facts.actions.filter((a) => a.appointmentId === appt.id).map((a) => ({ gapKey: a.gapKey, action: a.action, performedOn: a.performedOn ? a.performedOn.toISOString().slice(0, 10) : null, source: a.source, reason: a.reason, by: a.recordedByName }))
        : [],
      bhHandoff: { ...handoff, open: openHandoff },
      bhInvolvement: { involved: bh.involved, lastSeen: day(bh.lastSeen) },
      referrals,
      resultsAwaitingReview: awaitingReview,
      prescribing: { controlledMeds: controlled, lastPdmp: day(pdmp?.consultationTimestamp ?? null) },
      em: {
        ageYears: facts.ageYears,
        medicare: isMedicarePayer(appt?.insurancePayer, client?.insurancePayer, client?.insuranceType),
        lastAwv: awv?.visitDate ? awv.visitDate.toISOString() : null,
        newPatient: priorVisits === 0,
        newPatientBasis: priorVisits === 0 ? 'no primary care visit on file in the last 3 years' : `${priorVisits} primary care visit(s) on file in the last 3 years`,
        visitType: appt?.type ?? null,
      },
    });
  } catch (err) {
    console.error('[medical/visit-workflow GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the visit workflow' }, { status: 500 });
  }
}
