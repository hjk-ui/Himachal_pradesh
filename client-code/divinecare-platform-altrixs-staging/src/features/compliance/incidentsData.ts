/** CARF incident reporting: the page shape of an IncidentReport row (GET /api/incidents). */
import { incidentTimeliness } from '@/lib/compliance/metrics';

export type Severity = 'critical' | 'serious' | 'minor';
export type IncidentStatus = 'reported' | 'investigating' | 'corrective_action' | 'closed' | 'filed_in_error';
export type { Timeliness } from '@/lib/compliance/metrics';
import type { Timeliness } from '@/lib/compliance/metrics';

/** Short labels used in the incidents-by-type bar chart. */
export type ChartCategory =
  | 'Self-Harm'
  | 'Near-Miss'
  | 'Client Fall'
  | 'Elopement'
  | 'Aggression'
  | 'Privacy'
  | 'Staff Injury'
  | 'Other / unspecified';

export type Incident = {
  /** IncidentReport row id (PATCH /api/incidents/[recordId]) */
  recordId?: string;
  /** Incident number INC-YYYY-NNN (shown as the id) */
  id: string;
  reporterUserId?: string | null;
  assignedToUserId?: string | null;
  involvedStaffIds?: string[];
  clientId?: string | null;
  errorExplanation?: string;
  /** Server: may this user update the investigation / status (reviewer or assigned investigator) */
  canWork?: boolean;
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
  /** Full ISO instant the report was entered (used for 24h timeliness). */
  reportedAtTime?: string;
  /** Full ISO instant the incident occurred, when known. */
  occurredAt?: string;
  dueFollowUp: string;
  /** Set when status becomes closed — used for avg resolution */
  closedAt?: string;
  location: string;
  description: string;
  immediateAction: string;
  investigationNotes: string;
  correctiveActions: string[];
  rootCause: string;
  /** null = not recorded (occurred time unknown) */
  timeliness: Timeliness | null;
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
  { key: 'Other / unspecified', color: '#94A3B8' },
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
  return 'Other / unspecified';
}

export function normalizeIncident(raw: Incident): Incident {
  return {
    ...raw,
    chartCategory: raw.chartCategory || chartCategoryForType(raw.type),
    immediateAction: raw.immediateAction || '',
    rootCause: raw.rootCause || '',
    correctiveActions: Array.isArray(raw.correctiveActions) ? raw.correctiveActions : [],
    // Never assume on-time: computed from occurredAt vs reportedAtTime, else not recorded.
    // (A stored value is ignored: older rows were saved with an assumed 'within_24h'.)
    timeliness: incidentTimeliness(raw.occurredAt, raw.reportedAtTime),
  };
}
