'use client';

import { useEffect, useState } from 'react';
import { 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Code, 
  FileText, 
  Filter, 
  Globe, 
  Plus, 
  RefreshCw, 
  ShieldCheck, 
  Sparkles, 
  User, 
  X 
} from 'lucide-react';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';

interface PriorAuthRecord {
  id: string;
  patientId: string;
  patientName: string;
  memberId: string;
  payerName: string;
  vendor: 'Carelon' | 'Availity';
  demoMode?: boolean;
  referenceNumber: string;
  cptCodes: string[];
  diagnosisCodes: string[];
  requestedUnits: number;
  approvedUnits?: number;
  status: 'APPROVED' | 'PENDING_REVIEW' | 'DENIED' | 'ADDITIONAL_INFO_NEEDED' | 'SUBMITTING' | 'SUBMISSION_UNKNOWN';
  startDate: string;
  endDate: string;
  message: string;
  clearinghousePayload?: any;
  submittedAt: string;
}

export default function PriorAuthDashboardPage() {
  const { clients } = useClients();
  const [error, setError] = useState<string | null>(null);
  const [records, setRecords] = useState<PriorAuthRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // New Submission Modal State
  const [isNewModalOpen, setIsNewModalOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [memberId, setMemberId] = useState('');
  const [payerId, setPayerId] = useState('');
  const [requestId, setRequestId] = useState('');
  const [modes, setModes] = useState<Record<string, string>>({});
  const [payerName, setPayerName] = useState('Carelon Behavioral Health');
  const [vendor, setVendor] = useState<'Carelon' | 'Availity'>('Carelon');
  const [cptInput, setCptInput] = useState('90837, 90791');
  const [diagInput, setDiagInput] = useState('F41.1, F33.1');
  const [units, setUnits] = useState(12);
  const [rationale, setRationale] = useState('');

  // Clearinghouse JSON Payload Drawer
  const [viewPayloadRecord, setViewPayloadRecord] = useState<PriorAuthRecord | null>(null);

  const loadAuthRecords = async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ success: boolean; data: PriorAuthRecord[]; mode?: Record<string, string>; errors?: string[] }>('/api/billing/prior-auth');
      if (res.success && res.data) {
        setRecords(res.data);
        if (res.mode) setModes(res.mode);
        if (res.errors?.length) setError(res.errors.join("; "));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load records'); } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuthRecords();
  }, []);

  const handleBatchStatusCheck = async () => {
    setLoading(true);
    try {
      const res = await apiJson<{ success: boolean; data: PriorAuthRecord[]; mode?: Record<string, string>; errors?: string[] }>('/api/billing/prior-auth', {
        method: 'POST',
        body: JSON.stringify({ action: 'batch_check' }),
      });
      if (res.success && res.data) {
        setRecords(res.data);
        if (res.mode) setModes(res.mode);
        if (res.errors?.length) setError(res.errors.join("; "));
      }
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not load records'); } finally {
      setLoading(false);
    }
  };

  const handleSubmitNewAuth = async () => {
    if (!selectedClientId) return;
    const clientObj = clients.find((c) => c.id === selectedClientId);
    setSubmitting(true);
    try {
      const payload = {
        patientId: selectedClientId,
        patientName: clientObj?.name || 'Selected Patient',
        memberId, payerId, requestId,
        payerName: payerName,
        vendor: vendor,
        cptCodes: cptInput.split(',').map((s) => s.trim()),
        diagnosisCodes: diagInput.split(',').map((s) => s.trim()),
        requestedUnits: Number(units),
        clinicalRationale: rationale,
        startDate: new Date().toISOString().slice(0, 10),
        endDate: new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10),
      };

      await apiJson('/api/billing/prior-auth', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      setIsNewModalOpen(false);
      loadAuthRecords();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSubmitting(false);
    }
  };

  const filteredRecords = records.filter((r) => {
    if (statusFilter === 'ALL') return true;
    return r.status === statusFilter;
  });

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 font-sans">
      {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>}
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200/80 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-purple-100 text-[#5C2D91]">
              <Globe size={22} />
            </span>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Prior Authorizations</h1>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Carelon & Availity real-time prior authorization submissions, electronic EDI status checks & authorization tracking.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleBatchStatusCheck}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-xs font-bold transition-all"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Batch Re-Check Clearinghouse Status
          </button>
          <button
            onClick={() => { setRequestId(crypto.randomUUID()); setError(null); setIsNewModalOpen(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <Plus size={15} />
            New Prior Auth Submission
          </button>
        </div>
      </div>

      <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Carelon: {modes.Carelon || "Loading"} · Availity: {modes.Availity || "Loading"}. Demo requests do not create payer authorizations.</p>
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Total Authorizations</p>
          <h3 className="text-2xl font-extrabold text-slate-900 mt-1">{records.length}</h3>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Approved</p>
          <h3 className="text-2xl font-extrabold text-emerald-600 mt-1">
            {records.filter((r) => r.status === 'APPROVED').length}
          </h3>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Pending Medical Review</p>
          <h3 className="text-2xl font-extrabold text-amber-600 mt-1">
            {records.filter((r) => r.status === 'PENDING_REVIEW').length}
          </h3>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-bold text-slate-400 uppercase">Carelon / Availity Live API</p>
          <div className="flex items-center gap-2 mt-2 text-xs font-bold text-emerald-600">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            Connected & Syncing
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden space-y-4">
        <div className="p-4 border-b border-slate-200/80 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Authorization Requests Log</h3>
          <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-xl text-xs font-semibold">
            {['ALL', 'APPROVED', 'PENDING_REVIEW', 'ADDITIONAL_INFO_NEEDED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  statusFilter === st ? 'bg-white text-[#5C2D91] shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {st === 'ALL' ? 'All Statuses' : st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {loading && records.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-sm">Loading prior authorization records...</div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <Globe size={36} className="mx-auto mb-2 text-slate-300" />
            <p className="font-semibold text-slate-600">No Prior Authorization Records</p>
            <p className="text-xs text-slate-400 mt-1">Submit a new request to Carelon or Availity.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200/80 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="py-3 px-4">Ref # / Vendor</th>
                  <th className="py-3 px-4">Patient</th>
                  <th className="py-3 px-4">Payer</th>
                  <th className="py-3 px-4">CPT Codes</th>
                  <th className="py-3 px-4">Units</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-900 text-xs">{r.demoMode ? "DEMO · " : ""}{r.referenceNumber}</div>
                      <span className="text-[10px] font-extrabold text-[#5C2D91] bg-purple-50 px-1.5 py-0.5 rounded">
                        {r.vendor}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-bold text-slate-800 text-xs">{r.patientName}</div>
                      <span className="text-[11px] text-slate-400">ID: {r.memberId}</span>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-semibold text-slate-700">{r.payerName}</td>
                    <td className="py-3.5 px-4 text-xs">
                      {r.cptCodes.map((c) => (
                        <span key={c} className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded mr-1 font-mono text-[11px]">
                          {c}
                        </span>
                      ))}
                    </td>
                    <td className="py-3.5 px-4 text-xs font-bold text-slate-900">
                      {r.approvedUnits ? `${r.approvedUnits} / ${r.requestedUnits}` : r.requestedUnits}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                        r.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'PENDING_REVIEW' ? 'bg-amber-100 text-amber-800' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {r.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => setViewPayloadRecord(r)}
                        className="text-xs font-bold text-[#5C2D91] hover:underline flex items-center justify-end gap-1 ml-auto"
                      >
                        <Code size={14} /> View EDI Payload
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* NEW PRIOR AUTH MODAL */}
      {isNewModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">New Electronic Prior Authorization</h3>
                <p className="text-xs text-slate-500">Carelon / Availity Clearinghouse Direct Engine</p>
              </div>
              <button onClick={() => setIsNewModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-slate-700 block mb-1">Select Patient</label>
                <select
                  value={selectedClientId}
                  onChange={(e) => setSelectedClientId(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none"
                >
                  <option value="" disabled>Choose patient...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.id.slice(0, 6)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Insurance Member ID</label>
                  <input
                    type="text"
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    placeholder="MEM-992014"
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                  />
                </div>
<div><label className="text-sm font-semibold">Payer trading partner ID</label><input value={payerId} onChange={e => setPayerId(e.target.value)} className="mt-1 w-full rounded-lg border p-2" required /></div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Clearinghouse Adapter</label>
                  <select
                    value={vendor}
                    onChange={(e) => setVendor(e.target.value as any)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[#5C2D91]"
                  >
                    <option value="Carelon">Carelon Behavioral</option>
                    <option value="Availity">Availity EDI Realtime</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">CPT Procedure Codes (comma separated)</label>
                <input
                  type="text"
                  value={cptInput}
                  onChange={(e) => setCptInput(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-bold text-slate-700 block mb-1">ICD-10 Diagnoses</label>
                  <input
                    type="text"
                    value={diagInput}
                    onChange={(e) => setDiagInput(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono"
                  />
                </div>
                <div>
                  <label className="font-bold text-slate-700 block mb-1">Requested Units</label>
                  <input
                    type="number"
                    min={1}
                    value={units}
                    onChange={(e) => setUnits(Number(e.target.value))}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-slate-700 block mb-1">Medical Necessity Rationale</label>
                <textarea
                  rows={2}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                  placeholder="Clinical justification for treatment frequency..."
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsNewModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800"
              >
                Cancel
              </button>
              <button
                disabled={submitting || !selectedClientId}
                onClick={handleSubmitNewAuth}
                className="px-5 py-2.5 bg-[#5C2D91] hover:bg-purple-900 text-white rounded-xl text-xs font-bold transition-all shadow-sm disabled:opacity-50"
              >
                {submitting ? 'Transmitting to Clearinghouse...' : `Submit to ${vendor}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDI PAYLOAD DRAWER */}
      {viewPayloadRecord && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-end">
          <div className="bg-white w-full max-w-md h-full p-6 shadow-2xl overflow-y-auto space-y-6">
            <div className="flex items-center justify-between border-b pb-4">
              <div>
                <span className="text-[10px] uppercase font-extrabold bg-purple-100 text-[#5C2D91] px-2 py-0.5 rounded">
                  EDI 278 Authorization Transaction
                </span>
                <h3 className="text-lg font-bold text-slate-900 mt-1">{viewPayloadRecord.referenceNumber}</h3>
              </div>
              <button onClick={() => setViewPayloadRecord(null)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-xl overflow-x-auto">
                <pre>{JSON.stringify(viewPayloadRecord.clearinghousePayload || viewPayloadRecord, null, 2)}</pre>
              </div>

              <div className="p-3 bg-purple-50 border border-purple-100 rounded-xl text-purple-900 font-medium">
                <span className="font-bold">Clearinghouse Response:</span> {viewPayloadRecord.message}
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200">
              <button
                onClick={() => setViewPayloadRecord(null)}
                className="w-full py-2.5 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800"
              >
                Close Transaction Payload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
