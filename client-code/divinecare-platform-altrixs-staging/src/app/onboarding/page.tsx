'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronLeft, ChevronRight, Globe, LayoutDashboard, Loader2, LogIn } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import type { SettingsSectionKey } from '@/lib/practice/settings';
import { ChecklistList, ReadOnlyNotice, ReadinessBadges, usePracticeOverview } from '@/app/dashboard/practice-setup/_components/ui';
import { SECTION_COMPONENTS, SectionItems } from '@/app/dashboard/practice-setup/_components/sections';

/**
 * Setup wizard for a new practice. Same sections and APIs as Practice settings, one per step;
 * the current step is saved on the practice (PracticeSettings.onboardingStep) so setup resumes
 * where it was left, from any device.
 */
const STEPS: Array<{ key: SettingsSectionKey | 'finish'; label: string; blurb: string }> = [
  { key: 'profile', label: 'Practice profile', blurb: 'Legal name, NPI, tax ID, taxonomy, licenses and contact details.' },
  { key: 'billing', label: 'Billing provider', blurb: 'The NPI and address claims bill under, pay-to address and claim defaults.' },
  { key: 'locations', label: 'Locations', blurb: 'Each site’s address, phone, place of service and hours.' },
  { key: 'payers', label: 'Payers', blurb: 'Map each payer to its Waystar payer ID and telehealth rules.' },
  { key: 'clinical', label: 'Clinical defaults', blurb: 'Note signing, co-signature, treatment plan and assessment cadence.' },
  { key: 'scheduling', label: 'Scheduling', blurb: 'Appointment types, cancellation window and telehealth platform.' },
  { key: 'compliance', label: 'Compliance', blurb: 'HIPAA officers, Part 2 status, record retention and BAAs.' },
  { key: 'users', label: 'Users', blurb: 'Invite staff and make sure every clinician has an NPI.' },
  { key: 'integrations', label: 'Integrations', blurb: 'Clearinghouse, e-prescribing, messaging and telehealth status.' },
  { key: 'finish', label: 'Review & finish', blurb: 'What is still open before billing and go-live.' },
];

export default function OnboardingPage() {
  const { data, setData, error, reload } = usePracticeOverview();
  const [index, setIndex] = useState(0);
  const resumed = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  // Resume at the saved step once
  useEffect(() => {
    if (!data || resumed.current) return;
    resumed.current = true;
    const at = STEPS.findIndex((s) => s.key === data.settings.onboardingStep);
    if (at >= 0) setIndex(at);
  }, [data]);

  const go = (next: number) => {
    const bounded = Math.max(0, Math.min(STEPS.length - 1, next));
    setIndex(bounded);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (data?.canEdit) {
      void apiJson('/api/practice-settings/onboarding', { method: 'PUT', body: JSON.stringify({ step: STEPS[bounded].key }) }).catch(() => undefined);
    }
  };

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await apiJson('/api/practice-settings/onboarding', { method: 'PUT', body: JSON.stringify({ step: 'finish', complete: true }) });
      await reload();
    } catch (e) {
      setFinishError(e instanceof Error ? e.message : 'Could not finish setup');
    } finally {
      setFinishing(false);
    }
  };

  if (error) {
    const signedOut = /unauthor|sign in|401/i.test(error);
    return (
      <Shell>
        <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm sm:p-8">
          <h1 className="text-xl font-bold text-slate-900">{signedOut ? 'Sign in to set up your practice' : 'Setup is not available'}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {signedOut ? 'The setup wizard saves to your practice account. Create an account first, or sign in as a practice admin.' : error}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/login?callbackUrl=%2Fonboarding" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white">
              <LogIn className="h-4 w-4" /> Sign in
            </Link>
            {signedOut ? (
              <Link href="/get-started" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                Create an account <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        </div>
      </Shell>
    );
  }

  if (!data) {
    return (
      <Shell>
        <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-600">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your practice…
        </div>
      </Shell>
    );
  }

  const step = STEPS[index];
  const Section = step.key === 'finish' ? null : SECTION_COMPONENTS[step.key];
  const progress = Math.round((index / (STEPS.length - 1)) * 100);
  const sectionPct = new Map(data.checklist.sections.map((s) => [s.key, s.percent]));

  return (
    <Shell>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="h-fit rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-6">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{data.organization.name}</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">Practice setup</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-[#5C2D91] transition-all" style={{ width: `${progress}%` }} />
          </div>
          <ol className="mt-4 space-y-1">
            {STEPS.map((s, i) => {
              const pct = s.key === 'finish' ? data.checklist.percent : sectionPct.get(s.key) ?? 0;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => go(i)}
                    className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${i === index ? 'bg-purple-50 font-semibold text-[#5C2D91]' : 'text-slate-700 hover:bg-slate-50'}`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${pct === 100 ? 'bg-emerald-600 text-white' : i === index ? 'bg-[#5C2D91] text-white' : 'bg-slate-200 text-slate-600'}`}>
                      {pct === 100 ? <Check className="h-3 w-3" /> : i + 1}
                    </span>
                    <span className="min-w-0 flex-1 break-words">{s.label}</span>
                    <span className="text-[11px] text-slate-400">{pct}%</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </aside>

        <main className="min-w-0 space-y-5">
          <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Step {index + 1} of {STEPS.length}
            </p>
            <h1 className="break-words text-xl font-bold text-slate-900">{step.label}</h1>
            <p className="mt-1 text-sm text-slate-600">{step.blurb}</p>
          </div>
          <ReadOnlyNotice canEdit={data.canEdit} />

          {Section ? (
            <>
              <Section overview={data} onSaved={setData} refresh={() => void reload()} />
              <SectionItems overview={data} section={step.key as SettingsSectionKey} />
            </>
          ) : (
            <div className="space-y-5">
              <ReadinessBadges overview={data} />
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-base font-semibold text-slate-900">Still open</h3>
                {data.checklist.goLiveBlockers.length ? (
                  <ChecklistList items={data.checklist.goLiveBlockers} onJump={(section) => go(STEPS.findIndex((s) => s.key === section))} />
                ) : (
                  <p className="text-sm text-emerald-700">Everything required for billing and go-live is in place.</p>
                )}
              </section>
              <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                {data.settings.onboardingCompletedAt ? (
                  <p className="flex-1 text-sm text-emerald-700">
                    Setup marked complete on {new Date(data.settings.onboardingCompletedAt).toLocaleDateString()}. You can return here any time.
                  </p>
                ) : (
                  <p className="flex-1 text-sm text-slate-600">You can finish now and complete open items later in Practice settings.</p>
                )}
                {data.canEdit && !data.settings.onboardingCompletedAt ? (
                  <button
                    type="button"
                    onClick={() => void finish()}
                    disabled={finishing}
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Finish setup
                  </button>
                ) : null}
                <Link href="/dashboard" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  <LayoutDashboard className="h-4 w-4" /> Dashboard
                </Link>
                <Link href="/dashboard/practice-setup/booking" className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700">
                  <Globe className="h-4 w-4" /> Online booking profile
                </Link>
                {finishError ? <p className="w-full text-sm text-rose-600">{finishError}</p> : null}
              </section>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => go(index - 1)}
              disabled={index === 0}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Back
            </button>
            {index < STEPS.length - 1 ? (
              <button type="button" onClick={() => go(index + 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white">
                Next <ChevronRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          <p className="text-center text-xs text-slate-500">Save each section before moving on. Steps can be done in any order.</p>
        </main>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-slate-50 px-4 py-6 sm:px-6">
      <div className="mx-auto mb-6 flex max-w-6xl flex-wrap items-center justify-between gap-3">
        <Link href="/dashboard" className="inline-flex items-center gap-2">
          <Image src="/altrixs-logo.png" alt="Altrixs" width={120} height={32} className="h-8 w-auto" priority />
        </Link>
        <Link href="/dashboard/practice-setup" className="inline-flex min-h-10 items-center text-sm font-semibold text-[#5C2D91] hover:underline">
          Practice settings
        </Link>
      </div>
      {children}
    </div>
  );
}
