'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Menu, X } from 'lucide-react';
import {
  ADD_ONS,
  FEATURE_COMPARISON,
  PLAN_ORDER,
  SUBSCRIPTION_PLANS,
  cliniciansLabel,
} from '@/lib/subscription/catalog';
import { PartnerStrip } from '@/components/marketing/PartnerStrip';

const IMG = {
  hero: 'https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=2400&q=85',
  scheduling:
    'https://images.unsplash.com/photo-1519494026892-80bbd2d6fd0d?auto=format&fit=crop&w=1800&q=80',
  clinical:
    'https://images.unsplash.com/photo-1631217868264-e5b90bb7e133?auto=format&fit=crop&w=1800&q=80',
  telehealth:
    'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1800&q=80',
  team: 'https://images.unsplash.com/photo-1559839734-2b71ea197ec2?auto=format&fit=crop&w=1800&q=80',
  billing:
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1800&q=80',
};

const modules = [
  {
    kicker: 'Front desk & admissions',
    title: 'Client intake, waitlists, and care coordination',
    body: 'Behavioral health workflows for admissions, digital intake, referrals, and ongoing client records - so front desk and clinicians share one source of truth.',
    image: IMG.scheduling,
    alt: 'Modern clinic reception supporting mental health practice management and client intake',
  },
  {
    kicker: 'Behavioral health EHR',
    title: 'Clinical documentation built for therapy practices',
    body: 'Progress notes, treatment plans, assessments, diagnoses, and session documentation designed for outpatient mental health and counseling teams.',
    image: IMG.clinical,
    alt: 'Clinician documenting care in a behavioral health EHR workspace',
  },
  {
    kicker: 'Scheduling & telehealth',
    title: 'Appointment scheduling software for clinics',
    body: 'Coordinate calendars, check-ins, no-shows, and telehealth visits without bouncing between spreadsheets, email, and disconnected booking tools.',
    image: IMG.telehealth,
    alt: 'Healthcare professional preparing a telehealth session for a counseling practice',
  },
  {
    kicker: 'Billing & operations',
    title: 'Practice management and revenue workflows',
    body: 'Connect clinical activity to billing operations, staff roles, and multi-location clinic management so leadership can see what frontline teams are running every day.',
    image: IMG.billing,
    alt: 'Practice administrator reviewing clinic operations and billing workflows',
  },
];

const audiences = [
  {
    title: 'Outpatient mental health clinics',
    body: 'Coordinate caseloads, locations, and documentation for counseling and therapy practices.',
  },
  {
    title: 'Behavioral health organizations',
    body: 'Give clinicians, front desk, billing, and directors role-aware access in one platform.',
  },
  {
    title: 'Growing multi-site practices',
    body: 'Run organization-scoped data with shared standards across every clinic location.',
  },
];

const faqs = [
  {
    q: 'What is Altrixs behavioral health software?',
    a: 'Altrixs is a behavioral health EHR with appointment scheduling, telehealth, staff role access, billing operations, and a Community and outreach CRM module for mental health and counseling practices.',
  },
  {
    q: 'Is Altrixs HIPAA compliant clinic software?',
    a: 'Altrixs is designed for HIPAA-ready clinic operations with organization-scoped data, role-based staff access, and secure authentication for authorized clinical and administrative users.',
  },
  {
    q: 'Who uses Altrixs practice management software?',
    a: 'Outpatient mental health clinics, counseling practices, behavioral health teams, front-desk staff, clinicians, billing specialists, and practice administrators use Altrixs to coordinate care operations in one workspace.',
  },
  {
    q: 'Does Altrixs include appointment scheduling and telehealth?',
    a: 'Yes. Altrixs includes clinic appointment scheduling, caseload visibility, and telehealth session workflows so front desk and clinicians can coordinate visits without disconnected tools.',
  },
  {
    q: 'What plans does Altrixs offer?',
    a: 'Altrixs offers Solo ($89/mo, 1 clinician), Practice ($219/mo for 2 clinicians, +$69 each additional), and Enterprise ($449/mo for 3 clinicians, +$89 each additional). Add-ons include DrFirst eRx, extra AI Scribe sessions, priority onboarding, and CARF survey prep.',
  },
];

export function HomePage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = [
    { href: '#platform', label: 'Platform' },
    { href: '#who-its-for', label: 'Solutions' },
    { href: '/pricing', label: 'Pricing' },
    { href: '#faq', label: 'FAQ' },
  ] as const;

  return (
    <div className="home-root text-[#141C34]" style={{ fontFamily: 'var(--font-clinic-sans)' }}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-[#141C34]"
      >
        Skip to content
      </a>

      <header className="absolute inset-x-0 top-0 z-40">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:px-8 sm:py-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/25 bg-white/60 px-3 py-3 shadow-[0_10px_40px_rgba(20,28,52,0.08)] backdrop-blur-md sm:px-4">
            <Link
              href="/"
              className="relative h-8 w-[108px] shrink-0 sm:h-10 sm:w-[160px]"
              aria-label="Altrixs home"
              onClick={() => setMobileNavOpen(false)}
            >
              <Image
                src="/altrixs-logo.png"
                alt="Altrixs behavioral health EHR"
                fill
                className="object-contain object-left"
                sizes="160px"
                priority
              />
            </Link>

            <div className="flex items-center gap-2 sm:gap-3">
              <nav className="hidden items-center gap-1.5 md:flex" aria-label="Primary">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-lg px-3 py-2 text-sm font-medium text-[#141C34]/90 transition hover:bg-white/70"
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#6868D0]/35 bg-white/85 px-4 py-2 text-sm font-semibold text-[#6868D0] backdrop-blur-sm transition hover:bg-white"
              >
                Sign in
              </Link>
              <Link
                href="/get-started"
                className="hidden min-h-11 items-center justify-center rounded-lg bg-[#6868D0] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#141C34] sm:inline-flex"
              >
                Get started
              </Link>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#6868D0]/20 bg-white/90 text-[#141C34] transition hover:bg-white md:hidden"
                aria-expanded={mobileNavOpen}
                aria-controls="mobile-nav"
                aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
                onClick={() => setMobileNavOpen((open) => !open)}
              >
                {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
              </button>
            </div>
          </div>

          <div id="mobile-nav" className={`md:hidden ${mobileNavOpen ? 'block' : 'hidden'}`}>
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_18px_50px_rgba(20,28,52,0.12)]">
              <nav className="flex flex-col gap-1" aria-label="Mobile primary">
                {navItems.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className="rounded-xl px-4 py-3 text-sm font-semibold text-[#141C34] transition hover:bg-slate-50"
                    onClick={() => setMobileNavOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </nav>
              <div className="mt-3 grid grid-cols-1 gap-2">
                <Link
                  href="/get-started"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#6868D0] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#141C34]"
                  onClick={() => setMobileNavOpen(false)}
                >
                  Get started
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#6868D0]/30 bg-white px-4 py-3 text-sm font-semibold text-[#6868D0] transition hover:border-[#6868D0]/50"
                  onClick={() => setMobileNavOpen(false)}
                >
                  Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main id="main">
        <section className="relative min-h-[92dvh] overflow-hidden lg:min-h-[100dvh]">
          <Image
            src={IMG.hero}
            alt="Clinician using behavioral health EHR and practice management software in a modern clinic"
            fill
            priority
            className="home-hero-media object-cover object-[68%_center] sm:object-[60%_center]"
            sizes="100vw"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-b from-[#F8FAFC]/96 via-[#F8FAFC]/86 to-[#F8FAFC]/96 sm:bg-gradient-to-r sm:from-[#F8FAFC] sm:via-[#F8FAFC]/92 sm:to-[#F8FAFC]/15"
          />
          <div
            aria-hidden
            className="home-hero-glow absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#6868D0]/15 blur-3xl"
          />

          <div className="relative z-10 mx-auto flex min-h-[92dvh] max-w-6xl flex-col justify-end px-4 pb-8 pt-28 sm:px-8 sm:pb-16 lg:justify-center lg:pb-24 lg:pt-24">
            <div className="max-w-2xl rounded-[1.75rem] border border-white/60 bg-white/80 p-5 shadow-[0_22px_70px_rgba(20,28,52,0.12)] backdrop-blur-md sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
              <p className="home-fade-up text-xs font-bold uppercase tracking-[0.22em] text-[#5C2D91] sm:text-sm">
                Behavioral health EHR
              </p>
              <p
                className="home-fade-up home-delay-1 mt-4 text-[2.9rem] font-bold tracking-tight text-[#141C34] sm:text-7xl md:text-8xl"
                style={{ fontFamily: 'var(--font-clinic-display)' }}
              >
                Altrixs
              </p>
              <h1 className="home-fade-up home-delay-2 mt-5 max-w-xl text-2xl font-semibold leading-tight text-[#141C34] sm:text-3xl md:text-[2.35rem] md:leading-tight">
                The behavioral health EHR with primary care, billing and practice operations built
                in.
              </h1>
              <p className="home-fade-up home-delay-2 mt-4 max-w-lg text-base font-medium leading-relaxed text-slate-600 sm:text-lg md:text-xl">
                One chart and one schedule for therapists, prescribers, program staff and the front
                desk. Write notes faster with an AI Scribe that checks its work, prescribe from the
                chart, and get claims paid.
              </p>
              <ul className="home-fade-up home-delay-2 mt-4 flex flex-wrap gap-2">
                {[
                  'AI Scribe in English and Spanish',
                  'E-prescribing with EPCS',
                  'Built-in telehealth',
                  'Claims, ERA and eligibility',
                  '42 CFR Part 2 controls',
                ].map((chip) => (
                  <li
                    key={chip}
                    className="rounded-full border border-slate-200 bg-white/90 px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    {chip}
                  </li>
                ))}
              </ul>
              <div className="home-fade-up home-delay-3 mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Link
                  href="/get-started"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-[#5C2D91] px-7 py-4 text-base font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#141C34] sm:w-auto"
                >
                  Start free trial
                </Link>
                <a
                  href="mailto:support@altrixs.com?subject=Altrixs%20demo%20request"
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[#5C2D91] bg-white/95 px-7 py-4 text-base font-bold text-[#5C2D91] backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white sm:w-auto"
                >
                  Request a demo
                </a>
              </div>
            </div>
          </div>
        </section>

        <PartnerStrip />

        <section
          id="who-its-for"
          className="border-t border-slate-200/80 bg-white px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">
              Who it&apos;s for
            </p>
            <h2
              id="why"
              className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Why Altrixs for mental health and substance use clinics
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Altrixs helps therapy practices and behavioral health teams replace disconnected tools
              with one behavioral health EHR workspace for admissions through documentation.
            </p>
            <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-3 sm:gap-6">
              {audiences.map((item) => (
                <li
                  key={item.title}
                  className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5 sm:border-0 sm:bg-transparent sm:p-0 sm:pt-6"
                >
                  <h3 className="text-lg font-bold text-[#141C34]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                    {item.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="platform" className="bg-[#F8FAFC]">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-8 sm:py-20">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6868D0]">
              All-in-one clinic platform
            </p>
            <h2
              className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Behavioral health EHR, scheduling, and billing workflows together
            </h2>
          </div>

          {modules.map((mod, index) => (
            <article
              key={mod.title}
              className={`border-t border-slate-200/80 ${index % 2 === 1 ? 'bg-white' : 'bg-[#F8FAFC]'}`}
            >
              <div
                className={`mx-auto grid max-w-6xl gap-6 px-4 py-14 sm:px-8 sm:py-20 lg:grid-cols-2 lg:items-center lg:gap-16 ${
                  index % 2 === 1 ? 'lg:[&>div:first-child]:order-2' : ''
                }`}
              >
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#6868D0]">
                    {mod.kicker}
                  </p>
                  <h3
                    className="mt-3 text-2xl font-bold tracking-tight text-[#141C34] sm:text-3xl"
                    style={{ fontFamily: 'var(--font-clinic-display)' }}
                  >
                    {mod.title}
                  </h3>
                  <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
                    {mod.body}
                  </p>
                </div>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[1.6rem] border border-slate-200 shadow-[0_18px_50px_rgba(20,28,52,0.08)] sm:aspect-[16/11]">
                  <Image
                    src={mod.image}
                    alt={mod.alt}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                </div>
              </div>
            </article>
          ))}
        </section>

        <section
          id="security"
          className="relative overflow-hidden bg-[#141C34] px-4 py-16 text-white sm:px-8 sm:py-24"
        >
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
            <div className="relative order-2 aspect-[4/3] overflow-hidden rounded-[1.6rem] lg:order-1">
              <Image
                src={IMG.team}
                alt="Trusted clinician representing HIPAA-ready behavioral health clinic software"
                fill
                className="object-cover object-top"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="order-1 lg:order-2">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#A3A5F0]">
                Security and privacy
              </p>
              <h2
                className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl"
                style={{ fontFamily: 'var(--font-clinic-display)' }}
              >
                HIPAA-ready access for every clinic role
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/85 sm:text-lg">
                Keep organization-scoped client data protected while giving clinicians, front desk,
                billing, HR, and directors the exact access they need - without tool sprawl.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-white/90 sm:text-[15px]">
                {[
                  'Role-based permissions for EHR and practice modules',
                  'Multi-location practice management with clear org boundaries',
                  'Secure staff authentication and invite-based onboarding',
                ].map((line) => (
                  <li key={line} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#8888E8]"
                    />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section
          id="pricing"
          className="border-t border-slate-200/80 bg-[#F8FAFC] px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6868D0]">
                Pricing
              </p>
              <h2
                className="mt-3 text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
                style={{ fontFamily: 'var(--font-clinic-display)' }}
              >
                Simple, transparent pricing for every practice size
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
                Everything you need to run a modern behavioral health practice — EHR, telehealth, AI
                scribe, billing, and CARF compliance — in one platform. No hidden fees.
              </p>
            </div>

            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              {PLAN_ORDER.map((id) => {
                const plan = SUBSCRIPTION_PLANS[id];
                const cta =
                  id === 'enterprise'
                    ? { href: '/get-started?plan=practice', label: 'Contact us' }
                    : { href: `/get-started?plan=${id}`, label: id === 'solo' ? 'Get started' : 'Start free trial' };
                return (
                  <article
                    key={id}
                    className={`relative flex flex-col rounded-2xl border bg-white p-5 shadow-sm ${
                      plan.popular ? 'border-teal-500 ring-1 ring-teal-500/30' : 'border-slate-200'
                    }`}
                  >
                    {plan.popular ? (
                      <p className="absolute inset-x-0 -top-3 mx-auto w-fit rounded-full bg-teal-600 px-3 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-white">
                        Most Popular
                      </p>
                    ) : null}
                    <p className="text-sm font-black uppercase tracking-[0.14em] text-slate-500">
                      {plan.name}
                    </p>
                    <p className="mt-2 text-4xl font-black tracking-tight text-[#141C34]">
                      ${plan.monthly}
                      <span className="text-sm font-semibold text-slate-500">/mo</span>
                    </p>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{cliniciansLabel(plan)}</p>
                    <p className="mt-3 text-sm leading-relaxed text-slate-600">{plan.tagline}</p>
                    <ul className="mt-4 space-y-2 text-sm text-slate-700">
                      {plan.features.map((line) => (
                        <li key={line} className="flex items-start gap-2">
                          <Check size={16} className="mt-0.5 shrink-0 text-[#6868D0]" aria-hidden />
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      href={cta.href}
                      className="mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-[#141C34] px-4 py-3 text-sm font-bold text-white transition hover:bg-[#6868D0]"
                    >
                      {cta.label}
                    </Link>
                  </article>
                );
              })}
            </div>

            <div className="mt-12">
              <h3 className="text-center text-lg font-black text-[#141C34]">Add-ons</h3>
              <p className="mt-1 text-center text-sm text-slate-500">
                Available on any plan. Optional extras — only pay for what you need.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {ADD_ONS.map((addon) => (
                  <div key={addon.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <p className="text-sm font-bold text-[#141C34]">{addon.name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-500">{addon.detail}</p>
                    <p className="mt-3 text-sm font-black text-[#6868D0]">{addon.price}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-12 overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Feature</th>
                    <th className="px-4 py-3 text-center">Solo · $89</th>
                    <th className="px-4 py-3 text-center">Practice · $219+</th>
                    <th className="px-4 py-3 text-center">Enterprise · $449+</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700">
                  {FEATURE_COMPARISON.map((row) => (
                    <tr key={row.feature} className="border-t border-slate-100">
                      <td className="px-4 py-3">
                        {row.group ? (
                          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">
                            {row.group}
                          </p>
                        ) : null}
                        <span className="font-semibold">{row.feature}</span>
                      </td>
                      <td className="px-4 py-3 text-center">{row.solo}</td>
                      <td className="px-4 py-3 text-center">{row.practice}</td>
                      <td className="px-4 py-3 text-center">{row.enterprise}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-6 text-center text-sm text-slate-500">
              Already on Altrixs?{' '}
              <Link href="/login" className="font-semibold text-[#6868D0] hover:underline">
                Sign in to manage your plan
              </Link>
            </p>
          </div>
        </section>

        <section id="faq" className="border-t border-slate-200/80 bg-white px-4 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#6868D0]">FAQ</p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Common questions about Altrixs clinic software
            </h2>
            <div className="mt-10 space-y-0">
              {faqs.map((item) => (
                <details
                  key={item.q}
                  className="group border-t border-slate-200 py-5 open:pb-6 last:border-b"
                >
                  <summary className="cursor-pointer list-none text-base font-semibold text-[#141C34] marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {item.q}
                      <span className="mt-0.5 text-[#6868D0] transition group-open:rotate-45">+</span>
                    </span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-[15px]">
                    {item.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contact" className="relative overflow-hidden bg-white px-4 py-16 sm:px-8 sm:py-24">
          <div
            aria-hidden
            className="home-cta-glow pointer-events-none absolute right-[-10%] top-0 h-64 w-64 rounded-full bg-[#6868D0]/12 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">
              See Altrixs with your own workflows
            </p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Bring your behavioral health practice onto one platform
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Sign in to the Altrixs staff portal for EHR, scheduling, and clinic operations -
              or get started if your organization is ready to go live.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <Link
                href="/get-started"
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#5C2D91] px-6 py-3.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#141C34]"
              >
                Get started
              </Link>
              <Link
                href="/login"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#5C2D91]/30 bg-white px-6 py-3.5 text-sm font-semibold text-[#5C2D91] transition hover:-translate-y-0.5 hover:border-[#5C2D91]/50"
              >
                Staff sign in
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-10 sm:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="relative h-8 w-32">
              <Image
                src="/altrixs-logo.png"
                alt="Altrixs"
                fill
                className="object-contain object-left"
                sizes="128px"
              />
            </div>
            <p className="mt-3 max-w-sm text-sm text-slate-500">
              Altrixs is a behavioral health EHR with integrated primary care, billing, telehealth
              and practice operations.
            </p>
          </div>
          <nav
            className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-slate-600"
            aria-label="Footer"
          >
            <a href="#platform" className="hover:text-[#5C2D91]">
              Platform
            </a>
            <a href="#who-its-for" className="hover:text-[#5C2D91]">
              Solutions
            </a>
            <Link href="/pricing" className="hover:text-[#5C2D91]">
              Pricing
            </Link>
            <a href="#why" className="hover:text-[#5C2D91]">
              Why
            </a>
            <a href="#security" className="hover:text-[#5C2D91]">
              Security
            </a>
            <a href="#faq" className="hover:text-[#5C2D91]">
              FAQ
            </a>
            <Link href="/privacy" className="hover:text-[#5C2D91]">
              Privacy
            </Link>
            <Link href="/support" className="hover:text-[#5C2D91]">
              Support
            </Link>
            <Link href="/legal/baa" className="hover:text-[#5C2D91]">
              BAA
            </Link>
            <Link href="/login" className="hover:text-[#5C2D91]">
              Staff sign in
            </Link>
          </nav>
          <p className="text-sm text-slate-500">
            &copy; {new Date().getFullYear()} Altrixs. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
