'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Download,
  GraduationCap,
  UserPlus,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useStaff } from '@/features/staff';

import {
  type TrainingStatus,
  type TrainingDef,
  type StaffTraining,
  type StaffMember,
  ORIENTATION_TEMPLATE,
  STATUS_CFG,
} from '@/features/hr/trainingData';

function formatDate(iso?: string) {
  if (!iso) return '—';
  try {
    return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function getCell(staff: StaffMember, trainingId: string): StaffTraining {
  return (
    staff.trainings.find((t) => t.trainingId === trainingId) || {
      trainingId,
      status: 'not-required' as const,
    }
  );
}

export default function TrainingHubPage() {
  const { users: directory } = useStaff();
  const [staff, setStaff, { loading: loadingStaff }] = useModuleList<StaffMember>(
    'hr-training-staff',
    []
  );
  const [trainingsStored, , { loading: loadingCatalog }] = useModuleList<TrainingDef>(
    'hr-trainings-catalog',
    []
  );
  const trainings = trainingsStored;
  const [tab, setTab] = useState<'matrix' | 'orientation' | 'catalog'>('matrix');
  const [statusFilter, setStatusFilter] = useState<TrainingStatus | 'all'>('all');
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState('all');

  const loading = loadingStaff || loadingCatalog;

  const overdueCount = staff.reduce(
    (n, s) => n + s.trainings.filter((t) => t.status === 'overdue').length,
    0
  );
  const expiringCount = staff.reduce(
    (n, s) => n + s.trainings.filter((t) => t.status === 'expiring').length,
    0
  );
  const newHires = staff.filter((s) => s.isNewHire);

  const roles = useMemo(() => Array.from(new Set(staff.map((s) => s.role))), [staff]);

  const filteredStaff = useMemo(() => {
    return staff.filter((s) => {
      if (roleFilter !== 'all' && s.role !== roleFilter) return false;
      if (statusFilter === 'all') return true;
      return s.trainings.some((t) => t.status === statusFilter);
    });
  }, [staff, roleFilter, statusFilter]);

  const selected = selectedStaffId ? staff.find((s) => s.id === selectedStaffId) : null;

  const toggleOrientation = (staffId: string, itemId: string) => {
    setStaff((prev) =>
      prev.map((s) =>
        s.id !== staffId
          ? s
          : {
              ...s,
              orientation: s.orientation.map((o) => (o.id === itemId ? { ...o, done: !o.done } : o)),
            }
      )
    );
  };

  const markComplete = (staffId: string, trainingId: string) => {
    const today = new Date().toISOString().slice(0, 10);
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1);
    const expires = nextYear.toISOString().slice(0, 10);
    setStaff((prev) =>
      prev.map((s) =>
        s.id !== staffId
          ? s
          : {
              ...s,
              trainings: s.trainings.map((t) =>
                t.trainingId !== trainingId
                  ? t
                  : {
                      ...t,
                      status: 'complete',
                      completedDate: today,
                      expiresDate: expires,
                      provider: t.provider || 'Internal',
                      certNumber: t.certNumber || `CERT-${Math.floor(Math.random() * 9000 + 1000)}`,
                    }
              ),
            }
      )
    );
  };

  const exportMatrix = () => {
    const catalog = trainings;
    const header = ['Staff', 'Role', ...catalog.map((t) => t.shortName)];
    const rows = staff.map((s) => [
      s.name,
      s.role,
      ...catalog.map((t) => getCell(s, t.id).status),
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `training-matrix-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const addFromDirectory = () => {
    const existing = new Set(staff.map((s) => s.id));
    const next = directory
      .filter((u) => u.status === 'ACTIVE' && !existing.has(u.id))
      .map((u) => ({
        id: u.id,
        name: u.name || u.email,
        role: u.role,
        hireDate: new Date().toISOString().slice(0, 10),
        isNewHire: true,
        orientation: ORIENTATION_TEMPLATE.map((o) => ({ ...o, done: false })),
        trainings: trainings.map((t) => ({ trainingId: t.id, status: 'in-progress' as TrainingStatus })),
      }));
    if (next.length === 0) return;
    setStaff((prev) => [...prev, ...next]);
  };

  if (loading && staff.length === 0 && trainings.length === 0) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <GraduationCap size={22} style={{ color: '#4F46E5' }} />
            <h1 className="text-2xl font-bold text-slate-900">Training Hub</h1>
          </div>
          <p className="text-slate-500 text-sm">
            Staff training compliance matrix, new-hire orientation, and certification tracking.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addFromDirectory}
            className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 py-2.5 text-sm font-bold text-indigo-700 hover:bg-indigo-50"
          >
            <UserPlus size={16} /> Add from staff directory
          </button>
          <button
            type="button"
            onClick={exportMatrix}
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
          >
            <Download size={16} /> Export matrix
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Staff tracked', value: staff.length, color: '#4F46E5', icon: <BookOpen size={14} /> },
          { label: 'Overdue cells', value: overdueCount, color: '#dc2626', icon: <AlertTriangle size={14} /> },
          { label: 'Expiring soon', value: expiringCount, color: '#b45309', icon: <Clock size={14} /> },
          { label: 'New hires', value: newHires.length, color: '#5555B8', icon: <UserPlus size={14} /> },
        ].map((k) => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: k.color + '18' }}>
                <span style={{ color: k.color }}>{k.icon}</span>
              </div>
              <span className="text-2xl font-semibold" style={{ color: k.color }}>
                {k.value}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-600">{k.label}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
        {(
          [
            { key: 'matrix', label: 'Compliance matrix' },
            { key: 'orientation', label: `New-hire orientation (${newHires.length})` },
            { key: 'catalog', label: 'Training catalog' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
              tab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'matrix' && (
        <>
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4 flex flex-wrap gap-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm bg-white"
            >
              <option value="all">All roles</option>
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-1">
              {(['all', 'overdue', 'expiring', 'in-progress', 'complete'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                    statusFilter === s
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-slate-50 text-slate-600'
                  }`}
                >
                  {s === 'all' ? 'All statuses' : STATUS_CFG[s].label}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            {staff.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-slate-500">
                No staff on this matrix yet. Click <strong>Add from staff directory</strong> to pull live HR users.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-200/80 bg-slate-50/80">
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 sticky left-0 bg-slate-50">
                      Staff
                    </th>
                    {trainings.map((t) => (
                      <th key={t.id} className="px-2 py-3 text-center text-[10px] font-bold text-slate-500 uppercase tracking-wide">
                        <div title={`${t.name} · ${t.frequency}`}>{t.shortName}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredStaff.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/80">
                      <td className="px-4 py-3 sticky left-0 bg-white">
                        <button
                          type="button"
                          onClick={() => setSelectedStaffId(s.id === selectedStaffId ? null : s.id)}
                          className="text-left"
                        >
                          <p className="font-semibold text-slate-900 text-sm">{s.name}</p>
                          <p className="text-[11px] text-slate-400">
                            {s.role}
                            {s.isNewHire ? ' · New hire' : ''}
                          </p>
                        </button>
                      </td>
                      {trainings.map((t) => {
                        const cell = getCell(s, t.id);
                        const cfg = STATUS_CFG[cell.status];
                        const daysUntilExp = cell.expiresDate
                          ? Math.ceil((new Date(cell.expiresDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
                          : null;
                        const isCritical14 = daysUntilExp !== null && daysUntilExp >= 0 && daysUntilExp <= 14;
                        const isExpiring60 = daysUntilExp !== null && daysUntilExp > 14 && daysUntilExp <= 60;
                        const isExpired = daysUntilExp !== null && daysUntilExp < 0;

                        return (
                          <td key={t.id} className="px-2 py-2 text-center">
                            <button
                              type="button"
                              title={`${cfg.label}${cell.expiresDate ? ` · exp ${formatDate(cell.expiresDate)} (${daysUntilExp}d)` : ''}`}
                              onClick={() => {
                                setSelectedStaffId(s.id);
                                if (cell.status === 'overdue' || cell.status === 'expiring' || cell.status === 'in-progress' || isCritical14 || isExpired) {
                                  markComplete(s.id, t.id);
                                }
                              }}
                              className={`inline-flex items-center justify-center w-9 h-9 rounded-lg text-xs font-bold border mx-auto transition ${
                                isExpired
                                  ? 'bg-red-100 text-red-700 border-red-300'
                                  : isCritical14
                                    ? 'bg-red-50 text-red-600 border-red-300 ring-2 ring-red-200'
                                    : isExpiring60
                                      ? 'bg-amber-100 text-amber-800 border-amber-300'
                                      : ''
                              }`}
                              style={!isExpired && !isCritical14 && !isExpiring60 ? { background: cfg.bg, color: cfg.color, borderColor: cfg.bg } : {}}
                            >
                              {cell.status === 'not-required'
                                ? '—'
                                : isExpired
                                  ? '✗'
                                  : isCritical14
                                    ? `!14d`
                                    : isExpiring60
                                      ? `!60d`
                                      : cfg.short}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-slate-200/80 flex flex-wrap gap-3 text-[11px] text-slate-500">
              {(Object.keys(STATUS_CFG) as TrainingStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 rounded flex items-center justify-center font-bold text-[10px]"
                    style={{ background: STATUS_CFG[s].bg, color: STATUS_CFG[s].color }}
                  >
                    {STATUS_CFG[s].short}
                  </span>
                  {STATUS_CFG[s].label}
                </span>
              ))}
              <span className="text-slate-400">· Click overdue/expiring/in-progress cells to mark complete</span>
            </div>
          </div>

          {selected && (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
              <div className="flex items-start justify-between gap-3 mb-4">
                <div>
                  <h3 className="font-semibold text-slate-900">{selected.name}</h3>
                  <p className="text-xs text-slate-500">
                    {selected.role} · Hired {formatDate(selected.hireDate)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedStaffId(null)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                >
                  Close
                </button>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {selected.trainings.map((t) => {
                  const def = trainings.find((d) => d.id === t.trainingId);
                  if (!def) return null;
                  const cfg = STATUS_CFG[t.status];
                  const daysUntilExp = t.expiresDate
                    ? Math.ceil((new Date(t.expiresDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
                    : null;
                  return (
                    <div key={t.trainingId} className="rounded-xl border border-slate-200/80 p-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-sm font-semibold text-slate-800">{def.name}</p>
                        {daysUntilExp !== null && daysUntilExp < 0 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-100 text-red-800 border border-red-200">
                            Expired ({Math.abs(daysUntilExp)}d ago)
                          </span>
                        ) : daysUntilExp !== null && daysUntilExp <= 14 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-red-50 text-red-700 border border-red-300 ring-1 ring-red-200">
                            Critical ({daysUntilExp}d left)
                          </span>
                        ) : daysUntilExp !== null && daysUntilExp <= 60 ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-50 text-amber-800 border border-amber-300">
                            Notice ({daysUntilExp}d left)
                          </span>
                        ) : (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-bold shrink-0"
                            style={{ background: cfg.bg, color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-500">
                        Renewal interval: {def.frequency}
                        {t.provider ? ` · ${t.provider}` : ''}
                        {t.certNumber ? ` · #${t.certNumber}` : ''}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Completed {formatDate(t.completedDate)} · Expires {formatDate(t.expiresDate)}
                      </p>
                      {(t.status === 'overdue' || t.status === 'expiring' || t.status === 'in-progress') && (
                        <button
                          type="button"
                          onClick={() => markComplete(selected.id, t.trainingId)}
                          className="mt-2 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-indigo-700"
                        >
                          Mark complete
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'orientation' && (
        <div className="space-y-4">
          {newHires.length === 0 && (
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-8 text-center text-sm text-slate-500">
              No new hires in orientation window.
            </div>
          )}
          {newHires.map((s) => {
            const done = s.orientation.filter((o) => o.done).length;
            const pct = Math.round((done / s.orientation.length) * 100);
            return (
              <div key={s.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ background: '#EEF2FF', color: '#4F46E5' }}
                    >
                      {s.name.split(' ').map((w) => w[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500">
                        {s.role} · Start {formatDate(s.hireDate)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold" style={{ color: '#4F46E5' }}>
                      {pct}% complete
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {done}/{s.orientation.length} checklist items
                    </p>
                  </div>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
                  <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: '#4F46E5' }} />
                </div>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {s.orientation.map((o) => (
                    <li key={o.id}>
                      <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer rounded-lg border border-slate-100 px-3 py-2 hover:bg-slate-50">
                        <input
                          type="checkbox"
                          checked={o.done}
                          onChange={() => toggleOrientation(s.id, o.id)}
                          className="rounded border-slate-300"
                        />
                        <span className={o.done ? 'line-through text-slate-400' : ''}>{o.label}</span>
                        {o.done && <CheckCircle2 size={14} className="text-emerald-600 ml-auto" />}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'catalog' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200/80 flex items-center gap-2">
            <ClipboardCheck size={16} style={{ color: '#4F46E5' }} />
            <h2 className="font-semibold text-slate-900">Required trainings</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {trainings.map((t) => {
              const counts = {
                complete: staff.filter((s) => getCell(s, t.id).status === 'complete').length,
                overdue: staff.filter((s) => getCell(s, t.id).status === 'overdue').length,
                expiring: staff.filter((s) => getCell(s, t.id).status === 'expiring').length,
                inProgress: staff.filter((s) => getCell(s, t.id).status === 'in-progress').length,
              };
              return (
                <div key={t.id} className="px-5 py-4 flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{t.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Short code <span className="font-mono">{t.shortName}</span> · Frequency {t.frequency}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-[10px] font-bold">
                    <span className="px-2 py-1 rounded-full" style={{ background: '#dcfce7', color: '#15803d' }}>
                      {counts.complete} complete
                    </span>
                    <span className="px-2 py-1 rounded-full" style={{ background: '#fee2e2', color: '#dc2626' }}>
                      {counts.overdue} overdue
                    </span>
                    <span className="px-2 py-1 rounded-full" style={{ background: '#fef3c7', color: '#b45309' }}>
                      {counts.expiring} expiring
                    </span>
                    <span className="px-2 py-1 rounded-full" style={{ background: '#EEF2FF', color: '#4F46E5' }}>
                      {counts.inProgress} in progress
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
