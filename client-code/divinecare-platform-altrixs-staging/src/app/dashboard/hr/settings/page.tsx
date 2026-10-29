'use client';

import { Suspense } from 'react';
import { HrSettingsPage } from '@/components/hr/HrSettingsPage';

export default function HrSettingsRoute() {
  return (
    <Suspense>
      <HrSettingsPage />
    </Suspense>
  );
}
