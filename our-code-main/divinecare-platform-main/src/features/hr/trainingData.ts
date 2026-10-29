export type TrainingStatus = 'complete' | 'expiring' | 'overdue' | 'not-required' | 'in-progress';

export interface TrainingDef {
  id: string;
  name: string;
  shortName: string;
  frequency: string;
}

export interface StaffTraining {
  trainingId: string;
  status: TrainingStatus;
  completedDate?: string;
  expiresDate?: string;
  provider?: string;
  certNumber?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
  hireDate: string;
  isNewHire: boolean;
  trainings: StaffTraining[];
  orientation: { id: string; label: string; done: boolean }[];
}

export const HR_TRAININGS_CATALOG_SEED: TrainingDef[] = [
  { id: 'cpr', name: 'CPR / First Aid', shortName: 'CPR/FA', frequency: '2yr' },
  { id: 'qpr', name: 'Suicide Prevention — QPR', shortName: 'QPR', frequency: 'Annual' },
  { id: 'mandatory', name: 'Mandatory Reporter', shortName: 'Mand. Rep.', frequency: 'Annual' },
  { id: 'hipaa', name: 'HIPAA Privacy', shortName: 'HIPAA', frequency: 'Annual' },
  { id: 'crisis', name: 'Crisis De-escalation', shortName: 'Crisis DE', frequency: 'Annual' },
  { id: 'trauma', name: 'Trauma-Informed Care', shortName: 'TIC', frequency: '2yr' },
  { id: 'cultural', name: 'Cultural Competency', shortName: 'Cultural', frequency: 'Annual' },
  { id: 'mi', name: 'Motivational Interviewing', shortName: 'MI', frequency: 'One-time' },
  { id: 'documentation', name: 'Documentation Standards', shortName: 'Doc Stds', frequency: 'Annual' },
  { id: 'fire', name: 'Fire Safety / Emergency', shortName: 'Fire Safety', frequency: 'Annual' },
];

export const ORIENTATION_TEMPLATE = [
  { id: 'o1', label: 'HR paperwork & I-9' },
  { id: 'o2', label: 'EHR login & documentation standards' },
  { id: 'o3', label: 'Emergency procedures walkthrough' },
  { id: 'o4', label: 'Shadow 2 clinical sessions' },
  { id: 'o5', label: 'Complete HIPAA + Mandated Reporter' },
  { id: 'o6', label: 'Meet supervisor / caseload assignment' },
  { id: 'o7', label: 'Review client rights & grievance policy' },
  { id: 'o8', label: 'Sign code of conduct & handbook' },
];

export const STATUS_CFG: Record<TrainingStatus, { label: string; color: string; bg: string; short: string }> = {
  complete: { label: 'Complete', color: '#15803d', bg: '#dcfce7', short: '✓' },
  expiring: { label: 'Expiring', color: '#b45309', bg: '#fef3c7', short: '!' },
  overdue: { label: 'Overdue', color: '#dc2626', bg: '#fee2e2', short: '✗' },
  'not-required': { label: 'N/A', color: '#94a3b8', bg: '#f1f5f9', short: '—' },
  'in-progress': { label: 'In progress', color: '#4F46E5', bg: '#EEF2FF', short: '…' },
};

export const HR_TRAINING_STAFF_SEED: StaffMember[] = [];
