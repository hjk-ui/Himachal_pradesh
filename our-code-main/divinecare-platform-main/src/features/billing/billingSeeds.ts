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
  email: string;
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
  name: 'Divine Counseling LLC',
  address: '100 Light St, Suite 400, Baltimore, MD 21202',
  phone: '(410) 555-0100',
  npi: '1234567890',
  taxId: '52-1234567',
};

export const INSURANCE_PANEL_SEED: InsurancePanelRecord[] = [
  {
    panelId: 'pan-md-medicaid',
    payer: 'Maryland Medicaid',
    payerId: '77032',
    status: 'active',
    effectiveDate: '2024-01-01',
    contractRenewalDate: '2027-01-01',
    credentialingContact: 'Provider Relations: 1-800-555-0001',
    notes: 'HealthChoice network. All outpatient therapy and PRP services active.',
    feeSchedule: 'MD Medicaid 2026 - 90837: $121.44',
    openToNewClients: true,
  },
  {
    panelId: 'pan-medicare',
    payer: 'Medicare Part B',
    payerId: '00882',
    status: 'active',
    effectiveDate: '2023-06-01',
    contractRenewalDate: null,
    credentialingContact: 'CGS Administrators: 1-855-555-0002',
    notes: 'Outpatient mental health. Standard deductible and coinsurance apply.',
    feeSchedule: '2026 Medicare PFS - 90837: $119.78',
    openToNewClients: true,
  },
  {
    panelId: 'pan-carefirst',
    payer: 'CareFirst BCBS',
    payerId: '00560',
    status: 'active',
    effectiveDate: '2024-03-01',
    contractRenewalDate: '2027-03-01',
    credentialingContact: 'Provider Credentialing: 1-410-555-0003',
    notes: 'BlueChoice HMO + PPO contracts. Closed to new therapy referrals in North Baltimore.',
    feeSchedule: 'CareFirst 2026 - 90837: $145.00',
    openToNewClients: false,
  },
  {
    panelId: 'pan-aetna',
    payer: 'Aetna',
    payerId: '60054',
    status: 'pending',
    effectiveDate: null,
    contractRenewalDate: null,
    credentialingContact: 'Aetna Provider Services: 1-888-555-0004',
    notes: 'Application submitted 2026-05-15. CAQH complete. Awaiting committee review.',
    feeSchedule: null,
    openToNewClients: false,
  },
  {
    panelId: 'pan-uhc',
    payer: 'United Healthcare',
    payerId: '87726',
    status: 'credentialing',
    effectiveDate: null,
    contractRenewalDate: null,
    credentialingContact: 'UHC Provider Network: 1-877-555-0005',
    notes: 'Credentialing in progress. Estimated 90 to 120 days.',
    feeSchedule: null,
    openToNewClients: false,
  },
  {
    panelId: 'pan-cigna',
    payer: 'Cigna',
    payerId: '62308',
    status: 'pending',
    effectiveDate: null,
    contractRenewalDate: null,
    credentialingContact: 'Cigna Behavioral Health: 1-800-555-0006',
    notes: 'CAQH attestation complete 2026-06-01. Waiting on committee review.',
    feeSchedule: null,
    openToNewClients: false,
  },
  {
    panelId: 'pan-humana',
    payer: 'Humana',
    payerId: '61101',
    status: 'not_credentialed',
    effectiveDate: null,
    contractRenewalDate: null,
    credentialingContact: 'Humana Provider Relations: 1-800-555-0007',
    notes: 'Not currently pursuing. Will reassess in Q4 2026.',
    feeSchedule: null,
    openToNewClients: false,
  },
  {
    panelId: 'pan-self-pay',
    payer: 'Self-Pay',
    payerId: null,
    status: 'active',
    effectiveDate: '2023-01-01',
    contractRenewalDate: null,
    credentialingContact: null,
    notes: 'Sliding scale $80-$150/session. Superbills available for out-of-network reimbursement.',
    feeSchedule: 'Private Pay 2026 - 90837: $150',
    openToNewClients: true,
  },
];

export const AUTOPAY_CHARGE_SEED: AutopayChargeRecord[] = [];

export const SUPERBILL_SEED: SuperbillRecord[] = [];

export const BILLING_INVOICES_SEED: BillingInvoice[] = [];

