'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { AlertTriangle, Loader2, Plus, Search, UserRound, X } from 'lucide-react';
import {
  ICD10_FY_LABEL,
  NON_BILLABLE_MESSAGE,
  highlightCode,
  highlightSegments,
  mergeIcd10Options,
  pickerKey,
  type HighlightSegment,
  type Icd10Option,
} from '@/lib/icd10/normalize';

export type Icd10SearchContext = 'bh' | 'primary' | 'any';

type ApiHit = {
  code: string;
  description: string;
  billable: boolean;
  category?: { code: string; description: string | null };
};

const searchCache = new Map<string, Icd10Option[]>();
const suggestionCache = new Map<string, Icd10Option[]>();

/** Debounced (200 ms) GET /api/icd10/search; results cached per query for the page session. */
export function useIcd10Search(query: string, context: Icd10SearchContext = 'any', enabled = true) {
  const [hits, setHits] = useState<Icd10Option[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const q = query.trim();
    if (!enabled || q.length < 2) {
      setHits([]);
      setLoading(false);
      return;
    }
    const cacheKey = `${context}|${q.toLowerCase()}`;
    const cached = searchCache.get(cacheKey);
    if (cached) {
      setHits(cached);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/icd10/search?q=${encodeURIComponent(q)}&limit=20&context=${context}`, { signal: ctrl.signal });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || 'ICD-10 search is unavailable');
        const rows: Icd10Option[] = (data.results as ApiHit[]).map((h) => ({
          code: h.code,
          description: h.description,
          billable: h.billable,
          source: 'search',
          categoryCode: h.category?.code,
          categoryDescription: h.category?.description ?? null,
        }));
        searchCache.set(cacheKey, rows);
        setHits(rows);
        setError(null);
      } catch (e) {
        if (ctrl.signal.aborted) return;
        setHits([]);
        setError(e instanceof Error ? e.message : 'ICD-10 search is unavailable');
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      ctrl.abort();
      window.clearTimeout(timer);
    };
  }, [query, context, enabled]);
  return { hits, loading, error };
}

/** The client's active diagnoses (chart + problem list), for "suggested first". */
export function useClientDiagnosisSuggestions(clientId: string | null | undefined) {
  const [suggestions, setSuggestions] = useState<Icd10Option[]>(() => (clientId ? suggestionCache.get(clientId) ?? [] : []));
  useEffect(() => {
    if (!clientId) {
      setSuggestions([]);
      return;
    }
    const cached = suggestionCache.get(clientId);
    if (cached) {
      setSuggestions(cached);
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/icd10/client-suggestions?clientId=${encodeURIComponent(clientId)}`, { signal: ctrl.signal, cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.success || !Array.isArray(data.suggestions)) return;
        const rows: Icd10Option[] = data.suggestions.map(
          (s: { code: string; description: string; billable: boolean; source: string; status: string; message: string | null }) => ({
            code: s.code,
            description: s.description,
            billable: s.billable,
            source: 'client' as const,
            sourceLabel: s.source,
            status: s.status,
            message: s.message,
          })
        );
        suggestionCache.set(clientId, rows);
        setSuggestions(rows);
      })
      .catch(() => {
        /* suggestions are optional */
      });
    return () => ctrl.abort();
  }, [clientId]);
  return suggestions;
}

function Segments({ parts, className }: { parts: HighlightSegment[]; className?: string }) {
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.match ? (
          <mark key={i} className="rounded-sm bg-amber-100 px-0 text-inherit">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        )
      )}
    </span>
  );
}

/**
 * The shared result list (listbox) used by the diagnosis pickers. Client diagnoses first, then
 * code-set results; non-billable header codes carry a warning and are not selectable when
 * `requireBillable` (claims, lab orders).
 */
export function Icd10OptionList({
  id,
  query,
  options,
  activeIndex,
  loading,
  error,
  requireBillable,
  selectedCodes,
  blockedMessage,
  onHover,
  onPick,
}: {
  id: string;
  query: string;
  options: Icd10Option[];
  activeIndex: number;
  loading: boolean;
  error: string | null;
  requireBillable?: boolean;
  selectedCodes?: string[];
  blockedMessage?: string | null;
  onHover: (i: number) => void;
  onPick: (o: Icd10Option) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);
  const selected = new Set((selectedCodes ?? []).map((c) => c.toUpperCase()));
  return (
    <div className="absolute left-0 z-30 mt-1 w-full min-w-[min(28rem,90vw)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
      {blockedMessage ? (
        <div className="flex items-center gap-1.5 border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[11px] font-medium text-amber-800" role="alert">
          <AlertTriangle className="h-3.5 w-3.5" /> {blockedMessage}
        </div>
      ) : null}
      {options.length === 0 ? (
        <div className="p-3 text-center text-xs text-gray-500">
          {loading ? (
            <span className="inline-flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching ICD-10-CM…</span>
          ) : error ? (
            error
          ) : query.trim().length < 2 ? (
            'Type 2+ characters: a code (F33.1, f331) or words (major depress recurrent)'
          ) : (
            `No ${ICD10_FY_LABEL} ICD-10-CM code matches "${query.trim()}"`
          )}
        </div>
      ) : (
        <ul ref={listRef} id={id} role="listbox" className="max-h-72 overflow-y-auto p-1.5">
          {options.map((o, i) => {
            const already = selected.has(o.code.toUpperCase());
            const blocked = !!requireBillable && !o.billable;
            const stale = o.status === 'unknown' || o.status === 'deleted';
            const firstSearch = o.source === 'search' && i > 0 && options[i - 1].source === 'client';
            return (
              <li key={`${o.source}-${o.code}`} role="presentation">
                {i === 0 && o.source === 'client' ? (
                  <div className="px-2 pb-1 pt-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">Client&apos;s active diagnoses</div>
                ) : null}
                {firstSearch ? <div className="mt-1 border-t border-gray-100 px-2 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-500">ICD-10-CM {ICD10_FY_LABEL}</div> : null}
                <div
                  id={`${id}-opt-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={i === activeIndex}
                  aria-disabled={already || blocked || undefined}
                  onMouseEnter={() => onHover(i)}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the input
                    if (!already) onPick(o);
                  }}
                  className={`flex cursor-pointer items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs ${
                    i === activeIndex ? 'bg-purple-50 text-[#3d1d63]' : 'text-gray-800'
                  } ${already ? 'opacity-50' : ''}`}
                >
                  <div className="min-w-0">
                    <Segments parts={highlightCode(o.code, query)} className="font-mono font-bold text-[#5C2D91]" />
                    <span className="text-gray-400"> — </span>
                    <Segments parts={highlightSegments(o.description, query)} />
                    {o.source === 'client' && o.sourceLabel ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700">
                        <UserRound className="h-2.5 w-2.5" /> {o.sourceLabel}
                      </span>
                    ) : null}
                    {stale ? (
                      <span className="mt-0.5 block text-[10px] font-semibold text-rose-700">{o.message || `Not in ${ICD10_FY_LABEL} code set`}</span>
                    ) : !o.billable ? (
                      <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">
                        {NON_BILLABLE_MESSAGE}
                        {blocked ? ' (required here)' : ''}
                      </span>
                    ) : o.categoryDescription && o.categoryCode && o.categoryCode !== o.code ? (
                      <span className="mt-0.5 block truncate text-[10px] text-gray-400">{o.categoryCode} {o.categoryDescription}</span>
                    ) : null}
                  </div>
                  {already ? <span className="shrink-0 text-[11px] text-gray-500">Added</span> : blocked || stale ? <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" /> : <Plus className="h-4 w-4 shrink-0 text-[#5C2D91]" />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Combobox state + keyboard handling shared by the multi and single pickers. */
export function useIcd10Combobox({
  query,
  context,
  suggestions,
  requireBillable,
  onPick,
  onClose,
}: {
  query: string;
  context: Icd10SearchContext;
  suggestions: Icd10Option[];
  requireBillable?: boolean;
  onPick: (o: Icd10Option) => void;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [blocked, setBlocked] = useState<string | null>(null);
  const { hits, loading, error } = useIcd10Search(query, context, open);
  const options = useMemo(() => mergeIcd10Options(suggestions, hits, query), [suggestions, hits, query]);

  useEffect(() => {
    setActiveIndex(options.length ? 0 : -1);
    setBlocked(null);
  }, [options]);

  const pick = (o: Icd10Option) => {
    if (requireBillable && !o.billable) {
      setBlocked(`${o.code}: ${NON_BILLABLE_MESSAGE}`);
      return;
    }
    setBlocked(null);
    onPick(o);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      e.preventDefault();
      return;
    }
    if (e.key === 'Tab') return; // Tab only moves focus; Enter picks
    if (!open && e.key === 'Enter') return; // let the form handle Enter when the list is closed
    const r = pickerKey(e.key, activeIndex, options, { requireBillable });
    if (r.type === 'none') return;
    e.preventDefault();
    if (r.type === 'move') setActiveIndex(r.index);
    else if (r.type === 'select') pick(options[r.index]);
    else if (r.type === 'blocked') setBlocked(r.reason);
    else if (r.type === 'close') {
      setOpen(false);
      onClose?.();
    }
  };

  return { open, setOpen, activeIndex, setActiveIndex, options, loading, error, blocked, pick, onKeyDown };
}

/**
 * Single-code ICD-10-CM input (problem list "Set code", visit diagnosis, client primary dx, ...).
 * Typing calls onChange(text); picking a result calls onChange(code, option).
 */
export function Icd10CodeInput({
  value,
  onChange,
  context = 'any',
  clientId,
  requireBillable = false,
  placeholder = 'ICD-10-CM code or words',
  className = '',
  inputClassName,
  autoFocus,
  disabled,
  ariaLabel = 'ICD-10-CM code',
}: {
  value: string;
  onChange: (code: string, picked?: Icd10Option) => void;
  context?: Icd10SearchContext;
  clientId?: string | null;
  requireBillable?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const suggestions = useClientDiagnosisSuggestions(clientId);
  const [listId] = useState(() => `icd10-${Math.random().toString(36).slice(2, 9)}`);
  const cb = useIcd10Combobox({
    query: value,
    context,
    suggestions,
    requireBillable,
    onPick: (o) => {
      onChange(o.code, o);
      cb.setOpen(false);
    },
  });
  return (
    <div className={`relative ${className}`}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={cb.open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={cb.open && cb.activeIndex >= 0 ? `${listId}-opt-${cb.activeIndex}` : undefined}
          autoFocus={autoFocus}
          disabled={disabled}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value);
            cb.setOpen(true);
          }}
          onFocus={() => cb.setOpen(true)}
          onBlur={() => cb.setOpen(false)}
          onKeyDown={cb.onKeyDown}
          className={inputClassName ?? 'w-full rounded-lg border border-gray-200 bg-white py-1.5 pl-7 pr-2 text-xs outline-none focus:border-[#5C2D91]'}
        />
      </div>
      {cb.open && (value.trim().length > 0 || suggestions.length > 0) ? (
        <Icd10OptionList
          id={listId}
          query={value}
          options={cb.options}
          activeIndex={cb.activeIndex}
          loading={cb.loading}
          error={cb.error}
          requireBillable={requireBillable}
          blockedMessage={cb.blocked}
          onHover={cb.setActiveIndex}
          onPick={cb.pick}
        />
      ) : null}
    </div>
  );
}

/**
 * Multi-code chips + search (claims): codes as a string list, client diagnoses first; with
 * requireBillable, header codes are blocked.
 */
export function Icd10CodeChips({
  codes: selectedCodes,
  onChange,
  clientId,
  requireBillable = false,
  context = 'any',
  placeholder = 'Search ICD-10-CM by code or words (e.g. F33.1, major depress recurrent)...',
}: {
  codes: string[];
  onChange: (codes: string[]) => void;
  clientId?: string | null;
  requireBillable?: boolean;
  context?: Icd10SearchContext;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [descs, setDescs] = useState<Record<string, string>>({});
  const [listId] = useState(() => `claim-dx-${Math.random().toString(36).slice(2, 9)}`);
  const suggestions = useClientDiagnosisSuggestions(clientId);

  const addCode = (code: string, description?: string) => {
    const clean = code.trim().toUpperCase();
    if (clean && !selectedCodes.includes(clean)) onChange([...selectedCodes, clean]);
    if (description) setDescs((d) => ({ ...d, [clean]: description }));
    setQuery('');
  };
  const removeCode = (code: string) => onChange(selectedCodes.filter((c) => c !== code));

  const cb = useIcd10Combobox({
    query,
    context,
    suggestions,
    requireBillable,
    onPick: (o) => addCode(o.code, o.description),
    onClose: () => setQuery(''),
  });

  return (
    <div className="space-y-2">
      {selectedCodes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedCodes.map((code) => (
            <span
              key={code}
              className="inline-flex items-center gap-1 rounded-lg border border-purple-200 bg-purple-50 px-2.5 py-1 text-xs font-bold text-[#5C2D91]"
            >
              <span>{code}</span>
              {descs[code] ? <span className="max-w-[160px] truncate font-normal text-purple-700">({descs[code]})</span> : null}
              <button type="button" aria-label={`Remove ${code}`} onClick={() => removeCode(code)} className="rounded p-0.5 text-purple-400 hover:text-purple-700">
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-3 h-4 w-4 text-slate-500" />
        <input
          type="text"
          role="combobox"
          aria-label="Search ICD-10-CM diagnoses"
          aria-expanded={cb.open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={cb.open && cb.activeIndex >= 0 ? `${listId}-opt-${cb.activeIndex}` : undefined}
          value={query}
          onFocus={() => cb.setOpen(true)}
          onBlur={() => cb.setOpen(false)}
          onChange={(e) => {
            setQuery(e.target.value);
            cb.setOpen(true);
          }}
          onKeyDown={(e) => {
            // Enter in this field never submits the claim form
            if (e.key === 'Enter') e.preventDefault();
            cb.onKeyDown(e);
          }}
          placeholder={placeholder}
          className="w-full rounded-xl border border-slate-200 py-2.5 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
        />
        {cb.open && (query.trim().length > 0 || suggestions.length > 0) && (
          <Icd10OptionList
            id={listId}
            query={query}
            options={cb.options}
            activeIndex={cb.activeIndex}
            loading={cb.loading}
            error={cb.error}
            requireBillable={requireBillable}
            selectedCodes={selectedCodes}
            blockedMessage={cb.blocked}
            onHover={cb.setActiveIndex}
            onPick={cb.pick}
          />
        )}
      </div>
    </div>
  );
}
