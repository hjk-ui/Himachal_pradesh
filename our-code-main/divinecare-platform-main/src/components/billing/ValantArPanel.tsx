'use client';

import { useEffect, useState } from 'react';

export function ValantArPanel() {
  const [empty, setEmpty] = useState(true);
  const [total, setTotal] = useState(0);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    fetch('/api/billing/ar/valant', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          setError(data.error || 'Valant A/R did not load');
          return;
        }
        const count = (data.insurance?.length || 0) + (data.patients?.length || 0) + (data.combined?.total || 0);
        setEmpty(count === 0);
        setTotal(data.combined?.total || 0);
        setAsOf(data.asOf || null);
      })
      .catch(() => setError('Valant A/R did not load'));
  }, []);
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Valant run-out A/R</h2>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {!error && empty ? <p className="mt-2 text-sm text-slate-500">No Valant aging rows are on file.</p> : null}
      {!error && !empty ? (
        <p className="mt-2 text-sm text-slate-700">
          {total} combined rows{asOf ? ` as of ${String(asOf).slice(0, 10)}` : ''}. Stored buckets are unchanged. Over 120 can display the whole total.
        </p>
      ) : null}
    </section>
  );
}
