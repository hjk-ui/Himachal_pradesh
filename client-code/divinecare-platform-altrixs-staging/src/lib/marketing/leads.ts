/**
 * Lead pipeline rules (pure): stage moves, dedupe matching, speed-to-lead.
 */
import { LEAD_STAGE_KEYS, OPEN_STAGES, type LeadStage } from './constants';

export type StageMove = { ok: true } | { ok: false; error: string };

export const isLeadStage = (s: unknown): s is LeadStage => typeof s === 'string' && (LEAD_STAGE_KEYS as string[]).includes(s);
export const isOpenStage = (s: string) => (OPEN_STAGES as string[]).includes(s);

/**
 * Stage rules:
 * - Any open stage can move to any other open stage (forward or back).
 * - "converted" is reached only through Convert to client (creates the client + intake visit).
 * - "not_a_fit" / "lost" need a reason.
 * - Converted leads are closed for good: from then on the person is a client and communication
 *   moves to the clinical system (marketing to clients needs a marketing authorization).
 * - Lost / not a fit can be reopened to New or Contacted.
 */
export function canMoveStage(from: string, to: string, opts: { viaConvert?: boolean; reason?: string | null } = {}): StageMove {
  if (!isLeadStage(to)) return { ok: false, error: 'Unknown stage.' };
  if (from === to) return { ok: false, error: 'The lead is already in that stage.' };
  if (from === 'converted') return { ok: false, error: 'This lead is already a client. Work with them from the client chart.' };
  if (to === 'converted' && !opts.viaConvert) return { ok: false, error: 'Use Convert to client to create the client and intake appointment.' };
  if ((to === 'lost' || to === 'not_a_fit') && !opts.reason?.trim()) return { ok: false, error: 'Add a reason before closing the lead.' };
  if ((from === 'lost' || from === 'not_a_fit') && !(to === 'new' || to === 'contacted' || to === 'lost' || to === 'not_a_fit')) {
    return { ok: false, error: 'Reopen a closed lead to New or Contacted first.' };
  }
  if (to === 'converted' && !isOpenStage(from)) return { ok: false, error: 'Only open leads can be converted.' };
  return { ok: true };
}

/** Furthest open stage reached (for funnel math); closed stages keep the previous furthest. */
export function nextFurthestStage(currentFurthest: string, to: string): string {
  const order = OPEN_STAGES as string[];
  if (to === 'converted') return 'converted';
  if (currentFurthest === 'converted') return 'converted';
  const a = order.indexOf(currentFurthest);
  const b = order.indexOf(to);
  if (b < 0) return currentFurthest;
  return b > a ? to : currentFurthest;
}

// ─── Dedupe ─────────────────────────────────────────────────────────────────────────────

export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Last 10 digits (US), or '' when too short to compare. */
export function phoneKey(s: string | null | undefined): string {
  const d = (s ?? '').replace(/\D/g, '');
  if (d.length < 10) return '';
  return d.slice(-10);
}

export function dobKey(d: Date | string | null | undefined): string {
  if (!d) return '';
  if (typeof d === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    const t = new Date(d);
    return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
  }
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

export type DedupePerson = {
  firstName?: string | null;
  lastName?: string | null;
  /** Full name ("First Last") when first / last are not split (clients) */
  name?: string | null;
  dateOfBirth?: Date | string | null;
  phone?: string | null;
};

function nameKey(p: DedupePerson): string {
  if (p.firstName || p.lastName) return normalizeName(`${p.firstName ?? ''}${p.lastName ?? ''}`);
  return normalizeName(p.name);
}

export type DedupeMatch = { level: 'strong' | 'possible'; basis: string };

/**
 * Match a lead against an existing person (client or lead) on name + DOB + phone.
 * strong: any two of the three agree. possible: phone alone, or name alone with no DOB to compare.
 * The basis text never contains the other person's data, only which fields matched.
 */
export function matchPerson(a: DedupePerson, b: DedupePerson): DedupeMatch | null {
  const nA = nameKey(a);
  const nB = nameKey(b);
  const name = Boolean(nA && nB && nA === nB);
  const dA = dobKey(a.dateOfBirth ?? null);
  const dB = dobKey(b.dateOfBirth ?? null);
  const dob = Boolean(dA && dB && dA === dB);
  const pA = phoneKey(a.phone);
  const pB = phoneKey(b.phone);
  const phone = Boolean(pA && pB && pA === pB);
  const hits = [name && 'name', dob && 'date of birth', phone && 'phone'].filter(Boolean) as string[];
  if (hits.length >= 2) return { level: 'strong', basis: hits.join(' and ') };
  if (phone) return { level: 'possible', basis: 'phone' };
  if (name && (!dA || !dB)) return { level: 'possible', basis: 'name' };
  return null;
}

/** Best match across candidates (strong beats possible). */
export function bestMatch(lead: DedupePerson, candidates: DedupePerson[]): DedupeMatch | null {
  let best: DedupeMatch | null = null;
  for (const c of candidates) {
    const m = matchPerson(lead, c);
    if (!m) continue;
    if (m.level === 'strong') return m;
    best = best ?? m;
  }
  return best;
}

// ─── Speed to lead ──────────────────────────────────────────────────────────────────────

/** Minutes from lead creation to first outbound response (null until responded). */
export function speedToLeadMinutes(createdAt: Date, firstResponseAt: Date | null | undefined): number | null {
  if (!firstResponseAt) return null;
  return Math.max(0, Math.round((firstResponseAt.getTime() - createdAt.getTime()) / 60000));
}

export type SpeedStatus = { minutes: number; responded: boolean; overdue: boolean };

/** Live timer for the pipeline card: minutes waiting (or taken) and whether the target is blown. */
export function speedToLeadStatus(
  lead: { createdAt: Date; firstResponseAt?: Date | null },
  targetMinutes: number,
  now: Date,
): SpeedStatus {
  const responded = Boolean(lead.firstResponseAt);
  const end = lead.firstResponseAt ?? now;
  const minutes = Math.max(0, Math.round((end.getTime() - lead.createdAt.getTime()) / 60000));
  return { minutes, responded, overdue: minutes > targetMinutes };
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  if (h < 48) return `${h}h ${minutes % 60}m`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * Minimum-necessary guard for lead notes: blocks obvious clinical detail (diagnoses, medications,
 * symptoms) so the CRM holds contact / scheduling facts only. Returns the matched terms.
 */
const CLINICAL_NOTE_TERMS = [
  /\b(diagnos\w*|dx)\b/i,
  /\b(bipolar|schizo\w*|psychos\w*|ptsd|ocd|adhd|depress\w*|anxiety|panic attack|eating disorder|anorexia|bulimia)\b/i,
  /\b(suicid\w*|self[- ]harm|overdos\w*|cutting)\b/i,
  /\b(medication|meds|mg\b|prescri\w*|xanax|adderall|zoloft|lexapro|prozac|suboxone|methadone|lithium|seroquel|abilify)\b/i,
  /\b(heroin|cocaine|fentanyl|opioid|alcohol\w*|relapse|detox|sober|sobriety)\b/i,
  /\b(hospitali[sz]\w*|inpatient|psych ward|5150|emergency petition)\b/i,
];

export function clinicalTermsIn(text: string | null | undefined): string[] {
  const t = text ?? '';
  const out: string[] = [];
  for (const re of CLINICAL_NOTE_TERMS) {
    const m = re.exec(t);
    if (m) out.push(m[0].toLowerCase());
  }
  return out;
}
