/**
 * Waystar outbound configuration stored in the database:
 *
 *  - waystar_payer_mappings: payer name / aliases -> Waystar payer ID, claim filing
 *    indicator (SBR09), telehealth modifier policy, prior-auth requirement, verified flag.
 *  - billing_providers: the practice's organization NPIs (837P 2010AA) and the rules
 *    that pick one per claim (department, rendering clinician role, client location).
 *
 * Rows with organization_id '*' apply to every organization on the deployment
 * (seeded by the 20261016 migration). Edits from the UI never change a '*' row:
 * they write an organization-scoped row with the same payer name / NPI, which
 * overrides it (active = false hides it).
 */
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { billingProviderProblems, type BillingProviderForBatch } from '@/lib/services/waystarSftpService';
import {
  FILING_CODES,
  findPayerMapping,
  normalizePayerName,
  payerPolicyDefaults,
  type BillingProviderConfig,
  type PayerMappingConfig,
} from './waystarSftpClaims';
import { isTaxonomyCode } from './claimRules';

export const GLOBAL_ORG = '*';

const BILLING_ADMIN: Role[] = ['SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING'];
const PRACTICE_ADMIN: Role[] = ['SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'];

/** Billing admins edit the Waystar payer mapping. */
export function canEditPayerMappings(role: Role | string | null | undefined) {
  return Boolean(role && (BILLING_ADMIN as string[]).includes(String(role)));
}

/** Practice admins edit billing providers (NPIs, tax ID, addresses). */
export function canEditBillingProviders(role: Role | string | null | undefined) {
  return Boolean(role && (PRACTICE_ADMIN as string[]).includes(String(role)));
}

// ─── Payer mappings ──────────────────────────────────────────────────────────

export type PayerMappingRow = PayerMappingConfig & {
  id: string;
  scope: 'global' | 'organization';
  notes: string | null;
  updatedAt: string;
};

type DbPayerMapping = Awaited<ReturnType<typeof prisma.waystarPayerMapping.findMany>>[number];

function payerRow(r: DbPayerMapping): PayerMappingRow {
  return {
    id: r.id,
    scope: r.organizationId === GLOBAL_ORG ? 'global' : 'organization',
    payerName: r.payerName,
    aliases: r.aliases,
    waystarPayerId: r.waystarPayerId,
    claimFilingCode: r.claimFilingCode,
    telehealthModifier: r.telehealthModifier,
    requiresPriorAuth: r.requiresPriorAuth,
    superviseeClaims: r.superviseeClaims,
    requireTaxonomy: r.requireTaxonomy,
    audioOnlyModifier: r.audioOnlyModifier,
    filingLimitDays: r.filingLimitDays,
    verified: r.verified,
    active: r.active,
    notes: r.notes,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Organization rows override '*' rows with the same (normalized) payer name. Inactive rows are kept (they hide a '*' row). */
export async function listPayerMappings(organizationId: string): Promise<PayerMappingRow[]> {
  const rows = await prisma.waystarPayerMapping.findMany({
    where: { organizationId: { in: [organizationId, GLOBAL_ORG] } },
    orderBy: { payerName: 'asc' },
  });
  const merged = new Map<string, PayerMappingRow>();
  for (const r of rows.filter((x) => x.organizationId === GLOBAL_ORG)) merged.set(normalizePayerName(r.payerName), payerRow(r));
  for (const r of rows.filter((x) => x.organizationId !== GLOBAL_ORG)) merged.set(normalizePayerName(r.payerName), payerRow(r));
  return Array.from(merged.values()).sort((a, b) => a.payerName.localeCompare(b.payerName));
}

/** Active mappings for the mapper. */
export async function loadPayerMappings(organizationId: string): Promise<PayerMappingConfig[]> {
  return (await listPayerMappings(organizationId)).filter((m) => m.active);
}

/** Waystar payer ID + filing code for a payer name, or null when unmapped. */
export async function waystarPayerFor(organizationId: string, payerName: string | null | undefined) {
  if (!payerName?.trim()) return null;
  return findPayerMapping(await loadPayerMappings(organizationId), payerName);
}

export const payerMappingInputSchema = z.object({
  payerName: z.string().trim().min(2).max(200),
  aliases: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  waystarPayerId: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,15}$/, 'Waystar payer IDs are 2-15 letters, digits or dashes'),
  claimFilingCode: z.string().trim().toUpperCase().refine((v) => FILING_CODES.has(v), 'Not a valid claim filing indicator (SBR09)'),
  telehealthModifier: z.enum(['95', 'GT', 'both', 'none']).default('95'),
  requiresPriorAuth: z.boolean().default(false),
  /** Omitted = payer default by filing code (Medicare not_allowed, else supervisee_with_2310D) */
  superviseeClaims: z.enum(['render_as_supervisor', 'supervisee_with_2310D', 'not_allowed']).optional(),
  /** Omitted = payer default (Medicaid / PBHS required) */
  requireTaxonomy: z.boolean().optional(),
  /** Omitted = payer default (Medicare 93, else not_allowed until billing confirms the payer's policy) */
  audioOnlyModifier: z.enum(['93', 'FQ', 'none', 'not_allowed']).optional(),
  /** Days from DOS; verify against the payer contract */
  filingLimitDays: z.number().int().min(30).max(1095).optional().nullable(),
  verified: z.boolean().default(false),
  notes: z.string().trim().max(1000).optional().nullable(),
  active: z.boolean().default(true),
});

export type PayerMappingInput = z.infer<typeof payerMappingInputSchema>;

/** Creates or updates this organization's row for the payer name (overriding a '*' row of the same name). */
export async function savePayerMapping(organizationId: string, actorUserId: string, input: unknown): Promise<PayerMappingRow> {
  const data = payerMappingInputSchema.parse(input);
  const key = normalizePayerName(data.payerName);
  const aliases = Array.from(new Set(data.aliases.filter((a) => normalizePayerName(a) && normalizePayerName(a) !== key)));
  // An alias or name already used by another active mapping would make matching ambiguous
  const others = (await listPayerMappings(organizationId)).filter((m) => m.active && normalizePayerName(m.payerName) !== key);
  if (data.active) {
    for (const name of [data.payerName, ...aliases]) {
      const clash = others.find((m) => [m.payerName, ...m.aliases].some((n) => normalizePayerName(n) === normalizePayerName(name)));
      if (clash) throw new Error(`"${name}" is already mapped by ${clash.payerName}`);
    }
  }
  const existing = (
    await prisma.waystarPayerMapping.findMany({ where: { organizationId } })
  ).find((r) => normalizePayerName(r.payerName) === key);
  const defaults = payerPolicyDefaults(data.claimFilingCode);
  const values = {
    payerName: data.payerName,
    aliases,
    waystarPayerId: data.waystarPayerId,
    claimFilingCode: data.claimFilingCode,
    telehealthModifier: data.telehealthModifier,
    requiresPriorAuth: data.requiresPriorAuth,
    superviseeClaims: data.superviseeClaims ?? existing?.superviseeClaims ?? defaults.superviseeClaims,
    requireTaxonomy: data.requireTaxonomy ?? existing?.requireTaxonomy ?? defaults.requireTaxonomy,
    audioOnlyModifier: data.audioOnlyModifier ?? existing?.audioOnlyModifier ?? defaults.audioOnlyModifier,
    filingLimitDays: data.filingLimitDays !== undefined ? data.filingLimitDays : existing?.filingLimitDays ?? null,
    verified: data.verified,
    notes: data.notes ?? null,
    active: data.active,
    updatedBy: actorUserId,
  };
  const row = existing
    ? await prisma.waystarPayerMapping.update({ where: { id: existing.id }, data: values })
    : await prisma.waystarPayerMapping.create({ data: { organizationId, ...values } });
  return payerRow(row);
}

// ─── Billing providers ───────────────────────────────────────────────────────

export type BillingProviderRow = BillingProviderConfig & {
  id: string;
  scope: 'global' | 'organization';
  problems: string[];
  updatedAt: string;
};

type DbBillingProvider = Awaited<ReturnType<typeof prisma.billingProvider.findMany>>[number];

function providerRow(r: DbBillingProvider): BillingProviderRow {
  const base: BillingProviderConfig = {
    id: r.id,
    npi: r.npi,
    name: r.name,
    label: r.label,
    taxId: r.taxId,
    address1: r.addressLine1,
    ...(r.addressLine2 ? { address2: r.addressLine2 } : {}),
    city: r.city,
    state: r.state,
    zip: r.zip,
    ...(r.phone ? { phone: r.phone } : {}),
    departments: r.departments,
    clinicianRoles: r.clinicianRoles,
    locationKeys: r.locationKeys,
    isDefault: r.isDefault,
    active: r.active,
    taxonomyCode: r.taxonomyCode,
  };
  return {
    ...base,
    id: r.id,
    scope: r.organizationId === GLOBAL_ORG ? 'global' : 'organization',
    problems: billingProviderProblems(base, `NPI ${r.npi}`),
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Organization rows override '*' rows with the same NPI. */
export async function listBillingProviders(organizationId: string): Promise<BillingProviderRow[]> {
  const rows = await prisma.billingProvider.findMany({
    where: { organizationId: { in: [organizationId, GLOBAL_ORG] } },
    orderBy: { npi: 'asc' },
  });
  const merged = new Map<string, BillingProviderRow>();
  for (const r of rows.filter((x) => x.organizationId === GLOBAL_ORG)) merged.set(r.npi, providerRow(r));
  for (const r of rows.filter((x) => x.organizationId !== GLOBAL_ORG)) merged.set(r.npi, providerRow(r));
  return Array.from(merged.values());
}

/** Active providers for the mapper. */
export async function loadBillingProviders(organizationId: string): Promise<BillingProviderConfig[]> {
  return (await listBillingProviders(organizationId)).filter((p) => p.active);
}

const list = z.array(z.string().trim().min(1).max(100)).max(30).default([]);

export const billingProviderInputSchema = z.object({
  npi: z.string().trim().regex(/^\d{10}$/, 'NPI is 10 digits'),
  name: z.string().trim().min(2).max(60),
  label: z.string().trim().max(100).optional().nullable(),
  taxId: z.string().trim().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^\d{9}$/, 'Tax ID is 9 digits')),
  address1: z.string().trim().min(2).max(55),
  address2: z.string().trim().max(55).optional().nullable(),
  city: z.string().trim().min(2).max(30),
  state: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, 'State is a 2-letter code'),
  zip: z.string().trim().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^\d{9}$/, 'ZIP+4 (9 digits) is required for the billing provider')),
  phone: z.string().trim().transform((v) => v.replace(/\D/g, '')).pipe(z.string().regex(/^(\d{10})?$/, 'Phone is 10 digits')).optional().nullable(),
  /** NUCC taxonomy for 2000A PRV*BI (blank = practice settings' primary taxonomy) */
  taxonomyCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine((v) => !v || isTaxonomyCode(v), 'Taxonomy is a 10-character NUCC code ending in X (e.g. 261QM0801X)')
    .optional()
    .nullable(),
  departments: list,
  clinicianRoles: list,
  locationKeys: list,
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});

/** Creates or updates this organization's row for the NPI. Exactly one default is kept. */
export async function saveBillingProvider(organizationId: string, actorUserId: string, input: unknown): Promise<BillingProviderRow> {
  const data = billingProviderInputSchema.parse(input);
  const problems = billingProviderProblems(
    { ...data, address2: data.address2 || undefined, phone: data.phone || undefined } as BillingProviderForBatch,
    `NPI ${data.npi}`
  );
  if (problems.length) throw new Error(problems.join('; '));
  const values = {
    name: data.name.toUpperCase(),
    label: data.label || null,
    taxId: data.taxId,
    addressLine1: data.address1.toUpperCase(),
    addressLine2: data.address2 ? data.address2.toUpperCase() : null,
    city: data.city.toUpperCase(),
    state: data.state,
    zip: data.zip,
    phone: data.phone || null,
    taxonomyCode: data.taxonomyCode || null,
    departments: data.departments.map((d) => d.toLowerCase()),
    clinicianRoles: data.clinicianRoles.map((r) => r.toUpperCase()),
    locationKeys: data.locationKeys,
    isDefault: data.isDefault && data.active,
    active: data.active,
    updatedBy: actorUserId,
  };
  const row = await prisma.$transaction(async (tx) => {
    if (values.isDefault) {
      // Clear other defaults; a '*' default is overridden by an org copy marked non-default
      const current = await listBillingProviders(organizationId);
      for (const p of current.filter((x) => x.isDefault && x.npi !== data.npi)) {
        if (p.scope === 'organization') await tx.billingProvider.update({ where: { id: p.id }, data: { isDefault: false } });
        else {
          const { id: _id, scope: _scope, problems: _p, updatedAt: _u, address1, address2, ...rest } = p;
          void _id; void _scope; void _p; void _u;
          await tx.billingProvider.upsert({
            where: { organizationId_npi: { organizationId, npi: p.npi } },
            update: { isDefault: false },
            create: {
              organizationId, npi: rest.npi, name: rest.name, label: rest.label ?? null, taxId: rest.taxId,
              addressLine1: address1, addressLine2: address2 ?? null, city: rest.city, state: rest.state, zip: rest.zip,
              phone: rest.phone ?? null, departments: rest.departments, clinicianRoles: rest.clinicianRoles,
              locationKeys: rest.locationKeys, isDefault: false, active: rest.active, updatedBy: actorUserId,
            },
          });
        }
      }
    }
    return tx.billingProvider.upsert({
      where: { organizationId_npi: { organizationId, npi: data.npi } },
      update: values,
      create: { organizationId, npi: data.npi, ...values },
    });
  });
  return providerRow(row);
}
