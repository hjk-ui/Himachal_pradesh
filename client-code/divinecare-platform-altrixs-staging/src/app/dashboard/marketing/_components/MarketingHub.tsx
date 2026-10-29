'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Megaphone, ShieldCheck } from 'lucide-react';
import { Alert, Page, PageHeader, StatusBadge, Tabs, buttonClasses } from '@/components/ui';
import { LeadsWorkspace } from './LeadsWorkspace';
import { OverviewTab } from './OverviewTab';
import { FormsTab } from './FormsTab';
import { AutomationsTab } from './AutomationsTab';
import { ReputationTab } from './ReputationTab';
import { CampaignsTab } from './CampaignsTab';
import { SocialTab } from './SocialTab';
import { PartnersTab } from './PartnersTab';
import { AnalyticsTab } from './AnalyticsTab';
import { SettingsTab } from './SettingsTab';
import { useApi } from './shared';

const TABS = ['overview', 'leads', 'forms', 'automations', 'reputation', 'campaigns', 'social', 'partners', 'analytics', 'settings'] as const;
type TabKey = (typeof TABS)[number];

type Overview = {
  counts: { openLeads: number; openTasks: number; reviewsAwaiting: number; campaignsInReview: number; postsInReview: number };
  delivery: { sms: boolean; email: boolean; ai: boolean };
  complianceReady: boolean;
};

export default function MarketingHub() {
  const params = useSearchParams();
  const router = useRouter();
  const initial = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as TabKey) : 'overview';
  const [tab, setTab] = useState<TabKey>(initial);
  const { data, error } = useApi<Overview>('/api/marketing');
  useEffect(() => {
    const q = tab === 'overview' ? '' : `?tab=${tab}`;
    router.replace(`/dashboard/marketing${q}`, { scroll: false });
  }, [tab, router]);

  return (
    <Page width="full">
      <PageHeader
        title="Growth & Marketing"
        description="Leads, conversations, automations, reputation, campaigns, social and partners, built for HIPAA, TCPA and CAN-SPAM."
        badges={<StatusBadge tone="brand" icon={<ShieldCheck aria-hidden />}>HIPAA-safe marketing</StatusBadge>}
        actions={
          <>
            <Link href="/dashboard/pr" className={buttonClasses({ variant: 'secondary' })}>
              <Megaphone className="h-4 w-4" aria-hidden /> Press & brand assets
            </Link>
            <Link href="/dashboard/community" className={buttonClasses({ variant: 'secondary' })}>Events & volunteers</Link>
          </>
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {data && !data.complianceReady ? (
        <Alert tone="warning" title="Add the practice postal address" actions={<button type="button" className={buttonClasses({ variant: 'secondary', size: 'sm' })} onClick={() => setTab('settings')}>Open settings</button>}>
          CAN-SPAM requires a physical address in every marketing email. Marketing email stays blocked until it is set.
        </Alert>
      ) : null}
      {data && (!data.delivery.sms || !data.delivery.email) ? (
        <Alert tone="info" title="Some delivery channels are not connected">
          {!data.delivery.sms ? 'Text messages are saved as queued (SMS number not connected on this server). ' : ''}
          {!data.delivery.email ? 'Email is saved as queued (sender email not connected). ' : ''}
          Nothing is reported as sent until it is. See Settings, Integrations.
        </Alert>
      ) : null}
      <Tabs
        label="Marketing sections"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'leads', label: 'Leads & inbox', count: data?.counts.openLeads },
          { key: 'forms', label: 'Web forms' },
          { key: 'automations', label: 'Automations' },
          { key: 'reputation', label: 'Reputation', count: data?.counts.reviewsAwaiting, countTone: 'attention' },
          { key: 'campaigns', label: 'Campaigns', count: data?.counts.campaignsInReview, countTone: 'attention' },
          { key: 'social', label: 'Social & content', count: data?.counts.postsInReview, countTone: 'attention' },
          { key: 'partners', label: 'Partners & events' },
          { key: 'analytics', label: 'Analytics' },
          { key: 'settings', label: 'Settings' },
        ]}
      />
      {tab === 'overview' ? <OverviewTab onNavigate={(t) => setTab(t as TabKey)} /> : null}
      {tab === 'leads' ? <LeadsWorkspace /> : null}
      {tab === 'forms' ? <FormsTab /> : null}
      {tab === 'automations' ? <AutomationsTab /> : null}
      {tab === 'reputation' ? <ReputationTab /> : null}
      {tab === 'campaigns' ? <CampaignsTab /> : null}
      {tab === 'social' ? <SocialTab /> : null}
      {tab === 'partners' ? <PartnersTab /> : null}
      {tab === 'analytics' ? <AnalyticsTab /> : null}
      {tab === 'settings' ? <SettingsTab /> : null}
    </Page>
  );
}
