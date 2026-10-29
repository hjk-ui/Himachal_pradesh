/**
 * Required trainings by role (with frequency), completions with certificates, CEU hours per
 * license renewal cycle, and compliance %. Requirements start empty; HR can load the suggested
 * list (DEFAULT_TRAINING_REQUIREMENTS) and edit frequencies (practice policy, confirm).
 */
import { prisma } from '@/lib/db/prisma';
import {
  DEFAULT_TRAINING_REQUIREMENTS,
  addMonthsYmd,
  ceuProgress,
  dateOnlyValue,
  trainingCompliancePct,
  trainingStatus,
  ymd,
  type ExpiryStatus,
} from './standard';
import { assertOrgUser, isMissingTable, loadHrSettings, loadRoster, practiceTodayFor, type HrCtx, type RosterPerson } from './server';

export async function listRequirements(organizationId: string) {
  try {
    const rows = await prisma.hrTrainingRequirement.findMany({ where: { organizationId }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map((r) => ({
      id: r.id,
      key: r.key,
      name: r.name,
      category: r.category,
      frequencyMonths: r.frequencyMonths,
      roles: r.roles,
      dueWithinDaysOfHire: r.dueWithinDaysOfHire,
      active: r.active,
      policyNote: r.policyNote,
    }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export async function saveRequirement(
  ctx: HrCtx,
  input: { id?: string | null; key?: string; name: string; category: string; frequencyMonths: number | null; roles: string[]; dueWithinDaysOfHire: number | null; active: boolean; policyNote?: string | null },
) {
  if (input.id) {
    const existing = await prisma.hrTrainingRequirement.findFirst({ where: { id: input.id, organizationId: ctx.organizationId } });
    if (!existing) return { ok: false as const, status: 404, error: 'Requirement not found' };
    await prisma.hrTrainingRequirement.update({
      where: { id: input.id },
      data: {
        name: input.name,
        category: input.category,
        frequencyMonths: input.frequencyMonths,
        roles: input.roles,
        dueWithinDaysOfHire: input.dueWithinDaysOfHire,
        active: input.active,
        policyNote: input.policyNote ?? null,
        updatedById: ctx.userId,
      },
    });
    return { ok: true as const, id: input.id };
  }
  const key = (input.key || input.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || `req_${Date.now()}`;
  const row = await prisma.hrTrainingRequirement.upsert({
    where: { organizationId_key: { organizationId: ctx.organizationId, key } },
    update: { name: input.name, category: input.category, frequencyMonths: input.frequencyMonths, roles: input.roles, dueWithinDaysOfHire: input.dueWithinDaysOfHire, active: input.active, policyNote: input.policyNote ?? null, updatedById: ctx.userId },
    create: {
      organizationId: ctx.organizationId,
      key,
      name: input.name,
      category: input.category,
      frequencyMonths: input.frequencyMonths,
      roles: input.roles,
      dueWithinDaysOfHire: input.dueWithinDaysOfHire,
      active: input.active,
      policyNote: input.policyNote ?? null,
      updatedById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id };
}

/** Load the suggested requirement list (only keys not already present). */
export async function loadSuggestedRequirements(ctx: HrCtx) {
  const existing = new Set((await listRequirements(ctx.organizationId)).map((r) => r.key));
  const toAdd = DEFAULT_TRAINING_REQUIREMENTS.filter((r) => !existing.has(r.key));
  if (toAdd.length) {
    await prisma.hrTrainingRequirement.createMany({
      data: toAdd.map((r) => ({
        organizationId: ctx.organizationId,
        key: r.key,
        name: r.name,
        category: r.category,
        frequencyMonths: r.frequencyMonths,
        roles: [...r.roles],
        dueWithinDaysOfHire: r.dueWithinDaysOfHire,
        policyNote: r.policyNote,
        updatedById: ctx.userId,
      })),
      skipDuplicates: true,
    });
  }
  return toAdd.length;
}

export type CompletionInput = {
  userId: string;
  requirementId?: string | null;
  title?: string | null;
  completedOn: string;
  expiresOn?: string | null;
  hours?: number | null;
  ceuEligible?: boolean;
  credentialId?: string | null;
  provider?: string | null;
  certificateNumber?: string | null;
  certificateDocumentId?: string | null;
};

/**
 * Record a completion. HR / leadership / OM record verified completions for anyone; staff
 * self-report their own (status pending_review until HR verifies).
 */
export async function recordCompletion(ctx: HrCtx, input: CompletionInput, opts: { selfService: boolean }) {
  if (opts.selfService && input.userId !== ctx.userId) return { ok: false as const, status: 403, error: 'You can only add your own trainings' };
  const staff = await assertOrgUser(ctx.organizationId, input.userId);
  if (!staff) return { ok: false as const, status: 404, error: 'Staff member not found' };
  let title = input.title?.trim() || '';
  let expiresOn = ymd(input.expiresOn ?? null);
  if (input.requirementId) {
    const req = await prisma.hrTrainingRequirement.findFirst({ where: { id: input.requirementId, organizationId: ctx.organizationId } });
    if (!req) return { ok: false as const, status: 400, error: 'Training requirement not found' };
    title = title || req.name;
    if (!expiresOn && req.frequencyMonths) expiresOn = addMonthsYmd(input.completedOn, req.frequencyMonths);
  }
  if (!title) return { ok: false as const, status: 400, error: 'Training title is required' };
  if (input.credentialId) {
    const cred = await prisma.staffCredential.findFirst({ where: { id: input.credentialId, organizationId: ctx.organizationId, userId: input.userId }, select: { id: true } });
    if (!cred) return { ok: false as const, status: 400, error: 'License not found for this person' };
  }
  if (input.certificateDocumentId) {
    const doc = await prisma.hrDocument.findFirst({ where: { id: input.certificateDocumentId, organizationId: ctx.organizationId, userId: input.userId }, select: { id: true } });
    if (!doc) return { ok: false as const, status: 400, error: 'Certificate not found' };
  }
  const row = await prisma.hrTrainingCompletion.create({
    data: {
      organizationId: ctx.organizationId,
      userId: input.userId,
      requirementId: input.requirementId || null,
      title,
      completedOn: dateOnlyValue(input.completedOn)!,
      expiresOn: dateOnlyValue(expiresOn),
      hours: input.hours ?? null,
      ceuEligible: Boolean(input.ceuEligible),
      credentialId: input.credentialId || null,
      provider: input.provider?.trim() || null,
      certificateNumber: input.certificateNumber?.trim() || null,
      certificateDocumentId: input.certificateDocumentId || null,
      status: opts.selfService ? 'pending_review' : 'verified',
      source: opts.selfService ? 'self_service' : 'hr',
      recordedById: ctx.userId,
    },
  });
  return { ok: true as const, id: row.id };
}

export async function verifyCompletion(ctx: HrCtx, id: string, decision: 'verified' | 'rejected') {
  const row = await prisma.hrTrainingCompletion.findFirst({ where: { id, organizationId: ctx.organizationId } });
  if (!row) return { ok: false as const, status: 404, error: 'Completion not found' };
  if (decision === 'rejected') await prisma.hrTrainingCompletion.delete({ where: { id } });
  else await prisma.hrTrainingCompletion.update({ where: { id }, data: { status: 'verified' } });
  return { ok: true as const, userId: row.userId };
}

export type TrainingCell = { status: ExpiryStatus | 'not_required'; dueOn: string | null; lastCompletedOn: string | null };

/** Matrix: staff x requirement statuses, compliance %, CEU progress per license, pending reviews. */
export async function trainingMatrix(organizationId: string, opts: { userIds?: string[]; roster?: RosterPerson[] } = {}) {
  const [settings, today, requirements] = await Promise.all([loadHrSettings(organizationId), practiceTodayFor(organizationId), listRequirements(organizationId)]);
  const roster = (opts.roster ?? (await loadRoster(organizationId))).filter((p) => p.hrStatus !== 'Terminated' && (!opts.userIds || opts.userIds.includes(p.userId)));
  const ids = roster.map((p) => p.userId);
  const windows = { dueSoonDays: settings.dueSoonDays, urgentDays: settings.urgentDays };
  let completions: Awaited<ReturnType<typeof prisma.hrTrainingCompletion.findMany>> = [];
  let licenses: Awaited<ReturnType<typeof prisma.staffCredential.findMany>> = [];
  if (ids.length) {
    try {
      [completions, licenses] = await Promise.all([
        prisma.hrTrainingCompletion.findMany({ where: { organizationId, userId: { in: ids } }, orderBy: { completedOn: 'desc' } }),
        prisma.staffCredential.findMany({ where: { organizationId, userId: { in: ids }, credentialType: 'LICENSE' }, orderBy: { expiresAt: 'desc' } }),
      ]);
    } catch (err) {
      if (!isMissingTable(err)) throw err;
    }
  }
  const active = requirements.filter((r) => r.active);
  const rows = roster.map((p) => {
    const mine = completions.filter((c) => c.userId === p.userId);
    const cells: Record<string, TrainingCell> = {};
    for (const req of active) {
      const last = mine.find((c) => c.requirementId === req.id && c.status === 'verified');
      const st = trainingStatus(
        req,
        { role: p.role, hireDate: p.hireDate, lastCompletedOn: last ? ymd(last.completedOn) : null, lastExpiresOn: last ? ymd(last.expiresOn) : null },
        today,
        windows,
      );
      cells[req.id] = { status: st.status, dueOn: st.dueOn, lastCompletedOn: last ? ymd(last.completedOn) : null };
    }
    // Most recent license per license type
    const seen = new Set<string>();
    const ceu = licenses
      .filter((l) => l.userId === p.userId)
      .filter((l) => {
        const k = (l.licenseType || l.title).toUpperCase();
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .map((l) => ({
        credentialId: l.id,
        title: l.title,
        licenseType: l.licenseType,
        ...ceuProgress(
          { id: l.id, licenseType: l.licenseType, issuedAt: ymd(l.issuedAt), expiresAt: ymd(l.expiresAt)!, ceuRequired: l.ceuRequired },
          mine.filter((c) => c.status === 'verified').map((c) => ({ hours: c.hours, completedOn: ymd(c.completedOn)!, ceuEligible: c.ceuEligible, credentialId: c.credentialId })),
          settings.ceuRequirements,
        ),
      }));
    return {
      userId: p.userId,
      name: p.name,
      role: p.role,
      jobTitle: p.jobTitle,
      cells,
      compliancePct: trainingCompliancePct(Object.values(cells).map((c) => c.status)),
      ceu,
      completions: mine.slice(0, 50).map((c) => ({
        id: c.id,
        requirementId: c.requirementId,
        title: c.title,
        completedOn: ymd(c.completedOn)!,
        expiresOn: ymd(c.expiresOn),
        hours: c.hours,
        ceuEligible: c.ceuEligible,
        credentialId: c.credentialId,
        provider: c.provider,
        certificateNumber: c.certificateNumber,
        certificateDocumentId: c.certificateDocumentId,
        status: c.status,
        source: c.source,
      })),
    };
  });
  const allCells = rows.flatMap((r) => Object.values(r.cells).map((c) => c.status));
  return {
    today,
    requirements,
    rows,
    orgCompliancePct: trainingCompliancePct(allCells),
    pendingReview: rows.flatMap((r) => r.completions.filter((c) => c.status === 'pending_review').map((c) => ({ ...c, userId: r.userId, name: r.name }))),
    ceuSettings: settings.ceuRequirements,
  };
}
