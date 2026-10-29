'use client';
import { useEffect, useState } from 'react';
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { apiJson } from '@/lib/api-client';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
type Measurement = { id: string; instrumentId: string; instrumentName: string; totalScore: number | null; completedAt: string; severity: string | null };
export function AssessmentTrends({ clientId, records }: { clientId: string; records?: Measurement[] }) {
  const [rows, setRows] = useState<Measurement[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (records && records.length > 0) {
      setRows(records);
      setLoading(false);
      return;
    }
    let active = true;
    setRows([]); setError('');
    if (!clientId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    apiJson<{ data: Measurement[] }>(`/api/clinical/assessments?clientId=${encodeURIComponent(clientId)}`)
      .then(data => { if (active) setRows(data.data || []); })
      .catch(error => { if (active) setError(error instanceof Error ? error.message : 'Could not load measurements'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [clientId, records]);
  const instruments = [...new Set(rows.map(row => row.instrumentId))];
  return <section className="space-y-4 rounded-2xl border bg-white p-5">
    <h3 className="font-bold">Assessment history and trends</h3>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {!rows.length && <p className="text-sm text-slate-500">{loading ? 'Loading measurements…' : clientId ? 'No recorded assessments for this patient.' : 'Select a patient to see recorded assessments.'}</p>}
    <div className="grid gap-5 md:grid-cols-2">{instruments.map(id => {
      const measurements = rows.filter(row => row.instrumentId === id && row.totalScore !== null).sort((a,b) => a.completedAt.localeCompare(b.completedAt));
      const latest = measurements.at(-1);
      const max = ASSESSMENT_CATALOG.find(instrument => instrument.id === id)?.maxScore;
      return <div key={id} className="rounded-xl border p-4">
        <h4 className="text-sm font-bold">{latest?.instrumentName ?? id}</h4>
        <p className="my-2 text-sm">{latest ? `${latest.totalScore}${max ? ` / ${max}` : ''} · ${latest.severity ?? 'Recorded'}` : 'No scored results'}</p>
        <div className="h-40"><ResponsiveContainer width="100%" height="100%"><LineChart data={measurements.map(row => ({ date: new Date(row.completedAt).toLocaleDateString(), score: row.totalScore }))}>
          <XAxis dataKey="date" tick={{ fontSize: 10 }} /><YAxis domain={[0, max ?? 'auto']} width={30} /><Tooltip />
          <Line dataKey="score" type="linear" stroke="#5C2D91" strokeWidth={2} dot />
        </LineChart></ResponsiveContainer></div>
      </div>;
    })}</div>
  </section>;
}
