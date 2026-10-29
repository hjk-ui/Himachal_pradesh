'use client';

import { useEffect, useState } from 'react';

export default function CensusPage() {
  const [total, setTotal] = useState(0);
  const [locations, setLocations] = useState<Array<{ location: string; count: number }>>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/admin/census', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) setMessage(data.error || 'Could not open the census.');
        else {
          setTotal(data.total || 0);
          setLocations(data.locations || []);
        }
      })
      .catch(() => setMessage('Could not open the census.'));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Practice census</h1>
      <p className="text-sm text-slate-600">{total} active clients.</p>
      {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {locations.map((row) => (
          <li key={row.location} className="flex justify-between px-4 py-3 text-sm">
            <span>{row.location}</span>
            <span className="font-semibold">{row.count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
