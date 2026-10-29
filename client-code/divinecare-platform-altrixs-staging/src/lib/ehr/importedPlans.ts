/**
 * Plans imported from Valant: how their dates and diagnoses are shown, which filed documents
 * hold the real plan, the rewrite worklist, and goal suggestions read from a filed plan document.
 *
 * Valant's treatment plan grid exports status, Last Update, Next Review and providers only: no
 * start date, goals or diagnoses. Nothing here fills those in. Dates come from Valant (or say they
 * are not in the export), diagnoses come from the chart and say so, and goal suggestions are lines
 * quoted from a document the clinic filed, for the clinician to confirm.
 *
 * Pure and client-safe (no Prisma, no React).
 */
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import type { TpGoal } from '@/lib/ehr/therapy/widgets';
import { emptyGoal, emptyIntervention, emptyObjective, emptyProblem, type PlanGoalNode, type PlanIntervention, type PlanProblem } from '@/lib/ehr/therapy/planHierarchy';

// ─── Dates ──────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" (or an ISO instant) -> the calendar day, or null */
export function isoDay(v: string | Date | null | undefined): string | null {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const d = typeof v === 'string' ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** "2025-04-14" -> "Apr 14, 2025" (date only, no time zone shift) */
export function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}

/** Valant "Last Update" instant -> clinic calendar day (America/New_York) */
function clinicDayOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(parts) ? parts : d.toISOString().slice(0, 10);
}

export type PlanDateView = {
  /** Plan start day, or null when it is not known */
  startDay: string | null;
  startLabel: string;
  /** Valant "Last Update" (imported plans only) */
  lastUpdatedLabel: string | null;
  reviewDay: string | null;
  reviewLabel: string;
  overdue: boolean;
  /** Days past the review date (0 when not overdue) */
  daysOverdue: number;
  /** One line for a plan header: parts joined with " · " */
  line: string;
};

/**
 * Header dates for a plan. Imported plans use Valant's own dates only: the import date is never
 * shown as the start (Valant's grid has no start date, so it says so). The review date is shown
 * on its own ("Review due …"), never as the end of a "start to end" range, so a review date before
 * the start can never read as a plan that ends before it begins. A past review date on a plan that
 * is not closed reads "— OVERDUE".
 */
export function planDateView(input: {
  source: ImportedPlanSource | null;
  /** Altrixs plans: when the plan was written (createdAt) */
  createdAt: string | null;
  reviewDueAt: string | null;
  status: string;
  today: string;
}): PlanDateView {
  const imported = Boolean(input.source);
  const startDay = imported ? isoDay(input.source?.planStartDate ?? null) : isoDay(input.createdAt);
  const startLabel = startDay ? `Start ${fmtDay(startDay)}` : imported ? 'Start: not in Valant export' : 'Start: not recorded';
  const updatedDay = imported ? clinicDayOf(input.source?.lastUpdatedAt ?? null) : null;
  const lastUpdatedLabel = updatedDay ? `Last updated in Valant ${fmtDay(updatedDay)}` : null;
  const reviewDay = isoDay(input.reviewDueAt);
  const closed = input.status === 'CLOSED';
  const overdue = Boolean(reviewDay && !closed && reviewDay < input.today);
  const daysOverdue = overdue && reviewDay
    ? Math.round((Date.parse(`${input.today}T12:00:00Z`) - Date.parse(`${reviewDay}T12:00:00Z`)) / 86_400_000)
    : 0;
  const reviewLabel = reviewDay
    ? `Review due ${fmtDay(reviewDay)}${overdue ? ' — OVERDUE' : ''}`
    : imported
      ? 'Next review: not in Valant export'
      : 'Review date: not set';
  const line = [startLabel, lastUpdatedLabel, reviewLabel].filter(Boolean).join(' · ');
  return { startDay, startLabel, lastUpdatedLabel, reviewDay, reviewLabel, overdue, daysOverdue, line };
}

// ─── Diagnoses ──────────────────────────────────────────────────────────────

export const CHART_DX_LABEL = 'From chart (not part of the Valant plan)';

export type ChartDiagnosis = {
  code: string | null;
  description: string;
  isPrimary: boolean;
  from: 'Client record' | 'Problem list';
};

const ICD10_AT_START = /^\s*([A-TV-Z]\d[0-9A-Z](?:\.[0-9A-Z]{1,4})?)\b\s*[-—:–]?\s*(.*)$/i;

/** "F41.1 Generalized anxiety disorder; F32.1 - MDD" -> [{code, description}] */
export function splitDiagnosisText(raw: string | null | undefined): { code: string | null; description: string }[] {
  return String(raw ?? '')
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(ICD10_AT_START);
      return m ? { code: m[1].toUpperCase(), description: m[2].trim() } : { code: null, description: s };
    });
}

/**
 * The client's diagnoses as the chart records them: the client record (primary + secondary)
 * and active problem-list entries. Shown next to an imported plan, labeled as chart data,
 * because Valant's plan grid carries no diagnoses.
 */
export function chartDiagnosesForPlan(
  client: { primaryDiagnosis: string | null; primaryDiagnosisCode: string | null; secondaryDiagnoses: string | null },
  problems: { icd10Code: string | null; name: string; status: string | null }[]
): ChartDiagnosis[] {
  const out: ChartDiagnosis[] = [];
  const seen = new Set<string>();
  const push = (d: ChartDiagnosis) => {
    const k = d.code ? `c:${d.code}` : `t:${d.description.toLowerCase()}`;
    if (!d.code && !d.description) return;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(d);
  };
  const primaryCode = client.primaryDiagnosisCode?.trim().toUpperCase() || null;
  if (primaryCode || client.primaryDiagnosis?.trim()) {
    push({ code: primaryCode, description: client.primaryDiagnosis?.trim() || '', isPrimary: true, from: 'Client record' });
  }
  for (const d of splitDiagnosisText(client.secondaryDiagnoses)) push({ ...d, isPrimary: false, from: 'Client record' });
  for (const p of problems) {
    if (!/^active$/i.test(String(p.status ?? '').trim())) continue;
    push({ code: p.icd10Code?.trim().toUpperCase() || null, description: p.name.trim(), isPrimary: false, from: 'Problem list' });
  }
  return out;
}

/** Diagnoses for a rewrite: the signed intake's first, then chart diagnoses that have a code. */
export function rewriteDiagnoses(
  intakeDx: { code: string; description: string; isPrimary: boolean }[],
  chart: ChartDiagnosis[]
): { code: string; description: string; isPrimary: boolean }[] {
  const out = intakeDx.map((d) => ({ ...d }));
  const seen = new Set(out.map((d) => d.code.toUpperCase()));
  for (const d of chart) {
    if (!d.code || seen.has(d.code)) continue;
    seen.add(d.code);
    out.push({ code: d.code, description: d.description, isPrimary: d.isPrimary && !out.some((x) => x.isPrimary) });
  }
  return out.slice(0, 12);
}

// ─── Valant plan documents (Smart Doc Intake) ───────────────────────────────

const PLAN_DOC_RE = /\btreatment[\s_-]*plan\b|\bITP\b|\bIRP\b/i;

/** A filed intake document that is a treatment plan (classified type, title or file name). */
export function isTreatmentPlanDocument(doc: { documentType: string | null; title?: string | null; fileName?: string | null }): boolean {
  return [doc.documentType, doc.title, doc.fileName].some((v) => Boolean(v && PLAN_DOC_RE.test(v.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[_.]+/g, ' '))));
}

// ─── Worklist ───────────────────────────────────────────────────────────────

export type WorklistPlan = {
  id: string;
  status: string;
  reviewDueAt: string | null;
  source: ImportedPlanSource | null;
  supersedesId?: string | null;
};

export type ImportedPlanTask = {
  planId: string;
  /** Imported, still open: write the plan in Altrixs */
  needsRewrite: boolean;
  overdue: boolean;
  noReviewDate: boolean;
  /** An Altrixs draft that will replace this plan (opens instead of a new rewrite) */
  rewriteDraftId: string | null;
};

/** Imported Valant plans still open, with whether their review is overdue and any rewrite in progress. */
export function importedPlanWorklist(plans: WorklistPlan[], today: string): Map<string, ImportedPlanTask> {
  const rewrites = new Map<string, string>();
  for (const p of plans) if (p.supersedesId && !p.source && p.status !== 'CLOSED') rewrites.set(p.supersedesId, p.id);
  const out = new Map<string, ImportedPlanTask>();
  for (const p of plans) {
    if (!p.source || p.status === 'CLOSED') continue;
    const due = isoDay(p.reviewDueAt);
    out.set(p.id, {
      planId: p.id,
      needsRewrite: true,
      overdue: Boolean(due && due < today),
      noReviewDate: !due,
      rewriteDraftId: rewrites.get(p.id) ?? null,
    });
  }
  return out;
}

/** Editor link: a new rewrite, or the rewrite draft already started. */
export function rewriteHref(clientId: string, importedPlanId: string, draftId: string | null = null): string {
  const base = `/dashboard/ehr/treatment-plans/therapy?clientId=${encodeURIComponent(clientId)}`;
  return draftId ? `${base}&planId=${encodeURIComponent(draftId)}` : `${base}&rewriteOf=${encodeURIComponent(importedPlanId)}`;
}

// ─── Goal suggestions from a filed plan document ────────────────────────────

export type SuggestedItem = { text: string; sourceLines: string[] };
export type SuggestedObjective = SuggestedItem & { targetDateInSource: string | null };
export type SuggestedGoal = SuggestedItem & {
  /** Problem / need line the goal sits under in the document, quoted */
  problem: string | null;
  objectives: SuggestedObjective[];
  interventions: SuggestedItem[];
};
export type GoalSuggestions = {
  goals: SuggestedGoal[];
  /** Objectives / interventions found before any goal line (the clinician places them) */
  unattached: { kind: 'objective' | 'intervention'; item: SuggestedItem }[];
};

type LabelKind = 'problem' | 'goal' | 'objective' | 'intervention';

// Label at the start of a line: "Goal 1:", "Goal #2 -", "GOAL 1.", "Long-Term Goal:",
// "Objective 1.1:", "Short-term objective:", "Intervention:", "Interventions -", "Problem #1:".
const LABELS: { kind: LabelKind; re: RegExp }[] = [
  { kind: 'objective', re: /^(?:short[\s-]*term\s+(?:goal|objective)s?|objectives?)\b/i },
  { kind: 'goal', re: /^(?:long[\s-]*term\s+goals?|goals?)\b/i },
  { kind: 'intervention', re: /^(?:interventions?|strateg(?:y|ies)|modalit(?:y|ies))\b/i },
  { kind: 'problem', re: /^(?:problems?|needs?|presenting\s+problems?)\b/i },
];
/** After the label word: a number ("1", "#2", "1.1") with optional punctuation, or ":" / "-" */
const AFTER_NUMBER = /^\s*#?\s*\d+(?:\.\d+)*[a-z]?\s*[.):\-—–]?\s*/i;
const AFTER_PLAIN = /^\s*[:\-—–]\s*/;
const BULLET = /^(?:[•*•\-–]\s+|\(?\d{1,2}[.)]\s+|[a-z][.)]\s+)/i;
const TARGET_DATE = /\s*[(\[]?\s*(?:target(?:\s+date)?|due)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})\s*[)\]]?/i;
// Valant print noise: page footers, status / date / signature lines
const NOISE = /^(?:page\s+\d+(?:\s+of\s+\d+)?|printed\b.*|status\s*:.*|date\s*:.*|signature.*|signed\b.*|\d{1,2}\/\d{1,2}\/\d{2,4})$/i;

function labelOf(line: string): { kind: LabelKind; rest: string } | null {
  const bare = line.replace(/^[•*•\-–]\s*/, '');
  for (const { kind, re } of LABELS) {
    const m = bare.match(re);
    if (!m) continue;
    const after = bare.slice(m[0].length);
    if (!after.trim()) return { kind, rest: '' }; // heading on its own line ("Interventions")
    const sep = after.match(AFTER_NUMBER) ?? after.match(AFTER_PLAIN);
    if (!sep) continue; // "Goals are reviewed monthly" is prose, not a label
    return { kind, rest: after.slice(sep[0].length).trim() };
  }
  return null;
}

function splitTargetDate(text: string): { text: string; targetDateInSource: string | null } {
  const td = text.match(TARGET_DATE);
  if (!td || td.index == null) return { text, targetDateInSource: null };
  return { text: (text.slice(0, td.index) + text.slice(td.index + td[0].length)).trim(), targetDateInSource: td[1] };
}

/**
 * Goal / objective / intervention lines from a plan document's OCR text. Only labeled lines are
 * read ("Goal 1: …", "Objective 1.1: …", "Intervention: …", or a heading followed by bullets),
 * with up to two unlabeled lines that continue a wrapped line; each suggestion quotes the lines it
 * came from. Nothing is added that the text does not say: no default goals, no rewording, and
 * target dates are quoted, not applied (an old plan's dates are usually past). The clinician
 * confirms each suggestion before it goes into the plan; nothing is saved by this.
 */
export function suggestPlanGoalsFromText(text: string | null | undefined): GoalSuggestions {
  const lines = String(text ?? '')
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim());
  const goals: SuggestedGoal[] = [];
  const unattached: GoalSuggestions['unattached'] = [];
  let problem: string | null = null;
  let current = null as SuggestedItem | null;
  let continuation = 0;
  /** A heading on its own line ("Interventions:"): the bullets under it are items of this kind */
  let list = null as LabelKind | null;

  const add = (kind: LabelKind, raw: string, line: string) => {
    continuation = 0;
    const { text: body, targetDateInSource } = splitTargetDate(raw.replace(/[\s;,]+$/, ''));
    if (kind === 'problem') {
      problem = body || null;
      current = null;
      return;
    }
    if (kind === 'goal') {
      const g: SuggestedGoal = { text: body, sourceLines: [line], problem, objectives: [], interventions: [] };
      goals.push(g);
      current = g;
      return;
    }
    const last = goals[goals.length - 1];
    if (kind === 'objective') {
      const o: SuggestedObjective = { text: body, sourceLines: [line], targetDateInSource };
      if (last) last.objectives.push(o);
      else unattached.push({ kind: 'objective', item: o });
      current = o;
    } else {
      const iv: SuggestedItem = { text: body, sourceLines: [line] };
      if (last) last.interventions.push(iv);
      else unattached.push({ kind: 'intervention', item: iv });
      current = iv;
    }
  };

  for (const line of lines) {
    if (!line) {
      current = null;
      continuation = 0;
      continue;
    }
    const label = labelOf(line);
    if (label) {
      if (!label.rest) {
        list = label.kind;
        current = null;
        continue;
      }
      list = null;
      add(label.kind, label.rest, line);
      continue;
    }
    if (list && BULLET.test(line)) {
      add(list, line.replace(BULLET, ''), line);
      continue;
    }
    // Unlabeled line: continues the line above (wrapped text), at most two lines
    if (current && continuation < 2 && !NOISE.test(line)) {
      const cur: SuggestedItem = current;
      cur.text = `${cur.text} ${line}`.trim();
      cur.sourceLines.push(line);
      continuation += 1;
      continue;
    }
    current = null;
    list = null;
  }

  const keep = (i: SuggestedItem) => i.text.trim().length > 0;
  return {
    goals: goals
      .map((g) => ({ ...g, objectives: g.objectives.filter(keep), interventions: g.interventions.filter(keep) }))
      .filter((g) => keep(g) || g.objectives.length > 0 || g.interventions.length > 0),
    unattached: unattached.filter((u) => keep(u.item)),
  };
}

/** True when a goal in the editor has nothing typed in it (the starting blank goal). */
export function isBlankTpGoal(g: TpGoal): boolean {
  return !g.goal.trim() && g.objectives.every((o) => !o.text.trim()) && g.interventions.every((iv) => !iv.type && !iv.detail.trim());
}

/**
 * Editor goals from the suggestions the clinician ticked. Text is copied exactly; objective target
 * dates are left blank for the clinician to set (the document's dates are quoted in the
 * suggestion list, not applied); intervention type / frequency / responsible staff stay blank.
 * Blank goals already in the editor are replaced; goals the clinician typed are kept.
 */
export function addSuggestedGoals(current: TpGoal[], picked: SuggestedGoal[], newId: (i: number) => string): TpGoal[] {
  const added: TpGoal[] = picked.map((g, i) => ({
    id: newId(i),
    goal: g.text,
    objectives: g.objectives.length ? g.objectives.map((o) => ({ text: o.text, targetDate: '' })) : [{ text: '', targetDate: '' }],
    interventions: g.interventions.length
      ? g.interventions.map((iv) => ({ type: '', detail: iv.text, frequency: '', responsible: '' }))
      : [{ type: '', detail: '', frequency: '', responsible: '' }],
    progress: '',
    progressNote: '',
  }));
  return [...current.filter((g) => !isBlankTpGoal(g)), ...added].slice(0, 12);
}

/**
 * Same, into the Problem → Goal → Objective → Intervention plan: each picked goal goes under the
 * problem line it sat under in the document (quoted; matched to a problem already on the plan by
 * text, else a new problem with that text), or under the first problem when the document had none.
 * Interventions go under the goal's first objective. Blank problems / goals are replaced.
 */
export function addSuggestedGoalsToProblems(current: PlanProblem[], picked: SuggestedGoal[]): PlanProblem[] {
  const isBlankGoal = (g: PlanGoalNode) => !g.text.trim() && g.objectives.every((o) => !o.text.trim() && o.interventions.every((iv) => !iv.text.trim() && !iv.type));
  let problems = current
    .map((p) => ({ ...p, goals: p.goals.filter((g) => !isBlankGoal(g)) }))
    .filter((p) => p.text.trim() || p.goals.length || p.behavioralDescription || p.patientDescription);
  for (const g of picked) {
    const objectives = (g.objectives.length ? g.objectives : [{ text: '', sourceLines: [], targetDateInSource: null }]).map((o) => ({ ...emptyObjective(), text: o.text, interventions: [] as PlanIntervention[] }));
    objectives[0].interventions = g.interventions.length ? g.interventions.map((iv) => ({ ...emptyIntervention(), text: iv.text })) : [emptyIntervention()];
    const goal: PlanGoalNode = { ...emptyGoal(), text: g.text, objectives };
    const key = (g.problem || '').trim().toLowerCase();
    const idx = key ? problems.findIndex((p) => p.text.trim().toLowerCase() === key) : problems.length ? 0 : -1;
    if (idx >= 0) problems = problems.map((p, i) => (i === idx ? { ...p, goals: [...p.goals, goal] } : p));
    else problems = [...problems, { ...emptyProblem(undefined, [goal]), text: (g.problem || '').trim() }];
  }
  return problems.length ? problems : [emptyProblem()];
}
