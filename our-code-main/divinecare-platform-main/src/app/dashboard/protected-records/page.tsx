'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Lock,
  Plus,
  Search,
  Shield,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { apiJson } from '@/lib/api-client';

type Reason = 'employee' | 'vip' | 'legal' | 'other';

type WhitelistUser = { id: string; name?: string | null; email?: string | null; role?: string };

type SensitiveRow = {
  id: string;
  clientId: string;
  clientName: string;
  clientMrn?: string | null;
  reason: Reason;
  reasonNote?: string | null;
  alias?: string | null;
  noteClassification?: string | null;
  accessWhitelist: string[];
  whitelistUsers: WhitelistUser[];
  setAt: string;
  activeBreakGlass: Array<{
    userId: string;
    userName: string;
    reason: string;
    grantedAt: string;
    expiresAt: string;
  }>;
};

type AccessLog = {
  id: string;
  userName: string;
  accessType: string;
  reason?: string | null;
  path?: string | null;
  timestamp: string;
};

type StaffOption = { id: string; name: string; email: string; role: string };

const REASON_LABEL: Record<Reason, string> = {
  employee: 'Employee / Staff',
  vip: 'VIP / High-profile',
  legal: 'Legal / Court',
  other: 'Other',
};

const REASON_BADGE: Record<Reason, string> = {
  employee: 'bg-amber-50 text-amber-800 ring-amber-200',
  vip: 'bg-violet-50 text-violet-800 ring-violet-200',
  legal: 'bg-rose-50 text-rose-800 ring-rose-200',
  other: 'bg-slate-100 text-slate-700 ring-slate-200',
};

function canManageProtected(role?: string | null) {
  return role === 'PRACTICE_DIRECTOR';
}

export default function ProtectedRecordsPage() {
  const { user, loading: authLoading } = useAuth();
  const allowed = canManageProtected(user?.role);

  const [records, setRecords] = useState<SensitiveRow[]>([]);
  const [recentBtg, setRecentBtg] = useState<
    Array<{ id: string; clientName: string; userName: string; reason?: string | null; timestamp: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [logs, setLogs] = useState<Record<string, AccessLog[]>>({});
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    clientId: '',
    reason: 'employee' as Reason,
    reasonNote: '',
    alias: '',
    noteClassification: '',
    whitelistId: '',
  });
  const [whitelistPick, setWhitelistPick] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiJson<{
        success: true;
        records: SensitiveRow[];
        recentBreakGlass: typeof recentBtg;
      }>('/api/sensitive-records');
      setRecords(data.records);
      setRecentBtg(data.recentBreakGlass || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void load();
  }, [allowed, load]);

  useEffect(() => {
    if (!allowed) return;
    void (async () => {
      try {
        const [dir, roster] = await Promise.all([
          apiJson<{ success: true; users: StaffOption[] }>('/api/staff/directory'),
          apiJson<{ success: true; clients: Array<{ id: string; name: string }> }>('/api/clients'),
        ]);
        setStaff(dir.users || []);
        setClients((roster.clients || []).map((c) => ({ id: c.id, name: c.name })));
      } catch {
        /* pickers optional */
      }
    })();
  }, [allowed]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.clientName.toLowerCase().includes(q) ||
        (r.alias || '').toLowerCase().includes(q) ||
        r.reason.toLowerCase().includes(q) ||
        (r.clientMrn || '').toLowerCase().includes(q)
    );
  }, [records, search]);

  const stats = useMemo(() => {
    const byReason = { employee: 0, vip: 0, legal: 0, other: 0 };
    for (const r of records) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
    const activeBtg = records.reduce((n, r) => n + (r.activeBreakGlass?.length || 0), 0);
    return { total: records.length, byReason, activeBtg };
  }, [records]);

  const toggleExpand = async (clientId: string) => {
    if (expanded === clientId) {
      setExpanded(null);
      return;
    }
    setExpanded(clientId);
    if (!logs[clientId]) {
      try {
        const data = await apiJson<{ success: true; logs: AccessLog[] }>(
          `/api/sensitive-records/access-log/${clientId}`
        );
        setLogs((prev) => ({ ...prev, [clientId]: data.logs }));
      } catch {
        setLogs((prev) => ({ ...prev, [clientId]: [] }));
      }
    }
  };

  const removeProtection = async (clientId: string) => {
    if (!confirm('Remove sensitive-record protection for this client?')) return;
    setBusy(true);
    try {
      await apiJson(`/api/sensitive-records/${clientId}`, { method: 'DELETE' });
      await load();
      setExpanded(null);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Remove failed');
    } finally {
      setBusy(false);
    }
  };

  const addWhitelist = async (clientId: string) => {
    const userId = whitelistPick[clientId];
    if (!userId) return;
    setBusy(true);
    try {
      await apiJson(`/api/sensitive-records/${clientId}/whitelist`, {
        method: 'PATCH',
        body: JSON.stringify({ add: [userId] }),
      });
      setWhitelistPick((p) => ({ ...p, [clientId]: '' }));
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Whitelist update failed');
    } finally {
      setBusy(false);
    }
  };

  const removeWhitelist = async (clientId: string, userId: string) => {
    setBusy(true);
    try {
      await apiJson(`/api/sensitive-records/${clientId}/whitelist`, {
        method: 'PATCH',
        body: JSON.stringify({ remove: [userId] }),
      });
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Whitelist update failed');
    } finally {
      setBusy(false);
    }
  };

  const submitProtection = async () => {
    if (!form.clientId) {
      alert('Select a client');
      return;
    }
    setBusy(true);
    try {
      const whitelist = form.whitelistId ? [form.whitelistId] : [];
      await apiJson(`/api/sensitive-records/${form.clientId}`, {
        method: 'POST',
        body: JSON.stringify({
          reason: form.reason,
          reasonNote: form.reasonNote || null,
          alias: form.alias || null,
          noteClassification: form.noteClassification || null,
          accessWhitelist: whitelist,
        }),
      });
      setAddOpen(false);
      setForm({
        clientId: '',
        reason: 'employee',
        reasonNote: '',
        alias: '',
        noteClassification: '',
        whitelistId: '',
      });
      await load();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not set protection');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading…
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-rose-200 bg-rose-50 p-8 text-center">
        <Lock className="mx-auto mb-3 text-rose-500" size={28} />
        <h1 className="text-lg font-bold text-rose-900">Practice Director only</h1>
        <p className="mt-2 text-sm text-rose-700">
          Protected records administration is limited to Practice Director and Clinic Admin.
        </p>
      </div>
    );
  }

  const unprotectedClients = clients.filter((c) => !records.some((r) => r.clientId === c.id));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 inline-flex items-center gap-2 rounded-full bg-[#5C2D91]/10 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[#5C2D91]">
            <Shield size={12} /> HIPAA · Restricted PHI
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Protected Records</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Flag employee, VIP, and legal clients. Control whitelist access and audit break-the-glass.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl px-5 text-sm font-bold text-white shadow-sm"
          style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
        >
          <Plus size={16} />
          Add Protection
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Protected" value={stats.total} />
        <Stat label="Employee" value={stats.byReason.employee} />
        <Stat label="VIP" value={stats.byReason.vip} />
        <Stat label="Legal" value={stats.byReason.legal} />
        <Stat label="Active BTG" value={stats.activeBtg} accent />
      </div>

      {recentBtg.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-amber-950">Break-the-glass activity (7 days)</p>
              <ul className="mt-2 space-y-1.5">
                {recentBtg.slice(0, 8).map((e) => (
                  <li key={e.id} className="text-xs text-amber-900/90">
                    <span className="font-semibold">{e.userName}</span> accessed{' '}
                    <span className="font-semibold">{e.clientName}</span>
                    {e.reason ? ` — “${e.reason}”` : ''} ·{' '}
                    {new Date(e.timestamp).toLocaleString()}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
        <label className="relative block">
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search protected clients…"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50/80 pl-10 pr-3 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/15"
          />
        </label>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-14 text-center text-sm text-slate-500">
          Loading protected records…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
          <Lock className="mx-auto mb-3 text-slate-300" size={32} />
          <p className="text-base font-bold text-slate-900">No protected records yet</p>
          <p className="mt-1 text-sm text-slate-500">
            Add protection for employee, VIP, or legal clients to restrict PHI access.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const open = expanded === r.clientId;
            return (
              <article
                key={r.id}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() => void toggleExpand(r.clientId)}
                  className="flex w-full items-start gap-3 px-4 py-4 text-left sm:px-5"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#5C2D91]/10 text-[#5C2D91]">
                    <Lock size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-bold text-slate-900">{r.clientName}</p>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${REASON_BADGE[r.reason]}`}
                      >
                        {REASON_LABEL[r.reason]}
                      </span>
                      {(r.activeBreakGlass?.length || 0) > 0 ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                          BTG active
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.alias ? `Alias: ${r.alias} · ` : ''}
                      Whitelist {r.accessWhitelist.length} · Set{' '}
                      {new Date(r.setAt).toLocaleDateString()}
                    </p>
                  </div>
                  {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>

                {open ? (
                  <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 py-4 sm:px-5">
                    {r.reasonNote ? (
                      <p className="text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">Note:</span> {r.reasonNote}
                      </p>
                    ) : null}

                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                        Access whitelist
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {r.whitelistUsers.map((u) => (
                          <span
                            key={u.id}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
                          >
                            {u.name || u.email || u.id}
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void removeWhitelist(r.clientId, u.id)}
                              className="text-slate-400 hover:text-rose-600"
                              aria-label="Remove from whitelist"
                            >
                              <X size={12} />
                            </button>
                          </span>
                        ))}
                        {!r.whitelistUsers.length ? (
                          <span className="text-xs text-slate-400">No whitelist users</span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <select
                          value={whitelistPick[r.clientId] || ''}
                          onChange={(e) =>
                            setWhitelistPick((p) => ({ ...p, [r.clientId]: e.target.value }))
                          }
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs"
                        >
                          <option value="">Add staff…</option>
                          {staff
                            .filter((s) => !r.accessWhitelist.includes(s.id))
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.role})
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          disabled={busy || !whitelistPick[r.clientId]}
                          onClick={() => void addWhitelist(r.clientId)}
                          className="inline-flex items-center gap-1 rounded-lg bg-[#5C2D91] px-3 text-xs font-bold text-white disabled:opacity-50"
                        >
                          <UserPlus size={12} /> Add
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                        Access log
                      </p>
                      <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                        {(logs[r.clientId] || []).length === 0 ? (
                          <p className="px-3 py-4 text-xs text-slate-400">No access events yet</p>
                        ) : (
                          <ul className="divide-y divide-slate-50 text-xs">
                            {(logs[r.clientId] || []).slice(0, 40).map((l) => (
                              <li key={l.id} className="px-3 py-2">
                                <span className="font-semibold text-slate-800">{l.userName}</span>{' '}
                                <span className="text-slate-500">{l.accessType}</span>
                                {l.reason ? ` — ${l.reason}` : ''}
                                <span className="block text-[10px] text-slate-400">
                                  {new Date(l.timestamp).toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void removeProtection(r.clientId)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-100"
                    >
                      <Trash2 size={13} />
                      Remove protection
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}

      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-[11px] leading-relaxed text-slate-500">
        Access to protected records is logged under HIPAA §164.312(b). Break-the-glass grants expire
        after 24 hours. Practice Directors should review whitelist membership and recent emergency
        access regularly. Do not disclose protected client identities outside authorized workforce.
      </footer>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setAddOpen(false)}
          />
          <div className="relative z-10 w-full max-w-lg rounded-2xl border border-purple-100 bg-white p-5 shadow-xl sm:p-6">
            <div className="mb-4 flex items-start justify-between">
              <h2 className="text-lg font-bold text-slate-900">Add Protection</h2>
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-50"
              >
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3">
              <label className="block text-xs font-bold text-slate-600">
                Client
                <select
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                >
                  <option value="">Select client…</option>
                  {unprotectedClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Reason
                <select
                  value={form.reason}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reason: e.target.value as Reason }))
                  }
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                >
                  {(Object.keys(REASON_LABEL) as Reason[]).map((k) => (
                    <option key={k} value={k}>
                      {REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Reason note (optional)
                <input
                  value={form.reasonNote}
                  onChange={(e) => setForm((f) => ({ ...f, reasonNote: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Display alias (optional)
                <input
                  value={form.alias}
                  onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
                  placeholder="e.g. Client A"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Note classification (optional)
                <input
                  value={form.noteClassification}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, noteClassification: e.target.value }))
                  }
                  placeholder="e.g. 42 CFR Part 2"
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                Initial whitelist (optional)
                <select
                  value={form.whitelistId}
                  onChange={(e) => setForm((f) => ({ ...f, whitelistId: e.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 px-3 text-sm"
                >
                  <option value="">None</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAddOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void submitProtection()}
                className="rounded-xl px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                style={{ background: '#5C2D91' }}
              >
                Protect client
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3 shadow-sm ${
        accent ? 'border-amber-200 bg-amber-50' : 'border-slate-200 bg-white'
      }`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent ? 'text-amber-800' : 'text-slate-900'}`}>
        {value}
      </p>
    </div>
  );
}
