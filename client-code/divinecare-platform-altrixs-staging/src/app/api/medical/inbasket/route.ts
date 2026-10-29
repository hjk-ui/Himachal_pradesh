import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { prismaOverviewSource } from '@/lib/medical/primaryCareOverviewDb';
import {
  daysOverdue,
  isAbnormalFlag,
  isPrimaryCareProvider,
  LAB_RESULT_EXPECTED_DAYS,
  REFERRAL_REPORT_EXPECTED_DAYS,
  resultNotifyState,
  sortResultsForReview,
} from '@/lib/medical/primaryCareWorkflow';
import { accessWhere, loadPrimaryCareSettings, lockedClientIds } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowGate } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalInbasket';
const DAY_MS = 86_400_000;
const LIMIT = 100;

/**
 * GET /api/medical/inbasket — physician / medical NP in-basket (their own orders and visits, for
 * patients they can open): results to review (critical / abnormal first, days waiting), reviewed
 * results whose patient notification is still open (practice policy window), lab orders with no
 * result past the expected time, referrals awaiting the consult report, DrFirst refill / RxChange
 * requests, prior authorizations pending, unsigned visit notes.
 */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'LIST', resourceType: RESOURCE, allow: isPrimaryCareProvider });
  if (g.ok === false) return g.response;
  const v = g.viewer;
  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(v.organizationId);
    const settings = await loadPrimaryCareSettings(v.organizationId);
    const access = accessWhere(v);
    const day = (d: Date | null | undefined) => (d ? toPracticeWallTime(d, timeZone).date : null);
    const notifySince = new Date(now.getTime() - 120 * DAY_MS);

    const [toReview, toNotify, openOrders, referrals, rx, priorAuths, unsignedVisits] = await Promise.all([
      prisma.labOrder.findMany({
        where: { organizationId: v.organizationId, orderedById: v.userId, client: access, status: { in: ['resulted', 'critical'] }, reviewedAt: null },
        select: { id: true, clientId: true, clientName: true, panels: true, otherPanel: true, status: true, hasCritical: true, resultedAt: true, updatedAt: true, results: { select: { flag: true } } },
        orderBy: { resultedAt: 'asc' },
        take: LIMIT,
      }),
      prisma.labOrder.findMany({
        where: {
          organizationId: v.organizationId,
          orderedById: v.userId,
          client: access,
          status: { in: ['resulted', 'critical'] },
          reviewedAt: { not: null },
          releasedAt: null,
          patientNotifiedAt: null,
          OR: [{ resultedAt: { gte: notifySince } }, { resultedAt: null, reviewedAt: { gte: notifySince } }],
        },
        select: { id: true, clientId: true, clientName: true, panels: true, otherPanel: true, hasCritical: true, resultedAt: true, reviewedAt: true, results: { select: { flag: true } } },
        orderBy: { reviewedAt: 'asc' },
        take: LIMIT,
      }),
      prisma.labOrder.findMany({
        where: {
          organizationId: v.organizationId,
          orderedById: v.userId,
          client: access,
          status: { in: ['ordered', 'collected', 'pending'] },
          orderedAt: { lt: new Date(now.getTime() - LAB_RESULT_EXPECTED_DAYS * DAY_MS) },
        },
        select: { id: true, clientId: true, clientName: true, panels: true, otherPanel: true, status: true, orderedAt: true },
        orderBy: { orderedAt: 'asc' },
        take: LIMIT,
      }),
      prisma.medicalReferral.findMany({
        where: { organizationId: v.organizationId, orderedById: v.userId, kind: { in: ['specialist', 'imaging'] }, status: { in: ['sent', 'scheduled', 'seen'] } },
        orderBy: { sentAt: 'asc' },
        take: LIMIT,
      }),
      prismaOverviewSource({ ...v, isCaseload: false }).rxPending({ ...v, isCaseload: false }, access),
      prisma.priorAuth.count({ where: { organizationId: v.organizationId, client: access, status: { in: ['DRAFT', 'SUBMITTED'] }, createdById: v.userId } }),
      prisma.medicalVisit.count({ where: { providerId: v.userId, signedAt: null, client: access } }),
    ]);

    // Referrals: only patients the provider can still open
    const refClientIds = [...new Set(referrals.map((r) => r.clientId))];
    const refClients = refClientIds.length ? await prisma.client.findMany({ where: { AND: [access, { id: { in: refClientIds } }] }, select: { id: true, name: true } }) : [];
    const refNames = new Map(refClients.map((c) => [c.id, c.name]));

    const allIds = [...new Set([...toReview, ...toNotify, ...openOrders].map((o) => o.clientId).concat(refClientIds))];
    const locked = await lockedClientIds(v, allIds);
    const mask = (clientId: string, name: string) => (locked === null || locked.has(clientId) ? { clientId: null, patient: 'Protected record' } : { clientId, patient: name });
    const tests = (o: { panels: string[]; otherPanel: string | null }) => [...o.panels, ...(o.otherPanel ? [o.otherPanel] : [])].join(', ') || 'Lab order';

    const results = sortResultsForReview(
      toReview.map((o) => {
        const resulted = o.resultedAt ?? o.updatedAt;
        const critical = o.hasCritical || o.status === 'critical';
        return {
          orderId: o.id,
          ...mask(o.clientId, o.clientName),
          tests: tests(o),
          resultedOn: day(resulted),
          daysWaiting: Math.max(0, Math.floor((now.getTime() - resulted.getTime()) / DAY_MS)),
          critical,
          abnormal: critical || o.results.some((r) => isAbnormalFlag(r.flag)),
        };
      })
    );
    const notify = toNotify
      .map((o) => {
        const resulted = o.resultedAt ?? o.reviewedAt!;
        const st = resultNotifyState({ resultedAt: resulted, notifiedAt: null, releasedAt: null, notifyDays: settings.resultsNotifyDays, now, timeZone });
        return {
          orderId: o.id,
          ...mask(o.clientId, o.clientName),
          tests: tests(o),
          resultedOn: day(resulted),
          reviewedOn: day(o.reviewedAt),
          deadline: st.deadline,
          state: st.state,
          daysWaiting: st.daysWaiting,
          abnormal: o.hasCritical || o.results.some((r) => isAbnormalFlag(r.flag)),
        };
      })
      .sort((a, b) => Number(b.state === 'overdue') - Number(a.state === 'overdue') || b.daysWaiting - a.daysWaiting);
    const overdueOrders = openOrders.map((o) => ({
      orderId: o.id,
      ...mask(o.clientId, o.clientName),
      tests: tests(o),
      status: o.status,
      orderedOn: day(o.orderedAt),
      daysOverdue: daysOverdue(o.orderedAt, LAB_RESULT_EXPECTED_DAYS, now) ?? 0,
    }));
    const awaitingReports = referrals
      .filter((r) => refNames.has(r.clientId))
      .map((r) => ({
        id: r.id,
        ...mask(r.clientId, refNames.get(r.clientId) ?? 'Patient'),
        kind: r.kind,
        target: r.target,
        status: r.status,
        sentOn: day(r.sentAt),
        daysOverdue: daysOverdue(r.sentAt, REFERRAL_REPORT_EXPECTED_DAYS, now),
      }))
      .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1));

    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'LIST',
      resourceType: RESOURCE,
      metadata: { results: results.length, notify: notify.length, overdueOrders: overdueOrders.length, referrals: awaitingReports.length, clientIds: allIds.slice(0, 50) },
    });
    return NextResponse.json({
      success: true,
      policy: { resultsNotifyDays: settings.resultsNotifyDays, labExpectedDays: LAB_RESULT_EXPECTED_DAYS, referralReportDays: REFERRAL_REPORT_EXPECTED_DAYS },
      results,
      notify,
      overdueOrders,
      awaitingReports,
      counts: {
        refills: rx.refills,
        rxChanges: rx.rxChanges,
        priorAuthsPending: priorAuths,
        unsignedVisits,
      },
    });
  } catch (err) {
    console.error('[medical/inbasket GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load the in-basket' }, { status: 500 });
  }
}
