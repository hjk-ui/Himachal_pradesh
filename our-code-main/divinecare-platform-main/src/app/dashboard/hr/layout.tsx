'use client';

import type { ReactNode } from 'react';
import { HrHubShell } from '@/features/hr/HrHubShell';

export default function HrLayout({ children }: { children: ReactNode }) {
  return <HrHubShell>{children}</HrHubShell>;
}
