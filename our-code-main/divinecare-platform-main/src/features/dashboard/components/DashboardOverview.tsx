'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Heart,
  MessageSquare,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { Badge } from '@/components/clinic/ui';
import type { DashboardOverview as OverviewData } from '../types';
import type { StaffRole } from '@/types/roles';

const SEV: Record<string, { pill: string; bar: string; avatar: string }> = {
  high: {
    pill: 'bg-rose-50 text-rose-700 ring-rose-100',
    bar: 'bg-rose-500',
    avatar: 'bg-rose-50 text-rose-700',
  },
  medium: {
    pill: 'bg-amber-50 text-amber-700 ring-amber-100',
    bar: 'bg-amber-500',
    avatar: 'bg-amber-50 text-amber-700',
  },
  low: {
    pill: 'bg-blue-50 text-blue-700 ring-blue-100',
    bar: 'bg-blue-500',
    avatar: 'bg-blue-50 text-blue-700',
  },
};

const STAT_TONES = [
  {
    icon: Users,
    shell: 'from-[#E0F2FE] to-white',
    accent: '#2563EB',
    bar: 'from-[#2563EB] to-[#60A5FA]',
  },
  {
    icon: AlertTriangle,
    shell: 'from-[#FFE4E6] to-white',
    accent: '#E11D48',
    bar: 'from-[#E11D48] to-[#FDA4AF]',
  },
  {
    icon: CalendarDays,
    shell: 'from-[#EEF0FE] to-white',
    accent: '#6868D0',
    bar: 'from-[#6868D0] to-[#A3A5F0]',
  },
  {
    icon: MessageSquare,
    shell: 'from-[#FEF3C7] to-white',
    accent: '#D97706',
    bar: 'from-[#D97706] to-[#FBBF24]',
  },
] as const;

type Props = {
  data: OverviewData;
  firstName?: string | null;
  role?: StaffRole | null;
};

const RISK_COLORS = ['#E11D48', '#D97706', '#2563EB'] as const;

export function DashboardOverview({ data, firstName, role }: Props) {
  const [greeting, setGreeting] = useState('Hello');
  const { stats, alerts, appointments, clients, weekly, riskBreakdown } = data;

  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');
  }, []);

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  });

  const displayName = firstName || 'there';
  const isDirector = role === 'DIRECTOR';
  const description = isDirector
    ? `${todayLabel} - Clinical + ops oversight`
    : `${todayLabel} - Clinical priorities for today`;
  const completedAppointments = appointments.filter((appt) => appt.status === 'completed').length;
  const appointmentCompletion =
    appointments.length > 0 ? Math.round((completedAppointments / appointments.length) * 100) : 0;
  const highRiskClients = clients.filter((client) => client.risk === 'high').length;
  const avgMood =
    clients.length > 0
      ? Math.round((clients.reduce((sum, client) => sum + client.mood, 0) / clients.length) * 10) /
        10
      : 0;
  const riskSummary = (['high', 'medium', 'low'] as const).map((risk) => ({
    risk,
    count: clients.filter((client) => client.risk === risk).length,
  }));
  const weeklyMoodAverage =
    weekly.length > 0
      ? Math.round((weekly.reduce((sum, entry) => sum + entry.mood, 0) / weekly.length) * 10) /
        10
      : 0;
  const weeklyActivity = weekly.reduce(
    (sum, entry) => ({
      appointments: sum.appointments + entry.appointments,
      alerts: sum.alerts + entry.alerts,
      checkIns: sum.checkIns + entry.checkIns,
    }),
    { appointments: 0, alerts: 0, checkIns: 0 }
  );

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#d8daf8] bg-gradient-to-r from-[#F4F3FF] to-white px-4 py-2.5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="shrink-0 xl:min-w-[220px]">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#6868D0]">
              {greeting}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold leading-tight text-slate-900">{displayName}</h1>
            <p className="mt-0.5 text-xs font-medium text-slate-500">{description}</p>
          </div>
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-3">
            <div className="relative overflow-hidden rounded-xl border border-white/80 bg-gradient-to-br from-[#EEF0FE] to-white px-3 py-2">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#6868D0] to-[#A3A5F0]" />
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Avg mood</p>
                  <p className="text-xl font-semibold text-slate-900">{avgMood || '-'}</p>
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-[#6868D0]">
                  <Heart size={13} />
                </span>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-white/80 bg-gradient-to-br from-[#FFE4E6] to-white px-3 py-2">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[#E11D48] to-[#FDA4AF]" />
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">High risk</p>
                  <p className="text-xl font-semibold text-slate-900">{highRiskClients}</p>
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-[#E11D48]">
                  <AlertTriangle size={13} />
                </span>
              </div>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-white/80 bg-gradient-to-br from-emerald-50 to-white px-3 py-2">
              <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-600 to-emerald-300" />
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Completed</p>
                  <p className="text-xl font-semibold text-slate-900">{appointmentCompletion}%</p>
                </div>
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-white text-emerald-600">
                  <CheckCircle2 size={13} />
                </span>
              </div>
            </div>
          </div>
          <Link
            href="/dashboard/appointments"
            className="clinic-btn-primary inline-flex h-9 shrink-0 items-center px-3 text-xs"
          >
            Schedule appointment
          </Link>
        </div>
      </section>

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {stats.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-slate-200/80 bg-white px-4 py-8 text-center text-sm text-slate-500 shadow-sm">
            No dashboard metrics available
          </div>
        ) : (
          stats.map((s, i) => {
            const tone = STAT_TONES[i % STAT_TONES.length];
            const Icon = tone.icon;
            return (
              <div
                key={s.label}
                className={`relative overflow-hidden rounded-xl border border-white/80 bg-gradient-to-br ${tone.shell} px-3 py-2.5 shadow-sm`}
              >
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${tone.bar}`} />
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-2xl font-semibold tracking-tight text-[#141C34]">
                      {s.value}
                    </p>
                    <p className="text-[11px] font-medium text-slate-500">{s.delta}</p>
                  </div>
                  <span
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white"
                    style={{ color: tone.accent }}
                  >
                    <Icon size={16} />
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_0.85fr_0.8fr]">
        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)] xl:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-[#EEF0FE]/80 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Weekly mood trend</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Average mood score across the last 7 days
              </p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-[#EEF0FE] px-3 py-1 text-xs font-semibold text-[#6868D0]">
              {weeklyMoodAverage || '-'}
            </span>
          </div>
          <div className="p-4 sm:p-5">
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  Avg mood
                </p>
                <p className="mt-1 text-2xl font-black text-[#141C34]">{weeklyMoodAverage || '-'}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  Check-ins
                </p>
                <p className="mt-1 text-2xl font-black text-[#141C34]">
                  {weeklyActivity.checkIns}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  Alerts
                </p>
                <p className="mt-1 text-2xl font-black text-[#141C34]">
                  {weeklyActivity.alerts}
                </p>
              </div>
            </div>
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weekly}>
                  <defs>
                    <linearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6868D0" stopOpacity={0.34} />
                      <stop offset="95%" stopColor="#6868D0" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
                  />
                  <YAxis
                    domain={[0, 10]}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
                  />
                  <Tooltip
                    cursor={{ stroke: '#C7D2FE', strokeWidth: 1 }}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 16px 32px rgba(20, 28, 52, 0.12)',
                    }}
                    labelStyle={{ color: '#141C34', fontWeight: 700 }}
                  />
                  <Area
                    type="monotone"
                    dataKey="mood"
                    stroke="#6868D0"
                    strokeWidth={3}
                    fill="url(#moodFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-rose-50/70 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Risk mix</h2>
              <p className="mt-0.5 text-xs text-slate-500">Active clients by risk level</p>
            </div>
            <ChevronRight size={16} className="text-slate-400" />
          </div>
          <div className="p-5">
            <div className="relative mx-auto h-[230px] max-w-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={riskBreakdown}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={68}
                    outerRadius={92}
                    paddingAngle={3}
                  >
                    {riskBreakdown.map((slice, index) => (
                      <Cell key={slice.name} fill={slice.fill || RISK_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 16px 32px rgba(20, 28, 52, 0.12)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">
                  Total clients
                </p>
                <p className="mt-1 text-4xl font-black text-[#141C34]">{clients.length}</p>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              {riskBreakdown.map((slice) => {
                const total = clients.length || 1;
                const pct = Math.round((slice.value / total) * 100);
                return (
                  <div key={slice.name} className="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: slice.fill }}
                      />
                      <span className="text-sm font-semibold text-slate-700">{slice.name}</span>
                    </div>
                    <span className="text-sm font-black text-[#141C34]">
                      {slice.value} <span className="text-xs font-semibold text-slate-400">{pct}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-amber-50/70 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Weekly volume</h2>
              <p className="mt-0.5 text-xs text-slate-500">Appointments, check-ins, and alerts</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
              7 days
            </span>
          </div>
          <div className="p-4 sm:p-5">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly} barCategoryGap={18}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: '#94A3B8', fontSize: 12, fontWeight: 600 }}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(104,104,208,0.08)' }}
                    contentStyle={{
                      borderRadius: 16,
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 16px 32px rgba(20, 28, 52, 0.12)',
                    }}
                  />
                  <Bar dataKey="appointments" fill="#6868D0" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="checkIns" fill="#2563EB" radius={[8, 8, 0, 0]} />
                  <Bar dataKey="alerts" fill="#E11D48" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {[
                ['Appointments', weeklyActivity.appointments, '#6868D0'],
                ['Check-ins', weeklyActivity.checkIns, '#2563EB'],
                ['Alerts', weeklyActivity.alerts, '#E11D48'],
              ].map(([label, value, color]) => (
                <div key={String(label)} className="rounded-2xl bg-slate-50 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: String(color) }} />
                    <p className="text-xs font-bold uppercase tracking-[0.08em] text-slate-400">
                      {label}
                    </p>
                  </div>
                  <p className="mt-1 text-lg font-black text-[#141C34]">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)] lg:col-span-1">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-rose-50/60 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Risk alerts</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {alerts.length} unreviewed
              </p>
            </div>
            <Link
              href="/dashboard/alerts"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              View all
            </Link>
          </div>

          <div className="flex-1 divide-y divide-slate-100">
            {alerts.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500">No unreviewed alerts</p>
            ) : (
              alerts.map((alert) => {
                const sev = SEV[alert.severity] ?? SEV.low;
                return (
                  <div key={alert.id} className="relative px-5 py-4 transition hover:bg-slate-50/80">
                    <span className={`absolute bottom-4 left-0 top-4 w-1 rounded-r ${sev.bar}`} />
                    <div className="flex items-start gap-3 pl-3">
                      <ClientAvatar
                        name={alert.clientName}
                        image={alert.clientImage}
                        size="sm"
                        className={alert.clientImage ? '' : sev.avatar}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {alert.clientName}
                          </p>
                          <span className={`clinic-badge uppercase ring-1 ring-inset ${sev.pill}`}>
                            {alert.severity}
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-500">{alert.type}</p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {alert.time} - Mood {alert.mood}/10
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-100 px-5 py-3">
            <Link
              href="/dashboard/alerts"
              className="flex h-9 items-center justify-center rounded-lg text-sm font-semibold text-blue-600 transition hover:bg-blue-50"
            >
              Review all alerts
            </Link>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)] lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-blue-50/70 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Today&apos;s schedule</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">
                {completedAppointments} completed - {appointments.length} total
              </p>
            </div>
            <Link
              href="/dashboard/appointments"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              Manage
            </Link>
          </div>

          <div className="divide-y divide-slate-100">
            {appointments.length === 0 ? (
              <p className="px-5 py-8 text-sm text-slate-500">No appointments scheduled today</p>
            ) : (
              appointments.map((appt) => (
                <div
                  key={appt.id}
                  className={`flex items-center gap-4 px-5 py-4 transition hover:bg-slate-50/80 ${
                    appt.status === 'completed' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="w-20 shrink-0">
                    <p className="text-sm font-semibold tabular-nums text-slate-900">{appt.time}</p>
                    {appt.isVirtual ? (
                      <span className="clinic-badge mt-1 bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100">
                        Virtual
                      </span>
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <ClientAvatar name={appt.clientName} image={appt.clientImage} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {appt.clientName}
                        </p>
                        <p className="truncate text-xs text-slate-500">{appt.type}</p>
                      </div>
                    </div>
                  </div>

                  <span
                    className={`clinic-badge shrink-0 ring-1 ring-inset ${
                      appt.status === 'completed'
                        ? 'bg-slate-100 text-slate-600 ring-slate-200'
                        : 'bg-blue-50 text-blue-700 ring-blue-100'
                    }`}
                  >
                    {appt.status === 'completed' ? 'Done' : 'Upcoming'}
                  </span>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.72fr_1.28fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_48px_rgba(20,28,52,0.08)]">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-black text-slate-900">Clinical performance</h2>
              <p className="mt-0.5 text-xs font-medium text-slate-500">From current client list</p>
            </div>
            <Activity size={18} className="text-[#6868D0]" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            {riskSummary.map((item) => {
              const width = clients.length > 0 ? Math.round((item.count / clients.length) * 100) : 0;
              const color =
                item.risk === 'high' ? '#E11D48' : item.risk === 'medium' ? '#D97706' : '#2563EB';
              return (
                <div key={item.risk} className="rounded-2xl bg-slate-50 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-black uppercase tracking-[0.08em] text-slate-500">
                      {item.risk} risk
                    </p>
                    <p className="text-lg font-black text-[#141C34]">{item.count}</p>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${width}%`, backgroundColor: color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl bg-[#EEF0FE] p-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-[#6868D0]">
                <TrendingUp size={20} />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-500">Average mood score</p>
                <p className="text-2xl font-black text-[#141C34]">{avgMood || '-'}/10</p>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_18px_48px_rgba(20,28,52,0.08)]">
          <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-white to-[#EEF0FE]/80 px-5 py-4">
            <div>
              <h2 className="text-sm font-black text-slate-900">Client wellness overview</h2>
              <p className="mt-0.5 text-xs text-slate-500">Mood, risk level, and check-in streak</p>
            </div>
            <Link
              href="/dashboard/clients"
              className="text-sm font-semibold text-blue-600 hover:text-blue-700"
            >
              View all
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[660px] text-left">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70">
                  {['Client', 'Last check-in', 'Mood', 'Risk', 'Streak', ''].map((h) => (
                    <th
                      key={h || 'action'}
                      className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {clients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-12 text-center text-sm text-slate-500">
                      No clients yet
                    </td>
                  </tr>
                ) : (
                  clients.map((c) => {
                    const sev = SEV[c.risk] ?? SEV.low;
                    const moodPct = Math.max(8, Math.min(100, c.mood * 10));
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-slate-100 last:border-0 transition-colors hover:bg-slate-50/80"
                      >
                        <td className="px-5 py-4">
                          <div className="flex items-center gap-3">
                            <ClientAvatar name={c.name} image={c.image} size="sm" />
                            <span className="text-sm font-semibold text-slate-900">{c.name}</span>
                          </div>
                        </td>
                        <td className="px-5 py-4 text-sm text-slate-600">{c.lastCheckIn}</td>
                        <td className="px-5 py-4">
                          <div className="flex min-w-[120px] items-center gap-2.5">
                            <span className="w-10 text-sm font-semibold tabular-nums text-slate-800">
                              {c.mood}/10
                            </span>
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#6868D0] to-[#2563EB]"
                                style={{ width: `${moodPct}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-4">
                          <span className={`clinic-badge uppercase ring-1 ring-inset ${sev.pill}`}>
                            {c.risk}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          <Badge tone="amber">{c.streak}d streak</Badge>
                        </td>
                        <td className="px-5 py-4 text-right">
                          <Link
                            href={`/dashboard/clients/${c.id}`}
                            className="text-sm font-semibold text-blue-600 hover:text-blue-700"
                          >
                            Open
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
