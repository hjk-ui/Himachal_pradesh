'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  Check,
  CheckCircle2,
  DollarSign,
  FileCheck2,
  FileText,
  GraduationCap,
  Heart,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  Target,
  Umbrella,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { fetchHrCorner, hrCornerAction } from '@/features/hr/hrCornerApi';
import type { HrCornerPayload } from '@/features/hr/hrCornerTypes';

type Employee = HrCornerPayload['employees'][number];
type CornerData = HrCornerPayload;
type Tab =
  | 'people'
  | 'payroll'
  | 'benefits'
  | 'pto'
  | 'talent'
  | 'credentialing'
  | 'learning'
  | 'compliance'
  | 'analytics';

const TABS: { id: Tab; label: string; icon: typeof Users; badgeKey?: 'payroll' | 'pto' | 'credentialing' | 'compliance' }[] = [
  { id: 'people', label: 'People', icon: Users },
  { id: 'payroll', label: 'Payroll', icon: DollarSign, badgeKey: 'payroll' },
  { id: 'benefits', label: 'Benefits', icon: Heart },
  { id: 'pto', label: 'Time & PTO', icon: Umbrella, badgeKey: 'pto' },
  { id: 'talent', label: 'Talent', icon: Target },
  { id: 'credentialing', label: 'Credentialing', icon: FileCheck2, badgeKey: 'credentialing' },
  { id: 'learning', label: 'Learning', icon: GraduationCap },
  { id: 'compliance', label: 'Compliance', icon: ShieldCheck, badgeKey: 'compliance' },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const DEPT_PILL: Record<string, string> = {
  Clinical: 'bg-[#ede9f7] text-[#5c2d91]',
  PRP: 'bg-[#d8f4f0] text-[#0d7a72]',
  'Case Mgmt': 'bg-[#e2efff] text-[#2563c7]',
  Administrative: 'bg-[#f0f2f5] text-[#536174]',
  Community: 'bg-[#e3f6e8] text-[#2a7a3a]',
};

const DEPT_BAR: Record<string, string> = {
  Clinical: 'bg-[#5c2d91]',
  PRP: 'bg-[#0d9288]',
  Administrative: 'bg-[#3c4c58]',
  'Case Mgmt': 'bg-[#276bc8]',
  Community: 'bg-[#5ba8d6]',
};

function currency(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
}

const NOT_TRACKED = 'Not tracked in Altrixs';

/** Format a metric, or null (MetricCard shows "Not tracked in Altrixs") when no source data exists. */
function fmt(value: number | null | undefined, render: (v: number) => string | number = (v) => v): string | number | null {
  return value === null || value === undefined ? null : render(value);
}

/** Benefit plan by type (name match), not by list position. */
function planOfType(plans: { plan: string; enrolled: number; eligible: number }[], pattern: RegExp) {
  const p = plans.find((row) => pattern.test(row.plan));
  return p ? `${p.enrolled}/${p.eligible}` : null;
}

function Pill({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${className}`}>{children}</span>;
}

function MetricCard({
  value,
  label,
  hint,
  tone,
}: {
  value: string | number | null;
  label: string;
  hint?: string;
  tone: 'violet' | 'teal' | 'blue' | 'amber' | 'rose' | 'green';
}) {
  const styles = {
    violet: 'bg-[#f1eaff] text-[#6130a5]',
    teal: 'bg-[#dcf4f2] text-[#008d87]',
    blue: 'bg-[#e2f0ff] text-[#1765bd]',
    amber: 'bg-[#fff6dc] text-[#be8300]',
    rose: 'bg-[#ffe8eb] text-[#c5282d]',
    green: 'bg-[#e3f7ea] text-[#0d7a45]',
  };
  return (
    <div className={`rounded-[1.35rem] px-5 py-5 shadow-[0_5px_12px_rgba(30,40,70,0.06)] ${styles[tone]}`}>
      {value === null ? (
        <p className="pt-2 text-sm font-bold text-slate-500">{NOT_TRACKED}</p>
      ) : (
        <p className="text-3xl font-black tracking-tight">{value}</p>
      )}
      <p className="mt-1 text-sm font-semibold text-[#29415f]">{label}</p>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </div>
  );
}

function PrimaryButton({ children, onClick, type = 'button' }: { children: React.ReactNode; onClick?: () => void; type?: 'button' | 'submit' }) {
  return (
    <button
      type={type}
      onClick={onClick}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#5c2d91] to-[#7c3aed] px-4 py-2.5 text-sm font-bold text-white shadow-sm"
    >
      {children}
    </button>
  );
}

function Modal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className={`max-h-[90vh] w-full overflow-y-auto rounded-2xl bg-white shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold text-[#13223b]">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Close">
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto rounded-xl">{children}</div>;
}

function th() {
  return 'border-b border-slate-100 px-2 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400';
}

export default function HrCornerPage() {
  const [tab, setTab] = useState<Tab>('people');
  const [data, setData] = useState<CornerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('all');
  const [type, setType] = useState('all');
  const [talentDept, setTalentDept] = useState('all');
  const [talentPriority, setTalentPriority] = useState('all');
  const [selected, setSelected] = useState<Employee | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [postOpen, setPostOpen] = useState(false);
  const [payrollConfirm, setPayrollConfirm] = useState<string | null>(null);
  const [payPreview, setPayPreview] = useState<CornerData['payroll'][number] | null>(null);
  const [benefit, setBenefit] = useState<CornerData['benefits'][number] | null>(null);
  const [apps, setApps] = useState<CornerData['requisitions'][number] | null>(null);
  const [interview, setInterview] = useState<CornerData['requisitions'][number] | null>(null);
  const [license, setLicense] = useState<CornerData['licenses'][number] | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);

  const reload = async () => {
    const next = await fetchHrCorner();
    setData(next);
  };

  useEffect(() => {
    let cancelled = false;
    fetchHrCorner()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const employees = data && 'employees' in data ? data.employees : [];
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return employees.filter((e) => {
      const matchQ = !q || `${e.name} ${e.email} ${e.jobTitle} ${e.department}`.toLowerCase().includes(q);
      const matchD = department === 'all' || e.department === department;
      const matchT = type === 'all' || e.employmentType === type;
      return matchQ && matchD && matchT;
    });
  }, [department, employees, search, type]);

  const act = async (body: Record<string, unknown>, ok: string) => {
    try {
      await hrCornerAction(body);
    } catch (err) {
      toast.error((err as Error).message || 'Action failed');
      throw err;
    }
    await reload();
    toast.success(ok);
  };

  const exportReport = async () => {
    const res = await fetch('/api/hr/corner/export');
    if (!res.ok) {
      toast.error('Could not export');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hr-staff-report.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('HR report exported');
  };

  const downloadFile = async (kind: 'stub' | 'w2', filename: string) => {
    const res = await fetch(`/api/hr/corner/files?kind=${kind}`);
    if (!res.ok) {
      toast.error('Download failed');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Download started');
  };

  if (loading) {
    return <div className="py-24 text-center text-sm text-slate-500">Loading HR Corner…</div>;
  }
  if (!data || !('employees' in data)) {
    return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error || 'HR Corner is not ready. Run npm run db:seed:hr-corner.'}</div>;
  }

  const badges = data.badges;
  const kpis = data.kpis;
  const snap = data.snapshot;

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1580px] text-[#10233f]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-[#141c34]">HR Corner</h1>
          <p className="mt-1 text-[15px] text-[#5a718e] sm:text-lg">People · Payroll · Benefits · Talent · Compliance · Analytics</p>
        </div>
        <div className="flex gap-3">
          <button onClick={exportReport} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-[#27405e]">
            <FileText size={16} /> Export Report
          </button>
          <PrimaryButton onClick={() => setAddOpen(true)}>
            <Plus size={17} /> Add
          </PrimaryButton>
        </div>
      </div>

      {data.alertBanner ? (
        <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-[#ffb9bd] bg-[#fff2f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#ffc9cc] text-[#bd1f2b]">
              <AlertCircle size={22} />
            </span>
            <div>
              <p className="font-bold text-[#a3151f]">{data.alertBanner.count} Compliance Action{data.alertBanner.count === 1 ? '' : 's'} Required</p>
              <p className="text-sm text-[#d3202b]">{data.alertBanner.text}</p>
            </div>
          </div>
          <button onClick={() => setTab('compliance')} className="font-bold text-[#bd1f2b]">
            Resolve →
          </button>
        </div>
      ) : null}

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_rgba(36,57,91,0.05)]">
        <div className="flex flex-wrap border-b border-slate-100">
          {TABS.map(({ id, label, icon: Icon, badgeKey }) => {
            const badge = badgeKey ? badges[badgeKey] : 0;
            return (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`relative flex shrink-0 items-center gap-2 px-5 py-4 text-sm font-semibold transition ${
                  tab === id ? 'text-[#5c2d91] after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-[#5c2d91]' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={17} />
                {label}
                {badge ? <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#ef4950] px-1 text-[11px] font-bold text-white">{badge}</span> : null}
              </button>
            );
          })}
        </div>
        <div className="p-4 sm:p-6 lg:p-8">
          {tab === 'people' ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
                <MetricCard value={kpis.headcount} label="Total Headcount" tone="violet" />
                <MetricCard value={kpis.fullTime} label="Full-Time" tone="green" />
                <MetricCard value={kpis.partTime} label="Part-Time" tone="blue" />
                <MetricCard value={kpis.contract} label="Contract" tone="amber" />
                <MetricCard value={fmt(kpis.ytdTurnoverPct, (v) => `${v}%`)} label="YTD Turnover" tone="rose" />
              </div>
              <div className="mt-7 grid gap-5 xl:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-5">
                  <h2 className="mb-5 text-xl font-bold text-[#141c34]">Department Breakdown</h2>
                  <div className="space-y-4">
                    {data.departments.map((item) => (
                      <div key={item.name}>
                        <div className="mb-1 flex justify-between text-sm">
                          <span className="font-semibold text-[#1d3859]">{item.name}</span>
                          <span className="text-slate-500">
                            {item.count} staff · {item.pct}%
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-white">
                          <div className={`h-full rounded-full ${DEPT_BAR[item.name] || 'bg-[#5c2d91]'}`} style={{ width: `${Math.max(8, item.pct)}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-5">
                  <h2 className="mb-5 text-xl font-bold text-[#141c34]">Org Chart — Leadership</h2>
                  <div className="flex flex-col items-center">
                    {data.leadership.director ? (
                      <div className="rounded-xl border-2 border-[#d6adff] bg-[#f6eaff] px-6 py-3 text-center">
                        <p className="font-bold text-[#6b20bf]">{data.leadership.director.name}</p>
                        <p className="text-xs text-[#8e5bb6]">{data.leadership.director.jobTitle}</p>
                      </div>
                    ) : null}
                    <div className="my-3 h-7 w-px bg-slate-300" />
                    <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
                      {data.leadership.reports.map((staff) => {
                        const tones = [
                          'border-[#c5ddf8] bg-[#e7f2ff]',
                          'border-[#bfe8c9] bg-[#e8f8ee]',
                          'border-slate-200 bg-[#f3f4f6]',
                          'border-[#f3c2d8] bg-[#fde8f0]',
                        ];
                        const i = data.leadership.reports.indexOf(staff);
                        return (
                          <div key={staff.userId} className={`rounded-xl border px-4 py-3 text-center ${tones[i % 4]}`}>
                            <p className="text-sm font-bold text-[#173357]">{staff.name}</p>
                            <p className="text-xs text-slate-500">{staff.jobTitle}</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-8">
                <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <h2 className="text-xl font-bold text-[#141c34]">Employee Directory ({employees.length})</h2>
                  <div className="flex min-w-0 flex-wrap gap-2">
                    <div className="relative min-w-[10rem] flex-1">
                      <Search size={16} className="absolute left-3 top-3 text-slate-500" />
                      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="h-11 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#8338e5]" />
                    </div>
                    <select value={department} onChange={(e) => setDepartment(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
                      <option value="all">All Depts</option>
                      {data.departments.map((d) => (
                        <option key={d.name}>{d.name}</option>
                      ))}
                    </select>
                    <select value={type} onChange={(e) => setType(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm">
                      <option value="all">All Types</option>
                      <option>Full-Time</option>
                      <option>Part-Time</option>
                      <option>Contract</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-3 md:hidden">
                  {filtered.map((e) => (
                    <button key={e.id} onClick={() => setSelected(e)} className="w-full rounded-2xl border border-slate-100 p-4 text-left">
                      <div className="flex items-center gap-3">
                        <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#5c2d91] to-[#7c3aed] text-sm font-bold text-white">{e.initials}</span>
                        <div>
                          <p className="font-bold">{e.name}</p>
                          <p className="text-xs text-slate-500">{e.email}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-sm text-slate-500">{e.jobTitle}</p>
                    </button>
                  ))}
                </div>
                <TableWrap>
                  <table className="hidden w-full min-w-[980px] text-left md:table">
                    <thead>
                      <tr>
                        <th className={th()}>Employee</th>
                        <th className={th()}>Title</th>
                        <th className={th()}>Department</th>
                        <th className={th()}>Type</th>
                        <th className={th()}>Status</th>
                        <th className={th()}>Hire Date</th>
                        <th className={th()}>Manager</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((e) => (
                        <tr key={e.id} className="border-b border-slate-100 last:border-0">
                          <td className="px-2 py-4">
                            <button onClick={() => setSelected(e)} className="flex items-center gap-3 text-left">
                              <span className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#5c2d91] to-[#7c3aed] text-sm font-bold text-white">{e.initials}</span>
                              <span>
                                <span className="block font-bold text-[#101e36]">{e.name}</span>
                                <span className="block text-xs text-slate-500">{e.email}</span>
                              </span>
                            </button>
                          </td>
                          <td className="px-2 py-4 text-sm text-[#38516e]">{e.jobTitle}</td>
                          <td className="px-2 py-4">
                            <Pill className={DEPT_PILL[e.department] || DEPT_PILL.Administrative}>{e.department}</Pill>
                          </td>
                          <td className="px-2 py-4">
                            <Pill className={e.employmentType === 'Full-Time' ? 'bg-[#ede9f7] text-[#5c2d91]' : e.employmentType === 'Part-Time' ? 'bg-[#e2efff] text-[#2563c7]' : 'bg-[#fff1c8] text-[#a96600]'}>{e.employmentType}</Pill>
                          </td>
                          <td className="px-2 py-4">
                            <Pill className={e.hrStatus === 'Active' ? 'bg-[#dcf8e8] text-[#087a45]' : 'bg-[#fff1c8] text-[#a96600]'}>{e.hrStatus}</Pill>
                          </td>
                          <td className="px-2 py-4 text-sm text-slate-500">{e.hireLabel}</td>
                          <td className="px-2 py-4 text-sm text-slate-500">{e.managerName}</td>
                          <td className="px-2 py-4 text-right">
                            <button onClick={() => setSelected(e)} className="text-sm font-bold text-[#5c2d91]">
                              View →
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                {filtered.length === 0 ? <p className="py-10 text-center text-sm text-slate-500">No employees yet</p> : null}
              </div>
            </>
          ) : null}

          {tab === 'payroll' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={currency(kpis.lastPayroll)} label="Last Payroll Total" hint={kpis.lastPayrollHint} tone="violet" />
                <MetricCard value={kpis.nextPayDate} label="Next Pay Date" hint={kpis.nextPayHint} tone="teal" />
                <MetricCard value={fmt(kpis.ytdPayroll, (v) => `$${Math.round(v / 1000)}k`)} label="YTD Payroll" hint="Year to date" tone="blue" />
                <MetricCard value={fmt(kpis.pendingW4)} label="Pending W-4 Updates" tone="rose" />
              </div>
              {kpis.nextRun ? (
                <div className="mt-7 flex flex-col gap-3 rounded-2xl border border-[#f5d98a] bg-[#fff9e9] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3">
                    <CalendarClock className="mt-0.5 text-[#c47a12]" size={22} />
                    <div>
                      <p className="font-bold text-[#864006]">
                        Next Pay Run: {kpis.nextRun.period.replace(', 2026', '')} · {currency(kpis.nextRun.gross)} gross
                      </p>
                      <p className="text-sm text-[#bd6b17]">
                        Scheduled to process {kpis.nextRun.runDate} · {kpis.nextRun.employees} employees · Direct deposit.
                      </p>
                    </div>
                  </div>
                  <PrimaryButton onClick={() => setPayrollConfirm(kpis.nextRun.id)}>Mark Pay Run Complete</PrimaryButton>
                </div>
              ) : null}
              <div className="mt-8">
                <h2 className="text-xl font-bold text-[#141c34]">Payroll History</h2>
                <p className="mt-1 text-sm text-slate-500">{snap?.payrollProviderNote}</p>
                <TableWrap>
                  <table className="mt-4 w-full min-w-[920px] text-left">
                    <thead>
                      <tr>
                        {['Pay Period', 'Employees', 'Gross Pay', 'Taxes', 'Benefits', 'Net Pay', 'Run Date', 'Status', ''].map((h) => (
                          <th key={h} className={th()}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.payroll.map((row) => (
                        <tr key={row.id} className="border-b border-slate-100 text-sm text-[#38516e]">
                          <td className="py-4 font-semibold text-[#141c34]">{row.period}</td>
                          <td>{row.employees}</td>
                          <td className="font-bold text-[#141c34]">{currency(row.gross)}</td>
                          <td>{currency(row.taxes)}</td>
                          <td>{currency(row.benefits)}</td>
                          <td className="font-bold text-emerald-600">{currency(row.net)}</td>
                          <td>{row.runDate}</td>
                          <td>
                            <Pill className={row.status === 'completed' ? 'bg-[#dcf8e8] text-[#087a45]' : 'bg-[#fff1c8] text-[#a96600]'}>
                              {row.status === 'completed' ? 'Completed' : 'Scheduled'}
                            </Pill>
                          </td>
                          <td className="text-right">
                            <button onClick={() => setPayPreview(row)} className="font-bold text-[#5c2d91]">
                              {row.status === 'scheduled' ? 'Preview →' : 'View →'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {[
                    { icon: FileText, color: 'bg-[#ede9f7] text-[#5c2d91]', title: 'Pay Run Summary', sub: 'Last completed run (text export — not individual pay stubs)', action: 'Download →', onClick: () => downloadFile('stub', 'pay-run-summary.txt') },
                    { icon: BarChart3, color: 'bg-[#d8f4f0] text-[#0d7a72]', title: 'W-2 Prep Roster', sub: 'Employee roster for W-2 prep — Altrixs does not generate W-2 forms', action: 'Download →', onClick: () => downloadFile('w2', 'w2-prep-roster.txt') },
                    { icon: Wallet, color: 'bg-[#e2efff] text-[#2563c7]', title: 'Direct Deposit', sub: `${data.deposit?.percentOnDd ?? 100}% on direct deposit`, action: 'Manage →', onClick: () => setDepositOpen(true) },
                  ].map((card) => (
                    <div key={card.title} className="rounded-2xl border border-slate-100 p-5">
                      <span className={`grid h-11 w-11 place-items-center rounded-xl ${card.color}`}>
                        <card.icon size={18} />
                      </span>
                      <p className="mt-3 font-bold text-[#141c34]">{card.title}</p>
                      <p className="text-sm text-slate-500">{card.sub}</p>
                      <button onClick={card.onClick} className="mt-3 text-sm font-bold text-[#5c2d91]">
                        {card.action}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {tab === 'benefits' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={planOfType(data.benefits, /medical|health/i)} label="Medical Enrolled" tone="violet" />
                <MetricCard value={planOfType(data.benefits, /dental/i)} label="Dental Enrolled" tone="teal" />
                <MetricCard value={planOfType(data.benefits, /403\s*\(?b\)?|401\s*\(?k\)?|retire/i)} label="403(b) Participating" tone="amber" />
                <MetricCard value={fmt(snap?.benefitsCostMonthly, currency)} label="Benefits Cost / Mo" tone="blue" />
              </div>
              <div className="my-7 flex flex-col gap-3 rounded-2xl border border-[#e2c8ff] bg-[#fbf4ff] p-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-bold text-[#6721ad]">{snap?.openEnrollmentNote || 'Open enrollment: not tracked in Altrixs'}</p>
                  <p className="text-sm text-[#8a49c0]">{snap?.openEnrollmentDetail}</p>
                </div>
                {/* No benefit guide document is stored yet — /api/hr/corner/files serves only pay-run and roster exports. */}
                <button
                  type="button"
                  disabled
                  title="Not connected yet: no benefit guide has been uploaded. Get the current guide from your benefits broker."
                  className="inline-flex cursor-not-allowed items-center gap-2 rounded-xl border border-[#dcb8ff] bg-white px-4 py-2.5 text-sm font-bold text-[#5c2d91] opacity-50"
                >
                  <FileText size={16} /> Benefit Guide
                </button>
              </div>
              <h2 className="text-xl font-bold text-[#141c34]">Benefit Plans Overview</h2>
              <p className="mt-1 text-sm text-slate-500">Employer contributions + employee elections.</p>
              <TableWrap>
                <table className="mt-4 w-full min-w-[780px] text-left">
                  <thead>
                    <tr>
                      {['Plan', 'Carrier', 'Enrolled / Eligible', 'Employer Cost', 'Employee Cost', ''].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.benefits.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-sm text-[#38516e]">
                        <td className="py-4 font-bold text-[#141c34]">{row.plan}</td>
                        <td>{row.carrier}</td>
                        <td>
                          <div className="flex items-center gap-2">
                            <b>
                              {row.enrolled}/{row.eligible}
                            </b>
                            <span className="h-2 w-28 rounded-full bg-slate-100">
                              <span className="block h-full rounded-full bg-[#5c2d91]" style={{ width: `${(row.enrolled / Math.max(row.eligible, 1)) * 100}%` }} />
                            </span>
                          </div>
                        </td>
                        <td>{row.employerCostLabel}</td>
                        <td>{row.employeeCostLabel}</td>
                        <td className="text-right">
                          <button onClick={() => setBenefit(row)} className="font-bold text-[#5c2d91]">
                            Details →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}

          {tab === 'pto' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={kpis.pendingLeave} label="Leave Requests Pending" tone="rose" />
                <MetricCard value={kpis.onLeaveToday} label="Employees on Leave Today" tone="amber" />
                <MetricCard value={fmt(snap?.fmlaHoursYtd, (v) => `${v}h`)} label="FMLA Hours Used (YTD)" tone="blue" />
                <MetricCard value={fmt(snap?.avgVacationDays, (v) => `${v}d`)} label="Avg Vacation Balance" tone="teal" />
              </div>
              <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="text-xl font-bold text-[#141c34]">Leave Requests</h2>
                  <p className="text-sm text-slate-500">Pending and recently approved requests</p>
                </div>
                <PrimaryButton onClick={() => setLeaveOpen(true)}>
                  <Plus size={16} /> Request Leave
                </PrimaryButton>
              </div>
              <TableWrap>
                <table className="mt-4 w-full min-w-[900px] text-left">
                  <thead>
                    <tr>
                      {['Employee', 'Leave Type', 'Dates', 'Days', 'Submitted', 'Notes', 'Status', ''].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.leave.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-sm">
                        <td className="py-4 font-bold text-[#141c34]">{row.employee}</td>
                        <td>
                          <Pill className={row.leaveType === 'Sick' ? 'bg-[#ffe0e4] text-[#c5222b]' : row.leaveType === 'FMLA' ? 'bg-[#e2efff] text-[#2563c7]' : row.leaveType === 'Personal' ? 'bg-[#ede9f7] text-[#5c2d91]' : 'bg-[#ede9f7] text-[#5c2d91]'}>{row.leaveType}</Pill>
                        </td>
                        <td>{row.dates}</td>
                        <td>{row.days}</td>
                        <td className="text-slate-500">{row.submitted}</td>
                        <td>{row.notes}</td>
                        <td>
                          <Pill className={row.status === 'Approved' ? 'bg-[#dcf8e8] text-[#087a45]' : row.status === 'Denied' ? 'bg-[#ffe0e4] text-[#c5222b]' : 'bg-[#fff1c8] text-[#a96600]'}>{row.status}</Pill>
                        </td>
                        <td>
                          {row.status === 'Pending' ? (
                            <div className="flex gap-1">
                              <button onClick={() => act({ action: 'leave-status', id: row.id, status: 'Approved' }, 'Leave approved')} className="rounded-full bg-green-50 p-2 text-green-700" aria-label="Approve">
                                <Check size={14} />
                              </button>
                              <button onClick={() => act({ action: 'leave-status', id: row.id, status: 'Denied' }, 'Leave rejected')} className="rounded-full bg-rose-50 p-2 text-rose-700" aria-label="Reject">
                                <X size={14} />
                              </button>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
              <h2 className="mt-10 text-xl font-bold text-[#141c34]">PTO Balances</h2>
              <p className="text-sm text-slate-500">As of today · Accruals updated semi-monthly</p>
              <TableWrap>
                <table className="mt-4 w-full min-w-[880px] text-left">
                  <thead>
                    <tr>
                      {['Employee', 'Department', 'Vacation (Hrs)', 'Sick (Hrs)', 'Personal (Hrs)', 'FMLA Used', 'YTD Used', 'Pending Request'].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.pto.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-sm">
                        <td className="py-4 font-bold text-[#141c34]">{row.employee}</td>
                        <td>
                          <Pill className={DEPT_PILL[row.department] || DEPT_PILL.Administrative}>{row.department}</Pill>
                        </td>
                        <td className="font-bold">{row.vacationHrs}h</td>
                        <td>{row.sickHrs}h</td>
                        <td>{row.personalHrs}h</td>
                        <td>{row.fmlaUsed}</td>
                        <td>{row.ytdUsed}h</td>
                        <td>{row.pendingRequest}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}

          {tab === 'talent' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={kpis.openReqs} label="Open Requisitions" tone="violet" />
                <MetricCard value={kpis.totalApplicants} label="Total Applicants" tone="blue" />
                <MetricCard value={kpis.interviews} label="Interviews Scheduled" tone="green" />
                <MetricCard value={kpis.offers} label="Offers Extended" tone="amber" />
              </div>
              <div className="mt-8 flex flex-wrap items-end justify-between gap-3">
                <h2 className="text-xl font-bold text-[#141c34]">Open Requisitions & Candidate Pipeline</h2>
                <div className="flex flex-wrap gap-2">
                  <select value={talentDept} onChange={(e) => setTalentDept(e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
                    <option value="all">All Depts</option>
                    {data.departments.map((d) => (
                      <option key={d.name}>{d.name}</option>
                    ))}
                  </select>
                  <select value={talentPriority} onChange={(e) => setTalentPriority(e.target.value)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm">
                    <option value="all">All Priorities</option>
                    <option value="high">high</option>
                    <option value="medium">medium</option>
                    <option value="low">low</option>
                  </select>
                  <PrimaryButton onClick={() => setPostOpen(true)}>
                    <Plus size={16} /> Post New Position
                  </PrimaryButton>
                </div>
              </div>
              {data.requisitions
                .filter((r) => (talentDept === 'all' || r.department === talentDept) && (talentPriority === 'all' || r.priority === talentPriority))
                .map((row) => (
                  <div key={row.id} className="mt-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div>
                        <h3 className="text-lg font-bold text-[#141c34]">
                          {row.title}{' '}
                          <Pill className={row.priority === 'high' ? 'bg-[#ffe0e4] text-[#c5222b]' : row.priority === 'medium' ? 'bg-[#fff1c8] text-[#a96600]' : 'bg-[#f0f2f5] text-[#536174]'}>{row.priority} priority</Pill>{' '}
                          <Pill className={row.type === 'Part-Time' ? 'bg-[#e2efff] text-[#2563c7]' : 'bg-[#ede9f7] text-[#5c2d91]'}>{row.type}</Pill>
                        </h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {row.department} · Posted {row.posted} · {row.salary}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Pill className="bg-slate-100 text-slate-600">{row.applied} Applied</Pill>
                          <Pill className="bg-[#e2efff] text-[#2563c7]">{row.screened} Screened</Pill>
                          <Pill className="bg-[#ede9f7] text-[#5c2d91]">{row.interviews} Interview</Pill>
                          <Pill className="bg-[#fff1c8] text-[#a96600]">{row.offers} Offer</Pill>
                          <Pill className="bg-[#dcf8e8] text-[#087a45]">{row.hired} Hired</Pill>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button onClick={() => setApps(row)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700">
                          Applications
                        </button>
                        <button onClick={() => setInterview(row)} className="rounded-xl border border-[#e0c5ff] px-4 py-2 text-sm font-bold text-[#5c2d91]">
                          Schedule Interview
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
            </>
          ) : null}

          {tab === 'credentialing' ? (
            <>
              {/* Section 5.5: 90-Day Expiry Alert Banner */}
              {(() => {
                const expiringSoon = data.licenses.filter((l) => l.daysLeft >= 0 && l.daysLeft <= 90);
                if (expiringSoon.length === 0) return null;
                return (
                  <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50/90 p-4 text-amber-900 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-xl bg-amber-200/70 p-2 text-amber-800">
                        <AlertCircle className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">
                          {expiringSoon.length} Clinician Credential{expiringSoon.length === 1 ? '' : 's'} Expiring Within 90 Days
                        </p>
                        <p className="text-xs text-amber-700 mt-0.5">
                          Action required: professional state medical/NP licenses or DEA registrations are approaching renewal deadlines.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        expiringSoon.forEach((l) => {
                          void act({ action: 'send-reminder', id: l.id }, 'Reminder date recorded — no email or text is sent; contact each clinician directly').catch(() => undefined);
                        });
                      }}
                      className="whitespace-nowrap rounded-xl bg-amber-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs hover:bg-amber-700 transition"
                    >
                      Record Reminders for All ({expiringSoon.length})
                    </button>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={kpis.activeLicenses} label="Active Licenses" tone="violet" />
                <MetricCard value={kpis.expiring90} label="Expiring ≤ 90 Days" tone="rose" />
                <MetricCard value={kpis.npiCount} label="NPI Numbers on File" tone="teal" />
                <MetricCard value={kpis.deaCount} label="DEA Registrations" tone="blue" />
              </div>
              <h2 className="mt-8 text-xl font-bold text-[#141c34]">Professional License Tracker</h2>
              <p className="text-sm text-slate-500">&apos;Record Reminder&apos; logs that you reminded the clinician about a renewal. No message is sent from here.</p>
              <TableWrap>
                <table className="mt-4 w-full min-w-[980px] text-left">
                  <thead>
                    <tr>
                      {['Clinician', 'Dept', 'Credential', 'License #', 'NP#', 'NPI', 'DEA #', 'Expires', 'Days Left', ''].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.licenses.map((row) => {
                      const expired = row.daysLeft < 0;
                      const soon = row.daysLeft >= 0 && row.daysLeft <= 90;
                      // Only a stored NP license number; never derived from the RN/other license number.
                      const npNum = row.npLicense || '—';
                      return (
                        <tr key={row.id} className="border-b border-slate-100 text-sm">
                          <td className="py-4 font-bold text-[#141c34]">{row.clinician}</td>
                          <td>
                            <Pill className={DEPT_PILL[row.department] || DEPT_PILL.Administrative}>{row.department}</Pill>
                          </td>
                          <td>{row.credential}</td>
                          <td>{row.licenseNumber}</td>
                          <td className="font-mono text-xs text-slate-600">{npNum}</td>
                          <td>{row.npi || '—'}</td>
                          <td>{row.deaNumber || '—'}</td>
                          <td>{row.expiresAt}</td>
                          <td>
                            <Pill className={expired ? 'bg-[#ffe0e4] text-[#c5222b]' : soon ? 'bg-[#fff1c8] text-[#a96600]' : 'bg-[#dcf8e8] text-[#087a45]'}>
                              {expired ? 'EXPIRED' : `${row.daysLeft}d`}
                            </Pill>
                          </td>
                          <td className="text-right">
                            {expired || soon ? (
                              <button
                                onClick={() => act({ action: 'send-reminder', id: row.id }, 'Reminder date recorded — no email or text is sent; contact the clinician directly').catch(() => undefined)}
                                className="font-bold text-[#5c2d91]"
                              >
                                Record Reminder
                              </button>
                            ) : (
                              <button onClick={() => setLicense(row)} className="font-bold text-[#5c2d91]">
                                View
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}

          {tab === 'learning' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={fmt(snap?.requiredTrainings)} label="Required Trainings" tone="rose" />
                <MetricCard value={fmt(snap?.electiveOfferings)} label="Elective Offerings" tone="blue" />
                <MetricCard value={fmt(snap?.ceuCompliancePct, (v) => `${v}%`)} label="CEU Compliance Rate" hint="From staff credentials with a CEU requirement" tone="teal" />
                <MetricCard value={fmt(snap?.totalCreditsAvailable)} label="Total Credits Available" tone="violet" />
              </div>
              <h2 className="mt-8 text-xl font-bold text-[#141c34]">Individual CEU Progress</h2>
              <p className="text-sm text-slate-500">Progress toward licensure renewal cycle</p>
              <TableWrap>
                <table className="mt-4 w-full min-w-[720px] text-left">
                  <thead>
                    <tr>
                      {['Clinician', 'License', 'Credits Earned', 'Credits Required', 'Progress', 'Status'].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.ceu.map((row) => {
                      const remaining = row.creditsRequired - row.creditsEarned;
                      const complete = remaining <= 0;
                      return (
                        <tr key={row.id} className="border-b border-slate-100 text-sm">
                          <td className="py-4 font-bold text-[#141c34]">{row.clinician}</td>
                          <td>{row.license}</td>
                          <td className="font-bold">{row.creditsEarned}</td>
                          <td>{row.creditsRequired}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <span className="h-2 w-36 rounded-full bg-slate-100">
                                <span className={`block h-full rounded-full ${complete ? 'bg-emerald-500' : 'bg-[#5c2d91]'}`} style={{ width: `${Math.min(100, row.pct)}%` }} />
                              </span>
                              {row.pct}%
                            </div>
                          </td>
                          <td>
                            <Pill className={complete ? 'bg-[#dcf8e8] text-[#087a45]' : 'bg-[#fff1c8] text-[#a96600]'}>{complete ? 'Complete' : `${remaining} credits remaining`}</Pill>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}

          {tab === 'compliance' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={fmt(snap?.complianceScore, (v) => `${v}%`)} label="Compliance Score" tone="violet" />
                <MetricCard value={kpis.alertCount} label="Action Required" tone="rose" />
                <MetricCard value={kpis.reviewCount} label="Needs Review" tone="amber" />
                <MetricCard value={kpis.compliantCount} label="Items Compliant" tone="green" />
              </div>
              <div className="mt-7 flex items-start gap-3 rounded-2xl border border-[#b9d8ff] bg-[#eef6ff] p-5">
                <Lock className="mt-0.5 text-[#1765bd]" size={20} />
                <div>
                  <p className="font-bold text-[#1765bd]">HIPAA Workforce Compliance</p>
                  <p className="text-sm text-[#3d6fa8]">All staff are required to complete annual HIPAA training. Access to PHI is logged and audited. This portal operates under 45 CFR Parts 160 and 164.</p>
                </div>
              </div>
              <h2 className="mt-8 text-xl font-bold text-[#141c34]">Compliance Dashboard</h2>
              <p className="text-sm text-slate-500">HR and regulatory requirements — MD Behavioral Health LLC</p>
              <div className="mt-4 space-y-3">
                {data.compliance.map((item) => {
                  const tone =
                    item.status === 'Alert'
                      ? 'border-rose-200 bg-rose-50'
                      : item.status === 'Review'
                        ? 'border-amber-200 bg-amber-50'
                        : 'border-emerald-200 bg-emerald-50';
                  const icon = item.status === 'Alert' ? <AlertCircle className="text-rose-600" size={20} /> : item.status === 'Review' ? <AlertCircle className="text-amber-600" size={20} /> : <CheckCircle2 className="text-emerald-600" size={20} />;
                  return (
                    <div key={item.id} className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-5 ${tone}`}>
                      <div className="flex items-start gap-3">
                        <span className="mt-0.5">{icon}</span>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-[#141c34]">{item.title}</p>
                            <Pill className={item.status === 'Alert' ? 'bg-[#ffe0e4] text-[#c5222b]' : item.status === 'Review' ? 'bg-[#fff1c8] text-[#a96600]' : 'bg-[#dcf8e8] text-[#087a45]'}>{item.status}</Pill>
                          </div>
                          <p className="mt-1 text-sm text-slate-500">{item.detail}</p>
                        </div>
                      </div>
                      {item.status !== 'Compliant' ? (
                        <button onClick={() => act({ action: 'resolve-compliance', id: item.id }, 'Compliance item resolved')} className="font-bold text-[#5c2d91]">
                          Resolve →
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}

          {tab === 'analytics' ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard value={fmt(snap?.avgTimeToFillDays, (v) => `${v} days`)} label="Avg Time to Fill" tone="violet" />
                <MetricCard value={fmt(snap?.costPerHire, currency)} label="Cost per Hire" tone="green" />
                <MetricCard value={fmt(kpis.ytdTurnoverPct, (v) => `${v}%`)} label="YTD Turnover" tone="rose" />
                <MetricCard value={fmt(snap?.avgTenureYears, (v) => `${v} yrs`)} label="Avg Tenure" hint="From staff hire dates" tone="blue" />
              </div>
              <div className="mt-8 grid gap-5 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 p-5">
                  <h2 className="mb-4 text-lg font-bold text-[#141c34]">Headcount Trend (Last 8 Months)</h2>
                  {data.headcount.length === 0 ? <p className="text-sm text-slate-500">{NOT_TRACKED}: headcount history is not recorded.</p> : null}
                  <div className={`${data.headcount.length === 0 ? 'hidden' : 'flex'} h-48 items-end justify-between gap-2 border-b border-slate-100 px-1 pb-2`}>
                    {data.headcount.map((p) => (
                      <div key={p.id} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                        <span className="text-xs font-bold text-[#5c2d91]">{p.count}</span>
                        <div className="w-full max-w-10 rounded-t-lg bg-[#7436b6]" style={{ height: `${(p.count / 12) * 78}%` }} />
                        <span className="text-xs text-slate-500">{p.monthLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-100 p-5">
                  <h2 className="mb-4 text-lg font-bold text-[#141c34]">Monthly Turnover Events</h2>
                  {data.turnover.length === 0 ? <p className="text-sm text-slate-500">{NOT_TRACKED}: separations are not recorded.</p> : null}
                  <div className={`${data.turnover.length === 0 ? 'hidden' : 'flex'} h-48 items-end justify-between gap-2 border-b border-slate-100 px-1 pb-2`}>
                    {data.turnover.map((p) => (
                      <div key={p.id} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                        <span className={`text-xs font-bold ${p.count ? 'text-rose-600' : 'text-slate-500'}`}>{p.count}</span>
                        <div className={`w-full max-w-10 rounded-t-lg ${p.count ? 'bg-rose-500' : 'bg-slate-100'}`} style={{ height: `${Math.max(8, p.count * 45)}%` }} />
                        <span className="text-xs text-slate-500">{p.monthLabel}</span>
                      </div>
                    ))}
                  </div>
                  {data.turnover.length > 0 ? (
                    <p className="mt-3 text-xs text-slate-500">{data.turnover.reduce((sum, p) => sum + p.count, 0)} separations YTD</p>
                  ) : null}
                </div>
              </div>
              <h2 className="mt-8 text-xl font-bold text-[#141c34]">Compensation Summary by Department</h2>
              <TableWrap>
                <table className="mt-4 w-full min-w-[760px] text-left">
                  <thead>
                    <tr>
                      {['Department', 'Headcount', 'Avg Salary', 'Total Payroll / Yr', 'CEU Compliance', 'Turnover YTD'].map((h) => (
                        <th key={h} className={th()}>
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.deptComp.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100 text-sm">
                        <td className="py-4">
                          <Pill className={DEPT_PILL[row.department] || DEPT_PILL.Administrative}>{row.department}</Pill>
                        </td>
                        <td>{row.headcount}</td>
                        <td className="font-bold">{row.avgSalary === null ? <span className="text-xs font-medium text-slate-400">{NOT_TRACKED}</span> : currency(row.avgSalary)}</td>
                        <td>{row.totalPayrollYr === null ? <span className="text-xs text-slate-400">{NOT_TRACKED}</span> : currency(row.totalPayrollYr)}</td>
                        <td>
                          {row.ceuPct === null ? (
                            <span className="text-xs text-slate-400">{NOT_TRACKED}</span>
                          ) : (
                            <>
                              <span className="mr-2 inline-block h-2 w-28 rounded-full bg-slate-100 align-middle">
                                <span className={`block h-full rounded-full ${row.ceuPct >= 95 ? 'bg-emerald-500' : 'bg-amber-400'}`} style={{ width: `${row.ceuPct}%` }} />
                              </span>
                              {row.ceuPct}%
                            </>
                          )}
                        </td>
                        <td>
                          <Pill className={row.turnoverTone === 'green' ? 'bg-[#dcf8e8] text-[#087a45]' : row.turnoverTone === 'slate' ? 'bg-slate-100 text-slate-500' : 'bg-[#fff1c8] text-[#a96600]'}>{row.turnoverLabel}</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </>
          ) : null}
        </div>
      </div>

      {selected ? (
        <Modal title="Employee Profile" onClose={() => setSelected(null)}>
          <div className="flex items-center gap-3">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-[#5c2d91] to-[#7c3aed] font-bold text-white">{selected.initials}</span>
            <div>
              <p className="text-lg font-bold">{selected.name}</p>
              <p className="text-sm text-slate-500">{selected.email}</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ['Title', selected.jobTitle],
              ['Department', selected.department],
              ['Type', selected.employmentType],
              ['Status', selected.hrStatus],
              ['Hire date', selected.hireLabel],
              ['Manager', selected.managerName],
              ['NPI', selected.npi || '—'],
              ['DEA', selected.deaNumber || '—'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="mt-1 font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {addOpen ? (
        <Modal title="Add Employee" onClose={() => setAddOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              await act(
                {
                  action: 'create-employee',
                  name: fd.get('name'),
                  email: fd.get('email'),
                  jobTitle: fd.get('jobTitle'),
                  department: fd.get('department'),
                  employmentType: fd.get('employmentType'),
                  managerName: fd.get('managerName'),
                  hireDate: fd.get('hireDate'),
                },
                'Employee invited: they set their own password from the emailed invite link'
              );
              setAddOpen(false);
            }}
          >
            <input name="name" required placeholder="Full name" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="email" type="email" required placeholder="Email" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="jobTitle" required placeholder="Job title" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <select name="department" className="h-11 w-full rounded-xl border px-3 text-sm">
              {['Clinical', 'PRP', 'Administrative', 'Case Mgmt', 'Community'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select name="employmentType" className="h-11 w-full rounded-xl border px-3 text-sm">
              <option>Full-Time</option>
              <option>Part-Time</option>
              <option>Contract</option>
            </select>
            <input name="managerName" placeholder="Manager" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="hireDate" type="date" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <PrimaryButton type="submit">Save employee</PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {leaveOpen ? (
        <Modal title="Request Leave" onClose={() => setLeaveOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await act(
                {
                  action: 'request-leave',
                  employee: fd.get('employee'),
                  leaveType: fd.get('leaveType'),
                  dates: fd.get('dates'),
                  days: Number(fd.get('days')),
                  notes: fd.get('notes'),
                },
                'Leave request submitted'
              );
              setLeaveOpen(false);
            }}
          >
            <select name="employee" className="h-11 w-full rounded-xl border px-3 text-sm">
              {employees.map((e) => (
                <option key={e.id}>{e.name}</option>
              ))}
            </select>
            <select name="leaveType" className="h-11 w-full rounded-xl border px-3 text-sm">
              <option>Vacation</option>
              <option>FMLA</option>
              <option>Sick</option>
              <option>Personal</option>
            </select>
            <input name="dates" required placeholder="Mar 20–21, 2026" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="days" type="number" min={1} defaultValue={1} className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="notes" placeholder="Notes" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <PrimaryButton type="submit">Submit request</PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {postOpen ? (
        <Modal title="Post New Position" onClose={() => setPostOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await act(
                {
                  action: 'post-position',
                  title: fd.get('title'),
                  department: fd.get('department'),
                  priority: fd.get('priority'),
                  type: fd.get('type'),
                  salary: fd.get('salary'),
                },
                'Position posted'
              );
              setPostOpen(false);
            }}
          >
            <input name="title" required placeholder="Position title" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <select name="department" className="h-11 w-full rounded-xl border px-3 text-sm">
              {['Clinical', 'PRP', 'Administrative', 'Case Mgmt', 'Community'].map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select name="priority" className="h-11 w-full rounded-xl border px-3 text-sm">
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
            <select name="type" className="h-11 w-full rounded-xl border px-3 text-sm">
              <option>Full-Time</option>
              <option>Part-Time</option>
              <option>Contract</option>
            </select>
            <input name="salary" placeholder="$68k–$82k" className="h-11 w-full rounded-xl border px-3 text-sm" />
            <PrimaryButton type="submit">Post position</PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {payrollConfirm && kpis.nextRun ? (
        <Modal title="Mark pay run complete?" onClose={() => setPayrollConfirm(null)}>
          <p className="text-sm text-slate-600">
            Mark {kpis.nextRun.period} as completed? Gross {currency(kpis.nextRun.gross)} for {kpis.nextRun.employees} employees.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setPayrollConfirm(null)} className="rounded-xl border px-4 py-2 text-sm font-bold">
              Cancel
            </button>
            <PrimaryButton
              onClick={async () => {
                await act({ action: 'run-payroll', id: payrollConfirm }, 'Pay run marked completed (record only — no funds are moved)').catch(() => undefined);
                setPayrollConfirm(null);
              }}
            >
              Mark complete
            </PrimaryButton>
          </div>
        </Modal>
      ) : null}

      {payPreview ? (
        <Modal title={payPreview.status === 'scheduled' ? 'Payroll preview' : 'Payroll details'} onClose={() => setPayPreview(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Period</dt>
              <dd className="font-semibold">{payPreview.period}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Employees</dt>
              <dd className="font-semibold">{payPreview.employees}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Gross</dt>
              <dd className="font-semibold">{currency(payPreview.gross)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Net</dt>
              <dd className="font-semibold text-emerald-600">{currency(payPreview.net)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Taxes</dt>
              <dd>{currency(payPreview.taxes)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Benefits</dt>
              <dd>{currency(payPreview.benefits)}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}

      {benefit ? (
        <Modal title={benefit.plan} onClose={() => setBenefit(null)}>
          <p className="text-sm text-slate-600">{benefit.details}</p>
          <p className="mt-3 text-sm">
            Carrier: <b>{benefit.carrier}</b>
          </p>
          <p className="text-sm">
            Enrolled {benefit.enrolled}/{benefit.eligible}
          </p>
        </Modal>
      ) : null}

      {apps ? (
        <Modal title={`Applications — ${apps.title}`} onClose={() => setApps(null)} wide>
          {apps.applicants.length === 0 ? <p className="text-sm text-slate-500">No applications yet.</p> : null}
          <ul className="space-y-3">
            {apps.applicants.map((a) => (
              <li key={a.id} className="rounded-xl border border-slate-100 p-3">
                <p className="font-bold">{a.name}</p>
                <p className="text-xs text-slate-500">{a.email}</p>
                <p className="mt-1 text-sm">
                  {a.stage} · Applied {a.appliedAt}
                </p>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {interview ? (
        <Modal title={`Schedule interview — ${interview.title}`} onClose={() => setInterview(null)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await act({ action: 'schedule-interview', requisitionId: interview.id, applicantId: fd.get('applicantId') || undefined }, 'Interview scheduled');
              setInterview(null);
            }}
          >
            <select name="applicantId" className="h-11 w-full rounded-xl border px-3 text-sm">
              <option value="">Pipeline (no specific applicant)</option>
              {interview.applicants.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <PrimaryButton type="submit">Schedule</PrimaryButton>
          </form>
        </Modal>
      ) : null}

      {license ? (
        <Modal title="License detail" onClose={() => setLicense(null)}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-slate-500">Clinician</dt>
              <dd className="font-semibold">{license.clinician}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Credential</dt>
              <dd className="font-semibold">{license.credential}</dd>
            </div>
            <div>
              <dt className="text-slate-500">License #</dt>
              <dd>{license.licenseNumber}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Expires</dt>
              <dd>{license.expiresAt}</dd>
            </div>
            <div>
              <dt className="text-slate-500">NPI</dt>
              <dd>{license.npi || '—'}</dd>
            </div>
            <div>
              <dt className="text-slate-500">DEA</dt>
              <dd>{license.deaNumber || '—'}</dd>
            </div>
          </dl>
        </Modal>
      ) : null}

      {depositOpen ? (
        <Modal title="Manage direct deposit" onClose={() => setDepositOpen(false)}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              await act(
                {
                  action: 'direct-deposit',
                  bankName: fd.get('bankName'),
                  accountLast4: fd.get('accountLast4'),
                  routingLast4: fd.get('routingLast4'),
                  percentOnDd: Number(fd.get('percentOnDd')),
                },
                'Direct deposit updated'
              );
              setDepositOpen(false);
            }}
          >
            <input name="bankName" defaultValue={data.deposit?.bankName} className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="accountLast4" defaultValue={data.deposit?.accountLast4} maxLength={4} className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="routingLast4" defaultValue={data.deposit?.routingLast4} maxLength={4} className="h-11 w-full rounded-xl border px-3 text-sm" />
            <input name="percentOnDd" type="number" defaultValue={data.deposit?.percentOnDd ?? 100} className="h-11 w-full rounded-xl border px-3 text-sm" />
            <PrimaryButton type="submit">Save</PrimaryButton>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
