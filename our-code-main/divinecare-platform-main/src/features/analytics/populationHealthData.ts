/** ClinicModuleState `population-health` — full Population Health dashboard payload. */

export type RiskBucket = 'High' | 'Moderate' | 'Low';
export type Urgency = 'critical' | 'high' | 'routine';
export type CapacityStatus = 'At capacity' | 'Available' | 'Available (new)';

export type PopulationClient = {
  id: string;
  name: string;
  phq9: number;
  risk: RiskBucket;
  lastContact: string;
  riskNotes: string;
  clinician: string;
  daysSinceContact: number;
};

export type ActionItem = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  urgency: Urgency;
  due: string;
  done: boolean;
  primaryAction: string;
  primaryHref: string;
  secondaryAction?: string;
  secondaryHref?: string;
};

export type OutcomePoint = { month: string; value: number };

export type ClinicianCaseload = {
  id: string;
  initials: string;
  name: string;
  activeClients: number;
  highRisk: number;
  avgPhq9: number;
  docCurrent: number;
  capacity: CapacityStatus;
  color: string;
};

export type PopulationHealthPayload = {
  version: 1;
  updatedAt: string;
  activeCaseload: number;
  highRiskCount: number;
  moderateCount: number;
  lowCount: number;
  avgPhq9: number;
  priorAvgPhq9: number;
  engagementRate: number;
  clients: PopulationClient[];
  actions: ActionItem[];
  phq9Trend: OutcomePoint[];
  gad7Trend: OutcomePoint[];
  clinicians: ClinicianCaseload[];
};

/** Production default: complete typed empty payload without fabricated metrics or patients. */
export const EMPTY_POPULATION_HEALTH: PopulationHealthPayload = {
  version: 1,
  updatedAt: new Date().toISOString(),
  activeCaseload: 0,
  highRiskCount: 0,
  moderateCount: 0,
  lowCount: 0,
  avgPhq9: 0,
  priorAvgPhq9: 0,
  engagementRate: 0,
  clients: [],
  actions: [],
  phq9Trend: [],
  gad7Trend: [],
  clinicians: [],
};

/** Backward-compatible export — points to EMPTY_POPULATION_HEALTH in production runtime. */
export const POPULATION_HEALTH_SEED: PopulationHealthPayload = EMPTY_POPULATION_HEALTH;
export const POPULATION_CLIENTS_SEED: PopulationClient[] = [];
export const POPULATION_ACTIONS_SEED: Omit<
  ActionItem,
  'primaryAction' | 'primaryHref' | 'secondaryAction' | 'secondaryHref'
>[] = [];

export function isPopulationHealthPayload(value: unknown): value is PopulationHealthPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as PopulationHealthPayload;
  return v.version === 1 && Array.isArray(v.clients) && Array.isArray(v.actions);
}

export function overlayLivePopulationCounts(
  payload: PopulationHealthPayload | null | undefined,
  clients: Array<{ risk?: string | null }>
): PopulationHealthPayload {
  const base = payload ?? EMPTY_POPULATION_HEALTH;
  if (!clients || clients.length === 0) {
    return {
      version: 1,
      updatedAt: base.updatedAt || new Date().toISOString(),
      activeCaseload: 0,
      highRiskCount: 0,
      moderateCount: 0,
      lowCount: 0,
      avgPhq9: 0,
      priorAvgPhq9: 0,
      engagementRate: 0,
      clients: [],
      actions: [],
      phq9Trend: [],
      gad7Trend: [],
      clinicians: [],
    };
  }

  const high = clients.filter((c) => c.risk === 'high').length;
  const moderate = clients.filter((c) => c.risk === 'medium').length;
  const low = clients.filter((c) => c.risk === 'low').length;

  return {
    ...base,
    updatedAt: new Date().toISOString(),
    activeCaseload: clients.length,
    highRiskCount: high,
    moderateCount: moderate,
    lowCount: low,
    // Only retain persisted clinical trends and clinicians if they exist in persisted base and activeCaseload is non-zero
    phq9Trend: Array.isArray(base.phq9Trend) ? base.phq9Trend : [],
    gad7Trend: Array.isArray(base.gad7Trend) ? base.gad7Trend : [],
    clinicians: Array.isArray(base.clinicians) ? base.clinicians : [],
    clients: Array.isArray(base.clients) ? base.clients : [],
    actions: Array.isArray(base.actions) ? base.actions : [],
  };
}
