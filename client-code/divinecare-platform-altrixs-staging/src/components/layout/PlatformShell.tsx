'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth';

const NAV = [
  { href: '/platform', label: 'Organizations', exact: true },
  { href: '/platform/users', label: 'Users', exact: false },
];

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-[100svh] bg-slate-50 text-slate-900 lg:min-h-[100dvh]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-3 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-4">
          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                Altrixs Platform
              </p>
              <p className="truncate text-sm text-slate-500">Super Admin console</p>
            </div>
            <nav className="flex max-w-full items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
              {NAV.map((item) => {
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`min-h-11 shrink-0 rounded-md px-3 py-2.5 text-sm font-medium ${
                      active
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-3 text-sm md:justify-end">
            <span className="min-w-0 truncate text-slate-500">{user?.email}</span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="min-h-11 shrink-0 rounded-md border border-slate-200 px-3 py-2 font-medium text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}
