'use client';

import { AlertTriangle } from 'lucide-react';
import {
  DECLINED,
  NULL_FLAVORS,
  RACE,
  US_STATES,
  claimReadiness,
  describeGaps,
  drfirstReadiness,
  type CodeOption,
  type DemographicsInput,
} from '@/lib/clients/demographics';

/** Coded dropdown: the stored value is always a code from the list (never free text). */
export function CodeSelect({
  id,
  label,
  value,
  onChange,
  options,
  placeholder = 'Not recorded',
  className,
  labelClassName,
  hint,
}: {
  id: string;
  label: string;
  value: string | null | undefined;
  onChange: (code: string) => void;
  options: CodeOption[];
  placeholder?: string;
  className: string;
  labelClassName: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClassName}>{label}</label>
      <select id={id} value={value || ''} onChange={(e) => onChange(e.target.value)} className={className}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.code} value={o.code}>{o.label}</option>
        ))}
      </select>
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function StateSelect(props: { id: string; label: string; value: string | null | undefined; onChange: (code: string) => void; className: string; labelClassName: string }) {
  const known = !props.value || US_STATES.some((s) => s.code === props.value);
  // A legacy value that is not a USPS code stays visible so staff can correct it
  const options = known ? US_STATES : [{ code: props.value!, label: `${props.value} (not a valid state code)` }, ...US_STATES];
  return <CodeSelect {...props} options={options} placeholder="Select state" />;
}

/** OMB race categories, multi-select. "Declined" / "Unknown" are exclusive of the categories. */
export function RaceCheckboxes({ value, onChange, labelClassName }: { value: string[] | null | undefined; onChange: (codes: string[]) => void; labelClassName: string }) {
  const selected = new Set(value ?? []);
  const toggle = (code: string) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else if (NULL_FLAVORS.has(code)) { next.clear(); next.add(code); }
    else { for (const c of NULL_FLAVORS) next.delete(c); next.add(code); }
    onChange(RACE.map((r) => r.code).filter((c) => next.has(c)));
  };
  return (
    <fieldset>
      <legend className={labelClassName}>Race (select all that apply)</legend>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {RACE.map((r) => (
          <label key={r.code} className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={selected.has(r.code)} onChange={() => toggle(r.code)} />
            {r.code === DECLINED ? 'Declined to answer' : r.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** "Demographics incomplete for e-prescribing / claims" notice listing the required items missing. */
export function DemographicsGapNotice({ input, className = '' }: { input: DemographicsInput; className?: string }) {
  const erx = drfirstReadiness(input);
  const claims = claimReadiness(input);
  if (erx.ready && claims.ready) return null;
  return (
    <div role="status" className={`rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 ${className}`}>
      <p className="flex items-center gap-1.5 font-bold">
        <AlertTriangle size={13} aria-hidden /> Demographics incomplete for {[!erx.ready && 'e-prescribing', !claims.ready && 'claims'].filter(Boolean).join(' / ')}
      </p>
      {!erx.ready ? <p className="mt-0.5">E-prescribing (DrFirst) needs: {describeGaps(erx.missing)}.</p> : null}
      {!claims.ready ? <p className="mt-0.5">Claims (837P) need: {describeGaps(claims.missing)}.</p> : null}
    </div>
  );
}
