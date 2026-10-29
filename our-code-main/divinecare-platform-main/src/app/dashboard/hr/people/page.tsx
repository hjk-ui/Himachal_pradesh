'use client';

import { Suspense } from 'react';
import HrPeoplePage from '@/features/hr/HrPeoplePage';

export default function Page() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-500">Loading…</div>}>
      <HrPeoplePage />
    </Suspense>
  );
}
