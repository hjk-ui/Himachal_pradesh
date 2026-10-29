'use client';

import { useEffect, useMemo, useState, type ElementType } from 'react';
import {
  Plus,
  ArrowUpRight,
  Mail,
  Link2,
  BadgeCheck,
  AlertTriangle,
  Clock3,
  FileText,
  X,
  Loader2,
  Layers,
  Landmark,
  CheckCircle2,
  Trash2,
  Calendar,
  DollarSign,
  Building,
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { useSeededModuleList } from '@/features/billing/useSeededModuleList';
import { recordPayment, type PaymentMethod } from '@/features/billing/ledgerApi';
import { PatientLedgerList } from '@/components/billing/PatientLedgerList';
import { LedgerPostForm } from '@/components/billing/LedgerPostForm';
import { PracticePlanBanner } from '@/components/subscription/PracticePlanBanner';
import { BILLING_INVOICES_SEED, type BillingInvoice } from '@/features/billing/billingSeeds';

type Filter = 'all' | 'outstanding' | 'overdue' | 'paid' | 'draft';

const STATUS_META: Record<
  Exclude<BillingInvoice['status'], 'draft'> | 'draft',
  { label: string; bg: string; text: string }
> = {
  outstanding: { label: 'Outstanding', bg: 'bg-amber-50', text: 'text-amber-700' },
  overdue: { label: 'Overdue', bg: 'bg-rose-50', text: 'text-rose-700' },
  paid: { label: 'Paid', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  draft: { label: 'Draft', bg: 'bg-slate-100', text: 'text-slate-600' },
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: ElementType;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}>
          <Icon size={18} />
        </div>
        <div className="text-right">
          <p className="text-3xl font-black tracking-tight text-[#141C34]">{value}</p>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
        </div>
      </div>
    </div>
  );
}

function PaymentModal({
  clients,
  patientSide,
  onClose,
  onSave,
}: {
  clients: { id: string; name: string }[];
  patientSide: boolean;
  onClose: () => void;
  onSave: (input: {
    clientId: string;
    amountCents: number;
    method: PaymentMethod;
    note: string;
  }) => void;
}) {
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('50');
  const [method, setMethod] = useState<PaymentMethod>('CARD');
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[24px] bg-white shadow-[0_28px_80px_rgba(15,23,42,0.28)]">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-black text-[#141C34]">Record payment</h2>
            <p className="text-sm text-slate-500">Post a payment to the live billing ledger.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Client
            </span>
            <select
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              <option value="">Select client...</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Amount
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="50"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Method
            </span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod)}
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            >
              {(patientSide ? ['CARD', 'ACH', 'CASH', 'CHECK'] : ['CARD', 'ACH', 'CASH', 'CHECK', 'INSURANCE']).map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
              Note
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="optional"
              className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none ring-0 transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </label>
        </div>
        <div className="flex gap-3 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!clientId}
            onClick={() =>
              onSave({
                clientId,
                amountCents: Math.round(Number(amount || '0') * 100),
                method,
                note,
              })
            }
            className="flex-1 rounded-2xl bg-violet-600 px-4 py-3 text-sm font-bold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save payment
          </button>
        </div>
      </div>
    </div>
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
  const [payerSource, setPayerSource] = useState('Optum MD Medicaid BH');
  const [checkEftNumber, setCheckEftNumber] = useState('');
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [totalCheckAmount, setTotalCheckAmount] = useState('');
  const [lines, setLines] = useState<BulkPostLine[]>([
    {
      clientId: clients[0]?.id || '',
      claimId: 'CLM-2026-0042',
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
        clientId: clients[0]?.id || '',
        claimId: `CLM-2026-00${prev.length + 42}`,
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
    if (!isBalanced) {
      setError(`Batch allocations must balance exactly to $0.00 before posting. Current remainder: $${remaining.toFixed(2)}`);
      return;
    }
    if (!allLinesValid) {
      setError('Please select a client, date of service, and enter paid amount > 0 for all lines.');
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-4xl overflow-hidden rounded-[26px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)] my-8">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <Layers size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#141C34]">Post Bulk Payment Batch</h2>
              <p className="text-xs text-slate-500">Allocate single payer check/EFT across multiple clients &amp; claims</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          >
            <X size={18} />
          </button>
        </div>

        {error ? (
          <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-xs font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Insurance / Payer Source
              </label>
              <select
                value={payerSource}
                onChange={(e) => setPayerSource(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
              >
                <option value="Optum MD Medicaid BH">Optum MD Medicaid BH</option>
                <option value="CareFirst BlueCross BlueShield">CareFirst BCBS</option>
                <option value="Aetna Behavioral Health">Aetna Behavioral</option>
                <option value="Medicare Novitas Part B">Medicare Novitas Part B</option>
                <option value="UnitedHealthcare Community Plan">UHC Community Plan</option>
                <option value="Cigna Behavioral Health">Cigna Behavioral Health</option>
                <option value="Self-Pay Patient Bulk">Self-Pay Patient Bulk</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Check / EFT Reference #
              </label>
              <input
                type="text"
                placeholder="e.g. EFT-9824018"
                value={checkEftNumber}
                onChange={(e) => setCheckEftNumber(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono font-semibold text-slate-800 outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Payment Date
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Total Check Amount ($)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">$</span>
                <input
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={totalCheckAmount}
                  onChange={(e) => setTotalCheckAmount(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 pl-7 pr-3 py-2 text-xs font-bold text-slate-900 outline-none focus:border-violet-500"
                />
              </div>
            </div>
          </div>

          <div
            className={`rounded-2xl p-4 border transition ${
              isBalanced
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : 'border-amber-200 bg-amber-50 text-amber-900'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-6 text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                    Check Total
                  </span>
                  <span className="text-sm font-black font-mono text-slate-900">
                    ${checkTotalNum.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                    Allocated
                  </span>
                  <span className="text-sm font-black font-mono text-indigo-700">
                    ${appliedTotal.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-bold tracking-wider">
                    Remaining
                  </span>
                  <span
                    className={`text-sm font-black font-mono ${
                      isBalanced ? 'text-emerald-700' : 'text-amber-700'
                    }`}
                  >
                    ${remaining.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isBalanced ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                    <CheckCircle2 size={14} className="text-emerald-600" />
                    Balanced ($0.00 Remaining) · Ready to Post
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                    <AlertTriangle size={14} className="text-amber-600" />
                    Unallocated: ${remaining.toFixed(2)} (Must balance to $0.00)
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">
                Payment Line Allocations ({lines.length})
              </h3>
              <button
                type="button"
                onClick={addLine}
                className="inline-flex items-center gap-1 rounded-lg bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-700 hover:bg-violet-100 transition"
              >
                <Plus size={13} /> Add Client Line
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase font-bold tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2.5">Client</th>
                    <th className="px-3 py-2.5">Claim #</th>
                    <th className="px-3 py-2.5">DOS</th>
                    <th className="px-3 py-2.5">Paid Amount ($)</th>
                    <th className="px-3 py-2.5">CO-45 Adj ($)</th>
                    <th className="px-3 py-2.5">Pt Bal ($)</th>
                    <th className="px-2 py-2.5 text-center">Del</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {lines.map((line, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      <td className="p-2">
                        <select
                          value={line.clientId}
                          onChange={(e) => updateLine(idx, 'clientId', e.target.value)}
                          className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                        >
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
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-mono outline-none focus:border-violet-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="date"
                          value={line.dos}
                          onChange={(e) => updateLine(idx, 'dos', e.target.value)}
                          className="rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={line.paidAmount}
                          onChange={(e) => updateLine(idx, 'paidAmount', e.target.value)}
                          className="w-24 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-900 outline-none focus:border-violet-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={line.adjustment}
                          onChange={(e) => updateLine(idx, 'adjustment', e.target.value)}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={line.patientBalance}
                          onChange={(e) => updateLine(idx, 'patientBalance', e.target.value)}
                          className="w-20 rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:border-violet-500"
                        />
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(idx)}
                          disabled={lines.length === 1}
                          className="rounded p-1 text-slate-400 hover:text-rose-600 disabled:opacity-30"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <p className="text-xs text-slate-500">
            Hard financial guardrail: Remainder must be exactly $0.00 before posting batch.
          </p>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!isBalanced || !allLinesValid || submitting}
              onClick={() => void handlePostBatch()}
              className="inline-flex items-center gap-1.5 rounded-2xl bg-emerald-600 px-5 py-2.5 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <BadgeCheck size={15} />}
              Post Batch ($0.00 Remainder)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PaymentsPage() {
  const { user } = useAuth();
  const billingCore =
    user?.role === 'ADMIN' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'BILLING';
  const patientSide = user?.role === 'OFFICE_MANAGER' || user?.role === 'FRONT_DESK';
  const canRecord = billingCore || patientSide;
  const canMutate = billingCore;
  const { clients } = useClients();
  const [invoices, setInvoices] = useSeededModuleList<BillingInvoice>('invoices', BILLING_INVOICES_SEED);
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
    void loadBatches();
  }, []);

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
    if (!canRecord) return;
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
    if (!canRecord) return;
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
    <div className="mx-auto max-w-6xl space-y-6">
      {showForm ? (
        <PaymentModal
          clients={clients}
          patientSide={patientSide}
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

      <PatientLedgerList />

      <section className="rounded-[28px] border border-violet-100 bg-gradient-to-br from-[#f7f6ff] via-white to-[#eef5ff] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-violet-700 shadow-sm ring-1 ring-violet-100">
              <FileText size={12} /> Billing
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[#141C34] sm:text-4xl">
              Payments
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Track invoices, collect payments, and send links or reminders. Invoice rows persist in the
              organization database and can be posted directly from this page.
            </p>
          </div>
          <LedgerPostForm />
          {canRecord ? (
            <div className="flex flex-wrap gap-2.5">
              {canMutate ? (
              <button
                type="button"
                onClick={() => setShowBulkModal(true)}
                className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-5 py-3 text-sm font-black text-violet-700 shadow-sm transition hover:bg-violet-50"
              >
                <Layers size={16} /> Post Bulk Payment
              </button>
              ) : null}
              <button
                type="button"
                onClick={() => setShowForm(true)}
                className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-3 text-sm font-black text-white shadow-[0_12px_28px_rgba(109,90,230,0.28)] transition hover:bg-violet-700"
              >
                <Plus size={16} /> Record payment
              </button>
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard icon={Clock3} label="Outstanding" value={money(stats.outstanding)} accent="bg-amber-50 text-amber-700" />
          <StatCard icon={AlertTriangle} label="Overdue" value={money(stats.overdue)} accent="bg-rose-50 text-rose-700" />
          <StatCard icon={BadgeCheck} label="Collected" value={money(stats.collected)} accent="bg-emerald-50 text-emerald-700" />
          <StatCard icon={ArrowUpRight} label="Collection rate" value={`${stats.collectionRate}%`} accent="bg-violet-50 text-violet-700" />
        </div>
      </section>

      {message ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
          {error}
        </div>
      ) : null}
      {outboundError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
          {outboundError}
        </div>
      ) : null}

      <PracticePlanBanner />

      <div className="flex flex-wrap gap-2">
        {(['all', 'outstanding', 'overdue', 'paid', 'draft'] as const).map((item) => {
          const active = filter === item;
          const count =
            item === 'all'
              ? invoices.length
              : invoices.filter((invoice) => invoice.status === item).length;
          return (
            <button
              key={item}
              type="button"
              onClick={() => setFilter(item)}
              className={`rounded-2xl px-4 py-2.5 text-sm font-black transition ${
                active ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {item === 'all' ? 'All' : STATUS_META[item].label} ({count})
            </button>
          );
        })}
      </div>

      <div className="space-y-4">
        {visible.map((invoice) => (
          <article key={invoice.id} className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-black text-white">
                  {invoice.clientName
                    .split(' ')
                    .map((part) => part[0])
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-black text-[#141C34]">{invoice.clientName}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS_META[invoice.status].bg} ${STATUS_META[invoice.status].text}`}>
                      {STATUS_META[invoice.status].label}
                    </span>
                    {invoice.note ? (
                      <span className="text-sm text-slate-400">{invoice.note}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">
                    {invoice.invoiceNumber} · {invoice.serviceLabel} · Due {invoice.dueDate}
                  </p>
                </div>
              </div>

              <div className="text-left lg:text-right">
                <p className="text-3xl font-black text-[#141C34]">{money(invoice.amountCents)}</p>
                <p className="mt-1 text-sm text-slate-500">of {money(invoice.amountCents)} billed</p>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void setPaid(invoice)}
                disabled={!canRecord || invoice.status === 'paid' || invoice.amountCents <= 0}
                className="inline-flex items-center gap-2 rounded-2xl bg-emerald-50 px-4 py-2.5 text-sm font-black text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BadgeCheck size={15} /> Mark Paid
              </button>
              <button
                type="button"
                onClick={() => recordReminder(invoice)}
                disabled={invoice.status === 'paid'}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {invoice.reminderSentAt ? 'Reminder recorded' : 'Record reminder'}
              </button>
              <button
                type="button"
                disabled
                title="Requires Stripe"
                onClick={() => setOutboundError('Send Payment Link requires Stripe. It is not configured for this clinic.')}
                className="inline-flex items-center gap-2 rounded-2xl bg-violet-50 px-4 py-2.5 text-sm font-black text-violet-700 opacity-50"
              >
                <Link2 size={15} /> Requires Stripe
              </button>
              <button
                type="button"
                disabled
                title="Requires email"
                onClick={() => setOutboundError('Email Invoice requires email. It is not configured for this clinic.')}
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-4 py-2.5 text-sm font-black text-slate-700 opacity-50"
              >
                <Mail size={15} /> Requires email
              </button>
            </div>
          </article>
        ))}
      </div>

      {/* Batch Deposits & Bank Reconciliation Section */}
      <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200">
              <Landmark size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-[#141C34]">Batch Deposits — Bank Reconciliation</h2>
              <p className="text-xs text-slate-500">Payer bulk check allocations matched to bank settlement records</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadBatches()}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
          >
            Refresh Batches
          </button>
        </div>

        <div className="mt-4 overflow-x-auto">
          {loadingBatches ? (
            <p className="py-6 text-center text-xs text-slate-400">Loading batch reconciliation data...</p>
          ) : postedBatches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-xs text-slate-400">
              No posted batches yet. Use <span className="font-bold text-slate-600">Post Bulk Payment</span> to allocate and reconcile payer checks.
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-100 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                <tr>
                  <th className="pb-2.5">Batch #</th>
                  <th className="pb-2.5">Check / EFT #</th>
                  <th className="pb-2.5">Payer Source</th>
                  <th className="pb-2.5">Payment Date</th>
                  <th className="pb-2.5 text-right">Total Amount</th>
                  <th className="pb-2.5 text-center">Allocated Lines</th>
                  <th className="pb-2.5 text-right">Reconciliation Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {postedBatches.map((batch) => (
                  <tr key={batch.id} className="hover:bg-slate-50/60">
                    <td className="py-3 font-mono font-bold text-slate-900">{batch.batchNumber}</td>
                    <td className="py-3 font-mono text-slate-600">{batch.checkEftNumber}</td>
                    <td className="py-3 font-medium text-slate-900">{batch.payerSource}</td>
                    <td className="py-3 text-slate-500">{new Date(batch.paymentDate).toLocaleDateString()}</td>
                    <td className="py-3 text-right font-mono font-black text-slate-900">
                      ${batch.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 text-center">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700">
                        {batch.lines?.length ?? 1} claims
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        <CheckCircle2 size={12} className="text-emerald-600" />
                        Reconciled · Deposit Verified
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {busyId ? (
        <div className="fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-full bg-[#141C34] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.24)]">
          <Loader2 size={15} className="animate-spin" /> Working on {busyId}
        </div>
      ) : null}
    </div>
  );
}
