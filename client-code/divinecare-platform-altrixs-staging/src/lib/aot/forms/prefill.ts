/**
 * Prefill for the MDH AOT forms (pure). Only values that exist in the participant record, the linked
 * chart, the outreach log, SDOH screenings / referrals or earlier signed forms are used; anything else
 * stays blank. Statutory attestations (criteria checkboxes, "provider agreed", Y/N determinations) are
 * never pre-checked. Every filled key is returned in `sources` so the editor can show where it came from.
 */
import type { FormData, FormType } from './engine';
import { OUTREACH_METHODS, OUTREACH_STAFF_ROLES } from './deadlines';
import { CCT_REGION_LABEL, countyToCctRegion } from '../mdh';

export type PrefillClient = {
  name?: string | null;
  dateOfBirth?: Date | string | null;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  insuranceType?: string | null;
  insurancePayer?: string | null;
};

export type PrefillSources = {
  participant: {
    name: string;
    county?: string | null;
    status?: string | null;
    createdAt?: Date | string | null;
    eligibilityData?: unknown;
    psychiatristAffidavit?: unknown;
  };
  /** Null when there is no linked chart, or the signed-in user may not open it (caseload scope) */
  client?: PrefillClient | null;
  coverages?: { payerName?: string | null; claimFilingCode?: string | null; active?: boolean | null }[];
  diagnoses?: { code: string | null; label: string }[];
  outreach?: { attemptedAt: Date | string; method: string; staffRole: string; result: string }[];
  sdoh?: {
    latest?: { completedAt: Date | string; positiveDomains: string[] } | null;
    referrals?: { domain: string; status: string; referralType?: string | null; resourceName?: string | null; createdAt: Date | string }[];
  } | null;
  actor: { name: string | null; role: string };
  /** Latest signed data of other AOT forms for this participant (carry over program / CCT contact info) */
  previous?: Partial<Record<FormType, FormData>>;
  now?: Date;
};

export type PrefillResult = { data: FormData; sources: Record<string, string> };

const ymd = (v: Date | string | null | undefined): string => {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
};

export function splitName(full: string): { first: string; last: string } {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { first: parts[0] ?? '', last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

/** Insurance checkboxes (treatment plan item 15) from the chart's payer data; nothing when unclear. */
export function insuranceCategories(client: PrefillClient | null | undefined, coverages: PrefillSources['coverages'] = []): string[] {
  const out = new Set<string>();
  const add = (text: string | null | undefined, code?: string | null) => {
    const t = String(text ?? '').toLowerCase();
    const c = String(code ?? '').toUpperCase();
    if (c === 'MC' || /medicaid|medical assistance|healthchoice|priority partners|amerigroup|wellpoint|maryland physicians care|carefirst community/.test(t)) out.add('medicaid');
    else if (c === 'MA' || c === 'MB' || /medicare/.test(t)) out.add('medicare');
    else if (c === 'CH' || /tricare|champus|military/.test(t)) out.add('tricare');
    else if (['CI', 'BL', 'HM', '12', '13', '14', '15', '16'].includes(c) || /commercial|private|employer|blue cross|bcbs|aetna|cigna|united|carefirst/.test(t)) out.add('private');
  };
  for (const cv of coverages ?? []) if (cv.active !== false) add(cv.payerName, cv.claimFilingCode);
  if (client) {
    add(client.insuranceType);
    add(client.insurancePayer);
  }
  return [...out];
}

const methodLabel = (m: string) => OUTREACH_METHODS.find((x) => x.value === m)?.label ?? m;
const staffLabel = (r: string) => OUTREACH_STAFF_ROLES.find((x) => x.value === r)?.label ?? r;

function outreachSummary(list: PrefillSources['outreach']): string {
  if (!list?.length) return '';
  return [...list]
    .sort((a, b) => new Date(a.attemptedAt).getTime() - new Date(b.attemptedAt).getTime())
    .map((a) => `${ymd(a.attemptedAt)} — ${methodLabel(a.method)} (${staffLabel(a.staffRole)}): ${a.result}`)
    .join('\n');
}

const DOMAIN_LABEL: Record<string, string> = {
  housing_instability: 'Housing instability',
  housing_quality: 'Housing quality',
  food: 'Food',
  transportation: 'Transportation',
  utilities: 'Utilities',
  safety: 'Interpersonal safety',
  financial_strain: 'Financial strain',
  employment: 'Employment',
  family_support: 'Family and community support',
  education: 'Education',
};
const dl = (d: string) => DOMAIN_LABEL[d] ?? d;

function sdohSummary(s: PrefillSources['sdoh']): string {
  if (!s) return '';
  const lines: string[] = [];
  if (s.latest) {
    lines.push(
      `AHC HRSN screening ${ymd(s.latest.completedAt)}: ${s.latest.positiveDomains.length ? `positive for ${s.latest.positiveDomains.map(dl).join(', ')}` : 'no positive domains'}.`,
    );
  }
  for (const r of s.referrals ?? []) {
    const kind = r.referralType === 'resource_given' ? 'resource given' : 'referral made';
    lines.push(`${dl(r.domain)}: ${kind}${r.resourceName ? ` (${r.resourceName})` : ''} on ${ymd(r.createdAt)}; status ${r.status}.`);
  }
  return lines.join('\n');
}

function respondentFromClient(c: PrefillClient | null | undefined, participantName: string, out: PrefillResult, keys: {
  first: string; last: string; dob?: string; phone?: string; email?: string; street?: string; unit?: string; city?: string; state?: string; zip?: string;
}) {
  const set = (k: string | undefined, v: string, src: string) => {
    if (!k || !v) return;
    out.data[k] = v;
    out.sources[k] = src;
  };
  const nm = splitName(c?.name || participantName);
  const nameSrc = c?.name ? 'Chart name (split into first / last — verify)' : 'AOT participant name (split into first / last — verify)';
  set(keys.first, nm.first, nameSrc);
  set(keys.last, nm.last, nameSrc);
  if (!c) return;
  set(keys.dob, ymd(c.dateOfBirth), 'Chart: date of birth');
  set(keys.phone, c.phone ?? '', 'Chart: phone');
  set(keys.email, c.email ?? '', 'Chart: email');
  set(keys.street, c.addressLine1 ?? '', 'Chart: address');
  set(keys.unit, c.addressLine2 ?? '', 'Chart: address line 2');
  set(keys.city, c.city ?? '', 'Chart: city');
  set(keys.state, c.state ?? '', 'Chart: state');
  set(keys.zip, c.postalCode ?? '', 'Chart: ZIP');
}

function carry(out: PrefillResult, prev: FormData | undefined, keys: string[], label: string) {
  if (!prev) return;
  for (const k of keys) {
    const v = prev[k];
    if (typeof v === 'string' && v.trim() && !out.data[k]) {
      out.data[k] = v;
      out.sources[k] = `From the last signed ${label}`;
    }
  }
}

function legacyEval(p: PrefillSources['participant']): Record<string, unknown> {
  const a = p.psychiatristAffidavit;
  return a && typeof a === 'object' ? (a as Record<string, unknown>) : {};
}

export function buildPrefill(type: FormType, s: PrefillSources): PrefillResult {
  const out: PrefillResult = { data: {}, sources: {} };
  const set = (k: string, v: unknown, src: string) => {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) return;
    out.data[k] = v;
    out.sources[k] = src;
  };
  const p = s.participant;
  const c = s.client ?? null;
  const today = ymd(s.now ?? new Date());
  const isPsychiatrist = String(s.actor.role).toUpperCase() === 'PSYCHIATRIST';
  const ev = legacyEval(p);
  const basis = (ev.basis && typeof ev.basis === 'object' ? ev.basis : {}) as Record<string, string>;
  const elig = (p.eligibilityData && typeof p.eligibilityData === 'object' ? p.eligibilityData : {}) as Record<string, unknown>;
  const petitioner = (elig.petitioner && typeof elig.petitioner === 'object' ? elig.petitioner : {}) as Record<string, string>;
  const screen = (elig.screenAnswers && typeof elig.screenAnswers === 'object' ? elig.screenAnswers : {}) as Record<string, unknown>;

  switch (type) {
    case 'treatment_plan': {
      if (isPsychiatrist) set('psychiatristName', s.actor.name, 'Signed-in psychiatrist');
      respondentFromClient(c, p.name, out, {
        first: 'firstName', last: 'lastName', dob: 'dob', phone: 'phone', email: 'email', street: 'street', unit: 'unit', city: 'city', state: 'state', zip: 'zip',
      });
      if (s.diagnoses?.length) {
        set(
          'diagnoses',
          s.diagnoses.map((d) => ({ diagnosis: d.label, code: d.code ?? '', determinedBy: '' })),
          'Chart diagnoses (choose how each was determined)',
        );
      }
      set('engagementEfforts', outreachSummary(s.outreach), 'AOT outreach log');
      set('insurance', insuranceCategories(c, s.coverages), 'Chart insurance / coverage records');
      set('hrsnPlan', sdohSummary(s.sdoh), 'SDOH screening and referrals (edit into the plan)');
      break;
    }
    case 'psychiatrist_affidavit': {
      if (isPsychiatrist) set('psychiatristName', s.actor.name, 'Signed-in psychiatrist');
      else if (typeof ev.signedByName === 'string') set('psychiatristName', ev.signedByName, 'Psychiatric Eval worksheet signer');
      set('respondentName', c?.name || p.name, c?.name ? 'Chart name' : 'AOT participant name');
      if (c) set('respondentDob', ymd(c.dateOfBirth), 'Chart: date of birth');
      if (typeof ev.examDate === 'string') set('examDate', ev.examDate, 'Psychiatric Eval worksheet: examination date');
      set('petitionerName', petitioner.name, 'Eligibility screen: petitioner');
      set('c_spmiFacts', basis.smi, 'Psychiatric Eval worksheet: serious mental illness');
      set('c_needsAotFacts', basis.safety, 'Psychiatric Eval worksheet: safety without supervision');
      set('c_unlikelyAdhereFacts', basis.voluntary, 'Psychiatric Eval worksheet: unlikely to adhere voluntarily');
      // The worksheet's single 3-year history paragraph goes to whichever prong the screen answered yes (box left unchecked).
      if (basis.history) {
        if (screen.priorHospitalizations === 'yes' || screen.violenceHistory !== 'yes')
          set('c_hospitalizationDetails', basis.history, 'Psychiatric Eval worksheet: 3-year history (check 2c(i) if it applies)');
        if (screen.violenceHistory === 'yes')
          set('c_violenceDetails', basis.history, 'Psychiatric Eval worksheet: 3-year history (check 2c(ii) if it applies)');
      }
      break;
    }
    case 'ep_notification': {
      set('participantName', c?.name || p.name, c?.name ? 'Chart name' : 'AOT participant name');
      if (c) set('participantDob', ymd(c.dateOfBirth), 'Chart: date of birth');
      carry(out, s.previous?.ep_notification, ['regionalProgram', 'cctContact'], 'EP notification');
      carry(out, s.previous?.continued_treatment_plan, ['regionalProgram', 'cctContact'], 'Plan for Continued Treatment');
      break;
    }
    case 'continued_treatment_plan': {
      set('originalReferralDate', ymd(p.createdAt), 'Date the AOT referral was entered in Altrixs (verify against the original referral)');
      set('planCompletionDate', today, 'Today');
      respondentFromClient(c, p.name, out, {
        first: 'firstName', last: 'lastName', dob: 'dob', phone: 'phone', email: 'email', street: 'address', unit: 'apt', city: 'city', zip: 'zip',
      });
      carry(out, s.previous?.continued_treatment_plan, ['participantIdNumber', 'regionalProgram', 'cctContact', 'aka', 'bestContact'], 'Plan for Continued Treatment');
      carry(out, s.previous?.ep_notification, ['regionalProgram', 'cctContact'], 'EP notification');
      const sd = sdohSummary(s.sdoh);
      set('hrsnInterventions', sd, 'SDOH screening and referrals (edit)');
      break;
    }
    case 'nonresponsive_letter': {
      set('letterDate', today, 'Today');
      set('respondentName', c?.name || p.name, c?.name ? 'Chart name' : 'AOT participant name');
      if (c) {
        const addr = [c.addressLine1, c.addressLine2, [c.city, c.state].filter(Boolean).join(', ') + (c.postalCode ? ` ${c.postalCode}` : '')]
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
          .join('\n');
        set('mailingAddress', addr, 'Chart: address');
      }
      if (s.outreach?.length) {
        set(
          'outreachAttempts',
          [...s.outreach]
            .sort((a, b) => new Date(a.attemptedAt).getTime() - new Date(b.attemptedAt).getTime())
            .map((a) => ({
              date: ymd(a.attemptedAt),
              method: ['phone', 'mail', 'in_person'].includes(a.method) ? a.method : 'other',
              result: ['text', 'email'].includes(a.method) ? `${methodLabel(a.method)}: ${a.result}` : a.result,
            })),
          'AOT outreach log',
        );
      }
      if (['PRACTICE_DIRECTOR', 'DIRECTOR', 'ADMIN'].includes(String(s.actor.role).toUpperCase()))
        set('directorName', s.actor.name, 'Signed-in program director');
      carry(out, s.previous?.nonresponsive_letter, ['regionalOfficeAddress', 'regionalOfficeCity', 'regionalOfficePhone', 'regionalOfficeEmail', 'contactName', 'contactPhone', 'contactEmail', 'directorName'], 'non-responsive letter');
      break;
    }
    case 'complaint': {
      set('reportDate', today, 'Today');
      set('reporterName', s.actor.name, 'Signed-in user');
      set('participantName', c?.name || p.name, c?.name ? 'Chart name' : 'AOT participant name');
      if (c) set('participantDob', ymd(c.dateOfBirth), 'Chart: date of birth');
      if (p.county && p.county !== 'Not documented') set('county', p.county, 'AOT participant county');
      // Region follows the county only when MDH lists a CCT there; anything else stays unselected.
      const region = countyToCctRegion(p.county);
      if (region) set('region', region, `MDH CCT region for ${p.county} (${CCT_REGION_LABEL[region]}); change if needed`);
      // Unmapped county: the Region field's help reads "Phase II / other: select manually".
      const st = String(p.status ?? '');
      const aotStatus = st === 'petition' || st === 'hearing' ? 'pending_petition' : st === 'active' || st === 'renewal' ? 'active_order' : '';
      set('aotStatus', aotStatus, 'AOT participant stage');
      break;
    }
  }
  return out;
}
