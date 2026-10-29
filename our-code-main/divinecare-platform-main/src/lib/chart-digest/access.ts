/**
 * Who may see or regenerate a chart history digest.
 * `evaluateDigestAccess` is pure; `loadDigestAccess` gathers the facts from the database.
 */
import { prisma } from '@/lib/db/prisma';
import { clientByIdWhere } from '@/lib/clients/orgScope';
import type { DigestDenialCode } from './copy';
import { canRegenerateDigestKind, canViewDigestKind, isLeadershipRole, type ChartDigestKind } from './kinds';

export type DigestAction = 'view' | 'generate';

export type DigestAccessFacts = {
  role: string | null | undefined;
  kind: ChartDigestKind;
  action: DigestAction;
  onCareTeam: boolean;
  /** True when the client declined AI use */
  aiConsentDeclined: boolean;
  aiConfigured: boolean;
  /** True when the client has a SensitiveRecord (protected record) */
  sensitiveRecord: boolean;
};

export type DigestAccessResult =
  | { ok: true; canRegenerate: boolean }
  | { ok: false; code: DigestDenialCode };

/**
 * Order: role → sensitive record → care team → AI consent → AI configured.
 * AI configuration only matters when generating; a stored digest can still be viewed.
 */
export function evaluateDigestAccess(facts: DigestAccessFacts): DigestAccessResult {
  if (!canViewDigestKind(facts.role, facts.kind)) return { ok: false, code: 'role_not_permitted' };
  if (facts.action === 'generate' && !canRegenerateDigestKind(facts.role, facts.kind)) {
    return { ok: false, code: 'role_not_permitted' };
  }
  if (facts.sensitiveRecord) return { ok: false, code: 'sensitive_record' };
  // Leadership may view any client in the clinic; everyone else must be on the care team.
  const careTeamOk = facts.onCareTeam || (facts.action === 'view' && isLeadershipRole(facts.role));
  if (!careTeamOk) return { ok: false, code: 'not_on_care_team' };
  if (facts.aiConsentDeclined) return { ok: false, code: 'ai_consent_declined' };
  if (facts.action === 'generate' && !facts.aiConfigured) return { ok: false, code: 'ai_not_configured' };
  return {
    ok: true,
    canRegenerate: canRegenerateDigestKind(facts.role, facts.kind) && facts.onCareTeam,
  };
}

/** A consent form that mentions AI, most recent first. Declined unless a later one was signed. */
export function aiConsentDeclinedFromForms(
  forms: Array<{ type: string; status: string }>
): boolean {
  const latest = forms.find((f) => /\bAI\b|artificial intelligence/i.test(f.type));
  return latest?.status === 'DECLINED';
}

export type DigestActor = { userId: string; role: string; organizationId: string };

export type DigestFacts = {
  onCareTeam: boolean;
  aiConsentDeclined: boolean;
  sensitiveRecord: boolean;
};

/** Chart facts the access rules need. Null when the client is not in the actor's clinic. */
export async function loadDigestFacts(actor: DigestActor, clientId: string): Promise<DigestFacts | null> {
  const client = await prisma.client.findFirst({
    where: clientByIdWhere(clientId, actor.organizationId),
    select: {
      assignedToId: true,
      treatmentTeamMembers: { where: { providerId: actor.userId }, select: { id: true } },
    },
  });
  if (!client) return null;

  const [sensitive, forms] = await Promise.all([
    prisma.sensitiveRecord.findFirst({
      where: { organizationId: actor.organizationId, clientId },
      select: { id: true },
    }),
    prisma.consentForm.findMany({
      where: { organizationId: actor.organizationId, clientId },
      orderBy: { updatedAt: 'desc' },
      select: { type: true, status: true },
    }),
  ]);

  return {
    onCareTeam: client.assignedToId === actor.userId || client.treatmentTeamMembers.length > 0,
    aiConsentDeclined: aiConsentDeclinedFromForms(forms),
    sensitiveRecord: Boolean(sensitive),
  };
}

export async function loadDigestAccess(
  actor: DigestActor,
  clientId: string,
  kind: ChartDigestKind,
  action: DigestAction
): Promise<DigestAccessResult | { ok: false; code: 'not_found' }> {
  const facts = await loadDigestFacts(actor, clientId);
  if (!facts) return { ok: false, code: 'not_found' };
  // Loaded on demand so the pure rules above stay importable without the AWS SDK.
  const { isBedrockConfigured } = await import('@/lib/ai/bedrockService');
  return evaluateDigestAccess({
    role: actor.role,
    kind,
    action,
    aiConfigured: isBedrockConfigured(),
    ...facts,
  });
}