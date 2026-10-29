'use client';

import { Suspense } from 'react';
import { CredentialingHub } from '@/components/hr/CredentialingHub';

export default function CredentialingPage() {
  return (
    <Suspense>
      <CredentialingHub />
    </Suspense>
  );
}
