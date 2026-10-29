'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, CalendarClock, ChevronDown, ChevronUp, FileSignature, Lock, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react';
import { BUCKET_META } from '@/features/caseload/sessionFrequency';
import type { ChartBanner, LockedBanner } from '@/lib/clients/chartBanner';
import { formatApptWhenStaff } from '@/lib/clients/appointmentDisplay';
import { chartDocumentTitle } from './chartTabs';
import { AuthForecastBannerNote } from '@/components/ai/AuthForecastClient';
import { PcpPicker, PcpReviewInline } from './PcpPicker';
import { CareTeamInline } from '@/features/clients/components/CareTeamSummary';

type BannerData = ChartBanner | LockedBanner;

const RISK_TONE = {
  high: 'bg-rose-50 text-rose-700 ring-rose-200',
  medium: 'bg-amber-50 text-amber-800 ring-amber-200',
  low: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
} as const;

const money = (cents: number) =>
  (Math.abs(cents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

const fmtDay = (d: string | null) =>
  d ? new Date(`${d.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '—';

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="truncate text-xs font-semibold text-slate-800">{children}</dd>
    </div>
  );
}

/** Loads GET /api/clients/[id]/banner; sets document.title to "Jane D. · Client chart · Altrixs". */
export function useChartBanner(clientId: string, reloadKey = 0) {
  const [banner, setBanner] = useState<BannerData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!clientId) return;
    let live = true;
    setError(null);
    fetch(`/api/clients/${encodeURIComponent(clientId)}/banner`, { cache: 'no-store' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!live) return;
        if (!res.ok || !data.success) {
          setBanner(null);
          setError(data.error || `Could not load the patient banner (${res.status})`);
          return;
        }
        setBanner(data.banner);
      })
      .catch(() => live && setError('Could not load the patient banner'));
    return () => {
      live = false;
    };
  }, [clientId, reloadKey]);

  useEffect(() => {
    if (!banner) return;
    document.title = chartDocumentTitle(banner.locked === true ? (banner as LockedBanner).displayName : (banner as ChartBanner).shortName);
  }, [banner]);

  return { banner, error };
}

export function PatientBanner({ banner, error, onChanged }: { banner: BannerData | null; error: string | null; onChanged?: () => void }) {
  const [open, setOpen] = useState(false);

  if (error) {
    return (
      <div className="sticky top-0 z-20 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700 shadow-sm">
        {error}
      </div>
    );
  }
  if (!banner) {
    return (
      <div className="sticky top-0 z-20 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-xs text-slate-500 shadow-sm backdrop-blur">
        Loading patient banner…
      </div>
    );
  }
  if (banner.locked === true) {
    return (
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50/95 px-4 py-3 text-sm text-amber-900 shadow-sm backdrop-blur">
        <Lock size={16} className="shrink-0 text-amber-700" />
        <span className="min-w-0 break-words font-bold">{(banner as LockedBanner).displayName}</span>
        <span className="text-xs">Protected record: details are hidden until access is granted (break-glass is audited).</span>
      </div>
    );
  }

  const b = banner as ChartBanner;
  const risk = b.risk.level;
  const auth = b.authorization;
  const freq = b.sessionFrequency ? BUCKET_META[b.sessionFrequency.bucket] : null;
  const allergyText =
    b.allergies.status === 'list'
      ? b.allergies.items.map((a) => a.allergen).join(', ')
      : b.allergies.status === 'nka'
        ? 'NKA'
        : 'No allergies recorded';

  return (
    <section
      aria-label="Patient banner"
      className="sticky top-0 z-20 rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 shadow-sm backdrop-blur sm:px-4"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="min-w-0 break-words text-sm font-bold text-slate-900 sm:text-base">{b.legalName ?? b.name}</h2>
        {b.preferredName || b.pronouns ? (
          <span className="text-xs text-slate-600">
            {b.preferredName ? `"${b.preferredName}"` : ''}
            {b.preferredName && b.pronouns ? ' · ' : ''}
            {b.pronouns ?? ''}
          </span>
        ) : null}
        <span className="text-xs text-slate-600">
          {b.age != null ? `${b.age} y` : 'Age —'} · DOB {fmtDay(b.dateOfBirth)}
        </span>
        {b.mrn ? <span className="break-all font-mono text-[11px] font-semibold text-slate-600">MRN {b.mrn}</span> : null}
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ring-1 ${RISK_TONE[risk]}`}>
          {risk === 'high' ? <AlertTriangle size={11} /> : null}
          {risk} risk
        </span>
        <span
          className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-full sm:max-w-[16rem] px-2 py-0.5 text-[11px] font-bold ring-1 ${
            b.allergies.status === 'list' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-slate-50 text-slate-600 ring-slate-200'
          }`}
          title={b.allergies.status === 'list' ? b.allergies.items.map((a) => `${a.allergen}${a.reaction ? ` (${a.reaction})` : ''}${a.source === 'drfirst' ? ' · DrFirst' : ''}`).join('; ') : undefined}
        >
          <span className="truncate">Allergies: {allergyText}</span>
        </span>
        {b.protection.protectedRecord ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200" title="Protected record: your access is logged">
            <Lock size={11} /> Protected
          </span>
        ) : null}
        {b.protection.sudDiagnosis ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200" title="42 CFR Part 2: SUD records need specific Part 2 consent to disclose">
            <ShieldAlert size={11} /> Part 2
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-auto inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-[11px] font-semibold text-slate-500 hover:bg-slate-50 sm:hidden"
          aria-expanded={open}
        >
          {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {open ? 'Less' : 'More'}
        </button>
      </div>

      <dl className={`${open ? 'grid' : 'hidden'} mt-2 grid-cols-2 gap-x-4 gap-y-1.5 border-t border-slate-100 pt-2 sm:grid sm:grid-cols-4 lg:grid-cols-7`}>
        <Field label={b.primaryCarePatient ? 'BH clinician & team' : 'Care team'} className="col-span-2">
          <CareTeamInline team={b.careTeam} fallbackName={b.assignedClinician?.name} />
        </Field>
        {b.primaryCarePatient ? (
          <div className={`min-w-0 ${b.pcpReview?.contenders.length ? 'col-span-2' : ''}`}>
            <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Primary care provider</dt>
            <dd className="flex min-w-0 flex-wrap items-center gap-1 text-xs font-semibold text-slate-800">
              {b.pcpReview ? (
                <PcpReviewInline clientId={b.id} review={b.pcpReview} canSet={b.canSetPcp} onSaved={onChanged} />
              ) : (
                <span className="truncate" title={b.primaryCareProvider && !b.primaryCareProvider.id ? 'From intake text; not linked to a staff account' : undefined}>
                  {b.primaryCareProvider?.name ?? 'Not set'}
                </span>
              )}
              <PcpPicker clientId={b.id} onSaved={onChanged} />
            </dd>
          </div>
        ) : null}
        <Field label="Location">{b.location ?? '—'}</Field>
        <Field label="Primary payer">
          {b.payer ? `${b.payer.name}${b.payer.memberIdMasked ? ` · ${b.payer.memberIdMasked}` : ''}` : 'None on file'}
        </Field>
        <Field label="Authorization">
          {auth ? (
            <span className={auth.warn ? 'text-amber-700' : ''} title={`${auth.payer}${auth.authNumber ? ` #${auth.authNumber}` : ''} · ${auth.unitsUsed} of ${auth.unitsApproved} used`}>
              {auth.warn ? <AlertTriangle size={11} className="mr-0.5 inline" /> : null}
              {auth.unitsRemaining} left · ends {auth.endDate ? fmtDay(auth.endDate) : 'open'}
              <AuthForecastBannerNote clientId={b.id} priorAuthId={auth.id} />
            </span>
          ) : (
            'No active auth'
          )}
        </Field>
        <Field label="Next appointment">
          {b.nextAppointment ? (
            <span className="inline-flex items-center gap-1">
              <CalendarClock size={11} className="text-[#5C2D91]" />
              {formatApptWhenStaff(
                { startsAt: b.nextAppointment.startsAt, timeZone: b.nextAppointment.timeZone },
                { dateOpts: { month: 'short', day: 'numeric' } }
              )}
            </span>
          ) : (
            'None scheduled'
          )}
        </Field>
        <Field label="Session frequency">
          {freq && b.sessionFrequency ? (
            <span className={`rounded-full px-1.5 py-0.5 text-[11px] ring-1 ${freq.tone}`} title={b.sessionFrequency.statusDetail}>
              {b.sessionFrequency.recommendation} · {freq.label}
            </span>
          ) : (
            'Not tracked'
          )}
        </Field>
        {b.billingVisible ? (
          <Field label="Patient balance">
            {b.balance ? (
              <span className="inline-flex items-center gap-1">
                <Wallet size={11} className="text-slate-500" />
                {b.balance.cents < 0 ? `${money(b.balance.cents)} credit` : money(b.balance.cents)}
              </span>
            ) : (
              '—'
            )}
          </Field>
        ) : null}
      </dl>
      {b.risk.openAlerts > 0 || b.risk.latestCssrs?.safetyFlagged ? (
        <p className={`${open ? 'flex' : 'hidden'} mt-1.5 items-center gap-1 text-[11px] font-semibold text-rose-700 sm:flex`}>
          <ShieldCheck size={12} />
          {b.risk.openAlerts > 0 ? `${b.risk.openAlerts} unreviewed risk alert${b.risk.openAlerts === 1 ? '' : 's'}` : ''}
          {b.risk.openAlerts > 0 && b.risk.latestCssrs?.safetyFlagged ? ' · ' : ''}
          {b.risk.latestCssrs?.safetyFlagged ? `Latest C-SSRS safety-flagged (${fmtDay(b.risk.latestCssrs.createdAt)})` : ''}
          <Link href="?tab=safety" scroll={false} className="ml-1 underline">
            Review
          </Link>
        </p>
      ) : null}
      {b.carelonAttestation ? (
        <p role="status" className="mt-1.5 flex flex-wrap items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-[11px] font-semibold text-[#5C2D91] ring-1 ring-violet-200">
          <FileSignature size={12} aria-hidden />
          Carelon non-overlap attestation needed
          <span className="font-normal text-violet-800">({b.carelonAttestation.label}; Maryland Medicaid)</span>
          <Link href={`/dashboard/ehr/consents/carelon/${encodeURIComponent(b.id)}`} className="ml-1 underline">
            Open form
          </Link>
        </p>
      ) : null}
      {b.consentGaps ? (
        <p role="status" className="mt-1.5 flex flex-wrap items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-[11px] font-semibold text-[#5C2D91] ring-1 ring-violet-200">
          <FileSignature size={12} aria-hidden />
          Required consents missing ({b.consentGaps.count})
          <span className="font-normal text-violet-800">{b.consentGaps.titles.join('; ')}{b.consentGaps.count > b.consentGaps.titles.length ? '; ...' : ''}</span>
          <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(b.id)}`} className="ml-1 underline">
            Open consents
          </Link>
        </p>
      ) : null}
      {b.demographics && (b.demographics.erxMissing.length || b.demographics.claimsMissing.length) ? (
        <p role="status" className="mt-1.5 flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-200">
          <AlertTriangle size={12} aria-hidden />
          Demographics incomplete for {[b.demographics.erxMissing.length && 'e-prescribing', b.demographics.claimsMissing.length && 'claims'].filter(Boolean).join(' / ')}:
          <span className="font-normal">
            {Array.from(new Set([...b.demographics.erxMissing, ...b.demographics.claimsMissing])).join(', ')}
          </span>
          <span className="font-normal text-amber-800">(Edit client to complete)</span>
        </p>
      ) : null}
    </section>
  );
}
