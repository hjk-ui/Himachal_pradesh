'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  fetchEligibilityChecks,
  runEligibilityCheck,
  type EligibilityCheckRecord,
} from '@/features/ehr/eligibilityApi';
import { OvernightEligibilityCard } from '@/components/eligibility/OvernightEligibilityCard';
import { useAuth } from '@/features/auth/hooks/useAuth';
import { fetchPriorAuths } from '@/features/ehr/priorAuthsApi';
import { CheckCircle2, Shield, Clock, XCircle, Building2 } from 'lucide-react';

type EligibilityStatus = 'Active' | 'Inactive' | 'Pending' | 'Partial' | 'Failed';
type AuthStatus = 'Approved' | 'Pending' | 'Denied' | 'Expired';

interface EligibilityRecord {
  id: string;
  clientId: string;
  client: string;
  insurance: string;
  memberId: string;
  groupNum: string;
  deductible: number;
  deductibleMet: number;
  copay: number;
  oopMax: number;
  oopMet: number;
  status: EligibilityStatus;
  verifiedDate: string;
  coveredServices: string[];
  billingNotes?: string;
  secondaryInsurance?: {
    payer: string;
    memberId: string;
    groupNum?: string;
    cobOrder: 'Secondary' | 'Tertiary';
    status: EligibilityStatus;
    copay?: number;
    verifiedDate: string;
    notes?: string;
  };
}

interface PriorAuth {
  id: string;
  client: string;
  payer: string;
  cpt: string;
  description: string;
  authNum: string | null;
  unitsApproved: number;
  unitsUsed: number;
  expiry: string;
  status: AuthStatus;
}

const COMMON_PAYERS = [
  { name: 'Beacon Health Options', type: 'Managed Behavioral Health' },
  { name: 'Medicaid (MD)', type: 'State Medicaid' },
  { name: 'Medicare Part B', type: 'Federal' },
  { name: 'BCBS Maryland', type: 'Commercial' },
  { name: 'Aetna Behavioral Health', type: 'Commercial' },
  { name: 'Cigna', type: 'Commercial' },
  { name: 'UnitedHealth', type: 'Commercial' },
  { name: 'Magellan Health', type: 'Managed Behavioral Health' },
];

const PAYER_DIRECTORY_DETAILS: Record<string, { ediPayerId: string; claimsPhone: string }> = {
  'Beacon Health Options': { ediPayerId: '48172', claimsPhone: '1-800-555-2401' },
  'Medicaid (MD)': { ediPayerId: '77032', claimsPhone: '1-800-555-2402' },
  'Medicare Part B': { ediPayerId: '00882', claimsPhone: '1-800-555-2403' },
  'BCBS Maryland': { ediPayerId: '00560', claimsPhone: '1-800-555-2404' },
  'Aetna Behavioral Health': { ediPayerId: '60054', claimsPhone: '1-800-555-2405' },
  'Cigna': { ediPayerId: '62308', claimsPhone: '1-800-555-2406' },
  'UnitedHealth': { ediPayerId: '87726', claimsPhone: '1-800-555-2407' },
  'Magellan Health': { ediPayerId: '55019', claimsPhone: '1-800-555-2408' },
};

function toUiStatus(status: EligibilityCheckRecord['status']): EligibilityStatus {
  switch (status) {
    case 'ELIGIBLE':
      return 'Active';
    case 'INELIGIBLE':
      return 'Inactive';
    case 'ERROR':
      return 'Failed';
    default:
      return 'Pending';
  }
}

function mapCheck(row: EligibilityCheckRecord): EligibilityRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    client: row.clientName,
    insurance: row.payerName,
    memberId: row.memberId || '—',
    groupNum: '—',
    deductible: row.benefits.deductible,
    deductibleMet: row.benefits.deductibleMet,
    copay: row.benefits.copay,
    oopMax: row.benefits.oopMax,
    oopMet: row.benefits.oopMet,
    status: toUiStatus(row.status),
    verifiedDate: row.checkedAt,
    coveredServices: row.benefits.coveredServices,
  };
}

const STATUS_STYLES: Record<EligibilityStatus, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Inactive: 'bg-slate-100 text-slate-600',
  Pending: 'bg-amber-100 text-amber-700',
  Partial: 'bg-blue-100 text-blue-700',
  Failed: 'bg-red-100 text-red-700',
};

const AUTH_STYLES: Record<AuthStatus, string> = {
  Approved: 'bg-blue-50 text-blue-700',
  Pending: 'bg-amber-100 text-amber-700',
  Denied: 'bg-red-100 text-red-700',
  Expired: 'bg-slate-100 text-slate-600',
};

export default function EligibilityPage() {
  return (
    <Suspense fallback={<p className="text-sm text-slate-500">Loading eligibility…</p>}>
      <EligibilityPageInner />
    </Suspense>
  );
}

function EligibilityPageInner() {
  const { user } = useAuth();
  const canManageOvernight =
    user?.role === 'ADMIN' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'BILLING';
  const [eligibility, setEligibility] = useState<EligibilityRecord[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [auths, setAuths] = useState<PriorAuth[]>([]);
  const searchParams = useSearchParams();
  const { clients, loading: clientsLoading } = useClients();
  const [activeTab, setActiveTab] = useState('Verification');
  const [search, setSearch] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<EligibilityRecord | null>(null);
  const [showCheck, setShowCheck] = useState(false);
  const [checkForm, setCheckForm] = useState({ clientId: '', payer: '', memberId: '', groupNum: '', dos: new Date().toISOString().split('T')[0] });
  const [checkResult, setCheckResult] = useState<EligibilityRecord | null>(null);
  const [checking, setChecking] = useState(false);

  // Section 5.4: Secondary Insurance & Notes
  const [showSecondaryModal, setShowSecondaryModal] = useState(false);
  const [secondaryTargetRecord, setSecondaryTargetRecord] = useState<EligibilityRecord | null>(null);
  const [secForm, setSecForm] = useState({
    payer: 'Medicaid (MD)',
    memberId: '',
    groupNum: '',
    cobOrder: 'Secondary' as 'Secondary' | 'Tertiary',
    status: 'Active' as EligibilityStatus,
    copay: 0,
    notes: '',
  });
  const [recordNotesDraft, setRecordNotesDraft] = useState('');
  const [notesSavedSuccess, setNotesSavedSuccess] = useState(false);

  const loadChecks = useCallback(async () => {
    try {
      const rows = await fetchEligibilityChecks();
      if (rows && rows.length > 0) {
        setEligibility(rows.map(mapCheck));
      } else {
        setEligibility([]);
      }
      setLoadError(null);
    } catch {
      setEligibility([]);
    }
  }, []);

  useEffect(() => {
    void loadChecks();
  }, [loadChecks]);

  useEffect(() => {
    const clientId = searchParams.get('clientId');
    if (!clientId || clientsLoading) return;
    const client = clients.find((c) => c.id === clientId);
    if (!client) return;
    setCheckForm((form) => ({
      ...form,
      clientId,
      payer: client.insurancePayer || form.payer,
      memberId: client.insuranceMemberId || form.memberId,
      groupNum: client.insuranceGroupNumber || form.groupNum,
    }));
    setShowCheck(true);
  }, [searchParams, clients, clientsLoading]);

  useEffect(() => {
    void fetchPriorAuths()
      .then((rows) => {
        setAuths(
          rows.map((row) => ({
            id: row.id,
            client: row.clientName,
            payer: row.payer,
            cpt: row.cptCodes[0] || '—',
            description: row.notes || row.cptCodes.join(', '),
            authNum: row.authNumber,
            unitsApproved: row.unitsApproved,
            unitsUsed: row.unitsUsed,
            expiry: row.endDate || '—',
            status:
              row.status === 'APPROVED'
                ? 'Approved'
                : row.status === 'DENIED'
                  ? 'Denied'
                  : row.status === 'EXPIRED'
                    ? 'Expired'
                    : 'Pending',
          }))
        );
      })
      .catch(() => {
        setAuths([]);
      });
  }, []);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const verifiedToday = eligibility.filter(
      (record) => record.status === 'Active' && record.verifiedDate === today
    ).length;
    const activeCoverage = eligibility.filter((record) => record.status === 'Active').length;
    const pendingVerification = eligibility.filter((record) => record.status === 'Pending').length;
    const failedOrDenied = eligibility.filter(
      (record) => record.status === 'Failed' || record.status === 'Inactive'
    ).length;

    return [
      { label: 'Verified Today', value: String(verifiedToday), icon: 'check', color: '#16a34a' },
      { label: 'Active Coverage', value: String(activeCoverage), icon: 'shield', color: '#6868D0' },
      { label: 'Pending Verification', value: String(pendingVerification), icon: 'clock', color: '#D4A017' },
      { label: 'Failed / Denied', value: String(failedOrDenied), icon: 'xcircle', color: '#dc2626' },
    ];
  }, [eligibility]);

  const filtered = eligibility.filter(r =>
    r.client.toLowerCase().includes(search.toLowerCase()) || r.insurance.toLowerCase().includes(search.toLowerCase())
  );

  const runCheck = async () => {
    if (!checkForm.clientId) return;
    setChecking(true);
    setCheckError(null);
    try {
      const row = await runEligibilityCheck({
        clientId: checkForm.clientId,
        payerName: checkForm.payer || null,
        memberId: checkForm.memberId || null,
        dos: checkForm.dos || null,
      });
      const mapped = mapCheck(row);
      setCheckResult(mapped);
      setEligibility((prev) => [mapped, ...prev.filter((record) => record.id !== mapped.id)]);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Eligibility check failed');
    } finally {
      setChecking(false);
    }
  };

  const saveCheckedRecord = () => {
    if (!checkResult) return;
    setSelectedRecord(checkResult);
    setShowCheck(false);
    setCheckResult(null);
    setCheckError(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Insurance Eligibility</h1>
          <p className="text-slate-500 text-sm mt-1">Real-time coverage verification &amp; prior authorization tracking</p>
          {loadError ? <p className="mt-2 text-sm text-red-600">{loadError}</p> : null}
        </div>
        <button onClick={() => { setShowCheck(true); setCheckResult(null); setCheckError(null); }}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90 transition-all flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
          <Shield size={14} /> Check Eligibility
        </button>
      </div>

      <OvernightEligibilityCard canManage={canManageOvernight} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(s => (
          <div key={s.label} className="bg-white rounded-xl p-5 border border-slate-200/80 shadow-sm">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: s.color + '18' }}>
              {s.icon === 'check' && <CheckCircle2 size={20} style={{ color: s.color }} />}
              {s.icon === 'shield' && <Shield size={20} style={{ color: s.color }} />}
              {s.icon === 'clock' && <Clock size={20} style={{ color: s.color }} />}
              {s.icon === 'xcircle' && <XCircle size={20} style={{ color: s.color }} />}
            </div>
            <p className="text-2xl font-semibold mt-2" style={{ color: s.color }}>{s.value}</p>
            <p className="text-xs font-semibold text-slate-700 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-slate-200/80 shadow-sm p-1.5 w-fit">
        {['Verification', 'Prior Authorizations', 'Payer Directory'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-all
              ${activeTab === tab ? 'text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            style={activeTab === tab ? { background: '#6868D0' } : {}}>
            {tab}
          </button>
        ))}
      </div>

      {activeTab === 'Verification' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-50">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by client or insurance..."
              className="w-full sm:w-80 border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xs text-slate-400 uppercase">
                  <th className="text-left px-5 py-3 font-semibold">Client</th>
                  <th className="text-left px-5 py-3 font-semibold">Primary Payer</th>
                  <th className="text-left px-5 py-3 font-semibold">Member ID</th>
                  <th className="text-left px-5 py-3 font-semibold">Deductible</th>
                  <th className="text-left px-5 py-3 font-semibold">Copay</th>
                  <th className="text-left px-5 py-3 font-semibold">OOP Max</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                  <th className="text-left px-5 py-3 font-semibold">Secondary (COB)</th>
                  <th className="text-left px-5 py-3 font-semibold">Verified</th>
                  <th className="text-left px-5 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-10 text-center text-sm text-slate-500">
                      No eligibility checks yet. Run Check Eligibility to query Availity Coverages.
                    </td>
                  </tr>
                ) : null}
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                          style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
                          {r.client[0]}
                        </div>
                        <span className="text-sm font-medium text-slate-900">{r.client}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-700">{r.insurance}</td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-600">{r.memberId}</td>
                    <td className="px-5 py-3">
                      {r.deductible > 0 ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-blue-500"
                                style={{ width: `${Math.min((r.deductibleMet / r.deductible) * 100, 100)}%` }} />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">${r.deductibleMet.toLocaleString()} / ${r.deductible.toLocaleString()}</p>
                        </div>
                      ) : <span className="text-xs text-emerald-600 font-semibold">None</span>}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-slate-800">{r.copay > 0 ? `$${r.copay}` : 'N/A'}</td>
                    <td className="px-5 py-3">
                      {r.oopMax > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-700">${r.oopMet.toLocaleString()} / ${r.oopMax.toLocaleString()}</p>
                          <p className="text-xs text-slate-400">${(r.oopMax - r.oopMet).toLocaleString()} remaining</p>
                        </div>
                      ) : <span className="text-xs text-emerald-600 font-semibold">Unlimited</span>}
                    </td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      {r.secondaryInsurance ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-[#6868D0] border border-purple-200">
                            {r.secondaryInsurance.payer}
                          </span>
                          <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                            COB: {r.secondaryInsurance.cobOrder}
                          </span>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setSecondaryTargetRecord(r);
                            setSecForm({
                              payer: 'Medicaid (MD)',
                              memberId: '',
                              groupNum: '',
                              cobOrder: 'Secondary',
                              status: 'Active',
                              copay: 0,
                              notes: '',
                            });
                            setShowSecondaryModal(true);
                          }}
                          className="text-[11px] font-semibold text-slate-400 hover:text-[#6868D0] hover:underline"
                        >
                          + Verify Secondary
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{r.verifiedDate}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => { setSelectedRecord(r); setRecordNotesDraft(r.billingNotes || ''); }}
                        className="text-xs px-2.5 py-1 rounded-lg text-blue-600 border border-slate-300 hover:bg-blue-50 font-semibold">
                        Details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Prior Authorizations' && (
        <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-50 text-xs text-slate-400 uppercase">
                  <th className="text-left px-5 py-3 font-semibold">Client</th>
                  <th className="text-left px-5 py-3 font-semibold">Payer</th>
                  <th className="text-left px-5 py-3 font-semibold">CPT Code</th>
                  <th className="text-left px-5 py-3 font-semibold">Auth #</th>
                  <th className="text-left px-5 py-3 font-semibold">Units</th>
                  <th className="text-left px-5 py-3 font-semibold">Expiry</th>
                  <th className="text-left px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {auths.map((auth) => (
                  <tr key={auth.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 text-sm font-medium text-slate-900">{auth.client}</td>
                    <td className="px-5 py-3 text-sm text-slate-600">{auth.payer}</td>
                    <td className="px-5 py-3">
                      <div>
                        <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{auth.cpt}</span>
                        <p className="text-xs text-slate-400 mt-0.5">{auth.description}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-600">{auth.authNum || 'Pending'}</td>
                    <td className="px-5 py-3">
                      {auth.unitsApproved > 0 ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full"
                                style={{ width: `${(auth.unitsUsed / auth.unitsApproved) * 100}%`, background: '#6868D0' }} />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{auth.unitsUsed} / {auth.unitsApproved} units</p>
                        </div>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{auth.expiry}</td>
                    <td className="px-5 py-3">
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${AUTH_STYLES[auth.status]}`}>{auth.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'Payer Directory' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COMMON_PAYERS.map(p => (
            <div key={p.name} className="bg-white rounded-xl border border-slate-200/80 shadow-sm p-5 hover:shadow-md transition-all">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50">
                  <Building2 size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{p.name}</p>
                  <p className="text-xs text-slate-400">{p.type}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-500">
                <p>EDI Payer ID: {PAYER_DIRECTORY_DETAILS[p.name]?.ediPayerId || '—'}</p>
                <p>Claims Phone: {PAYER_DIRECTORY_DETAILS[p.name]?.claimsPhone || '1-800-555-2400'}</p>
                <p>Eligibility: Real-time 270/271</p>
              </div>
              <button onClick={() => setShowCheck(true)}
                className="mt-3 w-full text-xs font-semibold text-blue-600 border border-slate-300 py-1.5 rounded-lg hover:bg-blue-50 transition-all">
                Check Eligibility
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Eligibility Detail Modal */}
      {selectedRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-clinic-md">
            <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{selectedRecord.client}</h2>
                <p className="text-xs text-slate-500">{selectedRecord.insurance} · Verified {selectedRecord.verifiedDate}</p>
              </div>
              <button onClick={() => setSelectedRecord(null)} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${STATUS_STYLES[selectedRecord.status]}`}>{selectedRecord.status}</span>
                <span className="text-xs text-slate-400">Member ID: {selectedRecord.memberId}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Annual Deductible', value: selectedRecord.deductible > 0 ? `$${selectedRecord.deductible.toLocaleString()}` : 'None' },
                  { label: 'Deductible Met', value: selectedRecord.deductible > 0 ? `$${selectedRecord.deductibleMet.toLocaleString()}` : 'N/A' },
                  { label: 'Copay per Visit', value: selectedRecord.copay > 0 ? `$${selectedRecord.copay}` : '$0' },
                  { label: 'Out-of-Pocket Max', value: selectedRecord.oopMax > 0 ? `$${selectedRecord.oopMax.toLocaleString()}` : 'Unlimited' },
                  { label: 'OOP Met', value: selectedRecord.oopMax > 0 ? `$${selectedRecord.oopMet.toLocaleString()}` : 'N/A' },
                  { label: 'OOP Remaining', value: selectedRecord.oopMax > 0 ? `$${(selectedRecord.oopMax - selectedRecord.oopMet).toLocaleString()}` : 'N/A' },
                ].map(item => (
                  <div key={item.label} className="bg-slate-50 rounded-xl p-3">
                    <p className="text-xs text-slate-500">{item.label}</p>
                    <p className="text-sm font-bold text-slate-800 mt-0.5">{item.value}</p>
                  </div>
                ))}
              </div>
              {selectedRecord.coveredServices.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">Covered Services</p>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedRecord.coveredServices.map(s => (
                      <span key={s} className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{s}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Secondary Insurance & COB Tracking */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-[#6868D0]" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Secondary Payer & Coordination of Benefits (COB)
                    </span>
                  </div>
                  {selectedRecord.secondaryInsurance ? (
                    <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-bold text-[#6868D0]">
                      COB: {selectedRecord.secondaryInsurance.cobOrder}
                    </span>
                  ) : null}
                </div>

                {selectedRecord.secondaryInsurance ? (
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div>
                      <p className="text-slate-400">Payer Name</p>
                      <p className="font-semibold text-slate-800">{selectedRecord.secondaryInsurance.payer}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Member ID</p>
                      <p className="font-mono font-semibold text-slate-800">{selectedRecord.secondaryInsurance.memberId}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Status & Copay</p>
                      <p className="font-semibold text-emerald-700">
                        {selectedRecord.secondaryInsurance.status} · ${selectedRecord.secondaryInsurance.copay ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-400">COB Order</p>
                      <p className="font-semibold text-slate-800">{selectedRecord.secondaryInsurance.cobOrder} Payer</p>
                    </div>
                    {selectedRecord.secondaryInsurance.notes && (
                      <div className="col-span-2 text-[11px] text-slate-500 italic">
                        {selectedRecord.secondaryInsurance.notes}
                      </div>
                    )}
                    <div className="col-span-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSecondaryTargetRecord(selectedRecord);
                          setSecForm({
                            payer: selectedRecord.secondaryInsurance?.payer || 'Medicaid (MD)',
                            memberId: selectedRecord.secondaryInsurance?.memberId || '',
                            groupNum: selectedRecord.secondaryInsurance?.groupNum || '',
                            cobOrder: selectedRecord.secondaryInsurance?.cobOrder || 'Secondary',
                            status: selectedRecord.secondaryInsurance?.status || 'Active',
                            copay: selectedRecord.secondaryInsurance?.copay || 0,
                            notes: selectedRecord.secondaryInsurance?.notes || '',
                          });
                          setShowSecondaryModal(true);
                        }}
                        className="text-xs font-semibold text-[#6868D0] hover:underline"
                      >
                        Edit Secondary Verification →
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-500">No secondary coverage verified.</p>
                    <button
                      type="button"
                      onClick={() => {
                        setSecondaryTargetRecord(selectedRecord);
                        setSecForm({
                          payer: 'Medicaid (MD)',
                          memberId: '',
                          groupNum: '',
                          cobOrder: 'Secondary',
                          status: 'Active',
                          copay: 0,
                          notes: '',
                        });
                        setShowSecondaryModal(true);
                      }}
                      className="rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-semibold text-[#6868D0] hover:bg-slate-50 shadow-2xs"
                    >
                      + Verify Secondary Insurance
                    </button>
                  </div>
                )}
              </div>

              {/* Billing Specialist Notes & Prior-Auth Reference */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Billing Notes & Prior-Auth Reference
                  </span>
                  {notesSavedSuccess && (
                    <span className="text-xs font-semibold text-emerald-600">Saved!</span>
                  )}
                </div>
                <textarea
                  rows={3}
                  value={recordNotesDraft}
                  onChange={(e) => setRecordNotesDraft(e.target.value)}
                  placeholder="Save prior-authorization number (e.g. PA-2026-9912), clearinghouse trace ID, or appeal notes..."
                  className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      if (!selectedRecord) return;
                      const updated: EligibilityRecord = {
                        ...selectedRecord,
                        billingNotes: recordNotesDraft,
                      };
                      setSelectedRecord(updated);
                      setEligibility((prev) =>
                        prev.map((item) => (item.id === updated.id ? updated : item))
                      );
                      setNotesSavedSuccess(true);
                      setTimeout(() => setNotesSavedSuccess(false), 2000);
                    }}
                    className="rounded-lg bg-[#6868D0] px-3 py-1.5 text-xs font-semibold text-white shadow-2xs hover:opacity-90"
                  >
                    Save Notes & Prior-Auth
                  </button>
                </div>
              </div>

              <button onClick={() => setSelectedRecord(null)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Check Eligibility Modal */}
      {showCheck && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">Check Insurance Eligibility</h2>
              <button onClick={() => { setShowCheck(false); setCheckResult(null); }} className="text-slate-400 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <div className="p-6 space-y-4">
              {!checkResult ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Client</label>
                    <select
                      value={checkForm.clientId}
                      onChange={(e) => {
                        const client = clients.find((c) => c.id === e.target.value);
                        setCheckForm((p) => ({
                          ...p,
                          clientId: e.target.value,
                          payer: client?.insurancePayer?.trim() || p.payer,
                          memberId: client?.insuranceMemberId?.trim() || p.memberId,
                          groupNum: client?.insuranceGroupNumber?.trim() || p.groupNum,
                        }));
                      }}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">{clientsLoading ? 'Loading clients...' : 'Select client...'}</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Insurance Payer</label>
                    <select value={checkForm.payer} onChange={e => setCheckForm(p => ({ ...p, payer: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400">
                      <option value="">Select payer...</option>
                      {COMMON_PAYERS.map(p =><option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Member ID</label>
                      <input value={checkForm.memberId} onChange={e => setCheckForm(p => ({ ...p, memberId: e.target.value }))}
                        placeholder="Member ID #"
                        className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Group #</label>
                      <input value={checkForm.groupNum} onChange={e => setCheckForm(p => ({ ...p, groupNum: e.target.value }))}
                        placeholder="Group # (optional)"
                        className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Date of Service</label>
                    <input type="date" value={checkForm.dos} onChange={e => setCheckForm(p => ({ ...p, dos: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400" />
                  </div>
                  {checkError ? <p className="text-sm text-red-600">{checkError}</p> : null}
                  <button onClick={() => void runCheck()} disabled={!checkForm.clientId || checking}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
                    {checking ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Checking Eligibility...
                      </>
                    ) : <><Shield size={14} />Run Eligibility Check</>}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 p-4 rounded-xl ring-1 ring-inset ${
                    checkResult.status === 'Active'
                      ? 'bg-blue-50 ring-blue-100'
                      : checkResult.status === 'Inactive'
                        ? 'bg-slate-50 ring-slate-200'
                        : 'bg-red-50 ring-red-100'
                  }`}>
                    {checkResult.status === 'Active' ? (
                      <CheckCircle2 size={24} className="text-blue-600 shrink-0" />
                    ) : checkResult.status === 'Inactive' ? (
                      <XCircle size={24} className="text-slate-500 shrink-0" />
                    ) : (
                      <XCircle size={24} className="text-red-600 shrink-0" />
                    )}
                    <div>
                      <p className={`font-bold ${
                        checkResult.status === 'Active'
                          ? 'text-blue-800'
                          : checkResult.status === 'Inactive'
                            ? 'text-slate-800'
                            : 'text-red-800'
                      }`}>
                        {checkResult.status === 'Active'
                          ? 'Coverage Active'
                          : checkResult.status === 'Inactive'
                            ? 'Coverage Inactive'
                            : 'Eligibility Check Failed'}
                      </p>
                      <p className="text-xs text-slate-600">Result for {checkForm.dos}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Deductible', value: checkResult.deductible > 0 ? `$${checkResult.deductible.toLocaleString()}` : 'None' },
                      { label: 'Deductible Met', value: checkResult.deductible > 0 ? `$${checkResult.deductibleMet.toLocaleString()}` : 'N/A' },
                      { label: 'Copay', value: checkResult.copay > 0 ? `$${checkResult.copay}/visit` : '$0' },
                      { label: 'OOP Remaining', value: checkResult.oopMax > 0 ? `$${(checkResult.oopMax - checkResult.oopMet).toLocaleString()}` : 'Unlimited' },
                    ].map(item => (
                      <div key={item.label} className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs text-slate-500">{item.label}</p>
                        <p className="text-sm font-bold text-slate-800 mt-0.5">{item.value}</p>
                      </div>
                    ))}
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-500 uppercase mb-2">Covered Services</p>
                    <div className="flex flex-wrap gap-1.5">
                      {checkResult.coveredServices.map(s => (
                        <span key={s} className="text-xs font-medium px-2.5 py-1 rounded-full bg-blue-50 text-blue-700">{s}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveCheckedRecord} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                      style={{ background: 'linear-gradient(135deg, #6868D0, #6868D0)' }}>
                      Save to Record
                    </button>
                    <button onClick={() => { setShowCheck(false); setCheckResult(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Secondary Insurance Verification Modal */}
      {showSecondaryModal && secondaryTargetRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Verify Secondary Insurance</h2>
                <p className="text-xs text-slate-500">Coordination of Benefits (COB) for {secondaryTargetRecord.client}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSecondaryModal(false)}
                className="text-slate-400 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="rounded-xl bg-purple-50/60 border border-purple-100 p-3 text-slate-700 space-y-1">
                <p><strong>Client:</strong> {secondaryTargetRecord.client}</p>
                <p><strong>Primary Insurance:</strong> {secondaryTargetRecord.insurance} (Member ID: {secondaryTargetRecord.memberId})</p>
                <p className="text-[11px] text-[#6868D0] font-medium">Secondary claim billing will automatically route balances after primary adjudication.</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Secondary Payer *</label>
                <select
                  value={secForm.payer}
                  onChange={(e) => setSecForm((p) => ({ ...p, payer: e.target.value }))}
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                >
                  {COMMON_PAYERS.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                  <option value="Medicaid Wrap Plan">Medicaid Wrap Plan</option>
                  <option value="TRICARE Secondary">TRICARE Secondary</option>
                  <option value="Commercial Secondary">Other Commercial Secondary</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Secondary Member ID *</label>
                  <input
                    value={secForm.memberId}
                    onChange={(e) => setSecForm((p) => ({ ...p, memberId: e.target.value }))}
                    placeholder="e.g. MA-991024-MD"
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Group # (Optional)</label>
                  <input
                    value={secForm.groupNum}
                    onChange={(e) => setSecForm((p) => ({ ...p, groupNum: e.target.value }))}
                    placeholder="Group #"
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">COB Order *</label>
                  <select
                    value={secForm.cobOrder}
                    onChange={(e) =>
                      setSecForm((p) => ({ ...p, cobOrder: e.target.value as 'Secondary' | 'Tertiary' }))
                    }
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                  >
                    <option value="Secondary">Secondary</option>
                    <option value="Tertiary">Tertiary</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Coverage Status *</label>
                  <select
                    value={secForm.status}
                    onChange={(e) =>
                      setSecForm((p) => ({ ...p, status: e.target.value as EligibilityStatus }))
                    }
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                  >
                    <option value="Active">Active</option>
                    <option value="Pending">Pending</option>
                    <option value="Inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Secondary Copay ($)</label>
                  <input
                    type="number"
                    value={secForm.copay}
                    onChange={(e) => setSecForm((p) => ({ ...p, copay: Number(e.target.value) || 0 }))}
                    className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Secondary Coordination Notes</label>
                <textarea
                  rows={2}
                  value={secForm.notes}
                  onChange={(e) => setSecForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder="e.g. Requires primary EOB attached; covers 100% of primary copay/coinsurance."
                  className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#6868D0]"
                />
              </div>

              <div className="flex gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowSecondaryModal(false)}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!secondaryTargetRecord) return;
                    const updated: EligibilityRecord = {
                      ...secondaryTargetRecord,
                      secondaryInsurance: {
                        payer: secForm.payer,
                        memberId: secForm.memberId || 'SEC-PENDING',
                        groupNum: secForm.groupNum,
                        cobOrder: secForm.cobOrder,
                        status: secForm.status,
                        copay: Number(secForm.copay) || 0,
                        verifiedDate: new Date().toISOString().split('T')[0],
                        notes: secForm.notes,
                      },
                    };
                    setEligibility((prev) =>
                      prev.map((item) => (item.id === updated.id ? updated : item))
                    );
                    if (selectedRecord && selectedRecord.id === updated.id) {
                      setSelectedRecord(updated);
                    }
                    setShowSecondaryModal(false);
                  }}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white shadow-sm hover:opacity-90"
                  style={{ background: '#6868D0' }}
                >
                  Attach Secondary Payer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
