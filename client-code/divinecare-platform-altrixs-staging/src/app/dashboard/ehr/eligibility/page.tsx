'use client';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useClients } from '@/features/clients/hooks/useClients';
import {
  fetchEligibilityData,
  runEligibilityCheck,
  type EligibilityChannel,
  type EligibilityChannels,
  type EligibilityCheckRecord,
} from '@/features/ehr/eligibilityApi';
import { fetchPriorAuths } from '@/features/ehr/priorAuthsApi';
import { NightlyEligibilityCard } from '@/features/ehr/NightlyEligibilityCard';
import { ArrowRight, CheckCircle2, Shield, Clock, XCircle, Building2, Send } from 'lucide-react';
import { buttonClasses, cardClasses, cx, PageHeader, StatCard, StatGrid, Tabs, inputClasses, Alert } from '@/components/ui';

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
  /** Waystar batch: 270 sent, 271 not back yet */
  awaiting: boolean;
  statusText: string | null;
  channel: EligibilityChannel | null;
  error: string | null;
  details: EligibilityCheckRecord['details'] | null;
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

const DEFAULT_ELIGIBILITY: EligibilityRecord[] = [];

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
    awaiting: Boolean(row.awaitingResponse),
    statusText: row.statusText ?? null,
    channel: row.channel ?? null,
    error: row.error ?? null,
    details: row.details ?? null,
  };
}

const STATUS_STYLES: Record<EligibilityStatus, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Inactive: 'bg-slate-100 text-slate-600',
  Pending: 'bg-amber-100 text-amber-700',
  Partial: 'bg-blue-100 text-blue-700',
  Failed: 'bg-rose-100 text-rose-700',
};

const AUTH_STYLES: Record<AuthStatus, string> = {
  Approved: 'bg-blue-50 text-blue-700',
  Pending: 'bg-amber-100 text-amber-700',
  Denied: 'bg-rose-100 text-rose-700',
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
  // True when the check modal was opened from "Verify Secondary"; the request itself is an
  // ordinary check (the route has no COB flag), so the modal labels it instead.
  const [secondaryCheck, setSecondaryCheck] = useState(false);
  const [channels, setChannels] = useState<EligibilityChannels | null>(null);
  const [channelChoice, setChannelChoice] = useState<EligibilityChannel | ''>('');

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

  const loadChecks = useCallback(async () => {
    try {
      const { checks: rows, channels: ch } = await fetchEligibilityData();
      setEligibility(rows && rows.length > 0 ? rows.map(mapCheck) : DEFAULT_ELIGIBILITY);
      setChannels(ch);
      setLoadError(null);
    } catch {
      setEligibility(DEFAULT_ELIGIBILITY);
    }
  }, []);

  useEffect(() => {
    void loadChecks();
  }, [loadChecks]);

  // Waystar answers (271) arrive with the scheduled retrieval: refresh while any check is waiting
  const anyAwaiting = eligibility.some((r) => r.awaiting);
  useEffect(() => {
    if (!anyAwaiting) return;
    const t = setInterval(() => { void loadChecks(); }, 60_000);
    return () => clearInterval(t);
  }, [anyAwaiting, loadChecks]);

  const activeChannel: EligibilityChannel | null = channelChoice || channels?.defaultChannel || null;

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
    setSecondaryCheck(false);
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
      { label: 'Verified Today', value: String(verifiedToday), icon: 'check', tone: 'success' as const },
      { label: 'Active Coverage', value: String(activeCoverage), icon: 'shield', tone: 'brand' as const },
      { label: 'Pending Verification', value: String(pendingVerification), icon: 'clock', tone: 'warning' as const },
      { label: 'Failed / Denied', value: String(failedOrDenied), icon: 'xcircle', tone: 'danger' as const },
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
        channel: channelChoice || null,
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
      <PageHeader
        title="Insurance Eligibility"
        description={<>{channels?.waystar ? 'Coverage verification through Waystar (batch 270/271) & prior authorization tracking' : 'Real-time coverage verification & prior authorization tracking'}</>}
        actions={<>
          <button onClick={() => { setSecondaryCheck(false); setShowCheck(true); setCheckResult(null); setCheckError(null); }}
          className={buttonClasses({ variant: 'primary' })}>
          <Shield size={14} /> Check Eligibility
        </button>
        </>}
      >
        {channels?.waystarNote ? <p className="mt-1 max-w-2xl text-xs text-blue-600">{channels.waystarNote}</p> : null}
          {loadError ? <p className="mt-2 text-sm text-rose-600">{loadError}</p> : null}
      </PageHeader>

      <NightlyEligibilityCard />

      <StatGrid columns={4}>
        {stats.map(s => (
          <StatCard
            key={s.label}
            label={s.label}
            value={s.value}
            tone={s.tone}
            icon={s.icon === 'check' ? <CheckCircle2 /> : s.icon === 'shield' ? <Shield /> : s.icon === 'clock' ? <Clock /> : <XCircle />}
          />
        ))}
      </StatGrid>

      {/* Tabs */}
      <Tabs
        label="Eligibility sections"
        controlsPanels={false}
        value={activeTab}
        onChange={setActiveTab}
        items={['Verification', 'Prior Authorizations', 'Payer Directory'].map((tab) => ({ key: tab, label: tab }))}
      />

      {activeTab === 'Verification' && (
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="p-5 border-b border-slate-100">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by client or insurance…"
              className={cx(inputClasses, 'sm:w-80')} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Client</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Primary Payer</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Member ID</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Deductible</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Copay</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">OOP Max</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Status</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Secondary (COB)</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Verified</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-5 py-10 text-center text-sm text-slate-500">
                      No eligibility checks yet. Run Check Eligibility to query {channels?.waystar ? 'the payer through Waystar' : 'Availity Coverages'}.
                    </td>
                  </tr>
                ) : null}
                {filtered.map(r => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div className={buttonClasses({ variant: 'primary', size: 'sm', className: 'w-7 justify-center' })}>
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
                      ) : <span className="text-xs text-emerald-700 font-semibold">None</span>}
                    </td>
                    <td className="px-5 py-3 text-sm font-semibold text-slate-800">{r.copay > 0 ? `$${r.copay}` : 'N/A'}</td>
                    <td className="px-5 py-3">
                      {r.oopMax > 0 ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-700">${r.oopMet.toLocaleString()} / ${r.oopMax.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">${(r.oopMax - r.oopMet).toLocaleString()} remaining</p>
                        </div>
                      ) : <span className="text-xs text-emerald-700 font-semibold">Unlimited</span>}
                    </td>
                    <td className="px-5 py-3">
                      {r.awaiting ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-blue-50 text-blue-600" title="The 271 answer is applied by the next Waystar retrieval">
                          <Send size={11} /> Sent to Waystar — awaiting 271
                        </span>
                      ) : (
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLES[r.status]}`} title={r.error || r.statusText || undefined}>{r.status}</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {r.secondaryInsurance ? (
                        <div className="flex flex-col">
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-600 border border-blue-200">
                            {r.secondaryInsurance.payer}
                          </span>
                          <span className="text-[11px] text-slate-500 font-medium mt-0.5">
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
                          className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 hover:underline"
                        >
                          + Verify Secondary
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-3 text-sm text-slate-600">{r.verifiedDate}</td>
                    <td className="px-5 py-3">
                      <button onClick={() => setSelectedRecord(r)}
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
        <div className={cx(cardClasses, 'overflow-hidden')}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Client</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Payer</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">CPT Code</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Auth #</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Units</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Expiry</th>
                  <th scope="col" className="text-left px-5 py-3 font-semibold">Status</th>
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
                        <p className="text-xs text-slate-500 mt-0.5">{auth.description}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-xs font-mono text-slate-600">{auth.authNum || 'Pending'}</td>
                    <td className="px-5 py-3">
                      {auth.unitsApproved > 0 ? (
                        <div>
                          <div className="flex items-center gap-1.5">
                            <div className="w-16 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-blue-600"
                                style={{ width: `${(auth.unitsUsed / auth.unitsApproved) * 100}%` }} />
                            </div>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">{auth.unitsUsed} / {auth.unitsApproved} units</p>
                        </div>
                      ) : <span className="text-xs text-slate-500">—</span>}
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
            <div key={p.name} className="bg-white rounded-xl border border-slate-200/80 shadow-xs p-5 hover:shadow-sm transition-all">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50">
                  <Building2 size={18} className="text-blue-600" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900 text-sm">{p.name}</p>
                  <p className="text-xs text-slate-500">{p.type}</p>
                </div>
              </div>
              <div className="space-y-1.5 text-xs text-slate-500">
                <p>EDI payer ID and claims phone: confirm in the clearinghouse payer list</p>
              </div>
              <button onClick={() => { setSecondaryCheck(false); setShowCheck(true); }}
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
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-clinic-md">
            <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{selectedRecord.client}</h2>
                <p className="text-xs text-slate-500">{selectedRecord.insurance} · Verified {selectedRecord.verifiedDate}</p>
              </div>
              <button onClick={() => setSelectedRecord(null)} className="text-slate-500 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${STATUS_STYLES[selectedRecord.status]}`}>{selectedRecord.status}</span>
                <span className="text-xs text-slate-500">Member ID: {selectedRecord.memberId}</span>
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

              {selectedRecord.awaiting ? (
                <Alert tone="info">
                  Sent to Waystar{selectedRecord.details?.sentAt ? ` ${new Date(selectedRecord.details.sentAt).toLocaleString()}` : ''} — awaiting the 271 answer.
                  It is applied automatically by the next Waystar retrieval.
                </Alert>
              ) : null}
              {selectedRecord.error ? <Alert tone="danger">{selectedRecord.error}</Alert> : null}
              {selectedRecord.details && !selectedRecord.awaiting ? (
                <div className="space-y-1 rounded-xl border border-slate-200 p-3 text-xs text-slate-700">
                  <p className="font-bold uppercase tracking-wider text-slate-500">Waystar 271</p>
                  {selectedRecord.statusText ? <p>{selectedRecord.statusText}</p> : null}
                  {selectedRecord.details.planName ? <p>Plan: {selectedRecord.details.planName}</p> : null}
                  {selectedRecord.details.planBegin || selectedRecord.details.planEnd ? (
                    <p>Plan dates: {selectedRecord.details.planBegin || '?'} to {selectedRecord.details.planEnd || 'open'}</p>
                  ) : null}
                  {selectedRecord.details.coinsurancePercent != null ? <p>Coinsurance: {Math.round(selectedRecord.details.coinsurancePercent * 100)}%</p> : null}
                  {selectedRecord.details.benefitSource ? (
                    <p>Benefits read from: {selectedRecord.details.benefitSource === 'mental_health' ? 'mental health service types' : selectedRecord.details.benefitSource === 'plan' ? 'general plan coverage (no mental-health detail returned)' : 'not returned'}</p>
                  ) : null}
                  {selectedRecord.details.priorAuthRequired ? <p className="font-semibold text-amber-700">Prior authorization required</p> : null}
                  {selectedRecord.details.rejections.map((r) => <p key={r} className="text-rose-700">{r}</p>)}
                  {selectedRecord.details.notes.map((n) => <p key={n} className="text-slate-500">{n}</p>)}
                </div>
              ) : null}

              {/* Secondary Insurance & COB Tracking */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Shield className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                      Secondary Payer & Coordination of Benefits (COB)
                    </span>
                  </div>
                  {selectedRecord.secondaryInsurance ? (
                    <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-600">
                      COB: {selectedRecord.secondaryInsurance.cobOrder}
                    </span>
                  ) : null}
                </div>

                {selectedRecord.secondaryInsurance ? (
                  <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                    <div>
                      <p className="text-slate-500">Payer Name</p>
                      <p className="font-semibold text-slate-800">{selectedRecord.secondaryInsurance.payer}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Member ID</p>
                      <p className="font-mono font-semibold text-slate-800">{selectedRecord.secondaryInsurance.memberId}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Status & Copay</p>
                      <p className="font-semibold text-emerald-700">
                        {selectedRecord.secondaryInsurance.status} · ${selectedRecord.secondaryInsurance.copay ?? 0}
                      </p>
                    </div>
                    <div>
                      <p className="text-slate-500">COB Order</p>
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
                        className="text-xs font-semibold text-blue-600 hover:underline"
                      >
                        Edit Secondary Verification <ArrowRight size={12} aria-hidden className="inline" />
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
                      className="rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-slate-50 shadow-2xs"
                    >
                      + Verify Secondary Insurance
                    </button>
                  </div>
                )}
              </div>

              {/* Billing notes have no column on eligibility checks yet; prior-auth numbers belong on the prior-auth record. */}
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  Billing Notes & Prior-Auth Reference
                </span>
                <p className="text-xs text-slate-600">
                  Notes can&apos;t be saved on an eligibility check yet. Record authorization numbers and payer notes on the
                  client&apos;s prior authorization instead.
                </p>
                <div className="flex justify-end">
                  <a
                    href="/dashboard/ehr/prior-auths"
                    className={buttonClasses({ variant: 'primary', size: 'sm' })}
                  >
                    Open Prior Authorizations
                  </a>
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
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">
                {secondaryCheck ? 'Check Secondary Eligibility (COB)' : 'Check Insurance Eligibility'}
              </h2>
              <button onClick={() => { setShowCheck(false); setCheckResult(null); }} className="text-slate-500 hover:text-slate-600 text-xl font-bold">×</button>
            </div>
            <div className="p-6 space-y-4">
              {secondaryCheck ? (
                <Alert tone="warning">
                  Secondary payer check. The result is saved to eligibility history as an ordinary check against
                  this payer and is not marked as secondary there, so confirm which row is the primary plan before billing.
                  The group number on the client record (primary plan) is the one used.
                </Alert>
              ) : null}
              {!checkResult ? (
                <>
                  {channels && channels.channels.length > 1 ? (
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Clearinghouse</label>
                      <select value={activeChannel || ''} onChange={(e) => setChannelChoice(e.target.value as EligibilityChannel)}
                        className={inputClasses}>
                        <option value="waystar">Waystar (batch 270/271)</option>
                        <option value="availity">Availity (real-time)</option>
                      </select>
                    </div>
                  ) : null}
                  {activeChannel === 'waystar' && channels?.waystarNote ? (
                    <Alert tone="info">{channels.waystarNote}</Alert>
                  ) : null}
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
                      className={inputClasses}>
                      <option value="">{clientsLoading ? 'Loading clients…' : 'Select client…'}</option>
                      {clients.map((client) => (
                        <option key={client.id} value={client.id}>{client.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Insurance Payer</label>
                    <select value={checkForm.payer} onChange={e => setCheckForm(p => ({ ...p, payer: e.target.value }))}
                      className={inputClasses}>
                      <option value="">Select payer…</option>
                      {COMMON_PAYERS.map(p =><option key={p.name} value={p.name}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Member ID</label>
                      <input value={checkForm.memberId} onChange={e => setCheckForm(p => ({ ...p, memberId: e.target.value }))}
                        placeholder="Member ID #"
                        className={inputClasses} />
                    </div>
                    <div className={secondaryCheck ? 'hidden' : undefined}>
                      <label className="block text-xs font-semibold text-slate-600 mb-1">Group #</label>
                      <input value={checkForm.groupNum} onChange={e => setCheckForm(p => ({ ...p, groupNum: e.target.value }))}
                        placeholder="Group # (optional)"
                        className={inputClasses} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Date of Service</label>
                    <input type="date" value={checkForm.dos} onChange={e => setCheckForm(p => ({ ...p, dos: e.target.value }))}
                      className={inputClasses} />
                  </div>
                  {checkError ? <p className="text-sm text-rose-600">{checkError}</p> : null}
                  <button onClick={() => void runCheck()} disabled={!checkForm.clientId || checking}
                    className={buttonClasses({ variant: 'primary', className: 'w-full justify-center' })}>
                    {checking ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        {activeChannel === 'waystar' ? 'Sending to Waystar…' : 'Checking Eligibility…'}
                      </>
                    ) : <><Shield size={14} />{activeChannel === 'waystar' ? 'Send to Waystar (270)' : 'Run Eligibility Check'}</>}
                  </button>
                </>
              ) : (
                checkResult.awaiting ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 p-4 rounded-xl ring-1 ring-inset bg-blue-50 ring-blue-100">
                    <Send size={24} className="text-blue-600 shrink-0" />
                    <div>
                      <p className="font-bold text-blue-600">Sent to Waystar — awaiting 271</p>
                      <p className="text-xs text-slate-600">
                        The payer&apos;s answer is applied to this check automatically by the next Waystar retrieval; this page refreshes every minute while a check is waiting.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveCheckedRecord} className={buttonClasses({ variant: 'primary', className: 'flex-1' })}>
                      View Saved Check
                    </button>
                    <button onClick={() => { setShowCheck(false); setCheckResult(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                      Close
                    </button>
                  </div>
                </div>
                ) : (
                <div className="space-y-4">
                  <div className={`flex items-center gap-3 p-4 rounded-xl ring-1 ring-inset ${
                    checkResult.status === 'Active'
                      ? 'bg-blue-50 ring-blue-100'
                      : checkResult.status === 'Inactive'
                        ? 'bg-slate-50 ring-slate-200'
                        : 'bg-rose-50 ring-rose-100'
                  }`}>
                    {checkResult.status === 'Active' ? (
                      <CheckCircle2 size={24} className="text-blue-600 shrink-0" />
                    ) : checkResult.status === 'Inactive' ? (
                      <XCircle size={24} className="text-slate-500 shrink-0" />
                    ) : (
                      <XCircle size={24} className="text-rose-600 shrink-0" />
                    )}
                    <div>
                      <p className={`font-bold ${
                        checkResult.status === 'Active'
                          ? 'text-blue-800'
                          : checkResult.status === 'Inactive'
                            ? 'text-slate-800'
                            : 'text-rose-800'
                      }`}>
                        {checkResult.status === 'Active'
                          ? 'Coverage Active'
                          : checkResult.status === 'Inactive'
                            ? 'Coverage Inactive'
                            : 'Eligibility Check Failed'}
                      </p>
                      <p className="text-xs text-slate-600">Result for {checkForm.dos}</p>
                      {checkResult.error ? <p className="text-xs text-rose-700 mt-1">{checkResult.error}</p> : null}
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
                    <button onClick={saveCheckedRecord} className={buttonClasses({ variant: 'primary', className: 'flex-1' })}>
                      View Saved Check
                    </button>
                    <button onClick={() => { setShowCheck(false); setCheckResult(null); }}
                      className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                      Close
                    </button>
                  </div>
                </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* Secondary Insurance Verification Modal */}
      {showSecondaryModal && secondaryTargetRecord && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto shadow-clinic-md">
            <div className="sticky top-0 bg-white px-6 py-4 border-b border-slate-200/80 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Verify Secondary Insurance</h2>
                <p className="text-xs text-slate-500">Coordination of Benefits (COB) for {secondaryTargetRecord.client}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSecondaryModal(false)}
                className="text-slate-500 hover:text-slate-600 text-xl font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div className="rounded-xl bg-blue-50/60 border border-blue-100 p-3 text-slate-700 space-y-1">
                <p><strong>Client:</strong> {secondaryTargetRecord.client}</p>
                <p><strong>Primary Insurance:</strong> {secondaryTargetRecord.insurance} (Member ID: {secondaryTargetRecord.memberId})</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-600 mb-1">Secondary Payer *</label>
                <select
                  value={secForm.payer}
                  onChange={(e) => setSecForm((p) => ({ ...p, payer: e.target.value }))}
                  className={inputClasses}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Secondary Member ID *</label>
                  <input
                    value={secForm.memberId}
                    onChange={(e) => setSecForm((p) => ({ ...p, memberId: e.target.value }))}
                    placeholder="e.g. MA-991024-MD"
                    className={inputClasses}
                  />
                </div>
              </div>

              <Alert tone="warning">
                Secondary coverage can&apos;t be stored on the client record yet (no secondary-insurance fields).
                Run a real eligibility check against this payer below; the result is saved to the eligibility history.
              </Alert>

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
                  disabled={!secForm.memberId.trim()}
                  title={secForm.memberId.trim() ? undefined : 'Enter the secondary member ID first'}
                  onClick={() => {
                    if (!secondaryTargetRecord) return;
                    setCheckForm((form) => ({
                      ...form,
                      clientId: secondaryTargetRecord.clientId,
                      payer: secForm.payer,
                      memberId: secForm.memberId.trim(),
                      groupNum: '',
                    }));
                    setSecondaryCheck(true);
                    setCheckResult(null);
                    setCheckError(null);
                    setShowSecondaryModal(false);
                    setSelectedRecord(null);
                    setShowCheck(true);
                  }}
                  className={buttonClasses({ variant: 'primary', className: 'flex-1' })}
                >
                  Check Secondary Eligibility
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
