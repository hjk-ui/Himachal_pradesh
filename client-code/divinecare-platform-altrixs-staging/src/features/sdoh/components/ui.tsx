'use client';

import type { ReactNode } from 'react';
import {
  Banknote,
  BookOpen,
  Briefcase,
  Bus,
  Hammer,
  Home,
  Lightbulb,
  Medal,
  Phone,
  Rainbow,
  Scale,
  Shield,
  ShieldAlert,
  ShoppingBasket,
  Users,
} from 'lucide-react';
import type { AhcDomain } from '@/lib/sdoh/ahcHrsn';
import type { ResourceDomain } from '@/lib/sdoh/workflow';

const ICON: Record<AhcDomain | ResourceDomain, ReactNode> = {
  housing_instability: <Home size={16} />,
  housing_quality: <Hammer size={16} />,
  housing: <Home size={16} />,
  food: <ShoppingBasket size={16} />,
  transportation: <Bus size={16} />,
  utilities: <Lightbulb size={16} />,
  safety: <Shield size={16} />,
  financial_strain: <Banknote size={16} />,
  financial: <Banknote size={16} />,
  employment: <Briefcase size={16} />,
  family_support: <Users size={16} />,
  education: <BookOpen size={16} />,
  legal: <Scale size={16} />,
  domestic_violence: <ShieldAlert size={16} />,
  lgbtq: <Rainbow size={16} />,
  veterans: <Medal size={16} />,
  general: <Phone size={16} />,
};

export function DomainIcon({ domain }: { domain: AhcDomain | ResourceDomain }) {
  return <>{ICON[domain] ?? <Users size={16} />}</>;
}

export function Pill({ tone = 'slate', children }: { tone?: 'slate' | 'rose' | 'amber' | 'emerald' | 'brand' | 'sky'; children: ReactNode }) {
  const cls = {
    slate: 'bg-slate-100 text-slate-700',
    rose: 'bg-rose-50 text-rose-700',
    amber: 'bg-amber-50 text-amber-800',
    emerald: 'bg-emerald-50 text-emerald-700',
    brand: 'bg-[#5C2D91]/10 text-[#5C2D91]',
    sky: 'bg-sky-50 text-sky-700',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>{children}</span>;
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

export const inputCls =
  'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';
export const primaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4a2475] disabled:cursor-not-allowed disabled:opacity-50';
export const secondaryBtn =
  'inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50';
