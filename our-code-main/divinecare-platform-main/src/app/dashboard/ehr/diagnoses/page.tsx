'use client';

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Link2, Microscope, Plus, Search, TrendingUp } from 'lucide-react';
import { useClients } from '@/features/clients';
import { useModuleList } from '@/lib/modules/useModuleList';

interface DiagnosisRecord {
  id: string;
  client: string;
  primaryDx: string;
  icd10: string;
  dsmCode: string;
  onset: string;
  severity: string;
  clinician: string;                                            
  status: 'Active' | 'Resolved' | 'Rule-out';
}

const COMMON_DSM5 = [
  { icd: 'F33.0', dsm: '296.31', name: 'Major Depressive Disorder, Mild', group: 'Depressive Disorders' },
  { icd: 'F33.1', dsm: '296.32', name: 'Major Depressive Disorder, Moderate', group: 'Depressive Disorders' },
  { icd: 'F33.2', dsm: '296.33', name: 'Major Depressive Disorder, Severe', group: 'Depressive Disorders' },
  { icd: 'F41.1', dsm: '300.02', name: 'Generalized Anxiety Disorder', group: 'Anxiety Disorders' },
  { icd: 'F40.10', dsm: '300.23', name: 'Social Anxiety Disorder', group: 'Anxiety Disorders' },
  { icd: 'F41.0', dsm: '300.01', name: 'Panic Disorder', group: 'Anxiety Disorders' },
  { icd: 'F43.10', dsm: '309.81', name: 'PTSD, Acute', group: 'Trauma Disorders' },
  { icd: 'F43.12', dsm: '309.81', name: 'PTSD, Chronic', group: 'Trauma Disorders' },
  { icd: 'F31.10', dsm: '296.40', name: 'Bipolar I Disorder', group: 'Bipolar Disorders' },
  { icd: 'F31.81', dsm: '301.13', name: 'Cyclothymic Disorder', group: 'Bipolar Disorders' },
  { icd: 'F10.20', dsm: '303.90', name: 'Alcohol Use Disorder, Severe', group: 'Substance Disorders' },
  { icd: 'F12.20', dsm: '304.30', name: 'Cannabis Use Disorder, Severe', group: 'Substance Disorders' },
  { icd: 'F90.0', dsm: '314.00', name: 'ADHD, Predominantly Inattentive', group: 'Neurodevelopmental' },
  { icd: 'F90.2', dsm: '314.01', name: 'ADHD, Combined Presentation', group: 'Neurodevelopmental' },
  { icd: 'F20.9', dsm: '295.90', name: 'Schizophrenia', group: 'Schizophrenia Spectrum' },
  { icd: 'F25.0', dsm: '295.70', name: 'Schizoaffective Disorder, Bipolar', group: 'Schizophrenia Spectrum' },
  { icd: 'F50.00', dsm: '307.1', name: 'Anorexia Nervosa, Restricting', group: 'Eating Disorders' },
  { icd: 'F50.2', dsm: '307.51', name: 'Bulimia Nervosa', group: 'Eating Disorders' },
  { icd: 'F60.3', dsm: '301.83', name: 'Borderline Personality Disorder', group: 'Personality Disorders' },
  { icd: 'F94.1', dsm: '313.89', name: 'Reactive Attachment Disorder', group: 'Trauma Disorders' },
];

const STATUS_STYLES: Record<DiagnosisRecord['status'], string> = {
  Active: 'bg-blue-50 text-blue-700',
  Resolved: 'bg-blue-100 text-blue-700',
  'Rule-out': 'bg-slate-100 text-slate-600',
};

const SEV_STYLES: Record<string, string> = {
  Mild: 'text-yellow-600',
  Moderate: 'text-orange-600',
  Severe: 'text-red-600',
};

const FALLBACK_CLIENTS = ['No clients yet'];

function formatDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date);
}

export default function DiagnosesPage() {
  const [search, setSearch] = useState('');
  const { clients } = useClients({ search, limit: 50 });
  const [activeTab, setActiveTab] = useState('Client Diagnoses');
  const [dxSearch, setDxSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Resolved' | 'Rule-out'>('All');
  const [showAddDx, setShowAddDx] = useState(false);
  const [records, setRecords, recordList] = useModuleList<DiagnosisRecord>('diagnoses', []);
  const [newDx, setNewDx] = useState({
    client: '',
    icd10: '',
    name: '',
    dsm: '',
    onset: '',
    severity: 'Moderate',
    notes: '',
    status: 'Active' as DiagnosisRecord['status'],
  });

  const clientNames = useMemo(
    () => clients.map((client) => client.name).filter(Boolean),
    [clients]
  );

  useEffect(() => {
    if (recordList.loading) return;

    const derived = clients
      .filter((client) => client.primaryDiagnosis)
      .flatMap((client) => {
        const secondary = client.secondaryDiagnoses
          ?.split(',')
          .map((item) => item.trim())
          .filter(Boolean) ?? [];

        const items: DiagnosisRecord[] = [
          {
            id: `dx-${client.id}-primary`,
            client: client.name,
            primaryDx: client.primaryDiagnosis || '',
            icd10: client.primaryDiagnosisCode || '-',
            dsmCode: client.primaryDiagnosisCode || '-',
            onset: client.assignedSince || new Date().toISOString(),
            severity: client.risk === 'high' ? 'Severe' : client.risk === 'medium' ? 'Moderate' : 'Mild',
            clinician: client.assignedToName || 'Assigned clinician',
            status: 'Active',
          },
        ];

        secondary.forEach((dx, index) => {
          items.push({
            id: `dx-${client.id}-secondary-${index}`,
            client: client.name,
            primaryDx: dx,
            icd10: client.primaryDiagnosisCode || '-',
            dsmCode: client.primaryDiagnosisCode || '-',
            onset: client.assignedSince || new Date().toISOString(),
            severity: client.risk === 'high' ? 'Severe' : 'Moderate',
            clinician: client.assignedToName || 'Assigned clinician',
            status: 'Active',
          });
        });

        return items;
      });

    const seen = new Set(records.map((row) => `${row.client}|${row.icd10}`));
    const extra = derived.filter((row) => !seen.has(`${row.client}|${row.icd10}`));
    if (extra.length === 0) return;
    setRecords((current) => {
      const have = new Set(current.map((row) => `${row.client}|${row.icd10}`));
      const missing = extra.filter((row) => !have.has(`${row.client}|${row.icd10}`));
      return missing.length ? [...missing, ...current] : current;
    });
  }, [clients, records, recordList.loading, setRecords]);

  const filtered = records.filter((record) => {
    const q = search.toLowerCase();
    const matchSearch =
      record.client.toLowerCase().includes(q) ||
      record.icd10.toLowerCase().includes(q) ||
      record.primaryDx.toLowerCase().includes(q);
    const matchStatus = statusFilter === 'All' || record.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const filteredDsm = COMMON_DSM5.filter((item) => {
    const q = dxSearch.toLowerCase();
    return (
      item.name.toLowerCase().includes(q) ||
      item.icd.includes(dxSearch) ||
      item.dsm.includes(dxSearch)
    );
  });

  const groupedDsm = filteredDsm.reduce<Record<string, typeof COMMON_DSM5>>((acc, item) => {
    if (!acc[item.group]) acc[item.group] = [];
    acc[item.group].push(item);
    return acc;
  }, {});

  const clientDxCount = useMemo(() => {
    const map = new Map<string, number>();
    records.forEach((record) => {
      const key = record.primaryDx.split(',')[0].trim();
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [records]);

  const maxPrevalence = Math.max(...[...clientDxCount.values(), 1]);
  const topDx = [...clientDxCount.entries()].sort((a, b) => b[1] - a[1])[0];
  const uniqueDx = new Set(records.map((record) => record.icd10)).size;
  const multiDxClients = new Set(records.map((record) => record.client)).size;
  const newThisMonth = records.filter(
    (record) => new Date(record.onset).getMonth() === new Date().getMonth()
  ).length;

  const stats = [
    { label: 'Unique Active Dx', value: String(uniqueDx), icon: 'microscope', color: '#6868D0' },
    {
      label: 'Most Prevalent',
      value: topDx?.[0]?.split(' (')[0] || 'Clinical mix',
      icon: 'trending',
      color: '#6868D0',
      sub: topDx ? `${topDx[0]} - ${topDx[1]} entries` : 'From live client records',
    },
    { label: 'New This Month', value: String(newThisMonth), icon: 'plus', color: '#D4A017' },
    { label: 'Multi-Dx Clients', value: String(multiDxClients), icon: 'link', color: '#ea580c', sub: 'From active roster' },
  ];

  const handleAddDx = () => {
    if (!newDx.client || !newDx.icd10) return;
    const record: DiagnosisRecord = {
      id: `D${String(records.length + 1).padStart(3, '0')}`,
      client: newDx.client,
      primaryDx: newDx.name,
      icd10: newDx.icd10,
      dsmCode: newDx.dsm,
      onset: newDx.onset || new Date().toISOString().slice(0, 10),
      severity: newDx.severity,
            clinician: clients.find((c) => c.name === newDx.client)?.assignedToName || 'Assigned clinician',
      status: newDx.status,
    };
    setRecords((prev) => [record, ...prev]);
    setShowAddDx(false);
    setNewDx({
      client: '',
      icd10: '',
      name: '',
      dsm: '',
      onset: '',
      severity: 'Moderate',
      notes: '',
      status: 'Active',
    });
  };

  const roster = clientNames.length > 0 ? clientNames : FALLBACK_CLIENTS;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Diagnosis Management</h1>
          <p className="text-slate-500 text-sm mt-1">
            Diagnosis foundation and code tracking from live client records
          </p>
        </div>
        <button
          onClick={() => setShowAddDx(true)}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-all"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
        >
          + Add Diagnosis
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${stat.color}18` }}>
              {stat.icon === 'microscope' && <Microscope size={20} style={{ color: stat.color }} />}
              {stat.icon === 'trending' && <TrendingUp size={20} style={{ color: stat.color }} />}
              {stat.icon === 'plus' && <Plus size={20} style={{ color: stat.color }} />}
              {stat.icon === 'link' && <Link2 size={20} style={{ color: stat.color }} />}
            </div>
            <p className="text-2xl font-semibold mt-2" style={{ color: stat.color }}>{stat.value}</p>
            <p className="text-xs font-semibold text-slate-700 mt-0.5">{stat.label}</p>
            {'sub' in stat && stat.sub && <p className="text-xs text-slate-400 mt-0.5">{stat.sub}</p>}
          </div>
        ))}
      </div>

      <div className="flex gap-1 bg-white rounded-xl border border-slate-200/80 shadow-sm p-1.5 w-fit">
        {['Client Diagnoses', 'Prevalence', 'DSM-5 Reference'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              activeTab === tab ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            style={activeTab === tab ? { background: '#6868D0' } : {}}
          >
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Client Diagnoses' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-50 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by client, ICD-10, or diagnosis..."
                className="w-full border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {(['All', 'Active', 'Resolved', 'Rule-out'] as const).map((status) => (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                    statusFilter === status ? 'text-white' : 'text-slate-500 bg-slate-100 hover:bg-slate-200'
                  }`}
                  style={statusFilter === status ? { background: '#6868D0' } : {}}
                >
                  {status}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xs text-slate-400 uppercase">
                  <th className="text-left px-5 py-3 font-semibold">Client</th>
                  <th className="text-left px-5 py-3 font-semibold">Diagnosis</th>
                  <th className="text-left px-5 py-3 font-semibold">ICD-10</th>
                  <th className="text-left px-5 py-3 font-semibold">DSM-5</th>
                  <th className="text-left px-5 py-3 font-semibold">Onset</th>
                  <th className="text-left px-5 py-3 font-semibold">Severity</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                  <th className="text-left px-5 py-3 font-semibold">Clinician</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                        >
                          {record.client[0]}
                        </div>
                        <span className="text-sm font-medium text-slate-900">{record.client}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700 max-w-xs">{record.primaryDx}</td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{record.icd10}</span>
                    </td>
                    <td className="px-5 py-3 text-xs text-slate-500">{record.dsmCode}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{formatDate(record.onset)}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold ${SEV_STYLES[record.severity] || 'text-slate-600'}`}>
                        {record.severity}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[record.status]}`}>
                        {record.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{record.clinician}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <div className="py-12 text-center text-slate-400">No diagnosis records match the current filters.</div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'Prevalence' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-6">
          <h3 className="font-semibold text-slate-900 mb-6">Diagnosis Prevalence - Active Caseload</h3>
          <div className="space-y-4">
            {[...clientDxCount.entries()].sort((a, b) => b[1] - a[1]).map(([dx, count], index) => {
              const colors = ['#6868D0', '#6868D0', '#6868D0', '#ea580c', '#D4A017', '#0891B2', '#DC2626', '#9CA3AF'];
              const color = colors[index % colors.length];
              return (
              <div key={dx} className="flex items-center gap-4">
                <span className="text-sm font-semibold text-slate-700 w-28 flex-shrink-0 truncate" title={dx}>{dx}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="h-4 rounded-full transition-all duration-500 flex items-center justify-end pr-2"
                    style={{ width: `${(count / maxPrevalence) * 100}%`, background: color }}
                  >
                    <span className="text-xs text-white font-bold">{count}</span>
                  </div>
                </div>
                <span className="text-sm text-slate-500 w-16 text-right">
                  {Math.round((count / Math.max(records.length, 1)) * 100)}%
                </span>
              </div>
              );
            })}
            {clientDxCount.size === 0 && (
              <p className="text-sm text-slate-400">No saved diagnoses yet. Add diagnoses from the live roster to compute prevalence.</p>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-6">
            Based on the current client roster. Clients may have multiple diagnoses.
          </p>
        </div>
      )}

      {activeTab === 'DSM-5 Reference' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-50">
            <div className="relative">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={dxSearch}
                onChange={(e) => setDxSearch(e.target.value)}
                placeholder="Search by name, ICD-10, or DSM-5 code..."
                className="w-full sm:w-80 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>
          <div className="p-5 space-y-5">
            {Object.entries(groupedDsm).map(([group, dxList]) => (
              <div key={group}>
                <p className="text-xs font-bold text-slate-400 uppercase mb-2">{group}</p>
                <div className="space-y-1.5">
                  {dxList.map((item) => (
                    <button
                      key={item.icd}
                      type="button"
                      className="flex w-full items-center justify-between rounded-xl border border-slate-50 px-3 py-3 text-left transition-all hover:border-slate-200 hover:bg-slate-50 group"
                      onClick={() => {
                        setNewDx((prev) => ({ ...prev, icd10: item.icd, name: item.name, dsm: item.dsm }));
                        setShowAddDx(true);
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-16 rounded bg-blue-50 px-2 py-0.5 text-center text-xs font-bold text-blue-700">
                          {item.icd}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-slate-800">{item.name}</p>
                          <p className="text-xs text-slate-400">DSM-5: {item.dsm}</p>
                        </div>
                      </div>
                      <span className="text-xs text-blue-600 opacity-0 transition-opacity font-semibold group-hover:opacity-100">
                        + Assign
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAddDx && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg shadow-clinic-md">
            <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Add Diagnosis</h2>
              <button onClick={() => setShowAddDx(false)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">
                x
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Client *</label>
                <select
                  value={newDx.client}
                  onChange={(e) => setNewDx((prev) => ({ ...prev, client: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select client...</option>
                  {roster.map((clientName) => (
                    <option key={clientName} value={clientName}>
                      {clientName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">ICD-10 Code *</label>
                  <input
                    value={newDx.icd10}
                    onChange={(e) => setNewDx((prev) => ({ ...prev, icd10: e.target.value }))}
                    placeholder="e.g. F33.1"
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">DSM-5 Code</label>
                  <input
                    value={newDx.dsm}
                    onChange={(e) => setNewDx((prev) => ({ ...prev, dsm: e.target.value }))}
                    placeholder="e.g. 296.32"
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Diagnosis Name *</label>
                <input
                  value={newDx.name}
                  onChange={(e) => setNewDx((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Full diagnostic name..."
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Onset Date</label>
                  <input
                    type="date"
                    value={newDx.onset}
                    onChange={(e) => setNewDx((prev) => ({ ...prev, onset: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Severity</label>
                  <select
                    value={newDx.severity}
                    onChange={(e) => setNewDx((prev) => ({ ...prev, severity: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option>Mild</option>
                    <option>Moderate</option>
                    <option>Severe</option>
                    <option>Unspecified</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Status</label>
                  <select
                    value={newDx.status}
                    onChange={(e) => setNewDx((prev) => ({ ...prev, status: e.target.value as DiagnosisRecord['status'] }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    <option>Active</option>
                    <option>Rule-out</option>
                    <option>Resolved</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Clinical Notes</label>
                <textarea
                  value={newDx.notes}
                  onChange={(e) => setNewDx((prev) => ({ ...prev, notes: e.target.value }))}
                  placeholder="Additional clinical notes, differential considerations..."
                  rows={2}
                  className="w-full resize-none border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleAddDx}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                  style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}
                >
                  Add Diagnosis
                </button>
                <button
                  onClick={() => setShowAddDx(false)}
                  className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
