/**
 * Narrative documentation checks (medical necessity, interventions, progress toward goals, plan
 * for next session).
 *
 *  - Minimal text to the model: only the narrative sections of the note, with the header lines
 *    (patient, DOB, MRN, provider) removed and the client / clinician names replaced.
 *  - Grounding: every finding the model calls present or weak must quote the note; a quote is
 *    kept only if it is an exact (whitespace-normalized) substring of the text that was sent.
 *    A finding left without a verified quote is dropped and the rule heuristic is used instead.
 *  - Rule fallback: the same four checks by section / keyword, used when AI is skipped or fails.
 * Pure: no Prisma, no Bedrock client (the caller injects the model call).
 */
import { normalizeNoteType, structuredNoteSections } from '@/lib/ehr/noteTemplates';
import { THERAPY_PROGRESS, TS } from '@/lib/ehr/therapy/sections';
import { WIDGET_TEXT_CHECKS } from '@/lib/ehr/therapy/engine';
import { NARRATIVE_CHECKS, type NarrativeCheckId, type QualityItem } from './types';

/** Sections that never go to the model: identifiers, billing header, signature block. */
const EXCLUDED_SECTIONS = new Set(['Session', 'Header', 'Review', 'Meds & Allergies', 'Lab Results', 'Plan - Labs Ordered', '42 CFR Part 2 Consent']);
const IDENTIFIER_LINE = /^\s*(Patient|DOB|MRN|Provider|Date of service|Location|Source|Persons present|Patient location during telehealth|NPI|Phone|Email|Address)\s*:/i;
const MAX_CHARS = 6000;

export type NarrativeText = { text: string; sectionTitles: string[] };

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Replace each name (full name first, then each part of 3+ letters) with a placeholder. */
export function redactNames(text: string, names: { value: string | null | undefined; placeholder: string }[]): string {
  let out = text;
  for (const { value, placeholder } of names) {
    const full = (value || '').trim();
    if (!full) continue;
    out = out.replace(new RegExp(`\\b${escapeRe(full)}\\b`, 'gi'), placeholder);
    for (const part of full.split(/[\s,]+/).filter((p) => p.replace(/[^A-Za-z]/g, '').length >= 3)) {
      out = out.replace(new RegExp(`\\b${escapeRe(part)}(?:'s)?\\b`, 'gi'), placeholder);
    }
  }
  // Contact details that may sit in free text
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[phone]');
  return out;
}

/** The note's narrative sections, identifiers removed and names replaced. */
export function narrativeText(input: {
  noteType: string | null;
  body: string;
  clientName: string | null;
  authorName: string | null;
}): NarrativeText {
  const type = input.noteType ? normalizeNoteType(input.noteType) : '';
  // Addenda (appended by the loader after the signed body) are reviewed as their own section
  const cut = input.body.search(/\n\nAddendum \(\d{4}-\d{2}-\d{2}/);
  const main = cut >= 0 ? input.body.slice(0, cut) : input.body;
  const addenda = cut >= 0 ? input.body.slice(cut).trim() : '';
  const sections = structuredNoteSections(type, main).filter((s) => !EXCLUDED_SECTIONS.has(s.title));
  if (addenda) sections.push({ title: 'Addenda', text: addenda });
  const parts: string[] = [];
  const titles: string[] = [];
  for (const s of sections) {
    const kept = s.text
      .split('\n')
      .filter((l) => !IDENTIFIER_LINE.test(l))
      .join('\n')
      .trim();
    if (!kept) continue;
    titles.push(s.title);
    parts.push(`## ${s.title}\n${kept}`);
  }
  const joined = redactNames(parts.join('\n\n'), [
    { value: input.clientName, placeholder: '[client]' },
    { value: input.authorName, placeholder: '[clinician]' },
  ]);
  return { text: joined.length > MAX_CHARS ? joined.slice(0, MAX_CHARS) : joined, sectionTitles: titles };
}

export const NARRATIVE_SYSTEM_PROMPT = `You review behavioral health progress notes for documentation completeness before a supervisor co-signs.
You are given only the narrative sections of one note. For each check, decide whether the note documents it: "present", "weak" (mentioned but vague or generic) or "missing".
Rules:
- Judge only what the text says. Never assume something was done if it is not written.
- For "present" or "weak", copy one or two short supporting quotes EXACTLY as written in the note (verbatim, 3 to 25 words each). Do not paraphrase, do not fix typos, do not join text from different places.
- For "missing", give no quotes.
- "reason" is one short sentence for the supervisor. Do not suggest wording for the note, billing codes or diagnoses.
Return JSON: {"checks":[{"id":"<check id>","status":"present|weak|missing","quotes":["..."],"reason":"..."}]}`;

export function buildNarrativeUserPrompt(text: string): string {
  const checks = NARRATIVE_CHECKS.map((c) => `- ${c.id}: ${c.ask}`).join('\n');
  return `Checks:\n${checks}\n\nNote (narrative sections only):\n"""\n${text}\n"""`;
}

// ─── Grounding ──────────────────────────────────────────────────────────────

const norm = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

/** Is the quote an exact substring of the note text sent (whitespace / smart quotes normalized)? */
export function isGroundedQuote(quote: string, source: string): boolean {
  const q = norm(quote).replace(/^["']|["']$/g, '').replace(/\.{3}|…/g, '');
  if (q.length < 8) return false;
  return norm(source).includes(q);
}

export type NarrativeFinding = {
  id: NarrativeCheckId;
  status: 'present' | 'weak' | 'missing';
  quotes: string[];
  reason: string;
};

export type ParsedNarrative = { findings: NarrativeFinding[]; dropped: number };

/**
 * Parse the model reply and keep only grounded findings. present / weak without a verified quote
 * are dropped (counted in `dropped`); unknown ids and malformed entries are ignored.
 */
export function parseNarrativeOutput(output: string, source: string): ParsedNarrative | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    const m = output.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      parsed = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const checks = parsed && typeof parsed === 'object' ? (parsed as { checks?: unknown }).checks : null;
  if (!Array.isArray(checks)) return null;
  const ids = new Set(NARRATIVE_CHECKS.map((c) => c.id));
  const findings: NarrativeFinding[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const raw of checks) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const id = String(r.id ?? '') as NarrativeCheckId;
    const status = String(r.status ?? '').toLowerCase();
    if (!ids.has(id) || seen.has(id) || !['present', 'weak', 'missing'].includes(status)) continue;
    const quotes = (Array.isArray(r.quotes) ? r.quotes : [])
      .filter((q): q is string => typeof q === 'string')
      .map((q) => q.trim())
      .filter((q) => isGroundedQuote(q, source))
      .slice(0, 2);
    if (status !== 'missing' && quotes.length === 0) {
      dropped++;
      continue;
    }
    seen.add(id);
    findings.push({
      id,
      status: status as NarrativeFinding['status'],
      quotes: status === 'missing' ? [] : quotes,
      reason: typeof r.reason === 'string' ? r.reason.trim().slice(0, 300) : '',
    });
  }
  return { findings, dropped };
}

// ─── Items ──────────────────────────────────────────────────────────────────

export function aiNarrativeItem(f: NarrativeFinding): QualityItem {
  const def = NARRATIVE_CHECKS.find((c) => c.id === f.id)!;
  const status = f.status === 'present' ? 'pass' : 'warn';
  return {
    id: `narrative.${f.id}`,
    category: 'narrative',
    label: def.label,
    status,
    detail: `${f.status === 'present' ? 'Present' : f.status === 'weak' ? 'Weak' : 'Missing'}${f.reason ? `: ${f.reason}` : '.'}`,
    fix: status === 'pass' ? undefined : def.fix,
    source: 'ai',
    quotes: f.quotes.length ? f.quotes : undefined,
  };
}

const KEYWORDS: Record<NarrativeCheckId, RegExp> = {
  medical_necessity: /\b(symptom|impair|function(?:ing)?|distress|depress|anxi|panic|sleep|irritab|mood|interfer|unable to|difficulty)\w*/i,
  interventions: /\b(intervention|CBT|DBT|cognitive|behavioral activation|motivational|psychoeducation|mindfulness|role[- ]play|reframing|processed|explored|taught|practiced|modeled|EMDR|exposure|validated)\w*/i,
  progress_toward_goals: /\b(goal|objective)s?\b[\s\S]{0,160}\b(progress|improv|no change|regress|met|working toward)/i,
  plan_next_session: /\b(next session|follow[- ]up|return in|homework|continue|plan:|will (?:meet|see|continue|review)|scheduled)\b/i,
};

/** Rule heuristic for the narrative checks (templates: their sections; free text: keywords). */
export function ruleNarrativeItems(input: { noteType: string | null; body: string; reason: string }): QualityItem[] {
  const type = input.noteType ? normalizeNoteType(input.noteType) : '';
  const progress = type === THERAPY_PROGRESS;
  const read = (title: string) =>
    structuredNoteSections(type, input.body)
      .filter((s) => s.title === title)
      .map((s) => s.text)
      .join('\n')
      .trim();
  const found: Record<NarrativeCheckId, boolean> = progress
    ? {
        medical_necessity: Boolean(read(TS.interval)) && Boolean(read(TS.response)),
        interventions: /^Interventions used:\s*\S/m.test(read(TS.interventions)),
        progress_toward_goals: WIDGET_TEXT_CHECKS.planGoals(read(TS.planGoals)),
        plan_next_session: /^Next session:\s*\S/m.test(read(TS.planNext)),
      }
    : {
        medical_necessity: KEYWORDS.medical_necessity.test(input.body),
        interventions: KEYWORDS.interventions.test(input.body),
        progress_toward_goals: KEYWORDS.progress_toward_goals.test(input.body),
        plan_next_session: KEYWORDS.plan_next_session.test(input.body),
      };
  return NARRATIVE_CHECKS.map((c) => ({
    id: `narrative.${c.id}`,
    category: 'narrative' as const,
    label: c.label,
    status: found[c.id] ? ('pass' as const) : ('warn' as const),
    detail: `${found[c.id] ? 'Found' : 'Not found'} by rule check (${input.reason}).`,
    fix: found[c.id] ? undefined : c.fix,
    source: 'rule' as const,
  }));
}

/** AI findings where grounded, the rule heuristic for every check the AI did not support. */
export function mergeNarrative(ai: NarrativeFinding[], fallback: QualityItem[]): QualityItem[] {
  const byId = new Map(ai.map((f) => [`narrative.${f.id}`, f]));
  return fallback.map((rule) => {
    const f = byId.get(rule.id);
    return f ? aiNarrativeItem(f) : rule;
  });
}
