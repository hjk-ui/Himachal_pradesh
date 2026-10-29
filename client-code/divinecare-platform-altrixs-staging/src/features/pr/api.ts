import { apiJson } from '@/lib/api-client';
import type {
  PrAssetDTO,
  PrCampaignDTO,
  PrChannelDTO,
  PrColorDTO,
  PrCoverageDTO,
  PrMetricsDTO,
  PrPostDTO,
  PrReleaseDTO,
} from '@/lib/pr/manage';

export type {
  PrAssetDTO,
  PrCampaignDTO,
  PrChannelDTO,
  PrColorDTO,
  PrCoverageDTO,
  PrMetricsDTO,
  PrPostDTO,
  PrReleaseDTO,
};

export type PrDashboardData = {
  success: true;
  metrics: PrMetricsDTO;
  channels: PrChannelDTO[];
  assets: PrAssetDTO[];
  colors: PrColorDTO[];
  coverage: PrCoverageDTO[];
  releases: PrReleaseDTO[];
  campaigns: PrCampaignDTO[];
  posts: PrPostDTO[];
};

export async function fetchPrMarketing() {
  return apiJson<PrDashboardData>('/api/pr');
}

export async function createSocialPost(input: {
  platform: string;
  content: string;
  date?: string;
  time?: string;
  campaignId?: string;
  status: 'draft' | 'scheduled';
}) {
  const data = await apiJson<{ success: true; post: PrPostDTO }>('/api/pr/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.post;
}

export async function createMediaCoverage(input: {
  outlet: string;
  medium: string;
  headline: string;
  date: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  url?: string;
}) {
  const data = await apiJson<{ success: true; coverage: PrCoverageDTO }>('/api/pr/coverage', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.coverage;
}

export async function createPressRelease(input: {
  title: string;
  body?: string;
  date?: string;
  outlet?: string;
  status?: 'draft' | 'review' | 'published';
}) {
  const data = await apiJson<{ success: true; release: PrReleaseDTO }>('/api/pr/releases', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return data.release;
}
