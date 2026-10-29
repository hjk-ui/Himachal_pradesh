/** ClinicModuleState `compliance-calendar` + `compliance-meta`. */

export type Category =
  | 'HIPAA / Privacy'
  | 'Staff Credentials'
  | 'CARF'
  | 'Insurance/Payer'
  | 'State License'
  | 'Quality Reporting'
  | 'Grant Reporting'
  | 'Federal Reporting';

export type Priority = 'Critical' | 'High' | 'Medium' | 'Low';
export type Frequency = 'annually' | 'quarterly' | 'monthly' | 'one-time' | 'as-needed';
export type ItemStatus = 'upcoming' | 'overdue' | 'completed';

export type ComplianceItem = {
  id: string;
  title: string;
  category: Category;
  priority: Priority;
  frequency: Frequency;
  status: ItemStatus;
  dueDate: string;
  owner: string;
  description: string;
  /** Grey callout under description */
  contextNote?: string;
  completedAt?: string;
  completionNote?: string;
};

export type CarfDomain = {
  key: string;
  label: string;
  score: number;
  color: string;
};

export type ComplianceMeta = {
  version: 1;
  carfOverall: number;
  carfSurveyEnds: string;
  carfDomains: CarfDomain[];
  /** Historical completed count beyond listed module rows (YTD total) */
  completedYtdTotal: number;
};

export const COMPLIANCE_META_SEED: ComplianceMeta = {
  version: 1,
  carfOverall: 82,
  carfSurveyEnds: '2027-03',
  carfDomains: [
    { key: 'pcs', label: 'Person-Centered Services', score: 91, color: '#10B981' },
    { key: 'qi', label: 'Quality Improvement', score: 78, color: '#F59E0B' },
    { key: 'pe', label: 'Program Evaluation', score: 85, color: '#14B8A6' },
    { key: 'hr', label: 'HR & Governance', score: 74, color: '#EF4444' },
  ],
  completedYtdTotal: 28,
};

export const CATEGORIES: Category[] = [
  'HIPAA / Privacy',
  'Staff Credentials',
  'CARF',
  'Insurance/Payer',
  'State License',
  'Quality Reporting',
  'Grant Reporting',
  'Federal Reporting',
];

/** Normalize legacy "HIPAA/Privacy" → "HIPAA / Privacy" */
export function normalizeCategory(raw: string): Category {
  if (raw === 'HIPAA/Privacy' || raw === 'HIPAA / Privacy') return 'HIPAA / Privacy';
  if ((CATEGORIES as string[]).includes(raw)) return raw as Category;
  return 'CARF';
}

export function normalizeItem(raw: ComplianceItem): ComplianceItem {
  const notes = (raw as ComplianceItem & { notes?: string }).notes;
  return {
    ...raw,
    category: normalizeCategory(raw.category as string),
    priority: raw.priority || 'Medium',
    frequency: raw.frequency || 'annually',
    description: raw.description || notes || '',
    contextNote: raw.contextNote,
  };
}

export const COMPLIANCE_CALENDAR_SEED: ComplianceItem[] = [
  {
    id: 'cmp-001',
    category: 'HIPAA / Privacy',
    title: 'HIPAA Security Rule Risk Assessment Update',
    priority: 'Critical',
    frequency: 'annually',
    status: 'overdue',
    dueDate: '2026-07-31',
    owner: 'Alicia Thompson',
    description:
      'Annual HIPAA Security Rule risk assessment — evaluate all ePHI access points, update risk register, and document mitigation measures per 45 CFR §164.308(a)(1).',
    contextNote: 'Must be signed by Privacy Officer. Previous assessment completed Jul 2025.',
  },
  {
    id: 'cmp-002',
    category: 'Staff Credentials',
    title: 'Annual HIPAA Training — Terrance Coleman',
    priority: 'High',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-08-20',
    owner: 'HR Department',
    description:
      'Annual HIPAA privacy and security workforce training per 45 CFR §164.530. Completion certificate required for HR file.',
  },
  {
    id: 'cmp-003',
    category: 'CARF',
    title: 'CARF Quarterly QI Data Submission — Q2 2026',
    priority: 'High',
    frequency: 'quarterly',
    status: 'upcoming',
    dueDate: '2026-08-31',
    owner: 'Dr. Moore',
    description:
      'Submit Q2 2026 performance improvement data to CARF portal including treatment outcomes, client satisfaction scores, and access-to-care metrics.',
  },
  {
    id: 'cmp-004',
    category: 'Insurance/Payer',
    title: 'Medicaid Provider Revalidation — Dr. Patricia Chen, NP',
    priority: 'Critical',
    frequency: 'one-time',
    status: 'upcoming',
    dueDate: '2026-08-31',
    owner: 'Admin',
    description:
      'Maryland Medicaid 5-year provider revalidation through LTSS MMS portal. Required to maintain active billing privileges.',
    contextNote: 'Required: DEA certificate, malpractice cert, MD license copy, current CAQH profile.',
  },
  {
    id: 'cmp-005',
    category: 'Quality Reporting',
    title: 'Q3 Documentation Compliance Spot Audit',
    priority: 'Medium',
    frequency: 'quarterly',
    status: 'upcoming',
    dueDate: '2026-08-28',
    owner: 'QI Coordinator',
    description:
      'Random chart audit of progress notes and treatment plan timeliness for Q3 CARF indicator tracking.',
  },
  {
    id: 'cmp-006',
    category: 'State License',
    title: 'OMHC Annual License Renewal — Maryland BHSES',
    priority: 'Critical',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-09-01',
    owner: 'Practice Director',
    description:
      'Annual renewal of Outpatient Mental Health Center license through Maryland BHSES online portal. Updated staff rosters, floor plans, and policy attestations required.',
  },
  {
    id: 'cmp-007',
    category: 'Staff Credentials',
    title: 'LPC License Renewal — James Osei',
    priority: 'High',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-09-15',
    owner: 'James Osei',
    description:
      'Maryland Board of Professional Counselors LPC license renewal. 40 CEU hours required including minimum 3 hours ethics.',
  },
  {
    id: 'cmp-008',
    category: 'CARF',
    title: 'CAP-2026-02: Treatment Plan Completion Rate',
    priority: 'High',
    frequency: 'as-needed',
    status: 'upcoming',
    dueDate: '2026-09-15',
    owner: 'James Osei',
    description:
      'Submit corrective action plan progress report addressing treatment plan completion rate. Target: 95% within 30 days of intake. Current rate: 87%.',
  },
  {
    id: 'cmp-009',
    category: 'Quality Reporting',
    title: 'MIPS Quality Reporting — Q2 2026',
    priority: 'High',
    frequency: 'quarterly',
    status: 'upcoming',
    dueDate: '2026-09-30',
    owner: 'Billing Team',
    description:
      'Merit-based Incentive Payment System quality data submission for Q2 2026 via CMS Quality Payment Program portal.',
  },
  {
    id: 'cmp-010',
    category: 'CARF',
    title: 'CARF Internal Self-Study — Annual Readiness Review',
    priority: 'High',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-10-01',
    owner: 'Practice Director',
    description:
      'Conduct internal CARF readiness review using 2026 standards manual. Document standards achieved, gaps, and corrective assignments.',
  },
  {
    id: 'cmp-011',
    category: 'Insurance/Payer',
    title: 'Professional Liability Insurance Renewal',
    priority: 'Critical',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-10-15',
    owner: 'Admin',
    description:
      'Annual renewal of professional malpractice and general liability insurance. Obtain updated certificates for all credentialed providers.',
  },
  {
    id: 'cmp-012',
    category: 'Staff Credentials',
    title: 'DEA Registration Renewal — Dr. Marcus Moore',
    priority: 'Critical',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-10-31',
    owner: 'Dr. Moore',
    description:
      'DEA Certificate of Registration renewal for Schedule II–V controlled substance prescribing authority.',
  },
  {
    id: 'cmp-013',
    category: 'Grant Reporting',
    title: 'SAMHSA Community MH Block Grant Annual Report',
    priority: 'High',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-11-30',
    owner: 'Practice Director',
    description:
      'Annual state behavioral health block grant narrative report and outcome data submission through SABG reporting system.',
  },
  {
    id: 'cmp-014',
    category: 'CARF',
    title: 'CARF Annual Program Evaluation',
    priority: 'High',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-12-01',
    owner: 'QI Committee',
    description:
      'Required annual written evaluation of program effectiveness, goal attainment, and planning for the coming year.',
  },
  {
    id: 'cmp-015',
    category: 'Federal Reporting',
    title: 'W-2 and ACA 1095-C Reporting Preparation',
    priority: 'Medium',
    frequency: 'annually',
    status: 'upcoming',
    dueDate: '2026-12-15',
    owner: 'HR Department',
    description:
      'Year-end payroll and ACA employer mandate reporting setup. Verify employee data and prepare 1095-C forms.',
  },
  {
    id: 'cmp-016',
    category: 'CARF',
    title: 'CARF Accreditation Survey — Final Readiness Phase',
    priority: 'Critical',
    frequency: 'one-time',
    status: 'upcoming',
    dueDate: '2026-12-31',
    owner: 'Practice Director',
    description:
      'Final preparation for CARF 3-year on-site accreditation survey (scheduled March 2027). Complete mock survey and brief all staff.',
    contextNote: 'Survey window: March 9–11, 2027. Previous accreditation awarded: March 2024.',
  },
  {
    id: 'cmp-c01',
    category: 'Quality Reporting',
    title: 'MIPS Quality Reporting — Q1 2026',
    priority: 'High',
    frequency: 'quarterly',
    status: 'completed',
    dueDate: '2026-06-30',
    completedAt: '2026-06-18',
    owner: 'Billing Team',
    description: 'Q1 2026 MIPS data submitted via CMS QPP portal.',
    completionNote: 'Submitted on time. 6 quality measures reported. Estimated +2.1% payment adjustment.',
  },
  {
    id: 'cmp-c02',
    category: 'Staff Credentials',
    title: 'CPR / First Aid Recertification — All Clinical Staff',
    priority: 'High',
    frequency: 'annually',
    status: 'completed',
    dueDate: '2026-06-30',
    completedAt: '2026-06-10',
    owner: 'HR Department',
    description: 'Annual CPR and first aid recertification for all direct-service clinical staff.',
    completionNote: '14 of 14 clinical staff certified. Certificates filed in HR records.',
  },
  {
    id: 'cmp-c03',
    category: 'HIPAA / Privacy',
    title: 'Business Associate Agreement Annual Audit',
    priority: 'High',
    frequency: 'annually',
    status: 'completed',
    dueDate: '2026-05-31',
    completedAt: '2026-05-22',
    owner: 'Alicia Thompson',
    description: 'Annual review and update of all BAAs with vendors handling PHI.',
    completionNote:
      '12 BAAs reviewed. 2 updated (EHR vendor, telehealth). 1 new BAA executed with billing clearinghouse.',
  },
  {
    id: 'cmp-c04',
    category: 'CARF',
    title: 'CARF Quarterly QI Data Submission — Q1 2026',
    priority: 'High',
    frequency: 'quarterly',
    status: 'completed',
    dueDate: '2026-05-31',
    completedAt: '2026-05-28',
    owner: 'Dr. Moore',
    description: 'Q1 2026 performance improvement data submitted to CARF portal.',
    completionNote:
      'Client satisfaction: 87% very satisfied. Retention rate: 91%. No corrective actions needed.',
  },
  {
    id: 'cmp-c05',
    category: 'State License',
    title: 'BHSES Change of Information — New Office Suite',
    priority: 'Critical',
    frequency: 'one-time',
    status: 'completed',
    dueDate: '2026-04-30',
    completedAt: '2026-04-15',
    owner: 'Practice Director',
    description: 'Submit updated facility address and floor plan following April 2026 office expansion.',
    completionNote: 'BHSES approval received April 28. License updated to reflect Suite 200.',
  },
  {
    id: 'cmp-c06',
    category: 'Federal Reporting',
    title: 'ACA 1095-C Filing — Tax Year 2025',
    priority: 'High',
    frequency: 'annually',
    status: 'completed',
    dueDate: '2026-03-31',
    completedAt: '2026-03-25',
    owner: 'HR Department',
    description: 'Submit 1095-C forms to IRS and distribute to employees for tax year 2025.',
    completionNote: 'All forms filed with IRS. Employee copies distributed March 10. No corrections required.',
  },
];

export function todayIso(from = new Date()): string {
  return from.toISOString().slice(0, 10);
}

export function daysUntil(dueIso: string, from = new Date()): number {
  const target = new Date(`${dueIso.slice(0, 10)}T12:00:00`);
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatDueDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function monthKey(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }).toUpperCase();
}

export function isOpenItem(i: ComplianceItem): boolean {
  return i.status !== 'completed';
}

export function effectiveStatus(i: ComplianceItem, from = new Date()): ItemStatus {
  if (i.status === 'completed') return 'completed';
  if (i.status === 'overdue') return 'overdue';
  if (daysUntil(i.dueDate, from) < 0) return 'overdue';
  return 'upcoming';
}
