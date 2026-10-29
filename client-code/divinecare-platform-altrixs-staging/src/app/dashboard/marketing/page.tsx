import { Suspense } from 'react';
import { LoadingState } from '@/components/ui';
import MarketingHub from './_components/MarketingHub';

export const metadata = { title: 'Growth & Marketing' };

export default function MarketingPage() {
  return (
    <Suspense fallback={<LoadingState label="Loading marketing" />}>
      <MarketingHub />
    </Suspense>
  );
}
