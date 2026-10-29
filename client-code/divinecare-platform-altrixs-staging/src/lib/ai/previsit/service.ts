/**
 * Pre-visit brief orchestration. No prisma / AWS imports: the route passes real dependencies
 * (prismaSource.ts), tests pass fakes.
 *
 * Order of gates (each one audited):
 *  1. role: clinical staff only;
 *  2. chart access (org, roster role, caseload, 42 CFR Part 2 / protected record): locked → no brief;
 *  3. facts are built for every allowed viewer (rule-based brief always available);
 *  4. AI only when: Bedrock configured, client has not declined 'AI Note Drafting' consent, and
 *     the record is not a protected (Part 2) record. Otherwise → rule-based brief, labelled.
 *  5. AI output is grounded against the facts; if nothing survives → rule-based brief.
 * Cached per org + client + practice day + audience; `refresh` rebuilds.
 */
import { buildPreVisitFacts, factCounts, factLines, factLinks, type FactLine, type PreVisitAudience, type PreVisitFacts, type PreVisitInputs } from '@/lib/ai/previsit/facts';
import { ruleBasedBullets } from '@/lib/ai/previsit/rules';
import { groundedBullets, parseModelBullets } from '@/lib/ai/previsit/validate';
import { PREVISIT_SYSTEM_PROMPT, previsitUserPrompt } from '@/lib/ai/previsit/prompt';
import { PreVisitBriefCache, sharedPreVisitCache } from '@/lib/ai/previsit/cache';
import { canPrescribe, isClinicalStaff } from '@/types/roles';
import { canAccessClientChartNotes } from '@/lib/clients/orgScope';
import { toPracticeWallTime } from '@/lib/time/practiceTime';

export const PREVISIT_FEATURE = 'pre-visit-brief';
export const PREVISIT_RESOURCE = 'preVisitBrief';

export type PreVisitViewer = { organizationId: string; userId: string; role: string };

export type FallbackReason =
  | 'ai_not_configured'
  | 'ai_consent_declined'
  | 'protected_record'
  | 'ai_failed'
  | 'ai_output_rejected';

export type PreVisitBrief = {
  clientId: string;
  forDate: string;
  audience: PreVisitAudience;
  source: 'ai' | 'rules';
  bullets: string[];
  facts: PreVisitFacts;
  factLines: FactLine[];
  /** Signed notes / imported note documents the brief cites (viewer links; never sent to AI) */
  links: { label: string; href: string }[];
  generatedAt: string;
  model: string | null;
  fallbackReason: FallbackReason | null;
  /** AI bullets dropped by the grounding check */
  droppedCount: number;
  aiConsent: 'signed' | 'missing' | 'declined';
  cached: boolean;
};

export type PreVisitResult =
  | { ok: true; brief: PreVisitBrief }
  | { ok: false; status: 403 | 404 | 500; error: string; reason: string };

export type AuditEntry = {
  action: 'AI_ACCESS' | 'READ';
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  clientId: string;
  metadata: Record<string, unknown>;
};

export type PreVisitDeps = {
  resolveAccess(viewer: PreVisitViewer, clientId: string): Promise<
    | { ok: true; sensitive: 'none' | 'allowed'; names: string[] }
    | { ok: false; status: 403 | 404; reason: string }
  >;
  loadInputs(viewer: PreVisitViewer, clientId: string, opts: { now: Date; audience: PreVisitAudience; names: string[]; bhChartNotes?: boolean }): Promise<PreVisitInputs>;
  aiConsent(organizationId: string, clientId: string): Promise<'signed' | 'missing' | 'declined'>;
  practiceTimeZone(organizationId: string): Promise<string>;
  bedrockConfigured(): boolean;
  /** returns the raw JSON reply */
  invokeModel(input: { system: string; userPrompt: string }): Promise<string>;
  modelId: string;
  audit(entry: AuditEntry): Promise<void>;
  cache?: PreVisitBriefCache;
  now?: () => Date;
};

const PRIMARY_CARE_ROLES = new Set(['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT']);

/** prescriber = BH prescribers (psychiatry); primary_care = primary-care providers; else therapist */
export function audienceFor(role: string): PreVisitAudience {
  if (PRIMARY_CARE_ROLES.has(String(role ?? '').toUpperCase())) return 'primary_care';
  return canPrescribe(role) ? 'prescriber' : 'therapist';
}

export async function getPreVisitBrief(
  deps: PreVisitDeps,
  viewer: PreVisitViewer,
  clientId: string,
  opts: { refresh?: boolean } = {}
): Promise<PreVisitResult> {
  const base = { feature: PREVISIT_FEATURE };
  if (!isClinicalStaff(viewer.role) || viewer.role === 'PEER_SUPPORT') {
    await deps.audit({ action: 'READ', outcome: 'DENIED', clientId, metadata: { ...base, reason: 'role_not_permitted' } });
    return { ok: false, status: 403, error: 'Forbidden', reason: 'role_not_permitted' };
  }
  const access = await deps.resolveAccess(viewer, clientId);
  if (access.ok === false) {
    await deps.audit({ action: 'READ', outcome: 'DENIED', clientId, metadata: { ...base, reason: access.reason } });
    return {
      ok: false,
      status: access.status,
      error: access.status === 404 ? 'Client not found' : access.reason === 'sensitive_record' ? 'Protected record: no pre-visit brief without access.' : 'Forbidden',
      reason: access.reason,
    };
  }

  const now = (deps.now ?? (() => new Date()))();
  const audience = audienceFor(viewer.role);
  // BH note plan text, treatment-plan goals and PHQ-9 / GAD-7 only for chart-note readers
  // (not PHYSICIAN / MEDICAL_NP): a psychiatrist's cached brief must never reach primary care.
  const bhChartNotes = canAccessClientChartNotes(viewer.role);
  const timeZone = await deps.practiceTimeZone(viewer.organizationId);
  const forDate = toPracticeWallTime(now, timeZone).date;
  const consent = await deps.aiConsent(viewer.organizationId, clientId);
  const cache = deps.cache ?? sharedPreVisitCache;
  // Consent / protection is part of the key so a consent change never serves a stale AI brief
  const key = PreVisitBriefCache.key({
    organizationId: viewer.organizationId,
    clientId,
    forDate,
    audience: bhChartNotes ? audience : `${audience}:no-bh-notes`,
    aiAllowed: consent !== 'declined' && access.sensitive === 'none',
  });

  if (!opts.refresh) {
    const hit = cache.get(key, now);
    if (hit) {
      await deps.audit({ action: 'READ', outcome: 'SUCCESS', clientId, metadata: { ...base, cached: true, source: hit.source, forDate } });
      return { ok: true, brief: { ...hit, cached: true } };
    }
  }

  const inputs = await deps.loadInputs(viewer, clientId, { now, audience, names: access.names, bhChartNotes });
  const facts = buildPreVisitFacts(inputs, { now, timeZone, audience, bhChartNotes });
  const counts = factCounts(facts);

  let fallbackReason: FallbackReason | null = null;
  let bullets: string[] | null = null;
  let droppedCount = 0;
  if (access.sensitive !== 'none') fallbackReason = 'protected_record';
  else if (consent === 'declined') fallbackReason = 'ai_consent_declined';
  else if (!deps.bedrockConfigured()) fallbackReason = 'ai_not_configured';
  else {
    let outcome: 'SUCCESS' | 'FAILURE' = 'SUCCESS';
    let returned = 0;
    let errorKind: string | null = null;
    try {
      const reply = await deps.invokeModel({ system: PREVISIT_SYSTEM_PROMPT, userPrompt: previsitUserPrompt(facts) });
      const candidates = parseModelBullets(reply);
      returned = candidates.length;
      const { kept, dropped } = groundedBullets(candidates, facts, access.names);
      droppedCount = dropped.length;
      if (kept.length >= 2) bullets = kept;
      else {
        fallbackReason = 'ai_output_rejected';
        outcome = 'FAILURE';
        errorKind = 'too_few_grounded_bullets';
      }
    } catch (err) {
      outcome = 'FAILURE';
      fallbackReason = 'ai_failed';
      errorKind = err instanceof Error ? err.name : 'unknown';
    } finally {
      // One AI_ACCESS row per model call: counts / ids only, never chart text
      await deps.audit({
        action: 'AI_ACCESS',
        outcome,
        clientId,
        metadata: { ...base, model: deps.modelId, audience, forDate, aiConsent: consent, factCounts: counts, bulletsReturned: returned, bulletsKept: bullets?.length ?? 0, bulletsDropped: droppedCount, ...(errorKind ? { error: errorKind } : {}) },
      });
    }
  }

  const source: 'ai' | 'rules' = bullets ? 'ai' : 'rules';
  const brief: PreVisitBrief = {
    clientId,
    forDate,
    audience,
    source,
    bullets: bullets ?? ruleBasedBullets(facts),
    facts,
    factLines: factLines(facts),
    links: factLinks(facts, clientId),
    generatedAt: now.toISOString(),
    model: source === 'ai' ? deps.modelId : null,
    fallbackReason,
    droppedCount,
    aiConsent: consent,
    cached: false,
  };
  if (source === 'rules') {
    await deps.audit({ action: 'READ', outcome: 'SUCCESS', clientId, metadata: { ...base, source, fallbackReason, forDate, factCounts: counts } });
  }
  // Do not pin a transient AI failure for the whole day
  if (fallbackReason !== 'ai_failed') cache.set(key, brief, now);
  return { ok: true, brief };
}
