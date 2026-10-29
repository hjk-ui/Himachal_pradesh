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

const MEDICAL_TABS = [
  { href: '/dashboard/medical', label: 'Overview', icon: Activity, exact: true },
  { href: '/dashboard/medical/patients', label: 'Patients', icon: Users },
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
    <div className="mb-6 space-y-4">
      {/* Top Banner */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-blue-100 bg-gradient-to-r from-blue-900 via-indigo-950 to-slate-900 p-6 text-white shadow-sm sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-semibold text-blue-300 ring-1 ring-blue-400/30">
              {badge || 'Primary Care & Family Medicine'}
            </span>
            <span className="inline-flex items-center rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">
              HIPAA / Somatic EHR
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white sm:text-3xl">
            {title || 'Medical Primary Care EHR'}
          </h1>
          <p className="mt-1 text-sm text-slate-300">
            {subtitle ||
              'Family medicine clinical encounters, somatic problem lists, USPSTF preventive care gaps, diagnostic orders, and revenue cycle.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actionButton || (
            <>
              <Link
                href="/dashboard/medical/patients/intake"
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/20 bg-white/10 px-3.5 py-2 text-sm font-semibold text-white shadow-sm backdrop-blur transition hover:bg-white/20"
              >
                <UserPlus size={16} />
                Intake Wizard
              </Link>
              <Link
                href="/dashboard/medical/visits"
                className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-600/30 transition hover:bg-blue-500"
              >
                <FileText size={16} />
                New Encounter
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Horizontal Scrollable Tabs */}
      <div className="flex overflow-x-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm scrollbar-none">
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
                className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                  isActive
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MedicalNavHeader;

