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
  carfOverall: 0,
  carfSurveyEnds: '',
  carfDomains: [
    { key: 'pcs', label: 'Person-Centered Services', score: 0, color: '#10B981' },
    { key: 'qi', label: 'Quality Improvement', score: 0, color: '#F59E0B' },
    { key: 'pe', label: 'Program Evaluation', score: 0, color: '#14B8A6' },
    { key: 'hr', label: 'HR & Governance', score: 0, color: '#EF4444' },
  ],
  completedYtdTotal: 0,
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

export const COMPLIANCE_CALENDAR_SEED: ComplianceItem[] = [];

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
