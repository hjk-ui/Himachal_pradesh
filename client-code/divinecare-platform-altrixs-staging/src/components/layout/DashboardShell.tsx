'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ChevronRight, Eye, Menu, PanelLeftClose, PanelLeftOpen, Pill, X } from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useRoleSwitcher } from '@/components/layout/RoleSwitcher';
import { SidebarAccountMenu } from '@/components/layout/SidebarAccountMenu';
import { DashboardCommandSearch } from '@/components/layout/DashboardCommandSearch';
import { SidebarNav } from '@/components/layout/SidebarNav';
import {
  breadcrumbsFor,
  buildNavForRole,
  chartClientId,
  navHomeHrefForRole,
  navSearchItems,
  profileHrefForRole,
  searchOnlyItemsForRole,
} from '@/components/layout/navConfig';
import {
  CHART_CLIENT_EVENT,
  NAV_STORAGE_EVENT,
  clearRecentClients,
  getPinnedHrefs,
  getRecentClients,
  rememberRecentClient,
  togglePinnedHref,
  type RecentClient,
} from '@/components/layout/navStorage';
import { ModulePersistenceNotice } from '@/components/clinic/ModulePersistenceNotice';
import { BuildUpdateWatcher } from '@/lib/client/BuildUpdateWatcher';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { medicalDirectorActive, type AccessCapabilities } from '@/lib/auth/medicalDirector';
import type { StaffRole } from '@/types/roles';
import { canPrescribe } from '@/types/roles';
import { DemoToaster } from '@/components/DemoActionProvider';
import toast, { Toaster } from 'react-hot-toast';
import { DrFirstReturnSync } from '@/components/drfirst/DrFirstReturnSync';
import { openRcopia } from '@/lib/drfirst/openRcopiaClient';
import { NOTIFICATION_SCREENS, type NotificationCountKey } from '@/lib/drfirst/notificationScreens';
import { getPrescribingUiState } from '@/lib/drfirst/uiState';
import { useLocation } from '@/context/LocationContext';
import { SidebarLocationSwitcher } from '@/components/layout/SidebarLocationSwitcher';

/** Every Business sidebar item lives under one of these roots (incl. nested billing/HR). */
const BUSINESS_PATH_PREFIXES = [
  '/dashboard/enterprise',
  '/dashboard/billing',
  '/dashboard/hr',
  '/dashboard/admin',
  '/dashboard/settings',
] as const;

function isBusinessPath(pathname: string | null) {
  if (!pathname) return false;
  return BUSINESS_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/**
 * Fallback for chart pages that do not announce their client yet: read the
 * chart header already on screen (h1 = name, "MRN …" line). No extra fetch.
 */
function readChartHeader(): { name: string; mrn: string | null } | null {
  try {
    const main = document.querySelector('main.dashboard-shell-main');
    const h1 = main?.querySelector('h1');
    const name = h1?.textContent?.trim();
    if (!name) return null;
    const mrnLine = Array.from(h1?.parentElement?.querySelectorAll('p') ?? [])
      .map((p) => p.textContent?.trim() || '')
      .find((t) => /^MRN\s+\S+/.test(t));
    return { name, mrn: mrnLine ? mrnLine.replace(/^MRN\s+/, '') : null };
  } catch {
    return null;
  }
}

export function DashboardShell({
  children,
  verifiedMedicalDirector = false,
}: {
  children: React.ReactNode;
  /** Medical Director flag verified from the database by the dashboard layout (requireSession) */
  verifiedMedicalDirector?: boolean;
}) {
  const { user, loading, logout, refreshCapabilities } = useAuth();
  // One role-switch state for the sidebar account menu and the preview banner.
  const roleSwitch = useRoleSwitcher();
  // Sidebar / page checks use the DB-verified flag, never the JWT claim alone.
  const capabilities: AccessCapabilities = useMemo(() => ({ medicalDirector: verifiedMedicalDirector }), [verifiedMedicalDirector]);
  const showMedicalDirector = Boolean(user?.role && medicalDirectorActive(user.role, capabilities));

  // Granted or revoked since sign-in: bring the session token (read by the proxy gate) in line once.
  const capsSynced = useRef(false);
  useEffect(() => {
    if (!user || capsSynced.current) return;
    if (Boolean(user.medicalDirector) === verifiedMedicalDirector) return;
    capsSynced.current = true;
    void refreshCapabilities();
  }, [user, verifiedMedicalDirector, refreshCapabilities]);
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeLocationId, activeLocation, setActiveLocationId, locations, isAllLocations } = useLocation();
  const [locationSwitcherOpen, setLocationSwitcherOpen] = useState(false);
  const [prescriberBadge, setPrescriberBadge] = useState<{ prescriptions: number; toSign: number; refills: number; changes: number } | null>(null);

  useEffect(() => {
    if (!user) return;
    // Same rule as /api/drfirst/*: prescribers see their own counts, admins the org's
    const isPrescriberRole = canPrescribe(user.role) || user.role === 'ADMIN';

    if (isPrescriberRole) {
      fetch('/api/drfirst/notifications')
        .then((res) => res.json())
        .then((data) => {
          if (data.success && data.data?.counts) {
            // Keys from /api/drfirst/notifications (Rcopia get_notification_count types, normalized)
            const n = data.data.counts as Record<string, number>;
            setPrescriberBadge({
              prescriptions: n.pending_prescription || 0,
              toSign: n.need_signing || 0,
              refills: n.refill || 0,
              changes: n.rx_change || 0,
            });
          }
        })
        .catch(() => {});
    }
  }, [user]);

  const badgeCounts = prescriberBadge
    ? ([
        { key: 'pending_prescription', value: prescriberBadge.prescriptions, label: 'Rx pending', a11y: 'pending prescriptions' },
        { key: 'refill', value: prescriberBadge.refills, label: 'Renewals', a11y: 'renewal requests' },
        { key: 'rx_change', value: prescriberBadge.changes, label: 'Changes', a11y: 'change requests' },
        { key: 'need_signing', value: prescriberBadge.toSign, label: 'To sign', a11y: 'prescriptions to sign' },
      ] as const)
    : [];
  // Called straight from the click (openRcopia opens the tab first so the pop-up blocker allows it)
  const openBadgeCount = async (key: NotificationCountKey) => {
    const r = await openRcopia({ screen: NOTIFICATION_SCREENS[key] });
    if (!r.ok) toast.error(r.message || 'DrFirst could not be opened.');
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('altrixs.sidebarCollapsed');
      if (saved === '1') setSidebarCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('altrixs.sidebarCollapsed', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [user, loading, router]);

  // Keep everyone on the shared dashboard landing; only block clearly unauthorized pages.
  useEffect(() => {
    if (loading || !user?.role) return;
    if (!canAccessPath(user.role, pathname, { medicalDirector: verifiedMedicalDirector })) {
      if (pathname !== '/dashboard') router.replace('/dashboard');
    }
  }, [loading, user, pathname, router, verifiedMedicalDirector]);

  // Close drawer on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Lock body scroll when mobile drawer open
  useEffect(() => {
    if (!sidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sidebarOpen]);

  // Escape closes mobile drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Mobile drawer is a modal dialog: move focus in on open, back to the menu button on close
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const drawerWasOpen = useRef(false);
  useEffect(() => {
    if (sidebarOpen) {
      drawerWasOpen.current = true;
      const id = window.requestAnimationFrame(() => {
        const first = drawerRef.current?.querySelector<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        (first ?? drawerRef.current)?.focus();
      });
      return () => window.cancelAnimationFrame(id);
    }
    if (drawerWasOpen.current) {
      drawerWasOpen.current = false;
      menuButtonRef.current?.focus();
    }
  }, [sidebarOpen]);

  // Header location switcher: Escape and outside click close it
  const locationSwitcherRef = useRef<HTMLDivElement>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!locationSwitcherOpen) return;
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (!locationSwitcherRef.current?.contains(e.target as Node)) setLocationSwitcherOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLocationSwitcherOpen(false);
        locationButtonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [locationSwitcherOpen]);

  // ── Pinned pages + recent client charts (per user, localStorage) ──────────
  const userId = user?.id ?? null;
  const [pinned, setPinned] = useState<string[]>([]);
  const [recentClients, setRecentClients] = useState<RecentClient[]>([]);

  useEffect(() => {
    if (!userId) return;
    const sync = () => {
      setPinned(getPinnedHrefs(userId));
      setRecentClients(getRecentClients(userId));
    };
    sync();
    window.addEventListener(NAV_STORAGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(NAV_STORAGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [userId]);

  const onTogglePin = useCallback(
    (href: string) => {
      if (userId) setPinned(togglePinnedHref(userId, href));
    },
    [userId],
  );

  // Chart pages may announce {id, name, mrn}; otherwise read the header already rendered.
  const openChartId = chartClientId(pathname);
  // ?from=medical (Primary care patients list): breadcrumb links back to that list.
  // Read from window (no useSearchParams, so the shell needs no Suspense boundary).
  const [chartFrom, setChartFrom] = useState<string | null>(null);
  useEffect(() => {
    try {
      setChartFrom(openChartId ? new URLSearchParams(window.location.search).get('from') : null);
    } catch {
      setChartFrom(null);
    }
  }, [openChartId, pathname]);
  useEffect(() => {
    if (!userId) return;
    const onAnnounce = (e: Event) => {
      const detail = (e as CustomEvent<RecentClient>).detail;
      if (detail?.id && detail?.name) rememberRecentClient(userId, detail);
    };
    window.addEventListener(CHART_CLIENT_EVENT, onAnnounce);
    return () => window.removeEventListener(CHART_CLIENT_EVENT, onAnnounce);
  }, [userId]);

  useEffect(() => {
    if (!userId || !openChartId) return;
    const capture = () => {
      const header = readChartHeader();
      if (!header) return false;
      rememberRecentClient(userId, { id: openChartId, name: header.name, mrn: header.mrn });
      return true;
    };
    if (capture()) return;
    const main = document.querySelector('main.dashboard-shell-main');
    if (!main) return;
    const observer = new MutationObserver(() => {
      if (capture()) observer.disconnect();
    });
    observer.observe(main, { childList: true, subtree: true, characterData: true });
    const stop = window.setTimeout(() => observer.disconnect(), 15000);
    return () => {
      observer.disconnect();
      window.clearTimeout(stop);
    };
  }, [userId, openChartId]);

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-blue-600/20 border-t-blue-600" />
          <p className="text-sm font-medium text-slate-600">Loading Altrixs&hellip;</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Same rule as the page gate (canAccessPath), so no sidebar link bounces.
  const navSections = buildNavForRole(user.role, undefined, capabilities);
  // Logo and profile links come from the same nav model (HR's home is /dashboard/hr, not /dashboard;
  // My profile only when canAccessPath allows it, which is every clinic staff role).
  const homeHref = navHomeHrefForRole(user.role);
  const profileHref = profileHrefForRole(user.role);
  const chartClientName = openChartId
    ? recentClients.find((c) => c.id === openChartId)?.name ?? null
    : null;
  const crumbs = breadcrumbsFor(pathname, { sections: navSections, clientName: chartClientName, from: chartFrom });

  const handleLogout = async () => {
    clearRecentClients(userId);
    await logout();
    router.push('/login');
  };

  const initials =
    user.displayName?.[0]?.toUpperCase() || user.email?.[0]?.toUpperCase() || '?';

  const renderSidebar = (opts: { collapsed: boolean; isMobile?: boolean }) => {
    const { collapsed, isMobile } = opts;
    return (
      <div className="flex h-full min-h-0 flex-col bg-blue-900">
        <div
          className={`flex shrink-0 items-center gap-2 pb-3 pt-4 ${
            collapsed && !isMobile ? 'flex-col px-2' : 'justify-between px-4 sm:px-5'
          }`}
        >
          <Link
            href={homeHref}
            className="flex items-center transition hover:opacity-90"
            title="Altrixs"
          >
            {collapsed && !isMobile ? (
              <div className="relative flex h-9 w-9 items-center justify-center">
                <Image
                  src="/favicon.png"
                  alt="Altrixs"
                  width={30}
                  height={30}
                  className="object-contain"
                />
              </div>
            ) : (
              <div className="relative h-9 w-[150px] sm:h-10 sm:w-[165px]">
                <Image
                  src="/altrixs-logo-dark.png"
                  alt="Altrixs behavioral health EHR"
                  fill
                  sizes="(max-width: 640px) 150px, 165px"
                  className="object-contain object-left"
                  priority
                />
              </div>
            )}
          </Link>

          <div className={`flex items-center gap-1 ${collapsed && !isMobile ? '' : ''}`}>
            {!isMobile && (
              <button
                type="button"
                onClick={toggleCollapsed}
                className="hidden h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-300 transition hover:bg-white/5 hover:text-white lg:flex"
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              >
                {collapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
              </button>
            )}
            {isMobile && (
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
                aria-label="Close menu"
              >
                <X size={20} aria-hidden />
              </button>
            )}
          </div>
        </div>

        <div className={`mb-3 h-px shrink-0 bg-white/10 ${collapsed && !isMobile ? 'mx-2' : 'mx-4'}`} />

        {/* Sidebar Location Switcher below Logo */}
        {!(collapsed && !isMobile) && <SidebarLocationSwitcher />}

        <nav
          aria-label="Main navigation"
          className={`min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-4 [-webkit-overflow-scrolling:touch] ${
            collapsed && !isMobile ? 'px-2' : 'px-3'
          }`}
        >
          <SidebarNav
            sections={navSections}
            pathname={pathname}
            collapsed={Boolean(collapsed && !isMobile)}
            pinned={pinned}
            recentClients={recentClients}
            onNavigate={() => setSidebarOpen(false)}
            onTogglePin={onTogglePin}
          />
        </nav>

        <div
          className={`mt-auto shrink-0 border-t border-white/10 ${
            collapsed && !isMobile ? 'p-2' : 'p-3'
          }`}
        >
          <SidebarAccountMenu
            user={user}
            collapsed={Boolean(collapsed && !isMobile)}
            profileHref={profileHref}
            pathname={pathname}
            showMedicalDirector={showMedicalDirector}
            rs={roleSwitch}
            onNavigate={() => setSidebarOpen(false)}
            onSignOut={handleLogout}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-slate-50">
      <BuildUpdateWatcher />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[200] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-blue-700 focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-[#5C2D91]"
      >
        Skip to main content
      </a>
      <aside
        className={`relative hidden h-full min-h-0 shrink-0 flex-col overflow-hidden border-r border-white/5 bg-blue-900 transition-[width] duration-200 ease-out print:hidden lg:flex ${
          sidebarCollapsed ? 'lg:w-[76px]' : 'lg:w-[260px] xl:w-[280px]'
        }`}
      >
        <div className="relative z-10 flex h-full min-h-0 flex-col">
          {renderSidebar({ collapsed: sidebarCollapsed })}
        </div>
      </aside>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close menu overlay"
              className="fixed inset-0 z-40 touch-none bg-slate-900/50 backdrop-blur-[1px] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSidebarOpen(false)}
            />
            <motion.aside
              id="dashboard-mobile-sidebar"
              ref={drawerRef}
              role="dialog"
              aria-modal="true"
              aria-label="Navigation"
              tabIndex={-1}
              className="fixed inset-y-0 left-0 z-50 flex w-[min(86vw,320px)] max-w-[calc(100vw-1rem)] flex-col bg-blue-900 shadow-clinic-md lg:hidden"
              initial={{ x: '-105%' }}
              animate={{ x: 0 }}
              exit={{ x: '-105%' }}
              transition={{ type: 'spring', stiffness: 380, damping: 34 }}
            >
              <div className="relative z-10 flex h-full min-h-0 flex-col pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
                {renderSidebar({ collapsed: false, isMobile: true })}
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${isBusinessPath(pathname) ? 'business-app' : ''}`}
      >
        <header className="z-30 flex min-w-0 shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/90 py-2.5 pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] pt-[max(0.625rem,env(safe-area-inset-top))] backdrop-blur-md print:hidden sm:gap-3 sm:py-3 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] lg:px-8">
          <button
            type="button"
            ref={menuButtonRef}
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:scale-95"
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="dashboard-mobile-sidebar"
          >
            <Menu size={20} aria-hidden />
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 lg:flex"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
          </button>

          <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
            <ol className="flex min-w-0 items-center gap-1 text-[13px] font-medium text-slate-500">
              {crumbs.length === 0 ? (
                <li className="truncate">Altrixs</li>
              ) : (
                crumbs.map((crumb, i) => {
                  const last = i === crumbs.length - 1;
                  return (
                    <li
                      key={`${i}-${crumb.label}`}
                      className={`flex min-w-0 items-center gap-1 ${last ? '' : 'hidden sm:flex'}`}
                    >
                      {i > 0 && <ChevronRight size={13} className="hidden shrink-0 text-slate-300 sm:block" aria-hidden />}
                      {crumb.href && !last ? (
                        <Link href={crumb.href} className="truncate hover:text-blue-700">
                          {crumb.label}
                        </Link>
                      ) : (
                        <span
                          className={`truncate ${last ? 'font-semibold text-slate-800' : ''}`}
                          aria-current={last ? 'page' : undefined}
                        >
                          {crumb.label}
                        </span>
                      )}
                    </li>
                  );
                })
              )}
            </ol>
          </nav>

          <DashboardCommandSearch
            role={user?.role as StaffRole | null}
            capabilities={capabilities}
            navItems={[
              ...navSearchItems(navSections),
              ...searchOnlyItemsForRole(user.role, capabilities).map((item) => ({
                href: item.href,
                label: item.label,
                section: item.area,
                keywords: item.keywords,
              })),
            ]}
            pinnedHrefs={pinned}
            recentClients={recentClients}
          />

          {/* DrFirst Rcopia Prescriber Badge (Commit 6dbcf49) */}
          {/* DrFirst NCDM2: pending prescriptions, renewals, change requests and prescriptions to sign, always shown.
              NCDM3: each count opens its own Rcopia screen (NOTIFICATION_SCREENS); the icon opens E-Prescribing. */}
          {prescriberBadge && (
            <div
              role="group"
              aria-label="DrFirst counts"
              className="hidden lg:inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700 shadow-xs"
              title="DrFirst Rcopia: pending prescriptions, pharmacy renewal requests, pharmacy change requests and prescriptions waiting for your signature"
            >
              {prescriberBadge.prescriptions + prescriberBadge.toSign + prescriberBadge.refills + prescriberBadge.changes > 0 ? (
                <span className="h-2 w-2 rounded-full bg-blue-600 animate-pulse" aria-hidden />
              ) : null}
              <Link
                href="/dashboard/ehr/prescriptions"
                aria-label="DrFirst: open the E-Prescribing page"
                className="inline-flex items-center gap-1 rounded-full px-1 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <Pill size={12} aria-hidden /> DrFirst:
              </Link>
              {badgeCounts.map((item, i) => (
                <span key={item.key} className="inline-flex items-center gap-1">
                  {i > 0 ? <span aria-hidden>&middot;</span> : null}
                  <button
                    type="button"
                    onClick={() => void openBadgeCount(item.key)}
                    aria-label={`Open ${item.value} ${item.a11y} in DrFirst`}
                    className="rounded-full px-1 hover:bg-blue-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {item.value} {item.label}
                  </button>
                </span>
              ))}
            </div>
          )}
          {prescriberBadge && getPrescribingUiState(user).canLaunchGateway ? <DrFirstReturnSync /> : null}

          {/* MD Behavioral Health Header Location Switcher */}
          <div className="relative" ref={locationSwitcherRef}>
            <button
              type="button"
              ref={locationButtonRef}
              onClick={() => setLocationSwitcherOpen((o) => !o)}
              aria-haspopup="listbox"
              aria-expanded={locationSwitcherOpen}
              aria-controls="header-location-switcher"
              aria-label={`Location: ${activeLocation ? activeLocation.name : 'All Locations'}`}
              className="flex h-11 shrink-0 items-center gap-1.5 sm:h-10 sm:gap-2 rounded-xl border border-slate-200 bg-white px-2 sm:px-2.5 text-xs font-semibold text-slate-700 shadow-xs hover:border-slate-300 transition-all cursor-pointer"
              title="MD Behavioral Health Location"
            >
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white shadow-xs"
                style={{ backgroundColor: activeLocation ? activeLocation.brandColor : '#1E293B' }}
              >
                {activeLocation ? activeLocation.shortCode : 'AL'}
              </div>
              <span className="hidden md:inline truncate max-w-[130px]">
                {activeLocation ? activeLocation.name : 'All Locations'}
              </span>
              {activeLocation?.isFlagship && (
                <span className="hidden lg:inline text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200 font-semibold">
                  Flagship
                </span>
              )}
              <ChevronDown
                size={12}
                className={`text-slate-500 transition-transform ${locationSwitcherOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>

            {locationSwitcherOpen && (
              <div
                id="header-location-switcher"
                role="listbox"
                aria-label="MD Behavioral Health sites"
                className="absolute right-0 top-full mt-1.5 max-h-[calc(100dvh-5rem)] w-60 max-w-[calc(100vw-1.5rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95"
              >
                <p aria-hidden className="px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  MD Behavioral Health — Sites
                </p>
                {/* All Locations */}
                <button
                  type="button"
                  role="option"
                  aria-selected={isAllLocations}
                  onClick={() => {
                    setActiveLocationId('all');
                    setLocationSwitcherOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                    isAllLocations ? 'bg-blue-50 font-semibold text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white bg-slate-800">
                    ALL
                  </div>
                  <div className="flex-1 truncate">
                    <p className="truncate font-semibold">All Locations</p>
                    <p className="text-[11px] text-slate-500 font-normal">Practice-wide aggregate view</p>
                  </div>
                  {isAllLocations && <div className="h-1.5 w-1.5 rounded-full bg-brand-600" />}
                </button>

                <div aria-hidden className="border-t border-slate-100 my-1" />

                {/* 4 Locations */}
                {locations.map((loc) => {
                  const isSelected = activeLocationId === loc.id;
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setActiveLocationId(loc.id);
                        setLocationSwitcherOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50 font-semibold text-blue-900' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: loc.brandColor }}
                      >
                        {loc.shortCode}
                      </div>
                      <div className="flex-1 truncate">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-semibold">{loc.name}</p>
                          {loc.isFlagship && (
                            <span className="text-[11px] px-1 py-0.5 rounded bg-blue-50 text-blue-700 font-semibold">Flagship</span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-500 font-normal">{loc.specialtyType}</p>
                      </div>
                      {isSelected && <div className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: loc.brandColor }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <span
            className="hidden max-w-[12rem] truncate rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 sm:inline-block"
            title={user.displayName || user.email || undefined}
          >
            {user.displayName?.trim() || user.email || 'User'}
          </span>

          <Link
            href={profileHref ?? homeHref}
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#5C2D91] text-xs font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] focus-visible:ring-offset-2"
            aria-label={profileHref ? 'My profile' : 'Home'}
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </Link>
        </header>

        {roleSwitch.isPreviewing ? (
          <div
            role="status"
            className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-1.5 text-[13px] text-amber-900 print:hidden"
          >
            <Eye size={14} className="shrink-0" aria-hidden />
            <span className="min-w-0 truncate">
              You&apos;re previewing the <span className="font-semibold">{roleSwitch.previewLabel}</span> view.
            </span>
            <button
              type="button"
              onClick={() => void roleSwitch.exitPreview()}
              disabled={roleSwitch.busy}
              className="shrink-0 rounded-md px-2 py-1 font-semibold text-amber-900 underline underline-offset-2 hover:bg-amber-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 disabled:opacity-60"
            >
              Exit preview
            </button>
          </div>
        ) : null}

        <main id="main" tabIndex={-1} className="dashboard-shell-main focus:outline-none min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-auto py-3 pb-[max(1.5rem,calc(env(safe-area-inset-bottom)+1rem))] pl-[max(0.75rem,env(safe-area-inset-left))] pr-[max(0.75rem,env(safe-area-inset-right))] sm:py-4 sm:pl-[max(1.5rem,env(safe-area-inset-left))] sm:pr-[max(1.5rem,env(safe-area-inset-right))] [-webkit-overflow-scrolling:touch]">
          <ModulePersistenceNotice />
          {children}
        </main>
        {/* Aria is the patient companion for the mobile app, not the clinician web app */}
        <DemoToaster />
        <Toaster position="top-right" toastOptions={{ ariaProps: { role: 'status', 'aria-live': 'polite' } }} />
      </div>
    </div>
  );
}

