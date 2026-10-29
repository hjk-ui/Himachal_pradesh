'use client';

/**
 * Practice settings > Clinical policy > Measurement-based care: program and provider rule rows
 * (which measures, how often). Saved with the Clinical policy section (mbcProgramMeasures /
 * mbcProviderMeasures). Choices: GET /api/practice-settings/mbc-options.
 */
import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';

type Option = { id: string; name: string };
type Instrument = { id: string; name: string; fullName: string };
export type RuleRow = { instrumentIds: string[]; everyDays: number } & ({ programId: string } | { userId: string });

export function useMbcOptions() {
  const [opts, setOpts] = useState<{ instruments: Instrument[]; programs: Option[]; providers: Option[] } | null>(null);
  useEffect(() => {
    fetch('/api/practice-settings/mbc-options', { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => (b?.success ? setOpts({ instruments: b.instruments, programs: b.programs, providers: b.providers }) : null))
      .catch(() => undefined);
  }, []);
  return opts;
}

export function MbcRuleList<K extends 'programId' | 'userId'>({
  idKey,
  label,
  rows,
  choices,
  instruments,
  disabled,
  onChange,
}: {
  idKey: K;
  label: string;
  rows: ({ instrumentIds: string[]; everyDays: number } & Record<K, string>)[];
  choices: Option[];
  instruments: Instrument[];
  disabled?: boolean;
  onChange: (rows: ({ instrumentIds: string[]; everyDays: number } & Record<K, string>)[]) => void;
}) {
  const update = (i: number, patch: Partial<{ instrumentIds: string[]; everyDays: number } & Record<K, string>>) =>
    onChange(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const unused = choices.filter((c) => !rows.some((r) => r[idKey] === c.id));
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={`${r[idKey]}-${i}`} className="rounded-lg border border-slate-200 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label={label}
              value={r[idKey]}
              disabled={disabled}
              onChange={(e) => update(i, { [idKey]: e.target.value } as never)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            >
              {[...choices.filter((c) => c.id === r[idKey]), ...unused].map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-slate-600">
              every
              <input
                type="number"
                min={1}
                max={365}
                value={r.everyDays}
                disabled={disabled}
                onChange={(e) => update(i, { everyDays: Math.max(1, Math.min(365, Number(e.target.value) || 30)) } as never)}
                className="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm"
              />
              days
            </label>
            {!disabled ? (
              <button type="button" aria-label="Remove rule" onClick={() => onChange(rows.filter((_, n) => n !== i))} className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100">
                <X className="h-4 w-4" aria-hidden />
              </button>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {instruments.map((ins) => (
              <label key={ins.id} className="flex items-center gap-1 text-xs text-slate-700" title={ins.fullName}>
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={r.instrumentIds.includes(ins.id)}
                  onChange={(e) =>
                    update(i, {
                      instrumentIds: e.target.checked ? [...r.instrumentIds, ins.id].slice(0, 10) : r.instrumentIds.filter((x) => x !== ins.id),
                    } as never)
                  }
                />
                {ins.name}
              </label>
            ))}
          </div>
        </div>
      ))}
      {!disabled && unused.length ? (
        <button
          type="button"
          onClick={() => onChange([...rows, { [idKey]: unused[0].id, instrumentIds: ['phq-9', 'gad-7'], everyDays: idKey === 'programId' ? 7 : 30 } as { instrumentIds: string[]; everyDays: number } & Record<K, string>])}
          className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:underline"
        >
          <Plus className="h-4 w-4" aria-hidden /> Add {label.toLowerCase()} rule
        </button>
      ) : null}
      {!choices.length ? <p className="text-xs text-slate-500">No {label.toLowerCase()}s set up yet.</p> : null}
    </div>
  );
}
