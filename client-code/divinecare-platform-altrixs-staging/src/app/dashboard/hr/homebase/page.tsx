'use client';

import { Suspense } from 'react';
import { HomebaseHub } from '@/components/hr/HomebaseHub';

export default function HrHomebaseRoute() {
  return (
    <Suspense>
      <HomebaseHub />
    </Suspense>
  );
}
