'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Info, Loader2, Search, XCircle } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  LoadingState,
  Modal,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  cardClasses,
  cx,
  inputClasses,
} from '@/components/ui';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { OVER_120_NOTE, presentAgingTotals, sumPresented, type PresentedTotals } from '@/lib/billing/valantAgingDisplay';
import { ValantTransactionsTable } from '@/components/billing/ValantTransactionsTable';
import { ValantBillingArchive } from '@/components/billing/ValantBillingArchive';
import { ValantLedgerPostingPanel, type PostingStatus } from '@/components/billing/ValantLedgerPostingPanel';
import { FILTER_SEARCH, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

/**
 * Billing → Valant Balances. Balances carried over from Valant: patient aging, combined (patient + insurance)
 * aging, insurance A/R, prepayments and transactions. Patient opening balances (Patient Aging) and prepayment
 * credits can be posted to the Altrixs ledger from here (owner decision 2026-10-17); everything else, including
 * insurance A/R (a Valant run-out), stays reference only.
 */

type Tab = 'aging' | 'combined' | 'insurance' | 'prepayments' | 'transactions' | 'archive';

type Summary = {
  labels: string[];
  labelsConfirmed: boolean;
  labelsConfirmedAt: string | null;
  displayAllOver120: boolean;
  labelsInferredNote: string;
  reports: Record<string, { latest: { importedAt: string; asOf: string | null; periodStart: string | null; periodEnd: string | null } | null; asOfDates?: string[] }>;
};

type ReportTotals = { importedAt: string; reconciles: boolean; totals: Record<string, unknown> | null } | null;

/** From the server presenter: displayBucketsCents = what the columns show, valantBucketsCents = Valant's original buckets */
type Presented = { displayBucketsCents: number[]; valantBucketsCents: number[]; totalCents: number; shownAsOver120: boolean };
type AgingRow = Presented & {
  id: string; clientId: string | null; clientName: string | null; mrn: string | null; valantPatientId: string; bucketsMatchTotal: boolean;
};
type InsuranceRow = Presented & {
  id: string; rowIndex: number; payerName: string; bucketsMatchTotal: boolean;
  waystar: { waystarPayerId: string; verified: boolean } | null;
};
type CombinedPatient = Presented & {
  valantPatientId: string; clientId: string | null; clientName: string | null; mrn: string | null;
  parties: (Presented & { party: string; payerName: string | null; lastBilledAt: string | null })[];
};
type Txn = { id: string; type: string; kind: string; date: string; amountCents: number; reference: string | null; appliedTo: string | null; matchMethod: string | null };
type PrepayClient = {
  clientId: string; clientName: string; mrn: string | null; transactions: number; receivedCents: number; appliedCents: number;
  netCents: number; remainingCents: number | null; incomplete: boolean; note: string | null;
};
type UnmatchedGroup = { key: string; valantName: string; reason: string | null; transactions: number; netCents: number; txns: (Txn & { secondaryDate: string | null })[] };
type Period = { periodStart: string | null; periodEnd: string | null; importedAt: string } | null;

const TABLE_WRAP = cx(cardClasses, 'clinic-scroll-x');
const TH = 'px-3 py-2 font-semibold';
const LINK_BTN = cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING);
const CHECKBOX = 'h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600';

const TAB_ITEMS: { key: Tab; label: string }[] = [
  { key: 'aging', label: 'Patient aging' },
  { key: 'combined', label: 'Combined (patient + insurance)' },
  { key: 'insurance', label: 'Insurance A/R' },
  { key: 'prepayments', label: 'Prepayments' },
  { key: 'transactions', label: 'Transactions' },
  { key: 'archive', label: 'Valant billing archive' },
];

function numArr(v: unknown): (number | null)[] {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'number' ? x : null)) : [];
}

function Mark({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 size={14} className="inline text-emerald-600" aria-label="matches the report" />
  ) : (
    <XCircle size={14} className="inline text-rose-600" aria-label="does not match the report" />
  );
}

/** One bucket cell: the shown amount, plus Valant's original bucket when revealed */
function BucketCell({ r, i, showOriginal, className = 'px-3 py-2' }: { r: Presented; i: number; showOriginal: boolean; className?: string }) {
  return (
    <td className={`${className} text-right`}>
      <Money cents={r.displayBucketsCents[i]} />
      {showOriginal && r.shownAsOver120 ? (
        <span className="block text-[11px] text-slate-500" title="Valant's original bucket">
          Valant <Money cents={r.valantBucketsCents[i]} />
        </span>
      ) : null}
    </td>
  );
}

/** "Shown as Over 120" note with the toggle that reveals Valant's original buckets */
function Over120Note({ on, showOriginal, setShowOriginal }: { on: boolean; showOriginal: boolean; setShowOriginal: (v: boolean) => void }) {
  if (!on) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
      <Info size={12} aria-hidden /> {OVER_120_NOTE}
      <button type="button" onClick={() => setShowOriginal(!showOriginal)} className={LINK_BTN} aria-expanded={showOriginal}>
        {showOriginal ? 'Hide' : 'Show'}
      </button>
    </p>
  );
}

function Money({ cents, className = '' }: { cents: number | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${cents != null && cents < 0 ? 'text-rose-700' : ''} ${className}`}>{formatCents(cents)}</span>;
}

export default function ValantBalancesPage() {
  const [tab, setTab] = useState<Tab>('aging');
  // Deep link from the A/R Control Center (?tab=combined etc.)
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab');
    if (t === 'aging' || t === 'combined' || t === 'insurance' || t === 'prepayments' || t === 'transactions' || t === 'archive') setTab(t);
  }, []);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState<PostingStatus | null>(null);

  const loadPosting = useCallback(async () => {
    try {
      setPosting(await apiJson<PostingStatus>('/api/billing/valant-balances/ledger'));
    } catch {
      setPosting(null);
    }
  }, []);
  useEffect(() => {
    void loadPosting();
  }, [loadPosting]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await apiJson<Summary>('/api/billing/valant-balances'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Valant balances');
    }
  }, []);
  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const labels = summary?.labels ?? ['Bucket 1', 'Bucket 2', 'Bucket 3', 'Bucket 4', 'Bucket 5'];
  // Remount the aging tabs when the setting changes so they reload the presented rows
  const over120Key = summary ? String(summary.displayAllOver120) : 'loading';

  return (
    <Page>
      <PageHeader
        title="Legacy balances (Valant)"
        description="Balances carried over from Valant reports, for reference while patients move to Altrixs billing."
      />

      <Alert tone="brand">
        <p>
          <span className="font-semibold">Posted to the ledger:</span> patient opening balances (Patient Aging total per patient) and prepayment credits,
          only when billing posts them below; re-posting replaces the earlier posting. They become part of each patient&apos;s balance,
          statements and autopay.{' '}
          <span className="font-semibold">Reference only:</span> insurance A/R and the insurance part of combined aging (a Valant run-out: no claims or
          insurance balances are created), aging buckets and Valant transactions.
        </p>
      </Alert>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <ValantLedgerPostingPanel status={posting} onChanged={() => void loadPosting()} />

      {summary ? <LabelsPanel summary={summary} onSaved={loadSummary} /> : null}

      <Tabs label="Valant balance reports" value={tab} onChange={setTab} items={TAB_ITEMS} controlsPanels={false} />

      {tab === 'aging' ? (
        <AgingTab key={over120Key} labels={labels} asOfDates={summary?.reports.patient_aging?.asOfDates ?? []} posted={posting?.kinds.opening_balance ?? null} />
      ) : null}
      {tab === 'combined' ? <CombinedTab key={over120Key} labels={labels} asOfDates={summary?.reports.combined_aging?.asOfDates ?? []} /> : null}
      {tab === 'insurance' ? <InsuranceTab key={over120Key} labels={labels} asOfDates={summary?.reports.insurance_aging?.asOfDates ?? []} /> : null}
      {tab === 'prepayments' ? <PrepaymentsTab posted={posting?.kinds.prepayment_credit ?? null} /> : null}
      {tab === 'transactions' ? <ValantTransactionsTable /> : null}
      {tab === 'archive' ? <ValantBillingArchive /> : null}
    </Page>
  );
}

function LabelsPanel({ summary, onSaved }: { summary: Summary; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(summary.labels);
  const [confirmed, setConfirmed] = useState(summary.labelsConfirmed);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savingOver120, setSavingOver120] = useState(false);

  const setOver120 = async (on: boolean) => {
    setSavingOver120(true);
    setErr(null);
    try {
      await apiJson('/api/billing/valant-balances', { method: 'PATCH', body: JSON.stringify({ displayAllOver120: on }) });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSavingOver120(false);
    }
  };

  useEffect(() => {
    setDraft(summary.labels);
    setConfirmed(summary.labelsConfirmed);
  }, [summary.labels, summary.labelsConfirmed]);

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      await apiJson('/api/billing/valant-balances', { method: 'PUT', body: JSON.stringify({ labels: draft, confirmed }) });
      setEditing(false);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      {!summary.labelsConfirmed ? (
        <Alert tone="warning">
          <p>
            <span className="font-semibold">Unconfirmed bucket headings.</span> {summary.labelsInferredNote}. The five aging columns (patient, combined
            and insurance) use these headings; edit them and mark them confirmed once checked in Valant.
          </p>
        </Alert>
      ) : null}
      <div className={cx(cardClasses, 'flex flex-wrap items-center gap-2 px-4 py-2 text-xs')}>
        <span className="font-semibold text-slate-700">Aging buckets (days):</span>
        {editing ? (
          <>
            {draft.map((l, i) => (
              <input
                key={i}
                value={l}
                maxLength={40}
                aria-label={`Bucket ${i + 1} heading`}
                onChange={(e) => setDraft((d) => d.map((x, k) => (k === i ? e.target.value : x)))}
                className={cx(inputClasses, 'w-24 px-2 py-1')}
              />
            ))}
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" className={CHECKBOX} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmed in Valant
            </label>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={saving || draft.some((d) => !d.trim())} onClick={() => void save()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </>
        ) : (
          <>
            {summary.labels.map((l, i) => (
              <StatusBadge key={i} tone="neutral">
                {i + 1}. {l}
              </StatusBadge>
            ))}
            <StatusBadge tone={summary.labelsConfirmed ? 'success' : 'warning'}>
              {summary.labelsConfirmed ? 'Confirmed' : 'Unconfirmed'}
            </StatusBadge>
            <button type="button" onClick={() => setEditing(true)} className={cx('ml-auto', LINK_BTN)}>
              Edit headings
            </button>
          </>
        )}
        {err ? <span className="text-rose-700">{err}</span> : null}
      </div>
      <label className={cx(cardClasses, 'flex flex-wrap items-center gap-2 px-4 py-2 text-xs')}>
        <input
          type="checkbox"
          className={CHECKBOX}
          checked={summary.displayAllOver120}
          disabled={savingOver120}
          onChange={(e) => void setOver120(e.target.checked)}
        />
        <span className="font-semibold text-slate-700">Show all Valant aging as {summary.labels[4]}</span>
        <span className="text-slate-500">
          Practice setting. Each balance is shown in the {summary.labels[4]} column; Valant&apos;s original buckets stay stored and can be shown on each tab.
        </span>
        {savingOver120 ? <Loader2 size={12} className="animate-spin text-slate-500" aria-label="Saving" /> : null}
      </label>
    </div>
  );
}

function AsOfPicker({ asOf, dates, onChange }: { asOf: string | null; dates: string[]; onChange: (d: string) => void }) {
  if (!asOf) return null;
  return (
    <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600">
      As of
      <select value={asOf} onChange={(e) => onChange(e.target.value)} className={cx(inputClasses, 'w-auto px-2 py-1')}>
        {(dates.includes(asOf) ? dates : [asOf, ...dates]).map((d, i) => (
          <option key={d} value={d}>
            {d}
            {i === 0 ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function Empty({ what }: { what: string }) {
  return (
    <Card>
      <EmptyState title={`No ${what} imported yet.`} description="Import it on Admin → EHR Data Migration." />
    </Card>
  );
}

type SortKey = 'name' | 'total' | 0 | 1 | 2 | 3 | 4;

function useSorted<T>(rows: T[], key: SortKey, dir: 1 | -1, get: (r: T, k: SortKey) => string | number) {
  return useMemo(
    () =>
      [...rows].sort((a, b) => {
        const x = get(a, key);
        const y = get(b, key);
        return (typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : Number(x) - Number(y)) * dir;
      }),
    [rows, key, dir, get]
  );
}

function SortTh({ label, k, sort, setSort, right = true }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; setSort: (s: { key: SortKey; dir: 1 | -1 }) => void; right?: boolean }) {
  const active = sort.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} className={cx('px-3 py-2', right ? 'text-right' : cx('text-left', STICKY_FIRST_TH))}>
      <button type="button" onClick={() => setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 })} className={cx('inline-flex items-center gap-1 rounded font-semibold hover:text-blue-700', FOCUS_RING)}>
        {label}
        {active ? (sort.dir === 1 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />) : null}
      </button>
    </th>
  );
}

type PostedKind = PostingStatus['kinds']['opening_balance'];

/** "Posted to ledger" badge for a patient row (title shows the posted amount and as-of) */
function PostedBadge({ posted, clientId }: { posted: PostedKind | null; clientId: string | null }) {
  if (!posted || !clientId || posted.byClient[clientId] == null) return null;
  return (
    <span className="ml-1 inline-flex align-middle" title={`Posted ${formatCents(posted.byClient[clientId])} as of ${posted.asOf ?? '—'}`}>
      <StatusBadge size="sm" tone="success">Posted to ledger</StatusBadge>
    </span>
  );
}

function AgingTab({ labels, asOfDates, posted }: { labels: string[]; asOfDates: string[]; posted: PostedKind | null }) {
  const [asOf, setAsOf] = useState<string | null>(null);
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [report, setReport] = useState<ReportTotals>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [match, setMatch] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'total', dir: -1 });
  const [err, setErr] = useState<string | null>(null);
  const [over120, setOver120] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async (d: string | null) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiJson<{ asOf: string | null; displayAllOver120?: boolean; rows: AgingRow[]; report: ReportTotals }>(`/api/billing/valant-balances/aging${d ? `?asOf=${d}` : ''}`);
      setOver120(Boolean(data.displayAllOver120));
      setAsOf(data.asOf);
      setRows(data.rows);
      setReport(data.report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(null);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (match === 'matched' && !r.clientId) return false;
      if (match === 'unmatched' && r.clientId) return false;
      if (!needle) return true;
      return [r.clientName, r.mrn, r.valantPatientId].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [rows, q, match]);
  const getter = useCallback((r: AgingRow, k: SortKey) => (k === 'name' ? r.clientName ?? `~${r.valantPatientId}` : k === 'total' ? r.totalCents : r.displayBucketsCents[k]), []);
  const sorted = useSorted(filtered, sort.key, sort.dir, getter);
  const repB = numArr(report?.totals?.reportBucketsCents);
  const repT = typeof report?.totals?.reportTotalCents === 'number' ? (report.totals.reportTotalCents as number) : null;
  const all = presentAgingTotals(rows, { bucketsCents: repB, totalCents: repT });
  const sub = presentAgingTotals(filtered);

  if (loading) return <Loading />;
  if (err) return <ErrorBox text={err} />;
  if (!asOf) return <Empty what="Patient Aging Summary" />;
  const mismatches = rows.filter((r) => !r.bucketsMatchTotal).length;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <AsOfPicker asOf={asOf} dates={asOfDates} onChange={(d) => void load(d)} />
        <SearchBox value={q} onChange={setQ} placeholder="Patient, MRN or Valant ID" />
        <select value={match} aria-label="Match filter" onChange={(e) => setMatch(e.target.value as typeof match)} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')}>
          <option value="all">All rows</option>
          <option value="matched">Matched to a patient</option>
          <option value="unmatched">Not in Altrixs</option>
        </select>
        <span className="text-xs text-slate-500">
          {rows.length} patients · {rows.filter((r) => !r.clientId).length} not matched{mismatches ? ` · ${mismatches} where buckets ≠ total` : ''}
        </span>
      </div>
      <Over120Note on={over120} showOriginal={showOriginal} setShowOriginal={setShowOriginal} />
      <div className={TABLE_WRAP}>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <SortTh label="Patient" k="name" sort={sort} setSort={setSort} right={false} />
              {labels.map((l, i) => (
                <SortTh key={i} label={l} k={i as SortKey} sort={sort} setSort={setSort} />
              ))}
              <SortTh label="Total" k="total" sort={sort} setSort={setSort} />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r) => (
              <tr key={r.id} className="group hover:bg-slate-50">
                <td className={cx('px-3 py-2', STICKY_FIRST_TD)}>
                  <PatientCell clientId={r.clientId} name={r.clientName} mrn={r.mrn} valantId={r.valantPatientId} />
                  {posted?.asOf === asOf ? <PostedBadge posted={posted} clientId={r.clientId} /> : null}
                </td>
                {labels.map((_, i) => (
                  <BucketCell key={i} r={r} i={i} showOriginal={showOriginal} />
                ))}
                <td className="px-3 py-2 text-right font-semibold">
                  <Money cents={r.totalCents} />
                  {!r.bucketsMatchTotal ? <span className="ml-1 text-amber-700" title="Buckets do not add up to the total in the Valant export">*</span> : null}
                </td>
              </tr>
            ))}
          </tbody>
          <TotalsFoot labels={labels} all={all} sub={filtered.length !== rows.length ? sub : null} reportBuckets={repB} reportTotal={repT} over120={over120} />
        </table>
      </div>
    </div>
  );
}

/**
 * Footer totals. Reconciliation marks always compare Valant's ORIGINAL bucket sums to the report;
 * when the Over 120 setting is on, the shown column sums get their own row (grand total in Over 120).
 */
function TotalsFoot({
  all, sub, reportBuckets, reportTotal, labels, percents, over120, lead = 1,
}: {
  all: PresentedTotals;
  sub: PresentedTotals | null;
  reportBuckets: (number | null)[];
  reportTotal: number | null;
  labels: string[];
  percents?: boolean;
  over120: boolean;
  /** columns before the buckets */
  lead?: number;
}) {
  const totalMark = all.totalMatchesReport !== null ? <Mark ok={all.totalMatchesReport} /> : null;
  const bucketMark = (i: number) => (all.bucketsMatchReport[i] !== null ? <Mark ok={Boolean(all.bucketsMatchReport[i])} /> : null);
  const pctOf = over120 ? all.displayBucketsCents : all.valantBucketsCents;
  return (
    <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-800">
      {sub ? (
        <tr>
          <td className="px-3 py-2" colSpan={lead}>Shown (filtered)</td>
          {sub.displayBucketsCents.map((c, i) => (
            <td key={i} className="px-3 py-2 text-right"><Money cents={c} /></td>
          ))}
          <td className="px-3 py-2 text-right"><Money cents={sub.totalCents} /></td>
        </tr>
      ) : null}
      {over120 ? (
        <tr>
          <td className="px-3 py-2" colSpan={lead}>All rows (shown as {labels[4]})</td>
          {all.displayBucketsCents.map((c, i) => (
            <td key={i} className="px-3 py-2 text-right"><Money cents={c} /></td>
          ))}
          <td className="px-3 py-2 text-right"><Money cents={all.totalCents} /> {totalMark}</td>
        </tr>
      ) : null}
      <tr className={over120 ? 'text-slate-600' : ''}>
        <td className="px-3 py-2" colSpan={lead}>{over120 ? 'All rows, Valant\u2019s original buckets' : 'All rows'}</td>
        {all.valantBucketsCents.map((c, i) => (
          <td key={i} className="px-3 py-2 text-right">
            <Money cents={c} /> {bucketMark(i)}
          </td>
        ))}
        <td className="px-3 py-2 text-right">
          <Money cents={all.totalCents} /> {totalMark}
        </td>
      </tr>
      <tr className="text-slate-500">
        <td className="px-3 py-2 font-semibold" colSpan={lead}>Valant report total</td>
        {labels.map((_, i) => (
          <td key={i} className="px-3 py-2 text-right font-semibold"><Money cents={reportBuckets[i] ?? null} /></td>
        ))}
        <td className="px-3 py-2 text-right font-semibold"><Money cents={reportTotal} /></td>
      </tr>
      {percents ? (
        <tr className="text-slate-500">
          <td className="px-3 py-2 font-semibold" colSpan={lead}>% of total</td>
          {pctOf.map((c, i) => (
            <td key={i} className="px-3 py-2 text-right font-semibold">{all.totalCents ? `${((c / all.totalCents) * 100).toFixed(1)}%` : '—'}</td>
          ))}
          <td className="px-3 py-2 text-right font-semibold">100%</td>
        </tr>
      ) : null}
    </tfoot>
  );
}

function PatientCell({ clientId, name, mrn, valantId }: { clientId: string | null; name: string | null; mrn: string | null; valantId?: string }) {
  if (!clientId) {
    return <span className="text-slate-500">Valant ID {valantId} <span className="text-xs">(not in Altrixs)</span></span>;
  }
  return (
    <Link href={`/dashboard/clients/${clientId}`} className={cx('rounded font-semibold text-slate-900 hover:text-blue-700 hover:underline', FOCUS_RING)}>
      {name ?? 'Patient'}
      {mrn ? <span className="ml-1 text-xs font-normal text-slate-500">{mrn}</span> : null}
    </Link>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className={cx(FILTER_SEARCH, 'sm:max-w-sm')}>
      <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cx(inputClasses, 'h-10 py-1 pl-8 pr-2 text-xs sm:h-9')} />
    </label>
  );
}

function Loading() {
  return (
    <Card>
      <LoadingState />
    </Card>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <Alert tone="danger">{text}</Alert>;
}

function InsuranceTab({ labels, asOfDates }: { labels: string[]; asOfDates: string[] }) {
  const [asOf, setAsOf] = useState<string | null>(null);
  const [rows, setRows] = useState<InsuranceRow[]>([]);
  const [report, setReport] = useState<ReportTotals>(null);
  const [loading, setLoading] = useState(true);
  const [grouped, setGrouped] = useState(false);
  const [q, setQ] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [over120, setOver120] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async (d: string | null) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiJson<{ asOf: string | null; displayAllOver120?: boolean; rows: InsuranceRow[]; report: ReportTotals }>(`/api/billing/valant-balances/insurance${d ? `?asOf=${d}` : ''}`);
      setOver120(Boolean(data.displayAllOver120));
      setAsOf(data.asOf);
      setRows(data.rows);
      setReport(data.report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(null);
  }, [load]);

  const display = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = rows.filter((r) => !needle || r.payerName.toLowerCase().includes(needle));
    if (!grouped) return base.map((r) => ({ ...r, key: r.id, lines: 1 }));
    const map = new Map<string, InsuranceRow[]>();
    for (const r of base) map.set(r.payerName, [...(map.get(r.payerName) ?? []), r]);
    return [...map.entries()]
      .map(([payerName, rs]) => ({ key: payerName, payerName, lines: rs.length, waystar: rs[0].waystar, ...sumPresented(rs, over120) }))
      .sort((a, b) => b.totalCents - a.totalCents);
  }, [rows, grouped, q, over120]);

  if (loading) return <Loading />;
  if (err) return <ErrorBox text={err} />;
  if (!asOf) return <Empty what="Insurance Aging Summary" />;
  const repB = numArr(report?.totals?.reportBucketsCents);
  const repT = typeof report?.totals?.reportTotalCents === 'number' ? (report.totals.reportTotalCents as number) : null;
  const all = presentAgingTotals(rows, { bucketsCents: repB, totalCents: repT });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <AsOfPicker asOf={asOf} dates={asOfDates} onChange={(d) => void load(d)} />
        <SearchBox value={q} onChange={setQ} placeholder="Payer" />
        <label className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
          <input type="checkbox" className={CHECKBOX} checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Group by payer name
        </label>
        <span className="text-xs text-slate-500">
          {rows.length} payer lines · {new Set(rows.map((r) => r.payerName)).size} payer names
        </span>
      </div>
      <Over120Note on={over120} showOriginal={showOriginal} setShowOriginal={setShowOriginal} />
      <div className={TABLE_WRAP}>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className={cx(TH, 'text-left', STICKY_FIRST_TH)}>Payer</th>
              {labels.map((l, i) => (
                <th key={i} scope="col" className={cx(TH, 'text-right')}>{l}</th>
              ))}
              <th scope="col" className={cx(TH, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {display.map((r) => (
              <tr key={r.key} className="group hover:bg-slate-50">
                <td className={cx('px-3 py-2', STICKY_FIRST_TD)}>
                  <span className="font-semibold text-slate-900">{r.payerName}</span>
                  {grouped && r.lines > 1 ? <span className="ml-1 text-xs text-slate-500">({r.lines} lines)</span> : null}
                  {r.waystar ? (
                    <span className="ml-2 inline-flex align-middle" title="Exact name match in the Waystar payer mappings (display only)">
                      <StatusBadge size="sm" tone="info">
                        Waystar {r.waystar.waystarPayerId}
                        {r.waystar.verified ? '' : ' (unverified)'}
                      </StatusBadge>
                    </span>
                  ) : null}
                </td>
                {labels.map((_, i) => (
                  <BucketCell key={i} r={r} i={i} showOriginal={showOriginal} />
                ))}
                <td className="px-3 py-2 text-right font-semibold"><Money cents={r.totalCents} /></td>
              </tr>
            ))}
          </tbody>
          <TotalsFoot labels={labels} all={all} sub={q.trim() ? presentAgingTotals(display) : null} reportBuckets={repB} reportTotal={repT} percents over120={over120} />
        </table>
      </div>
    </div>
  );
}

const PARTY_LABEL: Record<string, string> = { patient: 'Patient', primary: 'Primary', secondary: 'Secondary', other: 'Other' };

function CombinedTab({ labels, asOfDates }: { labels: string[]; asOfDates: string[] }) {
  const [asOf, setAsOf] = useState<string | null>(null);
  const [patients, setPatients] = useState<CombinedPatient[]>([]);
  const [report, setReport] = useState<ReportTotals>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [party, setParty] = useState<'all' | 'patient' | 'insurance'>('all');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const [over120, setOver120] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);

  const load = useCallback(async (d: string | null) => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiJson<{ asOf: string | null; displayAllOver120?: boolean; patients: CombinedPatient[]; report: ReportTotals }>(`/api/billing/valant-balances/combined${d ? `?asOf=${d}` : ''}`);
      setOver120(Boolean(data.displayAllOver120));
      setAsOf(data.asOf);
      setPatients(data.patients);
      setReport(data.report);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load(null);
  }, [load]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return patients.filter((p) => {
      if (party === 'patient' && !p.parties.some((x) => x.party === 'patient')) return false;
      if (party === 'insurance' && !p.parties.some((x) => x.party !== 'patient')) return false;
      if (!needle) return true;
      return [p.clientName, p.mrn, p.valantPatientId, ...p.parties.map((x) => x.payerName)].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [patients, q, party]);

  if (loading) return <Loading />;
  if (err) return <ErrorBox text={err} />;
  if (!asOf) return <Empty what="Combined Aging" />;
  const repB = numArr(report?.totals?.reportBucketsCents);
  const repT = typeof report?.totals?.reportGrandTotalCents === 'number' ? (report.totals.reportGrandTotalCents as number) : null;
  const all = presentAgingTotals(patients, { bucketsCents: repB, totalCents: repT });
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <AsOfPicker asOf={asOf} dates={asOfDates} onChange={(d) => void load(d)} />
        <SearchBox value={q} onChange={setQ} placeholder="Patient, MRN, Valant ID or payer" />
        <select value={party} aria-label="Responsible party filter" onChange={(e) => setParty(e.target.value as typeof party)} className={cx(inputClasses, 'w-auto px-2 py-1 text-xs')}>
          <option value="all">All patients</option>
          <option value="patient">With a patient-responsible line</option>
          <option value="insurance">With an insurance line</option>
        </select>
        <span className="text-xs text-slate-500">
          {patients.length} patients · {patients.reduce((n, p) => n + p.parties.length, 0)} responsible-party lines
        </span>
      </div>
      <Over120Note on={over120} showOriginal={showOriginal} setShowOriginal={setShowOriginal} />
      <div className={TABLE_WRAP}>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className={cx(TH, 'text-left', STICKY_FIRST_TH)}>Patient / responsible party</th>
              <th scope="col" className={cx(TH, 'text-left')}>Last billed</th>
              {labels.map((l, i) => (
                <th key={i} scope="col" className={cx(TH, 'text-right')}>{l}</th>
              ))}
              <th scope="col" className={cx(TH, 'text-right')}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((p) => {
              const isOpen = open.has(p.valantPatientId) || p.parties.length === 1;
              return (
                <Fragment key={p.valantPatientId}>
                  <tr className="group hover:bg-slate-50">
                    <td className={cx('px-3 py-2', STICKY_FIRST_TD)}>
                      {p.parties.length > 1 ? (
                        <button type="button" onClick={() => toggle(p.valantPatientId)} className={cx('mr-1 rounded align-middle text-slate-500 hover:text-slate-700', FOCUS_RING)} aria-label="Show responsible parties" aria-expanded={isOpen}>
                          {isOpen ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
                        </button>
                      ) : null}
                      <PatientCell clientId={p.clientId} name={p.clientName} mrn={p.mrn} valantId={p.valantPatientId} />
                      <span className="ml-2 text-xs text-slate-500">{p.parties.map((x) => PARTY_LABEL[x.party] ?? x.party).join(' + ')}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {p.parties.map((x) => x.lastBilledAt).filter(Boolean).sort().reverse()[0] ?? '—'}
                    </td>
                    {labels.map((_, i) => (
                      <BucketCell key={i} r={p} i={i} showOriginal={showOriginal} />
                    ))}
                    <td className="px-3 py-2 text-right font-semibold"><Money cents={p.totalCents} /></td>
                  </tr>
                  {isOpen
                    ? p.parties.map((x, k) => (
                        <tr key={`${p.valantPatientId}-${k}`} className="bg-slate-50/60 text-slate-600">
                          <td className="py-1.5 pl-9 pr-3">
                            {PARTY_LABEL[x.party] ?? x.party}
                            {x.payerName ? `: ${x.payerName}` : ''}
                          </td>
                          <td className="px-3 py-1.5">{x.lastBilledAt ?? '—'}</td>
                          {labels.map((_, i) => (
                            <BucketCell key={i} r={x} i={i} showOriginal={showOriginal} className="px-3 py-1.5" />
                          ))}
                          <td className="px-3 py-1.5 text-right"><Money cents={x.totalCents} /></td>
                        </tr>
                      ))
                    : null}
                </Fragment>
              );
            })}
          </tbody>
          <TotalsFoot labels={labels} all={all} sub={null} reportBuckets={repB} reportTotal={repT} over120={over120} lead={2} />
        </table>
      </div>
    </div>
  );
}

function PrepaymentsTab({ posted }: { posted: PostedKind | null }) {
  const [period, setPeriod] = useState<Period>(null);
  const [clients, setClients] = useState<PrepayClient[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedGroup[]>([]);
  const [totals, setTotals] = useState<{ transactions: number; sumCents: number; report: Record<string, unknown> | null; reconciles: boolean | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [onlyIncomplete, setOnlyIncomplete] = useState(false);
  const [detail, setDetail] = useState<{ clientId: string; txns: Txn[] } | null>(null);
  const [assigning, setAssigning] = useState<UnmatchedGroup | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiJson<{ period: Period; clients: PrepayClient[]; unmatched: UnmatchedGroup[]; totals: typeof totals }>('/api/billing/valant-balances/prepayments');
      setPeriod(data.period);
      setClients(data.clients);
      setUnmatched(data.unmatched);
      setTotals(data.totals);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (clientId: string) => {
    if (detail?.clientId === clientId) return setDetail(null);
    try {
      const data = await apiJson<{ transactions: Txn[] }>(`/api/billing/valant-balances/prepayments?clientId=${encodeURIComponent(clientId)}`);
      setDetail({ clientId, txns: data.transactions });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load transactions');
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return clients.filter((c) => (!onlyIncomplete || c.incomplete) && (!needle || [c.clientName, c.mrn].some((v) => v?.toLowerCase().includes(needle))));
  }, [clients, q, onlyIncomplete]);

  if (loading) return <Loading />;
  if (err) return <ErrorBox text={err} />;
  if (!period && !clients.length && !unmatched.length) return <Empty what="Prepayments report" />;
  const periodText = period ? `${period.periodStart} to ${period.periodEnd}` : 'unknown period';
  const reportNet = typeof totals?.report?.reportNetCents === 'number' ? (totals.report.reportNetCents as number) : null;
  const remaining = clients.reduce((s, c) => s + (c.remainingCents ?? 0), 0);
  return (
    <div className="space-y-4">
      <Alert tone="warning" title={`Valant Prepayments report, ${periodText}.`}>
        The report only covers this period. A patient whose rows add up below zero used prepayments received before {period?.periodStart ?? 'the start date'}, so
        their remaining credit cannot be shown from this report. Re-export from the earliest date and re-import to complete it.
      </Alert>

      <StatGrid columns={4}>
        <Stat label="Patients with prepayments" value={String(clients.length)} />
        <Stat label="Remaining credit (complete patients)" value={formatCents(remaining)} />
        <Stat label="Incomplete patients" value={String(clients.filter((c) => c.incomplete).length)} />
        <Stat
          label="All rows vs report net"
          value={
            <>
              {formatCents(totals?.sumCents ?? 0)} / {formatCents(reportNet)} {reportNet !== null ? <Mark ok={reportNet === totals?.sumCents} /> : null}
            </>
          }
        />
      </StatGrid>

      {unmatched.length ? (
        <Card>
          <CardHeader
            title={`Unmatched (${unmatched.length} names, ${unmatched.reduce((n, g) => n + g.transactions, 0)} rows)`}
            description="The export has names only. These names match no patient, or more than one patient has the same name. Choose the patient for each name."
          />
          <div className="clinic-scroll-x">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className={cx(TH, 'text-left')}>Name in Valant</th>
                <th scope="col" className={cx(TH, 'text-left')}>Why</th>
                <th scope="col" className={cx(TH, 'text-right')}>Rows</th>
                <th scope="col" className={cx(TH, 'text-right')}>Net ({periodText})</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {unmatched.map((g) => (
                <tr key={g.key}>
                  <td className="px-3 py-2 font-semibold text-slate-900">{g.valantName}</td>
                  <td className="px-3 py-2 text-slate-500">{g.reason === 'duplicate' ? 'Several patients have this name' : g.reason === 'unassigned' ? 'Unassigned by staff' : 'No patient with this name'}</td>
                  <td className="px-3 py-2 text-right">{g.transactions}</td>
                  <td className="px-3 py-2 text-right"><Money cents={g.netCents} /></td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" onClick={() => setAssigning(g)}>
                      Choose patient
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <SearchBox value={q} onChange={setQ} placeholder="Patient or MRN" />
        <label className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600">
          <input type="checkbox" className={CHECKBOX} checked={onlyIncomplete} onChange={(e) => setOnlyIncomplete(e.target.checked)} /> Incomplete only
        </label>
      </div>
      <div className={TABLE_WRAP}>
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th scope="col" className={cx(TH, 'text-left')}>Patient</th>
              <th scope="col" className={cx(TH, 'text-right')}>Rows</th>
              <th scope="col" className={cx(TH, 'text-right')}>Received</th>
              <th scope="col" className={cx(TH, 'text-right')}>Applied</th>
              <th scope="col" className={cx(TH, 'text-right')}>Remaining prepayment ({periodText})</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((c) => (
              <Fragment key={c.clientId}>
                <tr
                  className={cx('cursor-pointer hover:bg-slate-50', FOCUS_RING)}
                  tabIndex={0}
                  aria-expanded={detail?.clientId === c.clientId}
                  onClick={() => void openDetail(c.clientId)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
                    e.preventDefault();
                    void openDetail(c.clientId);
                  }}
                >
                  <td className="px-3 py-2">
                    {detail?.clientId === c.clientId ? <ChevronDown size={12} className="mr-1 inline" aria-hidden /> : <ChevronRight size={12} className="mr-1 inline" aria-hidden />}
                    <Link href={`/dashboard/clients/${c.clientId}`} onClick={(e) => e.stopPropagation()} className={cx('rounded font-semibold text-slate-900 hover:text-blue-700 hover:underline', FOCUS_RING)}>
                      {c.clientName}
                    </Link>
                    {c.mrn ? <span className="ml-1 text-xs text-slate-500">{c.mrn}</span> : null}
                    <PostedBadge posted={posted} clientId={c.clientId} />
                  </td>
                  <td className="px-3 py-2 text-right">{c.transactions}</td>
                  <td className="px-3 py-2 text-right"><Money cents={c.receivedCents} /></td>
                  <td className="px-3 py-2 text-right"><Money cents={c.appliedCents} /></td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {c.incomplete ? <span className="font-semibold text-amber-800">{c.note}</span> : <Money cents={c.remainingCents} />}
                  </td>
                </tr>
                {detail?.clientId === c.clientId ? (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 px-6 py-2">
                      <TxnTable txns={detail.txns} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {assigning ? (
        <AssignDialog
          group={assigning}
          onClose={() => setAssigning(null)}
          onDone={() => {
            setAssigning(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return <StatCard label={label} value={value} />;
}

function TxnTable({ txns }: { txns: Txn[] }) {
  return (
    <div className="clinic-scroll-x">
    <table className="min-w-full text-xs">
      <thead className="text-slate-600">
        <tr>
          <th scope="col" className="py-1 pr-3 text-left font-semibold">Date</th>
          <th scope="col" className="py-1 pr-3 text-left font-semibold">Type</th>
          <th scope="col" className="py-1 pr-3 text-left font-semibold">Reference</th>
          <th scope="col" className="py-1 pr-3 text-left font-semibold">Applied to</th>
          <th scope="col" className="py-1 text-right font-semibold">Amount</th>
        </tr>
      </thead>
      <tbody>
        {txns.map((t) => (
          <tr key={t.id}>
            <td className="py-0.5">{t.date}</td>
            <td className="py-0.5">{t.type}</td>
            <td className="py-0.5">{t.reference ?? '—'}</td>
            <td className="py-0.5">{t.appliedTo ?? '—'}</td>
            <td className="py-0.5 text-right"><Money cents={t.amountCents} /></td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

type PatientHit = { id: string; name: string; mrn: string | null; dateOfBirth: string | null; status: string; valantId: string | null };

function AssignDialog({ group, onClose, onDone }: { group: UnmatchedGroup; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState(group.valantName);
  const [hits, setHits] = useState<PatientHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const data = await apiJson<{ patients: PatientHit[] }>(`/api/billing/valant-balances/patients?q=${encodeURIComponent(term)}`);
        setHits(data.patients);
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Search failed');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const assign = async (clientId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await apiJson('/api/billing/valant-balances/prepayments/assign', {
        method: 'POST',
        body: JSON.stringify({ txnIds: group.txns.map((t) => t.id), clientId }),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not assign');
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Choose patient"
      size="md"
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
        <div>
          <p className="text-base font-semibold text-slate-900">{group.valantName}</p>
          <p className="text-xs text-slate-500">
            {group.transactions} rows · net {formatCents(group.netCents)}. Check the date of birth: patients can share a name.
          </p>
        </div>
        <TxnTable txns={group.txns} />
        <SearchBox value={q} onChange={setQ} placeholder="Search by name or MRN" />
        {err ? <ErrorBox text={err} /> : null}
        <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className={cx(TH, 'text-left')}>Name</th>
                <th scope="col" className={cx(TH, 'text-left')}>DOB</th>
                <th scope="col" className={cx(TH, 'text-left')}>MRN</th>
                <th scope="col" className={cx(TH, 'text-left')}>Valant ID</th>
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {hits.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2 font-semibold">{h.name}{h.status !== 'ACTIVE' ? <span className="ml-1 text-[11px] text-slate-500">{h.status.toLowerCase()}</span> : null}</td>
                  <td className="px-3 py-2">{h.dateOfBirth ?? '—'}</td>
                  <td className="px-3 py-2">{h.mrn ?? '—'}</td>
                  <td className="px-3 py-2">{h.valantId ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <Button size="sm" disabled={busy} onClick={() => void assign(h.id)}>
                      Assign
                    </Button>
                  </td>
                </tr>
              ))}
              {!hits.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-slate-500">No patients found</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
    </Modal>
  );
}
