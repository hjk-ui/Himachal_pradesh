'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Check, Loader2, Pill, X } from 'lucide-react';
import {
  ALLERGEN_TYPES,
  ALLERGEN_TYPE_LABEL,
  DRUG_LOOKUP_UNAVAILABLE,
  type AllergenType,
  type DrugSearchHit,
} from '@/lib/drugs/types';

/**
 * RxNorm drug typeahead (GET /api/drugs/search, NLM RxNav). Medications pick a specific drug with
 * strength and form (SCD / SBD); drug allergies pick an ingredient. Free text always stays allowed:
 * no pick, or RxNav down, saves the text uncoded ("Not coded — code it" later). Only the RxCUI is
 * sent to the server, which resolves name / form / strength / NDCs itself.
 */

export type DrugKind = 'medication' | 'allergy';

export type DrugPick = {
  /** What is in the box (the chosen drug's label, or free text) */
  text: string;
  /** RxCUI when a match was chosen; null = free text (not coded) */
  rxcui: string | null;
  tty?: string | null;
};

const cache = new Map<string, DrugSearchHit[]>();

const TTY_LABEL: Record<string, string> = {
  SCD: 'Generic',
  SBD: 'Brand',
  GPCK: 'Generic pack',
  BPCK: 'Brand pack',
  IN: 'Ingredient',
  PIN: 'Ingredient',
  MIN: 'Combination',
};

/** Debounced (250 ms) drug search; results cached per query for the page session. */
export function useDrugSearch(query: string, kind: DrugKind, enabled = true) {
  const [hits, setHits] = useState<DrugSearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const key = `${kind}|${q.toLowerCase()}`;
    const cached = cache.get(key);
    if (cached) {
      setHits(cached);
      setUnavailable(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/drugs/search?kind=${kind}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || DRUG_LOOKUP_UNAVAILABLE);
        const rows = (data.results || []) as DrugSearchHit[];
        cache.set(key, rows);
        setHits(rows);
        setUnavailable(false);
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        setHits([]);
        setUnavailable(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [query, kind, enabled]);
  return { hits, loading, unavailable };
}

export function DrugPicker({
  kind,
  value,
  onChange,
  id,
  placeholder,
  disabled,
  autoFocus,
  className = 'clinic-input',
  'aria-describedby': describedBy,
}: {
  kind: DrugKind;
  value: DrugPick;
  onChange: (next: DrugPick) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
  'aria-describedby'?: string;
}) {
  const autoId = useId();
  const inputId = id || `drug-${autoId}`;
  const listId = `${inputId}-list`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const { hits, loading, unavailable } = useDrugSearch(value.text, kind, open && !value.rxcui);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  useEffect(() => setActive(0), [hits]);

  const choose = (h: DrugSearchHit) => {
    onChange({ text: h.display, rxcui: h.rxcui, tty: h.tty });
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || !hits.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(hits[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showList = open && !value.rxcui && value.text.trim().length >= 2;
  const hintId = `${inputId}-hint`;

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          id={inputId}
          value={value.text}
          onChange={(e) => {
            onChange({ text: e.target.value, rxcui: null, tty: null });
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && hits[active] ? `${listId}-${active}` : undefined}
          aria-describedby={[describedBy, hintId].filter(Boolean).join(' ')}
          placeholder={placeholder || (kind === 'allergy' ? 'Search drug (e.g. penicillin, Zoloft)' : 'Search brand or generic (e.g. Zoloft 50)')}
          className={`${className} ${value.rxcui ? 'pr-8' : ''}`}
        />
        {value.rxcui ? (
          <button
            type="button"
            onClick={() => onChange({ text: value.text, rxcui: null, tty: null })}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
            aria-label="Remove drug code (keep as free text)"
            title="Remove drug code"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      <p id={hintId} className="mt-1 text-[11px] leading-snug">
        {value.rxcui ? (
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <Check className="h-3 w-3" /> Coded: RxNorm {value.rxcui}
            {value.tty && TTY_LABEL[value.tty] ? ` · ${TTY_LABEL[value.tty]}` : ''}
          </span>
        ) : unavailable ? (
          <span className="inline-flex items-center gap-1 text-amber-700">
            <AlertTriangle className="h-3 w-3" /> {DRUG_LOOKUP_UNAVAILABLE}
          </span>
        ) : value.text.trim() ? (
          <span className="text-slate-500">Not coded. Pick a match{kind === 'medication' ? ' with the strength and form' : ''} to code it, or keep free text.</span>
        ) : null}
      </p>

      {showList ? (
        <div className="absolute left-0 z-30 mt-1 w-full min-w-[min(28rem,90vw)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          {loading && !hits.length ? (
            <div className="flex items-center justify-center gap-1.5 p-3 text-xs text-gray-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching RxNorm…
            </div>
          ) : unavailable ? (
            <div className="flex items-center gap-1.5 p-3 text-xs text-amber-800" role="alert">
              <AlertTriangle className="h-3.5 w-3.5" /> {DRUG_LOOKUP_UNAVAILABLE}
            </div>
          ) : !hits.length ? (
            <div className="p-3 text-center text-xs text-gray-500">No RxNorm match. Keep it as free text, or try the generic name.</div>
          ) : (
            <ul id={listId} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
              {hits.map((h, i) => (
                <li
                  key={h.rxcui}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(h);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={`flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2.5 py-1.5 text-sm ${i === active ? 'bg-violet-50' : ''}`}
                >
                  <span className="flex items-start gap-2 text-slate-800">
                    <Pill className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                    {h.display}
                  </span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{TTY_LABEL[h.tty] || h.tty}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-gray-100 px-3 py-1 text-[10px] text-gray-400">RxNorm (NLM RxNav, updated monthly)</div>
        </div>
      ) : null}
    </div>
  );
}

export type AllergenPick = DrugPick & { allergenType: AllergenType };

/**
 * Allergy entry: type selector (drug / food / environmental) + the allergen. Drug allergies use the
 * RxNorm typeahead (DrFirst AUM2 needs a drug code); food and environmental allergens stay free text.
 */
export function AllergenInput({
  value,
  onChange,
  id,
  disabled,
}: {
  value: AllergenPick;
  onChange: (next: AllergenPick) => void;
  id?: string;
  disabled?: boolean;
}) {
  const autoId = useId();
  const inputId = id || `allergen-${autoId}`;
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
      <select
        aria-label="Allergy type"
        value={value.allergenType}
        disabled={disabled}
        onChange={(e) => {
          const allergenType = e.target.value as AllergenType;
          // A drug code only belongs to a drug allergy
          onChange({ ...value, allergenType, ...(allergenType === 'drug' ? {} : { rxcui: null, tty: null }) });
        }}
        className="clinic-input sm:w-40"
      >
        {ALLERGEN_TYPES.map((t) => (
          <option key={t} value={t}>
            {ALLERGEN_TYPE_LABEL[t]}
          </option>
        ))}
      </select>
      <div className="min-w-0 flex-1">
        {value.allergenType === 'drug' ? (
          <DrugPicker kind="allergy" id={inputId} value={value} disabled={disabled} onChange={(next) => onChange({ ...value, ...next })} />
        ) : (
          <input
            id={inputId}
            value={value.text}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, text: e.target.value, rxcui: null, tty: null })}
            placeholder={value.allergenType === 'food' ? 'e.g. Peanuts, Shellfish' : 'e.g. Latex, Bee stings'}
            className="clinic-input"
          />
        )}
      </div>
    </div>
  );
}

/**
 * "Not coded — code it" for an existing free-text record: one click searches RxNorm with the record's
 * text; staff pick the match and `onCode(rxcui)` saves it. Allergies can instead be marked food /
 * environmental (no drug code needed).
 */
export function DrugCodeFixer({
  kind,
  text,
  onCode,
  onClassify,
}: {
  kind: DrugKind;
  text: string;
  onCode: (rxcui: string) => Promise<void>;
  onClassify?: (type: Exclude<AllergenType, 'drug'>) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<DrugPick>({ text, rxcui: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the code');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setPick({ text: stripStrengthNoise(text), rxcui: null });
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-200 hover:bg-amber-100"
        title={kind === 'medication' ? 'DrFirst receives this medication as free text' : 'DrFirst receives this allergy as free text'}
      >
        <AlertTriangle className="h-3 w-3" /> Not coded — code it
      </button>
    );
  }

  return (
    <div className="mt-1.5 w-full rounded-xl border border-amber-200 bg-amber-50/60 p-2.5">
      <DrugPicker kind={kind} value={pick} onChange={setPick} autoFocus disabled={busy} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!pick.rxcui || busy}
          onClick={() => pick.rxcui && run(() => onCode(pick.rxcui!))}
          className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-2.5 py-1 text-[11px] font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Save code
        </button>
        {kind === 'allergy' && onClassify ? (
          <>
            <span className="text-[11px] text-slate-500">or not a drug:</span>
            {(['food', 'environmental'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => run(() => onClassify(t))}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50"
              >
                {ALLERGEN_TYPE_LABEL[t]}
              </button>
            ))}
          </>
        ) : null}
        <button type="button" onClick={() => setOpen(false)} disabled={busy} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">
          Cancel
        </button>
      </div>
      {error ? <p className="mt-1 text-[11px] text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
}

/** "Sertraline 50mg tab daily" -> "Sertraline 50mg": the drug and strength are what RxNorm searches on. */
function stripStrengthNoise(text: string): string {
  const m = text.trim().match(/^(.*?\d+(?:\.\d+)?\s?(?:mg|mcg|g|ml|units?|%|meq)\b)/i);
  return (m ? m[1] : text).trim();
}
