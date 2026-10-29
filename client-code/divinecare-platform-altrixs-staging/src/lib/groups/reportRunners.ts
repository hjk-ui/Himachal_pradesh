/**
 * Report library runners for Group attendance and Group utilization (registered in
 * src/lib/reports/library/registry.ts, exported through runners/programs.ts).
 */
import { prisma } from '@/lib/db/prisma';
import type { ReportContext } from '@/lib/reports/library/context';
import { pct } from '@/lib/reports/library/formulas';
import type { ReportOutput, ReportRow, ResolvedParams } from '@/lib/reports/library/types';
import { NO_PROVIDER, requireRange, source, staffNames } from '@/lib/reports/library/runners/shared';
import { loadGroupReportData } from './reportData';
import { aggregateGroupReport, memberAttendanceRows } from './rules';
import { GROUP_KIND_META, groupTypeLabel, isGroupKind, type GroupKind } from './types';

function groupKindParam(p: ResolvedParams): 'all' | GroupKind {
  const k = p.values.kind ?? 'all';
  return isGroupKind(k) ? k : 'all';
}

const GROUP_PART2_NOTICE =
  'SUD group counseling rows are 42 CFR Part 2 records: shown only to roles that can open SUD Group Counseling; protected records you cannot open are left out. 42 CFR part 2 prohibits unauthorized use or disclosure of these records.';

const kindLabel = (kind: string) => (isGroupKind(kind) ? GROUP_KIND_META[kind].shortLabel : kind);

async function load(ctx: ReportContext, p: ResolvedParams) {
  const range = requireRange(p);
  return loadGroupReportData({
    organizationId: ctx.organizationId,
    role: ctx.role,
    kind: groupKindParam(p),
    from: range.from,
    toExclusive: range.toExclusive,
    clientFilter: await ctx.clientIdFilter(),
  });
}

function notices(kinds: GroupKind[], sessions: number): string[] {
  return [
    ...(kinds.length === 0 ? ['Your role cannot open the group areas, so no group data is shown.'] : []),
    ...(kinds.length && sessions === 0 ? ['No group sessions in this period.'] : []),
    ...(kinds.includes('sud') ? [GROUP_PART2_NOTICE] : []),
  ];
}

export async function groupAttendanceReport(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const data = await load(ctx, p);
  const dim = p.values.groupBy === 'member' ? 'member' : 'group';
  const summary = aggregateGroupReport(data.sessions, data.attendance);
  const groupMeta = new Map(data.groups.map((g) => [g.id, g]));
  let rows: ReportRow[] = [];
  let columns: ReportOutput['columns'];
  if (dim === 'member') {
    const ids = [...new Set(data.attendance.map((a) => a.clientId))];
    const clients = ids.length ? await prisma.client.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, mrn: true } }) : [];
    const byId = new Map(clients.map((c) => [c.id, c]));
    for (const g of data.groups) {
      for (const m of memberAttendanceRows(data.attendance.filter((a) => a.groupId === g.id))) {
        rows.push({
          group: g.name,
          kind: kindLabel(g.kind),
          client: byId.get(m.clientId)?.name ?? 'Client',
          mrn: byId.get(m.clientId)?.mrn ?? null,
          marked: m.marked,
          attended: m.attended,
          absent: m.absent,
          excused: m.excused,
          attendanceRate: m.attendanceRate,
        });
      }
    }
    columns = [
      { key: 'group', label: 'Group', type: 'text' },
      { key: 'kind', label: 'Area', type: 'text' },
      { key: 'client', label: 'Client', type: 'text' },
      { key: 'mrn', label: 'MRN', type: 'text' },
      { key: 'marked', label: 'Sessions marked', type: 'number' },
      { key: 'attended', label: 'Attended', type: 'number' },
      { key: 'absent', label: 'Absent', type: 'number' },
      { key: 'excused', label: 'Excused', type: 'number' },
      { key: 'attendanceRate', label: 'Attendance rate', type: 'percent' },
    ];
  } else {
    rows = summary.map((r) => {
      const g = groupMeta.get(r.groupId);
      return {
        group: g?.name ?? 'Removed group',
        kind: g ? kindLabel(g.kind) : '',
        sessionsHeld: r.sessionsHeld,
        marked: r.marked,
        attended: r.attended,
        absent: r.absent,
        excused: r.excused,
        attendanceRate: r.attendanceRate,
        members: r.members,
      };
    });
    columns = [
      { key: 'group', label: 'Group', type: 'text' },
      { key: 'kind', label: 'Area', type: 'text' },
      { key: 'sessionsHeld', label: 'Sessions held', type: 'number' },
      { key: 'marked', label: 'Attendance marks', type: 'number' },
      { key: 'attended', label: 'Attended', type: 'number' },
      { key: 'absent', label: 'Absent', type: 'number' },
      { key: 'excused', label: 'Excused', type: 'number' },
      { key: 'attendanceRate', label: 'Attendance rate', type: 'percent' },
      { key: 'members', label: 'Members seen', type: 'number' },
    ];
  }
  const marked = summary.reduce((t, r) => t + r.marked, 0);
  const attended = summary.reduce((t, r) => t + r.attended, 0);
  return {
    columns,
    rows,
    kpis: [
      { label: 'Sessions held', value: summary.reduce((t, r) => t + r.sessionsHeld, 0), type: 'number' },
      { label: 'Attendance marks', value: marked, type: 'number' },
      { label: 'Attendance rate', value: pct(attended, marked), type: 'percent' },
    ],
    chart:
      dim === 'group'
        ? { type: 'bar', xKey: 'group', series: [{ key: 'attended', label: 'Attended' }, { key: 'absent', label: 'Absent' }, { key: 'excused', label: 'Excused' }] }
        : null,
    sources: [source('Group sessions', data.sessions.length), source('Group attendance', data.attendance.filter((a) => a.status !== 'unmarked').length)],
    notices: notices(data.kinds, data.sessions.length),
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}

export async function groupUtilizationReport(ctx: ReportContext, p: ResolvedParams): Promise<ReportOutput> {
  const data = await load(ctx, p);
  const summary = new Map(aggregateGroupReport(data.sessions, data.attendance).map((r) => [r.groupId, r]));
  const facilitators = await staffNames(ctx.organizationId, data.groups.map((g) => g.facilitatorId));
  const rows: ReportRow[] = data.groups
    .map((g) => {
      const r = summary.get(g.id);
      const avg = r?.averageGroupSize ?? null;
      return {
        group: g.name,
        kind: kindLabel(g.kind),
        type: isGroupKind(g.kind) ? groupTypeLabel(g.kind, g.groupType) : g.groupType,
        facilitator: g.facilitatorId ? facilitators.get(g.facilitatorId) ?? NO_PROVIDER : NO_PROVIDER,
        sessionsHeld: r?.sessionsHeld ?? 0,
        sessionsCancelled: r?.sessionsCancelled ?? 0,
        averageGroupSize: avg,
        capacity: g.capacity,
        utilization: avg != null && g.capacity ? pct(avg, g.capacity) : null,
        attendanceRate: r?.attendanceRate ?? null,
        notesUnsigned: r?.notesUnsigned ?? 0,
        claimsGenerated: r?.claimsGenerated ?? 0,
      };
    })
    .sort((a, b) => Number(b.sessionsHeld) - Number(a.sessionsHeld));
  const all = [...summary.values()];
  return {
    columns: [
      { key: 'group', label: 'Group', type: 'text' },
      { key: 'kind', label: 'Area', type: 'text' },
      { key: 'type', label: 'Type', type: 'text' },
      { key: 'facilitator', label: 'Facilitator', type: 'text' },
      { key: 'sessionsHeld', label: 'Sessions held', type: 'number' },
      { key: 'sessionsCancelled', label: 'Cancelled', type: 'number' },
      { key: 'averageGroupSize', label: 'Average group size', type: 'number' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'utilization', label: 'Utilization', type: 'percent', description: 'Average group size / capacity' },
      { key: 'attendanceRate', label: 'Attendance rate', type: 'percent' },
      { key: 'notesUnsigned', label: 'Notes unsigned', type: 'number' },
      { key: 'claimsGenerated', label: 'Claims generated', type: 'number' },
    ],
    rows,
    kpis: [
      { label: 'Active groups', value: data.groups.filter((g) => g.status === 'active').length, type: 'number' },
      { label: 'Sessions held', value: all.reduce((t, r) => t + r.sessionsHeld, 0), type: 'number' },
      { label: 'Notes unsigned', value: all.reduce((t, r) => t + r.notesUnsigned, 0), type: 'number' },
      { label: 'Claims generated', value: all.reduce((t, r) => t + r.claimsGenerated, 0), type: 'number' },
    ],
    chart: { type: 'bar', xKey: 'group', series: [{ key: 'sessionsHeld', label: 'Sessions held' }, { key: 'averageGroupSize', label: 'Average group size' }] },
    sources: [source('Groups', data.groups.length), source('Group sessions', data.sessions.length), source('Group attendance', data.attendance.length)],
    notices: [...notices(data.kinds, data.sessions.length), 'Claims generated = claims created from signed attendee notes (any claim status).'],
    hiddenSensitiveClients: await ctx.hiddenSensitiveClients(),
  };
}
