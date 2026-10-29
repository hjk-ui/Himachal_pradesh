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
}

const CPT_SERVICES: { cpt: string; label: string }[] = CPT_CODES.map((c) => ({
  cpt: c.code,
  label: c.desc,
}));

const PAYERS = ['Medicaid (MD)', 'Medicare Part B', 'BCBS Maryland', 'Aetna Behavioral', 'Cigna', 'UnitedHealth'];

const STATUS_CONFIG: Record<PAStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  approved: { label: 'Approved', color: '#15803d', bg: '#E0E2FC', icon: <CheckCircle2 size={13} /> },
  pending:  { label: 'Pending',  color: '#b45309', bg: '#fef3c7', icon: <Clock size={13} /> },
  denied:   { label: 'Denied',   color: '#dc2626', bg: '#fee2e2', icon: <XCircle size={13} /> },
  expired:  { label: 'Expired',  color: '#6b7280', bg: '#f3f4f6', icon: <Clock size={13} /> },
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
  const cleaned = notes?.replace(/\s*\[seed:[^\]]+\]\s*/g, '').trim();
  if (cleaned) return cleaned;
  const match = CPT_SERVICES.find((s) => codes.includes(s.cpt));
  return match?.label || codes.join(', ') || 'Clinical service';
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
  };
}

function UtilizationBar({ used, approved, status }: { used: number; approved: number; status: PAStatus }) {
  const pct = approved > 0 ? Math.min(100, Math.round((used / approved) * 100)) : 0;
  const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f97316' : '#6868D0';
  if (status !== 'approved') return null;
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>{used}/{approved} used</span>
        <span className="font-semibold" style={{ color }}>{pct}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-2">
        <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function AlertBadge({ auth }: { auth: PriorAuth }) {
  if (auth.status !== 'approved') return null;
  const remaining = auth.unitsApproved - auth.unitsUsed;
  const pct = auth.unitsApproved > 0 ? Math.round((auth.unitsUsed / auth.unitsApproved) * 100) : 0;
  if (auth.daysUntilExpiry <= 7 || remaining <= 2 || pct >= 90) {
    return <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={10} />Urgent</span>;
  }
  if (auth.daysUntilExpiry <= 14 || pct >= 75) {
    return <span className="text-xs font-medium text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full flex items-center gap-1"><AlertTriangle size={10} />Action needed</span>;
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

export default function PriorAuthsPage() {
  const { clients, loading: clientsLoading } = useClients();
  const [auths, setAuths] = useState<PriorAuth[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | PAStatus>('all');
  const [showNewModal, setShowNewModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [detailId, setDetailId] = useState<string | null>(null);

  const loadAuths = useCallback(async () => {
    try {
      const rows = await fetchPriorAuths();
      setAuths(rows.map(mapAuth));
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load prior auths');
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

  const filtered = filter === 'all' ? auths : auths.filter((a) => a.status === filter);

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
          <h1 className="text-2xl font-semibold text-slate-900">Prior Authorizations</h1>
          <p className="text-slate-500 text-sm mt-0.5">Track PA status, session counts, and expiration dates</p>
          {loadError ? <p className="mt-2 text-sm text-red-600">{loadError}</p> : null}
          {actionError ? <p className="mt-2 text-sm text-red-600">{actionError}</p> : null}
        </div>
        <button onClick={() => { setShowNewModal(true); setActionError(null); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-white hover:opacity-90"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
          <Plus size={15} /> New PA Record
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {(['approved', 'pending', 'denied', 'expired'] as PAStatus[]).map((s) => {
          const count = auths.filter((a) => a.status === s).length;
          const cfg = STATUS_CONFIG[s];
          return (
            <button key={s} onClick={() => setFilter(filter === s ? 'all' : s)}
              className={`bg-white rounded-xl border shadow-sm p-4 text-left transition-all ${filter === s ? 'border-blue-400 ring-1 ring-blue-300' : 'border-slate-200/80 hover:border-slate-300'}`}>
              <div className="flex items-center gap-2 mb-1">
                <span style={{ color: cfg.color }}>{cfg.icon}</span>
                <span className="text-xs font-semibold text-slate-500">{cfg.label}</span>
              </div>
              <p className="text-2xl font-semibold" style={{ color: cfg.color }}>{count}</p>
            </button>
          );
        })}
      </div>

      {alerts.length > 0 && (
        <div className="bg-amber-50 ring-1 ring-inset ring-amber-100 rounded-xl p-4">
          <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5 mb-2">
            <AlertTriangle size={15} /> {alerts.length} Authorization{alerts.length !== 1 ? 's' : ''} Need Attention
          </p>
          <div className="space-y-1.5">
            {alerts.map((a) => {
              const remaining = a.unitsApproved - a.unitsUsed;
              const pct = a.unitsApproved > 0 ? Math.round((a.unitsUsed / a.unitsApproved) * 100) : 0;
              const msgs: string[] = [];
              if (a.daysUntilExpiry <= 7) msgs.push(`expires in ${a.daysUntilExpiry} day${a.daysUntilExpiry !== 1 ? 's' : ''}`);
              else if (a.daysUntilExpiry <= 14) msgs.push(`expires in ${a.daysUntilExpiry} days`);
              if (pct >= 75) msgs.push(`${pct}% of units used`);
              else if (remaining <= 2) msgs.push(`${remaining} units remaining`);
              return (
                <div key={a.id} className="flex items-center justify-between bg-white border border-amber-100 rounded-lg px-3 py-2">
                  <div>
                    <span className="text-sm font-medium text-slate-800">{a.patientName}</span>
                    <span className="text-xs text-slate-500 ml-2">— {a.serviceType}</span>
                  </div>
                  <span className="text-xs text-amber-700 font-medium">{msgs.join(' · ')}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {(['all', 'approved', 'pending', 'denied', 'expired'] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-colors ${filter === f ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            style={filter === f ? { background: '#6868D0' } : {}}>
            {f === 'all' ? `All (${auths.length})` : `${STATUS_CONFIG[f as PAStatus].label} (${auths.filter((a) => a.status === f).length})`}
          </button>
        ))}
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200/80 p-10 text-center text-sm text-slate-500">
            No prior authorizations yet. Create a PA record to persist it to the clinic database.
          </div>
        ) : null}
        {filtered.map((auth) => {
          const cfg = STATUS_CONFIG[auth.status];
          const remaining = auth.unitsApproved - auth.unitsUsed;
          const open = detailId === auth.id;
          return (
            <div key={auth.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 hover:border-slate-300 transition-colors">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900">{auth.patientName}</h3>
                    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ color: cfg.color, backgroundColor: cfg.bg }}>
                      {cfg.icon}{cfg.label}
                    </span>
                    <AlertBadge auth={auth} />
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{auth.serviceType} · {auth.cptCodes.join(', ')} · {auth.insurancePayer}</p>
                </div>
                <button onClick={() => setDetailId(open ? null : auth.id)}
                  className="text-xs text-blue-600 hover:underline font-medium flex items-center gap-0.5 shrink-0">
                  Details <ChevronRight size={12} />
                </button>
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-slate-400 font-medium mb-0.5">Auth Number</p>
                  <p className="text-sm font-mono text-slate-700">{auth.authNumber ?? <span className="text-slate-400 italic">Pending</span>}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium mb-0.5">Valid Period</p>
                  <p className="text-sm text-slate-700">{auth.startDate} – {auth.expiresAt}</p>
                  {auth.status === 'approved' && (
                    <p className={`text-xs mt-0.5 font-medium ${auth.daysUntilExpiry <= 7 ? 'text-red-600' : auth.daysUntilExpiry <= 14 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {auth.daysUntilExpiry > 0 ? `${auth.daysUntilExpiry} days remaining` : `Expired ${Math.abs(auth.daysUntilExpiry)} days ago`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-medium mb-1">Unit Utilization</p>
                  {auth.status === 'approved' ? (
                    <UtilizationBar used={auth.unitsUsed} approved={auth.unitsApproved} status={auth.status} />
                  ) : auth.status === 'denied' ? (
                    <p className="text-xs text-red-600">{auth.denialReason}</p>
                  ) : (
                    <p className="text-xs text-slate-400">{auth.unitsApproved} sessions requested</p>
                  )}
                </div>
              </div>

              {auth.status === 'approved' && (
                <div className="mt-3 pt-3 border-t border-slate-200/80 flex gap-3">
                  <button
                    onClick={() => void patchAuth(auth.id, { useUnits: 1 })}
                    disabled={remaining <= 0}
                    className="text-xs text-blue-600 hover:underline font-medium disabled:opacity-40">
                    Use Units
                  </button>
                  <button
                    onClick={() => {
                      const next = window.prompt('New auth number', auth.authNumber || '');
                      if (next == null) return;
                      void patchAuth(auth.id, { authNumber: next });
                    }}
                    className="text-xs text-slate-500 hover:underline">
                    Update Auth #
                  </button>
                  <span className="ml-auto text-xs text-slate-400">{remaining} sessions remaining</span>
                </div>
              )}
              {open ? (
                <p className="mt-3 text-xs text-slate-500">
                  Status {auth.dbStatus} · {auth.unitsUsed}/{auth.unitsApproved} units used. Low-units and expiry tasks appear on My To-Do.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {showNewModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
            <h2 className="text-lg font-semibold text-slate-900 mb-5">New Prior Authorization</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Patient</label>
                  <select value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    <option value="">{clientsLoading ? 'Loading...' : 'Select client...'}</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Insurance Payer</label>
                  <select value={form.payer} onChange={(e) => setForm((p) => ({ ...p, payer: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                    {PAYERS.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Service Type</label>
                <select value={form.cpt} onChange={(e) => setForm((p) => ({ ...p, cpt: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300">
                  {CPT_SERVICES.map((s) => <option key={s.cpt} value={s.cpt}>{s.label} ({s.cpt})</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Units Requested</label>
                  <input type="number" min={0} value={form.unitsApproved}
                    onChange={(e) => setForm((p) => ({ ...p, unitsApproved: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Start Date</label>
                  <input type="date" value={form.startDate}
                    onChange={(e) => setForm((p) => ({ ...p, startDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
                <div>
                  <label className="text-xs text-slate-500 font-medium block mb-1">Expires</label>
                  <input type="date" value={form.endDate}
                    onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium block mb-1">Auth Number (leave blank if pending)</label>
                <input value={form.authNumber} onChange={(e) => setForm((p) => ({ ...p, authNumber: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
                  placeholder="Payer-assigned authorization number" />
              </div>
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={() => setShowNewModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button onClick={() => void saveNew()} disabled={!form.clientId || saving}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
                {saving ? 'Saving...' : 'Save PA Record'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
