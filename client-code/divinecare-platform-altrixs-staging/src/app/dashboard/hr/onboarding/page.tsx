'use client';

import { Suspense } from 'react';
import { ChecklistBoard } from '@/components/hr/ChecklistBoard';

export default function HrOnboardingPage() {
  return (
    <Suspense>
      <ChecklistBoard kind="onboarding" />
    </Suspense>
  );
}
