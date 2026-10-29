'use client';

import { useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { PrimaryCareSettings } from '@/lib/medical/primary-care-settings';
import type { StandingOrder } from '@/lib/medical/standing-orders';
import { STANDING_ORDER_ATTESTATION } from '@/lib/medical/standing-orders';

export function PrimaryCareSettingsCard({ canManage = false }: { canManage?: boolean }) {
  const [settings, setSettings] = useState<PrimaryCareSettings | null>(null);
  const [orders, setOrders] = useState<StandingOrder[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const [s, o] = await Promise.all([
      apiJson<{ success: boolean; settings?: PrimaryCareSettings }>('/api/medical/primary-care-settings'),
      apiJson<{ success: boolean; orders?: StandingOrder[] }>('/api/medical/standing-orders'),
    ]);
    if (s.success && s.settings) setSettings(s.settings);
    if (o.success && o.orders) setOrders(o.orders);
  };

  useEffect(() => {
    void load().catch(() => undefined);
  }, []);

  const approve = async (orderId: string) => {
    const res = await apiJson<{ success: boolean; orders?: StandingOrder[]; error?: string }>(
      '/api/medical/standing-orders',
      {
        method: 'PATCH',
        body: JSON.stringify({ orderId, status: 'approved' }),
      }
    );
    if (!res.success) {
      setMessage(res.error || 'Could not approve');
      return;
    }
    setOrders(res.orders || []);
    setMessage('Standing order approved');
  };

  const saveWindow = async (field: 'notifyPatientWithinDays' | 'labExpectedDays' | 'referralReportDays', value: number) => {
    const res = await apiJson<{ success: boolean; settings?: PrimaryCareSettings; error?: string }>(
      '/api/medical/primary-care-settings',
      { method: 'PATCH', body: JSON.stringify({ [field]: value }) }
    );
    if (res.success && res.settings) setSettings(res.settings);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="primary-care-settings">
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100">
          <Settings2 size={18} className="text-slate-700" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Primary care settings</h2>
          <p className="text-xs text-slate-500">Policy windows · standing orders (draft until approved)</p>
        </div>
      </div>

      {message ? <p className="mt-2 text-xs text-emerald-800">{message}</p> : null}

      <div className="mt-3 space-y-2 text-sm">
        <PolicyRow
          label="Notify patient within"
          value={settings?.notifyPatientWithinDays ?? null}
          hint={`Suggested ${settings?.suggestedNotifyDays ?? 7} days — none on file until set`}
          canManage={canManage}
          onSave={(n) => void saveWindow('notifyPatientWithinDays', n)}
        />
        <PolicyRow
          label="Lab expected"
          value={settings?.labExpectedDays ?? null}
          hint={`Suggested ${settings?.suggestedLabDays ?? 14} days — none on file until set`}
          canManage={canManage}
          onSave={(n) => void saveWindow('labExpectedDays', n)}
        />
        <PolicyRow
          label="Referral report"
          value={settings?.referralReportDays ?? null}
          hint={`Suggested ${settings?.suggestedReferralDays ?? 30} days — none on file until set`}
          canManage={canManage}
          onSave={(n) => void saveWindow('referralReportDays', n)}
        />
      </div>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">MA standing orders</p>
        <p className="mt-1 text-[11px] text-slate-500">{STANDING_ORDER_ATTESTATION}</p>
        <ul className="mt-2 space-y-1.5">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 px-3 py-2 text-sm"
            >
              <span className="font-medium text-slate-900">{order.name}</span>
              <span className="font-mono text-xs text-slate-500">{order.cpt}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ring-1 ${
                  order.status === 'approved'
                    ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                    : order.status === 'retired'
                      ? 'bg-slate-50 text-slate-600 ring-slate-200'
                      : 'bg-amber-50 text-amber-900 ring-amber-200'
                }`}
              >
                {order.status}
              </span>
              {canManage && order.status === 'draft' ? (
                <button
                  type="button"
                  onClick={() => void approve(order.id)}
                  className="ml-auto rounded-lg bg-slate-900 px-2.5 py-1 text-[11px] font-semibold text-white"
                >
                  Approve
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function PolicyRow({
  label,
  value,
  hint,
  canManage,
  onSave,
}: {
  label: string;
  value: number | null;
  hint: string;
  canManage: boolean;
  onSave: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
      <div>
        <p className="font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500">
          {value == null ? hint : `${value} days`}
        </p>
      </div>
      {canManage && value == null ? (
        <button
          type="button"
          onClick={() => onSave(Number(hint.match(/\d+/)?.[0] || 7))}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 hover:bg-white"
        >
          Use suggested
        </button>
      ) : null}
    </div>
  );
}
