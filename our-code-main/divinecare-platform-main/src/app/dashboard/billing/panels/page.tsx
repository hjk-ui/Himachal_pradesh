'use client';

import { useState, useMemo } from 'react';
import { Shield, Plus, X, Check, Clock, AlertCircle, ChevronDown, ChevronUp, Edit2, Phone, Settings } from 'lucide-react';

// ─── Types & data ──────────────────────────────────────────────────────────────

type PanelStatus = 'active' | 'pending' | 'credentialing' | 'not_credentialed' | 'closed' | 'terminated';

interface Panel {
  panelId: string; payer: string; payerId: string | null; status: PanelStatus;
  effectiveDate: string | null; contractRenewalDate: string | null;
  credentialingContact: string | null; notes: string; feeSchedule: string | null;
  openToNewClients: boolean;
}

const STATUS_CONFIG: Record<PanelStatus, { label: string; color: string; bg: string; border: string; icon: any }> = {
  active:          { label: 'Active',         color: 'text-green-700',  bg: 'bg-green-50',  border: 'border-green-200', icon: Check },
  pending:         { label: 'Pending',        color: 'text-amber-700',  bg: 'bg-amber-50',  border: 'border-amber-200', icon: Clock },
  credentialing:   { label: 'Credentialing',  color: 'text-blue-700',   bg: 'bg-blue-50',   border: 'border-blue-200',  icon: Clock },
  not_credentialed:{ label: 'Not Credentialed',color: 'text-gray-500',  bg: 'bg-gray-50',   border: 'border-gray-200',  icon: AlertCircle },
  closed:          { label: 'Closed',         color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200',   icon: X },
  terminated:      { label: 'Terminated',     color: 'text-red-800',    bg: 'bg-red-100',   border: 'border-red-300',   icon: X },
};

// ─── Add panel modal ────────────────────────────────────────────────────────────

function AddPanelModal({ onClose, onAdd }: { onClose: () => void; onAdd: (p: Panel) => void }) {
  const [form, setForm] = useState({ payer: '', payerId: '', credentialingContact: '', notes: '' });
  function handleAdd() {
    onAdd({ panelId: 'pan-' + Date.now(), payer: form.payer, payerId: form.payerId || null, status: 'not_credentialed', effectiveDate: null, contractRenewalDate: null, credentialingContact: form.credentialingContact || null, notes: form.notes, feeSchedule: null, openToNewClients: false });
    onClose();
  }
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b">
          <h2 className="font-semibold text-gray-900">Add Insurance Panel</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payer Name *</label>
            <input value={form.payer} onChange={e => setForm(f => ({ ...f, payer: e.target.value }))} placeholder="e.g. Blue Cross Blue Shield" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payer ID / Payor Code</label>
            <input value={form.payerId} onChange={e => setForm(f => ({ ...f, payerId: e.target.value }))} placeholder="5-digit payor ID" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Credentialing Contact</label>
            <input value={form.credentialingContact} onChange={e => setForm(f => ({ ...f, credentialingContact: e.target.value }))} placeholder="Name, number, or email" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
            <textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none" />
          </div>
        </div>
        <div className="flex gap-3 p-5 border-t">
          <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={handleAdd} disabled={!form.payer} className="flex-1 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-40" style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>Add Panel</button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel card ──────────────────────────────────────────────────────────────

function PanelCard({ panel, onStatusChange }: { panel: Panel; onStatusChange: (id: string, status: PanelStatus) => void }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[panel.status];
  const Icon = cfg.icon;

  return (
    <div className={`bg-white rounded-xl border-2 ${cfg.border} transition-all`}>
      <div className="p-5 flex items-start justify-between cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-11 h-11 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0" style={{ background: '#5C2D91' }}>
            {panel.payer.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900">{panel.payer}</div>
            {panel.payerId && <div className="text-xs text-gray-400">Payor ID: {panel.payerId}</div>}
            {panel.feeSchedule && <div className="text-xs text-gray-500 mt-0.5">{panel.feeSchedule}</div>}
          </div>
        </div>
        <div className="flex items-center gap-3 ml-4 flex-shrink-0">
          <div className="text-right">
            <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${cfg.color} ${cfg.bg}`}>
              <Icon size={10} />{cfg.label}
            </span>
            {panel.status === 'active' && (
              <div className={`text-xs mt-1 ${panel.openToNewClients ? 'text-green-600' : 'text-gray-400'}`}>
                {panel.openToNewClients ? 'Open to new clients' : 'Closed panel'}
              </div>
            )}
          </div>
          {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 px-5 pb-5 pt-4 space-y-3">
          {panel.effectiveDate && (
            <div className="flex gap-6 text-sm">
              <div><span className="text-gray-500">Effective: </span><span className="font-medium">{new Date(panel.effectiveDate + 'T00:00:00').toLocaleDateString()}</span></div>
              {panel.contractRenewalDate && <div><span className="text-gray-500">Renewal: </span><span className="font-medium">{new Date(panel.contractRenewalDate + 'T00:00:00').toLocaleDateString()}</span></div>}
            </div>
          )}
          {panel.credentialingContact && (
            <div className="flex items-start gap-2 text-sm">
              <Phone size={13} className="text-gray-400 mt-0.5 flex-shrink-0" />
              <span className="text-gray-600">{panel.credentialingContact}</span>
            </div>
          )}
          {panel.notes && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{panel.notes}</div>
          )}
          <div className="flex gap-2 pt-1">
            <div className="text-xs text-gray-400">Update status:</div>
            {(['active', 'pending', 'credentialing', 'not_credentialed'] as PanelStatus[]).map(s => (
              <button
                key={s}
                onClick={() => onStatusChange(panel.panelId, s)}
                className={`text-xs px-2 py-1 rounded-md border transition-all ${panel.status === s ? `${STATUS_CONFIG[s].color} ${STATUS_CONFIG[s].bg} border-current font-medium` : 'text-gray-500 border-gray-200 hover:border-gray-300'}`}
              >
                {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────────

export default function PanelsPage() {
  const [panels, setPanels] = useState<Panel[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [filterStatus, setFilterStatus] = useState<PanelStatus | 'all'>('all');

  const filtered = useMemo(() =>
    panels.filter(p => filterStatus === 'all' || p.status === filterStatus),
    [panels, filterStatus]
  );

  function handleStatusChange(id: string, status: PanelStatus) {
    setPanels(prev => prev.map(p => p.panelId === id ? { ...p, status } : p));
  }

  const counts = useMemo(() => {
    const active = panels.filter(p => p.status === 'active').length;
    const pending = panels.filter(p => ['pending', 'credentialing'].includes(p.status)).length;
    const open = panels.filter(p => p.status === 'active' && p.openToNewClients).length;
    return { active, pending, open };
  }, [panels]);

  const FILTER_OPTIONS: { v: PanelStatus | 'all'; label: string }[] = [
    { v: 'all', label: 'All' },
    { v: 'active', label: 'Active' },
    { v: 'pending', label: 'Pending' },
    { v: 'credentialing', label: 'Credentialing' },
    { v: 'not_credentialed', label: 'Not Credentialed' },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {showAdd && <AddPanelModal onClose={() => setShowAdd(false)} onAdd={p => setPanels(prev => [...prev, p])} />}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Insurance Panels</h1>
          <p className="text-sm text-gray-500 mt-1">Track credentialing status, fee schedules, and panel availability</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/dashboard/billing/payer-settings" className="flex items-center gap-2 px-4 py-2 rounded-xl border border-gray-200 bg-white text-gray-600 text-sm font-medium hover:bg-gray-50">
            <Settings size={16} /> BH Payer Settings
          </a>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-medium" style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}>
            <Plus size={16} /> Add Panel
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Active Panels', value: counts.active, color: 'text-green-600', icon: Check },
          { label: 'In Progress', value: counts.pending, color: 'text-amber-600', icon: Clock },
          { label: 'Open to New Clients', value: counts.open, color: 'text-purple-600', icon: Shield },
        ].map(({ label, value, color, icon: Icon }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <Icon size={20} className={`${color} mx-auto mb-1`} />
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
            <div className="text-xs text-gray-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {FILTER_OPTIONS.map(f => (
          <button
            key={f.v}
            onClick={() => setFilterStatus(f.v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${filterStatus === f.v ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            style={filterStatus === f.v ? { background: '#5C2D91' } : {}}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="space-y-3">
        {filtered.map(p => (
          <PanelCard key={p.panelId} panel={p} onStatusChange={handleStatusChange} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-gray-400">
          <Shield size={32} className="mx-auto mb-3 opacity-30" />
          <p>No panels in this category</p>
        </div>
      )}
    </div>
  );
}
