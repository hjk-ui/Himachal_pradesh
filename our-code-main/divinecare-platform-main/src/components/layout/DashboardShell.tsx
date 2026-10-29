'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { AnimatePresence, motion } from 'framer-motion';
import { useAuth } from '@/features/auth';
import { AccountMenu } from '@/components/layout/AccountMenu';
import { DashboardCommandSearch } from '@/components/layout/DashboardCommandSearch';
import { ModulePersistenceNotice } from '@/components/clinic/ModulePersistenceNotice';
import {
  canAccessPath,
  filterNavForRole,
} from '@/lib/auth/roleAccess';
import { DemoToaster } from '@/components/DemoActionProvider';
import type { StaffRole } from '@/types/roles';

type NavItem = {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  exact?: boolean;
  badge?: number;
};

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Home',
    items: [
      { href: '/dashboard', label: 'Dashboard', icon: 'home', exact: true },
      { href: '/dashboard/tasks', label: 'My To-Do', icon: 'check' },
      { href: '/dashboard/appointments?view=today', label: "Today's schedule", icon: 'calendar' },
    ],
  },
  {
    label: 'Inbox',
    items: [{ href: '/dashboard/inbox', label: 'Inbox', icon: 'bell' }],
  },
  {
    label: 'Schedule',
    items: [
      { href: '/dashboard/appointments', label: 'Calendar', icon: 'calendar' },
      { href: '/dashboard/clients/waitlist', label: 'Waitlist', icon: 'clock' },
      { href: '/dashboard/ehr/group-sessions', label: 'Group Therapy', icon: 'users' },
      { href: '/dashboard/ehr/assessments/sud', label: 'SUD Group Counseling', icon: 'flask' },
      { href: '/dashboard/telehealth', label: 'Telehealth', icon: 'video' },
      { href: '/dashboard/admin/scheduling-settings', label: 'Online booking settings', icon: 'calendarPlus' },
    ],
  },
  {
    label: 'Clients',
    items: [
      { href: '/dashboard/clients', label: 'Client list', icon: 'users' },
      { href: '/dashboard/clients/intake', label: 'New intake', icon: 'clipboard' },
      { href: '/dashboard/medical/patients', label: 'Primary care patients', icon: 'users' },
      { href: '/dashboard/medical/patients/intake', label: 'Primary care intake', icon: 'clipboard' },
      { href: '/dashboard/alerts', label: 'Risk Alerts', icon: 'bell' },
      { href: '/dashboard/messages', label: 'Messages', icon: 'chat' },
      { href: '/dashboard/ehr/notes', label: 'Progress Notes', icon: 'file' },
      { href: '/dashboard/ehr/treatment-plans', label: 'Treatment Plans', icon: 'clipboard' },
      { href: '/dashboard/ehr/evaluations', label: 'Evaluations', icon: 'clipboard' },
      { href: '/dashboard/ehr/assessments', label: 'Assessments', icon: 'chart' },
      { href: '/dashboard/ehr/assessments/cssrs', label: 'C-SSRS', icon: 'shieldAlert' },
      { href: '/dashboard/ehr/diagnoses', label: 'Diagnoses', icon: 'activity' },
      { href: '/dashboard/ehr/prescriptions', label: 'E-Prescribing', icon: 'pill' },
      { href: '/dashboard/ehr/consents', label: 'Consent Forms', icon: 'file' },
      { href: '/dashboard/ehr/safety-plan', label: 'Safety Planning', icon: 'shieldAlert' },
      { href: '/dashboard/ehr/discharge', label: 'Discharge Planning', icon: 'logout' },
      { href: '/dashboard/ehr/session-ai', label: 'AI Session Notes', icon: 'spark' },
      { href: '/dashboard/ehr/doc-intake', label: 'Smart Doc Intake', icon: 'file' },
      { href: '/dashboard/ehr/scanner', label: 'Service Eligibility Scanner', icon: 'activity' },
      { href: '/dashboard/ehr/labs', label: 'Lab Orders & Results', icon: 'flask' },
      { href: '/dashboard/ehr/eligibility', label: 'Eligibility', icon: 'shield' },
      { href: '/dashboard/ehr/prior-auths', label: 'Prior Authorizations', icon: 'shield' },
      { href: '/dashboard/ehr/locus', label: 'LOCUS / CALOCUS', icon: 'chart' },
      { href: '/dashboard/ehr/mandatory-reporting', label: 'Mandatory Reporting', icon: 'shieldAlert' },
      { href: '/dashboard/sdoh', label: 'SDOH Screening', icon: 'clipboard' },
      { href: '/dashboard/medical/visits', label: 'Visits & SOAP', icon: 'file' },
      { href: '/dashboard/medical/vitals', label: 'Vitals Flowsheet', icon: 'activity' },
      { href: '/dashboard/medical/problem-list', label: 'Problem List', icon: 'check' },
      { href: '/dashboard/medical/preventive-care', label: 'Preventive Care', icon: 'shield' },
      { href: '/dashboard/medical/history', label: 'Medical History', icon: 'book' },
      { href: '/dashboard/medical/referrals', label: 'Orders & Referrals', icon: 'spark' },
      { href: '/dashboard/medical/labs', label: 'Primary care labs', icon: 'flask' },
      { href: '/dashboard/medical/ai', label: 'Medical AI Suite', icon: 'spark' },
    ],
  },
  {
    label: 'Programs',
    items: [
      { href: '/dashboard/programs/intensive', label: 'Intensive programs', icon: 'activity' },
      { href: '/dashboard/prp', label: 'PRP Program', icon: 'grid' },
      { href: '/dashboard/prp/assessment', label: 'PRP Assessment', icon: 'clipboard' },
      { href: '/dashboard/prp/irp', label: 'Treatment Plan (IRP)', icon: 'file' },
      { href: '/dashboard/prp/referral', label: 'PRP Referral', icon: 'users' },
      { href: '/dashboard/prp/enroll', label: 'Enroll Client', icon: 'clipboard' },
      { href: '/dashboard/crisis', label: 'Mobile Crisis', icon: 'siren' },
      { href: '/dashboard/residential', label: 'Residential (ASAM 3.1/3.5)', icon: 'bed' },
      { href: '/dashboard/aot', label: 'AOT Court Program', icon: 'scale' },
      { href: '/dashboard/ehr/tms-spravato', label: 'TMS & Spravato', icon: 'activity' },
      { href: '/dashboard/community', label: 'Events & Outreach', icon: 'globe' },
      { href: '/dashboard/community/referrals', label: 'Referrals', icon: 'users' },
      { href: '/dashboard/peer-support', label: 'Peer Support', icon: 'users' },
      { href: '/dashboard/marketing', label: 'Marketing hub', icon: 'megaphone' },
      { href: '/dashboard/marketing/leads', label: 'Lead inbox', icon: 'chat' },
      { href: '/dashboard/pr', label: 'PR & Marketing', icon: 'megaphone' },
    ],
  },
  {
    label: 'Billing',
    items: [
      { href: '/dashboard/billing', label: 'Billing overview', icon: 'card' },
      { href: '/dashboard/billing/claims', label: 'Claims', icon: 'file' },
      { href: '/dashboard/billing/claim-scrubber', label: 'Claim Scrubber', icon: 'check' },
      { href: '/dashboard/coding', label: 'AI Coding', icon: 'card' },
      { href: '/dashboard/billing/superbills', label: 'Superbills', icon: 'file' },
      { href: '/dashboard/billing/payments', label: 'Payments & deposits', icon: 'card' },
      { href: '/dashboard/billing/ar-control', label: 'A/R Control Center', icon: 'card' },
      { href: '/dashboard/billing/denials', label: 'Denials', icon: 'bell' },
      { href: '/dashboard/billing/statements', label: 'eStatements', icon: 'file' },
      { href: '/dashboard/billing/autopay', label: 'AutoPay', icon: 'spark' },
      { href: '/dashboard/billing/prior-auth', label: 'Authorizations', icon: 'shield' },
      { href: '/dashboard/billing/panels', label: 'Insurance panels', icon: 'users' },
      { href: '/dashboard/billing/payer-settings', label: 'BH payer settings', icon: 'settings' },
      { href: '/dashboard/billing/residential-crisis', label: 'Residential & Crisis Billing', icon: 'card' },
      { href: '/dashboard/billing/provider-collections', label: 'Provider collections', icon: 'card' },
      { href: '/dashboard/billing/insurance-companies', label: 'Insurance companies', icon: 'users' },
      { href: '/dashboard/billing/valant-balances', label: 'Legacy balances', icon: 'file' },
      { href: '/dashboard/programs/intensive/billing', label: 'Intensive program charges', icon: 'card' },
      { href: '/dashboard/medical/billing', label: 'Medical billing', icon: 'card' },
      { href: '/dashboard/medical/payer-settings', label: 'Medical payer settings', icon: 'settings' },
    ],
  },
  {
    label: 'Reports',
    items: [
      { href: '/dashboard/reports', label: 'Report library', icon: 'chart' },
      { href: '/dashboard/analytics/schedule', label: 'Schedule analytics', icon: 'chart' },
      { href: '/dashboard/analytics/productivity', label: 'Doc productivity', icon: 'check' },
      { href: '/dashboard/analytics/surveys', label: 'Patient satisfaction', icon: 'chat' },
      { href: '/dashboard/population', label: 'Population health', icon: 'activity' },
      { href: '/dashboard/ai-insights', label: 'Clinical insights', icon: 'spark' },
      { href: '/dashboard/mbc/outcomes', label: 'Outcome measures', icon: 'chart' },
      { href: '/dashboard/mbc', label: 'Outcome schedules', icon: 'activity' },
      { href: '/dashboard/scribe', label: 'AI Scribe', icon: 'mic' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { href: '/onboarding', label: 'Practice setup', icon: 'settings' },
      { href: '/dashboard/enterprise', label: 'Locations & enterprise', icon: 'building' },
      { href: '/dashboard/admin', label: 'Admin & Compliance', icon: 'shield' },
      { href: '/dashboard/admin/audit', label: 'Audit log', icon: 'shield' },
      { href: '/dashboard/ehr/note-builder', label: 'Note builder', icon: 'file' },
      { href: '/dashboard/ehr/goal-bank', label: 'Goal bank', icon: 'book' },
      { href: '/dashboard/resources', label: 'Resource library', icon: 'book' },
      { href: '/dashboard/ehr/part2', label: '42 CFR Part 2', icon: 'lock' },
      { href: '/dashboard/protected-records', label: 'Protected records', icon: 'lock' },
      { href: '/dashboard/incidents', label: 'Incidents', icon: 'alert' },
      { href: '/dashboard/grievances', label: 'Grievances', icon: 'chat' },
      { href: '/dashboard/qi', label: 'Quality improvement', icon: 'trending' },
      { href: '/dashboard/compliance', label: 'Compliance calendar', icon: 'calendar' },
      { href: '/dashboard/hr', label: 'HR & Staff', icon: 'building' },
      { href: '/dashboard/hr/credentialing', label: 'Credentialing', icon: 'shield' },
      { href: '/dashboard/hr/supervision', label: 'Clinical Supervision Log', icon: 'clipboard' },
      { href: '/dashboard/hr/training', label: 'Training Hub', icon: 'grad' },
      { href: '/dashboard/hr/me', label: 'My HR', icon: 'users' },
      { href: '/dashboard/ehr/healthlake', label: 'Data exchange', icon: 'database' },
      { href: '/dashboard/admin/migration', label: 'Data import', icon: 'database' },
      { href: '/dashboard/subscription', label: 'Plan & subscription', icon: 'card' },
      { href: '/dashboard/projects', label: 'Projects', icon: 'check' },
      { href: '/dashboard/communications', label: 'Communications', icon: 'phone' },
      { href: '/dashboard/ehr/hie', label: 'CRISP HIE', icon: 'activity' },
      { href: '/dashboard/ehr/supervisor-review', label: 'Supervisor review', icon: 'check' },
      { href: '/dashboard/settings', label: 'Profile settings', icon: 'settings' },
    ],
  },
];

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

const BILLING_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/clients',
  '/dashboard/ehr/eligibility',
  '/dashboard/ehr/prior-auths',
  '/dashboard/ehr/part2',
  '/dashboard/coding',
  '/dashboard/billing',
  '/dashboard/billing/residential-crisis',
  '/dashboard/billing/payer-settings',
  '/dashboard/billing/ar-control',
  '/dashboard/billing/claim-scrubber',
  '/dashboard/billing/statements',
  '/dashboard/billing/denials',
  '/dashboard/billing/autopay',
  '/dashboard/billing/superbills',
  '/dashboard/billing/payments',
  '/dashboard/billing/provider-collections',
  '/dashboard/billing/insurance-companies',
  '/dashboard/billing/valant-balances',
  '/dashboard/programs/intensive/billing',
  '/dashboard/billing/panels',
  '/dashboard/inbox',
]);

const OFFICE_MANAGER_ALLOWED_HREFS = new Set([
  '/dashboard',
  '/dashboard/inbox',
  '/dashboard/appointments?view=today',
  '/dashboard/clients',
  '/dashboard/clients/waitlist',
  '/dashboard/clients/intake',
  '/dashboard/appointments',
  '/dashboard/messages',
  '/dashboard/communications',
  '/dashboard/ehr/consents',
  '/dashboard/ehr/eligibility',
  '/dashboard/ehr/hie',
  '/dashboard/ehr/prior-auths',
  '/dashboard/ehr/part2',
  '/dashboard/analytics/schedule',
  '/dashboard/analytics/productivity',
  '/dashboard/analytics/surveys',
  '/dashboard/reports',
  '/dashboard/resources',
  '/dashboard/qi',
  '/dashboard/incidents',
  '/dashboard/grievances',
  '/dashboard/compliance',
  '/dashboard/prp',
  '/dashboard/community',
  '/dashboard/community/referrals',
  '/dashboard/pr',
  '/dashboard/billing/payments',
  '/dashboard/billing/statements',
  '/dashboard/billing/autopay',
  '/dashboard/billing/prior-auth',
  '/dashboard/admin/scheduling-settings',
]);

import { useLocation } from '@/context/LocationContext';
import { SidebarLocationSwitcher } from '@/components/layout/SidebarLocationSwitcher';

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeLocationId, activeLocation, setActiveLocationId, locations, isAllLocations } = useLocation();
  const [locationSwitcherOpen, setLocationSwitcherOpen] = useState(false);

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
    if (!canAccessPath(user.role, pathname)) {
      if (pathname !== '/dashboard') router.replace('/dashboard');
    }
  }, [loading, user, pathname, router]);

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

  if (loading || !user) {
    return (
      <div className="min-h-[100dvh] bg-slate-50">
        <p className="px-6 pt-4 text-sm font-semibold text-slate-800">Altrixs {process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0'}</p>
        {loading ? <p className="px-6 py-4 text-sm font-medium text-slate-600">Loading Altrixs&hellip;</p> : null}
        {children}
      </div>
    );
  }

  const roleStr = String(user.role || '').toLowerCase();
  const isBillingRole = user.role === 'BILLING' || roleStr === 'billing_specialist';
  const isOfficeRole = user.role === 'OFFICE_MANAGER' || roleStr === 'office_manager';
  const isMedicalProvider =
    user.role === 'PHYSICIAN' ||
    user.role === 'MEDICAL_NP' ||
    roleStr === 'physician' ||
    roleStr === 'medical_np';

  const baseNav = filterNavForRole(NAV_SECTIONS, user.role);

  const rawNavSections = baseNav
    .map((section) => {
      const label = section.label;
      let items = section.items;

      if (isMedicalProvider) {
        const allowed = new Set([
          '/dashboard',
          '/dashboard/tasks',
          '/dashboard/inbox',
          '/dashboard/appointments',
          '/dashboard/appointments?view=today',
          '/dashboard/telehealth',
          '/dashboard/communications',
          '/dashboard/billing/superbills',
          '/dashboard/billing/autopay',
          '/dashboard/billing/payments',
          '/dashboard/incidents',
          '/dashboard/settings',
        ]);
        items = items.filter(
          (item) => allowed.has(item.href) || item.href.startsWith('/dashboard/medical')
        );
      } else if (
        user.role === 'THERAPIST' ||
        user.role === 'PEER_SUPPORT' ||
        user.role === 'CASE_MANAGER' ||
        user.role === 'FRONT_DESK'
      ) {
        items = items.filter((item) => !item.href.startsWith('/dashboard/medical'));
      }

      if (isBillingRole) {
        items = items.filter((item) => BILLING_ALLOWED_HREFS.has(item.href));
      } else if (isOfficeRole) {
        items = items.filter((item) => OFFICE_MANAGER_ALLOWED_HREFS.has(item.href));
      } else if (user.role === 'HR') {
        items = items
          .filter(
            (item) =>
              !(
                section.label === 'Admin' &&
                item.href === '/dashboard/hr'
              )
          )
          .map((item) =>
            item.href === '/dashboard' ? { ...item, href: '/dashboard/hr' } : item
          );
      }

      return {
        ...section,
        label,
        items,
      };
    })
    .filter((section) => section.items.length > 0);

  // Merge sections that share the same label (e.g. Programs + Community for Office Manager) to ensure unique keys
  const navSections: typeof rawNavSections = [];
  for (const s of rawNavSections) {
    const existing = navSections.find((x) => x.label === s.label);
    if (existing) {
      const existingHrefs = new Set(existing.items.map((i) => i.href));
      const newItems = s.items.filter((i) => !existingHrefs.has(i.href));
      existing.items = [...existing.items, ...newItems];
    } else {
      navSections.push({ ...s, items: [...s.items] });
    }
  }

  const activeNavHref = navSections
    .flatMap((section) => section.items)
    .filter((item) =>
      item.exact
        ? pathname === item.href
        : pathname === item.href || pathname.startsWith(`${item.href}/`)
    )
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const handleLogout = async () => {
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
            href="/dashboard"
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
                  alt="Altrixs behavioral health EHR and clinic CRM"
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
                {collapsed ? <PanelExpandIcon /> : <PanelCollapseIcon />}
              </button>
            )}
            {isMobile && (
              <button
                type="button"
                onClick={() => setSidebarOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 text-slate-300 hover:bg-white/5"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            )}
          </div>
        </div>

        <div className={`mb-3 h-px shrink-0 bg-white/10 ${collapsed && !isMobile ? 'mx-2' : 'mx-4'}`} />

        {/* Sidebar Location Switcher below Logo */}
        {!(collapsed && !isMobile) && <SidebarLocationSwitcher />}

        <nav
          className={`min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden overscroll-y-contain pb-4 [-webkit-overflow-scrolling:touch] ${
            collapsed && !isMobile ? 'px-2' : 'px-3'
          }`}
        >
          {navSections.map((section) => (
            <div key={section.label}>
              {!(collapsed && !isMobile) && (
                <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300/80">
                  {section.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {section.items.map((item) => {
                  const active = activeNavHref === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setSidebarOpen(false)}
                        title={item.label}
                        className={`group relative flex min-h-11 items-center rounded-lg text-[13px] font-medium transition
                          ${collapsed && !isMobile ? 'justify-center px-2 py-2' : 'gap-2.5 px-3 py-2.5'}
                          focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#141C34]
                          ${
                            active
                              ? 'bg-white text-[#141C34] shadow-[0_14px_30px_rgba(0,0,0,0.22)] ring-1 ring-white/10'
                              : 'text-slate-300 hover:bg-white/5 hover:text-white'
                          }`}
                      >
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition
                            ${active ? 'text-[#6868D0]' : 'text-slate-400 group-hover:text-slate-200'}`}
                        >
                          <NavIcon name={item.icon} />
                        </span>
                        {!(collapsed && !isMobile) && (
                          <>
                            <span className="flex-1 truncate">{item.label}</span>
                            {item.badge ? (
                              <span
                                className={`ml-auto flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold
                                  ${active ? 'bg-[#6868D0]/10 text-[#6868D0]' : 'bg-blue-600 text-white'}`}
                              >
                                {item.badge}
                              </span>
                            ) : null}
                          </>
                        )}
                        {collapsed && !isMobile && item.badge ? (
                          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-400" />
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div
          className={`mt-auto shrink-0 space-y-2 border-t border-white/10 ${
            collapsed && !isMobile ? 'p-2' : 'p-3 sm:p-4'
          }`}
        >
          <AccountMenu
            collapsed={Boolean(collapsed && !isMobile)}
            onNavigate={() => setSidebarOpen(false)}
            onSignOut={handleLogout}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] w-full min-w-0 overflow-hidden bg-slate-50">
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
        <header className="z-30 flex shrink-0 items-center gap-2 border-b border-slate-200/80 bg-white/90 px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-md print:hidden sm:gap-3 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 active:scale-95"
            aria-label="Open menu"
            aria-expanded={sidebarOpen}
            aria-controls="dashboard-mobile-sidebar"
          >
            <MenuIcon />
          </button>

          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50 lg:flex"
            aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {sidebarCollapsed ? <PanelExpandIcon /> : <PanelCollapseIcon />}
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-slate-500">
              {pageTitle(pathname)}
              <span className="hidden text-slate-300 sm:inline">&middot;</span>
              <span className="hidden sm:inline">Altrixs</span>
            </p>
          </div>

          <DashboardCommandSearch
            role={user?.role as StaffRole | null}
            navItems={NAV_SECTIONS.flatMap((section) =>
              section.items.map((item) => ({
                href: item.href,
                label: item.label,
                section: section.label,
              }))
            )}
          />

          {/* MD Behavioral Health Header Location Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setLocationSwitcherOpen((o) => !o)}
              className="flex items-center gap-1.5 sm:gap-2 rounded-xl border border-slate-200 bg-white px-2 sm:px-2.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:border-slate-300 transition-all cursor-pointer"
              title="MD Behavioral Health Location"
            >
              <div
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white shadow-xs"
                style={{ backgroundColor: activeLocation ? activeLocation.brandColor : '#1E293B' }}
              >
                {activeLocation ? activeLocation.shortCode : 'AL'}
              </div>
              <span className="hidden md:inline truncate max-w-[130px]">
                {activeLocation ? activeLocation.name : 'All Locations'}
              </span>
              {activeLocation?.isFlagship && (
                <span className="hidden lg:inline text-[9px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 font-semibold">
                  Flagship
                </span>
              )}
              <svg className={`h-3 w-3 text-slate-400 transition-transform ${locationSwitcherOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {locationSwitcherOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl z-50 animate-in fade-in zoom-in-95">
                <p className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  MD Behavioral Health — Sites
                </p>
                {/* All Locations */}
                <button
                  type="button"
                  onClick={() => {
                    setActiveLocationId('all');
                    setLocationSwitcherOpen(false);
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                    isAllLocations ? 'bg-indigo-50 font-bold text-indigo-950' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white bg-slate-800">
                    ALL
                  </div>
                  <div className="flex-1 truncate">
                    <p className="truncate font-semibold">All Locations</p>
                    <p className="text-[10px] text-slate-400 font-normal">Practice-wide aggregate view</p>
                  </div>
                  {isAllLocations && <div className="h-1.5 w-1.5 rounded-full bg-indigo-600" />}
                </button>

                <div className="border-t border-slate-100 my-1" />

                {/* 4 Locations */}
                {locations.map((loc) => {
                  const isSelected = activeLocationId === loc.id;
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setActiveLocationId(loc.id);
                        setLocationSwitcherOpen(false);
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer ${
                        isSelected ? 'bg-indigo-50 font-bold text-indigo-950' : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold text-white"
                        style={{ backgroundColor: loc.brandColor }}
                      >
                        {loc.shortCode}
                      </div>
                      <div className="flex-1 truncate">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate font-semibold">{loc.name}</p>
                          {loc.isFlagship && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-50 text-indigo-600 font-semibold">Flagship</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 font-normal">{loc.specialtyType}</p>
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
            href="/dashboard/settings"
            className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#6868D0] text-xs font-semibold text-white"
            aria-label="Profile settings"
          >
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.image} alt="" className="h-full w-full object-cover" />
            ) : (
              initials
            )}
          </Link>
        </header>

        <main className="dashboard-shell-main min-h-0 w-full min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-4 [-webkit-overflow-scrolling:touch]">
          <ModulePersistenceNotice />
          {children}
        </main>
        <DemoToaster />
      </div>
    </div>
  );
}

function pageTitle(pathname: string) {
  if (pathname === '/dashboard') return 'Dashboard';
  const map: Record<string, string> = {
    '/dashboard/tasks': 'My To-Do',
    '/dashboard/clients/waitlist': 'Waitlist',
    '/dashboard/clients/intake': 'Digital Intake',
    '/dashboard/clients': 'Clients',
    '/dashboard/alerts': 'Risk Alerts',
    '/dashboard/appointments': 'Appointments',
    '/dashboard/messages': 'Messages',
    '/dashboard/communications': 'Communications',
    '/dashboard/telehealth': 'Telehealth',
    '/dashboard/notifications': 'Push Notifications',
    '/dashboard/ehr/notes': 'Progress Notes',
    '/dashboard/ehr/scanner': 'Service Eligibility Scanner',
    '/dashboard/ehr/tms-spravato': 'TMS & Spravato',
    '/dashboard/ehr/labs': 'Lab Orders & Results',
    '/dashboard/ehr/healthlake': 'HealthLake FHIR R4',
    '/dashboard/ehr/treatment-plans': 'Treatment Plans',
    '/dashboard/ehr/assessments/sud': 'SUD Screeners & Referral Alerts',
    '/dashboard/ehr/assessments/cssrs': 'C-SSRS (Suicide Scale)',
    '/dashboard/ehr/assessments': 'Assessments',
    '/dashboard/ehr/diagnoses': 'Diagnoses',
    '/dashboard/ehr/prescriptions': 'E-Prescribing',
    '/dashboard/ehr/consents': 'Consent Forms',
    '/dashboard/ehr/eligibility': 'Eligibility',
    '/dashboard/ehr/hie': 'CRISP HIE',
    '/dashboard/ehr/prior-auths': 'Prior Authorizations',
    '/dashboard/ehr/safety-plan': 'Safety Planning',
    '/dashboard/ehr/discharge': 'Discharge Planning',
    '/dashboard/ehr/group-sessions': 'Group Sessions',
    '/dashboard/ehr/session-ai': 'AI Session Notes',
    '/dashboard/ehr/supervisor-review': 'Supervisor Review',
    '/dashboard/ehr/note-builder': 'Note Builder',
    '/dashboard/ehr/goal-bank': 'Goal Bank',
    '/dashboard/ehr/part2': '42 CFR Part 2',
    '/dashboard/ehr': 'EHR Overview',
    '/dashboard/mbc/outcomes': 'Outcome Measures',
    '/dashboard/mbc': 'MBC Automation',
    '/dashboard/scribe': 'AI Scribe',
    '/dashboard/ai-insights': 'AI Insights',
    '/dashboard/coding': 'AI Coding',
    '/dashboard/analytics/schedule': 'Schedule Analytics',
    '/dashboard/analytics/productivity': 'Doc Productivity',
    '/dashboard/analytics/surveys': 'Patient Satisfaction',
    '/dashboard/reports': 'Outcomes & Reports',
    '/dashboard/population': 'Population Health',
    '/dashboard/sdoh': 'SDOH Screening',
    '/dashboard/resources': 'Resource Library',
    '/dashboard/qi': 'Quality Improvement',
    '/dashboard/incidents': 'Incident Reports',
    '/dashboard/grievances': 'Grievances & Rights',
    '/dashboard/compliance': 'Compliance Calendar',
    '/dashboard/peer-support': 'Peer Support',
    '/dashboard/programs/intensive': 'Intensive programs',
    '/dashboard/prp': 'PRP Program',
    '/dashboard/enterprise': 'Enterprise',
    '/dashboard/crisis': 'Mobile Crisis Team',
    '/dashboard/residential': 'Residential (ASAM 3.1/3.5)',
    '/dashboard/aot': 'AOT Court Program',
    '/dashboard/billing/residential-crisis': 'Residential & Crisis Billing',
    '/dashboard/billing/payer-settings': 'BH Payer Settings',
    '/dashboard/billing/denials': 'Denial Management',
    '/dashboard/billing/claims': 'Claims',
    '/dashboard/billing/autopay': 'AutoPay',
    '/dashboard/billing/superbills': 'Superbills',
    '/dashboard/billing/payments': 'Payments',
    '/dashboard/billing/provider-collections': 'Provider collections',
    '/dashboard/billing/insurance-companies': 'Insurance companies',
    '/dashboard/billing/valant-balances': 'Legacy balances',
    '/dashboard/programs/intensive/billing': 'Intensive program charges',
    '/dashboard/billing/panels': 'Insurance Panels',
    '/dashboard/billing': 'Billing',
    '/dashboard/hr/credentialing': 'Credentialing',
    '/dashboard/hr/supervision': 'Clinical Supervision Log',
    '/dashboard/hr/training': 'Training Hub',
    '/dashboard/hr/me': 'My HR',
    '/dashboard/hr/people': 'People',
    '/dashboard/hr': 'HR dashboard',
    '/dashboard/marketing/leads': 'Lead inbox',
    '/dashboard/marketing': 'Growth & Marketing',
    '/dashboard/admin': 'Admin & Compliance',
    '/dashboard/subscription': 'Plan & Subscription',
    '/dashboard/practice-setup': 'Practice Setup',
    '/onboarding': 'Practice Setup',
    '/dashboard/prp/referral': 'PRP Referral',
    '/dashboard/prp/enroll': 'Enroll Client',
    '/dashboard/ehr/mandatory-reporting': 'Mandatory Reporting',
    '/dashboard/compliance/mandatory-reporting': 'Mandatory Reporting',
    '/dashboard/settings': 'Profile settings',
    '/dashboard/community/referrals': 'Referral Tracking',
    '/dashboard/community': 'Events & Outreach',
    '/dashboard/pr': 'PR & Marketing',
  };
  const hit = Object.keys(map)
    .sort((a, b) => b.length - a.length)
    .find((k) => pathname === k || pathname.startsWith(`${k}/`));
  return hit ? map[hit] : 'Altrixs';
}

const ICONS = {
  siren: (
    <>
      <path d="M7 12a5 5 0 0 1 10 0v3H7v-3Z" />
      <path d="M5 15h14v2H5v-2ZM12 4v3M4.9 7.9l2.1 2.1M19.1 7.9l-2.1 2.1" />
    </>
  ),
  bed: (
    <>
      <path d="M3 7v11M21 11v7M3 14h18M3 11a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v3H3v-3Z" />
      <circle cx="7" cy="11" r="1.5" />
    </>
  ),
  scale: (
    <>
      <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM2 16l3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1ZM7 21h10M12 3v18M3 7h18" />
    </>
  ),
  home: (
    <path d="M3.5 8.5 10 3l6.5 5.5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V8.5Z" />
  ),
  users: (
    <>
      <circle cx="7.5" cy="8" r="2.2" />
      <circle cx="12.8" cy="8.5" r="2" />
      <path d="M3.5 15.5c.6-2.2 2.2-3.3 4-3.3s3.4 1.1 4 3.3" />
      <path d="M11 12.4c.9-.4 1.9-.5 2.9-.3 1.5.3 2.7 1.3 3.2 3.4" />
    </>
  ),
  bell: (
    <>
      <path d="M12.5 15.5a2.5 2.5 0 0 1-5 0" />
      <path d="M4.5 13.5h11l-1.2-1.5V8.8a4.3 4.3 0 1 0-8.6 0v3.2L4.5 13.5Z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="13" height="12" rx="2" />
      <path d="M3.5 9h13M7 3.5v3M13 3.5v3" />
    </>
  ),
  chat: (
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h7A2.5 2.5 0 0 1 16 5.5v6A2.5 2.5 0 0 1 13.5 14H9l-3.5 2.5V14H6.5A2.5 2.5 0 0 1 4 11.5v-6Z" />
  ),
  phone: (
    <path d="M5.2 3.8c.5-.5 1.3-.5 1.8 0l1.4 1.4c.5.5.5 1.3 0 1.8l-.8.8a10.5 10.5 0 0 0 4.6 4.6l.8-.8c.5-.5 1.3-.5 1.8 0l1.4 1.4c.5.5.5 1.3 0 1.8l-.9.9c-.5.5-1.2.7-1.9.5A13.8 13.8 0 0 1 3.8 6.6c-.2-.7 0-1.4.5-1.9l.9-.9Z" />
  ),
  video: (
    <>
      <rect x="3" y="5.5" width="9.5" height="9" rx="2" />
      <path d="M12.5 8.5 17 6v8l-4.5-2.5V8.5Z" />
    </>
  ),
  spark: (
    <path d="M10 2.5 11.4 7.2 16 8.5l-4.6 1.3L10 14.5 8.6 9.8 4 8.5l4.6-1.3L10 2.5Z" />
  ),
  chart: (
    <>
      <path d="M3.5 16.5h13" />
      <path d="M5.5 13V8.5M10 13V5.5M14.5 13V9.5" />
    </>
  ),
  book: (
    <path d="M4 4.5h5.2A2.3 2.3 0 0 1 11.5 6.8V16A1.8 1.8 0 0 0 9.7 14.2H4V4.5Zm12 0H10.8A2.3 2.3 0 0 0 8.5 6.8V16A1.8 1.8 0 0 1 10.3 14.2H16V4.5Z" />
  ),
  grid: (
    <>
      <rect x="3.5" y="3.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="3.5" width="5.5" height="5.5" rx="1.2" />
      <rect x="3.5" y="11" width="5.5" height="5.5" rx="1.2" />
      <rect x="11" y="11" width="5.5" height="5.5" rx="1.2" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5" width="14" height="10" rx="2" />
      <path d="M3 9h14" />
    </>
  ),
  building: (
    <>
      <path d="M4 16.5V5.5A1.5 1.5 0 0 1 5.5 4h6A1.5 1.5 0 0 1 13 5.5V16.5" />
      <path d="M13 8.5h2.5A1.5 1.5 0 0 1 17 10v6.5" />
      <path d="M3 16.5h14" />
    </>
  ),
  shield: <path d="M10 2.5 15.5 5v4.5c0 3.4-2.2 5.9-5.5 7.2C6.7 15.4 4.5 12.9 4.5 9.5V5L10 2.5Z" />,
  settings: (
    <>
      <circle cx="10" cy="10" r="2.4" />
      <path d="M10 3.2v1.8M10 15v1.8M3.2 10h1.8M15 10h1.8M5.2 5.2l1.3 1.3M13.5 13.5l1.3 1.3M14.8 5.2l-1.3 1.3M6.5 13.5l-1.3 1.3" />
    </>
  ),
  globe: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M3.5 10h13M10 3.5c2 2.2 2 10.8 0 13M10 3.5c-2 2.2-2 10.8 0 13" />
    </>
  ),
  megaphone: (
    <path d="M14.5 5.5 5 8.5v3l9.5 3V5.5ZM5 9v5.5l2.2-.8M12.5 14.8c0 1.4-.8 2.5-1.8 2.5" />
  ),
  check: (
    <>
      <rect x="4" y="3.5" width="12" height="13" rx="2" />
      <path d="M7 10.2 9 12.2 13.2 7.8" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.5" />
      <path d="M10 6.5V10l2.5 2" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4.5" width="10" height="12" rx="1.5" />
      <path d="M7.5 4.5h5v2h-5v-2Z" />
      <path d="M7.5 10h5M7.5 13h4" />
    </>
  ),
  activity: <path d="M3.5 10h3l2-4.5 3 9 2-4.5h3" />,
  file: (
    <>
      <path d="M6 3.5h5.5L15 7v9.5A1.5 1.5 0 0 1 13.5 18h-7A1.5 1.5 0 0 1 5 16.5v-11A2 2 0 0 1 6 3.5Z" />
      <path d="M11.5 3.5V7H15" />
    </>
  ),
  pill: (
    <>
      <rect x="4" y="7.5" width="12" height="5" rx="2.5" transform="rotate(-35 10 10)" />
      <path d="M8.2 8.2 11.8 11.8" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="9" width="10" height="7.5" rx="1.5" />
      <path d="M7 9V7a3 3 0 0 1 6 0v2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="10" cy="5.5" rx="5.5" ry="2" />
      <path d="M4.5 5.5v9c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2v-9" />
      <path d="M4.5 10c0 1.1 2.5 2 5.5 2s5.5-.9 5.5-2" />
    </>
  ),
  flask: (
    <>
      <path d="M8 3.5h4M9 3.5v5.2L5.8 14.5A2.2 2.2 0 0 0 7.7 17.5h4.6a2.2 2.2 0 0 0 1.9-3L11 8.7V3.5" />
      <path d="M7.2 12.5h5.6" />
    </>
  ),
  calendarPlus: (
    <>
      <rect x="3.5" y="5" width="13" height="12" rx="2" />
      <path d="M3.5 9h13M7 3.5v3M13 3.5v3M10 12v3.5M8.25 13.75h3.5" />
    </>
  ),
  mic: (
    <>
      <rect x="8" y="3.5" width="4" height="8" rx="2" />
      <path d="M5.5 10a4.5 4.5 0 0 0 9 0M10 14.5V17" />
    </>
  ),
  shieldAlert: (
    <>
      <path d="M10 2.5 15.5 5v4.5c0 3.4-2.2 5.9-5.5 7.2C6.7 15.4 4.5 12.9 4.5 9.5V5L10 2.5Z" />
      <path d="M10 7.5v3M10 13h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M8 3.5H5.5A2 2 0 0 0 3.5 5.5v9A2 2 0 0 0 5.5 16.5H8" />
      <path d="M11 10h5.5M14 7l3 3-3 3" />
    </>
  ),
  trending: (
    <>
      <path d="M3.5 14.5 8 10l3 3 5.5-6.5" />
      <path d="M13 6.5h3.5V10" />
    </>
  ),
  alert: (
    <>
      <path d="M10 3.5 17 16H3L10 3.5Z" />
      <path d="M10 8.5v3M10 13.5h.01" />
    </>
  ),
  grad: (
    <>
      <path d="M3.5 8.5 10 5l6.5 3.5L10 12 3.5 8.5Z" />
      <path d="M6.5 10.2v3.3c0 .8 1.6 2 3.5 2s3.5-1.2 3.5-2v-3.3" />
      <path d="M16.5 8.5v5" />
    </>
  ),
};

function NavIcon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="none" aria-hidden>
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[name]}
      </g>
    </svg>
  );
}

function PanelCollapseIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3.5 4.5h13v11h-13v-11ZM8 4.5v11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11.5 8 9 10l2.5 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PanelExpandIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M3.5 4.5h13v11h-13v-11ZM8 4.5v11"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 8l2.5 2L10 12"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M3.5 6h13M3.5 10h13M3.5 14h13" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M5 5l10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

