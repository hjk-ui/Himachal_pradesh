'use client';

import { FormEvent, useEffect, useState } from 'react';
import type { DrugAllergyResult, DrugAllergySearchResponse } from '@/lib/drfirst/fdb/types';

type Status = { enabled: boolean; configured: boolean; apiVersion: string };

function displayName(drug: DrugAllergyResult) {
  return drug.brandName || drug.genericName || 'Unnamed drug';
}

export function DrugAllergySearch() {
  const [status, setStatus] = useState<Status | null>(null);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<DrugAllergySearchResponse | null>(null);
  const [message, setMessage] = useState('Checking drug-allergy search configuration…');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/integrations/drfirst/drug-allergy', { cache: 'no-store' })
      .then(async response => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error();
        setStatus(body);
        setMessage(body.configured
          ? `Rcopia drug-allergy search ready (API ${body.apiVersion}). Search runs only when submitted.`
          : 'Rcopia drug-allergy search is prepared but awaiting sandbox configuration.');
      })
      .catch(() => { if (active) setMessage('Could not check drug-allergy search configuration.'); });
    return () => { active = false; };
  }, []);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.replace(/[^\p{L}\p{N}]/gu, '').length < 2) {
      setMessage('Enter at least two letters or numbers.');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch('/api/integrations/drfirst/drug-allergy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchString: query, maximum: 50 }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error || 'Drug-allergy search is unavailable.');
        return;
      }
      setResult(body.data);
      setMessage(body.data.drugs.length ? `${body.data.drugs.length} result(s) found.` : 'No drugs found.');
    } catch {
      setMessage('Drug-allergy search is unavailable. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
      <div>
        <h2 className="font-semibold text-slate-900">Rcopia Drug Allergy Search</h2>
        <p role="status" aria-live="polite" className="text-sm text-slate-600">{message}</p>
      </div>
      {status?.configured && (
        <>
          <form onSubmit={search} className="flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="drfirst-allergy-search">Drug or allergy group</label>
            <input id="drfirst-allergy-search" value={query} onChange={event => setQuery(event.target.value)}
              placeholder="Enter a brand, generic drug, or allergy group"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            <button type="submit" disabled={busy}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {busy ? 'Searching…' : 'Search'}
            </button>
          </form>
          {result?.warnings.map((warning, index) => (
            <p key={`${warning.code ?? 'warning'}-${index}`} className="text-sm text-amber-700">{warning.text}</p>
          ))}
          {result && result.drugs.length > 0 && (
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
              {result.drugs.map((drug, index) => (
                <li key={drug.rcopiaId || drug.rxNormId || `${displayName(drug)}-${index}`} className="p-3 text-sm">
                  <p className="font-medium text-slate-900">{displayName(drug)}</p>
                  <p className="text-slate-600">{[drug.genericName !== displayName(drug) ? drug.genericName : '', drug.strength, drug.form].filter(Boolean).join(' · ')}</p>
                  {drug.allergyGroups.length > 0 && <p className="mt-1 text-xs text-slate-500">Allergy groups: {drug.allergyGroups.map(group => group.groupName).filter(Boolean).join(', ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
