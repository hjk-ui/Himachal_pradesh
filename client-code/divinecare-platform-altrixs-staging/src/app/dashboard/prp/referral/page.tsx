'use client';
import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, CheckCircle, AlertTriangle, Info, Send, User, Stethoscope, ClipboardList, FileText, Gauge, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import {
  QUALIFYING_CODE_GROUPS, ALL_QUALIFYING_CODES, PRP_DOMAINS,
  PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, usePrpClients, type PrpDraft,
} from '../prpShared';
import { apiJson } from '@/lib/api-client';
import { buttonClasses } from '@/components/ui';
import { PRP_REFERRER_CREDENTIALS, referralIssues } from '@/lib/prp/standard';

const IMPAIRMENT_LEVELS = [
  { value: '1', label: '1 – Unable to perform independently' },
  { value: '2', label: '2 – Requires significant support' },
  { value: '3', label: '3 – Requires moderate support' },
  { value: '4', label: '4 – Requires minimal support' },
  { value: '5', label: '5 – Fully independent' },
];

type FormState = {
  clientName: string;
  clientDOB: string;
  clientMedicaidId: string;
  selectedCode: string;
  diagnosisNarrative: string;
  impairment: Record<string, string>;
  recommendedDomains: string[];
  hospitalizations: string;
  functionalNarrative: string;
  prpJustification: string;
  prescriberName: string;
  prescriberNPI: string;
  prescriberLicense: string;
  referrerCredential: string;
  referrerLicenseState: string;
  referrerIsTreating: boolean;
  prescriberSignature: string;
};

const empty: FormState = {
  clientName: '', clientDOB: '', clientMedicaidId: '',
  selectedCode: '', diagnosisNarrative: '',
  impairment: {},
  recommendedDomains: [],
  hospitalizations: '', functionalNarrative: '', prpJustification: '',
  prescriberName: '', prescriberNPI: '', prescriberLicense: '', prescriberSignature: '',
  referrerCredential: '', referrerLicenseState: 'MD', referrerIsTreating: false,
};

export default function PRPReferralPage() {
  const [form, setForm] = useState<FormState>(empty);
  const [submitted, setSubmitted] = useState(false);
  const [referralId, setReferralId] = useState('');
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { clients: PRP_CLIENTS } = usePrpClients();
  useEffect(() => { setDraft(loadPrpDraft()); }, []);
  // ?clientId= (Service Eligibility Scanner "Refer"): pick that chart once the roster loads.
  const [presetDone, setPresetDone] = useState(false);
  useEffect(() => {
    if (presetDone || !PRP_CLIENTS.length) return;
    const id = new URLSearchParams(window.location.search).get('clientId');
    const match = id ? PRP_CLIENTS.find(c => c.id === id) : undefined;
    if (match) setForm(prev => (prev.clientName ? prev : { ...prev, clientName: match.name, clientDOB: match.dob, clientMedicaidId: match.medicaidId }));
    setPresetDone(true);
  }, [PRP_CLIENTS, presetDone]);

  const selectedCodeObj = ALL_QUALIFYING_CODES.find(c => c.code === form.selectedCode);
  const isHighRisk = (selectedCodeObj as any)?.highRisk === true;
  const isConditional = selectedCodeObj?.strength === 'conditional';

  const set = (field: keyof FormState, value: any) =>
    setForm(prev => ({ ...prev, [field]: value }));

  // Smart picker: an exact roster match fills DOB + Medicaid ID automatically.
  const pickClient = (name: string) => {
    const match = PRP_CLIENTS.find(c => c.name.toLowerCase() === name.trim().toLowerCase());
    setForm(prev => ({
      ...prev,
      clientName: name,
      clientDOB: match ? match.dob : prev.clientDOB,
      clientMedicaidId: match ? match.medicaidId : prev.clientMedicaidId,
    }));
  };

  const toggleDomain = (d: string) =>
    set('recommendedDomains', form.recommendedDomains.includes(d)
      ? form.recommendedDomains.filter(x => x !== d)
      : [...form.recommendedDomains, d]);

  // Smart scoring: rating a domain 3 or below auto-recommends it for the IRP.
  const setImpairment = (domain: string, value: string) => {
    setForm(prev => {
      const recommended = Number(value) <= 3 && !prev.recommendedDomains.includes(domain)
        ? [...prev.recommendedDomains, domain]
        : prev.recommendedDomains;
      return { ...prev, impairment: { ...prev.impairment, [domain]: value }, recommendedDomains: recommended };
    });
  };

  // Live medical-necessity strength meter — mirrors what Optum reviewers weigh.
  const necessity = useMemo(() => {
    const tips: string[] = [];
    let score = 0;
    if (selectedCodeObj) {
      if (selectedCodeObj.strength === 'strong') score += 3;
      else { score += 1; tips.push('Anxiety-spectrum codes are conditional for adult PRP — the functional narrative must carry the case.'); }
      if (isHighRisk) { score -= 1; tips.push('F41.9 is routinely denied. Use a more specific code if one is documented.'); }
    } else tips.push('Select the qualifying diagnosis.');
    const severeCount = Object.values(form.impairment).filter(v => Number(v) <= 2).length;
    if (severeCount >= 2) score += 2;
    else if (severeCount === 1) score += 1;
    else tips.push('Rate at least two domains at level 1–2 if clinically accurate — reviewers look for significant impairment.');
    if (form.hospitalizations.trim()) score += 1; else tips.push('Add psychiatric hospitalization history if any — it strongly supports necessity.');
    if (form.functionalNarrative.trim().length >= 200) score += 2;
    else if (form.functionalNarrative.trim().length > 0) { score += 1; tips.push('Expand the functional narrative — tie each deficit to the diagnosis with concrete examples.'); }
    else tips.push('Write the functional impairment narrative.');
    if (form.prpJustification.trim().length >= 200) score += 2;
    else if (form.prpJustification.trim().length > 0) { score += 1; tips.push('Strengthen the justification — say why therapy alone is insufficient and name the rehabilitation outcome.'); }
    else tips.push('Write the medical-necessity justification.');
    const level = score >= 7 ? 'strong' : score >= 4 ? 'moderate' : 'weak';
    return { score, level, tips } as const;
  }, [form, selectedCodeObj, isHighRisk]);

  const npiValid = /^\d{10}$/.test(form.prescriberNPI);
  const signatureMatches = form.prescriberSignature.trim().length > 0 &&
    form.prescriberSignature.trim().toLowerCase() === form.prescriberName.trim().toLowerCase();

  // Referring licensed mental health professional + functional impairment (same check the API runs)
  const referrerMissing = referralIssues({
    referrerCredential: form.referrerCredential,
    licenseNumber: form.prescriberLicense,
    referrerLicenseState: form.referrerLicenseState,
    referrerIsTreating: form.referrerIsTreating,
    prescriberNpi: form.prescriberNPI,
    impairmentJson: form.impairment,
    functionalNarrative: form.functionalNarrative,
  });
  const sections = {
    client: Boolean(form.clientName && form.clientDOB && form.clientMedicaidId),
    diagnosis: Boolean(form.selectedCode && form.diagnosisNarrative),
    impairment: Boolean(form.functionalNarrative) && Object.values(form.impairment).some(v => Number(v) >= 1),
    domains: form.recommendedDomains.length >= 2,
    justification: Boolean(form.prpJustification),
    prescriber: Boolean(form.prescriberName && npiValid && signatureMatches) && referrerMissing.length === 0,
  };
  const canSubmit = Object.values(sections).every(Boolean);
  const completedCount = Object.values(sections).filter(Boolean).length;

  // Creates the PrpReferral record; the referral ID shown is the server's, never a client-made one.
  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    const client = PRP_CLIENTS.find(c => c.name.toLowerCase() === form.clientName.trim().toLowerCase());
    let created: { id: string; displayId: string | null };
    try {
      const res = await apiJson<{ referral: { id: string; displayId: string | null } }>('/api/prp/referrals', {
        method: 'POST',
        body: JSON.stringify({
          clientId: client?.id ?? null,
          clientName: form.clientName.trim(),
          dateOfBirth: form.clientDOB,
          medicaidId: form.clientMedicaidId.trim(),
          diagnosisCode: form.selectedCode,
          diagnosisNarrative: form.diagnosisNarrative.trim(),
          impairmentJson: form.impairment,
          recommendedDomains: form.recommendedDomains,
          hospitalizations: form.hospitalizations.trim() || null,
          functionalNarrative: form.functionalNarrative.trim(),
          prpJustification: form.prpJustification.trim(),
          prescriberName: form.prescriberName.trim(),
          prescriberNpi: form.prescriberNPI.trim(),
          licenseNumber: form.prescriberLicense.trim() || null,
          referrerCredential: form.referrerCredential,
          referrerLicenseState: form.referrerLicenseState.trim().toUpperCase(),
          referrerIsTreating: form.referrerIsTreating,
          signature: form.prescriberSignature.trim(),
        }),
      });
      created = res.referral;
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'Referral could not be submitted');
      setSubmitting(false);
      return;
    }
    const id = created.displayId || created.id;
    setReferralId(id);
    void savePrpDraft({
      stage: 'referral',
      referralId: id,
      referralRecordId: created.id,
      clientId: client?.id,
      clientName: form.clientName,
      clientDob: form.clientDOB,
      medicaidId: form.clientMedicaidId,
      dxCode: form.selectedCode,
      dxLabel: selectedCodeObj?.label,
      recommendedDomains: form.recommendedDomains,
      functionalNarrative: form.functionalNarrative,
      prescriberName: form.prescriberName,
    });
    setSubmitting(false);
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-emerald-700" size={32} />
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 mb-2">PRP Referral Signed &amp; Saved</h2>
        <p className="text-slate-500 mb-1">The referral is on file in the PRP referral list. Let the PRP coordinator know it is ready — no automatic notification is sent. Your answers carry forward to enrollment.</p>
        <p className="text-sm text-slate-500 mb-6">Referral ID: <span className="font-mono">{referralId}</span></p>
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-left text-sm text-blue-800 mb-6">
          <p className="font-semibold mb-1">What happens next</p>
          <ol className="list-decimal list-inside space-y-1 text-blue-700">
            <li>Coordinator verifies Medicaid eligibility (Availity 270/271)</li>
            <li>Initial 6-month authorization is submitted to Optum Maryland via Incedo</li>
            <li>PRP specialist contacts {form.clientName} to schedule the intake assessment</li>
            <li>The IRP is built collaboratively within the first two sessions</li>
            <li>You receive a copy of the signed IRP for your chart</li>
          </ol>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/dashboard/prp/enroll" className="flex items-center gap-2 px-5 py-2.5 bg-blue-700 text-white rounded-lg text-sm font-semibold hover:bg-blue-800">
            Continue to Enrollment <ArrowRight size={15} />
          </Link>
          <Link href="/dashboard/prp" className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">PRP Dashboard</Link>
          <button onClick={() => { setForm(empty); setSubmitted(false); }} className="px-4 py-2.5 border border-slate-300 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50">New Referral</button>
        </div>
      </div>
    );
  }

  const sectionHeader = (icon: React.ReactNode, title: string, done: boolean, right?: React.ReactNode) => (
    <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2 bg-slate-50">
      {icon}
      <h2 className="font-semibold text-slate-800">{title}</h2>
      {done && <CheckCircle size={15} className="text-emerald-700" />}
      {right && <span className="ml-auto text-xs text-slate-500">{right}</span>}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <Link href="/dashboard/prp" aria-label="Back to PRP Program" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
          <ChevronLeft size={20} className="text-slate-500" aria-hidden />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">PRP Referral Form</h1>
          <p className="text-sm text-slate-500">For Psychiatrists &amp; Nurse Practitioners · {PRP_REG_LINE}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-slate-500">Sections complete</p>
          <p className="text-lg font-semibold text-blue-700">{completedCount}/6</p>
        </div>
      </div>

      <PrpWorkflowBar current="referral" draft={draft} />

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex gap-3">
        <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">This referral authorizes PRP services for your patient. It routes to the PRP coordinator, who verifies eligibility and submits the Optum Maryland (Incedo) authorization. Everything you enter here prefills the enrollment, assessment, and IRP steps.</p>
      </div>

      <div className="space-y-8">

        {/* Section 1: Client Information */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<User size={16} className="text-blue-700" />, 'Client Information', sections.client, 'Pick a chart — DOB and Medicaid ID fill themselves')}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Client Full Name *</label>
              <input
                list="prp-client-roster"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Start typing to search the client roster…"
                value={form.clientName}
                onChange={e => pickClient(e.target.value)}
              />
              <datalist id="prp-client-roster">
                {PRP_CLIENTS.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date of Birth *</label>
              <input
                type="date"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.clientDOB}
                onChange={e => set('clientDOB', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Medicaid ID *</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="MA-XXXXXXXXX"
                value={form.clientMedicaidId}
                onChange={e => set('clientMedicaidId', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 2: Qualifying Diagnosis */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<Stethoscope size={16} className="text-blue-700" />, 'Qualifying Diagnosis', sections.diagnosis, 'Maryland PBHS qualifying codes')}
          <div className="p-5 space-y-4">
            {QUALIFYING_CODE_GROUPS.map(group => (
              <div key={group.group}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-600">{group.group}</span>
                  {group.strength === 'conditional' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Conditional for adult PRP</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.codes.map(c => (
                    <label
                      key={c.code}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.selectedCode === c.code ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <input
                        type="radio"
                        name="dx"
                        value={c.code}
                        checked={form.selectedCode === c.code}
                        onChange={() => set('selectedCode', c.code)}
                        className="mt-0.5 accent-blue-700"
                      />
                      <div>
                        <span className="font-mono text-xs font-semibold text-slate-700">{c.code}</span>
                        <p className="text-sm text-slate-600 leading-tight">{c.label}</p>
                        {(c as any).highRisk && (
                          <p className="text-xs text-amber-700 font-medium mt-0.5 flex items-center gap-1"><AlertTriangle size={10} /> High denial risk — document thoroughly</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {isConditional && !isHighRisk && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-800">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-700" />
                Anxiety-spectrum diagnoses are conditional for adult PRP and frequently pended by Optum Maryland. The functional impairment narrative must clearly link this diagnosis to significant, sustained deficits in daily functioning.
              </div>
            )}
            {isHighRisk && (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex gap-2 text-sm text-rose-800">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-600" />
                F41.9 frequently triggers payer review and denial. Consider whether a more specific anxiety diagnosis applies. If proceeding, the functional impairment narrative must be especially detailed.
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Diagnosis Narrative *</label>
              <p className="text-xs text-slate-500 mb-2">Briefly describe the clinical basis for this diagnosis and its chronicity (onset, duration, severity, treatment history).</p>
              <textarea
                rows={4}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 32-year-old with a 7-year history of Bipolar II disorder, confirmed by two prior psychiatric evaluations. Current episode depressed; three hospitalizations since 2020, most recent October 2024…"
                value={form.diagnosisNarrative}
                onChange={e => set('diagnosisNarrative', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 3: Functional Impairment */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<ClipboardList size={16} className="text-blue-700" />, 'Functional Impairment Assessment', sections.impairment, '1 = unable · 5 = independent · 3 or below auto-recommends the domain')}
          <div className="p-5 space-y-3">
            {PRP_DOMAINS.map(domain => (
              <div key={domain} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <span className="min-w-0 text-sm text-slate-700 sm:flex-1">{domain}</span>
                <div className="flex gap-1">
                  {IMPAIRMENT_LEVELS.map(lvl => (
                    <button
                      key={lvl.value}
                      type="button"
                      onClick={() => setImpairment(domain, lvl.value)}
                      title={lvl.label}
                      className={`h-10 w-10 sm:h-8 sm:w-8 rounded-lg text-sm font-semibold border transition-all ${form.impairment[domain] === lvl.value
                        ? 'bg-blue-700 text-white border-blue-700'
                        : 'border-slate-300 text-slate-500 hover:border-blue-400 hover:text-blue-700'}`}
                    >
                      {lvl.value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1 mt-4">Psychiatric Hospitalization History</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 3 hospitalizations — Jan 2022, Oct 2023, Oct 2024 (14 days average)"
                value={form.hospitalizations}
                onChange={e => set('hospitalizations', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Functional Impairment Narrative *</label>
              <p className="text-xs text-slate-500 mb-2">Describe in clinical terms how the psychiatric diagnosis causes functional deficits in daily life. Be specific — this narrative supports medical necessity.</p>
              <textarea
                rows={4}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Client is unable to manage daily medications without reminders from family members due to cognitive effects of chronic depression and medication side effects. Unable to use public transit independently — panic episodes have prevented community mobility for approximately 18 months…"
                value={form.functionalNarrative}
                onChange={e => set('functionalNarrative', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 4: Recommended Domains */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<Target size={16} className="text-blue-700" />, 'Recommended Rehabilitation Domains', sections.domains, 'Select at least 2 — low scores above are pre-checked for you')}
          <div className="p-5">
            <p className="text-xs text-slate-500 mb-3">Check the skill areas you recommend PRP address. The PRP specialist will use these to guide IRP goal-setting with the client.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRP_DOMAINS.map(domain => (
                <label key={domain} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.recommendedDomains.includes(domain) ? 'border-blue-500 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
                  <input
                    type="checkbox"
                    checked={form.recommendedDomains.includes(domain)}
                    onChange={() => toggleDomain(domain)}
                    className="accent-blue-700"
                  />
                  <span className="text-sm text-slate-700 flex-1">{domain}</span>
                  {Number(form.impairment[domain]) <= 3 && form.impairment[domain] && (
                    <span className="text-xs text-blue-500 font-medium">scored {form.impairment[domain]}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5: Clinical Justification */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<FileText size={16} className="text-blue-700" />, 'PRP Medical Necessity Justification', sections.justification)}
          <div className="p-5">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Why is PRP clinically appropriate for this client at this time? *</label>
            <p className="text-xs text-slate-500 mb-2">Address: (1) why outpatient therapy alone is insufficient, (2) what PRP rehabilitation goals will address, and (3) the expected rehabilitation outcome. This statement goes to Optum Maryland with the authorization request.</p>
            <textarea
              rows={5}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., This client's persistent functional deficits — particularly in medication self-management and community mobility — have not responded adequately to individual therapy alone. PRP's structured skills-based approach is medically necessary to address the rehabilitation needs caused by Bipolar II disorder…"
              value={form.prpJustification}
              onChange={e => set('prpJustification', e.target.value)}
            />
          </div>
        </section>

        {/* Live medical-necessity meter */}
        <section className={`rounded-xl border p-4 ${necessity.level === 'strong' ? 'bg-emerald-50 border-emerald-200' : necessity.level === 'moderate' ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={16} className={necessity.level === 'strong' ? 'text-emerald-700' : necessity.level === 'moderate' ? 'text-amber-700' : 'text-slate-500'} />
            <span className={`text-sm font-semibold ${necessity.level === 'strong' ? 'text-emerald-800' : necessity.level === 'moderate' ? 'text-amber-800' : 'text-slate-600'}`}>
              Medical necessity strength: {necessity.level === 'strong' ? 'Strong — ready for Optum review' : necessity.level === 'moderate' ? 'Moderate — strengthen before submitting' : 'Not yet established'}
            </span>
            <span className="ml-auto text-xs text-slate-500">updates as you type</span>
          </div>
          <div className="w-full bg-white rounded-full h-2 border border-slate-200 mb-2">
            <div className={`h-2 rounded-full transition-all ${necessity.level === 'strong' ? 'bg-emerald-600' : necessity.level === 'moderate' ? 'bg-amber-500' : 'bg-slate-400'}`} style={{ width: `${Math.min(100, (necessity.score / 8) * 100)}%` }} />
          </div>
          {necessity.tips.length > 0 && (
            <ul className="text-xs space-y-1 text-slate-600 list-disc list-inside">
              {necessity.tips.slice(0, 3).map(t => <li key={t}>{t}</li>)}
            </ul>
          )}
        </section>

        {/* Section 6: Referring licensed mental health professional */}
        <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {sectionHeader(<Stethoscope size={16} className="text-blue-700" />, 'Referring Licensed Mental Health Professional', sections.prescriber)}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2 text-xs text-slate-500">
              The referral comes from a licensed mental health professional who treats the participant (COMAR 10.63 PRP). Pre-licensed credentials (LGPC, LMSW, LGMFT) cannot refer.
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Referrer Full Name *</label>
              <input
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Dr. Adaeze Okonkwo, MD"
                value={form.prescriberName}
                onChange={e => set('prescriberName', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">NPI Number *</label>
              <input
                className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 ${form.prescriberNPI && !npiValid ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`}
                placeholder="10-digit NPI"
                value={form.prescriberNPI}
                onChange={e => set('prescriberNPI', e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {form.prescriberNPI && !npiValid && <p className="text-xs text-rose-600 mt-1">NPI must be exactly 10 digits.</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Credential *</label>
              <select
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.referrerCredential}
                onChange={e => set('referrerCredential', e.target.value)}
              >
                <option value="">Select credential…</option>
                {PRP_REFERRER_CREDENTIALS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-slate-600 mb-1">License Number *</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., D45012"
                  value={form.prescriberLicense}
                  onChange={e => set('prescriberLicense', e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">State *</label>
                <input
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-blue-500"
                  maxLength={2}
                  value={form.referrerLicenseState}
                  onChange={e => set('referrerLicenseState', e.target.value.replace(/[^a-zA-Z]/g, '').toUpperCase())}
                />
              </div>
            </div>
            <label className="sm:col-span-2 flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" className="accent-blue-600" checked={form.referrerIsTreating} onChange={e => set('referrerIsTreating', e.target.checked)} />
              I currently treat this participant (ongoing outpatient mental health treatment) *
            </label>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Referral Date</label>
              <input
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                readOnly
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-600 mb-1">Electronic Signature (type full name) *</label>
              <p className="text-xs text-slate-500 mb-2">By typing your full name you certify that this referral reflects your clinical assessment and that the diagnosis is documented in the client&apos;s medical record.</p>
              <input
                className={`w-full border-2 rounded-lg px-3 py-2 text-base italic font-medium text-blue-900 focus:outline-none focus:border-blue-500 bg-blue-50 ${form.prescriberSignature && !signatureMatches ? 'border-rose-300' : 'border-blue-200'}`}
                placeholder="Type your full name to sign"
                value={form.prescriberSignature}
                onChange={e => set('prescriberSignature', e.target.value)}
              />
              {form.prescriberSignature && !signatureMatches && (
                <p className="text-xs text-rose-600 mt-1">Signature must match the referrer name exactly.</p>
              )}
            </div>
            {referrerMissing.length > 0 && (
              <p className="sm:col-span-2 text-xs text-amber-700">Still needed: {referrerMissing.join(', ')}</p>
            )}
          </div>
        </section>

        {/* Submit */}
        <div className="flex flex-wrap-reverse items-center justify-between gap-3">
          <Link href="/dashboard/prp" className="inline-flex min-h-10 items-center text-sm text-slate-500 hover:text-slate-700">Cancel</Link>
          <button
            onClick={submit}
            disabled={!canSubmit || submitting}
            className={buttonClasses({ size: 'lg' })}
          >
            <Send size={15} />
            {submitting ? 'Submitting…' : 'Sign & Submit PRP Referral'}
          </button>
        </div>
        {submitError && (
          <p className="text-sm text-rose-600 text-right -mt-4">Referral not submitted: {submitError}</p>
        )}
        {!canSubmit && (
          <p className="text-xs text-slate-500 text-right -mt-4">
            {completedCount}/6 sections complete — {Object.entries(sections).filter(([, ok]) => !ok).map(([k]) => ({ client: 'client info', diagnosis: 'diagnosis', impairment: 'functional narrative', domains: '2+ domains', justification: 'justification', prescriber: 'referrer credential, license and signature' } as Record<string, string>)[k]).join(', ')} still needed.
          </p>
        )}
      </div>
    </div>
  );
}

// Reuse Target icon locally
function Target({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  );
}
