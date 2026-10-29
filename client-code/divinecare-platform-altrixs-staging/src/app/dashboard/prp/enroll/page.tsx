'use client';
import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, Search, ShieldCheck, FileText, ClipboardList, Users, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ALL_QUALIFYING_CODES, PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, usePrpClients, type PrpDraft } from '../prpShared';
import { apiJson } from '@/lib/api-client';
import { buttonClasses } from '@/components/ui';

const STEPS = [
  { id: 1, label: 'Find Client',   icon: Search },
  { id: 2, label: 'Eligibility',   icon: ShieldCheck },
  { id: 3, label: 'Diagnosis',     icon: FileText },
  { id: 4, label: 'Referral',      icon: ClipboardList },
  { id: 5, label: 'Assign',        icon: Users },
  { id: 6, label: 'Done',          icon: CheckCircle },
];

type EnrollClient = { id: string; name: string; dob: string; medicaidId: string; insurance: string };

const QUALIFYING_CODES: { code: string; label: string; group: string; warn?: boolean; highRisk?: boolean }[] = ALL_QUALIFYING_CODES as any;

type Specialist = { id: string; name: string; caseload: number };

// Raw /api/prp/eligibility response is kept as the enrollment's eligibilitySnapshot.
type EligibilityResponse = { active: boolean; prpCovered: boolean | 'unknown'; status?: string; message?: string; testPass?: boolean };
// prp: true = PRP benefit listed in the 271; 'unknown' = coverage active but no PRP benefit returned.
type Elg = { active: boolean; plan: string; prp: boolean | 'unknown'; authRequired: boolean; message?: string; testPass?: boolean; snapshot: EligibilityResponse };

const CUID_RE = /^c[a-z0-9]{20,32}$/;

export default function PRPEnrollPage() {
  const [step, setStep] = useState(1);
  const [query, setQuery] = useState('');
  const [client, setClient] = useState<EnrollClient | null>(null);
  const [elg, setElg] = useState<Elg | null>(null);
  const [elgError, setElgError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [specialists, setSpecialists] = useState<Specialist[]>([]);
  const [specError, setSpecError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [enrollmentId, setEnrollmentId] = useState('');
  const { clients: roster, error: rosterError } = usePrpClients();
  const CLIENT_OPTIONS: EnrollClient[] = roster.map(c => ({ id: c.id, name: c.name, dob: c.dob, medicaidId: c.medicaidId, insurance: c.plan }));
  const SPECIALISTS = specialists;
  useEffect(() => {
    apiJson<{ specialists: Specialist[] }>('/api/prp/specialists')
      .then(d => setSpecialists(d.specialists || []))
      .catch((err: unknown) => setSpecError(err instanceof Error ? err.message : 'Could not load specialists'));
  }, []);
  const [dxCode, setDxCode] = useState('');
  const [dxSource, setDxSource] = useState<'chart' | 'referral' | ''>('');
  const [referralId, setReferralId] = useState('');
  const [specialist, setSpecialist] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [enrolled, setEnrolled] = useState(false);
  const [workflowWarn, setWorkflowWarn] = useState<string | null>(null);
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  useEffect(() => { setDraft(loadPrpDraft()); }, []);

  const startFromReferral = () => {
    if (!draft) return;
    const c = CLIENT_OPTIONS.find(x => x.id === draft.clientId || x.name === draft.clientName);
    if (c) { setClient(c); setQuery(c.name); }
    if (draft.dxCode) { setDxCode(draft.dxCode); setDxSource('referral'); }
    if (draft.referralId) setReferralId(draft.referralId);
    setStep(2);
  };

  const filtered = query.length > 1
    ? CLIENT_OPTIONS.filter(c => c.name.toLowerCase().includes(query.toLowerCase()) || c.medicaidId.includes(query))
    : [];

  // Live Availity 270/271 through /api/prp/eligibility — fails closed, no simulated result.
  const runEligibility = async () => {
    if (!client) return;
    setChecking(true);
    setElgError(null);
    try {
      const res = await apiJson<EligibilityResponse>('/api/prp/eligibility', {
        method: 'POST',
        body: JSON.stringify({ clientId: client.id }),
      });
      setElg({
        active: res.active,
        plan: client.insurance || 'Not on file',
        prp: res.prpCovered,
        // Maryland PRP always routes through Optum (Incedo) authorization.
        authRequired: res.active && res.prpCovered !== false,
        message: res.message,
        testPass: res.testPass,
        snapshot: res,
      });
    } catch (err: unknown) {
      setElgError(err instanceof Error ? err.message : 'Eligibility check failed');
    } finally {
      setChecking(false);
    }
  };

  const confirmEnrollment = async () => {
    if (!client || !elg || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    // Only a real PrpReferral id (from the referral form) can be linked; free-text IDs stay on the workflow record.
    const referralRecordId = draft?.referralRecordId && draft.referralId === referralId
      ? draft.referralRecordId
      : CUID_RE.test(referralId) ? referralId : null;
    try {
      const res = await apiJson<{ enrollment: { id: string; displayId: string | null } }>('/api/prp/enrollments', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client.id,
          referralId: referralRecordId,
          diagnosisCode: dxCode,
          diagnosisSource: dxSource || 'chart',
          eligibilitySnapshot: elg.snapshot,
          specialistId: specialist && specialist !== 'unassigned' ? specialist : null,
          startDate,
        }),
      });
      setEnrollmentId(res.enrollment.displayId || res.enrollment.id);
      const saved = await savePrpDraft(
        { stage: 'enrolled', clientId: client.id, clientName: client.name, clientDob: client.dob, medicaidId: client.medicaidId, dxCode, dxLabel: selectedCode?.label, referralId: referralId || undefined, specialist: selectedSpec?.name, startDate },
        { enrollmentData: { enrollmentId: res.enrollment.id, referralReference: referralId || null, diagnosisSource: dxSource, specialistId: specialist, startDate } }
      );
      // The enrollment itself is saved; only the assessment/IRP prefill record failed.
      setWorkflowWarn(saved.ok ? null : saved.error || 'Save failed');
      setEnrolled(true);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Enrollment failed');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCode = QUALIFYING_CODES.find(c => c.code === dxCode);
  const selectedSpec = SPECIALISTS.find(s => s.id === specialist);

  // Enrollment may proceed when coverage is active and the 271 did not rule PRP out.
  const elgOk = !!elg && elg.active && elg.prp !== false;
  const prpConfirmed = !!elg && elg.active && elg.prp === true;
  const canFinish = client && elgOk && dxCode && dxSource && specialist;

  if (enrolled) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <Sparkles className="text-emerald-700" size={32} />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-2">Enrollment Complete</h2>
        <p className="text-slate-500 mb-6">
          <strong>{client?.name}</strong> is now enrolled in PRP and assigned to <strong>{selectedSpec?.name}</strong>. Let the specialist know — no automatic notification is sent. The IRP will be built in the first two sessions.
        </p>
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-left text-sm text-blue-800 mb-6 space-y-1">
          <p><span className="font-semibold">Enrollment ID:</span> <span className="font-mono">{enrollmentId}</span></p>
          <p><span className="font-semibold">Start Date:</span> {startDate}</p>
          <p><span className="font-semibold">Qualifying Dx:</span> {dxCode} — {selectedCode?.label}</p>
          <p><span className="font-semibold">Specialist:</span> {selectedSpec?.name}</p>
          {elg?.authRequired && <p className="text-amber-700 font-medium flex items-center gap-1"><AlertTriangle size={12} /> Prior authorization required — submit it to Optum Maryland (Incedo) before the first session</p>}
        </div>
        {workflowWarn && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-left text-xs text-amber-800 mb-6 flex gap-2">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" />
            The enrollment is saved, but the PRP workflow record was not ({workflowWarn}). The assessment and IRP will not be prefilled from the server; enter the client details there manually.
          </div>
        )}
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/dashboard/prp" className="px-4 py-2 bg-blue-700 text-white rounded-lg text-sm font-medium hover:bg-blue-800">PRP Dashboard</Link>
          <Link href="/dashboard/prp/irp" className="px-4 py-2 border border-blue-300 text-blue-700 rounded-lg text-sm font-medium hover:bg-blue-50">Build IRP</Link>
          <button onClick={() => { setStep(1); setClient(null); setElg(null); setDxCode(''); setDxSource(''); setReferralId(''); setSpecialist(''); setEnrolled(false); setQuery(''); setEnrollmentId(''); setElgError(null); setSubmitError(null); setWorkflowWarn(null); }}
            className="px-4 py-2 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">
            New Enrollment
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-8">
        <Link href="/dashboard/prp" aria-label="Back to PRP Program" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ChevronLeft size={20} className="text-slate-500" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">PRP Enrollment Wizard</h1>
          <p className="text-sm text-slate-500">{PRP_REG_LINE} · billing pending confirmation (H2018 + H2016)</p>
        </div>
      </div>

      <PrpWorkflowBar current="enroll" draft={draft} />

      {draft && draft.stage === 'referral' && step === 1 && !client && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 flex items-center gap-3 flex-wrap">
          <CheckCircle size={18} className="text-emerald-700 shrink-0" />
          <div className="flex-1 min-w-[220px]">
            <p className="text-sm font-semibold text-emerald-800">Signed referral ready — {draft.clientName}</p>
            <p className="text-xs text-emerald-700">Referral {draft.referralId} · {draft.dxCode} {draft.dxLabel} · Everything prefills, nothing is retyped.</p>
          </div>
          <button onClick={startFromReferral} className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700">Continue from referral</button>
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
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 transition-all ${done ? 'bg-blue-700 border-blue-700 text-white' : active ? 'border-blue-700 text-blue-700 bg-white' : 'border-slate-300 text-slate-500 bg-white'}`}>
                  {done ? <CheckCircle size={14} /> : s.id}
                </div>
                <span className={`text-xs mt-1 font-medium hidden sm:block ${active ? 'text-blue-700' : done ? 'text-blue-500' : 'text-slate-500'}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 ${done ? 'bg-blue-700' : 'bg-slate-200'}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: Find Client */}
      {step === 1 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Find the client to enroll</h2>
          <p className="text-sm text-slate-500 mb-4">Search by name or Medicaid ID. The client must already have a chart in Altrixs.</p>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Search by name or MA-XXXXXXXXX…"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          {filtered.map(c => (
            <button
              key={c.id}
              onClick={() => { setClient(c); setQuery(c.name); }}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border mb-2 text-left transition-all ${client?.id === c.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
            >
              <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center font-semibold text-blue-700 text-sm shrink-0">{c.name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
              <div>
                <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
                <p className="text-xs text-slate-500">DOB: {c.dob} · {c.medicaidId} · {c.insurance}</p>
              </div>
              {client?.id === c.id && <CheckCircle size={16} className="text-blue-600 ml-auto" />}
            </button>
          ))}
          {rosterError && <p className="text-sm text-rose-600 text-center py-2">Could not load the client roster: {rosterError}</p>}
          {query.length > 1 && filtered.length === 0 && (
            <p className="text-sm text-slate-500 text-center py-4">No clients found. Try a different name or ID.</p>
          )}
          <div className="mt-6 flex justify-end">
            <button
              disabled={!client}
              onClick={() => setStep(2)}
              className={buttonClasses({ size: 'lg' })}
            >
              Next: Verify Eligibility <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Eligibility */}
      {step === 2 && client && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Insurance Eligibility Verification</h2>
          <p className="text-sm text-slate-500 mb-4">Real-time Availity 270/271 check. Maryland Medicaid behavioral health is carved out to Optum Maryland — PRP authorization always routes through Incedo, never the MCO.</p>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center font-semibold text-blue-700 text-sm shrink-0">{client.name.split(' ').map(n => n[0]).join('').slice(0,2)}</div>
            <div>
              <p className="font-semibold text-slate-800 text-sm">{client.name}</p>
              <p className="text-xs text-slate-500">{client.medicaidId} · {client.insurance}</p>
            </div>
          </div>

          {elgError && (
            <div className="mb-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800 flex gap-2">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              Eligibility not verified: {elgError}. Enrollment cannot proceed until a live 271 confirms coverage.
            </div>
          )}

          {!elg && (
            <button
              onClick={runEligibility}
              disabled={checking}
              className={buttonClasses({ size: 'lg', className: 'w-full' })}
            >
              {checking ? (
                <><span className="animate-spin border-2 border-white border-t-transparent rounded-full w-4 h-4" /> Checking eligibility…</>
              ) : (
                <><ShieldCheck size={15} /> Run Eligibility Check (Availity 270/271)</>
              )}
            </button>
          )}

          {elg && (
            <div className={`rounded-lg border p-4 mt-4 ${prpConfirmed ? 'border-emerald-300 bg-emerald-50' : elgOk ? 'border-amber-300 bg-amber-50' : 'border-rose-300 bg-rose-50'}`}>
              <div className="flex items-center gap-2 mb-3">
                {prpConfirmed
                  ? <CheckCircle size={18} className="text-emerald-700" />
                  : <AlertTriangle size={18} className={elgOk ? 'text-amber-700' : 'text-rose-600'} />}
                <span className={`font-semibold text-sm ${prpConfirmed ? 'text-emerald-800' : elgOk ? 'text-amber-800' : 'text-rose-800'}`}>
                  {prpConfirmed ? 'Eligible for PRP' : elgOk ? 'Coverage active — PRP benefit not confirmed in 271' : !elg.active ? 'Coverage Inactive' : 'PRP Not Covered'}
                </span>
              </div>
              {elg.message && <p className="text-xs text-slate-600 mb-2">{elg.message}</p>}
              {elg.testPass && <p className="text-xs font-semibold text-amber-700 mb-2">TEST PASS — not a live Availity response.</p>}
              <div className="space-y-1 text-sm">
                <div className="flex justify-between gap-3"><span className="shrink-0 text-slate-500">Medicaid status</span><span className={`font-medium ${elg.active ? 'text-emerald-700' : 'text-rose-600'}`}>{elg.active ? 'Active' : 'Inactive'}</span></div>
                <div className="flex justify-between gap-3"><span className="shrink-0 text-slate-500">Insurance plan</span><span className="min-w-0 break-words font-medium text-slate-700 text-right max-w-xs">{elg.plan}</span></div>
                <div className="flex justify-between gap-3"><span className="shrink-0 text-slate-500">PRP benefit</span><span className={`font-medium ${elg.prp === true ? 'text-emerald-700' : elg.prp === 'unknown' ? 'text-amber-700' : 'text-rose-600'}`}>{elg.prp === true ? 'Listed in 271' : elg.prp === 'unknown' ? 'Not confirmed — verify with Optum authorization' : 'Not covered'}</span></div>
                <div className="flex justify-between gap-3"><span className="shrink-0 text-slate-500">Prior auth required</span><span className={`font-medium ${elg.authRequired ? 'text-amber-700' : 'text-emerald-700'}`}>{elg.authRequired ? 'Yes — all PRP requires Optum (Incedo) authorization' : 'No'}</span></div>
              </div>
              {elg.authRequired && (
                <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
                  <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                  PRP always requires authorization from Optum Maryland (Incedo). Submit the authorization request after enrollment — it is not sent automatically. Do not start sessions until the authorization is confirmed.
                </div>
              )}
              {!elg.active && (
                <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800">
                  Enrollment cannot proceed. Medicaid is inactive. Contact the client to assist with Medicaid reinstatement before scheduling PRP.
                </div>
              )}
              {elg.active && elg.prp === false && (
                <div className="mt-3 bg-rose-50 border border-rose-200 rounded-lg p-3 text-xs text-rose-800">
                  This plan does not cover PRP. Enrollment cannot proceed. Contact the billing team to explore alternative coverage options.
                </div>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setStep(1)} className="min-h-10 text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button
              disabled={!elgOk}
              onClick={() => setStep(3)}
              className={buttonClasses({ size: 'lg' })}
            >
              Next: Confirm Diagnosis <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Diagnosis */}
      {step === 3 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Qualifying Diagnosis</h2>
          <p className="text-sm text-slate-500 mb-4">Select the Maryland PBHS qualifying ICD-10-CM code documented in the client&apos;s chart by a psychiatrist, NP, or physician. If a signed referral exists, this is already filled in.</p>

          {(['Schizophrenia Spectrum', 'Mood Disorders', 'Anxiety Disorders'] as const).map(group => {
            return (
              <div key={group} className="mb-4">
                <p className="text-xs font-semibold uppercase tracking-wider mb-2 text-slate-600">{group}</p>
                <div className="grid grid-cols-1 gap-1.5">
                  {QUALIFYING_CODES.filter(c => c.group === group).map(c => (
                    <label
                      key={c.code}
                      className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-all ${dxCode === c.code ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <input type="radio" name="dxcode" value={c.code} checked={dxCode === c.code} onChange={() => setDxCode(c.code)} className="accent-blue-700" />
                      <span className="font-mono text-xs font-semibold text-slate-600 w-14 shrink-0">{c.code}</span>
                      <span className="text-sm text-slate-700 flex-1">{c.label}</span>
                      {c.highRisk && <span className="text-xs bg-rose-100 text-rose-700 px-2 py-0.5 rounded-full font-medium shrink-0">High risk</span>}
                      {c.warn && !c.highRisk && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium shrink-0">Verify</span>}
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {selectedCode?.highRisk && (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex gap-2 text-sm text-rose-800 mb-4">
              <AlertTriangle size={14} className="shrink-0 mt-0.5 text-rose-600" />
              F41.9 frequently results in payer denials. Confirm with the practice director before proceeding with this code.
            </div>
          )}

          <div className="mt-4">
            <p className="text-xs font-semibold text-slate-600 mb-2">Where is this diagnosis documented? *</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { value: 'chart', label: 'In the Altrixs EHR chart (psychiatric evaluation on file)' },
                { value: 'referral', label: 'On a completed PRP Referral Form from the prescriber' },
              ].map(opt => (
                <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${dxSource === opt.value ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input type="radio" name="dxsource" value={opt.value} checked={dxSource === opt.value} onChange={() => setDxSource(opt.value as any)} className="accent-blue-700 mt-0.5" />
                  <span className="text-sm text-slate-700">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>

          {dxSource === 'referral' && (
            <div className="mt-3">
              <label className="block text-xs font-semibold text-slate-600 mb-1">PRP Referral Form ID or Date</label>
              <input className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., PRP-A3F9B2 or 2026-09-18"
                value={referralId} onChange={e => setReferralId(e.target.value)} />
              <p className="text-xs text-slate-500 mt-1">
                No referral yet? <Link href="/dashboard/prp/referral" className="text-blue-600 underline">Open the PRP Referral Form</Link> and have the psychiatrist or NP complete it first.
              </p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setStep(2)} className="min-h-10 text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button disabled={!dxCode || !dxSource} onClick={() => setStep(4)}
              className={buttonClasses({ size: 'lg' })}>
              Next: Prior Authorization <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Prior Auth */}
      {step === 4 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Optum Maryland Authorization</h2>
          <p className="text-sm text-slate-500 mb-4">Based on the eligibility result, here is what is needed before sessions can begin.</p>

          {elg?.authRequired ? (
            <div className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3">
                <AlertTriangle size={18} className="text-amber-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm mb-1">Initial Authorization Required (Incedo)</p>
                  <p className="text-sm text-amber-700">The ASO requires an initial authorization before PRP services can begin. Altrixs does not submit it: create the request under Prior Authorizations (or in the ASO portal). You can finish enrollment now, but <strong>do not schedule sessions</strong> until the authorization is confirmed.</p>
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-4 text-sm space-y-2">
                <p className="font-semibold text-slate-700">The authorization request needs:</p>
                <ul className="list-disc list-inside space-y-1 text-slate-600">
                  <li>Client name, DOB, Medicaid ID</li>
                  <li>Qualifying diagnosis: <strong>{dxCode} — {selectedCode?.label}</strong></li>
                  <li>Functional impairment summary from referral form</li>
                  <li>Requested span: per Optum Maryland PRP Adult guidance (Mar 2023) the initial adult authorization is 2 units (the rest of the starting month plus the next full month); concurrent reviews up to 6 months. Confirm against the current ASO manual.</li>
                  <li>PRP specialist name and NPI</li>
                </ul>
              </div>
              <a href="/dashboard/prior-auth" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 hover:underline">
                Open Prior Authorizations
              </a>
            </div>
          ) : (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex gap-3">
              <CheckCircle size={18} className="text-emerald-700 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-emerald-800 text-sm mb-1">No Prior Authorization Required</p>
                <p className="text-sm text-emerald-700">The eligibility response did not indicate a prior authorization requirement for PRP. Confirm with the payer before the first session. Sessions may begin on the enrollment start date.</p>
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setStep(3)} className="min-h-10 text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button onClick={() => setStep(5)}
              className={buttonClasses({ size: 'lg' })}>
              Next: Assign Specialist <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 5: Assign Specialist & Start Date */}
      {step === 5 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Assign PRP Specialist &amp; Set Start Date</h2>
          <p className="text-sm text-slate-500 mb-4">Choose the specialist who will carry this client&apos;s caseload and conduct the initial IRP meeting.</p>

          <div className="space-y-2 mb-6">
            {specError && <p className="text-sm text-rose-600 text-center py-2">Could not load specialists: {specError}</p>}
            {SPECIALISTS.length === 0 && !specError && (
              <p className="text-sm text-slate-500 text-center py-4">No PRP specialists on staff yet.</p>
            )}
            {[...SPECIALISTS, { id: 'unassigned', name: 'Assign later (unassigned)', caseload: -1 }].map(s => (
              <label key={s.id} className={`flex items-center gap-4 p-3.5 rounded-xl border cursor-pointer transition-all ${specialist === s.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                <input type="radio" name="spec" value={s.id} checked={specialist === s.id} onChange={() => setSpecialist(s.id)} className="accent-blue-700" />
                <div className="flex-1">
                  <p className="font-semibold text-sm text-slate-800">{s.name}</p>
                  {s.caseload >= 0 && (
                    <p className="text-xs text-slate-500 mt-0.5">{s.caseload} active PRP {s.caseload === 1 ? 'participant' : 'participants'}</p>
                  )}
                </div>
                {specialist === s.id && <CheckCircle size={16} className="text-blue-600" />}
              </label>
            ))}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Program Start Date *</label>
            <p className="text-xs text-slate-500 mb-2">Must match the date of the first billable PRP encounter. Should not precede authorization approval if PA is required.</p>
            <input type="date" className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setStep(4)} className="min-h-10 text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button disabled={!specialist} onClick={() => setStep(6)}
              className={buttonClasses({ size: 'lg' })}>
              Review &amp; Enroll <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* Step 6: Review & Confirm */}
      {step === 6 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6">
          <h2 className="font-semibold text-slate-800 text-lg mb-1">Review &amp; Confirm Enrollment</h2>
          <p className="text-sm text-slate-500 mb-5">Check everything before submitting. Confirming saves the enrollment record; nothing is sent to the specialist automatically.</p>

          <div className="space-y-3 mb-6">
            {[
              { label: 'Client', value: `${client?.name} · DOB ${client?.dob}` },
              { label: 'Medicaid ID', value: client?.medicaidId },
              { label: 'Insurance', value: elg?.plan },
              prpConfirmed
                ? { label: 'Eligibility', value: 'Active — PRP benefit listed in 271', ok: true }
                : { label: 'Eligibility', value: 'Active — PRP benefit not confirmed in 271', warn: true },
              { label: 'Prior Auth', value: elg?.authRequired ? 'Required — submit to Optum (Incedo)' : 'Not required', warn: elg?.authRequired },
              { label: 'Qualifying Diagnosis', value: `${dxCode} — ${selectedCode?.label}` },
              { label: 'Diagnosis Source', value: dxSource === 'chart' ? 'Altrixs EHR chart' : `Referral form ${referralId ? `(${referralId})` : ''}` },
              { label: 'PRP Specialist', value: selectedSpec?.name },
              { label: 'Start Date', value: startDate },
            ].map(row => (
              <div key={row.label} className="flex justify-between items-start border-b border-slate-100 pb-2 last:border-0">
                <span className="text-sm text-slate-500 shrink-0 mr-4">{row.label}</span>
                <span className={`text-sm font-medium text-right ${(row as any).ok ? 'text-emerald-700' : (row as any).warn ? 'text-amber-700' : 'text-slate-800'}`}>{row.value}</span>
              </div>
            ))}
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800 mb-5">
            <p className="font-semibold mb-1">Confirming saves the PRP enrollment record. Still done by staff (not automated yet):</p>
            <ul className="list-disc list-inside space-y-1 text-blue-700">
              <li>Tell <strong>{selectedSpec?.name}</strong> about the new assignment</li>
              <li>Build the IRP in the first two sessions and set the 6-month review date (COMAR 10.63)</li>
              {elg?.authRequired && <li className="text-amber-700">Submit the prior authorization request to Optum Maryland (Incedo)</li>}
            </ul>
          </div>
          {submitError && (
            <div className="mb-4 bg-rose-50 border border-rose-200 rounded-lg p-3 text-sm text-rose-800">Enrollment not saved: {submitError}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setStep(5)} className="min-h-10 text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1"><ChevronLeft size={14} /> Back</button>
            <button
              disabled={!canFinish || submitting}
              onClick={confirmEnrollment}
              className={buttonClasses({ size: 'lg' })}>
              <CheckCircle size={15} /> {submitting ? 'Saving…' : 'Confirm Enrollment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
