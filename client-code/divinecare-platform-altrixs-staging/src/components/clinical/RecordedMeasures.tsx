'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, Plus } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { SMOKING_STATUS_OPTIONS, validateMeasureValue } from '@/lib/clinical/measures';
import { isVitalLike, unitsDisplay } from '@/lib/migration/valantMeasurementTypes';

type MeasureType = {
  id: string;
  name: string;
  dataType: string;
  defaultUnits: string | null;
  parentInstrument: string | null;
  isSubscore: boolean;
  vitalField: string | null;
  documentationCode: string | null;
  category: string;
};

type MeasureResult = {
  id: string;
  name: string;
  parentInstrument: string | null;
  dataType: string;
  value: string;
  units: string | null;
  measuredAt: string;
  source: string;
  notes: string | null;
};

/** Local calendar date (YYYY-MM-DD) */
const today = () => new Date().toLocaleDateString('en-CA');

/**
 * "Record a measure" — scores and vitals from the practice's measurement type catalog that are not
 * a built-in Altrixs instrument (those are entered on the Assessments page). Stored as
 * MeasurementResult via /api/clinical/measures.
 */
export function RecordedMeasures({ clientId }: { clientId: string }) {
  const [types, setTypes] = useState<MeasureType[]>([]);
  const [results, setResults] = useState<MeasureResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState('');
  const [value, setValue] = useState('');
  const [date, setDate] = useState(today());
  const [notes, setNotes] = useState('');
  const [verified, setVerified] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await apiJson<{ types: MeasureType[]; results: MeasureResult[] }>(`/api/clinical/measures?clientId=${encodeURIComponent(clientId)}`);
      setTypes(d.types || []);
      setResults(d.results || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load measures');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const map = new Map<string, MeasureType[]>();
    for (const t of types) {
      const g = isVitalLike(t) ? 'Vital signs' : t.parentInstrument ?? 'Other measures';
      map.set(g, [...(map.get(g) ?? []), t]);
    }
    return [...map.entries()].sort(([a], [b]) => (a === 'Vital signs' ? -1 : b === 'Vital signs' ? 1 : a.localeCompare(b)));
  }, [types]);

  const selected = types.find((t) => t.id === typeId) ?? null;

  const save = async () => {
    if (!selected) return setFormError('Choose a measure');
    const v = validateMeasureValue(selected, value);
    if ('error' in v) return setFormError(v.error);
    if (!verified) return setFormError('Confirm the value against the source form');
    setSaving(true);
    setFormError(null);
    try {
      await apiJson('/api/clinical/measures', {
        method: 'POST',
        body: JSON.stringify({ clientId, measurementTypeId: selected.id, value, measuredAt: date === today() ? new Date().toISOString() : `${date}T12:00:00`, notes: notes || undefined, clinicianVerified: true }),
      });
      setValue('');
      setNotes('');
      setVerified(false);
      setOpen(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</p>;

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
          <Activity size={15} className="text-[#5C2D91]" /> Recorded measures
        </p>
        {types.length ? (
          <button type="button" onClick={() => setOpen((o) => !o)} className="clinic-btn-secondary inline-flex items-center gap-1.5 text-xs">
            <Plus size={12} /> Record a measure
          </button>
        ) : null}
      </div>
      {!loading && !types.length ? (
        <p className="text-xs text-slate-500">No measurement types are set up. Leadership can import them in Admin › Data import › Import Measurement Types.</p>
      ) : null}

      {open ? (
        <div className="space-y-3 rounded-xl bg-slate-50 p-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-slate-700 sm:col-span-2">
              Measure
              <select
                aria-label="Measure"
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  setValue('');
                  setFormError(null);
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal"
              >
                <option value="">Choose…</option>
                {groups.map(([g, list]) => (
                  <optgroup key={g} label={g}>
                    {list.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.defaultUnits ? ` (${unitsDisplay(t.defaultUnits, t.vitalField)})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="text-xs font-bold text-slate-700">
              Date measured
              <input type="date" aria-label="Date measured" max={today()} value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal" />
            </label>
          </div>
          {selected ? (
            <label className="block text-xs font-bold text-slate-700">
              Value{selected.defaultUnits ? ` (${unitsDisplay(selected.defaultUnits, selected.vitalField)})` : ''}
              {selected.dataType === 'smoking_status' ? (
                <select aria-label="Value" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal">
                  <option value="">Choose…</option>
                  {SMOKING_STATUS_OPTIONS.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="Value"
                  inputMode={selected.dataType === 'blood_pressure' ? 'text' : 'decimal'}
                  placeholder={selected.dataType === 'blood_pressure' ? '120/80' : selected.dataType === 'integer' ? 'Whole number' : 'Number'}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal"
                />
              )}
            </label>
          ) : null}
          <label className="block text-xs font-bold text-slate-700">
            Notes (optional)
            <input aria-label="Notes" value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal" />
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />I verified this value against the completed form or device reading
          </label>
          {formError ? <p className="text-xs font-medium text-rose-700">{formError}</p> : null}
          <div className="flex gap-2">
            <button type="button" disabled={saving} onClick={() => void save()} className="rounded-lg px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50" style={{ background: '#5C2D91' }}>
              {saving ? 'Saving…' : 'Save measure'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="clinic-btn-secondary text-xs">
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {!loading && types.length > 0 && !results.length ? <p className="text-xs text-slate-500">No measures recorded for this client.</p> : null}
      {results.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500">
              <tr>
                <th className="py-1 pr-3 font-semibold">Date</th>
                <th className="py-1 pr-3 font-semibold">Measure</th>
                <th className="py-1 pr-3 font-semibold">Value</th>
                <th className="py-1 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(r.measuredAt).toLocaleDateString()}</td>
                  <td className="py-1.5 pr-3">
                    {r.name}
                    {r.parentInstrument ? <span className="text-slate-500"> · {r.parentInstrument}</span> : null}
                  </td>
                  <td className="py-1.5 pr-3 font-bold text-slate-900">
                    {r.value} {unitsDisplay(r.units)}
                  </td>
                  <td className="py-1.5 text-slate-600">{r.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
