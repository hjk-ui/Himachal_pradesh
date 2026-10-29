export type HrPayrollRow = {
  id: string;
  period: string;
  employees: number;
  gross: number;
  taxes: number;
  benefits: number;
  net: number;
  runDate: string;
  status: 'scheduled' | 'completed';
};

export type HrBenefitPlan = {
  id: string;
  plan: string;
  carrier: string;
  enrolled: number;
  eligible: number;
  employerCost: number;
  employeeCost: number;
};

export type HrLeaveRequest = {
  id: string;
  employee: string;
  leaveType: 'Vacation' | 'FMLA' | 'Sick' | 'Personal';
  dates: string;
  days: number;
  submitted: string;
  notes: string;
  status: 'Pending' | 'Approved' | 'Denied';
};

export type HrRequisition = {
  id: string;
  title: string;
  department: string;
  priority: 'high' | 'medium' | 'low';
  type: 'Full-Time' | 'Part-Time' | 'Contract';
  posted: string;
  salary: string;
  applied: number;
  screened: number;
  interviews: number;
  offers: number;
  hired: number;
};

export type HrTrainingRow = {
  id: string;
  employee: string;
  course: string;
  due: string;
  credits: number;
  status: 'Required' | 'In Progress' | 'Complete';
};

export const HR_PAYROLL_SEED: HrPayrollRow[] = [
  { id: 'pay-2026-03-01', period: 'Mar 1 - Mar 15, 2026', employees: 12, gross: 98420, taxes: 18440, benefits: 8640, net: 71340, runDate: 'Mar 20, 2026', status: 'scheduled' },
  { id: 'pay-2026-02-16', period: 'Feb 16 - Feb 28, 2026', employees: 12, gross: 96810, taxes: 18110, benefits: 8598, net: 70102, runDate: 'Mar 5, 2026', status: 'completed' },
  { id: 'pay-2026-02-01', period: 'Feb 1 - Feb 15, 2026', employees: 11, gross: 94120, taxes: 17640, benefits: 8340, net: 68140, runDate: 'Feb 20, 2026', status: 'completed' },
];

export const HR_BENEFITS_SEED: HrBenefitPlan[] = [
  { id: 'benefit-medical', plan: 'Medical - BCBS Blue Preferred (PPO)', carrier: 'CareFirst BCBS', enrolled: 9, eligible: 10, employerCost: 520, employeeCost: 180 },
  { id: 'benefit-dental', plan: 'Dental - Delta Dental PPO', carrier: 'Delta Dental', enrolled: 8, eligible: 10, employerCost: 40, employeeCost: 12 },
  { id: 'benefit-vision', plan: 'Vision - VSP Choice', carrier: 'VSP', enrolled: 7, eligible: 10, employerCost: 15, employeeCost: 5 },
  { id: 'benefit-retirement', plan: 'Retirement - 403(b) Plan', carrier: 'Fidelity', enrolled: 6, eligible: 10, employerCost: 0, employeeCost: 0 },
];

export const HR_LEAVE_SEED: HrLeaveRequest[] = [
  { id: 'leave-1', employee: 'Maria Rivera', leaveType: 'Vacation', dates: 'Mar 20-21, 2026', days: 2, submitted: 'Mar 2', notes: 'Family commitment', status: 'Pending' },
  { id: 'leave-2', employee: 'Lisa Chen', leaveType: 'FMLA', dates: 'Mar 10-14, 2026', days: 5, submitted: 'Mar 1', notes: 'Approved - medical', status: 'Approved' },
  { id: 'leave-3', employee: 'Angela Brooks', leaveType: 'Sick', dates: 'Mar 7, 2026', days: 1, submitted: 'Mar 6', notes: '-', status: 'Approved' },
  { id: 'leave-4', employee: 'Darius Roberts', leaveType: 'Personal', dates: 'Mar 15, 2026', days: 1, submitted: 'Mar 5', notes: '-', status: 'Pending' },
];

export const HR_REQUISITIONS_SEED: HrRequisition[] = [
  { id: 'req-therapist', title: 'Licensed Therapist (LCSW/LGPC)', department: 'Clinical', priority: 'high', type: 'Full-Time', posted: 'Feb 10, 2026', salary: '$68k-$82k', applied: 14, screened: 8, interviews: 3, offers: 1, hired: 0 },
  { id: 'req-prp', title: 'PRP Specialist', department: 'PRP', priority: 'medium', type: 'Full-Time', posted: 'Feb 25, 2026', salary: '$42k-$52k', applied: 7, screened: 4, interviews: 2, offers: 0, hired: 0 },
  { id: 'req-billing', title: 'Billing Specialist (CPC)', department: 'Administrative', priority: 'low', type: 'Part-Time', posted: 'Mar 1, 2026', salary: '$24-$30/hr', applied: 5, screened: 2, interviews: 1, offers: 0, hired: 0 },
];

export const HR_TRAINING_SEED: HrTrainingRow[] = [
  { id: 'training-1', employee: 'Dr. Sarah Smith', course: 'Ethics and Boundaries', due: 'Mar 31, 2026', credits: 3, status: 'Required' },
  { id: 'training-2', employee: 'Maria Rivera', course: 'Trauma-Informed Care', due: 'Apr 15, 2026', credits: 4, status: 'In Progress' },
  { id: 'training-3', employee: 'Dr. James Park', course: 'Clinical Documentation', due: 'Completed', credits: 4, status: 'Complete' },
  { id: 'training-4', employee: 'Tony Williams', course: 'Privacy and Security', due: 'Completed', credits: 2, status: 'Complete' },
];
