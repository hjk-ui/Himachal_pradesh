import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadWorklistData } from '@/lib/consents/library/worklist';
import { consentGate, json } from '../library/_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const idsSchema = z.array(z.string().min(1).max(128)).min(1).max(100);

/**
 * GET /api/consents/due?clientIds=a,b — "consents needed before the visit" for the check-in board:
 * per client, the count of required consents that are missing / expired / revoked (and how many
 * expire within 30 days). Titles only, no consent content. Org + caseload scoped; locked sensitive
 * charts left out. Audited READ (counts and ids only).
 */
export async function GET(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const url = new URL(req.url);
  const parsed = idsSchema.safeParse((url.searchParams.get('clientIds') ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  if (!parsed.success) return json({ success: false, error: 'Pass 1-100 client ids' }, 400);
  try {
    const d = await loadWorklistData(g.actor, { clientIds: [...new Set(parsed.data)] });
    const due: Record<string, { needed: number; expiring: number; titles: string[] }> = {};
    for (const r of d.rows) {
      if (!r.required || r.standard === 'complete') continue;
      const e = (due[r.clientId] ??= { needed: 0, expiring: 0, titles: [] });
      if (r.standard === 'expiring') e.expiring += 1;
      else {
        e.needed += 1;
        if (e.titles.length < 5) e.titles.push(r.title);
      }
    }
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'consentsDue', metadata: { clients: parsed.data.length, withGaps: Object.keys(due).length, clientIds: Object.keys(due).slice(0, 50) } });
    return json({ success: true, due });
  } catch (err) {
    console.error('[consents/due GET]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not load consents due' }, 500);
  }
}
