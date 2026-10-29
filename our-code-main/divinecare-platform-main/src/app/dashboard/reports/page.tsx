'use client';
import { useEffect, useMemo, useState } from 'react';
import { Download, Printer, ClipboardList, CheckCircle2, DollarSign, XCircle, CalendarDays, Clock, TrendingDown, X } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { AdminVendorLink } from '@/components/drfirst/AdminVendorLink';
import { fetchEhrProgressNotes } from '@/features/clients/api/clientsApi';
import { fetchAppointments } from '@/features/appointments';
import { fetchClaims } from '@/features/billing/claimsApi';
import { OperationalReports } from '@/components/billing/OperationalReports';
import { downloadTextFile, toCsv } from '@/lib/browser/downloadFile';

const TABS = ['Clinical Outcomes', 'HEDIS Measures', 'Financial', 'Utilization', 'Medications'];

// --- Clinical Outcomes Data ---
const PHQ9_TREND: { month: string; avg: number }[] = [];
const GAD7_TREND: { month: string; avg: number }[] = [];

const OUTCOME_STATS = [
  { label: 'Avg PHQ-9 Reduction', value: '—', sub: 'No saved scores yet', color: '#6868D0', trend: '—', up: true },
  { label: 'Treatment Response Rate', value: '—', sub: 'No saved scores yet', color: '#6868D0', trend: '—', up: true },
  { label: 'Remission Rate', value: '—', sub: 'No saved scores yet', color: '#D4A017', trend: '—', up: true },
  { label: 'Avg Sessions to Response', value: '—', sub: 'No saved scores yet', color: '#ea580c', trend: '—', up: true },
];

const CLIENT_OUTCOMES: {
  name: string;
  diagnosis: string;
  phq9Start: number;
  phq9Now: number;
  gad7Start: number;
  gad7Now: number;
  sessions: number;
  status: string;
  trend: string;
}[] = [];

// --- HEDIS ---
const HEDIS_MEASURES = [
  { code: 'FUH', name: 'Follow-Up After Hospitalization for Mental Illness', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
  { code: 'FUM', name: 'Follow-Up After ED Visit for Mental Illness', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
  { code: 'AMR', name: 'Antidepressant Medication Management — 84-Day', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
  { code: 'SAA', name: 'Adherence to Antipsychotic Medications for Schizophrenia', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
  { code: 'ADD-E', name: 'Initiation of AOD Treatment — Engagement', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
  { code: 'SMC', name: 'Behavioral Health Risk Assessment', rate: 0, benchmark: 0, target: 0, status: 'No saved rate' },
];

// --- Financial ---
const REVENUE_BY_PAYER: Array<{ payer: string; revenue: number; pct: number; claims: number; approved: number }> = [];

const REVENUE_TREND: Array<{ month: string; revenue: number }> = [];

// --- Utilization ---
const UTILIZATION_DATA: Array<{ service: string; sessions: number; hrs: number; clinicians: number; clients: number }> = [];

// Simple bar chart component
function MiniBarChart({ data, valueKey, labelKey, color }: { data: any[]; valueKey: string; labelKey: string; color: string }) {
  if (!data.length) {
    return <p className="text-sm text-slate-500">No saved scores yet.</p>;
  }
  const max = Math.max(...data.map(d => d[valueKey]));
  return (
    <div className="flex items-end gap-2 h-32">
      {data.map((d, i) => {
        const pct = (d[valueKey] / max) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <span className="text-xs text-slate-500 font-medium" style={{ fontSize: 10 }}>{d[valueKey]}</span>
            <div className="w-full rounded-t-md transition-all" style={{ height: `${pct}%`, backgroundColor: color, minHeight: 4 }} />
            <span className="text-xs text-slate-400" style={{ fontSize: 10 }}>{d[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

function TrendLine({ data, valueKey, color }: { data: any[]; valueKey: string; labelKey?: string; color: string }) {
  if (!data.length) {
    return <p className="text-sm text-slate-500">No saved scores yet.</p>;
  }
  const max = Math.max(...data.map(d => d[valueKey]));
  const min = Math.min(...data.map(d => d[valueKey]));
  const range = max - min || 1;
  const W = 280, H = 80;
  const pts = data.map((d, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - ((d[valueKey] - min) / range) * H;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" points={pts} />
      {data.map((d, i) => {
        const x = (i / (data.length - 1)) * W;
        const y = H - ((d[valueKey] - min) / range) * H;
        return <circle key={i} cx={x} cy={y} r="3.5" fill={color} />;
      })}
    </svg>
  );
}

const MED_CLASSES: Array<{
  id: string; label: string; color: string; bg: string; count: number; avgDose: string;
  adherence: number; refillsMTD: number; medications: string[]; diagnoses: string[];
  patients: Array<{ name: string; med: string; prescriber: string; lastFill: string; nextFill: string; adherence: number; refillsDue: boolean }>;
}> = [];
export default function ReportsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const visibleTabs = useMemo(() => {
    if (role === 'FRONT_DESK') return ['Utilization'];
    if (role === 'BILLING') return ['Financial'];
    if (role === 'HR') return [] as string[];
    if (role === 'OFFICE_MANAGER') return ['Utilization'];
    return TABS;
  }, [role]);
  const [activeTab, setActiveTab] = useState('Clinical Outcomes');
  const [exportOpen, setExportOpen] = useState(false);
  const [selectedMedClass, setSelectedMedClass] = useState<string | null>(null);
  const [medSearch, setMedSearch] = useState('');
  const [exportFormat, setExportFormat] = useState<'PDF' | 'Excel' | 'CSV'>('CSV');
  const [exportType, setExportType] = useState('Full Outcomes Report');
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const { clients } = useClients();
  const [live, setLive] = useState({
    notes: 0,
    unsigned: 0,
    appointments: 0,
    completed: 0,
    noShows: 0,
    claims: 0,
    paid: 0,
    denied: 0,
    billedCents: 0,
  });

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      fetchEhrProgressNotes(),
      fetchAppointments(),
      fetchClaims().catch(() => []),
    ]).then(([notesRes, apptRes, claimsRes]) => {
      if (cancelled) return;
      const notes = notesRes.status === 'fulfilled' ? notesRes.value : { notes: [], stats: { unsigned: 0, today: 0, thisWeek: 0, total: 0 } };
      const appts = apptRes.status === 'fulfilled' ? apptRes.value : [];
      const claims = claimsRes.status === 'fulfilled' ? claimsRes.value : [];
      setLive({
        notes: notes.stats?.total ?? notes.notes.length,
        unsigned: notes.stats?.unsigned ?? notes.notes.filter((n) => (n.workflowStatus || 'Draft') === 'Draft').length,
        appointments: appts.length,
        completed: appts.filter((a) => a.status === 'completed').length,
        noShows: appts.filter((a) => a.status === 'no-show').length,
        claims: claims.length,
        paid: claims.filter((c) => c.status === 'PAID' || c.status === 'ACCEPTED').length,
        denied: claims.filter((c) => c.status === 'DENIED').length,
        billedCents: claims.reduce((sum, c) => sum + (c.amountCents || 0), 0),
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (role === 'HR') return;
    if (visibleTabs.length && !visibleTabs.includes(activeTab)) setActiveTab(visibleTabs[0]);
  }, [role, visibleTabs, activeTab]);

  const liveKpis = useMemo(
    () => [
      {
        label: 'Active clients',
        value: String(clients.length),
        sub: 'Live roster',
        color: '#6868D0',
        trend: `${live.notes} notes`,
        up: true,
      },
      {
        label: 'Appointments on file',
        value: String(live.appointments),
        sub: `${live.completed} completed · ${live.noShows} no-show`,
        color: '#6868D0',
        trend: live.appointments ? `${Math.round((live.completed / live.appointments) * 100)}% seen` : 'No visits yet',
        up: true,
      },
      {
        label: 'Unsigned notes',
        value: String(live.unsigned),
        sub: `${live.notes} total progress notes`,
        color: '#D4A017',
        trend: live.unsigned === 0 ? 'Caught up' : 'Needs review',
        up: live.unsigned === 0,
      },
      {
        label: 'Claims on file',
        value: String(live.claims),
        sub: live.claims
          ? `$${(live.billedCents / 100).toLocaleString()} billed · ${live.denied} denied`
          : 'No claims yet',
        color: '#ea580c',
        trend: live.paid ? `${live.paid} paid/accepted` : 'Drafts only',
        up: live.denied === 0,
      },
    ],
    [clients.length, live]
  );

  const handleExport = () => {
    const rows: Array<Array<unknown>> = [
      ['Report', exportType],
      ['Format', exportFormat],
      ['Range', `${exportFrom || 'start'} – ${exportTo || 'end'}`],
      ['Generated', new Date().toISOString()],
      [],
    ];

    if (exportType === 'Full Outcomes Report' || exportType === 'Custom Range') {
      rows.push(['Live snapshot']);
      rows.push(['Active clients', clients.length]);
      rows.push(['Appointments', live.appointments]);
      rows.push(['Completed visits', live.completed]);
      rows.push(['No-shows', live.noShows]);
      rows.push(['Progress notes', live.notes]);
      rows.push(['Unsigned notes', live.unsigned]);
      rows.push(['Claims', live.claims]);
      rows.push(['Paid/accepted claims', live.paid]);
      rows.push([]);
    }

    if (exportType === 'Full Outcomes Report' || exportType === 'HEDIS Measures Only') {
      rows.push(['HEDIS code', 'Measure', 'Rate', 'Benchmark', 'Target', 'Status']);
      HEDIS_MEASURES.forEach((m) => rows.push([m.code, m.name, m.rate, m.benchmark, m.target, m.status]));
      rows.push([]);
    }

    if (exportType === 'Full Outcomes Report' || exportType === 'Financial Summary') {
      rows.push(['Payer', 'Revenue', 'Share %', 'Claims', 'Approved %']);
      REVENUE_BY_PAYER.forEach((p) => rows.push([p.payer, p.revenue, p.pct, p.claims, p.approved]));
      rows.push(['Live billed cents', live.billedCents]);
      rows.push([]);
    }

    if (exportType === 'Full Outcomes Report' || exportType === 'Utilization Report') {
      rows.push(['Service', 'Sessions', 'Hours', 'Clinicians', 'Clients']);
      UTILIZATION_DATA.forEach((u) => rows.push([u.service, u.sessions, u.hrs, u.clinicians, u.clients]));
      rows.push(['Live appointments', live.appointments, live.completed, '', clients.length]);
    }

    if (exportType === 'Full Outcomes Report') {
      rows.push([]);
      rows.push(['Client', 'Diagnosis', 'PHQ-9 start', 'PHQ-9 now', 'GAD-7 start', 'GAD-7 now', 'Sessions', 'Status', 'Trend']);
      CLIENT_OUTCOMES.forEach((c) =>
        rows.push([c.name, c.diagnosis, c.phq9Start, c.phq9Now, c.gad7Start, c.gad7Now, c.sessions, c.status, c.trend])
      );
    }

    const csv = toCsv(rows);
    const stamp = new Date().toISOString().slice(0, 10);
    if (exportFormat === 'PDF') {
      downloadTextFile(`outcomes-report-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
      window.setTimeout(() => window.print(), 150);
    } else if (exportFormat === 'Excel') {
      downloadTextFile(`outcomes-report-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    } else {
      downloadTextFile(`outcomes-report-${stamp}.csv`, csv, 'text/csv;charset=utf-8');
    }
    setExportOpen(false);
  };

  const shownTab = visibleTabs.includes(activeTab) ? activeTab : (visibleTabs[0] ?? '');

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Outcomes & Reports</h1>
          <p className="text-slate-500 text-sm mt-0.5">Saved practice results. Sample rows are not shown.</p>
          <AdminVendorLink screen="report" />
        </div>
        <div className="flex gap-3 print:hidden" data-print-hide>
          <button
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-300 text-blue-700 bg-blue-50 hover:bg-blue-100"
          >
            <Download size={15} /> Export Report
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm"
            style={{ background: 'linear-gradient(135deg, #6868D0, #1e40af)' }}
          >
            <Printer size={15} /> Print
          </button>
        </div>
      </div>

      {/* Top KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {liveKpis.filter((kpi) => {
          if (role === 'FRONT_DESK') return kpi.label.startsWith('Appointments');
          if (role === 'BILLING') return kpi.label.startsWith('Claims');
          if (role === 'HR') return false;
          if (role === 'OFFICE_MANAGER') return kpi.label.startsWith('Appointments');
          return true;
        }).map(s => (
          <div key={s.label} className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
            <p className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-2">{s.label}</p>
            <p className="text-3xl font-semibold mb-1" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs text-slate-500 mb-2">{s.sub}</p>
            <div className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${s.up ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
              {s.trend}
            </div>
          </div>
        ))}
      </div>

      {role === 'HR' ? (
        <p className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">HR reports are the license and CEU lists in Inbox. Client names, notes, and claims are not included.</p>
      ) : null}
      <OperationalReports role={role} />
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200/80 shadow-sm p-1.5 overflow-x-auto">
        {visibleTabs.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 min-w-fit px-4 py-2.5 rounded-xl text-sm font-semibold transition-all whitespace-nowrap
              ${shownTab === tab ? 'text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100'}`}
            style={shownTab === tab ? { background: '#6868D0' } : {}}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* --- CLINICAL OUTCOMES TAB --- */}
      {shownTab === 'Clinical Outcomes' && (
        <div className="space-y-6">
          {/* PHQ-9 & GAD-7 trend charts */}
          <div className="grid lg:grid-cols-2 gap-6">
            {[
              { title: 'PHQ-9 Average Score — 6 Months', data: PHQ9_TREND, color: '#6868D0', note: 'Moderate depression threshold: 10 | Severe: 20' },
              { title: 'GAD-7 Average Score — 6 Months', data: GAD7_TREND, color: '#ea580c', note: 'Moderate anxiety threshold: 10 | Severe: 15' },
            ].map(chart => (
              <div key={chart.title} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                <h3 className="font-semibold text-slate-900 mb-1">{chart.title}</h3>
                <p className="text-xs text-slate-400 mb-4">{chart.note}</p>
                <div className="flex items-end gap-3 mb-2 h-32">
                  <MiniBarChart data={chart.data} valueKey="avg" labelKey="month" color={chart.color} />
                </div>
                {chart.data.length === 0 ? (
                  <p className="text-sm text-slate-500">No saved scores yet.</p>
                ) : (
                <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                  <span>Start:<strong style={{ color: chart.color }}>{chart.data[0].avg}</strong></span>
                  <span className="text-blue-600 font-semibold">
                    ↓ {(chart.data[0].avg - chart.data[chart.data.length - 1].avg).toFixed(1)} pts improvement
                  </span>
                  <span>Now:<strong style={{ color: chart.color }}>{chart.data[chart.data.length - 1].avg}</strong></span>
                </div>
                )}
              </div>
            ))}
          </div>

          {/* Client Outcomes Table */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200/80 flex items-center justify-between">
              <h3 className="font-semibold text-slate-900">Client Outcomes — PHQ-9 & GAD-7</h3>
              <span className="text-xs text-slate-400">Reporting period: Aug 2025 – Jan 2026</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200/80">
                    {['Client', 'Diagnosis', 'PHQ-9 (Start → Now)', 'GAD-7 (Start → Now)', 'Sessions', 'Status', 'Trend'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {CLIENT_OUTCOMES.map((c, i) => {
                    const phqDelta = c.phq9Start - c.phq9Now;
                    const gadDelta = c.gad7Start - c.gad7Now;
                    return (
                      <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-semibold text-sm text-slate-900">{c.name}</td>
                        <td className="px-5 py-3 text-xs text-slate-500">{c.diagnosis}</td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-slate-600">{c.phq9Start} → <strong className="text-blue-700">{c.phq9Now}</strong></span>
                          <span className="ml-1 text-xs text-blue-600 font-semibold">↓{phqDelta}</span>
                        </td>
                        <td className="px-5 py-3">
                          <span className="text-sm text-slate-600">{c.gad7Start} → <strong className="text-orange-600">{c.gad7Now}</strong></span>
                          <span className="ml-1 text-xs text-blue-600 font-semibold">↓{gadDelta}</span>
                        </td>
                        <td className="px-5 py-3 text-sm text-slate-600">{c.sessions}</td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-semibold ${c.status === 'Graduated' ? 'bg-blue-100 text-blue-700' : 'bg-blue-100 text-blue-700'}`}>
                            {c.status}
                          </span>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`text-xs px-2 py-1 rounded-full font-semibold border ${
                            c.trend === 'Remission' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                            c.trend === 'Improving' ? 'bg-blue-100 text-blue-700 border-blue-200' :
                            'bg-amber-100 text-amber-700 border-amber-200'
                          }`}>
                            {c.trend}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- HEDIS TAB --- */}
      {shownTab === 'HEDIS Measures' && (
        <div className="space-y-4">
          <div className="bg-amber-50 ring-1 ring-inset ring-amber-100 rounded-xl p-4 text-sm text-amber-800">
            <strong>HEDIS 2025 Reporting Period:</strong> January 1, 2025 – December 31, 2025 · Submitted to NCQA · Payer: Medicaid MCO
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-200/80">
              <h3 className="font-semibold text-slate-900">Behavioral Health HEDIS Measures</h3>
              <p className="text-xs text-slate-400 mt-1">Rates shown as percentages. National benchmark = 50th percentile.</p>
            </div>
            <div className="divide-y divide-slate-100">
              {HEDIS_MEASURES.map(m => {
                const exceedsTarget = m.rate >= m.target;
                const exceedsBench = m.rate >= m.benchmark;
                return (
                  <div key={m.code} className="p-5">
                    <div className="flex items-start justify-between mb-3 flex-wrap gap-2">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{m.code}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            m.status === 'Exceeds Target' ? 'bg-blue-50 text-blue-700' :
                            m.status === 'Near Target' ? 'bg-blue-100 text-blue-700' :
                            'bg-amber-100 text-amber-700'
                          }`}>{m.status}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-800">{m.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-2xl font-semibold" style={{ color: exceedsTarget ? '#7878E0' : '#6868D0' }}>{m.rate}%</p>
                        <p className="text-xs text-slate-400">Target: {m.target}% · Benchmark: {m.benchmark}%</p>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="relative h-3 bg-slate-100 rounded-full overflow-visible">
                      <div
                        className="absolute top-0 left-0 h-3 rounded-full transition-all"
                        style={{ width: `${m.rate}%`, background: exceedsTarget ? '#7878E0' : '#6868D0' }}
                      />
                      {/* Benchmark marker */}
                      <div className="absolute top-0 h-3 w-0.5 bg-amber-400" style={{ left: `${m.benchmark}%` }} />
                      {/* Target marker */}
                      <div className="absolute top-0 h-3 w-0.5 bg-blue-500" style={{ left: `${m.target}%` }} />
                    </div>
                    <div className="flex gap-4 mt-1 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Nat&apos;l Benchmark ({m.benchmark}%)</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Target ({m.target}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- FINANCIAL TAB --- */}
      {shownTab === 'Financial' && (
        <div className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            {/* Revenue trend */}
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
              <h3 className="font-semibold text-slate-900 mb-1">Monthly Revenue — Last 6 Months</h3>
              <p className="text-xs text-slate-400 mb-3">Total billed and collected revenue</p>
              <MiniBarChart data={REVENUE_TREND} valueKey="revenue" labelKey="month" color="#6868D0" />
              <div className="flex items-center justify-between text-xs text-slate-500 mt-3 pt-3 border-t border-slate-200/80">
                <div>Claims on file:<strong className="text-slate-900"> {live.claims}</strong></div>
                <div>Paid or accepted:<strong className="text-slate-900"> {live.paid}</strong></div>
                <div>Billed:<strong className="text-blue-700"> ${(live.billedCents / 100).toLocaleString()}</strong></div>
              </div>
            </div>

            {/* Payer mix */}
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
              <h3 className="font-semibold text-slate-900 mb-4">Payer Mix & Approval Rates</h3>
              <div className="space-y-3">
                {REVENUE_BY_PAYER.map(p => (
                  <div key={p.payer}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium text-slate-700">{p.payer}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-slate-500 text-xs">{p.claims} claims · {p.approved}% approved</span>
                        <span className="font-semibold text-slate-900">${p.revenue.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-2.5 rounded-full" style={{ width: `${p.pct}%`, background: 'linear-gradient(90deg, #6868D0, #5555B8)' }} />
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">{p.pct}% of revenue</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Summary financials */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Total Claims', value: String(live.claims), icon: <ClipboardList size={18} className="text-white" />, iconBg: '#6868D0', color: '#6868D0' },
              { label: 'Paid or accepted', value: String(live.paid), icon: <CheckCircle2 size={18} className="text-white" />, iconBg: '#7878E0', color: '#7878E0' },
              { label: 'Billed', value: `$${(live.billedCents / 100).toLocaleString()}`, icon: <DollarSign size={18} className="text-white" />, iconBg: '#D4A017', color: '#D4A017' },
              { label: 'Denied', value: String(live.denied), icon: <XCircle size={18} className="text-white" />, iconBg: '#ea580c', color: '#ea580c' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: s.iconBg }}>
                    {s.icon}
                  </div>
                  <span className="text-2xl font-bold" style={{ color: s.color }}>{s.value}</span>
                </div>
                <p className="text-xs text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* --- UTILIZATION TAB --- */}
      {shownTab === 'Utilization' && (
        <div className="space-y-6">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              { label: 'Appointments on file', value: String(live.appointments), icon: <CalendarDays size={20} className="text-white" />, iconBg: '#6868D0', color: '#6868D0' },
              { label: 'Completed visits', value: String(live.completed), icon: <Clock size={20} className="text-white" />, iconBg: '#6868D0', color: '#6868D0' },
              { label: 'No-shows', value: String(live.noShows), icon: <TrendingDown size={20} className="text-white" />, iconBg: '#ea580c', color: '#ea580c' },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: s.iconBg }}>
                    {s.icon}
                  </div>
                  <span className="text-3xl font-semibold" style={{ color: s.color }}>{s.value}</span>
                </div>
                <p className="text-sm text-slate-500">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
            {role === 'FRONT_DESK' ? (
              <p className="p-5 text-sm text-slate-600">Schedule and no-show counts are above. This report does not include note text.</p>
            ) : (
            <>
            <div className="p-5 border-b border-slate-200/80">
              <h3 className="font-semibold text-slate-900">Service Utilization by CPT Code</h3>
              <p className="text-xs text-slate-400 mt-1">Saved visits only</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200/80">
                    {['Service', 'Sessions', 'Total Hours', 'Clinicians', 'Clients', 'Avg Sessions/Client'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {UTILIZATION_DATA.map((u, i) => (
                    <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-sm font-medium text-slate-800">{u.service}</td>
                      <td className="px-5 py-3 text-sm font-bold text-blue-700">{u.sessions}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">{u.hrs}h</td>
                      <td className="px-5 py-3 text-sm text-slate-600">{u.clinicians}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">{u.clients}</td>
                      <td className="px-5 py-3 text-sm text-slate-600">{(u.sessions / u.clients).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-blue-50 border-t border-slate-200/80">
                    <td className="px-5 py-3 text-sm font-bold text-blue-900">Total</td>
                    <td className="px-5 py-3 text-sm font-bold text-blue-700">{UTILIZATION_DATA.reduce((s, u) => s + u.sessions, 0)}</td>
                    <td className="px-5 py-3 text-sm font-bold text-blue-700">{UTILIZATION_DATA.reduce((s, u) => s + u.hrs, 0)}h</td>
                    <td className="px-5 py-3 text-sm text-slate-600">—</td>
                    <td className="px-5 py-3 text-sm font-bold text-blue-700">—</td>
                    <td className="px-5 py-3 text-sm text-slate-600">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            </>
            )}
          </div>

          {/* Clinician productivity */}
          <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
            <h3 className="font-semibold text-slate-900 mb-4">Clinician Productivity</h3>
            <div className="space-y-4">
              {[].map((c: { name: string; caseload: number; sessions: number; hrs: number; utilization: number }) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{c.name}</p>
                      <p className="text-xs text-slate-400">{c.caseload} clients · {c.sessions} sessions · {c.hrs}h</p>
                    </div>
                    <span className={`text-sm font-bold ${c.utilization >= 80 ? 'text-blue-600' : 'text-amber-600'}`}>{c.utilization}%</span>
                  </div>
                  <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-2.5 rounded-full"
                      style={{ width: `${c.utilization}%`, background: c.utilization >= 80 ? '#7878E0' : '#F59E0B' }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ─── MEDICATIONS TAB ─── */}
      {shownTab === 'Medications' && (() => {
        const activeCls = selectedMedClass ? MED_CLASSES.find(c => c.id === selectedMedClass) : null;
        const filteredPatients = activeCls
          ? activeCls.patients.filter(p => p.name.toLowerCase().includes(medSearch.toLowerCase()) || p.med.toLowerCase().includes(medSearch.toLowerCase()))
          : [];
        const totalPatients = MED_CLASSES.reduce((s, c) => s + c.count, 0);

        return (
          <div className="space-y-6">
            {/* Summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[
                { label: 'Total Patients on Rx', value: totalPatients, color: '#6868D0', bg: '#EEF2FF' },
                { label: 'Medication Classes', value: MED_CLASSES.length, color: '#6868D0', bg: '#EEF0FE' },
                { label: 'Refills Due This Month', value: MED_CLASSES.reduce((s, c) => s + c.refillsMTD, 0), color: '#D97706', bg: '#FFFBEB' },
                { label: 'Avg Adherence Rate', value: `${MED_CLASSES.length ? Math.round(MED_CLASSES.reduce((s, c) => s + c.adherence, 0) / MED_CLASSES.length) : 0}%`, color: '#6868D0', bg: '#F5F3FF' },
              ].map(s => (
                <div key={s.label} className="rounded-xl border p-4" style={{ backgroundColor: s.bg, borderColor: s.color + '30' }}>
                  <p className="text-2xl font-semibold" style={{ color: s.color }}>{s.value}</p>
                  <p className="text-xs text-slate-500 font-semibold mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>

            {/* Class filter grid */}
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-slate-900">Filter by Medication Class</h3>
                {selectedMedClass && (
                  <button onClick={() => setSelectedMedClass(null)}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 transition-all">
                    Clear filter
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {MED_CLASSES.map(cls => {
                  const isActive = selectedMedClass === cls.id;
                  return (
                    <button key={cls.id} onClick={() => setSelectedMedClass(isActive ? null : cls.id)}
                      className={`rounded-xl border-2 p-3 text-left transition-all hover:shadow-md ${isActive ? 'ring-2 ring-offset-1' : ''}`}
                      style={{
                        backgroundColor: isActive ? cls.bg : '#FAFAFA',
                        borderColor: isActive ? cls.color : '#E5E7EB',
                        ['--tw-ring-color' as string]: cls.color,
                      }}>
                      <p className="text-xl font-semibold" style={{ color: cls.color }}>{cls.count}</p>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{cls.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{cls.adherence}% adherence</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Class overview table */}
            {!selectedMedClass && (
              <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200/80">
                  <h3 className="font-semibold text-slate-900">Medication Class Summary</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Click a class above to see individual patient detail</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200/80">
                        {['Class', 'Patients', 'Common Diagnoses', 'Avg Adherence', 'Refills MTD', 'Medications'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {MED_CLASSES.map((cls, idx) => (
                        <tr key={cls.id} className={`hover:bg-slate-50 transition-colors cursor-pointer ${idx % 2 === 1 ? 'bg-slate-50/30' : ''}`}
                          onClick={() => setSelectedMedClass(cls.id)}>
                          <td className="px-5 py-3">
                            <span className="font-bold text-sm px-2.5 py-1 rounded-lg" style={{ backgroundColor: cls.bg, color: cls.color }}>
                              {cls.label}
                            </span>
                          </td>
                          <td className="px-5 py-3 font-semibold text-slate-900">{cls.count}</td>
                          <td className="px-5 py-3">
                            <div className="flex flex-wrap gap-1">
                              {cls.diagnoses.map(d => (
                                <span key={d} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">{d}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${cls.adherence}%`, backgroundColor: cls.adherence >= 85 ? '#6868D0' : cls.adherence >= 70 ? '#D97706' : '#EF4444' }} />
                              </div>
                              <span className="font-bold text-xs" style={{ color: cls.adherence >= 85 ? '#6868D0' : cls.adherence >= 70 ? '#D97706' : '#EF4444' }}>
                                {cls.adherence}%
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3 font-semibold text-slate-700">{cls.refillsMTD}</td>
                          <td className="px-5 py-3 text-xs text-slate-500">{cls.medications.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Patient drill-down */}
            {activeCls && (
              <div className="bg-white rounded-xl border shadow-sm overflow-hidden" style={{ borderColor: activeCls.color + '40' }}>
                <div className="px-5 py-4 border-b flex items-center justify-between flex-wrap gap-3"
                  style={{ backgroundColor: activeCls.bg, borderColor: activeCls.color + '30' }}>
                  <div>
                    <h3 className="font-semibold text-slate-900">{activeCls.label} — Patient Detail</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {activeCls.count} patients · Avg adherence {activeCls.adherence}% · {activeCls.refillsMTD} refills MTD
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {activeCls.diagnoses.map(d => (
                      <span key={d} className="text-xs px-2.5 py-1 rounded-full font-bold" style={{ backgroundColor: activeCls.color + '20', color: activeCls.color }}>
                        {d}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Search within class */}
                <div className="px-5 py-3 border-b border-slate-200/80">
                  <input type="text" value={medSearch} onChange={e => setMedSearch(e.target.value)}
                    placeholder={`Search patients on ${activeCls.label}…`}
                    className="w-full max-w-xs border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200/80">
                        {['Patient', 'Medication', 'Prescriber', 'Last Fill', 'Next Fill', 'Adherence', 'Refill Due'].map(h => (
                          <th key={h} className="text-left px-5 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredPatients.map((p, idx) => (
                        <tr key={idx} className={`hover:bg-slate-50 transition-colors ${idx % 2 === 1 ? 'bg-slate-50/30' : ''}`}>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                                style={{ backgroundColor: activeCls.color }}>
                                {p.name[0]}
                              </div>
                              <span className="font-semibold text-slate-900">{p.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-slate-600 text-xs font-medium">{p.med}</td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{p.prescriber}</td>
                          <td className="px-5 py-3 text-slate-500 text-xs">{p.lastFill}</td>
                          <td className="px-5 py-3 text-xs font-semibold" style={{ color: p.refillsDue ? '#D97706' : '#6868D0' }}>{p.nextFill}</td>
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div className="h-full rounded-full"
                                  style={{ width: `${p.adherence}%`, backgroundColor: p.adherence >= 85 ? '#6868D0' : p.adherence >= 70 ? '#D97706' : '#EF4444' }} />
                              </div>
                              <span className="text-xs font-bold" style={{ color: p.adherence >= 85 ? '#6868D0' : p.adherence >= 70 ? '#D97706' : '#EF4444' }}>
                                {p.adherence}%
                              </span>
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {p.refillsDue
                              ? <span className="text-xs font-bold text-amber-700 bg-amber-100 ring-1 ring-inset ring-amber-100 px-2 py-1 rounded-full">Refill Due</span>
                              : <span className="text-xs text-blue-600 font-semibold">Current</span>}
                          </td>
                        </tr>
                      ))}
                      {filteredPatients.length === 0 && (
                        <tr><td colSpan={7} className="text-center py-8 text-slate-400 text-sm">No patients match the search</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Medications in this class */}
                <div className="px-5 py-3 bg-slate-50 border-t border-slate-200/80">
                  <p className="text-xs font-semibold text-slate-500 mb-2">Medications in this class:</p>
                  <div className="flex flex-wrap gap-2">
                    {activeCls.medications.map(m => (
                      <span key={m} className="text-xs px-2.5 py-1 rounded-full font-medium bg-white border border-slate-200 text-slate-600">{m}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Export Modal */}
      {exportOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-clinic-md w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Export Report</h2>
              <button onClick={() => setExportOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
            </div>
            <div className="space-y-3 mb-5">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Report Type</label>
                <select
                  value={exportType}
                  onChange={(e) => setExportType(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option>Full Outcomes Report</option>
                  <option>HEDIS Measures Only</option>
                  <option>Financial Summary</option>
                  <option>Utilization Report</option>
                  <option>Custom Range</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date Range</label>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                  <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-200" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Format</label>
                <div className="flex gap-2">
                  {(['PDF', 'Excel', 'CSV'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setExportFormat(f)}
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold transition-all ${
                        exportFormat === f
                          ? 'bg-blue-600 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-blue-100 hover:text-blue-700'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  {exportFormat === 'PDF'
                    ? 'PDF opens the print dialog; a CSV copy is also downloaded.'
                    : exportFormat === 'Excel'
                      ? 'Excel downloads as CSV for spreadsheet apps.'
                      : 'CSV downloads immediately.'}
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setExportOpen(false)} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button
                onClick={handleExport}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                style={{ background: '#6868D0' }}
              >
                Export {exportFormat}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
