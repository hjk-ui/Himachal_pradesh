'use client';

import React from 'react';
import { Plus, Trash2, Database } from 'lucide-react';
import {
  YES_NO,
  YES_NO_UNKNOWN,
  fieldRequired,
  fieldVisible,
  sectionVisible,
  type ColumnSpec,
  type FieldSpec,
  type FormData,
  type FormDefinition,
} from '@/lib/aot/forms';

type Props = {
  def: FormDefinition;
  data: FormData;
  onChange: (next: FormData) => void;
  readOnly?: boolean;
  /** key -> where the value was prefilled from */
  prefilled?: Record<string, string>;
};

const inputCls =
  'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-slate-50 disabled:text-slate-600';

function ChoiceGroup({ name, options, value, onChange, disabled }: { name: string; options: { value: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-center gap-1.5 text-sm text-slate-700">
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled} onChange={() => onChange(o.value)} className="accent-blue-600" />
          {o.label}
        </label>
      ))}
      {!disabled && value && (
        <button type="button" onClick={() => onChange('')} className="text-[11px] text-slate-500 hover:text-slate-600 underline">
          clear
        </button>
      )}
    </div>
  );
}

function CheckGroup({ options, value, onChange, disabled }: { options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
      {options.map((o) => (
        <label key={o.value} className="inline-flex items-start gap-1.5 text-sm text-slate-700">
          <input
            type="checkbox"
            className="mt-0.5 accent-blue-600"
            checked={value.includes(o.value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

function Cell({ col, value, onChange, disabled }: { col: ColumnSpec; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  if (col.readonly) return <span className="text-sm text-slate-800">{String(value ?? '')}</span>;
  switch (col.type) {
    case 'checkbox':
      return <input type="checkbox" className="accent-blue-600" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />;
    case 'checkboxes':
      return (
        <div className="space-y-1">
          {(col.options ?? []).map((o) => {
            const list = Array.isArray(value) ? (value as string[]) : [];
            return (
              <label key={o.value} className="flex items-center gap-1 text-xs text-slate-700 whitespace-nowrap">
                <input
                  type="checkbox"
                  className="accent-blue-600"
                  checked={list.includes(o.value)}
                  disabled={disabled}
                  onChange={(e) => onChange(e.target.checked ? [...list, o.value] : list.filter((x) => x !== o.value))}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      );
    case 'select':
    case 'yesno': {
      const options = col.type === 'yesno' ? YES_NO : col.options ?? [];
      return (
        <select className={inputCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }
    case 'date':
      return <input type="date" className={inputCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    case 'textarea':
      return <textarea rows={2} className={inputCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
    default:
      return <input className={inputCls} value={String(value ?? '')} disabled={disabled} onChange={(e) => onChange(e.target.value)} />;
  }
}

function TableField({ f, value, onChange, disabled }: { f: FieldSpec; value: unknown; onChange: (v: unknown) => void; disabled?: boolean }) {
  const list = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  const cols = f.columns ?? [];
  const setCell = (i: number, k: string, v: unknown) => onChange(list.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const wide = cols.length > 5;
  return (
    <div className="space-y-2">
      {wide ? (
        // Many columns (recommended services, medications): one card per row
        list.map((r, i) => (
          <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500">Row {i + 1}</p>
              {!disabled && !f.fixedRows && (
                <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-600" aria-label={`Remove row ${i + 1}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {cols.map((c) => (
                <label key={c.key} className="block">
                  <span className="block text-[11px] font-semibold text-slate-500 mb-0.5">{c.label}</span>
                  <Cell col={c} value={r[c.key]} disabled={disabled} onChange={(v) => setCell(i, c.key, v)} />
                </label>
              ))}
            </div>
          </div>
        ))
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-600">
                {cols.map((c) => (
                  <th key={c.key} scope="col" className="px-1.5 py-1 font-semibold">{c.label}</th>
                ))}
                {!disabled && !f.fixedRows && <th scope="col" className="w-8"><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i} className="align-top border-t border-slate-100">
                  {cols.map((c) => (
                    <td key={c.key} className="px-1.5 py-1.5">
                      <Cell col={c} value={r[c.key]} disabled={disabled} onChange={(v) => setCell(i, c.key, v)} />
                    </td>
                  ))}
                  {!disabled && !f.fixedRows && (
                    <td className="px-1 py-1.5">
                      <button type="button" onClick={() => onChange(list.filter((_, j) => j !== i))} className="text-slate-500 hover:text-rose-600" aria-label={`Remove row ${i + 1}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length === 0 && <p className="text-xs text-slate-500">No rows.</p>}
      {!disabled && !f.fixedRows && list.length < (f.maxRows ?? 60) && (
        <button
          type="button"
          onClick={() => onChange([...list, Object.fromEntries(cols.map((c) => [c.key, c.type === 'checkbox' ? false : c.type === 'checkboxes' ? [] : '']))])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline"
        >
          <Plus className="h-3.5 w-3.5" /> Add row
        </button>
      )}
    </div>
  );
}

function Field({ f, data, set, readOnly, source }: { f: FieldSpec; data: FormData; set: (k: string, v: unknown) => void; readOnly?: boolean; source?: string }) {
  const v = data[f.key];
  const disabled = readOnly || f.readonly;
  const required = fieldRequired(f, data);
  if (f.type === 'static') {
    return (
      <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        {f.num ? <strong>{f.num}. </strong> : null}
        {f.text}
      </p>
    );
  }
  const label = (
    <span className="block text-xs font-semibold text-slate-700 mb-1">
      {f.num ? <span className="text-slate-500">{f.num}. </span> : null}
      {f.label}
      {required && <span className="text-rose-600"> *</span>}
    </span>
  );
  let control: React.ReactNode;
  switch (f.type) {
    case 'textarea':
      control = <textarea rows={4} className={inputCls} value={String(v ?? '')} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />;
      break;
    case 'date':
    case 'time':
    case 'email':
    case 'tel':
      control = <input type={f.type} className={inputCls} value={String(v ?? '')} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />;
      break;
    case 'amount':
      control = <input inputMode="decimal" placeholder="$" className={inputCls} value={String(v ?? '')} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />;
      break;
    case 'yesno':
    case 'yesnounknown':
    case 'radio':
      control = (
        <ChoiceGroup
          name={f.key}
          options={f.type === 'yesno' ? YES_NO : f.type === 'yesnounknown' ? YES_NO_UNKNOWN : f.options ?? []}
          value={String(v ?? '')}
          disabled={disabled}
          onChange={(x) => set(f.key, x)}
        />
      );
      break;
    case 'select':
      control = (
        <select className={inputCls} value={String(v ?? '')} disabled={disabled} onChange={(e) => set(f.key, e.target.value)}>
          <option value="">—</option>
          {(f.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    case 'checkboxes':
      control = <CheckGroup options={f.options ?? []} value={Array.isArray(v) ? (v as string[]) : []} disabled={disabled} onChange={(x) => set(f.key, x)} />;
      break;
    case 'checkbox':
      return (
        <div>
          <label className="flex items-start gap-2 text-sm text-slate-800">
            <input type="checkbox" className="mt-0.5 accent-blue-600" checked={v === true} disabled={disabled} onChange={(e) => set(f.key, e.target.checked)} />
            <span>
              {f.num ? <strong>{f.num}. </strong> : null}
              {f.label}
              {required && <span className="text-rose-600"> *</span>}
            </span>
          </label>
          {f.help && <p className="ml-6 mt-0.5 text-[11px] text-slate-500">{f.help}</p>}
        </div>
      );
    case 'table':
      control = <TableField f={f} value={v} disabled={disabled} onChange={(x) => set(f.key, x)} />;
      break;
    default:
      control = <input className={inputCls} value={String(v ?? '')} disabled={disabled} onChange={(e) => set(f.key, e.target.value)} />;
  }
  return (
    <div className={f.type === 'textarea' || f.type === 'table' || f.type === 'checkboxes' || f.type === 'radio' ? 'sm:col-span-2' : ''}>
      {label}
      {control}
      {f.help && <p className="mt-0.5 text-[11px] text-slate-500">{f.help}</p>}
      {source && (
        <p className="mt-0.5 text-[11px] text-blue-700 inline-flex items-center gap-1">
          <Database className="h-3 w-3" /> Prefilled: {source}
        </p>
      )}
    </div>
  );
}

export default function FormEditor({ def, data, onChange, readOnly, prefilled }: Props) {
  const set = (k: string, v: unknown) => {
    const next = { ...data, [k]: v };
    onChange(def.derive ? def.derive(next) : next);
  };
  return (
    <div className="space-y-4">
      {def.sections.filter((s) => sectionVisible(s, data)).map((s) => (
        <section key={s.id} className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <h2 className="text-sm font-semibold text-slate-900 mb-1">{s.title}</h2>
          {s.intro && <p className="text-xs text-slate-600 mb-3 whitespace-pre-line">{s.intro}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3 mt-2">
            {s.fields.filter((f) => fieldVisible(f, data)).map((f) => (
              <Field key={f.key} f={f} data={data} set={set} readOnly={readOnly} source={prefilled?.[f.key]} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
