'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { Clock, BarChart3, Plus, CheckCircle2, FileText, CreditCard, Send, RefreshCw, Users, Wifi, WifiOff, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import {
  Alert, Button, buttonClasses, Card, cx, EmptyState, FOCUS_RING, FormField, IconButton, inputClasses,
  LoadingState, Page, PageHeader, StatusBadge, Tabs, type Tone,
} from '@/components/ui';
import { useAuth } from '@/features/auth';
import { BILLING_STAFF_ONLY, canEditClaims } from '@/lib/billing/billingAccess';
import { NewClaimModal } from '@/features/billing/NewClaimModal';
import { fetchClaims, type ClaimRecord } from '@/features/billing/claimsApi';
import { fetchPayments, recordPayment, type LedgerEntryRecord, type PaymentMethod, type PaymentRecord } from '@/features/billing/ledgerApi';
import { fetchClients } from '@/features/clients/api/clientsApi';
import { BillingOverviewPanel } from '@/features/billing/overview/BillingOverviewPanel';
import { STICKY_ACTIONS_TD, STICKY_ACTIONS_TH, STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

// ─── Clearinghouse mode comes from GET /api/billing/claims/batch-submit ──────
// 'demo' = submissions get a DEMO tracking ID and nothing reaches a payer.
type ClearinghouseMode = 'loading' | 'demo' | 'configured' | 'unavailable';

type StatementRow = {
  id: string;
  clientId: string;
  clientName: string;
  status: string;
  balanceCents: number;
  periodLabel: string | null;
  sentAt: string | null;
  createdAt: string;
  note: string | null;
};

type Notice = { tone: 'ok' | 'warn' | 'error'; text: string; href?: string; hrefLabel?: string } | null;

type PaymentForm = {
  clientId: string;
  claimId: string;
  amount: string;
  method: PaymentMethod;
  note: string;
  fromStatement: boolean;
};

// Claim statuses the submit route accepts (DENIED = resubmission)
const SUBMITTABLE = ['DRAFT', 'READY', 'DENIED'];
const PAYMENT_METHOD_OPTIONS: PaymentMethod[] = ['INSURANCE', 'CHECK', 'ACH', 'CARD', 'CASH'];
// Payer swatch fills (Tailwind classes; the name and counts always carry the meaning)
const PAYER_COLORS = ['bg-blue-600', 'bg-emerald-600', 'bg-amber-500', 'bg-sky-600', 'bg-rose-500', 'bg-slate-500'];

function money(cents: number | null | undefined) {
  if (cents == null) return '—';
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function shortDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function trackingIdOf(c: ClaimRecord) {
  return c.clearinghouseClaimId || c.availityClaimId || null;
}

// submitClaim requires a signed progress note and an appointment; manual claims lack both
function hasSubmitPrereqs(c: ClaimRecord) {
  return Boolean(c.progressNoteId && c.appointmentId);
}

function isSubmittable(c: ClaimRecord) {
  return SUBMITTABLE.includes(c.status) && !c.submissionInProgress && hasSubmitPrereqs(c);
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

const MODIFIER_CODES = [
  // Telehealth
  { modifier: '95', desc: 'Telehealth — synchronous audio/video', posNote: 'Use with POS 02 or 10', category: 'Telehealth' },
  { modifier: 'GT', desc: 'Interactive audio/video (Medicare telehealth)', posNote: 'Medicare only', category: 'Telehealth' },
  // Credential Level
  { modifier: 'AH', desc: 'Clinical Psychologist (PhD/PsyD)', posNote: 'Doctoral-level billing independently', category: 'Credential' },
  { modifier: 'AJ', desc: 'Clinical Social Worker (LCSW)', posNote: 'LCSW billing independently', category: 'Credential' },
  { modifier: 'HN', desc: "Bachelor's level staff", posNote: 'Supervision required', category: 'Credential' },
  { modifier: 'HO', desc: "Master's level staff", posNote: 'LPC, LCSW, LGPC, etc.', category: 'Credential' },
  { modifier: 'HM', desc: 'Less than bachelor\'s level', posNote: 'Para-professional / peer support worker', category: 'Credential' },
  // Service Type
  { modifier: 'HQ', desc: 'Group setting', posNote: 'Required with 90853', category: 'Service' },
  { modifier: 'HF', desc: 'Substance Abuse Program', posNote: 'Required for SUD treatment — H0004, etc.', category: 'Service' },
  { modifier: 'TJ', desc: 'Program for children and adolescents', posNote: 'Add to child therapy codes', category: 'Service' },
  // Billing Rules
  { modifier: '25', desc: 'Significant, separately identifiable E&M (same day)', posNote: 'Required when billing E&M + psychotherapy same visit', category: 'BillingRule' },
  { modifier: '59', desc: 'Distinct Procedural Service', posNote: 'Unbundles add-on codes when payer requires it', category: 'BillingRule' },
  // Maryland Medicaid
  { modifier: 'EP', desc: 'EPSDT — Early Periodic Screening (under age 21)', posNote: 'Maryland Medicaid child services', category: 'Medicaid' },
  { modifier: 'U1', desc: 'Medicaid — high level of care', posNote: 'Maryland Medicaid specific', category: 'Medicaid' },
  { modifier: 'U3', desc: 'Medicaid — self-help / peer support services', posNote: 'Required with H0038 on MD Medicaid', category: 'Medicaid' },
];

const POS_CODES = [
  { pos: '02', desc: 'Telehealth — off-site (patient not at home)' },
  { pos: '03', desc: 'School — educational setting' },
  { pos: '10', desc: 'Telehealth — patient in home' },
  { pos: '11', desc: 'Office / outpatient clinic' },
  { pos: '12', desc: 'Home — in-home services (non-telehealth)' },
  { pos: '13', desc: 'Assisted Living Facility' },
  { pos: '14', desc: 'Group Home / Domiciliary' },
  { pos: '15', desc: 'Mobile Unit (mobile crisis response)' },
  { pos: '23', desc: 'Emergency Room (crisis intervention)' },
  { pos: '55', desc: 'Residential Substance Abuse Treatment Facility (ASAM 3.1/3.5)' },
  { pos: '56', desc: 'Psychiatric Residential Treatment Center' },
  { pos: '53', desc: 'Community Mental Health Center (CMHC)' },
  { pos: '99', desc: 'Other / unlisted' },
];

const ADJ_REASON_CODES = [
  { code: 'CO-45', desc: 'Charge exceeds fee schedule / maximum allowable', responsibility: 'Contractual', common: true },
  { code: 'CO-97', desc: 'Service is included in another already-adjudicated service', responsibility: 'Contractual', common: true },
  { code: 'CO-167', desc: 'Does not meet definition of medical necessity', responsibility: 'Contractual', common: true },
  { code: 'CO-29', desc: 'Filing deadline expired', responsibility: 'Contractual', common: true },
  { code: 'PR-1', desc: 'Deductible amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'PR-2', desc: 'Coinsurance amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'PR-3', desc: 'Co-payment amount — patient responsibility', responsibility: 'Patient', common: true },
  { code: 'CO-4', desc: 'Service inconsistent with modifier used', responsibility: 'Contractual', common: false },
  { code: 'CO-18', desc: 'Exact duplicate claim / service', responsibility: 'Contractual', common: false },
  { code: 'CO-96', desc: 'Non-covered charge(s)', responsibility: 'Contractual', common: false },
  { code: 'OA-23', desc: 'Non-covered — for coordination of benefits only', responsibility: 'Other', common: false },
  { code: 'CO-109', desc: 'Claim submitted to wrong payer / payer not primary', responsibility: 'Contractual', common: false },
];

const CLAIM_UI_TONE: Record<string, Tone> = {
  approved: 'success',
  pending: 'warning',
  denied: 'danger',
};

/** One idempotency key per payment form state: re-clicking Save on the same form reuses it. */
const paymentKeys = new WeakMap<object, string>();
function paymentKeyFor(form: object): string {
  let key = paymentKeys.get(form);
  if (!key) {
    key = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    paymentKeys.set(form, key);
  }
  return key;
}

export default function BillingPage() {
  const [tab, setTab] = useState<'claims' | 'insurance' | 'cpt' | 'payments' | 'invoices'>('claims');
  const [filter, setFilter] = useState('all');
  const [newClaimModal, setNewClaimModal] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  // Live data — claims, payments, statements and clients all come from the API
  // Office Manager reads the hub; claim work (new claim, submit / resubmit, batch, 276/277) is billing
  // core only (same rule as the claim routes, canMutateClaims). Buttons the role cannot use are hidden.
  const { user } = useAuth();
  const canClaimWork = canEditClaims(user?.role);
  const [claims, setClaims] = useState<ClaimRecord[]>([]);
  const [claimsLoading, setClaimsLoading] = useState(true);
  const [claimsError, setClaimsError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntryRecord[]>([]);
  const [paymentsError, setPaymentsError] = useState<string | null>(null);
  const [statements, setStatements] = useState<StatementRow[]>([]);
  const [statementsError, setStatementsError] = useState<string | null>(null);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [mode, setMode] = useState<ClearinghouseMode>('loading');

  // Per-row action state
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const [rowStatuses, setRowStatuses] = useState<Record<string, string>>({});
  const [selectedClaims, setSelectedClaims] = useState<Set<string>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  // Post Payment form
  const [paymentForm, setPaymentForm] = useState<PaymentForm | null>(null);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);

  const loadClaims = useCallback(async () => {
    try {
      setClaims(await fetchClaims());
      setClaimsError(null);
    } catch (err) {
      setClaimsError(errorText(err, 'Could not load claims'));
    } finally {
      setClaimsLoading(false);
    }
  }, []);

  const loadPayments = useCallback(async () => {
    try {
      const data = await fetchPayments();
      setPayments(data.payments);
      setLedgerEntries(data.ledgerEntries ?? []);
      setPaymentsError(data.schemaReady === false ? 'Payments table is not on this database yet' : null);
    } catch (err) {
      setPaymentsError(errorText(err, 'Could not load payments'));
    }
  }, []);

  const loadStatements = useCallback(async () => {
    try {
      const data = await apiJson<{ success: true; schemaReady: boolean; statements: StatementRow[] }>('/api/billing/statements');
      setStatements(data.statements);
      setStatementsError(data.schemaReady === false ? 'Statements table is not on this database yet' : null);
    } catch (err) {
      setStatementsError(errorText(err, 'Could not load statements'));
    }
  }, []);

  useEffect(() => {
    void loadClaims();
    void loadPayments();
    void loadStatements();
    apiJson<{ mode: string; submitReady?: boolean }>('/api/billing/claims/batch-submit')
      .then(d => setMode(d.mode !== 'configured' ? 'demo' : d.submitReady ? 'configured' : 'unavailable'))
      .catch(() => setMode('unavailable'));
    fetchClients()
      .then(rows => setClients(rows.map(c => ({ id: c.id, name: c.name }))))
      .catch(() => setClients([]));
  }, [loadClaims, loadPayments, loadStatements]);

  const filtered = filter === 'all' ? claims : claims.filter(c => c.uiStatus === filter);
  const canTransmit = mode === 'configured' || mode === 'demo';
  const claimLabel = (id: string | null) => (id ? claims.find(c => c.id === id)?.displayId ?? id.slice(0, 8) : '—');

  const payerBreakdown = useMemo(() => {
    const byPayer = new Map<string, { payer: string; claims: number; approved: number; pending: number; denied: number; cents: number }>();
    for (const c of claims) {
      const key = c.payer || 'No payer on claim';
      const row = byPayer.get(key) ?? { payer: key, claims: 0, approved: 0, pending: 0, denied: 0, cents: 0 };
      row.claims += 1;
      row[c.uiStatus] += 1;
      row.cents += c.amountCents ?? 0;
      byPayer.set(key, row);
    }
    return Array.from(byPayer.values())
      .sort((a, b) => b.claims - a.claims)
      .map((p, i) => ({ ...p, color: PAYER_COLORS[i % PAYER_COLORS.length] }));
  }, [claims]);

  // ─── New claim: create via POST /api/billing/claims, then submit 837P if eligible ─
  async function handleClaimCreated(claim: ClaimRecord) {
    setClaims(prev => [claim, ...prev.filter(c => c.id !== claim.id)]);
    if (!hasSubmitPrereqs(claim)) {
      setNotice({
        tone: 'warn',
        text: `Claim ${claim.displayId} saved as a manual claim. It was NOT submitted: it needs a signed progress note and an appointment before it can be sent.`,
        href: `/dashboard/billing/claims?claimId=${encodeURIComponent(claim.id)}`,
        hrefLabel: 'Open claim',
      });
      await loadClaims();
      return;
    }
    if (!canTransmit) {
      setNotice({ tone: 'warn', text: `Claim ${claim.displayId} saved. Not submitted: the clearinghouse is not available.` });
      await loadClaims();
      return;
    }
    setNotice({ tone: 'warn', text: `Claim ${claim.displayId} saved. Submitting to the clearinghouse…` });
    try {
      const data = await apiJson<{ demoMode: boolean; trackingId: string }>(`/api/billing/claims/${claim.id}/submit`, { method: 'POST' });
      setNotice(data.demoMode
        ? { tone: 'warn', text: `Claim ${claim.displayId} saved. DEMO mode: nothing was sent to a payer.` }
        : { tone: 'ok', text: `Claim ${claim.displayId} submitted. Tracking ID ${data.trackingId}.` });
    } catch (err) {
      setNotice({ tone: 'error', text: `Claim ${claim.displayId} saved but NOT submitted: ${errorText(err, 'submission failed')}` });
    }
    await loadClaims();
  }

  // ─── Submit one claim (837P) ──────────────────────────────────────────────────
  async function handleRowSubmit(claim: ClaimRecord) {
    setRowBusy(claim.id);
    setNotice(null);
    try {
      const data = await apiJson<{ demoMode: boolean; trackingId: string }>(`/api/billing/claims/${claim.id}/submit`, { method: 'POST' });
      setNotice(data.demoMode
        ? { tone: 'warn', text: `${claim.displayId}: DEMO only — nothing was sent to a payer.` }
        : { tone: 'ok', text: `${claim.displayId} submitted. Tracking ID ${data.trackingId}.` });
    } catch (err) {
      setNotice({ tone: 'error', text: `${claim.displayId} not submitted: ${errorText(err, 'submission failed')}` });
    } finally {
      setRowBusy(null);
      await loadClaims();
    }
  }

  // ─── Check 277 payer status for one claim ─────────────────────────────────────
  async function handleCheckStatus(claim: ClaimRecord) {
    setRowBusy(claim.id);
    try {
      const data = await apiJson<{ payerStatus: string }>(`/api/billing/claims/${claim.id}/status`);
      setRowStatuses(prev => ({ ...prev, [claim.id]: data.payerStatus }));
      await loadClaims();
    } catch (err) {
      setRowStatuses(prev => ({ ...prev, [claim.id]: `Status unavailable: ${errorText(err, 'request failed')}` }));
    } finally {
      setRowBusy(null);
    }
  }

  // ─── Batch submit selected claims ─────────────────────────────────────────────
  async function handleBatchSubmit() {
    const ids = claims.filter(c => selectedClaims.has(c.id) && isSubmittable(c)).map(c => c.id).slice(0, 50);
    if (ids.length === 0) return;
    setBatchSubmitting(true);
    setNotice(null);
    try {
      const data = await apiJson<{ results: Array<{ claimId: string; success: boolean; error?: string; demoMode?: boolean }> }>(
        '/api/billing/claims/batch-submit',
        { method: 'POST', body: JSON.stringify({ claimIds: ids }) }
      );
      const lines = data.results.map(r =>
        `${claimLabel(r.claimId)}: ${r.success ? (r.demoMode ? 'DEMO only, not sent' : 'submitted') : `not submitted — ${r.error ?? 'failed'}`}`
      );
      const allSent = data.results.every(r => r.success && !r.demoMode);
      const noneSent = data.results.every(r => !r.success);
      setNotice({ tone: allSent ? 'ok' : noneSent ? 'error' : 'warn', text: lines.join('\n') });
      setSelectedClaims(new Set());
    } catch (err) {
      setNotice({ tone: 'error', text: `Batch not submitted: ${errorText(err, 'request failed')}` });
    } finally {
      setBatchSubmitting(false);
      await loadClaims();
    }
  }

  // ─── A/R worklist report (CSV download) ───────────────────────────────────────
  async function handleRunReport() {
    setReportBusy(true);
    try {
      const res = await fetch('/api/billing/ar/export');
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || `Report failed (${res.status})`);
      }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `ar-worklist-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNotice({ tone: 'error', text: `A/R report not downloaded: ${errorText(err, 'request failed')}` });
    } finally {
      setReportBusy(false);
    }
  }

  // ─── Record a payment (POST /api/billing/payments) ────────────────────────────
  async function handleSavePayment() {
    if (!paymentForm) return;
    const cents = Math.round(parseFloat(paymentForm.amount) * 100);
    if (!paymentForm.clientId || !Number.isFinite(cents) || cents <= 0) {
      setPaymentError('Choose a client and enter an amount greater than zero.');
      return;
    }
    setPaymentSaving(true);
    setPaymentError(null);
    try {
      const payment = await recordPayment({
        clientId: paymentForm.clientId,
        claimId: paymentForm.claimId || null,
        amountCents: cents,
        method: paymentForm.method,
        note: paymentForm.note.trim() || null,
        idempotencyKey: paymentKeyFor(paymentForm),
      });
      setPayments(prev => [payment, ...prev]);
      setNotice({
        tone: 'ok',
        text: `Payment of ${money(payment.amountCents)} recorded.${paymentForm.fromStatement ? ' The statement keeps its current status; update it from Statements.' : ''}`,
      });
      setPaymentForm(null);
    } catch (err) {
      setPaymentError(errorText(err, 'Could not record payment'));
    } finally {
      setPaymentSaving(false);
    }
  }

  // ─── Send statement reminder (POST /api/billing/statements/[id]/send) ─────────
  async function handleSendReminder(st: StatementRow) {
    setSendingId(st.id);
    setNotice(null);
    try {
      const data = await apiJson<{ statement: StatementRow; note: string }>(`/api/billing/statements/${st.id}/send`, { method: 'POST' });
      setStatements(prev => prev.map(s => (s.id === st.id ? data.statement : s)));
      // Dev mode "sends" by logging to the console; that is not a delivery
      const consoleOnly = /logged to console/i.test(data.note ?? '') && !/sent via (SMTP|SNS)/i.test(data.note ?? '');
      const delivered = Boolean(data.statement.sentAt && data.statement.sentAt !== st.sentAt) && !consoleOnly;
      setNotice(delivered
        ? { tone: 'ok', text: `Reminder sent. ${data.note ?? ''}`.trim() }
        : { tone: 'warn', text: `Reminder not delivered. ${data.note ?? ''}`.trim() });
    } catch (err) {
      setNotice({ tone: 'error', text: `Reminder not sent: ${errorText(err, 'request failed')}` });
    } finally {
      setSendingId(null);
    }
  }

  function openPaymentForm(prefill?: Partial<PaymentForm>) {
    setPaymentError(null);
    setPaymentForm({ clientId: '', claimId: '', amount: '', method: 'INSURANCE', note: '', fromStatement: false, ...prefill });
    setTab('payments');
  }

  const submittableFiltered = filtered.filter(isSubmittable);
  const selectedSubmittable = claims.filter(c => selectedClaims.has(c.id) && isSubmittable(c)).length;

  return (
    <Page>
      <PageHeader
        title="Billing"
        description="Claims · ERA · Payments · Revenue Cycle"
        actions={
          <>
            <Button
              variant="secondary"
              icon={<BarChart3 />}
              onClick={() => void handleRunReport()}
              disabled={reportBusy}
              title="Download the A/R worklist as CSV"
            >
              {reportBusy ? 'Preparing…' : 'A/R Report (CSV)'}
            </Button>
            {canClaimWork ? (
              <Button icon={<Plus />} onClick={() => setNewClaimModal(true)}>
                New Claim
              </Button>
            ) : (
              <span className="self-center text-xs text-slate-500">Read-only. {BILLING_STAFF_ONLY}: new claims and submissions.</span>
            )}
          </>
        }
      />

      {/* Clearinghouse status banner */}
      <Alert
        tone={mode === 'configured' ? 'success' : mode === 'loading' ? 'neutral' : 'warning'}
        icon={mode === 'configured' ? <Wifi /> : <WifiOff />}
      >
        {mode === 'loading' && 'Checking clearinghouse connection…'}
        {mode === 'demo' && (
          <><span className="font-semibold">Demo Mode</span>{' — '}claim submissions record a DEMO tracking ID and are not sent to any payer.</>
        )}
        {mode === 'configured' && (
          <><span className="font-semibold">Clearinghouse credentials present</span>{' — '}submissions use the clearinghouse claims API (837P); use 277 to check payer status.</>
        )}
        {mode === 'unavailable' && 'Clearinghouse claim submission is not available (status could not be loaded, or the claims endpoint is not fully configured). Claims can be prepared but not submitted from here.'}
      </Alert>

      {notice && (
        <Alert
          tone={notice.tone === 'ok' ? 'success' : notice.tone === 'warn' ? 'warning' : 'danger'}
          className="whitespace-pre-line"
          actions={
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg opacity-70 hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 md:h-8 md:w-8"
            >
              <X size={14} aria-hidden />
            </button>
          }
        >
          {notice.text}
          {notice.href && <>{' '}<Link href={notice.href} className="font-medium underline">{notice.hrefLabel ?? 'Open'}</Link></>}
        </Alert>
      )}

      {/* Billing overview: Valant (imported) and Altrixs (live), never summed */}
      <BillingOverviewPanel />

      {/* Main panel */}
      <Card className="overflow-hidden">
        <Tabs
          label="Billing sections"
          controlsPanels={false}
          value={tab}
          onChange={setTab}
          className="px-3 pt-1"
          items={[
            { key: 'claims', label: 'Claims' },
            { key: 'insurance', label: 'Altrixs Claim Payers' },
            { key: 'cpt', label: 'Codes & Modifiers' },
            { key: 'payments', label: 'ERA & Payments' },
            { key: 'invoices', label: 'Statements' },
          ]}
        />

        {/* Claims tab */}
        {tab === 'claims' && (
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap gap-2" role="group" aria-label="Filter claims by status">
                {['all', 'approved', 'pending', 'denied'].map(f => (
                  <button key={f} type="button" onClick={() => setFilter(f)}
                    aria-pressed={filter === f}
                    className={cx(
                      'px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors',
                      FOCUS_RING,
                      filter === f ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                    )}>
                    {f} {f !== 'all' && `(${claims.filter(c => c.uiStatus === f).length})`}
                  </button>
                ))}
              </div>
              {canClaimWork && selectedSubmittable > 0 && (
                <Button
                  size="sm"
                  icon={<Send />}
                  onClick={() => void handleBatchSubmit()}
                  disabled={batchSubmitting || !canTransmit}
                  title={canTransmit ? undefined : 'Clearinghouse is not available'}
                >
                  {batchSubmitting ? 'Submitting…' : `Submit ${selectedSubmittable} selected`}
                </Button>
              )}
            </div>
            {claimsError && (
              <Alert
                tone="danger"
                className="mb-3"
                actions={<Button size="sm" variant="secondary" onClick={() => void loadClaims()}>Try again</Button>}
              >
                {claimsError}
              </Alert>
            )}
            <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-50">
                  <tr className="text-xs font-semibold text-slate-600 border-b border-slate-200">
                    <th scope="col" className={cx('px-3 py-3 w-8', STICKY_FIRST_TH)}>
                      <input type="checkbox" aria-label="Select all submittable claims"
                        checked={submittableFiltered.length > 0 && submittableFiltered.every(c => selectedClaims.has(c.id))}
                        onChange={e => {
                          if (e.target.checked) setSelectedClaims(new Set(submittableFiltered.slice(0, 50).map(c => c.id)));
                          else setSelectedClaims(new Set());
                        }} />
                    </th>
                    {['Claim ID', 'Client', 'Service Date', 'CPT', 'Insurance', 'Amount', 'Status', 'Clearinghouse'].map(h => (
                      <th key={h} scope="col" className={cx('px-3 py-3 font-semibold whitespace-nowrap', h === 'Amount' ? 'text-right' : 'text-left')}>{h}</th>
                    ))}
                    <th scope="col" className={cx('px-3 py-3 text-left font-semibold', STICKY_ACTIONS_TH)}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filtered.map(c => {
                    const tracking = trackingIdOf(c);
                    const busy = rowBusy === c.id;
                    return (
                      <tr key={c.id} className="group hover:bg-slate-50 transition-colors">
                        <td className={cx('px-3 py-3', STICKY_FIRST_TD)}>
                          {canClaimWork && isSubmittable(c) && (
                            <input type="checkbox" checked={selectedClaims.has(c.id)} aria-label={`Select ${c.displayId}`}
                              onChange={e => setSelectedClaims(prev => { const s = new Set(prev); if (e.target.checked) s.add(c.id); else s.delete(c.id); return s; })} />
                          )}
                        </td>
                        <td className="px-3 py-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                          <Link href={`/dashboard/billing/claims?claimId=${encodeURIComponent(c.id)}`} className={cx('rounded hover:underline', FOCUS_RING)}>{c.displayId}</Link>
                        </td>
                        <td className="px-3 py-3 min-w-[10rem]">
                          <p className="text-sm font-medium text-slate-900">{c.clientName}</p>
                          <p className="text-xs text-slate-500">{c.clinicianName || '—'}</p>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 whitespace-nowrap">{shortDate(c.serviceDate)}</td>
                        <td className="px-3 py-3">
                          <span className="text-xs font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{c.cptCode}</span>
                        </td>
                        <td className="px-3 py-3 text-sm text-slate-600 min-w-[8rem]">{c.payer || '—'}</td>
                        <td className="px-3 py-3 text-sm font-semibold text-slate-900 text-right tabular-nums whitespace-nowrap">{money(c.amountCents)}</td>
                        <td className="px-3 py-3">
                          <StatusBadge tone={CLAIM_UI_TONE[c.uiStatus] ?? 'neutral'} size="sm" className="capitalize">
                            {c.uiStatus}
                          </StatusBadge>
                          <p className="text-[11px] text-slate-500 mt-0.5 uppercase">{c.status}</p>
                        </td>
                        {/* Clearinghouse column */}
                        <td className="px-3 py-3">
                          {tracking ? (
                            <div>
                              <span className={`text-xs font-mono px-1.5 py-0.5 rounded block mb-0.5 ${c.clearinghouseDemo ? 'text-amber-800 bg-amber-50' : 'text-emerald-800 bg-emerald-50'}`}>
                                {tracking}{c.clearinghouseDemo ? ' (DEMO)' : ''}
                              </span>
                              {rowStatuses[c.id] && <span className="text-xs text-sky-800">{rowStatuses[c.id]}</span>}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500 italic whitespace-nowrap">{c.submissionInProgress ? 'Submission unconfirmed' : 'Not submitted'}</span>
                          )}
                          {c.submissionError && <p className="text-xs text-rose-700 mt-0.5">{c.submissionError}</p>}
                        </td>
                        {/* Actions */}
                        <td className={cx('px-3 py-3', STICKY_ACTIONS_TD)}>
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            {SUBMITTABLE.includes(c.status) && !c.submissionInProgress && !hasSubmitPrereqs(c) && (
                              <span className="text-[11px] text-slate-500 whitespace-nowrap" title="Needs a signed progress note and an appointment before it can be submitted">
                                Needs note + appt
                              </span>
                            )}
                            {canClaimWork && isSubmittable(c) && (
                              <button
                                onClick={() => void handleRowSubmit(c)}
                                type="button"
                                disabled={busy || !canTransmit}
                                title={canTransmit ? 'Submit 837P to the clearinghouse' : 'Clearinghouse is not available'}
                                className={buttonClasses({ size: 'sm' })}>
                                <Send size={14} aria-hidden />
                                {busy ? '…' : c.status === 'DENIED' ? 'Resubmit' : 'Submit'}
                              </button>
                            )}
                            {canClaimWork && tracking && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => void handleCheckStatus(c)}
                                disabled={busy}
                                title="Check payer status (277)"
                                icon={<RefreshCw className={busy ? 'animate-spin' : ''} />}>
                                {busy ? '…' : '277'}
                              </Button>
                            )}
                            {c.uiStatus === 'denied' && (
                              <Link href="/dashboard/billing/denials" className={cx('rounded text-xs text-rose-700 hover:underline font-medium', FOCUS_RING)}>Appeal</Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10}>
                        {claimsLoading ? (
                          <LoadingState label="Loading claims…" />
                        ) : (
                          <EmptyState compact icon={<FileText />} title="No claims yet" />
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Insurance / Payer Breakdown */}
        {tab === 'insurance' && (
          <div className="p-5">
            {payerBreakdown.length === 0 && (
              <EmptyState
                compact
                icon={<Users />}
                title="No Altrixs claims yet — claims start after go-live. The Valant payer mix is in the overview above."
              />
            )}
            {payerBreakdown.length > 0 && (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {payerBreakdown.map(p => (
                  <li key={p.payer} className="p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div className="flex min-w-0 flex-wrap items-center gap-3">
                        <span aria-hidden className={cx('h-3 w-3 shrink-0 rounded-full', p.color)} />
                        <h3 className="font-semibold text-slate-900">{p.payer}</h3>
                        <span className="text-xs text-slate-500">{p.claims} total claims</span>
                      </div>
                      <span className="text-lg font-semibold text-slate-900 tabular-nums">{money(p.cents)}</span>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div className={cx('h-2 rounded-full transition-all', p.color)} style={{ width: `${p.claims > 0 ? (p.approved / p.claims) * 100 : 0}%` }} />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-4 mt-2 text-xs">
                      <span className="text-emerald-700 font-medium flex items-center gap-1"><CheckCircle2 size={14} aria-hidden /> {p.approved} approved</span>
                      <span className="text-amber-700 font-medium flex items-center gap-1"><Clock size={14} aria-hidden /> {p.pending} pending</span>
                      {p.denied > 0 && <span className="text-rose-700 font-medium">{p.denied} denied</span>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* CPT / HCPCS Codes */}
        {tab === 'cpt' && (
          <div className="p-5 space-y-6">
            <Alert tone="brand">
              Practice rates live on the <Link href="/dashboard/billing/fee-schedule" className="font-medium text-blue-700 underline-offset-2 hover:underline">Fee schedule</Link> (imported from Valant&apos;s Fees export).
              CPT usage with charges and expected-at-fee-schedule amounts is in the overview above.
            </Alert>

            {/* Modifiers */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Billing Modifiers</h2>
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-xs text-slate-600 border-b border-slate-200">
                      <th scope="col" className="text-left px-4 py-3 font-semibold">Modifier</th>
                      <th scope="col" className="text-left px-4 py-3 font-semibold">Description</th>
                      <th scope="col" className="text-left px-4 py-3 font-semibold">Category</th>
                      <th scope="col" className="text-left px-4 py-3 font-semibold">When to Use</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {MODIFIER_CODES.map(m => (
                      <tr key={m.modifier} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono font-semibold text-blue-700">{m.modifier}</td>
                        <td className="px-4 py-3 text-slate-700">{m.desc}</td>
                        <td className="px-4 py-3">
                          <StatusBadge size="sm">{m.category}</StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{m.posNote}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Place of Service */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-3">Place of Service (POS) Codes</h2>
              <div className="flex flex-wrap gap-3">
                {POS_CODES.map(p => (
                  <div key={p.pos} className="border border-slate-200 rounded-lg px-4 py-2.5 flex items-center gap-3 bg-white">
                    <span className="font-mono font-semibold text-blue-700 text-sm">{p.pos}</span>
                    <span className="text-xs text-slate-600">{p.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ERA & Payments */}
        {tab === 'payments' && (
          <div className="p-5 space-y-8">
            {/* ERA Files */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Electronic Remittance Advice (ERA)</h2>
                  <p className="text-xs text-slate-500 mt-0.5">835 transaction files from payers.</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled
                  title="Not connected yet: 835 files are not parsed or posted to claims by this app"
                  icon={<FileText />}>
                  Import ERA
                </Button>
              </div>
              <Alert tone="warning">
                Not connected yet: 835 remittances are not imported or auto-posted here. Review remittances in the Waystar portal and record
                insurance payments below with <span className="font-semibold">Post Payment</span>.
              </Alert>
            </div>

            {/* Payment History */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Payment History</h2>
                  <p className="text-xs text-slate-500 mt-0.5">Insurance, check, ACH, card and cash payments recorded in the ledger.</p>
                </div>
                <Button size="sm" icon={<CreditCard />} onClick={() => openPaymentForm()}>
                  Post Payment
                </Button>
              </div>

              {paymentForm && (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-900">Record Payment</h3>
                    <IconButton label="Close" icon={<X size={16} />} onClick={() => setPaymentForm(null)} className="p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700" />
                  </div>
                  {paymentError && <Alert tone="danger">{paymentError}</Alert>}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <FormField label="Client" required>
                      <select value={paymentForm.clientId}
                        onChange={e => setPaymentForm(f => (f ? { ...f, clientId: e.target.value, claimId: '' } : f))}
                        className={inputClasses}>
                        <option value="">Select client…</option>
                        {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Apply to claim">
                      <select value={paymentForm.claimId}
                        onChange={e => setPaymentForm(f => (f ? { ...f, claimId: e.target.value } : f))}
                        disabled={!paymentForm.clientId}
                        className={inputClasses}>
                        <option value="">Not applied to a claim</option>
                        {claims.filter(c => c.clientId === paymentForm.clientId).map(c => (
                          <option key={c.id} value={c.id}>{c.displayId} · {c.cptCode} · {money(c.amountCents)}</option>
                        ))}
                      </select>
                    </FormField>
                    <FormField label="Amount ($)" required>
                      <input type="number" min="0.01" step="0.01" value={paymentForm.amount}
                        onChange={e => setPaymentForm(f => (f ? { ...f, amount: e.target.value } : f))}
                        className={inputClasses} />
                    </FormField>
                    <FormField label="Method" required>
                      <select value={paymentForm.method}
                        onChange={e => setPaymentForm(f => (f ? { ...f, method: e.target.value as PaymentMethod } : f))}
                        className={inputClasses}>
                        {PAYMENT_METHOD_OPTIONS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </FormField>
                    <FormField label="Reference / note" className="sm:col-span-2">
                      <input value={paymentForm.note} maxLength={400}
                        onChange={e => setPaymentForm(f => (f ? { ...f, note: e.target.value } : f))}
                        placeholder="Check / EFT number"
                        className={inputClasses} />
                    </FormField>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" onClick={() => setPaymentForm(null)}>Cancel</Button>
                    <Button onClick={() => void handleSavePayment()} loading={paymentSaving}>
                      {paymentSaving ? 'Recording…' : 'Record Payment'}
                    </Button>
                  </div>
                </div>
              )}

              {paymentsError && (
                <Alert
                  tone="danger"
                  className="mb-3"
                  actions={<Button size="sm" variant="secondary" onClick={() => void loadPayments()}>Try again</Button>}
                >
                  {paymentsError}
                </Alert>
              )}
              <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[860px] text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-xs text-slate-600 border-b border-slate-200">
                      {['Payment ID', 'Method', 'Client', 'Amount', 'Date', 'Applied To', 'Note'].map(h => (
                        <th key={h} scope="col" className={cx('px-4 py-3 font-semibold whitespace-nowrap', h === 'Amount' ? 'text-right' : 'text-left')}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {payments.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{p.id.slice(0, 8)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge size="sm" tone={p.method === 'INSURANCE' ? 'brand' : p.stub ? 'neutral' : 'info'}>
                            {p.stub ? 'STUB (not charged)' : p.method}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{p.clientName}</td>
                        <td className="px-4 py-3 font-semibold text-emerald-700 text-right tabular-nums whitespace-nowrap">{money(p.amountCents)}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{shortDate(p.paidAt)}</td>
                        <td className="px-4 py-3 text-xs font-mono text-slate-600">{claimLabel(p.claimId)}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{p.note || '—'}</td>
                      </tr>
                    ))}
                    {ledgerEntries.map(e => (
                      <tr key={`le-${e.id}`} className="hover:bg-slate-50 bg-slate-50/60">
                        <td className="px-4 py-3 font-mono text-xs text-slate-600">{e.id.slice(0, 8)}</td>
                        <td className="px-4 py-3">
                          <StatusBadge size="sm" tone="warning">{e.label}</StatusBadge>
                        </td>
                        <td className="px-4 py-3 font-semibold text-slate-900">{e.clientName}</td>
                        <td className={`px-4 py-3 font-semibold text-right tabular-nums whitespace-nowrap ${e.amountCents < 0 ? 'text-emerald-700' : 'text-slate-900'}`}>
                          {e.amountCents < 0 ? `${money(-e.amountCents)} credit` : `${money(e.amountCents)} owed`}
                        </td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{shortDate(e.postedAt)}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{e.asOf ? `As of ${e.asOf}` : '—'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{e.note || '—'}</td>
                      </tr>
                    ))}
                    {payments.length === 0 && ledgerEntries.length === 0 && (
                      <tr>
                        <td colSpan={7}>
                          <EmptyState compact icon={<CreditCard />} title="No payments posted yet" />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Adjustment Reason Codes */}
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-1">Adjustment Reason Codes (CARC)</h2>
              <p className="text-xs text-slate-500 mb-3">Standard CMS codes explaining claim adjustments on ERAs. CO = Contractual, PR = Patient Responsibility, OA = Other.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ADJ_REASON_CODES.map(a => (
                  <div key={a.code} className={cx('flex items-start gap-3 p-3 rounded-lg border border-slate-200', a.common ? 'bg-white' : 'bg-slate-50')}>
                    <span className="font-mono font-semibold text-xs text-blue-700 shrink-0 mt-0.5">{a.code}</span>
                    <div className="min-w-0">
                      <p className="text-xs text-slate-700">{a.desc}</p>
                      <span className={`text-xs mt-0.5 inline-block ${
                        a.responsibility === 'Patient' ? 'text-sky-800' :
                        a.responsibility === 'Other' ? 'text-amber-800' : 'text-slate-500'
                      }`}>{a.responsibility}</span>
                    </div>
                    {a.common && <StatusBadge tone="warning" size="sm" className="ml-auto shrink-0">Common</StatusBadge>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Statements (patient invoices) */}
        {tab === 'invoices' && (
          <div className="p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <p className="text-xs text-slate-500">Patient statements. Send a reminder or record a payment against the balance.</p>
              <Link href="/dashboard/billing/statements" className={cx('rounded text-xs text-blue-700 hover:underline font-medium', FOCUS_RING)}>Manage statements</Link>
            </div>
            {statementsError && (
              <Alert
                tone="danger"
                className="mb-3"
                actions={<Button size="sm" variant="secondary" onClick={() => void loadStatements()}>Try again</Button>}
              >
                {statementsError}
              </Alert>
            )}
            {statements.length === 0 && !statementsError && (
              <EmptyState compact icon={<FileText />} title="No statements yet" />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {statements.map(st => (
                <div key={st.id} className="p-4 rounded-lg border border-slate-200">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-xs font-mono text-slate-500">{st.id.slice(0, 8)}</p>
                      <p className="font-semibold text-slate-900 text-sm">{st.clientName}</p>
                      <p className="text-xs text-slate-500">{st.periodLabel || 'Statement'}</p>
                    </div>
                    <StatusBadge
                      size="sm"
                      tone={st.status === 'paid' ? 'success' : st.status === 'overdue' ? 'danger' : 'warning'}
                    >
                      {st.status}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between gap-3 mt-3">
                    <span className="text-lg font-semibold text-slate-900 tabular-nums">{money(st.balanceCents)}</span>
                    <span className="text-xs text-slate-500">{st.sentAt ? `Sent ${shortDate(st.sentAt)}` : `Created ${shortDate(st.createdAt)}`}</span>
                  </div>
                  {st.note && <p className="mt-1 text-xs text-slate-500">{st.note}</p>}
                  {st.status !== 'paid' && (
                    <div className="flex gap-2 mt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        onClick={() => void handleSendReminder(st)}
                        disabled={sendingId === st.id}>
                        {sendingId === st.id ? 'Sending…' : 'Send Reminder'}
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={() => openPaymentForm({ clientId: st.clientId, amount: (st.balanceCents / 100).toFixed(2), method: 'CARD', fromStatement: true })}
                        title="Record a payment in the ledger for this balance">
                        Record Payment
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* Billing Disclaimer */}
      <Alert tone="warning" title="HIPAA Billing Notice">
        All billing information is protected health information (PHI). Access is restricted to authorized billing staff. Ensure compliance with Maryland HIPAA regulations and Medicaid billing requirements. 42 CFR Part 2 applies to any SUD-related billing — obtain specific written consent before disclosing to payers.
      </Alert>

      {/* New Claim Modal — creates via POST /api/billing/claims; submits only when note + appointment exist */}
      <NewClaimModal
        open={newClaimModal}
        onClose={() => setNewClaimModal(false)}
        onCreated={claim => void handleClaimCreated(claim)}
      />
    </Page>
  );
}
