/**
 * Risk language watch: alert shape, dedupe and routing rules. Pure, browser-safe.
 *
 * Routing reuses the existing RiskAlert visibility: an alert carries the assigned clinician
 * (clinicianId) and is listed through clientAccessWhere — caseload roles see their own clients,
 * crisis responders and supervisors see the organization. Every list that carries patient detail
 * (Inbox, the risk-watch banner) also drops / masks clients the viewer may not open (42 CFR Part 2,
 * SensitiveRecord): those show "Protected record" and the chart's break-glass path.
 */
import { CATEGORY_LABEL, CONCEPT_LABEL, type RiskSeverity } from './phrases';
import { SEVERITY_RANK, type RiskHit } from './engine';

export const RISK_WATCH_TYPE = 'risk_language';
export const RISK_WATCH_TYPE_LABEL = 'Risk language';
export const PROTECTED_LABEL = 'Protected record';

export type RiskSourceKind = 'message' | 'note' | 'sdoh';

export const RISK_WATCH_SOURCE: Record<RiskSourceKind, string> = {
  message: 'risk_watch_message',
  note: 'risk_watch_note',
  sdoh: 'risk_watch_sdoh',
};

const SOURCE_LABEL: Record<RiskSourceKind, string> = {
  message: 'patient portal message',
  note: 'progress note',
  sdoh: 'SDOH screening notes',
};

export type RiskSourceRef =
  | { kind: 'message'; threadId: string; messageId: string }
  | { kind: 'note'; noteId: string }
  | { kind: 'sdoh'; screeningId: string };

/** RiskAlert.sourceId. Messages carry the thread so later messages coalesce while unreviewed. */
export function riskSourceId(ref: RiskSourceRef): string {
  if (ref.kind === 'message') return `msg:${ref.threadId}:${ref.messageId}`;
  if (ref.kind === 'note') return `note:${ref.noteId}`;
  return `sdoh:${ref.screeningId}`;
}

export function threadSourcePrefix(threadId: string): string {
  return `msg:${threadId}:`;
}

export const SEVERITY_DB = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' } as const;
export const SEVERITY_UI = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' } as const;

export type ExistingAlert = { id: string; sourceId: string | null; severity: 'HIGH' | 'MEDIUM' | 'LOW'; reviewed: boolean };

export type AlertWritePlan =
  | { kind: 'create' }
  | { kind: 'update'; alertId: string; escalated: boolean }
  | { kind: 'skip'; alertId: string; reason: 'duplicate' | 'coalesced' };

/**
 * One alert per source item:
 * - same source item already alerted at the same or a higher severity → skip (duplicate)
 * - same source item, unreviewed, lower severity → update (escalate)
 * - same source item, reviewed, now higher → new alert (the reviewed one stays as documented)
 * - messages: an unreviewed alert from the same thread absorbs later messages (escalating it when
 *   the new message is more severe) so one distressed conversation is one alert to review
 */
export function planAlertWrite(existing: ExistingAlert[], sourceId: string, severity: RiskSeverity, threadPrefix?: string | null): AlertWritePlan {
  const rank = SEVERITY_RANK[severity];
  const exact = existing.filter((a) => a.sourceId === sourceId);
  const covered = exact.find((a) => SEVERITY_RANK[SEVERITY_UI[a.severity]] >= rank);
  if (covered) return { kind: 'skip', alertId: covered.id, reason: 'duplicate' };
  const openExact = exact.find((a) => !a.reviewed);
  if (openExact) return { kind: 'update', alertId: openExact.id, escalated: true };
  if (threadPrefix) {
    const open = existing.find((a) => !a.reviewed && a.sourceId?.startsWith(threadPrefix));
    if (open) {
      return SEVERITY_RANK[SEVERITY_UI[open.severity]] >= rank
        ? { kind: 'skip', alertId: open.id, reason: 'coalesced' }
        : { kind: 'update', alertId: open.id, escalated: true };
    }
  }
  return { kind: 'create' };
}

/**
 * Alert text. Protected records (Part 2 note or a SensitiveRecord client) never carry the quote:
 * the alerts list is visible to roles that may not open the record. Authorized viewers read the
 * snippet in the banner, which re-checks access.
 */
export function buildAlertDescription(input: { kind: RiskSourceKind; hits: RiskHit[]; protectedRecord: boolean; severity: RiskSeverity }): string {
  const top = [...input.hits].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])[0];
  const concepts = [...new Set(input.hits.map((h) => CONCEPT_LABEL[h.concept]))].slice(0, 3).join('; ');
  const when = input.severity === 'high' ? 'Same-day clinician contact required.' : 'Clinician review required.';
  const head = `Risk language in ${SOURCE_LABEL[input.kind]} — ${concepts || CATEGORY_LABEL[top?.category ?? 'suicide']}.`;
  const quote = !input.protectedRecord && top ? ` "${top.quote}"` : ' Open the record to view the flagged text.';
  return `${head}${quote} ${when} Flagged by keyword screen (decision support).`;
}

export type RecipientUser = { id: string; role: string };

/**
 * Who should act on the alert (used for the audit trail and the banner's "routed to" line).
 * Assigned clinician always; active crisis responders on HIGH; anyone who may not open a
 * protected record is left out (they see it masked in the Inbox and can request break-glass).
 */
export function alertRecipients(input: {
  severity: RiskSeverity;
  assignedClinicianId: string | null;
  crisisResponders: RecipientUser[];
  lockedUserIds: Set<string>;
}): { userIds: string[]; assigned: boolean; crisisResponders: number; withheldProtected: number } {
  const ids: string[] = [];
  let withheld = 0;
  const add = (id: string) => {
    if (input.lockedUserIds.has(id)) {
      withheld += 1;
      return;
    }
    if (!ids.includes(id)) ids.push(id);
  };
  if (input.assignedClinicianId) add(input.assignedClinicianId);
  let crisis = 0;
  if (input.severity === 'high') {
    for (const u of input.crisisResponders) {
      const before = ids.length;
      add(u.id);
      if (ids.length > before) crisis += 1;
    }
  }
  return { userIds: ids, assigned: Boolean(input.assignedClinicianId && ids.includes(input.assignedClinicianId)), crisisResponders: crisis, withheldProtected: withheld };
}

/** Banner links */
export function riskWatchLinks(clientId: string) {
  const id = encodeURIComponent(clientId);
  return {
    chart: `/dashboard/clients/${id}`,
    chartSafety: `/dashboard/clients/${id}?tab=safety`,
    safetyPlan: '/dashboard/ehr/safety-plan',
    message: `/dashboard/communications?clientId=${id}`,
    alerts: '/dashboard/alerts?tab=risk',
    breakGlass: `/dashboard/clients/${id}`,
  };
}
