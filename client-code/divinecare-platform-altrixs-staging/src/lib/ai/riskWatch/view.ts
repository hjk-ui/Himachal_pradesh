/**
 * Risk language watch: the banner payload (GET /api/ai/risk-watch). Pure, browser-safe types.
 * A protected record the viewer may not open returns only "Protected record", the severity and
 * the break-glass path — never the snippet, the concept or the client's phone.
 */
import { CONCEPT_LABEL, CATEGORY_LABEL, type RiskSeverity } from './phrases';
import { SEVERITY_RANK, maxSeverity, type RiskHit } from './engine';
import { PROTECTED_LABEL, SEVERITY_UI, riskWatchLinks } from './routing';
import { CRISIS_RESOURCES, STAFF_988_REMINDER } from './crisisResources';

export type BannerAlert = { id: string; severity: RiskSeverity; reviewed: boolean; createdAt: string };

export type BannerHit = { severity: RiskSeverity; category: string; concept: string; quote: string; messageId?: string | null };

export type RiskWatchBannerView =
  | { active: false }
  | {
      active: true;
      protected: true;
      label: string;
      severity: RiskSeverity;
      unreviewed: number;
      breakGlassHref: string;
    }
  | {
      active: true;
      protected: false;
      severity: RiskSeverity;
      unreviewed: number;
      alerts: BannerAlert[];
      hits: BannerHit[];
      safetyPlanOnFile: boolean | null;
      phone: string | null;
      links: ReturnType<typeof riskWatchLinks>;
      reminder: string;
      resources: typeof CRISIS_RESOURCES;
    };

export function buildBannerView(input: {
  clientId: string;
  alerts: { id: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; reviewed: boolean; createdAt: Date | string }[];
  locked: boolean;
  hits: (RiskHit & { messageId?: string | null })[];
  safetyPlanOnFile: boolean | null;
  phone: string | null;
}): RiskWatchBannerView {
  if (!input.alerts.length) return { active: false };
  const alerts: BannerAlert[] = input.alerts.map((a) => ({
    id: a.id,
    severity: SEVERITY_UI[a.severity],
    reviewed: a.reviewed,
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : a.createdAt.toISOString(),
  }));
  const open = alerts.filter((a) => !a.reviewed);
  const severity = maxSeverity((open.length ? open : alerts).map((a) => a.severity)) ?? 'low';
  const links = riskWatchLinks(input.clientId);
  if (input.locked) {
    return { active: true, protected: true, label: PROTECTED_LABEL, severity, unreviewed: open.length, breakGlassHref: links.breakGlass };
  }
  const seen = new Set<string>();
  const hits: BannerHit[] = [];
  for (const h of [...input.hits].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])) {
    if (seen.has(h.quote)) continue;
    seen.add(h.quote);
    hits.push({ severity: h.severity, category: CATEGORY_LABEL[h.category], concept: CONCEPT_LABEL[h.concept], quote: h.quote, messageId: h.messageId ?? null });
    if (hits.length >= 3) break;
  }
  return {
    active: true,
    protected: false,
    severity,
    unreviewed: open.length,
    alerts,
    hits,
    safetyPlanOnFile: input.safetyPlanOnFile,
    phone: input.phone,
    links,
    reminder: STAFF_988_REMINDER,
    resources: CRISIS_RESOURCES,
  };
}
