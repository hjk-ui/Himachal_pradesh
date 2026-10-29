import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { PricingSection } from '@/components/marketing/PricingSection';
import { PartnerStrip } from '@/components/marketing/PartnerStrip';
import { PARTNER_TRADEMARK_LINE } from '@/components/marketing/partners';
import { TRIAL_DAYS } from '@/lib/billing/plans';

export const metadata: Metadata = {
  title: { absolute: 'Pricing | Altrixs Behavioral Health EHR' },
  description: `Behavioral health EHR pricing per provider, by role. Front desk, billing and HR users are free. Compare Starter, Professional, Clinic and Enterprise, add-ons and a ${TRIAL_DAYS}-day free trial.`,
};

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href="/" className="relative block h-8 w-32">
            <Image src="/altrixs-logo.png" alt="Altrixs home" fill className="object-contain object-left" sizes="128px" priority />
          </Link>
          <div className="flex items-center gap-4 text-sm font-semibold">
            <Link href="/login" className="text-[#5C2D91] hover:underline">
              Staff sign in
            </Link>
            <Link href="/get-started" className="rounded-xl bg-[#5C2D91] px-3.5 py-2 text-white hover:opacity-95">
              Start free trial
            </Link>
          </div>
        </div>
      </header>
      <main className="px-4 py-12 sm:px-6 sm:py-16">
        <PricingSection headingLevel="h1" />
        <PartnerStrip className="mt-14 sm:mt-20" />
      </main>
      <footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-400 sm:px-6">
        {PARTNER_TRADEMARK_LINE}
      </footer>
    </div>
  );
}
