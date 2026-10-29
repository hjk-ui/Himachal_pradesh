import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { invokeBedrock, isBedrockConfigured, BEDROCK_MODELS } from '@/lib/ai/bedrockService';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canSeeAotClinical, findParticipantInOrg } from '../_scope';

export const runtime = 'nodejs';

const text = z.string().trim().max(4000);

const bodySchema = z.object({
  participantId: z.string().min(1).max(64),
  eval: z.object({
    examDate: text.optional(),
    mode: text.optional(),
    sources: z.array(text).max(40).optional(),
    mse: z.record(z.string(), text).optional(),
    diagnosis: text.optional(),
    capacity: text.optional(),
    plan: z.array(text).max(40).optional(),
    basis: z.record(z.string(), text).optional(),
  }),
});

const BASIS_KEYS = ['smi', 'safety', 'history', 'voluntary', 'benefit'] as const;

/**
 * POST /api/aot/eval-basis — Bedrock draft of the five HG § 10-6A-05 factual-basis
 * paragraphs from the psychiatrist's own exam entries and the participant record.
 * No canned fallback: when Bedrock is unavailable the caller gets an error.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Affidavit factual basis (MSE, diagnosis, non-adherence): EHR clinical roles only
  if (!canSeeAotClinical(gate.role)) {
    return NextResponse.json({ success: false, error: 'Affidavit drafting is limited to the treating clinicians' }, { status: 403 });
  }

  try {
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid evaluation payload' }, { status: 400 });
    }
    const { participantId, eval: ev } = parsed.data;
    const participant = await findParticipantInOrg(participantId, gate.organizationId);
    if (!participant) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }

    if (!isBedrockConfigured()) {
      return NextResponse.json(
        { success: false, error: 'AI drafting is not configured on this server (Bedrock credentials missing). Write the paragraphs manually.' },
        { status: 503 }
      );
    }

    const events = Array.isArray(participant.escalationEvents) ? participant.escalationEvents : [];

    const system = `You draft the factual-basis paragraphs of a Maryland Assisted Outpatient Treatment physician affidavit (Health-General § 10-6A-05) for the examining psychiatrist to edit.
Use ONLY the facts supplied below. Never invent hospitalizations, dates, refusals, violent acts, medications, diagnoses or exam findings.
Where a criterion lacks supporting facts, write "[Psychiatrist to document: ...]" naming exactly what is needed.
Return JSON with string keys: smi, safety, history, voluntary, benefit.`;

    const userPrompt = `Respondent: ${participant.name}
County: ${participant.county}
Referral source: ${participant.referralSource}
Diagnosis on file: ${participant.diagnosis}
Psychiatrist's diagnosis entry: ${ev.diagnosis || 'not entered'}
Exam date: ${ev.examDate || 'not entered'} (${ev.mode || 'mode not entered'})
Sources reviewed: ${ev.sources?.length ? ev.sources.join('; ') : 'not entered'}
Mental status exam: ${ev.mse ? JSON.stringify(ev.mse) : 'not entered'}
Capacity & insight: ${ev.capacity || 'not entered'}
Proposed treatment plan: ${ev.plan?.length ? ev.plan.join('; ') : 'not entered'}
Documented non-adherence events: ${events.length ? JSON.stringify(events) : 'none recorded'}
Paragraphs already written by the psychiatrist (keep their facts): ${ev.basis ? JSON.stringify(ev.basis) : 'none'}`;

    let raw: string;
    try {
      raw = await invokeBedrock({ model: 'SONNET', system, userPrompt, maxTokens: 2500, temperature: 0.1, jsonMode: true });
    } catch (err: unknown) {
      console.error('[aot/eval-basis] Bedrock error:', err instanceof Error ? err.message : 'unknown');
      return NextResponse.json(
        { success: false, error: 'AI draft failed — Bedrock did not respond. Try again or write the paragraphs manually.' },
        { status: 502 }
      );
    }

    let draft: Record<string, unknown>;
    try {
      draft = JSON.parse(raw);
    } catch {
      return NextResponse.json({ success: false, error: 'AI returned an unreadable draft. Try again.' }, { status: 502 });
    }
    const basis = Object.fromEntries(
      BASIS_KEYS.map((k) => [k, typeof draft[k] === 'string' ? (draft[k] as string).trim() : ''])
    );
    if (BASIS_KEYS.every((k) => !basis[k])) {
      return NextResponse.json({ success: false, error: 'AI returned an empty draft' }, { status: 502 });
    }

    await auditPhiAccess({
      gate, req, action: 'AI_ACCESS', resourceType: 'aotEvalBasis', resourceId: participant.id,
      patientId: participant.clientId ?? null, metadata: { model: BEDROCK_MODELS.SONNET, events: events.length },
    });
    return NextResponse.json({ success: true, modelId: BEDROCK_MODELS.SONNET, basis });
  } catch (err: unknown) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Evaluation drafter failed' },
      { status: 500 }
    );
  }
}
