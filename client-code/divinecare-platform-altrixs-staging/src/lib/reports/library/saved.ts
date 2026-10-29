/**
 * Saved reports + scheduled delivery (server). Rows live in report_saved_views (migration
 * 20261019_report_library.sql). Owner-only: a user lists, edits and deletes their own rows.
 * Scheduled delivery runs from the notifications cron and emails the owner a sign-in link.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { sendEmail } from '@/lib/mail/sendEmail';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { canRunReport } from './access';
import { getReport } from './registry';
import {
  SAVED_VIEWS_PER_USER,
  isSchedule,
  nextScheduledRun,
  savedParamsFor,
  savedReportPath,
  scheduleLabel,
  scheduledEmail,
  type Schedule,
} from './schedule';

export type SavedViewDto = {
  id: string;
  reportId: string;
  reportTitle: string;
  name: string;
  params: Record<string, string>;
  schedule: Schedule;
  scheduleHour: number;
  scheduleWeekday: number | null;
  scheduleText: string;
  nextRunAt: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  href: string;
};

export class SavedViewError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 = 400) {
    super(message);
  }
}

type Owner = { organizationId: string; userId: string; role: string; capabilities?: { medicalDirector?: boolean } | null };

function isMissingTable(err: unknown) {
  const code = (err as { code?: string })?.code;
  return code === 'P2021' || code === 'P2022';
}

function toDto(r: {
  id: string; reportId: string; name: string; params: unknown; schedule: string; scheduleHour: number; scheduleWeekday: number | null;
  nextRunAt: Date | null; lastSentAt: Date | null; lastError: string | null;
}): SavedViewDto | null {
  const def = getReport(r.reportId);
  if (!def) return null;
  const params = r.params && typeof r.params === 'object' && !Array.isArray(r.params)
    ? Object.fromEntries(Object.entries(r.params as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
    : {};
  const schedule = isSchedule(r.schedule) ? r.schedule : 'none';
  return {
    id: r.id, reportId: r.reportId, reportTitle: def.title, name: r.name, params, schedule,
    scheduleHour: r.scheduleHour, scheduleWeekday: r.scheduleWeekday, scheduleText: scheduleLabel(schedule, r.scheduleHour, r.scheduleWeekday),
    nextRunAt: r.nextRunAt?.toISOString() ?? null, lastSentAt: r.lastSentAt?.toISOString() ?? null, lastError: r.lastError,
    href: savedReportPath(r.reportId, r.id, params),
  };
}

export async function listSavedViews(owner: Owner): Promise<{ views: SavedViewDto[]; available: boolean }> {
  try {
    const rows = await prisma.reportSavedView.findMany({ where: { organizationId: owner.organizationId, userId: owner.userId }, orderBy: { createdAt: 'desc' } });
    const views = rows
      .filter((r) => {
        const def = getReport(r.reportId);
        return Boolean(def && canRunReport(def, owner.role, owner.capabilities));
      })
      .map(toDto)
      .filter((x): x is SavedViewDto => Boolean(x));
    return { views, available: true };
  } catch (err) {
    if (isMissingTable(err)) return { views: [], available: false };
    throw err;
  }
}

type SaveInput = { reportId?: unknown; name?: unknown; params?: unknown; schedule?: unknown; scheduleHour?: unknown; scheduleWeekday?: unknown };

function cleanName(v: unknown): string {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 120) : '';
  if (!s) throw new SavedViewError('Give the saved report a name');
  return s;
}

function cleanSchedule(input: SaveInput) {
  const schedule: Schedule = isSchedule(input.schedule) ? input.schedule : 'none';
  const hour = Number.isInteger(Number(input.scheduleHour)) ? Math.min(23, Math.max(0, Number(input.scheduleHour))) : 7;
  const weekday = schedule === 'weekly' ? (Number.isInteger(Number(input.scheduleWeekday)) ? Math.min(6, Math.max(0, Number(input.scheduleWeekday))) : 1) : null;
  return { schedule, hour, weekday };
}

export async function createSavedView(owner: Owner, input: SaveInput): Promise<SavedViewDto> {
  const def = typeof input.reportId === 'string' ? getReport(input.reportId) : null;
  if (!def) throw new SavedViewError('Unknown report', 404);
  if (!canRunReport(def, owner.role, owner.capabilities)) throw new SavedViewError('You do not have access to this report', 403);
  const name = cleanName(input.name);
  const raw = input.params && typeof input.params === 'object' && !Array.isArray(input.params) ? (input.params as Record<string, unknown>) : {};
  const p = savedParamsFor(def, raw);
  if ('error' in p) throw new SavedViewError(p.error);
  const { schedule, hour, weekday } = cleanSchedule(input);
  const count = await prisma.reportSavedView.count({ where: { organizationId: owner.organizationId, userId: owner.userId } });
  if (count >= SAVED_VIEWS_PER_USER) throw new SavedViewError(`You can save up to ${SAVED_VIEWS_PER_USER} reports`, 409);
  const tz = await getPracticeTimeZone(owner.organizationId);
  const row = await prisma.reportSavedView.create({
    data: {
      organizationId: owner.organizationId, userId: owner.userId, reportId: def.id, name, params: p.params,
      schedule, scheduleHour: hour, scheduleWeekday: weekday, nextRunAt: nextScheduledRun(schedule, hour, weekday, new Date(), tz),
    },
  });
  return toDto(row) as SavedViewDto;
}

export async function updateSavedView(owner: Owner, id: string, input: SaveInput): Promise<SavedViewDto> {
  const row = await prisma.reportSavedView.findFirst({ where: { id, organizationId: owner.organizationId, userId: owner.userId } });
  if (!row) throw new SavedViewError('Saved report not found', 404);
  const data: { name?: string; schedule?: string; scheduleHour?: number; scheduleWeekday?: number | null; nextRunAt?: Date | null; lastError?: null } = {};
  if (input.name !== undefined) data.name = cleanName(input.name);
  if (input.schedule !== undefined) {
    const { schedule, hour, weekday } = cleanSchedule(input);
    const tz = await getPracticeTimeZone(owner.organizationId);
    Object.assign(data, { schedule, scheduleHour: hour, scheduleWeekday: weekday, nextRunAt: nextScheduledRun(schedule, hour, weekday, new Date(), tz), lastError: null });
  }
  const updated = await prisma.reportSavedView.update({ where: { id: row.id }, data });
  return toDto(updated) as SavedViewDto;
}

export async function deleteSavedView(owner: Owner, id: string): Promise<void> {
  const res = await prisma.reportSavedView.deleteMany({ where: { id, organizationId: owner.organizationId, userId: owner.userId } });
  if (!res.count) throw new SavedViewError('Saved report not found', 404);
}

function appBaseUrl(): string {
  return (process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * Cron: email every due schedule. Each row is claimed first (nextRunAt moved forward with a
 * conditional update), so two cron runs never send the same delivery twice. The owner must still
 * be an active account of the organization with access to the report; otherwise nothing is sent.
 */
export async function runReportSchedules(now = new Date()): Promise<{ due: number; sent: number; skipped: number; failed: number }> {
  const out = { due: 0, sent: 0, skipped: 0, failed: 0 };
  let rows;
  try {
    rows = await prisma.reportSavedView.findMany({
      where: { schedule: { in: ['daily', 'weekly', 'monthly'] }, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: 200,
    });
  } catch (err) {
    if (isMissingTable(err)) return out;
    throw err;
  }
  out.due = rows.length;
  for (const row of rows) {
    const schedule = isSchedule(row.schedule) ? row.schedule : 'none';
    const tz = await getPracticeTimeZone(row.organizationId);
    const next = nextScheduledRun(schedule, row.scheduleHour, row.scheduleWeekday, now, tz);
    const claim = await prisma.reportSavedView.updateMany({ where: { id: row.id, nextRunAt: row.nextRunAt }, data: { nextRunAt: next } });
    if (!claim.count) continue;
    const def = getReport(row.reportId);
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true, role: true, status: true, organizationId: true, isMedicalDirector: true } });
    const allowed = Boolean(def && user && user.status === 'ACTIVE' && user.organizationId === row.organizationId && canRunReport(def, user.role, { medicalDirector: user.isMedicalDirector }));
    if (!allowed || !def || !user) {
      out.skipped++;
      await prisma.reportSavedView.update({ where: { id: row.id }, data: { lastError: 'Not sent: the account no longer has access to this report' } });
      continue;
    }
    const params = row.params && typeof row.params === 'object' && !Array.isArray(row.params)
      ? Object.fromEntries(Object.entries(row.params as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
      : {};
    const mail = scheduledEmail({ reportTitle: def.title, url: `${appBaseUrl()}${savedReportPath(def.id, row.id, params)}`, scheduleText: scheduleLabel(schedule, row.scheduleHour, row.scheduleWeekday) });
    try {
      await sendEmail({ to: user.email, subject: mail.subject, text: mail.text, html: mail.html, context: 'report-schedule' });
      await prisma.reportSavedView.update({ where: { id: row.id }, data: { lastSentAt: now, lastError: null } });
      await writeAuditLog({
        action: 'REPORT_SCHEDULE_SENT', actorUserId: row.userId, actorRole: user.role, organizationId: row.organizationId,
        resourceType: 'reportSavedView', resourceId: row.id, metadata: { reportId: def.id, schedule },
      });
      out.sent++;
    } catch (err) {
      out.failed++;
      await prisma.reportSavedView.update({ where: { id: row.id }, data: { lastError: `Email not sent: ${err instanceof Error ? err.message.slice(0, 150) : 'unknown error'}` } });
    }
  }
  return out;
}
