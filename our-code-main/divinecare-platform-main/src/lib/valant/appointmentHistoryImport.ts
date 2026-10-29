import { parseEasternDateTime, classifyAppointmentRow } from './repair';
import { buildHistoryExternalKey } from './appointmentHistory';

/**
 * Pure parsing / planning for the Valant appointment-history import (no I/O).
 * Positional columns of the Valant Appointments export (24 columns, duplicate header names):
 *   [5] date  [6] time range  [7] "Name (CHART ID)"  [9] CPT  [15] provider
 */
export const APPOINTMENT_EXPORT_COLUMNS = 24;

/** Minimal RFC 4180 CSV reader (quoted fields, doubled quotes, CRLF). Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

export type HistoryRow = {
  rowNumber: number;
  chartId: string | null;
  /** Name from the export — used only for the optional name match; never printed. */
  nameFromExport: string | null;
  startsAt: Date;
  endsAt: Date;
  /** YYYY-MM-DD, clinic-local */
  localDate: string;
  provider: string;
  coded: boolean;
};

export type ParseSkipReason = 'non_patient' | 'bad_date_or_time' | 'no_chart_id_or_name';

export type ParseResult = {
  rows: HistoryRow[];
  skipped: Record<ParseSkipReason, number>;
  totalRows: number;
  /** Set when the file does not look like the Appointments export. */
  error?: string;
};

function clinicLocalDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

/** `rows[0]` is the header. Fails closed on a wrong column count. */
export function parseAppointmentHistoryRows(rows: string[][]): ParseResult {
  const skipped: Record<ParseSkipReason, number> = { non_patient: 0, bad_date_or_time: 0, no_chart_id_or_name: 0 };
  const out: HistoryRow[] = [];
  if (rows.length === 0) return { rows: out, skipped, totalRows: 0, error: 'The file is empty.' };
  const badWidth = rows.findIndex((r) => r.length !== APPOINTMENT_EXPORT_COLUMNS);
  if (badWidth >= 0) {
    return {
      rows: out,
      skipped,
      totalRows: rows.length - 1,
      error: `Row ${badWidth + 1} has ${rows[badWidth].length} columns; the Appointments export has ${APPOINTMENT_EXPORT_COLUMNS}.`,
    };
  }

  for (let i = 1; i < rows.length; i += 1) {
    const r = rows[i];
    const klass = classifyAppointmentRow(r[7]);
    if (klass.isNonPatient) {
      skipped.non_patient += 1;
      continue;
    }
    const time = parseEasternDateTime(r[5], r[6]);
    if (!time) {
      skipped.bad_date_or_time += 1;
      continue;
    }
    if (!klass.mrn && !klass.clientName) {
      skipped.no_chart_id_or_name += 1;
      continue;
    }
    const provider = (r[15] || '').trim() || 'Staff';
    out.push({
      rowNumber: i + 1,
      chartId: klass.mrn,
      nameFromExport: klass.clientName,
      startsAt: time.start,
      endsAt: time.end,
      localDate: clinicLocalDate(time.start),
      provider,
      coded: Boolean((r[9] || '').trim()),
    });
  }
  return { rows: out, skipped, totalRows: rows.length - 1 };
}

export type DateWindow = { since?: string; until?: string; now?: Date };

/** Keep past visits inside the window. Future-dated rows are never history. */
export function withinWindow(row: HistoryRow, w: DateWindow): boolean {
  if (row.startsAt.getTime() > (w.now ?? new Date()).getTime()) return false;
  if (w.since && row.localDate < w.since) return false;
  if (w.until && row.localDate > w.until) return false;
  return true;
}

export type ClientRef = { id: string; name: string; mrn: string | null; sourceId: string | null };

export type ClientMatch =
  | { kind: 'chart'; client: ClientRef }
  | { kind: 'name'; client: ClientRef }
  | { kind: 'none'; reason: 'no_match' | 'ambiguous_name' | 'name_match_off' };

const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Match by chart id first (client MRN or source id). Optional fallback: one exact full-name match. */
export function buildClientMatcher(clients: ClientRef[], opts: { nameMatch: boolean }) {
  const byChart = new Map<string, ClientRef[]>();
  const byName = new Map<string, ClientRef[]>();
  for (const c of clients) {
    for (const key of [c.mrn, c.sourceId]) {
      const k = (key || '').trim().toUpperCase();
      if (k) byChart.set(k, [...(byChart.get(k) || []), c]);
    }
    const n = norm(c.name);
    if (n) byName.set(n, [...(byName.get(n) || []), c]);
  }
  return (row: Pick<HistoryRow, 'chartId' | 'nameFromExport'>): ClientMatch => {
    const chart = (row.chartId || '').trim().toUpperCase();
    const hits = chart ? byChart.get(chart) || [] : [];
    const unique = [...new Map(hits.map((h) => [h.id, h])).values()];
    if (unique.length === 1) return { kind: 'chart', client: unique[0] };
    if (unique.length > 1) return { kind: 'none', reason: 'no_match' };
    if (!opts.nameMatch) return { kind: 'none', reason: 'name_match_off' };
    const named = byName.get(norm(row.nameFromExport)) || [];
    if (named.length === 1) return { kind: 'name', client: named[0] };
    return { kind: 'none', reason: named.length > 1 ? 'ambiguous_name' : 'no_match' };
  };
}

export type PlanOptions = {
  treatUncodedAsAttended: boolean;
};

export type PlannedAppointment = {
  clientId: string;
  clientName: string;
  externalKey: string;
  startsAt: Date;
  endsAt: Date;
  provider: string;
  chartId: string | null;
  matchedBy: 'chart' | 'name';
};

export type Plan = {
  create: PlannedAppointment[];
  counts: {
    parsed: number;
    outsideWindow: number;
    uncodedSkipped: number;
    unmatchedClient: number;
    ambiguousName: number;
    alreadyImported: number;
    liveSlotExists: number;
    toCreate: number;
    duplicateInFile: number;
  };
  /** Live (non-imported) SCHEDULED past appointments the history confirms as attended. */
  closeOut: { appointmentId: string }[];
};

type ExistingAppt = { id: string; clientId: string; startsAt: Date; status: string; source: string | null; externalKey: string | null; createdVia: string | null };

export function planHistoryImport(input: {
  rows: HistoryRow[];
  window: DateWindow;
  options: PlanOptions;
  match: ReturnType<typeof buildClientMatcher>;
  existing: ExistingAppt[];
}): Plan {
  const counts: Plan['counts'] = {
    parsed: input.rows.length,
    outsideWindow: 0,
    uncodedSkipped: 0,
    unmatchedClient: 0,
    ambiguousName: 0,
    alreadyImported: 0,
    liveSlotExists: 0,
    toCreate: 0,
    duplicateInFile: 0,
  };
  const existingKeys = new Set(input.existing.map((a) => a.externalKey).filter(Boolean));
  const liveBySlot = new Map<string, ExistingAppt>();
  for (const a of input.existing) {
    if (a.source !== 'valant_history') liveBySlot.set(`${a.clientId}|${a.startsAt.toISOString()}`, a);
  }
  const seen = new Set<string>();
  const create: PlannedAppointment[] = [];
  const closeOut: Plan['closeOut'] = [];

  for (const row of input.rows) {
    if (!withinWindow(row, input.window)) {
      counts.outsideWindow += 1;
      continue;
    }
    if (!row.coded && !input.options.treatUncodedAsAttended) {
      counts.uncodedSkipped += 1;
      continue;
    }
    const m = input.match(row);
    if (m.kind === 'none') {
      if (m.reason === 'ambiguous_name') counts.ambiguousName += 1;
      else counts.unmatchedClient += 1;
      continue;
    }
    const live = liveBySlot.get(`${m.client.id}|${row.startsAt.toISOString()}`);
    if (live) {
      counts.liveSlotExists += 1;
      if (live.status === 'SCHEDULED' && live.createdVia === 'import' && row.startsAt.getTime() < Date.now()) {
        closeOut.push({ appointmentId: live.id });
      }
      continue;
    }
    // Key by client id (not chart id) so a name-matched row still dedupes against re-runs.
    const key = buildHistoryExternalKey({ chartId: m.client.id, startsAtIso: row.startsAt.toISOString(), provider: row.provider });
    if (existingKeys.has(key)) {
      counts.alreadyImported += 1;
      continue;
    }
    if (seen.has(key)) {
      counts.duplicateInFile += 1;
      continue;
    }
    seen.add(key);
    create.push({
      clientId: m.client.id,
      clientName: m.client.name,
      externalKey: key,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      provider: row.provider,
      chartId: row.chartId,
      matchedBy: m.kind,
    });
  }
  counts.toCreate = create.length;
  return { create, counts, closeOut };
}
