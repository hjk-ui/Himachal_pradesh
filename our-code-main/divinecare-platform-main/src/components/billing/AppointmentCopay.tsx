'use client';

import { useEffect, useState } from 'react';

const ALLOWED = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'OFFICE_MANAGER', 'FRONT_DESK']);

export function AppointmentCopay({ appointmentId, role }: { appointmentId: string; role?: string | null }) {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!role || !ALLOWED.has(role)) return;
    let cancelled = false;
    fetch(`/api/billing/valant-balances/copay-for?appointmentId=${encodeURIComponent(appointmentId)}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.success) return;
        if (data.copay) {
          const dollars = (data.copay.amountCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
          setText(data.copay.ambiguous ? `${dollars} (more than one rule)` : dollars);
        } else {
          setText(data.reason === 'no-rules' ? 'No copay rule' : data.reason === 'payer-unknown' ? 'Payer unknown' : 'No matching rule');
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [appointmentId, role]);
  if (!role || !ALLOWED.has(role)) return null;
  return (
    <div className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-xs text-gray-700">
      <p className="text-[11px] font-semibold uppercase text-gray-400">Copay rule</p>
      <p className="mt-0.5 font-bold text-gray-900">{text || 'Loading…'}</p>
    </div>
  );
}
