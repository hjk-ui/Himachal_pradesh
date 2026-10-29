'use client';

/**
 * Generic inputs for the therapist template engine (src/lib/ehr/therapy/engine.ts): chips,
 * pick-lists, short text, narrative and small tables. Widgets (MSE, diagnoses, C-SSRS …) are
 * rendered by the editors. Nothing is selected by default; clicking a chosen chip clears it.
 */
import { Plus, X } from 'lucide-react';
import { ChoiceChips, MultiChips, TriChips, inputCls, pillBtn, smallBtn } from '@/components/notes/structuredNoteUi';
import {
  arrVal,
  detailsId,
  otherId,
  rowsVal,
  strVal,
  type FieldDef,
  type RowsValue,
  type Values,
} from '@/lib/ehr/therapy/engine';
import type { Tri } from '@/lib/ehr/childPsychIntake';

export type SetValue = (id: string, value: unknown) => void;

function Label({ field, missing }: { field: FieldDef; missing: 'required' | 'recommended' | null }) {
  return (
    <span className="mb-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-600">
      {field.label}
      {field.required ? <span className="text-rose-600">*</span> : null}
      {missing === 'required' ? <span className="rounded bg-rose-50 px-1.5 text-[11px] font-semibold text-rose-700">Required to sign</span> : null}
      {field.hint ? <span className="font-normal text-slate-500">— {field.hint}</span> : null}
    </span>
  );
}

function RowsTable({ field, value, onChange }: { field: Extract<FieldDef, { kind: 'rows' }>; value: RowsValue; onChange: (v: RowsValue) => void }) {
  const setCell = (i: number, key: string, v: string) =>
    onChange({ none: false, rows: value.rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)) });
  const anyFilled = value.rows.some((r) => field.columns.some((c) => (r[c.key] || '').trim()));
  return (
    <div className="space-y-2">
      {value.rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2 sm:flex-row sm:flex-wrap sm:items-center">
          {field.columns.map((c) =>
            c.options ? (
              <select
                key={c.key}
                aria-label={c.label}
                value={r[c.key] || ''}
                onChange={(e) => setCell(i, c.key, e.target.value)}
                className="min-h-[36px] min-w-[130px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
              >
                <option value="">{c.label}</option>
                {r[c.key] && !c.options.includes(r[c.key]) ? <option value={r[c.key]}>{r[c.key]}</option> : null}
                {c.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                key={c.key}
                type={c.kind === 'number' ? 'number' : c.kind === 'date' ? 'date' : 'text'}
                inputMode={c.kind === 'number' ? 'numeric' : undefined}
                aria-label={c.label}
                value={r[c.key] || ''}
                onChange={(e) => setCell(i, c.key, e.target.value)}
                placeholder={c.placeholder || c.label}
                className="min-h-[36px] min-w-[110px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
              />
            )
          )}
          <button type="button" aria-label="Remove row" className={smallBtn} onClick={() => onChange({ ...value, rows: value.rows.filter((_, j) => j !== i) })}>
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallBtn} onClick={() => onChange({ none: false, rows: [...value.rows, {}] })}>
          <Plus size={12} /> {field.addLabel}
        </button>
        {field.noneLabel !== undefined || field.kind === 'rows' ? (
          <button type="button" aria-pressed={value.none} disabled={anyFilled} className={pillBtn(value.none, 'good')} onClick={() => onChange({ ...value, none: !value.none })}>
            {field.noneLabel || 'None reported'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** One non-widget field. */
export function TemplateField({
  field,
  values,
  set,
  missing,
}: {
  field: FieldDef;
  values: Values;
  set: SetValue;
  missing: 'required' | 'recommended' | null;
}) {
  const id = `tf-${field.id}`;
  switch (field.kind) {
    case 'widget':
      return null;
    case 'text':
    case 'date':
    case 'time':
    case 'number':
      return (
        <label htmlFor={id} className="block">
          <Label field={field} missing={missing} />
          <input
            id={id}
            type={field.kind === 'text' ? 'text' : field.kind}
            inputMode={field.kind === 'number' ? 'numeric' : undefined}
            value={strVal(values, field.id)}
            onChange={(e) => set(field.id, e.target.value)}
            placeholder={field.placeholder}
            className={`${inputCls} ${field.kind === 'text' ? '' : 'sm:max-w-xs'}`}
          />
        </label>
      );
    case 'textarea':
      return (
        <label htmlFor={id} className="block">
          <Label field={field} missing={missing} />
          <textarea id={id} rows={field.rows ?? 3} value={strVal(values, field.id)} onChange={(e) => set(field.id, e.target.value)} placeholder={field.placeholder} className={`${inputCls} resize-y`} />
        </label>
      );
    case 'single': {
      const v = strVal(values, field.id);
      return (
        <div>
          <Label field={field} missing={missing} />
          <ChoiceChips
            options={field.options}
            value={v}
            onChange={(next) => set(field.id, next)}
            ariaLabel={field.label}
            tone={(o) => (field.warn?.includes(o) ? 'warn' : 'brand')}
          />
          {field.other && v === 'Other' ? (
            <input aria-label={`${field.label} — other`} value={strVal(values, otherId(field.id))} onChange={(e) => set(otherId(field.id), e.target.value)} placeholder="Specify" className={`mt-2 ${inputCls}`} />
          ) : null}
        </div>
      );
    }
    case 'multi':
      return (
        <div>
          <Label field={field} missing={missing} />
          <MultiChips options={field.options} values={arrVal(values, field.id)} onChange={(next) => set(field.id, next)} ariaLabel={field.label} />
          {field.other ? (
            <input aria-label={`${field.label} — other`} value={strVal(values, otherId(field.id))} onChange={(e) => set(otherId(field.id), e.target.value)} placeholder="Other" className={`mt-2 ${inputCls}`} />
          ) : null}
        </div>
      );
    case 'tri': {
      const v = strVal(values, field.id) as Tri;
      return (
        <div>
          <Label field={field} missing={missing} />
          <TriChips value={v} onChange={(next) => set(field.id, next)} label={field.label} />
          {v === 'Endorses' ? (
            <input
              aria-label={`${field.label} — details`}
              value={strVal(values, detailsId(field.id))}
              onChange={(e) => set(detailsId(field.id), e.target.value)}
              placeholder={field.detailsLabel || 'Details'}
              className={`mt-2 ${inputCls}`}
            />
          ) : null}
        </div>
      );
    }
    case 'rows':
      return (
        <div>
          <Label field={field} missing={missing} />
          <RowsTable field={field} value={rowsVal(values, field.id)} onChange={(v) => set(field.id, v)} />
        </div>
      );
  }
}

/** "Goes into the note" preview of a section's generated text. */
export function GeneratedPreview({ text, label = 'Goes into the note' }: { text: string; label?: string }) {
  if (!text.trim()) return null;
  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-blue-600">{label}</p>
      <pre className="whitespace-pre-wrap font-sans text-xs leading-5 text-slate-700">{text}</pre>
    </div>
  );
}
