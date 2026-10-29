'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  GraduationCap,
  PenLine,
  Plus,
} from 'lucide-react';
import {
  createSupervisionLog,
  fetchSupervisionLogs,
  signSupervisionLog,
  type SupervisionLogRecord,
  type SupervisionSessionType,
  type SupervisionTrackRecord,
} from '@/features/hr/supervisionApi';

const PURPLE = '#6868D0';
const SESSION_TYPES: SupervisionSessionType[] = ['Individual', 'Triadic', 'Group'];

function initials(name: string) {
  return name
    .split(' ')
    .filter((p) => p && p !== 'Dr.')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function isoDate(iso: string) {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

function usDate(iso: string | null) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  } catch {
    return iso;
  }
}

function formatHoursLabel(hours: number) {
  return hours === 1 ? '1 hr' : `${hours} hrs`;
}

function durationLine(log: SupervisionLogRecord) {
  return `${log.durationMin} min · ${formatHoursLabel(log.hoursTowardLicensure)}`;
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export default function SupervisionPage() {
  const [logs, setLogs] = useState<SupervisionLogRecord[]>([]);
  const [tracks, setTracks] = useState<SupervisionTrackRecord[]>([]);
  const [actorUserId, setActorUserId] = useState('');
  const [actorRole, setActorRole] = useState('');
  const [pendingBanner, setPendingBanner] = useState(0);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSupervisee, setActiveSupervisee] = useState('');
  const [showLogModal, setShowLogModal] = useState(false);
  const [showBoardModal, setShowBoardModal] = useState(false);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | SupervisionSessionType>('all');
  const [sigFilter, setSigFilter] = useState<'all' | 'pending' | 'signed'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [form, setForm] = useState({
    superviseeId: '',
    sessionType: 'Individual' as SupervisionSessionType,
    sessionAt: new Date().toISOString().slice(0, 10),
    durationMin: 30,
    topics: '',
    clientRefs: '',
  });

  const isHr = actorRole === 'ADMIN' || actorRole === 'DIRECTOR' || actorRole === 'HR';

  const load = useCallback(async () => {
    const data = await fetchSupervisionLogs();
    setLogs(data.logs);
    setTracks(data.tracks ?? []);
    setActorUserId(data.actor.userId);
    setActorRole(data.actor.role);
    setPendingBanner(data.pendingSuperviseeSignatures ?? 0);
    setSchemaReady(data.schemaReady !== false);
    setActiveSupervisee((prev) => {
      if (prev && (data.tracks ?? []).some((t) => t.superviseeId === prev)) return prev;
      if (prev && data.logs.some((l) => l.superviseeId === prev)) return prev;
      return data.tracks?.[0]?.superviseeId || data.logs[0]?.superviseeId || '';
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load supervision logs');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const superviseeTabs = useMemo(() => {
    if (tracks.length) return tracks;
    const seen = new Map<string, SupervisionTrackRecord>();
    for (const log of logs) {
      if (seen.has(log.superviseeId)) continue;
      seen.set(log.superviseeId, {
        id: log.superviseeId,
        superviseeId: log.superviseeId,
        superviseeName: log.superviseeName,
        supervisorId: log.supervisorId,
        supervisorName: log.supervisorName,
        licenseTrack: 'LGPC',
        targetLicense: 'LPC',
        requiredHours: 200,
        startedAt: log.sessionAt,
      });
    }
    return [...seen.values()];
  }, [tracks, logs]);

  const track = superviseeTabs.find((t) => t.superviseeId === activeSupervisee) ?? superviseeTabs[0];

  const superviseeLogs = useMemo(() => {
    const id = track?.superviseeId;
    return logs
      .filter((log) => (id ? log.superviseeId === id : true))
      .sort((a, b) => b.sessionAt.localeCompare(a.sessionAt));
  }, [logs, track]);

  const visibleLogs = useMemo(() => {
    return superviseeLogs.filter((log) => {
      if (typeFilter !== 'all' && log.sessionType !== typeFilter) return false;
      const signed = Boolean(log.signedBySupervisorAt && log.signedBySuperviseeAt);
      if (sigFilter === 'signed' && !signed) return false;
      if (sigFilter === 'pending' && signed) return false;
      const day = isoDate(log.sessionAt);
      if (dateFrom && day < dateFrom) return false;
      if (dateTo && day > dateTo) return false;
      return true;
    });
  }, [superviseeLogs, typeFilter, sigFilter, dateFrom, dateTo]);

  const hoursEarned = superviseeLogs.reduce((sum, log) => sum + (log.hoursCredited ?? 0), 0);
  const sessionCount = superviseeLogs.length;
  const required = track?.requiredHours ?? 200;
  const pct = required > 0 ? Math.min(100, Math.round((hoursEarned / required) * 100)) : 0;
  const remaining = Math.max(0, required - hoursEarned);

  const canSignSupervisee = (log: SupervisionLogRecord) =>
    Boolean(log.signedBySupervisorAt) &&
    !log.signedBySuperviseeAt &&
    (isHr || log.superviseeId === actorUserId);

  const sign = async (id: string) => {
    setError(null);
    try {
      const updated = await signSupervisionLog(id, 'supervisee');
      setLogs((prev) => prev.map((log) => (log.id === id ? updated : log)));
      setPendingBanner((n) => Math.max(0, n - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign log');
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createSupervisionLog({
        superviseeId: form.superviseeId,
        supervisorId: tracks.find((t) => t.superviseeId === form.superviseeId)?.supervisorId,
        sessionAt: form.sessionAt,
        sessionType: form.sessionType,
        durationMin: form.durationMin,
        topics: form.topics,
        clientRefs: form.clientRefs
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
      });
      setLogs((prev) => [created, ...prev.filter((l) => l.id !== created.id)]);
      setActiveSupervisee(created.superviseeId);
      setPendingBanner((n) => n + 1);
      setShowLogModal(false);
      setForm((f) => ({ ...f, topics: '', clientRefs: '' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save session');
    } finally {
      setSaving(false);
    }
  };

  const exportHoursReport = () => {
    if (!track) return;
    const signed = superviseeLogs.filter((l) => l.signedBySupervisorAt && l.signedBySuperviseeAt);
    const rows = [
      [
        'Date',
        'Session type',
        'Duration (min)',
        'Hours',
        'Topics',
        'Cases reviewed',
        'Supervisor signed',
        'Supervisee signed',
      ],
      ...signed.map((log) => [
        isoDate(log.sessionAt),
        log.sessionType,
        String(log.durationMin),
        String(log.hoursCredited),
        log.topics,
        log.clientRefs.join('; '),
        usDate(log.signedBySupervisorAt),
        usDate(log.signedBySuperviseeAt),
      ]),
    ];
    const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${track.superviseeName.replace(/\s+/g, '-').toLowerCase()}-supervision-hours.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printBoardSummary = () => {
    if (!track) return;
    const signed = superviseeLogs.filter((l) => l.signedBySupervisorAt && l.signedBySuperviseeAt);
    const html = `<!doctype html><html><head><title>Board Submission Summary</title>
      <style>body{font-family:system-ui,sans-serif;padding:32px;color:#111} h1{font-size:22px}
      table{border-collapse:collapse;width:100%;margin-top:16px} td,th{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}</style>
      </head><body>
      <h1>Board Submission Summary</h1>
      <p><strong>${track.superviseeName}</strong> · ${track.licenseTrack} → ${track.targetLicense}</p>
      <p>Supervised by ${track.supervisorName} · Started ${isoDate(track.startedAt)}</p>
      <p>Hours earned (both signatures): <strong>${hoursEarned}</strong> / ${required}
      (${pct}%). ${remaining} hours remaining. Signed sessions: ${signed.length} of ${sessionCount}.</p>
      <table><thead><tr><th>Date</th><th>Type</th><th>Hours</th><th>Topics</th></tr></thead><tbody>
      ${signed.map((l) => `<tr><td>${isoDate(l.sessionAt)}</td><td>${l.sessionType}</td><td>${l.hoursCredited}</td><td>${l.topics}</td></tr>`).join('')}
      </tbody></table></body></html>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  };

  const openLogModal = () => {
    setForm((f) => ({
      ...f,
      superviseeId: f.superviseeId || track?.superviseeId || superviseeTabs[0]?.superviseeId || '',
    }));
    setShowLogModal(true);
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] overflow-x-hidden px-1 pb-10 sm:px-0">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-[1.85rem]">
            Clinical Supervision Log
          </h1>
          <p className="mt-1 text-sm text-slate-500 sm:text-[15px]">
            Track supervised hours toward licensure — LGPC/LGSW → LPC/LCSW
          </p>
        </div>
        <button
          type="button"
          onClick={openLogModal}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
          style={{ backgroundColor: PURPLE }}
        >
          <Plus size={16} /> Log Session
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {!schemaReady ? (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Supervision schema is not on this database yet. Run prisma db push, then refresh.
        </p>
      ) : null}

      {pendingBanner > 0 ? (
        <div className="mt-5 flex items-start gap-3 rounded-xl border border-orange-200 bg-[#FFF7ED] px-4 py-3">
          <PenLine size={16} className="mt-0.5 shrink-0 text-orange-500" />
          <p className="text-sm text-orange-900">
            <span className="font-semibold">
              {pendingBanner} session{pendingBanner === 1 ? '' : 's'} awaiting supervisee signature.
            </span>{' '}
            Signatures required before hours count toward licensure.
          </p>
        </div>
      ) : null}

      {superviseeTabs.length > 0 ? (
        <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {superviseeTabs.map((sv) => {
            const active = track?.superviseeId === sv.superviseeId;
            return (
              <button
                key={sv.id}
                type="button"
                onClick={() => setActiveSupervisee(sv.superviseeId)}
                className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active
                    ? 'text-white shadow-sm'
                    : 'border border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                }`}
                style={active ? { backgroundColor: PURPLE } : undefined}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold ${
                    active ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {initials(sv.superviseeName)}
                </span>
                <span>{sv.superviseeName}</span>
                <span className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[10px] font-bold text-[#6D28D9]">
                  {sv.licenseTrack}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {track ? (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_8px_30px_rgba(15,23,42,0.04)] sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                style={{ backgroundColor: PURPLE }}
              >
                {initials(track.superviseeName)}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">{track.superviseeName}</h2>
                <p className="text-sm text-slate-500">
                  {track.licenseTrack} · Supervised by {track.supervisorName}
                </p>
                <p className="text-sm text-slate-400">Started: {isoDate(track.startedAt)}</p>
              </div>
            </div>
            <div className="flex gap-8 sm:text-right">
              <div>
                <p className="text-2xl font-bold sm:text-3xl" style={{ color: PURPLE }}>
                  {hoursEarned}
                </p>
                <p className="text-xs font-medium text-slate-500">Hours earned</p>
              </div>
              <div>
                <p className="text-2xl font-bold sm:text-3xl" style={{ color: PURPLE }}>
                  {sessionCount}
                </p>
                <p className="text-xs font-medium text-slate-500">Sessions</p>
              </div>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="text-slate-600">
                {hoursEarned} / {required} hrs toward {track.targetLicense}
              </span>
              <span className="font-medium text-slate-500">{pct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-1.5 rounded-full bg-sky-500"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="mt-2 text-sm text-slate-400">{remaining} hours remaining to licensure</p>
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
            <button
              type="button"
              onClick={exportHoursReport}
              className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              style={{ color: PURPLE }}
            >
              <FileText size={14} /> Export Hours Report
            </button>
            <button
              type="button"
              onClick={() => setShowBoardModal(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
              style={{ color: PURPLE }}
            >
              <FileText size={14} /> Board Submission Summary
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          aria-label="Filter by session type"
        >
          <option value="all">All types</option>
          {SESSION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={sigFilter}
          onChange={(e) => setSigFilter(e.target.value as typeof sigFilter)}
          className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          aria-label="Filter by signature status"
        >
          <option value="all">All signatures</option>
          <option value="pending">Pending</option>
          <option value="signed">Signed</option>
        </select>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          aria-label="From date"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="min-h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
          aria-label="To date"
        />
      </div>

      {loading ? <p className="mt-6 text-sm text-slate-500">Loading supervision logs…</p> : null}

      {!loading && logs.length === 0 && superviseeTabs.length === 0 ? (
        <p className="mt-6 rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          No supervision sessions yet. Log a session to start the record.
        </p>
      ) : null}

      {visibleLogs.length > 0 || (!loading && track) ? (
        <div className="mt-6">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            Session history
          </p>
          {visibleLogs.length === 0 ? (
            <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
              No sessions match these filters.
            </p>
          ) : (
            <div className="space-y-3">
              {visibleLogs.map((log) => {
                const signed = Boolean(log.signedBySupervisorAt && log.signedBySuperviseeAt);
                const pending = Boolean(log.signedBySupervisorAt && !log.signedBySuperviseeAt);
                const isOpen = expandedLog === log.id;
                return (
                  <div
                    key={log.id}
                    className={`overflow-hidden rounded-xl border bg-white ${
                      pending
                        ? 'border-orange-200 border-l-[3px] border-l-orange-400'
                        : 'border-slate-200 border-l-[3px] border-l-emerald-400'
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left sm:px-5"
                      onClick={() => setExpandedLog(isOpen ? null : log.id)}
                    >
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                          signed ? 'bg-emerald-50' : 'bg-amber-100'
                        }`}
                      >
                        {signed ? (
                          <CheckCircle2 size={18} className="text-emerald-600" />
                        ) : (
                          <Clock size={18} className="text-amber-500" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-slate-900">{isoDate(log.sessionAt)}</p>
                          <span className="rounded-full bg-[#EDE9FE] px-2 py-0.5 text-[11px] font-semibold text-[#6D28D9]">
                            {log.sessionType}
                          </span>
                          <span className="text-xs text-slate-400">{durationLine(log)}</span>
                        </div>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{log.topics}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {pending ? (
                          <span className="text-xs font-semibold text-orange-500">Pending sig.</span>
                        ) : null}
                        {isOpen ? (
                          <ChevronUp size={16} className="text-slate-400" />
                        ) : (
                          <ChevronDown size={16} className="text-slate-400" />
                        )}
                      </div>
                    </button>

                    {isOpen ? (
                      <div className="border-t border-slate-100 px-4 pb-4 pt-3 sm:px-5">
                        <p className="text-xs font-medium text-slate-400">Topics Covered</p>
                        <p className="mt-1 text-sm text-slate-700">{log.topics}</p>
                        <p className="mt-3 text-xs font-medium text-slate-400">Cases Reviewed</p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {log.clientRefs.length === 0 ? (
                            <span className="text-xs text-slate-400">None</span>
                          ) : (
                            log.clientRefs.map((c) => (
                              <span
                                key={c}
                                className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                              >
                                {c}
                              </span>
                            ))
                          )}
                        </div>
                        <div className="mt-3 flex flex-col gap-1.5 text-sm">
                          {log.signedBySupervisorAt ? (
                            <p className="flex items-center gap-1.5 text-slate-600">
                              <CheckCircle2 size={14} className="text-emerald-600" />
                              Supervisor signed {usDate(log.signedBySupervisorAt)}
                            </p>
                          ) : (
                            <p className="flex items-center gap-1.5 text-orange-500">
                              <Clock size={14} /> Awaiting supervisor
                            </p>
                          )}
                          {log.signedBySuperviseeAt ? (
                            <p className="flex items-center gap-1.5 text-slate-600">
                              <CheckCircle2 size={14} className="text-emerald-600" />
                              Supervisee signed {usDate(log.signedBySuperviseeAt)}
                            </p>
                          ) : (
                            <p className="flex items-center gap-1.5 font-medium text-orange-500">
                              <Clock size={14} /> Awaiting supervisee
                            </p>
                          )}
                        </div>
                        {canSignSupervisee(log) ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void sign(log.id);
                            }}
                            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold hover:underline"
                            style={{ color: PURPLE }}
                          >
                            <PenLine size={13} /> Sign as Supervisee
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      {showLogModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[96vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">Log Supervision Session</h2>
            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Supervisee</label>
                <select
                  value={form.superviseeId}
                  onChange={(e) => setForm((f) => ({ ...f, superviseeId: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                >
                  <option value="">Select supervisee</option>
                  {superviseeTabs.map((s) => (
                    <option key={s.superviseeId} value={s.superviseeId}>
                      {s.superviseeName} ({s.licenseTrack})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Session Type</label>
                <select
                  value={form.sessionType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sessionType: e.target.value as SupervisionSessionType }))
                  }
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                >
                  {SESSION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Session Date</label>
                <input
                  type="date"
                  value={form.sessionAt}
                  onChange={(e) => setForm((f) => ({ ...f, sessionAt: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">Duration (minutes)</label>
                <select
                  value={form.durationMin}
                  onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                >
                  {[30, 45, 60, 90, 120].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">Topics Covered</label>
                <textarea
                  rows={3}
                  value={form.topics}
                  onChange={(e) => setForm((f) => ({ ...f, topics: e.target.value }))}
                  className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-sm"
                  placeholder="Case conceptualization, interventions reviewed, ethical considerations..."
                />
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Cases Reviewed (comma-separated client names)
                </label>
                <input
                  value={form.clientRefs}
                  onChange={(e) => setForm((f) => ({ ...f, clientRefs: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm"
                  placeholder="Client A, Client B"
                />
              </div>
            </div>
            <div className="mt-4 rounded-xl bg-[#EEF0FE] px-3 py-3">
              <p className="flex items-start gap-2 text-sm text-[#5B21B6]">
                <GraduationCap size={16} className="mt-0.5 shrink-0" style={{ color: PURPLE }} />
                Hours are credited only after both parties sign. Supervisor signs first.
              </p>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !form.superviseeId || !form.topics.trim()}
                onClick={() => void save()}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: PURPLE }}
              >
                {saving ? 'Saving…' : 'Save & Sign'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showBoardModal && track ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[96vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <h2 className="text-lg font-bold text-slate-900">Board Submission Summary</h2>
            <p className="mt-1 text-sm text-slate-500">
              {track.superviseeName} · {track.licenseTrack} → {track.targetLicense}
            </p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-slate-400">Supervisor</dt>
                <dd className="font-medium text-slate-800">{track.supervisorName}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Started</dt>
                <dd className="font-medium text-slate-800">{isoDate(track.startedAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Hours earned</dt>
                <dd className="font-medium text-slate-800">
                  {hoursEarned} / {required}
                </dd>
              </div>
              <div>
                <dt className="text-slate-400">Remaining</dt>
                <dd className="font-medium text-slate-800">{remaining} hrs</dd>
              </div>
              <div>
                <dt className="text-slate-400">Sessions</dt>
                <dd className="font-medium text-slate-800">{sessionCount}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Progress</dt>
                <dd className="font-medium text-slate-800">{pct}%</dd>
              </div>
            </dl>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setShowBoardModal(false)}
                className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-700"
              >
                Close
              </button>
              <button
                type="button"
                onClick={printBoardSummary}
                className="flex-1 rounded-xl py-2.5 text-sm font-semibold text-white"
                style={{ backgroundColor: PURPLE }}
              >
                Print summary
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
