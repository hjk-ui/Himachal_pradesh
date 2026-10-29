import type {
  PrBrandAsset,
  PrBrandColor,
  PrCampaign,
  PrMediaCoverage,
  PrOrgMetrics,
  PrPressRelease,
  PrReleaseStatus,
  PrSentiment,
  PrSocialChannel,
  PrSocialPost,
  PrPostStatus,
  Role,
} from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { canAccessPath } from '@/lib/auth/roleAccess';

export { PR_PLATFORMS, PR_MEDIUMS } from '@/lib/pr/constants';

export function canAccessPr(role: Role) {
  return canAccessPath(role, '/dashboard/pr');
}

export type PrMetricsDTO = {
  pressMentionsYtd: number;
  socialReach: number;
  socialReachPeriod: string;
  websiteVisitors: number;
  websiteVisitorsPeriod: string;
  activeCampaigns: number;
};

export type PrChannelDTO = {
  id: string;
  platform: string;
  handle: string;
  followers: number;
  monthGrowthPct: number;
};

export type PrAssetDTO = {
  id: string;
  title: string;
  category: string;
  iconKey: string;
  fileName: string;
  body: string;
};

export type PrColorDTO = { id: string; name: string; hex: string };

export type PrCoverageDTO = {
  id: string;
  outlet: string;
  medium: string;
  headline: string;
  publishedAt: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  url: string | null;
};

export type PrReleaseDTO = {
  id: string;
  title: string;
  body: string;
  status: 'draft' | 'review' | 'published';
  publishedAt: string | null;
  outlet: string;
};

export type PrCampaignDTO = {
  id: string;
  name: string;
  status: 'planned' | 'active' | 'complete';
  startDate: string;
  endDate: string;
  description: string;
  progress: number;
  channels: string[];
};

export type PrPostDTO = {
  id: string;
  platform: string;
  content: string;
  status: 'draft' | 'scheduled' | 'posted';
  scheduledAt: string;
  reach: string;
  engagement: string;
  campaignId: string | null;
  campaignName: string | null;
};

function serializeMetrics(row: PrOrgMetrics, activeCampaigns: number): PrMetricsDTO {
  return {
    pressMentionsYtd: row.pressMentionsYtd,
    socialReach: row.socialReach,
    socialReachPeriod: row.socialReachPeriod,
    websiteVisitors: row.websiteVisitors,
    websiteVisitorsPeriod: row.websiteVisitorsPeriod,
    activeCampaigns,
  };
}

function serializeChannel(row: PrSocialChannel): PrChannelDTO {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    followers: row.followers,
    monthGrowthPct: row.monthGrowthPct,
  };
}

function serializeAsset(row: PrBrandAsset): PrAssetDTO {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    iconKey: row.iconKey,
    fileName: row.fileName,
    body: row.body,
  };
}

function serializeColor(row: PrBrandColor): PrColorDTO {
  return { id: row.id, name: row.name, hex: row.hex };
}

function serializeCoverage(row: PrMediaCoverage): PrCoverageDTO {
  return {
    id: row.id,
    outlet: row.outlet,
    medium: row.medium,
    headline: row.headline,
    publishedAt: row.publishedAt.toISOString(),
    sentiment: row.sentiment,
    url: row.url,
  };
}

function serializeRelease(row: PrPressRelease): PrReleaseDTO {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    status: row.status,
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    outlet: row.outlet,
  };
}

function serializeCampaign(row: PrCampaign): PrCampaignDTO {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.startDate.toISOString(),
    endDate: row.endDate.toISOString(),
    description: row.description,
    progress: row.progress,
    channels: row.channels,
  };
}

function serializePost(row: PrSocialPost & { campaign?: { name: string } | null }): PrPostDTO {
  return {
    id: row.id,
    platform: row.platform,
    content: row.content,
    status: row.status,
    scheduledAt: row.scheduledAt.toISOString(),
    reach: row.reach,
    engagement: row.engagement,
    campaignId: row.campaignId,
    campaignName: row.campaign?.name ?? null,
  };
}

export async function listPrMarketing(organizationId: string) {
  const [metrics, channels, assets, colors, coverage, releases, campaigns, posts, activeCampaigns] =
    await Promise.all([
      prisma.prOrgMetrics.findUnique({ where: { organizationId } }),
      prisma.prSocialChannel.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.prBrandAsset.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.prBrandColor.findMany({ where: { organizationId }, orderBy: { sortOrder: 'asc' } }),
      prisma.prMediaCoverage.findMany({ where: { organizationId }, orderBy: { publishedAt: 'desc' } }),
      prisma.prPressRelease.findMany({ where: { organizationId }, orderBy: { publishedAt: 'desc' } }),
      prisma.prCampaign.findMany({ where: { organizationId }, orderBy: { startDate: 'asc' } }),
      prisma.prSocialPost.findMany({
        where: { organizationId },
        include: { campaign: { select: { name: true } } },
        orderBy: { scheduledAt: 'asc' },
      }),
      prisma.prCampaign.count({ where: { organizationId, status: 'active' } }),
    ]);

  const metricsDto: PrMetricsDTO = metrics
    ? serializeMetrics(metrics, activeCampaigns)
    : {
        pressMentionsYtd: coverage.length,
        socialReach: 0,
        socialReachPeriod: 'Mar',
        websiteVisitors: 0,
        websiteVisitorsPeriod: 'Mar',
        activeCampaigns,
      };

  return {
    metrics: metricsDto,
    channels: channels.map(serializeChannel),
    assets: assets.map(serializeAsset),
    colors: colors.map(serializeColor),
    coverage: coverage.map(serializeCoverage),
    releases: releases.map(serializeRelease),
    campaigns: campaigns.map(serializeCampaign),
    posts: posts.map(serializePost),
  };
}

function parseDateTime(date: string, time?: string) {
  const t = time && time.trim() ? time.trim() : '09:00';
  const iso = `${date}T${t}:00`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function createPrPost(
  organizationId: string,
  input: {
    platform: string;
    content: string;
    date: string;
    time?: string;
    campaignId?: string;
    status: 'draft' | 'scheduled';
  }
) {
  const scheduledAt = parseDateTime(input.date, input.time) ?? new Date();
  if (input.status === 'scheduled' && !input.date) {
    return { ok: false as const, status: 400, error: 'Schedule date is required.' };
  }
  let campaignId: string | null = input.campaignId || null;
  if (campaignId) {
    const campaign = await prisma.prCampaign.findFirst({
      where: { id: campaignId, organizationId },
    });
    if (!campaign) campaignId = null;
  }
  const post = await prisma.prSocialPost.create({
    data: {
      organizationId,
      platform: input.platform,
      content: input.content,
      status: input.status as PrPostStatus,
      scheduledAt,
      campaignId,
    },
    include: { campaign: { select: { name: true } } },
  });
  return { ok: true as const, post: serializePost(post) };
}

export async function createPrCoverage(
  organizationId: string,
  input: {
    outlet: string;
    medium: string;
    headline: string;
    date: string;
    sentiment: 'positive' | 'neutral' | 'negative';
    url?: string;
  }
) {
  const publishedAt = parseDateTime(input.date) ?? new Date();
  const row = await prisma.prMediaCoverage.create({
    data: {
      organizationId,
      outlet: input.outlet,
      medium: input.medium,
      headline: input.headline,
      publishedAt,
      sentiment: input.sentiment as PrSentiment,
      url: input.url?.trim() || null,
    },
  });
  await prisma.prOrgMetrics.upsert({
    where: { organizationId },
    create: {
      organizationId,
      pressMentionsYtd: 1,
    },
    update: { pressMentionsYtd: { increment: 1 } },
  });
  return { ok: true as const, coverage: serializeCoverage(row) };
}

export async function createPrRelease(
  organizationId: string,
  input: {
    title: string;
    body?: string;
    date?: string;
    outlet?: string;
    status?: 'draft' | 'review' | 'published';
  }
) {
  const status = (input.status || 'draft') as PrReleaseStatus;
  const publishedAt = input.date ? parseDateTime(input.date) : new Date();
  const row = await prisma.prPressRelease.create({
    data: {
      organizationId,
      title: input.title,
      body: input.body?.trim() || '',
      status,
      publishedAt,
      outlet: input.outlet?.trim() || '',
    },
  });
  return { ok: true as const, release: serializeRelease(row) };
}
