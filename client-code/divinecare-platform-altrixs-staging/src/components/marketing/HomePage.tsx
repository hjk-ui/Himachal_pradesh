'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { Check, Menu, ShieldCheck, X } from 'lucide-react';
import { PricingSection } from './PricingSection';
import { PartnerStrip } from './PartnerStrip';
import { PARTNER_TRADEMARK_LINE } from './partners';
import {
  AUDIENCES,
  DEMO_REQUEST_HREF,
  DIFFERENTIATORS,
  GO_LIVE_TIMELINE,
  HERO,
  HOME_FAQS,
  MODULES,
  MORE_MODULES,
  SECURITY_POINTS,
} from './homeContent';

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

export function HomePage() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const navItems = [
    { href: '#platform', label: 'Platform' },
    { href: '#who-its-for', label: 'Solutions' },
    { href: '#pricing', label: 'Pricing' },
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
                className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#5C2D91]/35 bg-white/85 px-4 py-2 text-sm font-semibold text-[#5C2D91] backdrop-blur-sm transition hover:bg-white"
              >
                Sign in
              </Link>
              <Link
                href="/get-started"
                className="hidden min-h-11 items-center justify-center rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#141C34] sm:inline-flex"
              >
                Get started
              </Link>
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#5C2D91]/20 bg-white/90 text-[#141C34] transition hover:bg-white md:hidden"
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
                  className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#5C2D91] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#141C34]"
                  onClick={() => setMobileNavOpen(false)}
                >
                  Get started
                </Link>
                <Link
                  href="/login"
                  className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#5C2D91]/30 bg-white px-4 py-3 text-sm font-semibold text-[#5C2D91] transition hover:border-[#5C2D91]/50"
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
            alt="Clinician using the Altrixs behavioral health EHR in a clinic"
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
            className="home-hero-glow absolute -left-24 top-20 h-72 w-72 rounded-full bg-[#5C2D91]/15 blur-3xl"
          />

          <div className="relative z-10 mx-auto flex min-h-[92dvh] max-w-6xl flex-col justify-end px-4 pb-8 pt-28 sm:px-8 sm:pb-16 lg:justify-center lg:pb-24 lg:pt-24">
            <div className="max-w-2xl rounded-[1.75rem] border border-white/60 bg-white/80 p-5 shadow-[0_22px_70px_rgba(20,28,52,0.12)] backdrop-blur-md sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none">
              <p className="home-fade-up text-xs font-bold uppercase tracking-[0.22em] text-[#5C2D91] sm:text-sm">
                {HERO.kicker}
              </p>
              <p
                className="home-fade-up home-delay-1 mt-4 text-[2.9rem] font-bold tracking-tight text-[#141C34] sm:text-7xl md:text-8xl"
                style={{ fontFamily: 'var(--font-clinic-display)' }}
              >
                Altrixs
              </p>
              <h1 className="home-fade-up home-delay-2 mt-5 max-w-xl text-2xl font-semibold leading-tight text-[#141C34] sm:text-3xl md:text-[2.35rem] md:leading-tight">
                {HERO.headline}
              </h1>
              <p className="home-fade-up home-delay-2 mt-4 max-w-lg text-base font-medium leading-relaxed text-slate-600 sm:text-lg md:text-xl">
                {HERO.subhead}
              </p>
              <ul className="home-fade-up home-delay-2 mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm font-semibold text-[#141C34]/85">
                {HERO.proof.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check size={16} className="shrink-0 text-[#5C2D91]" aria-hidden />
                    {item}
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
                  href={DEMO_REQUEST_HREF}
                  className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-[#5C2D91] bg-white/95 px-7 py-4 text-base font-bold text-[#5C2D91] backdrop-blur-sm transition hover:-translate-y-0.5 hover:bg-white sm:w-auto"
                >
                  Request a demo
                </a>
              </div>
            </div>
          </div>
        </section>

        <PartnerStrip className="border-t border-slate-200/80 bg-[#F8FAFC] px-4 py-10 sm:px-8 sm:py-12" />

        <section
          id="who-its-for"
          className="border-t border-slate-200/80 bg-white px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">
              Who it&apos;s for
            </p>
            <h2
              className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Built for behavioral health organizations of every size
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              From a solo therapist to a multi-site organization with psychiatry, primary care and
              community programs. Everyone works from the same chart, with access set by role.
            </p>
            <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {AUDIENCES.map((item) => (
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
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">
              Platform
            </p>
            <h2
              className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Everything a behavioral health clinic runs on, in one EHR
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Clinical care, AI documentation, scheduling, telehealth and billing share one record,
              so nothing is typed twice.
            </p>
          </div>

          {MODULES.map((mod, index) => (
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
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5C2D91]">
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
                    src={IMG[mod.imageKey]}
                    alt={mod.alt}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 50vw"
                  />
                </div>
              </div>
            </article>
          ))}
          <div className="border-t border-slate-200/80 bg-white">
            <div className="mx-auto max-w-6xl px-4 py-14 sm:px-8 sm:py-20">
              <h3
                className="text-2xl font-bold tracking-tight text-[#141C34] sm:text-3xl"
                style={{ fontFamily: 'var(--font-clinic-display)' }}
              >
                Also in the platform
              </h3>
              <ul className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
                {MORE_MODULES.map((item) => (
                  <li key={item.title} className="rounded-2xl border border-slate-200/80 bg-slate-50/70 p-5">
                    <p className="text-base font-bold text-[#141C34]">{item.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-[15px]">{item.body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section
          id="why-altrixs"
          className="border-t border-slate-200/80 bg-[#F8FAFC] px-4 py-16 sm:px-8 sm:py-24"
        >
          <div className="mx-auto max-w-6xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">Why Altrixs</p>
            <h2
              className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              What sets Altrixs apart
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Many EHRs add these features later, as separate tools. In Altrixs they are part of how
              the chart works.
            </p>
            <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
              {DIFFERENTIATORS.map((item) => (
                <li key={item.title} className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-bold text-[#141C34]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600 sm:text-[15px]">{item.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section
          id="security"
          className="relative overflow-hidden bg-[#141C34] px-4 py-16 text-white sm:px-8 sm:py-24"
        >
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
            <div className="relative order-2 aspect-[4/3] overflow-hidden rounded-[1.6rem] lg:order-1">
              <Image
                src={IMG.team}
                alt="Clinician at a behavioral health clinic"
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
                Built for the privacy rules behavioral health follows
              </h2>
              <p className="mt-4 text-base leading-relaxed text-white/85 sm:text-lg">
                Altrixs is designed to support HIPAA and 42 CFR Part 2 compliance. Each person gets
                the access their role needs, and access to records is logged.
              </p>
              <ul className="mt-8 space-y-3 text-sm text-white/90 sm:text-[15px]">
                {SECURITY_POINTS.map((line) => (
                  <li key={line} className="flex gap-3">
                    <ShieldCheck size={18} aria-hidden className="mt-0.5 shrink-0 text-[#A3A5F0]" />
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
          <PricingSection showFaq={false} />
        </section>

        <section id="faq" className="border-t border-slate-200/80 bg-white px-4 py-16 sm:px-8 sm:py-24">
          <div className="mx-auto max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#5C2D91]">FAQ</p>
            <h2
              className="mt-3 text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              Questions buyers ask about Altrixs
            </h2>
            <div className="mt-10 space-y-0">
              {HOME_FAQS.map((item) => (
                <details
                  key={item.q}
                  className="group border-t border-slate-200 py-5 open:pb-6 last:border-b"
                >
                  <summary className="cursor-pointer list-none text-base font-semibold text-[#141C34] marker:content-none [&::-webkit-details-marker]:hidden">
                    <span className="flex items-start justify-between gap-4">
                      {item.q}
                      <span className="mt-0.5 text-[#5C2D91] transition group-open:rotate-45">+</span>
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
            className="home-cta-glow pointer-events-none absolute right-[-10%] top-0 h-64 w-64 rounded-full bg-[#5C2D91]/12 blur-3xl"
          />
          <div className="relative mx-auto max-w-3xl text-center">
            <h2
              className="text-3xl font-bold tracking-tight text-[#141C34] sm:text-4xl"
              style={{ fontFamily: 'var(--font-clinic-display)' }}
            >
              See Altrixs with your own workflows
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
              Request a demo and we will walk through your notes, programs and billing. Or start a
              free trial today. No card required. {GO_LIVE_TIMELINE}.
            </p>
            <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
              <a
                href={DEMO_REQUEST_HREF}
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#5C2D91] px-6 py-3.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-[#141C34]"
              >
                Request a demo
              </a>
              <Link
                href="/get-started"
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#5C2D91]/30 bg-white px-6 py-3.5 text-sm font-bold text-[#5C2D91] transition hover:-translate-y-0.5 hover:border-[#5C2D91]/50"
              >
                Start free trial
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
              Behavioral health EHR with integrated primary care, billing and practice operations.
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
            <a href="#pricing" className="hover:text-[#5C2D91]">
              Pricing
            </a>
            <a href="#why-altrixs" className="hover:text-[#5C2D91]">
              Why Altrixs
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
        <p className="mx-auto mt-6 max-w-6xl text-xs text-slate-400">{PARTNER_TRADEMARK_LINE}</p>
      </footer>
    </div>
  );
}
