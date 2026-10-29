'use client';

import { useState } from 'react';
import { Search, X, Star, Plus } from 'lucide-react';

export type SelectedDiagnosis = {
  code: string;
  description: string;
  isPrimary: boolean;
  specifier?: string;
};

export const COMMON_ICD10_CATALOG: { code: string; description: string; category: string }[] = [
  { code: 'F33.1', description: 'Major depressive disorder, recurrent, moderate', category: 'Mood' },
  { code: 'F33.2', description: 'Major depressive disorder, recurrent, severe without psychotic features', category: 'Mood' },
  { code: 'F32.9', description: 'Major depressive disorder, single episode, unspecified', category: 'Mood' },
  { code: 'F31.12', description: 'Bipolar I disorder, current episode hypomanic', category: 'Mood' },
  { code: 'F41.1', description: 'Generalized anxiety disorder', category: 'Anxiety' },
  { code: 'F41.0', description: 'Panic disorder [episodic paroxysmal anxiety]', category: 'Anxiety' },
  { code: 'F43.10', description: 'Post-traumatic stress disorder, unspecified', category: 'Trauma' },
  { code: 'F43.12', description: 'Post-traumatic stress disorder, chronic', category: 'Trauma' },
  { code: 'F90.2', description: 'Attention-deficit hyperactivity disorder, combined type', category: 'ADHD' },
  { code: 'F90.0', description: 'Attention-deficit hyperactivity disorder, predominantly inattentive type', category: 'ADHD' },
  { code: 'F10.20', description: 'Alcohol dependence, uncomplicated', category: 'Substance' },
  { code: 'F11.20', description: 'Opioid dependence, uncomplicated', category: 'Substance' },
  { code: 'F12.90', description: 'Cannabis use, unspecified', category: 'Substance' },
  { code: 'F60.3', description: 'Borderline personality disorder', category: 'Personality' },
  { code: 'F20.9', description: 'Schizophrenia, unspecified', category: 'Psychosis' },
];

type Props = {
  value: SelectedDiagnosis[];
  onChange: (diagnoses: SelectedDiagnosis[]) => void;
  disabled?: boolean;
};

export function DiagnosisAutocomplete({ value = [], onChange, disabled = false }: Props) {
  const [search, setSearch] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);

  const filtered = COMMON_ICD10_CATALOG.filter(
    (item) =>
      item.code.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase())
  );

  const addDiagnosis = (item: { code: string; description: string }) => {
    if (disabled) return;
    if (value.some((d) => d.code === item.code)) return;
    const isFirst = value.length === 0;
    const updated = [
      ...value,
      { code: item.code, description: item.description, isPrimary: isFirst, specifier: '' }
    ];
    onChange(updated);
    setSearch('');
    setShowDropdown(false);
  };

  const removeDiagnosis = (code: string) => {
    if (disabled) return;
    const updated = value.filter((d) => d.code !== code);
    if (updated.length > 0 && !updated.some((d) => d.isPrimary)) {
      updated[0].isPrimary = true;
    }
    onChange(updated);
  };

  const setPrimary = (code: string) => {
    if (disabled) return;
    const updated = value.map((d) => ({
      ...d,
      isPrimary: d.code === code
    }));
    onChange(updated);
  };

  const updateSpecifier = (code: string, specifier: string) => {
    if (disabled) return;
    const updated = value.map((d) => (d.code === code ? { ...d, specifier } : d));
    onChange(updated);
  };

  return (
    <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <h3 className="text-base font-bold text-gray-900">Diagnostic Formulation (ICD-10 / DSM-5)</h3>
        <span className="text-xs font-semibold text-gray-500">
          {value.length} {value.length === 1 ? 'Diagnosis' : 'Diagnoses'} Selected
        </span>
      </div>

      {/* Autocomplete Input */}
      {!disabled && (
        <div className="relative">
          <div className="flex items-center rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs focus-within:border-indigo-400 focus-within:bg-white">
            <Search className="mr-2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search diagnosis by ICD-10 code (e.g. F41.1) or name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              className="w-full bg-transparent outline-none"
            />
          </div>

          {showDropdown && search.trim().length > 0 && (
            <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl">
              {filtered.length === 0 ? (
                <div className="p-3 text-center text-xs text-gray-500">No matching ICD-10 code found</div>
              ) : (
                filtered.map((item) => {
                  const alreadySelected = value.some((d) => d.code === item.code);
                  return (
                    <button
                      key={item.code}
                      type="button"
                      disabled={alreadySelected}
                      onClick={() => addDiagnosis(item)}
                      className={`flex w-full items-center justify-between rounded-lg p-2 text-left text-xs transition ${
                        alreadySelected ? 'opacity-50' : 'hover:bg-indigo-50 hover:text-indigo-900'
                      }`}
                    >
                      <div>
                        <span className="font-bold text-indigo-600">{item.code}</span> — {item.description}
                      </div>
                      {alreadySelected ? (
                        <span className="text-[10px] text-gray-400">Added</span>
                      ) : (
                        <Plus className="h-4 w-4 text-indigo-500" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {/* Selected Diagnoses List */}
      <div className="space-y-2">
        {value.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-gray-400">
            No diagnoses selected yet. Search above to add ICD-10 diagnoses.
          </div>
        ) : (
          value.map((diag) => (
            <div
              key={diag.code}
              className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-xs transition ${
                diag.isPrimary ? 'border-indigo-300 bg-indigo-50/40' : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              <div className="flex flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPrimary(diag.code)}
                  disabled={disabled}
                  title={diag.isPrimary ? 'Primary Diagnosis' : 'Set as Primary'}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    diag.isPrimary
                      ? 'bg-indigo-600 text-white'
                      : 'border border-gray-300 bg-white text-gray-600 hover:border-indigo-300'
                  }`}
                >
                  <Star className="h-3 w-3 fill-current" />
                  {diag.isPrimary ? 'PRIMARY' : 'Set Primary'}
                </button>
                <span className="font-bold text-indigo-900">{diag.code}</span>
                <span className="text-gray-800 font-medium">{diag.description}</span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Specifier (e.g. Mild, Remission)..."
                  value={diag.specifier || ''}
                  onChange={(e) => updateSpecifier(diag.code, e.target.value)}
                  disabled={disabled}
                  className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-[11px] outline-none focus:border-indigo-400"
                />
                {!disabled && (
                  <button
                    type="button"
                    onClick={() => removeDiagnosis(diag.code)}
                    className="rounded-lg p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
