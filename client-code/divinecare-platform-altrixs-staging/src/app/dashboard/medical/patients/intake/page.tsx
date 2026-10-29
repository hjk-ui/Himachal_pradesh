'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
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
import { AllergenInput, DrugPicker } from '@/components/ui/DrugPicker';
import type { AllergenType } from '@/lib/drugs/types';
import { PRIMARY_CARE_LOCATION_NAMES } from '@/lib/medical/medicalProgram';
import { primaryCareChartHref } from '@/lib/medical/primaryCareRoster';
import {
  ADMINISTRATIVE_SEX,
  ETHNICITY,
  GENDER_IDENTITY,
  LANGUAGES,
  NULL_FLAVORS,
  PRONOUNS,
  RACE,
  RELATIONSHIPS,
  SEX_AT_BIRTH,
  SEXUAL_ORIENTATION,
  US_STATES,
  normalizeUsPhone,
  normalizeUsZip,
} from '@/lib/clients/demographics';
import { buttonClasses } from '@/components/ui';

/** Whole years since the DOB (0 when not entered); outside the component so render stays pure */
function ageInYears(dob: string): number {
  if (!dob) return 0;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25));
}

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
  const [legalFirstName, setLegalFirstName] = useState('');
  const [middleInitial, setMiddleInitial] = useState('');
  const [legalLastName, setLegalLastName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [dob, setDob] = useState('');
  const [intakeError, setIntakeError] = useState('');
  // Same name + DOB clients found by the server; staff open one or confirm a separate record
  const [duplicates, setDuplicates] = useState<{ id: string; name: string; mrn: string | null }[]>([]);
  // Coded answers (src/lib/clients/demographics.ts); nothing is pre-selected or defaulted
  const [administrativeSex, setAdministrativeSex] = useState('');
  const [sexAtBirth, setSexAtBirth] = useState('');
  const [genderIdentity, setGenderIdentity] = useState('');
  const [sexualOrientation, setSexualOrientation] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [race, setRace] = useState<string[]>([]);
  const [ethnicity, setEthnicity] = useState('');
  const [language, setLanguage] = useState('');
  const [interpreterNeeded, setInterpreterNeeded] = useState<'' | 'yes' | 'no'>('');

  // Step 2: Contact, Insurance & Guarantor
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [addrState, setAddrState] = useState('');
  const [zip, setZip] = useState('');
  // Nothing pre-filled: every value saved is one staff entered
  const [primaryPayer, setPrimaryPayer] = useState('');
  const [memberId, setMemberId] = useState('');
  const [groupNumber, setGroupNumber] = useState('');
  const [hasSecondary, setHasSecondary] = useState(false);
  const [secondaryPayer, setSecondaryPayer] = useState('');
  const [secondaryMemberId, setSecondaryMemberId] = useState('');
  const [guarantorIsSelf, setGuarantorIsSelf] = useState(true);
  const [emergencyContactName, setEmergencyContactName] = useState('');
  const [emergencyContactPhone, setEmergencyContactPhone] = useState('');
  const [emergencyContactRel, setEmergencyContactRel] = useState('');

  // Step 3: Medical History
  const [checkedPmh, setCheckedPmh] = useState<string[]>([]);
  const [customPmh, setCustomPmh] = useState('');
  const [surgeries, setSurgeries] = useState<Array<{ name: string; year: string }>>([]);
  const [familyHistory, setFamilyHistory] = useState('');
  const [tobaccoStatus, setTobaccoStatus] = useState('Former smoker (quit > 1 yr)');
  const [alcoholUse, setAlcoholUse] = useState('Moderate (1-2 drinks/week)');

  // Step 4: Meds & Allergies
  const [noActiveMeds, setNoActiveMeds] = useState(false);
  // rxcui: RxNorm drug chosen in the typeahead (null = free text, coded later from the chart)
  const [medsList, setMedsList] = useState<Array<{ name: string; dose: string; freq: string; rxcui: string | null; tty?: string | null }>>([]);
  const [nkda, setNkda] = useState(false);
  const [allergiesList, setAllergiesList] = useState<
    Array<{ substance: string; reaction: string; allergenType: AllergenType; rxcui: string | null; tty?: string | null }>
  >([]);

  // Step 5: Review of Systems (ROS)
  const [rosStates, setRosStates] = useState<Record<string, 'Negative' | 'Positive' | 'Not Reviewed'>>(
    () => Object.fromEntries(ROS_SYSTEMS.map((s) => [s.id, 'Negative']))
  );
  const [rosNotes, setRosNotes] = useState('');

  // Step 6: Consents & PCP Assignment
  // PCP: an active physician / medical NP (GET /api/medical/patients/intake providers); stored on the care team
  const [pcpUserId, setPcpUserId] = useState('');
  const [pcpChoices, setPcpChoices] = useState<{ id: string; name: string }[] | null>(null);
  // Primary care is offered only at these locations (src/lib/medical/medicalProgram.ts)
  const [locations, setLocations] = useState<{ id: string; name: string; city: string | null }[] | null>(null);
  const [locationId, setLocationId] = useState('');
  useEffect(() => {
    let live = true;
    fetch('/api/medical/patients/intake', { cache: 'no-store' })
      .then((r) => r.json().catch(() => ({})))
      .then((body) => {
        if (!live) return;
        const list = Array.isArray(body.locations) ? body.locations : [];
        setLocations(list);
        setPcpChoices(Array.isArray(body.providers) ? body.providers : []);
        if (list.length === 1) setLocationId(list[0].id);
      })
      .catch(() => {
        if (!live) return;
        setLocations([]);
        setPcpChoices([]);
      });
    return () => {
      live = false;
    };
  }, []);
  const [consentHipaa, setConsentHipaa] = useState(true);
  const [consentTreatment, setConsentTreatment] = useState(true);
  const [consentFinancial, setConsentFinancial] = useState(true);

  // Auto-calculated Age
  const calculatedAge = useMemo(() => ageInYears(dob), [dob]);


  const handleFinish = async (e?: React.FormEvent, confirmNewClient = false) => {
    e?.preventDefault();
    setDuplicates([]);
    if (!legalFirstName.trim() || !legalLastName.trim()) {
      setIntakeError('Legal first and last name are required (Step 1).');
      setStep(1);
      return;
    }
    if (!dob) {
      setIntakeError('Date of birth is required. Please enter it in Step 1 (Identity).');
      setStep(1);
      return;
    }
    if (!administrativeSex) {
      setIntakeError('Sex (as on the insurance card or ID) is required in Step 1; choose Unknown if it is not on the card.');
      setStep(1);
      return;
    }
    if ((phone.trim() && !normalizeUsPhone(phone)) || (emergencyContactPhone.trim() && !normalizeUsPhone(emergencyContactPhone))) {
      setIntakeError('Phone numbers must be valid 10-digit US numbers (Step 2).');
      setStep(2);
      return;
    }
    if (zip.trim() && !normalizeUsZip(zip)) {
      setIntakeError('ZIP must be 5 digits or ZIP+4 (Step 2).');
      setStep(2);
      return;
    }
    if (locations && locations.length > 1 && !locationId) {
      setIntakeError(`Choose the primary care location (${PRIMARY_CARE_LOCATION_NAMES.join(' or ')}) in Step 6.`);
      setStep(6);
      return;
    }
    if (!pcpUserId) {
      setIntakeError('Choose the primary care provider (PCP) in Step 6.');
      setStep(6);
      return;
    }
    setIntakeError('');
    setIsSubmitting(true);

    try {
      const res = await fetch('/api/medical/patients/intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          legalFirstName,
          middleInitial: middleInitial || undefined,
          legalLastName,
          preferredName,
          dob,
          administrativeSex,
          sexAtBirth: sexAtBirth || undefined,
          genderIdentity: genderIdentity || undefined,
          sexualOrientation: sexualOrientation || undefined,
          pronouns: pronouns || undefined,
          race: race.length ? race : undefined,
          ethnicity: ethnicity || undefined,
          preferredLanguage: language || undefined,
          interpreterNeeded: interpreterNeeded === '' ? undefined : interpreterNeeded === 'yes',
          phone: phone || undefined,
          email,
          addressLine1: addressLine1 || undefined,
          addressLine2: addressLine2 || undefined,
          city: city || undefined,
          state: addrState || undefined,
          zip: zip || undefined,
          emergencyContactRelationship: emergencyContactRel || undefined,
          primaryPayer,
          memberId,
          groupNumber,
          secondaryPayer: hasSecondary ? secondaryPayer : undefined,
          secondaryMemberId: hasSecondary ? secondaryMemberId : undefined,
          emergencyContactName,
          emergencyContactPhone,
          pcpUserId,
          locationId: locationId || undefined,
          checkedPmh,
          medsList: noActiveMeds ? [] : medsList,
          allergiesList: nkda ? [] : allergiesList,
          confirmNewClient,
          consents: {
            hipaaConsent: consentHipaa,
            treatmentConsent: consentTreatment,
            billingConsent: consentFinancial,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && Array.isArray(data.duplicates)) {
        setDuplicates(data.duplicates);
        setIntakeError(data.error || 'A client with this name and date of birth already exists.');
        setIsSubmitting(false);
        return;
      }
      if (!res.ok || !data.clientId) {
        setIntakeError(data.error || `Intake could not be saved (${res.status}). Nothing was created.`);
        setIsSubmitting(false);
        return;
      }
      // RxNav was down: some drugs were saved uncoded (the chart's DrFirst panel lists them to code)
      if (data.warning) toast(data.warning);
      // One patient record: open the client chart on its Medical tab group
      router.push(primaryCareChartHref(data.clientId));
    } catch {
      setIntakeError('Intake could not be saved (network error). Nothing was created.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-20">
      <MedicalNavHeader
        title="Medical Patient Clinical Intake Wizard"
        subtitle="ONC 2022 §170.315(a)(5) compliant guided onboarding for new somatic primary care patients"
      />

      {/* Progress Stepper Bar */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex justify-between items-center text-xs font-semibold text-slate-500 mb-2">
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
          <span className={step >= 1 ? 'text-blue-700 font-semibold' : ''}>1. Identity</span>
          <span className={step >= 2 ? 'text-blue-700 font-semibold' : ''}>2. Insurance</span>
          <span className={step >= 3 ? 'text-blue-700 font-semibold' : ''}>3. PMH/Social</span>
          <span className={step >= 4 ? 'text-blue-700 font-semibold' : ''}>4. Meds/Allergies</span>
          <span className={step >= 5 ? 'text-blue-700 font-semibold' : ''}>5. Review of Systems</span>
          <span className={step >= 6 ? 'text-blue-700 font-semibold' : ''}>6. Consents & PCP</span>
        </div>
      </div>

      {intakeError && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm font-semibold text-rose-800">
          {intakeError}
          {duplicates.length ? (
            <div className="mt-2 space-y-1.5 text-xs font-medium">
              {duplicates.map((d) => (
                <Link key={d.id} href={primaryCareChartHref(d.id)} className="block text-blue-600 underline">
                  Open existing chart: {d.name}
                  {d.mrn ? ` (MRN ${d.mrn})` : ''}
                </Link>
              ))}
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => void handleFinish(undefined, true)}
                className="rounded-lg border border-rose-300 bg-white px-3 py-1 font-semibold text-rose-800 hover:bg-rose-100"
              >
                Different person: create a separate record
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* Step Form Box */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-2">
              Step 1: Patient Identity & ONC SOGI Demographics
            </h2>
            <div className="grid gap-4 sm:grid-cols-2 text-xs">
              <div className="sm:col-span-2 grid grid-cols-[repeat(4,minmax(0,1fr))] gap-2 sm:grid-cols-6">
                <div className="col-span-3 sm:col-span-2">
                  <label className="font-semibold text-slate-700">Legal First Name *</label>
                  <input type="text" value={legalFirstName} onChange={(e) => setLegalFirstName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" required />
                </div>
                <div className="col-span-1">
                  <label className="font-semibold text-slate-700">M.I.</label>
                  <input type="text" value={middleInitial} onChange={(e) => setMiddleInitial(e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase())} maxLength={1} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" />
                </div>
                <div className="col-span-4 sm:col-span-3">
                  <label className="font-semibold text-slate-700">Legal Last Name *</label>
                  <input type="text" value={legalLastName} onChange={(e) => setLegalLastName(e.target.value)} maxLength={80} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" required />
                </div>
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
                <label className="font-semibold text-slate-700">Sex (as on insurance card / ID) *</label>
                <select value={administrativeSex} onChange={(e) => setAdministrativeSex(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Select…</option>
                  {ADMINISTRATIVE_SEX.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Sex Assigned at Birth</label>
                <select value={sexAtBirth} onChange={(e) => setSexAtBirth(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {SEX_AT_BIRTH.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Gender Identity</label>
                <select value={genderIdentity} onChange={(e) => setGenderIdentity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {GENDER_IDENTITY.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Preferred Pronouns</label>
                <select value={pronouns} onChange={(e) => setPronouns(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {PRONOUNS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Sexual Orientation</label>
                <select value={sexualOrientation} onChange={(e) => setSexualOrientation(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {SEXUAL_ORIENTATION.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Ethnicity</label>
                <select value={ethnicity} onChange={(e) => setEthnicity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {ETHNICITY.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div className="sm:col-span-2">
                <span className="font-semibold text-slate-700">OMB Race (select all that apply)</span>
                <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {RACE.map((r) => (
                    <label key={r.code} className="flex items-center gap-2 text-slate-700">
                      <input
                        type="checkbox"
                        checked={race.includes(r.code)}
                        onChange={() => {
                          const next = race.includes(r.code)
                            ? race.filter((c) => c !== r.code)
                            : NULL_FLAVORS.has(r.code)
                              ? [r.code]
                              : [...race.filter((c) => !NULL_FLAVORS.has(c)), r.code];
                          setRace(RACE.map((x) => x.code).filter((c) => next.includes(c)));
                        }}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Preferred Language</label>
                <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {LANGUAGES.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Interpreter Needed</label>
                <select value={interpreterNeeded} onChange={(e) => setInterpreterNeeded(e.target.value as '' | 'yes' | 'no')} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-2">
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
                  placeholder="123 Main St"
                  value={addressLine1}
                  onChange={(e) => setAddressLine1(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                />
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <input type="text" placeholder="Apt / Suite" aria-label="Apartment or suite" value={addressLine2} onChange={(e) => setAddressLine2(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" />
                  <input type="text" placeholder="City" aria-label="City" value={city} onChange={(e) => setCity(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" />
                  <select aria-label="State" value={addrState} onChange={(e) => setAddrState(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                    <option value="">State</option>
                    {US_STATES.map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}
                  </select>
                  <input type="text" placeholder="ZIP" aria-label="ZIP code" value={zip} onChange={(e) => setZip(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600" />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700">Primary Health Insurance</label>
                <select
                  value={primaryPayer}
                  onChange={(e) => setPrimaryPayer(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                >
                  <option value="">Not recorded</option>
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
                <label className="font-semibold text-slate-700">Emergency Contact Relationship</label>
                <select value={emergencyContactRel} onChange={(e) => setEmergencyContactRel(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600">
                  <option value="">Not recorded</option>
                  {RELATIONSHIPS.filter((o) => o.code !== 'ONESELF').map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                </select>
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
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-2">
              Step 3: Past Medical (PMH), Surgical & Social History
            </h2>
            <div className="text-xs">
              <label className="font-semibold text-slate-800">
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
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-2">
              Step 4: Medications & Allergies
            </h2>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
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
                    <div key={idx} className="flex flex-wrap gap-2 items-center text-xs sm:flex-nowrap">
                      <div className="min-w-0 w-full sm:w-auto sm:flex-1">
                        <DrugPicker
                          kind="medication"
                          value={{ text: m.name, rxcui: m.rxcui, tty: m.tty }}
                          onChange={(pick) => {
                            const next = [...medsList];
                            next[idx] = { ...next[idx], name: pick.text, rxcui: pick.rxcui, tty: pick.tty };
                            setMedsList(next);
                          }}
                          placeholder="Drug name (brand or generic)"
                          className="w-full rounded-xl border border-slate-200 p-2"
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Dosage (e.g. 10mg)"
                        value={m.dose}
                        onChange={(e) => {
                          const next = [...medsList];
                          next[idx].dose = e.target.value;
                          setMedsList(next);
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 p-2 sm:w-24 sm:flex-none"
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
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 p-2 sm:w-24 sm:flex-none"
                      />
                      <button
                        type="button"
                        onClick={() => setMedsList(medsList.filter((_, i) => i !== idx))}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setMedsList([...medsList, { name: '', dose: '', freq: 'Daily', rxcui: null }])}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"
                  >
                    <Plus size={14} /> Add Another Medication
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wider">
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
                    <div key={idx} className="flex flex-wrap gap-2 items-center text-xs sm:flex-nowrap">
                      <div className="min-w-0 w-full sm:w-auto sm:flex-[2]">
                        <AllergenInput
                          value={{ text: a.substance, rxcui: a.rxcui, tty: a.tty, allergenType: a.allergenType }}
                          onChange={(pick) => {
                            const next = [...allergiesList];
                            next[idx] = { ...next[idx], substance: pick.text, rxcui: pick.rxcui, tty: pick.tty, allergenType: pick.allergenType };
                            setAllergiesList(next);
                          }}
                        />
                      </div>
                      <input
                        type="text"
                        placeholder="Reaction (e.g. Hives, rash)"
                        value={a.reaction}
                        onChange={(e) => {
                          const next = [...allergiesList];
                          next[idx].reaction = e.target.value;
                          setAllergiesList(next);
                        }}
                        className="min-w-0 flex-1 rounded-xl border border-slate-200 p-2"
                      />
                      <button
                        type="button"
                        onClick={() => setAllergiesList(allergiesList.filter((_, i) => i !== idx))}
                        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setAllergiesList([...allergiesList, { substance: '', reaction: '', allergenType: 'drug', rxcui: null }])
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
              <h2 className="text-lg font-semibold text-slate-900">
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
                              : 'text-slate-500'
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
            <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-2">
              Step 6: Legal Consents & Primary Care Provider Assignment
            </h2>
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-900">
              <p className="font-semibold">Medical Record Number (MRN)</p>
              <p className="mt-1">
                Assigned when the intake is saved. The patient gets one client chart (shared with behavioral health); it
                opens on its Medical tabs.
              </p>
            </div>

            <div className="text-xs space-y-2.5">
              <label htmlFor="pc-location" className="font-semibold text-slate-700 block">
                Primary care location *
              </label>
              {locations === null ? (
                <p className="text-slate-500">Loading locations…</p>
              ) : locations.length ? (
                <select
                  id="pc-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                >
                  {locations.length > 1 ? <option value="">Select location</option> : null}
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                  No active {PRIMARY_CARE_LOCATION_NAMES.join(' / ')} location is set up for this practice, so the
                  patient is saved without a location.
                </p>
              )}
            </div>

            <div className="text-xs space-y-2.5">
              <label htmlFor="pc-pcp" className="font-semibold text-slate-700 block">
                Primary care provider (PCP) *
              </label>
              {pcpChoices === null ? (
                <p className="text-slate-500">Loading providers…</p>
              ) : pcpChoices.length ? (
                <select
                  id="pc-pcp"
                  value={pcpUserId}
                  onChange={(e) => setPcpUserId(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-sm outline-none focus:border-blue-600"
                  required
                >
                  <option value="">Select the PCP</option>
                  {pcpChoices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-amber-800">
                  No active physician or medical NP is set up for this practice. Add one in Admin › Users &amp; Roles before
                  registering a primary care patient.
                </p>
              )}
              <p className="text-slate-500">The PCP is separate from the behavioral health clinician.</p>
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
        <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
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
              onClick={() => {
                if (step === 1 && !dob) {
                  setIntakeError('Date of birth is required before continuing.');
                  return;
                }
                setIntakeError('');
                setStep(step + 1);
              }}
              className={buttonClasses({ size: 'sm' })}
            >
              Next Step <ArrowRight size={14} />
            </button>
          ) : (
            <button
              type="button"
              disabled={isSubmitting}
              onClick={(e) => void handleFinish(e)}
              className={buttonClasses({ size: 'sm' })}
            >
              <CheckCircle2 size={16} />
              {isSubmitting ? 'Onboarding Patient…' : 'Complete Intake & Open Chart'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
