'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  FileText,
  Link2,
  Loader2,
  Mail,
  MessageSquare,
  Phone,
  Plus,
  Printer,
  Search,
  Send,
  X,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useClients } from '@/features/clients';

type StatementStatus = 'outstanding' | 'sent' | 'viewed' | 'paid' | 'overdue' | 'plan';

type StatementRecord = {
  id: string;
  clientId: string;
  clientName: string;
  status: StatementStatus;
  balanceCents: number;
  periodLabel: string | null;
  delivery: string | null;
  paymentLink: string | null;
  sentAt: string | null;
  createdAt: string;
  note: string | null;
};

type StatementsSnapshot = {
  schemaReady: boolean;
  syncedAt: string;
  eraMode: 'waystar' | 'demo';
  emailConfigured: boolean;
  smsConfigured: boolean;
  kpis: {
    totalBalanceCents: number;
    outstandingCount: number;
    sentCount: number;
    overdueCount: number;
    paidCount: number;
    planCount: number;
  };
  statements: StatementRecord[];
};

const PURPLE = '#5C2D91';
const CTA = { background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' };

const STATUS_COLORS: Record<StatementStatus, string> = {
  outstanding: '#B45309',
  sent: '#0369A1',
  viewed: '#5C2D91',
  paid: '#15803D',
  overdue: '#DC2626',
  plan: '#00897B',
};

function money(cents: number) {
  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatTs(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function GenerateModal({
  clients,
  emailConfigured,
  smsConfigured,
  onClose,
  onGenerated,
}: {
  clients: { id: string; name: string; email?: string; phone?: string }[];
  emailConfigured: boolean;
  smsConfigured: boolean;
  onClose: () => void;
  onGenerated: (note: string) => void;
}) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const firstOfMonthStr = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  }, []);

  const [periodFrom, setPeriodFrom] = useState(firstOfMonthStr);
  const [periodTo, setPeriodTo] = useState(todayStr);
  const [selectedClientId, setSelectedClientId] = useState<string>('all');
  const [clientEmail, setClientEmail] = useState('');
  const [clientPhone, setClientPhone] = useState('');
  const [delivery, setDelivery] = useState<'email' | 'sms' | 'both' | 'portal' | 'print'>('email');
  const [minBalance, setMinBalance] = useState('25');
  const [customPayLink, setCustomPayLink] = useState('');
  const [skipPlans, setSkipPlans] = useState(true);
  const [sendNow, setSendNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mockStmtId = useMemo(() => `STM-${Math.floor(10000 + Math.random() * 90000)}`, []);
  const trackedPayLink = customPayLink.trim() || `altrixs.com/pay/${mockStmtId}`;

  const handleClientChange = (id: string) => {
    setSelectedClientId(id);
    if (id === 'all') {
      setClientEmail('');
      setClientPhone('');
    } else {
      const match = clients.find((c) => c.id === id);
      if (match) {
        setClientEmail(
          match.email || `${match.name.toLowerCase().replace(/\s+/g, '.')}@example.com`
        );
        setClientPhone(match.phone || '+1 (240) 555-0199');
      }
    }
  };

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const minBalanceCents = Math.round(Number(minBalance || '0') * 100);
      const periodLabel = `${periodFrom} to ${periodTo}`;
      const res = await apiJson<{
        success: true;
        created: StatementRecord[];
        note: string;
      }>('/api/billing/statements', {
        method: 'POST',
        body: JSON.stringify({
          periodLabel,
          periodFrom,
          periodTo,
          includeClientIds: selectedClientId === 'all' ? null : [selectedClientId],
          delivery,
          emailSentTo: clientEmail || undefined,
          phoneSentTo: clientPhone || undefined,
          minBalanceCents: Number.isFinite(minBalanceCents) ? minBalanceCents : 0,
          paymentLink: trackedPayLink,
          skipPaymentPlans: skipPlans,
          sendNow,
        }),
      });
      onGenerated(res.note);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generate failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm overflow-y-auto">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-[26px] bg-white shadow-[0_30px_90px_rgba(15,23,42,0.3)] my-6">
        <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
              <FileText size={20} />
            </div>
            <div>
              <h2 className="text-base font-black text-[#141C34]">Generate eStatements</h2>
              <p className="text-xs text-slate-500">Auto-reconciled statements with tracked payment links</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-200">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-6 py-5">
          {/* Calendar Date Pickers: From Date & To Date */}
          <div>
            <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Statement Period Date Range
            </span>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">From Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={periodFrom}
                    onChange={(e) => setPeriodFrom(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-semibold text-slate-400 mb-1">To Date</label>
                <div className="relative">
                  <input
                    type="date"
                    value={periodTo}
                    onChange={(e) => setPeriodTo(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Client Selector */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Target Client
            </label>
            <select
              value={selectedClientId}
              onChange={(e) => handleClientChange(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
            >
              <option value="all">All Clients with Outstanding Balance</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Auto-populated Client Contact Information */}
          {selectedClientId !== 'all' ? (
            <div className="rounded-xl border border-violet-100 bg-violet-50/50 p-3 space-y-2 text-xs">
              <p className="text-[10px] font-bold uppercase tracking-wider text-violet-800">
                Auto-Populated from Client Chart
              </p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">Email on file</label>
                  <input
                    type="email"
                    value={clientEmail}
                    onChange={(e) => setClientEmail(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-violet-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-slate-500 mb-0.5">Phone (SMS) on file</label>
                  <input
                    type="tel"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-violet-500"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {/* Delivery Method Selector */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Delivery Channel
            </label>
            <select
              value={delivery}
              onChange={(e) => setDelivery(e.target.value as typeof delivery)}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
            >
              <option value="email">Electronic Email {!emailConfigured ? '(Demo Mode)' : ''}</option>
              <option value="sms">SMS Text Message {!smsConfigured ? '(Demo Mode)' : ''}</option>
              <option value="both">Both (Email + SMS Push)</option>
              <option value="portal">Patient Portal Only</option>
              <option value="print">Print &amp; Mail Queue</option>
            </select>
          </div>

          {/* Minimum Balance */}
          <div>
            <label className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">
              Minimum Statement Balance ($)
            </label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={minBalance}
              onChange={(e) => setMinBalance(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-violet-500"
            />
          </div>

          {/* Tracked Payment Link Banner */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-bold text-emerald-900">
                <Link2 size={14} className="text-emerald-700" />
                Tracked Payment Link Attached
              </span>
              <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">
                Auto-Reconciling
              </span>
            </div>
            <p className="mt-1 font-mono text-emerald-800 font-semibold">{trackedPayLink}</p>
            <p className="mt-1 text-[11px] text-emerald-700">
              Payments completed via this unique URL auto-post to the ledger and clear this statement balance immediately.
            </p>
          </div>

          <div className="space-y-2 pt-1 text-xs text-slate-600">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={skipPlans}
                onChange={(e) => setSkipPlans(e.target.checked)}
                className="rounded border-slate-300 text-violet-600"
              />
              Skip clients with active auto-debit payment plans
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={sendNow}
                onChange={(e) => setSendNow(e.target.checked)}
                className="rounded border-slate-300 text-violet-600"
              />
              Transmit immediately via selected delivery channel
            </label>
          </div>

          {error && <p className="text-xs font-semibold text-rose-600">{error}</p>}
        </div>

        <div className="flex justify-end gap-2.5 border-t border-slate-100 bg-slate-50/50 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !periodFrom || !periodTo}
            onClick={() => void submit()}
            className="inline-flex items-center gap-2 rounded-2xl px-5 py-2 text-xs font-black text-white disabled:opacity-50 shadow-sm"
            style={CTA}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Generate &amp; Transmit
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StatementsPage() {
  const { clients } = useClients();
  const [data, setData] = useState<StatementsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatementStatus | 'all'>('all');
  const [showGenerate, setShowGenerate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiJson<StatementsSnapshot & { success: true }>('/api/billing/statements');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load statements');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const rows = data?.statements ?? [];
    const q = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      return `${row.clientName} ${row.periodLabel || ''} ${row.status}`.toLowerCase().includes(q);
    });
  }, [data, query, statusFilter]);

  async function resend(id: string) {
    setBusyId(id);
    setNote(null);
    try {
      const res = await apiJson<{ success: true; note: string; statement: StatementRecord }>(
        `/api/billing/statements/${id}/send`,
        { method: 'POST' }
      );
      setNote(res.note);
      await load();
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setBusyId(null);
    }
  }

  const kpis = data?.kpis;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: PURPLE }}>
            Billing
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight text-[#141C34]">eStatements</h1>
          <p className="mt-1 text-sm text-slate-500">
            Patient statements from live balances — email/SMS when configured, otherwise persisted with a clear note.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowGenerate(true)}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
          style={CTA}
        >
          <Plus size={16} /> Generate Statements
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </div>
      )}
      {note && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          {note}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          { label: 'Open balance', value: money(kpis?.totalBalanceCents ?? 0), color: PURPLE },
          { label: 'Outstanding', value: String(kpis?.outstandingCount ?? 0), color: STATUS_COLORS.outstanding },
          { label: 'Sent / viewed', value: String(kpis?.sentCount ?? 0), color: STATUS_COLORS.sent },
          { label: 'Overdue', value: String(kpis?.overdueCount ?? 0), color: STATUS_COLORS.overdue },
          { label: 'Paid', value: String(kpis?.paidCount ?? 0), color: STATUS_COLORS.paid },
          { label: 'Payment plans', value: String(kpis?.planCount ?? 0), color: STATUS_COLORS.plan },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
            <p className="text-2xl font-black tracking-tight" style={{ color: kpi.color }}>
              {loading ? '…' : kpi.value}
            </p>
            <p className="mt-0.5 text-sm text-slate-500">{kpi.label}</p>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-black text-[#141C34]">Statements</h2>
          <div className="relative ml-auto min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search statements…"
              className="w-full rounded-xl border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatementStatus | 'all')}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_COLORS) as StatementStatus[]).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <p className="px-5 py-10 text-center text-sm text-slate-500">Loading statements…</p>
        ) : filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <FileText className="mx-auto text-slate-300" size={36} />
            <p className="mt-3 text-sm font-semibold text-slate-600">No statements match your filters</p>
            <p className="mt-1 text-xs text-slate-400">
              Generate statements from open client balances to populate this list.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-bold text-[#141C34]">{row.clientName}</p>
                    <span
                      className="rounded-full px-2.5 py-0.5 text-[11px] font-bold text-white"
                      style={{ backgroundColor: STATUS_COLORS[row.status] }}
                    >
                      {row.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {row.periodLabel || 'Statement'} · {money(row.balanceCents)}
                    {row.delivery ? ` · ${row.delivery}` : ''}
                  </p>
                  {row.note ? <p className="mt-1 text-xs text-slate-400">{row.note}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  onClick={() => void resend(row.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  {row.delivery === 'sms' ? <MessageSquare size={14} /> : <Mail size={14} />}
                  {busyId === row.id ? 'Sending…' : 'Send again'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-center text-xs text-slate-400">
        Synced via Waystar ERA ·{' '}
        {data?.eraMode === 'waystar' && data.syncedAt ? formatTs(data.syncedAt) : 'Demo'}
        {!data?.emailConfigured && !data?.smsConfigured
          ? ' · Email/SMS not configured — statements persist with delivery notes'
          : ''}
      </p>

      {showGenerate && (
        <GenerateModal
          clients={(clients || []).map((c: { id: string; name: string }) => ({
            id: c.id,
            name: c.name,
          }))}
          emailConfigured={Boolean(data?.emailConfigured)}
          smsConfigured={Boolean(data?.smsConfigured)}
          onClose={() => setShowGenerate(false)}
          onGenerated={(msg) => {
            setNote(msg);
            void load();
          }}
        />
      )}
    </div>
  );
}
