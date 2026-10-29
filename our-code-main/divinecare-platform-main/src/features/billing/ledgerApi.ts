import { apiJson } from '@/lib/api-client';

export type DenialStatus = 'OPEN' | 'APPEALED' | 'WON' | 'LOST';
export type PaymentMethod = 'CARD' | 'ACH' | 'CASH' | 'CHECK' | 'INSURANCE' | 'STUB';

export type DenialRecord = {
  id: string;
  claimId: string;
  clientId: string;
  clientName: string;
  cptCode: string;
  payer: string | null;
  amountCents: number | null;
  reasonCode: string;
  reasonText: string;
  status: DenialStatus;
  claimStatus: string;
  createdAt: string;
};

export type PaymentRecord = {
  id: string;
  clientId: string;
  clientName: string;
  claimId: string | null;
  amountCents: number;
  method: PaymentMethod;
  paidAt: string;
  note: string | null;
  stub: boolean;
};

export type AutopayRecord = {
  clientId: string;
  clientName: string;
  active: boolean;
  last4: string | null;
  enrollmentId: string | null;
};

export async function fetchDenials() {
  const data = await apiJson<{ success: true; denials: DenialRecord[]; schemaReady?: boolean }>(
    '/api/billing/denials'
  );
  return data;
}

export async function patchDenialStatus(id: string, status: DenialStatus) {
  const data = await apiJson<{ success: true; denial: DenialRecord }>('/api/billing/denials', {
    method: 'PATCH',
    body: JSON.stringify({ id, status }),
  });
  return data.denial;
}

export async function fetchPayments() {
  return apiJson<{ success: true; payments: PaymentRecord[]; schemaReady?: boolean }>(
    '/api/billing/payments'
  );
}

export async function recordPayment(input: {
  clientId: string;
  claimId?: string | null;
  amountCents: number;
  method: PaymentMethod;
  note?: string | null;
  kind?: 'copay' | 'adjustment' | 'legacy' | 'chargeback';
}) {
  const data = await apiJson<{ success: true; payment: PaymentRecord }>('/api/billing/payments', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.payment;
}

export async function stubAutopayCharge(input: { clientId: string; amountCents: number; last4?: string | null }) {
  const data = await apiJson<{ success: true; payment: PaymentRecord }>('/api/billing/payments/charge', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.payment;
}

export async function fetchAutopay() {
  return apiJson<{
    success: true;
    enrollments: AutopayRecord[];
    schemaReady?: boolean;
    paymentsMode?: string;
    paymentsAllowed?: boolean;
  }>('/api/billing/autopay');
}

export async function saveAutopay(input: { clientId: string; active: boolean; last4?: string | null }) {
  const data = await apiJson<{ success: true; enrollment: AutopayRecord }>('/api/billing/autopay', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.enrollment;
}
