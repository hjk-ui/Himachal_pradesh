'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { PriorAuthTracking } from './_components/PriorAuthTracking';
import { ElectronicPriorAuth } from './_components/ElectronicPriorAuth';
import { TmsBillingHandoffs } from './_components/TmsBillingHandoffs';
import { Page, PageHeader, Tabs } from '@/components/ui';

/**
 * One Authorizations page (merged Oct 2026):
 * - Tracking: PA status, session counts, expiry (was /dashboard/ehr/prior-auths)
 * - Electronic submissions: Carelon / Availity requests (was /dashboard/billing/prior-auth)
 * Each tab is shown only to roles whose API gate allows it — the APIs still
 * check the original paths, so tab visibility uses the same paths.
 */
const TABS = [
  { id: 'tracking', label: 'Tracking', gatePath: '/dashboard/ehr/prior-auths' },
  { id: 'electronic', label: 'Electronic submissions', gatePath: '/dashboard/billing/prior-auth' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function AuthorizationsTabs() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const visible = TABS.filter((t) => user?.role && canAccessPath(user.role, t.gatePath));
  const requested = searchParams.get('tab') as TabId | null;
  const active = visible.find((t) => t.id === requested) ?? visible[0];

  const selectTab = (id: TabId) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set('tab', id);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };

  return (
    <Page>
      <PageHeader
        title="Authorizations"
        description="Prior authorization tracking and electronic payer submissions in one place."
      />

      {user?.role && canAccessPath(user.role, '/dashboard/billing/authorizations') ? <TmsBillingHandoffs /> : null}

      {visible.length > 1 && (
        <Tabs
          label="Authorizations views"
          idBase="auth"
          value={active?.id ?? visible[0].id}
          onChange={(id) => selectTab(id)}
          items={visible.map((tab) => ({ key: tab.id, label: tab.label }))}
        />
      )}

      {active ? (
        <div role="tabpanel" id={`auth-panel-${active.id}`} aria-labelledby={`auth-tab-${active.id}`}>
          {active.id === 'tracking' ? <PriorAuthTracking /> : <ElectronicPriorAuth />}
        </div>
      ) : null}
    </Page>
  );
}

export default function AuthorizationsPage() {
  return (
    <Suspense fallback={null}>
      <AuthorizationsTabs />
    </Suspense>
  );
}
