/**
 * "Recompute client locations" rules. Pure: no prisma. The server loads the evidence
 * (src/lib/locations/server.ts), these functions decide, the owner reviews a dry run and applies it.
 *
 * Evidence per client (ids and counts only):
 *  - journal:   imported Valant Transaction Journal rows whose Facility is mapped to a location
 *               (FacilityLocationMap kind 'location'; program / unmapped / ignored facilities do not count).
 *  - clinician: the client's appointments, counted only for clinicians who work at exactly ONE location
 *               (UserLocation). Multi-site clinicians say nothing about the client. The assigned clinician is
 *               not used: a Valant import sets it to the importing user when no provider matched.
 *  - home:      the client's current location. For a Valant import it is Valant's "Assigned Facility" when
 *               the export had one, else the organization's primary location (the import default).
 *
 * Rules:
 *  1. A source is STRONG when its top location has >= MIN rows/weight and >= 80% of that source's votes;
 *     journal votes also need a CONFIRMED mapping (a mapping flagged "confirm" is weak).
 *  2. No strong source -> keep. Strong sources that disagree -> keep (conflict).
 *  3. Client at the default (primary) location or with no location: one strong source moves it.
 *  4. Client at a NON-default location (an explicit assignment): evidence for the default location never
 *     moves it (the default is where import defaults, default staff links and Valant's billing facility land);
 *     evidence for another location moves it only when BOTH sources are strong and agree.
 */

export const RULES = {
  minJournalRows: 2,
  minClinicianWeight: 2,
  minShare: 0.8,
} as const;

export type LocationVote = { locationId: string; count: number };

export type ClientEvidence = {
  clientId: string;
  currentLocationId: string | null;
  sourcePlatform: string | null;
  /** journal rows per mapped location; unconfirmedLocationIds = locations whose rows came from a "confirm" mapping */
  journal: LocationVote[];
  journalUnconfirmedLocationIds: string[];
  journalProgramRows: number;
  journalUnmappedRows: number;
  /** appointments per location of single-site clinicians */
  clinician: LocationVote[];
  /** weight from clinicians with several locations (ignored, shown for transparency) */
  clinicianMultiSiteWeight: number;
};

export type SourceVerdict = {
  source: 'journal' | 'clinician';
  locationId: string | null;
  count: number;
  total: number;
  share: number;
  strong: boolean;
  /** why it is weak (null when strong or empty) */
  weakReason: string | null;
};

export type RecomputeReason = 'move' | 'unchanged' | 'no_evidence' | 'weak' | 'conflict' | 'protected';

export type ClientDecision = {
  clientId: string;
  action: 'move' | 'keep';
  reason: RecomputeReason;
  fromLocationId: string | null;
  toLocationId: string | null;
  /** journal | clinician | journal+clinician (for moves) */
  evidence: string | null;
  verdicts: SourceVerdict[];
};

function topVote(votes: LocationVote[]): { top: LocationVote | null; total: number } {
  let top: LocationVote | null = null;
  let total = 0;
  for (const v of votes) {
    if (v.count <= 0) continue;
    total += v.count;
    if (!top || v.count > top.count || (v.count === top.count && v.locationId < top.locationId)) top = v;
  }
  return { top, total };
}

export function journalVerdict(e: ClientEvidence): SourceVerdict {
  const { top, total } = topVote(e.journal);
  if (!top) return { source: 'journal', locationId: null, count: 0, total: 0, share: 0, strong: false, weakReason: null };
  const share = top.count / total;
  let weakReason: string | null = null;
  if (top.count < RULES.minJournalRows) weakReason = `only ${top.count} journal row${top.count === 1 ? '' : 's'}`;
  else if (share < RULES.minShare) weakReason = `journal rows split across locations (${Math.round(share * 100)}%)`;
  else if (e.journalUnconfirmedLocationIds.includes(top.locationId)) weakReason = 'facility mapping not confirmed';
  return { source: 'journal', locationId: top.locationId, count: top.count, total, share, strong: weakReason === null, weakReason };
}

export function clinicianVerdict(e: ClientEvidence): SourceVerdict {
  const { top, total } = topVote(e.clinician);
  if (!top) return { source: 'clinician', locationId: null, count: 0, total: 0, share: 0, strong: false, weakReason: null };
  const share = top.count / total;
  let weakReason: string | null = null;
  if (top.count < RULES.minClinicianWeight) weakReason = `only ${top.count} visit${top.count === 1 ? '' : 's'} with a single-site clinician`;
  else if (share < RULES.minShare) weakReason = `clinicians at several locations (${Math.round(share * 100)}%)`;
  return { source: 'clinician', locationId: top.locationId, count: top.count, total, share, strong: weakReason === null, weakReason };
}

export function decideClientLocation(e: ClientEvidence, defaultLocationId: string | null): ClientDecision {
  const verdicts = [journalVerdict(e), clinicianVerdict(e)];
  const base = { clientId: e.clientId, fromLocationId: e.currentLocationId, verdicts };
  const keep = (reason: RecomputeReason): ClientDecision => ({ ...base, action: 'keep', reason, toLocationId: e.currentLocationId, evidence: null });

  const strong = verdicts.filter((v) => v.strong && v.locationId);
  if (strong.length === 0) {
    return keep(verdicts.some((v) => v.locationId) ? 'weak' : 'no_evidence');
  }
  const targets = new Set(strong.map((v) => v.locationId as string));
  if (targets.size > 1) return keep('conflict');
  const target = strong[0].locationId as string;
  if (target === e.currentLocationId) return keep('unchanged');

  const atDefault = !e.currentLocationId || e.currentLocationId === defaultLocationId;
  if (!atDefault) {
    if (target === defaultLocationId) return keep('protected');
    if (strong.length < 2) return keep('protected');
  }
  return {
    ...base,
    action: 'move',
    reason: 'move',
    toLocationId: target,
    evidence: strong.map((v) => v.source).sort().join('+'),
  };
}

export const REASON_LABELS: Record<RecomputeReason, string> = {
  move: 'Will move',
  unchanged: 'Evidence agrees with current location',
  no_evidence: 'No journal or clinician evidence',
  weak: 'Evidence too weak',
  conflict: 'Sources disagree',
  protected: 'Kept: explicit (non-default) location needs two agreeing sources',
};

export type RecomputeSummary = {
  clients: number;
  byReason: Record<RecomputeReason, number>;
  moves: { fromLocationId: string | null; toLocationId: string; count: number }[];
};

export function summarizeDecisions(decisions: ClientDecision[]): RecomputeSummary {
  const byReason: Record<RecomputeReason, number> = { move: 0, unchanged: 0, no_evidence: 0, weak: 0, conflict: 0, protected: 0 };
  const pairs = new Map<string, { fromLocationId: string | null; toLocationId: string; count: number }>();
  for (const d of decisions) {
    byReason[d.reason] += 1;
    if (d.action !== 'move' || !d.toLocationId) continue;
    const key = `${d.fromLocationId ?? ''}>${d.toLocationId}`;
    const p = pairs.get(key) ?? { fromLocationId: d.fromLocationId, toLocationId: d.toLocationId, count: 0 };
    p.count += 1;
    pairs.set(key, p);
  }
  return { clients: decisions.length, byReason, moves: [...pairs.values()].sort((a, b) => b.count - a.count) };
}

/** Stable fingerprint of the planned moves: apply refuses when the data changed since the preview. */
export function planFingerprint(decisions: ClientDecision[]): string {
  const lines = decisions
    .filter((d) => d.action === 'move')
    .map((d) => `${d.clientId}:${d.fromLocationId ?? ''}>${d.toLocationId ?? ''}`)
    .sort();
  let h = 0x811c9dc5;
  const s = lines.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${lines.length}-${h.toString(16).padStart(8, '0')}`;
}

/** Build per-client evidence from grouped rows (the server runs the groupBy queries). */
export function collectEvidence(input: {
  clients: { id: string; locationId: string | null; sourcePlatform: string | null }[];
  journalGroups: { clientId: string; facility: string | null; rows: number }[];
  resolveFacility: (facility: string | null) =>
    | { kind: 'location'; locationId: string; confirmed: boolean }
    | { kind: 'program' }
    | { kind: 'ignore' }
    | { kind: 'unmapped' };
  appointmentGroups: { clientId: string; clinicianId: string | null; count: number }[];
  staffLocations: Map<string, string[]>;
}): ClientEvidence[] {
  const byClient = new Map<string, ClientEvidence>();
  for (const c of input.clients) {
    byClient.set(c.id, {
      clientId: c.id,
      currentLocationId: c.locationId,
      sourcePlatform: c.sourcePlatform,
      journal: [],
      journalUnconfirmedLocationIds: [],
      journalProgramRows: 0,
      journalUnmappedRows: 0,
      clinician: [],
      clinicianMultiSiteWeight: 0,
    });
  }
  const bump = (votes: LocationVote[], locationId: string, n: number) => {
    const v = votes.find((x) => x.locationId === locationId);
    if (v) v.count += n;
    else votes.push({ locationId, count: n });
  };
  for (const g of input.journalGroups) {
    const e = byClient.get(g.clientId);
    if (!e) continue;
    const r = input.resolveFacility(g.facility);
    if (r.kind === 'location') {
      bump(e.journal, r.locationId, g.rows);
      if (!r.confirmed && !e.journalUnconfirmedLocationIds.includes(r.locationId)) e.journalUnconfirmedLocationIds.push(r.locationId);
    } else if (r.kind === 'program') e.journalProgramRows += g.rows;
    else if (r.kind === 'unmapped') e.journalUnmappedRows += g.rows;
  }
  const addClinician = (e: ClientEvidence, clinicianId: string | null, n: number) => {
    if (!clinicianId) return;
    const locs = input.staffLocations.get(clinicianId) ?? [];
    if (locs.length === 1) bump(e.clinician, locs[0], n);
    else if (locs.length > 1) e.clinicianMultiSiteWeight += n;
  };
  for (const g of input.appointmentGroups) {
    const e = byClient.get(g.clientId);
    if (e) addClinician(e, g.clinicianId, g.count);
  }
  return [...byClient.values()];
}
