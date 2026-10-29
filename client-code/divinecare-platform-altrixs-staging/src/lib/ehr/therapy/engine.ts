/**
 * Declarative template engine for the therapist templates.
 *
 * A template is a list of sections; each section is a list of fields (chips, pick-lists, short
 * text, narrative, small tables) or widgets (MSE, diagnoses, C-SSRS, safety plan, chart
 * medications, treatment plan goals, ASAM, session header). The editor keeps field values; this
 * module turns them into note text, one "Label: value" line per answered field, so the note
 * prints and reads like any other note.
 *
 * Sign rules are text-based (they read the saved note body), so the editor, the note view and
 * the server apply exactly the same checks. Nothing is pre-selected and nothing is written for a
 * field the clinician did not answer.
 */

export type TemplateCtx = { minor: boolean; telehealth: boolean };

/** Show / require a field or section only when … (all given keys must hold) */
export type When = {
  minor?: boolean;
  telehealth?: boolean;
  /** Another field's id */
  field?: string;
  /** …whose value is one of these (single / tri) */
  is?: string | readonly string[];
  /** …whose value contains this option (multi) or any of these options */
  includes?: string | readonly string[];
  /** …that has any answer */
  notEmpty?: boolean;
};

export type RowColumn = { key: string; label: string; options?: readonly string[]; placeholder?: string; kind?: 'text' | 'date' | 'number' };

export type WidgetKind = 'session' | 'identifyingInfo' | 'mse' | 'diagnoses' | 'cssrs' | 'safetyPlan' | 'chartMeds' | 'planGoals' | 'asam' | 'tpGoals';

type FieldBase = {
  id: string;
  label: string;
  when?: When;
  /** Blocks signing when visible and unanswered (billing / compliance only) */
  required?: boolean;
  /** Listed under "Check before signing" when unanswered */
  recommended?: boolean;
  hint?: string;
  placeholder?: string;
  /** Where the field comes from (shown in docs/therapist-templates.md) */
  origin?: 'clinic-form' | 'standard';
};

export type FieldDef =
  | (FieldBase & { kind: 'text' | 'date' | 'time' | 'number' })
  | (FieldBase & { kind: 'textarea'; rows?: number; ai?: boolean; bare?: boolean })
  | (FieldBase & { kind: 'single'; options: readonly string[]; warn?: readonly string[]; other?: boolean })
  | (FieldBase & { kind: 'multi'; options: readonly string[]; other?: boolean; noneOption?: string })
  | (FieldBase & { kind: 'tri'; detailsLabel?: string })
  | (FieldBase & { kind: 'rows'; columns: readonly RowColumn[]; addLabel: string; noneLabel?: string })
  | (FieldBase & { kind: 'widget'; widget: WidgetKind });

export type SectionDef = {
  heading: string;
  when?: When;
  intro?: string;
  fields: readonly FieldDef[];
};

export type Values = Record<string, unknown>;
export type RowsValue = { none: boolean; rows: Record<string, string>[] };

export const TRI_OPTIONS = ['Denies', 'Endorses', 'Not assessed'] as const;

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
export const strVal = (values: Values, id: string) => clean(values[id]);
export const arrVal = (values: Values, id: string): string[] =>
  Array.isArray(values[id]) ? (values[id] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
export function rowsVal(values: Values, id: string): RowsValue {
  const v = values[id] as Partial<RowsValue> | undefined;
  return {
    none: Boolean(v && v.none),
    rows: Array.isArray(v?.rows) ? v!.rows.filter((r): r is Record<string, string> => Boolean(r) && typeof r === 'object') : [],
  };
}
export const detailsId = (id: string) => `${id}__details`;
export const otherId = (id: string) => `${id}__other`;

// ─── Conditions ─────────────────────────────────────────────────────────────

export function fieldIndex(sections: readonly SectionDef[]): Map<string, { field: FieldDef; heading: string }> {
  const map = new Map<string, { field: FieldDef; heading: string }>();
  for (const s of sections) for (const f of s.fields) map.set(f.id, { field: f, heading: s.heading });
  return map;
}

const asList = (v: string | readonly string[] | undefined) => (v == null ? [] : typeof v === 'string' ? [v] : [...v]);

function whenHolds(when: When | undefined, ctx: TemplateCtx, read: (id: string) => { single: string; multi: string[] }): boolean {
  if (!when) return true;
  if (when.minor !== undefined && when.minor !== ctx.minor) return false;
  if (when.telehealth !== undefined && when.telehealth !== ctx.telehealth) return false;
  if (when.field) {
    const v = read(when.field);
    if (when.is !== undefined && !asList(when.is).includes(v.single)) return false;
    if (when.includes !== undefined && !asList(when.includes).some((o) => v.multi.includes(o) || v.single === o)) return false;
    if (when.notEmpty && !v.single && !v.multi.length) return false;
  }
  return true;
}

/** Condition from the editor's values */
export function visibleFromValues(when: When | undefined, ctx: TemplateCtx, values: Values): boolean {
  return whenHolds(when, ctx, (id) => ({ single: strVal(values, id), multi: arrVal(values, id) }));
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderRowsLines(f: Extract<FieldDef, { kind: 'rows' }>, v: RowsValue): string[] {
  const rows = v.rows
    .map((r) => f.columns.map((c) => (clean(r[c.key]) ? `${c.label}: ${clean(r[c.key])}` : '')).filter(Boolean).join('; '))
    .filter(Boolean);
  if (rows.length) return [`${f.label}:`, ...rows.map((r) => `- ${r}`)];
  if (v.none) return [`${f.label}: ${f.noneLabel || 'None reported'}`];
  return [];
}

/** Text for one field ('' when unanswered). Widgets come pre-rendered in `widgets`. */
export function renderField(f: FieldDef, values: Values, widgets: Record<string, string>): string {
  switch (f.kind) {
    case 'widget':
      return clean(widgets[f.id]);
    case 'textarea': {
      const t = strVal(values, f.id);
      if (!t) return '';
      if (f.bare) return t;
      return t.includes('\n') ? `${f.label}:\n${t}` : `${f.label}: ${t}`;
    }
    case 'single': {
      const v = strVal(values, f.id);
      if (!v) return '';
      const other = v === 'Other' && strVal(values, otherId(f.id)) ? ` (${strVal(values, otherId(f.id))})` : '';
      return `${f.label}: ${v}${other}`;
    }
    case 'multi': {
      const items = arrVal(values, f.id);
      const other = f.other ? strVal(values, otherId(f.id)) : '';
      const all = [...items, ...(other ? [other] : [])];
      return all.length ? `${f.label}: ${all.join(', ')}` : '';
    }
    case 'tri': {
      const v = strVal(values, f.id);
      if (!v) return '';
      const d = strVal(values, detailsId(f.id));
      return `${f.label}: ${v}${v === 'Endorses' && d ? ` — ${d}` : ''}`;
    }
    case 'rows':
      return renderRowsLines(f, rowsVal(values, f.id)).join('\n');
    default: {
      const v = strVal(values, f.id);
      return v ? `${f.label}: ${v}` : '';
    }
  }
}

/** Generated text for a section: answered fields in order. */
export function renderSection(section: SectionDef, values: Values, ctx: TemplateCtx, widgets: Record<string, string>): string {
  if (!visibleFromValues(section.when, ctx, values)) return '';
  return section.fields
    .filter((f) => visibleFromValues(f.when, ctx, values))
    .map((f) => renderField(f, values, widgets))
    .filter(Boolean)
    .join('\n');
}

// ─── Reading note text back (server / note view) ────────────────────────────

/** Value of "Label: value" in a section ('' when missing). A label line with nothing after the colon reads the next line. */
export function lineValue(sectionText: string, label: string): string {
  const lines = sectionText.split('\n');
  const prefix = `${label}:`;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith(prefix)) continue;
    const rest = l.slice(prefix.length).trim();
    if (rest) return rest;
    const next = (lines[i + 1] || '').trim();
    return next;
  }
  return '';
}

/** Template context recovered from the note text (age line in the Session section, visit type). */
export function ctxFromText(sessionText: string): TemplateCtx {
  const age = sessionText.match(/\(age (\d{1,3})\)/);
  return {
    minor: age ? Number(age[1]) < 18 : false,
    telehealth: /^Visit type: Telehealth/m.test(sessionText),
  };
}

function textReader(index: Map<string, { field: FieldDef; heading: string }>, sectionText: (heading: string) => string) {
  return (id: string) => {
    const hit = index.get(id);
    if (!hit) return { single: '', multi: [] as string[] };
    const v = lineValue(sectionText(hit.heading), hit.field.label);
    if (hit.field.kind === 'tri') return { single: v.split(' — ')[0].trim(), multi: [] };
    return { single: v, multi: v ? v.split(',').map((s) => s.trim()) : [] };
  };
}

export type TextIssue = { message: string; heading: string | null };

/** Widget evidence in note text: what a completed widget writes. */
export const WIDGET_TEXT_CHECKS: Record<WidgetKind, (sectionText: string) => boolean> = {
  session: () => true,
  // Own sign rules (chief complaint, modality, a minor's guardian): src/lib/ehr/identifyingInfo.ts via notes/standard noteTypeIssues
  identifyingInfo: () => true,
  mse: (t) => t.trim().length > 0,
  diagnoses: (t) => /^\d+\.\s+[A-TV-Z]\d/m.test(t),
  cssrs: (t) => /^C-SSRS screen result:/m.test(t),
  safetyPlan: (t) => /^Stanley-Brown safety plan:\n.+:/m.test(t) || /^Safety plan on file reviewed:/m.test(t),
  chartMeds: (t) => /^Current medications/m.test(t),
  planGoals: (t) => /^Goal \d+: .+ — (Progress made|No change|Regression)/m.test(t),
  asam: (t) => (t.match(/^Dimension \d — .+: [0-4]/gm) || []).length === 6,
  tpGoals: (t) => /^Goal \d+:/m.test(t) && /^\s*Objective \d+\.\d+: .+ \(target \d{4}-\d{2}-\d{2}\)/m.test(t) && /^\s*Intervention: /m.test(t),
};

function fieldAnswered(f: FieldDef, sectionText: string): boolean {
  if (f.kind === 'widget') return WIDGET_TEXT_CHECKS[f.widget](sectionText);
  if (f.kind === 'textarea' && f.bare) return sectionText.trim().length > 0;
  if (f.kind === 'rows') {
    const lines = sectionText.split('\n');
    const i = lines.findIndex((l) => l.trim().startsWith(`${f.label}:`));
    if (i === -1) return false;
    const rest = lines[i].trim().slice(f.label.length + 1).trim();
    return Boolean(rest) || (lines[i + 1] || '').trim().startsWith('- ');
  }
  return lineValue(sectionText, f.label).length > 0;
}

/**
 * Required / recommended fields that are missing in the note text. `sectionText(heading)` reads
 * the saved body; conditions are evaluated from the same text.
 */
export function missingFields(
  sections: readonly SectionDef[],
  sectionText: (heading: string) => string,
  /** Heading whose text carries the age / visit-type lines, or the context itself */
  context: string | TemplateCtx
): { required: TextIssue[]; recommended: TextIssue[] } {
  const ctx = typeof context === 'string' ? ctxFromText(sectionText(context)) : context;
  const index = fieldIndex(sections);
  const read = textReader(index, sectionText);
  const required: TextIssue[] = [];
  const recommended: TextIssue[] = [];
  for (const s of sections) {
    if (!whenHolds(s.when, ctx, read)) continue;
    const text = sectionText(s.heading);
    for (const f of s.fields) {
      if (!f.required && !f.recommended) continue;
      if (!whenHolds(f.when, ctx, read)) continue;
      if (fieldAnswered(f, text)) continue;
      const issue = { message: `${s.heading}: ${f.label} ${f.required ? 'is required' : 'is not documented'}.`, heading: s.heading };
      (f.required ? required : recommended).push(issue);
    }
  }
  return { required, recommended };
}

/** Same check from the editor's values (section status dots before the text is regenerated). */
export function missingFromValues(sections: readonly SectionDef[], values: Values, ctx: TemplateCtx, widgets: Record<string, string>) {
  const out: { heading: string; fieldId: string; required: boolean }[] = [];
  for (const s of sections) {
    if (!visibleFromValues(s.when, ctx, values)) continue;
    for (const f of s.fields) {
      if (!f.required && !f.recommended) continue;
      if (!visibleFromValues(f.when, ctx, values)) continue;
      const text = renderField(f, values, widgets);
      if (f.kind === 'widget' ? WIDGET_TEXT_CHECKS[f.widget](text) : text) continue;
      out.push({ heading: s.heading, fieldId: f.id, required: Boolean(f.required) });
    }
  }
  return out;
}

// ─── Reopening a saved draft ────────────────────────────────────────────────

function parseFieldValue(f: FieldDef, raw: string): { value: unknown; extra?: Record<string, unknown> } | null {
  const v = raw.trim();
  if (!v) return null;
  switch (f.kind) {
    case 'single': {
      if (f.options.includes(v)) return { value: v };
      const m = v.match(/^Other \((.+)\)$/);
      if (f.other && m) return { value: 'Other', extra: { [otherId(f.id)]: m[1] } };
      return null;
    }
    case 'multi': {
      const parts = v.split(', ').map((p) => p.trim()).filter(Boolean);
      const known = parts.filter((p) => f.options.includes(p));
      const unknown = parts.filter((p) => !f.options.includes(p));
      if (unknown.length && !f.other) return null;
      return { value: known, extra: unknown.length ? { [otherId(f.id)]: unknown.join(', ') } : undefined };
    }
    case 'tri': {
      const [answer, ...rest] = v.split(' — ');
      if (!(TRI_OPTIONS as readonly string[]).includes(answer.trim())) return null;
      return { value: answer.trim(), extra: rest.length ? { [detailsId(f.id)]: rest.join(' — ') } : undefined };
    }
    default:
      return { value: v };
  }
}

/**
 * Field values recovered from a saved draft's section text ("Label: value" lines), plus the text
 * that is not a field line (kept as the section's free text). Lets a reopened draft show its chips
 * again instead of duplicating text. Widgets and unlabeled narrative stay in the free text.
 */
export function restoreValues(
  sections: readonly SectionDef[],
  saved: Record<string, string>,
  /** Lines (by prefix) regenerated by a widget, dropped from the free text */
  regeneratedPrefixes: Record<string, readonly string[]> = {}
): { values: Values; leftover: Record<string, string> } {
  const values: Values = {};
  const leftover: Record<string, string> = {};
  for (const s of sections) {
    const lines = (saved[s.heading] || '').split('\n');
    const used = new Set<number>();
    const labels = s.fields.filter((f) => f.kind !== 'widget' && !(f.kind === 'textarea' && f.bare)).map((f) => `${f.label}:`);
    const isLabelLine = (l: string) => labels.some((p) => l.trim().startsWith(p));
    for (const f of s.fields) {
      if (f.kind === 'widget' || (f.kind === 'textarea' && f.bare)) continue;
      const i = lines.findIndex((l, idx) => !used.has(idx) && l.trim().startsWith(`${f.label}:`));
      if (i === -1) continue;
      const rest = lines[i].trim().slice(f.label.length + 1).trim();
      if (f.kind === 'rows') {
        const rows: Record<string, string>[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim().startsWith('- ')) {
          const row: Record<string, string> = {};
          for (const part of lines[j].trim().slice(2).split('; ')) {
            const col = f.columns.find((c) => part.startsWith(`${c.label}: `));
            if (col) row[col.key] = part.slice(col.label.length + 2).trim();
          }
          rows.push(row);
          used.add(j);
          j++;
        }
        if (rows.length || rest) {
          values[f.id] = { none: !rows.length && Boolean(rest), rows };
          used.add(i);
        }
        continue;
      }
      if (f.kind === 'textarea' && !rest) {
        const body: string[] = [];
        let j = i + 1;
        while (j < lines.length && lines[j].trim() && !isLabelLine(lines[j])) {
          body.push(lines[j]);
          used.add(j);
          j++;
        }
        if (body.length) {
          values[f.id] = body.join('\n').trim();
          used.add(i);
        }
        continue;
      }
      const parsed = parseFieldValue(f, rest);
      if (!parsed) continue;
      values[f.id] = parsed.value;
      if (parsed.extra) Object.assign(values, parsed.extra);
      used.add(i);
    }
    const prefixes = regeneratedPrefixes[s.heading] || [];
    leftover[s.heading] = lines
      .filter((l, idx) => !used.has(idx) && !prefixes.some((p) => l.trim().startsWith(p)))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
  return { values, leftover };
}
