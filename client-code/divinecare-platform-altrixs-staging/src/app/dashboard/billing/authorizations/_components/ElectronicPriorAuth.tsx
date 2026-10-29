'use client';

import { useEffect, useState } from 'react';
import { 
  Code, 
  Globe, 
  Plus, 
  RefreshCw,
  CheckCircle2,
  Clock,
} from 'lucide-react';
import {
  Alert, Button, Card, CardHeader, EmptyState, FormField, LoadingState, Modal, StatCard, StatGrid, StatusBadge, Tabs,
  cx, inputClasses, TONE_SOFT,
} from '@/components/ui';
import { useClients } from '@/features/clients';
import { apiJson } from '@/lib/api-client';
import { Icd10CodeChips } from '@/components/clinical/Icd10Picker';
import { STICKY_FIRST_TD, STICKY_FIRST_TH } from '@/features/billing/tableLayout';

interface PriorAuthRecord {
  id: string;
  patientId: string;
  patientName: string;
  memberId: string;
  payerName: string;
  vendor: 'Carelon' | 'Availity' | 'valant';
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

export function ElectronicPriorAuth() {
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
  const [payerName, setPayerName] = useState('');
  const [vendor, setVendor] = useState<'Carelon' | 'Availity'>('Carelon');
  const [cptInput, setCptInput] = useState('');
  const [diagInput, setDiagInput] = useState('');
  const [units, setUnits] = useState('');
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
    const cptCodes = cptInput.split(',').map((s) => s.trim()).filter(Boolean);
    const diagnosisCodes = diagInput.split(',').map((s) => s.trim()).filter(Boolean);
    const requestedUnits = Number(units);
    // Nothing is defaulted: the payer, codes and units come from the person filing the request
    if (!payerName.trim() || !cptCodes.length || !diagnosisCodes.length || !(requestedUnits > 0)) {
      setError('Enter the payer, CPT codes, ICD-10 diagnoses and requested units.');
      return;
    }
    const clientObj = clients.find((c) => c.id === selectedClientId);
    setSubmitting(true);
    try {
      const payload = {
        patientId: selectedClientId,
        patientName: clientObj?.name || 'Selected Patient',
        memberId, payerId, requestId,
        payerName: payerName,
        vendor: vendor,
        cptCodes,
        diagnosisCodes,
        requestedUnits,
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
    <div className="w-full space-y-6">
      {error && <Alert tone="danger">{error}</Alert>}
      {/* Top Header */}
      <Card className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5">
        <div>
          <div className="flex items-center gap-2">
            <span aria-hidden className={cx('flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset', TONE_SOFT.brand)}>
              <Globe size={18} />
            </span>
            <h2 className="text-base font-semibold text-slate-900">Electronic submissions</h2>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Carelon & Availity real-time prior authorization submissions, electronic EDI status checks & authorization tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={handleBatchStatusCheck}
            disabled={loading}
            icon={<RefreshCw className={loading ? 'animate-spin' : ''} />}
          >
            Batch Re-Check Clearinghouse Status
          </Button>
          <Button
            icon={<Plus />}
            onClick={() => { setRequestId(crypto.randomUUID()); setError(null); setIsNewModalOpen(true); }}
          >
            New Prior Auth Submission
          </Button>
        </div>
      </Card>

      <Alert tone="warning">Carelon: {modes.Carelon || "Loading"} · Availity: {modes.Availity || "Loading"}. Demo requests do not create payer authorizations.</Alert>
      {/* Summary Cards */}
      <StatGrid columns={4}>
        <StatCard label="Total Authorizations" value={records.length} />
        <StatCard label="Approved" value={records.filter((r) => r.status === 'APPROVED').length} tone="success" icon={<CheckCircle2 />} />
        <StatCard label="Pending Medical Review" value={records.filter((r) => r.status === 'PENDING_REVIEW').length} tone="warning" icon={<Clock />} />
        <StatCard
          label="Carelon / Availity Live API"
          value={<StatusBadge tone="success" dot>Connected & Syncing</StatusBadge>}
        />
      </StatGrid>

      {/* Main Table */}
      <Card>
        <CardHeader
          title="Authorization Requests Log"
          titleAs="h3"
          actions={
            <Tabs
              variant="pill"
              label="Filter by status"
              controlsPanels={false}
              value={statusFilter}
              onChange={setStatusFilter}
              items={['ALL', 'APPROVED', 'PENDING_REVIEW', 'ADDITIONAL_INFO_NEEDED'].map((st) => ({
                key: st,
                label: st === 'ALL' ? 'All Statuses' : st.replace('_', ' '),
              }))}
            />
          }
        />

        {loading && records.length === 0 ? (
          <LoadingState label="Loading prior authorization records…" />
        ) : filteredRecords.length === 0 ? (
          <EmptyState icon={<Globe />} title="No Prior Authorization Records" description="Submit a new request to Carelon or Availity." />
        ) : (
          <div className="clinic-scroll-x overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <tr>
                  <th scope="col" className={cx('py-3 px-4', STICKY_FIRST_TH)}>Ref # / Vendor</th>
                  <th scope="col" className="py-3 px-4">Patient</th>
                  <th scope="col" className="py-3 px-4">Payer</th>
                  <th scope="col" className="py-3 px-4">CPT Codes</th>
                  <th scope="col" className="py-3 px-4 text-right">Units</th>
                  <th scope="col" className="py-3 px-4">Status</th>
                  <th scope="col" className="py-3 px-4 text-right">Payload</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {filteredRecords.map((r) => (
                  <tr key={r.id} className="group hover:bg-slate-50 transition-colors">
                    <td className={cx('py-3 px-4', STICKY_FIRST_TD)}>
                      <div className="font-semibold text-slate-900 text-xs">{r.demoMode ? "DEMO · " : ""}{r.referenceNumber}</div>
                      <StatusBadge tone="brand" size="sm" className="mt-1">
                        {r.vendor === 'valant' ? 'from Valant' : r.vendor}
                      </StatusBadge>
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800 text-xs">{r.patientName}</div>
                      <span className="text-xs text-slate-500">ID: {r.memberId}</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-medium text-slate-700">{r.payerName}</td>
                    <td className="py-3 px-4 text-xs">
                      {r.cptCodes.map((c) => (
                        <span key={c} className="inline-block bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded mr-1 font-mono text-[11px]">
                          {c}
                        </span>
                      ))}
                    </td>
                    <td className="py-3 px-4 text-right text-xs font-semibold tabular-nums text-slate-900">
                      {r.approvedUnits ? `${r.approvedUnits} / ${r.requestedUnits}` : r.requestedUnits}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge tone={r.status === 'APPROVED' ? 'success' : r.status === 'PENDING_REVIEW' ? 'warning' : 'danger'}>
                        {r.status.replace('_', ' ')}
                      </StatusBadge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button size="sm" variant="ghost" icon={<Code />} onClick={() => setViewPayloadRecord(r)}>
                        View EDI Payload
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* NEW PRIOR AUTH MODAL */}
      {isNewModalOpen && (
        <Modal
          title="New Electronic Prior Authorization"
          onClose={() => setIsNewModalOpen(false)}
          footer={<>
            <Button variant="secondary" onClick={() => setIsNewModalOpen(false)}>Cancel</Button>
            <Button disabled={submitting || !selectedClientId} onClick={handleSubmitNewAuth}>
              {submitting ? 'Transmitting to Clearinghouse…' : `Submit to ${vendor}`}
            </Button>
          </>}
        >
          <p className="text-xs text-slate-500">Carelon / Availity Clearinghouse Direct Engine</p>

          <FormField label="Select Patient">
            <select
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              className={inputClasses}
            >
              <option value="" disabled>Choose patient…</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.id.slice(0, 6)})
                </option>
              ))}
            </select>
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <FormField label="Insurance Member ID">
              <input
                type="text"
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                placeholder="Member ID"
                className={inputClasses}
              />
            </FormField>
            <FormField label="Payer Trading Partner ID" required>
              <input value={payerId} onChange={e => setPayerId(e.target.value)} className={inputClasses} required />
            </FormField>
            <FormField label="Clearinghouse Adapter">
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value as any)}
                className={inputClasses}
              >
                <option value="Carelon">Carelon Behavioral</option>
                <option value="Availity">Availity EDI Realtime</option>
              </select>
            </FormField>
          </div>

          <FormField label="Payer Name">
            <input
              type="text"
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder="Payer name"
              className={inputClasses}
            />
          </FormField>

          <FormField label="CPT Procedure Codes (comma separated)">
            <input
              type="text"
              value={cptInput}
              onChange={(e) => setCptInput(e.target.value)}
              placeholder="CPT codes"
              className={cx(inputClasses, 'font-mono')}
            />
          </FormField>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="mb-1.5 block text-sm font-medium text-slate-700">ICD-10 Diagnoses</p>
              <Icd10CodeChips
                codes={diagInput.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean)}
                onChange={(codes) => setDiagInput(codes.join(', '))}
                clientId={selectedClientId || null}
                requireBillable
                context="bh"
                placeholder="Search ICD-10-CM code or words"
              />
            </div>
            <FormField label="Requested Units">
              <input
                type="number"
                min={1}
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                placeholder="Units"
                className={inputClasses}
              />
            </FormField>
          </div>

          <FormField label="Medical Necessity Rationale">
            <textarea
              rows={2}
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              placeholder="Clinical justification for treatment frequency…"
              className={inputClasses}
            />
          </FormField>
        </Modal>
      )}

      {/* EDI PAYLOAD DRAWER */}
      {viewPayloadRecord && (
        <Modal
          title={viewPayloadRecord.referenceNumber}
          onClose={() => setViewPayloadRecord(null)}
          footer={
            <Button variant="secondary" onClick={() => setViewPayloadRecord(null)}>
              Close Transaction Payload
            </Button>
          }
        >
          <StatusBadge tone="brand" size="sm">EDI 278 Authorization Transaction</StatusBadge>
          <div className="p-3 bg-slate-900 text-emerald-400 font-mono text-[11px] rounded-lg overflow-x-auto">
            <pre>{JSON.stringify(viewPayloadRecord.clearinghousePayload || viewPayloadRecord, null, 2)}</pre>
          </div>

          <Alert tone="brand" icon={false}>
            <span className="font-semibold">Clearinghouse Response:</span> {viewPayloadRecord.message}
          </Alert>
        </Modal>
      )}
    </div>
  );
}
