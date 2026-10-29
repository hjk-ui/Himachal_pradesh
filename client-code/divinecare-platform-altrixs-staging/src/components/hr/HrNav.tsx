'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  CalendarDays,
  Clock,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Network,
  Settings,
  ShieldCheck,
  Star,
  UserCircle2,
  UserPlus,
  Users,
} from 'lucide-react';
import { cx } from '@/components/ui';

export type HrTab = { href: string; label: string; icon: string; exact?: boolean };

const ICONS: Record<string, typeof Users> = {
  dashboard: LayoutDashboard,
  people: Users,
  credentialing: ShieldCheck,
  onboarding: UserPlus,
  offboarding: LogOut,
  training: GraduationCap,
  timeOff: CalendarDays,
  performance: Star,
  supervision: ClipboardCheck,
  orgChart: Network,
  analytics: BarChart3,
  settings: Settings,
  me: UserCircle2,
  homebase: Clock,
};

/** HR hub tab bar (links, so each tab has its own URL). Scrolls sideways on tablets and phones. */
export function HrNav({ tabs }: { tabs: HrTab[] }) {
  const pathname = usePathname() || '';
  if (tabs.length <= 1) return null;
  const active = tabs
    .filter((t) => (t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav aria-label="HR sections" className="mb-6 -mx-1 overflow-x-auto border-b border-slate-200">
      <ul className="flex min-w-max gap-1 px-1">
        {tabs.map((t) => {
          const Icon = ICONS[t.icon] ?? Users;
          const isActive = active?.href === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  '-mb-px inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600',
                  isActive ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
