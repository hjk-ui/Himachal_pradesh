'use client';

import { useEffect, useState } from 'react';
import { 
  AlertTriangle, 
  BarChart2, 
  Bell, 
  CheckCircle2, 
  ChevronRight, 
  Filter, 
  HeartHandshake, 
  LineChart, 
  ShieldAlert, 
  Sliders, 
  TrendingDown, 
  TrendingUp, 
  User, 
  X 
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { AssessmentTrends } from '@/components/clinical/AssessmentTrends';
import { apiJson } from '@/lib/api-client';

interface MbcAlert {
  id: string;
  assessmentRecordId: string;
  clientId: string;
  clientName: string;
  instrumentName: string;
  totalScore: number;
  severity: string;
  safetyFlagged: boolean;
  safetyNotes?: string;
  completedAt: string;
  isAcknowledged: boolean;
}

export default function MeasurementBasedCarePage() {
  const { clients } = useClients();
  const [error, setError] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [alerts, setAlerts] = useState<MbcAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Threshold Control State
  const [phq9Threshold] = useState(20);
  const [gad7Threshold] = useState(15);
  const [showThresholdConfig, setShowThresholdConfig] = useState(false);

  // Acknowledgment Modal
  const [ackModalAlert, setAckModalAlert] = useState<MbcAlert | null>(null);
  const [ackNotes, setAckNotes] = useState('');

  useEffect(() => {
    if (clients.length > 0 && !selectedClientId) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, selectedClientId]);

  const loadAlerts = async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ success: boolean; data: MbcAlert[] }>('/api/clinical/mbc/alerts');
      if (res.success && res.data) {
        setAlerts(res.data);
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load records'); } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const handleAcknowledge = async () => {
    if (!ackModalAlert) return;
    setSubmitting(true);
    try {
      await apiJson('/api/clinical/mbc/alerts', {
        method: 'POST',
        body: JSON.stringify({
          assessmentRecordId: ackModalAlert.assessmentRecordId,
          notes: ackNotes,
        }),
      });

      setAckModalAlert(null);
      setAckNotes('');
      loadAlerts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const patientAlerts = alerts.filter(a => !selectedClientId || a.clientId === selectedClientId);
  const pendingAlerts = patientAlerts.filter((a) => !a.isAcknowledged);
  const acknowledgedAlerts = patientAlerts.filter((a) => a.isAcknowledged);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 font-sans">
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-purple-100 text-[#5C2D91]">
              <LineChart size={22} />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Measurement-Based Care (MBC)</h1>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Clinical outcome trajectory monitoring, automated threshold alerts, and risk acknowledgment workflows.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
            <User size={16} className="text-slate-400" />
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className="bg-transparent text-sm font-medium text-slate-800 focus:outline-none"
            >
              <option value="" disabled>Select Patient...</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 6)})
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={() => setShowThresholdConfig(!showThresholdConfig)}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all"
          >
            <Sliders size={15} />
            View Alert Thresholds
          </button>
        </div>
      </div>

      {/* Threshold Config Dropdown Panel */}
      {showThresholdConfig && (
        <div className="bg-purple-50 border border-purple-200 p-5 rounded-2xl space-y-4 animate-fadeIn">
          <h3 className="text-sm font-bold text-purple-900 flex items-center gap-2">
            <Sliders size={16} /> Clinical Alert Thresholds
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div className="bg-white p-3 rounded-xl border border-purple-100 space-y-1">
              <label className="font-bold text-slate-700 block">PHQ-9 Severe Depression Alert Threshold</label>
              <input
                type="number"
                value={phq9Threshold}
                readOnly
                className="w-full p-2 border rounded-lg text-sm font-bold text-[#5C2D91]"
              />
              <p className="text-[11px] text-slate-400">Triggers 'Attention Required' panel when score &ge; threshold.</p>
            </div>
            <div className="bg-white p-3 rounded-xl border border-purple-100 space-y-1">
              <label className="font-bold text-slate-700 block">GAD-7 Severe Anxiety Alert Threshold</label>
              <input
                type="number"
                value={gad7Threshold}
                readOnly
                className="w-full p-2 border rounded-lg text-sm font-bold text-[#5C2D91]"
              />
              <p className="text-[11px] text-slate-400">Triggers 'Attention Required' panel when score &ge; threshold.</p>
            </div>
          </div>
        </div>
      )}

      {showThresholdConfig && <p className="text-sm text-slate-600">C-SSRS: 3 or higher · PCL-5: 60 or higher. Positive safety responses also create alerts.</p>}
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Unacknowledged Risk Alerts</p>
          <h3 className="text-2xl font-extrabold text-red-600 mt-1">{pendingAlerts.length}</h3>
          <p className="text-xs text-slate-500 mt-1">Requires clinician review</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Acknowledged Alerts</p>
          <h3 className="text-2xl font-extrabold text-emerald-600 mt-1">{acknowledgedAlerts.length}</h3>
          <p className="text-xs text-slate-500 mt-1">Logged in audit trail</p>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Active Patient Focus</p>
          <h3 className="text-xl font-bold text-slate-900 mt-1">{selectedClient?.name || 'All Patients'}</h3>
          <p className="text-xs text-slate-500 mt-1">Tracking longitudinal progress</p>
        </div>
      </div>

      {/* ATTENTION REQUIRED PANEL */}
      {pendingAlerts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <ShieldAlert size={20} className="text-red-600" />
            <h2 className="text-base font-bold text-red-900">ATTENTION REQUIRED: High Severity Clinical Alerts</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pendingAlerts.map((al) => (
              <div key={al.id} className="bg-white p-4 rounded-xl border border-red-200 shadow-sm space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-900 text-sm">{al.clientName}</span>
                    <span className="text-[10px] font-extrabold bg-red-100 text-red-700 px-2 py-0.5 rounded uppercase">
                      {al.severity}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-slate-700 mt-1">
                    {al.instrumentName} Total Score: <span className="font-extrabold text-red-600">{al.totalScore}</span>
                  </div>
                  {al.safetyNotes && (
                    <p className="text-xs text-red-800 bg-red-50 p-2 rounded-lg mt-2 font-medium">
                      {al.safetyNotes}
                    </p>
                  )}
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{new Date(al.completedAt).toLocaleDateString()}</span>
                  <button
                    onClick={() => {
                      setAckModalAlert(al);
                      setAckNotes('');
                    }}
                    className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg font-bold transition-colors"
                  >
                    Acknowledge Alert
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AssessmentTrends clientId={selectedClientId} />

      {/* ACKNOWLEDGMENT MODAL */}
      {ackModalAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Acknowledge MBC Safety Alert</h3>
                <p className="text-xs text-slate-500">{ackModalAlert.clientName} — {ackModalAlert.instrumentName}</p>
              </div>
              <button onClick={() => setAckModalAlert(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-red-50 text-red-800 rounded-xl border border-red-200 font-medium">
                <span className="font-bold">Alert Trigger:</span> {ackModalAlert.severity} (Score: {ackModalAlert.totalScore})
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Clinician Response & Safety Action Notes *</label>
                <textarea
                  rows={3}
                  value={ackNotes}
                  onChange={(e) => setAckNotes(e.target.value)}
                  placeholder="Document clinician review, client contact, safety plan review..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setAckModalAlert(null)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                disabled={submitting || !ackNotes.trim()}
                onClick={handleAcknowledge}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-bold transition-all"
              >
                {submitting ? 'Saving Acknowledgment...' : 'Confirm Acknowledgment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
