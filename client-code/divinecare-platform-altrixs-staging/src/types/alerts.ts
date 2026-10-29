import type { Severity } from './common';

export type { Severity };

export interface RiskAlert {
  id: string;
  clientName: string;
  clientId: string;
  clinicianId: string | null;
  organizationId: string | null;
  type: string;
  source: string;
  sourceId: string | null;
  severity: Severity;
  description: string;
  reviewNote: string | null;
  mood: number;
  stress: number;
  createdAt: string;
  reviewed: boolean;
  reviewedAt: string | null;
  reviewedById: string | null;
}

export interface RiskAlertSummary {
  high: number;
  medium: number;
  low: number;
  totalUnreviewed: number;
  total: number;
}
