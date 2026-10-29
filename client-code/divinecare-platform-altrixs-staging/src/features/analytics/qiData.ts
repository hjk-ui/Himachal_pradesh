/** ClinicModuleState keys: `qi-indicators`, `qi-caps`, `qi-meetings`, `qi-meta`. */

export type Trend = 'up' | 'down' | 'stable';
export type IndicatorStatus = 'Meeting' | 'At Risk' | 'Below Target';
export type CapStatus = 'Open' | 'In Progress' | 'Completed' | 'Overdue';

export type PerformanceIndicator = {
  id: string;
  name: string;
  target: number;
  current: number;
  unit: string;
  /** Display for target column e.g. "<15%" when lower-is-better */
  targetDisplay?: string;
  trend: Trend;
  status: IndicatorStatus;
  period: string;
  monthlyData: number[];
  monthlyLabels: string[];
  higherIsBetter: boolean;
};

export type CAPRecord = {
  id: string;
  capNum: string;
  indicator: string;
  rootCause: string;
  actionSteps: string[];
  responsible: string;
  dueDate: string;
  status: CapStatus;
  /** Incident the CAP was opened for (e.g. INC-2026-004), when any. */
  linkedIncidentId?: string;
  /** Free-text origin, e.g. "Incident INC-2026-004: Client fall". */
  source?: string;
  createdAt?: string;
};

export type QIMeeting = {
  id: string;
  date: string;
  title?: string;
  attendees: string[];
  agendaItems: string[];
  decisions: string[];
  nextSteps: string[];
};

export type QIProgramMeta = {
  version: 1;
  period: string;
  periodRange: string;
  nextMeetingDate: string;
  lastSurveyScore: number;
  lastSurveyMax: number;
  lastSurveyLabel: string;
  resolvedCapsPriorYear: number;
  resolvedCapsYearLabel: string;
};

/** Empty meta — real QI program settings are persisted in the `qi-meta` module. */
export const QI_META_SEED: QIProgramMeta = {
  version: 1,
  period: '',
  periodRange: '',
  nextMeetingDate: '',
  lastSurveyScore: 0,
  lastSurveyMax: 5.0,
  lastSurveyLabel: '',
  resolvedCapsPriorYear: 0,
  resolvedCapsYearLabel: '',
};

export const QI_INDICATORS_SEED: PerformanceIndicator[] = [];

export const QI_CAPS_SEED: CAPRecord[] = [];

export const QI_MEETINGS_SEED: QIMeeting[] = [];

export function formatIndicatorValue(value: number, unit: string): string {
  if (unit === '%') return Number.isInteger(value) ? `${value}%` : `${value}%`;
  if (unit === '/5') return `${value} / 5.0`;
  if (unit === 'd') return `${value}d`;
  return `${value}${unit}`;
}

export function formatTarget(ind: PerformanceIndicator): string {
  if (ind.targetDisplay) return ind.targetDisplay;
  return formatIndicatorValue(ind.target, ind.unit);
}

export function daysUntil(dateIso: string, from = new Date()): number {
  const target = new Date(`${dateIso}T12:00:00`);
  const start = new Date(from);
  start.setHours(12, 0, 0, 0);
  return Math.round((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function formatMeetingDate(dateIso: string): string {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function isQIMeta(data: unknown): data is QIProgramMeta {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  return m.version === 1 && typeof m.period === 'string' && typeof m.nextMeetingDate === 'string';
}
