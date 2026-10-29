'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import {
  MARKETING_HIPAA_BADGE,
  MARKETING_HUB_DESCRIPTION,
  MARKETING_HUB_TABS,
  MARKETING_HUB_TITLE,
  PARTNER_TYPES,
  SMS_OPT_OUT_FOOTER,
  type MarketingHubTabId,
} from '@/lib/marketing/constants';
import { useMarketingItems } from '@/features/marketing/useMarketingItems';
import type { MarketingKind } from '@/lib/marketing/store';

function isTab(id: string | null): id is MarketingHubTabId {
  return MARKETING_HUB_TABS.some((t) => t.id === id);
}

const KIND_FOR_TAB: Partial<Record<MarketingHubTabId, MarketingKind>> = {
  forms: 'form',
  automations: 'workflow',
  reputation: 'review',
  campaigns: 'campaign',
  social: 'social',
  partners: 'partner',
};

export default function MarketingHub() {
  const router = useRouter();
  const params = useSearchParams();
  const tabParam = params.get('tab');
  const tab: MarketingHubTabId = isTab(tabParam) ? tabParam : 'overview';
  const [postalAddress, setPostalAddress] = useState('');
  const [channelsConnected, setChannelsConnected] = useState(false);
  const [brandKit, setBrandKit] = useState('');
  const [leadResponseHours, setLeadResponseHours] = useState('24');
  const [templates, setTemplates] = useState('');
  const [aiFeatures, setAiFeatures] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overview, setOverview] = useState<{
    kpis: {
      leads30: number;
      converted: number;
      medianSpeedHours: number | null;
      avgReviewRating: number | null;
    };
    sources: Record<string, number>;
    emptyLeads30: boolean;
  } | null>(null);
  const [msg, setMsg] = useState('');
  const [campaignSub, setCampaignSub] = useState<'campaigns' | 'audience'>('campaigns');
  const [socialSub, setSocialSub] = useState<'planner' | 'press'>('planner');
  const [partnerSub, setPartnerSub] = useState<'partners' | 'events'>('partners');
  const [repSub, setRepSub] = useState<'reviews' | 'testimonials'>('reviews');

  const kind =
    tab === 'partners'
      ? partnerSub === 'events'
        ? 'event'
        : 'partner'
      : tab === 'reputation'
        ? repSub === 'testimonials'
          ? 'testimonial'
          : 'review'
        : tab === 'social'
          ? socialSub === 'press'
            ? 'press'
            : 'social'
          : KIND_FOR_TAB[tab] || null;

  const { items, loading, create, patch, reload } = useMarketingItems(kind);
  const spend = useMarketingItems(tab === 'analytics' ? 'spend' : null);

  const loadSettings = useCallback(async () => {
    const res = await fetch('/api/marketing/settings', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      setPostalAddress(String(data.postalAddress || ''));
      setChannelsConnected(Boolean(data.channelsConnected));
      setBrandKit(String(data.brandKit || ''));
      setLeadResponseHours(String(data.leadResponseHours || '24'));
      setTemplates(String(data.templates || ''));
      setAiFeatures(Boolean(data.aiFeatures));
    }
  }, []);

  const loadOverview = useCallback(async () => {
    const res = await fetch('/api/marketing/overview', { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    if (res.ok) setOverview(data);
  }, []);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (tab === 'overview' || tab === 'analytics') void loadOverview();
  }, [tab, loadOverview]);

  const setTab = (id: MarketingHubTabId) => {
    if (id === 'leads') {
      router.push('/dashboard/marketing/leads');
      return;
    }
    router.replace(`/dashboard/marketing?tab=${id}`);
  };

  const canSpamBlocked = !postalAddress.trim();
  const alerts = useMemo(() => {
    const list: string[] = [];
    if (canSpamBlocked) list.push('Add the practice postal address (CAN-SPAM block until set)');
    if (!channelsConnected) list.push('Some delivery channels are not connected');
    return list;
  }, [canSpamBlocked, channelsConnected]);

  async function saveSettings() {
    setSaving(true);
    try {
      await fetch('/api/marketing/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postalAddress,
          channelsConnected,
          brandKit,
          leadResponseHours,
          templates,
          aiFeatures,
        }),
      });
      await loadSettings();
      setMsg('Settings saved');
    } finally {
      setSaving(false);
    }
  }

  async function run(label: string, fn: () => Promise<unknown>) {
    setMsg('');
    try {
      await fn();
      setMsg(label);
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Failed');
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title={MARKETING_HUB_TITLE}
        description={MARKETING_HUB_DESCRIPTION}
        badges={
          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 ring-1 ring-inset ring-blue-600/20">
            {MARKETING_HIPAA_BADGE}
          </span>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => router.push('/dashboard/pr')}>
              Press &amp; brand assets
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setTab('partners')}>
              Events &amp; volunteers
            </Button>
          </>
        }
      />

      {alerts.map((a) => (
        <div key={a} className="mb-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {a}
        </div>
      ))}
      {msg ? <p className="mb-3 text-sm text-slate-600">{msg}</p> : null}

      <nav className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-1" aria-label="Marketing hub">
        {MARKETING_HUB_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium ${
              tab === t.id ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'overview' ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: 'Leads (30 days)', value: overview?.kpis.leads30 ?? '—' },
              { label: 'Converted to clients', value: overview?.kpis.converted ?? '—' },
              {
                label: 'Median speed to lead',
                value:
                  overview?.kpis.medianSpeedHours == null
                    ? '—'
                    : `${overview.kpis.medianSpeedHours.toFixed(1)}h`,
              },
              {
                label: 'Average review rating',
                value:
                  overview?.kpis.avgReviewRating == null
                    ? '—'
                    : overview.kpis.avgReviewRating.toFixed(1),
              },
            ].map((k) => (
              <Card key={k.label}>
                <CardBody>
                  <p className="text-xs uppercase tracking-wider text-slate-500">{k.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">{k.value}</p>
                </CardBody>
              </Card>
            ))}
          </div>
          {overview?.emptyLeads30 ? (
            <p className="text-sm text-slate-500">No leads in the last 30 days…</p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => setMsg('Weekly growth insights generated (in-app)')}>
              Weekly growth insights Generate
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setTab('social')}>
              Content calendar Suggest
            </Button>
            <Link href="/dashboard/marketing/leads" className="text-sm font-semibold text-blue-600 self-center">
              Open lead inbox →
            </Link>
          </div>
          <Card>
            <CardHeader title="Lead sources" />
            <CardBody>
              {overview && Object.keys(overview.sources).length ? (
                <ul className="space-y-1 text-sm text-slate-700">
                  {Object.entries(overview.sources).map(([s, n]) => (
                    <li key={s}>
                      {s}: {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">No leads in the last 30 days…</p>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'forms' ? (
        <ModuleList
          title="Web forms"
          empty="No forms yet"
          loading={loading}
          cta="Create a form"
          onCreate={() =>
            void run('Form created', () =>
              create({ name: 'Website intake', live: false })
            )
          }
          items={items.map((i) => ({
            id: i.id,
            title: String(i.name || 'Form'),
            meta: i.live ? 'Live' : 'Off',
            body: String(i.publicNotice || ''),
            actions: (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void run('Updated', () => patch(i.id, { live: !i.live }))}
              >
                {i.live ? 'Set Off' : 'Set Live'}
              </Button>
            ),
          }))}
        />
      ) : null}

      {tab === 'automations' ? (
        <ModuleList
          title="Automations"
          description="Recipes / Workflows"
          empty="No workflows"
          loading={loading}
          cta="Install a recipe or build your own"
          onCreate={() =>
            void run('Recipe installed', () =>
              create({ name: 'Speed-to-lead follow-up', recipe: true })
            )
          }
          items={items.map((i) => ({
            id: i.id,
            title: String(i.name || 'Workflow'),
            meta: i.recipe ? 'Recipe' : 'Custom',
          }))}
        />
      ) : null}

      {tab === 'reputation' ? (
        <div className="space-y-3">
          <SubTabs
            tabs={[
              { id: 'reviews', label: 'Reviews' },
              { id: 'testimonials', label: 'Testimonials' },
            ]}
            value={repSub}
            onChange={(v) => setRepSub(v as 'reviews' | 'testimonials')}
          />
          <ModuleList
            title={repSub === 'reviews' ? 'Reviews' : 'Testimonials'}
            empty={repSub === 'reviews' ? 'No reviews here' : 'No testimonials'}
            loading={loading}
            cta={repSub === 'reviews' ? 'Add review' : 'Add testimonial'}
            onCreate={() =>
              void run('Saved', () =>
                create(
                  repSub === 'reviews'
                    ? { author: 'Anonymous', rating: 5, body: 'Great care' }
                    : { author: 'Client', body: 'Authorized quote', authorized: true }
                )
              )
            }
            items={items.map((i) => ({
              id: i.id,
              title: String(i.author || 'Entry'),
              meta: i.rating ? `★ ${i.rating}` : i.authorized ? 'Authorized' : 'Needs signed authorization',
              body: String(i.body || ''),
            }))}
          />
        </div>
      ) : null}

      {tab === 'campaigns' ? (
        <div className="space-y-3">
          <SubTabs
            tabs={[
              { id: 'campaigns', label: 'Campaigns' },
              { id: 'audience', label: 'Audience & consent' },
            ]}
            value={campaignSub}
            onChange={(v) => setCampaignSub(v as 'campaigns' | 'audience')}
          />
          {campaignSub === 'audience' ? (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-500">No contacts</p>
                <p className="mt-2 text-xs text-slate-500">{SMS_OPT_OUT_FOOTER}</p>
              </CardBody>
            </Card>
          ) : (
            <ModuleList
              title="Campaigns"
              empty="No campaigns yet"
              loading={loading}
              cta="New campaign"
              onCreate={() =>
                void run('Campaign drafted', () =>
                  create({ name: 'Spring outreach', channel: 'Email', status: 'draft' })
                )
              }
              items={items.map((i) => ({
                id: i.id,
                title: String(i.name || 'Campaign'),
                meta: `${i.channel || 'Email'} · ${i.status || 'draft'}`,
                body: `No tracking pixels. ${SMS_OPT_OUT_FOOTER}`,
                actions: (
                  <div className="flex flex-wrap gap-1">
                    {i.status === 'draft' ? (
                      <Button size="sm" onClick={() => void run('Submitted', () => patch(i.id, {}, 'submit'))}>
                        Submit for review
                      </Button>
                    ) : null}
                    {i.status === 'review' ? (
                      <>
                        <Button size="sm" onClick={() => void run('Approved', () => patch(i.id, {}, 'approve'))}>
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void run('Sent back', () => patch(i.id, {}, 'send_back'))}
                        >
                          Send back
                        </Button>
                      </>
                    ) : null}
                    {i.status === 'approved' ? (
                      <Button
                        size="sm"
                        onClick={() => void run('Sent (test mode)', () => patch(i.id, {}, 'send'))}
                      >
                        Send now
                      </Button>
                    ) : null}
                    {i.status === 'send_back' ? (
                      <Button size="sm" onClick={() => void run('Resubmitted', () => patch(i.id, {}, 'submit'))}>
                        Submit for review
                      </Button>
                    ) : null}
                    {i.status === 'draft' || i.status === 'send_back' ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void run('Channel set', () =>
                            patch(i.id, { channel: i.channel === 'Text' ? 'Email' : 'Text' })
                          )
                        }
                      >
                        Channel: {String(i.channel || 'Email')}
                      </Button>
                    ) : null}
                  </div>
                ),
              }))}
            />
          )}
          {canSpamBlocked ? (
            <p className="text-sm font-medium text-rose-700">
              Set the practice postal address in Settings before sending.
            </p>
          ) : null}
        </div>
      ) : null}

      {tab === 'social' ? (
        <div className="space-y-3">
          <SubTabs
            tabs={[
              { id: 'planner', label: 'Social planner' },
              { id: 'press', label: 'Press & page copy' },
            ]}
            value={socialSub}
            onChange={(v) => setSocialSub(v as 'planner' | 'press')}
          />
          <div className="grid gap-3 sm:grid-cols-3">
            {['Approval queue', 'Press release drafting', 'Landing page and ad copy'].map((t) => (
              <Card key={t}>
                <CardBody>
                  <p className="text-sm font-semibold text-slate-900">{t}</p>
                </CardBody>
              </Card>
            ))}
          </div>
          <ModuleList
            title={socialSub === 'planner' ? 'Social planner' : 'Press & page copy'}
            empty={socialSub === 'planner' ? 'No social posts yet' : 'No press copy yet'}
            loading={loading}
            cta="New draft"
            onCreate={() =>
              void run('Draft created', () =>
                create({
                  title: socialSub === 'press' ? 'Press draft' : 'Social draft',
                  status: 'draft',
                })
              )
            }
            items={items.map((i) => ({
              id: i.id,
              title: String(i.title || 'Draft'),
              meta: String(i.status || 'draft'),
              actions: (
                <div className="flex flex-wrap gap-1">
                  {(['review', 'approved', 'scheduled', 'exported', 'posted'] as const).map((st) => (
                    <Button key={st} size="sm" variant="ghost" onClick={() => void run(st, () => patch(i.id, { status: st }))}>
                      {st}
                    </Button>
                  ))}
                </div>
              ),
            }))}
          />
          <Link href="/dashboard/pr" className="text-sm font-semibold text-blue-600">
            Open Press &amp; brand assets →
          </Link>
        </div>
      ) : null}

      {tab === 'partners' ? (
        <div className="space-y-3">
          <SubTabs
            tabs={[
              { id: 'partners', label: 'Referral partners' },
              { id: 'events', label: 'Events' },
            ]}
            value={partnerSub}
            onChange={(v) => setPartnerSub(v as 'partners' | 'events')}
          />
          <ModuleList
            title={partnerSub === 'partners' ? 'Referral partners' : 'Events'}
            empty={partnerSub === 'partners' ? 'No partners yet' : 'No events'}
            loading={loading}
            cta={partnerSub === 'partners' ? 'Add partner' : 'Add event'}
            onCreate={() =>
              void run('Saved', () =>
                create(
                  partnerSub === 'partners'
                    ? { name: 'New partner', partnerType: 'Community org' }
                    : { name: 'Community event', date: new Date().toISOString().slice(0, 10) }
                )
              )
            }
            items={items.map((i) => ({
              id: i.id,
              title: String(i.name || 'Item'),
              meta:
                partnerSub === 'partners'
                  ? String(i.partnerType || 'Other')
                  : String(i.date || ''),
            }))}
          />
          {partnerSub === 'partners' ? (
            <p className="text-xs text-slate-500">Types: {PARTNER_TYPES.join(' · ')}</p>
          ) : null}
        </div>
      ) : null}

      {tab === 'analytics' ? (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Funnel & speed" description="Small-cell suppression default 11" />
            <CardBody className="grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
              <p>Leads (30d): {overview?.kpis.leads30 ?? 0}</p>
              <p>Converted: {overview?.kpis.converted ?? 0}</p>
              <p>
                Median speed:{' '}
                {overview?.kpis.medianSpeedHours == null
                  ? '—'
                  : `${overview.kpis.medianSpeedHours.toFixed(1)}h`}
              </p>
              <p>
                Avg review:{' '}
                {overview?.kpis.avgReviewRating == null
                  ? '—'
                  : overview.kpis.avgReviewRating.toFixed(1)}
              </p>
            </CardBody>
          </Card>
          <ModuleList
            title="Sources + CPL (manual spend)"
            empty="No spend rows"
            loading={spend.loading}
            cta="Add spend"
            onCreate={() =>
              void run('Spend saved', () => spend.create({ source: 'Social media', amount: 100 }))
            }
            items={spend.items.map((i) => ({
              id: i.id,
              title: String(i.source || 'Source'),
              meta: `$${Number(i.amount || 0)}`,
            }))}
          />
          <Card>
            <CardHeader title="Partner leaderboard · Event ROI · Review trend" />
            <CardBody>
              <p className="text-sm text-slate-500">
                Values suppress when cell count &lt; 11.
              </p>
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'settings' ? (
        <Card>
          <CardHeader title="Settings" description="Integrations stay disconnected until real connectors are enabled" />
          <CardBody className="space-y-4">
            <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
              <p className="font-semibold text-slate-900">Integrations</p>
              <p className="text-slate-500">Meta Ads · Google Ads · Mail — Disconnected</p>
            </div>
            <label className="block text-sm font-medium text-slate-700">
              Compliance — physical address (CAN-SPAM)
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
                rows={3}
                value={postalAddress}
                onChange={(e) => setPostalAddress(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Marketing authorization template
              <textarea
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows={2}
                value={templates}
                onChange={(e) => setTemplates(e.target.value)}
                placeholder="Authorization language…"
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Lead response (hours)
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={leadResponseHours}
                onChange={(e) => setLeadResponseHours(e.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Brand kit / senders
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                value={brandKit}
                onChange={(e) => setBrandKit(e.target.value)}
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channelsConnected}
                onChange={(e) => setChannelsConnected(e.target.checked)}
              />
              Delivery channels connected
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={aiFeatures} onChange={(e) => setAiFeatures(e.target.checked)} />
              AI features
            </label>
            <p className="text-xs text-slate-500">SMS footer: {SMS_OPT_OUT_FOOTER}</p>
            <Button loading={saving} onClick={() => void saveSettings()}>
              Save settings
            </Button>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function SubTabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
            value === t.id ? 'bg-blue-600 text-white shadow-xs' : 'border border-slate-300 bg-white text-slate-700'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function ModuleList({
  title,
  description,
  empty,
  loading,
  cta,
  onCreate,
  items,
}: {
  title: string;
  description?: string;
  empty: string;
  loading: boolean;
  cta: string;
  onCreate: () => void;
  items: Array<{
    id: string;
    title: string;
    meta?: string;
    body?: string;
    actions?: React.ReactNode;
  }>;
}) {
  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        actions={
          <Button size="sm" onClick={onCreate}>
            {cta}
          </Button>
        }
      />
      <CardBody>
        {loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">{empty}</p>
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <li key={item.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                    {item.meta ? <p className="text-xs text-slate-500">{item.meta}</p> : null}
                    {item.body ? <p className="mt-1 text-xs text-slate-600">{item.body}</p> : null}
                  </div>
                  {item.actions}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
