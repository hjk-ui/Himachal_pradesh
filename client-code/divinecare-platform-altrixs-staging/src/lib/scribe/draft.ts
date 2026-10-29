/**
 * AI Scribe drafting: prompt, parse and ground. No Prisma / Bedrock imports (the route injects the
 * model calls), so the whole flow is testable.
 *
 * Sources the model may use, numbered: t1… transcript lines (speaker + time) and c1… chart facts
 * (active plan goals, chart diagnoses, last note plan / homework, recent scores, the active
 * medication list). Every sentence, option value, MSE item, plan linkage, follow-up and summary
 * sentence must cite them; grounding.ts withholds what the cited sources do not support (incl.
 * polarity mismatches and unlisted drugs / doses) and flags weak support; the entailment pass
 * (entailment.ts, Haiku) re-checks weak / negated / risk / MSE / medication sentences, and weak ones
 * in those sections are withheld. Option chips need the client's own words with the right polarity
 * (polarity.ts). Risk findings, coding, minimum-necessary and stigmatizing-language flags are
 * computed by rules, not by the model.
 */
import { AI_DRAFT_MARKER } from '@/lib/ai/noteDraftFormats';
import { MODALITIES, NEXT_SESSION } from '@/lib/ehr/therapy/templates';
import { GOAL_PROGRESS } from '@/lib/ehr/therapy/widgets';
import { PLAN_PROGRESS } from '@/lib/ehr/therapy/planHierarchy';
import { checkDraftSentence, NOT_SUGGESTED_REASONS, sourceMap, type CheckedSentence, type DraftSentence, type Source } from './grounding';
import {
  aiFieldCatalog,
  applyDraft,
  CLINICIAN_ONLY_MED_HEADINGS,
  composeBody,
  formatSpec,
  MSE_DOMAINS,
  normalizeMseKeys,
  resolveTargetKey,
  SECTION_HINTS,
  validOptionValue,
  type FormatSpec,
  type GroundedDraft,
} from './templateFields';
import { SPEAKER_LABEL, formatTimestamp, transcriptForModel, type TranscriptLine } from './diarization';
import { styleInstructions, type ScribeFormat, type ScribePreferences } from './settings';
import { FORMAT_CODING } from './formatCatalog';
import { chartMedicationFact, drugNamesIn, suggestMisheardMeds, type ChartMedication, type MedSuggestion } from './medications';
import { checkOptionValue } from './polarity';
import { applyVerdict, drugNameSensitive, entailKey, isSensitiveTarget, type Verdict } from './entailment';
import { MINIMUM_NECESSARY_PROMPT_RULES, minimumNecessaryFlags, type MinimumNecessaryFlag } from './minimumNecessary';
import { lintStigma, rewriteStigma, STIGMA_PROMPT_RULE, type StigmaFinding } from './stigma';
import { VERBAL_INSTRUMENTS, verbalInstrument } from './verbalScores';
import { measurePlanFromTranscript, measurePlanSentence, type MeasurePlanItem } from './spokenMeasures';

export const DRAFT_LABEL = 'AI draft (Claude on AWS Bedrock, under BAA). Every sentence cites the transcript or chart; review, edit and sign.';
/** Bumped whenever the drafting prompt or grounding rules change (stored with each draft and on the signed note). */
export const PROMPT_VERSION = 'scribe-draft-2026-10-25';
export const PART2_NOTICE =
  '42 CFR Part 2: this record is protected by federal confidentiality rules (42 CFR part 2). Further disclosure is prohibited unless the patient consents in writing or the rules otherwise permit it.';
/** Risk screens: set only from the client's own words (CLIENT speaker), with polarity checked. */
export const RISK_FIELDS = new Set(['si', 'hi', 'selfHarm', 'selfHarmHx', 'currentAbuse']);
/** Chip set from the clinician's stated finding ("patient denies SI, HI" in dictation / recap), not the client's answer. */
export const CLINICIAN_ATTESTED_FLAG = 'clinician-attested: from your stated finding, not the client’s answer';
/** Chips the clinician's own words set (interventions used, the plan): any transcript speaker, lexical + polarity check. */
export const CLINICIAN_SOURCED_OPTIONS = new Set(['modalitiesUsed', 'modalities', 'referrals', 'nextSession', 'screenFollowUp']);
export const FOLLOW_UP_KINDS = ['next_visit', 'lab', 'referral', 'letter', 'coordination', 'measure', 'other'] as const;
export type FollowUpKind = (typeof FOLLOW_UP_KINDS)[number];
export const FUNCTIONAL_DOMAINS = ['home', 'work', 'school', 'relationships'] as const;
export type FunctionalDomain = (typeof FUNCTIONAL_DOMAINS)[number];

export type ChartFacts = {
  goals: { id: string; text: string; objectives: string[] }[];
  diagnoses: { code: string | null; description: string | null }[];
  lastPlan: string | null;
  scores: string[];
  /** Active medication list (context.ts); absent in older callers */
  medications?: ChartMedication[];
};

export type DraftSource = Source & { role?: string; goalId?: string; med?: boolean };

export function buildSources(lines: TranscriptLine[], chart: ChartFacts): { sources: DraftSource[]; text: string } {
  const sources: DraftSource[] = lines.map((l) => ({ id: l.id, kind: 'transcript', text: l.text, role: l.role }));
  const chartLines: string[] = [];
  let n = 0;
  const add = (text: string, extra: { goalId?: string; med?: boolean } = {}) => {
    n++;
    sources.push({ id: `c${n}`, kind: 'chart', text, ...extra });
    chartLines.push(`c${n}: ${text}`);
  };
  chart.goals.forEach((g, i) => add(`Treatment plan goal ${i + 1}: ${g.text}${g.objectives.length ? ` (objectives: ${g.objectives.join('; ')})` : ''}`, { goalId: g.id }));
  for (const d of chart.diagnoses) if (d.code || d.description) add(`Chart diagnosis: ${[d.code, d.description].filter(Boolean).join(' ')}`);
  if (chart.lastPlan) add(`Last note plan / homework: ${chart.lastPlan}`);
  for (const s of chart.scores) add(`Score: ${s}`);
  for (const m of chart.medications ?? []) add(chartMedicationFact(m), { med: true });
  const text = `TRANSCRIPT\n${transcriptForModel(lines)}\n\nCHART FACTS\n${chartLines.join('\n') || '(none)'}`;
  return { sources, text };
}

const isPrescriberFormat = (spec: FormatSpec) => FORMAT_CODING[spec.format] === 'em';

/** Narrative targets (field ids / headings) for the format, in order. */
export function draftTargets(spec: FormatSpec): string[] {
  if (spec.kind === 'template') return aiFieldCatalog(spec.noteType).filter((f) => f.kind === 'text' || f.kind === 'textarea').map((f) => f.id);
  if (spec.kind === 'sections') return [...spec.aiHeadings];
  return ['Progress summary'];
}

/** Two halves of the targets, for the long-session retry (drafted in separate calls). */
export function draftTargetGroups(spec: FormatSpec): string[][] {
  const all = draftTargets(spec);
  if (all.length < 2) return [all];
  const mid = Math.ceil(all.length / 2);
  return [all.slice(0, mid), all.slice(mid)];
}

/**
 * Intake / evaluation templates have many sections (Adult Psych Intake: 30+). One reply for all of
 * them ran out of tokens on a long intake and the tail sections (Substance Use Consequences, Family
 * Hx…) came back empty or cut. Formats with more than GROUP_ALWAYS_OVER narrative targets are
 * always drafted in groups of at most GROUP_SIZE targets (separate calls); the first group also
 * carries the rest of the reply (options, MSE, interventions, plan links, summary…).
 */
export const GROUP_ALWAYS_OVER = 10;
export const GROUP_SIZE = 8;

export type DraftGroup = { only: string[] | null; extras: boolean };

/** How to draft a format: one call, or section groups (always for many-section formats, else on a cut-off long session). */
export function draftGroupsFor(spec: FormatSpec, opts: { split?: boolean } = {}): DraftGroup[] {
  const all = draftTargets(spec);
  if (spec.kind === 'plan') return [{ only: null, extras: true }];
  if (all.length > GROUP_ALWAYS_OVER) {
    const out: DraftGroup[] = [];
    for (let i = 0; i < all.length; i += GROUP_SIZE) out.push({ only: all.slice(i, i + GROUP_SIZE), extras: i === 0 });
    return out;
  }
  if (opts.split) return draftTargetGroups(spec).map((only, i) => ({ only, extras: i === 0 }));
  return [{ only: null, extras: true }];
}

/** Halve a group whose reply was cut off (retried once); the extras stay with the first half. */
export function splitGroup(g: DraftGroup): DraftGroup[] {
  if (!g.only || g.only.length < 2) return [g];
  const mid = Math.ceil(g.only.length / 2);
  return [
    { only: g.only.slice(0, mid), extras: g.extras },
    { only: g.only.slice(mid), extras: false },
  ];
}

const MSE_RULE = (where: string) =>
  `\nMental status (${where}): "mse" keys EXACTLY from: ${MSE_DOMAINS.join(', ')} (one key per domain). The mental status exam is the CLINICIAN's observation: the clinician's own lines (said aloud, dictated or in a recap, e.g. "insight fair, judgment fair", "no AH/VH", "thought content without delusions, denies SI/HI") are the primary source (basis "observed"); the client's words support Mood and what the client reports (basis "stated"). Include every domain the clinician or client stated; omit a domain nobody addressed. Never infer a normal finding.`;

export function buildDraftSystemPrompt(spec: FormatSpec, prefs: ScribePreferences, opts: { only?: string[]; extras?: boolean } = {}): string {
  const sentence = '{"text":"...","cites":["t3"]}';
  const only = opts.only ? new Set(opts.only) : null;
  const keep = (k: string) => !only || only.has(k);
  const extras = opts.extras !== false;
  let targets: string;
  if (spec.kind === 'template') {
    const fields = aiFieldCatalog(spec.noteType).filter((f) => ((f.kind !== 'text' && f.kind !== 'textarea') ? extras : keep(f.id)));
    targets =
      `Template fields (use the id):\n` +
      fields
        .map((f) => `- ${f.id} (${f.kind}${f.options ? `; one of: ${f.options.join(' | ')}` : ''}) — ${f.heading} › ${f.label}`)
        .join('\n') +
      `\nPut text/textarea fields in "narrative" as sentence lists; put single/multi/tri fields in "options".` +
      `\nOption values (incl. "Denies" / "Endorses") must cite the CLIENT's own answer (the line where the client said it), or the clinician's own stated finding (a statement such as "patient denies SI, HI" in dictation or a recap) — never the clinician's question. Leave an option out when neither exists.` +
      (extras ? MSE_RULE('Mental Status Exam') : '');
  } else if (spec.kind === 'sections') {
    const headings = spec.aiHeadings.filter(keep);
    targets = `Sections (use the heading as the narrative key): ${headings.join(', ')}.`;
    const hints = headings.filter((h) => SECTION_HINTS[h]).map((h) => `${h}: ${SECTION_HINTS[h]}`);
    if (hints.length) targets += `\nWhat goes in each section (use the heading exactly as written):\n- ${hints.join('\n- ')}`;
    const clinicianOnly = spec.headings.filter((h) => h !== spec.mseHeading && !spec.aiHeadings.includes(h));
    if (clinicianOnly.length) targets += `\nDo not write the other sections of this note (${clinicianOnly.join(', ')}): the clinician completes them.`;
    if (spec.mseHeading && extras) targets += MSE_RULE(`"${spec.mseHeading}"`);
  } else {
    targets = 'Treatment plan update: fill "planLinks" for each plan goal discussed and "narrative" key "Progress summary".';
  }
  const prescriber = isPrescriberFormat(spec);
  return `You are a clinical documentation assistant for licensed behavioral health clinicians in Maryland (COMAR). You draft; the clinician reviews, edits and signs.
${targets}
Interventions: list each therapeutic intervention the CLINICIAN actually used, tagged with one modality from: ${MODALITIES.join(' | ')}.
Rules:
- Use ONLY the numbered sources (t = transcript lines, c = chart facts). Every sentence and value must cite at least one source id that supports it. Never cite a source that does not say it.
- Never invent findings, quotes, mental status observations, risk statements, diagnoses, scores, dates, medications, doses, goals, progress or plans. If something was not discussed, leave it out (do NOT write "denies" or "within normal limits" unless a source says so).
- Keep the polarity of the source: write "denies" only when the client said no; never turn a denial into an endorsement or the reverse.
- Attribute by source: "Client reports …" for what the client said, "Clinician observed …" for what the clinician saw or said, "Per [mother / guardian / interpreter] …" for another participant. Interpreter lines are the client's statements as interpreted: "Client reports (via interpreter) …".
- Suicidal / homicidal ideation, self-harm, abuse: report exactly what was said with citations; do not rate risk level.
- Medications: name a drug or dose only as the transcript or the medication list (chart facts) states it. Do not write medication changes into the note: put changes discussed in "medChanges" (the prescriber writes the orders).
- Do not assign diagnoses or billing codes. "conditions" lists symptoms/conditions the client described, in their terms, for the clinician to consider.
${MINIMUM_NECESSARY_PROMPT_RULES.map((r) => `- ${r}`).join('\n')}
- ${STIGMA_PROMPT_RULE}
- "functionalImpact": how symptoms affect home, work, school or relationships, in the client's words, citing the client's lines. Omit a domain not discussed.
- "continuedCare": one sentence on why continued care is needed, citing the symptoms discussed (t) and the plan goal status (c); omit it if the transcript does not support it.
- "scores": a screening score stated aloud in session (e.g. "PHQ-9 = 14"), instrument from: ${VERBAL_INSTRUMENTS.map((i) => i.name).join(', ')}; omit if none.${
    prescriber
      ? `\n- "mdm": medical decision making elements discussed: "problems" (each problem addressed and its status: stable | improving | worsening | new), "data" (labs / records / history reviewed), "rx" (prescription drug management and risk discussed). Cite each. Do not choose an E/M level.`
      : ''
  }
- History sections: write everything discussed for each one, completely (every substance and its consequences, every hospitalization, every relative named). Do not summarize away details the client gave.
- Measures: when the clinician says measures are to be completed (e.g. "fill out the GAD-7, PHQ-9 and DASS-42 before next session"), write it in the plan ("Measures to complete before next session: …") using the names as said, citing the clinician's line.
- Clinical, third-person, past tense. ${styleInstructions(prefs)}
- "summary" is a plain-language recap for the client: second person ("you"), short sentences, 6th-8th grade reading level, no jargon, no diagnoses, no risk details.
Return one JSON object:
{"narrative":{"<field id or heading>":[${sentence}]},
 "options":{"<field id>":{"value":"<option>" or ["<option>"],"cites":["t2"]}},
 "mse":{"<domain>":{"text":"...","cites":["t4"],"basis":"stated"|"observed"}},
 "interventions":[{"modality":"<modality>","text":"...","cites":["t6"]}],
 "planLinks":[{"goal":"<c id of the goal>","status":"${GOAL_PROGRESS.join('|')}","level":"${PLAN_PROGRESS.join('|')}","evidence":[${sentence}]}],
 "homework":[${sentence}],
 "nextAppointment":${sentence},
 "followUps":[{"kind":"${FOLLOW_UP_KINDS.join('|')}","text":"...","cites":["t9"]}],
 "conditions":[{"term":"...","cites":["t2"]}],
 "medChanges":[${sentence}],
 "functionalImpact":[{"domain":"${FUNCTIONAL_DOMAINS.join('|')}","text":"...","cites":["t5"]}],
 "continuedCare":${sentence},
 "scores":[{"instrument":"PHQ-9","score":14,"cites":["t7"]}],${prescriber ? `\n "mdm":{"problems":[{"text":"...","status":"stable","cites":["t2"]}],"data":[${sentence}],"rx":[${sentence}]},` : ''}
 "summary":[${sentence}]}${
    extras
      ? ''
      : `\nThis call drafts ONLY the sections listed above (another call drafts the rest of the note): return "narrative" for them and "medChanges" if discussed; leave every other key empty.`
  }`;
}

export function buildDraftUserPrompt(input: { spec: FormatSpec; sessionLabel: string; sourcesText: string }): string {
  return `Note format: ${input.spec.format}\nSession: ${input.sessionLabel}\n\n${input.sourcesText}`;
}

type RawSentence = { text?: unknown; cites?: unknown };
const asSentence = (v: unknown): DraftSentence | null => {
  if (!v || typeof v !== 'object') return null;
  const s = v as RawSentence;
  if (typeof s.text !== 'string') return null;
  return { text: s.text, cites: Array.isArray(s.cites) ? s.cites.filter((c): c is string => typeof c === 'string') : [] };
};
const asSentences = (v: unknown): DraftSentence[] => (Array.isArray(v) ? v.map(asSentence).filter((s): s is DraftSentence => s !== null) : []);
const asCites = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string').map((c) => c.trim().toLowerCase()) : []);

export type RawDraft = {
  narrative: Record<string, DraftSentence[]>;
  options: Record<string, { value: unknown; cites: string[] }>;
  mse: Record<string, { text: string; cites: string[]; basis: 'stated' | 'observed' }>;
  interventions: { modality: string; text: string; cites: string[] }[];
  planLinks: { goal: string; status: string; level: string; evidence: DraftSentence[] }[];
  homework: DraftSentence[];
  nextAppointment: DraftSentence | null;
  followUps: { kind: string; text: string; cites: string[] }[];
  conditions: { term: string; cites: string[] }[];
  summary: DraftSentence[];
  medChanges?: DraftSentence[];
  functionalImpact?: { domain: string; text: string; cites: string[] }[];
  continuedCare?: DraftSentence | null;
  scores?: { instrument: string; score: number; cites: string[] }[];
  mdm?: { problems: { text: string; status: string; cites: string[] }[]; data: DraftSentence[]; rx: DraftSentence[] } | null;
};

export function parseDraftReply(reply: string): RawDraft | null {
  let root: Record<string, unknown>;
  try {
    const parsed = JSON.parse(reply);
    if (!parsed || typeof parsed !== 'object') return null;
    root = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const narrative: RawDraft['narrative'] = {};
  for (const [k, v] of Object.entries(obj(root.narrative))) narrative[k] = asSentences(v);
  const options: RawDraft['options'] = {};
  for (const [k, v] of Object.entries(obj(root.options))) options[k] = { value: obj(v).value ?? (v as { value?: unknown })?.value, cites: asCites(obj(v).cites) };
  const mse: RawDraft['mse'] = {};
  for (const [k, v] of Object.entries(obj(root.mse))) {
    const o = obj(v);
    if (typeof o.text === 'string') mse[k] = { text: o.text, cites: asCites(o.cites), basis: o.basis === 'observed' ? 'observed' : 'stated' };
  }
  const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);
  const mdmRoot = obj(root.mdm);
  return {
    narrative,
    options,
    mse: normalizeMseKeys(mse),
    interventions: list(root.interventions)
      .filter((o) => typeof o.text === 'string')
      .map((o) => ({ modality: String(o.modality ?? ''), text: String(o.text), cites: asCites(o.cites) })),
    planLinks: list(root.planLinks).map((o) => ({ goal: String(o.goal ?? '').toLowerCase(), status: String(o.status ?? ''), level: String(o.level ?? ''), evidence: asSentences(o.evidence) })),
    homework: asSentences(root.homework),
    nextAppointment: asSentence(root.nextAppointment),
    followUps: list(root.followUps)
      .filter((o) => typeof o.text === 'string')
      .map((o) => ({ kind: String(o.kind ?? 'other'), text: String(o.text), cites: asCites(o.cites) })),
    conditions: list(root.conditions)
      .filter((o) => typeof o.term === 'string')
      .map((o) => ({ term: String(o.term).slice(0, 80), cites: asCites(o.cites) })),
    summary: asSentences(root.summary),
    medChanges: asSentences(root.medChanges),
    functionalImpact: list(root.functionalImpact)
      .filter((o) => typeof o.text === 'string')
      .map((o) => ({ domain: String(o.domain ?? '').toLowerCase(), text: String(o.text), cites: asCites(o.cites) })),
    continuedCare: asSentence(root.continuedCare),
    scores: list(root.scores)
      .filter((o) => typeof o.instrument === 'string' && Number.isFinite(Number(o.score)))
      .map((o) => ({ instrument: String(o.instrument), score: Number(o.score), cites: asCites(o.cites) })),
    mdm: Object.keys(mdmRoot).length
      ? {
          problems: list(mdmRoot.problems)
            .filter((o) => typeof o.text === 'string')
            .map((o) => ({ text: String(o.text), status: String(o.status ?? ''), cites: asCites(o.cites) })),
          data: asSentences(mdmRoot.data),
          rx: asSentences(mdmRoot.rx),
        }
      : null,
  };
}

/** A reply that was cut off (max tokens) or is not JSON at all: retry by section groups. */
export function looksTruncated(reply: string): boolean {
  const t = reply.trim();
  return !t.endsWith('}') || (t.match(/\{/g)?.length ?? 0) !== (t.match(/\}/g)?.length ?? 0);
}

/** Merge drafts of the section groups (narrative by key; lists concatenated; first wins for singletons). */
export function mergeRawDrafts(parts: RawDraft[]): RawDraft | null {
  if (!parts.length) return null;
  const [first, ...rest] = parts;
  const out: RawDraft = JSON.parse(JSON.stringify(first));
  for (const p of rest) {
    for (const [k, v] of Object.entries(p.narrative)) out.narrative[k] = [...(out.narrative[k] ?? []), ...v];
    out.options = { ...p.options, ...out.options };
    out.mse = { ...p.mse, ...out.mse };
    out.interventions.push(...p.interventions);
    out.planLinks.push(...p.planLinks);
    out.homework.push(...p.homework);
    out.nextAppointment = out.nextAppointment ?? p.nextAppointment;
    out.followUps.push(...p.followUps);
    out.conditions.push(...p.conditions);
    out.summary.push(...p.summary);
    out.medChanges = [...(out.medChanges ?? []), ...(p.medChanges ?? [])];
    out.functionalImpact = [...(out.functionalImpact ?? []), ...(p.functionalImpact ?? [])];
    out.continuedCare = out.continuedCare ?? p.continuedCare ?? null;
    out.scores = [...(out.scores ?? []), ...(p.scores ?? [])];
    out.mdm = out.mdm ?? p.mdm ?? null;
  }
  return out;
}

export type ProvenanceItem = CheckedSentence & { target: string; heading: string | null };
export type PlanLinkSuggestion = {
  goalId: string;
  goalIndex: number;
  goalText: string;
  status: string;
  level: string;
  evidence: CheckedSentence[];
};
export type FollowUpSuggestion = { kind: FollowUpKind; title: string; cites: string[]; status: 'supported' | 'weak' };
export type ScoreSuggestion = { instrument: string; instrumentId: string; score: number; cites: string[]; max: number };
export type MdmChecklist = {
  problems: (CheckedSentence & { problemStatus: string })[];
  data: CheckedSentence[];
  rx: CheckedSentence[];
  note: string;
};
export type StigmaItem = { heading: string; text: string; findings: StigmaFinding[]; rewrite: string };

export type GroundedResult = {
  spec: FormatSpec;
  texts: Record<string, string>;
  body: string;
  provenance: ProvenanceItem[];
  withheld: ProvenanceItem[];
  planLinks: PlanLinkSuggestion[];
  followUps: FollowUpSuggestion[];
  homework: CheckedSentence[];
  summary: CheckedSentence[];
  conditions: { term: string; cites: string[] }[];
  counts: { sentences: number; withheld: number; weak: number; flagged: number };
  /** Clinician-only medication sections (Plan - Med Changes / Current Medications): suggestions, never inserted */
  medSuggestions: ProvenanceItem[];
  /** Transcript words that sound like a medication (did-you-mean; suggestion only) */
  misheardMeds: MedSuggestion[];
  /** Screening scores stated in session, offered for one-click save (clinician confirms) */
  scores: ScoreSuggestion[];
  /** Prescriber formats: grounded MDM elements to support the clinician's level choice (never picks a level) */
  mdm: MdmChecklist | null;
  minimumNecessary: MinimumNecessaryFlag[];
  stigma: StigmaItem[];
  /** Lexical checks before the entailment pass (the route picks its candidates from these) */
  preliminary: ProvenanceItem[];
  /** Measures the clinician said are to be completed (review: one-click assign; never auto-assigned) */
  measurePlan: MeasurePlanItem[];
};

const TRANSCRIPT_ID = /^t\d+$/;
export const MDM_NOTE = 'Elements discussed in the session, to support your E/M level choice. The level is yours: nothing here picks it.';

/** Where functional impact and the continued-care rationale go (assessment / HPI). */
const TEMPLATE_ASSESSMENT_FIELDS = ['impression', 'formulation', 'hpiNarrative', 'interval'];
const SECTION_ASSESSMENT = /^assessment$|^evaluation$|^response$|^participant response$/i;
const SECTION_HPI = /history of present illness|^hpi$|interval history|^data$|^subjective$|^problem$|^behavior$|presenting|session focus|target behaviors|systemic assessment|^goals$/i;

export type GroundOptions = {
  format: ScribeFormat;
  sources: DraftSource[];
  chart: ChartFacts;
  minor?: boolean;
  telehealth?: boolean;
  /** Entailment verdicts by entailKey (second pass) */
  verdicts?: Map<string, Verdict>;
  /** Client name tokens (not flagged as third-party names) */
  clientNames?: string[];
};

/** Ground every part of the model reply against the sources and place it into the template. */
export function groundDraft(raw: RawDraft, input: GroundOptions): GroundedResult {
  const spec = formatSpec(input.format);
  const map = sourceMap(input.sources);
  const byId = new Map(input.sources.map((s) => [s.id.toLowerCase(), s]));
  const medList = input.chart.medications ?? [];
  const provenance: ProvenanceItem[] = [];
  const preliminary: ProvenanceItem[] = [];
  const sensitive = (target: string, heading: string | null, text: string) => isSensitiveTarget(target, heading) || drugNameSensitive(heading, drugNamesIn(text, medList).length);
  const check = (s: DraftSentence, target: string, heading: string | null, record = true) => {
    const lexical = checkDraftSentence(s, map, { medList });
    preliminary.push({ ...lexical, target, heading });
    const c = applyVerdict(lexical, input.verdicts?.get(entailKey(lexical)), sensitive(target, heading, lexical.text));
    if (record) provenance.push({ ...c, target, heading });
    return c;
  };
  const validCites = (cites: string[]) => cites.length > 0 && cites.every((c) => map.has(c));
  const transcriptLines = input.sources.filter((s) => s.kind === 'transcript').map((s) => ({ id: s.id, role: s.role ?? 'UNKNOWN', text: s.text }));

  const draft: GroundedDraft = { narrative: {}, options: {}, mse: {} };
  const catalog = spec.kind === 'template' ? aiFieldCatalog(spec.noteType) : [];
  const fieldById = new Map(catalog.map((f) => [f.id, f]));
  const draftable = spec.kind === 'sections' ? spec.aiHeadings : spec.headings;
  const headingOf = (key: string) => fieldById.get(key)?.heading ?? (draftable.includes(key) ? key : null);

  // Clinician-only medication sections: whatever the model wrote there is a suggestion, never inserted
  const medSuggestions: ProvenanceItem[] = [];
  const suggestMed = (s: DraftSentence, heading: string) => {
    const c = check(s, 'medChanges', heading, false);
    if (c.status !== 'withheld') medSuggestions.push({ ...c, target: 'medChanges', heading });
  };
  const medHeading = spec.kind === 'sections' ? spec.headings.find((h) => CLINICIAN_ONLY_MED_HEADINGS.has(h)) ?? 'Medication changes' : 'Medication changes';

  // The model's key → a target: exact, or the same heading spelled differently ("Family History" →
  // "Family Hx", "Inpatient History" → "Inpatient Hx"); template fields also by their label
  const medHeadings = [...CLINICIAN_ONLY_MED_HEADINGS];
  const resolveKey = (key: string): string => {
    if (spec.kind === 'template') {
      if (fieldById.has(key)) return key;
      const byLabel = catalog.find((f) => (f.kind === 'text' || f.kind === 'textarea') && resolveTargetKey(key, [f.label]) != null);
      return byLabel?.id ?? key;
    }
    return resolveTargetKey(key, [...draftable, ...medHeadings]) ?? key;
  };
  for (const [rawKey, list] of Object.entries(raw.narrative)) {
    const key = resolveKey(rawKey);
    if (CLINICIAN_ONLY_MED_HEADINGS.has(key)) {
      for (const s of list) suggestMed(s, key);
      continue;
    }
    const heading = headingOf(key) ?? (spec.kind === 'plan' ? 'Progress summary' : null);
    if (!heading) continue;
    if (spec.kind === 'template') {
      const f = fieldById.get(key);
      if (!f || (f.kind !== 'text' && f.kind !== 'textarea')) continue;
    }
    draft.narrative[key] = [...(draft.narrative[key] ?? []), ...list.map((s) => check(s, key, heading))];
  }
  for (const s of raw.medChanges ?? []) suggestMed(s, medHeading);

  // Interventions: modality tags → the template's multi-select; detail sentences → detail field / Intervention section
  const modalities: string[] = [];
  const modalityCites: string[] = [];
  const interventionSentences: CheckedSentence[] = [];
  for (const iv of raw.interventions) {
    const tag = (MODALITIES as readonly string[]).includes(iv.modality) ? iv.modality : null;
    const c = check({ text: tag ? `${iv.text.trim()} [${tag}]` : iv.text, cites: iv.cites }, 'interventions', spec.kind === 'template' ? 'Interventions' : 'Intervention');
    if (c.status === 'withheld') continue;
    interventionSentences.push(c);
    if (tag && !modalities.includes(tag)) {
      modalities.push(tag);
      modalityCites.push(...iv.cites);
    }
  }
  if (spec.kind === 'template') {
    if (fieldById.has('modalitiesUsed') && modalities.length) draft.options.modalitiesUsed = { value: modalities, cites: [...new Set(modalityCites)] };
    if (fieldById.has('interventionDetail') && interventionSentences.length) draft.narrative.interventionDetail = [...(draft.narrative.interventionDetail ?? []), ...interventionSentences];
  } else if (spec.kind === 'sections') {
    const ivHeading = spec.aiHeadings.find((h) => /^intervention/i.test(h));
    if (ivHeading && interventionSentences.length) draft.narrative[ivHeading] = [...(draft.narrative[ivHeading] ?? []), ...interventionSentences];
  }

  const homework = raw.homework.map((s) => check(s, 'homework', 'Plan & Homework'));
  if (spec.kind === 'template' && fieldById.has('homework')) draft.narrative.homework = [...(draft.narrative.homework ?? []), ...homework];
  const nextAppt = raw.nextAppointment ? check(raw.nextAppointment, 'nextAppointment', 'Plan') : null;
  if (spec.kind === 'sections') {
    const planHeading = spec.aiHeadings.find((h) => h === 'Plan');
    // Prescriber templates have their own next-appointment section
    const nextHeading = spec.aiHeadings.find((h) => h === 'Plan - Next Appointment') ?? planHeading;
    if (planHeading) draft.narrative[planHeading] = [...(draft.narrative[planHeading] ?? []), ...homework];
    if (nextHeading && nextAppt) draft.narrative[nextHeading] = [...(draft.narrative[nextHeading] ?? []), nextAppt];
  } else if (spec.kind === 'template' && nextAppt && nextAppt.status !== 'withheld' && fieldById.has('planText')) {
    draft.narrative.planText = [...(draft.narrative.planText ?? []), nextAppt];
  }

  // Functional impact (medical necessity): the client's words, placed in the assessment / HPI section
  const fnTarget =
    spec.kind === 'template'
      ? TEMPLATE_ASSESSMENT_FIELDS.find((id) => fieldById.has(id)) ?? null
      : spec.kind === 'sections'
        ? spec.aiHeadings.find((h) => SECTION_ASSESSMENT.test(h)) ?? spec.aiHeadings.find((h) => SECTION_HPI.test(h)) ?? null
        : null;
  for (const fi of raw.functionalImpact ?? []) {
    if (!fnTarget || !(FUNCTIONAL_DOMAINS as readonly string[]).includes(fi.domain)) continue;
    const fromParticipant = fi.cites.some((c) => TRANSCRIPT_ID.test(c) && byId.get(c)?.role && byId.get(c)!.role !== 'CLINICIAN');
    const heading = headingOf(fnTarget) ?? fnTarget;
    if (!fromParticipant) {
      provenance.push({ text: fi.text, cites: fi.cites, status: 'withheld', reason: 'option_role', support: 0, target: 'functionalImpact', heading });
      continue;
    }
    const c = check({ text: fi.text, cites: fi.cites }, 'functionalImpact', heading);
    if (c.status === 'withheld') continue;
    const label = `Functional impact (${fi.domain}): ${c.text.replace(/^functional impact[^:]*:\s*/i, '')}`;
    draft.narrative[fnTarget] = [...(draft.narrative[fnTarget] ?? []), { ...c, text: label }];
  }
  // Continued care rationale: symptoms (transcript) + plan goal status (chart goal) when the client has a plan
  if (raw.continuedCare && fnTarget) {
    const heading = headingOf(fnTarget) ?? fnTarget;
    const cc = { text: raw.continuedCare.text, cites: raw.continuedCare.cites.map((c) => c.toLowerCase()) };
    const hasGoal = cc.cites.some((c) => byId.get(c)?.goalId);
    const hasTranscript = cc.cites.some((c) => TRANSCRIPT_ID.test(c));
    if (!hasTranscript || (input.chart.goals.length && !hasGoal)) {
      provenance.push({ ...cc, status: 'withheld', reason: 'no_citation', support: 0, target: 'continuedCare', heading, detail: 'needs the symptoms (transcript) and the plan goal it relates to' });
    } else {
      const c = check(cc, 'continuedCare', heading);
      if (c.status !== 'withheld') draft.narrative[fnTarget] = [...(draft.narrative[fnTarget] ?? []), { ...c, text: `Continued care: ${c.text.replace(/^continued care:\s*/i, '')}` }];
    }
  }

  if (spec.kind === 'template') {
    for (const [id, o] of Object.entries(raw.options)) {
      const f = fieldById.get(id);
      if (!f || !validCites(o.cites)) continue;
      const v = validOptionValue(f, o.value);
      if (v == null) continue;
      if (id === 'nextSession' && !(NEXT_SESSION as readonly string[]).includes(String(v))) continue;
      const shown = `${f.label}: ${Array.isArray(v) ? v.join(', ') : v}`;
      if (id === 'modalitiesUsed' && draft.options.modalitiesUsed) {
        const merged = [...new Set([...(draft.options.modalitiesUsed.value as string[]), ...(Array.isArray(v) ? v : [v])])];
        draft.options.modalitiesUsed = { value: merged, cites: [...new Set([...draft.options.modalitiesUsed.cites, ...o.cites])] };
        continue;
      }
      if (CLINICIAN_SOURCED_OPTIONS.has(id)) {
        // The clinician's own plan / interventions: the usual sentence checks (numbers, polarity, overlap)
        const c = check({ text: shown, cites: o.cites }, id, f.heading, false);
        provenance.push({ ...c, text: shown, target: id, heading: f.heading });
        if (c.status !== 'withheld') draft.options[id] = { value: v, cites: o.cites };
        continue;
      }
      if (f.kind !== 'single' && f.kind !== 'multi' && f.kind !== 'tri') continue;
      const risk = RISK_FIELDS.has(id);
      const res = checkOptionValue({ fieldId: id, label: f.label, kind: f.kind, value: v, cites: o.cites, lines: transcriptLines, risk });
      if (res.ok === false) {
        const fail = res as { ok: false; reason: 'option_role' | 'option_polarity'; detail: string };
        provenance.push({ text: shown, cites: o.cites, status: 'withheld', reason: fail.reason, detail: fail.detail, support: 0, target: id, heading: f.heading });
        continue;
      }
      const ok = res as { ok: true; support: number; lines: string[]; attested?: boolean };
      const status: CheckedSentence['status'] = ok.support >= 0.35 ? 'supported' : 'weak';
      if (ok.attested) {
        // The clinician's stated finding (dictation / recap), not the client's answer: marked as such
        draft.options[id] = { value: v, cites: ok.lines };
        provenance.push({ text: shown, cites: ok.lines, status, support: ok.support, target: id, heading: f.heading, flags: [CLINICIAN_ATTESTED_FLAG] });
        continue;
      }
      // A weakly supported risk screen is left for the clinician
      if (risk && status === 'weak') {
        provenance.push({ text: shown, cites: o.cites, status: 'withheld', reason: 'weak_sensitive', support: ok.support, target: id, heading: f.heading });
        continue;
      }
      draft.options[id] = { value: v, cites: ok.lines };
      provenance.push({ text: shown, cites: ok.lines, status, support: ok.support, target: id, heading: f.heading });
    }
  }
  // Mental status: therapist templates, and section templates with a mental status section
  const mseHeading = spec.kind === 'template' ? 'Mental Status Exam' : spec.kind === 'sections' ? spec.mseHeading : null;
  if (mseHeading) {
    for (const [domain, m] of Object.entries(raw.mse)) {
      if (!(MSE_DOMAINS as readonly string[]).includes(domain)) continue;
      const c = check({ text: m.text, cites: m.cites }, `mse.${domain}`, mseHeading);
      if (c.status !== 'withheld') draft.mse[domain] = { sentence: c, basis: m.basis };
      else if (!c.reason || !NOT_SUGGESTED_REASONS.has(c.reason)) draft.mseSuggested = [...(draft.mseSuggested ?? []), domain];
    }
  }

  // Measures the clinician said are to be completed: a grounded plan sentence + one-click assign in review
  const measurePlan = spec.kind === 'plan' ? [] : measurePlanFromTranscript(transcriptLines);
  const measureSentence = measurePlanSentence(measurePlan);
  if (measureSentence) {
    const planTarget =
      spec.kind === 'template'
        ? (['planText', 'plan', 'nextSteps'].find((id) => fieldById.get(id)?.kind === 'textarea' || fieldById.get(id)?.kind === 'text') ?? null)
        : spec.kind !== 'sections' ? null : spec.aiHeadings.find((h) => h === 'Plan') ?? spec.aiHeadings.find((h) => /^plan\b/i.test(h) && !CLINICIAN_ONLY_MED_HEADINGS.has(h)) ?? null;
    if (planTarget) {
      const already = (draft.narrative[planTarget] ?? []).some((s) => s.status !== 'withheld' && measurePlan.every((m) => m.status === 'ambiguous' || s.text.toLowerCase().includes(m.name.toLowerCase().split(' ')[0])));
      if (!already) {
        const heading = headingOf(planTarget) ?? planTarget;
        const c = check({ text: measureSentence, cites: [...new Set(measurePlan.flatMap((m) => m.cites))] }, planTarget, heading);
        if (c.status !== 'withheld') draft.narrative[planTarget] = [...(draft.narrative[planTarget] ?? []), c];
      }
    }
  }

  const goalSources = input.sources.filter((s) => s.goalId);
  const planLinks: PlanLinkSuggestion[] = [];
  for (const pl of raw.planLinks) {
    const src = goalSources.find((s) => s.id.toLowerCase() === pl.goal);
    if (!src?.goalId) continue;
    const evidence = pl.evidence.map((s) => check(s, `plan.${src.goalId}`, 'Treatment Plan Goals')).filter((s) => s.status !== 'withheld' && s.cites.some((c) => TRANSCRIPT_ID.test(c)));
    if (!evidence.length) continue;
    const idx = input.chart.goals.findIndex((g) => g.id === src.goalId);
    planLinks.push({
      goalId: src.goalId,
      goalIndex: idx,
      goalText: input.chart.goals[idx]?.text ?? '',
      status: (GOAL_PROGRESS as readonly string[]).includes(pl.status) ? pl.status : 'No change',
      level: (PLAN_PROGRESS as readonly string[]).includes(pl.level) ? pl.level : '',
      evidence,
    });
  }

  const followUps: FollowUpSuggestion[] = [];
  for (const f of raw.followUps.slice(0, 8)) {
    const c = check({ text: f.text, cites: f.cites }, 'followUp', null);
    if (c.status === 'withheld') continue;
    const kind = (FOLLOW_UP_KINDS as readonly string[]).includes(f.kind) ? (f.kind as FollowUpKind) : 'other';
    followUps.push({ kind, title: c.text.slice(0, 200), cites: c.cites, status: c.status });
  }

  // Scores stated in session: instrument and number must be in the cited transcript lines
  const scores: ScoreSuggestion[] = [];
  for (const sc of (raw.scores ?? []).slice(0, 6)) {
    const inst = verbalInstrument(sc.instrument);
    if (!inst || sc.score < 0 || sc.score > inst.max || !Number.isInteger(sc.score)) continue;
    if (!sc.cites.length || !sc.cites.every((c) => TRANSCRIPT_ID.test(c))) continue;
    const c = checkDraftSentence({ text: `${inst.name} ${sc.score}`, cites: sc.cites }, map);
    if (c.status === 'withheld') continue;
    if (!scores.some((x) => x.instrumentId === inst.id)) scores.push({ instrument: inst.name, instrumentId: inst.id, score: sc.score, cites: c.cites, max: inst.max });
  }

  // Prescriber formats: MDM elements (review only)
  let mdm: MdmChecklist | null = null;
  if (isPrescriberFormat(spec) && raw.mdm) {
    const keepOk = (s: CheckedSentence) => s.status !== 'withheld';
    mdm = {
      problems: raw.mdm.problems
        .map((p) => ({ ...check({ text: p.text, cites: p.cites }, 'mdm', null, false), problemStatus: /^(stable|improving|worsening|new)$/i.test(p.status) ? p.status.toLowerCase() : 'not stated' }))
        .filter(keepOk),
      data: raw.mdm.data.map((s) => check(s, 'mdm', null, false)).filter(keepOk),
      rx: raw.mdm.rx.map((s) => check(s, 'mdm', null, false)).filter(keepOk),
      note: MDM_NOTE,
    };
  }

  const summary = raw.summary.map((s) => check(s, 'summary', null));
  const conditions = raw.conditions.filter((c) => c.cites.some((id) => TRANSCRIPT_ID.test(id) && map.has(id)));

  const texts = applyDraft(spec, draft, { minor: input.minor, telehealth: input.telehealth });
  const body = spec.kind === 'plan' ? '' : composeBody(spec, texts);
  const noteItems = provenance.filter((p) => p.target !== 'summary');
  const placed = noteItems.filter((p) => p.status !== 'withheld');
  const stigma: StigmaItem[] = [];
  for (const p of placed) {
    const findings = lintStigma(p.text);
    if (findings.length && p.heading) stigma.push({ heading: p.heading, text: p.text, findings, rewrite: rewriteStigma(p.text) });
  }
  return {
    spec,
    texts,
    body,
    provenance: placed,
    withheld: noteItems.filter((p) => p.status === 'withheld'),
    planLinks,
    followUps,
    homework: homework.filter((h) => h.status !== 'withheld'),
    summary,
    conditions,
    counts: {
      sentences: noteItems.length,
      withheld: noteItems.filter((p) => p.status === 'withheld').length,
      weak: noteItems.filter((p) => p.status === 'weak').length,
      flagged: placed.filter((p) => p.flags?.length).length,
    },
    medSuggestions,
    misheardMeds: suggestMisheardMeds(transcriptLines, medList),
    scores,
    mdm,
    minimumNecessary: minimumNecessaryFlags(placed, { clientNames: input.clientNames }),
    stigma,
    preliminary: preliminary.filter((p) => p.target !== 'summary'),
    measurePlan,
  };
}

/**
 * "Low transcript quality — review carefully": withheld + weak above 30 % of the drafted items, or a
 * transcript far too short for the minutes (under 20 words a minute over 10+ minutes).
 */
export function transcriptQualityWarning(input: { sentences: number; withheld: number; weak: number; transcriptWords: number; minutes: number | null }): string | null {
  const reasons: string[] = [];
  if (input.sentences >= 3 && (input.withheld + input.weak) / input.sentences > 0.3) {
    reasons.push(`${input.withheld + input.weak} of ${input.sentences} drafted items were withheld or weakly supported`);
  }
  if (input.minutes != null && input.minutes >= 10 && input.transcriptWords < input.minutes * 20) {
    reasons.push(`the transcript has ${input.transcriptWords} words for ${input.minutes} minutes`);
  }
  return reasons.length ? `Low transcript quality — review carefully: ${reasons.join('; ')}.` : null;
}

/** Confirmed plan links → "Treatment Plan Goals" lines in the format the planGoals widget writes. */
export function planGoalLines(links: Pick<PlanLinkSuggestion, 'goalIndex' | 'goalText' | 'status' | 'level'>[]): string {
  return links
    .filter((l) => l.goalIndex >= 0)
    .map((l) => `Goal ${l.goalIndex + 1}: ${l.goalText} — ${l.status}${l.level ? ` (${l.level})` : ''}`)
    .join('\n');
}

/** Lines of the transcript a sentence cites, for the citation popover. */
export function citedLines(cites: string[], lines: TranscriptLine[]): { id: string; at: string; speaker: string; text: string }[] {
  const by = new Map(lines.map((l) => [l.id, l]));
  return cites
    .map((c) => by.get(c))
    .filter((l): l is TranscriptLine => Boolean(l))
    .map((l) => ({ id: l.id, at: formatTimestamp(l.startMs), speaker: SPEAKER_LABEL[l.role], text: l.text }));
}

export { AI_DRAFT_MARKER };
