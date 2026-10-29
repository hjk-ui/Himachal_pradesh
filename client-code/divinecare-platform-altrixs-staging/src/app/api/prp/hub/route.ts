import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { errorResponse, ok, prpGate } from '@/lib/prp/http';
import {
  loadAttendance,
  loadClientAges,
  loadEnrollments,
  loadPrpAuths,
  loadGroups,
  loadIrps,
  loadMors,
  loadReferralPipeline,
  PRP_STATUS_ROLES,
  PRP_WRITE_ROLES,
} from '@/lib/prp/program';
import {
  domainsFromReferrals,
  goalsByNeed,
  hubStats,
  irpReviewState,
  isoDay,
  lastServiceByEnrollment,
  monthOf,
  type IrpSummary,
} from '@/lib/prp/reports';
import { PRP_BILLING_RULE_NOTE } from '@/lib/prp/billingRule';
import { loadPrpSettings, PRP_SETTINGS_ROLES } from '@/lib/prp/settings';
import { computeIrpReviewDue, encounterDocIssues, monthlyMinimumState, morsDue } from '@/lib/prp/standard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/prp/hub: participants, referral pipeline, groups, stats and IRP goal areas for the PRP hub. */
export async function GET(req: Request) {
  const g = await prpGate();
  if (!g.ok) return g.res;
  try {
    const now = new Date();
    const month = monthOf(now);
    const enrollments = await loadEnrollments(g.actor);
    const ids = enrollments.map((e) => e.id);
    const clientIds = [...new Set(enrollments.map((e) => e.clientId))];
    const [attendance, groups, loadedIrps, referrals, mors, settings, ages, auths] = await Promise.all([
      loadAttendance(g.actor, ids),
      loadGroups(g.actor),
      loadIrps(clientIds),
      loadReferralPipeline(g.actor),
      loadMors(g.actor, ids, month),
      loadPrpSettings(g.actor.organizationId),
      loadClientAges(g.actor, clientIds),
      loadPrpAuths(g.actor, enrollments, now),
    ]);
    // A finalized IRP saved without a review date: due = IRP date + the practice interval (adult / under 18).
    const irps = new Map<string, IrpSummary>();
    for (const [clientId, irp] of loadedIrps) {
      const fallback = irp.status === 'final' && !irp.reviewDueDate ? computeIrpReviewDue(irp.effectiveDate, ages.get(clientId) ?? null, settings.irpReviewDays) : null;
      irps.set(clientId, fallback ? { ...irp, reviewDueDate: fallback } : irp);
    }
    const last = lastServiceByEnrollment(attendance);
    const morsBy = new Map(mors.map((m) => [m.enrollmentId, m.rating]));
    const monthCount = new Map<string, number>();
    const billableCount = new Map<string, number>();
    const incomplete = new Map<string, number>();
    for (const a of attendance) {
      if (monthOf(a.serviceDate) !== month) continue;
      monthCount.set(a.enrollmentId, (monthCount.get(a.enrollmentId) ?? 0) + 1);
      if (a.billable) billableCount.set(a.enrollmentId, (billableCount.get(a.enrollmentId) ?? 0) + 1);
      if (encounterDocIssues(a).length) incomplete.set(a.enrollmentId, (incomplete.get(a.enrollmentId) ?? 0) + 1);
    }
    const participants = enrollments.map((e) => {
      const irp = irps.get(e.clientId);
      const minimum = monthlyMinimumState(billableCount.get(e.id) ?? 0, settings.monthlyMinContacts);
      return {
        enrollmentId: e.id,
        clientId: e.clientId,
        name: e.clientName,
        displayId: e.displayId,
        status: e.status,
        enrolledDate: isoDay(e.startDate ?? e.createdAt),
        specialistId: e.specialistId,
        specialist: e.specialistName,
        diagnosisCode: e.diagnosisCode,
        irpStatus: irp?.status ?? null,
        irpReviewDue: isoDay(irp?.reviewDueDate ?? null),
        irpReviewState: irpReviewState(irp?.reviewDueDate ?? null, now),
        irpGoals: irp?.goals.length ?? 0,
        lastServiceDate: isoDay(last.get(e.id)),
        encountersThisMonth: monthCount.get(e.id) ?? 0,
        morsThisMonth: morsBy.get(e.id) ?? null,
        morsDue: morsDue(e.status, morsBy.get(e.id) ?? null),
        incompleteEncountersThisMonth: incomplete.get(e.id) ?? 0,
        monthlyMinimum: { state: minimum.state, label: minimum.label },
        auth: auths.get(e.id) ?? null,
        dischargedAt: isoDay(e.dischargedAt),
        dischargeReason: e.dischargeReason,
        dischargeType: e.dischargeType ?? null,
        transitionPlan: e.transitionPlan ?? null,
        aftercarePlan: e.aftercarePlan ?? null,
      };
    });
    const openIrps = enrollments
      .filter((e) => e.status !== 'discharged')
      .map((e) => irps.get(e.clientId))
      .filter((x): x is IrpSummary => !!x);

    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: 'prpHub',
      metadata: {
        enrollments: enrollments.length,
        referrals: referrals.length,
        patientIds: [...new Set(enrollments.map((e) => e.clientId))].slice(0, 50),
      },
    });

    return ok({
      month,
      stats: hubStats({ enrollments, attendance, referralsAwaiting: referrals.length, irps, month, now, mors }),
      participants,
      referrals: referrals.map((r) => ({
        id: r.id,
        displayId: r.displayId,
        clientId: r.clientId,
        name: r.clientName,
        diagnosisCode: r.diagnosisCode,
        referralDate: isoDay(r.referralDate),
        prescriber: r.prescriberName,
      })),
      groups: groups.map((x) => ({
        id: x.id,
        name: x.name,
        schedule: x.schedule,
        facilitatorId: x.facilitatorId,
        facilitator: x.facilitatorName,
        location: x.location,
        active: x.active,
      })),
      goalsByNeed: goalsByNeed(openIrps),
      referralDomains: domainsFromReferrals(openIrps),
      billingRule: {
        confirmed: settings.billing.confirmed,
        model: settings.billing.model,
        label: settings.billing.label,
        note: `${settings.billing.detail} ${PRP_BILLING_RULE_NOTE}`,
        confirmedByName: settings.billing.confirmedByName,
        confirmedAt: settings.billing.confirmedAt,
        sources: settings.billing.sources,
      },
      settings,
      canEditSettings: PRP_SETTINGS_ROLES.has(String(g.gate.role)),
      canWrite: PRP_WRITE_ROLES.has(String(g.gate.role)),
      canChangeStatus: PRP_STATUS_ROLES.has(String(g.gate.role)),
    });
  } catch (e) {
    return errorResponse(e, 'Could not load the PRP program');
  }
}
