'use client';

/**
 * Practice setting "Automatic overnight eligibility checks" (GET / PATCH /api/eligibility/nightly-settings).
 * Default OFF: enable after Waystar production is live. Leadership + billing can change it.
 * The job is scripts/eligibility-nightly.ts (rules: src/lib/eligibility/nightly.ts).
 */
import { useCallback, useEffect, useState } from 'react';
import { MoonStar } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { NIGHTLY_ALLOW_TEST_LABEL, NIGHTLY_OFF_NOTE, NIGHTLY_SETTING_LABEL } from '@/lib/eligibility/nightly';

type NightlyView = {
  settings: { enabled: boolean; allowTest: boolean; updatedAt: string | null };
  waystar: { active: boolean; usageIndicator: 'T' | 'P' };
  wouldRun: boolean;
  blockedBy: string | null;
  canEdit: boolean;
};

export function NightlyEligibilityCard() {
  const [data, setData] = useState<NightlyView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await apiJson<NightlyView>('/api/eligibility/nightly-settings', { cache: 'no-store' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the overnight setting');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const save = async (patch: { enabled?: boolean; allowTest?: boolean }) => {
    setBusy(true);
    setError('');
    try {
      setData(await apiJson<NightlyView>('/api/eligibility/nightly-settings', { method: 'PATCH', body: JSON.stringify(patch) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  if (!data) return error ? <p className="text-xs text-rose-700">{error}</p> : null;
  const s = data.settings;
  const ro = !data.canEdit || busy;
  return (
    <section className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-xs">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <MoonStar size={16} className="text-blue-600" /> {NIGHTLY_SETTING_LABEL}
          </h2>
          <p className="mt-0.5 max-w-2xl text-xs text-slate-500">
            Each night, sends a Waystar 270 for tomorrow&apos;s insured visits whose coverage was not verified in the last 30 days
            (Maryland Medicaid: not yet in the visit month). Never for self-pay; one inquiry per client and payer per night.
          </p>
          <p className={`mt-1 text-xs font-semibold ${s.enabled ? 'text-emerald-700' : 'text-amber-800'}`}>
            {s.enabled ? 'On' : NIGHTLY_OFF_NOTE}
          </p>
          {s.enabled && data.blockedBy ? <p className="mt-0.5 text-xs text-amber-800">Not running tonight: {data.blockedBy}.</p> : null}
          <p className="mt-0.5 text-[11px] text-slate-500">
            Waystar: {data.waystar.active ? `active, usage indicator ${data.waystar.usageIndicator === 'P' ? 'P (production)' : 'T (test)'}` : 'not active on this server'}
          </p>
        </div>
        <div className="flex flex-col gap-1.5 text-xs text-slate-700">
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={ro} checked={s.enabled} onChange={(e) => void save({ enabled: e.target.checked })} />
            {NIGHTLY_SETTING_LABEL}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" disabled={ro} checked={s.allowTest} onChange={(e) => void save({ allowTest: e.target.checked })} />
            {NIGHTLY_ALLOW_TEST_LABEL} (default off)
          </label>
          {!data.canEdit ? <span className="text-[11px] text-slate-500">Leadership or billing can change this.</span> : null}
        </div>
      </div>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
    </section>
  );
}
