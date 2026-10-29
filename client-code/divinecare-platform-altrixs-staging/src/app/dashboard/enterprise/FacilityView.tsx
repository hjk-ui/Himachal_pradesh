'use client';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import { Building2, Info, Layers, Upload } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader, cx } from '@/components/ui';
import type { FacilityBreakdownExtra, FacilityOverview, FacilitySite } from '@/lib/locations/facilityOverview';

// Practice overview "By facility": the practice's Valant facilities. Every figure comes from
// /api/locations/overview (overview.facilityView); a facility that is only expected shows no figures.

// Chart series colours (Recharts needs hex): brand, emerald, sky, amber, rose, slate.
// FACILITY_SWATCH holds the matching Tailwind classes (same index) for legend dots in chips and table rows.
export const FACILITY_PALETTE = ['#5C2D91', '#059669', '#0284C7', '#D97706', '#E11D48', '#334155', '#64748B'];
export const FACILITY_SWATCH = ['bg-blue-600', 'bg-emerald-600', 'bg-sky-600', 'bg-amber-600', 'bg-rose-600', 'bg-slate-700', 'bg-slate-500'];
export const UNASSIGNED_COLOR = '#94A3B8';
export const UNASSIGNED_SWATCH = 'bg-slate-400';
export const GRID_STROKE = '#F1F5F9';

/** Small series-colour dot tying a facility or location to its chart colour (decorative). */
export function Swatch({ className }: { className: string }) {
  return <span aria-hidden className={cx('inline-block h-2.5 w-2.5 shrink-0 rounded-full', className)} />;
}

const LINK = 'font-semibold text-blue-700 hover:underline';
const TH = 'whitespace-nowrap px-4 py-2.5 text-xs font-semibold text-slate-600';
/** Pinned first column for the wide facility tables (they scroll sideways on tablets and phones). */
const STICKY_CELL = 'sticky left-0 z-10';
const STICKY_HEAD = 'sticky left-0 z-10 bg-slate-50';
const TD = 'whitespace-nowrap px-4 py-2 text-right tabular-nums';

const fmtN = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString('en-US'));
const fmt$ = (cents: number) => `${cents < 0 ? '-' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`;
const pct = (r: number | null | undefined) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(1)}%`);
const rateOf = (r: unknown): number | null => {
  if (typeof r === 'number') return r;
  if (r && typeof r === 'object' && 'value' in r) {
    const v = (r as { value: unknown }).value;
    return typeof v === 'number' ? v : null;
  }
  return null;
};
const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
};

function Cell({ label, value, src }: { label: string; value: string; src: string }) {
  return (
    <div className="p-3 text-center">
      <p className="text-base font-semibold tabular-nums text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-600">{label}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">source: {src}</p>
    </div>
  );
}

function Notes({ fv, canOpen }: { fv: FacilityOverview; canOpen: (href: string) => boolean }) {
  const ca = fv.clientAssignment;
  return (
    <div className="space-y-2">
      {fv.source === 'expected' ? (
        <Alert tone="warning">
          The Valant facility list has not been imported. The facilities below are expected from Valant; they show no figures until the list is imported.{' '}
          {canOpen(fv.links.facilityImport) ? (
            <Link href={fv.links.facilityImport} className={LINK}>Import facilities (Admin › Data import)</Link>
          ) : (
            'Ask practice leadership to import facilities (Admin › Data import).'
          )}
        </Alert>
      ) : null}
      {ca.column && ca.clientsTotal > 0 && ca.withoutFacility > 0 ? (
        <Alert tone="neutral" icon={<Upload />}>
          {fmtN(ca.withoutFacility)} of {fmtN(ca.clientsTotal)} clients have no Valant facility. The client import did not keep the facility before, so it cannot be filled in from
          stored data: re-import the Valant client file with &quot;Facility only&quot; to capture it.{' '}
          {canOpen(fv.links.clientImport) ? <Link href={fv.links.clientImport} className={LINK}>Data import › Clients</Link> : null}
        </Alert>
      ) : null}
      {!ca.column ? (
        <p className="text-xs text-amber-800">Client facility is not in this database yet (migration 20261019_client_valant_facility.sql); clients and appointments per facility show —.</p>
      ) : null}
      {ca.ambiguous.map((a) => (
        <p key={a.value} className="flex items-start gap-2 text-xs text-slate-600">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
          <span>
            {fmtN(a.clients)} clients are assigned to &quot;{a.value}&quot; in Valant, a billing entity with several facilities ({a.candidates.join(', ')}); they are not counted at any one of them.
          </span>
        </p>
      ))}
      {ca.unmatched.length ? (
        <p className="flex items-start gap-2 text-xs text-slate-600">
          <Info size={14} aria-hidden className="mt-0.5 shrink-0 text-slate-400" />
          <span>Client facility values not in the facility list: {ca.unmatched.map((u) => `"${u.value}" (${fmtN(u.clients)})`).join(', ')}.</span>
        </p>
      ) : null}
    </div>
  );
}

function ExpectedCards({ fv }: { fv: FacilityOverview }) {
  if (!fv.expected.length) return null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
      {fv.expected.map((e) => (
        <div key={e.facilityName} className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
          <div className="mb-1 flex items-center gap-2">
            <Building2 size={14} aria-hidden className="text-slate-400" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Expected from Valant · not imported</span>
          </div>
          <h3 className="text-sm font-semibold text-slate-700">{e.facilityName}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{e.billingEntityName} · {e.timezone} · {e.active ? 'Active' : 'Inactive'} in Valant</p>
          <p className="mt-2 text-xs text-slate-500">No figures until the facility list is imported.</p>
        </div>
      ))}
    </div>
  );
}

function SiteCard({ s, swatch, fv, canOpen }: { s: FacilitySite; swatch: string; fv: FacilityOverview; canOpen: (href: string) => boolean }) {
  const m = s.money90;
  const a = s.appointments.last90;
  const p = s.program;
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              <Swatch className={swatch} />
              <span>{s.billingEntityName ?? 'No billing entity on file'}</span>
              {s.timezone ? <span>· {s.timezone}</span> : null}
              {s.active === false ? <span className="font-semibold text-rose-700">· Inactive in Valant</span> : s.active ? <span>· Active</span> : null}
            </div>
            <h3 className="text-sm font-semibold leading-snug text-slate-900">{s.facilityName}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Altrixs: {s.mappedTo}
              {s.needsConfirmation ? ' (to confirm)' : ''}
            </p>
            {s.separateBillingEntity ? (
              <p className="mt-1 text-xs text-slate-600">
                Bills as {s.billingEntityName}, not {fv.mainBillingEntity}: confirm its billing provider and NPI in{' '}
                {canOpen(fv.links.billingProviders) ? (
                  <Link href={fv.links.billingProviders} className={LINK}>Practice settings › Billing providers</Link>
                ) : (
                  'Practice settings › Billing providers'
                )}
                .
              </p>
            ) : null}
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular-nums tracking-tight text-slate-900">{fmt$(m.chargesCents)}</p>
            <p className="text-xs text-slate-500">Valant charges, 90 days</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
        <Cell
          label="Clients assigned (active)"
          value={s.clients ? `${fmtN(s.clients.assigned)} (${fmtN(s.clients.active)})` : '—'}
          src={s.clients ? `Valant assigned facility${s.clients.viaBillingEntity ? `; ${fmtN(s.clients.viaBillingEntity)} via billing entity` : ''}` : 'client facility not available'}
        />
        <Cell label="New clients (30 / 90 d)" value={`${fmtN(s.newClients.first30)} / ${fmtN(s.newClients.first90)}`} src="first journal charge at this facility" />
        <Cell label="Visits billed (90 d)" value={fmtN(s.billed90.visits)} src={`${fmtN(s.billed90.clients)} clients · journal`} />
        <Cell label="Payments (90 d)" value={fmt$(m.netCollectionsCents)} src={`net collections · ${pct(rateOf(m.collectionRate))} of charges`} />
        <Cell label="Adjustments (90 d)" value={fmt$(m.adjustmentsCents)} src="insurance + patient adjustments" />
        <Cell
          label="Completed visits (90 d)"
          value={s.clients ? fmtN(a.completed) : '—'}
          src={s.clients ? `inferred from client facility · no-show ${pct(a.noShowRate)} · ${fmtN(s.appointments.upcoming30)} booked next 30 d` : 'client facility not available'}
        />
      </div>
      {s.payerMix.length ? (
        <div className="border-t border-slate-100 px-4 py-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Payer mix, charges 90 d</p>
          <ul className="space-y-0.5 text-xs text-slate-700">
            {s.payerMix.map((r) => (
              <li key={r.payer} className="flex justify-between gap-2">
                <span className="truncate">{r.payer}</span>
                <span className="tabular-nums">{fmt$(r.chargesCents)}{m.chargesCents > 0 ? ` · ${((r.chargesCents / m.chargesCents) * 100).toFixed(0)}%` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {p ? (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-700">
          <p className="mb-0.5 flex items-center gap-1.5 font-semibold text-slate-900"><Layers size={14} aria-hidden className="text-blue-600" /> {p.label}</p>
          {'enrollments' in p ? (
            <>
              <p>
                Enrollments: <strong>{fmtN(p.enrollments.total)}</strong>
                {Object.keys(p.enrollments.byStatus).length ? ` (${Object.entries(p.enrollments.byStatus).map(([k, v]) => `${k} ${fmtN(v)}`).join(', ')})` : ''}
                {' '}· attendance 90 d: <strong>{fmtN(p.attendance90.encounters)}</strong> encounters, {fmtN(p.attendance90.clients)} clients
              </p>
              <p className="text-[11px] text-slate-500">source: {p.source}</p>
            </>
          ) : 'activePatients' in p ? (
            <>
              <p>Active primary-care patients: <strong>{fmtN(p.activePatients)}</strong> · medical visits 90 d: <strong>{fmtN(p.visits90)}</strong></p>
              <p className="text-[11px] text-slate-500">source: {p.source}</p>
            </>
          ) : (
            <p className="text-slate-500">{p.note}</p>
          )}
        </div>
      ) : null}
    </Card>
  );
}

/** "N transactions ($X) have no facility" banner; nothing when every row has a facility. */
export function UnrecordedBanner({ fv, canOpen }: { fv: FacilityOverview; canOpen: (href: string) => boolean }) {
  const nr = fv.practice.notRecorded;
  if (nr.rows <= 0) return null;
  return (
    <Alert tone="warning">
      {fmtN(nr.rows)} Valant transactions in the last 90 days ({fmt$(nr.chargesCents)} charges, {fmt$(nr.paymentsCents)} payments) have no facility. They are counted in the practice
      totals and under &quot;Facility not recorded&quot; below. Import the Valant Transaction Journal (Admin › Data import) to split them by facility.{' '}
      {canOpen(fv.links.journalImport) ? <Link href={fv.links.journalImport} className={LINK}>Import the Transaction Journal</Link> : null}
    </Alert>
  );
}

/** Practice-wide financials: every Valant row (whatever its facility) plus Altrixs live billing. */
export function PracticeFinancialsPanel({ fv }: { fv: FacilityOverview }) {
  const p = fv.practice;
  const k = p.valant90;
  const trend = p.months.map((m) => ({
    month: monthLabel(m.month),
    Charges: Math.round(m.chargesCents / 100),
    Payments: Math.round(m.paymentsCents / 100),
    Adjustments: Math.round(m.adjustmentsCents / 100),
  }));
  const tiles = [
    { label: 'Charges', value: fmt$(k.chargesCents), sub: `${fmtN(k.chargeCount)} charge lines` },
    { label: 'Insurance payments', value: fmt$(k.insurancePaymentsCents), sub: 'Valant insurance payments' },
    { label: 'Patient payments', value: fmt$(k.patientPaymentsCents), sub: 'refunds netted' },
    { label: 'Adjustments', value: fmt$(k.adjustmentsCents), sub: 'insurance + patient' },
    { label: 'Net collections', value: fmt$(k.netCollectionsCents), sub: 'insurance + patient payments' },
    { label: 'Collection rate', value: pct(rateOf(k.collectionRate)), sub: 'net collections ÷ charges' },
    { label: 'Visits billed', value: fmtN(k.visitsBilled), sub: p.billedClients90 === null ? 'patient + date of service' : `${fmtN(p.billedClients90)} patients` },
  ];
  return (
    <Card>
      <CardHeader
        title="Practice totals, last 90 days"
        description={`All imported Valant rows by date of service, whatever their facility (${fmtN(p.rows90)} rows). Altrixs live billing is shown separately, never added in.`}
      />
      <CardBody className="space-y-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          {tiles.map((t) => (
            <div key={t.label} className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs text-slate-600">{t.label}</p>
              <p className="text-sm font-semibold tabular-nums text-slate-900">{t.value}</p>
              <p className="text-[11px] text-slate-500">{t.sub}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <p className="mb-2 text-xs font-semibold text-slate-700">By service month (6 months)</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trend} barSize={12} barCategoryGap="25%">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
                <Tooltip formatter={(v) => `$${Number(v).toLocaleString('en-US')}`} />
                <Legend />
                <Bar dataKey="Charges" fill={FACILITY_PALETTE[0]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Payments" fill={FACILITY_PALETTE[1]} radius={[4, 4, 0, 0]} />
                <Bar dataKey="Adjustments" fill={FACILITY_PALETTE[3]} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold text-slate-700">Payer mix (charges)</p>
            {p.payerMix.length && p.payerRowsWithInsurance > 0 ? (
              <ul className="space-y-0.5 text-xs text-slate-700">
                {p.payerMix.map((r) => (
                  <li key={r.payer} className="flex justify-between gap-2">
                    <span className="truncate">{r.payer}</span>
                    <span className="tabular-nums">{fmt$(r.chargesCents)}{k.chargesCents > 0 ? ` · ${((r.chargesCents / k.chargesCents) * 100).toFixed(0)}%` : ''}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">No insurance on the imported rows: payer mix needs the Valant Transaction Journal (it carries the insurance). See Billing for payer A/R.</p>
            )}
            <p className="mb-1 mt-4 text-xs font-semibold text-slate-700">Altrixs live billing (90 days)</p>
            {p.altrixs ? (
              <p className="text-xs text-slate-600">
                {fmtN(p.altrixs.claims.submitted)} claims sent ({fmt$(p.altrixs.claims.billedCents)}), {fmtN(p.altrixs.claims.paid)} paid ({fmt$(p.altrixs.claims.paidCents)})
                {p.altrixs.payments ? ` · payments posted ${fmt$(p.altrixs.payments.totalCents)}` : ''}
                {p.altrixs.claims.total === 0 ? ' · no Altrixs claims yet (claims start after go-live)' : ''}
              </p>
            ) : (
              <p className="text-xs text-slate-500">Altrixs claims could not be read.</p>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

function ExtraCard({ x }: { x: FacilityBreakdownExtra }) {
  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-slate-300 bg-white shadow-xs">
      <div className="border-b border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-700">{x.label}</h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {x.key === 'not_recorded' ? 'Valant rows without a facility (not split until the Transaction Journal is imported)' : 'Journal facilities that are not in the imported facility list'}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-lg font-semibold tabular-nums tracking-tight text-slate-700">{fmt$(x.money90.chargesCents)}</p>
            <p className="text-xs text-slate-500">Valant charges, 90 days</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 divide-x divide-y divide-slate-100">
        <Cell label="Transactions (90 d)" value={fmtN(x.rows90)} src="Valant rows" />
        <Cell label="Visits billed (90 d)" value={fmtN(x.visits90)} src="patient + date of service" />
        <Cell label="Payments (90 d)" value={fmt$(x.money90.netCollectionsCents)} src="insurance + patient" />
        <Cell label="Adjustments (90 d)" value={fmt$(x.money90.adjustmentsCents)} src="insurance + patient" />
      </div>
    </div>
  );
}

export function FacilityOverviewCards({ fv, focus, canOpen }: { fv: FacilityOverview; focus: string | null; canOpen: (href: string) => boolean }) {
  const sites = focus ? fv.sites.filter((s) => s.facilityName === focus) : fv.sites;
  return (
    <div className="space-y-4">
      <UnrecordedBanner fv={fv} canOpen={canOpen} />
      <Notes fv={fv} canOpen={canOpen} />
      {sites.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => (
            <SiteCard key={s.facilityName} s={s} swatch={FACILITY_SWATCH[fv.sites.indexOf(s) % FACILITY_SWATCH.length]} fv={fv} canOpen={canOpen} />
          ))}
        </div>
      ) : null}
      {!focus && fv.extras.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {fv.extras.map((x) => <ExtraCard key={x.key} x={x} />)}
        </div>
      ) : null}
      {!focus ? <ExpectedCards fv={fv} /> : null}
      {fv.otherJournalFacilities.length && !focus ? (
        <p className="text-xs text-slate-500">
          {fv.source === 'expected' ? 'Facilities on the imported journal' : 'Journal facilities not in the facility list'} (6 months):{' '}
          {fv.otherJournalFacilities.map((o) => `${o.facility} (${fmtN(o.rows)} rows, ${fmt$(o.charges90Cents)} charges 90 d)`).join('; ')}.
        </p>
      ) : null}
      {fv.appointmentsInferred.noFacility90 > 0 && fv.clientAssignment.column ? (
        <p className="text-xs text-slate-500">
          {fmtN(fv.appointmentsInferred.noFacility90)} of {fmtN(fv.appointmentsInferred.total90)} appointments in the last 90 days belong to clients without a determinable facility.
        </p>
      ) : null}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="mb-1.5 text-xs font-semibold text-slate-700">How these numbers are counted</p>
        <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {fv.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </div>
    </div>
  );
}

type Row = { key: string; name: string; color: string; swatch: string; money90: FacilitySite['money90']; visits: number; months: FacilitySite['months']; extra: boolean };

export function FacilityFinancials({ fv, focus, canOpen }: { fv: FacilityOverview; focus: string | null; canOpen: (href: string) => boolean }) {
  const sites = focus ? fv.sites.filter((s) => s.facilityName === focus) : fv.sites;
  const idx = (s: FacilitySite) => fv.sites.indexOf(s);
  // facility rows + "not recorded" / "not in list" rows: the unfocused table always sums to the practice total
  const rows: Row[] = [
    ...sites.map((s) => ({
      key: s.facilityName,
      name: s.facilityName,
      color: FACILITY_PALETTE[idx(s) % FACILITY_PALETTE.length],
      swatch: FACILITY_SWATCH[idx(s) % FACILITY_SWATCH.length],
      money90: s.money90,
      visits: s.billed90.visits,
      months: s.months,
      extra: false,
    })),
    ...(focus
      ? []
      : fv.extras.map((x) => ({ key: x.key, name: x.label, color: UNASSIGNED_COLOR, swatch: UNASSIGNED_SWATCH, money90: x.money90, visits: x.visits90, months: x.months, extra: true }))),
  ];
  const trend = fv.months.map((month, i) => ({
    month: monthLabel(month),
    ...Object.fromEntries(rows.map((r) => [r.key, Math.round((r.months[i]?.chargesCents ?? 0) / 100)])),
  }));
  const pay = (m: FacilitySite['money90']) => m.insurancePaymentsCents + m.patientPaymentsCents;
  const total = fv.practice.valant90;
  return (
    <div className="space-y-5">
      <UnrecordedBanner fv={fv} canOpen={canOpen} />
      {!focus ? <PracticeFinancialsPanel fv={fv} /> : null}
      {!fv.sites.length ? (
        <Alert tone="warning">
          The Valant facility list has not been imported, so there are no facility rows yet; amounts by facility on the journal are under &quot;Facilities not in the facility list&quot;.{' '}
          {canOpen(fv.links.facilityImport) ? <Link href={fv.links.facilityImport} className={LINK}>Import facilities</Link> : null}
        </Alert>
      ) : null}
      <Card className="overflow-hidden">
        <div className="clinic-scroll-x">
          <table className="w-full min-w-full text-sm text-slate-700">
            <caption className="sr-only">Valant financials by facility, last 90 days</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className={cx(TH, STICKY_HEAD, 'text-left')}>Facility (last 90 days)</th>
                <th scope="col" className={cx(TH, 'text-right')}>Charges</th>
                <th scope="col" className={cx(TH, 'text-right')}>Payments</th>
                <th scope="col" className={cx(TH, 'text-right')}>Adjustments</th>
                <th scope="col" className={cx(TH, 'text-right')}>Net collections</th>
                <th scope="col" className={cx(TH, 'text-right')}>Collection rate</th>
                <th scope="col" className={cx(TH, 'text-right')}>Visits billed</th>
                <th scope="col" className={cx(TH, 'text-right')}>Avg charge / visit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key} className={r.extra ? 'bg-slate-50 italic' : 'group hover:bg-slate-50'}>
                  <td className={cx('whitespace-nowrap px-4 py-2 font-semibold text-slate-900', STICKY_CELL, r.extra ? 'bg-slate-50' : 'bg-white group-hover:bg-slate-50')}>
                    <span className="inline-flex items-center gap-2">
                      <Swatch className={r.swatch} />
                      {r.name}
                    </span>
                  </td>
                  <td className={TD}>{fmt$(r.money90.chargesCents)}</td>
                  <td className={TD}>{fmt$(pay(r.money90))}</td>
                  <td className={TD}>{fmt$(r.money90.adjustmentsCents)}</td>
                  <td className={TD}>{fmt$(r.money90.netCollectionsCents)}</td>
                  <td className={TD}>{pct(rateOf(r.money90.collectionRate))}</td>
                  <td className={TD}>{fmtN(r.visits)}</td>
                  <td className={TD}>{r.money90.avgChargePerVisitCents === null ? '—' : fmt$(r.money90.avgChargePerVisitCents)}</td>
                </tr>
              ))}
              {!focus ? (
                <tr className="bg-slate-50 font-semibold text-slate-900">
                  <td className="whitespace-nowrap px-4 py-2">Practice total</td>
                  <td className={TD}>{fmt$(total.chargesCents)}</td>
                  <td className={TD}>{fmt$(pay(total))}</td>
                  <td className={TD}>{fmt$(total.adjustmentsCents)}</td>
                  <td className={TD}>{fmt$(total.netCollectionsCents)}</td>
                  <td className={TD}>{pct(rateOf(total.collectionRate))}</td>
                  <td className={TD}>{fmtN(total.visitsBilled)}</td>
                  <td className={TD}>{total.avgChargePerVisitCents === null ? '—' : fmt$(total.avgChargePerVisitCents)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">
          source: Valant Transaction Journal rows whose facility is exactly the facility name, by date of service. Payments = insurance + patient (refunds netted); collection rate = net collections ÷ charges for the same dates of service.
        </p>
      </Card>
      <Card>
        <CardHeader title="Valant charges by month and facility" description="Service month; exact facility on each journal row." />
        <CardBody>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trend} barSize={14} barCategoryGap="25%">
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `$${Math.round(Number(v) / 1000)}k`} />
              <Tooltip formatter={(v) => `$${Number(v).toLocaleString('en-US')}`} />
              <Legend />
              {rows.map((r) => (
                <Bar key={r.key} dataKey={r.key} name={r.name} fill={r.color} radius={[4, 4, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </CardBody>
      </Card>
      <Card className="overflow-hidden">
        <div className="clinic-scroll-x">
          <table className="w-full min-w-full text-sm text-slate-700">
            <caption className="sr-only">Valant charges, payments and adjustments by facility and month</caption>
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th scope="col" className={cx(TH, STICKY_HEAD, 'text-left')}>Facility · month</th>
                {fv.months.map((m) => <th key={m} scope="col" className={cx(TH, 'text-right')}>{monthLabel(m)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.flatMap((s) => [
                <tr key={`${s.key}-c`}>
                  <td className={cx('whitespace-nowrap bg-white px-4 py-2 font-semibold text-slate-900', STICKY_CELL)}>{s.name} · charges</td>
                  {s.months.map((m) => <td key={m.month} className={TD}>{fmt$(m.chargesCents)}</td>)}
                </tr>,
                <tr key={`${s.key}-p`}>
                  <td className={cx('whitespace-nowrap bg-white px-4 py-2 pl-8 text-slate-600', STICKY_CELL)}>payments</td>
                  {s.months.map((m) => <td key={m.month} className={TD}>{fmt$(m.paymentsCents)}</td>)}
                </tr>,
                <tr key={`${s.key}-a`}>
                  <td className={cx('whitespace-nowrap bg-white px-4 py-2 pl-8 text-slate-600', STICKY_CELL)}>adjustments</td>
                  {s.months.map((m) => <td key={m.month} className={TD}>{fmt$(m.adjustmentsCents)}</td>)}
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
