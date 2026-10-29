'use client';

import { Suspense, use } from 'react';
import { EmployeeProfile } from '@/components/hr/EmployeeProfile';

export default function HrEmployeePage({ params }: { params: Promise<{ userId: string }> }) {
  const { userId } = use(params);
  return (
    <Suspense>
      <EmployeeProfile userId={userId} />
    </Suspense>
  );
}
