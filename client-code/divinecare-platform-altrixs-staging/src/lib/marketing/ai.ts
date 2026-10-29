/**
 * Growth assistant (server). Uses the existing Bedrock helper when configured and the feature flag
 * is on; otherwise the rules drafts in aiTemplates.ts. Never sends client PHI: lead text is
 * redacted first, insights use aggregate counts only, review text is public and still redacted.
 * Every result is a draft for a person to approve. Usage is logged (feature, engine, size only).
 */
import { prisma } from '@/lib/db/prisma';
import { invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import type { MarketingAiFeature } from './constants';
import {
  aiFeatureEnabled,
  contentCalendarSuggestions,
  contentClaimIssues,
  leadStageForPrompt,
  needsCrisisLine,
  redactForAi,
  ruleGrowthInsights,
  ruleLandingCopy,
  rulePressRelease,
  ruleSocialDraft,
  ruleSuggestedReplies,
  withCrisisLine,
  type GrowthAggregates,
} from './aiTemplates';
import { enforceSafeReply } from './reviewGuard';
import { getMarketingSettings, practiceInfo } from './settings';

export type AiDraft<T> = { status: 'draft'; requiresApproval: true; engine: 'bedrock' | 'rules'; feature: MarketingAiFeature; data: T; notes: string[] };

const SYSTEM_BASE =
  'You write marketing and communications drafts for a Maryland outpatient behavioral health and primary care practice. Rules: never state or imply that any person is a patient; never include health details about any person; no outcome guarantees or "cure" claims; plain, warm, inclusive language at an 8th-grade reading level; follow safe messaging guidelines for suicide (include 988, no method detail); never target or single out substance use. A human reviews every draft.';

async function logUsage(organizationId: string, userId: string | null, feature: string, engine: string, inputChars: number) {
  await prisma.marketingAiUsage.create({ data: { organizationId, userId, feature, engine, inputChars } }).catch(() => {});
}

async function canUseModel(organizationId: string, feature: MarketingAiFeature): Promise<{ enabled: boolean; model: boolean; voice: string | null }> {
  const s = await getMarketingSettings(organizationId);
  const enabled = aiFeatureEnabled(s.aiFeatures, feature);
  return { enabled, model: enabled && isBedrockConfigured(), voice: s.brandVoice };
}

async function modelJson<T>(system: string, prompt: string): Promise<T | null> {
  try {
    const raw = await invokeBedrock({ model: 'HAIKU', system, userPrompt: prompt, jsonMode: true, maxTokens: 1200, temperature: 0.4, guard: 'general' });
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error('[marketing ai] model call failed', err instanceof Error ? err.name : 'error');
    return null;
  }
}

export class AiFeatureOffError extends Error {
  readonly status = 403;
  constructor() {
    super('This AI feature is turned off in Marketing settings.');
  }
}

export async function draftReviewReply(organizationId: string, userId: string | null, review: { rating: number; body: string; authorName?: string | null }) {
  const gate = await canUseModel(organizationId, 'reviewReply');
  if (!gate.enabled) throw new AiFeatureOffError();
  const practice = await practiceInfo(organizationId);
  let draft: string | null = null;
  let engine: 'bedrock' | 'rules' = 'rules';
  const text = redactForAi(review.body, [review.authorName]);
  if (gate.model) {
    const out = await modelJson<{ reply?: string }>(
      `${SYSTEM_BASE} You draft public replies to online reviews. HIPAA: the reply must NOT confirm or imply the reviewer is or was a patient (no "your visit", "your session", "your treatment", "your provider", no names, no dates, no conditions, even if the reviewer mentioned them). Thank them for feedback about the practice; for negative reviews invite them to call the office manager offline. Under 450 characters. Return {"reply": string}.`,
      `Practice: ${practice.name}. Office phone: ${practice.phone ?? 'not given'}. Rating: ${review.rating}/5. Review text (redacted, do not repeat details): ${text}`,
    );
    if (out?.reply) {
      draft = out.reply;
      engine = 'bedrock';
    }
  }
  const safe = enforceSafeReply(draft, review, { practiceName: practice.name, officePhone: practice.phone });
  await logUsage(organizationId, userId, 'reviewReply', engine, text.length);
  const notes = safe.replaced && draft ? ['The AI draft failed the HIPAA check and was replaced by the safe template.'] : [];
  return { status: 'draft', requiresApproval: true, engine: safe.replaced ? 'rules' : engine, feature: 'reviewReply', data: { reply: safe.text }, notes } as AiDraft<{ reply: string }>;
}

export async function suggestLeadReplies(organizationId: string, userId: string | null, lead: { stage: string; firstName: string; lastName: string; lastInbound?: string | null }) {
  const gate = await canUseModel(organizationId, 'suggestedReply');
  if (!gate.enabled) throw new AiFeatureOffError();
  const practice = await practiceInfo(organizationId);
  let replies = ruleSuggestedReplies(lead.stage, practice.name, practice.phone);
  let engine: 'bedrock' | 'rules' = 'rules';
  const inbound = redactForAi(lead.lastInbound ?? '', [lead.firstName, lead.lastName]);
  if (gate.model && inbound) {
    const out = await modelJson<{ replies?: string[] }>(
      `${SYSTEM_BASE} You suggest short SMS replies (under 300 characters) from the intake team to a prospective client. Do not ask about symptoms or diagnoses by text; offer a phone call for anything clinical. If the message suggests danger or crisis, the first reply must give 988 and 911. ${gate.voice ? `Brand voice: ${gate.voice}.` : ''} Return {"replies": [string, string, string]}.`,
      `Pipeline stage: ${leadStageForPrompt(lead.stage)}. Practice: ${practice.name}, phone ${practice.phone ?? 'n/a'}. Their last message (redacted): ${inbound}`,
    );
    if (out?.replies?.length) {
      replies = out.replies.filter((r) => typeof r === 'string' && r.trim()).slice(0, 3).map((r) => r.trim().slice(0, 320));
      engine = 'bedrock';
    }
  }
  if (needsCrisisLine(inbound)) replies = replies.map(withCrisisLine);
  await logUsage(organizationId, userId, 'suggestedReply', engine, inbound.length);
  return { status: 'draft', requiresApproval: true, engine, feature: 'suggestedReply', data: { replies }, notes: [] } as AiDraft<{ replies: string[] }>;
}

export async function draftSocial(organizationId: string, userId: string | null, input: { topic: string; channels: string[] }) {
  const gate = await canUseModel(organizationId, 'socialCaption');
  if (!gate.enabled) throw new AiFeatureOffError();
  const practice = await practiceInfo(organizationId);
  const topic = redactForAi(input.topic);
  let data = ruleSocialDraft(topic, input.channels, practice.name);
  let engine: 'bedrock' | 'rules' = 'rules';
  if (gate.model) {
    const out = await modelJson<{ caption?: string; hashtags?: string[]; imagePrompts?: string[] }>(
      `${SYSTEM_BASE} Write a social media caption with hashtags and 2 image prompt ideas (no identifiable patients, no clinical settings with people in distress). ${gate.voice ? `Brand voice: ${gate.voice}.` : ''} Return {"caption": string, "hashtags": string[], "imagePrompts": string[]}.`,
      `Practice: ${practice.name}. Channels: ${input.channels.join(', ') || 'general'}. Topic: ${topic}`,
    );
    if (out?.caption) {
      data = { caption: out.caption, hashtags: (out.hashtags ?? []).slice(0, 10), imagePrompts: (out.imagePrompts ?? []).slice(0, 3) };
      engine = 'bedrock';
    }
  }
  if (needsCrisisLine(`${topic} ${data.caption}`)) data.caption = withCrisisLine(data.caption);
  const notes = contentClaimIssues(data.caption).map((c) => `Check the claim "${c}" before posting.`);
  await logUsage(organizationId, userId, 'socialCaption', engine, topic.length);
  return { status: 'draft', requiresApproval: true, engine, feature: 'socialCaption', data, notes } as AiDraft<typeof data>;
}

export async function draftPressRelease(organizationId: string, userId: string | null, input: { headline: string; facts: string; quote?: string; spokesperson?: string; city?: string; contact?: string }) {
  const gate = await canUseModel(organizationId, 'pressRelease');
  if (!gate.enabled) throw new AiFeatureOffError();
  const practice = await practiceInfo(organizationId);
  const facts = redactForAi(input.facts);
  let body = rulePressRelease({ ...input, facts, practiceName: practice.name });
  let engine: 'bedrock' | 'rules' = 'rules';
  if (gate.model) {
    const out = await modelJson<{ release?: string }>(
      `${SYSTEM_BASE} Write a press release in AP style: FOR IMMEDIATE RELEASE, headline, dateline, 3-5 short paragraphs, optional quote, About section, media contact placeholder, ###. Use only the facts given. Return {"release": string}.`,
      `Practice: ${practice.name}. Headline: ${input.headline}. City: ${input.city ?? 'Bowie, Md.'}. Facts: ${facts}. Quote: ${input.quote ?? 'none'} (${input.spokesperson ?? ''}).`,
    );
    if (out?.release) {
      body = out.release;
      engine = 'bedrock';
    }
  }
  await logUsage(organizationId, userId, 'pressRelease', engine, facts.length);
  return { status: 'draft', requiresApproval: true, engine, feature: 'pressRelease', data: { body }, notes: contentClaimIssues(body).map((c) => `Check the claim "${c}".`) } as AiDraft<{ body: string }>;
}

export async function draftLandingCopy(organizationId: string, userId: string | null, input: { service: string; location?: string; audience?: string }) {
  const gate = await canUseModel(organizationId, 'landingCopy');
  if (!gate.enabled) throw new AiFeatureOffError();
  const practice = await practiceInfo(organizationId);
  let data = ruleLandingCopy({ ...input, practiceName: practice.name });
  let engine: 'bedrock' | 'rules' = 'rules';
  if (gate.model) {
    const out = await modelJson<Partial<typeof data>>(
      `${SYSTEM_BASE} Draft landing page and search ad copy. Ads must not reference a person's health condition ("Struggling with depression?") because ad platforms forbid personal-attribute targeting. Return {"headline": string, "subheadline": string, "bullets": string[], "cta": string, "adVariants": string[]}.`,
      `Practice: ${practice.name}. Service: ${input.service}. Location: ${input.location ?? 'Maryland'}. Audience (general, non-clinical): ${input.audience ?? 'adults and families'}.`,
    );
    if (out?.headline) {
      data = { ...data, ...out, complianceNotes: data.complianceNotes };
      engine = 'bedrock';
    }
  }
  await logUsage(organizationId, userId, 'landingCopy', engine, input.service.length);
  return { status: 'draft', requiresApproval: true, engine, feature: 'landingCopy', data, notes: data.complianceNotes } as AiDraft<typeof data>;
}

export async function contentCalendar(organizationId: string, userId: string | null, month: number) {
  const gate = await canUseModel(organizationId, 'contentCalendar');
  if (!gate.enabled) throw new AiFeatureOffError();
  const data = contentCalendarSuggestions(month);
  await logUsage(organizationId, userId, 'contentCalendar', 'rules', 0);
  return { status: 'draft', requiresApproval: true, engine: 'rules', feature: 'contentCalendar', data: { month, items: data }, notes: [] } as AiDraft<{ month: number; items: typeof data }>;
}

export async function growthInsights(organizationId: string, userId: string | null, agg: GrowthAggregates) {
  const gate = await canUseModel(organizationId, 'growthInsights');
  if (!gate.enabled) throw new AiFeatureOffError();
  let insights = ruleGrowthInsights(agg);
  let engine: 'bedrock' | 'rules' = 'rules';
  if (gate.model) {
    const out = await modelJson<{ insights?: string[] }>(
      `${SYSTEM_BASE} You are a growth analyst. Give 4-6 short, specific, actionable insights from these aggregate counts (no individuals). Return {"insights": string[]}.`,
      JSON.stringify(agg),
    );
    if (out?.insights?.length) {
      insights = out.insights.slice(0, 6);
      engine = 'bedrock';
    }
  }
  await logUsage(organizationId, userId, 'growthInsights', engine, JSON.stringify(agg).length);
  return { status: 'draft', requiresApproval: true, engine, feature: 'growthInsights', data: { insights }, notes: [] } as AiDraft<{ insights: string[] }>;
}
