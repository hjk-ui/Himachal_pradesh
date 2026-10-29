/** ClinicModuleState `incidents` — CARF incident reporting payload. */

export type Severity = 'critical' | 'serious' | 'minor';
export type IncidentStatus = 'reported' | 'investigating' | 'corrective_action' | 'closed';
export type Timeliness = 'within_24h' | 'late';

/** Short labels used in the Q3 bar chart (screenshot). */
export type ChartCategory =
  | 'Self-Harm'
  | 'Near-Miss'
  | 'Client Fall'
  | 'Elopement'
  | 'Aggression'
  | 'Privacy'
  | 'Staff Injury';

export type Incident = {
  id: string;
  title: string;
  type: string;
  chartCategory: ChartCategory;
  severity: Severity;
  status: IncidentStatus;
  clientInitials: string;
  reportedBy: string;
  assignedTo: string;
  /** ISO date YYYY-MM-DD */
  reportedAt: string;
  dueFollowUp: string;
  /** Set when status becomes closed — used for avg resolution */
  closedAt?: string;
  location: string;
  description: string;
  immediateAction: string;
  investigationNotes: string;
  correctiveActions: string[];
  rootCause: string;
  timeliness: Timeliness;
  carfCategory: string;
};

export const INCIDENT_TYPES = [
  'Self-Harm Event',
  'Near-Miss: Medication',
  'Near-Miss: Other',
  'Client Fall',
  'Elopement',
  'Aggressive Behavior',
  'Privacy Breach',
  'Staff Injury',
  'Medication Error',
  'Medical Emergency',
  'Behavioral Crisis',
  'Property Damage',
  'Other',
] as const;

export const CHART_CATEGORIES: { key: ChartCategory; color: string }[] = [
  { key: 'Self-Harm', color: '#5B4FC9' },
  { key: 'Near-Miss', color: '#A78BFA' },
  { key: 'Client Fall', color: '#F59E0B' },
  { key: 'Elopement', color: '#EF4444' },
  { key: 'Aggression', color: '#EA580C' },
  { key: 'Privacy', color: '#0D9488' },
  { key: 'Staff Injury', color: '#059669' },
];

export const INCIDENTS_SEED: Incident[] = [];

export const OPEN_STATUSES: IncidentStatus[] = ['reported', 'investigating', 'corrective_action'];

export function isOpenIncident(i: Incident): boolean {
  return OPEN_STATUSES.includes(i.status);
}

export function formatIncidentDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00`).getTime();
  const b = new Date(`${toIso}T12:00:00`).getTime();
  return Math.max(0, Math.round((b - a) / (1000 * 60 * 60 * 24)));
}

export function avgResolutionDays(incidents: Incident[]): number {
  const closed = incidents.filter((i) => i.status === 'closed' && i.closedAt);
  if (!closed.length) return 0;
  const sum = closed.reduce((acc, i) => acc + daysBetween(i.reportedAt, i.closedAt!), 0);
  return Math.round((sum / closed.length) * 10) / 10;
}

export function chartCategoryForType(type: string): ChartCategory {
  const t = type.toLowerCase();
  if (t.includes('self-harm') || t.includes('self harm')) return 'Self-Harm';
  if (t.includes('near-miss') || t.includes('near miss')) return 'Near-Miss';
  if (t.includes('fall')) return 'Client Fall';
  if (t.includes('elope')) return 'Elopement';
  if (t.includes('aggress')) return 'Aggression';
  if (t.includes('privacy')) return 'Privacy';
  if (t.includes('staff')) return 'Staff Injury';
  return 'Near-Miss';
}

export function normalizeIncident(raw: Incident): Incident {
  return {
    ...raw,
    chartCategory: raw.chartCategory || chartCategoryForType(raw.type),
    immediateAction: raw.immediateAction || '',
    rootCause: raw.rootCause || '',
    correctiveActions: Array.isArray(raw.correctiveActions) ? raw.correctiveActions : [],
    timeliness: raw.timeliness || 'within_24h',
  };
}

/** Q3 window used for KPI subtitle (matches screenshot period). */
export const QUARTER_LABEL = 'Jul 1 – Aug 14, 2026';
export const CHART_TITLE_PERIOD = 'Q3 2026';
