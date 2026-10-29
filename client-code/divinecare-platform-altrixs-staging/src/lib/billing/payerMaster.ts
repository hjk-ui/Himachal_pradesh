/**
 * Billing payer master (Billing › Payers, PayerRegistry). Pure: no Prisma, so the page and the
 * tests import it.
 *
 * Rules (owner-delegated, Oct 2026):
 *  - Every payer ID, address and timely-filing value is entered by staff. Nothing is defaulted
 *    from a guess; blanks are shown as "Missing".
 *  - "Start from Valant" prefills the name, address and phone from the Valant import. Valant's EDI
 *    payer ID is shown as a reference hint only and is NEVER filled in as the Waystar payer ID
 *    (Waystar's IDs can differ; see src/lib/billing/valantPayers.ts).
 *  - Waystar claim rules (filing code, modifiers, prior auth, supervisee rule, taxonomy) stay in
 *    WaystarPayerMapping and are edited through src/lib/billing/waystarConfig.ts. This file only
 *    finds the mapping that belongs to a payer.
 *  - Edit: billing + practice leadership. Audits name the changed fields only.
 */
import { z } from 'zod';

const EDIT_ROLES = new Set(['SUPER_ADMIN', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING']);

/** Billing + leadership edit payers and insurance panels (same as BILLING_AR_ROLES + platform admin). */
export function canEditPayerMaster(role: string | null | undefined) {
  return Boolean(role && EDIT_ROLES.has(String(role).toUpperCase()));
}

export const PAYER_TYPES = [
  ['medicare', 'Medicare'],
  ['medicaid', 'Medicaid'],
  ['medicare_advantage', 'Medicare Advantage'],
  ['commercial', 'Commercial'],
  ['mco_bh', 'MCO / BH carve-out (e.g. Carelon)'],
  ['self_pay', 'Self-pay'],
  ['other', 'Other'],
] as const;
export type PayerType = (typeof PAYER_TYPES)[number][0];
export const PAYER_TYPE_LABEL: Record<string, string> = Object.fromEntries(PAYER_TYPES);

export const ENROLLMENT_STATUSES = [
  ['unknown', 'Not recorded'],
  ['not_started', 'Not started'],
  ['submitted', 'Submitted'],
  ['enrolled', 'Enrolled'],
  ['not_applicable', 'Not applicable'],
] as const;
export const ENROLLMENT_LABEL: Record<string, string> = Object.fromEntries(ENROLLMENT_STATUSES);

/** Offered in the form; a legacy value on an existing row is kept and shown as is. */
export const CLEARINGHOUSE_OPTIONS = ['Waystar', 'Paper claims', 'Payer portal', 'Other'] as const;

export const US_STATES = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'VI', 'GU', 'AS', 'MP', 'AA', 'AE', 'AP',
]);

export const PAYER_ID_RE = /^[A-Z0-9-]{2,15}$/;

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess(blankToNull, s.nullable().optional());
const digits = (v: unknown) => (typeof v === 'string' ? v.replace(/\D/g, '') : v);
const usPhone = z.preprocess(
  (v) => {
    const d = digits(blankToNull(v));
    return typeof d === 'string' && d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  },
  z.string().regex(/^\d{10}$/, 'Phone and fax numbers are 10 digits').nullable().optional(),
);

export const payerMasterInputSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter the payer name').max(200),
    /** Waystar payer ID. Blank = not confirmed yet (shown as Missing). Never filled from Valant. */
    payerId: opt(z.string().trim().toUpperCase().regex(PAYER_ID_RE, 'Payer IDs are 2-15 letters, digits or dashes')),
    payerType: opt(z.enum(PAYER_TYPES.map((t) => t[0]) as [PayerType, ...PayerType[]])),
    clearinghouse: z.preprocess((v) => blankToNull(v) ?? 'Waystar', z.string().trim().min(1).max(40)),
    claimsAddressLine1: opt(z.string().trim().max(55)),
    claimsAddressLine2: opt(z.string().trim().max(55)),
    claimsCity: opt(z.string().trim().max(30)),
    claimsState: opt(
      z.string().trim().toUpperCase().refine((v) => US_STATES.has(v), 'State is a 2-letter US state code'),
    ),
    claimsZip: z.preprocess(
      (v) => digits(blankToNull(v)),
      z.string().regex(/^(\d{5}|\d{9})$/, 'ZIP is 5 or 9 digits').nullable().optional(),
    ),
    phone: usPhone,
    fax: usPhone,
    portalUrl: opt(
      z
        .string()
        .trim()
        .max(300)
        .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
        .refine((v) => {
          try {
            const u = new URL(v);
            return /^https?:$/.test(u.protocol) && u.hostname.includes('.');
          } catch {
            return false;
          }
        }, 'Enter a web address like provider.example.com'),
    ),
    /** Days from DOS (verify against the payer contract). Same range as the Waystar filing limit. */
    timelyFilingDays: z.preprocess(
      (v) => (v === '' || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
      z.number().int('Timely filing is whole days').min(30, 'Timely filing is 30 to 1095 days').max(1095, 'Timely filing is 30 to 1095 days').nullable(),
    ),
    eraEnrollmentStatus: z.preprocess((v) => blankToNull(v) ?? 'unknown', z.string().trim().min(1).max(30)),
    eftEnrollmentStatus: z.preprocess((v) => blankToNull(v) ?? 'unknown', z.string().trim().min(1).max(30)),
    notes: opt(z.string().trim().max(2000)),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const parts = [v.claimsAddressLine1, v.claimsCity, v.claimsState, v.claimsZip];
    if (parts.some(Boolean) || v.claimsAddressLine2) {
      const missing = (
        [
          ['claimsAddressLine1', 'street'],
          ['claimsCity', 'city'],
          ['claimsState', 'state'],
          ['claimsZip', 'ZIP'],
        ] as const
      ).filter(([k]) => !v[k]);
      for (const [k, label] of missing) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `Claims address needs a ${label} (or leave the whole address blank)` });
      }
    }
  });

export type PayerMasterInput = z.infer<typeof payerMasterInputSchema>;

/** Persisted fields (PayerRegistry columns) from validated input. claimsAddress mirrors the structured address. */
export function payerMasterData(input: PayerMasterInput) {
  return {
    name: input.name,
    payerId: input.payerId ?? null,
    payerType: input.payerType ?? null,
    clearinghouse: input.clearinghouse,
    claimsAddressLine1: input.claimsAddressLine1 ?? null,
    claimsAddressLine2: input.claimsAddressLine2 ?? null,
    claimsCity: input.claimsCity ?? null,
    claimsState: input.claimsState ?? null,
    claimsZip: input.claimsZip ?? null,
    claimsAddress: formatAddress(input) || null,
    phone: input.phone ?? null,
    fax: input.fax ?? null,
    portalUrl: input.portalUrl ?? null,
    timelyFilingDays: input.timelyFilingDays ?? null,
    eraEnrollmentStatus: input.eraEnrollmentStatus,
    eftEnrollmentStatus: input.eftEnrollmentStatus,
    notes: input.notes ?? null,
    active: input.active,
  };
}

export type PayerMasterData = ReturnType<typeof payerMasterData>;

/** Field names whose value differs (for the audit log: names only, never values). */
export function changedFields(before: Record<string, unknown> | null, after: Record<string, unknown>): string[] {
  const norm = (v: unknown) => (v === undefined || v === '' ? null : v instanceof Date ? v.toISOString().slice(0, 10) : Array.isArray(v) ? JSON.stringify([...v].sort()) : v);
  return Object.keys(after)
    .filter((k) => norm(before ? before[k] : null) !== norm(after[k]))
    .sort();
}

export function formatZip(zip: string | null | undefined) {
  const d = (zip || '').replace(/\D/g, '');
  return d.length === 9 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function formatPhone(v: string | null | undefined) {
  const d = (v || '').replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : v || '';
}

export function formatAddress(a: {
  claimsAddressLine1?: string | null;
  claimsAddressLine2?: string | null;
  claimsCity?: string | null;
  claimsState?: string | null;
  claimsZip?: string | null;
}) {
  const street = [a.claimsAddressLine1, a.claimsAddressLine2].filter(Boolean).join(', ');
  const cityLine = [a.claimsCity, [a.claimsState, formatZip(a.claimsZip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return [street, cityLine].filter(Boolean).join(', ');
}

// ─── List rows / filters ─────────────────────────────────────────────────────

export type PayerMasterRow = PayerMasterData & {
  id: string;
  updatedAt: string;
  /** Valant insurance companies linked to this payer */
  valant: { id: string; name: string; ediPayerId: string }[];
  /** linked Waystar claim rules (WaystarPayerMapping) */
  waystar: LinkedMapping | null;
};

export type LinkedMapping = {
  id: string;
  payerName: string;
  waystarPayerId: string;
  scope: 'global' | 'organization';
  verified: boolean;
  active: boolean;
  /** how it was matched */
  by: 'name' | 'alias' | 'payer_id';
};

export function missingPayerId(p: { payerId?: string | null }) {
  return !p.payerId?.trim();
}

export function missingAddress(p: { claimsAddressLine1?: string | null; claimsCity?: string | null; claimsState?: string | null; claimsZip?: string | null }) {
  return !(p.claimsAddressLine1 && p.claimsCity && p.claimsState && p.claimsZip);
}

export type PayerFilter = {
  q?: string;
  type?: string;
  /** 'active' | 'inactive' | 'all' */
  status?: string;
  missingPayerId?: boolean;
  missingAddress?: boolean;
};

export function filterPayers<T extends PayerMasterData & { valant?: { name: string; ediPayerId: string }[] }>(rows: T[], f: PayerFilter): T[] {
  const q = (f.q || '').trim().toLowerCase();
  return rows.filter((r) => {
    if (f.type && f.type !== 'all' && (r.payerType || 'none') !== f.type) return false;
    if (f.status === 'active' && !r.active) return false;
    if (f.status === 'inactive' && r.active) return false;
    if (f.missingPayerId && !missingPayerId(r)) return false;
    if (f.missingAddress && !missingAddress(r)) return false;
    if (q) {
      const hay = [r.name, r.payerId, r.claimsCity, r.claimsState, ...(r.valant ?? []).map((v) => v.name)].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ─── Waystar mapping link ────────────────────────────────────────────────────

/** Same normalization as waystarSftpClaims / valantPayers.normalizePayerName. */
export function normalizeName(name: string | null | undefined) {
  return (name || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

type MappingLike = { id: string; payerName: string; aliases: string[]; waystarPayerId: string; scope: 'global' | 'organization'; verified: boolean; active: boolean };

/** The Waystar mapping that belongs to a payer: exact name, then alias, then the same payer ID. */
export function findLinkedMapping(payer: { name: string; payerId?: string | null }, mappings: MappingLike[]): LinkedMapping | null {
  const key = normalizeName(payer.name);
  const pick = (m: MappingLike, by: LinkedMapping['by']): LinkedMapping => ({
    id: m.id, payerName: m.payerName, waystarPayerId: m.waystarPayerId, scope: m.scope, verified: m.verified, active: m.active, by,
  });
  const ordered = [...mappings].sort((a, b) => Number(b.active) - Number(a.active));
  const byName = ordered.find((m) => normalizeName(m.payerName) === key);
  if (byName) return pick(byName, 'name');
  const byAlias = ordered.find((m) => m.aliases.some((a) => normalizeName(a) === key));
  if (byAlias) return pick(byAlias, 'alias');
  const id = (payer.payerId || '').trim().toUpperCase();
  const byId = id ? ordered.find((m) => m.waystarPayerId.toUpperCase() === id) : undefined;
  return byId ? pick(byId, 'payer_id') : null;
}

/** Suggested SBR09 for a new Waystar mapping (staff confirm in the form). Only the unambiguous types. */
export function suggestedFilingCode(type: string | null | undefined): string {
  if (type === 'medicare') return 'MB';
  if (type === 'medicaid') return 'MC';
  if (type === 'commercial') return 'CI';
  return '';
}

// ─── Start from Valant ───────────────────────────────────────────────────────

export type ValantPayerOption = {
  id: string;
  name: string;
  ediPayerId: string;
  payerRegistryId: string | null;
  addresses: {
    id: string;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    addressRaw: string | null;
    addressStatus: string;
    phone: string | null;
  }[];
};

/**
 * Form values prefilled from a Valant insurance company and the chosen address. The Waystar payer
 * ID is ALWAYS left blank: Valant's EDI ID comes back separately as `valantEdiHint` for display.
 */
export function prefillFromValant(v: ValantPayerOption, addressId?: string | null) {
  const a = v.addresses.find((x) => x.id === addressId) ?? v.addresses[0] ?? null;
  const zip = (a?.zip || '').replace(/\D/g, '');
  const state = (a?.state || '').trim().toUpperCase();
  return {
    form: {
      name: v.name,
      payerId: '',
      claimsAddressLine1: a?.addressLine || '',
      claimsAddressLine2: '',
      claimsCity: a?.city || '',
      claimsState: US_STATES.has(state) ? state : '',
      claimsZip: zip.length === 5 || zip.length === 9 ? zip : '',
      phone: a?.phone || '',
    },
    addressId: a?.id ?? null,
    /** shown as "Valant EDI ID (verify against Waystar's payer list)"; never copied into payerId */
    valantEdiHint: v.ediPayerId || null,
    addressWarning: a && a.addressStatus !== 'ok' ? `Valant address is ${a.addressStatus}: check it against the payer's current claims address` : null,
  };
}
