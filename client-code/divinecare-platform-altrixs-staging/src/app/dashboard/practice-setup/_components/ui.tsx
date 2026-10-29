'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, Circle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { PracticeOverview } from '@/lib/practice/store';
import type { ChecklistItem } from '@/lib/practice/checklist';
import { Alert, Button, StatusBadge, cx, FOCUS_RING } from '@/components/ui';

export type Overview = PracticeOverview & { canEdit: boolean };

export const PURPLE = '#5C2D91';

export function usePracticeOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await apiJson<Overview>('/api/practice-settings'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load practice settings');
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, setData, error, reload };
}

export async function putSettings(url: string, body: unknown): Promise<Overview> {
  return apiJson<Overview>(url, { method: 'PUT', body: JSON.stringify(body) });
}

/** Save state for one form: busy flag + result message. */
export function useSaver(onSaved: (o: Overview) => void) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const run = useCallback(
    async (url: string, body: unknown, okText = 'Saved') => {
      setBusy(true);
      setMessage(null);
      try {
        const next = await putSettings(url, body);
        onSaved(next);
        const changed = (next as Overview & { changedFields?: string[] }).changedFields;
        setMessage({ tone: 'ok', text: changed && changed.length === 0 ? 'Saved (no changes)' : okText });
        return true;
      } catch (e) {
        setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Could not save' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onSaved]
  );
  return { busy, message, run };
}

export function inputClass(invalid = false) {
  return `block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-xs outline-none transition placeholder:text-slate-500 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500 ${
    invalid ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20' : 'border-slate-300 focus:border-blue-600 focus:ring-blue-600/20'
  }`;
}

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className = '',
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string | null;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-rose-600">{error}</span> : hint ? <span className="mt-1 block text-xs text-slate-500">{hint}</span> : null}
    </label>
  );
}

export function TextInput({
  value,
  onChange,
  disabled,
  placeholder,
  invalid,
  type = 'text',
  maxLength,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  invalid?: boolean;
  type?: string;
  maxLength?: number;
}) {
  return (
    <input
      type={type}
      className={inputClass(invalid)}
      value={value ?? ''}
      disabled={disabled}
      placeholder={placeholder}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function NumberInput({ value, onChange, disabled, min, max }: { value: number; onChange: (v: number) => void; disabled?: boolean; min?: number; max?: number }) {
  return (
    <input
      type="number"
      className={inputClass()}
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? NaN : Number(e.target.value))}
    />
  );
}

/** Dollar input stored as integer cents (null when empty). */
export function MoneyInput({ cents, onChange, disabled }: { cents: number | null; onChange: (v: number | null) => void; disabled?: boolean }) {
  const [text, setText] = useState(cents === null ? '' : (cents / 100).toFixed(2));
  useEffect(() => {
    setText(cents === null ? '' : (cents / 100).toFixed(2));
  }, [cents]);
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
      <input
        inputMode="decimal"
        className={`${inputClass()} pl-6`}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = Number(text.replace(/[^0-9.]/g, ''));
          onChange(text.trim() === '' || !Number.isFinite(n) ? null : Math.round(n * 100));
        }}
      />
    </div>
  );
}

export function Select({
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <select className={inputClass()} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean; hint?: string }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-blue-600' : 'bg-slate-300', FOCUS_RING)}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition ${checked ? 'left-4' : 'left-0.5'}`} />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {hint ? <span className="block text-xs text-slate-500">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Card({ title, description, children, actions }: { title: string; description?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function SaveBar({
  busy,
  message,
  onSave,
  disabled,
  label = 'Save section',
}: {
  busy: boolean;
  message: { tone: 'ok' | 'error'; text: string } | null;
  onSave: () => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
      {message ? (
        <span className={`text-sm ${message.tone === 'ok' ? 'text-emerald-700' : 'text-rose-600'}`}>{message.text}</span>
      ) : null}
      <Button onClick={onSave} disabled={busy || disabled} loading={busy} icon={busy ? undefined : <Check />}>
        {label}
      </Button>
    </div>
  );
}

export function PercentPill({ percent, blocking }: { percent: number; blocking?: number }) {
  const tone = percent === 100 ? 'success' : blocking ? 'warning' : 'neutral';
  return (
    <StatusBadge tone={tone} size="sm" className="tabular-nums">
      {percent}%
    </StatusBadge>
  );
}

const GATE_LABEL: Record<ChecklistItem['gate'], string> = { bill: 'Billing', golive: 'Go-live', recommended: 'Recommended' };

export function ChecklistList({ items, onJump }: { items: ChecklistItem[]; onJump?: (section: ChecklistItem['section']) => void }) {
  if (!items.length) return <p className="text-sm text-slate-500">Nothing to check here.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((item) => (
        <li key={item.id} className="flex items-start gap-3 py-2">
          {item.done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
          ) : item.gate === 'recommended' ? (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <p className={`text-sm ${item.done ? 'text-slate-600' : 'font-medium text-slate-900'}`}>{item.label}</p>
            {item.detail && !item.done ? <p className="text-xs text-slate-500">{item.detail}</p> : null}
          </div>
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{GATE_LABEL[item.gate]}</span>
          {onJump && !item.done ? (
            <button type="button" onClick={() => onJump(item.section)} className={cx('shrink-0 rounded text-xs font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
              Fix
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function ReadinessBadges({ overview }: { overview: Overview }) {
  const c = overview.checklist;
  const badge = (ok: boolean, label: string, count: number) => (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
      {ok ? <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden /> : <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden />}
      <div>
        <p className={`text-sm font-semibold ${ok ? 'text-emerald-800' : 'text-amber-900'}`}>{label}</p>
        <p className="text-xs text-slate-600">{ok ? 'All required items done' : `${count} item${count === 1 ? '' : 's'} open`}</p>
      </div>
    </div>
  );
  return (
    <div className="flex flex-wrap gap-3">
      {badge(c.readyToBill, 'Ready to bill', c.billBlockers.length)}
      {badge(c.readyToGoLive, 'Ready to go live', c.goLiveBlockers.length)}
      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <span className="stat-number text-lg font-bold text-blue-700">{c.percent}%</span>
        <span className="text-xs text-slate-600">of all checks complete</span>
      </div>
    </div>
  );
}

export function ReadOnlyNotice({ canEdit }: { canEdit: boolean }) {
  if (canEdit) return null;
  return (
    <Alert tone="warning">View only — practice settings are changed by practice leadership (Admin, Director, Practice Director).</Alert>
  );
}
