'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Download, Info, Loader2, Printer, ShieldAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Alert,
  Button,
  Card as UiCard,
  CardHeader,
  EmptyState,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  Tabs,
  buttonClasses,
  cardClasses,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';
import { formatCents } from '@/lib/migration/valantReportCommon';
import {
  ELEVATED_BASELINE,
  FOLLOW_UP_MIN_DAYS,
  REMISSION_BELOW,
  type ClientInstrumentOutcome,
  type InstrumentOutcomes,
  type OutcomesReport,
  type Rate,
  type ReportTab,
  type ValantMoney,
} from '@/lib/reports/outcomesReports';

// Chart bar fills (Tailwind classes): brand for PHQ-9 and money, sky for GAD-7.
const ACCENT = 'bg-blue-600';
const GAD_FILL = 'bg-sky-600';

const TABS: { id: ReportTab; label: string }[] = [
  { id: 'clinical', label: 'Clinical Outcomes' },
  { id: 'quality', label: 'Quality Measures' },
  { id: 'financial', label: 'Financial' },
  { id: 'utilization', label: 'Utilization' },
  { id: 'medications', label: 'Medications' },
];

function ymd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function daysAgo(n: number): string {
  return ymd(new Date(Date.now() - n * 86_400_000));
}

function fmtRate(r: Rate | null | undefined): string {
  if (!r || r.pct == null) return 'No data';
  return `${r.pct}%`;
}

function fmtNum(v: number | null | undefined, suffix = ''): string {
  return v == null ? 'No data' : `${v}${suffix}`;
}

function fmtDate(iso: string | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  if (!y || !m) return key;
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}

// ─── Small building blocks ───────────────────────────────────────────────────

function Tip({ text }: { text: string }) {
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help align-middle text-slate-400 hover:text-slate-600">
      <Info size={13} />
    </span>
  );
}

function Card({ title, tip, children, right }: { title: string; tip?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <UiCard className="overflow-hidden">
      <CardHeader title={<span className="inline-flex items-center gap-1.5">{title}{tip ? <Tip text={tip} /> : null}</span>} actions={right} />
      <div className="p-5">{children}</div>
    </UiCard>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <EmptyState compact title={children} />;
}

const VALUE_TONE: Partial<Record<Tone, string>> = { danger: 'text-rose-700', warning: 'text-amber-700' };

function Stat({ label, value, sub, tip, tone }: { label: string; value: string; sub?: string; tip?: string; tone?: Tone }) {
  return (
    <div className={cx(cardClasses, 'p-4')}>
      <p className="text-[13px] text-slate-600 font-medium mb-1 flex items-center gap-1">{label}{tip ? <Tip text={tip} /> : null}</p>
      <p className={cx('stat-number text-2xl font-semibold tracking-tight', (tone && VALUE_TONE[tone]) || 'text-slate-900')}>{value}</p>
      {sub ? <p className="text-xs text-slate-500 mt-1">{sub}</p> : null}
    </div>
  );
}

function SourceNote({ source, asOf, definitions }: { source: string; asOf: string; definitions: [string, string][] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 space-y-2">
      <p>
        <strong className="text-slate-700">Data source:</strong> {source}{' '}
        <span className="text-slate-500">· as of {new Date(asOf).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</span>
      </p>
      {definitions.length ? (
        <details>
          <summary className="cursor-pointer font-semibold text-slate-700">Definitions</summary>
          <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {definitions.map(([k, v]) => (
              <div key={k}><dt className="inline font-semibold text-slate-700">{k}: </dt><dd className="inline">{v}</dd></div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  return (
    <div className="clinic-scroll-x -mx-5">
      <table className="w-full min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            {head.map((h) => <th key={h} scope="col" className="text-left px-4 py-2.5 text-xs font-semibold text-slate-600 whitespace-nowrap">{h}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.length === 0 ? (
            <tr><td colSpan={head.length}>{empty ? <EmptyState compact title={empty} /> : null}</td></tr>
          ) : rows.map((r, i) => (
            <tr key={i} className="hover:bg-slate-50">
              {r.map((c, j) => <td key={j} className="px-4 py-2 text-slate-700 whitespace-nowrap">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Bars({ data, color, format }: { data: { label: string; value: number }[]; color: string; format?: (v: number) => string }) {
  if (!data.length) return <Empty>No data in this period</Empty>;
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  return (
    <div className="flex items-end gap-2 h-36">
      {data.map((d) => (
        <div key={d.label} className="flex-1 min-w-0 flex flex-col items-center justify-end gap-1 h-full">
          <span className="text-[11px] text-slate-500 font-medium truncate max-w-full">{format ? format(d.value) : d.value}</span>
          <div className={cx('w-full min-h-[3px] rounded-t-md', color)} style={{ height: `${(Math.abs(d.value) / max) * 100}%` }} />
          <span className="text-[11px] text-slate-500 truncate max-w-full">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  Remission: 'success',
  Response: 'brand',
  Improving: 'info',
  'No change': 'neutral',
  Worsening: 'danger',
  'Under 4 weeks': 'warning',
  'Baseline only': 'neutral',
};

function OutcomeCell({ o }: { o: ClientInstrumentOutcome | null }) {
  if (!o) return <span className="text-slate-500">Not measured</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span>{o.scores > 1 ? `${o.baseline} → ${o.latest}` : o.latest}</span>
      {o.scores > 1 ? (
        <span className={`text-xs ${o.change < 0 ? 'text-emerald-700' : o.change > 0 ? 'text-rose-700' : 'text-slate-500'}`}>{o.change > 0 ? `+${o.change}` : o.change}</span>
      ) : null}
      <StatusBadge size="sm" tone={STATUS_TONE[o.status] ?? 'neutral'}>{o.status}</StatusBadge>
    </span>
  );
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

function InstrumentPanel({ s, color, note }: { s: Omit<InstrumentOutcomes, 'clients'>; color: string; note: string }) {
  return (
    <Card title={s.instrument} tip={note}>
      {s.clientsMeasured === 0 ? (
        <Empty>No {s.instrument} scores recorded in this period.</Empty>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs text-slate-500">Clients measured</p>
              <p className="text-lg font-semibold">{s.clientsMeasured}</p>
              <p className="text-xs text-slate-500">{s.scoresInPeriod} scores</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Baseline → latest (avg)</p>
              <p className="text-lg font-semibold">{s.avgBaseline == null ? 'No data' : `${s.avgBaseline} → ${s.avgLatest}`}</p>
              <p className="text-xs text-slate-500">{s.clientsWithFollowUp} with ≥{FOLLOW_UP_MIN_DAYS / 7} wk follow-up</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Response</p>
              <p className="text-lg font-semibold">{fmtRate(s.response)}</p>
              <p className="text-xs text-slate-500">{s.response.numerator}/{s.response.denominator} with baseline ≥{ELEVATED_BASELINE}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">Remission</p>
              <p className="text-lg font-semibold">{fmtRate(s.remission)}</p>
              <p className="text-xs text-slate-500">{s.remission.numerator}/{s.remission.denominator} latest &lt;{REMISSION_BELOW}</p>
            </div>
          </div>
          {s.clientsElevatedBaseline < 10 ? (
            <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              Only {s.clientsElevatedBaseline} client{s.clientsElevatedBaseline === 1 ? '' : 's'} qualify for response / remission so far; rates on small numbers move a lot.
            </p>
          ) : null}
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Average score by month (all scores in the month)</p>
            <Bars data={s.monthlyTrend.map((t) => ({ label: fmtMonth(t.month), value: t.avg }))} color={color} />
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-600 mb-2">Severity of latest score (clients)</p>
            <div className="space-y-1.5">
              {s.severity.map((b) => (
                <div key={b.label} className="flex items-center gap-2 text-xs">
                  <span className="w-32 sm:w-44 shrink-0 text-slate-600">{b.label}</span>
                  <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div className={cx('h-full rounded-full', color)} style={{ width: `${s.clientsMeasured ? (b.clients / s.clientsMeasured) * 100 : 0}%` }} />
                  </div>
                  <span className="w-8 text-right font-semibold text-slate-700">{b.clients}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function ClinicalTab({ r }: { r: OutcomesReport }) {
  const c = r.clinical;
  if (!c) return null;
  return (
    <div className="space-y-6">
      <SourceNote
        source="PHQ-9, GAD-7 and C-SSRS assessments recorded in Altrixs (EHR → Assessments). Clinician filter = client's assigned clinician."
        asOf={r.generatedAt}
        definitions={[
          ['Clients measured', 'Clients with at least one score dated in the period.'],
          ['Baseline', "The client's first recorded score (may be before the period)."],
          ['Latest', 'The most recent score on or before the period end.'],
          ['Follow-up', `At least two scores, latest ≥ ${FOLLOW_UP_MIN_DAYS} days after baseline.`],
          ['Response', `Follow-up clients with baseline ≥ ${ELEVATED_BASELINE} whose latest score is ≤ 50% of baseline.`],
          ['Remission', `Follow-up clients with baseline ≥ ${ELEVATED_BASELINE} whose latest score is < ${REMISSION_BELOW}.`],
          ['C-SSRS positive', 'Screen with any "yes" answer or the safety flag set.'],
          ['Not included', 'PHQ-9s recorded only in the TMS module or the MBC scheduler.'],
        ]}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <InstrumentPanel s={c.phq9} color={ACCENT} note="PHQ-9 bands: 0–4 minimal, 5–9 mild, 10–14 moderate, 15–19 moderately severe, 20–27 severe" />
        <InstrumentPanel s={c.gad7} color={GAD_FILL} note="GAD-7 bands: 0–4 minimal, 5–9 mild, 10–14 moderate, 15–21 severe" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat label="C-SSRS screens" value={String(c.cssrs.screens)} sub={`${c.cssrs.clientsScreened} clients`} />
        <Stat label="Positive C-SSRS" value={String(c.cssrs.positiveScreens)} sub={`${c.cssrs.clientsPositive} clients`} tone="danger" tip="Any yes answer or safety flag" />
      </div>
      <Card
        title="Client outcomes"
        tip="Baseline → latest; change is latest minus baseline (negative = better)."
        right={<span className="text-xs text-slate-500">{c.clients.length} clients{c.clientsTruncated ? ' (first 500; export for all)' : ''}</span>}
      >
        <Table
          head={['Client', 'MRN', 'PHQ-9', 'GAD-7', 'Latest score']}
          empty="No clients with PHQ-9 or GAD-7 scores in this period"
          rows={c.clients.map((cl) => [
            <Link key="n" href={`/dashboard/clients/${cl.clientId}`} className="font-semibold text-blue-700 hover:underline">{cl.name}</Link>,
            cl.mrn ?? '—',
            <OutcomeCell key="p" o={cl.phq9} />,
            <OutcomeCell key="g" o={cl.gad7} />,
            fmtDate([cl.phq9?.latestAt, cl.gad7?.latestAt].filter((x): x is string => Boolean(x)).sort().reverse()[0]),
          ])}
        />
      </Card>
    </div>
  );
}

function QualityTab({ r }: { r: OutcomesReport }) {
  const q = r.quality;
  if (!q) return null;
  return (
    <div className="space-y-6">
      <SourceNote
        source="Altrixs appointments, assessments, risk alerts and crisis episodes. These are INTERNAL measures modelled on HEDIS / CMS definitions, not NCQA-certified HEDIS rates."
        asOf={r.generatedAt}
        definitions={[
          ['Measurement-based care', 'Clients with a completed visit in the 90 days ending on the report end date who also have a PHQ-9 or GAD-7 in that window.'],
          ['Depression screening', 'Clients with a completed visit in the period who have a PHQ-9 or PHQ-2 in the 12 months ending on the report end date.'],
          ['Follow-up after risk event', 'High-severity risk alerts and mobile crisis episodes in the period, followed by a completed appointment within 7 / 30 days. Repeat events for a client within 30 days count once. Events whose window has not ended yet are left out of that window.'],
          ['Clinician filter', "Client's assigned clinician."],
        ]}
      />
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat label="Measurement-based care" value={fmtRate(q.measurementBasedCare)} sub={`${q.measurementBasedCare.numerator} of ${q.measurementBasedCare.denominator} clients seen in last 90 days`} />
        <Stat label="Depression screening" value={fmtRate(q.depressionScreening)} sub={`${q.depressionScreening.numerator} of ${q.depressionScreening.denominator} clients seen in period`} />
        <Stat label="Follow-up ≤ 7 days" value={fmtRate(q.followUp.within7)} sub={`${q.followUp.within7.numerator}/${q.followUp.within7.denominator} events · ${q.followUp.windowOpen7} still open`} tip="Internal FUH-style measure (not HEDIS)" />
        <Stat label="Follow-up ≤ 30 days" value={fmtRate(q.followUp.within30)} sub={`${q.followUp.within30.numerator}/${q.followUp.within30.denominator} events · ${q.followUp.windowOpen30} still open`} tip="Internal FUH-style measure (not HEDIS)" />
      </div>
      <p className="text-xs text-slate-500">
        Follow-up index events: {q.followUp.indexEvents} ({q.followUp.byKind.risk_alert} high risk alerts, {q.followUp.byKind.crisis_episode} crisis episodes) from {q.followUp.events} raw events
        {q.followUp.crisisEpisodesWithoutClient ? `; ${q.followUp.crisisEpisodesWithoutClient} crisis episodes not linked to a client were left out` : ''}.
      </p>
      <Card title="HEDIS behavioral health measures" tip="These NCQA HEDIS measures need data Altrixs does not hold. No rates or benchmarks are shown for them.">
        <Table
          head={['Measure', 'Name', 'Status']}
          empty=""
          rows={q.unavailable.map((m) => [
            <strong key="c">{m.code}</strong>,
            <span key="n" className="whitespace-normal">{m.name}</span>,
            <span key="s" className="text-amber-800 whitespace-normal">Needs payer / hospital data — not available ({m.needs})</span>,
          ])}
        />
      </Card>
    </div>
  );
}

function valantCols(m: ValantMoney): React.ReactNode[] {
  return [m.chargeCount, formatCents(m.chargesCents), formatCents(m.insurancePaymentsCents), formatCents(m.patientPaymentsCents), formatCents(m.adjustmentsCents)];
}
const VALANT_HEAD = ['Charges', 'Charges $', 'Insurance paid $', 'Patient paid $', 'Adjustments $'];

function FinancialTab({ r }: { r: OutcomesReport }) {
  const f = r.financial;
  if (!f) return null;
  return (
    <div className="space-y-6">
      <SourceNote
        source="Altrixs claims (by claim created date) and Valant (imported) transactions (by date of service). Valant figures are reference data from the migration, not Altrixs billing."
        asOf={r.generatedAt}
        definitions={[
          ['Valant payer', 'First payer listed on the Valant transaction journal row; blank = self-pay or no insurance on the row.'],
          ['Payments / adjustments', 'Shown as positive amounts (Valant stores credits as negative).'],
          ['Facility', 'Facility as exported by Valant.'],
          ['Location filter (Valant)', r.facilityTerm ? `Facility text containing "${r.facilityTerm}".` : 'No location filter.'],
          ['Clinician filter (Valant)', 'Rows whose Valant provider matched that staff member.'],
          ['Altrixs billed', 'Claims submitted, accepted, denied or paid; paid $ from the payer remittance.'],
        ]}
      />
      <Card title="Altrixs claims by payer">
        {f.claimsByPayer.length === 0 ? (
          <Empty>No Altrixs claims yet in this period. Billing in Altrixs starts at go-live; see Valant (imported) below.</Empty>
        ) : (
          <Table
            head={['Payer', 'Claims', 'Billed', 'Billed $', 'Paid', 'Paid $', 'Denied']}
            empty=""
            rows={f.claimsByPayer.map((p) => [p.payer, p.total, p.billed, formatCents(p.billedCents), p.paid, formatCents(p.paidCents), p.denied])}
          />
        )}
      </Card>
      <Card title="Valant (imported) by month of service" tip="Charges per month from imported Valant transactions">
        {f.valantTotals.rows === 0 ? (
          <Empty>No imported Valant transactions with a date of service in this period.</Empty>
        ) : (
          <div className="space-y-4">
            <Bars data={f.valantByMonth.map((m) => ({ label: fmtMonth(m.key), value: m.chargesCents / 100 }))} color={ACCENT} format={(v) => `$${Math.round(v).toLocaleString()}`} />
            <Table head={['Month', ...VALANT_HEAD]} empty="" rows={f.valantByMonth.map((m) => [fmtMonth(m.key), ...valantCols(m)])} />
          </div>
        )}
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Valant (imported) by payer">
          <Table head={['Payer', ...VALANT_HEAD]} empty="No imported Valant transactions in this period" rows={f.valantByPayer.map((m) => [<span key="k" className="whitespace-normal">{m.key}</span>, ...valantCols(m)])} />
        </Card>
        <Card title="Valant (imported) by facility">
          <Table head={['Facility', ...VALANT_HEAD]} empty="No imported Valant transactions in this period" rows={f.valantByFacility.map((m) => [<span key="k" className="whitespace-normal">{m.key}</span>, ...valantCols(m)])} />
        </Card>
      </div>
    </div>
  );
}

function UtilizationTab({ r }: { r: OutcomesReport }) {
  const u = r.utilization;
  if (!u) return null;
  return (
    <div className="space-y-6">
      <SourceNote
        source="Altrixs appointments, progress notes and claims; Valant (imported) charge rows by date of service."
        asOf={r.generatedAt}
        definitions={[
          ['Hours', 'Scheduled length of completed appointments (bookings over 12 h count as 0).'],
          ['No-show rate', 'No-shows ÷ (completed + no-shows).'],
          ['Notes signed', 'Progress notes signed in the period.'],
          ['Avg hours to sign', 'From note creation to signature.'],
          ['Unsigned notes', 'Draft notes dated in the period.'],
          ['Valant charge code', 'CPT / HCPCS base of the Valant charge code (modifiers and suffixes dropped).'],
          ['Altrixs claim CPT', 'Claim header CPT code.'],
        ]}
      />
      <Card title="Completed appointments by type">
        <Table head={['Type', 'Sessions', 'Hours', 'Clinicians', 'Clients']} empty="No completed appointments in this period" rows={u.appointmentTypes.map((t) => [t.type, t.sessions, t.hours, t.clinicians, t.clients])} />
      </Card>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card title="Valant (imported) charges by CPT">
          <Table head={['CPT / HCPCS', 'Charges', 'Charges $']} empty="No imported Valant charges in this period" rows={u.valantCpt.map((c) => [c.codeBase, c.charges, formatCents(c.chargesCents)])} />
        </Card>
        <Card title="Altrixs claims by CPT">
          {u.claimCpt.length === 0 ? <Empty>No Altrixs claims yet in this period.</Empty> : (
            <Table head={['CPT', 'Claims', 'Units', 'Billed $']} empty="" rows={u.claimCpt.map((c) => [c.cptCode, c.claims, c.units, formatCents(c.billedCents)])} />
          )}
        </Card>
      </div>
      <Card title="Clinician productivity (Altrixs)">
        <Table
          head={['Clinician', 'Completed', 'No-show', 'Cancelled', 'No-show rate', 'Hours', 'Notes signed', 'Avg hrs to sign', 'Unsigned']}
          empty="No appointments or notes in this period"
          rows={u.productivity.map((p) => [p.name, p.completed, p.noShow, p.cancelled, fmtRate(p.noShowRate), p.hours, p.notesSigned, fmtNum(p.avgHoursToSign), p.unsignedNotes])}
        />
      </Card>
      <Card title="Valant (imported) charges by provider" tip="Valant provider code; staff name when it matched one staff member">
        <Table
          head={['Provider', 'Charges', 'Charges $']}
          empty="No imported Valant charges in this period"
          rows={u.valantByProvider.map((p) => [p.matchedStaff ? p.provider : <span key="p" className="text-slate-500">{p.provider} (Valant code)</span>, p.charges, formatCents(p.chargesCents)])}
        />
      </Card>
    </div>
  );
}

function MedicationsTab({ r }: { r: OutcomesReport }) {
  const m = r.medications;
  if (!m) return null;
  return (
    <div className="space-y-6">
      <SourceNote
        source="Active medications on client charts (DrFirst-synced and entered in Altrixs) as of now. The date range applies only to DrFirst prescriptions signed."
        asOf={r.generatedAt}
        definitions={[
          ['Drug class', 'Matched from the drug name against a fixed list of generic and brand names; unmatched names show as "Other / not classified".'],
          ['Antipsychotics', 'Name match or the antipsychotic flag on the medication.'],
          ['Lithium / clozapine', 'Name match.'],
          ['Top drugs', 'Grouped by the first word of the generic (or drug) name.'],
          ['Clinician filter', "Client's assigned clinician."],
        ]}
      />
      {m.activeMedications === 0 ? (
        <Card title="Medications"><Empty>No active medications on file for the clients in this report.</Empty></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <Stat label="Clients on medications" value={String(m.clientsOnMedications)} sub={`${m.activeMedications} active medications`} />
            <Stat label="On antipsychotics" value={String(m.clientsOnAntipsychotics)} sub="clients" tip="Name match or antipsychotic flag" />
            <Stat label="On lithium" value={String(m.clientsOnLithium)} sub="clients" />
            <Stat label="On clozapine" value={String(m.clientsOnClozapine)} sub="clients" />
            <Stat label="DrFirst Rx signed" value={String(m.rcopiaPrescriptionsSigned)} sub="in period" />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Card title="By drug class (name match)">
              <Table head={['Class', 'Clients', 'Medications']} empty="" rows={m.byClass.map((c) => [c.label, c.clients, c.medications])} />
            </Card>
            <Card title="Top 20 drugs">
              <Table head={['Drug', 'Class', 'Clients']} empty="" rows={m.topDrugs.map((d) => [d.drug, d.drugClass, d.clients])} />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const QUICK_RANGES: [string, number][] = [['30 days', 29], ['90 days', 89], ['12 months', 364]];

export default function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('clinical');
  const [from, setFrom] = useState(() => daysAgo(89));
  const [to, setTo] = useState(() => daysAgo(0));
  const [location, setLocation] = useState('');
  const [clinician, setClinician] = useState('');
  const [report, setReport] = useState<OutcomesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams({ from, to, tab });
    if (location) p.set('location', location);
    if (clinician) p.set('clinician', clinician);
    return p.toString();
  }, [from, to, tab, location, clinician]);

  const load = useCallback(async (q: string, signal: { cancelled: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<{ success: true; report: OutcomesReport }>(`/api/reports/outcomes?${q}`);
      if (!signal.cancelled) setReport(res.report);
    } catch (e) {
      if (!signal.cancelled) setError(e instanceof Error ? e.message : 'Could not load the report');
    } finally {
      if (!signal.cancelled) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!from || !to || from > to) return;
    const signal = { cancelled: false };
    void load(query, signal);
    return () => {
      signal.cancelled = true;
    };
  }, [query, from, to, load]);

  const o = report?.overview;
  const shown = report?.filters.tab === tab ? report : null;

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/dashboard/reports" className="normal-case tracking-normal font-semibold text-blue-700 hover:underline print:hidden">
            Report library
          </Link>
        }
        title="Outcomes & Reports"
        description="Clinical outcomes, internal quality measures, financial and utilization reports from live records"
        actions={
          <div className="flex flex-wrap gap-2 print:hidden" data-print-hide>
            <a href={`/api/reports/outcomes?${query}&format=csv`} className={buttonClasses({ variant: 'secondary' })}>
              <Download size={16} aria-hidden /> Export CSV
            </a>
            <Button icon={<Printer />} onClick={() => window.print()}>
              Print
            </Button>
          </div>
        }
      />

      <div className={cx(cardClasses, 'p-4 grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-end print:hidden')} data-print-hide>
        <label className="text-xs font-medium text-slate-600">From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cx(inputClasses, 'mt-1')} />
        </label>
        <label className="text-xs font-medium text-slate-600">To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cx(inputClasses, 'mt-1')} />
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-600 sm:col-auto">Location
          <select value={location} onChange={(e) => setLocation(e.target.value)} className={cx(inputClasses, 'mt-1 w-full sm:w-auto sm:min-w-40')}>
            <option value="">All locations</option>
            {report?.options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 text-xs font-medium text-slate-600 sm:col-auto">Clinician
          <select value={clinician} onChange={(e) => setClinician(e.target.value)} className={cx(inputClasses, 'mt-1 w-full sm:w-auto sm:min-w-48')}>
            <option value="">All clinicians</option>
            {report?.options.clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {QUICK_RANGES.map(([label, d]) => (
            <Button key={label} variant="secondary" size="sm" onClick={() => { setFrom(daysAgo(d)); setTo(daysAgo(0)); }}>
              {label}
            </Button>
          ))}
        </div>
        {loading ? (
          <span role="status" className="mb-2 inline-flex items-center">
            <Loader2 size={16} aria-hidden className="animate-spin text-slate-400" />
            <span className="sr-only">Loading</span>
          </span>
        ) : null}
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {report ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
          <span>Period {report.filters.from} to {report.filters.to} (Eastern time)</span>
          <span>Scope: {report.scope === 'caseload' ? 'your assigned clients' : 'whole organization'}</span>
          {report.hiddenSensitiveClients > 0 ? (
            <span className="inline-flex items-center gap-1 text-amber-800">
              <ShieldAlert size={12} aria-hidden /> {report.hiddenSensitiveClients} sensitive (Part 2 / protected) client{report.hiddenSensitiveClients === 1 ? '' : 's'} excluded
            </span>
          ) : null}
        </div>
      ) : null}

      {o ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat
            label="Active clients"
            value={String(o.activeClients)}
            sub={`${o.newClients} new in Altrixs · ${o.importedClients} imported in period`}
            tip="Active = client status Active now. New = registered in Altrixs in the period (migrated clients not counted)."
          />
          <Stat
            label="Appointments completed"
            value={String(o.appointments.completed)}
            sub={`${o.appointments.noShow} no-show · ${o.appointments.cancelled} cancelled · ${o.appointments.lateCancel} late cancel`}
            tip="Altrixs appointments scheduled in the period"
          />
          <Stat label="No-show rate" value={fmtRate(o.appointments.noShowRate)} sub={`${o.appointments.total} appointments in period`} tone="warning" tip="No-shows ÷ (completed + no-shows)" />
          <Stat
            label="Unsigned notes"
            value={String(o.notes.unsigned)}
            sub={`${o.notes.unsignedOver24h} > 24h · ${o.notes.unsignedOver48h} > 48h · ${o.notes.inPeriod} notes in period`}
            tone="warning"
            tip="Draft progress notes dated in the period; age from date of service (or creation)"
          />
          <Stat
            label="Altrixs claims"
            value={o.claims.total ? String(o.claims.billed) : 'None yet'}
            sub={o.claims.total ? `${formatCents(o.claims.billedCents)} billed · ${o.claims.paid} paid · ${o.claims.denied} denied` : 'No Altrixs claims yet'}
            tip="Claims created in Altrixs in the period"
          />
          <Stat
            label="Valant (imported) charges"
            value={formatCents(o.valant.chargesCents)}
            sub={`${o.valant.chargeCount} charges by date of service`}
            tip="Imported Valant transactions: reference data from the migration"
          />
          <Stat
            label="Valant (imported) payments"
            value={formatCents(o.valant.insurancePaymentsCents + o.valant.patientPaymentsCents)}
            sub={`${formatCents(o.valant.insurancePaymentsCents)} insurance · ${formatCents(o.valant.patientPaymentsCents)} patient`}
            tip="Payments posted against dates of service in the period"
          />
          <Stat
            label="Valant (imported) adjustments"
            value={formatCents(o.valant.adjustmentsCents)}
            sub={o.valant.undatedRows ? `${o.valant.undatedRows} rows have no date of service (not counted)` : 'by date of service'}
          />
        </div>
      ) : null}

      <Tabs
        label="Report sections"
        controlsPanels={false}
        value={tab}
        onChange={setTab}
        className="print:hidden"
        items={TABS.map((t) => ({ key: t.id, label: t.label }))}
      />

      {!shown ? (
        loading ? <LoadingState /> : null
      ) : (
        <>
          {tab === 'clinical' && <ClinicalTab r={shown} />}
          {tab === 'quality' && <QualityTab r={shown} />}
          {tab === 'financial' && <FinancialTab r={shown} />}
          {tab === 'utilization' && <UtilizationTab r={shown} />}
          {tab === 'medications' && <MedicationsTab r={shown} />}
        </>
      )}
    </Page>
  );
}
