'use client';

import { useEffect, useState } from 'react';

const ALLOWED = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'BILLING', 'OFFICE_MANAGER', 'FRONT_DESK']);

type Balance = {
  balanceCents: number;
  openingBalanceCents: number;
  prepaymentCreditCents: number;
  adjustmentsCents: number;
  claimsPatientCents: number;
  patientPaymentsCents: number;
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function PatientBalanceCard({ clientId, role }: { clientId: string; role?: string | null }) {
  const [balance, setBalance] = useState<Balance | null>(null);
  const [ready, setReady] = useState(true);
  useEffect(() => {
    if (!role || !ALLOWED.has(role)) return;
    let cancelled = false;
    fetch(`/api/billing/patient-balance/${clientId}`, { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data?.success) return;
        setBalance(data.balance);
        setReady(data.schemaReady !== false);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [clientId, role]);
  if (!role || !ALLOWED.has(role) || !balance) return null;
  return (
    <div className="clinic-card p-5">
      <h3 className="clinic-section-title mb-4">Patient balance</h3>
      <p className="text-2xl font-semibold text-slate-900">{money(balance.balanceCents)}</p>
      <p className="mt-2 text-sm text-slate-500">
        Opening {money(balance.openingBalanceCents)} · Credits {money(balance.prepaymentCreditCents)} · Adjustments {money(balance.adjustmentsCents)} · Claims {money(balance.claimsPatientCents)} · Payments {money(balance.patientPaymentsCents)}
      </p>
      {ready ? null : <p className="mt-2 text-xs text-slate-500">The ledger table is not on this database yet.</p>}
    </div>
  );
}
