/**
 * Client diagnosis list: database reads and writes (ClientDiagnosis / ClientDiagnosisEvent /
 * ClientDiagnosisSuggestion, prisma/migrations/20261025_diagnosis_list.sql). Rules in ./model and
 * ./rules. Every write runs in one transaction that also writes the history event and the derived
 * Client.primaryDiagnosis / primaryDiagnosisCode / secondaryDiagnoses. Callers (API routes) check
 * access (resolveChartAccess: org, care team, Part 2) and write the HIPAA audit entry.
 *
 * Before a client's list exists (no rows yet), reads fall back to the client-record fields
 * (rows marked `legacy`); the first write turns them into rows (source LEGACY_CHART).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { ICD10_FISCAL_YEAR } from '@/lib/icd10/normalize';
import { checkIcd10Code } from '@/lib/icd10/validate';
import { dsmNameFor } from './dsm5tr';
import {
  CURRENT_STATUSES,
  REASON_REQUIRED,
  applyOrder,
  canChangeStatus,
  deriveLegacyFields,
  displayCode,
  isCurrent,
  moveDiagnosis,
  normalizeRanks,
  parseLegacyDiagnoses,
  reviewState,
  type DiagnosisRow,
  type DiagnosisStatus,
  type LegacyDiagnosisFields,
  type ReviewContext,
  type ReviewState,
} from './model';
import { checkChartDiagnosisCode, type DxIssue } from './rules';

type Tx = Prisma.TransactionClient;

export type DxActor = { organizationId: string; userId: string; name?: string | null };

export type DxResult<T> = ({ ok: true; error?: undefined; status?: undefined } & T) | { ok: false; status: number; error: string; issues?: DxIssue[] };

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (s: string | null | undefined) => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`) : null);

const SELECT = {
  id: true,
  code: true,
  description: true,
  dsmName: true,
  rank: true,
  isPrimary: true,
  status: true,
  onsetDate: true,
  resolvedDate: true,
  statusReason: true,
  diagnosingProviderName: true,
  source: true,
  updatedAt: true,
  createdAt: true,
} as const;

type DbRow = Prisma.ClientDiagnosisGetPayload<{ select: typeof SELECT }>;

function toRow(r: DbRow): DiagnosisRow {
  return {
    id: r.id,
    code: r.code,
    description: r.description,
    dsmName: r.dsmName,
    rank: r.rank,
    isPrimary: r.isPrimary,
    status: r.status as DiagnosisStatus,
    onsetDate: day(r.onsetDate),
    resolvedDate: day(r.resolvedDate),
    statusReason: r.statusReason,
    diagnosingProviderName: r.diagnosingProviderName,
    source: r.source,
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function isMissingDiagnosisTable(err: unknown): boolean {
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  const message = err instanceof Error ? err.message : String(err);
  return code === 'P2021' || code === 'P2022' || (/ClientDiagnosis|diagnosisReviewDays/.test(message) && /does not exist/i.test(message));
}

const MIGRATION_ERROR = 'The diagnosis list needs database migration 20261025_diagnosis_list.sql. Ask an administrator to run it.';

function describe(code: string | null): string {
  if (!code) return '';
  try {
    return checkIcd10Code(code).description || '';
  } catch {
    return '';
  }
}

/** Client-record diagnoses as list rows (not saved). */
export function legacyRows(c: { primaryDiagnosisCode?: string | null; primaryDiagnosis?: string | null; secondaryDiagnoses?: string | null }): DiagnosisRow[] {
  return parseLegacyDiagnoses(c).map((p, i) => ({
    id: `legacy-${i + 1}`,
    code: p.code,
    description: p.description || describe(p.code) || p.code || '',
    dsmName: dsmNameFor(p.code),
    rank: p.rank,
    isPrimary: p.rank === 1,
    status: 'ACTIVE',
    onsetDate: null,
    resolvedDate: null,
    statusReason: null,
    diagnosingProviderName: null,
    source: 'LEGACY_CHART',
    legacy: true,
  }));
}

/** The client's list (rank order, current first), falling back to the client record. */
export async function loadDiagnosisList(organizationId: string, clientId: string): Promise<{ rows: DiagnosisRow[]; structured: boolean; migrated: boolean }> {
  try {
    const rows = await prisma.clientDiagnosis.findMany({
      where: { organizationId, clientId },
      select: SELECT,
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
    if (rows.length) return { rows: sortForDisplay(rows.map(toRow)), structured: true, migrated: true };
  } catch (err) {
    if (!isMissingDiagnosisTable(err)) throw err;
    const c = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true } });
    return { rows: c ? legacyRows(c) : [], structured: false, migrated: false };
  }
  const c = await prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true } });
  return { rows: c ? legacyRows(c) : [], structured: false, migrated: true };
}

/** Saved lists for many clients (scrubber, overview). Clients without rows are absent. */
export async function loadDiagnosisListsFor(organizationId: string, clientIds: string[]): Promise<Map<string, DiagnosisRow[]>> {
  const out = new Map<string, DiagnosisRow[]>();
  if (!clientIds.length) return out;
  try {
    const rows = await prisma.clientDiagnosis.findMany({
      where: { organizationId, clientId: { in: [...new Set(clientIds)] } },
      select: { ...SELECT, clientId: true },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
    for (const r of rows) {
      const list = out.get(r.clientId) ?? [];
      list.push(toRow(r));
      out.set(r.clientId, list);
    }
  } catch (err) {
    if (!isMissingDiagnosisTable(err)) throw err;
  }
  for (const [k, v] of out) out.set(k, sortForDisplay(v));
  return out;
}

/** Current diagnoses by rank, then history (most recently changed first). */
export function sortForDisplay(rows: DiagnosisRow[]): DiagnosisRow[] {
  const current = rows.filter(isCurrent).sort((a, b) => a.rank - b.rank);
  const past = rows.filter((r) => !isCurrent(r)).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return [...current, ...past];
}

export async function loadReviewState(organizationId: string, clientId: string, now = new Date()): Promise<ReviewState> {
  const [last, policy] = await Promise.all([
    prisma.clientDiagnosisEvent
      .findFirst({ where: { organizationId, clientId, action: 'REVIEWED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, actorName: true } })
      .catch(() => null),
    prisma.notePolicySettings.findUnique({ where: { organizationId }, select: { diagnosisReviewDays: true } }).catch(() => null),
  ]);
  return reviewState({ lastReviewedAt: last?.createdAt ?? null, lastReviewedBy: last?.actorName ?? null, intervalDays: policy?.diagnosisReviewDays, now });
}

export async function loadDiagnosisHistory(organizationId: string, clientId: string, take = 200) {
  try {
    const rows = await prisma.clientDiagnosisEvent.findMany({
      where: { organizationId, clientId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, diagnosisId: true, action: true, context: true, before: true, after: true, reason: true, actorName: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  } catch (err) {
    if (isMissingDiagnosisTable(err)) return [];
    throw err;
  }
}

// ─── Writes ─────────────────────────────────────────────────────────────────

function snapshot(r: Partial<DiagnosisRow> | null | undefined) {
  if (!r) return null;
  return {
    code: r.code ?? null,
    description: r.description ?? null,
    dsmName: r.dsmName ?? null,
    rank: r.rank ?? null,
    status: r.status ?? null,
    onsetDate: r.onsetDate ?? null,
    resolvedDate: r.resolvedDate ?? null,
  } as Prisma.InputJsonValue;
}

async function writeEvent(
  tx: Tx,
  actor: DxActor,
  clientId: string,
  e: { diagnosisId?: string | null; action: string; context?: ReviewContext | string | null; before?: Prisma.InputJsonValue | null; after?: Prisma.InputJsonValue | null; reason?: string | null }
) {
  await tx.clientDiagnosisEvent.create({
    data: {
      organizationId: actor.organizationId,
      clientId,
      diagnosisId: e.diagnosisId ?? null,
      action: e.action,
      context: e.context ?? 'manual',
      before: e.before ?? undefined,
      after: e.after ?? undefined,
      reason: e.reason?.slice(0, 1000) ?? null,
      actorId: actor.userId,
      actorName: actor.name ?? null,
    },
  });
}

async function readRows(tx: Tx, organizationId: string, clientId: string): Promise<DiagnosisRow[]> {
  const rows = await tx.clientDiagnosis.findMany({ where: { organizationId, clientId }, select: SELECT, orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }] });
  return rows.map(toRow);
}

/** First write for a client: the client-record diagnoses become rows (source LEGACY_CHART). */
async function materialize(tx: Tx, actor: DxActor, clientId: string, context: string = 'manual'): Promise<DiagnosisRow[]> {
  const existing = await readRows(tx, actor.organizationId, clientId);
  if (existing.length) return existing;
  const client = await tx.client.findFirst({
    where: { id: clientId, organizationId: actor.organizationId },
    select: { primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
  });
  if (!client) return [];
  const legacy = legacyRows(client);
  for (const r of legacy) {
    const created = await tx.clientDiagnosis.create({
      data: {
        organizationId: actor.organizationId,
        clientId,
        code: r.code,
        description: r.description.slice(0, 500) || (r.code ?? 'Uncoded diagnosis'),
        dsmName: r.dsmName,
        rank: r.rank,
        isPrimary: r.rank === 1,
        status: 'ACTIVE',
        source: 'LEGACY_CHART',
        codeSetYear: r.code ? ICD10_FISCAL_YEAR : null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      select: { id: true },
    });
    await writeEvent(tx, actor, clientId, { diagnosisId: created.id, action: 'IMPORTED', context, after: snapshot(r), reason: 'Carried over from the client record' });
  }
  return readRows(tx, actor.organizationId, clientId);
}

/** Persist rank / primary for rows whose position changed (clears the old primary first). */
async function persistRanks(tx: Tx, before: DiagnosisRow[], after: DiagnosisRow[]) {
  const prev = new Map(before.map((r) => [r.id, r]));
  const changed = after.filter((r) => prev.get(r.id) && (prev.get(r.id)!.rank !== r.rank || prev.get(r.id)!.isPrimary !== r.isPrimary));
  for (const r of changed.filter((x) => !x.isPrimary)) {
    await tx.clientDiagnosis.update({ where: { id: r.id }, data: { rank: r.rank, isPrimary: false } });
  }
  for (const r of changed.filter((x) => x.isPrimary)) {
    await tx.clientDiagnosis.update({ where: { id: r.id }, data: { rank: r.rank, isPrimary: true } });
  }
  return changed;
}

async function syncLegacy(tx: Tx, organizationId: string, clientId: string): Promise<LegacyDiagnosisFields> {
  const rows = await readRows(tx, organizationId, clientId);
  const legacy = deriveLegacyFields(rows);
  await tx.client.update({ where: { id: clientId }, data: legacy });
  return legacy;
}

async function run<R>(fn: (tx: Tx) => Promise<R>): Promise<R | { ok: false; status: number; error: string }> {
  try {
    return await prisma.$transaction(fn, { timeout: 20_000 });
  } catch (err) {
    if (isMissingDiagnosisTable(err)) return { ok: false, status: 503, error: MIGRATION_ERROR };
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'P2002') return { ok: false, status: 409, error: 'The diagnosis list changed at the same time (another save). Reload and try again.' };
    throw err;
  }
}

export type AddDiagnosisInput = {
  code: string;
  description?: string | null;
  dsmName?: string | null;
  status?: 'ACTIVE' | 'PROVISIONAL';
  onsetDate?: string | null;
  makePrimary?: boolean;
  diagnosingProviderName?: string | null;
  source?: string;
  sourceRef?: string | null;
  comment?: string | null;
  context?: ReviewContext;
  /** Client sex for the sex edits (warning only) */
  sex?: string | null;
};

/** Validation only (no write): issues for the add form. */
export function previewDiagnosis(input: { code: string; makePrimary?: boolean; sex?: string | null }) {
  const c = checkChartDiagnosisCode(input.code, { asPrimary: input.makePrimary, sex: input.sex });
  return { code: c.check.code, description: c.description, billable: c.check.billable, dsmName: dsmNameFor(c.check.code), issues: c.issues };
}

export async function addDiagnosis(actor: DxActor, clientId: string, input: AddDiagnosisInput): Promise<DxResult<{ row: DiagnosisRow; issues: DxIssue[]; legacy: LegacyDiagnosisFields }>> {
  const check = checkChartDiagnosisCode(input.code, { asPrimary: input.makePrimary, sex: input.sex });
  const blocks = check.issues.filter((i) => i.severity === 'block');
  if (blocks.length) return { ok: false, status: 400, error: blocks.map((b) => b.message).join(' '), issues: check.issues };
  const code = check.check.code;
  return run(async (tx) => {
    const before = await materialize(tx, actor, clientId, input.context);
    if (before.some((r) => isCurrent(r) && displayCode(r.code || '') === code)) {
      return { ok: false, status: 409, error: `${code} is already on the diagnosis list.` };
    }
    const status = input.status === 'PROVISIONAL' ? 'PROVISIONAL' : 'ACTIVE';
    const currentCount = before.filter(isCurrent).length;
    const created = await tx.clientDiagnosis.create({
      data: {
        organizationId: actor.organizationId,
        clientId,
        code,
        description: (input.description?.trim() || check.description || code).slice(0, 500),
        dsmName: (input.dsmName?.trim() || dsmNameFor(code))?.slice(0, 300) || null,
        rank: currentCount + 1,
        isPrimary: false,
        status,
        onsetDate: toDate(input.onsetDate),
        diagnosingProviderId: actor.userId,
        diagnosingProviderName: (input.diagnosingProviderName?.trim() || actor.name || null)?.slice(0, 200) ?? null,
        source: input.source || 'CLINICIAN',
        sourceRef: input.sourceRef ?? null,
        codeSetYear: ICD10_FISCAL_YEAR,
        comment: input.comment?.trim().slice(0, 1000) || null,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
      select: SELECT,
    });
    const withNew = [...before, toRow(created)];
    const ordered = input.makePrimary || currentCount === 0 ? moveDiagnosis(withNew, created.id, 'primary') : normalizeRanks(withNew);
    await persistRanks(tx, withNew, ordered);
    const row = ordered.find((r) => r.id === created.id)!;
    await writeEvent(tx, actor, clientId, { diagnosisId: created.id, action: 'ADDED', context: input.context, after: snapshot(row), reason: input.comment ?? null });
    const legacy = await syncLegacy(tx, actor.organizationId, clientId);
    return { ok: true, row: { ...toRow(created), rank: row.rank, isPrimary: row.isPrimary }, issues: check.issues, legacy };
  });
}

export type UpdateDiagnosisInput = {
  status?: DiagnosisStatus;
  statusReason?: string | null;
  resolvedDate?: string | null;
  onsetDate?: string | null;
  dsmName?: string | null;
  description?: string | null;
  diagnosingProviderName?: string | null;
  comment?: string | null;
  move?: 'up' | 'down' | 'primary';
  context?: ReviewContext;
};

/**
 * Change status / dates / names, or move. `id` may be a legacy id ("legacy-2") from the fallback
 * read: the list is created first and the row at that position is changed.
 */
export async function updateDiagnosis(actor: DxActor, clientId: string, id: string, input: UpdateDiagnosisInput): Promise<DxResult<{ row: DiagnosisRow; legacy: LegacyDiagnosisFields }>> {
  return run(async (tx) => {
    let rows = await materialize(tx, actor, clientId, input.context);
    let targetId = id;
    const legacyIdx = /^legacy-(\d+)$/.exec(id);
    if (legacyIdx) {
      const hit = rows.filter((r) => r.source === 'LEGACY_CHART').find((r) => r.rank === Number(legacyIdx[1]));
      if (!hit) return { ok: false, status: 404, error: 'Diagnosis not found' };
      targetId = hit.id;
    }
    const current = rows.find((r) => r.id === targetId);
    if (!current) return { ok: false, status: 404, error: 'Diagnosis not found' };

    const data: Prisma.ClientDiagnosisUpdateInput = {};
    let action = 'UPDATED';
    let reason: string | null = input.comment ?? null;

    if (input.status && input.status !== current.status) {
      if (!canChangeStatus(current.status, input.status)) {
        return { ok: false, status: 400, error: current.status === 'ENTERED_IN_ERROR' ? 'A diagnosis marked entered in error cannot be changed. Add the correct diagnosis instead.' : 'That status change is not allowed.' };
      }
      const why = input.statusReason?.trim() || '';
      if (REASON_REQUIRED.has(input.status) && why.length < 3) {
        return { ok: false, status: 400, error: 'Give a short reason for resolving, ruling out or marking a diagnosis entered in error.' };
      }
      if (CURRENT_STATUSES.has(input.status) && !CURRENT_STATUSES.has(current.status) && current.code) {
        const dup = rows.find((r) => r.id !== current.id && isCurrent(r) && displayCode(r.code || '') === displayCode(current.code!));
        if (dup) return { ok: false, status: 409, error: `${displayCode(current.code)} is already current on the list.` };
      }
      data.status = input.status;
      data.statusReason = why || null;
      if (input.status === 'RESOLVED') data.resolvedDate = toDate(input.resolvedDate) ?? toDate(new Date().toISOString());
      else if (CURRENT_STATUSES.has(input.status)) data.resolvedDate = null;
      action = 'STATUS';
      reason = why || reason;
    } else if (input.resolvedDate !== undefined && current.status === 'RESOLVED') {
      data.resolvedDate = toDate(input.resolvedDate);
    }
    if (input.onsetDate !== undefined) data.onsetDate = toDate(input.onsetDate);
    if (input.dsmName !== undefined) data.dsmName = input.dsmName?.trim().slice(0, 300) || null;
    if (input.description !== undefined && input.description?.trim()) data.description = input.description.trim().slice(0, 500);
    if (input.diagnosingProviderName !== undefined) data.diagnosingProviderName = input.diagnosingProviderName?.trim().slice(0, 200) || null;
    if (input.comment !== undefined) data.comment = input.comment?.trim().slice(0, 1000) || null;

    const hasFieldChange = Object.keys(data).length > 0;
    if (hasFieldChange) {
      // Leaving the current list: rank 0 now (persistRanks will not see it as current)
      if (data.status && !CURRENT_STATUSES.has(String(data.status))) {
        data.rank = 0;
        data.isPrimary = false;
      }
      if (data.status && CURRENT_STATUSES.has(String(data.status)) && !isCurrent(current)) {
        data.rank = rows.filter(isCurrent).length + 1;
      }
      data.updatedById = actor.userId;
      await tx.clientDiagnosis.update({ where: { id: current.id }, data });
      rows = await readRows(tx, actor.organizationId, clientId);
    }

    let next = normalizeRanks(rows);
    if (input.move) {
      next = moveDiagnosis(rows, current.id, input.move);
      if (!hasFieldChange) action = 'RANK';
    }
    const changedRanks = await persistRanks(tx, rows, next);
    const after = next.find((r) => r.id === current.id)!;
    if (!hasFieldChange && !changedRanks.length) {
      return { ok: true, row: after, legacy: deriveLegacyFields(next) };
    }
    await writeEvent(tx, actor, clientId, { diagnosisId: current.id, action, context: input.context, before: snapshot(current), after: snapshot(after), reason });
    // Other rows that moved because of this change (e.g. a new primary after resolving the old one)
    for (const r of changedRanks.filter((x) => x.id !== current.id)) {
      const was = rows.find((x) => x.id === r.id);
      await writeEvent(tx, actor, clientId, { diagnosisId: r.id, action: 'RANK', context: input.context, before: snapshot(was), after: snapshot(r), reason: 'Re-ranked after another diagnosis changed' });
    }
    const legacy = await syncLegacy(tx, actor.organizationId, clientId);
    return { ok: true, row: after, legacy };
  });
}

/** Full order of the current diagnoses (drag and drop). */
export async function reorderDiagnoses(actor: DxActor, clientId: string, orderedIds: string[], context?: ReviewContext): Promise<DxResult<{ rows: DiagnosisRow[]; legacy: LegacyDiagnosisFields }>> {
  return run(async (tx) => {
    const rows = await materialize(tx, actor, clientId, context);
    const next = applyOrder(rows, orderedIds);
    const changed = await persistRanks(tx, rows, next);
    for (const r of changed) {
      await writeEvent(tx, actor, clientId, { diagnosisId: r.id, action: 'RANK', context, before: snapshot(rows.find((x) => x.id === r.id)), after: snapshot(r) });
    }
    const legacy = changed.length ? await syncLegacy(tx, actor.organizationId, clientId) : deriveLegacyFields(next);
    return { ok: true, rows: sortForDisplay(next), legacy };
  });
}

/** "Reviewed — no change" (or a review after changes). Saves the list first if it was legacy. */
export async function recordDiagnosisReview(
  actor: DxActor,
  clientId: string,
  input: { context?: ReviewContext; comment?: string | null; changed?: boolean }
): Promise<DxResult<{ reviewedAt: string; current: number }>> {
  return run(async (tx) => {
    const rows = await materialize(tx, actor, clientId, input.context);
    const current = rows.filter(isCurrent);
    const now = new Date();
    await writeEvent(tx, actor, clientId, {
      action: 'REVIEWED',
      context: input.context ?? 'manual',
      after: { changed: Boolean(input.changed), current: current.map((r) => r.code || r.description) } as Prisma.InputJsonValue,
      reason: input.comment?.trim() || (input.changed ? 'Reviewed with changes' : 'Reviewed — no change'),
    });
    return { ok: true, reviewedAt: now.toISOString(), current: current.length };
  });
}

/**
 * Client profile form (legacy primary / secondary fields) edited: apply it to the list instead of
 * overwriting the derived fields. New codes are added, the named primary becomes primary, and
 * current coded diagnoses no longer named are resolved ("Removed in the client profile form").
 * Uncoded text in the form is kept as an uncoded entry. Returns null when nothing changed.
 */
export async function applyLegacyDiagnosisEdit(actor: DxActor, clientId: string, fields: Partial<LegacyDiagnosisFields>): Promise<DxResult<{ legacy: LegacyDiagnosisFields; added: number; resolved: number }>> {
  return run(async (tx) => {
    const client = await tx.client.findFirst({
      where: { id: clientId, organizationId: actor.organizationId },
      select: { primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
    });
    if (!client) return { ok: false, status: 404, error: 'Client not found' };
    const merged = {
      primaryDiagnosisCode: fields.primaryDiagnosisCode !== undefined ? fields.primaryDiagnosisCode : client.primaryDiagnosisCode,
      primaryDiagnosis: fields.primaryDiagnosis !== undefined ? fields.primaryDiagnosis : client.primaryDiagnosis,
      secondaryDiagnoses: fields.secondaryDiagnoses !== undefined ? fields.secondaryDiagnoses : client.secondaryDiagnoses,
    };
    const wanted = parseLegacyDiagnoses(merged);
    const rows = await materialize(tx, actor, clientId, 'client_profile');
    let added = 0;
    let resolved = 0;
    const key = (code: string | null, text: string) =>
      code ? `C:${displayCode(code)}` : `T:${text.toLowerCase().replace(/[,;\n]+/g, ' ').replace(/\s+/g, ' ').trim()}`;
    const have = new Map(rows.filter(isCurrent).map((r) => [key(r.code, r.description), r]));
    const wantedKeys = new Set(wanted.map((w) => key(w.code, w.description)));
    const orderIds: string[] = [];
    for (const w of wanted) {
      const k = key(w.code, w.description);
      const existing = have.get(k);
      if (existing) {
        orderIds.push(existing.id);
        continue;
      }
      if (w.code) {
        const chk = checkIcd10Code(w.code);
        if (chk.status !== 'ok') return { ok: false, status: 400, error: chk.message || `${w.code} is not a valid ICD-10-CM code` };
      }
      const created = await tx.clientDiagnosis.create({
        data: {
          organizationId: actor.organizationId,
          clientId,
          code: w.code ? displayCode(w.code) : null,
          description: (w.description || describe(w.code) || w.code || 'Uncoded diagnosis').slice(0, 500),
          dsmName: dsmNameFor(w.code),
          rank: 999,
          status: 'ACTIVE',
          diagnosingProviderId: actor.userId,
          diagnosingProviderName: actor.name ?? null,
          source: 'CLINICIAN',
          codeSetYear: w.code ? ICD10_FISCAL_YEAR : null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: SELECT,
      });
      await writeEvent(tx, actor, clientId, { diagnosisId: created.id, action: 'ADDED', context: 'client_profile', after: snapshot(toRow(created)) });
      orderIds.push(created.id);
      added++;
    }
    for (const r of rows.filter(isCurrent)) {
      if (wantedKeys.has(key(r.code, r.description))) continue;
      await tx.clientDiagnosis.update({ where: { id: r.id }, data: { status: 'RESOLVED', statusReason: 'Removed in the client profile form', resolvedDate: toDate(new Date().toISOString()), rank: 0, isPrimary: false, updatedById: actor.userId } });
      await writeEvent(tx, actor, clientId, { diagnosisId: r.id, action: 'STATUS', context: 'client_profile', before: snapshot(r), after: snapshot({ ...r, status: 'RESOLVED' }), reason: 'Removed in the client profile form' });
      resolved++;
    }
    const fresh = await readRows(tx, actor.organizationId, clientId);
    const next = applyOrder(fresh, orderIds);
    await persistRanks(tx, fresh, next);
    const legacy = await syncLegacy(tx, actor.organizationId, clientId);
    return { ok: true, legacy, added, resolved };
  });
}

// ─── Suggestions (AI scribe / coding agent): clinician accepts or dismisses ─

export async function listSuggestions(organizationId: string, clientId: string) {
  try {
    const rows = await prisma.clientDiagnosisSuggestion.findMany({
      where: { organizationId, clientId, status: 'PENDING' },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, code: true, description: true, origin: true, rationale: true, createdAt: true },
    });
    return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  } catch (err) {
    if (isMissingDiagnosisTable(err)) return [];
    throw err;
  }
}

export async function createSuggestion(
  actor: DxActor,
  clientId: string,
  input: { code: string; description?: string | null; origin: string; originRef?: string | null; rationale?: string | null }
): Promise<DxResult<{ id: string; duplicate: boolean }>> {
  const chk = checkIcd10Code(input.code);
  if (chk.status !== 'ok') return { ok: false, status: 400, error: chk.message || 'Not an ICD-10-CM code' };
  try {
    const existing = await prisma.clientDiagnosisSuggestion.findFirst({ where: { organizationId: actor.organizationId, clientId, code: chk.code, status: 'PENDING' }, select: { id: true } });
    if (existing) return { ok: true, id: existing.id, duplicate: true };
    const row = await prisma.clientDiagnosisSuggestion.create({
      data: {
        organizationId: actor.organizationId,
        clientId,
        code: chk.code,
        description: (input.description?.trim() || chk.description || chk.code).slice(0, 500),
        origin: input.origin.slice(0, 40),
        originRef: input.originRef?.slice(0, 100) ?? null,
        rationale: input.rationale?.slice(0, 1000) ?? null,
        createdById: actor.userId,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id, duplicate: false };
  } catch (err) {
    if (isMissingDiagnosisTable(err)) return { ok: false, status: 503, error: MIGRATION_ERROR };
    throw err;
  }
}

export async function decideSuggestion(actor: DxActor, clientId: string, id: string, decision: 'ACCEPTED' | 'DISMISSED', opts: { makePrimary?: boolean; status?: 'ACTIVE' | 'PROVISIONAL'; sex?: string | null } = {}) {
  const s = await prisma.clientDiagnosisSuggestion.findFirst({ where: { id, organizationId: actor.organizationId, clientId, status: 'PENDING' } }).catch(() => null);
  if (!s) return { ok: false as const, status: 404, error: 'Suggestion not found or already decided' };
  let added: DiagnosisRow | null = null;
  if (decision === 'ACCEPTED') {
    const res = await addDiagnosis(actor, clientId, {
      code: s.code,
      description: s.description,
      status: opts.status,
      makePrimary: opts.makePrimary,
      source: 'AI_ACCEPTED',
      sourceRef: s.id,
      context: 'ai_suggestion',
      sex: opts.sex,
    });
    if (res.ok === false && res.status !== 409) return res;
    added = res.ok ? res.row : null;
  }
  await prisma.clientDiagnosisSuggestion.update({ where: { id: s.id }, data: { status: decision, decidedById: actor.userId, decidedAt: new Date() } });
  return { ok: true as const, added };
}

// ─── Imports (Valant re-import, backfill) ───────────────────────────────────

/**
 * Add imported diagnoses to a client's saved list: codes not already current are added after the
 * existing ones (source VALANT_IMPORT); clinician-entered rows are never changed or resolved by an
 * import. When the client has no list yet, `createList` decides: false = leave it (the caller
 * keeps writing the client record), true = create the list in the import's order (primary first).
 * Codes not valid in the FY2027 set are still imported (they were on the chart) and flagged on
 * the chart; they cannot be billed until fixed.
 */
export async function mergeImportedDiagnoses(
  actor: DxActor,
  clientId: string,
  dx: { code: string | null; description: string }[],
  opts: { source: 'VALANT_IMPORT' | 'LEGACY_CHART' | 'INTAKE'; sourceRef?: string | null; context: ReviewContext; createList: boolean }
): Promise<DxResult<{ added: number; listExisted: boolean }>> {
  return run(async (tx) => {
    const existing = await readRows(tx, actor.organizationId, clientId);
    if (!existing.length && !opts.createList) return { ok: true, added: 0, listExisted: false };
    const key = (code: string | null, text: string) => (code ? `C:${displayCode(code)}` : `T:${text.toLowerCase().trim()}`);
    const have = new Set(existing.filter(isCurrent).map((r) => key(r.code, r.description)));
    let rank = existing.filter(isCurrent).length;
    let added = 0;
    for (const d of dx) {
      const code = d.code ? displayCode(d.code) : null;
      const k = key(code, d.description);
      if (have.has(k) || (!code && !d.description.trim())) continue;
      have.add(k);
      rank += 1;
      const created = await tx.clientDiagnosis.create({
        data: {
          organizationId: actor.organizationId,
          clientId,
          code,
          description: (d.description.trim() || describe(code) || code || 'Uncoded diagnosis').slice(0, 500),
          dsmName: dsmNameFor(code),
          rank,
          isPrimary: false,
          status: 'ACTIVE',
          source: opts.source,
          sourceRef: opts.sourceRef ?? null,
          codeSetYear: code ? ICD10_FISCAL_YEAR : null,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
        select: SELECT,
      });
      await writeEvent(tx, actor, clientId, { diagnosisId: created.id, action: 'IMPORTED', context: opts.context, after: snapshot(toRow(created)) });
      added++;
    }
    if (added) {
      const fresh = await readRows(tx, actor.organizationId, clientId);
      await persistRanks(tx, fresh, normalizeRanks(fresh));
      await syncLegacy(tx, actor.organizationId, clientId);
    }
    return { ok: true, added, listExisted: existing.length > 0 };
  });
}
