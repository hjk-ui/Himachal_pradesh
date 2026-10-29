'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, ChevronRight, ChevronLeft, Shield, Loader2, AlertTriangle } from 'lucide-react';
import { splitFullName } from '@/lib/clients/legalName';
import {
  ADMINISTRATIVE_SEX,
  DECLINED,
  ETHNICITY,
  GENDER_IDENTITY,
  LANGUAGES,
  NULL_FLAVORS,
  PRONOUNS,
  RACE,
  RELATIONSHIPS,
  US_STATES,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
} from '@/lib/clients/demographics';
import { CarelonPartAForm } from '@/components/consents/CarelonPartAForm';
import { carelonTemplate } from '@/lib/consents/carelon/template';
import { marylandMedicaidPayerLabel } from '@/lib/consents/carelon/medicaid';
import type { PartAInput } from '@/lib/consents/carelon/workflow';
import { ConsentPacketForm, SignerBlock, type PacketFormItem } from '@/components/consents/ConsentPacketForm';
import { SERVICES_INTERESTED, type MinorRule } from '@/lib/consents/library/composer';
import { validatePacketSubmission, type PacketSubmission, type SignerInput } from '@/lib/consents/library/signing';
import { ssnError, SSN_OPTIONAL_NOTE } from '@/lib/clients/ssn';

/** Maryland HealthChoice (Medicaid) MCOs, listed so the Carelon attestation is offered to every MCO member */
const MD_MEDICAID_PLANS = [
  'Aetna Better Health of Maryland',
  'CareFirst Community Health Plan Maryland',
  'Jai Medical Systems',
  'Kaiser Permanente HealthChoice',
  'Maryland Physicians Care',
  'MedStar Family Choice',
  'Priority Partners',
  'UnitedHealthcare Community Plan (Maryland)',
  'Wellpoint Maryland (Amerigroup)',
];

const STEPS = ['Demographics', 'Insurance', 'Medical History', 'Consents', 'Signature'];

type FormState = {
  firstName: string;
  middleInitial: string;
  lastName: string;
  dateOfBirth: string;
  /** Coded (src/lib/clients/demographics.ts); "" = not answered */
  pronouns: string;
  administrativeSex: string;
  genderIdentity: string;
  race: string[];
  ethnicity: string;
  preferredLanguage: string;
  interpreterNeeded: '' | 'yes' | 'no';
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  email: string;
  emergencyContactName: string;
  emergencyContactRelationship: string;
  emergencyContactPhone: string;
  primaryPayer: string;
  memberId: string;
  groupNumber: string;
  subscriberName: string;
  subscriberDob: string;
  subscriberRelationship: string;
  secondaryPayer: string;
  secondaryMemberId: string;
  secondaryGroupNumber: string;
  medications: string;
  allergies: string;
  previousTreatment: string;
  pcpName: string;
  pcpPhone: string;
  reasonForSeeking: string;
  substanceUse: string;
  consents: Record<string, boolean>;
  signatureName: string;
  /** Packet fields (source form page 6-7). SSN is optional (review note 4). */
  ssn: string;
  hasGuardian: '' | 'yes' | 'no';
  guardianName: string;
  guardianRelationship: string;
  guardianPhone: string;
  guardianEmail: string;
  servicesInterested: string[];
  wantsTelehealth: '' | 'yes' | 'no';
};

const emptyForm = (prefill?: {
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string | null;
}): FormState => {
  // Staff send the invite as "First M. Last"; the client confirms each part below.
  const { firstName, middleInitial, lastName } = splitFullName(prefill?.clientName);
  return {
    firstName,
    middleInitial,
    lastName,
    dateOfBirth: '',
    pronouns: '',
    administrativeSex: '',
    genderIdentity: '',
    race: [],
    ethnicity: '',
    preferredLanguage: '',
    interpreterNeeded: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    phone: prefill?.clientPhone || '',
    email: prefill?.clientEmail || '',
    emergencyContactName: '',
    emergencyContactRelationship: '',
    emergencyContactPhone: '',
    primaryPayer: '',
    memberId: '',
    groupNumber: '',
    subscriberName: '',
    subscriberDob: '',
    subscriberRelationship: 'Self',
    secondaryPayer: '',
    secondaryMemberId: '',
    secondaryGroupNumber: '',
    medications: '',
    allergies: '',
    previousTreatment: '',
    pcpName: '',
    pcpPhone: '',
    reasonForSeeking: '',
    substanceUse: '',
    consents: {},
    signatureName: '',
    ssn: '',
    hasGuardian: '',
    guardianName: '',
    guardianRelationship: '',
    guardianPhone: '',
    guardianEmail: '',
    servicesInterested: [],
    wantsTelehealth: '',
  };
};

type IntakePacket = { items: PacketFormItem[]; minor: MinorRule | null; carelonAttestation: boolean; practiceName: string | null };

function ProgressBar({ step, total }: { step: number; total: number }) {
  return (
    <div className="mb-8 flex items-center gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="h-1.5 flex-1 rounded-full transition-colors"
          style={{
            backgroundColor: i < step ? '#5C2D91' : i === step ? '#7C3AED' : '#e5e7eb',
          }}
        />
      ))}
    </div>
  );
}

function Label({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className="mb-1 block text-xs font-semibold text-slate-600">
      {children}
      {required && <span className="ml-0.5 text-red-500">*</span>}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`min-h-11 w-full rounded-xl border border-slate-200 p-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${props.className || ''}`}
    />
  );
}

function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="min-h-11 w-full rounded-xl border border-slate-200 p-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
    >
      {children}
    </select>
  );
}

function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className="w-full resize-none rounded-xl border border-slate-200 p-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30"
    />
  );
}

export default function IntakeFormPage() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => String(params?.token || ''), [params]);

  const [step, setStep] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [homeless, setHomeless] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm());
  /** Carelon non-overlap attestation Part A (Maryland Medicaid payers only) */
  const [carelon, setCarelon] = useState<{ input: PartAInput; errors: string[] } | null>(null);
  const carelonRequired = Boolean(marylandMedicaidPayerLabel(form.primaryPayer));
  /** Consent library packet composed for these answers (null until loaded; items [] = none Active) */
  const [packet, setPacket] = useState<IntakePacket | null>(null);
  const [packetLoading, setPacketLoading] = useState(false);
  const [packetSections, setPacketSections] = useState<{ sub: PacketSubmission; errors: string[] } | null>(null);
  const [signer, setSigner] = useState<SignerInput>({ signerType: 'self', printedName: '', relationship: '', authority: '', signature: '', agree: false });
  const usePacket = Boolean(packet && packet.items.length);
  const onPacketChange = useCallback((sub: PacketSubmission, errors: string[]) => setPacketSections({ sub, errors }), []);

  const loadPacket = async () => {
    setPacketLoading(true);
    try {
      const res = await fetch(`/api/intake/public/${token}/packet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dateOfBirth: form.dateOfBirth || null,
          servicesInterested: form.servicesInterested,
          wantsTelehealth: form.wantsTelehealth === 'yes',
          insurancePayer: form.primaryPayer || null,
          emergencyContact: form.emergencyContactName.trim() ? { name: form.emergencyContactName.trim(), relationship: form.emergencyContactRelationship || null, phone: form.emergencyContactPhone || null } : null,
        }),
      });
      const data = await res.json();
      setPacket(res.ok && data.success ? { items: data.items, minor: data.minor, carelonAttestation: data.carelonAttestation, practiceName: data.practiceName } : { items: [], minor: null, carelonAttestation: false, practiceName: null });
      if (res.ok && data.success && data.minor && !data.minor.mayConsentAlone) {
        setSigner((sg) => ({ ...sg, signerType: 'representative', printedName: sg.printedName || form.guardianName, relationship: sg.relationship || '' }));
      } else {
        setSigner((sg) => ({ ...sg, printedName: sg.printedName || `${form.firstName} ${form.lastName}`.trim() }));
      }
    } catch {
      setPacket({ items: [], minor: null, carelonAttestation: false, practiceName: null });
    } finally {
      setPacketLoading(false);
    }
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const loadInvite = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/intake/public/${token}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        setLoadError(data.error || 'This intake link is invalid');
        return;
      }
      if (data.alreadyCompleted) {
        setAlreadyCompleted(true);
        setSubmitted(true);
        return;
      }
      setHomeless(Boolean(data.invite?.homeless));
      setForm(emptyForm(data.invite));
    } catch {
      setLoadError('Could not load intake form');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadInvite();
  }, [loadInvite]);

  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.firstName.trim() || !form.lastName.trim()) return 'First and last name are required';
      if (!form.dateOfBirth) return 'Date of birth is required';
      if (!homeless && !form.addressLine1.trim()) return 'Home address is required';
      if (!form.administrativeSex) return 'Sex (as on your insurance card or ID) is required; "Unknown" is an option';
      if (!form.phone.trim()) return 'Phone is required';
      if (!normalizeUsPhone(form.phone)) return 'Phone must be a 10-digit US number';
      if (form.emergencyContactPhone.trim() && !normalizeUsPhone(form.emergencyContactPhone)) return 'Emergency contact phone must be a 10-digit US number';
      if (form.state && !normalizeStateCode(form.state)) return 'State must be a US state';
      if (form.postalCode.trim() && !normalizeUsZip(form.postalCode)) return 'ZIP must be 5 digits (or ZIP+4)';
      if (!form.email.trim()) return 'Email is required';
      const ssnProblem = ssnError(form.ssn);
      if (ssnProblem) return ssnProblem;
      if (!form.hasGuardian) return 'Please answer whether the client has a guardian';
      if (form.hasGuardian === 'yes' && (!form.guardianName.trim() || !form.guardianRelationship.trim())) return 'Enter the guardian name and relationship';
      if (form.hasGuardian === 'yes' && form.guardianPhone.trim() && !normalizeUsPhone(form.guardianPhone)) return 'Guardian phone must be a 10-digit US number';
      if (!form.servicesInterested.length) return 'Choose at least one service you are interested in';
    }
    if (s === 1) {
      if (!form.primaryPayer.trim()) return 'Primary insurance is required';
    }
    if (s === 3) {
      if (!packet) return 'The consent packet is still loading';
      if (usePacket) {
        if (packetSections?.errors.length) return packetSections.errors[0];
      } else {
        const required = ['hipaa', 'treatment', 'telehealth', 'financial'];
        if (!required.every((k) => form.consents[k])) {
          return 'Please agree to all consent items before continuing';
        }
      }
      if (carelonRequired && (!carelon || carelon.errors.length)) {
        return carelon?.errors[0] ?? 'Please complete the Carelon attestation (Maryland Medicaid) before continuing';
      }
    }
    return null;
  };

  const onContinue = () => {
    const err = validateStep(step);
    if (err) {
      alert(err);
      return;
    }
    if (step === 2) void loadPacket();
    setStep((s) => s + 1);
  };

  const onSubmit = async () => {
    let consentPacket: PacketSubmission | undefined;
    if (usePacket && packet) {
      consentPacket = { sections: packetSections?.sub.sections ?? {}, signer };
      const errs = validatePacketSubmission(packet.items, new Map(packet.items.map((it) => [it.key, it.rendered])), consentPacket, packet.minor);
      if (errs.length) {
        setSubmitError(errs[0]);
        return;
      }
    } else if (!form.signatureName.trim()) {
      alert('Please type your full legal name as signature');
      return;
    }
    const signatureName = usePacket ? signer.printedName.trim() : form.signatureName.trim();
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch(`/api/intake/public/${token}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demographics: {
            firstName: form.firstName,
            middleInitial: form.middleInitial || null,
            lastName: form.lastName,
            dateOfBirth: form.dateOfBirth,
            pronouns: form.pronouns || null,
            administrativeSex: form.administrativeSex || null,
            genderIdentity: form.genderIdentity || null,
            race: form.race.length ? form.race : null,
            ethnicity: form.ethnicity || null,
            preferredLanguage: form.preferredLanguage || null,
            interpreterNeeded: form.interpreterNeeded === '' ? null : form.interpreterNeeded === 'yes',
            addressLine1: form.addressLine1 || null,
            addressLine2: form.addressLine2 || null,
            city: form.city || null,
            state: form.state || null,
            postalCode: form.postalCode || null,
            phone: form.phone,
            email: form.email,
            emergencyContactName: form.emergencyContactName || null,
            emergencyContactRelationship: form.emergencyContactRelationship || null,
            emergencyContactPhone: form.emergencyContactPhone || null,
          },
          insurance: {
            primaryPayer: form.primaryPayer,
            memberId: form.memberId || null,
            groupNumber: form.groupNumber || null,
            subscriberName: form.subscriberName || null,
            subscriberDob: form.subscriberDob || null,
            subscriberRelationship: form.subscriberRelationship || null,
            secondaryPayer: form.secondaryPayer || null,
            secondaryMemberId: form.secondaryMemberId || null,
            secondaryGroupNumber: form.secondaryGroupNumber || null,
          },
          medicalHistory: {
            medications: form.medications,
            allergies: form.allergies,
            previousTreatment: form.previousTreatment,
            pcpName: form.pcpName,
            pcpPhone: form.pcpPhone,
            reasonForSeeking: form.reasonForSeeking,
            substanceUse: form.substanceUse,
          },
          consents: form.consents,
          ...(carelonRequired && carelon && !carelon.errors.length ? { carelonAttestation: carelon.input } : {}),
          identity: { ssn: form.ssn.trim() || null },
          guardian: { hasGuardian: form.hasGuardian === 'yes', name: form.guardianName || null, relationship: form.guardianRelationship || null, phone: form.guardianPhone || null, email: form.guardianEmail || null },
          servicesInterested: form.servicesInterested,
          wantsTelehealth: form.wantsTelehealth === '' ? null : form.wantsTelehealth === 'yes',
          ...(consentPacket ? { consentPacket } : {}),
          signature: {
            fullName: signatureName,
            signedAt: new Date().toISOString(),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setSubmitError(data.error || 'Could not submit intake');
        return;
      }
      setSubmitted(true);
    } catch {
      setSubmitError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 to-white">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="animate-spin" size={16} /> Loading secure intake…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-blue-50 to-white p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto mb-4 text-amber-500" size={32} />
          <h1 className="mb-2 text-xl font-bold text-slate-900">Intake unavailable</h1>
          <p className="text-sm text-slate-500">{loadError}</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-purple-50 to-white p-6">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-50">
            <CheckCircle2 size={32} className="text-green-600" />
          </div>
          <h1 className="mb-3 text-2xl font-bold text-slate-900">
            {alreadyCompleted ? 'Already completed' : 'Intake Complete!'}
          </h1>
          <p className="mb-6 leading-relaxed text-slate-500">
            {alreadyCompleted
              ? 'This intake form was already submitted. Your care team has your information on file.'
              : 'Thank you for completing your intake paperwork. Your care team will review your information before your first appointment.'}
          </p>
          {!alreadyCompleted ? (
            <div className="rounded-2xl border border-purple-100 bg-white p-4 text-left shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-[#5C2D91]">Next steps</p>
              <ul className="mt-2 space-y-2 text-sm text-slate-600">
                <li>Your clinician reviews this packet before your visit.</li>
                <li>You may get a reminder about 24 hours before your appointment.</li>
                <li>Please bring your insurance card (and ID) to the first visit.</li>
                <li>Questions? Call the clinic number on your appointment confirmation.</li>
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const consents = [
    {
      id: 'hipaa',
      title: 'HIPAA Notice of Privacy Practices',
      body: 'MD Behavioral Health LLC ("Practice") may use and disclose your protected health information (PHI) for treatment, payment, and healthcare operations.',
    },
    {
      id: 'treatment',
      title: 'Informed Consent for Treatment',
      body: 'You voluntarily consent to mental health evaluation, diagnosis, and treatment by licensed clinicians at MD Behavioral Health LLC.',
    },
    {
      id: 'telehealth',
      title: 'Telehealth Consent (if applicable)',
      body: 'If services are delivered via video session, you consent to the use of HIPAA-compliant telehealth technology.',
    },
    {
      id: 'financial',
      title: 'Financial Agreement',
      body: 'You agree to pay co-pays, deductibles, and any non-covered services at time of service.',
    },
  ];

  const today = new Date().toLocaleDateString();

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-purple-50 to-white">
      <div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-xl items-center gap-3">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-white"
            style={{ background: '#5C2D91' }}
          >
            A
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">Altrixs</p>
            <p className="text-xs text-slate-500">New Client Intake · Secure & HIPAA-compliant</p>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-[#5C2D91]">
            <Shield size={12} />
            Encrypted
          </div>
        </div>
      </div>

      <div className="mx-auto w-full min-w-0 max-w-xl px-4 py-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8">
        <div className="mb-6">
          <p className="mb-1 text-xs text-slate-500">
            Step {step + 1} of {STEPS.length} — {STEPS[step]}
          </p>
          <ProgressBar step={step + 1} total={STEPS.length} />
        </div>

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {step === 0 && (
            <div className="space-y-4">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Personal Information</h2>
              {homeless ? (
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
                  <p className="font-semibold">Housing / SDOH</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">
                    Your care team noted no fixed address. Street address is optional — you may
                    leave it blank or enter a mailing / shelter / temporary location if you have one.
                  </p>
                </div>
              ) : null}
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem] gap-3 sm:grid-cols-[minmax(0,1fr)_4.5rem_minmax(0,1fr)]">
                <div>
                  <Label required>Legal First Name</Label>
                  <Input
                    value={form.firstName}
                    onChange={(e) => setField('firstName', e.target.value)}
                    placeholder="First"
                    aria-label="Legal first name"
                  />
                </div>
                <div>
                  <Label>M.I.</Label>
                  <Input
                    value={form.middleInitial}
                    onChange={(e) =>
                      setField('middleInitial', e.target.value.replace(/[^A-Za-z]/g, '').slice(0, 1).toUpperCase())
                    }
                    maxLength={1}
                    className="text-center uppercase"
                    aria-label="Middle initial"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Label required>Legal Last Name</Label>
                  <Input
                    value={form.lastName}
                    onChange={(e) => setField('lastName', e.target.value)}
                    placeholder="Last"
                    aria-label="Legal last name"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label required>Date of Birth</Label>
                  <Input
                    type="date"
                    value={form.dateOfBirth}
                    onChange={(e) => setField('dateOfBirth', e.target.value)}
                  />
                </div>
                <div>
                  <Label required>Sex (as on your insurance card or ID)</Label>
                  <Select
                    value={form.administrativeSex}
                    onChange={(e) => setField('administrativeSex', e.target.value)}
                    aria-label="Sex as on your insurance card or ID"
                  >
                    <option value="">Select…</option>
                    {ADMINISTRATIVE_SEX.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Gender Identity</Label>
                  <Select value={form.genderIdentity} onChange={(e) => setField('genderIdentity', e.target.value)} aria-label="Gender identity">
                    <option value="">Select…</option>
                    {GENDER_IDENTITY.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Preferred Pronouns</Label>
                  <Select value={form.pronouns} onChange={(e) => setField('pronouns', e.target.value)} aria-label="Preferred pronouns">
                    <option value="">Select…</option>
                    {PRONOUNS.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                </div>
              </div>
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-slate-700">Race (select all that apply)</legend>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {RACE.map((r) => (
                    <label key={r.code} className="flex min-h-10 items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0"
                        checked={form.race.includes(r.code)}
                        onChange={() => {
                          const has = form.race.includes(r.code);
                          const next = has
                            ? form.race.filter((c) => c !== r.code)
                            : NULL_FLAVORS.has(r.code)
                              ? [r.code]
                              : [...form.race.filter((c) => !NULL_FLAVORS.has(c)), r.code];
                          setField('race', RACE.map((x) => x.code).filter((c) => next.includes(c)));
                        }}
                      />
                      {r.code === DECLINED ? 'Prefer not to answer' : r.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <Label>Ethnicity</Label>
                  <Select value={form.ethnicity} onChange={(e) => setField('ethnicity', e.target.value)} aria-label="Ethnicity">
                    <option value="">Select…</option>
                    {ETHNICITY.map((o) => <option key={o.code} value={o.code}>{o.code === DECLINED ? 'Prefer not to answer' : o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Preferred Language</Label>
                  <Select value={form.preferredLanguage} onChange={(e) => setField('preferredLanguage', e.target.value)} aria-label="Preferred language">
                    <option value="">Select…</option>
                    {LANGUAGES.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>Need an Interpreter?</Label>
                  <Select value={form.interpreterNeeded} onChange={(e) => setField('interpreterNeeded', e.target.value as '' | 'yes' | 'no')} aria-label="Need an interpreter">
                    <option value="">Select…</option>
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                </div>
              </div>
              <div>
                <Label required={!homeless}>
                  {homeless ? 'Address (optional — no fixed address)' : 'Home Address'}
                </Label>
                <Input
                  value={form.addressLine1}
                  onChange={(e) => setField('addressLine1', e.target.value)}
                  placeholder={homeless ? 'Shelter, mailing, or temporary location (optional)' : 'Street address'}
                />
                <Input
                  className="mt-2"
                  value={form.addressLine2}
                  onChange={(e) => setField('addressLine2', e.target.value)}
                  placeholder="Apt / Suite / Unit (optional)"
                  aria-label="Apartment, suite or unit"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="col-span-2 sm:col-span-1">
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => setField('city', e.target.value)} />
                </div>
                <div>
                  <Label>State</Label>
                  <Select value={form.state} onChange={(e) => setField('state', e.target.value)} aria-label="State">
                    <option value="">Select…</option>
                    {US_STATES.map((o) => <option key={o.code} value={o.code}>{o.code}</option>)}
                  </Select>
                </div>
                <div>
                  <Label>ZIP</Label>
                  <Input
                    value={form.postalCode}
                    onChange={(e) => setField('postalCode', e.target.value)}
                    maxLength={10}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label required>Phone</Label>
                  <Input
                    type="tel"
                    value={form.phone}
                    onChange={(e) => setField('phone', e.target.value)}
                  />
                </div>
                <div>
                  <Label required>Email</Label>
                  <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => setField('email', e.target.value)}
                  />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Emergency Contact</h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={form.emergencyContactName}
                      onChange={(e) => setField('emergencyContactName', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Relationship</Label>
                    <Select
                      value={form.emergencyContactRelationship}
                      onChange={(e) => setField('emergencyContactRelationship', e.target.value)}
                      aria-label="Emergency contact relationship"
                    >
                      <option value="">Select…</option>
                      {RELATIONSHIPS.filter((o) => o.code !== 'ONESELF').map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
                    </Select>
                  </div>
                </div>
                <div className="mt-3">
                  <Label>Phone</Label>
                  <Input
                    type="tel"
                    value={form.emergencyContactPhone}
                    onChange={(e) => setField('emergencyContactPhone', e.target.value)}
                  />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Guardian</h3>
                <Label required>Does the client have a guardian?</Label>
                <div className="flex flex-wrap gap-4 text-sm">
                  {(['yes', 'no'] as const).map((v) => (
                    <label key={v} className="flex min-h-11 items-center gap-2">
                      <input type="radio" className="h-5 w-5" name="hasGuardian" checked={form.hasGuardian === v} onChange={() => setField('hasGuardian', v)} />
                      {v === 'yes' ? 'Yes' : 'No'}
                    </label>
                  ))}
                </div>
                {form.hasGuardian === 'yes' ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label required>Name of guardian</Label>
                      <Input value={form.guardianName} onChange={(e) => setField('guardianName', e.target.value)} />
                    </div>
                    <div>
                      <Label required>Relationship</Label>
                      <Input value={form.guardianRelationship} onChange={(e) => setField('guardianRelationship', e.target.value)} />
                    </div>
                    <div>
                      <Label>Parent/guardian phone</Label>
                      <Input type="tel" value={form.guardianPhone} onChange={(e) => setField('guardianPhone', e.target.value)} />
                    </div>
                    <div>
                      <Label>Parent/guardian email</Label>
                      <Input type="email" value={form.guardianEmail} onChange={(e) => setField('guardianEmail', e.target.value)} />
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="border-t border-slate-100 pt-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Services</h3>
                <Label required>What service are you interested in?</Label>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {SERVICES_INTERESTED.map((o) => (
                    <label key={o.value} className="flex min-h-10 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 shrink-0 accent-[#5C2D91]"
                        checked={form.servicesInterested.includes(o.value)}
                        onChange={(e) => setField('servicesInterested', e.target.checked ? [...form.servicesInterested, o.value] : form.servicesInterested.filter((x) => x !== o.value))}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
                <div className="mt-3">
                  <Label>Would you like video (telehealth) visits?</Label>
                  <Select value={form.wantsTelehealth} onChange={(e) => setField('wantsTelehealth', e.target.value as FormState['wantsTelehealth'])} aria-label="Telehealth visits">
                    <option value="">Not sure</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </Select>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <Label>Social Security Number (optional)</Label>
                <Input inputMode="numeric" autoComplete="off" placeholder="123-45-6789" value={form.ssn} onChange={(e) => setField('ssn', e.target.value)} />
                <p className="mt-1 text-xs text-slate-500">{SSN_OPTIONAL_NOTE}</p>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Insurance Information</h2>
              <div>
                <Label required>Primary Insurance</Label>
                <Select
                  value={form.primaryPayer}
                  onChange={(e) => setField('primaryPayer', e.target.value)}
                >
                  <option value="">Select payer…</option>
                  <option>Medicaid (Maryland)</option>
                  <optgroup label="Maryland Medicaid (HealthChoice) plans">
                    {MD_MEDICAID_PLANS.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </optgroup>
                  <option>Medicare</option>
                  <option>CareFirst BCBS</option>
                  <option>Aetna</option>
                  <option>Cigna</option>
                  <option>United Healthcare</option>
                  <option>Uninsured / Self-pay</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Member ID</Label>
                  <Input
                    value={form.memberId}
                    onChange={(e) => setField('memberId', e.target.value)}
                  />
                </div>
                <div>
                  <Label>Group Number</Label>
                  <Input
                    value={form.groupNumber}
                    onChange={(e) => setField('groupNumber', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Subscriber Name (if different from patient)</Label>
                <Input
                  value={form.subscriberName}
                  onChange={(e) => setField('subscriberName', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Subscriber DOB</Label>
                  <Input
                    type="date"
                    value={form.subscriberDob}
                    onChange={(e) => setField('subscriberDob', e.target.value)}
                  />
                </div>
                <div>
                  <Label>Subscriber Relationship</Label>
                  <Select
                    value={form.subscriberRelationship}
                    onChange={(e) => setField('subscriberRelationship', e.target.value)}
                  >
                    <option>Self</option>
                    <option>Spouse</option>
                    <option>Parent</option>
                    <option>Other</option>
                  </Select>
                </div>
              </div>
              <div className="border-t border-slate-100 pt-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">
                  Secondary Insurance (optional)
                </h3>
                <div>
                  <Label>Secondary Payer</Label>
                  <Select
                    value={form.secondaryPayer}
                    onChange={(e) => setField('secondaryPayer', e.target.value)}
                  >
                    <option value="">None</option>
                    <option>Medicaid</option>
                    <option>Medicare</option>
                    <option>Other</option>
                  </Select>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Member ID</Label>
                    <Input
                      value={form.secondaryMemberId}
                      onChange={(e) => setField('secondaryMemberId', e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Group Number</Label>
                    <Input
                      value={form.secondaryGroupNumber}
                      onChange={(e) => setField('secondaryGroupNumber', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Medical History</h2>
              <div>
                <Label>Current Medications</Label>
                <Textarea
                  rows={3}
                  value={form.medications}
                  onChange={(e) => setField('medications', e.target.value)}
                  placeholder="List medications or write 'None'"
                />
              </div>
              <div>
                <Label>Allergies</Label>
                <Input
                  value={form.allergies}
                  onChange={(e) => setField('allergies', e.target.value)}
                  placeholder="e.g. Penicillin — or 'None known'"
                />
              </div>
              <div>
                <Label>Previous Mental Health Treatment</Label>
                <Textarea
                  rows={3}
                  value={form.previousTreatment}
                  onChange={(e) => setField('previousTreatment', e.target.value)}
                />
              </div>
              <div>
                <Label>Primary Care Provider</Label>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input
                    placeholder="Provider name"
                    value={form.pcpName}
                    onChange={(e) => setField('pcpName', e.target.value)}
                  />
                  <Input
                    placeholder="Phone number"
                    value={form.pcpPhone}
                    onChange={(e) => setField('pcpPhone', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label>Reason for Seeking Services</Label>
                <Textarea
                  rows={3}
                  value={form.reasonForSeeking}
                  onChange={(e) => setField('reasonForSeeking', e.target.value)}
                />
              </div>
              <div>
                <Label>Substance Use</Label>
                <Select
                  value={form.substanceUse}
                  onChange={(e) => setField('substanceUse', e.target.value)}
                >
                  <option value="">Select…</option>
                  <option>None</option>
                  <option>Alcohol — light/social</option>
                  <option>Alcohol — moderate</option>
                  <option>Alcohol — heavy/daily</option>
                  <option>Cannabis — occasional</option>
                  <option>Cannabis — daily</option>
                  <option>Other substances</option>
                  <option>In recovery</option>
                </Select>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="mb-4 text-lg font-bold text-slate-900">Consents & Agreements</h2>
              {!packet || packetLoading ? (
                <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading your consent packet…</p>
              ) : null}
              {packet && usePacket ? (
                <ConsentPacketForm mode="intake" items={packet.items} minor={packet.minor} hideSigner onChange={onPacketChange} />
              ) : null}
              <div className={`space-y-4 ${packet && !usePacket ? '' : 'hidden'}`}>
                {consents.map((c) => (
                  <div
                    key={c.id}
                    className={`rounded-xl border p-4 transition-colors ${
                      form.consents[c.id]
                        ? 'border-[#5C2D91] bg-purple-50'
                        : 'border-slate-200'
                    }`}
                  >
                    <h3 className="mb-2 text-sm font-semibold text-slate-800">{c.title}</h3>
                    <p className="mb-3 text-xs leading-relaxed text-slate-600">{c.body}</p>
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!form.consents[c.id]}
                        onChange={() =>
                          setField('consents', {
                            ...form.consents,
                            [c.id]: !form.consents[c.id],
                          })
                        }
                        className="h-5 w-5 shrink-0 accent-[#5C2D91]"
                      />
                      <span className="text-xs font-medium text-slate-700">
                        I have read and agree to the above
                      </span>
                    </label>
                  </div>
                ))}
              </div>
              {carelonRequired ? <IntakeCarelonSection onChange={(input, errors) => setCarelon({ input, errors })} /> : null}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="mb-2 text-lg font-bold text-slate-900">Signature</h2>
              <p className="mb-4 text-sm text-slate-500">
                Type your full legal name below as your electronic signature.
              </p>
              {usePacket && packet ? (
                <SignerBlock signer={signer} setSigner={setSigner} minor={packet.minor} />
              ) : (
              <div>
                <Label required>Full Legal Name (typed signature)</Label>
                <Input
                  placeholder="Type your full name"
                  value={form.signatureName}
                  onChange={(e) => setField('signatureName', e.target.value)}
                  className="text-lg font-semibold"
                  style={{ fontFamily: 'cursive' }}
                />
              </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>Date</Label>
                  <Input value={today} readOnly className="bg-slate-50 text-slate-500" />
                </div>
                <div>
                  <Label>Recorded</Label>
                  <Input
                    value="Securely timestamped on submit"
                    readOnly
                    className="bg-slate-50 text-xs text-slate-500"
                  />
                </div>
              </div>
              {submitError && (
                <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">{submitError}</p>
              )}
              <div className="flex items-start gap-2 rounded-xl bg-blue-50 p-3">
                <Shield size={14} className="mt-0.5 shrink-0 text-blue-600" />
                <p className="text-xs text-blue-700">
                  This form is encrypted and HIPAA-compliant. Your information is transmitted
                  securely.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onSubmit()}
                disabled={(usePacket ? !signer.signature.trim() : !form.signatureName.trim()) || submitting}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" /> Submitting…
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={16} /> Submit Intake Form
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {step < 4 && (
          <div className="flex gap-3">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="flex min-h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft size={15} /> Back
              </button>
            )}
            <button
              type="button"
              onClick={onContinue}
              className="flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
            >
              {step === STEPS.length - 2 ? 'Review & Sign' : 'Continue'}{' '}
              <ChevronRight size={15} />
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs text-slate-500">
          Having trouble? Call us and we&apos;ll complete this by phone.
        </p>
      </div>
    </div>
  );
}

/**
 * Carelon Behavioral Health - Maryland non-overlap attestation, Part A, in the intake packet for
 * Maryland Medicaid clients. The exact form text; the clinic fills the participant ID, NPI and TIN
 * from the chart and signs Part B (src/lib/consents/carelon).
 */
function IntakeCarelonSection({ onChange }: { onChange: (input: PartAInput, errors: string[]) => void }) {
  const t = carelonTemplate()!;
  return (
    <div className="space-y-3 rounded-xl border border-[#5C2D91]/40 bg-purple-50/40 p-4">
      <div>
        <h3 className="text-sm font-bold text-slate-900">{t.title}</h3>
        <p className="text-xs font-semibold text-slate-700">{t.subtitle}</p>
        <p className="mt-1 text-xs text-slate-600">
          Required for Maryland Medicaid. Your participant information (name, Medicaid ID, date of birth) and the clinic&apos;s provider information (name, NPI, TIN) are filled in by the clinic from your chart.
        </p>
      </div>
      <div className="space-y-2 text-xs leading-relaxed text-slate-700">
        <p className="font-semibold">{t.purpose.heading}</p>
        {t.purpose.paragraphs.map((p) => <p key={p}>{p}</p>)}
        <p className="font-semibold">{t.partA.heading}</p>
        <p>{t.partA.lead}</p>
        <p>{t.partA.statement1.before} {t.partA.statement1.optionParticipant} {t.partA.statement1.or} {t.partA.statement1.optionRepresentative}</p>
        {t.partA.statements.map((st) => <p key={st}>{st}</p>)}
      </div>
      <CarelonPartAForm mode="intake" onSubmit={() => undefined} onChange={onChange} />
    </div>
  );
}
