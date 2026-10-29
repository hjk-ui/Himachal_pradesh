import type { Metadata } from 'next';
import Link from 'next/link';
import { PartnerStrip } from '@/components/marketing/PartnerStrip';
import { GO_LIVE_COPY, MIGRATION_FROM, PRICING_TITLE } from '@/lib/marketing/homeContent';
import { PLAN_ORDER, SUBSCRIPTION_PLANS } from '@/lib/subscription/catalog';

export const metadata: Metadata = {
  title: { absolute: PRICING_TITLE },
  description:
    'Altrixs behavioral health EHR pricing for mental health and substance use clinics.',
};

export default function PricingPage() {
  return (
    <main className="min-h-[100dvh] bg-[#F8FAFC]">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="text-lg font-bold text-[#141C34]">
            Altrixs
          </Link>
          <Link
            href="/get-started"
            className="rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white hover:bg-[#141C34]"
          >
            Start free trial
          </Link>
        </div>
      </header>
      <PartnerStrip />
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#141C34] sm:text-3xl">
          Pricing for your behavioral health EHR
        </h1>
        <p className="mt-2 text-sm text-slate-600">{GO_LIVE_COPY}</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((key) => {
            const plan = SUBSCRIPTION_PLANS[key];
            return (
              <li
                key={key}
                className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs"
              >
                <p className="text-sm font-semibold text-[#141C34]">{plan.name}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-[#5C2D91]">
                  {plan.contactSales ? 'Contact sales' : `$${plan.monthly}/mo`}
                </p>
                <p className="mt-2 text-xs text-slate-500">{plan.tagline}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-8 text-sm text-slate-500">
          Migrating from <span className="font-medium text-slate-700">{MIGRATION_FROM}</span>.
        </p>
      </div>
    </main>
  );
}
