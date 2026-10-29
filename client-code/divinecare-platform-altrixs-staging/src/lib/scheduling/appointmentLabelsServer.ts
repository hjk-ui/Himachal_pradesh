/**
 * Calendar color labels: database side. Appointment."labelId" is not in the Prisma model
 * (same pattern as location_id), so it is read/written with raw SQL after a column check.
 * Every function is org-scoped.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { appointmentOrgWhere } from '@/lib/appointments/duplicates';
import {
  labelForMeaning,
  looksRescheduled,
  pickSuggestedMeaning,
  planValantLabelLoad,
  suggestLabelMeanings,
  toLabelDto,
  type AppointmentLabelChipData,
  type AppointmentLabelDto,
  type LabelMeaning,
} from './appointmentLabels';

// ─── Schema readiness ────────────────────────────────────────────────────────

let columnCache: { has: boolean; at: number } | null = null;

/** Appointment."labelId" exists only where 20261018_appointment_labels.sql ran. */
export async function hasAppointmentLabelColumn(): Promise<boolean> {
  if (columnCache && (columnCache.has || Date.now() - columnCache.at < 60_000)) return columnCache.has;
  try {
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM information_schema.columns
      WHERE table_name = 'Appointment' AND column_name = 'labelId'`;
    columnCache = { has: (rows[0]?.n ?? 0) > 0, at: Date.now() };
  } catch {
    columnCache = { has: false, at: Date.now() };
  }
  return columnCache.has;
}

function isMissingTable(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022');
}

export const LABELS_NOT_READY =
  'Calendar labels are not set up on this server yet (migration 20261018_appointment_labels has not run).';

// ─── Labels ──────────────────────────────────────────────────────────────────

export async function listOrgLabels(
  organizationId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<{ ready: boolean; labels: AppointmentLabelDto[] }> {
  try {
    const rows = await prisma.appointmentLabel.findMany({
      where: { organizationId, ...(opts.includeInactive ? {} : { active: true }) },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return { ready: true, labels: rows.map(toLabelDto) };
  } catch (err) {
    if (isMissingTable(err)) return { ready: false, labels: [] };
    throw err;
  }
}

export async function getLabelSettings(organizationId: string): Promise<{ autoApplySuggested: boolean }> {
  try {
    const row = await prisma.appointmentLabelSettings.findUnique({ where: { organizationId } });
    return { autoApplySuggested: Boolean(row?.autoApplySuggested) };
  } catch (err) {
    if (isMissingTable(err)) return { autoApplySuggested: false };
    throw err;
  }
}

export async function setAutoApplySuggested(organizationId: string, value: boolean, userId: string) {
  await prisma.appointmentLabelSettings.upsert({
    where: { organizationId },
    create: { organizationId, autoApplySuggested: value, updatedBy: userId },
    update: { autoApplySuggested: value, updatedBy: userId },
  });
}

/** Creates whichever of the 12 Valant labels the org does not have yet. Never overwrites. */
export async function loadValantLabels(organizationId: string, userId: string) {
  const existing = await prisma.appointmentLabel.findMany({
    where: { organizationId },
    select: { name: true, sortOrder: true },
  });
  const plan = planValantLabelLoad(existing);
  if (plan.length) {
    await prisma.appointmentLabel.createMany({
      data: plan.map((l) => ({
        organizationId,
        name: l.name,
        displayName: l.displayName,
        color: l.color,
        availability: l.availability,
        meaning: l.meaning,
        source: 'valant',
        sortOrder: l.sortOrder,
        active: true,
        createdBy: userId,
        updatedBy: userId,
      })),
      skipDuplicates: true,
    });
  }
  return { created: plan.map((l) => l.name), skipped: 12 - plan.length };
}

export async function createLabel(
  organizationId: string,
  userId: string,
  input: { name: string; displayName: string; color: string; availability: string; meaning?: string | null; active?: boolean }
) {
  const clash = await prisma.appointmentLabel.findFirst({
    where: { organizationId, name: { equals: input.name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (clash) return { ok: false as const, status: 409, error: 'A label with this name already exists' };
  const max = await prisma.appointmentLabel.aggregate({ where: { organizationId }, _max: { sortOrder: true } });
  const row = await prisma.appointmentLabel.create({
    data: {
      organizationId,
      name: input.name,
      displayName: input.displayName,
      color: input.color,
      availability: input.availability,
      meaning: input.meaning ?? null,
      active: input.active ?? true,
      source: 'altrixs',
      sortOrder: (max._max.sortOrder ?? -1) + 1,
      createdBy: userId,
      updatedBy: userId,
    },
  });
  return { ok: true as const, label: toLabelDto(row) };
}

export async function updateLabel(
  organizationId: string,
  id: string,
  userId: string,
  patch: Partial<{ displayName: string; color: string; availability: string; meaning: string | null; active: boolean; sortOrder: number }>
) {
  const existing = await prisma.appointmentLabel.findFirst({ where: { id, organizationId } });
  if (!existing) return { ok: false as const, status: 404, error: 'Label not found' };
  const data: Prisma.AppointmentLabelUpdateInput = { updatedBy: userId };
  for (const k of ['displayName', 'color', 'availability', 'meaning', 'active', 'sortOrder'] as const) {
    if (patch[k] !== undefined) (data as Record<string, unknown>)[k] = patch[k];
  }
  const row = await prisma.appointmentLabel.update({ where: { id }, data });
  const changed = Object.keys(patch).filter((k) => patch[k as keyof typeof patch] !== undefined).sort();
  return { ok: true as const, label: toLabelDto(row), changed, before: toLabelDto(existing) };
}

/** Sets sortOrder from the given id order; ids from another org are ignored. */
export async function reorderLabels(organizationId: string, ids: string[], userId: string) {
  const own = await prisma.appointmentLabel.findMany({ where: { organizationId }, select: { id: true } });
  const ownIds = new Set(own.map((r) => r.id));
  const ordered = ids.filter((id, i) => ownIds.has(id) && ids.indexOf(id) === i);
  const rest = own.map((r) => r.id).filter((id) => !ordered.includes(id));
  await prisma.$transaction(
    [...ordered, ...rest].map((id, i) =>
      prisma.appointmentLabel.update({ where: { id }, data: { sortOrder: i, updatedBy: userId } })
    )
  );
  return ordered.length;
}

// ─── Appointment ↔ label ────────────────────────────────────────────────────

export async function labelIdsForAppointments(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!ids.length || !(await hasAppointmentLabelColumn())) return out;
  const rows = await prisma.$queryRaw<{ id: string; labelId: string | null }[]>`
    SELECT "id", "labelId" FROM "Appointment" WHERE "id" = ANY(${ids}::text[]) AND "labelId" IS NOT NULL`;
  for (const r of rows) out.set(r.id, r.labelId);
  return out;
}

/** Caller has already checked the appointment belongs to the org and the actor may edit it. */
export async function writeAppointmentLabelId(
  organizationId: string,
  appointmentId: string,
  labelId: string | null
): Promise<{ ok: true; label: AppointmentLabelDto | null } | { ok: false; status: number; error: string }> {
  if (!(await hasAppointmentLabelColumn())) return { ok: false, status: 503, error: LABELS_NOT_READY };
  let label: AppointmentLabelDto | null = null;
  if (labelId) {
    const row = await prisma.appointmentLabel.findFirst({ where: { id: labelId, organizationId } });
    if (!row) return { ok: false, status: 404, error: 'Label not found' };
    if (!row.active) return { ok: false, status: 400, error: 'This label is turned off in Scheduling settings' };
    label = toLabelDto(row);
  }
  await prisma.$executeRaw`UPDATE "Appointment" SET "labelId" = ${labelId}, "updatedAt" = NOW() WHERE "id" = ${appointmentId}`;
  return { ok: true, label };
}

type RowForLabels = {
  id: string;
  clientId: string;
  startsAt: Date;
  status: string;
  isVirtual: boolean;
  notes: string | null;
  rescheduleRequestedAt?: Date | null;
};

const NOT_A_VISIT = ['CANCELLED', 'LATE_CANCEL', 'NO_SHOW'] as const;

const UI_STATUS: Record<string, string> = {
  SCHEDULED: 'scheduled',
  CHECKED_IN: 'checked-in',
  IN_SESSION: 'in-session',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no-show',
  LATE_CANCEL: 'late-cancel',
};

export type LabelFields = {
  labelId: string | null;
  label: AppointmentLabelChipData | null;
  /** Meaning of the label Altrixs suggests (one-click chip); null when nothing to suggest */
  suggestedLabelMeaning: LabelMeaning | null;
};

/**
 * Label + suggestion per appointment. "New" is only suggested for clients created in Altrixs
 * (imported clients are existing patients) whose earliest kept appointment is this one.
 */
export async function labelFieldsFor(organizationId: string, rows: RowForLabels[]): Promise<Map<string, LabelFields>> {
  const out = new Map<string, LabelFields>();
  if (!rows.length) return out;
  const [idMap, { labels }] = await Promise.all([
    labelIdsForAppointments(rows.map((r) => r.id)),
    listOrgLabels(organizationId, { includeInactive: true }),
  ]);
  const byId = new Map(labels.map((l) => [l.id, l]));

  const clientIds = [...new Set(rows.map((r) => r.clientId))];
  const [firsts, clients] = labels.length
    ? await Promise.all([
        prisma.appointment.groupBy({
          by: ['clientId'],
          where: { clientId: { in: clientIds }, status: { notIn: [...NOT_A_VISIT] } },
          _min: { startsAt: true },
        }),
        prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, importedAt: true } }),
      ])
    : [[], []];
  const firstAt = new Map(firsts.map((f) => [f.clientId, f._min.startsAt?.getTime() ?? null]));
  const imported = new Set(clients.filter((c) => c.importedAt).map((c) => c.id));

  for (const r of rows) {
    const labelId = idMap.get(r.id) ?? null;
    const l = labelId ? byId.get(labelId) ?? null : null;
    const chip: AppointmentLabelChipData | null = l
      ? { id: l.id, name: l.name, displayName: l.displayName, color: l.color, textColor: l.textColor, meaning: l.meaning }
      : null;
    let suggested: LabelMeaning | null = null;
    if (labels.length) {
      const meanings = suggestLabelMeanings({
        isVirtual: r.isVirtual,
        status: UI_STATUS[r.status] ?? r.status,
        rescheduled: looksRescheduled(r),
        isFirstAppointment: !imported.has(r.clientId) && firstAt.get(r.clientId) === r.startsAt.getTime(),
        confirmed: null,
      });
      // Only offer meanings the practice has an active label for
      const offerable = meanings.filter((m) => labelForMeaning(labels, m));
      suggested = pickSuggestedMeaning(offerable, l?.meaning ?? null, Boolean(l));
    }
    out.set(r.id, { labelId: l ? labelId : null, label: chip, suggestedLabelMeaning: suggested });
  }
  return out;
}

export async function withLabelFields<T extends { id: string }>(
  organizationId: string,
  rows: RowForLabels[],
  dtos: T[]
): Promise<Array<T & LabelFields>> {
  let fields = new Map<string, LabelFields>();
  try {
    fields = await labelFieldsFor(organizationId, rows);
  } catch (err) {
    // Labels are decoration: never fail an appointment list because of them
    console.error('[appointment labels] enrich failed', err);
  }
  return dtos.map((d) => ({ ...d, ...(fields.get(d.id) ?? { labelId: null, label: null, suggestedLabelMeaning: null }) }));
}

/**
 * After create / status change: when the practice turned on auto-apply and the appointment has
 * no label, apply the suggested one. Returns the meaning applied (for the audit entry) or null.
 */
export async function autoApplySuggestedLabel(organizationId: string, row: RowForLabels): Promise<LabelMeaning | null> {
  try {
    const { autoApplySuggested } = await getLabelSettings(organizationId);
    if (!autoApplySuggested) return null;
    const f = (await labelFieldsFor(organizationId, [row])).get(row.id);
    if (!f || f.labelId || !f.suggestedLabelMeaning) return null;
    const { labels } = await listOrgLabels(organizationId);
    const target = labelForMeaning(labels, f.suggestedLabelMeaning);
    if (!target) return null;
    const res = await writeAppointmentLabelId(organizationId, row.id, target.id);
    return res.ok ? f.suggestedLabelMeaning : null;
  } catch (err) {
    console.error('[appointment labels] auto-apply failed', err);
    return null;
  }
}

export const BACKFILL_DAYS_BACK = 90;

/**
 * Apply the suggested label to EXISTING unlabeled appointments (auto-apply otherwise only runs on
 * create / status change, so turning it on never touched the calendar already on screen).
 * Window: the last 90 days and everything upcoming. Never overwrites a label someone chose
 * (the UPDATE re-checks "labelId" IS NULL). Returns counts per label display name.
 */
export async function applySuggestedLabelsToExisting(
  organizationId: string,
  opts: { now?: Date; daysBack?: number } = {}
): Promise<{ scanned: number; labelled: number; byLabel: Record<string, number> }> {
  const result = { scanned: 0, labelled: 0, byLabel: {} as Record<string, number> };
  if (!(await hasAppointmentLabelColumn())) return result;
  const { labels } = await listOrgLabels(organizationId);
  if (!labels.length) return result;

  const from = new Date((opts.now ?? new Date()).getTime() - (opts.daysBack ?? BACKFILL_DAYS_BACK) * 86_400_000);
  const BATCH = 500;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.appointment.findMany({
      where: { AND: [appointmentOrgWhere(organizationId), { labelId: null, startsAt: { gte: from } }] },
      select: { id: true, clientId: true, startsAt: true, status: true, isVirtual: true, notes: true, rescheduleRequestedAt: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    result.scanned += rows.length;

    const fields = await labelFieldsFor(organizationId, rows);
    const idsByLabel = new Map<string, string[]>();
    for (const r of rows) {
      const meaning = fields.get(r.id)?.suggestedLabelMeaning;
      const target = meaning ? labelForMeaning(labels, meaning) : null;
      if (!target) continue;
      idsByLabel.set(target.id, [...(idsByLabel.get(target.id) ?? []), r.id]);
    }
    for (const [labelId, ids] of idsByLabel) {
      const n = await prisma.$executeRaw`
        UPDATE "Appointment" SET "labelId" = ${labelId}, "updatedAt" = NOW()
        WHERE "id" = ANY(${ids}::text[]) AND "labelId" IS NULL`;
      const name = labels.find((l) => l.id === labelId)?.displayName ?? labelId;
      result.byLabel[name] = (result.byLabel[name] ?? 0) + n;
      result.labelled += n;
    }
    if (rows.length < BATCH) break;
  }
  return result;
}

/**
 * Suggestion for an appointment that is being booked (form preview), all offerable meanings in priority order. "New" only when the client
 * was created in Altrixs (not imported) and has no kept appointment yet.
 */
export async function suggestForNewAppointment(
  organizationId: string,
  client: { id: string; importedAt: Date | null },
  isVirtual: boolean
): Promise<LabelMeaning[]> {
  const { labels } = await listOrgLabels(organizationId);
  if (!labels.length) return [];
  const kept = client.importedAt
    ? 1
    : await prisma.appointment.count({ where: { clientId: client.id, status: { notIn: [...NOT_A_VISIT] } } });
  const meanings = suggestLabelMeanings({ isVirtual, status: 'scheduled', isFirstAppointment: kept === 0, confirmed: null });
  return meanings.filter((m) => labelForMeaning(labels, m));
}
