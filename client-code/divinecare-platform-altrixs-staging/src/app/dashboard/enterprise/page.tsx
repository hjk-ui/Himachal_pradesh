'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { Users, UserCheck, DollarSign, CalendarDays, AlertTriangle, CheckCircle2, MapPin, Info, Settings, BarChart3, Layers, ArrowRight, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  buttonClasses,
  cx,
  inputClasses,
} from '@/components/ui';
import { useLocation } from '@/context/LocationContext';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import type { PracticeOverview } from '@/lib/locations/overview';
import CensusTab from './CensusTab';
import {
  FacilityFinancials,
  FacilityOverviewCards,
  FACILITY_PALETTE,
  FACILITY_SWATCH,
  GRID_STROKE,
  PracticeFinancialsPanel,
  Swatch,
  UnrecordedBanner,
  UNASSIGNED_COLOR,
} from './FacilityView';

// Practice overview per location. Every figure comes from /api/locations/overview (leadership only, audited);
// locations are the organization's Location rows (Admin › Locations), never a hard-coded list.
// Default view "By facility": the practice's Valant facilities (overview.facilityView); "By Altrixs location" is the toggle.

type Loc = PracticeOverview['locations'][number];

/** Entity ids used by cross-location referrals saved before locations came from the database */
const LEGACY_REFERRAL_IDS: Record<string, string> = { bow: 'Bowie', ss: 'Silver Spring', bal: 'Baltimore', lp: 'Lexington Park' };

const LINK = 'font-semibold text-blue-700 hover:underline';

const fmtN = (n: number) => n.toLocaleString('en-US');
const fmt$ = (cents: number) => `$${Math.round(cents / 100).toLocaleString('en-US')}`;
const pct = (r: number | null) => (r === null ? '—' : `${(r * 100).toFixed(1)}%`);
const shortOf = (l: Pick<Loc, 'code' | 'name'>) =>
  (l.code?.trim() || l.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3)).toUpperCase();
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
};

/** Location code chip with its chart-series dot. */
function EntityLogo({ shortName, swatch }: { shortName: string; swatch: string }) {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-slate-100 px-1.5 text-[11px] font-semibold tracking-wide text-slate-700 ring-1 ring-inset ring-slate-200">
      <Swatch className={swatch} />
      {shortName}
    </span>
  );
}

/** Filter chip (facility / location focus). */
const chipClasses = (selected: boolean) =>
  cx(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition',
    FOCUS_RING,
    selected ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  );

function Source({ children }: { children: React.ReactNode }) {
  return <p className="mt-0.5 text-[11px] text-slate-500">source: {children}</p>;
}

// ─── Cross-location referrals ─────────────────────────────────────────────────
// Stored in the org referral log (/api/referrals). A cross-location transfer is tagged through sourceName as
// "Cross-location: <from> → <to>": Location ids for new referrals, legacy entity ids (bow/ss/bal/lp) for older ones.
type XferStatus = 'pending' | 'accepted' | 'converted' | 'declined';
type CrossReferral = { id: string; client: string; from: string; to: string; reason: string; date: string; status: XferStatus };
const XFER_PREFIX = 'Cross-location: ';
type ReferralDto = { id: string; patientName: string; sourceName: string; notes: string; referralDate: string; status: XferStatus };

function toCrossReferral(r: ReferralDto): CrossReferral | null {
  if (!r.sourceName?.startsWith(XFER_PREFIX)) return null;
  const [from, to] = r.sourceName.slice(XFER_PREFIX.length).split(' → ');
  if (!from || !to) return null;
  return { id: r.id, client: r.patientName, from, to, reason: r.notes, date: r.referralDate, status: r.status };
}

export default function EnterprisePage() {
  const { activeLocation, isAllLocations } = useLocation();
  const { user } = useAuth();
  // Office Manager reads the overview; links to leadership-only admin pages are shown only to roles that can open them
  const canOpen = (href: string) => canAccessPath(user?.role ?? null, href);
  type TabKey = 'census' | 'overview' | 'financials' | 'staff' | 'programs' | 'referrals';
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  // ?tab=census (sidebar "Practice Overview & Census") opens the Census tab, also when the page is already open
  // (the sidebar link fires altrixs:enterprise-tab; back / forward fire popstate)
  useEffect(() => {
    const TABS = ['census', 'overview', 'financials', 'staff', 'programs', 'referrals'];
    const apply = (tab: string | null | undefined) => {
      if (tab && TABS.includes(tab)) setActiveTab(tab as TabKey);
    };
    apply(new URLSearchParams(window.location.search).get('tab'));
    const onTab = (e: Event) => apply((e as CustomEvent<string>).detail);
    const onPop = () => apply(new URLSearchParams(window.location.search).get('tab'));
    window.addEventListener('altrixs:enterprise-tab', onTab);
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('altrixs:enterprise-tab', onTab);
      window.removeEventListener('popstate', onPop);
    };
  }, []);
  const [focusEntity, setFocusEntity] = useState<string | null>(null);
  const [view, setView] = useState<'facility' | 'location'>('facility');
  const [focusFacility, setFocusFacility] = useState<string | null>(null);
  const byFacility = view === 'facility';
  const [overview, setOverview] = useState<PracticeOverview | null>(null);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [referrals, setReferrals] = useState<CrossReferral[]>([]);
  const [referralsError, setReferralsError] = useState<string | null>(null);
  const [refFormOpen, setRefFormOpen] = useState(false);
  const [refForm, setRefForm] = useState({ client: '', from: '', to: '', reason: '' });
  const [refBusy, setRefBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/locations/overview')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `Could not load the overview (${res.status})`);
        setOverview(data.overview as PracticeOverview);
      })
      .catch((err: unknown) => setOverviewError(err instanceof Error ? err.message : 'Could not load the overview'));
    fetch('/api/referrals?kind=cross_location')
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) throw new Error(data?.error || `Could not load referrals (${res.status})`);
        setReferrals((data.referrals as ReferralDto[]).map(toCrossReferral).filter((r): r is CrossReferral => r !== null));
      })
      .catch((err: unknown) => setReferralsError(err instanceof Error ? err.message : 'Could not load referrals'));
  }, []);

  const entities = useMemo(
    () =>
      (overview?.locations ?? []).map((l, i) => ({
        ...l,
        short: shortOf(l),
        color: FACILITY_PALETTE[i % FACILITY_PALETTE.length],
        swatch: FACILITY_SWATCH[i % FACILITY_SWATCH.length],
      })),
    [overview]
  );
  type Entity = (typeof entities)[number];
  const byId = useMemo(() => new Map(entities.map((e) => [e.id, e])), [entities]);
  const resolveEntity = (ref: string): Entity | null => {
    const direct = byId.get(ref);
    if (direct) return direct;
    const legacy = LEGACY_REFERRAL_IDS[ref];
    return legacy ? entities.find((e) => e.name.toLowerCase() === legacy.toLowerCase()) ?? null : null;
  };

  // Sync with the sidebar location switcher (matched by name)
  useEffect(() => {
    if (isAllLocations || !activeLocation) {
      setFocusEntity(null);
      return;
    }
    const hit = entities.find((e) => e.name.toLowerCase() === activeLocation.name.toLowerCase());
    setFocusEntity(hit?.id ?? null);
  }, [activeLocation, isAllLocations, entities]);

  const displayed = focusEntity ? entities.filter((e) => e.id === focusEntity) : entities;

  const revenueTrend = useMemo(
    () =>
      (overview?.months ?? []).map((m) => {
        const locCents = entities.reduce((n, e) => n + (m.byLocation[e.id]?.chargesCents ?? 0), 0);
        const practiceCents = overview?.facilityView?.practice.months.find((p) => p.month === m.month)?.chargesCents ?? null;
        return {
          month: monthLabel(m.month),
          ...Object.fromEntries(entities.map((e) => [e.id, Math.round((m.byLocation[e.id]?.chargesCents ?? 0) / 100)])),
          // the remainder keeps the bars summing to the practice total
          ...(practiceCents === null ? {} : { __unassigned: Math.round((practiceCents - locCents) / 100) }),
        };
      }),
    [overview, entities]
  );
  const sessionTrend = useMemo(
    () => (overview?.months ?? []).map((m) => ({ month: monthLabel(m.month), ...Object.fromEntries(entities.map((e) => [e.id, m.byLocation[e.id]?.completed ?? 0])) })),
    [overview, entities]
  );

  const submitReferral = async () => {
    const { client, from, to, reason } = refForm;
    if (client.trim().length < 2 || !from || !to || from === to) {
      toast.error('Enter the client name and two different locations.');
      return;
    }
    setRefBusy('new');
    try {
      const res = await fetch('/api/referrals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          direction: 'incoming',
          patientName: client.trim(),
          sourceType: 'other_provider',
          sourceName: `${XFER_PREFIX}${from} → ${to}`,
          referralDate: new Date().toISOString().slice(0, 10),
          notes: reason.trim() || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Could not save referral (${res.status})`);
      const created = toCrossReferral(data.referral);
      if (created) setReferrals((prev) => [created, ...prev]);
      setRefForm({ client: '', from: '', to: '', reason: '' });
      setRefFormOpen(false);
      toast.success('Cross-location referral saved.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not save referral');
    } finally {
      setRefBusy(null);
    }
  };

  const setReferralStatus = async (r: CrossReferral, status: 'accepted' | 'declined') => {
    setRefBusy(r.id);
    try {
      const res = await fetch(`/api/referrals/${encodeURIComponent(r.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) throw new Error(data?.error || `Could not update referral (${res.status})`);
      setReferrals((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: data.referral.status } : x)));
      toast.success(`Referral ${status}.`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not update referral');
    } finally {
      setRefBusy(null);
    }
  };

  const entityBadge = (refId: string, key?: string) => {
    const e = resolveEntity(refId);
    if (!e) return <span key={key} className="text-xs text-slate-500">Unknown location</span>;
    return (
      <span key={key} className="inline-flex items-center gap-1.5 rounded-full bg-white py-0.5 pl-0.5 pr-2.5 text-xs font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
        <EntityLogo shortName={e.short} swatch={e.swatch} /> {e.name}
      </span>
    );
  };

  const t = overview?.totals;
  const fv = overview?.facilityView ?? null;
  // Practice total minus the location sums: money on rows with no facility, program facilities or unmapped ones
  const notAtLocation = fv && overview
    ? (() => {
        const p = fv.practice.valant90;
        const sumL = (f: (l: Loc) => number) => overview.locations.reduce((n, l) => n + f(l), 0);
        return {
          rows: fv.practice.rows90 - sumL((l) => l.valant.last90.rows),
          chargesCents: p.chargesCents - sumL((l) => l.valant.last90.chargesCents),
          paymentsCents: p.insurancePaymentsCents + p.patientPaymentsCents - sumL((l) => l.valant.last90.paymentsCents),
          adjustmentsCents: p.adjustmentsCents - sumL((l) => l.valant.last90.adjustmentsCents),
        };
      })()
    : null;
  const facilityChips = fv ? fv.sites.map((s, i) => ({ name: s.facilityName, swatch: FACILITY_SWATCH[i % FACILITY_SWATCH.length] })) : [];

  return (
    <Page>
      <PageHeader
        title={`${overview?.organizationName ?? 'Practice'} — Practice Overview`}
        description={
          <>
            {byFacility ? "Per-facility figures (the practice's Valant facilities)" : 'Per-location figures'} from Altrixs data and imported Valant reference data. NPI and tax ID:{' '}
            <Link href="/dashboard/practice-setup" className={LINK}>Practice settings</Link>.
          </>
        }
        actions={
          <>
            <Tabs
              variant="pill"
              label="Group by"
              controlsPanels={false}
              value={view}
              onChange={setView}
              items={[
                { key: 'facility', label: 'By facility' },
                { key: 'location', label: 'By Altrixs location' },
              ]}
            />
            {canOpen('/dashboard/admin/locations') ? (
              <Link href="/dashboard/admin/locations" className={buttonClasses()}>
                <Settings size={16} aria-hidden /> Manage locations
              </Link>
            ) : null}
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          {byFacility ? (
            <>
              <button type="button" onClick={() => setFocusFacility(null)} aria-pressed={!focusFacility} className={chipClasses(!focusFacility)}>
                All facilities ({facilityChips.length})
              </button>
              {facilityChips.map((f) => (
                <button
                  key={f.name}
                  type="button"
                  onClick={() => setFocusFacility(focusFacility === f.name ? null : f.name)}
                  aria-pressed={focusFacility === f.name}
                  className={chipClasses(focusFacility === f.name)}
                >
                  <Swatch className={f.swatch} />
                  {f.name}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setFocusEntity(null)} aria-pressed={!focusEntity} className={chipClasses(!focusEntity)}>
                All Locations ({entities.length})
              </button>
              {entities.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setFocusEntity(focusEntity === e.id ? null : e.id)}
                  aria-pressed={focusEntity === e.id}
                  className={chipClasses(focusEntity === e.id)}
                >
                  <Swatch className={e.swatch} />
                  {e.name}
                </button>
              ))}
            </>
          )}
        </div>
      </PageHeader>

      {overviewError ? <Alert tone="danger">Could not load the practice overview: {overviewError}</Alert> : null}
      {!overview && !overviewError ? (
        <Card>
          <LoadingState label="Loading the practice overview…" />
        </Card>
      ) : null}

      {/* Data checks */}
      {overview?.warnings.length ? (
        <Alert tone="warning" title="Data checks" icon={false}>
          <ul className="mt-1.5 space-y-1.5">
            {overview.warnings.map((w) => (
              <li key={w.code} className="flex items-start gap-2 text-xs text-slate-700">
                {w.level === 'warning' ? (
                  <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-700" />
                ) : (
                  <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-500" />
                )}
                <span>
                  {w.message} {w.href && canOpen(w.href) ? <Link href={w.href} className={LINK}>Review</Link> : null}
                </span>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* Practice KPIs */}
      {fv && byFacility && !focusFacility ? (
        <StatGrid columns={5}>
          <StatCard icon={<Users />} tone="brand" label="Clients at a facility" value={fmtN(fv.totals.assignedClients)} hint={`${fmtN(fv.totals.activeClients)} active · Valant assigned facility`} />
          <StatCard icon={<UserCheck />} tone="success" label="Facilities" value={fmtN(fv.sites.length)} hint={fv.source === 'expected' ? 'facility list not imported' : 'from the Valant facility list'} />
          <StatCard icon={<CalendarDays />} tone="info" label="Visits billed" value={fmtN(fv.totals.visits90)} hint="Last 90 days (Valant journal)" />
          <StatCard icon={<DollarSign />} tone="brand" label="Valant charges" value={fmt$(fv.practice.valant90.chargesCents)} hint={`Last 90 days, whole practice · ${fmt$(fv.totals.charges90Cents)} at a facility`} />
          <StatCard icon={<CheckCircle2 />} tone="success" label="Net collections" value={fmt$(fv.practice.valant90.netCollectionsCents)} hint={`Last 90 days, whole practice · ${fmt$(fv.totals.payments90Cents)} at a facility`} />
        </StatGrid>
      ) : null}
      {t && !focusEntity && !byFacility ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard icon={<Users />} tone="brand" label="Active clients" value={fmtN(t.activeClients)} hint={`${fmtN(t.clients)} clients on file`} />
          <StatCard icon={<UserCheck />} tone="success" label="Staff" value={fmtN(t.staff)} hint="Active staff with a location link" />
          <StatCard icon={<CalendarDays />} tone="info" label="Completed visits" value={fmtN(t.completed90)} hint="Last 90 days (Altrixs schedule)" />
          <StatCard icon={<AlertTriangle />} tone="danger" label="No-show rate" value={pct(t.noShowRate90)} hint="No-shows / (completed + no-show + late cancel), 90 days" />
          <StatCard icon={<DollarSign />} tone="brand" label="Valant charges" value={fmt$(fv ? fv.practice.valant90.chargesCents : t.charges90Cents)} hint={fv ? 'Last 90 days, whole practice' : 'Last 90 days, location facilities'} />
          <StatCard icon={<CheckCircle2 />} tone="success" label="Valant payments" value={fmt$(fv ? fv.practice.valant90.netCollectionsCents : t.payments90Cents)} hint={fv ? 'Last 90 days, whole practice' : 'Last 90 days, location facilities'} />
        </div>
      ) : null}

      {/* Tabs */}
      <Tabs
        label="Practice overview sections"
        controlsPanels={false}
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'census', label: 'Census' },
          { key: 'overview', label: 'Overview' },
          { key: 'financials', label: 'Financials' },
          { key: 'staff', label: 'Staff' },
          { key: 'programs', label: 'Programs' },
          { key: 'referrals', label: 'Referrals' },
        ]}
      />

      {/* ── CENSUS ── */}
      {activeTab === 'census' ? <CensusTab locationId={focusEntity} grouping={view} facility={focusFacility} /> : null}

      {/* ── OVERVIEW ── */}
      {activeTab === 'overview' && overview && byFacility ? (
        fv ? <FacilityOverviewCards fv={fv} focus={focusFacility} canOpen={canOpen} /> : <p className="text-sm text-slate-500">Facility view is not available.</p>
      ) : null}
      {activeTab === 'overview' && overview && !byFacility ? (
        <div className="space-y-4">
          {fv ? <UnrecordedBanner fv={fv} canOpen={canOpen} /> : null}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {displayed.map((e) => {
              const a = e.appointments.last90;
              return (
                <Card key={e.id} className="overflow-hidden">
                  <div className="border-b border-slate-200 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <EntityLogo shortName={e.short} swatch={e.swatch} />
                          {e.isPrimary ? <StatusBadge size="sm" tone="brand">Primary location</StatusBadge> : null}
                          {!e.active ? <StatusBadge size="sm" tone="neutral">Inactive</StatusBadge> : null}
                        </div>
                        <h3 className="text-sm font-semibold leading-snug text-slate-900">{e.name}</h3>
                        <p className="mt-1 flex items-center gap-1 text-xs text-slate-500">
                          <MapPin size={12} aria-hidden className="shrink-0 text-slate-400" />
                          {[e.addressLine1, e.city, e.state].filter(Boolean).join(', ') || 'No address on file'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-lg font-semibold tabular-nums tracking-tight text-slate-900">{fmt$(e.valant.last90.chargesCents)}</p>
                        <p className="text-xs text-slate-500">Valant charges, 90 days</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
                    {[
                      { label: 'Active clients', value: fmtN(e.clients.active), src: `${fmtN(e.clients.total)} total · client home location` },
                      { label: 'New clients (30 / 90 d)', value: `${fmtN(e.clients.newIn30)} / ${fmtN(e.clients.newIn90)}`, src: 'created in Altrixs (imports excluded)' },
                      { label: 'Completed visits (90 d)', value: fmtN(a.completed), src: e.sources.appointments },
                      { label: 'No-show rate (90 d)', value: pct(a.noShowRate), src: `${fmtN(a.noShow)} no-shows · ${fmtN(e.appointments.upcoming30)} booked next 30 d` },
                      { label: 'Staff', value: `${fmtN(e.staff.count)}${e.staff.shared ? ` (${e.staff.shared} shared)` : ''}`, src: 'staff location links' },
                      { label: 'Valant payments (90 d)', value: fmt$(e.valant.last90.paymentsCents), src: e.sources.valant },
                    ].map((c) => (
                      <div key={c.label} className="p-3.5 text-center">
                        <p className="text-base font-semibold tabular-nums text-slate-900">{c.value}</p>
                        <p className="mt-0.5 text-xs text-slate-600">{c.label}</p>
                        <Source>{c.src}</Source>
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
          {overview.unassigned.clients > 0 || overview.unassigned.appointments90 > 0 ? (
            <p className="text-xs text-slate-500">
              Not at any location: {fmtN(overview.unassigned.clients)} clients, {fmtN(overview.unassigned.appointments90)} appointments in the last 90 days.
            </p>
          ) : null}
          <Card>
            <CardHeader title="Practice actions" />
            <CardBody className="flex flex-wrap gap-2">
              {[
                { label: 'Outcomes & reports', Icon: BarChart3, href: '/dashboard/reports' },
                { label: 'Staff', Icon: Users, href: '/dashboard/hr' },
                { label: 'Billing', Icon: DollarSign, href: '/dashboard/billing' },
                { label: 'Locations & mapping', Icon: Settings, href: '/dashboard/admin/locations' },
              ].filter((a) => canOpen(a.href)).map((a) => (
                <Link key={a.label} href={a.href} className={buttonClasses({ variant: 'secondary' })}>
                  <a.Icon size={16} aria-hidden /> {a.label}
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {/* ── FINANCIALS ── */}
      {activeTab === 'financials' && overview && byFacility && fv ? <FacilityFinancials fv={fv} focus={focusFacility} canOpen={canOpen} /> : null}
      {activeTab === 'financials' && overview && !byFacility ? (
        <div className="space-y-5">
          {fv ? <UnrecordedBanner fv={fv} canOpen={canOpen} /> : null}
          {fv && !focusEntity ? <PracticeFinancialsPanel fv={fv} /> : null}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {displayed.map((e) => (
              <Card key={e.id} className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <EntityLogo shortName={e.short} swatch={e.swatch} />
                  <p className="text-sm font-semibold text-slate-900">{e.name}</p>
                </div>
                <p className="text-2xl font-semibold tabular-nums text-slate-900">{fmt$(e.valant.last90.chargesCents)}</p>
                <p className="mt-0.5 text-xs text-slate-500">Valant charges, last 90 days ({fmtN(e.valant.last90.chargeCount)} charge lines)</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">Payments</p>
                    <p className="font-semibold tabular-nums text-slate-900">{fmt$(e.valant.last90.paymentsCents)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">Adjustments</p>
                    <p className="font-semibold tabular-nums text-slate-900">{fmt$(e.valant.last90.adjustmentsCents)}</p>
                  </div>
                </div>
                <Source>{e.sources.valant}</Source>
              </Card>
            ))}
            {notAtLocation && !focusEntity && notAtLocation.rows > 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-5 shadow-xs">
                <p className="mb-3 text-sm font-semibold text-slate-700">Not assigned to a location</p>
                <p className="text-2xl font-semibold tabular-nums text-slate-700">{fmt$(notAtLocation.chargesCents)}</p>
                <p className="mt-0.5 text-xs text-slate-500">Valant charges, last 90 days ({fmtN(notAtLocation.rows)} rows)</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">Payments</p>
                    <p className="font-semibold tabular-nums text-slate-900">{fmt$(notAtLocation.paymentsCents)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <p className="text-slate-500">Adjustments</p>
                    <p className="font-semibold tabular-nums text-slate-900">{fmt$(notAtLocation.adjustmentsCents)}</p>
                  </div>
                </div>
                <Source>practice total minus the locations: facility not recorded, program facilities (Programs tab) or unmapped facilities</Source>
              </div>
            ) : null}
          </div>
          <Card>
            <CardHeader title="Valant charges by month and location" description="Service month; facilities mapped to a location only (programs on the Programs tab)." />
            <CardBody>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={revenueTrend} barSize={18} barCategoryGap="30%">
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
                  <Tooltip formatter={(v) => `$${Number(v).toLocaleString('en-US')}`} />
                  <Legend />
                  {displayed.map((e) => (
                    <Bar key={e.id} dataKey={e.id} name={e.name} fill={e.color} radius={[4, 4, 0, 0]} />
                  ))}
                  {fv && !focusEntity ? <Bar dataKey="__unassigned" name="Not assigned to a location" fill={UNASSIGNED_COLOR} radius={[4, 4, 0, 0]} /> : null}
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Completed visits per month" description="Altrixs schedule; location from the appointment, else inferred from the client's home location." />
            <CardBody>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={sessionTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend />
                  {displayed.map((e) => (
                    <Line key={e.id} type="monotone" dataKey={e.id} name={e.name} stroke={e.color} strokeWidth={2} dot={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Valant facilities" />
            <CardBody>
              {overview.facilities.length === 0 ? (
                <p className="text-xs text-slate-500">No imported Valant rows carry a facility yet.</p>
              ) : (
                <ul className="space-y-1 text-xs text-slate-700">
                  {overview.facilities.map((f) => (
                    <li key={f.facility} className="flex flex-wrap items-center gap-1">
                      <span className="font-semibold">{f.facility}</span>
                      <ArrowRight size={12} aria-label="maps to" className="text-slate-400" />
                      <span>{f.mappedTo} · {fmtN(f.rows)} rows (6 months){f.needsConfirmation ? ' · to confirm' : ''}</span>
                    </li>
                  ))}
                </ul>
              )}
              {overview.noFacilityRows90 > 0 ? (
                <p className="mt-2 text-xs text-slate-500">{fmtN(overview.noFacilityRows90)} Valant rows in the last 90 days have no facility (Transactions report rows not on the journal).</p>
              ) : null}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {byFacility && (activeTab === 'staff' || activeTab === 'programs' || activeTab === 'referrals') ? (
        <p className="text-xs text-slate-500">Staff links, programs and referrals are kept by Altrixs location.</p>
      ) : null}

      {/* ── STAFF ── */}
      {activeTab === 'staff' && overview ? (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {displayed.map((e) => (
              <Card key={e.id} className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <EntityLogo shortName={e.short} swatch={e.swatch} />
                  <p className="text-sm font-semibold text-slate-900">{e.name}</p>
                </div>
                <p className="mb-1 text-2xl font-semibold tabular-nums text-slate-900">{fmtN(e.staff.count)}</p>
                <p className="text-xs text-slate-500">Active staff linked to this location{e.staff.shared ? ` (${e.staff.shared} also at another)` : ''}</p>
                <div className="mt-3 space-y-1 text-xs text-slate-600">
                  <p className="flex items-center gap-1.5"><CalendarDays size={12} aria-hidden className="text-slate-400" /> {fmtN(e.appointments.last90.completed)} completed visits, 90 days</p>
                  <p className="flex items-center gap-1.5"><Users size={12} aria-hidden className="text-slate-400" /> {fmtN(e.clients.active)} active clients</p>
                </div>
              </Card>
            ))}
          </div>
          <Card className="overflow-hidden">
            <CardHeader title="Staff at more than one location" description="From staff location links. FTE split is not recorded." />
            <div className="divide-y divide-slate-100">
              {overview.sharedStaff.length === 0 ? (
                <EmptyState compact title="No staff member is linked to more than one location." />
              ) : (
                overview.sharedStaff.map((s) => (
                  <div key={s.userId} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-slate-50">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">{s.role}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {s.locationIds.map((id) => entityBadge(id, id))}
                    </div>
                  </div>
                ))
              )}
            </div>
            <CardFooter className="justify-start">
              <Link href="/dashboard/hr" className={cx('inline-flex items-center gap-1 text-xs', LINK)}>
                Manage staff locations <ArrowRight size={14} aria-hidden />
              </Link>
            </CardFooter>
          </Card>
        </div>
      ) : null}

      {/* ── PROGRAMS ── */}
      {activeTab === 'programs' && overview ? (
        <div className="space-y-4">
          {overview.programs.length === 0 ? (
            <Card className="p-6 text-sm text-slate-500">
              No Valant facility is mapped to a program yet. Map Family Practice and IOP on{' '}
              <Link href="/dashboard/admin/locations#mapping" className={LINK}>Admin › Locations</Link>.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {overview.programs.map((p) => (
                <Card key={p.programKey} className="p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <Layers size={16} aria-hidden className="text-blue-600" />
                    <p className="text-sm font-semibold text-slate-900">{p.label}</p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums text-slate-900">{fmtN(p.clients)}</p>
                  <p className="text-xs text-slate-500">
                    {p.facilities.length ? `clients with Valant journal rows at ${p.facilities.join(', ')}` : 'no Valant facility mapped to this program'}
                  </p>
                  {p.enrollments ? (
                    <p className="mt-1 text-xs text-slate-600">
                      Altrixs PRP enrollments: <strong>{fmtN(p.enrollments.total)}</strong>
                      {Object.keys(p.enrollments.byStatus).length
                        ? ` (${Object.entries(p.enrollments.byStatus).map(([k, v]) => `${k} ${fmtN(v)}`).join(', ')})`
                        : ''}
                      {p.enrollments.byHomeLocation.length
                        ? ` · by home location: ${p.enrollments.byHomeLocation.map((h) => `${h.locationId ? byId.get(h.locationId)?.name ?? 'Unknown' : 'No location'} ${fmtN(h.clients)}`).join(', ')}`
                        : ''}
                    </p>
                  ) : null}
                  {p.programKey === 'prp' ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Valant&apos;s client export can assign clients to the &quot;MD Behavioral Health - PRP&quot; facility; the client import keeps only the facility city, so those clients are not counted here.
                    </p>
                  ) : null}
                  {p.intakeFlagged !== null ? <p className="mt-1 text-xs text-slate-500">{fmtN(p.intakeFlagged)} clients created through primary-care intake</p> : null}
                  <p className="mt-2 text-xs text-slate-600">Valant charges, 90 days: <strong>{fmt$(p.last90.chargesCents)}</strong> · payments {fmt$(p.last90.paymentsCents)}</p>
                  {p.byHomeLocation.length ? (
                    <div className="mt-3">
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">By client home location</p>
                      <ul className="space-y-0.5 text-xs text-slate-700">
                        {p.byHomeLocation.map((h) => (
                          <li key={h.locationId ?? 'none'}>{h.locationId ? byId.get(h.locationId)?.name ?? 'Unknown' : 'No location'}: {fmtN(h.clients)}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* ── REFERRALS ── */}
      {activeTab === 'referrals' ? (
        <div className="space-y-5">
          <Card className="overflow-hidden">
            <CardHeader
              title="Cross-Location Referrals"
              description="Clients moving between locations for step-up / step-down care"
              actions={
                <Button variant="secondary" size="sm" icon={refFormOpen ? undefined : <Plus />} onClick={() => setRefFormOpen((o) => !o)}>
                  {refFormOpen ? 'Cancel' : 'New Referral'}
                </Button>
              }
            />
            {refFormOpen ? (
              <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:grid-cols-2">
                <input value={refForm.client} onChange={(e) => setRefForm((f) => ({ ...f, client: e.target.value }))} placeholder="Client name" aria-label="Client name" className={inputClasses} />
                <input value={refForm.reason} onChange={(e) => setRefForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Reason (step-up / step-down, program)" aria-label="Reason" className={inputClasses} />
                <select value={refForm.from} onChange={(e) => setRefForm((f) => ({ ...f, from: e.target.value }))} aria-label="From location" className={inputClasses}>
                  <option value="">From location…</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <select value={refForm.to} onChange={(e) => setRefForm((f) => ({ ...f, to: e.target.value }))} aria-label="To location" className={inputClasses}>
                  <option value="">To location…</option>
                  {entities.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <div className="flex justify-end sm:col-span-2">
                  <Button size="sm" onClick={submitReferral} disabled={refBusy === 'new'}>
                    {refBusy === 'new' ? 'Saving…' : 'Save Referral'}
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="divide-y divide-slate-100">
              {referralsError ? (
                <div className="px-5 py-4">
                  <Alert tone="danger">Could not load referrals: {referralsError}</Alert>
                </div>
              ) : null}
              {referrals.length === 0 && !referralsError ? <EmptyState compact title="No cross-location referrals yet." /> : null}
              {referrals.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-4 px-5 py-4 hover:bg-slate-50">
                  <div aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                    {r.client.split(' ').map((w: string) => w[0]).join('')}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{r.client}</p>
                    <p className="text-xs text-slate-500">{r.reason}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{r.date}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {entityBadge(r.from)}
                    <ArrowRight size={14} aria-label="to" className="text-slate-400" />
                    {entityBadge(r.to)}
                  </div>
                  {r.status === 'accepted' || r.status === 'converted' ? (
                    <StatusBadge tone="success" icon={<CheckCircle2 />}>Accepted</StatusBadge>
                  ) : r.status === 'declined' ? (
                    <StatusBadge tone="danger">Declined</StatusBadge>
                  ) : (
                    <StatusBadge tone="warning">Pending</StatusBadge>
                  )}
                  {r.status === 'pending' ? (
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => setReferralStatus(r, 'accepted')} disabled={refBusy === r.id}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" className="text-rose-700 hover:bg-rose-50 hover:text-rose-800" onClick={() => setReferralStatus(r, 'declined')} disabled={refBusy === r.id}>
                        Decline
                      </Button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>
        </div>
      ) : null}
    </Page>
  );
}
