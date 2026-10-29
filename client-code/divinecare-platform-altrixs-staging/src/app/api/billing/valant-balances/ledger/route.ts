import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireValantBalancesGate } from '@/lib/billing/valantGate';
import {
  LedgerPostingError,
  PREPAYMENT_EXCLUSION_LABEL,
  REPLACE_WARNING,
  REPLACE_WARNING_PREPAYMENT,
  canPostValantLedger,
  postOpeningBalances,
  postPrepaymentCredits,
  previewOpeningBalances,
  previewPrepaymentCredits,
  unpostValant,
  valantPostingStatus,
} from '@/lib/billing/patientLedger';

export const runtime = 'nodejs';

/**
 * GET  /api/billing/valant-balances/ledger — what is posted to the Altrixs ledger from Valant
 * POST /api/billing/valant-balances/ledger — { action: 'preview' | 'post' | 'unpost', kind, expected }
 *
 * Posts Valant patient opening balances (current Patient Aging snapshot) and prepayment credits.
 * Insurance A/R is never posted (Valant run-out). Re-posting replaces; unpost supersedes; nothing is deleted.
 * Preview: billing roles + leadership. Post / unpost: billing, leadership and office manager (canPostValantLedger). Audited with
 * ids, counts and totals only.
 */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const status = await valantPostingStatus(gate.organizationId);
    await auditPhiAccess({
      gate, req, action: 'READ', resourceType: 'patientLedgerEntry',
      metadata: { view: 'valant_posting_status', opening: status.kinds.opening_balance.active, prepayment: status.kinds.prepayment_credit.active },
    });
    return NextResponse.json({ success: true, canPost: canPostValantLedger(gate.role), ...status });
  } catch (err) {
    console.error('[valant-balances ledger GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load the ledger posting status' }, { status: 500 });
  }
}

const kindSchema = z.enum(['opening_balance', 'prepayment_credit']);
const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), kind: kindSchema }),
  z.object({
    action: z.literal('post'),
    kind: kindSchema,
    confirm: z.literal(true),
    expected: z.object({ asOf: z.string().nullable(), count: z.number().int().min(0), totalCents: z.number().int() }),
  }),
  z.object({ action: z.literal('unpost'), kind: kindSchema.optional(), confirm: z.literal(true) }),
]);

async function names(organizationId: string, ids: string[]) {
  if (!ids.length) return new Map<string, { name: string; mrn: string | null }>();
  const rows = await prisma.client.findMany({ where: { id: { in: ids }, AND: [clientOrgFilter(organizationId)] }, select: { id: true, name: true, mrn: true } });
  return new Map(rows.map((r) => [r.id, { name: r.name, mrn: r.mrn }]));
}

export async function POST(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
  }
  const orgId = gate.organizationId;

  if (body.action !== 'preview' && !canPostValantLedger(gate.role)) {
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'patientLedgerEntry', outcome: 'DENIED',
      metadata: { op: `valant_${body.action}`, kind: body.kind ?? 'all', reason: 'role' },
    });
    return NextResponse.json({ success: false, error: 'Only billing and practice leadership can post to the ledger' }, { status: 403 });
  }

  try {
    if (body.action === 'preview') {
      const plan = body.kind === 'opening_balance' ? await previewOpeningBalances(orgId) : await previewPrepaymentCredits(orgId);
      if (!plan) {
        return NextResponse.json({ success: true, preview: null, note: body.kind === 'opening_balance' ? 'No Patient Aging snapshot imported' : 'No Prepayments report imported' });
      }
      const ids = [
        ...plan.diffs.map((d) => d.clientId),
        ...('excluded' in plan ? plan.excluded.map((e) => e.clientId).filter((x): x is string => Boolean(x)) : []),
      ];
      const nm = await names(orgId, [...new Set(ids)]);
      const who = (id: string | null) => (id ? { clientId: id, clientName: nm.get(id)?.name ?? null, mrn: nm.get(id)?.mrn ?? null } : { clientId: null, clientName: null, mrn: null });
      const common = {
        kind: plan.kind,
        asOf: plan.asOf,
        counts: plan.counts,
        totals: plan.totals,
        diffs: plan.diffs.map((d) => ({ ...who(d.clientId), beforeCents: d.beforeCents, afterCents: d.afterCents })),
        expected: { asOf: plan.asOf, count: plan.counts.post, totalCents: plan.totals.postCents },
      };
      const preview =
        'unmatched' in plan
          ? {
              ...common,
              warning: REPLACE_WARNING,
              reconciliation: plan.reconciliation,
              reportTotalCents: plan.reportTotalCents,
              importReconciles: plan.importReconciles,
              unmatched: plan.unmatched,
              zeroCount: plan.zero.length,
            }
          : {
              ...common,
              warning: REPLACE_WARNING_PREPAYMENT,
              periodStart: plan.periodStart,
              periodEnd: plan.periodEnd,
              reconciliation: plan.reconciliation,
              excluded: plan.excluded.map((e) => ({ ...who(e.clientId), valantName: e.valantName, netCents: e.netCents, reason: e.reason, reasonText: PREPAYMENT_EXCLUSION_LABEL[e.reason] })),
            };
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'patientLedgerEntry',
        metadata: {
          op: 'valant_preview', kind: plan.kind, asOf: plan.asOf, post: plan.counts.post, replace: plan.counts.replace,
          removed: plan.counts.removed, excluded: plan.counts.excluded, totalCents: plan.totals.postCents,
        },
      });
      return NextResponse.json({ success: true, preview });
    }

    if (body.action === 'post') {
      const expected = { asOf: body.expected.asOf ?? null, count: body.expected.count, totalCents: body.expected.totalCents };
      const result = body.kind === 'opening_balance'
        ? await postOpeningBalances(orgId, gate.userId, expected)
        : await postPrepaymentCredits(orgId, gate.userId, expected);
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'patientLedgerEntry', resourceId: result.batchId,
        metadata: {
          op: 'valant_post', kind: result.kind, asOf: result.asOf, batchId: result.batchId, posted: result.posted,
          superseded: result.superseded, replaced: result.replaced, removed: result.removed,
          totalCents: result.totalCents, previousActiveCents: result.previousActiveCents,
        },
      });
      return NextResponse.json({ success: true, result });
    }

    const result = await unpostValant(orgId, gate.userId, body.kind);
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'patientLedgerEntry',
      metadata: {
        op: 'valant_unpost', kind: body.kind ?? 'all', superseded: result.superseded,
        openingCount: result.byKind.opening_balance.count, openingCents: result.byKind.opening_balance.totalCents,
        prepaymentCount: result.byKind.prepayment_credit.count, prepaymentCents: result.byKind.prepayment_credit.totalCents,
      },
    });
    return NextResponse.json({ success: true, result });
  } catch (err) {
    if (err instanceof LedgerPostingError) return NextResponse.json({ success: false, error: err.message }, { status: err.status });
    const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
    if (code === 'P2002') return NextResponse.json({ success: false, error: 'Another posting ran at the same time. Preview again.' }, { status: 409 });
    if (code === 'P2021') return NextResponse.json({ success: false, error: 'The patient ledger table is not on this database yet (apply 20261017_patient_ledger_entries.sql)' }, { status: 503 });
    console.error('[valant-balances ledger POST]', err);
    return NextResponse.json({ success: false, error: 'Could not complete the ledger posting' }, { status: 500 });
  }
}
