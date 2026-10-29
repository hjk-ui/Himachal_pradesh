/**
 * Report library runners: "Resources assigned" and "Community referrals" (registered in
 * src/lib/reports/library/registry.ts). Rows come from the pure aggregators in ./rules.ts, so
 * report totals always equal the underlying lists (tests/resource-library.test.ts).
 * Scope: ctx.clientIdFilter (caseload roles see their own clients; protected records the viewer
 * cannot open are left out and counted).
 */
import { prisma } from '@/lib/db/prisma';
import type { ReportContext } from '@/lib/reports/library/context';
import { clientIdWhere } from '@/lib/reports/library/context';
import type { ReportOutput, ReportRow, ResolvedParams } from '@/lib/reports/library/types';
import { NO_PROVIDER, monthIn, monthLabel, requireRange, source, staffNames } from '@/lib/reports/library/runners/shared';
import { RESOURCE_DOMAIN_LABEL, REFERRAL_TYPE_LABEL } from '@/lib/sdoh/workflow';
import { DOMAIN_LABEL, type AhcDomain } from '@/lib/sdoh/ahcHrsn';
import { aggregateAssignments, aggregateReferrals, type AssignmentFact, type ReferralFact } from './rules';
import { TOPIC_LABEL, type Topic } from './types';

const PART2_NOTICE =
  'Assignments flagged 42 CFR Part 2 (SUD content or a Part 2 chart) are counted only for clients you may open; protected records you cannot open are left out. 42 CFR part 2 prohibits unauthorized use or disclosure of these records.';

export async function loadAssignmentFacts(ctx: ReportContext, p: ResolvedParams) {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  const rows = await prisma.resourceAssignment.findMany({
    where: { organizationId: ctx.organizationId, context: { not: 'legacy' }, createdAt: { gte: range.from, lt: range.toExclusive }, ...clientIdWhere(f) },
    select: { id: true, status: true, assignedById: true, createdAt: true, part2: true, item: { select: { topics: true } } },
  });
  const facts: AssignmentFact[] = rows.map((r) => ({ id: r.id, status: r.status, topics: r.item.topics, assignedById: r.assignedById, createdAt: r.createdAt, month: monthIn(r.createdAt, ctx.timeZone) }));
  return { facts, part2: rows.filter((r) => r.part2).length };
}

export async function runResourcesAssigned(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const dim = p.values.groupBy === 'clinician' ? 'clinician' : p.values.groupBy === 'month' ? 'month' : 'topic';
  const { facts, part2 } = await loadAssignmentFacts(ctx, p);
  const agg = aggregateAssignments(facts, dim);
  const names = dim === 'clinician' ? await staffNames(ctx.organizationId, agg.map((a) => a.key)) : new Map<string, string>();
  const label = (k: string) =>
    dim === 'topic' ? (k ? TOPIC_LABEL[k as Topic] ?? k : 'No topic') : dim === 'clinician' ? (k ? names.get(k) ?? 'Former staff' : NO_PROVIDER) : monthLabel(k);
  const rows: ReportRow[] = agg.map((a) => ({
    group: label(a.key),
    assigned: a.assigned,
    viewed: a.viewed,
    completed: a.completed,
    open: a.open,
    withdrawn: a.withdrawn,
    completionRate: a.completionRate,
  }));
  const live = facts.filter((f) => f.status !== 'withdrawn');
  const completed = live.filter((f) => f.status === 'completed').length;
  return {
    columns: [
      { key: 'group', label: dim === 'topic' ? 'Topic' : dim === 'clinician' ? 'Sent by' : 'Month', type: 'text' },
      { key: 'assigned', label: 'Assigned', type: 'number', smallCell: 'count' },
      { key: 'viewed', label: 'Viewed', type: 'number', smallCell: 'count', description: 'Opened by the client (viewed or completed)' },
      { key: 'completed', label: 'Completed', type: 'number', smallCell: 'count' },
      { key: 'open', label: 'Not yet completed', type: 'number', smallCell: 'count' },
      { key: 'withdrawn', label: 'Withdrawn', type: 'number', smallCell: 'count' },
      { key: 'completionRate', label: 'Completion rate', type: 'percent', smallCell: { rateOf: 'assigned' } },
    ],
    rows,
    kpis: [
      { label: 'Resources assigned', value: facts.length, type: 'number' },
      { label: 'Viewed', value: facts.filter((f) => f.status === 'viewed' || f.status === 'completed').length, type: 'number' },
      { label: 'Completion rate', value: live.length ? Math.round((completed / live.length) * 1000) / 10 : null, type: 'percent', hint: 'Completed ÷ assigned (excluding withdrawn)' },
    ],
    chart: { type: 'stackedBar', xKey: 'group', series: [{ key: 'completed', label: 'Completed' }, { key: 'open', label: 'Not yet completed' }] },
    sources: [source('Resource assignments', facts.length)],
    notices: [
      ...(facts.length === 0 ? ['No resources were sent to clients in this period.'] : []),
      ...(dim === 'topic' ? ['A resource with several topics is counted under each topic, so topic rows can add up to more than the total.'] : []),
      ...(part2 ? [PART2_NOTICE] : []),
      'Legacy records copied from the old library (never delivered) are not counted.',
    ],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

export async function loadReferralFacts(ctx: ReportContext, p: ResolvedParams) {
  const range = requireRange(p);
  const f = await ctx.clientIdFilter();
  const rows = await prisma.sdohReferral.findMany({
    where: { organizationId: ctx.organizationId, createdAt: { gte: range.from, lt: range.toExclusive }, ...clientIdWhere(f) },
    select: { id: true, domain: true, status: true, referralType: true, followUpDate: true, followUpCompletedAt: true, closeReason: true },
  });
  return rows as ReferralFact[];
}

const FOLLOW_UP_LABEL: Record<string, string> = { none: 'No follow-up date', scheduled: 'Follow-up scheduled', overdue: 'Follow-up overdue', done: 'Followed up / closed' };
const domainLabel = (d: string) => DOMAIN_LABEL[d as AhcDomain] ?? RESOURCE_DOMAIN_LABEL[d as keyof typeof RESOURCE_DOMAIN_LABEL] ?? d;

export async function runCommunityReferrals(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const dim = p.values.groupBy === 'followUp' ? 'followUp' : 'domain';
  const facts = await loadReferralFacts(ctx, p);
  const agg = aggregateReferrals(facts, dim, ctx.now);
  const rows: ReportRow[] = agg.map((a) => ({
    group: dim === 'domain' ? domainLabel(a.key) : FOLLOW_UP_LABEL[a.key] ?? a.key,
    referrals: a.referrals,
    resourceGiven: a.resourceGiven,
    referralMade: a.referralMade,
    open: a.open,
    connected: a.connected,
    closed: a.closed,
    needMet: a.needMet,
    followUpOverdue: a.followUpOverdue,
    loopClosedRate: a.loopClosedRate,
  }));
  const overdue = agg.reduce((t, a) => t + a.followUpOverdue, 0);
  const closed = facts.filter((f) => f.status === 'closed').length;
  return {
    columns: [
      { key: 'group', label: dim === 'domain' ? 'SDOH domain' : 'Follow-up', type: 'text' },
      { key: 'referrals', label: 'Referrals', type: 'number', smallCell: 'count' },
      { key: 'resourceGiven', label: REFERRAL_TYPE_LABEL.resource_given, type: 'number', smallCell: 'count' },
      { key: 'referralMade', label: REFERRAL_TYPE_LABEL.referral_made, type: 'number', smallCell: 'count' },
      { key: 'open', label: 'Open', type: 'number', smallCell: 'count' },
      { key: 'connected', label: 'Connected', type: 'number', smallCell: 'count' },
      { key: 'closed', label: 'Closed', type: 'number', smallCell: 'count' },
      { key: 'needMet', label: 'Need met', type: 'number', smallCell: 'count' },
      { key: 'followUpOverdue', label: 'Follow-up overdue', type: 'number', smallCell: 'count' },
      { key: 'loopClosedRate', label: 'Loop closed', type: 'percent', smallCell: { rateOf: 'referrals' }, description: 'Closed ÷ referrals × 100' },
    ],
    rows,
    kpis: [
      { label: 'Referrals', value: facts.length, type: 'number' },
      { label: 'Follow-ups overdue', value: overdue, type: 'number' },
      { label: 'Loop closed', value: facts.length ? Math.round((closed / facts.length) * 1000) / 10 : null, type: 'percent' },
    ],
    chart: dim === 'domain' ? { type: 'stackedBar', xKey: 'group', series: [{ key: 'open', label: 'Open' }, { key: 'connected', label: 'Connected' }, { key: 'closed', label: 'Closed' }] } : null,
    sources: [source('SDOH referrals', facts.length)],
    notices: facts.length === 0 ? ['No community referrals were opened in this period.'] : [],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}
