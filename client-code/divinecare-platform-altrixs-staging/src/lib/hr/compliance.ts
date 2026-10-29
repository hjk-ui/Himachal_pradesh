/**
 * Staff compliance records (TB, immunizations, background, fingerprints, I-9, CAQH, Medicaid
 * ePREP) and exclusion checks (OIG LEIE, SAM.gov, Maryland Medicaid). Exclusion checks are
 * recorded by a person (date, result, by whom); an automated screening feed is a future
 * integration. Rows are append-only for exclusions.
 */
import { prisma } from '@/lib/db/prisma';
import { COMPLIANCE_KIND_KEYS, EXCLUSION_SOURCE_KEYS, dateOnlyValue, exclusionDue, ymd } from './standard';
import { assertOrgUser, isMissingTable, loadHrSettings, loadRoster, practiceTodayFor, type HrCtx } from './server';

export type ComplianceInput = {
  userId: string;
  kind: string;
  label?: string | null;
  completedOn?: string | null;
  expiresOn?: string | null;
  status?: string;
  result?: string | null;
  identifier?: string | null;
  notes?: string | null;
};

export async function createComplianceRecord(ctx: HrCtx, input: ComplianceInput) {
  if (!COMPLIANCE_KIND_KEYS.includes(input.kind as never)) return { ok: false as const, status: 400, error: 'Unknown record type' };
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  const row = await prisma.staffComplianceRecord.create({
    data: {
      organizationId: ctx.organizationId,
      userId: staff.id,
      kind: input.kind,
      label: input.label?.trim() || null,
      completedOn: dateOnlyValue(input.completedOn ?? null),
      expiresOn: dateOnlyValue(input.expiresOn ?? null),
      status: input.status || 'complete',
      result: input.result?.trim() || null,
      identifier: input.identifier?.trim() || null,
      notes: input.notes?.trim() || null,
      verifiedById: ctx.userId,
      verifiedByName: ctx.name,
      createdById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id, userId: row.userId };
}

export async function updateComplianceRecord(ctx: HrCtx, id: string, input: Partial<ComplianceInput>) {
  const existing = await prisma.staffComplianceRecord.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) return { ok: false as const, status: 404, error: 'Record not found' };
  await prisma.staffComplianceRecord.update({
    where: { id },
    data: {
      ...(input.label !== undefined ? { label: input.label?.trim() || null } : {}),
      ...(input.completedOn !== undefined ? { completedOn: dateOnlyValue(input.completedOn) } : {}),
      ...(input.expiresOn !== undefined ? { expiresOn: dateOnlyValue(input.expiresOn) } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.result !== undefined ? { result: input.result?.trim() || null } : {}),
      ...(input.identifier !== undefined ? { identifier: input.identifier?.trim() || null } : {}),
      ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
      verifiedById: ctx.userId,
      verifiedByName: ctx.name,
    },
  });
  return { ok: true as const, userId: existing.userId };
}

export async function deleteComplianceRecord(ctx: HrCtx, id: string) {
  const existing = await prisma.staffComplianceRecord.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!existing) return { ok: false as const, status: 404, error: 'Record not found' };
  await prisma.staffComplianceRecord.delete({ where: { id } });
  return { ok: true as const, userId: existing.userId, kind: existing.kind };
}

// ─── Exclusion checks ────────────────────────────────────────────────────────

export type ExclusionInput = {
  userIds: string[];
  sources: string[];
  checkedOn: string;
  result: 'clear' | 'possible_match' | 'match';
  reference?: string | null;
  notes?: string | null;
};

/**
 * Record one check (or a monthly batch: many staff x sources, all with the same result). A
 * possible match / match is recorded per person; the UI asks HR to record those one at a time.
 */
export async function recordExclusionChecks(ctx: HrCtx, input: ExclusionInput) {
  const sources = input.sources.filter((s) => EXCLUSION_SOURCE_KEYS.includes(s as never));
  if (!sources.length) return { ok: false as const, status: 400, error: 'Choose at least one list' };
  if (input.result !== 'clear' && input.userIds.length !== 1) {
    return { ok: false as const, status: 400, error: 'Record a possible match for one person at a time' };
  }
  const users = await prisma.user.findMany({
    where: { id: { in: input.userIds }, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (users.length !== new Set(input.userIds).size) return { ok: false as const, status: 400, error: 'Some staff are not in this practice' };
  const checkedOn = dateOnlyValue(input.checkedOn);
  if (!checkedOn) return { ok: false as const, status: 400, error: 'Invalid check date' };
  const data = users.flatMap((u) =>
    sources.map((source) => ({
      organizationId: ctx.organizationId,
      userId: u.id,
      source,
      checkedOn,
      result: input.result,
      reference: input.reference?.trim() || null,
      notes: input.notes?.trim() || null,
      checkedById: ctx.userId,
      checkedByName: ctx.name,
    })),
  );
  await prisma.hrExclusionCheck.createMany({ data });
  return { ok: true as const, count: data.length };
}

export async function exclusionBoard(organizationId: string) {
  const [roster, settings, today] = await Promise.all([loadRoster(organizationId), loadHrSettings(organizationId), practiceTodayFor(organizationId)]);
  let checks: Array<{ userId: string; source: string; checkedOn: Date; result: string; checkedByName: string | null }> = [];
  try {
    checks = await prisma.hrExclusionCheck.findMany({
      where: { organizationId },
      orderBy: { checkedOn: 'desc' },
      select: { userId: true, source: true, checkedOn: true, result: true, checkedByName: true },
      take: 5000,
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) {
    const k = `${c.userId}|${c.source}`;
    if (!latest.has(k)) latest.set(k, c);
  }
  const rows = roster
    .filter((p) => p.hrStatus !== 'Terminated')
    .map((p) => ({
      userId: p.userId,
      name: p.name,
      jobTitle: p.jobTitle,
      sources: Object.fromEntries(
        EXCLUSION_SOURCE_KEYS.map((s) => {
          const last = latest.get(`${p.userId}|${s}`);
          const due = exclusionDue(last ? ymd(last.checkedOn) : null, today, settings.exclusionCheckIntervalDays);
          return [
            s,
            {
              lastCheckedOn: last ? ymd(last.checkedOn) : null,
              result: last?.result ?? null,
              checkedByName: last?.checkedByName ?? null,
              dueOn: due.dueOn,
              status: due.status,
            },
          ];
        }),
      ),
    }));
  return { rows, today, intervalDays: settings.exclusionCheckIntervalDays };
}
