/** ClinicModuleState `grievances` — Grievances & Client Rights. */
import { addBusinessDays, businessDaysBetween } from '@/lib/workflows/dates';

export type GrievanceStatus =
  | 'submitted'
  | 'acknowledged'
  | 'investigating'
  | 'resolved'
  | 'appealed'
  | 'closed';

export type GrievanceCategory =
  | 'Clinical Care'
  | 'Privacy'
  | 'Billing'
  | 'Staff Conduct'
  | 'Access'
  | 'Rights';

export type GrievancePriority = 'critical' | 'standard' | 'low';

export type TimelineEvent = {
  id: string;
  at: string;
  actor: string;
  note: string;
  status: GrievanceStatus;
};

export type Attachment = {
  id: string;
  name: string;
  uploadedAt: string;
};

export type Grievance = {
  id: string;
  subject: string;
  category: GrievanceCategory;
  status: GrievanceStatus;
  clientInitials: string;
  submittedAt: string;
  receivedAt?: string;
  acknowledgmentDueDate?: string;
  dueDate: string;
  /** When resolved/closed — for days-to-resolve */
  resolvedAt?: string;
  assignedTo: string;
  priority: GrievancePriority;
  description: string;
  /** Short outcome shown in Resolved table */
  resolutionSummary: string;
  timeline: TimelineEvent[];
  attachments: Attachment[];
  rightsCited: string[];
};

export type RightsOfficer = {
  name: string;
  title: string;
  phone: string;
  email: string;
};

export type GrievancesMeta = {
  version: 1;
  resolutionTargetDays: number;
  nextTrendReview: string;
  officer: RightsOfficer;
};

export const GRIEVANCES_META_SEED: GrievancesMeta = {
  version: 1,
  resolutionTargetDays: 10,
  nextTrendReview: '2026-09-30',
  officer: {
    name: 'Dr. Patricia Moore',
    title: 'Clinical Director',
    phone: '(410) 555-0187',
    email: 'rights@divinecounseling.org',
  },
};

export const CATEGORIES: GrievanceCategory[] = [
  'Clinical Care',
  'Privacy',
  'Billing',
  'Staff Conduct',
  'Access',
  'Rights',
];

export const CATEGORY_STYLE: Record<GrievanceCategory, string> = {
  'Clinical Care': 'bg-violet-100 text-violet-800',
  Privacy: 'bg-orange-100 text-orange-800',
  Billing: 'bg-blue-100 text-blue-800',
  'Staff Conduct': 'bg-red-100 text-red-800',
  Access: 'bg-sky-100 text-sky-800',
  Rights: 'bg-amber-100 text-amber-800',
};

export const CATEGORY_BAR: Record<GrievanceCategory, string> = {
  'Clinical Care': '#7C3AED',
  Privacy: '#EA580C',
  Billing: '#2563EB',
  'Staff Conduct': '#DC2626',
  Access: '#0EA5E9',
  Rights: '#D97706',
};

export const OPEN_STATUSES: GrievanceStatus[] = [
  'submitted',
  'acknowledged',
  'investigating',
  'appealed',
];

export function isOpenGrievance(g: Grievance): boolean {
  return OPEN_STATUSES.includes(g.status);
}

export function isResolvedGrievance(g: Grievance): boolean {
  return g.status === 'resolved' || g.status === 'closed';
}

export function formatGrievanceDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

export function daysToResolve(g: Grievance): number | null {
  if (!g.resolvedAt) return null;
  return businessDaysBetween(g.receivedAt ?? g.submittedAt, g.resolvedAt);
}

export function grievanceDeadlines(receivedAt: string) {
  return { acknowledgmentDueDate: addBusinessDays(receivedAt, 2), dueDate: addBusinessDays(receivedAt, 10) };
}

export function avgResolutionDays(items: Grievance[]): number {
  const closed = items.filter((g) => isResolvedGrievance(g) && g.resolvedAt);
  if (!closed.length) return 0;
  const sum = closed.reduce((acc, g) => acc + (daysToResolve(g) ?? 0), 0);
  return Math.round((sum / closed.length) * 10) / 10;
}

/** Map legacy "Quality of Care" → Clinical Care for older module rows. */
export function normalizeGrievance(raw: Grievance): Grievance {
  const cat = (raw.category as string) === 'Quality of Care' ? 'Clinical Care' : raw.category;
  let resolvedAt = raw.resolvedAt;
  if (!resolvedAt && isResolvedGrievance(raw) && raw.timeline?.length) {
    const last = [...raw.timeline].reverse().find((t) => t.status === 'closed' || t.status === 'resolved');
    if (last?.at) resolvedAt = last.at.slice(0, 10);
  }
  return {
    ...raw,
    category: cat as GrievanceCategory,
    resolvedAt,
    resolutionSummary:
      raw.resolutionSummary ||
      raw.timeline?.filter((t) => t.status === 'closed' || t.status === 'resolved').slice(-1)[0]?.note ||
      '',
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    attachments: Array.isArray(raw.attachments) ? raw.attachments : [],
    rightsCited: Array.isArray(raw.rightsCited) ? raw.rightsCited : [],
  };
}

export const GRIEVANCES_SEED: Grievance[] = [
  {
    id: 'GRV-2026-011',
    subject: 'Client Rights document not provided; appeal process unclear',
    category: 'Rights',
    status: 'investigating',
    clientInitials: 'L. Okonkwo',
    submittedAt: '2026-08-12',
    dueDate: '2026-08-26',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'critical',
    description:
      'Client reports not receiving a written copy of Client Rights at intake and being unsure how to appeal a treatment decision. Requesting rights officer review.',
    resolutionSummary: '',
    rightsCited: ['Right to be informed of rights', 'Right to appeal treatment decisions'],
    attachments: [],
    timeline: [
      {
        id: 't1',
        at: '2026-08-12 10:00',
        actor: 'Front Desk',
        note: 'Grievance received via written submission',
        status: 'submitted',
      },
      {
        id: 't2',
        at: '2026-08-12 16:30',
        actor: 'Dr. Patricia Moore',
        note: 'Acknowledged within 24 hours. Rights officer review opened.',
        status: 'acknowledged',
      },
      {
        id: 't3',
        at: '2026-08-14 11:00',
        actor: 'Dr. Patricia Moore',
        note: 'Intake packet audit started. Chart lacks signed rights acknowledgment.',
        status: 'investigating',
      },
    ],
  },
  {
    id: 'GRV-2026-008',
    subject: 'Incorrect telehealth copay charged twice',
    category: 'Billing',
    status: 'investigating',
    clientInitials: 'Denise M.',
    submittedAt: '2026-08-06',
    dueDate: '2026-08-20',
    assignedTo: 'Sarah O.',
    priority: 'standard',
    description:
      'Charged copay incorrectly for telehealth sessions twice; dispute unresolved for 3 weeks despite contacting billing.',
    resolutionSummary: '',
    rightsCited: ['Right to clear billing information'],
    attachments: [],
    timeline: [
      {
        id: 't1',
        at: '2026-08-06 14:14',
        actor: 'System',
        note: 'Grievance received via client portal',
        status: 'submitted',
      },
      {
        id: 't2',
        at: '2026-08-07 09:30',
        actor: 'Sarah O.',
        note: 'Acknowledgment letter sent. Billing records requested.',
        status: 'acknowledged',
      },
      {
        id: 't3',
        at: '2026-08-10 15:45',
        actor: 'Sarah O.',
        note: 'Copay discrepancy confirmed. Claim resubmission in progress.',
        status: 'investigating',
      },
    ],
  },
  {
    id: 'GRV-2026-007',
    subject: 'Unauthorized disclosure of session details to family member',
    category: 'Staff Conduct',
    status: 'investigating',
    clientInitials: 'Family of T.W.',
    submittedAt: '2026-07-30',
    dueDate: '2026-08-13',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'critical',
    description:
      'Family reports clinician disclosed session details without signed authorization. Formal review requested.',
    resolutionSummary: '',
    rightsCited: ['Right to privacy / HIPAA', '42 CFR Part 2 confidentiality'],
    attachments: [],
    timeline: [
      {
        id: 't1',
        at: '2026-07-30 16:55',
        actor: 'Front Desk',
        note: 'Grievance received via phone',
        status: 'submitted',
      },
      {
        id: 't2',
        at: '2026-07-31 08:30',
        actor: 'Dr. Patricia Moore',
        note: 'Acknowledgment letter sent',
        status: 'acknowledged',
      },
      {
        id: 't3',
        at: '2026-08-03 13:15',
        actor: 'Dr. Patricia Moore',
        note: 'Staff interview completed. No consent authorizing disclosure found.',
        status: 'investigating',
      },
    ],
  },
  {
    id: 'GRV-2026-010',
    subject: 'Six-week wait for urgent intake without crisis triage',
    category: 'Access',
    status: 'closed',
    clientInitials: 'R. Johnson',
    submittedAt: '2026-08-01',
    dueDate: '2026-08-15',
    resolvedAt: '2026-08-08',
    assignedTo: 'James Osei',
    priority: 'critical',
    description:
      'Wait time for first intake was 6 weeks. Urgent request not triaged; no crisis screening completed.',
    resolutionSummary:
      'Expedited intake offered Aug 15. Crisis line referral documented. Urgent-request triage protocol updated.',
    rightsCited: ['Right to timely services'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-08-01', actor: 'Front Desk', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-08-08',
        actor: 'James Osei',
        note: 'Expedited intake offered. Triage protocol updated.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-005',
    subject: 'Treatment plan not reviewed for over 4 months',
    category: 'Clinical Care',
    status: 'closed',
    clientInitials: 'Marcus T.',
    submittedAt: '2026-07-18',
    dueDate: '2026-08-01',
    resolvedAt: '2026-07-25',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'standard',
    description: 'Treatment plan not reviewed or updated in over 4 months despite clinical progress.',
    resolutionSummary:
      'Treatment plan reviewed and updated in collaboration with client. Process change implemented requiring mandatory 90-day plan review flag in EHR.',
    rightsCited: ['Right to participate in treatment planning'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-18', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-25',
        actor: 'Dr. Patricia Moore',
        note: 'Plan updated; 90-day EHR flag added.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-004',
    subject: 'Records released to employer without specific consent',
    category: 'Privacy',
    status: 'closed',
    clientInitials: 'Sandra K.',
    submittedAt: '2026-07-10',
    dueDate: '2026-07-24',
    resolvedAt: '2026-07-15',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'critical',
    description: 'Records released to employer without explicit consent for that recipient.',
    resolutionSummary:
      'Review confirmed the release was within scope of the signed consent form. Consent language updated in intake packet for greater specificity.',
    rightsCited: ['Right to privacy / HIPAA'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-10', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-15',
        actor: 'Dr. Patricia Moore',
        note: 'Consent language clarified; client educated.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-003',
    subject: 'Claims submitted under wrong provider NPI',
    category: 'Billing',
    status: 'closed',
    clientInitials: 'Antoine R.',
    submittedAt: '2026-07-05',
    dueDate: '2026-07-19',
    resolvedAt: '2026-07-13',
    assignedTo: 'Sarah O.',
    priority: 'standard',
    description: 'Claims under wrong NPI; $340 out-of-pocket impact.',
    resolutionSummary:
      'Claims resubmitted under correct NPI. Full refund of $340 issued. Billing workflow updated with NPI verification step.',
    rightsCited: ['Right to clear billing information'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-05', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-13',
        actor: 'Sarah O.',
        note: 'Refund issued; NPI check added.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-002',
    subject: 'Culturally insensitive comments by peer support specialist',
    category: 'Staff Conduct',
    status: 'closed',
    clientInitials: 'Family of L.H.',
    submittedAt: '2026-06-28',
    dueDate: '2026-07-12',
    resolvedAt: '2026-07-07',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'critical',
    description: 'Peer support specialist made dismissive comments perceived as culturally insensitive.',
    resolutionSummary:
      'Peer specialist completed cultural humility training. Written apology to family. Supervision increased to weekly for 90 days.',
    rightsCited: ['Right to respectful treatment'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-06-28', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-07',
        actor: 'Dr. Patricia Moore',
        note: 'Training + apology + supervision plan.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-001',
    subject: 'Client portal error blocked telehealth scheduling',
    category: 'Access',
    status: 'closed',
    clientInitials: 'T. Williams',
    submittedAt: '2026-06-20',
    dueDate: '2026-07-04',
    resolvedAt: '2026-06-26',
    assignedTo: 'James Osei',
    priority: 'standard',
    description: 'Portal error blocked telehealth scheduling for ~2 weeks.',
    resolutionSummary:
      'Technical issue resolved with IT vendor. Manual scheduling provided during outage. Portal confirmed functional.',
    rightsCited: ['Right to timely services'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-06-20', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-06-26',
        actor: 'James Osei',
        note: 'Portal fixed; client onboarded.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-009',
    subject: 'Clinician consistently late to sessions',
    category: 'Clinical Care',
    status: 'closed',
    clientInitials: 'Priya N.',
    submittedAt: '2026-06-08',
    dueDate: '2026-06-22',
    resolvedAt: '2026-06-12',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'standard',
    description: 'Clinician consistently 15–20 minutes late without notice.',
    resolutionSummary:
      'Clinician counseled. Scheduling buffer of 15 minutes added between sessions. Client offered time adjustments.',
    rightsCited: ['Right to respectful treatment'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-06-08', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-06-12',
        actor: 'Dr. Patricia Moore',
        note: 'Counseling + calendar buffer.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2025-046',
    subject: 'Incorrect sliding-scale fee after income recertification',
    category: 'Billing',
    status: 'closed',
    clientInitials: 'Kevin B.',
    submittedAt: '2026-05-28',
    dueDate: '2026-06-11',
    resolvedAt: '2026-06-04',
    assignedTo: 'Sarah O.',
    priority: 'low',
    description: 'Wrong sliding-scale fee after income recert; overcharged 3 sessions.',
    resolutionSummary:
      'Credit of $126 applied. Recertification now triggers immediate fee schedule adjustment in billing.',
    rightsCited: ['Right to clear billing information'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-05-28', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-06-04',
        actor: 'Sarah O.',
        note: 'Credit applied; fee schedule automation fixed.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2025-045',
    subject: 'Client Rights document not provided at intake',
    category: 'Clinical Care',
    status: 'closed',
    clientInitials: 'D. Freeman',
    submittedAt: '2026-05-16',
    dueDate: '2026-05-30',
    resolvedAt: '2026-05-26',
    assignedTo: 'James Osei',
    priority: 'standard',
    description: 'Did not receive Client Rights document at intake.',
    resolutionSummary:
      'Rights document reviewed in person. Intake checklist requires signed acknowledgment before service begins.',
    rightsCited: ['Right to be informed of rights'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-05-16', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-05-26',
        actor: 'James Osei',
        note: 'Rights packet + checklist updated.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2025-044',
    subject: 'Denied request to change assigned clinician',
    category: 'Access',
    status: 'closed',
    clientInitials: 'Elena V.',
    submittedAt: '2026-05-02',
    dueDate: '2026-05-16',
    resolvedAt: '2026-05-09',
    assignedTo: 'James Osei',
    priority: 'standard',
    description: 'Client request to change clinician denied without explanation.',
    resolutionSummary:
      'Transfer approved to preferred clinician. Access policy clarified that transfer requests are reviewed within 5 business days.',
    rightsCited: ['Right to participate in treatment planning'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-05-02', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-05-09',
        actor: 'James Osei',
        note: 'Transfer approved; policy clarified.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2025-043',
    subject: 'Invoice missing itemized CPT codes',
    category: 'Billing',
    status: 'closed',
    clientInitials: 'Omar S.',
    submittedAt: '2026-07-02',
    dueDate: '2026-07-16',
    resolvedAt: '2026-07-08',
    assignedTo: 'Sarah O.',
    priority: 'low',
    description: 'Monthly statement lacked itemized CPT codes needed for FSA reimbursement.',
    resolutionSummary:
      'Itemized statement reissued. Billing template updated to include CPT and diagnosis codes by default.',
    rightsCited: ['Right to clear billing information'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-02', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-08',
        actor: 'Sarah O.',
        note: 'Itemized statement sent; template fixed.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-012',
    subject: 'Missed follow-up after medication change',
    category: 'Clinical Care',
    status: 'closed',
    clientInitials: 'Nina P.',
    submittedAt: '2026-07-20',
    dueDate: '2026-08-03',
    resolvedAt: '2026-07-27',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'standard',
    description: 'No outreach after dose increase despite side-effect call to clinic.',
    resolutionSummary:
      'Same-week med check scheduled. Outreach SOP updated for post-titration check-ins within 72 hours.',
    rightsCited: ['Right to participate in treatment planning'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-20', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-27',
        actor: 'Dr. Patricia Moore',
        note: 'Med check scheduled; outreach SOP updated.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-013',
    subject: 'Waiting room privacy — PHI overheard',
    category: 'Privacy',
    status: 'closed',
    clientInitials: 'Chris D.',
    submittedAt: '2026-07-22',
    dueDate: '2026-08-05',
    resolvedAt: '2026-07-29',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'standard',
    description: 'Front desk discussed appointment reason loudly enough for others to hear.',
    resolutionSummary:
      'Staff re-trained on low-volume check-in script. Soft-music privacy barrier added at reception.',
    rightsCited: ['Right to privacy / HIPAA'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-07-22', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-07-29',
        actor: 'Dr. Patricia Moore',
        note: 'Retraining + reception privacy barrier.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-014',
    subject: 'Group session canceled without notice',
    category: 'Access',
    status: 'closed',
    clientInitials: 'Maya L.',
    submittedAt: '2026-08-03',
    dueDate: '2026-08-17',
    resolvedAt: '2026-08-09',
    assignedTo: 'James Osei',
    priority: 'standard',
    description: 'IOP group canceled same morning; client traveled 45 minutes before learning.',
    resolutionSummary:
      'Makeup session offered. Cancellation policy requires 24-hour client notification via portal SMS.',
    rightsCited: ['Right to timely services'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-08-03', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-08-09',
        actor: 'James Osei',
        note: 'Makeup offered; 24h cancel notice policy.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-015',
    subject: 'Rude tone during billing call',
    category: 'Staff Conduct',
    status: 'closed',
    clientInitials: 'Jordan A.',
    submittedAt: '2026-08-05',
    dueDate: '2026-08-19',
    resolvedAt: '2026-08-11',
    assignedTo: 'Sarah O.',
    priority: 'low',
    description: 'Billing coordinator used dismissive language when client questioned a charge.',
    resolutionSummary:
      'Apology issued. Customer-service coaching completed. Call scripts updated for dispute handling.',
    rightsCited: ['Right to respectful treatment'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-08-05', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-08-11',
        actor: 'Sarah O.',
        note: 'Apology + coaching + script update.',
        status: 'closed',
      },
    ],
  },
  {
    id: 'GRV-2026-016',
    subject: 'Lab order delayed after psychiatric evaluation',
    category: 'Clinical Care',
    status: 'closed',
    clientInitials: 'Samira H.',
    submittedAt: '2026-08-07',
    dueDate: '2026-08-21',
    resolvedAt: '2026-08-14',
    assignedTo: 'Dr. Patricia Moore',
    priority: 'standard',
    description: 'Baseline labs ordered at evaluation were not transmitted for 11 days.',
    resolutionSummary:
      'Labs ordered same day. EHR task queue now auto-escalates unsigned lab orders at 48 hours.',
    rightsCited: ['Right to participate in treatment planning'],
    attachments: [],
    timeline: [
      { id: 't1', at: '2026-08-07', actor: 'System', note: 'Received', status: 'submitted' },
      {
        id: 't2',
        at: '2026-08-14',
        actor: 'Dr. Patricia Moore',
        note: 'Labs placed; 48h escalation rule added.',
        status: 'closed',
      },
    ],
  },
];
