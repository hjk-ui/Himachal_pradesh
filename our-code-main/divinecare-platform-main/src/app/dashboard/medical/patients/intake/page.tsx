'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  User,
  ShieldCheck,
  HeartPulse,
  Pill,
  FileCheck,
  Stethoscope,
  Plus,
  Trash2,
} from 'lucide-react';
import { MedicalNavHeader } from '@/features/medical/components/MedicalNavHeader';
import { getMedicalPatients, saveMedicalPatients } from '@/features/medical/data';
import type { MedicalPatient } from '@/features/medical/types';

const PMH_CHECKLIST = [
  'Hypertension (HTN)',
  'Type 2 Diabetes Mellitus',
  'Hyperlipidemia / Dyslipidemia',
  'Coronary Artery Disease (CAD)',
  'Congestive Heart Failure (CHF)',
  'Asthma / COPD',
  'Chronic Kidney Disease (CKD)',
  'Gastroesophageal Reflux (GERD)',
  'Hypothyroidism / Thyroid Disease',
  'Osteoarthritis / Chronic Joint Pain',
  'Major Depressive Disorder / Anxiety',
  'Stroke / Transient Ischemic Attack (TIA)',
  'Obstructive Sleep Apnea (OSA)',
  'Peripheral Vascular Disease',
  'Cancer / Malignancy History',
  'Liver Disease / Cirrhosis / Hepatitis',
  'Osteoporosis / Fragility Fracture',
];

const ROS_SYSTEMS = [
  { id: 'Constitutional', label: 'Constitutional (Fever, chills, fatigue, unexpected weight loss)' },
  { id: 'Eyes', label: 'Eyes (Vision changes, blurred vision, eye pain, dryness)' },
  { id: 'ENT', label: 'Ears, Nose, Throat (Hearing loss, congestion, sore throat, dysphagia)' },
  { id: 'Cardiovascular', label: 'Cardiovascular (Chest pain, palpitations, orthopnea, leg swelling)' },
  { id: 'Respiratory', label: 'Respiratory (Shortness of breath, cough, sputum, wheezing)' },
  { id: 'Gastrointestinal', label: 'Gastrointestinal (Nausea, abdominal pain, diarrhea, constipation)' },
  { id: 'Genitourinary', label: 'Genitourinary (Dysuria, hematuria, frequency, incontinence)' },
  { id: 'Musculoskeletal', label: 'Musculoskeletal (Joint swelling, stiffness, back pain, muscle aches)' },
  { id: 'Integumentary', label: 'Integumentary / Skin (Rashes, lesions, changing moles, pruritus)' },
  { id: 'Neurological', label: 'Neurological (Headache, dizziness, numbness, tingling, focal weakness)' },
];

export default function MedicalIntakeWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Step 1: Identity & ONC Demographics
  const [legalName, setLegalName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dob, setDob] = useState('');
  const [sexAtBirth, setSexAtBirth] = useState<'Male' | 'Female' | 'Intersex' | 'Unknown'>('Male');
  const [genderIdentity, setGenderIdentity] = useState('Male');
  const [sexualOrientation, setSexualOrientation] = useState('Straight or heterosexual');
  const [pronouns, setPronouns] = useState('He/Him');
  const [race, setRace] = useState('White');
  const [ethnicity, setEthnicity] = useState('Not Hispanic or Latino');
  const [language, setLanguage] = useState('English');
  const [interpreterNeeded, setInterpreterNeeded] = useState(false);

  // Step 2: Contact, Insurance & Guarantor
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [primaryPayer, setPrimaryPayer] = useState('CareFirst BlueCross BlueShield');
  const [memberId, setMemberId] = useState('');
  const [groupNumber, setGroupNumber] = useState('');
  const [hasSecondary, setHasSecondary] = useState(false);
  const [secondaryPayer, setSecondaryPayer] = useState('Medicare Part B');
  const [secondaryMemberId, setSecondaryMemberId] = useState('');
  const [guarantorIsSelf, setGuarantorIsSelf] = useState(true);
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRel, setEmergencyContactRel] = useState('Spouse');

  // Step 3: Medical History
  const [checkedPmh, setCheckedPmh] = useState<string[]>([]);
  const [customPmh, setCustomPmh] = useState('');
  const [surgeries, setSurgeries] = useState<Array<{ name: string; year: string }>>([
    { name: 'Appendectomy', year: '2012' },
  ]);
  const [familyHistory, setFamilyHistory] = useState('Mother: HTN, T2DM. Father: CAD, MI at age 62.');
  const [tobaccoStatus, setTobaccoStatus] = useState('Former smoker (quit > 1 yr)');
  const [alcoholUse, setAlcoholUse] = useState('Moderate (1-2 drinks/week)');

  // Step 4: Meds & Allergies
  const [noActiveMeds, setNoActiveMeds] = useState(false);
  const [medsList, setMedsList] = useState<Array<{ name: string; dose: string; freq: string }>>([
    { name: 'Lisinopril', dose: '10mg', freq: 'Daily' },
  ]);
  const [nkda, setNkda] = useState(false);
  const [allergiesList, setAllergiesList] = useState<Array<{ substance: string; reaction: string }>>([]);

  // Step 5: Review of Systems (ROS)
  const [rosStates, setRosStates] = useState<Record<string, 'Negative' | 'Positive' | 'Not Reviewed'>>(
    () => Object.fromEntries(ROS_SYSTEMS.map((s) => [s.id, 'Negative']))
  );
  const [rosNotes, setRosNotes] = useState('');

  // Step 6: Consents & PCP Assignment
  const [assignedPcp, setAssignedPcp] = useState('');
  const [consentHipaa, setConsentHipaa] = useState(true);
  const [consentTreatment, setConsentTreatment] = useState(true);
  const [consentFinancial, setConsentFinancial] = useState(true);

  // Auto-calculated Age
  const calculatedAge = useMemo(() => {
    if (!dob) return 0;
    const diff = Date.now() - new Date(dob).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
  }, [dob]);

  const autoMrn = useMemo(() => {
    return `MED-${Math.floor(10000 + Math.random() * 90000)}`;
  }, []);

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    const newPatient: MedicalPatient = {
      id: `med-pat-${Date.now()}`,
      mrn: autoMrn,
      name: legalName || 'Unnamed Patient',
      preferredName: preferredName || undefined,
      dob,
      age: calculatedAge,
      gender: genderIdentity || '',
      pronouns: pronouns || '',
      pcp: assignedPcp,
      phone,
      email,
      hasCareGaps: checkedPmh.length > 0,
      hasAbnormalLabs: false,
      lastVisit: new Date().toISOString().slice(0, 10),
      demographics: {
        legalName: legalName || 'Unnamed Patient',
        preferredName: preferredName,
        dateOfBirth: dob,
        sexAtBirth: sexAtBirth,
        genderIdentity,
        sexualOrientation,
        pronouns,
        ombRace: race,
        ombEthnicity: ethnicity,
        preferredLanguage: language,
        interpreterNeeded,
        portalStatus: 'Active',
        primaryInsurance: {
          payerName: primaryPayer,
          payerId: '',
          memberId,
          groupNumber,
          subscriberName: legalName,
          subscriberDob: dob,
          relationship: 'Self',
        },
        guarantor: {
          name: guarantorIsSelf ? legalName : 'Guarantor',
          relationship: guarantorIsSelf ? 'Self' : 'Other',
          phone,
          address,
        },
        emergencyContacts: [
          {
            name: emergencyContactName,
            relationship: emergencyContactRel,
            phone: emergencyContactPhone || phone,
            isAuthorizedProxy: true,
          },
        ],
        codeStatus: 'Full Code',
        advanceDirectives: {
          hasLivingWill: false,
          hasPOLST: false,
        },
        chartFlags: ['New Onboarding'],
      },
      problems: checkedPmh.map((item, idx) => ({
        id: `prob-new-${idx}`,
        icd10: item.includes('HTN') ? 'I10' : item.includes('Diabetes') ? 'E11.9' : 'R69',
        description: item,
        onsetDate: new Date().toISOString().slice(0, 10),
        status: 'Active',
        severity: '',
        category: '',
      })),
      medications: noActiveMeds
        ? []
        : medsList.map((m, idx) => ({
            id: `med-new-${idx}`,
            name: m.name,
            dosage: m.dose,
            route: 'Oral',
            frequency: m.freq,
            refills: 0,
            indication: '',
            startDate: new Date().toISOString().slice(0, 10),
            status: 'Active',
            prescribedBy: assignedPcp,
            instructions: `Take ${m.dose} ${m.freq}.`,
          })),
      allergies: nkda
        ? []
        : allergiesList.map((a, idx) => ({
            id: `alg-new-${idx}`,
            substance: a.substance,
            reaction: a.reaction,
            severity: '',
            type: '',
          })),
      vitals: [],
      labs: [],
      preventiveCare: [],
      referrals: [],
      encounters: [],
    };

    try {
      const res = await fetch('/api/medical/patients/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalName,
          preferredName,
          dob,
          sexAtBirth,
          genderIdentity,
          race,
          language,
          phone,
          email,
          address,
          primaryPayer,
          memberId,
          groupNumber,
          secondaryPayer: hasSecondary ? secondaryPayer : undefined,
          secondaryMemberId: hasSecondary ? secondaryMemberId : undefined,
          emergencyContactName,
          emergencyContactPhone,
          assignedPcp,
          checkedPmh,
          medsList: noActiveMeds ? [] : medsList,
          allergiesList: nkda ? [] : allergiesList,
          consents: {
            hipaaConsent: consentHipaa,
            treatmentConsent: consentTreatment,
            billingConsent: consentFinancial,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.patient?.id) {
          newPatient.id = data.patient.id;
          newPatient.mrn = data.patient.mrn;
        }
      }
    } catch (err) {
      console.error('Failed to post intake to API:', err);
    }

    const current = getMedicalPatients();
    saveMedicalPatients([newPatient, ...current]);

    setTimeout(() => {
      setIsSubmitting(false);
      router.push(`/dashboard/medical/patients/${newPatient.id}`);
    }, 600);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <MedicalNavHeader
        title="Medical Patient Clinical Intake Wizard"
        subtitle="ONC 2022 §170.315(a)(5) compliant guided onboarding for new somatic primary care patients"
      />

      {/* Progress Stepper Bar */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex justify-between items-center text-xs font-bold text-slate-500 mb-2">
          <span>Step {step} of 6</span>
          <span className="text-blue-600">{Math.round((step / 6) * 100)}% Completed</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full bg-blue-600 transition-all duration-300"
            style={{ width: `${(step / 6) * 100}%` }}
          />
        </div>
        <div className="mt-4 grid grid-cols-6 gap-2 text-center text-[11px] font-semibold text-slate-600">
          <span className={step >= 1 ? 'text-blue-700 font-bold' : ''}>1. Identity</span>
          <span className={step >= 2 ? 'text-blue-700 font-bold' : ''}>2. Insurance</span>
          <span className={step >= 3 ? 'text-blue-700 font-bold' : ''}>3. PMH/Social</span>
          <span className={step >= 4 ? 'text-blue-700 font-bold' : ''}>4. Meds/Allergies</span>
          <span className={step >= 5 ? 'text-blue-700 font-bold' : ''}>5. Review Systems</span>
          <span className={step >= 6 ? 'text-blue-700 font-bold' : ''}>6. Consents & PCP</span>
        </div>
      </div>

      {/* Step Form Box */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
              Step 1: Patient Identity & ONC SOGI Demographics
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Legal Full Name *</label>
                <input
                  type="text"
                  placeholder="e.g. Jonathan David Taylor"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  required
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Preferred Name</label>
                <input
                  type="text"
                  placeholder="e.g. Jon"
                  value={preferredName}
                  onChange={(e) => setPreferredName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Date of Birth *</label>
                <input
                  type="date"
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  required
                />
                {dob && (
                  <p className="mt-1 text-[11px] text-blue-600 font-semibold">
                    Auto-calculated Age: {calculatedAge} years old
                  </p>
                )}
              </div>
              <div>
                <label className="font-semibold text-slate-700">Sex Assigned at Birth</label>
                <select
                  value={sexAtBirth}
                  onChange={(e) => setSexAtBirth(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Intersex">Intersex</option>
                  <option value="Unknown">Unknown</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Gender Identity</label>
                <input
                  type="text"
                  value={genderIdentity}
                  onChange={(e) => setGenderIdentity(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Preferred Pronouns</label>
                <input
                  type="text"
                  value={pronouns}
                  onChange={(e) => setPronouns(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Sexual Orientation</label>
                <select
                  value={sexualOrientation}
                  onChange={(e) => setSexualOrientation(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                >
                  <option value="Straight or heterosexual">Straight or heterosexual</option>
                  <option value="Gay or lesbian">Gay or lesbian</option>
                  <option value="Bisexual">Bisexual</option>
                  <option value="Something else">Something else</option>
                  <option value="Don't know / Choose not to disclose">Choose not to disclose</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">OMB Race & Ethnicity</label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={race}
                    onChange={(e) => setRace(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2 text-xs outline-none"
                  >
                    <option value="White">White</option>
                    <option value="Black or African American">Black / African Am.</option>
                    <option value="Asian">Asian</option>
                    <option value="American Indian or Alaska Native">Native American</option>
                    <option value="Two or More Races">Multi-racial</option>
                  </select>
                  <select
                    value={ethnicity}
                    onChange={(e) => setEthnicity(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-200 p-2 text-xs outline-none"
                  >
                    <option value="Not Hispanic or Latino">Not Hispanic</option>
                    <option value="Hispanic or Latino">Hispanic / Latino</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
              Step 2: Contact, Insurance & Financial Guarantor
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Phone Number *</label>
                <input
                  type="tel"
                  placeholder="(410) 555-0100"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  required
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Email Address</label>
                <input
                  type="email"
                  placeholder="patient@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="font-semibold text-slate-700">Residential Street Address</label>
                <input
                  type="text"
                  placeholder="123 Main St, Apt 4B, Baltimore, MD 21201"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Primary Health Insurance</label>
                <select
                  value={primaryPayer}
                  onChange={(e) => setPrimaryPayer(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                >
                  <option value="CareFirst BlueCross BlueShield">CareFirst BCBS</option>
                  <option value="Priority Partners (Medicaid MCO)">Priority Partners Medicaid</option>
                  <option value="Medicare Part B (CMS)">Medicare Part B</option>
                  <option value="Aetna Commercial">Aetna Commercial</option>
                  <option value="UnitedHealthcare">UnitedHealthcare</option>
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Member ID / Policy # *</label>
                <input
                  type="text"
                  placeholder="e.g. CFB-9988123"
                  value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 font-mono text-sm outline-none focus:border-blue-600"
                  required
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Emergency Contact Name</label>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={emergencyContactName}
                  onChange={(e) => setEmergencyContactName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Emergency Contact Phone</label>
                <input
                  type="tel"
                  placeholder="(410) 555-0101"
                  value={emergencyContactPhone}
                  onChange={(e) => setEmergencyContactPhone(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
              Step 3: Past Medical (PMH), Surgical & Social History
            </h2>
            <div className="text-xs">
              <label className="font-bold text-slate-800">
                17-Item Past Medical Conditions Checklist
              </label>
              <p className="text-slate-500 mb-2">Check all diagnosed somatic conditions:</p>
              <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
                {PMH_CHECKLIST.map((item) => (
                  <label
                    key={item}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-slate-800 cursor-pointer hover:bg-blue-50"
                  >
                    <input
                      type="checkbox"
                      checked={checkedPmh.includes(item)}
                      onChange={(e) => {
                        if (e.target.checked) setCheckedPmh([...checkedPmh, item]);
                        else setCheckedPmh(checkedPmh.filter((x) => x !== item));
                      }}
                      className="rounded text-blue-600"
                    />
                    <span className="text-[11px] font-medium">{item}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 pt-2 text-xs">
              <div>
                <label className="font-semibold text-slate-700">Family Medical History</label>
                <textarea
                  rows={2}
                  value={familyHistory}
                  onChange={(e) => setFamilyHistory(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700">Tobacco & Alcohol Use</label>
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <select
                    value={tobaccoStatus}
                    onChange={(e) => setTobaccoStatus(e.target.value)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  >
                    <option value="Never smoker">Never smoker</option>
                    <option value="Former smoker (quit > 1 yr)">Former smoker</option>
                    <option value="Current everyday smoker">Current smoker</option>
                  </select>
                  <select
                    value={alcoholUse}
                    onChange={(e) => setAlcoholUse(e.target.value)}
                    className="rounded-xl border border-slate-200 p-2 text-xs"
                  >
                    <option value="None">No alcohol</option>
                    <option value="Moderate (1-2 drinks/week)">Moderate</option>
                    <option value="Heavy / binge drinking">Heavy drinking</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
              Step 4: Medications & Allergies
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Active Medications
                </h3>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={noActiveMeds}
                    onChange={(e) => setNoActiveMeds(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  Patient takes NO active medications
                </label>
              </div>

              {!noActiveMeds && (
                <div className="space-y-2">
                  {medsList.map((m, idx) => (
                    <div key={idx} className="flex gap-2 items-center text-xs">
                      <input
                        type="text"
                        placeholder="Drug name"
                        value={m.name}
                        onChange={(e) => {
                          const next = [...medsList];
                          next[idx].name = e.target.value;
                          setMedsList(next);
                        }}
                        className="flex-1 rounded-xl border border-slate-200 p-2"
                      />
                      <input
                        type="text"
                        placeholder="Dosage (e.g. 10mg)"
                        value={m.dose}
                        onChange={(e) => {
                          const next = [...medsList];
                          next[idx].dose = e.target.value;
                          setMedsList(next);
                        }}
                        className="w-24 rounded-xl border border-slate-200 p-2"
                      />
                      <input
                        type="text"
                        placeholder="Freq (e.g. Daily)"
                        value={m.freq}
                        onChange={(e) => {
                          const next = [...medsList];
                          next[idx].freq = e.target.value;
                          setMedsList(next);
                        }}
                        className="w-24 rounded-xl border border-slate-200 p-2"
                      />
                      <button
                        type="button"
                        onClick={() => setMedsList(medsList.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700 p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMedsList([...medsList, { name: '', dose: '', freq: 'Daily' }])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                  >
                    <Plus size={14} /> Add Another Medication
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Allergies
                </h3>
                <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={nkda}
                    onChange={(e) => setNkda(e.target.checked)}
                    className="rounded text-blue-600"
                  />
                  No Known Drug Allergies (NKDA)
                </label>
              </div>

              {!nkda && (
                <div className="space-y-2">
                  {allergiesList.map((a, idx) => (
                    <div key={idx} className="flex gap-2 items-center text-xs">
                      <input
                        type="text"
                        placeholder="Substance (e.g. Penicillin)"
                        value={a.substance}
                        onChange={(e) => {
                          const next = [...allergiesList];
                          next[idx].substance = e.target.value;
                          setAllergiesList(next);
                        }}
                        className="flex-1 rounded-xl border border-slate-200 p-2"
                      />
                      <input
                        type="text"
                        placeholder="Reaction (e.g. Hives, rash)"
                        value={a.reaction}
                        onChange={(e) => {
                          const next = [...allergiesList];
                          next[idx].reaction = e.target.value;
                          setAllergiesList(next);
                        }}
                        className="flex-1 rounded-xl border border-slate-200 p-2"
                      />
                      <button
                        type="button"
                        onClick={() => setAllergiesList(allergiesList.filter((_, i) => i !== idx))}
                        className="text-rose-500 hover:text-rose-700 p-1"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setAllergiesList([...allergiesList, { substance: '', reaction: '' }])
                    }
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                  >
                    <Plus size={14} /> Add Allergy
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h2 className="text-lg font-bold text-slate-900">
                Step 5: 10-System Review of Systems (ROS)
              </h2>
              <button
                type="button"
                onClick={() => {
                  const allNeg = Object.fromEntries(ROS_SYSTEMS.map((s) => [s.id, 'Negative']));
                  setRosStates(allNeg as any);
                }}
                className="text-xs font-semibold text-blue-600 hover:underline"
              >
                Set All Negative
              </button>
            </div>
            <div className="space-y-2.5">
              {ROS_SYSTEMS.map((sys) => (
                <div
                  key={sys.id}
                  className="flex flex-col justify-between rounded-xl border border-slate-100 bg-slate-50 p-2.5 sm:flex-row sm:items-center text-xs"
                >
                  <span className="font-semibold text-slate-800 sm:max-w-md">{sys.label}</span>
                  <div className="flex items-center gap-3 mt-1.5 sm:mt-0">
                    {(['Negative', 'Positive', 'Not Reviewed'] as const).map((opt) => (
                      <label key={opt} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="radio"
                          name={`ros-${sys.id}`}
                          checked={rosStates[sys.id] === opt}
                          onChange={() => setRosStates({ ...rosStates, [sys.id]: opt })}
                          className="accent-blue-600"
                        />
                        <span
                          className={`text-[11px] font-medium ${
                            opt === 'Positive'
                              ? 'text-rose-600'
                              : opt === 'Negative'
                              ? 'text-emerald-700'
                              : 'text-slate-400'
                          }`}
                        >
                          {opt}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === 6 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-slate-900 border-b border-slate-100 pb-2">
              Step 6: Legal Consents & Primary Care Provider Assignment
            </h2>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-900">
              <p className="font-bold">Auto-Generated Medical Record Number (MRN):</p>
              <p className="mt-1 font-mono text-xl font-black text-blue-700">{autoMrn}</p>
            </div>

            <div className="text-xs space-y-2.5">
              <label className="font-semibold text-slate-700 block">
                Assign Primary Care Clinician (PCP) *
              </label>
              <select
                value={assignedPcp}
                onChange={(e) => setAssignedPcp(e.target.value)}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
              >
                <option value="">Select clinician…</option>
              </select>
            </div>

            <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentHipaa}
                  onChange={(e) => setConsentHipaa(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600"
                  required
                />
                <span className="text-slate-700">
                  <strong>HIPAA Notice of Privacy Practices:</strong> Patient acknowledges receipt
                  and agrees to standard healthcare operations and treatment disclosures.
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentTreatment}
                  onChange={(e) => setConsentTreatment(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600"
                  required
                />
                <span className="text-slate-700">
                  <strong>Informed General Medical Treatment Consent:</strong> Authorizes outpatient
                  examinations, somatic diagnostics, routine blood tests, and telehealth encounters.
                </span>
              </label>
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={consentFinancial}
                  onChange={(e) => setConsentFinancial(e.target.checked)}
                  className="mt-0.5 rounded text-blue-600"
                  required
                />
                <span className="text-slate-700">
                  <strong>Assignment of Benefits & Financial Agreement:</strong> Authorizes direct
                  payer reimbursement and agrees to copayment / deductible responsibility.
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Stepper Navigation Buttons */}
        <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <div />
          )}

          {step < 6 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-500"
            >
              Next Step <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleFinish}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white shadow-md shadow-emerald-600/30 transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <CheckCircle2 size={16} />
              {isSubmitting ? 'Onboarding Patient...' : 'Complete Intake & Open Chart'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
