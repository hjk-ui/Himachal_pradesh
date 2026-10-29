/**
 * Valant client re-import, "contact & demographics only" mode: fills address, phone, email,
 * standard demographics, emergency contact, guardian, guarantor, Medicaid ID, legal middle name and
 * suffix on clients ALREADY in Altrixs (matched by Valant patient id). Pure: no prisma.
 *
 * Rules:
 * - Only an empty field is filled. A non-empty field is never overwritten with a different value;
 *   the difference is reported as a conflict (field + client id / MRN, never the values).
 * - Exception: a state / ZIP / phone that is the SAME value in a non-standard form is rewritten to
 *   the standard form ("maryland" -> "MD", "212011234" -> "21201-1234", "410.555.1234 cell" ->
 *   "(410) 555-1234").
 * - A value that fails validation is never written (reported as invalid, per field).
 * - A blank cell never clears anything. Legal first / last name and DOB are never written in this
 *   mode; a mismatch is reported as a conflict.
 * - Idempotent: a second run over the same file finds every field filled and writes nothing.
 * - A source id matching several clients is skipped (ambiguous); unknown ids are listed, never created.
 */
import type { CanonicalClientField } from './fieldMaps';
import { normalizeDate } from './normalize';
import {
  ethnicityFromText,
  genderIdentityFromText,
  isValidMedicaidId,
  languageFromText,
  maritalStatusFromText,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
  pronounsFromText,
  raceCodesFromText,
  relationshipFromText,
  sexAtBirthFromText,
  sexCodeFromText,
  sexualOrientationFromText,
  yesNoFromText,
  type CodeFromText,
} from '@/lib/clients/demographics';

/** Client columns this mode may write (and nothing else) */
export const CONTACT_FIELDS = [
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'county',
  'phone', 'phoneType', 'phoneSecondary', 'phoneSecondaryType', 'email',
  'administrativeSex', 'sexAtBirth', 'genderIdentity', 'sexualOrientation', 'pronouns',
  'race', 'ethnicity', 'preferredLanguage', 'interpreterNeeded', 'maritalStatus',
  'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship',
  'guardianName', 'guardianRelationship', 'guardianPhone',
  'guarantorFirstName', 'guarantorLastName', 'guarantorRelationship', 'guarantorDateOfBirth',
  'guarantorPhone', 'guarantorAddressLine1', 'guarantorAddressLine2', 'guarantorCity',
  'guarantorState', 'guarantorPostalCode',
  'medicaidId', 'legalMiddleName', 'nameSuffix',
] as const;
export type ContactField = (typeof CONTACT_FIELDS)[number];

/** Compared (never written) in this mode */
export const IDENTITY_FIELDS = ['legalFirstName', 'legalLastName', 'dateOfBirth'] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

export type ContactRow = { row: number; fields: Partial<Record<CanonicalClientField, string>> };

export type ExistingContactClient = {
  id: string;
  mrn: string | null;
  sourceId: string | null;
  legalFirstName: string | null;
  legalLastName: string | null;
  dateOfBirth: Date | null;
} & { [K in ContactField]?: unknown };

export type ContactUpdate = {
  clientId: string;
  mrn: string | null;
  /** Prisma data: only the fields this plan writes */
  data: Partial<Record<ContactField, unknown>>;
  /** Values read from the database for those fields: the write is guarded on them (optimistic) */
  expected: Partial<Record<ContactField, unknown>>;
  fields: ContactField[];
};

export type ContactConflict = { row: number; clientId: string; mrn: string | null; field: ContactField | IdentityField };
export type ContactWarning = { row: number; field: string; reason: string };

export type ClientContactPlan = {
  /** Distinct clients matched by Valant patient id */
  matched: number;
  updates: ContactUpdate[];
  /** Matched rows with nothing to write */
  unchanged: number;
  /** Empty fields that get a value, per field */
  filled: Partial<Record<ContactField, number>>;
  /** Same value rewritten to the standard form (state / ZIP / phone), per field */
  formatFixed: Partial<Record<ContactField, number>>;
  conflicts: ContactConflict[];
  conflictsByField: Partial<Record<ContactField | IdentityField, number>>;
  /** Values that failed validation (not written), per source field */
  invalid: Record<string, number>;
  warnings: ContactWarning[];
  /** Email is already on another client (Client.email is unique) */
  emailInUse: number;
  notFound: { row: number; sourceId: string }[];
  ambiguous: { row: number; sourceId: string; clients: number }[];
  noSourceId: number;
};

type Kind = 'text' | 'state' | 'zip' | 'phone' | 'code' | 'race' | 'bool' | 'date' | 'email';
type Candidate = { kind: Kind; value: unknown };

function clean(v: string | null | undefined, max = 200): string | null {
  const t = (v ?? '').trim().replace(/\s+/g, ' ');
  if (!t || /^none$/i.test(t)) return null;
  return t.slice(0, max);
}

export function isEmptyValue(v: unknown): boolean {
  if (v == null) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Digits of a stored phone, without a leading US 1 (works on malformed values too) */
function looseDigits(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

const textKey = (v: unknown) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
const isoDay = (v: unknown) => {
  const d = v instanceof Date ? v : v ? new Date(String(v)) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null;
};

/** Stored value and the candidate mean the same thing */
function sameValue(kind: Kind, stored: unknown, value: unknown): boolean {
  switch (kind) {
    case 'state':
      return normalizeStateCode(String(stored)) === value;
    case 'zip': {
      // A stored 5-digit ZIP and the same ZIP+4 are the same address: the +4 is filled in (format fix)
      const s = normalizeUsZip(String(stored));
      return s === value || (s !== null && s.length === 5 && String(value).startsWith(`${s}-`));
    }
    case 'phone':
      return looseDigits(stored) === normalizeUsPhone(String(value))?.digits;
    case 'race': {
      const a = new Set((stored as string[]) ?? []);
      const b = new Set((value as string[]) ?? []);
      return a.size === b.size && [...a].every((x) => b.has(x));
    }
    case 'bool':
      return stored === value;
    case 'date':
      return isoDay(stored) === isoDay(value);
    case 'code':
      return String(stored).trim().toUpperCase() === String(value).trim().toUpperCase();
    default:
      return textKey(stored) === textKey(value);
  }
}

/** Same value but not in the standard form: allowed to be rewritten (state / ZIP / phone only) */
function needsFormatFix(kind: Kind, stored: unknown, value: unknown): boolean {
  if (kind === 'state' || kind === 'zip') return String(stored).trim() !== value;
  if (kind === 'phone') return normalizeUsPhone(String(stored)) === null;
  return false;
}

type PhoneSource = { digits: string; display: string; type: 'mobile' | 'home' | 'work' | null; from: 'phone' | 'phoneSecondary' };

type RowCandidates = {
  values: Partial<Record<ContactField, Candidate>>;
  phones: PhoneSource[];
  invalid: { field: string; reason: string }[];
  identity: { legalFirstName: string | null; legalLastName: string | null; dateOfBirth: Date | null };
};

/** Validated / normalized values for this mode from one resolved row (invalid ones reported, not returned) */
export function contactCandidates(f: Partial<Record<CanonicalClientField, string>>): RowCandidates {
  const values: Partial<Record<ContactField, Candidate>> = {};
  const invalid: { field: string; reason: string }[] = [];
  const text = (field: ContactField, raw: string | undefined, max = 200) => {
    const v = clean(raw, max);
    if (v) values[field] = { kind: 'text', value: v };
  };
  const code = (field: ContactField, raw: string | undefined, r: CodeFromText) => {
    if (r.code) values[field] = { kind: 'code', value: r.code };
    else if (r.unmapped) invalid.push({ field, reason: `"${r.unmapped.slice(0, 40)}" is not a standard code` });
    else if (clean(raw)) invalid.push({ field, reason: 'not a standard code' });
  };
  const state = (field: ContactField, raw: string | undefined) => {
    const v = clean(raw, 40);
    if (!v) return;
    const s = normalizeStateCode(v);
    if (s) values[field] = { kind: 'state', value: s };
    else invalid.push({ field, reason: 'not a US state / territory' });
  };
  const zip = (field: ContactField, raw: string | undefined) => {
    const v = clean(raw, 20);
    if (!v) return;
    const z = normalizeUsZip(v);
    if (z) values[field] = { kind: 'zip', value: z };
    else invalid.push({ field, reason: 'not a 5-digit ZIP or ZIP+4' });
  };
  const phone = (field: ContactField, raw: string | undefined) => {
    const v = clean(raw, 40);
    if (!v || !/[1-9]/.test(v)) return; // (000) 000-0000 placeholders mean "no phone"
    const p = normalizeUsPhone(v);
    if (p) values[field] = { kind: 'phone', value: p.display };
    else invalid.push({ field, reason: 'not a valid 10-digit US phone number' });
  };

  text('addressLine1', f.addressLine1);
  text('addressLine2', f.addressLine2);
  text('city', f.city, 100);
  state('state', f.state);
  zip('postalCode', f.postalCode);
  text('county', f.county, 80);

  const email = clean(f.email, 254)?.toLowerCase();
  if (email) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) values.email = { kind: 'email', value: email };
    else invalid.push({ field: 'email', reason: 'not a valid email address' });
  }

  // Sex: the sex column; a legacy gender column only when it literally says male / female
  const sex = sexCodeFromText(f.administrativeSex);
  const legacy = sexCodeFromText(f.gender).code;
  if (sex.code) values.administrativeSex = { kind: 'code', value: sex.code };
  else if (legacy === 'M' || legacy === 'F') values.administrativeSex = { kind: 'code', value: legacy };
  else if (sex.unmapped) invalid.push({ field: 'administrativeSex', reason: `"${sex.unmapped.slice(0, 40)}" is not a standard code` });
  code('sexAtBirth', f.sexAtBirth, sexAtBirthFromText(f.sexAtBirth));
  code('genderIdentity', f.genderIdentity, genderIdentityFromText(f.genderIdentity));
  code('sexualOrientation', f.sexualOrientation, sexualOrientationFromText(f.sexualOrientation));
  code('pronouns', f.pronouns, pronounsFromText(f.pronouns));
  const race = raceCodesFromText(f.race);
  if (race.unmapped.length) invalid.push({ field: 'race', reason: `"${race.unmapped.join('; ').slice(0, 40)}" is not a standard code` });
  // A partly mappable race cell is not written: storing only some of the races would misstate it
  else if (race.codes.length) values.race = { kind: 'race', value: race.codes };
  code('ethnicity', f.ethnicity, ethnicityFromText(f.ethnicity));
  code('preferredLanguage', f.preferredLanguage, languageFromText(f.preferredLanguage));
  if (clean(f.interpreterNeeded)) {
    const yn = yesNoFromText(f.interpreterNeeded);
    if (yn === null) invalid.push({ field: 'interpreterNeeded', reason: 'not yes / no' });
    else values.interpreterNeeded = { kind: 'bool', value: yn };
  }
  code('maritalStatus', f.maritalStatus, maritalStatusFromText(f.maritalStatus));

  text('emergencyContactName', f.emergencyContactName, 160);
  phone('emergencyContactPhone', f.emergencyContactPhone);
  code('emergencyContactRelationship', f.emergencyContactRelationship, relationshipFromText(f.emergencyContactRelationship));

  text('guardianName', f.guardianName, 160);
  code('guardianRelationship', f.guardianRelationship, relationshipFromText(f.guardianRelationship));
  phone('guardianPhone', f.guardianPhone);

  text('guarantorFirstName', f.guarantorFirstName, 80);
  text('guarantorLastName', f.guarantorLastName, 80);
  code('guarantorRelationship', f.guarantorRelationship, relationshipFromText(f.guarantorRelationship));
  if (clean(f.guarantorDateOfBirth)) {
    const d = normalizeDate(f.guarantorDateOfBirth);
    if (d) values.guarantorDateOfBirth = { kind: 'date', value: new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`) };
    else invalid.push({ field: 'guarantorDateOfBirth', reason: 'not a date' });
  }
  phone('guarantorPhone', f.guarantorPhone);
  text('guarantorAddressLine1', f.guarantorAddressLine1);
  text('guarantorAddressLine2', f.guarantorAddressLine2);
  text('guarantorCity', f.guarantorCity, 100);
  state('guarantorState', f.guarantorState);
  zip('guarantorPostalCode', f.guarantorPostalCode);

  const medicaid = clean(f.medicaidId, 40)?.replace(/\s/g, '');
  if (medicaid) {
    if (isValidMedicaidId(medicaid)) values.medicaidId = { kind: 'text', value: medicaid };
    else invalid.push({ field: 'medicaidId', reason: 'not 11 digits' });
  }
  text('legalMiddleName', f.legalMiddleName, 80);
  text('nameSuffix', f.nameSuffix, 20);

  // Phones: the main + secondary columns, then the typed (mobile / home / work) columns.
  // Each must be a valid US number; at most two distinct numbers (Client.phone / phoneSecondary).
  const typed: { type: 'mobile' | 'home' | 'work'; field: CanonicalClientField; raw: string | undefined }[] = [
    { type: 'mobile', field: 'phoneMobile', raw: f.phoneMobile },
    { type: 'home', field: 'phoneHome', raw: f.phoneHome },
    { type: 'work', field: 'phoneWork', raw: f.phoneWork },
  ];
  const parse = (field: string, raw: string | undefined) => {
    const v = clean(raw, 40);
    if (!v || !/[1-9]/.test(v)) return null;
    const p = normalizeUsPhone(v);
    if (!p) invalid.push({ field, reason: 'not a valid 10-digit US phone number' });
    return p;
  };
  const typedParsed = typed.map((t) => ({ ...t, p: parse(t.field, t.raw) })).filter((t) => t.p);
  const typeOf = (digits: string) => typedParsed.find((t) => t.p!.digits === digits)?.type ?? null;
  const ordered: { p: NonNullable<ReturnType<typeof normalizeUsPhone>>; type: PhoneSource['type'] }[] = [];
  const main = parse('phone', f.phone);
  const second = parse('phoneSecondary', f.phoneSecondary);
  if (main) ordered.push({ p: main, type: typeOf(main.digits) });
  if (second) ordered.push({ p: second, type: typeOf(second.digits) });
  for (const t of typedParsed) ordered.push({ p: t.p!, type: t.type });
  const phones: PhoneSource[] = [];
  for (const o of ordered) {
    if (phones.length >= 2) break;
    if (phones.some((x) => x.digits === o.p.digits)) continue;
    phones.push({ digits: o.p.digits, display: o.p.display, type: o.type, from: phones.length === 0 ? 'phone' : 'phoneSecondary' });
  }

  const first = clean(f.firstName, 80);
  const last = clean(f.lastName, 80);
  const dobRaw = clean(f.dateOfBirth, 40);
  return {
    values,
    phones,
    invalid,
    identity: {
      legalFirstName: first && last ? first : null,
      legalLastName: first && last ? last : null,
      dateOfBirth: dobRaw ? normalizeDate(dobRaw) : null,
    },
  };
}

export function planClientContactUpdates(
  rows: readonly ContactRow[],
  existing: readonly ExistingContactClient[],
  /** Lower-cased email -> client id that holds it (any organization: Client.email is unique) */
  emailOwners: ReadonlyMap<string, string> = new Map()
): ClientContactPlan {
  const bySource = new Map<string, ExistingContactClient[]>();
  for (const c of existing) {
    const k = c.sourceId?.trim();
    if (!k) continue;
    bySource.set(k, [...(bySource.get(k) ?? []), c]);
  }
  const plan: ClientContactPlan = {
    matched: 0, updates: [], unchanged: 0, filled: {}, formatFixed: {}, conflicts: [], conflictsByField: {},
    invalid: {}, warnings: [], emailInUse: 0, notFound: [], ambiguous: [], noSourceId: 0,
  };
  const working = new Map<string, Record<string, unknown>>();
  const updates = new Map<string, ContactUpdate>();
  const conflictKeys = new Set<string>();
  const emails = new Map(emailOwners);
  const matched = new Set<string>();

  for (const r of rows) {
    const sid = r.fields.sourceId?.trim();
    if (!sid) {
      plan.noSourceId += 1;
      continue;
    }
    const hits = bySource.get(sid) ?? [];
    if (hits.length === 0) {
      plan.notFound.push({ row: r.row, sourceId: sid });
      continue;
    }
    if (hits.length > 1) {
      plan.ambiguous.push({ row: r.row, sourceId: sid, clients: hits.length });
      continue;
    }
    const c = hits[0];
    matched.add(c.id);
    const cur = working.get(c.id) ?? { ...c };
    working.set(c.id, cur);
    const cand = contactCandidates(r.fields);
    for (const w of cand.invalid) {
      plan.invalid[w.field] = (plan.invalid[w.field] ?? 0) + 1;
      plan.warnings.push({ row: r.row, field: w.field, reason: w.reason });
    }

    const conflict = (field: ContactField | IdentityField) => {
      const key = `${c.id}|${field}`;
      if (conflictKeys.has(key)) return;
      conflictKeys.add(key);
      plan.conflicts.push({ row: r.row, clientId: c.id, mrn: c.mrn, field });
      plan.conflictsByField[field] = (plan.conflictsByField[field] ?? 0) + 1;
    };
    const writes: Partial<Record<ContactField, unknown>> = {};
    const set = (field: ContactField, value: unknown, how: 'filled' | 'formatFixed') => {
      writes[field] = value;
      plan[how][field] = (plan[how][field] ?? 0) + 1;
    };

    // Identity: compared only, never written
    const id = cand.identity;
    if (id.legalFirstName && !isEmptyValue(c.legalFirstName) && textKey(c.legalFirstName) !== textKey(id.legalFirstName)) conflict('legalFirstName');
    if (id.legalLastName && !isEmptyValue(c.legalLastName) && textKey(c.legalLastName) !== textKey(id.legalLastName)) conflict('legalLastName');
    if (id.dateOfBirth && c.dateOfBirth && isoDay(c.dateOfBirth) !== isoDay(id.dateOfBirth)) conflict('dateOfBirth');

    for (const [field, cv] of Object.entries(cand.values) as [ContactField, Candidate][]) {
      const stored = cur[field];
      if (isEmptyValue(stored)) {
        if (field === 'email') {
          const owner = emails.get(String(cv.value));
          if (owner && owner !== c.id) {
            plan.emailInUse += 1;
            plan.warnings.push({ row: r.row, field: 'email', reason: 'already on another patient; not filled' });
            continue;
          }
          emails.set(String(cv.value), c.id);
        }
        set(field, cv.value, 'filled');
      } else if (sameValue(cv.kind, stored, cv.value)) {
        if (needsFormatFix(cv.kind, stored, cv.value)) set(field, cv.value, 'formatFixed');
      } else {
        conflict(field);
      }
    }

    // Main / secondary phone: a number already on the chart (either slot) is kept where it is;
    // a new number fills an empty slot; with no empty slot it is a conflict.
    const slots = [
      { field: 'phone' as const, typeField: 'phoneType' as const },
      { field: 'phoneSecondary' as const, typeField: 'phoneSecondaryType' as const },
    ];
    const used = new Set<number>();
    const pending: PhoneSource[] = [];
    const applyType = (slot: (typeof slots)[number], src: PhoneSource) => {
      if (!src.type) return;
      const storedType = cur[slot.typeField];
      if (isEmptyValue(storedType)) set(slot.typeField, src.type, 'filled');
      else if (String(storedType).toLowerCase() !== src.type) conflict(slot.typeField);
    };
    for (const src of cand.phones) {
      const i = slots.findIndex((s, idx) => !used.has(idx) && !isEmptyValue(cur[s.field]) && looseDigits(cur[s.field]) === src.digits);
      if (i < 0) {
        pending.push(src);
        continue;
      }
      used.add(i);
      if (needsFormatFix('phone', cur[slots[i].field], src.display)) set(slots[i].field, src.display, 'formatFixed');
      applyType(slots[i], src);
    }
    for (const src of pending) {
      const i = slots.findIndex((s, idx) => !used.has(idx) && isEmptyValue(cur[s.field]));
      if (i < 0) {
        conflict(src.from);
        continue;
      }
      used.add(i);
      set(slots[i].field, src.display, 'filled');
      applyType(slots[i], src);
    }

    const fields = Object.keys(writes) as ContactField[];
    if (!fields.length) {
      plan.unchanged += 1;
      continue;
    }
    const u = updates.get(c.id) ?? { clientId: c.id, mrn: c.mrn, data: {}, expected: {}, fields: [] };
    for (const f of fields) {
      if (!(f in u.expected)) u.expected[f] = c[f] ?? null;
      u.data[f] = writes[f];
      if (!u.fields.includes(f)) u.fields.push(f);
      cur[f] = writes[f];
    }
    updates.set(c.id, u);
  }
  plan.matched = matched.size;
  plan.updates = [...updates.values()];
  return plan;
}
