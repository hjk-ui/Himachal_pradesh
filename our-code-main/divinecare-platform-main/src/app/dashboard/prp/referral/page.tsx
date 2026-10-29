'use client';
import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, CheckCircle, AlertTriangle, Info, Send, User, Stethoscope, ClipboardList, FileText, Gauge, ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import {
  PRP_CLIENTS, QUALIFYING_CODE_GROUPS, ALL_QUALIFYING_CODES, PRP_DOMAINS,
  PRP_REG_LINE, PrpWorkflowBar, savePrpDraft, loadPrpDraft, type PrpDraft,
} from '../prpShared';

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
  prescriberSignature: string;
};

const empty: FormState = {
  clientName: '', clientDOB: '', clientMedicaidId: '',
  selectedCode: '', diagnosisNarrative: '',
  impairment: {},
  recommendedDomains: [],
  hospitalizations: '', functionalNarrative: '', prpJustification: '',
  prescriberName: '', prescriberNPI: '', prescriberLicense: '', prescriberSignature: '',
};

export default function PRPReferralPage() {
  const [form, setForm] = useState<FormState>(empty);
  const [submitted, setSubmitted] = useState(false);
  const [referralId, setReferralId] = useState('');
  const [draft, setDraft] = useState<PrpDraft | null>(null);
  useEffect(() => { setDraft(loadPrpDraft()); }, []);

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

  const sections = {
    client: Boolean(form.clientName && form.clientDOB && form.clientMedicaidId),
    diagnosis: Boolean(form.selectedCode && form.diagnosisNarrative),
    impairment: Boolean(form.functionalNarrative),
    domains: form.recommendedDomains.length >= 2,
    justification: Boolean(form.prpJustification),
    prescriber: Boolean(form.prescriberName && npiValid && signatureMatches),
  };
  const canSubmit = Object.values(sections).every(Boolean);
  const completedCount = Object.values(sections).filter(Boolean).length;

  const submit = () => {
    if (!canSubmit) return;
    const id = `PRP-${Date.now().toString(36).toUpperCase()}`;
    setReferralId(id);
    const client = PRP_CLIENTS.find(c => c.name.toLowerCase() === form.clientName.trim().toLowerCase());
    savePrpDraft({
      stage: 'referral',
      referralId: id,
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
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <div className="max-w-xl mx-auto mt-20 text-center px-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="text-green-600" size={32} />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">PRP Referral Signed &amp; Submitted</h2>
        <p className="text-gray-500 mb-1">The PRP coordinator has been notified. Your answers carry forward — <strong>no one retypes this referral</strong>.</p>
        <p className="text-sm text-gray-400 mb-6">Referral ID: <span className="font-mono">{referralId}</span></p>
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-4 text-left text-sm text-purple-800 mb-6">
          <p className="font-semibold mb-1">What happens next</p>
          <ol className="list-decimal list-inside space-y-1 text-purple-700">
            <li>Coordinator verifies Medicaid eligibility (Availity 270/271)</li>
            <li>Initial 6-month authorization is submitted to Optum Maryland via Incedo</li>
            <li>PRP specialist contacts {form.clientName} to schedule the intake assessment</li>
            <li>The IRP is built collaboratively within the first two sessions</li>
            <li>You receive a copy of the signed IRP for your chart</li>
          </ol>
        </div>
        <div className="flex gap-3 justify-center flex-wrap">
          <Link href="/dashboard/prp/enroll" className="flex items-center gap-2 px-5 py-2.5 bg-purple-700 text-white rounded-lg text-sm font-semibold hover:bg-purple-800">
            Continue to Enrollment <ArrowRight size={15} />
          </Link>
          <Link href="/dashboard/prp" className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">PRP Dashboard</Link>
          <button onClick={() => { setForm(empty); setSubmitted(false); }} className="px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50">New Referral</button>
        </div>
      </div>
    );
  }

  const sectionHeader = (icon: React.ReactNode, title: string, done: boolean, right?: React.ReactNode) => (
    <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2 bg-gray-50">
      {icon}
      <h2 className="font-semibold text-gray-800">{title}</h2>
      {done && <CheckCircle size={15} className="text-green-500" />}
      {right && <span className="ml-auto text-xs text-gray-400">{right}</span>}
    </div>
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/dashboard/prp" className="p-2 rounded-lg hover:bg-gray-100">
          <ChevronLeft size={20} className="text-gray-500" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">PRP Referral Form</h1>
          <p className="text-sm text-gray-500">For Psychiatrists &amp; Nurse Practitioners · {PRP_REG_LINE}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">Sections complete</p>
          <p className="text-lg font-bold text-purple-700">{completedCount}/6</p>
        </div>
      </div>

      <PrpWorkflowBar current="referral" draft={draft} />

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 flex gap-3">
        <Info size={16} className="text-blue-600 shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">This referral authorizes PRP services for your patient. It routes to the PRP coordinator, who verifies eligibility and submits the Optum Maryland (Incedo) authorization. Everything you enter here prefills the enrollment, assessment, and IRP steps.</p>
      </div>

      <div className="space-y-8">

        {/* Section 1: Client Information */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<User size={16} className="text-purple-700" />, 'Client Information', sections.client, 'Pick a chart — DOB and Medicaid ID fill themselves')}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Client Full Name *</label>
              <input
                list="prp-client-roster"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Start typing to search the client roster…"
                value={form.clientName}
                onChange={e => pickClient(e.target.value)}
              />
              <datalist id="prp-client-roster">
                {PRP_CLIENTS.map(c => <option key={c.id} value={c.name} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Date of Birth *</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                value={form.clientDOB}
                onChange={e => set('clientDOB', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Medicaid ID *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="MA-XXXXXXXXX"
                value={form.clientMedicaidId}
                onChange={e => set('clientMedicaidId', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 2: Qualifying Diagnosis */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<Stethoscope size={16} className="text-purple-700" />, 'Qualifying Diagnosis', sections.diagnosis, 'Maryland PBHS qualifying codes')}
          <div className="p-5 space-y-4">
            {QUALIFYING_CODE_GROUPS.map(group => (
              <div key={group.group}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-bold uppercase tracking-wider" style={{ color: group.color }}>{group.group}</span>
                  {group.strength === 'conditional' && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Conditional for adult PRP</span>}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {group.codes.map(c => (
                    <label
                      key={c.code}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.selectedCode === c.code ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                      <input
                        type="radio"
                        name="dx"
                        value={c.code}
                        checked={form.selectedCode === c.code}
                        onChange={() => set('selectedCode', c.code)}
                        className="mt-0.5 accent-purple-700"
                      />
                      <div>
                        <span className="font-mono text-xs font-bold text-gray-700">{c.code}</span>
                        <p className="text-sm text-gray-600 leading-tight">{c.label}</p>
                        {(c as any).highRisk && (
                          <p className="text-xs text-amber-600 font-medium mt-0.5 flex items-center gap-1"><AlertTriangle size={10} /> High denial risk — document thoroughly</p>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ))}

            {isConditional && !isHighRisk && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 text-sm text-amber-800">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-amber-500" />
                Anxiety-spectrum diagnoses are conditional for adult PRP and frequently pended by Optum Maryland. The functional impairment narrative must clearly link this diagnosis to significant, sustained deficits in daily functioning.
              </div>
            )}
            {isHighRisk && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2 text-sm text-red-800">
                <AlertTriangle size={15} className="shrink-0 mt-0.5 text-red-500" />
                F41.9 frequently triggers payer review and denial. Consider whether a more specific anxiety diagnosis applies. If proceeding, the functional impairment narrative must be especially detailed.
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Diagnosis Narrative *</label>
              <p className="text-xs text-gray-400 mb-2">Briefly describe the clinical basis for this diagnosis and its chronicity (onset, duration, severity, treatment history).</p>
              <textarea
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., 32-year-old with a 7-year history of Bipolar II disorder, confirmed by two prior psychiatric evaluations. Current episode depressed; three hospitalizations since 2020, most recent October 2024…"
                value={form.diagnosisNarrative}
                onChange={e => set('diagnosisNarrative', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 3: Functional Impairment */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<ClipboardList size={16} className="text-purple-700" />, 'Functional Impairment Assessment', sections.impairment, '1 = unable · 5 = independent · 3 or below auto-recommends the domain')}
          <div className="p-5 space-y-3">
            {PRP_DOMAINS.map(domain => (
              <div key={domain} className="flex items-center gap-3">
                <span className="text-sm text-gray-700 flex-1">{domain}</span>
                <div className="flex gap-1">
                  {IMPAIRMENT_LEVELS.map(lvl => (
                    <button
                      key={lvl.value}
                      type="button"
                      onClick={() => setImpairment(domain, lvl.value)}
                      title={lvl.label}
                      className={`w-8 h-8 rounded-lg text-sm font-bold border transition-all ${form.impairment[domain] === lvl.value
                        ? 'bg-purple-700 text-white border-purple-700'
                        : 'border-gray-300 text-gray-500 hover:border-purple-400 hover:text-purple-700'}`}
                    >
                      {lvl.value}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1 mt-4">Psychiatric Hospitalization History</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., 3 hospitalizations — Jan 2022, Oct 2023, Oct 2024 (14 days average)"
                value={form.hospitalizations}
                onChange={e => set('hospitalizations', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Functional Impairment Narrative *</label>
              <p className="text-xs text-gray-400 mb-2">Describe in clinical terms how the psychiatric diagnosis causes functional deficits in daily life. Be specific — this narrative supports medical necessity.</p>
              <textarea
                rows={4}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., Client is unable to manage daily medications without reminders from family members due to cognitive effects of chronic depression and medication side effects. Unable to use public transit independently — panic episodes have prevented community mobility for approximately 18 months…"
                value={form.functionalNarrative}
                onChange={e => set('functionalNarrative', e.target.value)}
              />
            </div>
          </div>
        </section>

        {/* Section 4: Recommended Domains */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<Target size={16} className="text-purple-700" />, 'Recommended Rehabilitation Domains', sections.domains, 'Select at least 2 — low scores above are pre-checked for you')}
          <div className="p-5">
            <p className="text-xs text-gray-500 mb-3">Check the skill areas you recommend PRP address. The PRP specialist will use these to guide IRP goal-setting with the client.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {PRP_DOMAINS.map(domain => (
                <label key={domain} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${form.recommendedDomains.includes(domain) ? 'border-purple-500 bg-purple-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input
                    type="checkbox"
                    checked={form.recommendedDomains.includes(domain)}
                    onChange={() => toggleDomain(domain)}
                    className="accent-purple-700"
                  />
                  <span className="text-sm text-gray-700 flex-1">{domain}</span>
                  {Number(form.impairment[domain]) <= 3 && form.impairment[domain] && (
                    <span className="text-xs text-purple-500 font-medium">scored {form.impairment[domain]}</span>
                  )}
                </label>
              ))}
            </div>
          </div>
        </section>

        {/* Section 5: Clinical Justification */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<FileText size={16} className="text-purple-700" />, 'PRP Medical Necessity Justification', sections.justification)}
          <div className="p-5">
            <label className="block text-xs font-semibold text-gray-600 mb-1">Why is PRP clinically appropriate for this client at this time? *</label>
            <p className="text-xs text-gray-400 mb-2">Address: (1) why outpatient therapy alone is insufficient, (2) what PRP rehabilitation goals will address, and (3) the expected rehabilitation outcome. This statement goes to Optum Maryland with the authorization request.</p>
            <textarea
              rows={5}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="e.g., This client's persistent functional deficits — particularly in medication self-management and community mobility — have not responded adequately to individual therapy alone. PRP's structured skills-based approach is medically necessary to address the rehabilitation needs caused by Bipolar II disorder…"
              value={form.prpJustification}
              onChange={e => set('prpJustification', e.target.value)}
            />
          </div>
        </section>

        {/* Live medical-necessity meter */}
        <section className={`rounded-xl border p-4 ${necessity.level === 'strong' ? 'bg-green-50 border-green-200' : necessity.level === 'moderate' ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
          <div className="flex items-center gap-2 mb-2">
            <Gauge size={16} className={necessity.level === 'strong' ? 'text-green-600' : necessity.level === 'moderate' ? 'text-amber-600' : 'text-gray-400'} />
            <span className={`text-sm font-bold ${necessity.level === 'strong' ? 'text-green-800' : necessity.level === 'moderate' ? 'text-amber-800' : 'text-gray-600'}`}>
              Medical necessity strength: {necessity.level === 'strong' ? 'Strong — ready for Optum review' : necessity.level === 'moderate' ? 'Moderate — strengthen before submitting' : 'Not yet established'}
            </span>
            <span className="ml-auto text-xs text-gray-400">updates as you type</span>
          </div>
          <div className="w-full bg-white rounded-full h-2 border border-gray-200 mb-2">
            <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, (necessity.score / 8) * 100)}%`, background: necessity.level === 'strong' ? '#16A34A' : necessity.level === 'moderate' ? '#D97706' : '#9CA3AF' }} />
          </div>
          {necessity.tips.length > 0 && (
            <ul className="text-xs space-y-1 text-gray-600 list-disc list-inside">
              {necessity.tips.slice(0, 3).map(t => <li key={t}>{t}</li>)}
            </ul>
          )}
        </section>

        {/* Section 6: Prescriber Authorization */}
        <section className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          {sectionHeader(<Stethoscope size={16} className="text-purple-700" />, 'Prescriber Authorization', sections.prescriber)}
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Prescriber Full Name *</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., Dr. Adaeze Okonkwo, MD"
                value={form.prescriberName}
                onChange={e => set('prescriberName', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">NPI Number *</label>
              <input
                className={`w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500 ${form.prescriberNPI && !npiValid ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
                placeholder="10-digit NPI"
                value={form.prescriberNPI}
                onChange={e => set('prescriberNPI', e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
              {form.prescriberNPI && !npiValid && <p className="text-xs text-red-500 mt-1">NPI must be exactly 10 digits.</p>}
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">MD / CRNP License Number</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="e.g., D45012"
                value={form.prescriberLicense}
                onChange={e => set('prescriberLicense', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Referral Date</label>
              <input
                type="date"
                defaultValue={new Date().toISOString().slice(0, 10)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                readOnly
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-gray-600 mb-1">Electronic Signature (type full name) *</label>
              <p className="text-xs text-gray-400 mb-2">By typing your full name you certify that this referral reflects your clinical assessment and that the diagnosis is documented in the client's medical record.</p>
              <input
                className={`w-full border-2 rounded-lg px-3 py-2 text-base italic font-medium text-purple-900 focus:outline-none focus:border-purple-500 bg-purple-50 ${form.prescriberSignature && !signatureMatches ? 'border-red-300' : 'border-purple-200'}`}
                placeholder="Type your full name to sign"
                value={form.prescriberSignature}
                onChange={e => set('prescriberSignature', e.target.value)}
              />
              {form.prescriberSignature && !signatureMatches && (
                <p className="text-xs text-red-500 mt-1">Signature must match the prescriber name exactly.</p>
              )}
            </div>
          </div>
        </section>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <Link href="/dashboard/prp" className="text-sm text-gray-500 hover:text-gray-700">Cancel</Link>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: canSubmit ? '#5C2D91' : '#9CA3AF', color: '#fff' }}
          >
            <Send size={15} />
            Sign &amp; Submit PRP Referral
          </button>
        </div>
        {!canSubmit && (
          <p className="text-xs text-gray-400 text-right -mt-4">
            {completedCount}/6 sections complete — {Object.entries(sections).filter(([, ok]) => !ok).map(([k]) => ({ client: 'client info', diagnosis: 'diagnosis', impairment: 'functional narrative', domains: '2+ domains', justification: 'justification', prescriber: 'prescriber signature' } as Record<string, string>)[k]).join(', ')} still needed.
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
