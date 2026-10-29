'use client';

/**
 * HR: licensed vs pre-licensed per clinician. Pre-licensed clinicians (LGPC, LMSW, LGMFT, LGADC,
 * trainees, supervisees on a licensure track) need a supervisor signature on treatment plans and
 * a co-signature on notes. The level is derived from credentials / supervision tracks unless HR
 * sets it here.
 */
import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldCheck } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Row = {
  userId: string;
  name: string;
  role: string;
  explicit: 'LICENSED' | 'PRE_LICENSED' | null;
  level: 'LICENSED' | 'PRE_LICENSED';
  source: 'hr-setting' | 'supervision-track' | 'credential' | 'default';
  credentials: string[];
  licenseTrack: string | null;
};

const SOURCE: Record<Row['source'], string> = {
  'hr-setting': 'set by HR',
  'supervision-track': 'on a licensure track (HR › Supervision)',
  credential: 'from credentials',
  default: 'no pre-licensure credential on file',
};

export function LicenseLevelPanel() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    apiJson<{ success: true; staff: Row[] }>('/api/hr/license-levels')
      .then((res) => setRows(res.staff))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Could not load license levels'));
  }, []);
  useEffect(() => {
    if (open && rows === null) load();
  }, [open, rows, load]);

  const save = async (userId: string, licenseLevel: Row['explicit']) => {
    setError(null);
    try {
      await apiJson('/api/hr/license-levels', { method: 'PATCH', body: JSON.stringify({ userId, licenseLevel }) });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 text-left text-sm font-semibold text-slate-900" aria-expanded={open}>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <ShieldCheck size={16} className="text-[#5C2D91]" /> License level (supervisor signature rules)
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Pre-licensed clinicians’ treatment plans need their supervisor’s signature before they are active, and their notes go to Supervisor Review for co-signature. Licensed clinicians sign alone.
          </p>
          {error ? <p className="text-xs text-rose-700">{error}</p> : null}
          {rows === null ? <p className="text-xs text-slate-500">Loading…</p> : null}
          {rows?.length === 0 ? <p className="text-xs text-slate-500">No clinical staff found.</p> : null}
          <ul className="divide-y divide-slate-100">
            {rows?.map((r) => (
              <li key={r.userId} className="flex flex-col gap-1.5 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{r.name}</span> <span className="text-slate-500">· {r.role.replace(/_/g, ' ').toLowerCase()}</span>
                  <span className="block text-slate-500">
                    {r.level === 'PRE_LICENSED' ? 'Pre-licensed' : 'Licensed'} — {SOURCE[r.source]}
                    {r.licenseTrack ? ` (${r.licenseTrack})` : ''}
                    {r.credentials.length ? ` · ${r.credentials.join(', ')}` : ''}
                  </span>
                </span>
                <select
                  aria-label={`License level for ${r.name}`}
                  value={r.explicit ?? ''}
                  onChange={(e) => void save(r.userId, (e.target.value || null) as Row['explicit'])}
                  className="min-h-[36px] rounded-lg border border-slate-200 p-1.5 text-xs"
                >
                  <option value="">Automatic ({r.explicit ? 'derived' : r.level === 'PRE_LICENSED' ? 'pre-licensed' : 'licensed'})</option>
                  <option value="LICENSED">Licensed</option>
                  <option value="PRE_LICENSED">Pre-licensed (supervisor signs)</option>
                </select>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
