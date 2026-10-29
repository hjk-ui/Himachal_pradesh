'use client';

import { Suspense } from 'react';
import { PeopleList } from '@/components/hr/PeopleList';

export default function HrPeoplePage() {
  return (
    <Suspense>
      <PeopleList />
    </Suspense>
  );
}
