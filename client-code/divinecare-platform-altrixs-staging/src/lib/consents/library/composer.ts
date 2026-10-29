/**
 * Intake packet composer (pure). The practice picks which templates go in the new-client packet
 * (Library settings); for each client the rules below decide which of those apply:
 *   - telehealth consent only when the client has / chose telehealth;
 *   - PRP sections only for PRP;
 *   - the SUD / Part 2 consent for SUD services;
 *   - the minor consent when the client is under 18;
 *   - the primary care consent for primary care (Family Practice at Silver Spring / Bowie);
 *   - the Carelon non-overlap attestation for Maryland Medicaid (built separately, flagged here).
 * Only the Active version of a template is used, and only when it can be sent (canSendTemplate).
 */
import type { ConsentTemplateVersion, ServiceFlag } from './types';
import { latestTitle } from './catalog';

export const SERVICE_FLAGS: readonly ServiceFlag[] = ['omhc', 'prp', 'sud', 'primary_care', 'telehealth', 'medication', 'group'];

export const SERVICE_LABEL: Record<ServiceFlag, string> = {
  omhc: 'Outpatient mental health (therapy / evaluation)',
  prp: 'Psychiatric Rehabilitation Program (PRP)',
  sud: 'Substance use disorder (SUD / IOP)',
  primary_care: 'Primary care',
  telehealth: 'Telehealth',
  medication: 'Medication management',
  group: 'Group therapy',
};

/** The packet's "What service are you interested in?" answers (source form page 6-7). */
export const SERVICES_INTERESTED = [
  { value: 'diagnostic_evaluation', label: 'Comprehensive Diagnostic Evaluation', flags: ['omhc'] },
  { value: 'therapy', label: 'Therapy (Individual, Group, Family)', flags: ['omhc', 'group'] },
  { value: 'prp', label: 'Psychiatric Rehabilitation Program (PRP)', flags: ['prp'] },
  { value: 'medication_management', label: 'Medication Management', flags: ['medication'] },
  { value: 'sud', label: 'Substance Use Disorder (SUD)', flags: ['sud'] },
  { value: 'primary_care', label: 'Primary Care', flags: ['primary_care'] },
  { value: 'other', label: 'Other', flags: [] },
] as const satisfies readonly { value: string; label: string; flags: readonly ServiceFlag[] }[];

export type ServiceInterest = (typeof SERVICES_INTERESTED)[number]['value'];

export function flagsFromInterests(values: readonly string[] | null | undefined): ServiceFlag[] {
  const out = new Set<ServiceFlag>();
  for (const v of values ?? []) {
    const s = SERVICES_INTERESTED.find((x) => x.value === v);
    s?.flags.forEach((f) => out.add(f));
  }
  return [...out];
}

export type PacketClientContext = {
  /** Age in whole years on the signing date; null when the date of birth is unknown */
  ageYears: number | null;
  services: ServiceFlag[];
  medicaid: boolean;
  emergencyContact: { name: string; relationship: string | null; phone: string | null } | null;
  /** Facts beyond the services that make a consent required (requirements.ts); absent = unknown / no */
  signals?: { aot?: boolean; autopay?: boolean; smsConsent?: boolean; aiScribe?: boolean };
};

export type PacketItem = {
  key: string;
  version: number;
  title: string;
  signing: 'packet' | 'standalone';
  /** Standalone authorizations are voluntary: the client may decline them without blocking care */
  optional: boolean;
  /** Why this item is in the packet (shown to staff) */
  reason: string;
  /** Prefilled field values (e.g. the emergency-contact ROI) */
  prefill?: Record<string, string | string[]>;
  /** Marks the emergency-contact ROI (status tracking) */
  purposeTag?: 'emergency_contact' | 'tpo';
  /** Required by a rule (requirements.ts) and satisfied by ANY valid row of the template (per-medication / per-card forms) */
  anyRow?: boolean;
};

export type ComposeResult = {
  items: PacketItem[];
  skipped: { key: string; title: string; reason: string }[];
  /** Maryland Medicaid: the Carelon non-overlap attestation is also required (its own workflow) */
  carelonAttestation: boolean;
  minor: MinorRule | null;
  /** Required by a rule (requirements.ts) but the practice has no Active, sendable version */
  requiredUnavailable?: { key: string; title: string; reason: string }[];
};

export function ageOn(dob: Date | string | null | undefined, on: Date): number | null {
  if (!dob) return null;
  const s = typeof dob === 'string' ? dob.slice(0, 10) : dob.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ty = on.getUTCFullYear();
  const tm = on.getUTCMonth() + 1;
  const td = on.getUTCDate();
  let age = ty - y;
  if (tm < mo || (tm === mo && td < d)) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

// ─── Minor rules (Maryland) ──────────────────────────────────────────────────

export type MinorRule = {
  minor: boolean;
  /** The minor may sign for themselves (Maryland Health-General §20-104 / §20-102(c)) */
  mayConsentAlone: boolean;
  /** Part 2: only the minor can consent to disclosures of their SUD records (42 CFR §2.14) */
  minorControlsPart2: boolean;
  explanation: string;
};

const BEHAVIORAL: readonly ServiceFlag[] = ['omhc', 'prp', 'sud', 'medication', 'group', 'telehealth'];

/**
 * Who may sign for a client under 18:
 *  - SUD treatment: a minor of any age has the same capacity as an adult (Health-General §20-102(c));
 *  - mental health treatment: a minor 16 or older (Health-General §20-104);
 *  - primary care or anything else: a parent / legal representative (outside specific statutory
 *    exceptions that staff handle case by case).
 */
export function minorRule(ageYears: number | null, services: readonly ServiceFlag[]): MinorRule | null {
  if (ageYears === null || ageYears >= 18) return null;
  const sud = services.includes('sud');
  const onlyBehavioral = services.length > 0 && services.every((s) => BEHAVIORAL.includes(s));
  const sudOnly = services.length > 0 && services.every((s) => s === 'sud' || s === 'telehealth');
  const mayConsentAlone = sudOnly || (ageYears >= 16 && onlyBehavioral);
  const explanation = mayConsentAlone
    ? sudOnly
      ? 'Under Maryland Health-General §20-102(c) a minor may consent to substance use treatment; the minor may sign. A parent or guardian may also sign the treatment consent.'
      : 'Under Maryland Health-General §20-104 a minor 16 or older may consent to mental health treatment; the minor may sign. A parent or guardian may also sign.'
    : services.includes('primary_care')
      ? 'Primary care for a minor needs a parent or legal representative to sign (outside specific statutory exceptions).'
      : 'A parent or legal representative must sign for a client under 16 (mental health) or for services a minor cannot consent to alone.';
  return { minor: true, mayConsentAlone, minorControlsPart2: sud, explanation };
}

// ─── Composer ────────────────────────────────────────────────────────────────

function applies(t: ConsentTemplateVersion, ctx: PacketClientContext): { ok: boolean; reason: string } {
  const r = t.appliesTo;
  switch (r.kind) {
    case 'all':
      return { ok: true, reason: 'All new clients' };
    case 'service': {
      const hit = r.services.filter((s) => ctx.services.includes(s));
      return hit.length
        ? { ok: true, reason: `Client receives ${hit.map((s) => SERVICE_LABEL[s]).join(', ')}` }
        : { ok: false, reason: `Only for ${r.services.map((s) => SERVICE_LABEL[s]).join(' / ')}` };
    }
    case 'minor':
      if (ctx.ageYears === null) return { ok: false, reason: 'Date of birth unknown (add it to check whether the client is a minor)' };
      return ctx.ageYears < 18 ? { ok: true, reason: `Client is under 18 (age ${ctx.ageYears})` } : { ok: false, reason: 'Only for clients under 18' };
    case 'medicaid':
      return ctx.medicaid ? { ok: true, reason: 'Maryland Medicaid' } : { ok: false, reason: 'Only for Maryland Medicaid clients' };
    case 'manual':
      return { ok: false, reason: 'Added per client from the chart' };
  }
}

export function composePacket(input: {
  /** Practice packet selection, in order */
  selection: readonly string[];
  /** Active + sendable version for a key, or a reason it cannot be used */
  resolve: (key: string) => { template: ConsentTemplateVersion } | { reason: string };
  ctx: PacketClientContext;
  /** Signing date (for the default ROI expiration) */
  today: string;
}): ComposeResult {
  const items: PacketItem[] = [];
  const skipped: ComposeResult['skipped'] = [];
  for (const key of input.selection) {
    const res = input.resolve(key);
    if (!('template' in res)) {
      skipped.push({ key, title: latestTitle(key), reason: res.reason });
      continue;
    }
    const t = res.template;
    const base = { key, version: t.version, title: t.title, signing: t.signing };

    // The emergency-contact ROI the practice's Release of Information section requires
    if (key === 'roi-authorization') {
      if (!input.ctx.emergencyContact) {
        skipped.push({ key, title: t.title, reason: 'No emergency contact on file for the emergency-contact release' });
        continue;
      }
      const ec = input.ctx.emergencyContact;
      items.push({
        ...base,
        title: `${t.title}: emergency contact (${ec.name})`,
        optional: true,
        reason: "Emergency-contact release required by the practice's Release of Information section",
        purposeTag: 'emergency_contact',
        prefill: {
          direction: 'release',
          recipientName: ec.name,
          recipientRelationship: ec.relationship ?? '',
          recipientContact: ec.phone ?? '',
          information: ['emergency'],
          purpose: 'To inform my emergency contact in an emergency',
          expirationDate: addYears(input.today, 1),
        },
      });
      continue;
    }

    const a = applies(t, input.ctx);
    if (!a.ok) {
      skipped.push({ key, title: t.title, reason: a.reason });
      continue;
    }
    if (key === 'part2-consent') {
      items.push({
        ...base,
        optional: true,
        reason: `${a.reason}; single consent for treatment, payment and health care operations (voluntary)`,
        purposeTag: 'tpo',
        prefill: { recipientType: 'tpo', purpose: 'Treatment, payment, and health care operations', expirationEvent: 'End of my treatment' },
      });
      continue;
    }
    items.push({ ...base, optional: t.signing === 'standalone', reason: a.reason });
  }
  return { items, skipped, carelonAttestation: input.ctx.medicaid, minor: minorRule(input.ctx.ageYears, input.ctx.services) };
}

export function addYears(ymd: string, years: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y + years, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) dt.setUTCDate(0); // Feb 29 → Feb 28
  return dt.toISOString().slice(0, 10);
}
