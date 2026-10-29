'use client';
import { useCallback, useEffect, useState } from 'react';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  createPriorAuth,
  fetchPriorAuths,
  updatePriorAuth,
  type PriorAuthDbStatus,
  type PriorAuthRecord,
} from '@/features/ehr/priorAuthsApi';
import { CPT_CODES } from '@/lib/constants/cpt';
import { AlertTriangle, Clock, CheckCircle2, XCircle, Plus, ChevronRight } from 'lucide-react';
import { AuthForecastDetail, useAuthForecasts } from '@/components/ai/AuthForecastClient';
import { AuthForecastRenewalButton } from '@/components/ai/AuthForecastRenewalDialog';
import {
  Alert, Button, Card, EmptyState, FormField, LoadingState, Modal, StatusBadge, Tabs,
  cardClasses, cx, FOCUS_RING, inputClasses, TONE_SOFT, type Tone,
} from '@/components/ui';

type PAStatus = 'approved' | 'pending' | 'denied' | 'expired';

interface PriorAuth {
  id: string;
  patientName: string;
  patientId: string;
  serviceType: string;
  cptCodes: string[];
  insurancePayer: string;
  authNumber: string | null;
  unitsApproved: number;
  unitsUsed: number;
  unitType: string;
  startDate: string;
  expiresAt: string;
  status: PAStatus;
  dbStatus: PriorAuthDbStatus;
  denialReason?: string;
  daysUntilExpiry: number;
  fromValant: boolean;
}

const CPT_SERVICES: { cpt: string; label: string }[] = CPT_CODES.map((c) => ({
  cpt: c.code,
  label: c.desc,
}));

const PAYERS = ['Medicaid (MD)', 'Medicare Part B', 'BCBS Maryland', 'Aetna Behavioral', 'Cigna', 'UnitedHealth'];

const STATUS_CONFIG: Record<PAStatus, { label: string; tone: Tone; icon: React.ReactNode }> = {
  approved: { label: 'Approved', tone: 'success', icon: <CheckCircle2 /> },
  pending:  { label: 'Pending',  tone: 'warning', icon: <Clock /> },
  denied:   { label: 'Denied',   tone: 'danger',  icon: <XCircle /> },
  expired:  { label: 'Expired',  tone: 'neutral', icon: <Clock /> },
};

function toUiStatus(status: PriorAuthDbStatus): PAStatus {
  switch (status) {
    case 'APPROVED':
      return 'approved';
    case 'DENIED':
      return 'denied';
    case 'EXPIRED':
      return 'expired';
    default:
      return 'pending';
  }
}

function serviceLabel(codes: string[], notes: string | null) {
  const cleaned = notes?.replace(/\s*\[(?:seed|renewal-drafted):[^\]]+\]\s*/g, '').trim();
  if (cleaned) return cleaned;
  const match = CPT_SERVICES.find((s) => codes.includes(s.cpt));
  return match?.label || codes.join(', ') || 'Any service';
}

function daysUntil(dateStr: string | null) {
  if (!dateStr) return 0;
  const expiry = new Date(`${dateStr}T12:00:00`);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

function mapAuth(row: PriorAuthRecord): PriorAuth {
  const ui = toUiStatus(row.status);
  return {
    id: row.id,
    patientName: row.clientName,
    patientId: row.clientId,
    serviceType: serviceLabel(row.cptCodes, row.notes),
    cptCodes: row.cptCodes,
    insurancePayer: row.payer,
    authNumber: row.authNumber,
    unitsApproved: row.unitsApproved,
    unitsUsed: row.unitsUsed,
    unitType: 'sessions',
    startDate: row.startDate || '—',
    expiresAt: row.endDate || '—',
    status: ui,
    dbStatus: row.status,
    denialReason: ui === 'denied' ? row.notes || 'Denied' : undefined,
    daysUntilExpiry: daysUntil(row.endDate),
    fromValant: row.source === 'valant',
  };
}

function UtilizationBar({ used, approved, status }: { used: number; approved: number; status: PAStatus }) {
  const pct = approved > 0 ? Math.min(100, Math.round((used / approved) * 100)) : 0;
  const tone = pct >= 90 ? { text: 'text-rose-700', bar: 'bg-rose-500' } : pct >= 75 ? { text: 'text-amber-700', bar: 'bg-amber-500' } : { text: 'text-blue-700', bar: 'bg-blue-600' };
  if (status !== 'approved') return null;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>{used}/{approved} used</span>
        <span className={cx('font-semibold tabular-nums', tone.text)}>{pct}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className={cx('h-2 rounded-full transition-all', tone.bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function AlertBadge({ auth }: { auth: PriorAuth }) {
  if (auth.status !== 'approved') return null;
  const remaining = auth.unitsApproved - auth.unitsUsed;
  const pct = auth.unitsApproved > 0 ? Math.round((auth.unitsUsed / auth.unitsApproved) * 100) : 0;
  if (auth.daysUntilExpiry <= 7 || remaining <= 2 || pct >= 90) {
    return <StatusBadge tone="danger" icon={<AlertTriangle />}>Urgent</StatusBadge>;
  }
  if (auth.daysUntilExpiry <= 14 || pct >= 75) {
    return <StatusBadge tone="warning" icon={<AlertTriangle />}>Action needed</StatusBadge>;
  }
  return null;
}

const emptyForm = {
  clientId: '',
  payer: 'BCBS Maryland',
  cpt: '90837',
  unitsApproved: '8',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  authNumber: '',
};

export function PriorAuthTracking() {
  const { clients, loading: clientsLoading } = useClients();
  const [auths, setAuths] = useState<PriorAuth[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'at_risk' | PAStatus>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const forecast = useAuthForecasts();

  const loadAuths = useCallback(async () => {
    try {
      const rows = await fetchPriorAuths();
      setAuths(rows.map(mapAuth));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load prior auths');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadAuths();
  }, [loadAuths]);

  const alerts = auths.filter((a) => {
    if (a.status !== 'approved') return false;
    const remaining = a.unitsApproved - a.unitsUsed;
    const pct = a.unitsApproved > 0 ? Math.round((a.unitsUsed / a.unitsApproved) * 100) : 0;
    return a.daysUntilExpiry <= 14 || remaining <= 2 || pct >= 75;
  });

  const atRiskCount = auths.filter((a) => forecast.byId.get(a.id)?.atRisk).length;
  const filtered =
    filter === 'all'
      ? auths
      : filter === 'at_risk'
        ? auths.filter((a) => forecast.byId.get(a.id)?.atRisk)
        : auths.filter((a) => a.status === filter);

  const saveNew = async () => {
    if (!form.clientId) return;
    setSaving(true);
    setActionError(null);
    try {
      const service = CPT_SERVICES.find((s) => s.cpt === form.cpt);
      await createPriorAuth({
        clientId: form.clientId,
        payer: form.payer,
        authNumber: form.authNumber || null,
        cptCodes: [form.cpt],
        unitsApproved: Number(form.unitsApproved) || 0,
        unitsUsed: 0,
        status: form.authNumber ? 'APPROVED' : 'SUBMITTED',
        startDate: form.startDate || null,
        endDate: form.endDate || null,
        notes: service?.label || null,
      });
      setShowNewModal(false);
      setForm(emptyForm);
      await loadAuths();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not save prior auth');
    } finally {
      setSaving(false);
    }
  };

  const patchAuth = async (id: string, body: Parameters<typeof updatePriorAuth>[1]) => {
    setActionError(null);
    try {
      const row = await updatePriorAuth(id, body);
      setAuths((prev) => prev.map((a) => (a.id === id ? mapAuth(row) : a)));
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update prior auth');
    }
  };

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">Authorization tracking</h2>
          <p className="text-slate-500 text-sm mt-0.5">Track PA status, session counts, and expiration dates</p>
        </div>
        <Button icon={<Plus />} onClick={() => { setShowNewModal(true); setActionError(null); }}>
          New PA Record
        </Button>
      </div>
      {loadError ? <Alert tone="danger" actions={<Button size="sm" variant="secondary" onClick={() => void loadAuths()}>Retry</Button>}>{loadError}</Alert> : null}
      {actionError ? <Alert tone="danger">{actionError}</Alert> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {(['approved', 'pending', 'denied', 'expired'] as PAStatus[]).map((s) => {
          const count = auths.filter((a) => a.status === s).length;
          const cfg = STATUS_CONFIG[s];
          return (
            <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(filter === s ? 'all' : s)}
              className={cx(cardClasses, 'p-4 text-left transition', FOCUS_RING, filter === s ? 'border-blue-600 ring-1 ring-blue-600' : 'hover:border-slate-300 hover:shadow-sm')}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-medium text-slate-600">{cfg.label}</p>
                  <p className="stat-number mt-1 text-2xl font-semibold text-slate-900">{count}</p>
                </div>
                <span aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset [&>svg]:h-[18px] [&>svg]:w-[18px]', TONE_SOFT[cfg.tone])}>
                  {cfg.icon}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {alerts.length > 0 && (
        <Alert tone="warning" title={`${alerts.length} Authorization${alerts.length !== 1 ? 's' : ''} Need Attention`}>
          <div className="mt-2 space-y-1.5">
            {alerts.map((a) => {
              const remaining = a.unitsApproved - a.unitsUsed;
              const pct = a.unitsApproved > 0 ? Math.round((a.unitsUsed / a.unitsApproved) * 100) : 0;
              const msgs: string[] = [];
              if (a.daysUntilExpiry <= 7) msgs.push(`expires in ${a.daysUntilExpiry} day${a.daysUntilExpiry !== 1 ? 's' : ''}`);
              else if (a.daysUntilExpiry <= 14) msgs.push(`expires in ${a.daysUntilExpiry} days`);
              if (pct >= 75) msgs.push(`${pct}% of units used`);
              else if (remaining <= 2) msgs.push(`${remaining} units remaining`);
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{a.patientName}</span>
                    <span className="text-xs text-slate-500 ml-2">— {a.serviceType}</span>
                  </div>
                  <span className="text-xs text-amber-800 font-medium">{msgs.join(' · ')}</span>
                </div>
              );
            })}
          </div>
        </Alert>
      )}

      <Tabs
        variant="pill"
        label="Filter prior authorizations"
        controlsPanels={false}
        value={filter}
        onChange={(f) => setFilter(f)}
        items={[
          ...(['all', 'approved', 'pending', 'denied', 'expired'] as const).map((f) => ({
            key: f,
            label: f === 'all' ? `All (${auths.length})` : `${STATUS_CONFIG[f as PAStatus].label} (${auths.filter((a) => a.status === f).length})`,
          })),
          {
            key: 'at_risk' as const,
            label: `At risk (${forecast.loading ? '…' : atRiskCount})`,
            hint: 'Forecast: will run out before the end date, expiring within the renewal lead time, or expired',
          },
        ]}
      />

      <div className="space-y-3">
        {!loaded && !loadError && filtered.length === 0 ? (
          <Card><LoadingState label="Loading prior authorizations…" /></Card>
        ) : filtered.length === 0 ? (
          <Card>
            <EmptyState title="No prior authorizations yet." description="Create a PA record to persist it to the clinic database." />
          </Card>
        ) : null}
        {filtered.map((auth) => {
          const cfg = STATUS_CONFIG[auth.status];
          const remaining = auth.unitsApproved - auth.unitsUsed;
          const open = detailId === auth.id;
          return (
            <Card key={auth.id} className="p-5 transition-colors hover:border-slate-300">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">{auth.patientName}</h3>
                    <StatusBadge tone={cfg.tone} icon={cfg.icon}>{cfg.label}</StatusBadge>
                    <AlertBadge auth={auth} />
                    {auth.fromValant ? (
                      <span title="Imported from Valant; covers any service for this payer in its dates">
                        <StatusBadge tone="brand" size="sm">from Valant</StatusBadge>
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{auth.serviceType} · {auth.cptCodes.join(', ')} · {auth.insurancePayer}</p>
                </div>
                <button type="button" aria-expanded={open} onClick={() => setDetailId(open ? null : auth.id)}
                  className={cx('text-xs text-blue-700 hover:underline font-medium flex items-center gap-0.5 shrink-0 rounded', FOCUS_RING)}>
                  Details <ChevronRight size={12} aria-hidden />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-0.5">Auth Number</p>
                  <p className="text-sm font-mono text-slate-700">{auth.authNumber ?? <span className="text-slate-500 italic">Pending</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-0.5">Valid Period</p>
                  <p className="text-sm text-slate-700">{auth.startDate} – {auth.expiresAt}</p>
                  {auth.status === 'approved' && (
                    <p className={`text-xs mt-0.5 font-medium ${auth.daysUntilExpiry <= 7 ? 'text-rose-700' : auth.daysUntilExpiry <= 14 ? 'text-amber-700' : 'text-slate-500'}`}>
                      {auth.daysUntilExpiry > 0 ? `${auth.daysUntilExpiry} days remaining` : `Expired ${Math.abs(auth.daysUntilExpiry)} days ago`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-1">Unit Utilization</p>
                  {auth.status === 'approved' ? (
                    <UtilizationBar used={auth.unitsUsed} approved={auth.unitsApproved} status={auth.status} />
                  ) : auth.status === 'denied' ? (
                    <p className="text-xs text-rose-700">{auth.denialReason}</p>
                  ) : (
                    <p className="text-xs text-slate-500">{auth.unitsApproved} sessions requested</p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium mb-1">Forecast</p>
                  {forecast.byId.get(auth.id) ? (
                    <AuthForecastDetail forecast={forecast.byId.get(auth.id)!} />
                  ) : (
                    <p className="text-xs text-slate-500">{auth.status === 'approved' ? (forecast.loading ? 'Loading…' : 'Not forecast') : '—'}</p>
                  )}
                </div>
              </div>

              {auth.status === 'approved' && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void patchAuth(auth.id, { useUnits: 1 })}
                    disabled={remaining <= 0}>
                    Use Units
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = window.prompt('New auth number', auth.authNumber || '');
                      if (next == null) return;
                      void patchAuth(auth.id, { authNumber: next });
                    }}>
                    Update Auth #
                  </Button>
                  {forecast.byId.get(auth.id) ? (
                    <AuthForecastRenewalButton priorAuthId={auth.id} onRecorded={() => { forecast.reload(); void loadAuths(); }} />
                  ) : null}
                  <span className="ml-auto text-xs text-slate-500">{remaining} sessions remaining</span>
                </div>
              )}
              {open ? (
                <p className="mt-3 text-xs text-slate-500">
                  Status {auth.dbStatus} · {auth.unitsUsed}/{auth.unitsApproved} units used. Low-units and expiry tasks appear on My To-Do.
                </p>
              ) : null}
            </Card>
          );
        })}
      </div>

      {showNewModal && (
        <Modal
          title="New Prior Authorization"
          onClose={() => setShowNewModal(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setShowNewModal(false)}>Cancel</Button>
            <Button onClick={() => void saveNew()} disabled={!form.clientId || saving}>
              {saving ? 'Saving…' : 'Save PA Record'}
            </Button>
          </>}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Patient">
              <select value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))} className={inputClasses}>
                <option value="">{clientsLoading ? 'Loading…' : 'Select client…'}</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </FormField>
            <FormField label="Insurance Payer">
              <select value={form.payer} onChange={(e) => setForm((p) => ({ ...p, payer: e.target.value }))} className={inputClasses}>
                {PAYERS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </FormField>
          </div>
          <FormField label="Service Type">
            <select value={form.cpt} onChange={(e) => setForm((p) => ({ ...p, cpt: e.target.value }))} className={inputClasses}>
              {CPT_SERVICES.map((s) => <option key={s.cpt} value={s.cpt}>{s.label} ({s.cpt})</option>)}
            </select>
          </FormField>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <FormField label="Units Requested">
              <input type="number" min={0} value={form.unitsApproved}
                onChange={(e) => setForm((p) => ({ ...p, unitsApproved: e.target.value }))}
                className={inputClasses} />
            </FormField>
            <FormField label="Start Date">
              <input type="date" value={form.startDate}
                onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                className={inputClasses} />
            </FormField>
            <FormField label="Expires">
              <input type="date" value={form.endDate}
                onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                className={inputClasses} />
            </FormField>
          </div>
          <FormField label="Auth Number (leave blank if pending)">
            <input value={form.authNumber} onChange={(e) => setForm((p) => ({ ...p, authNumber: e.target.value }))}
              className={inputClasses}
              placeholder="Payer-assigned authorization number" />
          </FormField>
        </Modal>
      )}
    </div>
  );
}
