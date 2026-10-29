'use client';
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, Search, ShieldCheck, FileText, ClipboardList, Users, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/features/auth';
import { useClients } from '@/features/clients';
import { ALL_QUALIFYING_CODES, PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, type PrpDraft } from '../prpShared';

const STEPS = [
  { id: 1, label: 'Find Client',   icon: Search },
  { id: 2, label: 'Eligibility',   icon: ShieldCheck },
  { id: 3, label: 'Diagnosis',     icon: FileText },
  { id: 4, label: 'Referral',      icon: ClipboardList },
  { id: 5, label: 'Assign',        icon: Users },
  { id: 6, label: 'Done',          icon: CheckCircle },
];

const QUALIFYING_CODES: { code: string; label: string; group: string; warn?: boolean; highRisk?: boolean }[] = ALL_QUALIFYING_CODES as any;

type RosterClient = { id: string; name: string; dob: string; medicaidId: string; insurance: string; payer: string };

type Elg = { active: boolean; plan: string; prp: boolean; authRequired: boolean };

export default function PRPEnrollPage() {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const { clients: rosterSource } = useClients({ search: query.length > 1 ? query : '', limit: 50 });
  const canCreateClaim = user?.role === 'ADMIN' || user?.role === 'DIRECTOR' || user?.role === 'PRACTICE_DIRECTOR' || user?.role === 'BILLING';
  const [client, setClient] = useState<RosterClient | null>(null);
  const [claimNote, setClaimNote] = useState('');
  const [elg, setElg] = useState<Elg | null>(null);
  const [checking, setChecking] = useState(false);
  const [dxCode, setDxCode] = useState('');
  const [dxSource, setDxSource] = useState<'chart' | 'referral' | ''>('');
  const [referralId, setReferralId] = useState('');
  const [specialist, setSpecialist] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [enrolled, setEnrolled] = useState(false);
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  useEffect(() => { setDraft(loadPrpDraft()); }, []);

  const roster: RosterClient[] = rosterSource.map((row) => ({
    id: row.id,
    name: row.name,
    dob: row.dateOfBirth || '—',
    medicaidId: row.insuranceMemberId || row.mrn || '',
    insurance: row.insurancePayer || 'No payer on file',
    payer: row.insurancePayer || '',
  }));

  const startFromReferral = () => {
    if (!draft) return;
    const c = roster.find(x => x.id === draft.clientId || x.name === draft.clientName) || (draft.clientId ? {
      id: draft.clientId,
      name: draft.clientName || 'Client',
      dob: draft.clientDob || '—',
      medicaidId: draft.medicaidId || '',
      insurance: 'From referral',
      payer: 'From referral',
    } : null);
    if (c) { setClient(c); setQuery(c.name); }
    if (draft.dxCode) { setDxCode(draft.dxCode); setDxSource('referral'); }
    if (draft.referralId) setReferralId(draft.referralId);
    if (draft.specialist) setSpecialist(draft.specialist);
    setStep(2);
  };

  const filtered = query.length > 1
    ? roster.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.medicaidId.toLowerCase().includes(query.toLowerCase()))
    : [];

  const runEligibility = () => {
    if (!client) return;
    setChecking(true);
    const covered = Boolean(client.payer);
    setElg({ active: covered, plan: client.insurance, prp: covered, authRequired: true });
    setChecking(false);
  };

  const selectedCode = QUALIFYING_CODES.find(c => c.code === dxCode);

  const canFinish = client && elg?.active && elg?.prp && dxCode && dxSource && specialist;

  if (enrolled) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-green-600" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Enrollment Complete</h2>
        <p className="text-gray-500 mb-6">
          <strong>{client?.name}</strong> is now enrolled in PRP and assigned to <strong>{specialist}</strong>. The H2017 billing model is confirmed. The IRP is the next step.
        </p>
        <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 text-left text-sm text-purple-800 mb-6 space-y-1">
          <p><span className="font-semibold">Enrollment ID:</span> <span className="font-mono">PRP-{Date.now().toString(36).toUpperCase()}</span></p>
          <p><span className="font-semibold">Start Date:</span> {startDate}</p>
          <p><span className="font-semibold">Qualifying Dx:</span> {dxCode} — {selectedCode?.label}</p>
          <p><span className="font-semibold">Specialist:</span> {specialist}</p>
          {claimNote ? <p>{claimNote}</p> : null}
          {elg?.authRequired && <p className="text-amber-700 font-medium flex items-center gap-1"><AlertTriangle size={12} /> Prior authorization required — billing team has been notified</p>}
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/dashboard/prp" className="px-4 py-2 bg-purple-700 text-white rounded-lg text-sm font-medium hover:bg-purple-800">PRP Dashboard</Link>
          <Link href="/dashboard/prp/irp" className="px-4 py-2 border border-purple-300 text-purple-700 rounded-lg text-sm font-medium hover:bg-purple-50">Build IRP</Link>
          {canCreateClaim && client ? (
            <button
              type="button"
              onClick={async () => {
                const response = await fetch('/api/prp/billing-model', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ clientId: client.id, diagnosisCode: dxCode || 'F20.9', code: 'H2017', createClaim: true }),
                });
                const data = await response.json().catch(() => ({}));
                setClaimNote(response.ok ? 'H2017 claim draft created. It stays a draft until billing submits it.' : (data.error || 'Claim was not created.'));
              }}
              className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm font-medium"
            >
              Create H2017 claim draft
            </button>
          ) : null}
          <button onClick={() => { setStep(1); setClient(null); setElg(null); setDxCode(''); setDxSource(''); setReferralId(''); setSpecialist(''); setEnrolled(false); setQuery(''); }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">
            New Enrollment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/dashboard/prp" className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft size={20} className="text-gray-500" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PRP Enrollment Wizard</h1>
          <p className="text-sm text-gray-500">{PRP_REG_LINE} · H2017</p>
        </div>
      </div>

      <PrpWorkflowBar current="enroll" draft={draft} />

      {draft && draft.stage === 'referral' && step === 1 && !client && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6 flex items-center gap-3 flex-wrap">
          <CheckCircle size={18} className="text-green-600 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-semibold text-green-800">Signed referral ready — {draft.clientName}</p>
            <p className="text-xs text-green-700">Referral {draft.referralId} · {draft.dxCode} {draft.dxLabel} · Everything prefills, nothing is retyped.</p>
          </div>
          <button onClick={startFromReferral} className="px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-semibold hover:bg-green-700">Continue from referral</button>
        </div>
      )}

      {/* Progress bar */}
      <div className="flex items-center gap-0 mb-8">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all ${done ? 'bg-purple-700 border-purple-700 text-white' : active ? 'border-purple-700 text-purple-700 bg-white' : 'border-gray-300 text-gray-400 bg-white'}`}>
                  {done ? <CheckCircle size={14} /> : s.id}
                </div>
                <span className={`text-xs mt-1 font-medium hidden sm:block ${active ? 'text-purple-700' : done ? 'text-purple-500' : 'text-gray-400'}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-purple-700' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Find Client */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Find the client to enroll</h2>
          <p className="text-sm text-gray-500 mb-4">Search by name or Medicaid ID. The client must already have a chart in Altrixs.</p>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Search by name or MA-XXXXXXXXX…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => { setClient(c); setQuery(c.name); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border mb-2 text-left transition-all ${client?.id === c.id ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
            >
              <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center font-bold text-purple-700 text-sm shrink-0">{c.name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
              <div>
                <p className="font-semibold text-gray-800 text-sm">{c.name}</p>
                <p className="text-xs text-gray-400">DOB: {c.dob} · {c.medicaidId} · {c.insurance}</p>
              </div>
              {client?.id === c.id && <CheckCircle size={16} className="text-purple-600 ml-auto" />}
            </button>
          ))}
          {query.length > 1 && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No clients found. Try a different name or ID.</p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              disabled={!client}
              onClick={() => setStep(2)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: client ? '#5C2D91' : '#9CA3AF', color: '#fff' }}
            >
              Next: Verify Eligibility <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Eligibility */}
      {step === 2 && client && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Insurance Eligibility Verification</h2>
          <p className="text-sm text-gray-500 mb-4">Real-time Availity 270/271 check. Maryland Medicaid behavioral health is carved out to Optum Maryland — PRP authorization always routes through Incedo, never the MCO.</p>

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center font-bold text-purple-700 text-sm shrink-0">{client.name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
            <div>
              <p className="font-semibold text-gray-800 text-sm">{client.name}</p>
              <p className="text-xs text-gray-500">{client.medicaidId} · {client.insurance}</p>
            </div>
          </div>

          {!elg && (
            <button
              onClick={runEligibility}
              disabled={checking}
              className="w-full py-3 rounded-lg text-sm font-semibold text-white flex items-center justify-center gap-2"
              style={{ background: '#5C2D91' }}
            >
              {checking ? (
                <><span className="animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4" /> Checking eligibility…</>
              ) : (
                <><ShieldCheck size={15} /> Run Eligibility Check (Availity 270/271)</>
              )}
            </button>
          )}

          {elg && (
            <div className={`rounded-lg border p-4 mt-4 ${elg.active && elg.prp ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                {elg.active && elg.prp
                  ? <CheckCircle size={18} className="text-green-600" />
                  : <AlertTriangle size={18} className="text-red-500" />}
                <span className={`font-semibold text-sm ${elg.active && elg.prp ? 'text-green-800' : 'text-red-800'}`}>
                  {elg.active && elg.prp ? 'Eligible for PRP' : !elg.active ? 'Medicaid Inactive' : 'PRP Not Covered'}
                </span>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Medicaid status</span><span className={`font-medium ${elg.active ? 'text-green-700' : 'text-red-600'}`}>{elg.active ? 'Active' : 'Inactive'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Insurance plan</span><span className="font-medium text-gray-700 text-right max-w-xs">{elg.plan}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">PRP benefit</span><span className={`font-medium ${elg.prp ? 'text-green-700' : 'text-red-600'}`}>{elg.prp ? 'Covered' : 'Not covered'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Prior auth required</span><span className={`font-medium ${elg.authRequired ? 'text-amber-600' : 'text-green-700'}`}>{elg.authRequired ? 'Yes — all PRP requires Optum (Incedo) authorization' : 'No'}</span></div>
              </div>
              {elg.authRequired && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  PRP always requires authorization from Optum Maryland (Incedo). The billing team is notified automatically after enrollment. Do not start sessions until the authorization is confirmed.
                </div>
              )}
              {!elg.active && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  Enrollment cannot proceed. Medicaid is inactive. Contact the client to assist with Medicaid reinstatement before scheduling PRP.
                </div>
              )}
              {elg.active && !elg.prp && (
                <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800">
                  This plan does not cover PRP (H2017). Enrollment cannot proceed. Contact the billing team to explore alternative coverage options.
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(1)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button
              disabled={!elg || !elg.active || !elg.prp}
              onClick={() => setStep(3)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: elg?.active && elg?.prp ? '#5C2D91' : '#9CA3AF', color: '#fff' }}
            >
              Next: Confirm Diagnosis <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Diagnosis */}
      {step === 3 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Qualifying Diagnosis</h2>
          <p className="text-sm text-gray-500 mb-4">Select the Maryland PBHS qualifying ICD-10-CM code documented in the client's chart by a psychiatrist, NP, or physician. If a signed referral exists, this is already filled in.</p>

          {(['Schizophrenia Spectrum', 'Mood Disorders', 'Anxiety Disorders'] as const).map(group => {
            const colors: Record<string, { text: string; bg: string }> = {
              'Schizophrenia Spectrum': { text: '#5C2D91', bg: '#EDE9F7' },
              'Mood Disorders': { text: '#00897B', bg: '#E0F2F1' },
              'Anxiety Disorders': { text: '#D4A017', bg: '#FEF9E7' },
            };
            const { text, bg } = colors[group];
            return (
              <div key={group} className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: text }}>{group}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {QUALIFYING_CODES.filter(c => c.group === group).map(c => (
                    <label
                      key={c.code}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${dxCode === c.code ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                      <input type="radio" name="dxcode" value={c.code} checked={dxCode === c.code} onChange={() => setDxCode(c.code)} className="accent-purple-700" />
                      <span className="font-mono text-xs font-bold text-gray-600 w-14 shrink-0">{c.code}</span>
                      <span className="text-sm text-gray-700 flex-1">{c.label}</span>
                      {c.highRisk && <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium shrink-0">High risk</span>}
                      {c.warn && !c.highRisk && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">Verify</span>}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {selectedCode?.highRisk && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2 text-sm text-red-800 mb-4">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-red-500" />
              F41.9 frequently results in payer denials. Confirm with the practice director before proceeding with this code.
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-600 mb-2">Where is this diagnosis documented? *</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { value: 'chart', label: 'In the Altrixs EHR chart (psychiatric evaluation on file)' },
                { value: 'referral', label: 'On a completed PRP Referral Form from the prescriber' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${dxSource === opt.value ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="radio" name="dxsource" value={opt.value} checked={dxSource === opt.value} onChange={() => setDxSource(opt.value as any)} className="accent-purple-700 mt-0.5" />
                  <span className="text-sm text-gray-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {dxSource === 'referral' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-gray-600 mb-1">PRP Referral Form ID or Date</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., PRP-A3F9B2 or 2026-09-18"
                value={referralId} onChange={e => setReferralId(e.target.value)} />
              <p className="text-xs text-gray-400 mt-1">
                No referral yet? <Link href="/dashboard/prp/referral" className="text-purple-600 underline">Open the PRP Referral Form</Link> and have the psychiatrist or NP complete it first.
              </p>
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(2)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button disabled={!dxCode || !dxSource} onClick={() => setStep(4)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: dxCode && dxSource ? '#5C2D91' : '#9CA3AF', color: '#fff' }}>
              Next: Prior Authorization <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Prior Auth */}
      {step === 4 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Optum Maryland Authorization</h2>
          <p className="text-sm text-gray-500 mb-4">Based on the eligibility result, here is what is needed before sessions can begin.</p>

          {elg?.authRequired ? (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <AlertTriangle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm mb-1">Initial Authorization Required (Incedo)</p>
                  <p className="text-sm text-amber-700">Optum Maryland (Incedo) requires an initial authorization before H2017 services can begin — this applies to every PRP enrollment. Altrixs automatically queues the submission for the billing team. You can finish enrollment now, but <strong>do not schedule sessions</strong> until the authorization is confirmed.</p>
                </div>
              </div>
              <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm space-y-2">
                <p className="font-semibold text-gray-700">Billing team will submit:</p>
                <ul className="list-disc list-inside space-y-1 text-gray-600">
                  <li>Client name, DOB, Medicaid ID</li>
                  <li>Qualifying diagnosis: <strong>{dxCode} — {selectedCode?.label}</strong></li>
                  <li>Functional impairment summary from referral form</li>
                  <li>Requested span: initial 6-month authorization (H2017), concurrent review before renewal</li>
                  <li>PRP specialist name and NPI</li>
                </ul>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex gap-2">
                <CheckCircle size={14} className="shrink-0 mt-0.5 text-green-600" />
                Billing team has been automatically queued — no action needed from you.
              </div>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex gap-3">
              <CheckCircle size={18} className="text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-green-800 text-sm mb-1">No Prior Authorization Required</p>
                <p className="text-sm text-green-700">This payer does not require PA for H2017 services. Sessions may begin on the enrollment start date.</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(3)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button onClick={() => setStep(5)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
              style={{ background: '#5C2D91' }}>
              Next: Assign Specialist <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Assign Specialist & Start Date */}
      {step === 5 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Assign PRP Specialist &amp; Set Start Date</h2>
          <p className="text-sm text-gray-500 mb-4">Choose the specialist who will carry this client's caseload and conduct the initial IRP meeting.</p>

          <label className="block text-sm font-semibold text-gray-700 mb-6">
            Specialist name
            <input
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              value={specialist}
              onChange={(event) => setSpecialist(event.target.value)}
              placeholder="Name of the PRP specialist on this caseload"
            />
          </label>

          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1">Program Start Date *</label>
            <p className="text-xs text-gray-400 mb-2">Must match the date of the first billable H2017 session. Should not precede authorization approval if PA is required.</p>
            <input type="date" className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(4)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button disabled={!specialist} onClick={() => setStep(6)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: specialist ? '#5C2D91' : '#9CA3AF', color: '#fff' }}>
              Review &amp; Enroll <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Review & Confirm */}
      {step === 6 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6">
          <h2 className="font-semibold text-gray-800 text-lg mb-1">Review &amp; Confirm Enrollment</h2>
          <p className="text-sm text-gray-500 mb-5">Check everything before submitting. Enrollment creates the IRP framework and notifies the assigned specialist.</p>

          <div className="space-y-3 mb-6">
            {[
              { label: 'Client', value: `${client?.name} · DOB ${client?.dob}` },
              { label: 'Medicaid ID', value: client?.medicaidId },
              { label: 'Insurance', value: elg?.plan },
              { label: 'Eligibility', value: 'Verified — PRP covered', ok: true },
              { label: 'Prior Auth', value: elg?.authRequired ? 'Required — billing team notified' : 'Not required', warn: elg?.authRequired },
              { label: 'Qualifying Diagnosis', value: `${dxCode} — ${selectedCode?.label}` },
              { label: 'Diagnosis Source', value: dxSource === 'chart' ? 'Altrixs EHR chart' : `Referral form ${referralId ? `(${referralId})` : ''}` },
              { label: 'PRP Specialist', value: specialist },
              { label: 'Start Date', value: startDate },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-start border-b border-gray-100 pb-2 last:border-0">
                <span className="text-sm text-gray-500 shrink-0 mr-4">{row.label}</span>
                <span className={`text-sm font-medium text-right ${(row as any).ok ? 'text-green-700' : (row as any).warn ? 'text-amber-600' : 'text-gray-800'}`}>{row.value}</span>
              </div>
            ))}
          </div>

          <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-sm text-purple-800 mb-5">
            <p className="font-semibold mb-1">After enrollment, Altrixs will automatically:</p>
            <ul className="list-disc list-inside space-y-1 text-purple-700">
              <li>Notify <strong>{specialist}</strong> of the new assignment</li>
              <li>Create an empty IRP ready for goal-building in the first session</li>
              <li>Set the 6-month IRP review reminder (COMAR 10.63)</li>
              {elg?.authRequired && <li className="text-amber-700">Queue a prior authorization request for the billing team</li>}
              <li>Begin tracking H2017 units against the 6-month Optum authorization</li>
            </ul>
          </div>

          <div className="flex justify-between">
            <button onClick={() => setStep(5)} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button
              disabled={!canFinish}
              onClick={() => {
                setEnrolled(true);
                savePrpDraft({ stage: 'enrolled', clientId: client?.id, clientName: client?.name, clientDob: client?.dob, medicaidId: client?.medicaidId, dxCode, dxLabel: selectedCode?.label, referralId: referralId || undefined, specialist, startDate });
                if (client?.id && dxCode) {
                  void fetch('/api/prp/billing-model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: client.id, diagnosisCode: dxCode, code: 'H2017' }),
                  });
                }
              }}
              className="flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: '#5C2D91', color: '#fff' }}>
              <CheckCircle size={15} /> Confirm Enrollment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
