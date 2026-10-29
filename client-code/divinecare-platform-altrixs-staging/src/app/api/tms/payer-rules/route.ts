import { NextResponse } from 'next/server';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { tmsError, tmsGate } from '@/lib/tms/http';
import { MAX_MATCH_TERMS, loadPayerRules, savePayerRule } from '@/lib/tms/workflowDb';
import { TMS_PRESCRIBER_RULE_VALUES } from '@/lib/tms/workflow';

export const runtime = 'nodejs';

const schema = z.object({
  payerKey: z.string().trim().max(60).nullish(),
  payerLabel: z.string().trim().min(2).max(120),
  matchTerms: z.array(z.string().trim().max(60)).max(MAX_MATCH_TERMS),
  payerTypes: z.array(z.string().trim().max(40)).max(6),
  rule: z.enum(TMS_PRESCRIBER_RULE_VALUES as [string, ...string[]]),
  note: z.string().max(500).nullish(),
  active: z.boolean().optional(),
  /** Payer minimum failed antidepressant trials (from the plan's policy); null = not set */
  minFailedTrials: z.number().int().min(1).max(20).nullish(),
});

/** GET — the practice's TMS payer prescriber rules (the owner's list is seeded once per org). No PHI. */
export async function GET() {
  const g = await tmsGate('rules');
  if (g.ok === false) return g.res;
  try {
    return NextResponse.json({ success: true, rules: await loadPayerRules(g.actor.organizationId) });
  } catch (err) {
    return tmsError(err, 'Could not load TMS payer rules');
  }
}

/** PUT — add or edit one rule (TMS write roles or Authorizations roles). */
export async function PUT(req: Request) {
  const g = await tmsGate('rules');
  if (g.ok === false) return g.res;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  try {
    const row = await savePayerRule(g.actor, parsed.data as Parameters<typeof savePayerRule>[1]);
    await writeAuditLog({
      action: 'TMS_PAYER_RULE_SAVED',
      actorUserId: g.actor.userId,
      actorRole: g.actor.role,
      organizationId: g.actor.organizationId,
      resourceType: 'tmsPayerRule',
      resourceId: row.id,
      metadata: { payerKey: row.payerKey, rule: row.rule, active: row.active, minFailedTrials: row.minFailedTrials },
    }).catch(() => {});
    return NextResponse.json({ success: true, rules: await loadPayerRules(g.actor.organizationId) });
  } catch (err) {
    return tmsError(err, 'Could not save the TMS payer rule');
  }
}
