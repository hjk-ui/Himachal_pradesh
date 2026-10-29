'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search, Star, X } from 'lucide-react';
import { ICD10_FY_LABEL, NON_BILLABLE_MESSAGE, icd10Key, type Icd10Option } from '@/lib/icd10/normalize';
import { Icd10OptionList, useClientDiagnosisSuggestions, useIcd10Combobox, type Icd10SearchContext } from './Icd10Picker';

export type SelectedDiagnosis = {
  code: string;
  description: string;
  isPrimary: boolean;
  specifier?: string;
};

type Props = {
  value: SelectedDiagnosis[];
  onChange: (diagnoses: SelectedDiagnosis[]) => void;
  disabled?: boolean;
  /** Client in context: their active diagnoses are offered first. */
  clientId?: string | null;
  /** Extra suggestions the caller already has (offered first, before code-set results). */
  suggestions?: { code: string; description: string; source?: string }[];
  /** Claims / lab orders: header (non-billable) codes cannot be picked. */
  requireBillable?: boolean;
  /** Boost Chapter 5 (F codes) for behavioral health; 'primary' / 'any' for medical forms. */
  context?: Icd10SearchContext;
  title?: string;
  /** @deprecated DrFirst search is no longer needed: the full FY2027 ICD-10-CM set is searched. */
  drfirst?: boolean;
};

type CodeStatus = { status: string; description: string | null; billable: boolean; message: string | null };
const statusCache = new Map<string, CodeStatus>();

/**
 * Multi-diagnosis ICD-10-CM picker (notes, treatment plans, evaluations, lab orders). Searches the
 * official FY2027 code set (GET /api/icd10/search, 200 ms debounce), keyboard navigable, with
 * matches highlighted; header codes are flagged non-billable (and blocked when requireBillable);
 * selected codes not in the current code set are flagged.
 */
export function DiagnosisAutocomplete({
  value = [],
  onChange,
  disabled = false,
  clientId,
  suggestions: extraSuggestions,
  requireBillable = false,
  context = 'bh',
  title = 'Diagnostic Formulation (ICD-10 / DSM-5)',
}: Props) {
  const [search, setSearch] = useState('');
  const [listId] = useState(() => `dx-${Math.random().toString(36).slice(2, 9)}`);
  const clientSuggestions = useClientDiagnosisSuggestions(clientId);
  const suggestions = useMemo<Icd10Option[]>(() => {
    const extra: Icd10Option[] = (extraSuggestions ?? []).map((s) => {
      const st = statusCache.get(icd10Key(s.code));
      return { code: s.code, description: s.description, billable: st?.billable ?? true, source: 'client', sourceLabel: s.source || 'Chart', status: st?.status, message: st?.message };
    });
    return [...extra, ...clientSuggestions];
  }, [extraSuggestions, clientSuggestions]);

  const [statuses, setStatuses] = useState<Record<string, CodeStatus>>({});
  const codesKey = value.map((d) => d.code).join(',');

  // Code-set status of the selected codes (fills blank descriptions; flags stale / header codes)
  useEffect(() => {
    const codes = value.map((d) => d.code).filter((c) => /^[A-Za-z][0-9]/.test(c));
    const missing = codes.filter((c) => !statusCache.has(icd10Key(c)));
    const apply = () => {
      const next: Record<string, CodeStatus> = {};
      for (const c of codes) {
        const s = statusCache.get(icd10Key(c));
        if (s) next[icd10Key(c)] = s;
      }
      setStatuses(next);
      if (value.some((d) => !d.description && statusCache.get(icd10Key(d.code))?.description)) {
        onChange(value.map((d) => (d.description ? d : { ...d, description: statusCache.get(icd10Key(d.code))?.description || '' })));
      }
    };
    if (!missing.length) {
      apply();
      return;
    }
    const ctrl = new AbortController();
    fetch(`/api/icd10/lookup?codes=${encodeURIComponent(missing.join(','))}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data?.success) return;
        for (const r of data.results as (CodeStatus & { input: string })[]) {
          statusCache.set(icd10Key(r.input), { status: r.status, description: r.description, billable: r.billable, message: r.message });
        }
        apply();
      })
      .catch(() => {
        /* status is informational; the server validates on save */
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesKey]);

  const addDiagnosis = (item: { code: string; description: string }) => {
    if (disabled) return;
    if (value.some((d) => icd10Key(d.code) === icd10Key(item.code))) return;
    const isFirst = value.length === 0;
    onChange([...value, { code: item.code, description: item.description, isPrimary: isFirst, specifier: '' }]);
    setSearch('');
  };

  const cb = useIcd10Combobox({
    query: search,
    context,
    suggestions,
    requireBillable,
    onPick: (o) => addDiagnosis(o),
    onClose: () => setSearch(''),
  });

  const removeDiagnosis = (code: string) => {
    if (disabled) return;
    const updated = value.filter((d) => d.code !== code).map((d) => ({ ...d }));
    if (updated.length > 0 && !updated.some((d) => d.isPrimary)) updated[0].isPrimary = true;
    onChange(updated);
  };

  const setPrimary = (code: string) => {
    if (disabled) return;
    onChange(value.map((d) => ({ ...d, isPrimary: d.code === code })));
  };

  const updateSpecifier = (code: string, specifier: string) => {
    if (disabled) return;
    onChange(value.map((d) => (d.code === code ? { ...d, specifier } : d)));
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <span className="text-xs font-semibold text-slate-500">
          {value.length} {value.length === 1 ? 'Diagnosis' : 'Diagnoses'} Selected
        </span>
      </div>

      {!disabled && (
        <div className="relative">
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs focus-within:border-blue-600 focus-within:bg-white">
            <Search className="mr-2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              role="combobox"
              aria-label="Search ICD-10-CM diagnoses"
              aria-expanded={cb.open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={cb.open && cb.activeIndex >= 0 ? `${listId}-opt-${cb.activeIndex}` : undefined}
              placeholder="Search ICD-10-CM by code (F33.1, f331) or words (major depress recurrent)…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                cb.setOpen(true);
              }}
              onFocus={() => cb.setOpen(true)}
              onBlur={() => cb.setOpen(false)}
              onKeyDown={cb.onKeyDown}
              className="w-full bg-transparent outline-none"
            />
          </div>

          {cb.open && (search.trim().length > 0 || suggestions.length > 0) && (
            <Icd10OptionList
              id={listId}
              query={search}
              options={cb.options}
              activeIndex={cb.activeIndex}
              loading={cb.loading}
              error={cb.error}
              requireBillable={requireBillable}
              selectedCodes={value.map((d) => d.code)}
              blockedMessage={cb.blocked}
              onHover={cb.setActiveIndex}
              onPick={cb.pick}
            />
          )}
        </div>
      )}

      <div className="space-y-2">
        {value.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
            No diagnoses selected yet. Search above to add ICD-10-CM diagnoses ({ICD10_FY_LABEL} code set).
          </div>
        ) : (
          value.map((diag) => {
            const st = statuses[icd10Key(diag.code)];
            const stale = st && (st.status === 'unknown' || st.status === 'deleted' || st.status === 'malformed');
            const header = st && st.status === 'ok' && !st.billable;
            return (
              <div
                key={diag.code}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs transition ${
                  stale ? 'border-rose-200 bg-rose-50/40' : diag.isPrimary ? 'border-blue-300 bg-blue-50/40' : 'border-slate-200 bg-slate-50/50'
                }`}
              >
                <div className="flex flex-1 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPrimary(diag.code)}
                    disabled={disabled}
                    title={diag.isPrimary ? 'Primary Diagnosis' : 'Set as Primary'}
                    className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      diag.isPrimary ? 'bg-brand-600 text-white' : 'border border-slate-300 bg-white text-slate-600 hover:border-blue-300'
                    }`}
                  >
                    <Star className="h-3 w-3 fill-current" />
                    {diag.isPrimary ? 'PRIMARY' : 'Set Primary'}
                  </button>
                  <span className="font-mono font-bold text-[#3d1d63]">{diag.code}</span>
                  <span className="font-medium text-slate-800">{diag.description}</span>
                  {stale ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700">
                      <AlertTriangle className="h-3 w-3" /> {st.message || `Not in ${ICD10_FY_LABEL} code set`}
                    </span>
                  ) : header ? (
                    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${requireBillable ? 'text-rose-700' : 'text-amber-700'}`}>
                      <AlertTriangle className="h-3 w-3" /> {NON_BILLABLE_MESSAGE}
                    </span>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Specifier (e.g. Mild, Remission)…"
                    value={diag.specifier || ''}
                    onChange={(e) => updateSpecifier(diag.code, e.target.value)}
                    disabled={disabled}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-blue-600"
                  />
                  {!disabled && (
                    <button
                      type="button"
                      onClick={() => removeDiagnosis(diag.code)}
                      aria-label={`Remove ${diag.code}`}
                      className="rounded-lg p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
