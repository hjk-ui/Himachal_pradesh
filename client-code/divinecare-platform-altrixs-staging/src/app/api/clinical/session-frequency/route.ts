import { NextResponse } from 'next/server';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canAccessClientRoster } from '@/lib/clients/orgScope';
import { loadSessionFrequency } from '@/lib/clinical/sessionFrequencyData';
import {
  ALERT_BUCKETS,
  redactLockedItem,
  SESSION_FREQUENCY_RULES,
  summarizeByClinician,
  type AlertBucket,
} from '@/lib/clinical/sessionFrequency';

export const runtime = 'nodejs';

const BUCKETS: AlertBucket[] = ALERT_BUCKETS;
const MAX_CLIENT_IDS = 200;

/**
 * Session frequency alert: recommended vs actual individual-therapy cadence per active client.
 *
 * GET ?clientId=      one chart, full detail (incl. what was not counted)
 * GET ?clientIds=a,b  those clients only (directory chips)
 * GET ?locationId=    one clinic
 * GET ?view=summary   counts (+ byClinician) for the whole scope, with items only for
 *                     ?buckets= (default overdue,due_soon,unassigned; empty for counts only)
 * No view: every item (unchanged response).
 *
 * Caseload roles only get their own clients. `summary` is always computed from the full item
 * set for the scope, so the banner count matches the list for that bucket.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId') || undefined;
  const locationId = url.searchParams.get('locationId') || undefined;
  const clientIdsParam = url.searchParams.get('clientIds');
  const clientIds = clientIdsParam
    ? [...new Set(clientIdsParam.split(',').map((s) => s.trim()).filter(Boolean))].slice(0, MAX_CLIENT_IDS)
    : undefined;
  const summaryView = url.searchParams.get('view') === 'summary';
  const bucketsParam = url.searchParams.get('buckets');
  const buckets: AlertBucket[] =
    bucketsParam == null
      ? ['overdue', 'due_soon', 'unassigned']
      : (bucketsParam.split(',').filter((b) => (BUCKETS as string[]).includes(b)) as AlertBucket[]);

  if (!canAccessClientRoster(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'sessionFrequency', patientId: clientId ?? null, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  if (clientIdsParam != null && !clientIds?.length) {
    return NextResponse.json({ success: true, items: [], summary: null, rules: SESSION_FREQUENCY_RULES });
  }

  try {
    const { items, summary } = await loadSessionFrequency(
      { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role },
      { clientId, locationId, clientIds }
    );
    const returned = summaryView ? items.filter((i) => buckets.includes(i.bucket)) : items;
    await auditPhiAccess({
      gate,
      req,
      action: clientId ? 'READ' : 'LIST',
      resourceType: 'sessionFrequency',
      resourceId: clientId ?? null,
      patientId: clientId ?? null,
      metadata: {
        count: returned.length,
        inScope: items.length,
        overdue: summary.overdue,
        locationId: locationId ?? null,
        view: summaryView ? 'summary' : clientIds ? 'clientIds' : clientId ? 'client' : 'all',
      },
    });
    return NextResponse.json({
      success: true,
      items: returned.map(redactLockedItem),
      summary,
      ...(summaryView ? { byClinician: summarizeByClinician(items), buckets } : {}),
      rules: SESSION_FREQUENCY_RULES,
    });
  } catch (err) {
    console.error('[api/clinical/session-frequency GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load session frequency' }, { status: 500 });
  }
}
