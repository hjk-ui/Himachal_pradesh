/**
 * Facts from the MDH AOT Resource Center page (owner-provided copy, 2026-10-20), as pure helpers.
 * Source text is quoted in docs/source-forms/mdh-aot-resource-center-2026-10-20.md.
 * Browser-safe: no Prisma, no React.
 */

// ─── Quoted MDH text ────────────────────────────────────────────────────────

export const MDH_CCT_REGIONS_TEXT =
  "MDH AOT Care Coordination Teams (CCT) are currently operational in Baltimore City; Anne Arundel County; and the Eastern Shore Region (Kent County, Queen Anne's County, Caroline County, Dorchester County, Wicomico County, Somerset County, Worcester County, Cecil County & Talbot County).";

export const MDH_AFFIDAVIT_TIMING_TEXT =
  "completion of the AOT Psychiatrist's Affidavit by a psychiatrist who has examined the individual atleast 30 days prior to the petition filing and is willing to attest to the individual's eligibility in court. The psychiatrist's affidavit must be filed along with the petition in the Circuit Court in the county the respondent resides in or was last known to reside in.";

export const MDH_AFFIDAVIT_TIMING_CAVEAT =
  "The MDH wording ('at least 30 days prior') may mean within 30 days before filing; confirm with counsel.";

export const MDH_PARTICIPANT_TEXT =
  'AOT Participant - An individual who is court ordered to follow the treatment plan ordered by the court for a term not to exceed one year.';

export const MDH_PETITIONER_TEXT =
  'Petitioner - An individual who files an AOT petition in Maryland. This can be the director of a State-funded mental health program or any individual at least 18 years old who has a legitimate interest in the wellbeing of the respondent.';

export const MDH_AOT_QUESTIONS_TEXT =
  "For questions about Maryland's Assisted Outpatient Treatment (AOT) Program reach out to MDH.AOT@Maryland.gov.";
export const MDH_AOT_EMAIL = 'MDH.AOT@Maryland.gov';
export const MDH_988_TEXT = 'AOT is not for everyone, if you or someone you know needs to talk, call or text 988.';

// ─── 1. County → MDH CCT region ─────────────────────────────────────────────

export type CctRegion = 'baltimore_city' | 'anne_arundel' | 'eastern_shore';

export const CCT_REGION_LABEL: Record<CctRegion, string> = {
  baltimore_city: 'Baltimore City',
  anne_arundel: 'Anne Arundel',
  eastern_shore: 'Eastern Shore',
};

/** The nine Eastern Shore counties MDH lists as operational. */
export const EASTERN_SHORE_COUNTIES = [
  'Kent',
  "Queen Anne's",
  'Caroline',
  'Dorchester',
  'Wicomico',
  'Somerset',
  'Worcester',
  'Cecil',
  'Talbot',
] as const;

/** Maryland's 23 counties and Baltimore City (venue / county pickers). */
export const MARYLAND_JURISDICTIONS = [
  'Allegany',
  'Anne Arundel',
  'Baltimore City',
  'Baltimore County',
  'Calvert',
  'Caroline',
  'Carroll',
  'Cecil',
  'Charles',
  'Dorchester',
  'Frederick',
  'Garrett',
  'Harford',
  'Howard',
  'Kent',
  'Montgomery',
  "Prince George's",
  "Queen Anne's",
  "St. Mary's",
  'Somerset',
  'Talbot',
  'Washington',
  'Wicomico',
  'Worcester',
] as const;

/** "Queen Anne's County", "queen annes", "QUEEN ANNE’S" -> "queen annes" */
function normCounty(v: string | null | undefined): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[’'`.]/g, '')
    .replace(/,?\s*(maryland|md)$/, '')
    .replace(/\s+county$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const REGION_BY_COUNTY: Record<string, CctRegion> = {
  'baltimore city': 'baltimore_city',
  'anne arundel': 'anne_arundel',
  ...Object.fromEntries(EASTERN_SHORE_COUNTIES.map((c) => [normCounty(c), 'eastern_shore' as CctRegion])),
};

/**
 * MDH CCT region for a county, or null when MDH does not list a CCT as operational there
 * ("Baltimore County" is not Baltimore City and maps to null).
 */
export function countyToCctRegion(county: string | null | undefined): CctRegion | null {
  const raw = String(county ?? '').trim().toLowerCase();
  // "Baltimore County" normalizes to "baltimore"; only an explicit "Baltimore City" maps.
  if (/^baltimore\s+county\b/.test(raw)) return null;
  return REGION_BY_COUNTY[normCounty(county)] ?? null;
}

export function hasOperationalCct(county: string | null | undefined): boolean {
  return countyToCctRegion(county) !== null;
}

export const NO_CCT_NOTE =
  'MDH does not list an AOT Care Coordination Team as operational in this county (MDH lists Baltimore City, Anne Arundel County and nine Eastern Shore counties). Confirm with MDH which team, if any, serves this respondent.';

/** County values that mean "not recorded" (no note shown for these). */
export function countyRecorded(county: string | null | undefined): boolean {
  const c = String(county ?? '').trim();
  return !!c && c.toLowerCase() !== 'not documented';
}

// ─── 3. Order term ≤ one year ───────────────────────────────────────────────

const DAY = 86400000;

function ymdUtc(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = typeof v === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v) : v;
  if (Number.isNaN(d.getTime())) return null;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Latest allowed order end: start + 365 days, or + 366 when a Feb 29 falls after the start within that span. */
export function maxOrderEnd(orderStart: Date | string | null | undefined): string | null {
  const s = ymdUtc(orderStart);
  if (s === null) return null;
  const plus365 = s + 365 * DAY;
  let days = 365;
  const startYear = new Date(s).getUTCFullYear();
  for (const y of [startYear, startYear + 1]) {
    if (!isLeap(y)) continue;
    const feb29 = Date.UTC(y, 1, 29);
    if (feb29 > s && feb29 <= plus365) days = 366;
  }
  return new Date(s + days * DAY).toISOString().slice(0, 10);
}

/** null when the order term is valid (or a date is missing); otherwise a plain message. */
export function orderTermProblem(orderStart: Date | string | null | undefined, orderEnd: Date | string | null | undefined): string | null {
  const s = ymdUtc(orderStart);
  const e = ymdUtc(orderEnd);
  if (s === null || e === null) return null;
  if (e < s) return 'The order end date is before the order start date.';
  const max = maxOrderEnd(orderStart)!;
  if (e > ymdUtc(max)!) {
    return `An AOT order term cannot exceed one year (MDH: "a term not to exceed one year"). With this start date, the order must end on or before ${max}.`;
  }
  return null;
}

// ─── 4. Petitioner ──────────────────────────────────────────────────────────

export const PETITIONER_TYPES = [
  { value: 'program_director', label: 'Director of a State-funded mental health program' },
  { value: 'individual', label: 'Individual at least 18 years old with a legitimate interest in the wellbeing of the respondent' },
] as const;
export type PetitionerType = (typeof PETITIONER_TYPES)[number]['value'];

export type PetitionerInput = {
  type?: string | null;
  name?: string | null;
  relationship?: string | null;
  attestedAdult?: boolean | null;
};

export const PETITIONER_ADULT_ATTESTATION = 'I confirm the petitioner is at least 18 years old.';

/** Missing / invalid petitioner items (empty = valid). */
export function petitionerProblems(p: PetitionerInput | null | undefined): string[] {
  const out: string[] = [];
  const type = String(p?.type ?? '');
  if (!PETITIONER_TYPES.some((t) => t.value === type)) out.push('Select the petitioner type');
  if (!String(p?.relationship ?? '').trim()) out.push("Enter the petitioner's relationship to the respondent");
  if (type === 'individual' && p?.attestedAdult !== true) out.push('Confirm the petitioner is at least 18 years old');
  return out;
}

/**
 * Server check for eligibilityData.petitioner on save: null when absent or valid, else a plain message.
 * Rows saved before petitioner types existed (free-text type) are not re-validated unless re-sent.
 */
export function petitionerIssueIn(eligibilityData: unknown): string | null {
  if (!eligibilityData || typeof eligibilityData !== 'object') return null;
  const p = (eligibilityData as Record<string, unknown>).petitioner;
  if (p === undefined || p === null) return null;
  if (typeof p !== 'object') return 'Petitioner details are not valid';
  const problems = petitionerProblems(p as PetitionerInput);
  return problems.length ? `Petitioner: ${problems.join('; ')}` : null;
}

export function petitionerTypeLabel(type: string | null | undefined): string {
  return PETITIONER_TYPES.find((t) => t.value === type)?.label ?? String(type ?? '');
}

// ─── 6. Respondent vs participant ───────────────────────────────────────────

/** Stages before an order is granted. */
export const PRE_ORDER_STAGES = ['referral', 'screening', 'petition', 'hearing'] as const;

/** Altrixs UI label for the person: "Respondent" before an order is granted, "Participant" after. */
export function personLabel(status: string | null | undefined): 'Respondent' | 'Participant' {
  return (PRE_ORDER_STAGES as readonly string[]).includes(String(status ?? '')) ? 'Respondent' : 'Participant';
}

// ─── 5. Petition checklist ──────────────────────────────────────────────────

export type ChecklistItemSpec = {
  id: string;
  label: string;
  /** Respondent agreement item: records agreed / declined / no response */
  outcome?: boolean;
};

export const PETITION_CHECKLIST: readonly ChecklistItemSpec[] = [
  {
    id: 'petition_filed',
    label:
      'Petition for Assisted Outpatient Treatment (Maryland Court Forms) filed in the Circuit Court of the county where the respondent resides or last resided',
  },
  { id: 'affidavit_filed', label: "AOT Psychiatrist's Affidavit filed with the petition" },
  { id: 'county_attorney_notified', label: 'Office of the County Attorney notified of the petition filing' },
  { id: 'mdh_notified', label: 'MDH (the Department) notified of the petition filing' },
  { id: 'counsel_identified', label: 'Respondent counsel identified (Office of the Public Defender or private attorney)' },
  {
    id: 'remote_participation_motion',
    label: 'Motion for Remote Participation filed for providers ("the department highly encourages the submission of a Motion for Remote Participation")',
  },
  {
    id: 'respondent_plan_opportunity',
    label: 'Respondent given the opportunity to work with the CCT on the treatment plan and to agree to it before the hearing',
    outcome: true,
  },
  { id: 'cct_composition', label: 'CCT includes at minimum a Psychiatrist, a Case Manager and a Certified Peer Recovery Specialist' },
];

export const RESPONDENT_PLAN_OUTCOMES = [
  { value: 'agreed', label: 'Agreed' },
  { value: 'declined', label: 'Declined' },
  { value: 'no_response', label: 'No response' },
] as const;
export type RespondentPlanOutcome = (typeof RESPONDENT_PLAN_OUTCOMES)[number]['value'];

export type ChecklistEntry = { done: boolean; date?: string | null; by?: string | null; outcome?: RespondentPlanOutcome | null };
export type PetitionChecklist = Record<string, ChecklistEntry>;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Keep only known items and well-formed values (stored in eligibilityData.petitionChecklist). */
export function normalizeChecklist(input: unknown): PetitionChecklist {
  const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const out: PetitionChecklist = {};
  for (const spec of PETITION_CHECKLIST) {
    const raw = src[spec.id];
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const outcome = spec.outcome && RESPONDENT_PLAN_OUTCOMES.some((o) => o.value === r.outcome) ? (r.outcome as RespondentPlanOutcome) : null;
    const date = typeof r.date === 'string' && YMD.test(r.date) ? r.date : null;
    const by = typeof r.by === 'string' ? r.by.trim().slice(0, 120) : '';
    // The respondent item is done once an outcome is recorded
    const done = spec.outcome ? !!outcome : r.done === true;
    out[spec.id] = { done, date, by: by || null, ...(spec.outcome ? { outcome } : {}) };
  }
  return out;
}

export function checklistFromEligibility(eligibilityData: unknown): PetitionChecklist {
  const e = eligibilityData && typeof eligibilityData === 'object' ? (eligibilityData as Record<string, unknown>) : {};
  return normalizeChecklist(e.petitionChecklist);
}

export type ChecklistFlag = { id: string; label: string; status: 'due'; basis: string };

/** Open checklist items, flagged only while the case is at the petition or hearing stage. */
export function petitionChecklistFlags(status: string | null | undefined, checklist: PetitionChecklist): ChecklistFlag[] {
  if (!['petition', 'hearing'].includes(String(status ?? ''))) return [];
  return PETITION_CHECKLIST.filter((s) => !checklist[s.id]?.done).map((s) => ({
    id: `checklist-${s.id}`,
    label: s.label,
    status: 'due' as const,
    basis: 'MDH AOT Resource Center petition steps',
  }));
}
