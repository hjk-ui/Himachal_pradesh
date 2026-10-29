/**
 * Note quality check orchestration: deterministic rules first, then (optionally) the AI narrative
 * checks with grounding, falling back to rule heuristics whenever AI is skipped or fails.
 * No Prisma and no Bedrock import: the route injects the model call and the audit writer, so the
 * flow (consent / Part 2 gate, audit before PHI leaves, fallback) is testable.
 *
 * Never edits the note. The result is a checklist of suggestions for the supervisor or author.
 */
import { runRuleChecks, type NoteQualityFacts } from './rules';
import {
  NARRATIVE_SYSTEM_PROMPT,
  buildNarrativeUserPrompt,
  mergeNarrative,
  narrativeText,
  parseNarrativeOutput,
  ruleNarrativeItems,
} from './narrative';
import { countStatuses, type AiStatus, type QualityReport, type QualityReviewView } from './types';

/** Why AI may or may not see this note (decided by the caller from consent, Part 2, settings). */
export type AiGate = { allowed: true } | { allowed: false; reason: string; code: string };

export type QualityDeps = {
  /** null when Bedrock is not configured on this server */
  invokeModel: ((args: { system: string; userPrompt: string }) => Promise<string>) | null;
  modelId: string;
  /** Writes an AI_ACCESS audit row (ids / counts only, never note text) */
  auditAi: (entry: { outcome: 'SUCCESS' | 'DENIED' | 'FAILURE'; metadata: Record<string, unknown> }) => Promise<void>;
};

/**
 * AI gate from the patient's AI consent, Part 2 and the practice setting:
 *  - Part 2 (SUD) notes never go to the model (no redisclosure without written consent).
 *  - A declined AI consent always blocks; a missing one blocks when the practice requires consent.
 */
export function decideAiGate(input: {
  part2: boolean;
  consent: 'signed' | 'missing' | 'declined';
  practiceRequiresConsent: boolean;
}): AiGate {
  if (input.part2) return { allowed: false, code: 'part2', reason: '42 CFR Part 2 note: AI narrative checks are not run on SUD records' };
  if (input.consent === 'declined') return { allowed: false, code: 'consent_declined', reason: 'the client declined AI use in their notes' };
  if (input.consent === 'missing' && input.practiceRequiresConsent) {
    return { allowed: false, code: 'consent_missing', reason: 'no AI consent on file and the practice requires it' };
  }
  return { allowed: true };
}

export async function runNoteQualityCheck(
  input: {
    facts: NoteQualityFacts;
    names: { client: string | null; author: string | null };
    /** Caller asked for AI narrative checks */
    wantAi: boolean;
    aiGate: AiGate;
    lastReview: QualityReviewView | null;
  },
  deps: QualityDeps
): Promise<QualityReport> {
  const { facts } = input;
  const rules = runRuleChecks(facts);
  const fallback = (reason: string) => ruleNarrativeItems({ noteType: facts.note.noteType, body: facts.note.body, reason });

  let ai: AiStatus;
  let narrative = fallback('AI not requested');

  if (!input.wantAi) {
    ai = { state: 'skipped', reason: 'AI checks not requested' };
  } else if (input.aiGate.allowed === false) {
    const gate = input.aiGate as { allowed: false; reason: string; code: string };
    ai = { state: 'skipped', reason: gate.reason };
    narrative = fallback('AI skipped');
    await deps.auditAi({ outcome: 'DENIED', metadata: { feature: 'note-quality-check', reason: gate.code, mode: facts.mode } });
  } else if (!deps.invokeModel) {
    ai = { state: 'unavailable', reason: 'AWS Bedrock is not configured on this server' };
    narrative = fallback('AI unavailable');
  } else {
    const sent = narrativeText({ noteType: facts.note.noteType, body: facts.note.body, clientName: input.names.client, authorName: input.names.author });
    if (!sent.text.trim()) {
      ai = { state: 'skipped', reason: 'the note has no narrative text to review' };
      narrative = fallback('no narrative text');
    } else {
      // PHI (de-identified narrative text) is about to go to the model under the AWS BAA: audit first.
      await deps.auditAi({
        outcome: 'SUCCESS',
        metadata: { feature: 'note-quality-check', model: deps.modelId, mode: facts.mode, sectionCount: sent.sectionTitles.length, chars: sent.text.length },
      });
      try {
        const output = await deps.invokeModel({ system: NARRATIVE_SYSTEM_PROMPT, userPrompt: buildNarrativeUserPrompt(sent.text) });
        const parsed = parseNarrativeOutput(output, sent.text);
        if (!parsed) {
          ai = { state: 'unavailable', reason: 'the AI reply could not be read' };
          narrative = fallback('AI reply unreadable');
        } else {
          ai = { state: 'used', model: deps.modelId };
          narrative = mergeNarrative(parsed.findings, fallback('AI gave no verifiable quote'));
        }
      } catch {
        ai = { state: 'unavailable', reason: 'the AI service did not respond' };
        narrative = fallback('AI unavailable');
        await deps.auditAi({ outcome: 'FAILURE', metadata: { feature: 'note-quality-check', model: deps.modelId, mode: facts.mode } });
      }
    }
  }

  const items = [...rules, ...narrative];
  return {
    noteId: facts.note.id,
    mode: facts.mode,
    checkedAt: facts.now,
    items,
    counts: countStatuses(items),
    ai,
    lastReview: input.lastReview,
  };
}
