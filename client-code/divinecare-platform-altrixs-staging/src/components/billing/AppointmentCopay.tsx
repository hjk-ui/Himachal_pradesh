'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';

type Resp = {
  payerName: string | null;
  copay: { amountCents: number; specificity: string; ambiguous: boolean; providerType: string | null; cptRule: string | null; source: string } | null;
  reason: string | null;
};

/** Patient copay for this visit from the client's copay rules (e.g. imported from Valant). Hidden when none apply. */
export function AppointmentCopay({ appointmentId }: { appointmentId: string }) {
  const [data, setData] = useState<Resp | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    apiJson<Resp>(`/api/billing/valant-balances/copay-for?appointmentId=${encodeURIComponent(appointmentId)}`)
      .then((d) => {
        if (live) setData(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [appointmentId]);
  if (!data?.copay) {
    if (data?.reason === 'payer-unknown') {
      return <p className="text-[11px] text-gray-500">Copay: rules exist for several payers; set the visit&apos;s payer to pick one.</p>;
    }
    return null;
  }
  const c = data.copay;
  const basis = [c.cptRule ? `CPT ${c.cptRule}` : null, c.providerType].filter(Boolean).join(', ') || 'all services';
  return (
    <div className="flex items-center justify-between rounded-xl border border-teal-100 bg-teal-50/60 px-3.5 py-2 text-xs">
      <span className="font-semibold text-gray-700">
        Patient copay{data.payerName ? ` (${data.payerName})` : ''}
        <span className="ml-1 font-normal text-gray-500">
          {basis}
          {c.source === 'valant' ? ' · from Valant' : ''}
          {c.ambiguous ? ' · check: another rule at the same level differs' : ''}
        </span>
      </span>
      <span className="font-bold text-gray-900">{formatCents(c.amountCents)}</span>
    </div>
  );
}
