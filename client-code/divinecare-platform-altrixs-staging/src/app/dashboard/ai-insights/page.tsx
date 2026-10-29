import ClinicalInsightsPage from '@/features/insights/clinical/ClinicalInsightsPage';

/**
 * Clinical Insights (formerly "AI Insights" / "Chart risk overview"). Rule-based, explainable
 * priority and population patterns computed on the server (src/lib/insights/clinical); AI only
 * for grounded summaries and the filter box. The path stays /dashboard/ai-insights so role access
 * rules and existing links keep working.
 */
export default function Page() {
  return <ClinicalInsightsPage />;
}
