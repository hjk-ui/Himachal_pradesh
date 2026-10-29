/**
 * Helpers shared by the report runners (server).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { addDaysYmd, practiceDayStart } from '../params';
import type { ReportContext } from '../context';
import type { ReportSource, ResolvedParams } from '../types';

export const NO_SITE = 'No site on chart';
export const NO_PROVIDER = 'No provider';
export const UNSPECIFIED = 'Not recorded';

export function requireRange(p: ResolvedParams): NonNullable<ResolvedParams['range']> {
  if (!p.range) throw new Error('This report needs a date range');
  return p.range;
}

/** YYYY-MM-DD of an instant on the practice clock. */
export function ymdIn(at: Date, tz: string): string {
  return toPracticeWallTime(at, tz).date;
}

/** YYYY-MM of an instant on the practice clock. */
export function monthIn(at: Date, tz: string): string {
  return ymdIn(at, tz).slice(0, 7);
}

/** YYYY-MM of a calendar-date column (UTC midnight / noon storage). */
export function monthOfDateOnly(d: Date): string {
  return d.toISOString().slice(0, 7);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Calendar months overlapping [fromDate, toDate], each with practice-time bounds clipped to the range. */
export function monthBuckets(range: NonNullable<ResolvedParams['range']>, tz: string): { key: string; from: Date; toExclusive: Date }[] {
  const out: { key: string; from: Date; toExclusive: Date }[] = [];
  let cursor = `${range.fromDate.slice(0, 7)}-01`;
  while (cursor <= range.toDate) {
    const key = cursor.slice(0, 7);
    const [y, m] = key.split('-').map(Number);
    const next = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    const fromYmd = cursor < range.fromDate ? range.fromDate : cursor;
    const endYmd = next > addDaysYmd(range.toDate, 1) ? addDaysYmd(range.toDate, 1) : next;
    out.push({ key, from: practiceDayStart(fromYmd, tz), toExclusive: practiceDayStart(endYmd, tz) });
    cursor = next;
    if (out.length > 60) break;
  }
  return out;
}

/** Display names for staff ids (same organization only). */
export async function staffNames(organizationId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (!unique.length) return new Map();
  const rows = await prisma.user.findMany({ where: { id: { in: unique }, organizationId }, select: { id: true, name: true, email: true } });
  return new Map(rows.map((r) => [r.id, r.name || r.email]));
}

export async function siteList(organizationId: string): Promise<{ id: string; name: string }[]> {
  return prisma.location.findMany({ where: { organizationId }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
}

/** Sites to group by: the filtered site only, else every org location + "no site". */
export async function siteBuckets(ctx: ReportContext): Promise<{ id: string | null; name: string }[]> {
  const all = await siteList(ctx.organizationId);
  if (ctx.scope.locationId) return all.filter((s) => s.id === ctx.scope.locationId);
  return [...all, { id: null, name: NO_SITE }];
}

/** Client filter for one site bucket (null = clients with no home location). */
export function clientAtSite(ctx: ReportContext, siteId: string | null, byAssignee = false): Prisma.ClientWhereInput {
  return { AND: [ctx.clientWhere({ byAssignee }), { locationId: siteId }] };
}

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function dateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Source descriptor helper: empty when the scoped count is 0. */
export function source(name: string, rows: number, asOf?: Date | string | null, note?: string): ReportSource {
  return {
    name,
    rows,
    empty: rows === 0,
    asOf: asOf ? (typeof asOf === 'string' ? asOf : asOf.toISOString()) : null,
    ...(note ? { note } : {}),
  };
}

export function sortByLabel<T extends Record<string, unknown>>(rows: T[], key = 'group'): T[] {
  return rows.sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')));
}

export function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function daysFromToday(target: Date, now: Date): number {
  return Math.floor((target.getTime() - now.getTime()) / 86_400_000);
}
