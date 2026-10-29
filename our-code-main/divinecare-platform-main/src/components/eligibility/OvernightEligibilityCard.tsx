'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { OvernightEligibilitySettings } from '@/lib/eligibility/overnight-settings';

export function OvernightEligibilityCard({ canManage = false }: { canManage?: boolean }) {
  const [settings, setSettings] = useState<OvernightEligibilitySettings | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    apiJson<{ success: boolean; settings?: OvernightEligibilitySettings; error?: string }>(
      '/api/eligibility/overnight'
    )
      .then((res) => {
        if (res.success && res.settings) setSettings(res.settings);
        else setError(res.error || null);
      })
      .catch(() => undefined);
  }, [canManage]);

  if (!canManage) return null;

  const toggle = async (field: 'enabled' | 'allowTestClearinghouse', value: boolean) => {
    const res = await apiJson<{ success: boolean; settings?: OvernightEligibilitySettings; error?: string }>(
      '/api/eligibility/overnight',
      { method: 'PATCH', body: JSON.stringify({ [field]: value }) }
    );
    if (!res.success) {
      setError(res.error || 'Could not save');
      return;
    }
    if (res.settings) setSettings(res.settings);
  };

  return (
    <section
      className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="overnight-eligibility-card"
    >
      <h2 className="text-sm font-semibold text-slate-900">Automatic overnight eligibility checks</h2>
      <p className="mt-1 text-xs text-slate-500">
        Off — enable after Waystar production is live
      </p>
      {error ? <p className="mt-2 text-xs text-rose-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={Boolean(settings?.enabled)}
            onChange={(e) => void toggle('enabled', e.target.checked)}
          />
          Enable overnight checks
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={Boolean(settings?.allowTestClearinghouse)}
            onChange={(e) => void toggle('allowTestClearinghouse', e.target.checked)}
          />
          Allow on test clearinghouse
        </label>
      </div>
    </section>
  );
}
