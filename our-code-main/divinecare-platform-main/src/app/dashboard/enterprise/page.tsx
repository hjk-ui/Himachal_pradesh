'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts';
import { Users, UserCheck, DollarSign, CalendarDays, AlertTriangle, CheckCircle2, Building2, Settings, BarChart3, ArrowLeftRight, MapPin, Plus, X, Sparkles, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { useLocation } from '@/context/LocationContext';

// ─── MD Behavioral Health Practice Locations (Pillar 6 / Practice Identity) ───
const INITIAL_ENTITIES = [
  {
    id: 'bow',
    name: 'MD Behavioral Health — Bowie (Flagship)',
    shortName: 'BOW',
    color: '#6D5AE6',
    bg: '#F5F3FF',
    border: '#DDD6FE',
    soft: '#F8F7FF',
    location: '',
    type: 'Comprehensive Outpatient & PRP Flagship',
    npi: '',
    taxId: '',
    isFlagship: true,
    programs: ['Individual Therapy', 'Group Therapy', 'PRP (COMAR 10.63)', 'Medication Management', 'Crisis Walk-In'],
    payers: ['Maryland Medicaid (Optum Carve-Out)', 'CareFirst BCBS', 'Aetna', 'Cigna', 'Medicare'],
    stats: {
      activeClients: 0,
      staff: 0,
      sessionsThisMonth: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      openClaims: 0,
      denialRate: 0,
      riskAlerts: 0,
      complianceScore: 0,
      avgWaitDays: 0,
      noShowRate: 0,
      noteCompletionRate: 0,
    },
  },
  {
    id: 'ss',
    name: 'MD Behavioral Health — Silver Spring',
    shortName: 'SS',
    color: '#059669',
    bg: '#ECFDF5',
    border: '#A7F3D0',
    soft: '#F0FDF8',
    location: '',
    type: 'Outpatient Mental Health Clinic',
    npi: '',
    taxId: '',
    isFlagship: false,
    programs: ['Individual Therapy', 'Medication Management', 'Telehealth', 'Adolescent Services'],
    payers: ['Maryland Medicaid', 'BCBS', 'UHC', 'Private Pay'],
    stats: {
      activeClients: 0,
      staff: 0,
      sessionsThisMonth: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      openClaims: 0,
      denialRate: 0,
      riskAlerts: 0,
      complianceScore: 0,
      avgWaitDays: 0,
      noShowRate: 0,
      noteCompletionRate: 0,
    },
  },
  {
    id: 'bal',
    name: 'MD Behavioral Health — Baltimore Center',
    shortName: 'BAL',
    color: '#0284C7',
    bg: '#F0F9FF',
    border: '#BAE6FD',
    soft: '#F8FAFC',
    location: '',
    type: 'Urban Outpatient & Community PRP',
    npi: '',
    taxId: '',
    isFlagship: false,
    programs: ['Individual Therapy', 'PRP Off-site', 'Substance Use IOP', 'Peer Support'],
    payers: ['Medicaid MCO', 'Optum MD PBHS', 'Sliding Scale'],
    stats: {
      activeClients: 0,
      staff: 0,
      sessionsThisMonth: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      openClaims: 0,
      denialRate: 0,
      riskAlerts: 0,
      complianceScore: 0,
      avgWaitDays: 0,
      noShowRate: 0,
      noteCompletionRate: 0,
    },
  },
  {
    id: 'lp',
    name: 'MD Behavioral Health — Lexington Park',
    shortName: 'LP',
    color: '#D97706',
    bg: '#FFFBEB',
    border: '#FDE68A',
    soft: '#FFFCF5',
    location: '',
    type: 'Southern Maryland Behavioral Health',
    npi: '',
    taxId: '',
    isFlagship: false,
    programs: ['Individual Therapy', 'Family Therapy', 'Crisis Services', 'PRP'],
    payers: ['Medicaid', 'Tricare', 'CareFirst', 'Medicare'],
    stats: {
      activeClients: 0,
      staff: 0,
      sessionsThisMonth: 0,
      revenueThisMonth: 0,
      revenueLastMonth: 0,
      openClaims: 0,
      denialRate: 0,
      riskAlerts: 0,
      complianceScore: 0,
      avgWaitDays: 0,
      noShowRate: 0,
      noteCompletionRate: 0,
    },
  },
];

function EntityLogo({
  shortName,
  color,
  size = 'sm',
}: {
  shortName: string;
  color: string;
  size?: 'xs' | 'sm' | 'md';
}) {
  const dim = size === 'xs' ? 'h-5 w-5 text-[8px]' : size === 'sm' ? 'h-6 w-6 text-[9px]' : 'h-7 w-7 text-[10px]';
  return (
    <div
      className={`${dim} shrink-0 rounded-md font-black tracking-wide text-white flex items-center justify-center shadow-sm`}
      style={{ backgroundColor: color }}
    >
      {shortName}
    </div>
  );
}

// ─── Cross-location shared staff ──────────────────────────────────────────────
const SHARED_STAFF = [];

// ─── Cross-location referrals ─────────────────────────────────────────────────
const REFERRALS = [];

// ─── Monthly revenue trend ────────────────────────────────────────────────────
const REVENUE_TREND = [];

const SESSION_TREND = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt$(n: number) { return '$' + n.toLocaleString(); }
function pct(n: number) { return n.toFixed(1) + '%'; }

function EntityBadge({ id, size = 'sm' }: { id: string; size?: 'sm' | 'md' }) {
  const e = INITIAL_ENTITIES.find((x) => x.id === id);
  if (!e) return null;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-bold rounded-full ${
        size === 'sm' ? 'text-[10px] px-2 py-0.5' : 'text-xs px-2.5 py-1'
      }`}
      style={{ backgroundColor: e.bg, color: e.color, border: `1px solid ${e.border}` }}
    >
      <EntityLogo shortName={e.shortName} color={e.color} size="xs" />
      {e.shortName}
    </span>
  );
}

function KpiCard({
  label,
  value,
  sub,
  Icon,
  iconBg,
  accent = '#6D5AE6',
  trend,
}: {
  label: string;
  value: string;
  sub?: string;
  Icon: React.ElementType;
  iconBg: string;
  accent?: string;
  trend?: 'up' | 'down' | 'neutral';
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="mb-2.5 flex items-start justify-between gap-2">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ backgroundColor: iconBg }}
        >
          <Icon size={15} style={{ color: accent }} strokeWidth={2.2} />
        </div>
        <span className="text-xl font-black tracking-tight" style={{ color: accent }}>
          {value}
        </span>
      </div>
      <p className="text-sm font-semibold text-slate-800">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p> : null}
      {trend ? (
        <p
          className={`mt-1 text-[11px] font-bold ${
            trend === 'up' ? 'text-emerald-600' : trend === 'down' ? 'text-red-600' : 'text-slate-400'
          }`}
        >
          {trend === 'up' ? '+ ' : trend === 'down' ? '- ' : '— '}vs last month
        </p>
      ) : null}
    </div>
  );
}

export default function EnterprisePage() {
  const { activeLocationId } = useLocation();
  const [activeTab, setActiveTab] = useState<'overview' | 'financials' | 'staff' | 'compliance' | 'referrals'>('overview');
  const [focusEntity, setFocusEntity] = useState<string | null>(null);
  const [entities, setEntities] = useState(INITIAL_ENTITIES);

  // Sync focusEntity with global LocationContext switcher
  useEffect(() => {
    if (activeLocationId === 'all') {
      setFocusEntity(null);
    } else if (activeLocationId === 'bowie') {
      setFocusEntity('bow');
    } else if (activeLocationId === 'ss') {
      setFocusEntity('ss');
    } else if (activeLocationId === 'lex') {
      setFocusEntity('lp');
    } else if (activeLocationId === 'balt') {
      setFocusEntity('bal');
    }
  }, [activeLocationId]);

  // Add Location Modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newLocName, setNewLocName] = useState('');
  const [newLocAddress, setNewLocAddress] = useState('');
  const [newLocCity, setNewLocCity] = useState('');
  const [newLocZip, setNewLocZip] = useState('');
  const [newLocNpi, setNewLocNpi] = useState('');
  const [newLocWaystar, setNewLocWaystar] = useState('');
  const [newLocConnect, setNewLocConnect] = useState('');
  const [newLocFlagship, setNewLocFlagship] = useState(false);

  const totalClients = entities.reduce((s, e) => s + e.stats.activeClients, 0);
  const totalStaff = entities.reduce((s, e) => s + e.stats.staff, 0);
  const totalRevenue = entities.reduce((s, e) => s + e.stats.revenueThisMonth, 0);
  const totalSessions = entities.reduce((s, e) => s + e.stats.sessionsThisMonth, 0);
  const totalAlerts = entities.reduce((s, e) => s + e.stats.riskAlerts, 0);
  const avgCompliance = Math.round(entities.reduce((s, e) => s + e.stats.complianceScore, 0) / entities.length);

  const displayed = focusEntity ? entities.filter((e) => e.id === focusEntity) : entities;

  const handleAddLocationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLocName.trim() || !newLocAddress.trim() || !newLocCity.trim() || !newLocZip.trim()) {
      toast.error('Please enter Location Name, Address, City, and Zip Code');
      return;
    }
    const short = newLocName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'LOC';
    const newId = newLocName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const newEntry = {
      id: newId,
      name: newLocName,
      shortName: short,
      color: '#7C3AED',
      bg: '#F5F3FF',
      border: '#DDD6FE',
      soft: '#F8F7FF',
      location: `${newLocAddress}, ${newLocCity}, MD ${newLocZip}`,
      type: 'Outpatient Behavioral Health Clinic',
      npi: newLocNpi || '',
      taxId: '',
      isFlagship: newLocFlagship,
      programs: ['Individual Therapy', 'Medication Management', 'Telehealth'],
      payers: ['Maryland Medicaid', 'CareFirst BCBS'],
      stats: {
        activeClients: 0,
        staff: 1,
        sessionsThisMonth: 0,
        revenueThisMonth: 0,
        revenueLastMonth: 0,
        openClaims: 0,
        denialRate: 0,
        riskAlerts: 0,
        complianceScore: 100,
        avgWaitDays: 0,
        noShowRate: 0,
        noteCompletionRate: 100,
      },
    };
    setEntities((prev) => [...prev, newEntry]);
    toast.success(`Location ${newLocName} added! Assigned Location NPI: ${newEntry.npi}. Ready for Waystar SFTP & Amazon Connect queues.`);
    setAddModalOpen(false);
    setNewLocName('');
    setNewLocAddress('');
    setNewLocCity('');
    setNewLocZip('');
    setNewLocNpi('');
    setNewLocWaystar('');
    setNewLocConnect('');
    setNewLocFlagship(false);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold text-slate-900">MD Behavioral Health — Practice Overview</h1>
            <span className="rounded-full bg-purple-100 text-purple-800 text-[11px] font-bold px-2.5 py-0.5">
              Platform: Altrixs
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-0.5">
            Group NPI: <strong>1457893210</strong> · TIN: <strong>82-1234567</strong> · Flagship: Bowie, MD
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Entity filter */}
          <button onClick={() => setFocusEntity(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${!focusEntity ? 'text-white border-transparent shadow-sm' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}
            style={!focusEntity ? { background: '#6D5AE6' } : {}}>
            All Locations ({entities.length})
          </button>
          {entities.map((e) => (
            <button key={e.id} onClick={() => setFocusEntity(focusEntity === e.id ? null : e.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-bold border transition-all"
              style={{
                borderColor: focusEntity === e.id ? e.color : e.border,
                color: e.color,
                backgroundColor: focusEntity === e.id ? e.bg : '#fff',
              }}>
              <EntityLogo shortName={e.shortName} color={e.color} size="xs" />
              {e.shortName}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold text-white hover:opacity-90 transition-all shadow-sm"
            style={{ background: '#6D5AE6' }}
          >
            <Plus size={14} /> Add Location
          </button>
        </div>
      </div>

      {/* Enterprise KPIs */}
      {!focusEntity && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard Icon={Users} iconBg="#F3F0FF" label="Total Clients" value={totalClients.toString()} sub="Across all entities" accent="#6D5AE6" trend="up" />
          <KpiCard Icon={UserCheck} iconBg="#ECFDF5" label="Total Staff" value={totalStaff.toString()} sub="FTE across orgs" accent="#059669" trend="up" />
          <KpiCard Icon={DollarSign} iconBg="#F3F0FF" label="Monthly Revenue" value={fmt$(totalRevenue)} sub="All entities combined" accent="#6D5AE6" trend="up" />
          <KpiCard Icon={CalendarDays} iconBg="#ECFDF5" label="Sessions / Mo" value={totalSessions.toString()} sub="Current month" accent="#0D9488" trend="up" />
          <KpiCard Icon={AlertTriangle} iconBg="#FEF2F2" label="Risk Alerts" value={totalAlerts.toString()} sub="Needs review" accent="#DC2626" />
          <KpiCard Icon={CheckCircle2} iconBg="#ECFDF5" label="Avg Compliance" value={pct(avgCompliance)} sub="Documentation score" accent="#059669" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit flex-wrap">
        {([
          { key: 'overview', label: 'Overview' },
          { key: 'financials', label: 'Financials' },
          { key: 'staff', label: 'Staff' },
          { key: 'compliance', label: 'Compliance' },
          { key: 'referrals', label: 'Referrals' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${activeTab === t.key ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ── */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-3 gap-4">
            {displayed.map(entity => (
              <div key={entity.id} className="rounded-2xl border shadow-sm overflow-hidden bg-white"
                style={{ borderColor: entity.border, background: entity.soft }}>
                {/* Entity header */}
                <div className="p-4 border-b" style={{ borderColor: entity.border, background: entity.bg }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <EntityLogo shortName={entity.shortName} color={entity.color} size="sm" />
                        <span className="text-[11px] font-semibold text-slate-500 truncate">{entity.type}</span>
                      </div>
                      <h3 className="font-bold text-slate-900 text-sm leading-snug">{entity.name}</h3>
                      <p className="text-[11px] text-slate-500 mt-1 flex items-center gap-1">
                        <MapPin size={10} className="shrink-0 opacity-70" /> {entity.location}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-lg font-black tracking-tight" style={{ color: entity.color }}>{fmt$(entity.stats.revenueThisMonth)}</p>
                      <p className="text-[10px] text-slate-400">this month</p>
                    </div>
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-2 divide-x divide-y divide-slate-100/80 bg-white/70">
                  {[
                    { label: 'Clients', value: entity.stats.activeClients },
                    { label: 'Staff', value: entity.stats.staff },
                    { label: 'Sessions', value: entity.stats.sessionsThisMonth },
                    { label: 'Open Claims', value: entity.stats.openClaims },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3.5 text-center">
                      <p className="text-base font-black text-slate-900">{value}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Programs */}
                <div className="p-4 border-t bg-white/80" style={{ borderColor: entity.border }}>
                  <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400 mb-2">Programs</p>
                  <div className="flex flex-wrap gap-1.5">
                    {entity.programs.map(p => (
                      <span key={p} className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ backgroundColor: entity.bg, color: entity.color, border: `1px solid ${entity.border}` }}>
                        {p}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Alerts & compliance */}
                <div className="px-4 pb-4 flex items-center gap-3 bg-white/80">
                  {entity.stats.riskAlerts > 0 && (
                    <Link href="/dashboard/alerts"
                      className="flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-lg bg-red-50 text-red-700 ring-1 ring-inset ring-red-100 font-semibold hover:bg-red-100 transition-all">
                      <AlertTriangle size={11} /> {entity.stats.riskAlerts} alert{entity.stats.riskAlerts > 1 ? 's' : ''}
                    </Link>
                  )}
                  <div className="flex items-center gap-1.5 ml-auto">
                    <div className="w-14 bg-slate-100 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full" style={{ width: `${entity.stats.complianceScore}%`, backgroundColor: entity.color }} />
                    </div>
                    <span className="text-[11px] font-bold" style={{ color: entity.color }}>{entity.stats.complianceScore}%</span>
                  </div>
                  <Link href="/dashboard/enterprise"
                    className="text-[11px] font-semibold hover:underline" style={{ color: entity.color }}>
                    Manage →
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {/* Quick actions */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <p className="text-sm font-semibold text-slate-900 mb-3">Enterprise Actions</p>
            <div className="flex flex-wrap gap-3">
              {[
                { label: 'Cross-Entity Report', Icon: BarChart3, href: '/dashboard/reports' },
                { label: 'Staff Deployment', Icon: Users, href: '/dashboard/hr' },
                { label: 'Consolidated Billing', Icon: DollarSign, href: '/dashboard/billing' },
                { label: 'Entity Settings', Icon: Settings, href: '/dashboard/admin' },
                { label: 'Add New Entity', Icon: Building2, href: '/dashboard/admin' },
              ].map(a => (
                <Link key={a.label} href={a.href}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, #6D5AE6, #4F46E5)' }}>
                  <a.Icon size={14} /> {a.label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── FINANCIALS TAB ── */}
      {activeTab === 'financials' && (
        <div className="space-y-5">
          {/* Revenue by entity */}
          <div className="grid lg:grid-cols-3 gap-4">
            {displayed.map(e => {
              const growth = ((e.stats.revenueThisMonth - e.stats.revenueLastMonth) / e.stats.revenueLastMonth * 100).toFixed(1);
              const isUp = parseFloat(growth) > 0;
              return (
                <div key={e.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <EntityLogo shortName={e.shortName} color={e.color} size="sm" />
                    <p className="text-sm font-semibold text-slate-900">{e.name}</p>
                  </div>
                  <p className="text-2xl font-semibold" style={{ color: e.color }}>{fmt$(e.stats.revenueThisMonth)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">This month</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className={`text-xs font-bold ${isUp ? 'text-blue-600' : 'text-red-600'}`}>{isUp ? '↑' : '↓'} {growth}%</span>
                    <span className="text-xs text-slate-400">vs {fmt$(e.stats.revenueLastMonth)} last month</span>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Open Claims</p>
                      <p className="font-semibold text-slate-900">{e.stats.openClaims}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-slate-500">Denial Rate</p>
                      <p className={`font-bold ${e.stats.denialRate > 5 ? 'text-red-600' : 'text-blue-600'}`}>{pct(e.stats.denialRate)}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Revenue trend chart */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <p className="font-semibold text-slate-900 mb-4">Revenue Trend — All Entities</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={REVENUE_TREND} barSize={18} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={v => '$' + (v / 1000) + 'k'} />
                <Tooltip formatter={(v: any) => fmt$(v)} />
                <Legend />
                <Bar dataKey="BOW" name="Bowie (Flagship)" fill="#6D5AE6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="SS" name="Silver Spring" fill="#059669" radius={[4, 4, 0, 0]} />
                <Bar dataKey="BAL" name="Baltimore" fill="#0284C7" radius={[4, 4, 0, 0]} />
                <Bar dataKey="LP" name="Lexington Park" fill="#D97706" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sessions trend */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <p className="font-semibold text-slate-900 mb-4">Sessions Per Month — All Practice Locations</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={SESSION_TREND}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="BOW" name="Bowie" stroke="#6D5AE6" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="SS" name="Silver Spring" stroke="#059669" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="BAL" name="Baltimore" stroke="#0284C7" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="LP" name="Lexington Park" stroke="#D97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── STAFF TAB ── */}
      {activeTab === 'staff' && (
        <div className="space-y-5">
          {/* Per-entity headcount */}
          <div className="grid lg:grid-cols-3 gap-4">
            {displayed.map(e => (
              <div key={e.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                <div className="flex items-center gap-2 mb-3">
                  <EntityLogo shortName={e.shortName} color={e.color} size="sm" />
                  <p className="text-sm font-semibold text-slate-900">{e.name}</p>
                </div>
                <p className="text-3xl font-semibold mb-1" style={{ color: e.color }}>{e.stats.staff}</p>
                <p className="text-xs text-slate-400">Total staff</p>
                <div className="mt-3 text-xs text-slate-600 space-y-1">
                  <p className="flex items-center gap-1.5"><CalendarDays size={11} className="text-slate-400" /> {e.stats.sessionsThisMonth} sessions this month</p>
                  <p className="flex items-center gap-1.5"><Users size={11} className="text-slate-400" /> {e.stats.activeClients} active clients</p>
                  <p className="flex items-center gap-1.5"><BarChart3 size={11} className="text-slate-400" /> {(e.stats.sessionsThisMonth / e.stats.staff).toFixed(0)} sessions per clinician</p>
                </div>
              </div>
            ))}
          </div>

          {/* Shared staff across entities */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80">
              <h2 className="font-semibold text-slate-900">Cross-Entity Staff Assignments</h2>
              <p className="text-xs text-slate-400 mt-0.5">Staff deployed across multiple organizations — FTE allocation shown</p>
            </div>
            <div className="divide-y divide-slate-100">
              {SHARED_STAFF.map((s, i) => (
                <div key={i} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 flex-wrap">
                  <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-sm font-bold text-blue-700 shrink-0">
                    {s.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.role}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.entities.map(eid => {
                      const entity = entities.find(x => x.id === eid) || INITIAL_ENTITIES[0];
                      const fte = (s.fte as any)[eid] || 0.5;
                      return (
                        <div key={eid} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold"
                          style={{ backgroundColor: entity.bg, color: entity.color, border: `1px solid ${entity.border}` }}>
                          <span className="font-semibold">{entity.shortName}</span>
                          <span className="text-slate-500">{Math.round(fte * 100)}% FTE</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-5 py-3 border-t border-slate-200/80 bg-slate-50">
              <Link href="/dashboard/hr" className="text-xs font-semibold text-blue-600 hover:underline">
                Manage all staff →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ── COMPLIANCE TAB ── */}
      {activeTab === 'compliance' && (
        <div className="space-y-4">
          <div className="grid lg:grid-cols-4 gap-4">
            {displayed.map(e => (
              <div key={e.id} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 space-y-4">
                <div className="flex items-center gap-2">
                  <EntityLogo shortName={e.shortName} color={e.color} size="sm" />
                  <p className="text-sm font-semibold text-slate-900 truncate">{e.name}</p>
                </div>
                <div className="text-center py-3">
                  <p className="text-4xl font-semibold" style={{ color: e.stats.complianceScore >= 95 ? '#059669' : '#D97706' }}>{e.stats.complianceScore}%</p>
                  <p className="text-xs text-slate-400 mt-1">Overall compliance score</p>
                  <div className="w-full bg-slate-100 rounded-full h-2 mt-3">
                    <div className="h-2 rounded-full transition-all" style={{ width: `${e.stats.complianceScore}%`, backgroundColor: e.stats.complianceScore >= 95 ? '#059669' : '#D97706' }} />
                  </div>
                </div>
                <div className="space-y-2 text-xs">
                  {[
                    { label: 'Note Completion Rate', value: e.stats.noteCompletionRate, threshold: 90 },
                    { label: 'No-Show Rate', value: 100 - e.stats.noShowRate, threshold: 85, invert: true, rawVal: e.stats.noShowRate },
                    { label: 'Avg Wait Time', value: e.stats.avgWaitDays <= 7 ? 95 : 70, threshold: 85, rawVal: `${e.stats.avgWaitDays} days` },
                  ].map(({ label, value, threshold, rawVal, invert }) => (
                    <div key={label} className="flex items-center gap-2">
                      <span className={value >= threshold ? 'text-blue-500' : 'text-amber-500'}>
                        {value >= threshold ?<CheckCircle2 size={12} />:<AlertTriangle size={12} />}
                      </span>
                      <span className="flex-1 text-slate-600">{label}</span>
                      <span className="font-bold" style={{ color: value >= threshold ? '#059669' : '#D97706' }}>
                        {rawVal !== undefined ? (typeof rawVal === 'string' ? rawVal : pct(rawVal as number)) : pct(value)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Regulatory checklist */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">Regulatory Compliance &amp; Accreditation</h2>
                <p className="text-xs text-slate-400 mt-0.5">COMAR 10.63 · Optum Maryland PBHS · DEA EPCS · CARF</p>
              </div>
              <span className="rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold px-3 py-1">
                All Audits Passing
              </span>
            </div>
            <div className="divide-y divide-slate-100">
              {[
                { item: 'HIPAA Business Associate Agreements & S3 KMS Encryption', status: 'current', entities: ['bow', 'ss', 'bal', 'lp'] },
                { item: 'Clinician State Licenses (MD Board of Physicians / Counselors)', status: 'current', entities: ['bow', 'ss', 'bal', 'lp'] },
                { item: 'Maryland COMAR 10.63 Accreditation & Optum MD PBHS Carve-Out', status: 'current', entities: ['bow', 'bal'] },
                { item: 'DEA EPCS Two-Factor Biometric Attestation (DrFirst Rcopia)', status: 'current', entities: ['bow', 'ss'] },
                { item: 'CARF Behavioral Health Three-Year Accreditation Renewal', status: 'current', entities: ['bow', 'ss'], due: 'CARF-2027' },
                { item: 'Waystar Clearinghouse 837P / 835 SFTP Production EDI Test', status: 'current', entities: ['bow', 'ss', 'bal', 'lp'] },
                { item: 'Annual 42 CFR Part 2 Substance Use Re-disclosure Training', status: 'current', entities: ['bow', 'bal'] },
              ].map((row, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center gap-4 hover:bg-slate-50">
                  <span className={`${row.status === 'current' ? 'text-blue-500' : 'text-amber-500'}`}>
                    {row.status === 'current' ? <CheckCircle2 size={16} />:<AlertTriangle size={16} />}
                  </span>
                  <p className="text-sm text-slate-800 flex-1">{row.item}</p>
                  <div className="flex items-center gap-2">
                    {row.entities.map(eid =><EntityBadge key={eid} id={eid} />)}
                    {row.due && <span className="text-xs text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-full">{row.due}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── REFERRALS TAB ── */}
      {activeTab === 'referrals' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-900">Cross-Location Referrals</h2>
                <p className="text-xs text-slate-400 mt-0.5">Clients moving between locations for specialized step-up / step-down care</p>
              </div>
              <button
                type="button"
                onClick={() => toast.success('Transfer referral form initialized for cross-location intake.')}
                className="text-xs px-4 py-2 rounded-xl text-white font-bold hover:opacity-90 transition-all"
                style={{ background: '#6D5AE6' }}
              >
                + New Referral
              </button>
            </div>
            <div className="divide-y divide-slate-100">
              {REFERRALS.map((r, i) => {
                return (
                  <div key={i} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 flex-wrap">
                    <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center text-sm font-bold text-slate-600 shrink-0">
                      {r.client.split(' ').map((w: string) => w[0]).join('')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{r.client}</p>
                      <p className="text-xs text-slate-500">{r.reason}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{r.date}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <EntityBadge id={r.from} />
                      <span className="text-slate-400 text-sm">→</span>
                      <EntityBadge id={r.to} />
                    </div>
                    <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-bold ${r.status === 'accepted' ? 'bg-blue-50 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                      {r.status === 'accepted' ? <><CheckCircle2 size={11} />Accepted</> : 'Pending'}
                    </span>
                    {r.status === 'pending' && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => toast.success(`Referral for ${r.client} accepted!`)}
                          className="text-xs px-3 py-1 rounded-lg bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-100 font-semibold hover:bg-blue-50"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={() => toast.error(`Referral for ${r.client} declined.`)}
                          className="text-xs px-3 py-1 rounded-lg bg-red-50 text-red-700 ring-1 ring-inset ring-red-100 font-semibold hover:bg-red-100"
                        >
                          Decline
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Care Continuum — Practice Locations */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <h2 className="font-semibold text-slate-900 mb-4">Care Continuum — Location Pathways</h2>
            <div className="flex items-center justify-center gap-4 flex-wrap py-4">
              {[
                { entity: 'lp', label: 'Community Outpatient', desc: 'Crisis Walk-in · Family Therapy · PRP', level: 1 },
                { entity: 'bal', label: 'Urban Community Center', desc: 'PRP Off-site · IOP Placement', level: 2 },
                { entity: 'ss', label: 'Specialty Outpatient', desc: 'Therapy · Adolescent · Telehealth', level: 3 },
                { entity: 'bow', label: 'Bowie Flagship Center', desc: 'Full Psychiatry · COMAR 10.63 PRP', level: 4 },
              ].map(({ entity: eid, label, desc }, idx, arr) => {
                const e = entities.find(x => x.id === eid) || INITIAL_ENTITIES[0];
                return (
                  <div key={eid} className="flex items-center gap-3">
                    <div className="text-center max-w-40">
                      <div className="mx-auto mb-2 flex justify-center">
                        <EntityLogo shortName={e.shortName} color={e.color} size="md" />
                      </div>
                      <p className="text-xs font-semibold text-slate-900">{label}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                    </div>
                    {idx < arr.length - 1 && (
                      <div className="flex flex-col items-center text-slate-300">
                        <ArrowLeftRight size={20} />
                        <span className="text-xs text-slate-400">site transfer</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── ADD LOCATION MODAL (Pillar 6) ── */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-[#6D5AE6]" />
                <h3 className="text-base font-bold text-slate-900">Add Practice Location</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddModalOpen(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleAddLocationSubmit} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700">Location Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. MD Behavioral Health — Bethesda Center"
                  value={newLocName}
                  onChange={(e) => setNewLocName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#6D5AE6] focus:ring-1 focus:ring-[#6D5AE6]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Street Address *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 7315 Wisconsin Ave, Suite 400"
                  value={newLocAddress}
                  onChange={(e) => setNewLocAddress(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#6D5AE6] focus:ring-1 focus:ring-[#6D5AE6]"
                />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-slate-700">City *</label>
                  <input
                    type="text"
                    required
                    placeholder="Bethesda"
                    value={newLocCity}
                    onChange={(e) => setNewLocCity(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#6D5AE6]"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-slate-700">State</label>
                  <input
                    type="text"
                    disabled
                    value="MD"
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500"
                  />
                </div>
                <div className="col-span-1">
                  <label className="block text-xs font-bold text-slate-700">Zip Code *</label>
                  <input
                    type="text"
                    required
                    placeholder="20814"
                    value={newLocZip}
                    onChange={(e) => setNewLocZip(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#6D5AE6]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700">Location NPI (10 digits)</label>
                  <input
                    type="text"
                    maxLength={10}
                    placeholder="1457893299"
                    value={newLocNpi}
                    onChange={(e) => setNewLocNpi(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-[#6D5AE6]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700">Waystar Submitter ID</label>
                  <input
                    type="text"
                    placeholder="ALTRIXS01-BETH"
                    value={newLocWaystar}
                    onChange={(e) => setNewLocWaystar(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs font-mono outline-none focus:border-[#6D5AE6]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700">Amazon Connect Queue Notes</label>
                <input
                  type="text"
                  placeholder="Dedicated extension queue for triage &amp; DID routing"
                  value={newLocConnect}
                  onChange={(e) => setNewLocConnect(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs outline-none focus:border-[#6D5AE6]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="locFlagship"
                  checked={newLocFlagship}
                  onChange={(e) => setNewLocFlagship(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                />
                <label htmlFor="locFlagship" className="text-xs font-semibold text-slate-700">
                  Set as practice flagship facility (overrides Bowie)
                </label>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#6D5AE6] px-4 py-2 text-xs font-bold text-white hover:opacity-90 transition shadow-xs"
                >
                  Save Practice Location
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
