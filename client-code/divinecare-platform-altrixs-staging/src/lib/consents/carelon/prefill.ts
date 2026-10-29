/**
 * Prefill for the Carelon non-overlap attestation (pure, browser-safe).
 *
 * Participant: legal first + last name, Participant ID = Maryland Medicaid (MA) number
 * (Client.medicaidId), else the Medicaid coverage member ID; when neither exists the field stays
 * empty and staff must enter it. A Participant ID is NEVER invented.
 * Provider: organization name, NPI and TIN from the billing providers that bill PBHS / Carelon
 * (Billing > Payer settings > Billing providers), the practice settings profile (legal name,
 * organization NPI, EIN) and verified site NPIs. Missing values block completion.
 */
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { isValidNpi } from '@/lib/practice/validators';
import { isPlaceholderNpi } from '@/lib/practice/placeholders';

export type ParticipantIdSource = 'medicaid_id' | 'coverage_member_id';

export type ParticipantPrefill = {
  participantName: string | null;
  participantId: string | null;
  participantIdSource: ParticipantIdSource | null;
  /** MM/DD/YYYY */
  dateOfBirth: string | null;
  warnings: string[];
};

export type ProviderOptionSource = 'billing_provider' | 'practice_settings' | 'site';

export type ProviderOption = {
  /** Stable key the staff picker sends back: "bp:<npi>", "ps:<npi>", "site:<locationId>" */
  key: string;
  source: ProviderOptionSource;
  label: string;
  organizationName: string | null;
  npi: string | null;
  /** 9 digits, no dash */
  tin: string | null;
  isDefault: boolean;
  locationKeys: string[];
};

export type ProviderPrefill = {
  optionKey: string | null;
  source: ProviderOptionSource | null;
  organizationName: string | null;
  npi: string | null;
  tin: string | null;
};

const MA_RE = /^\d{11}$/;
const clean = (v: string | null | undefined) => (v ?? '').trim();
const digits = (v: string | null | undefined) => clean(v).replace(/\D/g, '');
/** A real NPI (check digit passes, not an imported placeholder) or '' */
const realNpi = (v: string | null | undefined) => {
  const n = digits(v);
  return n && isValidNpi(n) && !isPlaceholderNpi(n) ? n : '';
};

/** Date-only value (UTC midnight, @db.Date / DOB) → MM/DD/YYYY. */
export function formatDateOnlyMdY(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const x = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(x.getTime())) return null;
  const mm = String(x.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(x.getUTCDate()).padStart(2, '0');
  return `${mm}/${dd}/${x.getUTCFullYear()}`;
}

/** Instant → MM/DD/YYYY on the practice clock. */
export function formatPracticeMdY(at: Date | string | null | undefined, timeZone: string): string | null {
  if (!at) return null;
  const x = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(x.getTime())) return null;
  const [y, m, d] = toPracticeWallTime(x, timeZone).date.split('-');
  return `${m}/${d}/${y}`;
}

/** "12-3456789" */
export function formatTin(tin: string | null | undefined): string | null {
  const t = digits(tin);
  return t.length === 9 ? `${t.slice(0, 2)}-${t.slice(2)}` : null;
}

/** "•••••6789" for screens; the full TIN only goes on the signed form / PDF. */
export function maskTin(tin: string | null | undefined): string | null {
  const t = digits(tin);
  return t ? `•••••${t.slice(-4)}` : null;
}

export function participantPrefill(
  client: {
    name: string;
    legalFirstName: string | null;
    legalLastName: string | null;
    dateOfBirth: Date | null;
    medicaidId: string | null;
  },
  coverageMemberId: string | null
): ParticipantPrefill {
  const warnings: string[] = [];
  const first = clean(client.legalFirstName);
  const last = clean(client.legalLastName);
  let participantName: string | null = first && last ? `${first} ${last}` : null;
  if (!participantName) {
    participantName = clean(client.name) || null;
    if (participantName) warnings.push('Legal first / last name not on file: the chart name is used. Confirm it matches the Medicaid card.');
  }
  const ma = digits(client.medicaidId);
  let participantId: string | null = null;
  let participantIdSource: ParticipantIdSource | null = null;
  if (MA_RE.test(ma)) {
    participantId = ma;
    participantIdSource = 'medicaid_id';
  } else {
    if (clean(client.medicaidId)) warnings.push('The Medicaid (MA) number on file is not 11 digits and was not used.');
    const member = clean(coverageMemberId);
    if (member) {
      participantId = member;
      participantIdSource = 'coverage_member_id';
      warnings.push('Participant ID is the Medicaid coverage member ID (no MA number on file). Confirm it, or enter the 11-digit MA number.');
    }
  }
  return { participantName, participantId, participantIdSource, dateOfBirth: formatDateOnlyMdY(client.dateOfBirth), warnings };
}

export type ProviderSources = {
  billingProviders: { npi: string; name: string; label: string | null; taxId: string; isDefault: boolean; active: boolean; locationKeys: string[] }[];
  practice: { legalName: string | null; dbaName: string | null; organizationNpi: string | null; taxId: string | null } | null;
  organizationName: string | null;
  locations: { id: string; name: string; code: string | null; npi: string | null; npiVerified: boolean; active: boolean }[];
};

/** Every NPI staff can choose: billing providers first, then the practice profile, then verified site NPIs. */
export function providerOptions(src: ProviderSources): ProviderOption[] {
  const out: ProviderOption[] = [];
  const seen = new Set<string>();
  for (const bp of src.billingProviders.filter((b) => b.active)) {
    const npi = realNpi(bp.npi);
    if (!npi || seen.has(npi)) continue;
    seen.add(npi);
    out.push({
      key: `bp:${npi}`,
      source: 'billing_provider',
      label: `${bp.label?.trim() || bp.name} (billing provider)`,
      organizationName: clean(bp.name) || null,
      npi,
      tin: digits(bp.taxId) || null,
      isDefault: bp.isDefault,
      locationKeys: bp.locationKeys,
    });
  }
  const practiceName = clean(src.practice?.legalName) || clean(src.practice?.dbaName) || clean(src.organizationName) || null;
  const practiceTin = digits(src.practice?.taxId) || null;
  const orgNpi = realNpi(src.practice?.organizationNpi);
  if (orgNpi && !seen.has(orgNpi)) {
    seen.add(orgNpi);
    out.push({ key: `ps:${orgNpi}`, source: 'practice_settings', label: `${practiceName ?? 'Practice'} (practice settings)`, organizationName: practiceName, npi: orgNpi, tin: practiceTin, isDefault: false, locationKeys: [] });
  }
  // Site NPIs share the group's name and TIN (the default billing provider's, else practice settings)
  const group = out.find((o) => o.source === 'billing_provider' && o.isDefault) ?? out.find((o) => o.source === 'billing_provider') ?? out.find((o) => o.source === 'practice_settings');
  for (const loc of src.locations.filter((l) => l.active && l.npiVerified)) {
    const npi = realNpi(loc.npi);
    if (!npi || seen.has(npi)) continue;
    seen.add(npi);
    out.push({
      key: `site:${loc.id}`,
      source: 'site',
      label: `${loc.name} site NPI`,
      organizationName: group?.organizationName ?? practiceName,
      npi,
      tin: group?.tin ?? practiceTin,
      isDefault: false,
      locationKeys: [loc.id, loc.name, ...(loc.code ? [loc.code] : [])],
    });
  }
  return out;
}

/**
 * The group / billing NPI that bills PBHS for this client: a billing provider for the client's
 * site, else the default billing provider, else the practice settings NPI, else the first option.
 */
export function defaultProviderOption(options: ProviderOption[], clientLocation: { id: string; name: string; code: string | null } | null): ProviderOption | null {
  const bps = options.filter((o) => o.source === 'billing_provider');
  if (clientLocation) {
    const keys = [clientLocation.id, clientLocation.name, clientLocation.code].filter(Boolean).map((k) => String(k).toLowerCase());
    const bySite = bps.filter((o) => o.locationKeys.some((k) => keys.includes(k.toLowerCase())));
    if (bySite.length === 1) return bySite[0];
    const def = bySite.find((o) => o.isDefault);
    if (def) return def;
  }
  return bps.find((o) => o.isDefault) ?? (bps.length === 1 ? bps[0] : null) ?? options.find((o) => o.source === 'practice_settings') ?? options[0] ?? null;
}

export function providerPrefill(option: ProviderOption | null): ProviderPrefill {
  return {
    optionKey: option?.key ?? null,
    source: option?.source ?? null,
    organizationName: option?.organizationName ?? null,
    npi: option?.npi ?? null,
    tin: option?.tin ?? null,
  };
}

/** Reasons the form cannot be signed yet (empty = complete). */
export function prefillBlockers(p: ParticipantPrefill, v: ProviderPrefill): string[] {
  const out: string[] = [];
  if (!p.participantName) out.push("Participant name is missing: add the client's legal first and last name.");
  if (!p.participantId) out.push("Participant ID is missing: enter the client's 11-digit Maryland Medicaid (MA) number. Altrixs never fills it in on its own.");
  if (!p.dateOfBirth) out.push("Participant date of birth is missing: add it to the client's demographics.");
  if (!v.organizationName) out.push('Provider organization name is missing: set the legal name in Practice settings > Profile (or the billing provider name).');
  if (!v.npi || !/^\d{10}$/.test(v.npi)) out.push('Provider NPI is missing: set the organization NPI in Practice settings > Profile, or add a billing provider (Billing > Payer settings).');
  if (!v.tin || !/^\d{9}$/.test(v.tin)) out.push('Provider TIN is missing: set the EIN in Practice settings > Profile (or on the billing provider).');
  return out;
}
