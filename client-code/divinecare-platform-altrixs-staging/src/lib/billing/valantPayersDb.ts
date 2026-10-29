import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { listPayerMappings } from './waystarConfig';
import {
  clientNameMatches,
  journalPayerNames,
  normalizePayerName,
  registryMatches,
  waystarValantReference,
  type NameCount,
  type PayerImportPlan,
  type PlannedAddress,
  type PlannedPayer,
} from './valantPayers';

/** Leadership + billing import Valant payers, confirm links and create registry entries. */
const EDIT_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);

export function canEditValantPayers(role: string | null | undefined) {
  return Boolean(role && EDIT_ROLES.has(String(role)));
}

type Db = Prisma.TransactionClient | typeof prisma;

function addressData(a: PlannedAddress, position: number) {
  return {
    addressKey: a.addressKey,
    addressLine: a.addressLine || null,
    city: a.city || null,
    state: a.state || null,
    zip: a.zip || null,
    addressRaw: a.addressRaw || null,
    addressStatus: a.addressStatus,
    addressIssues: a.addressIssues,
    phone: a.phone,
    phonesRaw: a.phonesRaw,
    phoneStatus: a.phoneStatus,
    phoneIssues: a.phoneIssues,
    taxIdsRaw: a.taxIdsRaw,
    sourceLines: a.sourceLines,
    position,
  };
}

/** Columns the import owns. Staff links (confirmedAliases, payerRegistryId) are never touched. */
function payerData(p: PlannedPayer, importId: string, now: Date) {
  return {
    name: p.name,
    normalizedName: p.normalizedName,
    ediPayerId: p.ediPayerId,
    nameVariants: p.nameVariants,
    addressLine: p.addressLine || null,
    city: p.city || null,
    state: p.state || null,
    zip: p.zip || null,
    addressRaw: p.addressRaw || null,
    phone: p.phone,
    phoneRaw: p.phoneRaw || null,
    phoneStatus: p.phoneStatus,
    taxIdsRaw: p.taxIdsRaw || null,
    active: p.active,
    sourceRowHash: p.sourceRowHash,
    sourceRowCount: p.sourceRowCount,
    duplicateGroup: p.duplicateGroup,
    importId,
    importedAt: now,
  };
}

export async function loadExistingValantPayers(organizationId: string) {
  return prisma.valantPayer.findMany({
    where: { organizationId },
    select: { id: true, normalizedName: true, ediPayerId: true, sourceRowHash: true, duplicateGroup: true },
  });
}

/** Applies an import plan: creates new payers, replaces the addresses of changed ones. */
export async function applyValantPayerPlan(db: Db, organizationId: string, plan: PayerImportPlan, importId: string) {
  const now = new Date();
  for (const p of plan.create) {
    await db.valantPayer.create({
      data: {
        organizationId,
        ...payerData(p, importId, now),
        addresses: { create: p.addresses.map((a, i) => ({ organizationId, ...addressData(a, i) })) },
      },
    });
  }
  for (const { id, payer: p } of plan.update) {
    await db.valantPayer.update({ where: { id }, data: payerData(p, importId, now) });
    await db.valantPayerAddress.deleteMany({ where: { payerId: id, addressKey: { notIn: p.addresses.map((a) => a.addressKey) } } });
    for (const [i, a] of p.addresses.entries()) {
      const data = addressData(a, i);
      await db.valantPayerAddress.upsert({
        where: { payerId_addressKey: { payerId: id, addressKey: a.addressKey } },
        create: { organizationId, payerId: id, ...data },
        update: data,
      });
    }
  }
  return plan.create.length + plan.update.length;
}

// ─── Usage: client insurance, Valant A/R and journal ─────────────────────────

export type PayerUsage = {
  /** raw client payer name -> client ids (Client.insurancePayer + active ClientInsuranceCoverage) */
  clientIdsByName: Map<string, Set<string>>;
  activeClientIds: Set<string>;
  /** Valant insurance aging (latest as-of): normalized payer name -> total cents */
  agingByName: Map<string, number>;
  agingAsOf: string | null;
  /** Valant combined aging (latest as-of): normalized payer name -> patient rows */
  combinedAgingByName: Map<string, number>;
  /** Valant transaction journal: normalized payer name -> transactions */
  journalByName: Map<string, number>;
};

export async function loadPayerUsage(organizationId: string, knownNames: string[]): Promise<PayerUsage> {
  const clientIdsByName = new Map<string, Set<string>>();
  const add = (name: string | null | undefined, clientId: string) => {
    const n = (name || '').trim();
    if (!n) return;
    const set = clientIdsByName.get(n) ?? new Set<string>();
    set.add(clientId);
    clientIdsByName.set(n, set);
  };
  const [clients, coverages] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { id: true, insurancePayer: true, status: true } }),
    prisma.clientInsuranceCoverage.findMany({ where: { organizationId, active: true }, select: { clientId: true, payerName: true } }),
  ]);
  const activeClientIds = new Set<string>();
  for (const c of clients) {
    add(c.insurancePayer, c.id);
    if (String(c.status) === 'ACTIVE') activeClientIds.add(c.id);
  }
  for (const c of coverages) add(c.payerName, c.clientId);

  const known = new Set(knownNames.map(normalizePayerName));
  const agingByName = new Map<string, number>();
  const combinedAgingByName = new Map<string, number>();
  const journalByName = new Map<string, number>();
  let agingAsOf: string | null = null;
  // The Valant reference tables may not exist yet on a database without those migrations
  try {
    const latest = await prisma.valantInsuranceAgingSnapshot.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } });
    if (latest) {
      agingAsOf = latest.asOf.toISOString().slice(0, 10);
      const rows = await prisma.valantInsuranceAgingSnapshot.findMany({ where: { organizationId, asOf: latest.asOf }, select: { payerName: true, totalCents: true } });
      for (const r of rows) {
        const k = normalizePayerName(r.payerName);
        agingByName.set(k, (agingByName.get(k) ?? 0) + r.totalCents);
      }
    }
    const latestCombined = await prisma.valantCombinedAgingRow.findFirst({ where: { organizationId }, orderBy: { asOf: 'desc' }, select: { asOf: true } });
    if (latestCombined) {
      const rows = await prisma.valantCombinedAgingRow.groupBy({
        by: ['payerName'],
        where: { organizationId, asOf: latestCombined.asOf, payerName: { not: null } },
        _count: { _all: true },
      });
      for (const r of rows) {
        const k = normalizePayerName(r.payerName);
        combinedAgingByName.set(k, (combinedAgingByName.get(k) ?? 0) + r._count._all);
      }
    }
    const journal = await prisma.valantTransaction.groupBy({
      by: ['insurance'],
      where: { organizationId, insurance: { not: null } },
      _count: { _all: true },
    });
    for (const r of journal) {
      for (const name of journalPayerNames(r.insurance ?? '', known)) {
        const k = normalizePayerName(name);
        journalByName.set(k, (journalByName.get(k) ?? 0) + r._count._all);
      }
    }
  } catch (error) {
    console.warn('[valant payers] Valant A/R usage unavailable:', error instanceof Error ? error.message : 'unknown error');
  }
  return { clientIdsByName, activeClientIds, agingByName, agingAsOf, combinedAgingByName, journalByName };
}

export function nameCounts(usage: PayerUsage): NameCount[] {
  return [...usage.clientIdsByName.entries()].map(([name, ids]) => ({ name, count: ids.size }));
}

// ─── List ────────────────────────────────────────────────────────────────────

export type InsuranceCompanyRow = {
  id: string;
  name: string;
  nameVariants: string[];
  ediPayerId: string;
  active: boolean;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  addressRaw: string | null;
  phone: string | null;
  phoneRaw: string | null;
  phoneStatus: string;
  /** a phone printed on this payer is one of the practice's own billing-provider numbers */
  practicePhone: boolean;
  sourceRowCount: number;
  duplicateGroup: string | null;
  duplicates: { id: string; name: string; ediPayerId: string }[];
  addresses: {
    id: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    addressRaw: string | null;
    addressStatus: string;
    addressIssues: string[];
    phone: string | null;
    phonesRaw: string[];
    phoneStatus: string;
    phoneIssues: string[];
    taxIdsRaw: string[];
    sourceLines: number[];
  }[];
  clientCount: number;
  activeClientCount: number;
  /** another Valant payer has the same normalized name, so the client count is shared */
  sharedName: boolean;
  clientNames: { name: string; count: number; kind: 'exact' | 'confirmed' }[];
  suggestedClientNames: { name: string; count: number; score: number }[];
  confirmedAliases: string[];
  agingCents: number | null;
  combinedAgingRows: number;
  journalTransactions: number;
  registry: { id: string; payerId: string; name: string; clearinghouse: string; active: boolean } | null;
  registrySuggestions: { id: string; payerId: string; name: string; by: string }[];
  waystar: { id: string; payerName: string; waystarPayerId: string; verified: boolean; matchesValant: boolean } | null;
  importedAt: string;
};

export async function listInsuranceCompanies(organizationId: string) {
  const payers = await prisma.valantPayer.findMany({
    where: { organizationId },
    include: { addresses: { orderBy: { position: 'asc' } } },
    orderBy: { name: 'asc' },
  });
  const [registry, mappings, providers] = await Promise.all([
    prisma.payerRegistry.findMany({ where: { organizationId }, select: { id: true, payerId: true, name: true, clearinghouse: true, active: true } }).catch(() => []),
    listPayerMappings(organizationId).catch(() => []),
    prisma.billingProvider.findMany({ where: { organizationId: { in: [organizationId, '*'] } }, select: { phone: true } }).catch(() => []),
  ]);
  const practicePhones = new Set(providers.map((p) => (p.phone || '').replace(/\D/g, '')).filter((p) => p.length === 10));
  const usage = await loadPayerUsage(organizationId, payers.map((p) => p.name));
  const names = nameCounts(usage);
  const byNormalized = new Map<string, number>();
  for (const p of payers) byNormalized.set(p.normalizedName, (byNormalized.get(p.normalizedName) ?? 0) + 1);

  const rows: InsuranceCompanyRow[] = payers.map((p) => {
    const matches = clientNameMatches(p, names);
    const counted = matches.filter((m) => m.kind !== 'similar');
    const ids = new Set<string>();
    for (const m of counted) for (const id of usage.clientIdsByName.get(m.name) ?? []) ids.add(id);
    const keys = new Set([p.name, ...p.nameVariants, ...p.confirmedAliases].map(normalizePayerName));
    const sum = (map: Map<string, number>) => [...keys].reduce((n, k) => n + (map.get(k) ?? 0), 0);
    const reg = p.payerRegistryId ? registry.find((r) => r.id === p.payerRegistryId) ?? null : null;
    const mapping = mappings.find(
      (m) => m.active && [m.payerName, ...m.aliases].some((n) => keys.has(normalizePayerName(n)))
    );
    const phones = p.addresses.flatMap((a) => a.phonesRaw.map((x) => x.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '')));
    return {
      id: p.id,
      name: p.name,
      nameVariants: p.nameVariants,
      ediPayerId: p.ediPayerId,
      active: p.active,
      addressLine: p.addressLine,
      city: p.city,
      state: p.state,
      zip: p.zip,
      addressRaw: p.addressRaw,
      phone: p.phone,
      phoneRaw: p.phoneRaw,
      phoneStatus: p.phoneStatus,
      practicePhone: phones.some((x) => practicePhones.has(x)),
      sourceRowCount: p.sourceRowCount,
      duplicateGroup: p.duplicateGroup,
      duplicates: p.duplicateGroup
        ? payers.filter((o) => o.id !== p.id && o.duplicateGroup === p.duplicateGroup).map((o) => ({ id: o.id, name: o.name, ediPayerId: o.ediPayerId }))
        : [],
      addresses: p.addresses.map((a) => ({
        id: a.id,
        addressLine: a.addressLine,
        city: a.city,
        state: a.state,
        zip: a.zip,
        addressRaw: a.addressRaw,
        addressStatus: a.addressStatus,
        addressIssues: a.addressIssues,
        phone: a.phone,
        phonesRaw: a.phonesRaw,
        phoneStatus: a.phoneStatus,
        phoneIssues: a.phoneIssues,
        taxIdsRaw: a.taxIdsRaw,
        sourceLines: a.sourceLines,
      })),
      clientCount: ids.size,
      activeClientCount: [...ids].filter((id) => usage.activeClientIds.has(id)).length,
      sharedName: (byNormalized.get(p.normalizedName) ?? 0) > 1,
      clientNames: counted.map((m) => ({ name: m.name, count: m.count, kind: m.kind as 'exact' | 'confirmed' })),
      suggestedClientNames: matches.filter((m) => m.kind === 'similar').slice(0, 8).map((m) => ({ name: m.name, count: m.count, score: Math.round(m.score * 100) / 100 })),
      confirmedAliases: p.confirmedAliases,
      agingCents: usage.agingAsOf ? sum(usage.agingByName) : null,
      combinedAgingRows: sum(usage.combinedAgingByName),
      journalTransactions: sum(usage.journalByName),
      registry: reg,
      registrySuggestions: reg ? [] : registryMatches(p, registry),
      waystar: mapping
        ? {
            id: mapping.id,
            payerName: mapping.payerName,
            waystarPayerId: mapping.waystarPayerId,
            verified: mapping.verified,
            matchesValant: !p.ediPayerId || mapping.waystarPayerId.toUpperCase() === p.ediPayerId,
          }
        : null,
      importedAt: p.importedAt.toISOString(),
    };
  });

  // Client payer names that no Valant payer accounts for (exact or confirmed), most clients first
  const accounted = new Set(rows.flatMap((r) => r.clientNames.map((n) => normalizePayerName(n.name))));
  const unmatchedClientPayers = names
    .filter((n) => !accounted.has(normalizePayerName(n.name)))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return { rows, registryCount: registry.length, agingAsOf: usage.agingAsOf, unmatchedClientPayers };
}

/** Waystar payer mapping -> Valant payers with the same name (or a known equivalent). Read-only. */
export async function waystarValantCheck(organizationId: string) {
  const [mappings, payers] = await Promise.all([
    listPayerMappings(organizationId),
    prisma.valantPayer.findMany({ where: { organizationId }, select: { id: true, name: true, normalizedName: true, ediPayerId: true, nameVariants: true, confirmedAliases: true } }),
  ]);
  if (!payers.length) return { imported: false, references: [] };
  const usage = await loadPayerUsage(organizationId, payers.map((p) => p.name));
  const names = nameCounts(usage);
  const withCounts = payers.map((p) => {
    const ids = new Set<string>();
    for (const m of clientNameMatches(p, names).filter((x) => x.kind !== 'similar')) for (const id of usage.clientIdsByName.get(m.name) ?? []) ids.add(id);
    return { id: p.id, name: p.name, normalizedName: p.normalizedName, ediPayerId: p.ediPayerId, clientCount: ids.size };
  });
  return { imported: true, references: waystarValantReference(mappings, withCounts) };
}
