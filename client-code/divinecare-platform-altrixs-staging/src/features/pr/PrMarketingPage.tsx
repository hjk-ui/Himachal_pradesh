'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Eye,
  FileText,
  Globe,
  Image,
  Link2,
  Mail,
  Megaphone,
  MessageSquare,
  Newspaper,
  Plus,
  Rocket,
  Share2,
  Users,
  X,
} from 'lucide-react';
import {
  createMediaCoverage,
  createPressRelease,
  createSocialPost,
  fetchPrMarketing,
  type PrAssetDTO,
  type PrCampaignDTO,
  type PrChannelDTO,
  type PrColorDTO,
  type PrCoverageDTO,
  type PrMetricsDTO,
  type PrPostDTO,
  type PrReleaseDTO,
} from '@/features/pr/api';
import { PR_MEDIUMS, PR_PLATFORMS } from '@/lib/pr/constants';

const PURPLE = '#5C2D91';

type Tab = 'overview' | 'press' | 'social' | 'campaigns';

const PLATFORM_PILL: Record<string, string> = {
  Instagram: 'bg-pink-100 text-pink-700',
  Facebook: 'bg-blue-100 text-blue-700',
  LinkedIn: 'bg-sky-100 text-sky-800',
  'Twitter/X': 'bg-slate-100 text-slate-700',
  Email: 'bg-emerald-100 text-emerald-700',
  Flyers: 'bg-slate-100 text-slate-600',
  Website: 'bg-slate-100 text-slate-600',
  Indeed: 'bg-slate-100 text-slate-600',
  Schools: 'bg-teal-100 text-teal-800',
};

const STATUS_PILL: Record<string, string> = {
  posted: 'bg-emerald-50 text-emerald-700',
  scheduled: 'bg-violet-100 text-[#5C2D91]',
  draft: 'bg-slate-100 text-slate-500',
  published: 'bg-emerald-50 text-emerald-700',
  review: 'bg-amber-50 text-amber-700',
};

function formatCompact(n: number) {
  if (n >= 1000) {
    const k = n / 1000;
    return `${k % 1 === 0 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return n.toLocaleString('en-US');
}

function formatVisitors(n: number) {
  return n.toLocaleString('en-US');
}

function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatRange(startIso: string, endIso: string) {
  const a = new Date(startIso);
  const b = new Date(endIso);
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const right = b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${left} – ${right}`;
}

function assetIcon(key: string) {
  const cls = 'text-[#5C2D91]';
  if (key === 'image') return <Image size={20} className={cls} />;
  if (key === 'share') return <Share2 size={20} className={cls} />;
  if (key === 'mail') return <Mail size={20} className={cls} />;
  if (key === 'newspaper') return <Newspaper size={20} className={cls} />;
  if (key === 'book') return <BookOpen size={20} className={cls} />;
  return <FileText size={20} className={cls} />;
}

function channelIcon(platform: string) {
  if (platform === 'Facebook') return <Users size={18} className="text-[#2563eb]" />;
  if (platform === 'Instagram') return <Link2 size={18} className="text-[#db2777]" />;
  if (platform === 'LinkedIn') return <Globe size={18} className="text-[#1d4ed8]" />;
  return <MessageSquare size={18} className="text-[#2563eb]" />;
}

function channelIconBg(platform: string) {
  if (platform === 'Facebook') return 'bg-blue-50';
  if (platform === 'Instagram') return 'bg-pink-50';
  if (platform === 'LinkedIn') return 'bg-sky-50';
  return 'bg-slate-100';
}

const emptyMetrics: PrMetricsDTO = {
  pressMentionsYtd: 0,
  socialReach: 0,
  socialReachPeriod: 'Mar',
  websiteVisitors: 0,
  websiteVisitorsPeriod: 'Mar',
  activeCampaigns: 0,
};

export default function PrMarketingPage() {
  const assetsRef = useRef<HTMLDivElement | null>(null);
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<PrMetricsDTO>(emptyMetrics);
  const [channels, setChannels] = useState<PrChannelDTO[]>([]);
  const [assets, setAssets] = useState<PrAssetDTO[]>([]);
  const [colors, setColors] = useState<PrColorDTO[]>([]);
  const [coverage, setCoverage] = useState<PrCoverageDTO[]>([]);
  const [releases, setReleases] = useState<PrReleaseDTO[]>([]);
  const [campaigns, setCampaigns] = useState<PrCampaignDTO[]>([]);
  const [posts, setPosts] = useState<PrPostDTO[]>([]);

  const [postModal, setPostModal] = useState(false);
  const [coverageModal, setCoverageModal] = useState(false);
  const [releaseModal, setReleaseModal] = useState(false);
  const [viewCoverage, setViewCoverage] = useState<PrCoverageDTO | null>(null);
  const [viewRelease, setViewRelease] = useState<PrReleaseDTO | null>(null);
  const [saving, setSaving] = useState(false);

  const [postDraft, setPostDraft] = useState({
    platform: 'Instagram',
    content: '',
    date: '',
    time: '',
    campaignId: '',
  });
  const [coverageDraft, setCoverageDraft] = useState({
    outlet: '',
    medium: 'Print / Online',
    headline: '',
    date: '',
    sentiment: 'positive' as 'positive' | 'neutral' | 'negative',
    url: '',
  });
  const [releaseDraft, setReleaseDraft] = useState({
    title: '',
    body: '',
    date: '',
    outlet: '',
    status: 'draft' as 'draft' | 'review' | 'published',
  });

  const [socialPlatform, setSocialPlatform] = useState('all');
  const [socialStatus, setSocialStatus] = useState('all');
  const [pressMedium, setPressMedium] = useState('all');
  const [pressSentiment, setPressSentiment] = useState('all');

  const load = useCallback(async () => {
    const data = await fetchPrMarketing();
    setMetrics(data.metrics);
    setChannels(data.channels);
    setAssets(data.assets);
    setColors(data.colors);
    setCoverage(data.coverage);
    setReleases(data.releases);
    setCampaigns(data.campaigns);
    setPosts(data.posts);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const kpis = useMemo(
    () => [
      {
        label: 'Press Mentions (YTD)',
        value: String(metrics.pressMentionsYtd),
        Icon: Newspaper,
        color: PURPLE,
        bg: '#F5F3FF',
      },
      {
        label: `Social Reach (${metrics.socialReachPeriod})`,
        value: formatCompact(metrics.socialReach),
        Icon: Megaphone,
        color: '#0F766E',
        bg: '#CCFBF1',
      },
      {
        label: 'Active Campaigns',
        value: String(metrics.activeCampaigns),
        Icon: Rocket,
        color: '#C9A227',
        bg: '#FEF9E7',
      },
      {
        label: `Website Visitors (${metrics.websiteVisitorsPeriod})`,
        value: formatVisitors(metrics.websiteVisitors),
        Icon: Globe,
        color: '#E07050',
        bg: '#FFF1E6',
      },
    ],
    [metrics]
  );

  const filteredPosts = posts.filter((post) => {
    if (socialPlatform !== 'all' && post.platform !== socialPlatform) return false;
    if (socialStatus !== 'all' && post.status !== socialStatus) return false;
    return true;
  });

  const filteredCoverage = coverage.filter((item) => {
    if (pressMedium !== 'all' && item.medium !== pressMedium) return false;
    if (pressSentiment !== 'all' && item.sentiment !== pressSentiment) return false;
    return true;
  });

  const openBrandAssets = () => {
    setTab('overview');
    requestAnimationFrame(() => {
      assetsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const downloadAsset = (asset: PrAssetDTO) => {
    window.location.href = `/api/pr/assets/${asset.id}`;
  };

  const savePost = async (status: 'draft' | 'scheduled') => {
    if (!postDraft.content.trim()) {
      setError('Post content is required before saving.');
      return;
    }
    if (status === 'scheduled' && !postDraft.date) {
      setError('Schedule date is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const post = await createSocialPost({
        platform: postDraft.platform,
        content: postDraft.content.trim(),
        date: postDraft.date,
        time: postDraft.time,
        campaignId: postDraft.campaignId || undefined,
        status,
      });
      setPosts((prev) => [...prev, post].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)));
      setPostDraft({ platform: 'Instagram', content: '', date: '', time: '', campaignId: '' });
      setPostModal(false);
      setTab('social');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveCoverage = async () => {
    if (!coverageDraft.outlet.trim() || !coverageDraft.headline.trim() || !coverageDraft.date) {
      setError('Outlet, headline, and date are required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = await createMediaCoverage({
        outlet: coverageDraft.outlet.trim(),
        medium: coverageDraft.medium,
        headline: coverageDraft.headline.trim(),
        date: coverageDraft.date,
        sentiment: coverageDraft.sentiment,
        url: coverageDraft.url.trim() || undefined,
      });
      setCoverage((prev) => [row, ...prev]);
      setMetrics((prev) => ({ ...prev, pressMentionsYtd: prev.pressMentionsYtd + 1 }));
      setCoverageDraft({
        outlet: '',
        medium: 'Print / Online',
        headline: '',
        date: '',
        sentiment: 'positive',
        url: '',
      });
      setCoverageModal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveRelease = async () => {
    if (!releaseDraft.title.trim()) {
      setError('Press release title is required.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const row = await createPressRelease({
        title: releaseDraft.title.trim(),
        body: releaseDraft.body.trim(),
        date: releaseDraft.date,
        outlet: releaseDraft.outlet.trim(),
        status: releaseDraft.status,
      });
      setReleases((prev) => [row, ...prev]);
      setReleaseDraft({ title: '', body: '', date: '', outlet: '', status: 'draft' });
      setReleaseModal(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const openCoverageView = (item: PrCoverageDTO) => {
    if (item.url) {
      window.open(item.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setViewCoverage(item);
  };

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

  return (
    <div className="mx-auto w-full max-w-[1360px] min-w-0 space-y-5 overflow-x-hidden pb-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">PR &amp; Marketing</h1>
          <p className="mt-1 text-sm text-slate-500">Press relations · Social media · Campaigns · Brand</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openBrandAssets}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-[#DDD3F0] bg-white px-4 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50"
          >
            <Image size={16} className="text-[#5C2D91]" /> Brand Assets
          </button>
          <button
            type="button"
            onClick={() => setPostModal(true)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-[#5C2D91] px-4 text-sm font-semibold text-white shadow-sm hover:opacity-95"
          >
            <Plus size={16} /> Create Post
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
            <div
              className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ backgroundColor: kpi.bg }}
            >
              <kpi.Icon size={20} style={{ color: kpi.color }} />
            </div>
            <p className="text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: kpi.color }}>
              {loading ? '—' : kpi.value}
            </p>
            <p className="mt-1 text-[11px] font-medium text-slate-500 sm:text-xs">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
        {error && (
          <div className="flex items-start justify-between gap-3 border-b border-rose-100 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <p>{error}</p>
            <button type="button" onClick={() => setError(null)} className="shrink-0" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}
        <div className="flex overflow-x-auto border-b border-slate-200/80">
          {(
            [
              ['overview', 'Overview'],
              ['press', 'Press & Media'],
              ['social', 'Social Media'],
              ['campaigns', 'Campaigns'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-medium transition-colors sm:px-5 ${
                tab === key
                  ? 'border-[#5C2D91] text-[#5C2D91]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid gap-8 p-4 sm:p-6 lg:grid-cols-2">
            <section className="min-w-0">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Social Channels</h2>
              <div className="space-y-3">
                {channels.map((channel) => (
                  <div
                    key={channel.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200/80 px-3 py-3 sm:px-4"
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${channelIconBg(channel.platform)}`}
                    >
                      {channelIcon(channel.platform)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{channel.platform}</p>
                      <p className="truncate text-xs text-slate-500">{channel.handle}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-slate-900">{channel.followers.toLocaleString('en-US')}</p>
                      <p className="text-xs font-medium text-emerald-600">+{channel.monthGrowthPct}% this month</p>
                    </div>
                  </div>
                ))}
                {!loading && channels.length === 0 && (
                  <p className="text-sm text-slate-500">No channels yet.</p>
                )}
              </div>
            </section>

            <section ref={assetsRef} id="pr-brand-assets" className="min-w-0 scroll-mt-4">
              <h2 className="mb-4 text-base font-semibold text-slate-900">Brand Assets &amp; Templates</h2>
              <div className="grid grid-cols-2 gap-3">
                {assets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => downloadAsset(asset)}
                    className="rounded-xl border border-slate-200/80 p-3 text-left transition hover:border-[#DDD3F0] hover:bg-[#F5F3FF]/40 sm:p-4"
                  >
                    <div className="mb-2">{assetIcon(asset.iconKey)}</div>
                    <p className="text-sm font-semibold leading-snug text-slate-900">{asset.title}</p>
                    <p className="mt-1 text-xs text-slate-500">{asset.category}</p>
                  </button>
                ))}
              </div>
              <div className="mt-5 rounded-2xl bg-[#F5F3FF]/70 p-4 sm:p-5">
                <h3 className="mb-4 text-sm font-semibold text-slate-800">Brand Colors</h3>
                <div className="flex flex-wrap gap-4 sm:gap-6">
                  {colors.map((color) => (
                    <div key={color.id} className="flex flex-col items-center gap-2">
                      <div
                        className="h-11 w-11 rounded-xl shadow-inner ring-1 ring-black/5"
                        style={{ backgroundColor: color.hex }}
                        title={color.hex}
                      />
                      <p className="text-[11px] font-medium text-slate-600">{color.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          </div>
        )}

        {tab === 'press' && (
          <div className="space-y-8 p-4 sm:p-6">
            <section>
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-base font-semibold text-slate-900">Media Coverage</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={pressMedium}
                    onChange={(e) => setPressMedium(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"
                  >
                    <option value="all">All media</option>
                    {PR_MEDIUMS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={pressSentiment}
                    onChange={(e) => setPressSentiment(e.target.value)}
                    className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"
                  >
                    <option value="all">All sentiment</option>
                    <option value="positive">Positive</option>
                    <option value="neutral">Neutral</option>
                    <option value="negative">Negative</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setCoverageModal(true)}
                    className="text-sm font-semibold text-[#5C2D91] hover:underline"
                  >
                    + Add Coverage
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {filteredCoverage.map((item) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200/80 p-4 sm:flex-row sm:items-start"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F5F3FF]">
                      <Newspaper size={20} className="text-[#5C2D91]" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.outlet}</p>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                          {item.medium}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          <CheckCircle2 size={10} /> {item.sentiment}
                        </span>
                      </div>
                      <p className="text-sm italic text-slate-700">&ldquo;{item.headline}&rdquo;</p>
                      <p className="mt-1 text-xs text-slate-500">{formatLongDate(item.publishedAt)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => openCoverageView(item)}
                      className="self-start text-sm font-semibold text-[#5C2D91] hover:underline"
                    >
                      View
                    </button>
                  </div>
                ))}
                {filteredCoverage.length === 0 && !loading && (
                  <p className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                    No coverage matches these filters.
                  </p>
                )}
              </div>
            </section>

            <section>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold text-slate-900">Press Releases</h2>
                <button
                  type="button"
                  onClick={() => setReleaseModal(true)}
                  className="inline-flex min-h-10 shrink-0 items-center text-sm font-semibold text-[#5C2D91] hover:underline"
                >
                  + Write Release
                </button>
              </div>
              <div className="space-y-3">
                {releases.map((release) => (
                  <div
                    key={release.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200/80 p-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{release.title}</p>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[release.status]}`}>
                          {release.status}
                        </span>
                      </div>
                      {release.publishedAt && (
                        <p className="mt-1 text-xs text-slate-500">{formatLongDate(release.publishedAt)}</p>
                      )}
                      {release.outlet ? (
                        <p className="mt-1 text-xs text-[#5C2D91]">{release.outlet}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewRelease(release)}
                      className="self-start text-sm font-semibold text-[#5C2D91] hover:underline"
                    >
                      View
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        {tab === 'social' && (
          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="text-base font-semibold text-slate-900">Content Calendar</h2>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={socialPlatform}
                  onChange={(e) => setSocialPlatform(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"
                >
                  <option value="all">All platforms</option>
                  {PR_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <select
                  value={socialStatus}
                  onChange={(e) => setSocialStatus(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600"
                >
                  <option value="all">All statuses</option>
                  <option value="posted">Posted</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="draft">Draft</option>
                </select>
                <button
                  type="button"
                  onClick={() => setPostModal(true)}
                  className="inline-flex min-h-10 items-center gap-1 rounded-xl bg-[#5C2D91] px-3 text-sm font-semibold text-white"
                >
                  <Plus size={14} /> Create Post
                </button>
              </div>
            </div>
            <div className="space-y-3">
              {filteredPosts.map((post) => (
                <div key={post.id} className="rounded-xl border border-slate-200/80 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <span
                      className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${PLATFORM_PILL[post.platform] || 'bg-slate-100 text-slate-700'}`}
                    >
                      {post.platform}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-800">{post.content}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays size={11} /> {formatLongDate(post.scheduledAt)}
                        </span>
                        {post.status === 'posted' && post.reach ? (
                          <span className="inline-flex items-center gap-1">
                            <Eye size={11} /> {post.reach} reach
                          </span>
                        ) : null}
                        {post.status === 'posted' && post.engagement ? (
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare size={11} /> {post.engagement} engagement
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={`w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_PILL[post.status]}`}
                    >
                      {post.status}
                    </span>
                  </div>
                </div>
              ))}
              {filteredPosts.length === 0 && !loading && (
                <p className="rounded-xl border border-dashed border-slate-200 p-6 text-sm text-slate-500">
                  No posts match these filters.
                </p>
              )}
            </div>
          </div>
        )}

        {tab === 'campaigns' && (
          <div className="space-y-4 p-4 sm:p-6">
            {campaigns.map((campaign) => (
              <div key={campaign.id} className="rounded-xl border border-slate-200/80 p-4 sm:p-5">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-slate-900">{campaign.name}</h3>
                      {campaign.status === 'active' && (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                          ● active
                        </span>
                      )}
                      {campaign.status !== 'active' && (
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_PILL[campaign.status] || 'bg-slate-100 text-slate-600'}`}>
                          {campaign.status}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500">{formatRange(campaign.startDate, campaign.endDate)}</p>
                    <p className="mt-1 text-sm text-slate-600">{campaign.description}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-2xl font-bold text-[#5C2D91]">{campaign.progress}%</p>
                    <p className="text-xs text-slate-500">complete</p>
                  </div>
                </div>
                <div className="mb-3 h-2 w-full rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-[#5C2D91]"
                    style={{ width: `${Math.min(100, Math.max(0, campaign.progress))}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  {campaign.channels.map((channel) => (
                    <span
                      key={channel}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${PLATFORM_PILL[channel] || 'bg-slate-100 text-slate-700'}`}
                    >
                      {channel}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {postModal && (
        <Modal title="Create Social Media Post" onClose={() => setPostModal(false)}>
          <div className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Platform</label>
              <div className="flex flex-wrap gap-2">
                {PR_PLATFORMS.map((platform) => (
                  <button
                    key={platform}
                    type="button"
                    onClick={() => setPostDraft((prev) => ({ ...prev, platform }))}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                      postDraft.platform === platform
                        ? PLATFORM_PILL[platform]
                        : 'bg-slate-50 text-slate-600'
                    }`}
                  >
                    {platform}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Post Content</label>
              <textarea
                rows={5}
                value={postDraft.content}
                onChange={(e) => setPostDraft((prev) => ({ ...prev, content: e.target.value }))}
                className={`${inputClass} resize-none`}
                placeholder="Write your post…"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Schedule Date</label>
                <input
                  type="date"
                  value={postDraft.date}
                  onChange={(e) => setPostDraft((prev) => ({ ...prev, date: e.target.value }))}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Schedule Time</label>
                <input
                  type="time"
                  value={postDraft.time}
                  onChange={(e) => setPostDraft((prev) => ({ ...prev, time: e.target.value }))}
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-500">Campaign (optional)</label>
              <select
                value={postDraft.campaignId}
                onChange={(e) => setPostDraft((prev) => ({ ...prev, campaignId: e.target.value }))}
                className={inputClass}
              >
                <option value="">No campaign</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={() => setPostModal(false)}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePost('draft')}
              className="rounded-xl border border-[#DDD3F0] px-4 py-2.5 text-sm font-semibold text-[#5C2D91] hover:bg-[#F5F3FF] disabled:opacity-60"
            >
              Save Draft
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void savePost('scheduled')}
              className="rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Schedule
            </button>
          </div>
        </Modal>
      )}

      {coverageModal && (
        <Modal title="Add Coverage" onClose={() => setCoverageModal(false)}>
          <div className="space-y-3">
            <input
              className={inputClass}
              placeholder="Outlet (e.g. Baltimore Sun)"
              value={coverageDraft.outlet}
              onChange={(e) => setCoverageDraft((p) => ({ ...p, outlet: e.target.value }))}
            />
            <select
              className={inputClass}
              value={coverageDraft.medium}
              onChange={(e) => setCoverageDraft((p) => ({ ...p, medium: e.target.value }))}
            >
              {PR_MEDIUMS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
            <input
              className={inputClass}
              placeholder="Headline"
              value={coverageDraft.headline}
              onChange={(e) => setCoverageDraft((p) => ({ ...p, headline: e.target.value }))}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="date"
                className={inputClass}
                value={coverageDraft.date}
                onChange={(e) => setCoverageDraft((p) => ({ ...p, date: e.target.value }))}
              />
              <select
                className={inputClass}
                value={coverageDraft.sentiment}
                onChange={(e) =>
                  setCoverageDraft((p) => ({
                    ...p,
                    sentiment: e.target.value as 'positive' | 'neutral' | 'negative',
                  }))
                }
              >
                <option value="positive">positive</option>
                <option value="neutral">neutral</option>
                <option value="negative">negative</option>
              </select>
            </div>
            <input
              className={inputClass}
              placeholder="URL (optional)"
              value={coverageDraft.url}
              onChange={(e) => setCoverageDraft((p) => ({ ...p, url: e.target.value }))}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCoverageModal(false)}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveCoverage()}
              className="rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Save Coverage
            </button>
          </div>
        </Modal>
      )}

      {releaseModal && (
        <Modal title="Write Release" onClose={() => setReleaseModal(false)}>
          <div className="space-y-3">
            <input
              className={inputClass}
              placeholder="Press release title"
              value={releaseDraft.title}
              onChange={(e) => setReleaseDraft((p) => ({ ...p, title: e.target.value }))}
            />
            <textarea
              rows={5}
              className={`${inputClass} resize-none`}
              placeholder="Release body"
              value={releaseDraft.body}
              onChange={(e) => setReleaseDraft((p) => ({ ...p, body: e.target.value }))}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                type="date"
                className={inputClass}
                value={releaseDraft.date}
                onChange={(e) => setReleaseDraft((p) => ({ ...p, date: e.target.value }))}
              />
              <select
                className={inputClass}
                value={releaseDraft.status}
                onChange={(e) =>
                  setReleaseDraft((p) => ({
                    ...p,
                    status: e.target.value as 'draft' | 'review' | 'published',
                  }))
                }
              >
                <option value="draft">Draft</option>
                <option value="review">Review</option>
                <option value="published">Published</option>
              </select>
            </div>
            <input
              className={inputClass}
              placeholder="Outlets (optional)"
              value={releaseDraft.outlet}
              onChange={(e) => setReleaseDraft((p) => ({ ...p, outlet: e.target.value }))}
            />
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setReleaseModal(false)}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void saveRelease()}
              className="rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              Save Release
            </button>
          </div>
        </Modal>
      )}

      {viewCoverage && (
        <Modal title={viewCoverage.outlet} onClose={() => setViewCoverage(null)}>
          <p className="text-sm italic text-slate-700">&ldquo;{viewCoverage.headline}&rdquo;</p>
          <p className="mt-2 text-xs text-slate-500">
            {viewCoverage.medium} · {formatLongDate(viewCoverage.publishedAt)} · {viewCoverage.sentiment}
          </p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setViewCoverage(null)}
              className="rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Close
            </button>
          </div>
        </Modal>
      )}

      {viewRelease && (
        <Modal title="Press Release" onClose={() => setViewRelease(null)}>
          <p className="text-sm font-semibold text-slate-900">{viewRelease.title}</p>
          <p className="mt-1 text-xs text-slate-500">
            {viewRelease.status}
            {viewRelease.publishedAt ? ` · ${formatLongDate(viewRelease.publishedAt)}` : ''}
          </p>
          {viewRelease.outlet ? <p className="mt-1 text-xs text-[#5C2D91]">{viewRelease.outlet}</p> : null}
          <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{viewRelease.body || 'No body yet.'}</p>
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setViewRelease(null)}
              className="rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white"
            >
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 shrink-0 md:h-8 md:w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
