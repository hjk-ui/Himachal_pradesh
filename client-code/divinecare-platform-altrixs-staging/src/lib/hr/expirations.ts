/**
 * Expiration engine: every dated HR item (licenses and registrations, compliance records, CAQH
 * re-attestation, monthly exclusion checks, required trainings, expiring documents, overdue
 * onboarding / offboarding tasks, performance reviews) with one status, plus in-app reminders
 * (HrTask) for HR and for the staff member. No email is sent. No client data is read.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  CREDENTIAL_TYPE_LABELS,
  COMPLIANCE_KINDS,
  EXCLUSION_SOURCES,
  addMonthsYmd,
  caqhStatus,
  exclusionDue,
  expiryStatus,
  isClinicalRole,
  isLicensedRole,
  trainingStatus,
  ymd,
  type ExpiryStatus,
} from './standard';
import { isMissingTable, loadHrSettings, loadRoster, practiceTodayFor, type HrSettingsView, type RosterPerson } from './server';

export type ExpirationSource = 'credential' | 'compliance' | 'caqh' | 'exclusion' | 'training' | 'document' | 'checklist' | 'review';

export type ExpirationItem = {
  key: string;
  source: ExpirationSource;
  sourceId: string;
  userId: string;
  staffName: string;
  category: string;
  label: string;
  dueOn: string | null;
  status: ExpiryStatus;
  daysLeft: number | null;
  /** Staff member should act (renew, upload, complete); HR always sees the item */
  staffActionable: boolean;
  href: string;
};

const ATTENTION: ExpiryStatus[] = ['due_60', 'due_30', 'expired', 'missing'];

function complianceLabel(kind: string) {
  return COMPLIANCE_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

/**
 * All dated items for the org (or one person). `attentionOnly` drops current / no-expiry rows.
 */
export async function computeExpirations(
  organizationId: string,
  opts: { userId?: string; attentionOnly?: boolean; today?: string; settings?: HrSettingsView; roster?: RosterPerson[] } = {},
): Promise<{ items: ExpirationItem[]; today: string; settings: HrSettingsView }> {
  const settings = opts.settings ?? (await loadHrSettings(organizationId));
  const today = opts.today ?? (await practiceTodayFor(organizationId));
  const roster = (opts.roster ?? (await loadRoster(organizationId))).filter((p) => !opts.userId || p.userId === opts.userId);
  const active = roster.filter((p) => p.accountStatus !== 'DEACTIVATED' && p.hrStatus !== 'Terminated');
  const ids = active.map((p) => p.userId);
  const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
  const windows = { dueSoonDays: settings.dueSoonDays, urgentDays: settings.urgentDays };
  const items: ExpirationItem[] = [];
  if (!ids.length) return { items, today, settings };

  const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => {
    try {
      return await p;
    } catch (err) {
      if (isMissingTable(err)) return fallback;
      throw err;
    }
  };

  const [credentials, compliance, exclusions, requirements, completions, documents, tasks, reviews, profiles] = await Promise.all([
    safe(prisma.staffCredential.findMany({ where: { organizationId, userId: { in: ids } } }), []),
    safe(prisma.staffComplianceRecord.findMany({ where: { organizationId, userId: { in: ids } } }), []),
    safe(
      prisma.hrExclusionCheck.findMany({
        where: { organizationId, userId: { in: ids } },
        orderBy: { checkedOn: 'desc' },
        select: { userId: true, source: true, checkedOn: true, result: true },
      }),
      [],
    ),
    safe(prisma.hrTrainingRequirement.findMany({ where: { organizationId, active: true } }), []),
    safe(
      prisma.hrTrainingCompletion.findMany({
        where: { organizationId, userId: { in: ids }, requirementId: { not: null } },
        orderBy: { completedOn: 'desc' },
        select: { userId: true, requirementId: true, completedOn: true, expiresOn: true },
      }),
      [],
    ),
    safe(
      prisma.hrDocument.findMany({
        where: { organizationId, userId: { in: ids }, expiresOn: { not: null }, status: { not: 'archived' } },
        select: { id: true, userId: true, title: true, expiresOn: true, category: true },
      }),
      [],
    ),
    safe(
      prisma.hrChecklistTask.findMany({
        where: { organizationId, userId: { in: ids }, status: 'open', dueOn: { lt: new Date(`${today}T12:00:00.000Z`) } },
        select: { id: true, userId: true, label: true, dueOn: true, ownerType: true, checklistId: true },
      }),
      [],
    ),
    safe(
      prisma.hrPerformanceReview.findMany({
        where: { organizationId, userId: { in: ids }, status: { not: 'complete' }, dueOn: { not: null } },
        select: { id: true, userId: true, reviewType: true, dueOn: true },
      }),
      [],
    ),
    safe(prisma.staffHrProfile.findMany({ where: { organizationId, userId: { in: ids } }, select: { userId: true, caqhId: true } }), []),
  ]);

  // Credentials: a renewed license supersedes the old row of the same type + license type.
  const latest = new Map<string, (typeof credentials)[number]>();
  for (const c of credentials) {
    const k = `${c.userId}|${c.credentialType}|${(c.licenseType || c.title).toUpperCase()}`;
    const cur = latest.get(k);
    if (!cur || cur.expiresAt < c.expiresAt) latest.set(k, c);
  }
  for (const c of latest.values()) {
    const due = ymd(c.expiresAt)!;
    const st = expiryStatus(due, today, windows);
    items.push({
      key: `credential:${c.id}`,
      source: 'credential',
      sourceId: c.id,
      userId: c.userId,
      staffName: nameOf.get(c.userId) ?? 'Staff',
      category: CREDENTIAL_TYPE_LABELS[c.credentialType] ?? c.credentialType,
      label: `${c.title}${c.licenseNumber ? ` #${c.licenseNumber}` : ''}`,
      dueOn: due,
      status: st.status,
      daysLeft: st.daysLeft,
      staffActionable: true,
      href: `/dashboard/hr/people/${c.userId}?tab=credentials`,
    });
  }

  // Compliance records: explicit expiry, or the policy interval (TB), latest per kind.
  const latestCompliance = new Map<string, (typeof compliance)[number]>();
  for (const r of compliance) {
    if (r.kind === 'CAQH_ATTESTATION') continue;
    const k = `${r.userId}|${r.kind}|${r.label || ''}`;
    const cur = latestCompliance.get(k);
    const rank = (x: typeof r) => ymd(x.expiresOn) || ymd(x.completedOn) || '';
    if (!cur || rank(cur) < rank(r)) latestCompliance.set(k, r);
  }
  const tbMonths = settings.immunizationPolicy?.tbIntervalMonths ?? null;
  for (const r of latestCompliance.values()) {
    const completed = ymd(r.completedOn);
    let due = ymd(r.expiresOn);
    if (!due && r.kind === 'TB_TEST' && completed && tbMonths) due = addMonthsYmd(completed, tbMonths);
    let status: ExpiryStatus;
    let daysLeft: number | null = null;
    if (r.status === 'pending') {
      status = 'missing';
    } else if (r.status === 'exempt' || r.status === 'not_applicable' || r.status === 'declined') {
      status = 'no_expiry';
    } else {
      const st = expiryStatus(due, today, windows);
      status = st.status;
      daysLeft = st.daysLeft;
    }
    items.push({
      key: `compliance:${r.id}`,
      source: 'compliance',
      sourceId: r.id,
      userId: r.userId,
      staffName: nameOf.get(r.userId) ?? 'Staff',
      category: complianceLabel(r.kind),
      label: r.label || complianceLabel(r.kind),
      dueOn: due,
      status,
      daysLeft,
      staffActionable: ['TB_TEST', 'FLU_VACCINE', 'HEP_B'].includes(r.kind),
      href: `/dashboard/hr/people/${r.userId}?tab=credentials`,
    });
  }

  // CAQH re-attestation (only staff with a CAQH id on file).
  const lastCaqh = new Map<string, string>();
  for (const r of compliance) {
    if (r.kind !== 'CAQH_ATTESTATION' || !r.completedOn) continue;
    const d = ymd(r.completedOn)!;
    if (!lastCaqh.has(r.userId) || lastCaqh.get(r.userId)! < d) lastCaqh.set(r.userId, d);
  }
  for (const p of profiles) {
    const st = caqhStatus({ caqhId: p.caqhId, lastAttestedOn: lastCaqh.get(p.userId) ?? null }, today, { caqhAttestationDays: settings.caqhAttestationDays });
    if (st.status === 'not_applicable') continue;
    items.push({
      key: `caqh:${p.userId}`,
      source: 'caqh',
      sourceId: p.userId,
      userId: p.userId,
      staffName: nameOf.get(p.userId) ?? 'Staff',
      category: 'CAQH re-attestation',
      label: `CAQH re-attestation (every ${settings.caqhAttestationDays} days)`,
      dueOn: st.dueOn,
      status: st.status,
      daysLeft: st.daysLeft,
      staffActionable: true,
      href: `/dashboard/hr/people/${p.userId}?tab=credentials`,
    });
  }

  // Exclusion screening per source, every active staff member.
  const lastCheck = new Map<string, string>();
  for (const e of exclusions) {
    const k = `${e.userId}|${e.source}`;
    const d = ymd(e.checkedOn)!;
    if (!lastCheck.has(k) || lastCheck.get(k)! < d) lastCheck.set(k, d);
  }
  for (const p of active) {
    for (const src of EXCLUSION_SOURCES) {
      const st = exclusionDue(lastCheck.get(`${p.userId}|${src.key}`) ?? null, today, settings.exclusionCheckIntervalDays);
      const status: ExpiryStatus =
        st.status === 'never' ? 'missing' : st.status === 'overdue' ? 'expired' : st.status === 'due_soon' ? 'due_30' : 'current';
      items.push({
        key: `exclusion:${p.userId}:${src.key}`,
        source: 'exclusion',
        sourceId: `${p.userId}:${src.key}`,
        userId: p.userId,
        staffName: p.name,
        category: 'Exclusion check',
        label: `${src.label} check`,
        dueOn: st.dueOn,
        status,
        daysLeft: st.daysLeft,
        staffActionable: false,
        href: '/dashboard/hr/credentialing?view=exclusions',
      });
    }
  }

  // Required trainings.
  const lastCompletion = new Map<string, { completedOn: string; expiresOn: string | null }>();
  for (const c of completions) {
    const k = `${c.userId}|${c.requirementId}`;
    if (!lastCompletion.has(k)) lastCompletion.set(k, { completedOn: ymd(c.completedOn)!, expiresOn: ymd(c.expiresOn) });
  }
  for (const p of active) {
    for (const req of requirements) {
      const last = lastCompletion.get(`${p.userId}|${req.id}`);
      const st = trainingStatus(
        { id: req.id, key: req.key, name: req.name, frequencyMonths: req.frequencyMonths, roles: req.roles, dueWithinDaysOfHire: req.dueWithinDaysOfHire, active: req.active },
        { role: p.role, hireDate: p.hireDate, lastCompletedOn: last?.completedOn ?? null, lastExpiresOn: last?.expiresOn ?? null },
        today,
        windows,
      );
      if (st.status === 'not_required') continue;
      items.push({
        key: `training:${p.userId}:${req.id}`,
        source: 'training',
        sourceId: `${p.userId}:${req.id}`,
        userId: p.userId,
        staffName: p.name,
        category: 'Training',
        label: req.name,
        dueOn: st.dueOn,
        status: st.status,
        daysLeft: st.daysLeft,
        staffActionable: true,
        href: '/dashboard/hr/training',
      });
    }
  }

  for (const d of documents) {
    const due = ymd(d.expiresOn)!;
    const st = expiryStatus(due, today, windows);
    items.push({
      key: `document:${d.id}`,
      source: 'document',
      sourceId: d.id,
      userId: d.userId,
      staffName: nameOf.get(d.userId) ?? 'Staff',
      category: 'Document',
      label: d.title,
      dueOn: due,
      status: st.status,
      daysLeft: st.daysLeft,
      staffActionable: true,
      href: `/dashboard/hr/people/${d.userId}?tab=documents`,
    });
  }

  for (const t of tasks) {
    const due = ymd(t.dueOn)!;
    const st = expiryStatus(due, today, windows);
    items.push({
      key: `checklist:${t.id}`,
      source: 'checklist',
      sourceId: t.id,
      userId: t.userId,
      staffName: nameOf.get(t.userId) ?? 'Staff',
      category: 'Checklist task overdue',
      label: t.label,
      dueOn: due,
      status: st.status,
      daysLeft: st.daysLeft,
      staffActionable: t.ownerType === 'employee',
      href: `/dashboard/hr/people/${t.userId}?tab=onboarding`,
    });
  }

  for (const r of reviews) {
    const due = ymd(r.dueOn)!;
    const st = expiryStatus(due, today, { dueSoonDays: 30, urgentDays: 14 });
    items.push({
      key: `review:${r.id}`,
      source: 'review',
      sourceId: r.id,
      userId: r.userId,
      staffName: nameOf.get(r.userId) ?? 'Staff',
      category: 'Performance review',
      label: r.reviewType === 'ninety_day' ? '90-day review' : r.reviewType === 'annual' ? 'Annual review' : 'Review',
      dueOn: due,
      status: st.status,
      daysLeft: st.daysLeft,
      staffActionable: false,
      href: '/dashboard/hr/performance',
    });
  }

  const order: Record<ExpiryStatus, number> = { expired: 0, missing: 1, due_30: 2, due_60: 3, current: 4, no_expiry: 5 };
  const out = (opts.attentionOnly ? items.filter((i) => ATTENTION.includes(i.status)) : items).sort(
    (a, b) => order[a.status] - order[b.status] || (a.dueOn || '9999').localeCompare(b.dueOn || '9999'),
  );
  return { items: out, today, settings };
}

export function summarizeExpirations(items: ExpirationItem[]) {
  const by = (s: ExpiryStatus) => items.filter((i) => i.status === s).length;
  return {
    expired: by('expired'),
    missing: by('missing'),
    due30: by('due_30'),
    due60: by('due_60'),
    licensesExpired: items.filter((i) => i.source === 'credential' && i.category === 'Professional license' && i.status === 'expired').length,
    exclusionsDue: items.filter((i) => i.source === 'exclusion' && (i.status === 'expired' || i.status === 'missing')).length,
    caqhDue: items.filter((i) => i.source === 'caqh' && ATTENTION.includes(i.status)).length,
    trainingsOverdue: items.filter((i) => i.source === 'training' && (i.status === 'expired' || i.status === 'missing')).length,
    tasksOverdue: items.filter((i) => i.source === 'checklist').length,
  };
}

// ─── Reminders (HrTask) ──────────────────────────────────────────────────────

const lastSync = new Map<string, number>();
const SYNC_INTERVAL_MS = 10 * 60 * 1000;

function severityFor(status: ExpiryStatus): 'info' | 'warning' | 'critical' {
  if (status === 'expired' || status === 'missing') return 'critical';
  if (status === 'due_30') return 'warning';
  return 'info';
}

function reminderTitle(i: ExpirationItem): string {
  const when =
    i.status === 'expired'
      ? 'expired' + (i.dueOn ? ` ${i.dueOn}` : '')
      : i.status === 'missing'
        ? 'not on file'
        : `due ${i.dueOn}`;
  return `${i.label}: ${when}`;
}

/**
 * Upsert reminders for items that need attention: one HR reminder per item, plus one for the
 * staff member when they can act. Reminders whose item is no longer due are marked resolved.
 * Runs at most every 10 minutes per org unless forced (dashboard load / refresh button).
 */
export async function syncHrReminders(organizationId: string, opts: { force?: boolean } = {}) {
  const now = Date.now();
  if (!opts.force && now - (lastSync.get(organizationId) ?? 0) < SYNC_INTERVAL_MS) return { skipped: true as const };
  lastSync.set(organizationId, now);
  const { items } = await computeExpirations(organizationId, { attentionOnly: true });
  const wanted = new Map<string, Prisma.HrTaskCreateManyInput>();
  const dateVal = (d: string | null) => (d ? new Date(`${d}T12:00:00.000Z`) : null);
  // Exclusion checks are one monthly batch for HR (not one reminder per person per list).
  const exclusionDueItems = items.filter((i) => i.source === 'exclusion');
  if (exclusionDueItems.length) {
    const people = new Set(exclusionDueItems.map((i) => i.userId)).size;
    const firstDue = exclusionDueItems.map((i) => i.dueOn || '').sort()[0] || null;
    const key = `hr:exclusion-batch:${(firstDue || 'none').slice(0, 7)}`;
    wanted.set(key, {
      organizationId,
      audience: 'hr',
      kind: 'exclusion',
      title: `Exclusion screening due for ${people} staff member${people === 1 ? '' : 's'}`,
      detail: 'OIG LEIE, SAM.gov and Maryland Medicaid sanctions',
      dueOn: dateVal(firstDue),
      severity: exclusionDueItems.some((i) => i.status === 'expired') ? 'critical' : 'warning',
      sourceType: 'exclusion',
      sourceId: 'batch',
      href: '/dashboard/hr/credentialing?view=exclusions',
      dedupeKey: key,
    });
  }
  // Trainings: HR gets one reminder per person; the person gets one per training.
  const trainingByUser = new Map<string, ExpirationItem[]>();
  for (const i of items.filter((x) => x.source === 'training')) {
    trainingByUser.set(i.userId, [...(trainingByUser.get(i.userId) ?? []), i]);
  }
  for (const [userId, list] of trainingByUser) {
    const firstDue = list.map((i) => i.dueOn || '').sort()[0] || null;
    const key = `hr:training-person:${userId}:${(firstDue || 'none').slice(0, 7)}`;
    wanted.set(key, {
      organizationId,
      audience: 'hr',
      subjectUserId: userId,
      kind: 'training',
      title: `${list.length} required training${list.length === 1 ? '' : 's'} due: ${list[0].staffName}`,
      detail: list.map((i) => i.label).slice(0, 4).join(', '),
      dueOn: dateVal(firstDue),
      severity: list.some((i) => i.status === 'expired') ? 'critical' : 'warning',
      sourceType: 'training',
      sourceId: userId,
      href: '/dashboard/hr/training',
      dedupeKey: key,
    });
  }
  for (const i of items) {
    if (i.source === 'exclusion') continue;
    const base = {
      organizationId,
      subjectUserId: i.userId,
      kind: i.source,
      title: reminderTitle(i),
      detail: `${i.staffName} · ${i.category}`,
      dueOn: i.dueOn ? new Date(`${i.dueOn}T12:00:00.000Z`) : null,
      severity: severityFor(i.status),
      sourceType: i.source,
      sourceId: i.sourceId,
      href: i.href,
    };
    const hrKey = `hr:${i.key}:${i.dueOn ?? 'none'}`;
    if (i.source !== 'training') wanted.set(hrKey, { ...base, audience: 'hr', dedupeKey: hrKey });
    if (i.staffActionable) {
      const staffKey = `staff:${i.key}:${i.dueOn ?? 'none'}`;
      wanted.set(staffKey, {
        ...base,
        audience: 'staff',
        assigneeUserId: i.userId,
        dedupeKey: staffKey,
        detail: i.category,
        href: '/dashboard/hr/me',
      });
    }
  }
  try {
    const existing = await prisma.hrTask.findMany({
      where: { organizationId, sourceType: { not: null }, status: { in: ['open', 'dismissed', 'done'] } },
      select: { id: true, dedupeKey: true, status: true, severity: true, title: true },
    });
    const byKey = new Map(existing.map((e) => [e.dedupeKey, e]));
    const toCreate = [...wanted.values()].filter((w) => !byKey.has(w.dedupeKey));
    const toResolve = existing.filter((e) => e.status === 'open' && !wanted.has(e.dedupeKey)).map((e) => e.id);
    const toUpdate = existing.filter((e) => {
      const w = wanted.get(e.dedupeKey);
      return w && e.status === 'open' && (w.severity !== e.severity || w.title !== e.title);
    });
    if (toCreate.length) await prisma.hrTask.createMany({ data: toCreate, skipDuplicates: true });
    if (toResolve.length) await prisma.hrTask.updateMany({ where: { id: { in: toResolve } }, data: { status: 'resolved', resolvedAt: new Date() } });
    for (const e of toUpdate) {
      const w = wanted.get(e.dedupeKey)!;
      await prisma.hrTask.update({ where: { id: e.id }, data: { severity: w.severity, title: w.title } });
    }
    return { skipped: false as const, created: toCreate.length, resolved: toResolve.length, updated: toUpdate.length };
  } catch (err) {
    if (isMissingTable(err)) return { skipped: true as const };
    throw err;
  }
}

// ─── Expired license flag (scheduling / billing) ─────────────────────────────

export type LicenseFlag = { userId: string; name: string; title: string; expiredOn: string; daysExpired: number };

/**
 * Clinicians whose most recent professional license has expired. Scheduling and billing show a
 * warning to HR / leadership; blocking happens only when HrSettings.blockSchedulingWhenLicenseExpired is on.
 */
export async function expiredLicenseFlags(organizationId: string, userIds?: string[]): Promise<LicenseFlag[]> {
  const today = await practiceTodayFor(organizationId);
  let rows;
  try {
    rows = await prisma.staffCredential.findMany({
      where: { organizationId, credentialType: 'LICENSE', ...(userIds ? { userId: { in: userIds } } : {}) },
      include: { user: { select: { name: true, email: true, role: true, status: true } } },
    });
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    if (r.user.status === 'DEACTIVATED') continue;
    if (!isLicensedRole(String(r.user.role)) && !isClinicalRole(String(r.user.role))) continue;
    const cur = latest.get(r.userId);
    if (!cur || cur.expiresAt < r.expiresAt) latest.set(r.userId, r);
  }
  const out: LicenseFlag[] = [];
  for (const r of latest.values()) {
    const exp = ymd(r.expiresAt)!;
    if (exp < today) {
      out.push({
        userId: r.userId,
        name: r.user.name?.trim() || r.user.email,
        title: r.title,
        expiredOn: exp,
        daysExpired: Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${exp}T12:00:00Z`)) / 86_400_000),
      });
    }
  }
  return out.sort((a, b) => b.daysExpired - a.daysExpired);
}

/**
 * Scheduling guard for appointment creation: blocks only when the practice turned on
 * "Block scheduling when license expired" (default OFF) and the clinician's license has expired.
 */
export async function schedulingLicenseBlock(
  organizationId: string,
  clinicianId: string | null | undefined,
): Promise<{ blocked: false } | { blocked: true; message: string }> {
  if (!clinicianId) return { blocked: false };
  // Opt-in policy (default off): if HR settings can't be read (e.g. migration not applied yet), never block booking.
  const settings = await loadHrSettings(organizationId).catch((err: unknown) => {
    console.warn('[hr] schedulingLicenseBlock: HR settings unavailable; not blocking', err);
    return null;
  });
  if (!settings?.blockSchedulingWhenLicenseExpired) return { blocked: false };
  const flags = await expiredLicenseFlags(organizationId, [clinicianId]);
  if (!flags.length) return { blocked: false };
  return {
    blocked: true,
    message: `This clinician's license (${flags[0].title}) expired ${flags[0].expiredOn}. The practice blocks scheduling until HR records the renewal.`,
  };
}
