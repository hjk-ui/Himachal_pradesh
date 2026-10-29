'use client';

import { Suspense } from 'react';
import { ChecklistBoard } from '@/components/hr/ChecklistBoard';

export default function HrOffboardingPage() {
  return (
    <Suspense>
      <ChecklistBoard kind="offboarding" />
    </Suspense>
  );
}
