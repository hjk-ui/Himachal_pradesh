import 'server-only';

/**
 * Practice settings persistence (PracticeSettings, PracticeBaa, Location fields) and the
 * overview the settings hub and setup wizard load. Every write is organization scoped,
 * audited with the changed field names only (never values), and leadership-gated by the API.
 */
import { Prisma, type PracticeSettings, type TelehealthPlatform } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { listBillingProviders, listPayerMappings } from '@/lib/billing/waystarConfig';
import { getOrCreateSchedulingSettings } from '@/lib/scheduling/manage';
import { labFacilityClia } from '@/lib/labs/facility';
import { parseRules } from '@/lib/measures/schedule';
import { practiceIntegrationStatuses } from './integrationStatus';
import {
  computePracticeChecklist,
  emptySettingsView,
  type BaaView,
  type ChecklistContext,
  type LocationView,
  type PracticeChecklist,
  type PracticeSettingsView,
} from './checklist';
import {
  DEFAULT_BAA_VENDORS,
  SECTION_SCHEMAS,
  SENSITIVE_FIELDS,
  baaInputSchema,
  changedFields,
  locationInputSchema,
  onboardingInputSchema,
  type EditableSectionKey,
} from './settings';
import { isValidNpi, maskTaxId } from './validators';
import { placeholderLocationFields } from './placeholders';

export type PracticeActor = { organizationId: string; userId: string; role: string };

const DATE_FIELDS = new Set(['omhcLicenseExpiresOn', 'prpLicenseExpiresOn', 'accreditationExpiresOn', 'signedOn', 'expiresOn']);
const LEADERSHIP_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
const RENDERING_ROLES = new Set(['CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP']);

const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

export function settingsView(row: PracticeSettings | null, envClia: string | null = null): PracticeSettingsView {
  if (!row) return { ...emptySettingsView(), cliaNumber: envClia, cliaFromEnv: Boolean(envClia) };
  const { taxId, organizationId: _org, createdAt: _c, updatedBy: _u, ...rest } = row;
  void _org; void _c; void _u;
  return {
    ...rest,
    cliaNumber: row.cliaNumber || envClia,
    cliaFromEnv: !row.cliaNumber && Boolean(envClia),
    taxIdMasked: maskTaxId(taxId),
    // Measurement-based care rule lists (JSON columns): only well-formed rows reach the page
    mbcProgramMeasures: parseRules(row.mbcProgramMeasures, 'programId'),
    mbcProviderMeasures: parseRules(row.mbcProviderMeasures, 'userId'),
    hasTaxId: Boolean(taxId),
    omhcLicenseExpiresOn: day(row.omhcLicenseExpiresOn),
    prpLicenseExpiresOn: day(row.prpLicenseExpiresOn),
    accreditationExpiresOn: day(row.accreditationExpiresOn),
    onboardingCompletedAt: row.onboardingCompletedAt ? row.onboardingCompletedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function getPracticeSettingsRow(organizationId: string) {
  return prisma.practiceSettings.findUnique({ where: { organizationId } });
}

/** Settings for consumers (claims, labs, inbox): the row's values or the column defaults. */
export async function loadPracticeSettings(organizationId: string): Promise<PracticeSettingsView> {
  try {
    return settingsView(await getPracticeSettingsRow(organizationId), labFacilityClia());
  } catch {
    // Table missing before the 20261018 migration runs: behave as "nothing entered"
    return settingsView(null, labFacilityClia());
  }
}

function auditSafe(fields: string[]) {
  return fields.map((f) => (SENSITIVE_FIELDS.has(f) ? `${f} (value withheld)` : f));
}

/** Saves one section of the PracticeSettings row. Returns the new view and the changed field names. */
export async function savePracticeSection(actor: PracticeActor, section: EditableSectionKey, raw: unknown) {
  const parsed = SECTION_SCHEMAS[section].parse(raw) as Record<string, unknown>;
  const existing = await getPracticeSettingsRow(actor.organizationId);

  const data: Record<string, unknown> = {};
  let telehealthPlatform: TelehealthPlatform | null = null;
  for (const [k, v] of Object.entries(parsed)) {
    if (v === undefined) continue; // e.g. taxId not re-entered: keep the stored value
    if (k === 'telehealthDefaultPlatform') {
      telehealthPlatform = v as TelehealthPlatform;
      continue;
    }
    data[k] = DATE_FIELDS.has(k) ? toDate(v as string | null) : v;
  }
  if (section === 'billing' && data.payToSameAsBilling === true) {
    for (const k of ['payToAddressLine1', 'payToAddressLine2', 'payToCity', 'payToState', 'payToZip']) data[k] = null;
  }

  const changed = changedFields((existing ?? {}) as Record<string, unknown>, data);
  const reviewed = Array.from(new Set([...(existing?.reviewedSections ?? []), section]));

  const row = await prisma.practiceSettings.upsert({
    where: { organizationId: actor.organizationId },
    create: { organizationId: actor.organizationId, ...(data as Prisma.PracticeSettingsUncheckedCreateInput), reviewedSections: reviewed, updatedBy: actor.userId },
    update: { ...(data as Prisma.PracticeSettingsUncheckedUpdateInput), reviewedSections: reviewed, updatedBy: actor.userId },
  });

  let telehealthChanged = false;
  if (telehealthPlatform) {
    const current = await prisma.telehealthSettings.findUnique({ where: { organizationId: actor.organizationId }, select: { defaultPlatform: true } });
    if (current?.defaultPlatform !== telehealthPlatform) {
      telehealthChanged = true;
      await prisma.telehealthSettings.upsert({
        where: { organizationId: actor.organizationId },
        create: { organizationId: actor.organizationId, defaultPlatform: telehealthPlatform },
        update: { defaultPlatform: telehealthPlatform },
      });
    }
  }
  const allChanged = telehealthChanged ? [...changed, 'telehealthDefaultPlatform'] : changed;

  await writeAuditLog({
    action: 'practice_settings_updated',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: actor.organizationId,
    resourceType: 'PracticeSettings',
    resourceId: row.id,
    metadata: { section, changedFields: auditSafe(allChanged), changedCount: allChanged.length },
  });

  return { settings: settingsView(row, labFacilityClia()), changedFields: allChanged };
}

/** Records the setup-wizard step (resume point) and, on the last step, completion. */
export async function saveOnboardingProgress(actor: PracticeActor, raw: unknown) {
  const input = onboardingInputSchema.parse(raw);
  const row = await prisma.practiceSettings.upsert({
    where: { organizationId: actor.organizationId },
    create: {
      organizationId: actor.organizationId,
      onboardingStep: input.step,
      onboardingCompletedAt: input.complete ? new Date() : null,
      updatedBy: actor.userId,
    },
    update: {
      onboardingStep: input.step,
      ...(input.complete ? { onboardingCompletedAt: new Date() } : {}),
      updatedBy: actor.userId,
    },
  });
  if (input.complete) {
    await writeAuditLog({
      action: 'practice_onboarding_completed',
      actorUserId: actor.userId,
      actorRole: actor.role,
      organizationId: actor.organizationId,
      resourceType: 'PracticeSettings',
      resourceId: row.id,
    });
  }
  return settingsView(row, labFacilityClia());
}

// ─── Locations ───────────────────────────────────────────────────────────────

type DbLocation = Awaited<ReturnType<typeof prisma.location.findMany>>[number];

function locationView(l: DbLocation): LocationView {
  return {
    id: l.id,
    name: l.name,
    code: l.code,
    addressLine1: l.addressLine1,
    addressLine2: l.addressLine2,
    city: l.city,
    state: l.state,
    postalCode: l.postalCode,
    phone: l.phone,
    fax: l.fax,
    npi: l.npi,
    posCode: l.posCode,
    timezone: l.timezone,
    active: l.active,
    isPrimary: l.isPrimary,
    businessHours: (l.businessHours && typeof l.businessHours === 'object' ? l.businessHours : null) as LocationView['businessHours'],
    unverifiedFields: placeholderLocationFields(l),
  };
}

export async function listPracticeLocations(organizationId: string): Promise<LocationView[]> {
  const rows = await prisma.location.findMany({
    where: { organizationId },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  });
  return rows.map(locationView);
}

/** Updates the practice-settings fields of a location (or creates one). Org scoped. */
export async function savePracticeLocation(actor: PracticeActor, raw: unknown) {
  const input = locationInputSchema.parse(raw);
  const fields = {
    name: input.name,
    code: input.code,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    phone: input.phone,
    fax: input.fax,
    npi: input.npi,
    posCode: input.posCode,
    timezone: input.timezone,
    active: input.active,
    businessHours: input.businessHours ? (input.businessHours as Prisma.InputJsonValue) : Prisma.DbNull,
  };

  let row: DbLocation;
  let changed: string[];
  if (input.id) {
    const existing = await prisma.location.findFirst({ where: { id: input.id, organizationId: actor.organizationId } });
    if (!existing) throw new PracticeSettingsError('Location not found', 404);
    const { businessHours, ...plain } = fields;
    changed = changedFields(existing as unknown as Record<string, unknown>, {
      ...plain,
      businessHours: input.businessHours ?? null,
    });
    void businessHours;
    row = await prisma.location.update({ where: { id: existing.id }, data: fields });
  } else {
    const count = await prisma.location.count({ where: { organizationId: actor.organizationId } });
    row = await prisma.location.create({ data: { organizationId: actor.organizationId, ...fields, isPrimary: count === 0 } });
    changed = Object.entries(fields)
      .filter(([, v]) => v !== null && v !== Prisma.DbNull)
      .map(([k]) => k)
      .sort();
  }

  await writeAuditLog({
    action: input.id ? 'practice_location_updated' : 'practice_location_created',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: actor.organizationId,
    resourceType: 'Location',
    resourceId: row.id,
    metadata: { changedFields: changed, changedCount: changed.length },
  });
  return locationView(row);
}

// ─── BAAs ────────────────────────────────────────────────────────────────────

export async function listPracticeBaas(organizationId: string): Promise<BaaView[]> {
  const rows = await prisma.practiceBaa.findMany({ where: { organizationId }, orderBy: { vendorName: 'asc' } });
  const views: BaaView[] = DEFAULT_BAA_VENDORS.map((v) => {
    const r = rows.find((x) => x.vendorKey === v.key);
    return {
      vendorKey: v.key,
      vendorName: r?.vendorName || v.name,
      service: v.service,
      status: (r?.status as BaaView['status']) || 'not_recorded',
      signedOn: day(r?.signedOn),
      expiresOn: day(r?.expiresOn),
      notes: r?.notes ?? null,
      requiredForGoLive: v.requiredForGoLive,
    };
  });
  for (const r of rows.filter((x) => !DEFAULT_BAA_VENDORS.some((v) => v.key === x.vendorKey))) {
    views.push({
      vendorKey: r.vendorKey,
      vendorName: r.vendorName,
      service: null,
      status: r.status as BaaView['status'],
      signedOn: day(r.signedOn),
      expiresOn: day(r.expiresOn),
      notes: r.notes,
      requiredForGoLive: false,
    });
  }
  return views;
}

export async function savePracticeBaa(actor: PracticeActor, raw: unknown) {
  const input = baaInputSchema.parse(raw);
  const data = {
    vendorName: input.vendorName,
    status: input.status,
    signedOn: toDate(input.signedOn),
    expiresOn: toDate(input.expiresOn),
    notes: input.notes,
    updatedBy: actor.userId,
  };
  const row = await prisma.practiceBaa.upsert({
    where: { organizationId_vendorKey: { organizationId: actor.organizationId, vendorKey: input.vendorKey } },
    create: { organizationId: actor.organizationId, vendorKey: input.vendorKey, ...data },
    update: data,
  });
  await writeAuditLog({
    action: 'practice_baa_saved',
    actorUserId: actor.userId,
    actorRole: actor.role,
    organizationId: actor.organizationId,
    resourceType: 'PracticeBaa',
    resourceId: row.id,
    metadata: { vendorKey: input.vendorKey, status: input.status },
  });
  return listPracticeBaas(actor.organizationId);
}

// ─── Overview ────────────────────────────────────────────────────────────────

export class PracticeSettingsError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

async function staffSummary(organizationId: string): Promise<ChecklistContext['staff']> {
  const users = await prisma.user.findMany({
    where: { organizationId, status: 'ACTIVE' },
    select: { role: true, roles: true, npi: true },
  });
  const isRole = (u: (typeof users)[number], set: Set<string>) => [u.role, ...u.roles].some((r) => set.has(String(r)));
  const clinicians = users.filter((u) => isRole(u, RENDERING_ROLES));
  return {
    active: users.length,
    leadership: users.filter((u) => isRole(u, LEADERSHIP_ROLES)).length,
    clinicians: clinicians.length,
    cliniciansMissingNpi: clinicians.filter((u) => !isValidNpi(u.npi)).length,
  };
}

async function quiet<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export type PracticeOverview = {
  organization: { id: string; name: string; slug: string };
  settings: PracticeSettingsView;
  locations: LocationView[];
  baas: BaaView[];
  billingProviders: ChecklistContext['billingProviders'] & { rows: Array<{ npi: string; label: string | null; isDefault: boolean; active: boolean; problems: string[] }> };
  payers: ChecklistContext['payers'];
  scheduling: ChecklistContext['scheduling'] & { appointmentTypes: Array<{ id: string; title: string; durationMin: number; enabled: boolean; defaultCpt: string | null }> };
  staff: ChecklistContext['staff'];
  integrations: ChecklistContext['integrations'];
  checklist: PracticeChecklist;
  migrationPending: boolean;
};

export async function loadPracticeOverview(organizationId: string): Promise<PracticeOverview> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true, name: true, slug: true } });
  if (!org) throw new PracticeSettingsError('Organization not found', 404);

  let migrationPending = false;
  const [row, locations, baas] = await Promise.all([
    getPracticeSettingsRow(organizationId).catch(() => {
      migrationPending = true;
      return null;
    }),
    listPracticeLocations(organizationId).catch(async () => {
      migrationPending = true;
      const rows = await prisma.location.findMany({
        where: { organizationId },
        select: { id: true, name: true, code: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, phone: true, timezone: true, active: true, isPrimary: true },
      });
      return rows.map((l) => ({ ...l, fax: null, npi: null, posCode: null, businessHours: null, unverifiedFields: placeholderLocationFields(l) }));
    }),
    listPracticeBaas(organizationId).catch(() => [] as BaaView[]),
  ]);
  const settings = settingsView(row, labFacilityClia());

  const providers = await quiet(() => listBillingProviders(organizationId), []);
  const activeProviders = providers.filter((p) => p.active);
  const def = activeProviders.find((p) => p.isDefault) ?? null;
  const billingProviders = {
    active: activeProviders.length,
    defaultNpi: def?.npi ?? null,
    problems: def ? def.problems : activeProviders.length ? ['No billing provider is marked as the default'] : ['No billing provider configured'],
    // Compared server-side so neither tax ID is sent to the browser by this route
    defaultTaxIdMatches: def && row?.taxId ? def.taxId.replace(/\D/g, '') === row.taxId : null,
    rows: providers.map((p) => ({ npi: p.npi, label: p.label ?? p.name, isDefault: p.isDefault, active: p.active, problems: p.problems })),
  };

  const mappings = await quiet(() => listPayerMappings(organizationId), []);
  const activeMappings = mappings.filter((m) => m.active);
  const payers = { active: activeMappings.length, verified: activeMappings.filter((m) => m.verified).length };

  const sched = await quiet(() => getOrCreateSchedulingSettings(organizationId), null);
  const telehealth = await quiet(
    () => prisma.telehealthSettings.findUnique({ where: { organizationId }, select: { defaultPlatform: true } }),
    null
  );
  const reminderChannels: string[] = [];
  if (sched?.reminders.emailConfirm || sched?.reminders.emailReminder24h) reminderChannels.push('email');
  if (sched?.reminders.smsConfirm || sched?.reminders.smsReminder24h || sched?.reminders.smsReminder2h) reminderChannels.push('sms');
  const scheduling = {
    enabledServices: sched ? sched.services.filter((s) => s.enabled).length : 0,
    reminderChannels,
    telehealthPlatform: telehealth?.defaultPlatform ?? null,
    appointmentTypes: (sched?.services ?? []).map((s) => ({
      id: s.id,
      title: s.title,
      durationMin: s.durationMin,
      enabled: s.enabled,
      defaultCpt: s.defaultCpt || null,
    })),
  };

  const staff = await quiet(() => staffSummary(organizationId), { active: 0, leadership: 0, clinicians: 0, cliniciansMissingNpi: 0 });
  const integrations = practiceIntegrationStatuses();

  const checklist = computePracticeChecklist({ settings, locations, billingProviders, payers, scheduling, baas, staff, integrations });
  return { organization: org, settings, locations, baas, billingProviders, payers, scheduling, staff, integrations, checklist, migrationPending };
}
