/**
 * Per-client consent status (pure): what is required, signed (version / date / signer), pending,
 * expired, revoked, declined or needs re-signing (a newer Active version that requires it, or the
 * template's renewal cadence). The chart card, banner, inbox and "Consent compliance" report all
 * use computeClientConsents + summarize/filter, so their counts always equal their lists.
 */
import type { ConsentTemplateVersion } from './types';
import { latestTitle, LEGACY_TYPE_TO_KEY, templateKeyOf } from './catalog';
import type { ComposeResult } from './composer';
import { EXPIRING_WITHIN_DAYS, type StandardStatus } from './requirements';

export type ConsentRowLite = {
  id: string;
  formKey: string | null;
  type: string;
  formVersion: string | null;
  /** ConsentFormStatus */
  status: string;
  formStatus: string | null;
  signedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  signedByName: string | null;
  recipientName: string | null;
  /** formData.purposeTag (emergency_contact / tpo) */
  purposeTag?: string | null;
};

export type ConsentState = 'signed' | 'pending' | 'missing' | 'expired' | 'revoked' | 'needs_resign' | 'declined';

export const CONSENT_STATE_LABEL: Record<ConsentState, string> = {
  signed: 'Signed',
  pending: 'Sent, awaiting signature',
  missing: 'Missing',
  expired: 'Expired',
  revoked: 'Revoked',
  needs_resign: 'Needs re-sign (new version)',
  declined: 'Declined',
};

export type ClientConsentItem = {
  /** template key, or "<key>:<row id>" for per-recipient authorizations */
  itemKey: string;
  templateKey: string;
  title: string;
  required: boolean;
  state: ConsentState;
  needsAction: boolean;
  signedVersion: number | null;
  legacy: boolean;
  activeVersion: number | null;
  signedAt: string | null;
  signerName: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  rowId: string | null;
  recipient: string | null;
  reason: string | null;
  /** Whole days until a signed consent expires (negative = past); null = no expiration */
  daysToExpiry: number | null;
  /** Front-desk status: complete / missing / expiring (within 30 days) / expired / revoked */
  standard: StandardStatus;
  /** Why it is "missing" when something is on file (sent, declined, new version) */
  detail: string | null;
};

const PER_RECIPIENT = new Set(['roi-authorization', 'part2-consent', 'card-on-file-authorization', 'psychiatric-medication-consent']);
const VOID = new Set(['VOIDED', 'SUPERSEDED']);

export function keyOf(r: ConsentRowLite): string | null {
  return templateKeyOf(r.formKey) ?? (r.formKey ? null : LEGACY_TYPE_TO_KEY[r.type] ?? null);
}

export function stateOf(r: ConsentRowLite, active: ConsentTemplateVersion | null, now: Date): { state: ConsentState; version: number | null; legacy: boolean } {
  const legacy = !r.formKey;
  const version = legacy ? null : Number(r.formVersion) || null;
  if (r.revokedAt || r.formStatus === 'REVOKED') return { state: 'revoked', version, legacy };
  if (r.status === 'DECLINED') return { state: 'declined', version, legacy };
  if (r.status === 'EXPIRED') return { state: 'expired', version, legacy };
  if (r.status === 'SIGNED') {
    if (r.expiresAt && r.expiresAt.getTime() < now.getTime()) return { state: 'expired', version, legacy };
    if (!legacy && active && version !== null && active.version > version && active.resignOnNewVersion) return { state: 'needs_resign', version, legacy };
    return { state: 'signed', version, legacy };
  }
  return { state: 'pending', version, legacy };
}

const ACTION_STATES: readonly ConsentState[] = ['missing', 'expired', 'revoked', 'needs_resign', 'declined', 'pending'];

const DAY = 86_400_000;

/** Map the detailed state to the front-desk status (pure). */
export function standardStatusOf(state: ConsentState, daysToExpiry: number | null): { standard: StandardStatus; detail: string | null } {
  switch (state) {
    case 'revoked':
      return { standard: 'revoked', detail: null };
    case 'expired':
      return { standard: 'expired', detail: null };
    case 'signed':
      return daysToExpiry !== null && daysToExpiry <= EXPIRING_WITHIN_DAYS ? { standard: 'expiring', detail: `Expires in ${Math.max(0, daysToExpiry)} day${daysToExpiry === 1 ? '' : 's'}` } : { standard: 'complete', detail: null };
    case 'needs_resign':
      return { standard: 'missing', detail: 'New version: client must re-sign' };
    case 'pending':
      return { standard: 'missing', detail: 'Sent, not signed yet' };
    case 'declined':
      return { standard: 'missing', detail: 'Client declined' };
    default:
      return { standard: 'missing', detail: null };
  }
}

/** Best row for an "any row" requirement: a valid signed one first, else the latest. */
function bestRow(list: ConsentRowLite[], active: (key: string) => ConsentTemplateVersion | null, key: string, now: Date): ConsentRowLite | null {
  return list.find((r) => stateOf(r, active(key), now).state === 'signed') ?? list[0] ?? null;
}

/**
 * @param composed  the packet composition for this client (what is required)
 * @param activeOf  Active version per template key
 */
export function computeClientConsents(input: { composed: Pick<ComposeResult, 'items'>; rows: ConsentRowLite[]; activeOf: (key: string) => ConsentTemplateVersion | null; now: Date }): ClientConsentItem[] {
  const rows = input.rows.filter((r) => !VOID.has(r.formStatus ?? '')).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const byKey = new Map<string, ConsentRowLite[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    byKey.set(k, [...(byKey.get(k) ?? []), r]);
  }
  const out: ClientConsentItem[] = [];
  const view = (templateKey: string, itemKey: string, r: ConsentRowLite | null, required: boolean, reason: string | null): ClientConsentItem => {
    const active = input.activeOf(templateKey);
    const s = r ? stateOf(r, active, input.now) : { state: 'missing' as const, version: null, legacy: false };
    const daysToExpiry = r?.expiresAt ? Math.floor((r.expiresAt.getTime() - input.now.getTime()) / DAY) : null;
    const std = standardStatusOf(s.state, daysToExpiry);
    return {
      itemKey,
      templateKey,
      title: active?.title ?? latestTitle(templateKey),
      required,
      state: s.state,
      needsAction: required && ACTION_STATES.includes(s.state),
      signedVersion: s.version,
      legacy: s.legacy,
      activeVersion: active?.version ?? null,
      signedAt: r?.signedAt?.toISOString() ?? null,
      signerName: r?.signedByName ?? null,
      expiresAt: r?.expiresAt?.toISOString() ?? null,
      revokedAt: r?.revokedAt?.toISOString() ?? null,
      rowId: r?.id ?? null,
      recipient: r?.recipientName ?? null,
      reason,
      daysToExpiry,
      standard: std.standard,
      detail: std.detail,
    };
  };

  const seen = new Set<string>();
  for (const item of input.composed.items) {
    const list = byKey.get(item.key) ?? [];
    if (item.purposeTag) {
      // the emergency-contact ROI / TPO Part 2 consent: satisfied by a row with the same purpose
      const r = list.find((x) => x.purposeTag === item.purposeTag) ?? null;
      out.push(view(item.key, `${item.key}:${item.purposeTag}`, r, !item.optional || item.purposeTag === 'emergency_contact', item.reason));
      if (r) seen.add(r.id);
      continue;
    }
    if (PER_RECIPIENT.has(item.key)) {
      // Required by a rule (requirements.ts): any valid form of this template satisfies it
      if (!item.anyRow) continue;
      const r = bestRow(list, input.activeOf, item.key, input.now);
      out.push(view(item.key, item.key, r, !item.optional, item.reason));
      if (r) seen.add(r.id);
      continue;
    }
    const r = list[0] ?? null;
    out.push(view(item.key, item.key, r, !item.optional, item.reason));
    seen.add(item.key);
  }
  // Rows on file that are not required by the packet (per-recipient ROIs, legacy consents, etc.)
  for (const [key, list] of byKey) {
    if (PER_RECIPIENT.has(key)) {
      for (const r of list) if (!seen.has(r.id)) out.push(view(key, `${key}:${r.id}`, r, false, r.recipientName ? `Recipient: ${r.recipientName}` : null));
    } else if (!seen.has(key)) {
      out.push(view(key, key, list[0], false, 'On file (not required by the packet for this client)'));
    }
  }
  return out;
}

// ─── Summary / filter (report, inbox, chart) ─────────────────────────────────

export type ComplianceRow = ClientConsentItem & { clientId: string; clientName: string; mrn: string | null };

export type ComplianceFilter = 'needs_action' | 'missing' | 'expired' | 'revoked' | 'needs_resign' | 'declined' | 'pending' | 'signed' | 'all_required';

export function filterCompliance(rows: ComplianceRow[], f: ComplianceFilter): ComplianceRow[] {
  const req = rows.filter((r) => r.required);
  switch (f) {
    case 'needs_action':
      return req.filter((r) => r.needsAction);
    case 'all_required':
      return req;
    default:
      return req.filter((r) => r.state === f);
  }
}

export type ComplianceSummary = Record<ConsentState, number> & { required: number; needsAction: number; clientsNeedingAction: number };

export function summarizeCompliance(rows: ComplianceRow[]): ComplianceSummary {
  const s: ComplianceSummary = { required: 0, needsAction: 0, clientsNeedingAction: 0, signed: 0, pending: 0, missing: 0, expired: 0, revoked: 0, needs_resign: 0, declined: 0 };
  const clients = new Set<string>();
  for (const r of rows) {
    if (!r.required) continue;
    s.required += 1;
    s[r.state] += 1;
    if (r.needsAction) {
      s.needsAction += 1;
      clients.add(r.clientId);
    }
  }
  s.clientsNeedingAction = clients.size;
  return s;
}

/** Banner text: the required consents missing / expired / revoked / needing re-sign (pending excluded). */
export function bannerItems(items: ClientConsentItem[]): ClientConsentItem[] {
  return items.filter((i) => i.required && i.needsAction && i.state !== 'pending');
}
