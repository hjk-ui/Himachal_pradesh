'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  LayoutDashboard,
  Link2,
  Plus,
  Shield,
  Trash2,
  User,
} from 'lucide-react';
import {
  EMPTY_PRACTICE_SETUP,
  SOLO_CANCELLATION_OPTIONS,
  SOLO_DAYS,
  SOLO_LICENSE_TYPES,
  SOLO_PAYERS,
  SOLO_STATES,
} from '@/lib/solo/defaults';
import type { SoloPracticeSetup, SoloService } from '@/lib/solo/types';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7B4DB5)';
const PURPLE = '#5C2D91';

const STEPS = [
  { label: 'Practice Information', icon: Building2 },
  { label: 'Clinician Credentials', icon: User },
  { label: 'Services and Fees', icon: Plus },
  { label: 'Payment and Insurance', icon: Shield },
  { label: 'Clinician Schedule', icon: Clock },
  { label: 'Booking Settings', icon: Link2 },
  { label: 'Completion & Launch', icon: Check },
];

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
        {label} {required ? <span className="text-red-500">*</span> : null}
      </span>
      {children}
    </label>
  );
}

function inputClass() {
  return 'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition focus:border-[#5C2D91] focus:ring-4 focus:ring-purple-100';
}

const DRAFT_KEY = 'altrixs.soloOnboarding';

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<SoloPracticeSetup>(EMPTY_PRACTICE_SETUP);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bookingUrl, setBookingUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [currentTime] = useState(() => Date.now());

  // Load setup on mount: first check /api/onboarding (if logged in), fallback to local draft
  useEffect(() => {
    let mounted = true;
    void fetch('/api/onboarding')
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        if (mounted && json.authenticated && json.setup) {
          setData((prev) => ({ ...prev, ...json.setup }));
          if (json.bookingUrl) setBookingUrl(json.bookingUrl);
          if (json.completed) setStep(STEPS.length - 1);
        }
      })
      .catch(() => undefined);

    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const draft = (raw ? JSON.parse(raw) : {}) as { step?: number; data?: SoloPracticeSetup; bookingUrl?: string };
      if (draft.data) setData((prev) => ({ ...prev, ...draft.data }));
      if (typeof draft.step === 'number') setStep(Math.min(Math.max(draft.step, 0), STEPS.length - 1));
      if (draft.bookingUrl) setBookingUrl(draft.bookingUrl);
    } catch {
      /* ignore invalid draft */
    }

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ step, data, bookingUrl }));
    } catch {
      /* ignore quota */
    }
  }, [step, data, bookingUrl]);

  const progress = Math.round((step / (STEPS.length - 1)) * 100);
  const completed = step === STEPS.length - 1;

  const set = <K extends keyof SoloPracticeSetup>(key: K, value: SoloPracticeSetup[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const validation = useMemo(() => {
    if (step === 0) {
      if (!data.practiceName.trim() || data.practiceName.trim().length < 2) {
        return 'Practice name is required (at least 2 characters).';
      }
      if (!data.practiceAddress.trim()) {
        return 'Practice address is required for regulatory and booking records.';
      }
      if (!data.practiceCity.trim()) {
        return 'City is required.';
      }
      if (!data.practiceZip.trim() || !/^\d{5}(-\d{4})?$/.test(data.practiceZip.trim())) {
        return 'Please enter a valid 5-digit US ZIP code.';
      }
      if (!/^[0-9()+\-\s.]{7,24}$/.test(data.practicePhone)) {
        return 'Enter a valid phone number (at least 7 digits).';
      }
      if (data.practiceWebsite && !/^https?:\/\/.+\..+/.test(data.practiceWebsite)) {
        return 'Website must be a valid URL starting with http:// or https://.';
      }
    }
    if (step === 1) {
      if (!data.fullName.trim() || data.fullName.trim().length < 2) {
        return 'Clinician full name is required.';
      }
      if (!data.licenseType) {
        return 'Please select a license type (e.g. LCSW, LPC, MD, NP, PsyD).';
      }
      if (!data.licenseNumber.trim()) {
        return 'State medical/clinical license number is required.';
      }
      if (!/^\d{10}$/.test(data.npi)) {
        return 'NPI must be exactly 10 digits.';
      }
      if (!data.licenseExpiryDate || new Date(data.licenseExpiryDate).getTime() <= currentTime) {
        return 'License expiry date must be in the future.';
      }
    }
    if (step === 2) {
      const active = data.services.filter((service) => service.active !== false);
      if (active.length === 0) return 'At least one active service is required.';
      if (active.some((service) => !service.name.trim() || service.duration <= 0 || service.fee < 0)) {
        return 'Each service needs a name, valid duration (minutes), and valid fee.';
      }
      const names = active.map((service) => service.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) return 'Duplicate service names are not allowed.';
    }
    if (step === 3) {
      if (data.acceptsInsurance && data.acceptedPayers.length === 0) {
        return 'Select at least one accepted insurance panel or toggle insurance off.';
      }
      if (data.selfPayRate < 0) return 'Self-pay rate must be a non-negative number.';
    }
    if (step === 4) {
      if (!SOLO_DAYS.some((day) => data.availability[day].enabled)) {
        return 'At least one operating availability day is required.';
      }
      const invalid = SOLO_DAYS.find(
        (day) => data.availability[day].enabled && data.availability[day].end <= data.availability[day].start
      );
      if (invalid) return `${invalid} end time must be after start time.`;
    }
    if (step === 5) {
      if (data.leadTimeHours < 0) return 'Lead time cannot be negative.';
      if (data.bufferMinutes < 0) return 'Buffer time cannot be negative.';
      if (data.bookingWindowDays < 1) return 'Booking window must be at least 1 day.';
    }
    return null;
  }, [data, step, currentTime]);

  const next = async () => {
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    if (step < STEPS.length - 2) {
      setStep((prev) => prev + 1);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not complete setup.');
      setBookingUrl(json.bookingUrl);
      setStep(STEPS.length - 1);
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ step: STEPS.length - 1, data, bookingUrl: json.bookingUrl })
        );
      } catch {
        /* ignore */
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not complete setup.');
    } finally {
      setSaving(false);
    }
  };

  const updateService = (id: string, patch: Partial<SoloService>) => {
    set(
      'services',
      data.services.map((service) => (service.serviceId === id ? { ...service, ...patch } : service))
    );
  };

  const addService = () => {
    set('services', [
      ...data.services,
      {
        serviceId: `svc-${Date.now()}`,
        name: '',
        duration: 53,
        fee: data.selfPayRate || 150,
        description: '',
        active: true,
      },
    ]);
  };

  const copyLink = async () => {
    const fullUrl = `${window.location.origin}${bookingUrl}`;
    await navigator.clipboard.writeText(fullUrl).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eef2ff,transparent_34%),#f8fafc]">
      {/* Header */}
      <header className="border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4">
          <Link href="/dashboard" className="flex items-center gap-2">
            <div
              className="grid h-10 w-10 place-items-center rounded-2xl text-sm font-black text-white shadow-xs"
              style={{ background: GRADIENT }}
            >
              A
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Altrixs Clinical Onboarding</p>
              <p className="text-xs text-slate-500">6-Step Practice Setup & Public Booking Engine</p>
            </div>
          </Link>
          <div className="ml-auto hidden items-center gap-3 sm:flex">
            <div className="h-2 w-48 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%`, background: GRADIENT }}
              />
            </div>
            <span className="text-xs font-bold text-[#5C2D91]">{progress}%</span>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <main className="mx-auto grid max-w-6xl gap-6 px-5 py-8 lg:grid-cols-[280px_1fr]">
        {/* Step Indicator Sidebar */}
        <aside className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm h-fit">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400 px-3 pb-3">Setup Progress</p>
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const isCurrent = index === step;
            const isDone = index < step;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => index < step && setStep(index)}
                className={`mb-1 flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-xs font-semibold transition ${
                  isCurrent
                    ? 'bg-purple-50 text-[#5C2D91] font-bold shadow-2xs'
                    : isDone
                    ? 'text-slate-700 hover:bg-slate-50'
                    : 'text-slate-300 cursor-not-allowed'
                }`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                    isCurrent
                      ? 'bg-[#5C2D91] text-white'
                      : isDone
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-50 text-slate-300'
                  }`}
                >
                  {isDone ? <Check size={15} /> : <Icon size={15} />}
                </span>
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </aside>

        {/* Wizard Form Section */}
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          {error && (
            <div className="mb-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          )}

          {!completed && (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#5C2D91]">
                Step {step + 1} of {STEPS.length - 1}
              </p>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
                {STEPS[step].label}
              </h1>

              <div className="mt-6 space-y-5">
                {/* Step 0: Practice Info */}
                {step === 0 && (
                  <>
                    <Field label="Practice or Clinic Name" required>
                      <input
                        className={inputClass()}
                        value={data.practiceName}
                        onChange={(e) => set('practiceName', e.target.value)}
                        placeholder="e.g. Beacon Health Therapy"
                      />
                    </Field>
                    <Field label="Tagline or Specialty Focus">
                      <input
                        className={inputClass()}
                        value={data.practiceTagline}
                        onChange={(e) => set('practiceTagline', e.target.value)}
                        placeholder="e.g. Trauma-informed outpatient counseling"
                      />
                    </Field>
                    <Field label="Physical Office Street Address" required>
                      <input
                        className={inputClass()}
                        value={data.practiceAddress}
                        onChange={(e) => set('practiceAddress', e.target.value)}
                        placeholder="e.g. 100 West Baltimore St, Suite 400"
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-[1fr_100px_120px]">
                      <Field label="City" required>
                        <input
                          className={inputClass()}
                          value={data.practiceCity}
                          onChange={(e) => set('practiceCity', e.target.value)}
                          placeholder="Baltimore"
                        />
                      </Field>
                      <Field label="State" required>
                        <select
                          className={inputClass()}
                          value={data.practiceState}
                          onChange={(e) => set('practiceState', e.target.value)}
                        >
                          {SOLO_STATES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="ZIP Code" required>
                        <input
                          className={inputClass()}
                          value={data.practiceZip}
                          onChange={(e) => set('practiceZip', e.target.value)}
                          placeholder="21201"
                        />
                      </Field>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Practice Phone Number" required>
                        <input
                          className={inputClass()}
                          value={data.practicePhone}
                          onChange={(e) => set('practicePhone', e.target.value)}
                          placeholder="(410) 555-0199"
                        />
                      </Field>
                      <Field label="Practice Website (optional)">
                        <input
                          className={inputClass()}
                          value={data.practiceWebsite}
                          onChange={(e) => set('practiceWebsite', e.target.value)}
                          placeholder="https://beaconhealth.com"
                        />
                      </Field>
                    </div>
                  </>
                )}

                {/* Step 1: Credentials & Licensing */}
                {step === 1 && (
                  <>
                    <Field label="Primary Clinician Full Name" required>
                      <input
                        className={inputClass()}
                        value={data.fullName}
                        onChange={(e) => set('fullName', e.target.value)}
                        placeholder="Dr. Sarah Smith"
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="NPI (10 digits)" required>
                        <input
                          className={inputClass()}
                          value={data.npi}
                          onChange={(e) =>
                            set('npi', e.target.value.replace(/\D/g, '').slice(0, 10))
                          }
                          placeholder="1234567890"
                        />
                      </Field>
                      <Field label="CAQH Provider ID">
                        <input
                          className={inputClass()}
                          value={data.caqhId}
                          onChange={(e) => set('caqhId', e.target.value)}
                          placeholder="e.g. 10987654"
                        />
                      </Field>
                      <Field label="License Type" required>
                        <select
                          className={inputClass()}
                          value={data.licenseType}
                          onChange={(e) =>
                            set('licenseType', e.target.value as SoloPracticeSetup['licenseType'])
                          }
                        >
                          <option value="">Select license type…</option>
                          {SOLO_LICENSE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="License Number" required>
                        <input
                          className={inputClass()}
                          value={data.licenseNumber}
                          onChange={(e) => set('licenseNumber', e.target.value)}
                          placeholder="e.g. MD-104928"
                        />
                      </Field>
                      <Field label="License State" required>
                        <select
                          className={inputClass()}
                          value={data.licenseState}
                          onChange={(e) => set('licenseState', e.target.value)}
                        >
                          {SOLO_STATES.map((state) => (
                            <option key={state} value={state}>
                              {state}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="License Expiry Date" required>
                        <input
                          type="date"
                          className={inputClass()}
                          value={data.licenseExpiryDate}
                          onChange={(e) => set('licenseExpiryDate', e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Professional Statement / Bio">
                      <textarea
                        className={`${inputClass()} min-h-24 resize-none`}
                        value={data.practiceBio}
                        onChange={(e) => set('practiceBio', e.target.value)}
                        placeholder="Describe your therapeutic style, specialties, and experience for your client booking page."
                      />
                    </Field>
                  </>
                )}

                {/* Step 2: Services & Fees */}
                {step === 2 && (
                  <div className="space-y-4">
                    <p className="text-xs text-gray-500">
                      Configure your clinical appointment services and standard self-pay rates.
                    </p>
                    {data.services.map((service) => (
                      <div
                        key={service.serviceId}
                        className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 shadow-2xs space-y-3"
                      >
                        <div className="grid gap-3 sm:grid-cols-[1fr_130px_130px_auto]">
                          <div>
                            <span className="block text-[11px] font-bold text-gray-500 mb-1">
                              Service Name
                            </span>
                            <input
                              className={inputClass()}
                              value={service.name}
                              onChange={(e) =>
                                updateService(service.serviceId, { name: e.target.value })
                              }
                              placeholder="Service name"
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] font-bold text-gray-500 mb-1">
                              Duration (min)
                            </span>
                            <input
                              type="number"
                              className={inputClass()}
                              value={service.duration}
                              onChange={(e) =>
                                updateService(service.serviceId, {
                                  duration: Number(e.target.value),
                                })
                              }
                            />
                          </div>
                          <div>
                            <span className="block text-[11px] font-bold text-gray-500 mb-1">
                              Fee (USD)
                            </span>
                            <input
                              type="number"
                              className={inputClass()}
                              value={service.fee}
                              onChange={(e) =>
                                updateService(service.serviceId, { fee: Number(e.target.value) })
                              }
                            />
                          </div>
                          <div className="flex items-end">
                            <button
                              type="button"
                              onClick={() => updateService(service.serviceId, { active: false })}
                              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-400 hover:text-red-600"
                              title="Remove service"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <div>
                          <input
                            className={inputClass()}
                            value={service.description}
                            onChange={(e) =>
                              updateService(service.serviceId, { description: e.target.value })
                            }
                            placeholder="Brief description shown to patients during online booking..."
                          />
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addService}
                      className="inline-flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-2.5 text-xs font-bold text-[#5C2D91] hover:bg-purple-100"
                    >
                      <Plus size={16} /> Add Custom Service
                    </button>
                  </div>
                )}

                {/* Step 3: Payment & Insurance */}
                {step === 3 && (
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 bg-white cursor-pointer hover:border-purple-200">
                        <input
                          type="checkbox"
                          checked={data.acceptsInsurance}
                          onChange={(e) => set('acceptsInsurance', e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-[#5C2D91]"
                        />
                        <span>Accept Insurance</span>
                      </label>
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 bg-white cursor-pointer hover:border-purple-200">
                        <input
                          type="checkbox"
                          checked={data.acceptsSelfPay ?? true}
                          onChange={(e) => set('acceptsSelfPay', e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-[#5C2D91]"
                        />
                        <span>Accept Self-Pay / Cash</span>
                      </label>
                    </div>

                    {data.acceptsInsurance && (
                      <div className="rounded-2xl border border-purple-100 bg-purple-50/40 p-4 space-y-2">
                        <p className="text-xs font-bold text-purple-900 uppercase">
                          Accepted Insurance Panels
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {SOLO_PAYERS.map((payer) => (
                            <label
                              key={payer}
                              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={data.acceptedPayers.includes(payer)}
                                onChange={() =>
                                  set(
                                    'acceptedPayers',
                                    data.acceptedPayers.includes(payer)
                                      ? data.acceptedPayers.filter((item) => item !== payer)
                                      : [...data.acceptedPayers, payer]
                                  )
                                }
                                className="h-3.5 w-3.5 rounded text-[#5C2D91]"
                              />
                              {payer}
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Standard Self-Pay Rate (USD)">
                        <input
                          type="number"
                          className={inputClass()}
                          value={data.selfPayRate}
                          onChange={(e) => set('selfPayRate', Number(e.target.value))}
                        />
                      </Field>
                      <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 bg-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={data.slidingScale ?? false}
                          onChange={(e) => set('slidingScale', e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-[#5C2D91]"
                        />
                        <span>Offer Sliding Scale Rates</span>
                      </label>
                    </div>

                    {data.slidingScale && (
                      <div className="grid gap-4 sm:grid-cols-2 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <Field label="Sliding Scale Min Fee ($)">
                          <input
                            type="number"
                            className={inputClass()}
                            value={data.slidingScaleMin ?? 60}
                            onChange={(e) => set('slidingScaleMin', Number(e.target.value))}
                          />
                        </Field>
                        <Field label="Sliding Scale Max Fee ($)">
                          <input
                            type="number"
                            className={inputClass()}
                            value={data.slidingScaleMax ?? 120}
                            onChange={(e) => set('slidingScaleMax', Number(e.target.value))}
                          />
                        </Field>
                      </div>
                    )}

                    <Field label="Sliding Scale / Financial Policy Note">
                      <textarea
                        className={`${inputClass()} min-h-20 resize-none`}
                        value={data.slidingScalePolicy}
                        onChange={(e) => set('slidingScalePolicy', e.target.value)}
                        placeholder="e.g. Sliding scale available based on household income verification."
                      />
                    </Field>
                  </div>
                )}

                {/* Step 4: Schedule */}
                {step === 4 && (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-500">
                      Set regular operating hours for appointment availability and public client self-scheduling.
                    </p>
                    {SOLO_DAYS.map((day) => (
                      <div
                        key={day}
                        className="grid items-center gap-3 rounded-2xl border border-slate-200 p-3.5 sm:grid-cols-[120px_1fr_1fr]"
                      >
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={data.availability[day].enabled}
                            onChange={(e) =>
                              set('availability', {
                                ...data.availability,
                                [day]: {
                                  ...data.availability[day],
                                  enabled: e.target.checked,
                                },
                              })
                            }
                            className="h-4 w-4 rounded text-[#5C2D91]"
                          />
                          {day}
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-gray-400">Start:</span>
                          <input
                            type="time"
                            className={inputClass()}
                            value={data.availability[day].start}
                            onChange={(e) =>
                              set('availability', {
                                ...data.availability,
                                [day]: {
                                  ...data.availability[day],
                                  start: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-semibold text-gray-400">End:</span>
                          <input
                            type="time"
                            className={inputClass()}
                            value={data.availability[day].end}
                            onChange={(e) =>
                              set('availability', {
                                ...data.availability,
                                [day]: {
                                  ...data.availability[day],
                                  end: e.target.value,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Step 5: Booking Settings */}
                {step === 5 && (
                  <div className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Minimum Advance Notice / Lead Time (hours)">
                        <input
                          type="number"
                          className={inputClass()}
                          value={data.leadTimeHours}
                          onChange={(e) => set('leadTimeHours', Number(e.target.value))}
                        />
                      </Field>
                      <Field label="Session Buffer (minutes between sessions)">
                        <input
                          type="number"
                          className={inputClass()}
                          value={data.bufferMinutes}
                          onChange={(e) => set('bufferMinutes', Number(e.target.value))}
                        />
                      </Field>
                      <Field label="Advance Booking Window (days out)">
                        <input
                          type="number"
                          className={inputClass()}
                          value={data.bookingWindowDays}
                          onChange={(e) => set('bookingWindowDays', Number(e.target.value))}
                        />
                      </Field>
                      <Field label="Cancellation Policy Window">
                        <select
                          className={inputClass()}
                          value={data.cancellationPolicy}
                          onChange={(e) =>
                            set(
                              'cancellationPolicy',
                              e.target.value as SoloPracticeSetup['cancellationPolicy']
                            )
                          }
                        >
                          {SOLO_CANCELLATION_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      </Field>
                    </div>

                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-800 bg-white cursor-pointer">
                      <input
                        type="checkbox"
                        checked={data.requireCreditCard}
                        onChange={(e) => set('requireCreditCard', e.target.checked)}
                        className="h-4 w-4 rounded text-[#5C2D91]"
                      />
                      <span>Require Credit Card on File for Online Bookings</span>
                    </label>

                    <Field label="Appointment Reminder Note">
                      <textarea
                        className={`${inputClass()} min-h-20 resize-none`}
                        value={data.remindersNote}
                        onChange={(e) => set('remindersNote', e.target.value)}
                        placeholder="Clients receive automated reminders 24 hours prior to visit."
                      />
                    </Field>
                  </div>
                )}
              </div>

              {/* Navigation Actions */}
              <div className="mt-8 flex items-center justify-between border-t border-gray-100 pt-6">
                {step > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStep((prev) => prev - 1)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                ) : <div />}

                <button
                  type="button"
                  onClick={next}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl px-6 py-2.5 text-xs font-bold text-white shadow-md transition disabled:opacity-60"
                  style={{ background: GRADIENT }}
                >
                  {saving ? (
                    'Saving Practice...'
                  ) : step === STEPS.length - 2 ? (
                    <>
                      Complete Setup & Launch <Check size={16} />
                    </>
                  ) : (
                    <>
                      Continue <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </div>
            </>
          )}

          {/* Step 6 / Completion: Public Booking Link & Dashboard Handover */}
          {completed && (
            <div className="mx-auto max-w-2xl py-6 text-center space-y-6">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-100 text-emerald-700 shadow-xs">
                <Check size={38} />
              </div>
              <div>
                <h1 className="text-3xl font-black text-slate-900">Practice Setup Complete!</h1>
                <p className="mt-2 text-sm text-slate-500">
                  Your credentials, operating schedule, and services are saved to the platform.
                </p>
              </div>

              {/* Booking URL Card */}
              {bookingUrl ? (
                <div className="rounded-2xl border border-purple-100 bg-purple-50/60 p-4 text-left shadow-2xs space-y-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#5C2D91]">
                    Your Public Client Booking Link
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-bold text-gray-800 bg-white border border-gray-200 rounded-lg px-3 py-2">
                      {typeof window !== 'undefined' ? `${window.location.origin}${bookingUrl}` : bookingUrl}
                    </span>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs font-bold text-[#5C2D91] hover:bg-gray-50 shadow-2xs"
                    >
                      <Copy size={13} className="mr-1 inline" /> {copied ? 'Copied!' : 'Copy'}
                    </button>
                    <a
                      href={bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-gray-50 shadow-2xs inline-flex items-center gap-1"
                    >
                      <ExternalLink size={13} /> View Page
                    </a>
                  </div>
                </div>
              ) : null}

              {/* Handover CTA to Dashboard */}
              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center gap-2 rounded-xl px-8 py-3.5 text-sm font-bold text-white shadow-lg transition hover:opacity-95 w-full sm:w-auto"
                  style={{ background: GRADIENT }}
                >
                  <LayoutDashboard size={18} /> Go to Live Dashboard
                </Link>
                <Link
                  href="/dashboard/appointments"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3.5 text-sm font-bold text-slate-700 hover:bg-gray-50 w-full sm:w-auto"
                >
                  <Clock size={18} /> View Clinic Calendar
                </Link>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
