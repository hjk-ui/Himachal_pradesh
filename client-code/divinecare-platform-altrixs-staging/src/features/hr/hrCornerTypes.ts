export type HrCornerEmployee = {
  id: string;
  userId: string;
  name: string;
  email: string;
  initials: string;
  jobTitle: string;
  department: string;
  employmentType: string;
  hrStatus: string;
  hireDate: string | null;
  hireLabel: string;
  managerName: string;
  role: string;
  npi: string | null;
  deaNumber: string | null;
  sortOrder: number;
};

export type HrPayrollDTO = {
  id: string;
  period: string;
  periodHint: string;
  employees: number;
  gross: number;
  taxes: number;
  benefits: number;
  net: number;
  runDate: string;
  status: string;
};

export type HrBenefitDTO = {
  id: string;
  plan: string;
  carrier: string;
  enrolled: number;
  eligible: number;
  employerCost: number;
  employeeCost: number;
  employerCostLabel: string;
  employeeCostLabel: string;
  details: string;
};

export type HrLeaveDTO = {
  id: string;
  employee: string;
  leaveType: string;
  dates: string;
  days: number;
  submitted: string;
  notes: string;
  status: string;
};

export type HrPtoDTO = {
  id: string;
  employee: string;
  department: string;
  vacationHrs: number;
  sickHrs: number;
  personalHrs: number;
  fmlaUsed: string;
  ytdUsed: number;
  pendingRequest: string;
};

export type HrApplicantDTO = {
  id: string;
  name: string;
  email: string;
  stage: string;
  appliedAt: string;
  notes: string;
};

export type HrRequisitionDTO = {
  id: string;
  title: string;
  department: string;
  priority: string;
  type: string;
  posted: string;
  salary: string;
  applied: number;
  screened: number;
  interviews: number;
  offers: number;
  hired: number;
  applicants: HrApplicantDTO[];
};

export type HrComplianceDTO = { id: string; title: string; detail: string; status: string };

export type HrCeuDTO = {
  id: string;
  clinician: string;
  license: string;
  creditsEarned: number;
  creditsRequired: number;
  pct: number;
};

export type HrLicenseDTO = {
  id: string;
  userId: string;
  clinician: string;
  department: string;
  credential: string;
  licenseNumber: string;
  npLicense?: string | null;
  npi: string | null;
  deaNumber: string | null;
  expiresAt: string;
  daysLeft: number;
  reminderAt: string | null;
};

export type HrCornerPayload = {
  success: true;
  schemaReady: true;
  employees: HrCornerEmployee[];
  /** null = not tracked in Altrixs */
  snapshot: {
    ytdTurnoverPct: number | null;
    avgTenureYears: number | null;
    avgTimeToFillDays: number | null;
    timeToFillDeltaDays: number | null;
    costPerHire: number | null;
    fmlaHoursYtd: number | null;
    avgVacationDays: number | null;
    ceuCompliancePct: number | null;
    electiveOfferings: number | null;
    requiredTrainings: number | null;
    totalCreditsAvailable: number | null;
    benefitsCostMonthly: number | null;
    complianceScore: number | null;
    pendingW4: number | null;
    ytdPayroll: number | null;
    employeesOnLeaveToday: number;
    openEnrollmentNote: string;
    openEnrollmentDetail: string;
    payrollProviderNote: string;
  } | null;
  payroll: HrPayrollDTO[];
  benefits: HrBenefitDTO[];
  leave: HrLeaveDTO[];
  pto: HrPtoDTO[];
  requisitions: HrRequisitionDTO[];
  compliance: HrComplianceDTO[];
  ceu: HrCeuDTO[];
  deposit: {
    percentOnDd: number;
    bankName: string;
    accountLast4: string;
    routingLast4: string;
  } | null;
  headcount: { id: string; monthLabel: string; count: number }[];
  turnover: { id: string; monthLabel: string; count: number }[];
  deptComp: {
    id: string;
    department: string;
    headcount: number;
    avgSalary: number | null;
    totalPayrollYr: number | null;
    ceuPct: number | null;
    turnoverLabel: string;
    turnoverTone: string;
  }[];
  licenses: HrLicenseDTO[];
  kpis: {
    headcount: number;
    fullTime: number;
    partTime: number;
    contract: number;
    ytdTurnoverPct: number | null;
    lastPayroll: number;
    lastPayrollHint: string;
    nextPayDate: string;
    nextPayHint: string;
    ytdPayroll: number | null;
    pendingW4: number | null;
    nextRun: HrPayrollDTO | undefined;
    pendingLeave: number;
    onLeaveToday: number;
    openReqs: number;
    totalApplicants: number;
    interviews: number;
    offers: number;
    activeLicenses: number;
    expiring90: number;
    npiCount: number;
    deaCount: number;
    alertCount: number;
    reviewCount: number;
    compliantCount: number;
  };
  badges: { payroll: number; pto: number; credentialing: number; compliance: number };
  departments: { name: string; count: number; pct: number }[];
  leadership: { director: HrCornerEmployee | undefined; reports: HrCornerEmployee[] };
  alertBanner: { count: number; text: string } | null;
};
