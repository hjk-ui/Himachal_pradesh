'use client';

import Link from 'next/link';
import PrMarketingPage from '@/features/pr/PrMarketingPage';
import { Alert } from '@/components/ui';

export default function PRPage() {
  return (
    <div className="space-y-4">
      <Alert tone="brand" title="Growth & Marketing hub">
        Leads, campaigns, reputation, automations, the social planner with approvals and AI press release drafting now live in the{' '}
        <Link href="/dashboard/marketing" className="font-medium text-blue-700 underline">Marketing hub</Link>. Press coverage and brand assets stay here.
      </Alert>
      <PrMarketingPage />
    </div>
  );
}
