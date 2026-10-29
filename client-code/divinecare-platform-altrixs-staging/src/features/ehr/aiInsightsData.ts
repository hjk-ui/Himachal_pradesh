/** ClinicModuleState `ai-insights` — Risk / Sentiment / Patterns / Weekly report. */

export type AiUrgency = 'critical' | 'high' | 'medium' | 'low';
export type AiTrend = 'worsening' | 'improving' | 'stable' | 'up' | 'down';

export type AiInsightStat = {
  label: string;
  value: string;
  sub: string;
  color: string;
};

export type AiRiskPrediction = {
  id: string;
  clientId: string | null;
  client: string;
  risk: number;
  trend: AiTrend;
  prediction: string;
  action: string;
  urgency: AiUrgency;
  href: string;
};

export type AiSentimentRow = {
  id: string;
  clientId: string | null;
  client: string;
  today: string;
  trend: AiTrend;
  keywords: string[];
  score: number;
};

export type AiPattern = {
  id: string;
  title: string;
  insight: string;
  impact: 'high' | 'medium' | 'low';
  category: string;
  href: string;
};

export type AiWeeklyReport = {
  period: string;
  summary: string;
  highlights: { color: string; text: string }[];
  recommendations: { text: string; href: string }[];
  previousReports: { id: string; label: string }[];
};

export type AiInsightsPayload = {
  version: 1;
  analyzedAt: string;
  accuracy: number;
  stats: AiInsightStat[];
  predictions: AiRiskPrediction[];
  sentiment: AiSentimentRow[];
  patterns: AiPattern[];
  weeklyReport: AiWeeklyReport;
};

/**
 * Empty baseline for the legacy `ai-insights` module blob (seed scripts only). The page no longer
 * reads or writes this blob: Clinical Insights is computed on the server (src/lib/insights/clinical,
 * /api/insights/clinical) and never stores derived rows with client names.
 */
export const AI_INSIGHTS_SEED: AiInsightsPayload = {
  version: 1,
  analyzedAt: '',
  accuracy: 0,
  stats: [],
  predictions: [],
  sentiment: [],
  patterns: [],
  weeklyReport: {
    period: '',
    summary: '',
    highlights: [],
    recommendations: [],
    previousReports: [],
  },
};

export function isAiInsightsPayload(value: unknown): value is AiInsightsPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as AiInsightsPayload;
  return v.version === 1 && Array.isArray(v.predictions) && Array.isArray(v.stats);
}
