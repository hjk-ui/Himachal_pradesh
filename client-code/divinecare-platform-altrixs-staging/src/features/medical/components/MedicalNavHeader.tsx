'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Activity,
  Users,
  FileText,
  HeartPulse,
  ClipboardList,
  ShieldCheck,
  Send,
  FlaskConical,
  BookOpen,
  CreditCard,
  Settings,
  Sparkles,
  UserPlus,
} from 'lucide-react';
import { buttonClasses, PageHeader, StatusBadge } from '@/components/ui';

const MEDICAL_TABS = [
  { href: '/dashboard/medical', label: 'Overview', icon: Activity, exact: true },
  // Primary care patients list; rows open the one client chart (Medical tabs)
  { href: '/dashboard/medical/patients', label: 'Patients', icon: Users, exact: true },
  { href: '/dashboard/medical/visits', label: 'Visits & SOAP', icon: FileText },
  { href: '/dashboard/medical/vitals', label: 'Vitals', icon: HeartPulse },
  { href: '/dashboard/medical/problem-list', label: 'Problem List', icon: ClipboardList },
  { href: '/dashboard/medical/preventive-care', label: 'Preventive Care', icon: ShieldCheck },
  { href: '/dashboard/medical/referrals', label: 'Referrals & Imaging', icon: Send },
  { href: '/dashboard/medical/labs', label: 'Labs & Orders', icon: FlaskConical },
  { href: '/dashboard/medical/history', label: 'History Suite', icon: BookOpen },
  { href: '/dashboard/medical/billing', label: 'Medical RCM', icon: CreditCard },
  { href: '/dashboard/medical/payer-settings', label: 'Payer Settings', icon: Settings },
  { href: '/dashboard/medical/ai', label: 'Medical AI', icon: Sparkles },
];

export function MedicalNavHeader({
  title,
  subtitle,
  badge,
  actionButton,
}: {
  title?: string;
  subtitle?: string;
  badge?: string;
  actionButton?: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="mb-6">
      <PageHeader
        title={title || 'Medical Primary Care EHR'}
        badges={
          <>
            <StatusBadge tone="brand">{badge || 'Primary Care & Family Medicine'}</StatusBadge>
            <StatusBadge tone="success">HIPAA / Somatic EHR</StatusBadge>
          </>
        }
        description={
          subtitle ||
          'Family medicine clinical encounters, somatic problem lists, USPSTF preventive care gaps, diagnostic orders, and revenue cycle.'
        }
        actions={
          actionButton || (
            <>
              <Link href="/dashboard/medical/patients/intake" className={buttonClasses({ variant: 'secondary' })}>
                <UserPlus size={16} aria-hidden />
                Intake Wizard
              </Link>
              <Link href="/dashboard/medical/visits" className={buttonClasses()}>
                <FileText size={16} aria-hidden />
                New Encounter
              </Link>
            </>
          )
        }
      >
        {/* Section navigation (links, so it is a nav rather than a tablist) */}
        <nav aria-label="Primary care sections" className="clinic-scroll-x border-b border-slate-200">
          <div className="flex min-w-max gap-1">
            {MEDICAL_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = tab.exact
                ? pathname === tab.href
                : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    isActive
                      ? 'border-blue-600 text-blue-700'
                      : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900'
                  }`}
                >
                  <Icon size={16} aria-hidden />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </PageHeader>
    </div>
  );
}

export default MedicalNavHeader;

