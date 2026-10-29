export type RiskLevel = 'high' | 'medium' | 'low';

export type Severity = RiskLevel;

export interface ApiListResult<T> {
  items: T[];
  total: number;
}
