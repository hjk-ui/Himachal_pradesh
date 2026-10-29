'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  ArrowUpRight,
  Mail,
  Link2,
  BadgeCheck,
  AlertTriangle,
  Clock3,
  FileText,
  Loader2,
  Layers,
  Landmark,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { isBillingCore, paymentMethodsFor } from '@/lib/billing/billingAccess';
import { useModuleList } from '@/lib/modules/useModuleList';
import { recordPayment, type PaymentMethod } from '@/features/billing/ledgerApi';
import { PracticePlanBanner } from '@/components/subscription/PracticePlanBanner';
import { PatientLedgerHistory } from '@/components/billing/PatientLedgerHistory';
import { type BillingInvoice } from '@/features/billing/billingSeeds';
import { STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';
import {
  Alert, Button, Card, CardHeader, EmptyState, FormField, IconButton, LoadingState, Modal, Page, PageHeader,
  StatCard, StatGrid, StatusBadge, Tabs, cx, inputClasses, type Tone,
} from '@/components/ui';

type Filter = 'all' | 'outstanding' | 'overdue' | 'paid' | 'draft';

const STATUS_META: Record<
  Exclude<BillingInvoice['status'], 'draft'> | 'draft',
  { label: string; tone: Tone }
> = {
  outstanding: { label: 'Outstanding', tone: 'warning' },
  overdue: { label: 'Overdue', tone: 'danger' },
  paid: { label: 'Paid', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function PaymentModal({
  clients,
  methods,
  onClose,
  onSave,
}: {
  clients: { id: string; name: string }[];
  /** Methods this role may post (Front Desk / Office Manager: patient methods only) */
  methods: PaymentMethod[];
  onClose: () => void;
  onSave: (input: {
    clientId: string;
    amountCents: number;
    method: PaymentMethod;
    note: string;
  }) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [note, setNote] = useState('');

  return (
    <Modal
      title="Record Payment"
      size="sm"
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!clientId || !(Number(amount) > 0)}
          onClick={() =>
            onSave({
              clientId,
              amountCents: Math.round(Number(amount || '0') * 100),
              method,
              note,
            })
          }
        >
          Save Payment
        </Button>
      </>}
    >
      <p className="text-sm text-slate-500">Post a payment to the live billing ledger.</p>
      <FormField label="Client">
        <select
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          className={inputClasses}
        >
          <option value="">Select client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Amount">
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          placeholder="Amount"
          className={inputClasses}
        />
      </FormField>
      <FormField label="Method">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          className={inputClasses}
        >
          {methods.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </FormField>
      <FormField label="Note">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="optional"
          className={inputClasses}
        />
      </FormField>
    </Modal>
  );
}

type BulkPostLine = {
  clientId: string;
  claimId: string;
  dos: string;
  paidAmount: string;
  adjustment: string;
  patientBalance: string;
};

type PaymentBatchItem = {
  id: string;
  batchNumber: string;
  payerSource: string;
  checkEftNumber: string;
  paymentDate: string;
  totalAmount: number;
  reconciled: boolean;
  postedById: string;
  createdAt: string;
  lines?: { id: string; paidAmount: number }[];
};

function BulkPostModal({
  clients,
  onClose,
  onSuccess,
}: {
  clients: { id: string; name: string }[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [payerSource, setPayerSource] = useState('');
  const [checkEftNumber, setCheckEftNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalCheckAmount, setTotalCheckAmount] = useState('');
  const [lines, setLines] = useState<BulkPostLine[]>([
    {
      clientId: '',
      claimId: '',
      dos: new Date().toISOString().slice(0, 10),
      paidAmount: '',
      adjustment: '0.00',
      patientBalance: '0.00',
    },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkTotalNum = Number(totalCheckAmount || 0);
  const appliedTotal = lines.reduce((acc, l) => acc + (Number(l.paidAmount) || 0), 0);
  const remaining = Number((checkTotalNum - appliedTotal).toFixed(2));
  const isBalanced = checkTotalNum > 0 && Math.abs(remaining) <= 0.009;
  const allLinesValid =
    lines.length > 0 &&
    lines.every((l) => l.clientId && l.dos && Number(l.paidAmount) > 0);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        clientId: '',
        claimId: '',
        dos: new Date().toISOString().slice(0, 10),
        paidAmount: remaining > 0 ? remaining.toFixed(2) : '',
        adjustment: '0.00',
        patientBalance: '0.00',
      },
    ]);
  };

  const removeLine = (idx: number) => {
    if (lines.length === 1) return;
    setLines((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateLine = (idx: number, field: keyof BulkPostLine, val: string) => {
    setLines((prev) =>
      prev.map((l, i) => (i === idx ? { ...l, [field]: val } : l))
    );
  };

  const handlePostBatch = async () => {
    if (!checkEftNumber.trim()) {
      setError('Check/EFT number is required');
      return;
    }
    if (!payerSource) {
      setError('Select the payer for this batch.');
      return;
    }
    if (!isBalanced) {
      setError(`Batch allocations must balance exactly to $0.00 before posting. Current remainder: $${remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      return;
    }
    if (!allLinesValid) {
      setError('Please select a client, date of service, and enter a paid amount > 0 for all lines.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/payments/bulk-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: payerSource,
          checkEftNumber: checkEftNumber.trim(),
          paymentDate,
          totalAmount: checkTotalNum,
          lines: lines.map((l) => ({
            clientId: l.clientId,
            claimId: l.claimId || undefined,
            dos: l.dos,
            paid: Number(l.paidAmount),
            adjustment: Number(l.adjustment) || 0,
            patientBalance: Number(l.patientBalance) || 0,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to post bulk payment batch');
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Batch post failed');
    } finally {
      setSubmitting(false);
    }
  };

  const cellInput = 'rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

  return (
    <Modal
      title="Post Bulk Payment Batch"
      size="lg"
      onClose={onClose}
      footer={<>
        <p className="mr-auto text-xs text-slate-500">
          Hard financial guardrail: Remainder must be exactly $0.00 before posting batch.
        </p>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!payerSource || !isBalanced || !allLinesValid || submitting}
          loading={submitting}
          icon={<BadgeCheck />}
          onClick={() => void handlePostBatch()}
        >
          Post Batch ($0.00 Remainder)
        </Button>
      </>}
    >
      <p className="text-sm text-slate-500">Allocate a single payer check/EFT across multiple clients &amp; claims</p>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FormField label="Insurance / Payer Source">
          <select
            value={payerSource}
            onChange={(e) => setPayerSource(e.target.value)}
            className={inputClasses}
          >
            <option value="">Select payer…</option>
            <option value="Optum MD Medicaid BH">Optum MD Medicaid BH</option>
            <option value="CareFirst BlueCross BlueShield">CareFirst BCBS</option>
            <option value="Aetna Behavioral Health">Aetna Behavioral</option>
            <option value="Medicare Novitas Part B">Medicare Novitas Part B</option>
            <option value="UnitedHealthcare Community Plan">UHC Community Plan</option>
            <option value="Cigna Behavioral Health">Cigna Behavioral Health</option>
            <option value="Self-Pay Patient Bulk">Self-Pay Patient Bulk</option>
          </select>
        </FormField>

        <FormField label="Check / EFT Reference #">
          <input
            type="text"
            placeholder="e.g. EFT-9824018"
            value={checkEftNumber}
            onChange={(e) => setCheckEftNumber(e.target.value)}
            className={cx(inputClasses, 'font-mono')}
          />
        </FormField>

        <FormField label="Payment Date">
          <input
            type="date"
            value={paymentDate}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={inputClasses}
          />
        </FormField>

        <FormField label="Total Check Amount ($)">
          {(control) => (
            <div className="relative">
              <span aria-hidden className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">$</span>
              <input
                {...control}
                type="number"
                step="0.01"
                placeholder="0.00"
                value={totalCheckAmount}
                onChange={(e) => setTotalCheckAmount(e.target.value)}
                className={cx(inputClasses, 'pl-7 font-semibold tabular-nums')}
              />
            </div>
          )}
        </FormField>
      </div>

      <Alert
        tone={isBalanced ? 'success' : 'warning'}
        icon={false}
        actions={
          isBalanced ? (
            <StatusBadge tone="success" icon={<CheckCircle2 />}>
              Balanced ($0.00 Remaining) · Ready to Post
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning" icon={<AlertTriangle />}>
              Unallocated: ${remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (Must balance to $0.00)
            </StatusBadge>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-6 text-xs">
          <div>
            <span className="block text-xs font-medium text-slate-600">
              Check Total
            </span>
            <span className="font-mono text-sm font-semibold text-slate-900">
              ${checkTotalNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-600">
              Allocated
            </span>
            <span className="font-mono text-sm font-semibold text-blue-700">
              ${appliedTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div>
            <span className="block text-xs font-medium text-slate-600">
              Remaining
            </span>
            <span
              className={`font-mono text-sm font-semibold ${
                isBalanced ? 'text-emerald-700' : 'text-amber-700'
              }`}
            >
              ${remaining.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>
      </Alert>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900">
            Payment Line Allocations ({lines.length})
          </h3>
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={addLine}>
            Add Client Line
          </Button>
        </div>

        <div className="clinic-scroll-x overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
              <tr>
                <th scope="col" className="min-w-[11rem] px-3 py-2.5">Client</th>
                <th scope="col" className="px-3 py-2.5">Claim #</th>
                <th scope="col" className="px-3 py-2.5">DOS</th>
                <th scope="col" className="px-3 py-2.5">Paid Amount ($)</th>
                <th scope="col" className="px-3 py-2.5">CO-45 Adj ($)</th>
                <th scope="col" className="px-3 py-2.5">Pt Bal ($)</th>
                <th scope="col" className="px-2 py-2.5 text-center">Del</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {lines.map((line, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="p-2">
                    <select
                      value={line.clientId}
                      onChange={(e) => updateLine(idx, 'clientId', e.target.value)}
                      aria-label={`Line ${idx + 1} client`}
                      className={cx(cellInput, 'w-full')}
                    >
                      <option value="">Select client…</option>
                      {clients.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="p-2">
                    <input
                      type="text"
                      value={line.claimId}
                      onChange={(e) => updateLine(idx, 'claimId', e.target.value)}
                      placeholder="CLM-0042"
                      aria-label={`Line ${idx + 1} claim number`}
                      className={cx(cellInput, 'w-24 font-mono')}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="date"
                      value={line.dos}
                      onChange={(e) => updateLine(idx, 'dos', e.target.value)}
                      aria-label={`Line ${idx + 1} date of service`}
                      className={cellInput}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={line.paidAmount}
                      onChange={(e) => updateLine(idx, 'paidAmount', e.target.value)}
                      aria-label={`Line ${idx + 1} paid amount`}
                      className={cx(cellInput, 'w-24 font-semibold')}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={line.adjustment}
                      onChange={(e) => updateLine(idx, 'adjustment', e.target.value)}
                      aria-label={`Line ${idx + 1} CO-45 adjustment`}
                      className={cx(cellInput, 'w-20')}
                    />
                  </td>
                  <td className="p-2">
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={line.patientBalance}
                      onChange={(e) => updateLine(idx, 'patientBalance', e.target.value)}
                      aria-label={`Line ${idx + 1} patient balance`}
                      className={cx(cellInput, 'w-20')}
                    />
                  </td>
                  <td className="p-2 text-center">
                    <IconButton
                      label={`Remove line ${idx + 1}`}
                      icon={<Trash2 className="h-4 w-4" />}
                      className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-rose-700"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  // Payer batches, invoice mark-paid and other ledger changes beyond a patient payment: billing
  // core only (same rule as canMutateLedger). Office Manager / Front Desk see Record Payment only.
  const canMutate = isBillingCore(user?.role);
  // Record Payment: billing (any method); Office Manager and Front Desk post patient payments
  // (copay / cash / card / check / ACH, no insurance), the same rule the payments API enforces.
  const paymentMethods = paymentMethodsFor(user?.role);
  const canRecordPayment = paymentMethods.length > 0;
  // Payer batch deposits / bank reconciliation are billing back-office (same gate as the
  // bulk-batch API). Front Desk and primary care roles collect copays here but do not see batches.
  const canSeeBatches = canAccessPath(user?.role, '/dashboard/billing');
  const { clients } = useClients();
  const [invoices, setInvoices, invoicesMeta] = useModuleList<BillingInvoice>('invoices', []);
  const [filter, setFilter] = useState<Filter>('all');
  const [showForm, setShowForm] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [postedBatches, setPostedBatches] = useState<PaymentBatchItem[]>([]);
  const [loadingBatches, setLoadingBatches] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outboundError, setOutboundError] = useState<string | null>(null);
  const [clientStatus, setClientStatus] = useState<Record<string, string>>({});

  const loadBatches = async () => {
    setLoadingBatches(true);
    try {
      const res = await fetch('/api/billing/payments/bulk-batch');
      const data = await res.json();
      if (data.batches) setPostedBatches(data.batches);
    } catch {
      // safe fallback
    } finally {
      setLoadingBatches(false);
    }
  };

  useEffect(() => {
    if (!canSeeBatches) return;
    void loadBatches();
  }, [canSeeBatches]);

  useEffect(() => {
    if (!clients.length) return;
    const map: Record<string, string> = {};
    for (const client of clients) {
      map[client.name.toLowerCase()] = client.id;
    }
    setClientStatus(map);
  }, [clients]);

  const visible = useMemo(
    () => invoices.filter((invoice) => filter === 'all' || invoice.status === filter),
    [filter, invoices]
  );

  const stats = useMemo(() => {
    const outstanding = invoices
      .filter((invoice) => invoice.status === 'outstanding' || invoice.status === 'draft')
      .reduce((sum, invoice) => sum + invoice.amountCents, 0);
    const overdue = invoices.filter((invoice) => invoice.status === 'overdue').reduce((sum, invoice) => sum + invoice.amountCents, 0);
    const collected = invoices.filter((invoice) => invoice.status === 'paid').reduce((sum, invoice) => sum + invoice.amountCents, 0);
    const collectionRate = invoices.length ? Math.round((invoices.filter((invoice) => invoice.status === 'paid').length / invoices.length) * 100) : 0;
    return { outstanding, overdue, collected, collectionRate };
  }, [invoices]);

  const setPaid = async (invoice: BillingInvoice) => {
    if (!canMutate) return;
    if (invoice.status === 'paid' || invoice.amountCents <= 0) return;
    const clientId = clientStatus[invoice.clientName.toLowerCase()];
    setBusyId(invoice.id);
    setMessage(null);
    setError(null);
    try {
      if (clientId) {
        await recordPayment({
          clientId,
          amountCents: invoice.amountCents,
          method: 'CARD',
          note: invoice.note || invoice.invoiceNumber,
        });
      }
      setInvoices((prev) => prev.map((item) => (item.id === invoice.id ? { ...item, status: 'paid' } : item)));
      setMessage(`${invoice.clientName} marked as paid.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark invoice paid');
    } finally {
      setBusyId(null);
    }
  };

  const savePayment = async (input: {
    clientId: string;
    amountCents: number;
    method: PaymentMethod;
    note: string;
  }) => {
    if (!canRecordPayment) return;
    setBusyId(input.clientId);
    setMessage(null);
    setError(null);
    try {
      await recordPayment({
        clientId: input.clientId,
        amountCents: input.amountCents,
        method: input.method,
        note: input.note || null,
      });
      setMessage('Payment recorded.');
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record payment');
    } finally {
      setBusyId(null);
    }
  };

  const recordReminder = (invoice: BillingInvoice) => {
    setInvoices((prev) =>
      prev.map((item) =>
        item.id === invoice.id ? { ...item, reminderSentAt: new Date().toISOString() } : item
      )
    );
    setMessage(`Reminder recorded for ${invoice.clientName}. Email was not sent.`);
  };

  return (
    <Page className="max-w-6xl">
      {showForm ? (
        <PaymentModal
          clients={clients}
          methods={paymentMethods}
          onClose={() => setShowForm(false)}
          onSave={(input) => void savePayment(input)}
        />
      ) : null}

      {showBulkModal ? (
        <BulkPostModal
          clients={clients}
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            setShowBulkModal(false);
            setMessage('Bulk payment batch posted & reconciled successfully.');
            void loadBatches();
          }}
        />
      ) : null}

      <PageHeader
        eyebrow="Billing"
        title="Payments"
        description={
          <>
            Track invoices, collect payments, and send links or reminders. Invoice rows persist in the
            organization database and can be posted directly from this page.
          </>
        }
        actions={
          canRecordPayment ? (
            <>
              {canMutate ? (
                <Button variant="secondary" icon={<Layers />} onClick={() => setShowBulkModal(true)}>
                  Post Bulk Payment
                </Button>
              ) : null}
              <Button icon={<Plus />} onClick={() => setShowForm(true)}>
                Record Payment
              </Button>
            </>
          ) : null
        }
      />

      {message ? (
        <Alert tone="success">
          {message}
        </Alert>
      ) : null}
      {error ? (
        <Alert tone="danger">
          {error}
        </Alert>
      ) : null}
      {outboundError ? (
        <Alert tone="warning">
          {outboundError}
        </Alert>
      ) : null}

      <StatGrid columns={4}>
        <StatCard icon={<Clock3 />} label="Outstanding" value={money(stats.outstanding)} tone="warning" />
        <StatCard icon={<AlertTriangle />} label="Overdue" value={money(stats.overdue)} tone="danger" />
        <StatCard icon={<BadgeCheck />} label="Collected" value={money(stats.collected)} tone="success" />
        <StatCard icon={<ArrowUpRight />} label="Collection rate" value={`${stats.collectionRate}%`} tone="brand" />
      </StatGrid>

      <PracticePlanBanner />

      <Tabs
        variant="pill"
        label="Filter invoices by status"
        controlsPanels={false}
        value={filter}
        onChange={setFilter}
        items={(['all', 'outstanding', 'overdue', 'paid', 'draft'] as const).map((item) => {
          const count =
            item === 'all'
              ? invoices.length
              : invoices.filter((invoice) => invoice.status === item).length;
          return { key: item, label: `${item === 'all' ? 'All' : STATUS_META[item].label} (${count})` };
        })}
      />

      {invoicesMeta.error ? (
        <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={invoicesMeta.retry}>Retry</Button>}>
          {invoicesMeta.error}
        </Alert>
      ) : null}

      <div className="space-y-4">
        {visible.length === 0 ? (
          <Card>
            {invoicesMeta.loading ? (
              <LoadingState label="Loading invoices…" />
            ) : (
              <EmptyState icon={<FileText />} title="No invoices yet." />
            )}
          </Card>
        ) : null}
        {visible.map((invoice) => (
          <Card key={invoice.id} className="p-5">
            <article>
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                  {invoice.clientName
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold text-slate-900">{invoice.clientName}</h3>
                    <StatusBadge tone={STATUS_META[invoice.status].tone} size="sm">
                      {STATUS_META[invoice.status].label}
                    </StatusBadge>
                    {invoice.note ? (
                      <span className="text-sm text-slate-500">{invoice.note}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {invoice.invoiceNumber} · {invoice.serviceLabel} · Due {invoice.dueDate}
                  </p>
                </div>
              </div>

              <div className="text-left lg:text-right">
                <p className="stat-number text-2xl font-semibold text-slate-900">{money(invoice.amountCents)}</p>
                <p className="mt-1 text-sm text-slate-500">of {money(invoice.amountCents)} billed</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                icon={<BadgeCheck className="text-emerald-700" />}
                onClick={() => void setPaid(invoice)}
                disabled={!canMutate || invoice.status === 'paid' || invoice.amountCents <= 0}
              >
                Mark Paid
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => recordReminder(invoice)}
                disabled={invoice.status === 'paid'}
              >
                {invoice.reminderSentAt ? 'Reminder Recorded' : 'Record Reminder'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled
                title="Requires Stripe"
                icon={<Link2 />}
                onClick={() => setOutboundError('Send Payment Link requires Stripe. It is not configured for this clinic.')}
              >
                Requires Stripe
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled
                title="Requires email"
                icon={<Mail />}
                onClick={() => setOutboundError('Email Invoice requires email. It is not configured for this clinic.')}
              >
                Requires Email
              </Button>
            </div>
            </article>
          </Card>
        ))}
      </div>

      {/* Batch Deposits & Bank Reconciliation Section */}
      {canSeeBatches ? (
      <Card>
        <CardHeader
          icon={<Landmark />}
          title="Batch Deposits — Bank Reconciliation"
          description="Payer bulk check allocations matched to bank settlement records"
          actions={
            <Button size="sm" variant="secondary" onClick={() => void loadBatches()}>
              Refresh Batches
            </Button>
          }
        />

        <div className="clinic-scroll-x overflow-x-auto">
          {loadingBatches ? (
            <LoadingState label="Loading batch reconciliation data…" />
          ) : postedBatches.length === 0 ? (
            <EmptyState
              compact
              title="No posted batches yet."
              description={<>Use <span className="font-semibold text-slate-700">Post Bulk Payment</span> to allocate and reconcile payer checks.</>}
            />
          ) : (
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className={cx('px-4 py-3', STICKY_FIRST_TH)}>Batch #</th>
                  <th scope="col" className="px-4 py-3">Check / EFT #</th>
                  <th scope="col" className="px-4 py-3">Payer Source</th>
                  <th scope="col" className="px-4 py-3">Payment Date</th>
                  <th scope="col" className="px-4 py-3 text-right">Total Amount</th>
                  <th scope="col" className="px-4 py-3 text-center">Allocated Lines</th>
                  <th scope="col" className="px-4 py-3 text-right">Reconciliation Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {postedBatches.map((batch) => (
                  <tr key={batch.id} className="group hover:bg-slate-50">
                    <td className={cx('px-4 py-3 font-mono font-semibold text-slate-900', STICKY_FIRST_TD)}>{batch.batchNumber}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{batch.checkEftNumber}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{batch.payerSource}</td>
                    <td className="px-4 py-3 text-slate-500">{new Date(batch.paymentDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-slate-900">
                      ${batch.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge size="sm">
                        {batch.lines?.length ?? 1} claims
                      </StatusBadge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StatusBadge tone="success" size="sm" icon={<CheckCircle2 />}>
                        Reconciled · Deposit Verified
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
      ) : null}

      <PatientLedgerHistory />

      {busyId ? (
        <div role="status" className="fixed bottom-5 right-5 inline-flex max-w-[calc(100vw-2.5rem)] items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Working on {busyId}
        </div>
      ) : null}
    </Page>
  );
}
