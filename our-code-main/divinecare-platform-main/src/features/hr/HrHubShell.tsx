'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { HR_HUB_TABS } from '@/lib/hr/constants';

function tabActive(pathname: string, href: string, match: 'exact' | 'prefix') {
  if (match === 'exact') return pathname === href;
  if (href === '/dashboard/hr/people') {
    return pathname === href || pathname.startsWith('/dashboard/hr/people/');
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function HrHubShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() || '/dashboard/hr';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <nav
        className="-mx-1 mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 px-1"
        aria-label="HR hub"
      >
        {HR_HUB_TABS.map((tab) => {
          const active = tabActive(pathname, tab.href, tab.match);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`shrink-0 border-b-2 px-3 py-2.5 text-[13px] font-medium transition ${
                active
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      {children}
    </div>
  );
}
