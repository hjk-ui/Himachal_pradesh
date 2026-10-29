/**
 * Client chart: per-client views of practice-wide JSON module lists (ClinicModuleState).
 * Pure helpers so the matching rules are testable and stated once.
 *
 * - ehr-safety-plans: entries carry clientId when created from the client picker -> exact match.
 *   Older entries without clientId are NOT matched by name (names are not unique).
 * - ehr-discharge-cases: entries carry only clientName (+ dob) -> matched by exact name AND,
 *   when both sides have one, the same date of birth. Flagged "name-matched" in the UI.
 * - diagnoses: entries carry only the client name -> matched by exact name, flagged the same way.
 */

export type ChartClientIdentity = {
  id: string;
  name: string;
  legalFirstName?: string | null;
  legalLastName?: string | null;
  dateOfBirth?: Date | null;
};

const norm = (s: unknown) => (typeof s === 'string' ? s.trim().replace(/\s+/g, ' ').toLowerCase() : '');

/** Names this chart is known by: Client.name, "First Last", "Last, First" */
export function chartNameKeys(c: ChartClientIdentity): Set<string> {
  const keys = new Set<string>();
  if (norm(c.name)) keys.add(norm(c.name));
  const first = norm(c.legalFirstName);
  const last = norm(c.legalLastName);
  if (first && last) {
    keys.add(`${first} ${last}`);
    keys.add(`${last}, ${first}`);
  }
  return keys;
}

type Rec = Record<string, unknown> & { id?: unknown };
const asList = (data: unknown): Rec[] => (Array.isArray(data) ? data.filter((r): r is Rec => Boolean(r) && typeof r === 'object') : []);

export function safetyPlansForClient(data: unknown, c: ChartClientIdentity): { matched: Rec[]; unlinkedCount: number } {
  const list = asList(data);
  return {
    matched: list.filter((r) => r.clientId === c.id),
    unlinkedCount: list.filter((r) => !r.clientId).length,
  };
}

function dobKey(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function dischargeCasesForClient(data: unknown, c: ChartClientIdentity): Rec[] {
  const keys = chartNameKeys(c);
  const dob = c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : null;
  return asList(data).filter((r) => {
    if (r.clientId === c.id) return true;
    if (r.clientId) return false;
    if (!keys.has(norm(r.clientName))) return false;
    const rd = dobKey(r.dob);
    return !(rd && dob && rd !== dob);
  });
}

export function diagnosisRecordsForClient(data: unknown, c: ChartClientIdentity): Rec[] {
  const keys = chartNameKeys(c);
  return asList(data).filter((r) => (r.clientId ? r.clientId === c.id : keys.has(norm(r.client))));
}
