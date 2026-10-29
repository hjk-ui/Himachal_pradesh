import type { BillingInvoice } from './billingHubData';

export type { BillingInvoice } from './billingHubData';

export type InsurancePanelStatus = 'active' | 'pending' | 'credentialing' | 'not_credentialed';

export type InsurancePanelRecord = {
  panelId: string;
  payer: string;
  payerId: string | null;
  status: InsurancePanelStatus;
  effectiveDate: string | null;
  contractRenewalDate: string | null;
  credentialingContact: string | null;
  notes: string;
  feeSchedule: string | null;
  openToNewClients: boolean;
};

export type AutopayChargeRecord = {
  id: string;
  clientId: string;
  clientName: string;
  amountCents: number;
  chargedAt: string;
  status: 'charged' | 'failed';
  method: string;
  last4: string | null;
  note?: string;
  retryable?: boolean;
};

export type SuperbillLine = {
  date: string;
  cptCode: string;
  description: string;
  diagnosisCodes: string[];
  feeCents: number;
  paidCents: number;
  balanceCents: number;
};

export type SuperbillPractice = {
  name: string;
  address: string;
  phone: string;
  npi: string;
  taxId: string;
};

export type SuperbillRecord = {
  superbillId: string;
  generatedAt: string;
  clinicianName: string;
  practice: SuperbillPractice;
  patient: {
    clientId: string;
    name: string;
    dob: string;
    address: string;
    insurancePayer: string;
    memberId: string | null;
    groupNumber: string | null;
  };
  services: SuperbillLine[];
  diagnosisCodes: string[];
  totalBilledCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
};

export const DEFAULT_SUPERBILL_PRACTICE: SuperbillPractice = {
  name: 'MD Behavioral Health',
  address: '',
  phone: '',
  npi: '',
  taxId: '',
};

export const INSURANCE_PANEL_SEED: InsurancePanelRecord[] = [];

export const AUTOPAY_CHARGE_SEED: AutopayChargeRecord[] = [];

export const SUPERBILL_SEED: SuperbillRecord[] = [];

export const BILLING_INVOICES_SEED: BillingInvoice[] = [];
