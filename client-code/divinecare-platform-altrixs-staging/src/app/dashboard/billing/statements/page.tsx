'use client';

import { statementLineText, type StatementLines } from '@/lib/billing/patientLedgerMath';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  FileText,
  Link2,
  Mail,
  MessageSquare,
  Plus,
  Search,
  Send,
} from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useClients } from '@/features/clients';
import { FILTER_BAR, FILTER_SEARCH, FILTER_SELECT } from '@/features/billing/tableLayout';
import {
  Alert, Button, Card, EmptyState, FormField, LoadingState, Modal, Page, PageHeader, StatCard, StatusBadge,
  cx, inputClasses, type Tone,
} from '@/components/ui';

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
  lines?: StatementLines | null;
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

const STATUS_TONES: Record<StatementStatus, Tone> = {
  outstanding: 'warning',
  sent: 'info',
  viewed: 'brand',
  paid: 'success',
  overdue: 'danger',
  plan: 'success',
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

  const [mockStmtId] = useState(() => `STM-${Math.floor(10000 + Math.random() * 90000)}`);
  const trackedPayLink = customPayLink.trim() || `altrixs.com/pay/${mockStmtId}`;

  const handleClientChange = (id: string) => {
    setSelectedClientId(id);
    if (id === 'all') {
      setClientEmail('');
      setClientPhone('');
    } else {
      const match = clients.find((c) => c.id === id);
      if (match) {
        setClientEmail(match.email || '');
        setClientPhone(match.phone || '');
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
    <Modal
      title="Generate eStatements"
      onClose={onClose}
      footer={<>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={busy || !periodFrom || !periodTo}
          loading={busy}
          icon={<Send />}
          onClick={() => void submit()}
        >
          Generate &amp; Transmit
        </Button>
      </>}
    >
      <p className="text-sm text-slate-500">Auto-reconciled statements with tracked payment links</p>

      {/* Calendar Date Pickers: From Date & To Date */}
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-slate-700">
          Statement Period Date Range
        </legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="From Date" labelClassName="mb-1 block text-xs font-medium text-slate-600">
            <input
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
              className={inputClasses}
            />
          </FormField>
          <FormField label="To Date" labelClassName="mb-1 block text-xs font-medium text-slate-600">
            <input
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
              className={inputClasses}
            />
          </FormField>
        </div>
      </fieldset>

      {/* Client Selector */}
      <FormField label="Target Client">
        <select
          value={selectedClientId}
          onChange={(e) => handleClientChange(e.target.value)}
          className={inputClasses}
        >
          <option value="all">All Clients with Outstanding Balance</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </FormField>

      {/* Auto-populated Client Contact Information */}
      {selectedClientId !== 'all' ? (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">
            Auto-Populated from Client Chart
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Email on file" labelClassName="mb-1 block text-xs font-medium text-slate-600">
              <input
                type="email"
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                className={inputClasses}
              />
            </FormField>
            <FormField label="Phone (SMS) on file" labelClassName="mb-1 block text-xs font-medium text-slate-600">
              <input
                type="tel"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className={inputClasses}
              />
            </FormField>
          </div>
        </div>
      ) : null}

      {/* Delivery Method Selector */}
      <FormField label="Delivery Channel">
        <select
          value={delivery}
          onChange={(e) => setDelivery(e.target.value as typeof delivery)}
          className={inputClasses}
        >
          <option value="email">Electronic Email {!emailConfigured ? '(Demo Mode)' : ''}</option>
          <option value="sms">SMS Text Message {!smsConfigured ? '(Demo Mode)' : ''}</option>
          <option value="both">Both (Email + SMS Push)</option>
          <option value="portal">Patient Portal Only</option>
          <option value="print">Print &amp; Mail Queue</option>
        </select>
      </FormField>

      {/* Minimum Balance */}
      <FormField label="Minimum Statement Balance ($)">
        <input
          type="number"
          min={0}
          step="0.01"
          value={minBalance}
          onChange={(e) => setMinBalance(e.target.value)}
          className={inputClasses}
        />
      </FormField>

      {/* Tracked Payment Link Banner */}
      <Alert
        tone="success"
        icon={<Link2 />}
        title="Tracked Payment Link Attached"
        actions={<StatusBadge tone="success" size="sm">Auto-Reconciling</StatusBadge>}
      >
        <p className="mt-1 break-all font-mono font-semibold">{trackedPayLink}</p>
        <p className="mt-1 text-xs">
          Payments completed via this unique URL auto-post to the ledger and clear this statement balance immediately.
        </p>
      </Alert>

      <div className="space-y-2 pt-1 text-sm text-slate-700">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={skipPlans}
            onChange={(e) => setSkipPlans(e.target.checked)}
            className="rounded border-slate-300 text-blue-600"
          />
          Skip clients with active auto-debit payment plans
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sendNow}
            onChange={(e) => setSendNow(e.target.checked)}
            className="rounded border-slate-300 text-blue-600"
          />
          Transmit immediately via selected delivery channel
        </label>
      </div>

      {error && <Alert tone="danger">{error}</Alert>}
    </Modal>
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
    <Page>
      <PageHeader
        eyebrow="Billing"
        title="eStatements"
        description="Patient statements from live balances — email/SMS when configured, otherwise persisted with a clear note."
        actions={
          <Button icon={<Plus />} onClick={() => setShowGenerate(true)}>
            Generate Statements
          </Button>
        }
      />

      {error && (
        <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={() => void load()}>Retry</Button>}>
          {error}
        </Alert>
      )}
      {note && (
        <Alert tone="neutral">
          {note}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[
          { label: 'Open balance', value: money(kpis?.totalBalanceCents ?? 0), tone: 'brand' as Tone, icon: <FileText /> },
          { label: 'Outstanding', value: String(kpis?.outstandingCount ?? 0), tone: STATUS_TONES.outstanding, icon: <Clock /> },
          { label: 'Sent / viewed', value: String(kpis?.sentCount ?? 0), tone: STATUS_TONES.sent, icon: <Send /> },
          { label: 'Overdue', value: String(kpis?.overdueCount ?? 0), tone: STATUS_TONES.overdue, icon: <AlertTriangle /> },
          { label: 'Paid', value: String(kpis?.paidCount ?? 0), tone: STATUS_TONES.paid, icon: <CheckCircle2 /> },
          { label: 'Payment plans', value: String(kpis?.planCount ?? 0), tone: STATUS_TONES.plan, icon: <Calendar /> },
        ].map((kpi) => (
          <StatCard
            key={kpi.label}
            label={kpi.label}
            tone={kpi.tone}
            icon={kpi.icon}
            value={loading ? '…' : kpi.value}
          />
        ))}
      </div>

      <Card>
        <div className={cx(FILTER_BAR, 'gap-3 border-b border-slate-200 px-4 py-4 sm:px-5')}>
          <h2 className="text-sm font-semibold text-slate-900 sm:mr-auto">Statements</h2>
          <div className={cx(FILTER_SEARCH, 'sm:max-w-sm')}>
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search statements…"
              aria-label="Search statements"
              className={cx(inputClasses, 'pl-9')}
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatementStatus | 'all')}
            aria-label="Filter by status"
            className={cx(inputClasses, FILTER_SELECT)}
          >
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_TONES) as StatementStatus[]).map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </div>

        {loading ? (
          <LoadingState label="Loading statements…" />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<FileText />}
            title="No statements match your filters"
            description="Generate statements from open client balances to populate this list."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {filtered.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-900">{row.clientName}</p>
                    <StatusBadge tone={STATUS_TONES[row.status]} size="sm">
                      {row.status}
                    </StatusBadge>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {row.periodLabel || 'Statement'} · {money(row.balanceCents)}
                    {row.delivery ? ` · ${row.delivery}` : ''}
                  </p>
                  {statementLineText(row.lines ?? null).length ? (
                    <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                      {statementLineText(row.lines ?? null).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  ) : null}
                  {row.note ? <p className="mt-1 text-xs text-slate-500">{row.note}</p> : null}
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busyId === row.id}
                  icon={row.delivery === 'sms' ? <MessageSquare /> : <Mail />}
                  onClick={() => void resend(row.id)}
                >
                  {busyId === row.id ? 'Sending…' : 'Send again'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="text-center text-xs text-slate-500">
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
    </Page>
  );
}
