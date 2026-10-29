/**
 * Amazon Personalize. Output is returned ONLY when a campaign is configured, credentials exist and
 * the campaign actually answers with items. Otherwise every function returns `available: false`
 * with the reason and no items: there is no demo / heuristic fallback presented as
 * personalization (caseload numbers live in GET /api/dashboard/home, from real records).
 */
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import {
  getAwsCredentials,
  hasAwsCredentials,
  personalizeCampaignArn,
  personalizeRankingArn,
} from './credentials';
import { awsJsonPost } from './sign';

export type PersonalizeUnavailable = { available: false; reason: string };

export type PersonalizeItem = { itemId: string; score: number | null };

export type CaseloadInsightsResult =
  | PersonalizeUnavailable
  | { available: true; source: 'amazon-personalize'; generatedAt: string; items: PersonalizeItem[] };

export type ClientRecommendationsResult =
  | PersonalizeUnavailable
  | { available: true; source: 'amazon-personalize'; recommendations: PersonalizeItem[] };

export type CopingTool = { id: string; name: string; category: string; description: string };

export type CopingToolsResult =
  | PersonalizeUnavailable
  | { available: true; source: 'amazon-personalize'; tools: CopingTool[] };

export type RankToolsResult =
  | PersonalizeUnavailable
  | { available: true; source: 'amazon-personalize'; ranked: CopingTool[] };

/** Item catalog the ranking campaign ranks (static tool definitions, not patient data) */
const COPING_TOOL_CATALOG: CopingTool[] = [
  { id: 'tool-grounding-54321', name: '5-4-3-2-1 Grounding', category: 'grounding', description: 'Sensory grounding for acute anxiety or dissociation.' },
  { id: 'tool-box-breathing', name: 'Box Breathing', category: 'breathing', description: '4-count inhale/hold/exhale/hold to down-regulate arousal.' },
  { id: 'tool-behavioral-activation', name: 'Behavioral Activation Walk', category: 'activation', description: 'Scheduled pleasant or mastery activity for low mood.' },
  { id: 'tool-thought-record', name: 'CBT Thought Record', category: 'cbt', description: 'Capture automatic thoughts and generate balanced alternatives.' },
  { id: 'tool-urge-surfing', name: 'Urge Surfing', category: 'sud', description: 'Ride craving waves without acting for substance-use recovery.' },
  { id: 'tool-safety-check', name: 'Safety Plan Check-in', category: 'safety', description: 'Quick review of warning signs, coping, and crisis contacts.' },
];

export const PERSONALIZE_NOT_CONFIGURED = 'Amazon Personalize is not configured for this practice.';

function unavailable(reason: string): PersonalizeUnavailable {
  return { available: false, reason };
}

/** Recommendation campaign + credentials, or the reason it cannot be called */
function recommendationTarget(): { ok: true; arn: string } | { ok: false; reason: string } {
  const arn = personalizeCampaignArn();
  if (!arn) return { ok: false, reason: PERSONALIZE_NOT_CONFIGURED };
  if (!hasAwsCredentials()) return { ok: false, reason: 'Amazon Personalize campaign is set but AWS credentials are not available.' };
  return { ok: true, arn };
}

async function getRecommendations(
  arn: string,
  userId: string,
  numResults: number
): Promise<{ ok: true; items: PersonalizeItem[] } | { ok: false; reason: string }> {
  const creds = getAwsCredentials()!;
  const res = await awsJsonPost<{ itemList?: Array<{ itemId?: string; score?: number }> }>({
    creds,
    service: 'personalize-runtime',
    host: `personalize-runtime.${creds.region}.amazonaws.com`,
    target: 'AmazonPersonalizeRuntime.GetRecommendations',
    body: { campaignArn: arn, userId, numResults },
  });
  if (res.ok === false) return { ok: false, reason: 'Amazon Personalize call failed.' };
  const items = (res.data.itemList || [])
    .filter((i): i is { itemId: string; score?: number } => Boolean(i.itemId))
    .map((i) => ({ itemId: i.itemId, score: typeof i.score === 'number' ? i.score : null }));
  return { ok: true, items };
}

async function assertClientInScope(input: { organizationId: string; actorUserId: string; actorRole: Role; clientId: string }) {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorRole: input.actorRole }),
    },
    select: { id: true },
  });
  if (!client) throw Object.assign(new Error('Client not found'), { status: 404 });
}

/** Model output for the signed-in staff member (userId = staff id), when a campaign answers */
export async function getCaseloadInsights(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<CaseloadInsightsResult> {
  const target = recommendationTarget();
  if (target.ok === false) return unavailable(target.reason);
  const res = await getRecommendations(target.arn, input.actorUserId, 10);
  if (res.ok === false) return unavailable(res.reason);
  if (!res.items.length) return unavailable('Amazon Personalize returned no items.');
  return { available: true, source: 'amazon-personalize', generatedAt: new Date().toISOString(), items: res.items };
}

export async function getClientRecommendations(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
}): Promise<ClientRecommendationsResult> {
  await assertClientInScope(input);
  const target = recommendationTarget();
  if (target.ok === false) return unavailable(target.reason);
  const res = await getRecommendations(target.arn, input.clientId, 5);
  if (res.ok === false) return unavailable(res.reason);
  if (!res.items.length) return unavailable('Amazon Personalize returned no items.');
  return { available: true, source: 'amazon-personalize', recommendations: res.items };
}

async function rankWithPersonalize(clientId: string, toolIds: string[]): Promise<RankToolsResult> {
  const arn = personalizeRankingArn();
  if (!arn) return unavailable(PERSONALIZE_NOT_CONFIGURED);
  if (!hasAwsCredentials()) return unavailable('Amazon Personalize ranking campaign is set but AWS credentials are not available.');
  const creds = getAwsCredentials()!;
  const res = await awsJsonPost<{ personalizedRanking?: Array<{ itemId?: string }>; rankedItems?: Array<{ itemId?: string }> }>({
    creds,
    service: 'personalize-runtime',
    host: `personalize-runtime.${creds.region}.amazonaws.com`,
    target: 'AmazonPersonalizeRuntime.GetPersonalizedRanking',
    body: { campaignArn: arn, userId: clientId, inputList: toolIds },
  });
  if (res.ok === false) return unavailable('Amazon Personalize call failed.');
  const byId = new Map(COPING_TOOL_CATALOG.map((t) => [t.id, t]));
  const ranked = (res.data.personalizedRanking || res.data.rankedItems || [])
    .map((r) => (r.itemId ? byId.get(r.itemId) : undefined))
    .filter((t): t is CopingTool => Boolean(t));
  if (!ranked.length) return unavailable('Amazon Personalize returned no ranking.');
  return { available: true, source: 'amazon-personalize', ranked };
}

/** The coping-tool catalog in the order the ranking campaign gives for this client */
export async function getCopingTools(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
}): Promise<CopingToolsResult> {
  await assertClientInScope(input);
  const r = await rankWithPersonalize(input.clientId, COPING_TOOL_CATALOG.map((t) => t.id));
  if (r.available === false) return r;
  return { available: true, source: 'amazon-personalize', tools: r.ranked };
}

export async function rankCopingTools(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  toolIds: string[];
}): Promise<RankToolsResult> {
  await assertClientInScope(input);
  const known = input.toolIds.filter((id) => COPING_TOOL_CATALOG.some((t) => t.id === id));
  if (!known.length) return unavailable('None of the tool ids are in the coping-tool catalog.');
  return rankWithPersonalize(input.clientId, known);
}
