'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type ElementType } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  CreditCard,
  History,
  Loader2,
  Plus,
  Settings2,
  ShieldCheck,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { useSeededModuleList } from '@/features/billing/useSeededModuleList';
import {
  fetchAutopay,
  saveAutopay,
  stubAutopayCharge,
  type AutopayRecord,
} from '@/features/billing/ledgerApi';
import {
  AUTOPAY_CHARGE_SEED,
  type AutopayChargeRecord,
} from '@/features/billing/billingSeeds';
import { PracticePlanBanner } from '@/components/subscription/PracticePlanBanner';

const STANDARD_FEE_CENTS = 5000;

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function AutoPayStat({
  icon: Icon,
  label,
  value,
  helper,
  accent,
}: {
  icon: ElementType;
  label: string;
  value: string;
  helper: string;
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
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </div>
  );
}

function luhnValid(num: string): boolean {
  const d = num.replace(/\D/g, '');
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0, dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function AddCardModal({
  client,
  onClose,
  onSuccess,
}: {
  client: AutopayRecord;
  onClose: () => void;
  onSuccess: (cardData: { brand: string; last4: string; expiry: string }) => void;
}) {
  const [cardNumber, setCardNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [zip, setZip] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cleanNum = cardNumber.replace(/\D/g, '');

  const brand = useMemo(() => {
    if (/^4/.test(cleanNum)) return 'Visa';
    if (/^(5[1-5]|2[2-7])/.test(cleanNum)) return 'Mastercard';
    if (/^3[47]/.test(cleanNum)) return 'Amex';
    if (/^6/.test(cleanNum)) return 'Discover';
    return null;
  }, [cleanNum]);

  const brandStyle = useMemo(() => {
    switch (brand) {
      case 'Visa':
        return 'bg-blue-600 text-white';
      case 'Mastercard':
        return 'bg-amber-600 text-white';
      case 'Amex':
        return 'bg-cyan-600 text-white';
      case 'Discover':
        return 'bg-orange-600 text-white';
      default:
        return 'bg-slate-100 text-slate-500';
    }
  }, [brand]);

  const isLuhnOk = useMemo(() => {
    if (cleanNum.length < 13) return false;
    return luhnValid(cleanNum);
  }, [cleanNum]);

  const handleCardNumberChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 16);
    const formatted = digits.match(/.{1,4}/g)?.join(' ') || digits;
    setCardNumber(formatted);
  };

  const handleExpiryChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 4);
    if (digits.length >= 3) {
      setExpiry(`${digits.slice(0, 2)}/${digits.slice(2)}`);
    } else {
      setExpiry(digits);
    }
  };

  const handleSaveCard = async () => {
    if (!isLuhnOk) {
      setError('Invalid card number. Luhn algorithm validation failed.');
      return;
    }
    if (!/^\d{2}\/\d{2}$/.test(expiry)) {
      setError('Expiration date must be in MM/YY format.');
      return;
    }
    const reqCvvLen = brand === 'Amex' ? 4 : 3;
    if (cvv.replace(/\D/g, '').length < reqCvvLen) {
      setError(`CVV must be ${reqCvvLen} digits for ${brand || 'this card'}.`);
      return;
    }
    if (zip.replace(/\D/g, '').length !== 5) {
      setError('Billing ZIP code must be 5 digits.');
      return;
    }

    setAuthorizing(true);
    setError(null);
    try {
      const res = await fetch('/api/billing/autopay/capture-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: client.clientId,
          cardNumber: cleanNum,
          expiry,
          cvv,
          zip,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gateway authorization failed');
      }
      onSuccess({
        brand: data.brand || brand || 'Visa',
        last4: data.last4 || cleanNum.slice(-4),
        expiry,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gateway verification error');
    } finally {
      setAuthorizing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md overflow-hidden rounded-[26px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)]">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <CreditCard size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-[#141C34]">Capture Card on File</h2>
              <p className="text-xs text-slate-500">{client.clientName} · PCI SAQ-A Gateway</p>
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
          <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="p-6 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Card Number
              </label>
              <div className="flex items-center gap-2">
                {brand ? (
                  <span className={`rounded-md px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${brandStyle}`}>
                    {brand}
                  </span>
                ) : (
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                    Auto-Detect Brand
                  </span>
                )}
                {cleanNum.length >= 13 ? (
                  isLuhnOk ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-emerald-600">
                      <CheckCircle2 size={12} /> Luhn Valid
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-600">
                      <AlertTriangle size={12} /> Invalid Checksum
                    </span>
                  )
                ) : null}
              </div>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="4000 1234 5678 9010"
                value={cardNumber}
                onChange={(e) => handleCardNumberChange(e.target.value)}
                className={`w-full rounded-xl border px-3.5 py-2.5 text-sm font-mono font-bold tracking-wider outline-none transition ${
                  cleanNum.length >= 13
                    ? isLuhnOk
                      ? 'border-emerald-400 focus:ring-2 focus:ring-emerald-100'
                      : 'border-rose-400 focus:ring-2 focus:ring-rose-100'
                    : 'border-slate-200 focus:border-violet-500'
                }`}
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Expires (MM/YY)
              </label>
              <input
                type="text"
                placeholder="MM/YY"
                maxLength={5}
                value={expiry}
                onChange={(e) => handleExpiryChange(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono font-bold outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                CVV / CVC
              </label>
              <input
                type="password"
                placeholder={brand === 'Amex' ? '4 digits' : '3 digits'}
                maxLength={brand === 'Amex' ? 4 : 3}
                value={cvv}
                onChange={(e) => setCvv(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono font-bold outline-none focus:border-violet-500"
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Billing ZIP
              </label>
              <input
                type="text"
                placeholder="5 digits"
                maxLength={5}
                value={zip}
                onChange={(e) => setZip(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono font-bold outline-none focus:border-violet-500"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-slate-600 text-[11px]">
            <div className="flex items-center gap-1.5 font-bold text-slate-800 mb-0.5">
              <ShieldCheck size={14} className="text-emerald-600" />
              $0 Gateway Pre-Authorization
            </div>
            Card number is verified with Luhn checksum and tokenized with the merchant gateway. Sensitive PAN and CVV are never stored in plain text.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!isLuhnOk || authorizing}
            onClick={() => void handleSaveCard()}
            className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-5 py-2 text-xs font-black text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 shadow-sm"
          >
            {authorizing ? (
              <>
                <Loader2 size={13} className="animate-spin" /> Authorizing ($0)...
              </>
            ) : (
              'Verify & Save Card'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClientRow({
  row,
  onToggle,
  onCharge,
  onAddCard,
}: {
  row: AutopayRecord;
  onToggle: (row: AutopayRecord) => void;
  onCharge: (row: AutopayRecord) => void;
  onAddCard: (row: AutopayRecord) => void;
}) {
  const initials = row.clientName
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <article className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-black text-white shadow-[0_12px_26px_rgba(109,90,230,0.24)]">
            {initials}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-black text-[#141C34]">{row.clientName}</h3>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                Client
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-500">{row.clientId}</p>
            <p className="mt-1 text-sm text-slate-600">{row.active ? 'Autopay enabled' : 'Autopay paused'}</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:justify-items-end">
          <div className="rounded-2xl bg-slate-50 px-4 py-3 text-left sm:text-right">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Card</p>
            <p className="mt-1 text-sm font-bold text-[#141C34]">
              {row.last4 ? `\u2022\u2022\u2022\u2022 ${row.last4}` : 'No card on file'}
            </p>
            <p className="text-xs text-slate-500">{row.active ? `Standard fee ${money(STANDARD_FEE_CENTS)}` : 'Enable autopay to charge automatically'}</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onToggle(row)}
              className={`relative inline-flex h-10 w-18 items-center rounded-full border-2 p-1 transition ${
                row.active ? 'border-violet-500 bg-violet-500/15' : 'border-slate-300 bg-slate-200'
              }`}
              aria-label={row.active ? 'Disable autopay' : 'Enable autopay'}
            >
              <span
                className={`h-7 w-7 rounded-full bg-white shadow transition ${
                  row.active ? 'translate-x-8' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm font-bold text-slate-500">AutoPay</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAddCard(row)}
          className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
        >
          {row.last4 ? <Settings2 size={15} /> : <Plus size={15} />}
          {row.last4 ? 'Update Card' : 'Capture Card'}
        </button>
        <button
          type="button"
          onClick={() => onCharge(row)}
          disabled={!row.active || !row.last4}
          className="inline-flex items-center gap-2 rounded-2xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Zap size={15} /> Charge Session Now
        </button>
        <span className="inline-flex items-center gap-2 text-sm text-slate-500">
          <ClockIcon />
          Timing: Immediately after session
        </span>
      </div>
    </article>
  );
}

function ClockIcon() {
  return (
    <svg className="h-4 w-4 text-slate-400" viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 6.5V10l2.5 1.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HistoryRow({
  row,
  onRetry,
}: {
  row: AutopayChargeRecord;
  onRetry: (row: AutopayChargeRecord) => void;
}) {
  const success = row.status === 'charged';
  return (
    <article className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              success ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
            }`}
          >
            {success ? <ShieldCheck size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div>
            <p className="text-base font-black text-[#141C34]">{row.clientName}</p>
            <p className="text-sm text-slate-500">
              {new Date(row.chargedAt).toLocaleDateString('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
              })}{' '}
              - {row.method}
            </p>
            {row.note ? <p className={`mt-1 text-sm ${success ? 'text-slate-500' : 'text-rose-600'}`}>{row.note}</p> : null}
          </div>
        </div>
        <div className="flex items-center gap-4 lg:text-right">
          <div>
            <p className="text-2xl font-black text-[#141C34]">{money(row.amountCents)}</p>
            <p className={`text-sm font-semibold ${success ? 'text-emerald-700' : 'text-rose-600'}`}>
              {success ? 'Charged' : 'Failed'}
            </p>
          </div>
          {!success && row.retryable ? (
            <button
              type="button"
              onClick={() => onRetry(row)}
              className="rounded-2xl bg-rose-50 px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-100"
            >
              Retry
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export default function AutopayPage() {
  const { user } = useAuth();
  const canMutate = user?.role === 'ADMIN' || user?.role === 'DIRECTOR' || user?.role === 'BILLING';
  const [rows, setRows] = useState<AutopayRecord[]>([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [paymentsMode, setPaymentsMode] = useState<string>('test mode');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'clients' | 'history'>('clients');
  const [clientFilter, setClientFilter] = useState<
    'all' | 'autopay-on' | 'inactive' | 'needs-card' | 'failed-charges'
  >('all');
  const [cardModalClient, setCardModalClient] = useState<AutopayRecord | null>(null);
  const [last4Drafts, setLast4Drafts] = useState<Record<string, string>>({});
  const [charges, setCharges] = useSeededModuleList<AutopayChargeRecord>(
    'autopay-charges',
    AUTOPAY_CHARGE_SEED
  );

  const filteredClients = useMemo(() => {
    switch (clientFilter) {
      case 'autopay-on':
        return rows.filter((r) => r.active && r.last4);
      case 'inactive':
        return rows.filter((r) => !r.active);
      case 'needs-card':
        return rows.filter((r) => !r.last4);
      case 'failed-charges': {
        const failedClientIds = new Set(charges.filter((c) => c.status === 'failed').map((c) => c.clientId));
        return rows.filter((r) => failedClientIds.has(r.clientId));
      }
      default:
        return rows;
    }
  }, [clientFilter, rows, charges]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAutopay();
      setRows(data.enrollments);
      setSchemaReady(data.schemaReady !== false);
      if (data.paymentsMode) setPaymentsMode(data.paymentsMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load autopay');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => {
    const enabled = rows.filter((row) => row.active).length;
    const needCard = rows.filter((row) => !row.active && !row.last4).length;
    const failed = charges.filter((charge) => charge.status === 'failed').length;
    const collected = charges
      .filter((charge) => charge.status === 'charged')
      .reduce((sum, charge) => sum + charge.amountCents, 0);
    return { enabled, needCard, failed, collected };
  }, [charges, rows]);

  const toggleRow = async (row: AutopayRecord) => {
    if (!canMutate) return;
    const nextActive = !row.active;
    const draft = last4Drafts[row.clientId] || row.last4 || '4242';
    const last4 = draft.replace(/\D/g, '').slice(-4);
    if (nextActive && last4.length !== 4) {
      setError('Enter the last 4 digits before enabling autopay.');
      return;
    }

    setBusyId(row.clientId);
    setError(null);
    setMessage(null);
    try {
      const enrollment = await saveAutopay({
        clientId: row.clientId,
        active: nextActive,
        last4: nextActive ? last4 : row.last4,
      });
      setRows((prev) => prev.map((item) => (item.clientId === enrollment.clientId ? enrollment : item)));
      setMessage(nextActive ? `${row.clientName} is now enrolled in AutoPay.` : `${row.clientName} autopay paused.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save autopay');
    } finally {
      setBusyId(null);
    }
  };

  const chargeRow = async (row: AutopayRecord) => {
    if (!canMutate || !row.active || !row.last4) return;
    setBusyId(row.clientId);
    setError(null);
    setMessage(null);
    try {
      const payment = await stubAutopayCharge({
        clientId: row.clientId,
        amountCents: STANDARD_FEE_CENTS,
        last4: row.last4,
      });
      setCharges((prev) => [
        {
          id: `ap-${Date.now()}`,
          clientId: row.clientId,
          clientName: row.clientName,
          email: `${row.clientName.toLowerCase().replace(/\s+/g, '.')}@example.com`,
          amountCents: payment.amountCents,
          chargedAt: payment.paidAt,
          status: 'charged',
          method: row.last4 ? `Card ****${row.last4}` : 'Card on file',
          last4: row.last4,
          note: 'Autopay session charge',
        },
        ...prev,
      ]);
      setMessage(`Charge posted for ${row.clientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not charge autopay');
    } finally {
      setBusyId(null);
    }
  };

  const retryCharge = async (row: AutopayChargeRecord) => {
    if (!canMutate) return;
    setBusyId(row.clientId);
    setError(null);
    setMessage(null);
    try {
      const payment = await stubAutopayCharge({
        clientId: row.clientId,
        amountCents: row.amountCents || STANDARD_FEE_CENTS,
        last4: row.last4,
      });
      setCharges((prev) =>
        prev.map((entry) =>
          entry.id === row.id
            ? {
                ...entry,
                status: 'charged',
                chargedAt: payment.paidAt,
                note: 'Retry succeeded',
              }
            : entry
        )
      );
      setMessage(`Retry succeeded for ${row.clientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry charge');
    } finally {
      setBusyId(null);
    }
  };

  const promptForCard = (row: AutopayRecord) => {
    if (!canMutate) return;
    const last4 = window.prompt(`Enter the last 4 digits for ${row.clientName}`, row.last4 || '4242');
    if (last4 === null) return;
    const clean = last4.replace(/\D/g, '').slice(-4);
    if (clean.length !== 4) {
      setError('Last 4 digits must be exactly 4 numbers.');
      return;
    }
    setLast4Drafts((prev) => ({ ...prev, [row.clientId]: clean }));
    void toggleRow({ ...row, last4: clean, active: false });
  };

  const historyRows = useMemo(() => charges, [charges]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading AutoPay...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <section className="rounded-[28px] border border-violet-100 bg-gradient-to-br from-[#f7f6ff] via-white to-[#eef5ff] p-6 shadow-[0_20px_60px_rgba(15,23,42,0.08)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-violet-700 shadow-sm ring-1 ring-violet-100">
              <Zap size={12} /> Billing
            </p>
            <h1 className="mt-4 text-3xl font-black tracking-tight text-[#141C34] sm:text-4xl">
              AutoPay
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              Automatically charge clients after sessions, keep payment methods on file, and retry failed
              charges from a single view. Rows are loaded from the live organization database.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/live \(approved\)/i.test(paymentsMode) ? (
                <span
                  className="inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-emerald-900 ring-1 ring-emerald-200"
                  data-testid="autopay-live-badge"
                >
                  Live mode
                </span>
              ) : (
                <span
                  className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-amber-950 ring-1 ring-amber-200"
                  data-testid="autopay-test-badge"
                >
                  Test mode
                </span>
              )}
              <p className="text-sm font-semibold text-slate-700">
                {paymentsMode}. Sweep drafts do not mean money was captured.
                {!/live \(approved\)/i.test(paymentsMode)
                  ? ' Live Stripe keys are refused unless PATIENT_PAYMENTS_LIVE_APPROVED=true.'
                  : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/dashboard/billing/payments"
              className="inline-flex items-center gap-2 rounded-2xl border border-violet-200 bg-white px-4 py-3 text-sm font-bold text-violet-700 transition hover:bg-violet-50"
            >
              <History size={15} /> Open payments
            </Link>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <AutoPayStat
            icon={BadgeCheck}
            label="AutoPay enabled"
            value={String(stats.enabled)}
            helper={`of ${rows.length} clients`}
            accent="bg-violet-50 text-violet-700"
          />
          <AutoPayStat
            icon={CreditCard}
            label="Need card"
            value={String(stats.needCard)}
            helper="Autopay on, no card on file"
            accent="bg-amber-50 text-amber-700"
          />
          <AutoPayStat
            icon={AlertTriangle}
            label="Failed charges"
            value={String(stats.failed)}
            helper="Need attention"
            accent="bg-rose-50 text-rose-700"
          />
          <AutoPayStat
            icon={Wallet}
            label="Auto-collected"
            value={money(stats.collected)}
            helper="Total collected to date"
            accent="bg-emerald-50 text-emerald-700"
          />
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
      {!schemaReady ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Autopay table is not on this database yet. Run prisma db push, then refresh.
        </div>
      ) : null}

      <PracticePlanBanner />

      <div className="flex flex-wrap gap-2">
        {[
          { key: 'clients', label: 'Clients', icon: ShieldCheck },
          { key: 'history', label: 'Charge History', icon: History },
        ].map((item) => {
          const active = tab === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key as 'clients' | 'history')}
              className={`inline-flex items-center gap-2 rounded-2xl px-5 py-3 text-sm font-black transition ${
                active ? 'bg-violet-600 text-white shadow-sm' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              <Icon size={15} /> {item.label}
            </button>
          );
        })}
      </div>

      {cardModalClient ? (
        <AddCardModal
          client={cardModalClient}
          onClose={() => setCardModalClient(null)}
          onSuccess={(cardData) => {
            setRows((prev) =>
              prev.map((r) =>
                r.clientId === cardModalClient.clientId
                  ? { ...r, last4: cardData.last4, active: true }
                  : r
              )
            );
            setCardModalClient(null);
            setMessage(
              `Card (${cardData.brand} •••• ${cardData.last4}) successfully tokenized & saved to client chart.`
            );
          }}
        />
      ) : null}

      {tab === 'clients' ? (
        <div className="space-y-4">
          {/* Client Filter Pills */}
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'all', label: 'All', count: rows.length },
              {
                id: 'autopay-on',
                label: 'AutoPay On',
                count: rows.filter((r) => r.active && r.last4).length,
              },
              { id: 'inactive', label: 'Inactive', count: rows.filter((r) => !r.active).length },
              { id: 'needs-card', label: 'Needs Card', count: rows.filter((r) => !r.last4).length },
              {
                id: 'failed-charges',
                label: 'Failed Charges',
                count: charges.filter((c) => c.status === 'failed').length,
              },
            ].map((f) => {
              const active = clientFilter === f.id;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setClientFilter(f.id as typeof clientFilter)}
                  className={`rounded-2xl px-4 py-2 text-xs font-bold transition ${
                    active
                      ? 'bg-violet-600 text-white shadow-xs'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label} ({f.count})
                </button>
              );
            })}
          </div>

          {filteredClients.map((row) => (
            <ClientRow
              key={row.clientId}
              row={row}
              onToggle={(next) => void toggleRow(next)}
              onCharge={chargeRow}
              onAddCard={(target) => setCardModalClient(target)}
            />
          ))}
          {filteredClients.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-500">
              No clients matching the selected filter.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {stats.failed > 0 ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {stats.failed} failed charge{stats.failed === 1 ? '' : 's'} - retry below to collect.
            </div>
          ) : null}

          {historyRows.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center text-slate-500">
              No charge history yet.
            </div>
          ) : (
            historyRows.map((row) => (
              <HistoryRow key={row.id} row={row} onRetry={retryCharge} />
            ))
          )}
        </div>
      )}

      <Link href="/dashboard/billing/payments" className="text-sm font-bold text-violet-700 hover:underline">
        Open payments ledger
      </Link>

      {busyId ? (
        <div className="fixed bottom-5 right-5 inline-flex items-center gap-2 rounded-full bg-[#141C34] px-4 py-2 text-sm font-semibold text-white shadow-[0_16px_30px_rgba(15,23,42,0.24)]">
          <Loader2 size={15} className="animate-spin" /> Working on {busyId}
        </div>
      ) : null}
    </div>
  );
}
