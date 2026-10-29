'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  BedDouble,
  Building2,
  CalendarClock,
  ClipboardCheck,
  CreditCard,
  Globe,
  MapPin,
  Plug,
  ShieldCheck,
  Stethoscope,
  Users,
  Wand2,
} from 'lucide-react';
import { Alert, ErrorState, LoadingState, Page, PageHeader, buttonClasses, cx, FOCUS_RING } from '@/components/ui';
import { SETTINGS_SECTIONS, type SettingsSectionKey } from '@/lib/practice/settings';
import { ChecklistList, PercentPill, ReadOnlyNotice, ReadinessBadges, usePracticeOverview } from './_components/ui';
import { SECTION_COMPONENTS, SectionItems, useSectionPercent } from './_components/sections';

const ICONS: Record<SettingsSectionKey, typeof Building2> = {
  profile: Building2,
  billing: CreditCard,
  locations: MapPin,
  payers: ClipboardCheck,
  clinical: Stethoscope,
  programs: BedDouble,
  scheduling: CalendarClock,
  compliance: ShieldCheck,
  users: Users,
  integrations: Plug,
};

type View = 'overview' | SettingsSectionKey;

export default function PracticeSettingsPage() {
  const { data, setData, error, reload } = usePracticeOverview();
  const [view, setView] = useState<View>('overview');
  // ?section=<key> opens a section directly (e.g. Programs & capacity from the bed board)
  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('section');
    if (s && SETTINGS_SECTIONS.some((x) => x.key === s)) setView(s as SettingsSectionKey);
  }, []);
  const percents = useSectionPercent(data);

  if (error) {
    return (
      <Page width="full">
        <PageHeader title="Practice settings" />
        <div className="rounded-xl border border-slate-200 bg-white shadow-xs">
          <ErrorState title="Could not load practice settings" description={error} onRetry={() => void reload()} retryLabel="Retry" />
        </div>
      </Page>
    );
  }
  if (!data) {
    return (
      <Page width="full">
        <LoadingState label="Loading practice settings…" />
      </Page>
    );
  }

  const Section = view === 'overview' ? null : SECTION_COMPONENTS[view];
  const label = view === 'overview' ? 'Readiness overview' : SETTINGS_SECTIONS.find((s) => s.key === view)?.label;

  return (
    <Page width="full">
      <PageHeader
        eyebrow={data.organization.name}
        title="Practice settings"
        description="Profile, billing identifiers, locations, clinical policy and compliance — everything a payer audit or go-live review asks for."
        actions={
          <>
            <Link href="/onboarding" className={buttonClasses({ variant: 'secondary' })}>
              <Wand2 className="h-4 w-4" aria-hidden /> Setup wizard
            </Link>
            <Link href="/dashboard/practice-setup/booking" className={buttonClasses({ variant: 'secondary' })}>
              <Globe className="h-4 w-4" aria-hidden /> Online booking profile
            </Link>
          </>
        }
      />

      <ReadinessBadges overview={data} />
      <ReadOnlyNotice canEdit={data.canEdit} />
      {data.migrationPending ? (
        <Alert tone="warning">
          The practice settings tables are not in this database yet — run prisma/migrations/20261018_practice_settings.sql before saving.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <nav className="h-fit rounded-xl border border-slate-200 bg-white p-2 shadow-xs lg:sticky lg:top-4" aria-label="Settings sections">
          <button
            type="button"
            onClick={() => setView('overview')}
            aria-current={view === 'overview' ? 'page' : undefined}
            className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium', FOCUS_RING, view === 'overview' ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50')}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ClipboardCheck className="h-4 w-4 shrink-0" aria-hidden /> Readiness overview
            </span>
            <PercentPill percent={data.checklist.percent} />
          </button>
          <div className="my-1 border-t border-slate-100" />
          {SETTINGS_SECTIONS.map((s) => {
            const Icon = ICONS[s.key];
            const p = percents.get(s.key);
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setView(s.key)}
                aria-current={view === s.key ? 'page' : undefined}
                className={cx('flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium', FOCUS_RING, view === s.key ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0" aria-hidden /> {s.label}
                </span>
                {p ? <PercentPill percent={p.percent} blocking={p.blocking} /> : null}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0 space-y-5">
          <h2 className="text-base font-semibold text-slate-900">{label}</h2>
          {view === 'overview' ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Before the first claim</h3>
                <p className="mb-3 text-sm text-slate-500">Items that block an 837P claim or would get it rejected.</p>
                {data.checklist.billBlockers.length ? (
                  <ChecklistList items={data.checklist.billBlockers} onJump={(s) => setView(s)} />
                ) : (
                  <p className="text-sm text-emerald-700">Ready to bill.</p>
                )}
              </section>
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
                <h3 className="mb-1 text-sm font-semibold text-slate-900">Before go-live</h3>
                <p className="mb-3 text-sm text-slate-500">Operational and compliance items (excluding billing blockers).</p>
                {data.checklist.goLiveBlockers.filter((i) => i.gate === 'golive').length ? (
                  <ChecklistList items={data.checklist.goLiveBlockers.filter((i) => i.gate === 'golive')} onJump={(s) => setView(s)} />
                ) : (
                  <p className="text-sm text-emerald-700">No open go-live items.</p>
                )}
              </section>
              <section className="min-w-0 rounded-xl border border-slate-200 bg-white p-5 shadow-xs xl:col-span-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">Recommended</h3>
                <ChecklistList items={data.checklist.items.filter((i) => i.gate === 'recommended' && !i.done)} onJump={(s) => setView(s)} />
              </section>
            </div>
          ) : Section ? (
            <>
              <SectionItems overview={data} section={view} />
              <Section overview={data} onSaved={setData} refresh={() => void reload()} />
            </>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
