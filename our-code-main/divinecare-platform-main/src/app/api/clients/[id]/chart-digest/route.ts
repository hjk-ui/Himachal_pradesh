import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { loadDigestAccess, type DigestAction } from '@/lib/chart-digest/access';
import { generateChartDigest, isDigestEmpty, loadStoredDigest, viewDigestForRole } from '@/lib/chart-digest/build';
import {
  CHART_DIGEST_DISCLAIMER,
  CHART_DIGEST_EMPTY,
  DIGEST_DENIAL_MESSAGES,
  DIGEST_DENIAL_STATUS,
} from '@/lib/chart-digest/copy';
import { parseDigestKind, type ChartDigestKind } from '@/lib/chart-digest/kinds';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

const paramsSchema = z.object({ id: z.string().min(1).max(128) });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

async function authorize(req: Request, ctx: Ctx, action: DigestAction) {
  const gate = await requireOrgContext();
  if (gate.ok === false) return { ok: false as const, response: json({ success: false, error: gate.error }, gate.status) };

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) {
    return { ok: false as const, response: json({ success: false, error: 'Invalid client id' }, 400) };
  }

  const kind = parseDigestKind(new URL(req.url).searchParams.get('kind'));
  if (!kind) {
    return { ok: false as const, response: json({ success: false, error: 'kind must be bh or medical' }, 400) };
  }

  const access = await loadDigestAccess(
    { userId: gate.userId, role: gate.role, organizationId: gate.organizationId },
    parsed.data.id,
    kind,
    action
  );
  if (access.ok === false) {
    if (access.code === 'not_found') {
      return { ok: false as const, response: json({ success: false, error: 'Client not found' }, 404) };
    }
    return {
      ok: false as const,
      response: json(
        { success: false, code: access.code, error: DIGEST_DENIAL_MESSAGES[access.code] },
        DIGEST_DENIAL_STATUS[access.code]
      ),
    };
  }
  return {
    ok: true as const,
    gate,
    clientId: parsed.data.id,
    kind,
    canRegenerate: access.canRegenerate,
  };
}

function payload(
  kind: ChartDigestKind,
  role: string,
  stored: Awaited<ReturnType<typeof loadStoredDigest>>,
  canRegenerate: boolean
) {
  const digest = stored
    ? {
        kind,
        status: stored.status,
        generatedAt: stored.generatedAt,
        content: viewDigestForRole(stored.content, kind, role),
      }
    : null;
  return {
    success: true,
    kind,
    digest,
    empty: !digest || isDigestEmpty(digest.content),
    emptyMessage: CHART_DIGEST_EMPTY,
    disclaimer: CHART_DIGEST_DISCLAIMER,
    canRegenerate,
  };
}

/** GET /api/clients/[id]/chart-digest?kind=bh|medical — the stored digest (never generates). */
export async function GET(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx, 'view');
  if (a.ok === false) return a.response;

  const stored = await loadStoredDigest(a.gate.organizationId, a.clientId, a.kind);
  return json(payload(a.kind, a.gate.role, stored, a.canRegenerate));
}

/** POST /api/clients/[id]/chart-digest?kind=bh|medical — generate or regenerate. */
export async function POST(req: Request, ctx: Ctx) {
  const a = await authorize(req, ctx, 'generate');
  if (a.ok === false) return a.response;

  const result = await generateChartDigest({
    organizationId: a.gate.organizationId,
    clientId: a.clientId,
    kind: a.kind,
    generatedById: a.gate.userId,
  });
  if (result.ok === false) return json({ success: false, error: result.error }, result.status);
  return json(payload(a.kind, a.gate.role, result.digest, true));
}
