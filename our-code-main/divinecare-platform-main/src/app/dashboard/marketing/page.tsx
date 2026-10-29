'use client';

import { Suspense } from 'react';
import MarketingHub from '@/features/marketing/MarketingHub';

export default function MarketingPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-slate-500">Loading…</div>}>
      <MarketingHub />
    </Suspense>
  );
}
