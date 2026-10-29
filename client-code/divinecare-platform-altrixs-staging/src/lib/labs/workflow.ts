/**
 * Lab order workflow stages and worklist / inbox derivations. Pure (browser + server + tests).
 *
 * Stage (what the worklists show) is derived from the stored status plus review / release times:
 *   ordered → collected → sent (status "pending" = at the lab) → resulted (incl. critical)
 *   → reviewed (provider sign-off) → released (patient portal); cancelled at any point.
 * Release requires review first (enforced server-side).
 */

export const LAB_STAGES = ['ordered', 'collected', 'sent', 'resulted', 'reviewed', 'released', 'cancelled'] as const;
export type LabStage = (typeof LAB_STAGES)[number];

export const LAB_STAGE_LABEL: Record<LabStage, string> = {
  ordered: 'Ordered',
  collected: 'Collected',
  sent: 'Sent to lab',
  resulted: 'Resulted — needs review',
  reviewed: 'Reviewed',
  released: 'Released to portal',
  cancelled: 'Cancelled',
};

type StageInput = { status: string; reviewedAt?: string | Date | null; releasedAt?: string | Date | null };

export function labOrderStage(o: StageInput): LabStage {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.releasedAt) return 'released';
  if (o.reviewedAt) return 'reviewed';
  if (o.status === 'resulted' || o.status === 'critical') return 'resulted';
  if (o.status === 'pending') return 'sent';
  if (o.status === 'collected') return 'collected';
  return 'ordered';
}

/** Status transitions staff can make by hand (results set resulted/critical themselves) */
export const MANUAL_STATUS_STEPS: Record<string, string[]> = {
  ordered: ['collected', 'pending', 'cancelled'],
  collected: ['pending', 'cancelled'],
  pending: ['cancelled'],
  resulted: [],
  critical: [],
  cancelled: [],
};

export function canMoveStatus(from: string, to: string): boolean {
  return (MANUAL_STATUS_STEPS[from] ?? []).includes(to);
}

export type ReleaseCheck = { ok: true } | { ok: false; error: string };

/** Portal release order: resulted → reviewed (signed off) → released */
export function releaseCheck(o: StageInput & { resultCount: number }): ReleaseCheck {
  if (o.status === 'cancelled') return { ok: false, error: 'Cancelled orders cannot be released.' };
  if (o.status !== 'resulted' && o.status !== 'critical') return { ok: false, error: 'Only resulted orders can be released to the patient.' };
  if (o.resultCount === 0) return { ok: false, error: 'Enter or attach the results before releasing.' };
  if (!o.reviewedAt) return { ok: false, error: 'A provider must review and sign off the results before they are released to the portal.' };
  if (o.releasedAt) return { ok: false, error: 'These results were already released to the portal.' };
  return { ok: true };
}

export function reviewCheck(o: StageInput & { resultCount: number }): ReleaseCheck {
  if (o.status !== 'resulted' && o.status !== 'critical') return { ok: false, error: 'Results must be entered before review.' };
  if (o.resultCount === 0) return { ok: false, error: 'No results to review.' };
  if (o.reviewedAt) return { ok: false, error: 'Already reviewed.' };
  return { ok: true };
}

// ─── Inbox: lab results to review ────────────────────────────────────────────

export type UnreviewedLabRow = {
  id: string;
  clientId: string;
  clientName: string;
  panels: string[];
  otherPanel: string | null;
  hasCritical: boolean;
  status: string;
  resultedAt: Date | string | null;
  orderedAt: Date | string;
  abnormalCount: number;
};

export type LabInboxDraft = {
  entityKey: string;
  title: string;
  detail: string | null;
  clientId: string;
  clientName: string;
  priority: 'urgent' | 'high' | 'normal';
  since: string | null;
  href: string;
  hrefLabel: string;
  action: null;
};

const isoOf = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Unreviewed results → inbox rows. Critical = urgent, any abnormal = high, else normal. */
export function labResultInboxDrafts(rows: UnreviewedLabRow[]): LabInboxDraft[] {
  return rows.map((r) => {
    const tests = [...r.panels, ...(r.otherPanel ? [r.otherPanel] : [])];
    const critical = r.hasCritical || r.status === 'critical';
    return {
      entityKey: `labOrder:${r.id}`,
      title: critical ? 'CRITICAL lab result to review' : r.abnormalCount ? 'Abnormal lab result to review' : 'Lab result to review',
      detail: tests.length ? tests.slice(0, 4).join(', ') + (tests.length > 4 ? ` +${tests.length - 4}` : '') : null,
      clientId: r.clientId,
      clientName: r.clientName,
      priority: critical ? 'urgent' : r.abnormalCount ? 'high' : 'normal',
      since: isoOf(r.resultedAt) ?? isoOf(r.orderedAt),
      href: `/dashboard/clients/${encodeURIComponent(r.clientId)}?tab=labs`,
      hrefLabel: 'Review in chart',
      action: null,
    };
  });
}
