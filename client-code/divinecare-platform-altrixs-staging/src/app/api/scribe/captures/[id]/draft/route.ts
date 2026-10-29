import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { loadIcd10CodeSet } from '@/lib/icd10/codeSet';
import { SCRIBE_FORMATS } from '@/lib/scribe/settings';
import { aiConsentFor, findCapture, loadLines, loadPreferences, practiceAiConsentRequired } from '@/lib/scribe/store';
import { loadScribeContext } from '@/lib/scribe/context';
import { capturedMinutes, speakerLabelsInferred } from '@/lib/scribe/diarization';
import { clinicianNarrates, scanTranscriptRisk } from '@/lib/scribe/risk';
import { persistableFindings } from '@/lib/scribe/riskGate';
import { formatSpec } from '@/lib/scribe/templateFields';
import { sessionClockFromCapture } from '@/lib/scribe/sessionClock';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { DEFAULT_PRACTICE_TIME_ZONE } from '@/lib/time/practiceTime';
import { drugNamesIn } from '@/lib/scribe/medications';
import { drugNameSensitive, entailmentCandidates, runEntailment } from '@/lib/scribe/entailment';
import { sourceMap } from '@/lib/scribe/grounding';
import {
  CODING_DISCLAIMER,
  interactiveComplexityEvidence,
  suggestCptForSession,
  suggestIcd10,
  suggestPos,
} from '@/lib/scribe/coding';
import {
  DRAFT_LABEL,
  PART2_NOTICE,
  PROMPT_VERSION,
  buildDraftSystemPrompt,
  buildDraftUserPrompt,
  buildSources,
  draftGroupsFor,
  splitGroup,
  type DraftGroup,
  groundDraft,
  looksTruncated,
  mergeRawDrafts,
  parseDraftReply,
  transcriptQualityWarning,
  type RawDraft,
} from '@/lib/scribe/draft';
import { FORMAT_CODING } from '@/lib/scribe/formatCatalog';
import { draftSessionLabel } from '@/lib/scribe/paste';
import { draftLanguageInstruction, normalizeScribeLanguage } from '@/lib/scribe/language';
import { jsonError, scribeGate } from '../../../_lib/gate';

export const runtime = 'nodejs';
export const maxDuration = 180;

const bodySchema = z.object({
  format: z.enum(SCRIBE_FORMATS).optional(),
  /** Documented face-to-face minutes, when the clinician entered them (else the capture clock) */
  minutes: z.number().int().min(1).max(600).optional(),
  sessionType: z.enum(['individual', 'family-with-patient', 'family-without-patient']).optional(),
  /** The clinician confirmed inferred speaker labels (one microphone / third speaker) */
  speakersConfirmed: z.boolean().optional(),
});

/** Long sessions: a cut-off reply is retried once by drafting the section groups in separate calls. */
const LONG_SESSION_LINES = 120;
const LONG_SESSION_CHARS = 20_000;

/**
 * POST /api/scribe/captures/[id]/draft — grounded AI draft from this capture's transcript.
 * Not configured → 503 with nothing generated (no canned text). Declined AI consent → 403; missing
 * consent → 403 when the practice requires it (same rule as section-draft). Inferred speaker labels
 * must be confirmed first (409 SPEAKERS_UNCONFIRMED). Every AI_ACCESS audit row is written before
 * PHI goes to Bedrock (the draft call, the section-group retry, the entailment pass).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await scribeGate({ entitlement: true });
  if (g.ok === false) return g.response;
  const { actor, gate } = g;
  const { id } = await ctx.params;
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json().catch(() => ({})));
  } catch {
    return jsonError(400, 'Invalid request');
  }
  const cap = await findCapture(actor, id);
  if (!cap) return jsonError(404, 'Capture not found');
  if (cap.consentWithdrawnAt || cap.transcriptPurgedAt) return jsonError(409, 'This capture has no transcript (consent withdrawn or purged).');
  const format = body.format ?? (cap.noteFormat as (typeof SCRIBE_FORMATS)[number] | null) ?? 'THERAPY_PROGRESS';
  const base = { feature: 'scribe-draft', format, mode: cap.mode, source: cap.source, language: cap.language };
  const audit = (outcome: 'SUCCESS' | 'FAILURE' | 'DENIED', metadata: Record<string, unknown>) =>
    auditPhiAccess({ gate, req, action: 'AI_ACCESS', resourceType: 'scribeDraft', resourceId: cap.id, patientId: cap.clientId, outcome, metadata: { ...base, ...metadata } });

  const [consent, consentRequired] = await Promise.all([aiConsentFor(actor.organizationId, cap.clientId), practiceAiConsentRequired(actor.organizationId)]);
  if (consent === 'declined') {
    await audit('DENIED', { reason: 'ai_consent_declined' });
    return jsonError(403, 'This client declined AI use. Nothing was sent to the AI model; write the note yourself.', { code: 'CONSENT_DECLINED' });
  }
  if (consent === 'missing' && consentRequired) {
    await audit('DENIED', { reason: 'ai_consent_missing' });
    return jsonError(403, "No AI consent is on file for this client and the practice requires it. Record the client's AI Note Drafting consent first.", { code: 'CONSENT_MISSING' });
  }
  const { lines, labels } = await loadLines(cap);
  if (lines.length < 2 || lines.reduce((t, l) => t + l.text.length, 0) < 40) {
    return jsonError(422, 'There is not enough transcript to draft from. Nothing was sent to the AI.');
  }
  // Speaker labels are a guess (one microphone, unlabeled paste, a third speaker): the clinician confirms them first
  if (speakerLabelsInferred(labels) && !cap.speakersConfirmedAt) {
    if (!body.speakersConfirmed) {
      return jsonError(409, 'Speaker labels are a guess — confirm who is the clinician, the client and anyone else before drafting.', { code: 'SPEAKERS_UNCONFIRMED' });
    }
    await prisma.scribeCapture.update({ where: { id: cap.id }, data: { speakersConfirmedAt: new Date(), speakersConfirmedById: actor.userId } });
    await auditPhiAccess({ gate, req, action: 'SCRIBE_SPEAKERS_CONFIRMED', resourceType: 'scribeCapture', resourceId: cap.id, patientId: cap.clientId, metadata: { speakers: labels.length } });
  }
  if (!isBedrockConfigured()) {
    return jsonError(503, 'AI drafting is not configured on this server (AWS Bedrock). Nothing was generated; write the note yourself.', { provider: 'bedrock-unconfigured' });
  }

  const [context, prefs, settings, telehealth, client, tz] = await Promise.all([
    loadScribeContext({ organizationId: actor.organizationId, userId: actor.userId, role: actor.role, clientId: cap.clientId }),
    loadPreferences(actor.organizationId, actor.userId),
    prisma.practiceSettings
      .findUnique({ where: { organizationId: actor.organizationId }, select: { posOffice: true, posTelehealthHome: true, posTelehealthOther: true, telehealthModifierDefault: true } })
      .catch(() => null),
    cap.telehealthSessionId ? prisma.telehealthSession.findUnique({ where: { id: cap.telehealthSessionId }, select: { patientLocationType: true } }) : null,
    prisma.client.findFirst({ where: { id: cap.clientId, organizationId: actor.organizationId }, select: { name: true, dateOfBirth: true } }).catch(() => null),
    getPracticeTimeZone(actor.organizationId).catch(() => DEFAULT_PRACTICE_TIME_ZONE),
  ]);
  const spec = formatSpec(format);
  const { sources, text } = buildSources(lines, context);
  const language = normalizeScribeLanguage(cap.language);
  const system = (g: DraftGroup) =>
    [buildDraftSystemPrompt(spec, prefs, { only: g.only ?? undefined, extras: g.extras }), draftLanguageInstruction(language)].filter(Boolean).join('\n');
  const userPrompt = buildDraftUserPrompt({ spec, sessionLabel: draftSessionLabel(cap.mode, cap.engine, cap.source, cap.language), sourcesText: text });

  await audit('SUCCESS', { model: BEDROCK_MODELS.SONNET, lines: lines.length, chartFacts: sources.length - lines.length, consent, part2: cap.part2, promptVersion: PROMPT_VERSION });
  const call = (g: DraftGroup) => invokeBedrock({ model: 'SONNET', system: system(g), userPrompt, maxTokens: 6000, temperature: 0, jsonMode: true });
  /** One group: a cut-off or unreadable reply is retried once as two halves (every section still drafted). */
  const draftGroup = async (g: DraftGroup, retry: boolean): Promise<{ parts: RawDraft[]; error: boolean; retried: boolean }> => {
    let reply: string;
    try {
      reply = await call(g);
    } catch {
      return { parts: [], error: true, retried: false };
    }
    const parsed = parseDraftReply(reply);
    if (parsed && !looksTruncated(reply)) return { parts: [parsed], error: false, retried: false };
    const halves = splitGroup(g);
    if (!retry || halves.length < 2) return { parts: parsed ? [parsed] : [], error: false, retried: false };
    const sub = await Promise.all(halves.map((h) => draftGroup(h, false)));
    const parts = sub.flatMap((x) => x.parts);
    return { parts: parts.length ? parts : parsed ? [parsed] : [], error: sub.every((x) => x.error), retried: true };
  };
  // Intake / evaluation formats (many sections): always drafted by section groups, so a long intake
  // drafts every section fully; other formats: one call, split in two when a long session's reply was cut off
  const long = lines.length >= LONG_SESSION_LINES || text.length >= LONG_SESSION_CHARS;
  let groups = draftGroupsFor(spec);
  let raw: RawDraft | null = null;
  let retried = false;
  if (groups.length > 1) await audit('SUCCESS', { step: 'section_groups', model: BEDROCK_MODELS.SONNET, groups: groups.length });
  let results = await Promise.all(groups.map((g) => draftGroup(g, groups.length > 1 || long)));
  if (results.every((x) => x.error)) {
    await audit('FAILURE', { reason: 'model_error' });
    return jsonError(503, 'AI drafting is unavailable right now. Nothing was generated; write the note yourself or try again.', { provider: 'bedrock-error' });
  }
  retried = results.some((x) => x.retried);
  if (groups.length === 1 && !results[0].parts.length && spec.kind !== 'plan') {
    // Single call cut off / unreadable: retry once, drafting the section groups in separate calls
    retried = true;
    groups = draftGroupsFor(spec, { split: true });
    await audit('SUCCESS', { step: 'section_group_retry', model: BEDROCK_MODELS.SONNET, groups: groups.length });
    results = await Promise.all(groups.map((g) => draftGroup(g, false)));
  }
  raw = mergeRawDrafts(results.flatMap((x) => x.parts));
  if (!raw) {
    await audit('FAILURE', { reason: 'unreadable_reply', retried });
    return jsonError(502, 'The AI reply could not be read. Nothing was generated; try again or write the note yourself.');
  }
  const groundInput = {
    format,
    sources,
    chart: context,
    minor: context.minor,
    telehealth: cap.mode === 'telehealth',
    clientNames: client?.name ? [client.name] : [],
  };
  let grounded = groundDraft(raw, groundInput);

  // Entailment pass (Haiku): weak / negated / risk / MSE / medication sentences; all of them for Spanish / interpreted sessions
  const participants = Array.isArray(cap.consentParticipants) ? (cap.consentParticipants as { role?: string }[]) : [];
  const crossLanguage = language !== 'en-US' || participants.some((p) => p.role === 'INTERPRETER') || lines.some((l) => l.role === 'INTERPRETER');
  const meds = context.medications ?? [];
  const candidates = entailmentCandidates(grounded.preliminary, { crossLanguage, sensitive: (it) => drugNameSensitive(it.heading, drugNamesIn(it.text, meds).length) });
  let entailment = { calls: 0, checked: 0, skipped: candidates.length, failed: false };
  if (candidates.length) {
    await audit('SUCCESS', { step: 'entailment', model: BEDROCK_MODELS.HAIKU, claims: candidates.length, crossLanguage });
    const run = await runEntailment(candidates, sourceMap(sources), ({ system: sys, userPrompt: up }) =>
      invokeBedrock({ model: 'HAIKU', system: sys, userPrompt: up, maxTokens: 1500, temperature: 0, jsonMode: true, guard: 'clinical' })
    );
    entailment = { calls: run.calls, checked: run.checked, skipped: run.skipped, failed: run.failed };
    if (run.failed) await audit('FAILURE', { step: 'entailment', reason: 'model_error' });
    if (run.verdicts.size) grounded = groundDraft(raw, { ...groundInput, verdicts: run.verdicts });
  }

  const clock = sessionClockFromCapture({ startedAt: cap.startedAt, stoppedAt: cap.stoppedAt, pausedAt: cap.pausedAt, pausedSeconds: cap.pausedSeconds }, tz);
  const minutes = body.minutes ?? (clock && clock.minutes > 0 ? clock.minutes : null) ?? capturedMinutes(lines);
  let index = null;
  try {
    index = loadIcd10CodeSet().index;
  } catch {
    index = null;
  }
  const icEvidence = interactiveComplexityEvidence(lines, { interpreterPresent: participants.some((p) => p.role === 'INTERPRETER') });
  const prescriber = FORMAT_CODING[format] === 'em';
  const coding = {
    minutes,
    minutesSource: body.minutes ? 'clinician' : clock ? 'capture clock' : 'capture span',
    sessionClock: clock,
    prescriber,
    cpt: suggestCptForSession({ format, minutes, sessionType: body.sessionType }),
    interactiveComplexity: {
      suggested: icEvidence.length > 0 && spec.kind !== 'plan',
      evidence: icEvidence,
      rule: '90785 only when a listed interactive-complexity factor is documented, from what a participant (not the clinician) said or an interpreter confirmed on the consent; add-on to 90791 / 90832-90837 / 90853 (and E/M + psychotherapy add-on).',
    },
    pos: suggestPos({
      mode: cap.mode as 'in_person' | 'telehealth' | 'dictation',
      patientLocationType: telehealth?.patientLocationType ?? null,
      posOffice: settings?.posOffice ?? '11',
      posSettings: settings,
      telehealthModifierDefault: settings?.telehealthModifierDefault ?? '95',
    }),
    icd10: suggestIcd10({ index, chart: context.diagnoses, terms: grounded.conditions, lines }),
    crisisRule: format === 'CRISIS' ? '90839: first 30–74 min of crisis psychotherapy. +90840: each additional 30 min (75–104 min → 1 unit, 105–134 → 2).' : null,
    disclaimer: CODING_DISCLAIMER,
  };
  // Measures the clinician said are to be completed: due on the client's next scheduled visit (review assigns with one click)
  const nextAppointmentDate = grounded.measurePlan.length
    ? await prisma.appointment
        .findFirst({
          where: { clientId: cap.clientId, organizationId: actor.organizationId, startsAt: { gt: new Date() }, status: { in: ['SCHEDULED', 'CHECKED_IN'] } },
          orderBy: { startsAt: 'asc' },
          select: { startsAt: true },
        })
        .then((a) => (a ? a.startsAt.toLocaleDateString('en-CA', { timeZone: tz }) : null))
        .catch(() => null)
    : null;
  const risk = scanTranscriptRisk(lines, { scanClinician: clinicianNarrates(cap) });
  const quality = transcriptQualityWarning({
    sentences: grounded.counts.sentences,
    withheld: grounded.counts.withheld,
    weak: grounded.counts.weak,
    transcriptWords: lines.reduce((t, l) => t + l.text.split(/\s+/).filter(Boolean).length, 0),
    minutes,
  });

  const content = {
    label: DRAFT_LABEL,
    promptVersion: PROMPT_VERSION,
    part2Notice: cap.part2 ? PART2_NOTICE : null,
    noteType: spec.noteType,
    texts: grounded.texts,
    body: grounded.body,
    provenance: grounded.provenance,
    withheld: grounded.withheld,
    planLinks: grounded.planLinks,
    followUps: grounded.followUps,
    homework: grounded.homework,
    summarySentences: grounded.summary,
    medSuggestions: grounded.medSuggestions,
    misheardMeds: grounded.misheardMeds,
    medications: meds,
    scores: grounded.scores,
    mdm: grounded.mdm,
    minimumNecessary: grounded.minimumNecessary,
    stigma: grounded.stigma,
    measurePlan: grounded.measurePlan,
    nextAppointmentDate,
    qualityWarning: quality,
    counts: grounded.counts,
    entailment,
    risk,
    coding,
  };
  const saved = await prisma.scribeDraft.create({
    data: {
      sessionId: cap.id,
      organizationId: actor.organizationId,
      clientId: cap.clientId,
      createdById: actor.userId,
      format,
      modelId: BEDROCK_MODELS.SONNET,
      content: JSON.parse(JSON.stringify(content)),
      sentenceCount: grounded.counts.sentences,
      withheldCount: grounded.counts.withheld,
      flaggedCount: grounded.counts.weak,
    },
  });
  // Risk findings stay on the capture (no quotes): a linked note signs only once risk is documented or attested
  await prisma.scribeCapture.update({
    where: { id: cap.id },
    data: {
      draftCount: { increment: 1 },
      noteFormat: format,
      status: cap.status === 'note_created' ? cap.status : 'drafted',
      riskFindings: JSON.parse(JSON.stringify(persistableFindings(risk))),
    },
  });
  await audit('SUCCESS', {
    step: 'grounded',
    draftId: saved.id,
    sentences: grounded.counts.sentences,
    withheld: grounded.counts.withheld,
    weak: grounded.counts.weak,
    flagged: grounded.counts.flagged,
    planLinks: grounded.planLinks.length,
    riskFindings: risk.findings.length,
    entailmentCalls: entailment.calls,
    retried,
  });

  return NextResponse.json(
    {
      success: true,
      provider: 'bedrock-live',
      modelId: BEDROCK_MODELS.SONNET,
      draft: { id: saved.id, format, createdAt: saved.createdAt.toISOString(), content },
      lines,
      // Review header "Right client?" (not stored with the draft)
      client: client ? { name: client.name, dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null } : null,
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
