'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ChartSection, SectionState } from './ChartSection';
import { LabOrderCard } from '@/components/labs/LabOrderCard';
import { LabOrderForm, type LabOrderPrefill } from '@/components/labs/LabOrderForm';
import { LabTrends } from '@/components/labs/LabTrends';
import { StandingOrdersList } from '@/components/labs/StandingOrdersList';
import { useLabCatalog, useLabOrders } from '@/components/labs/labClient';

/**
 * Chart › Labs: this client's orders and results (BH and primary care), therapeutic drug level /
 * ANC trends, standing orders, and "Order labs" for prescribers. Same scope rules as the Labs
 * worklist (GET /api/labs/orders?clientId=).
 */
export function LabChartTab({ clientId, fullListHref = '/dashboard/ehr/labs' }: { clientId: string; fullListHref?: string }) {
  const { catalog } = useLabCatalog();
  const { orders, standing, permissions, loading, error, reload, upsert } = useLabOrders({ clientId });
  const [form, setForm] = useState<{ prefill?: LabOrderPrefill } | null>(null);
  const clientName = orders[0]?.clientName ?? null;
  const tests = catalog?.tests ?? [];

  return (
    <div className="space-y-4">
      <ChartSection
        title="Labs"
        subtitle="Lab orders and results for this client (behavioral health and primary care)"
        fullListHref={fullListHref}
        actions={
          permissions?.order ? (
            <button type="button" onClick={() => setForm({})} className="inline-flex items-center gap-1.5 rounded-xl bg-[#5C2D91] px-3 py-1.5 text-xs font-bold text-white">
              <Plus size={14} /> Order labs
            </button>
          ) : null
        }
      >
        <SectionState loading={loading} error={error} empty={!loading && !error && !orders.length && !standing.length} emptyText="No lab orders for this client." />
        {standing.length ? (
          <div className="mb-4">
            <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Standing orders</p>
            <StandingOrdersList standing={standing} canOrder={Boolean(permissions?.order)} showClient={false} onPlace={(_s, prefill) => setForm({ prefill })} onChanged={() => void reload()} />
          </div>
        ) : null}
        {orders.length ? (
          <div className="mb-4">
            <LabTrends orders={orders} tests={tests} />
          </div>
        ) : null}
        <div className="space-y-2">
          {orders.map((o, i) => (
            <LabOrderCard key={o.id} order={o} permissions={permissions} tests={tests} showClient={false} defaultOpen={i === 0} onChange={upsert} />
          ))}
        </div>
      </ChartSection>

      {form ? (
        <LabOrderForm
          clientId={clientId}
          clientName={clientName}
          prefill={form.prefill}
          onClose={() => {
            setForm(null);
            void reload();
          }}
          onPlaced={upsert}
        />
      ) : null}
    </div>
  );
}
