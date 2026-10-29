'use client';

/**
 * Small presentational controls shared by the structured note templates.
 * Large tap targets (min 36px), keyboard-focusable, nothing selected by default.
 */
import { Plus, X } from 'lucide-react';
import type { Checklist, RowField, RowsState, Tri } from '@/lib/ehr/childPsychIntake';

export const inputCls =
  'w-full rounded-xl border border-slate-200 p-2.5 text-sm focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
export const smallBtn =
  'inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-50';
export const pillBtn = (on: boolean, tone: 'brand' | 'good' | 'bad' | 'warn' = 'brand') => {
  const onCls =
    tone === 'good' ? 'bg-emerald-600 text-white' : tone === 'bad' ? 'bg-rose-600 text-white' : tone === 'warn' ? 'bg-amber-500 text-white' : 'bg-blue-600 text-white';
  return `min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-600/30 ${
    on ? onCls : 'border border-slate-200 bg-white text-slate-600 hover:bg-blue-50'
  }`;
};

export function SourceTag({ text }: { text: string }) {
  return <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">Source: {text}</span>;
}

/** Single choice; clicking the chosen chip again clears it. */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  tone,
}: {
  options: readonly T[];
  value: T | '';
  onChange: (v: T | '') => void;
  ariaLabel: string;
  tone?: (option: T) => 'brand' | 'good' | 'bad' | 'warn';
}) {
  return (
    <span className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          className={pillBtn(value === o, tone?.(o))}
          onClick={() => onChange(value === o ? '' : o)}
        >
          {o}
        </button>
      ))}
    </span>
  );
}

export function MultiChips({
  options,
  values,
  onChange,
  ariaLabel,
}: {
  options: readonly string[];
  values: string[];
  onChange: (v: string[]) => void;
  ariaLabel: string;
}) {
  return (
    <span className="flex flex-wrap gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = values.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            className={pillBtn(on)}
            onClick={() => onChange(on ? values.filter((v) => v !== o) : [...values, o])}
          >
            {o}
          </button>
        );
      })}
    </span>
  );
}

const TRI: readonly Exclude<Tri, ''>[] = ['Denies', 'Endorses', 'Not assessed'];
export function TriChips({ value, onChange, label }: { value: Tri; onChange: (v: Tri) => void; label: string }) {
  return (
    <ChoiceChips
      options={TRI}
      value={value}
      onChange={(v) => onChange(v as Tri)}
      ariaLabel={label}
      tone={(o) => (o === 'Endorses' ? 'bad' : o === 'Denies' ? 'good' : 'brand')}
    />
  );
}

/** Repeatable rows (facility / dates / reason …) with a "None reported" chip. */
export function RowsEditor({
  fields,
  state,
  onChange,
  addLabel,
}: {
  fields: RowField[];
  state: RowsState;
  onChange: (s: RowsState) => void;
  addLabel: string;
}) {
  const setRow = (i: number, key: string, value: string) =>
    onChange({ ...state, none: false, rows: state.rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)) });
  return (
    <div className="space-y-2">
      {state.rows.map((r, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-2 sm:flex-row sm:flex-wrap sm:items-center">
          {fields.map((f) => (
            <input
              key={f.key}
              value={r[f.key] || ''}
              onChange={(e) => setRow(i, f.key, e.target.value)}
              placeholder={f.placeholder || f.label}
              aria-label={f.label}
              className="min-h-[36px] min-w-[120px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
            />
          ))}
          {r._source ? <span className="rounded bg-sky-50 px-1.5 text-[11px] font-semibold text-sky-700">{r._source}</span> : null}
          <button
            type="button"
            aria-label="Remove row"
            className={smallBtn}
            onClick={() => onChange({ ...state, rows: state.rows.filter((_, j) => j !== i) })}
          >
            <X size={12} />
          </button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={smallBtn} onClick={() => onChange({ none: false, rows: [...state.rows, {}] })}>
          <Plus size={12} /> {addLabel}
        </button>
        <button
          type="button"
          aria-pressed={state.none}
          disabled={state.rows.some((r) => fields.some((f) => (r[f.key] || '').trim()))}
          className={pillBtn(state.none, 'good')}
          onClick={() => onChange({ ...state, none: !state.none })}
        >
          None reported
        </button>
      </div>
    </div>
  );
}

/** Multi-select checklist + "None identified" + other text. */
export function ChecklistEditor({
  options,
  value,
  onChange,
  label,
  noneLabel = 'None identified',
}: {
  options: readonly string[];
  value: Checklist;
  onChange: (c: Checklist) => void;
  label: string;
  noneLabel?: string;
}) {
  return (
    <div className="space-y-2">
      <MultiChips options={options} values={value.items} onChange={(items) => onChange({ ...value, items, none: false })} ariaLabel={label} />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={value.none}
          disabled={value.items.length > 0 || Boolean(value.other.trim())}
          className={pillBtn(value.none, 'good')}
          onClick={() => onChange({ ...value, none: !value.none })}
        >
          {noneLabel}
        </button>
        <input
          value={value.other}
          onChange={(e) => onChange({ ...value, other: e.target.value, none: false })}
          placeholder="Other"
          aria-label={`${label} — other`}
          className="min-h-[36px] min-w-[160px] flex-1 rounded-lg border border-slate-200 p-1.5 text-xs"
        />
      </div>
    </div>
  );
}
