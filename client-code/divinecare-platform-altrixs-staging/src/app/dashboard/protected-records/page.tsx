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
import {
  Alert,
  Button,
  Card,
  EmptyState,
  FOCUS_RING,
  FormField,
  IconButton,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  cx,
  inputClasses,
  type Tone,
} from '@/components/ui';

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

const REASON_TONE: Record<Reason, Tone> = {
  employee: 'warning',
  vip: 'brand',
  legal: 'danger',
  other: 'neutral',
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
    return <LoadingState className="min-h-[40vh]" />;
  }

  if (!allowed) {
    return (
      <Page width="narrow">
        <Card className="px-6 py-10 text-center">
          <span
            aria-hidden
            className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-rose-50 text-rose-700"
          >
            <Lock size={20} />
          </span>
          <h1 className="text-lg font-semibold text-slate-900">Practice Director only</h1>
          <p className="mt-2 text-sm text-slate-600">
            Protected records administration is limited to Practice Director and Clinic Admin.
          </p>
        </Card>
      </Page>
    );
  }

  const unprotectedClients = clients.filter((c) => !records.some((r) => r.clientId === c.id));

  return (
    <Page>
      <PageHeader
        title="Protected Records"
        badges={
          <StatusBadge tone="brand" icon={<Shield />}>
            HIPAA · Restricted PHI
          </StatusBadge>
        }
        description="Flag employee, VIP, and legal clients. Control whitelist access and audit break-the-glass."
        actions={
          <Button icon={<Plus />} onClick={() => setAddOpen(true)}>
            Add Protection
          </Button>
        }
      />

      <StatGrid columns={5}>
        <StatCard label="Protected" value={stats.total} icon={<Lock />} tone="brand" />
        <StatCard label="Employee" value={stats.byReason.employee} />
        <StatCard label="VIP" value={stats.byReason.vip} />
        <StatCard label="Legal" value={stats.byReason.legal} />
        <StatCard
          label="Active BTG"
          value={stats.activeBtg}
          icon={<AlertTriangle />}
          tone={stats.activeBtg > 0 ? 'warning' : 'neutral'}
        />
      </StatGrid>

      {recentBtg.length > 0 ? (
        <Alert tone="warning" title="Break-the-glass activity (7 days)">
          <ul className="mt-1.5 space-y-1.5">
            {recentBtg.slice(0, 8).map((e) => (
              <li key={e.id} className="text-xs">
                <span className="font-semibold">{e.userName}</span> accessed{' '}
                <span className="font-semibold">{e.clientName}</span>
                {e.reason ? ` — “${e.reason}”` : ''} ·{' '}
                {new Date(e.timestamp).toLocaleString()}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card className="p-4">
        <label className="relative block">
          <span className="sr-only">Search protected clients</span>
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search protected clients…"
            className={cx(inputClasses, 'pl-9')}
          />
        </label>
      </Card>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      {loading ? (
        <Card>
          <LoadingState label="Loading protected records…" />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Lock />}
            title="No protected records yet"
            description="Add protection for employee, VIP, or legal clients to restrict PHI access."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((r) => {
            const open = expanded === r.clientId;
            return (
              <Card key={r.id} className="overflow-hidden">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => void toggleExpand(r.clientId)}
                  className={cx('flex w-full items-start gap-3 rounded-xl px-4 py-4 text-left hover:bg-slate-50 sm:px-5', FOCUS_RING)}
                >
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200"
                  >
                    <Lock size={18} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-[15px] font-semibold text-slate-900">{r.clientName}</p>
                      <StatusBadge tone={REASON_TONE[r.reason] ?? 'neutral'} size="sm">
                        {REASON_LABEL[r.reason]}
                      </StatusBadge>
                      {(r.activeBreakGlass?.length || 0) > 0 ? (
                        <StatusBadge tone="warning" size="sm">
                          BTG active
                        </StatusBadge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {r.alias ? `Alias: ${r.alias} · ` : ''}
                      Whitelist {r.accessWhitelist.length} · Set{' '}
                      {new Date(r.setAt).toLocaleDateString()}
                    </p>
                  </div>
                  {open ? (
                    <ChevronUp size={18} aria-hidden className="text-slate-500" />
                  ) : (
                    <ChevronDown size={18} aria-hidden className="text-slate-500" />
                  )}
                </button>

                {open ? (
                  <div className="space-y-4 border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-5">
                    {r.reasonNote ? (
                      <p className="text-sm text-slate-600">
                        <span className="font-semibold text-slate-800">Note:</span> {r.reasonNote}
                      </p>
                    ) : null}

                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-600">
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
                              className={cx('rounded text-slate-500 hover:text-rose-700 disabled:opacity-50', FOCUS_RING)}
                              aria-label="Remove from whitelist"
                            >
                              <X size={12} aria-hidden />
                            </button>
                          </span>
                        ))}
                        {!r.whitelistUsers.length ? (
                          <span className="text-xs text-slate-500">No whitelist users</span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <select
                          aria-label="Add staff to whitelist"
                          value={whitelistPick[r.clientId] || ''}
                          onChange={(e) =>
                            setWhitelistPick((p) => ({ ...p, [r.clientId]: e.target.value }))
                          }
                          className={cx(inputClasses, 'h-8 w-full py-1 text-xs sm:w-auto')}
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
                        <Button
                          size="sm"
                          icon={<UserPlus />}
                          disabled={busy || !whitelistPick[r.clientId]}
                          onClick={() => void addWhitelist(r.clientId)}
                        >
                          Add
                        </Button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-xs font-semibold text-slate-600">
                        Access log
                      </p>
                      <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white">
                        {(logs[r.clientId] || []).length === 0 ? (
                          <p className="px-3 py-4 text-xs text-slate-500">No access events yet</p>
                        ) : (
                          <ul className="divide-y divide-slate-100 text-xs text-slate-700">
                            {(logs[r.clientId] || []).slice(0, 40).map((l) => (
                              <li key={l.id} className="px-3 py-2">
                                <span className="font-semibold text-slate-800">{l.userName}</span>{' '}
                                <span className="text-slate-500">{l.accessType}</span>
                                {l.reason ? ` — ${l.reason}` : ''}
                                <span className="block text-[11px] text-slate-500">
                                  {new Date(l.timestamp).toLocaleString()}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>

                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 />}
                      disabled={busy}
                      onClick={() => void removeProtection(r.clientId)}
                    >
                      Remove protection
                    </Button>
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      <footer className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-500">
        Access to protected records is logged under HIPAA §164.312(b). Break-the-glass grants expire
        after 24 hours. Practice Directors should review whitelist membership and recent emergency
        access regularly. Do not disclose protected client identities outside authorized workforce.
      </footer>

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setAddOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="protected-add-title"
            className="relative z-10 max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2 id="protected-add-title" className="text-base font-semibold text-slate-900">Add Protection</h2>
              <IconButton
                label="Close"
                className="h-10 w-10 shrink-0 md:h-8 md:w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                icon={<X className="h-[18px] w-[18px]" />}
                onClick={() => setAddOpen(false)}
              />
            </div>
            <div className="space-y-4">
              <FormField label="Client">
                <select
                  value={form.clientId}
                  onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
                  className={inputClasses}
                >
                  <option value="">Select client…</option>
                  {unprotectedClients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reason">
                <select
                  value={form.reason}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, reason: e.target.value as Reason }))
                  }
                  className={inputClasses}
                >
                  {(Object.keys(REASON_LABEL) as Reason[]).map((k) => (
                    <option key={k} value={k}>
                      {REASON_LABEL[k]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Reason note (optional)">
                <input
                  value={form.reasonNote}
                  onChange={(e) => setForm((f) => ({ ...f, reasonNote: e.target.value }))}
                  className={inputClasses}
                />
              </FormField>
              <FormField label="Display alias (optional)">
                <input
                  value={form.alias}
                  onChange={(e) => setForm((f) => ({ ...f, alias: e.target.value }))}
                  placeholder="e.g. Client A"
                  className={inputClasses}
                />
              </FormField>
              <FormField label="Note classification (optional)">
                <input
                  value={form.noteClassification}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, noteClassification: e.target.value }))
                  }
                  placeholder="e.g. 42 CFR Part 2"
                  className={inputClasses}
                />
              </FormField>
              <FormField label="Initial whitelist (optional)">
                <select
                  value={form.whitelistId}
                  onChange={(e) => setForm((f) => ({ ...f, whitelistId: e.target.value }))}
                  className={inputClasses}
                >
                  <option value="">None</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </FormField>
            </div>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void submitProtection()}>
                Protect client
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Page>
  );
}
