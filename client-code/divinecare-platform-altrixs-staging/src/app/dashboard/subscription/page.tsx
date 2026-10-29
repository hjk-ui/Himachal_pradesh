'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, CreditCard, ExternalLink, Info, Loader2, RefreshCw, Settings2 } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  PageHeader,
  Section,
  StatusBadge,
  buttonClasses,
  cx,
  FOCUS_RING,
  inputClasses,
  toneForStatus,
} from '@/components/ui';
import {
  ADD_ONS,
  CLAIMS_RULE,
  DUNNING_RULE,
  estimateLabel,
  OVERAGE_RULE,
  SALES_CONTACT_HREF,
  SEAT_RULE,
  TIERS,
  TRIAL_RULE,
  formatUsd,
  isTierId,
  quote,
  smallestFittingTier,
  tierPriceLabel,
  type BillingInterval,
  type SeatQuantities,
  type SelfServeTierId,
  type TierId,
} from '@/lib/billing/plans';
import type { BillingBanner } from '@/lib/billing/entitlements';
import {
  AddOnCards,
  FeatureMatrix,
  IntervalToggle,
  PricingFaqList,
  ProposedPricingNotice,
  TierCards,
} from '@/components/marketing/PricingPlans';
import { QuoteCalculator } from '@/components/marketing/QuoteCalculator';

type Access = {
  status: string;
  mode: 'full' | 'grace' | 'read_only';
  canWrite: boolean;
  unlimited: boolean;
  trialDaysLeft: number | null;
  graceEndsAt: string | null;
  banner: BillingBanner | null;
};

type Payload = {
  success: boolean;
  error?: string;
  canManage: boolean;
  access: Access;
  subscription?: {
    tier: string | null;
    status: string;
    interval: BillingInterval;
    seatsPaid: number | null;
    seatsByType: SeatQuantities | null;
    addOns: { eprescribing: number; ai_scribe: number; additional_location: number };
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    hasStripeCustomer: boolean;
    hasStripeSubscription: boolean;
    compedReason: string | null;
  };
  seats?: {
    byType: SeatQuantities;
    support: number;
    providers: number;
    seats: number;
    unmapped: number;
    licensed: number;
    program: number;
    prescribers: number;
    free: number;
    billable: number;
  };
  locations?: number;
  pricingApproved?: boolean;
  stripe?: {
    configured: boolean;
    mode: 'live' | 'test' | 'unknown' | null;
    webhookConfigured: boolean;
    seatSync: boolean;
    checkoutReady: Record<string, Record<BillingInterval, boolean>>;
    env: { name: string; set: boolean; purpose: string }[];
  };
};

type InvoicesPayload = {
  success: boolean;
  error?: string;
  configured: boolean;
  invoices: {
    id: string;
    number: string | null;
    createdAt: string;
    total: number;
    amountDue: number;
    currency: string;
    status: string | null;
    hostedUrl: string | null;
    pdfUrl: string | null;
  }[];
  upcoming: { amountDue: number; currency: string; date: string | null } | null;
};

const STATUS_LABEL: Record<string, string> = {
  comped: 'Complimentary',
  grandfathered: 'Full access — existing clinic',
  trialing: 'Free trial',
  active: 'Active',
  past_due: 'Payment past due',
  unpaid: 'Unpaid — read-only',
  incomplete: 'Payment incomplete',
  canceled: 'Ended — read-only',
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function money(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format(amount);
}

function BannerBox({ banner }: { banner: BillingBanner }) {
  return (
    <Alert tone={banner.tone} icon={banner.tone === 'info' ? <Info /> : <AlertTriangle />}>
      <p>
        <span className="font-semibold">{banner.title}.</span> {banner.message}
      </p>
    </Alert>
  );
}

export default function SubscriptionPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [invoices, setInvoices] = useState<InvoicesPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [interval, setBillingInterval] = useState<BillingInterval>('month');
  const [aiScribeUsers, setAiScribeUsers] = useState(0);
  const [includeOnboarding, setIncludeOnboarding] = useState(false);
  const [includeDataMigration, setIncludeDataMigration] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/subscription', { cache: 'no-store' });
      const json = (await res.json()) as Payload;
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not load the subscription.');
        return;
      }
      setData(json);
      if (json.subscription) {
        setBillingInterval(json.subscription.interval);
        setAiScribeUsers(json.subscription.addOns.ai_scribe || 0);
      }
      if (json.canManage) {
        const inv = await fetch('/api/stripe/invoices', { cache: 'no-store' });
        const invJson = (await inv.json()) as InvoicesPayload;
        setInvoices(invJson);
      }
    } catch {
      setError('Could not load the subscription.');
    }
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get('checkout');
    if (checkout === 'success') {
      setNotice('Checkout completed in Stripe. Your plan updates here as soon as Stripe confirms it (usually within a minute). Refresh if it has not changed.');
    } else if (checkout === 'canceled') {
      setNotice('Checkout was cancelled. No charge was made.');
    }
  }, [load]);

  const sub = data?.subscription;
  const access = data?.access;
  const currentTier: TierId | null = sub && isTierId(sub.tier) ? (sub.tier as TierId) : null;
  const isComped = access?.status === 'comped';
  const hasSubscription = Boolean(sub?.hasStripeSubscription) && ['active', 'trialing', 'past_due'].includes(access?.status || '');
  const seatsInUse = data?.seats?.seats ?? 0;
  const seatsByType: SeatQuantities = data?.seats?.byType ?? { prescriber: 0, clinician: 0, paraprofessional: 0 };
  const providersInUse = data?.seats?.providers ?? 0;
  const locationsInUse = Math.max(1, data?.locations ?? 1);

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; url?: string; message?: string };
    if (!res.ok || !json.success) throw new Error(json.error || 'Request failed.');
    return json;
  };

  const choose = async (tier: TierId) => {
    setBusy(tier);
    setError(null);
    try {
      if (hasSubscription) {
        const json = await post('/api/stripe/change', { tier, interval, aiScribeUsers });
        setNotice(json.message || 'Change sent to Stripe.');
        await load();
      } else {
        const json = await post('/api/stripe/checkout', { tier, interval, aiScribeUsers, includeOnboarding, includeDataMigration });
        if (json.url) window.location.assign(json.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checkout.');
    } finally {
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy('portal');
    setError(null);
    try {
      const json = await post('/api/stripe/portal');
      if (json.url) window.location.assign(json.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the billing portal.');
      setBusy(null);
    }
  };

  const syncNow = async () => {
    setBusy('seats');
    setError(null);
    try {
      await post('/api/stripe/seats');
      setNotice('Seat count sent to Stripe.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Seat sync failed.');
    } finally {
      setBusy(null);
    }
  };

  const previewTier: SelfServeTierId =
    currentTier && currentTier !== 'enterprise' ? currentTier : smallestFittingTier(seatsByType, locationsInUse);
  const preview = useMemo(
    () =>
      quote({
        tier: previewTier,
        interval,
        seats: seatsByType,
        locations: locationsInUse,
        aiScribeUsers,
        includeOnboarding: !hasSubscription && includeOnboarding,
        includeDataMigration: !hasSubscription && includeDataMigration,
      }),
    [previewTier, interval, seatsByType, locationsInUse, aiScribeUsers, includeOnboarding, includeDataMigration, hasSubscription]
  );
  /** "Your plan" estimate at current active seats and list price (comped orgs included). Never billed from here. */
  const currentEstimate = useMemo(
    () =>
      quote({
        tier: previewTier,
        interval: sub?.interval ?? 'month',
        seats: seatsByType,
        locations: locationsInUse,
        aiScribeUsers: sub?.addOns.ai_scribe ?? 0,
      }),
    [previewTier, sub?.interval, sub?.addOns.ai_scribe, seatsByType, locationsInUse]
  );

  const renderAction = (tier: TierId) => {
    const t = TIERS[tier];
    if (!t.selfServe) {
      return (
        <a href={SALES_CONTACT_HREF} className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'w-full' })}>
          Contact sales
        </a>
      );
    }
    if (isComped) {
      return <p className="text-center text-xs font-semibold text-slate-500">Included in your complimentary plan</p>;
    }
    const ready = data?.stripe?.checkoutReady?.[tier]?.[interval];
    const isCurrent = hasSubscription && currentTier === tier && sub?.interval === interval;
    const tooSmall = t.maxProviderSeats !== null && providersInUse > t.maxProviderSeats;
    const disabled = busy !== null || isCurrent || !ready || tooSmall;
    const label = isCurrent
      ? 'Current plan'
      : hasSubscription
        ? `Switch to ${t.name}`
        : `Choose ${t.name}`;
    return (
      <div>
        <Button size="lg" disabled={disabled} loading={busy === tier} onClick={() => void choose(tier)} className="w-full">
          {label}
        </Button>
        {!isCurrent && !ready ? (
          <p className="mt-1.5 text-center text-xs text-slate-500">
            {data?.stripe?.configured ? 'Stripe price not configured on this server' : 'Stripe not configured on this server'}
          </p>
        ) : null}
        {tooSmall ? (
          <p className="mt-1.5 text-center text-xs text-slate-500">
            {t.name} is for up to {t.maxProviderSeats} providers; you have {providersInUse} active.
          </p>
        ) : null}
      </div>
    );
  };

  if (!data && !error) {
    return (
      <Page>
        <PageHeader title="Plan & Subscription" />
        <Card>
          <LoadingState label="Loading plan…" />
        </Card>
      </Page>
    );
  }

  return (
    <Page className="pb-10">
      <PageHeader
        title="Plan & Subscription"
        description="Your plan, seats by role, add-ons and invoices. Prescriber, clinician and program staff seats are priced by role; front desk, billing, HR and admin accounts are free."
      />

      <ProposedPricingNotice />
      {notice ? (
        <Alert tone="success" icon={<CheckCircle2 />}>
          {notice}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger" icon={<AlertTriangle />}>
          {error}
        </Alert>
      ) : null}
      {access?.banner ? <BannerBox banner={access.banner} /> : null}

      {data && !data.canManage ? (
        <p className="text-sm text-slate-600">Only practice leadership can view and change the subscription.</p>
      ) : null}

      {data?.canManage && sub && access ? (
        <>
          {/* Current plan */}
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Current plan</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">
                    {isComped ? 'Complimentary' : currentTier ? TIERS[currentTier].name : 'No paid plan'}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {STATUS_LABEL[access.status] || access.status}
                    {currentTier && !isComped ? ` · ${tierPriceLabel(currentTier, sub.interval)}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {hasSubscription && data.stripe?.seatSync ? (
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => void syncNow()}
                      icon={<RefreshCw className={busy === 'seats' ? 'animate-spin' : ''} />}
                    >
                      Sync seats
                    </Button>
                  ) : null}
                  {sub.hasStripeCustomer ? (
                    <Button
                      disabled={busy !== null}
                      onClick={() => void openPortal()}
                      icon={busy === 'portal' ? <Loader2 className="animate-spin" /> : <CreditCard />}
                    >
                      Manage billing in Stripe
                    </Button>
                  ) : null}
                </div>
              </div>

              {isComped ? (
                <Alert tone="brand" className="mt-4">
                  This organization is on a complimentary plan{sub.compedReason ? ` (${sub.compedReason})` : ''}. Every feature is
                  included and nothing is billed through Altrixs.
                </Alert>
              ) : access.status === 'grandfathered' ? (
                <Alert tone="brand" className="mt-4">
                  This clinic was set up before self-serve billing and keeps full access. Nothing is charged unless a plan is chosen below.
                </Alert>
              ) : null}

              {currentEstimate ? (
                <Alert tone="warning" className="mt-4" title={estimateLabel()}>
                  <p>
                    At current active seats on {TIERS[currentEstimate.tier].name} list price:{' '}
                    <span className="font-semibold">{formatUsd(currentEstimate.subscriptionPerMonth)} / month</span>
                    {' '}({currentEstimate.lines.filter((l) => l.kind !== 'discount').map((l) => l.label).join(', ') || 'no paid seats'}).
                    {isComped ? ' This organization is complimentary, so nothing is charged.' : ' Stripe shows the final amount before any charge.'}
                  </p>
                </Alert>
              ) : null}

              <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-slate-500">Paid seats in use</dt>
                  <dd className="stat-number mt-1 text-2xl font-semibold text-slate-900">{data.seats?.seats ?? 0}</dd>
                  <dd className="text-xs text-slate-500">
                    {seatsByType.prescriber} prescribers · {seatsByType.clinician} clinicians · {seatsByType.paraprofessional} program staff ·{' '}
                    {data.seats?.support ?? 0} free support · {locationsInUse} location{locationsInUse === 1 ? '' : 's'}
                  </dd>
                  {data.seats?.unmapped ? (
                    <dd className="text-xs font-semibold text-amber-700">{data.seats.unmapped} account(s) with an unrecognized role, counted as free</dd>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-slate-500">Seats paid</dt>
                  <dd className="stat-number mt-1 text-2xl font-semibold text-slate-900">{sub.seatsPaid ?? '—'}</dd>
                  {sub.seatsPaid !== null && data.seats && data.seats.billable > sub.seatsPaid ? (
                    <dd className="text-xs font-semibold text-amber-700">
                      {data.seats.billable - sub.seatsPaid} over paid seats
                      {data.stripe?.seatSync ? ' — sync to update Stripe' : ' — trued up at renewal'}
                    </dd>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-slate-500">
                    {access.status === 'trialing' && !sub.hasStripeSubscription ? 'Trial ends' : sub.cancelAtPeriodEnd ? 'Ends on' : 'Current period ends'}
                  </dt>
                  <dd className="stat-number mt-1 text-lg font-semibold text-slate-900">
                    {fmtDate(access.status === 'trialing' ? sub.trialEndsAt : sub.currentPeriodEnd)}
                  </dd>
                  {access.trialDaysLeft !== null ? (
                    <dd className="text-xs text-slate-500">{access.trialDaysLeft} days left</dd>
                  ) : null}
                </div>
                <div className="min-w-0">
                  <dt className="text-xs font-semibold text-slate-500">Next invoice</dt>
                  <dd className="stat-number mt-1 text-lg font-semibold text-slate-900">
                    {invoices?.upcoming ? money(invoices.upcoming.amountDue, invoices.upcoming.currency) : '—'}
                  </dd>
                  <dd className="text-xs text-slate-500">
                    {invoices?.upcoming ? fmtDate(invoices.upcoming.date) : invoices && invoices.success && !invoices.configured ? 'Stripe not configured on this server' : invoices && !invoices.success ? 'Could not load from Stripe' : 'No upcoming invoice'}
                  </dd>
                </div>
              </dl>
              {sub.addOns.ai_scribe || sub.addOns.additional_location || sub.addOns.eprescribing ? (
                <p className="mt-4 text-sm text-slate-600">
                  Add-ons:{' '}
                  {[
                    sub.addOns.ai_scribe ? `AI Scribe × ${sub.addOns.ai_scribe}` : '',
                    sub.addOns.additional_location ? `Additional locations × ${sub.addOns.additional_location}` : '',
                    sub.addOns.eprescribing ? `E-prescribing (previous plan) × ${sub.addOns.eprescribing}` : '',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              ) : null}
            </CardBody>
          </Card>

          {/* Choose / change plan */}
          {!isComped ? (
            <Section
              title={hasSubscription ? 'Change plan' : 'Choose a plan'}
              description={
                <span className="block max-w-3xl">
                  Seat quantities are your active staff by role ({seatsByType.prescriber} prescribers, {seatsByType.clinician} clinicians, {seatsByType.paraprofessional} program staff). If the total is below the plan minimum, the minimum applies.
                  {hasSubscription ? ' Changes are prorated by Stripe.' : ' Any trial days left carry over: you are not charged until the trial ends.'}
                </span>
              }
              actions={<IntervalToggle value={interval} onChange={setBillingInterval} />}
              className="space-y-4"
            >
              <Card>
                <CardBody className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-3">
                  <label className="text-sm">
                    <span className="block font-semibold text-slate-900">AI Scribe users</span>
                    <span className="block text-xs text-slate-500">
                      {formatUsd(ADD_ONS.ai_scribe.monthlyPerUnit || 0)} {ADD_ONS.ai_scribe.unit}. Up to your {seatsInUse} paid seats.
                    </span>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, seatsInUse)}
                      value={aiScribeUsers}
                      onChange={(e) => setAiScribeUsers(Math.max(0, Math.min(seatsInUse, Math.floor(Number(e.target.value) || 0))))}
                      className={cx(inputClasses, 'mt-2 max-w-28')}
                    />
                  </label>
                  <p className="text-xs text-slate-500">
                    E-prescribing with EPCS is included in each prescriber seat. Extra locations are added automatically on Professional.
                  </p>
                  {!hasSubscription ? (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={includeOnboarding}
                        onChange={(e) => setIncludeOnboarding(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span>
                        <span className="block font-semibold text-slate-900">Add onboarding and training</span>
                        <span className="block text-xs text-slate-500">One-time fee by tier plus a per-site fee after the first location. Starter has no fee.</span>
                      </span>
                    </label>
                  ) : null}
                  {!hasSubscription ? (
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={includeDataMigration}
                        onChange={(e) => setIncludeDataMigration(e.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                      />
                      <span>
                        <span className="block font-semibold text-slate-900">Add data migration</span>
                        <span className="block text-xs text-slate-500">One prior system. Starter uses self-serve CSV import at no charge.</span>
                      </span>
                    </label>
                  ) : null}
                  {preview ? (
                    <div className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-700 sm:col-span-3">
                      <p className="font-semibold text-slate-900">Estimate for {TIERS[preview.tier].name}</p>
                      <ul className="mt-1 space-y-0.5 text-xs">
                        {preview.lines.map((l) => (
                          <li key={l.id}>
                            {l.label}: {formatUsd(l.amount)}/mo
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1 text-xs font-semibold">
                        {formatUsd(preview.subscriptionPerMonth)}/mo
                        {interval === 'year' ? ` · ${formatUsd(preview.subscriptionPerInvoice)} billed annually` : ''}
                        {preview.oneTime ? ` · plus ${formatUsd(preview.oneTime)} one-time onboarding` : ''}. Stripe shows the final amount, including tax if configured, before you pay.
                      </p>
                    </div>
                  ) : null}
                </CardBody>
              </Card>

              <TierCards interval={interval} currentTier={hasSubscription ? currentTier : null} renderAction={renderAction} />
            </Section>
          ) : null}

          {/* Billing history */}
          <Card>
            <CardHeader title="Billing history" />
            {!invoices ? (
              <LoadingState label="Loading…" rows={3} />
            ) : !invoices.success ? (
              <ErrorState title="Could not load invoices" description={invoices.error || 'Could not load invoices from Stripe.'} />
            ) : !invoices.configured ? (
              <EmptyState
                compact
                title="No billing history"
                description="Stripe is not configured on this server, so there is no billing history to show."
              />
            ) : invoices.invoices.length === 0 ? (
              <EmptyState compact title="No invoices yet." description="Invoices from Stripe appear here after your first billing period." />
            ) : (
              <div className="clinic-scroll-x">
                <table className="w-full min-w-full border-collapse text-sm">
                  <caption className="sr-only">Invoices from Stripe</caption>
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Date</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Invoice</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-right text-xs font-semibold text-slate-600">Amount</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Status</th>
                      <th scope="col" className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold text-slate-600">Links</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {invoices.invoices.map((inv) => (
                      <tr key={inv.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-700">{fmtDate(inv.createdAt)}</td>
                        <td className="px-4 py-3 text-slate-700">{inv.number || '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{money(inv.total, inv.currency)}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {inv.status ? (
                            <StatusBadge tone={toneForStatus(inv.status)} className="capitalize">
                              {inv.status}
                            </StatusBadge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {inv.hostedUrl ? (
                            <a
                              href={inv.hostedUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={cx('inline-flex items-center gap-1 rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                            >
                              View <ExternalLink className="h-3 w-3" aria-hidden />
                            </a>
                          ) : null}
                          {inv.pdfUrl ? (
                            <a
                              href={inv.pdfUrl}
                              target="_blank"
                              rel="noreferrer"
                              className={cx('ml-3 rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}
                            >
                              PDF
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      ) : null}

      {/* How billing works */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          { title: 'Who counts as a seat', body: SEAT_RULE },
          { title: 'Claims included', body: CLAIMS_RULE },
          { title: 'Adding or removing clinicians', body: OVERAGE_RULE },
          { title: 'Free trial', body: TRIAL_RULE },
          { title: 'Failed payments', body: DUNNING_RULE },
        ].map((card) => (
          <Card key={card.title} className="p-4">
            <p className="text-sm font-semibold text-slate-900">{card.title}</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-600">{card.body}</p>
          </Card>
        ))}
      </section>

      {data?.canManage ? (
        <QuoteCalculator
          key={`${seatsByType.prescriber}-${seatsByType.clinician}-${seatsByType.paraprofessional}-${locationsInUse}`}
          heading="Price calculator"
          initialSeats={seatsByType}
          initialSupport={data.seats?.support ?? 0}
          initialLocations={locationsInUse}
          initialTier={previewTier}
          initialInterval={sub?.interval ?? 'month'}
          initialAiScribeUsers={sub?.addOns.ai_scribe ?? 0}
          totalLabel={estimateLabel()}
        />
      ) : null}

      <Section title="Add-ons">
        <AddOnCards interval={interval} />
      </Section>

      <Section title="Compare plans">
        <FeatureMatrix interval={interval} />
      </Section>

      <Card>
        <CardHeader title="Frequently asked questions" />
        <CardBody>
          <PricingFaqList />
        </CardBody>
      </Card>

      {data?.canManage && data.stripe ? (
        <Card>
          <button
            type="button"
            onClick={() => setShowConfig((v) => !v)}
            aria-expanded={showConfig}
            className={cx('flex w-full flex-col gap-1 rounded-xl px-5 py-4 text-left sm:flex-row sm:items-center sm:justify-between', FOCUS_RING)}
          >
            <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Settings2 className="h-4 w-4 text-slate-500" aria-hidden /> Server billing configuration
              <ChevronDown className={cx('h-4 w-4 text-slate-500 transition', showConfig ? 'rotate-180' : '')} aria-hidden />
            </span>
            <span className="text-xs font-semibold text-slate-500">
              Stripe {data.stripe.configured ? `configured (${data.stripe.mode} mode)` : 'not configured'} · webhook{' '}
              {data.stripe.webhookConfigured ? 'configured' : 'not configured'} · seat sync {data.stripe.seatSync ? 'on' : 'off'} · pricing{' '}
              {data.pricingApproved ? 'approved' : 'proposed'}
            </span>
          </button>
          {showConfig ? (
            <ul className="grid grid-cols-1 gap-1 border-t border-slate-200 px-5 py-4 text-xs sm:grid-cols-2">
              {data.stripe.env.map((row) => (
                <li key={row.name} className="flex min-w-0 items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${row.set ? 'bg-emerald-500' : 'bg-slate-300'}`} aria-hidden />
                  <code className="font-mono text-[11px] text-slate-700">{row.name}</code>
                  <span className="text-slate-500">— {row.purpose}{row.set ? '' : ' (not set)'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}
    </Page>
  );
}
