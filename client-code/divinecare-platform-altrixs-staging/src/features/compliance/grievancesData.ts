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
  nextTrendReview: '',
  officer: {
    name: '',
    title: '',
    phone: '',
    email: '',
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

export const GRIEVANCES_SEED: Grievance[] = [];
