'use client';

import { Suspense } from 'react';
import { GroupDetail } from '@/features/groups/GroupDetail';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GroupDetail kind="sud" />
    </Suspense>
  );
}
