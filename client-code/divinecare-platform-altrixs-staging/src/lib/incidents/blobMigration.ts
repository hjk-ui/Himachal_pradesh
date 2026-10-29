/**
 * Plan for scripts/migrate-incidents-blob.ts: copy the legacy ClinicModuleState 'incidents' list
 * (one org-wide JSON list) into IncidentReport rows.
 *
 * Rules (nothing is invented):
 *   - one row per item that has an id; the id becomes incidentNumber and legacySourceId (items
 *     without an id, or a repeated id inside the list, are counted and skipped; when a report
 *     filed in the new table already has that number, the legacy copy is numbered "<id>-LEGACY");
 *   - reportedBy / assignedTo were display names: linked to a staff user only on an exact,
 *     case-insensitive match to exactly one user of the organization; otherwise the user id stays
 *     null and the name is kept as text (an unlinked legacy report is visible to reviewers only);
 *   - involvedStaffIds start empty (the old form had no such field);
 *   - statuses from the old PATCH vocabulary are mapped to the page's (Open -> reported, Under Review /
 *     Investigation -> investigating, Resolved -> closed); unknown values are kept as written;
 *   - missing dates stay null / empty (never "today").
 * Pure (no database).
 */
import { normalizePersonName } from '@/lib/modules/clientLinkBackfill';

const LEGACY_STATUS: Record<string, string> = {
  open: 'reported',
  'under review': 'investigating',
  investigation: 'investigating',
  resolved: 'closed',
};

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function instant(v: unknown): Date | null {
  const s = text(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}

function ymd(v: unknown): string | null {
  const s = text(v);
  return s && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

export type IncidentMigrationRow = {
  incidentNumber: string;
  legacySourceId: string;
  title: string;
  type: string;
  chartCategory: string | null;
  severity: string;
  status: string;
  reporterUserId: string | null;
  reportedByName: string | null;
  assignedToUserId: string | null;
  assignedToName: string | null;
  clientInitials: string | null;
  reportedDate: string;
  reportedAtTime: Date | null;
  occurredAt: Date | null;
  dueFollowUp: string | null;
  closedAt: string | null;
  location: string | null;
  description: string;
  immediateAction: string | null;
  investigationNotes: string | null;
  correctiveActions: string[];
  rootCause: string | null;
  carfCategory: string | null;
  errorExplanation: string | null;
};

export type IncidentMigrationCounts = {
  items: number;
  toCopy: number;
  alreadyCopied: number;
  noId: number;
  duplicateId: number;
  renumbered: number;
  reporterLinked: number;
  reporterUnlinked: number;
  assigneeLinked: number;
  statusMapped: number;
  statusUnknownKept: number;
  notList: number;
};

export function emptyIncidentCounts(): IncidentMigrationCounts {
  return {
    items: 0, toCopy: 0, alreadyCopied: 0, noId: 0, duplicateId: 0, renumbered: 0, reporterLinked: 0, reporterUnlinked: 0,
    assigneeLinked: 0, statusMapped: 0, statusUnknownKept: 0, notList: 0,
  };
}

const KNOWN_STATUS = new Set(['reported', 'investigating', 'corrective_action', 'closed', 'filed_in_error']);

export function planIncidentBlobMigration(
  blob: unknown,
  opts: { staff: { id: string; name: string | null }[]; existingLegacyIds: Set<string>; existingNumbers: Set<string> },
): { rows: IncidentMigrationRow[]; counts: IncidentMigrationCounts } {
  const counts = emptyIncidentCounts();
  const rows: IncidentMigrationRow[] = [];
  if (!Array.isArray(blob)) {
    counts.notList = blob == null ? 0 : 1;
    return { rows, counts };
  }
  const byName = new Map<string, string[]>();
  for (const u of opts.staff) {
    const k = normalizePersonName(u.name);
    if (k) byName.set(k, [...(byName.get(k) ?? []), u.id]);
  }
  const uniqueUser = (name: string | null): string | null => {
    const hits = name ? byName.get(normalizePersonName(name)) ?? [] : [];
    return hits.length === 1 ? hits[0] : null;
  };
  const seen = new Set<string>();
  for (const raw of blob) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    counts.items++;
    const r = raw as Record<string, unknown>;
    const id = text(r.id);
    if (!id) {
      counts.noId++;
      continue;
    }
    if (opts.existingLegacyIds.has(id)) {
      counts.alreadyCopied++;
      continue;
    }
    if (seen.has(id)) {
      counts.duplicateId++;
      continue;
    }
    seen.add(id);
    // A report filed in the new table already took this number: keep the legacy report under a
    // marked number (the original id stays in legacySourceId)
    let incidentNumber = id;
    if (opts.existingNumbers.has(id)) {
      incidentNumber = `${id}-LEGACY`;
      counts.renumbered++;
    }
    const reportedByName = text(r.reportedBy);
    const assignedToName = text(r.assignedTo);
    const reporterUserId = uniqueUser(reportedByName);
    const assignedToUserId = uniqueUser(assignedToName);
    if (reporterUserId) counts.reporterLinked++;
    else counts.reporterUnlinked++;
    if (assignedToUserId) counts.assigneeLinked++;
    const rawStatus = text(r.status) ?? 'reported';
    let status = rawStatus;
    if (!KNOWN_STATUS.has(rawStatus)) {
      const mapped = LEGACY_STATUS[rawStatus.toLowerCase()];
      if (mapped) {
        status = mapped;
        counts.statusMapped++;
      } else {
        counts.statusUnknownKept++;
      }
    }
    const reportedAtTime = instant(r.reportedAtTime);
    rows.push({
      incidentNumber,
      legacySourceId: id,
      title: text(r.title) ?? '',
      type: text(r.type) ?? '',
      chartCategory: text(r.chartCategory),
      severity: text(r.severity) ?? '',
      status,
      reporterUserId,
      reportedByName,
      assignedToUserId,
      assignedToName,
      clientInitials: text(r.clientInitials),
      reportedDate: ymd(r.reportedAt) ?? (reportedAtTime ? reportedAtTime.toISOString().slice(0, 10) : ''),
      reportedAtTime,
      occurredAt: instant(r.occurredAt),
      dueFollowUp: ymd(r.dueFollowUp),
      closedAt: ymd(r.closedAt),
      location: text(r.location),
      description: text(r.description) ?? '',
      immediateAction: text(r.immediateAction),
      investigationNotes: text(r.investigationNotes),
      correctiveActions: Array.isArray(r.correctiveActions) ? r.correctiveActions.filter((a): a is string => typeof a === 'string' && Boolean(a.trim())) : [],
      rootCause: text(r.rootCause),
      carfCategory: text(r.carfCategory),
      errorExplanation: text(r.errorExplanation),
    });
    counts.toCopy++;
  }
  return { rows, counts };
}
