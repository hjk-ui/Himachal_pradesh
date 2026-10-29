import type { ReactNode } from 'react';
import { requireSession } from '@/lib/auth/requireSession';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { HrNav, type HrTab } from '@/components/hr/HrNav';

/** Every HR area in one hub; each viewer sees only the tabs their role can open. */
const HR_TABS: HrTab[] = [
  { href: '/dashboard/hr', label: 'Dashboard', icon: 'dashboard', exact: true },
  { href: '/dashboard/hr/people', label: 'People', icon: 'people' },
  { href: '/dashboard/hr/credentialing', label: 'Credentialing', icon: 'credentialing' },
  { href: '/dashboard/hr/onboarding', label: 'Onboarding', icon: 'onboarding' },
  { href: '/dashboard/hr/offboarding', label: 'Offboarding', icon: 'offboarding' },
  { href: '/dashboard/hr/training', label: 'Training', icon: 'training' },
  { href: '/dashboard/hr/time-off', label: 'Time off', icon: 'timeOff' },
  { href: '/dashboard/hr/performance', label: 'Performance', icon: 'performance' },
  { href: '/dashboard/hr/supervision', label: 'Supervision', icon: 'supervision' },
  { href: '/dashboard/hr/org-chart', label: 'Org chart', icon: 'orgChart' },
  // Read-only Homebase (payroll / timekeeping) connector: HR + leadership (/dashboard/hr prefix)
  { href: '/dashboard/hr/homebase', label: 'Homebase', icon: 'homebase' },
  { href: '/dashboard/hr/settings', label: 'Settings', icon: 'settings' },
  { href: '/dashboard/hr/me', label: 'My HR', icon: 'me' },
];

export default async function HrLayout({ children }: { children: ReactNode }) {
  const gate = await requireSession();
  const role = gate.ok ? String(gate.role) : null;
  const caps = gate.ok ? gate.capabilities : null;
  const tabs = role ? HR_TABS.filter((t) => canAccessPath(role, t.href, caps)) : [];
  return (
    <div className="min-w-0">
      <HrNav tabs={tabs} />
      {children}
    </div>
  );
}
