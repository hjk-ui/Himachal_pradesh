/**
 * Treatment plan content in the hierarchy of the practice's Valant "Valant Treatment Plan"
 * template: Problem → Goal → Objective → Intervention, with Valant's fields at each level, a
 * progress rating on goals and objectives, and the content libraries.
 *
 * Stored in the plan's template values as `tpProblems`. Plans saved before this structure kept
 * goals flat (`tpGoals`: goal → objectives + goal-level interventions); they are read forward
 * here (one unnamed problem, interventions under the goal's first objective) so nothing saved
 * earlier is lost. Pure: no Prisma, no React.
 */

// ─── Progress scale ─────────────────────────────────────────────────────────

/** Progress on a goal or objective (Valant progress scale as configured for the practice). */
export const PLAN_PROGRESS = ['Not started', 'Minimal', 'Moderate', 'Significant', 'Achieved', 'Discontinued'] as const;
export type PlanProgress = '' | (typeof PLAN_PROGRESS)[number];

/** Percent shown on the Treatment Plans list (Discontinued counts as no progress). */
export const PROGRESS_PERCENT: Record<PlanProgress, number> = {
  '': 0,
  'Not started': 0,
  Minimal: 25,
  Moderate: 50,
  Significant: 75,
  Achieved: 100,
  Discontinued: 0,
};

/**
 * A stored progress value on the Valant scale. Plans written before this release used the clinic
 * ITP Review form scale (None / Minimal / Satisfactory): None → Not started, Minimal → Minimal,
 * Satisfactory → Moderate (the conservative reading; the clinician re-rates at the next review).
 */
export function asPlanProgress(v: unknown): PlanProgress {
  const s = typeof v === 'string' ? v.trim() : '';
  if ((PLAN_PROGRESS as readonly string[]).includes(s)) return s as PlanProgress;
  if (s === 'None') return 'Not started';
  if (s === 'Satisfactory') return 'Moderate';
  return '';
}

// ─── Content libraries ──────────────────────────────────────────────────────

export type LibrarySourceId = 'valant' | 'practice' | 'wiley' | 'personal' | 'custom';

/**
 * The libraries the Valant template offered. Valant's own library and the Wiley PracticePlanners®
 * library are licensed third-party content: none of their text is in Altrixs. The practice can
 * rebuild what it uses in the Practice Library (its own wording; CSV import is planned).
 */
export const LIBRARY_SOURCES: readonly { id: LibrarySourceId; label: string; available: boolean; note: string }[] = [
  { id: 'valant', label: 'Valant Library', available: false, note: 'Licensed content — not included in Altrixs.' },
  { id: 'practice', label: 'Practice Library', available: true, note: 'Your practice’s own problems, goals, objectives and interventions (Goal Bank).' },
  { id: 'wiley', label: 'Wiley PracticePlanners® Library', available: false, note: 'Licensed content — not included in Altrixs.' },
  { id: 'personal', label: 'Provider’s Personal Library', available: true, note: 'Items you saved for your own plans.' },
  { id: 'custom', label: 'Custom', available: true, note: 'Typed on this plan.' },
];

/** Where a plan item came from. Only libraries Altrixs has can be a source. */
export type ItemSource = 'practice' | 'personal' | 'custom';
const ITEM_SOURCES: readonly ItemSource[] = ['practice', 'personal', 'custom'];

export type LibraryKind = 'problem' | 'goal' | 'objective' | 'intervention';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['problem', 'goal', 'objective', 'intervention'];

export type LibraryItem = {
  id: string;
  kind: LibraryKind;
  text: string;
  /** Free grouping (e.g. "Anxiety") */
  category: string;
  /** ICD-10 prefixes the item is suggested for (optional) */
  diagnosisCodes: string[];
  // Default field values copied onto the plan (all optional)
  behavioralDescription: string;
  strengths: string;
  responsibleParty: string;
  targetSessions: number | null;
  interventionType: string;
  frequency: string;
  length: string;
  duration: string;
  comment: string;
  updatedAt: string | null;
  updatedByName: string | null;
};

// ─── Plan nodes ─────────────────────────────────────────────────────────────

type NodeMeta = {
  id: string;
  /** Library the text came from ('custom' = typed on the plan) */
  source: ItemSource;
  libraryId: string | null;
  /** Copied forward from the plan this one reviews (the item was on an active plan) */
  carried: boolean;
};

export type PlanIntervention = NodeMeta & {
  /** Modality (CBT, DBT skills, …); optional */
  type: string;
  text: string;
  frequency: string;
  length: string;
  duration: string;
  /** Staff responsible (kept from plans written before this release) */
  responsible: string;
  comment: string;
};

export type PlanObjective = NodeMeta & {
  text: string;
  targetDate: string;
  targetSessions: number | null;
  patientDescription: string;
  comment: string;
  progress: PlanProgress;
  interventions: PlanIntervention[];
};

export type PlanGoalNode = NodeMeta & {
  text: string;
  responsibleParty: string;
  targetDate: string;
  targetSessions: number | null;
  patientDescription: string;
  comment: string;
  progress: PlanProgress;
  /** Progress comment (plan review) */
  progressNote: string;
  objectives: PlanObjective[];
};

export type PlanProblem = NodeMeta & {
  text: string;
  behavioralDescription: string;
  patientDescription: string;
  strengths: string;
  comment: string;
  goals: PlanGoalNode[];
};

export const MAX_PROBLEMS = 10;
export const MAX_GOALS_PER_PROBLEM = 8;
export const MAX_OBJECTIVES_PER_GOAL = 8;
export const MAX_INTERVENTIONS_PER_OBJECTIVE = 8;

const clean = (v: unknown, max = 4000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isoDay = (v: unknown) => {
  const s = clean(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '';
};
/** Target # of sessions: a whole number 1–999, else none */
export function asSessionCount(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 999 ? n : null;
}
const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown, max: number) => (Array.isArray(v) ? v : []).map(asObj).filter((x): x is Record<string, unknown> => Boolean(x)).slice(0, max);

let seq = 0;
/** Short unique id for a new node (client or server) */
export function newNodeId(prefix: 'P' | 'G' | 'O' | 'I'): string {
  seq = (seq + 1) % 1_000_000;
  return `${prefix}${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function meta(o: Record<string, unknown>, fallbackId: string): NodeMeta {
  const source = ITEM_SOURCES.includes(o.source as ItemSource) ? (o.source as ItemSource) : 'custom';
  const libraryId = source !== 'custom' ? clean(o.libraryId, 80) || null : null;
  return { id: clean(o.id, 80) || fallbackId, source: libraryId ? source : 'custom', libraryId, carried: o.carried === true };
}

function parseIntervention(o: Record<string, unknown>, id: string): PlanIntervention {
  return {
    ...meta(o, id),
    type: clean(o.type, 80),
    // Plans before this release kept the intervention text in `detail`
    text: clean(o.text ?? o.detail, 600),
    frequency: clean(o.frequency, 80),
    length: clean(o.length, 80),
    duration: clean(o.duration, 80),
    responsible: clean(o.responsible, 120),
    comment: clean(o.comment, 1000),
  };
}

function parseObjective(o: Record<string, unknown>, id: string): PlanObjective {
  return {
    ...meta(o, id),
    text: clean(o.text, 600),
    targetDate: isoDay(o.targetDate),
    targetSessions: asSessionCount(o.targetSessions),
    patientDescription: clean(o.patientDescription, 2000),
    comment: clean(o.comment, 2000),
    progress: asPlanProgress(o.progress),
    interventions: list(o.interventions, MAX_INTERVENTIONS_PER_OBJECTIVE).map((iv, k) => parseIntervention(iv, `${id}-I${k + 1}`)),
  };
}

function parseGoal(o: Record<string, unknown>, id: string): PlanGoalNode {
  return {
    ...meta(o, id),
    text: clean(o.text ?? o.goal, 600),
    responsibleParty: clean(o.responsibleParty, 200),
    targetDate: isoDay(o.targetDate),
    targetSessions: asSessionCount(o.targetSessions),
    patientDescription: clean(o.patientDescription, 2000),
    comment: clean(o.comment, 2000),
    progress: asPlanProgress(o.progress),
    progressNote: clean(o.progressNote, 1000),
    objectives: list(o.objectives, MAX_OBJECTIVES_PER_GOAL).map((ob, j) => parseObjective(ob, `${id}-O${j + 1}`)),
  };
}

function parseProblem(o: Record<string, unknown>, id: string): PlanProblem {
  return {
    ...meta(o, id),
    text: clean(o.text, 300),
    behavioralDescription: clean(o.behavioralDescription, 4000),
    patientDescription: clean(o.patientDescription, 4000),
    strengths: clean(o.strengths, 4000),
    comment: clean(o.comment, 4000),
    goals: list(o.goals, MAX_GOALS_PER_PROBLEM).map((g, i) => parseGoal(g, `${id}-G${i + 1}`)),
  };
}

/**
 * Goals saved before this release (`tpGoals`: goal, objectives {text, targetDate}, goal-level
 * interventions {type, detail, frequency, responsible}, progress None/Minimal/Satisfactory).
 * They become goals of one problem whose name is left blank for the clinician to enter (nothing
 * is invented); the goal's interventions go under its first objective.
 */
export function problemsFromLegacyGoals(rawGoals: unknown): PlanProblem[] {
  const goals = list(rawGoals, 12).map((g, i) => {
    const id = clean(g.id, 80) || `G${i + 1}`;
    const objectives = list(g.objectives, MAX_OBJECTIVES_PER_GOAL).map((o, j) => parseObjective({ text: o.text, targetDate: o.targetDate }, `${id}-O${j + 1}`));
    const interventions = list(g.interventions, MAX_INTERVENTIONS_PER_OBJECTIVE).map((iv, k) => parseIntervention(iv, `${id}-I${k + 1}`));
    if (interventions.length) {
      if (!objectives.length) objectives.push(parseObjective({}, `${id}-O1`));
      objectives[0] = { ...objectives[0], interventions };
    }
    return { ...parseGoal({ id, goal: g.goal, progress: g.progress, progressNote: g.progressNote }, id), objectives };
  });
  if (!goals.length) return [];
  return [{ ...parseProblem({ id: 'P1' }, 'P1'), goals }];
}

/** The plan's problems (current structure, or goals saved before it read forward). */
export function planProblems(values: Record<string, unknown>): PlanProblem[] {
  if (Array.isArray(values.tpProblems)) return list(values.tpProblems, MAX_PROBLEMS).map((p, i) => parseProblem(p, `P${i + 1}`));
  return problemsFromLegacyGoals(values.tpGoals);
}

// ─── Empty nodes / library use ──────────────────────────────────────────────

const base = (prefix: 'P' | 'G' | 'O' | 'I', id?: string): NodeMeta => ({ id: id || newNodeId(prefix), source: 'custom', libraryId: null, carried: false });

export function emptyIntervention(id?: string): PlanIntervention {
  return { ...base('I', id), type: '', text: '', frequency: '', length: '', duration: '', responsible: '', comment: '' };
}
export function emptyObjective(id?: string): PlanObjective {
  return { ...base('O', id), text: '', targetDate: '', targetSessions: null, patientDescription: '', comment: '', progress: '', interventions: [emptyIntervention()] };
}
export function emptyGoal(id?: string, text = ''): PlanGoalNode {
  return { ...base('G', id), text, responsibleParty: '', targetDate: '', targetSessions: null, patientDescription: '', comment: '', progress: '', progressNote: '', objectives: [emptyObjective()] };
}
export function emptyProblem(id?: string, goals: PlanGoalNode[] = [emptyGoal()]): PlanProblem {
  return { ...base('P', id), text: '', behavioralDescription: '', patientDescription: '', strengths: '', comment: '', goals };
}

/** A plan node from a library item (the item's text and default fields; the rest stays blank). */
export function nodeFromLibrary(item: LibraryItem, source: 'practice' | 'personal'): PlanProblem | PlanGoalNode | PlanObjective | PlanIntervention {
  const m = { source, libraryId: item.id, carried: false } as const;
  switch (item.kind) {
    case 'problem':
      return { ...emptyProblem(), ...m, text: item.text, behavioralDescription: item.behavioralDescription, strengths: item.strengths, comment: item.comment };
    case 'goal':
      return { ...emptyGoal(), ...m, text: item.text, responsibleParty: item.responsibleParty, targetSessions: item.targetSessions, comment: item.comment };
    case 'objective':
      return { ...emptyObjective(), ...m, text: item.text, targetSessions: item.targetSessions, comment: item.comment };
    case 'intervention':
      return { ...emptyIntervention(), ...m, type: item.interventionType, text: item.text, frequency: item.frequency, length: item.length, duration: item.duration, comment: item.comment };
  }
}

/** Library item from a plan node (saving to the Practice or Personal library). */
export function libraryItemFromNode(
  kind: LibraryKind,
  node: Partial<PlanProblem & PlanGoalNode & PlanObjective & PlanIntervention>,
  extra: { id: string; category?: string; updatedByName?: string | null; now: string }
): LibraryItem {
  return sanitizeLibraryItem({
    id: extra.id,
    kind,
    text: node.text,
    category: extra.category ?? '',
    behavioralDescription: node.behavioralDescription,
    strengths: node.strengths,
    responsibleParty: node.responsibleParty,
    targetSessions: node.targetSessions,
    interventionType: node.type,
    frequency: node.frequency,
    length: node.length,
    duration: node.duration,
    comment: node.comment,
    updatedAt: extra.now,
    updatedByName: extra.updatedByName ?? null,
  })!;
}

export function sanitizeLibraryItem(raw: unknown): LibraryItem | null {
  const o = asObj(raw);
  if (!o) return null;
  const kind = LIBRARY_KINDS.includes(o.kind as LibraryKind) ? (o.kind as LibraryKind) : null;
  const text = clean(o.text, 600);
  const id = clean(o.id, 80);
  if (!kind || !text || !id) return null;
  return {
    id,
    kind,
    text,
    category: clean(o.category, 80),
    diagnosisCodes: (Array.isArray(o.diagnosisCodes) ? o.diagnosisCodes : [])
      .map((c) => clean(c, 10).toUpperCase())
      .filter((c) => /^[A-Z]\d[0-9A-Z.]{0,6}$/.test(c))
      .slice(0, 12),
    behavioralDescription: clean(o.behavioralDescription, 4000),
    strengths: clean(o.strengths, 2000),
    responsibleParty: clean(o.responsibleParty, 200),
    targetSessions: asSessionCount(o.targetSessions),
    interventionType: clean(o.interventionType, 80),
    frequency: clean(o.frequency, 80),
    length: clean(o.length, 80),
    duration: clean(o.duration, 80),
    comment: clean(o.comment, 2000),
    updatedAt: clean(o.updatedAt, 40) || null,
    updatedByName: clean(o.updatedByName, 120) || null,
  };
}

export const MAX_LIBRARY_ITEMS = 2000;

export function sanitizeLibrary(raw: unknown): LibraryItem[] {
  const items = Array.isArray(raw) ? raw : asObj(raw) && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const seen = new Set<string>();
  const out: LibraryItem[] = [];
  for (const r of items) {
    const item = sanitizeLibraryItem(r);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
    if (out.length >= MAX_LIBRARY_ITEMS) break;
  }
  return out;
}

// ─── Walking the tree ───────────────────────────────────────────────────────

export type NodeRef = { kind: LibraryKind; node: PlanProblem | PlanGoalNode | PlanObjective | PlanIntervention };

export function walkNodes(problems: PlanProblem[]): NodeRef[] {
  const out: NodeRef[] = [];
  for (const p of problems) {
    out.push({ kind: 'problem', node: p });
    for (const g of p.goals) {
      out.push({ kind: 'goal', node: g });
      for (const o of g.objectives) {
        out.push({ kind: 'objective', node: o });
        for (const iv of o.interventions) out.push({ kind: 'intervention', node: iv });
      }
    }
  }
  return out;
}

/** Goals in plan order (numbered 1…n across problems; progress notes rate them by this number). */
export function allGoals(problems: PlanProblem[]): PlanGoalNode[] {
  return problems.flatMap((p) => p.goals);
}

/** Mark every node as copied forward from the active plan (plan review). Progress is cleared for re-rating. */
export function carryForward(problems: PlanProblem[]): PlanProblem[] {
  return problems.map((p) => ({
    ...p,
    carried: true,
    goals: p.goals.map((g) => ({
      ...g,
      carried: true,
      progress: '',
      progressNote: '',
      objectives: g.objectives.map((o) => ({ ...o, carried: true, progress: '', interventions: o.interventions.map((iv) => ({ ...iv, carried: true })) })),
    })),
  }));
}

// ─── Library editing rules ──────────────────────────────────────────────────

export type LibraryEditSettings = { libraryEditBeforeActive: boolean; libraryEditAfterActive: boolean };

/**
 * Can the text of a library item on this plan be changed? Custom items always can. A library
 * item copied forward from an active plan follows "edit after active"; one added to this draft
 * follows "edit before active" (Valant: providers can edit library components before / after the
 * plan is active, configurable). Dates, sessions, comments and progress are always editable.
 */
export function libraryTextEditable(node: NodeMeta, settings: LibraryEditSettings): boolean {
  if (node.source === 'custom' || !node.libraryId) return true;
  return node.carried ? settings.libraryEditAfterActive : settings.libraryEditBeforeActive;
}

/**
 * Server check of the library editing rules: a locked library item's text must still match the
 * library (added on this draft) or the plan it was copied from (carried forward). Items whose
 * library entry or prior plan is gone are not checked. Returns the first problem, or null.
 */
export function libraryEditViolation(
  problems: PlanProblem[],
  settings: LibraryEditSettings,
  lookup: { library: (source: 'practice' | 'personal', id: string) => string | null; prior: (nodeId: string) => string | null }
): string | null {
  for (const { kind, node } of walkNodes(problems)) {
    if (libraryTextEditable(node, settings)) continue;
    const expected = node.carried ? lookup.prior(node.id) : lookup.library(node.source as 'practice' | 'personal', node.libraryId!);
    if (expected == null) continue;
    if (expected.trim() !== node.text.trim()) {
      return `The ${kind} “${expected.slice(0, 80)}” comes from the ${node.source === 'practice' ? 'Practice' : 'Personal'} Library and practice settings do not allow editing library text ${node.carried ? 'after the plan is active' : 'before the plan is active'}. Add a custom ${kind} instead.`;
    }
  }
  return null;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Hierarchy rules before signing (messages; empty = fine). Every named problem has a goal, every
 * goal a measurable objective with a target date and at least one intervention (the clinic's
 * existing rule), nothing is left half-entered (an objective with interventions but no text, …),
 * and no target date falls before the plan start date. A review rates progress on every goal.
 */
export function hierarchyBlockers(problems: PlanProblem[], opts: { review: boolean; startDate: string | null }): string[] {
  const out: string[] = [];
  const goalHasContent = (g: PlanGoalNode) => Boolean(g.text || g.objectives.some((o) => o.text || o.interventions.some((iv) => iv.text || iv.type)));
  let goalNo = 0;
  problems.forEach((p, pi) => {
    const label = `Problem ${pi + 1}`;
    const named = p.goals.filter((g) => g.text);
    if (!p.text && (named.length || p.behavioralDescription || p.patientDescription)) out.push(`${label}: enter the problem.`);
    if (p.text && !named.length) out.push(`${label}: add at least one goal.`);
    for (const g of p.goals) {
      if (!goalHasContent(g)) continue;
      goalNo += 1;
      const gl = `Goal ${goalNo}`;
      if (!g.text) {
        out.push(`${gl}: enter the goal.`);
        continue;
      }
      if (!g.objectives.some((o) => o.text)) out.push(`${gl}: add at least one measurable objective.`);
      if (g.objectives.some((o) => o.text && !o.targetDate)) out.push(`${gl}: every objective needs a target date.`);
      g.objectives.forEach((o, oi) => {
        if (!o.text && o.interventions.some((iv) => iv.text || iv.type)) out.push(`Objective ${goalNo}.${oi + 1}: enter the objective (it has interventions).`);
      });
      if (!g.objectives.some((o) => o.interventions.some((iv) => iv.text || iv.type))) out.push(`${gl}: add at least one intervention.`);
      if (opts.startDate) {
        if (g.targetDate && g.targetDate < opts.startDate) out.push(`${gl}: target date ${g.targetDate} is before the plan start date (${opts.startDate}).`);
        g.objectives.forEach((o, oi) => {
          if (o.text && o.targetDate && o.targetDate < opts.startDate!) out.push(`Objective ${goalNo}.${oi + 1}: target date ${o.targetDate} is before the plan start date (${opts.startDate}).`);
        });
      }
      if (opts.review && !g.progress) out.push(`${gl}: rate progress since the last plan.`);
    }
  });
  return out;
}

// ─── Text ───────────────────────────────────────────────────────────────────

export function interventionLine(iv: PlanIntervention): string {
  const what = iv.type === 'Other' ? iv.text || 'Other' : [iv.type, iv.text].filter(Boolean).join(': ');
  const parts = [
    what,
    iv.frequency ? `Frequency: ${iv.frequency}` : '',
    iv.length ? `Length: ${iv.length}` : '',
    iv.duration ? `Duration: ${iv.duration}` : '',
    iv.responsible ? `by ${iv.responsible}` : '',
  ].filter(Boolean);
  return parts.join(' — ');
}

/**
 * Plan text for the hierarchy (what is signed). Goals are numbered 1…n across problems and
 * start at the line start; objectives are "Objective goal.n" with their target date.
 */
export function renderProblems(problems: PlanProblem[]): string {
  const lines: string[] = [];
  let goalNo = 0;
  const field = (indent: string, label: string, v: string | number | null) => {
    if (v === null || v === '') return;
    const s = String(v);
    lines.push(s.includes('\n') ? `${indent}${label}:\n${s.split('\n').map((l) => `${indent}  ${l}`).join('\n')}` : `${indent}${label}: ${s}`);
  };
  let problemNo = 0;
  problems.forEach((p) => {
    const goals = p.goals.filter((g) => g.text);
    if (!p.text && !goals.length) return;
    problemNo += 1;
    lines.push(`Problem ${problemNo}: ${p.text || '(problem not named)'}`);
    field('  ', 'Behavioral description', p.behavioralDescription);
    field('  ', 'Patient description', p.patientDescription);
    field('  ', 'Strengths', p.strengths);
    field('  ', 'Comment', p.comment);
    for (const g of goals) {
      goalNo += 1;
      lines.push(`Goal ${goalNo}: ${g.text}`);
      field('  ', 'Responsible party', g.responsibleParty);
      field('  ', 'Target date', g.targetDate);
      field('  ', 'Target # of sessions', g.targetSessions);
      field('  ', 'Patient’s description', g.patientDescription);
      field('  ', 'Comment', g.comment);
      if (g.progress) lines.push(`  Progress: ${g.progress}${g.progressNote ? ` — ${g.progressNote}` : ''}`);
      g.objectives
        .filter((o) => o.text)
        .forEach((o, oi) => {
          lines.push(`  Objective ${goalNo}.${oi + 1}: ${o.text}${o.targetDate ? ` (target ${o.targetDate})` : ' (target date not set)'}`);
          field('    ', 'Target # of sessions', o.targetSessions);
          field('    ', 'Patient’s description', o.patientDescription);
          field('    ', 'Comment', o.comment);
          if (o.progress) lines.push(`    Progress: ${o.progress}`);
          o.interventions
            .filter((iv) => iv.text || iv.type)
            .forEach((iv) => {
              lines.push(`    Intervention: ${interventionLine(iv)}`);
              field('      ', 'Comment', iv.comment);
            });
        });
    }
  });
  return lines.join('\n');
}

// ─── Progress history from progress notes ───────────────────────────────────

export type GoalProgressEntry = { date: string; noteId: string; status: string; level: PlanProgress; note: string };

const NOTE_GOAL_LINE = /^Goal (\d+): (.+?) — (Progress made|No change|Regression)(?: \(([^)]+)\))?(?: — (.*))?$/;

/** One progress note's "Treatment Plan Goals" lines (written by renderPlanGoals). */
export function parseNoteGoalLines(text: string): { n: number; goal: string; status: string; level: PlanProgress; note: string }[] {
  const out: { n: number; goal: string; status: string; level: PlanProgress; note: string }[] = [];
  for (const raw of text.split('\n')) {
    const m = raw.trim().match(NOTE_GOAL_LINE);
    if (!m) continue;
    out.push({ n: Number(m[1]), goal: m[2].trim(), status: m[3], level: asPlanProgress(m[4] ?? ''), note: (m[5] ?? '').trim() });
  }
  return out;
}

/**
 * Per-goal history from signed progress notes (newest first, up to `limit` per goal). A note
 * line is matched to the goal by its text (goal numbers can shift between plan versions).
 */
export function goalProgressHistory(
  goals: { id: string; text: string }[],
  notes: { noteId: string; date: string; goalsText: string }[],
  limit = 6
): Record<string, GoalProgressEntry[]> {
  const byText = new Map(goals.map((g) => [g.text.trim().toLowerCase(), g.id]));
  const out: Record<string, GoalProgressEntry[]> = {};
  const sorted = [...notes].sort((a, b) => b.date.localeCompare(a.date));
  for (const n of sorted) {
    for (const line of parseNoteGoalLines(n.goalsText)) {
      const id = byText.get(line.goal.toLowerCase());
      if (!id) continue;
      const arr = (out[id] ||= []);
      if (arr.length < limit) arr.push({ date: n.date, noteId: n.noteId, status: line.status, level: line.level, note: line.note });
    }
  }
  return out;
}
