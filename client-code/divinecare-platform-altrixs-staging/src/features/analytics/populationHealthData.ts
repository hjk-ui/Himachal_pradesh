/**
 * ClinicModuleState `population-health` — the old hand-maintained Population Health payload.
 * The page no longer reads these numbers (GET /api/reports/population counts every active client);
 * it only shows any saved `actions` read-only as manual notes. Kept for scripts/seed-ehr-modules.ts.
 */

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

/** Empty seed — population metrics are computed from real clients/assessments only. */
export const POPULATION_HEALTH_SEED: PopulationHealthPayload = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
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

/** Backward-compatible exports for seed-ehr-modules */
export const POPULATION_CLIENTS_SEED = POPULATION_HEALTH_SEED.clients;
export const POPULATION_ACTIONS_SEED = POPULATION_HEALTH_SEED.actions.map(
  ({ primaryAction: _a, primaryHref: _b, secondaryAction: _c, secondaryHref: _d, ...rest }) => rest
);

export function isPopulationHealthPayload(value: unknown): value is PopulationHealthPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as PopulationHealthPayload;
  return v.version === 1 && Array.isArray(v.clients) && Array.isArray(v.actions);
}
