'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Banknote,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  CreditCard,
  Link2,
  Plus,
  Settings2,
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
  normalizePracticeSetup,
} from '@/lib/solo/defaults';
import type { SoloPracticeSetup, SoloService } from '@/lib/solo/types';

const STEPS = [
  { label: 'Practice Info', icon: Building2 },
  { label: 'Your Credentials', icon: User },
  { label: 'Services & Fees', icon: Banknote },
  { label: 'Payment & Insurance', icon: CreditCard },
  { label: 'Your Schedule', icon: Clock },
  { label: 'Booking Settings', icon: Settings2 },
  { label: 'Done!', icon: Check },
] as const;

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-semibold text-slate-700">
        {label}
        {required ? <span className="text-rose-500"> *</span> : null}
      </span>
      {children}
    </label>
  );
}

function inputClass() {
  return 'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-violet-400 focus:ring-4 focus:ring-violet-100';
}

export default function PracticeSetupPage() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<SoloPracticeSetup>(EMPTY_PRACTICE_SETUP);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bookingUrl, setBookingUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [currentTime] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/practice-setup');
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not load practice setup.');
        if (cancelled) return;
        setData(normalizePracticeSetup(json.setup));
        setBookingUrl(json.bookingUrl || '');
        setCompleted(Boolean(json.completed));
        if (json.completed) setStep(STEPS.length - 1);
      } catch (err: unknown) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load practice setup.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const progress = Math.round((step / (STEPS.length - 1)) * 100);
  const onDoneStep = step === STEPS.length - 1;

  const set = <K extends keyof SoloPracticeSetup>(key: K, value: SoloPracticeSetup[K]) => {
    setData((prev) => ({ ...prev, [key]: value }));
  };

  const validation = useMemo(() => {
    if (step === 0) {
      if (!data.practiceName.trim()) return 'Practice name is required.';
      if (!/^[0-9()+\-\s.]{7,24}$/.test(data.practicePhone)) return 'Enter a valid phone number.';
      if (data.practiceWebsite && !/^https?:\/\/.+\..+/.test(data.practiceWebsite)) {
        return 'Website must start with http:// or https://.';
      }
    }
    if (step === 1) {
      if (!data.fullName.trim() || !data.licenseType || !data.licenseNumber.trim()) {
        return 'Clinician name, license type, and license number are required.';
      }
      if (!/^\d{10}$/.test(data.npi)) return 'NPI must be exactly 10 digits.';
      if (!data.licenseExpiryDate || new Date(data.licenseExpiryDate).getTime() <= currentTime) {
        return 'License expiry date must be in the future.';
      }
      if (data.practiceBio.trim() && data.practiceBio.trim().length < 10) {
        return 'Bio must be at least 10 characters when provided.';
      }
    }
    if (step === 2) {
      const active = data.services.filter((service) => service.active !== false);
      if (active.length === 0) return 'At least one active service is required.';
      if (active.some((s) => !s.name.trim() || s.duration <= 0 || s.fee < 0)) {
        return 'Each service needs a name, valid duration, and valid fee.';
      }
      const names = active.map((s) => s.name.trim().toLowerCase());
      if (new Set(names).size !== names.length) return 'Duplicate service names are not allowed.';
    }
    if (step === 3) {
      if (data.acceptsInsurance && data.acceptedPayers.length === 0) {
        return 'Select accepted payers or turn insurance off.';
      }
      if (data.selfPayRate < 0) return 'Self-pay rate must be valid.';
    }
    if (step === 4) {
      if (!SOLO_DAYS.some((day) => data.availability[day].enabled)) {
        return 'At least one available day is required.';
      }
      const invalid = SOLO_DAYS.find(
        (day) =>
          data.availability[day].enabled &&
          data.availability[day].end <= data.availability[day].start
      );
      if (invalid) return `${invalid} end time must be after start time.`;
    }
    if (step === 5) {
      if (data.bookingWindowDays < 1) return 'Booking window must be at least 1 day.';
      if (data.leadTimeHours < 0) return 'Lead time must be valid.';
    }
    return null;
  }, [data, step]);

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
      const res = await fetch('/api/practice-setup', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not save practice setup.');
      setBookingUrl(json.bookingUrl);
      setCompleted(true);
      setData(normalizePracticeSetup(json.setup));
      setStep(STEPS.length - 1);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save practice setup.');
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    const full = `${window.location.origin}${bookingUrl}`;
    await navigator.clipboard.writeText(full).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-3 h-9 w-9 animate-spin rounded-full border-2 border-violet-600/20 border-t-violet-600" />
          <p className="text-sm font-medium text-slate-600">Loading practice setup…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-1 space-y-4 sm:-mx-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">My Practice</p>
          <h1 className="text-lg font-black text-[#141C34]">Practice Setup</h1>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="h-2 w-24 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100 sm:w-48 sm:flex-none">
            <div
              className="h-full rounded-full bg-violet-600 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs font-bold text-slate-500">{progress}%</span>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          {STEPS.map((item, index) => {
            const Icon = item.icon;
            const active = index === step;
            const done = index < step || (completed && index <= step);
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  if (index < step || (completed && index < STEPS.length - 1)) setStep(index);
                }}
                className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  active
                    ? 'bg-violet-50 text-violet-700'
                    : done
                      ? 'text-slate-700 hover:bg-slate-50'
                      : 'text-slate-300'
                }`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-lg ${
                    active ? 'bg-white text-violet-600 shadow-sm' : done ? 'bg-slate-50 text-violet-500' : 'bg-slate-50'
                  }`}
                >
                  {index < step || (completed && index < STEPS.length - 1 && index !== step) ? (
                    <Check size={15} />
                  ) : (
                    <Icon size={15} />
                  )}
                </span>
                {item.label}
              </button>
            );
          })}
        </aside>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {error ? (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}

          {!onDoneStep ? (
            <>
              <h2 className="text-2xl font-black tracking-tight text-[#141C34]">
                {STEPS[step].label}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Step {step + 1} of {STEPS.length - 1}
              </p>

              <div className="mt-6 space-y-5">
                {step === 0 && (
                  <>
                    <Field label="Practice Name" required>
                      <input
                        className={inputClass()}
                        value={data.practiceName}
                        onChange={(e) => set('practiceName', e.target.value)}
                        placeholder="e.g. Sunrise Wellness Counseling"
                      />
                    </Field>
                    <Field label="Tagline (optional)">
                      <input
                        className={inputClass()}
                        value={data.practiceTagline}
                        onChange={(e) => set('practiceTagline', e.target.value)}
                        placeholder="e.g. Compassionate care for every season of life"
                      />
                    </Field>
                    <Field label="Phone Number" required>
                      <input
                        className={inputClass()}
                        value={data.practicePhone}
                        onChange={(e) => set('practicePhone', e.target.value)}
                        placeholder="(410) 555-0100"
                      />
                    </Field>
                    <Field label="Practice Address">
                      <input
                        className={inputClass()}
                        value={data.practiceAddress}
                        onChange={(e) => set('practiceAddress', e.target.value)}
                        placeholder="Street address"
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-[1fr_100px_120px]">
                      <Field label="City">
                        <input
                          className={inputClass()}
                          value={data.practiceCity}
                          onChange={(e) => set('practiceCity', e.target.value)}
                          placeholder="Baltimore"
                        />
                      </Field>
                      <Field label="State">
                        <select
                          className={inputClass()}
                          value={data.practiceState}
                          onChange={(e) => set('practiceState', e.target.value)}
                        >
                          {SOLO_STATES.map((state) => (
                            <option key={state}>{state}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="ZIP">
                        <input
                          className={inputClass()}
                          value={data.practiceZip}
                          onChange={(e) => set('practiceZip', e.target.value)}
                          placeholder="21201"
                        />
                      </Field>
                    </div>
                    <Field label="Website (optional)">
                      <input
                        className={inputClass()}
                        value={data.practiceWebsite}
                        onChange={(e) => set('practiceWebsite', e.target.value)}
                        placeholder="https://yourdomain.com"
                      />
                    </Field>
                  </>
                )}

                {step === 1 && (
                  <>
                    <Field label="Clinician name" required>
                      <input
                        className={inputClass()}
                        value={data.fullName}
                        onChange={(e) => set('fullName', e.target.value)}
                        placeholder="Dr. Maya Johnson"
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="NPI" required>
                        <input
                          className={inputClass()}
                          value={data.npi}
                          onChange={(e) => set('npi', e.target.value.replace(/\D/g, '').slice(0, 10))}
                          placeholder="1234567890"
                        />
                      </Field>
                      <Field label="CAQH ID (optional)">
                        <input
                          className={inputClass()}
                          value={data.caqhId}
                          onChange={(e) => set('caqhId', e.target.value)}
                          placeholder="CAQH provider ID"
                        />
                      </Field>
                      <Field label="License number" required>
                        <input
                          className={inputClass()}
                          value={data.licenseNumber}
                          onChange={(e) => set('licenseNumber', e.target.value)}
                        />
                      </Field>
                      <Field label="License type" required>
                        <select
                          className={inputClass()}
                          value={data.licenseType}
                          onChange={(e) => set('licenseType', e.target.value as SoloPracticeSetup['licenseType'])}
                        >
                          <option value="">Select</option>
                          {SOLO_LICENSE_TYPES.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="License state">
                        <select
                          className={inputClass()}
                          value={data.licenseState}
                          onChange={(e) => set('licenseState', e.target.value)}
                        >
                          {SOLO_STATES.map((state) => (
                            <option key={state}>{state}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="License expiry" required>
                        <input
                          type="date"
                          className={inputClass()}
                          value={data.licenseExpiryDate}
                          onChange={(e) => set('licenseExpiryDate', e.target.value)}
                        />
                      </Field>
                    </div>
                    <Field label="Bio (optional)">
                      <textarea
                        className={`${inputClass()} min-h-28 resize-none`}
                        value={data.practiceBio}
                        onChange={(e) => set('practiceBio', e.target.value)}
                        placeholder="Short clinician bio for your booking page"
                      />
                    </Field>
                  </>
                )}

                {step === 2 && (
                  <>
                    {data.services
                      .filter((s) => s.active !== false)
                      .map((service) => (
                        <div
                          key={service.serviceId}
                          className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                        >
                          <div className="grid gap-3 sm:grid-cols-[1fr_110px_110px_auto]">
                            <input
                              className={inputClass()}
                              value={service.name}
                              onChange={(e) => updateService(service.serviceId, { name: e.target.value })}
                              placeholder="Service name"
                            />
                            <input
                              type="number"
                              className={inputClass()}
                              value={service.duration}
                              onChange={(e) =>
                                updateService(service.serviceId, { duration: Number(e.target.value) })
                              }
                              placeholder="Min"
                              title="Duration (minutes)"
                            />
                            <input
                              type="number"
                              className={inputClass()}
                              value={service.fee}
                              onChange={(e) =>
                                updateService(service.serviceId, { fee: Number(e.target.value) })
                              }
                              placeholder="Fee"
                              title="Fee ($)"
                            />
                            <button
                              type="button"
                              onClick={() => updateService(service.serviceId, { active: false })}
                              className="rounded-xl border border-slate-200 bg-white px-3 text-slate-500"
                              aria-label="Remove service"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                          <input
                            className={`${inputClass()} mt-3`}
                            value={service.description}
                            onChange={(e) =>
                              updateService(service.serviceId, { description: e.target.value })
                            }
                            placeholder="Description"
                          />
                        </div>
                      ))}
                    <button
                      type="button"
                      onClick={addService}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#141C34] px-4 py-2.5 text-sm font-bold text-white"
                    >
                      <Plus size={16} /> Add service
                    </button>
                  </>
                )}

                {step === 3 && (
                  <>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={data.acceptsInsurance}
                        onChange={(e) => set('acceptsInsurance', e.target.checked)}
                      />
                      Accept insurance
                    </label>
                    {data.acceptsInsurance ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {SOLO_PAYERS.map((payer) => (
                          <label
                            key={payer}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm"
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
                            />
                            {payer}
                          </label>
                        ))}
                      </div>
                    ) : null}
                    <Field label="Self-pay rate">
                      <input
                        type="number"
                        className={inputClass()}
                        value={data.selfPayRate}
                        onChange={(e) => set('selfPayRate', Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Sliding-scale policy">
                      <textarea
                        className={`${inputClass()} min-h-24 resize-none`}
                        value={data.slidingScalePolicy}
                        onChange={(e) => set('slidingScalePolicy', e.target.value)}
                        placeholder="Describe policy if offered"
                      />
                    </Field>
                  </>
                )}

                {step === 4 && (
                  <>
                    {SOLO_DAYS.map((day) => (
                      <div
                        key={day}
                        className="grid items-center gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-[120px_1fr_1fr]"
                      >
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                          <input
                            type="checkbox"
                            checked={data.availability[day].enabled}
                            onChange={(e) =>
                              set('availability', {
                                ...data.availability,
                                [day]: { ...data.availability[day], enabled: e.target.checked },
                              })
                            }
                          />
                          {day}
                        </label>
                        <input
                          type="time"
                          className={inputClass()}
                          value={data.availability[day].start}
                          onChange={(e) =>
                            set('availability', {
                              ...data.availability,
                              [day]: { ...data.availability[day], start: e.target.value },
                            })
                          }
                        />
                        <input
                          type="time"
                          className={inputClass()}
                          value={data.availability[day].end}
                          onChange={(e) =>
                            set('availability', {
                              ...data.availability,
                              [day]: { ...data.availability[day], end: e.target.value },
                            })
                          }
                        />
                      </div>
                    ))}
                  </>
                )}

                {step === 5 && (
                  <>
                    <Field label="Lead time (hours before first bookable slot)">
                      <input
                        type="number"
                        className={inputClass()}
                        value={data.leadTimeHours}
                        onChange={(e) => set('leadTimeHours', Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Appointment buffer (minutes)">
                      <input
                        type="number"
                        className={inputClass()}
                        value={data.bufferMinutes}
                        onChange={(e) => set('bufferMinutes', Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Booking window (days ahead)">
                      <input
                        type="number"
                        className={inputClass()}
                        value={data.bookingWindowDays}
                        onChange={(e) => set('bookingWindowDays', Number(e.target.value))}
                      />
                    </Field>
                    <Field label="Cancellation policy">
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
                        {SOLO_CANCELLATION_OPTIONS.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    </Field>
                    <label className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-sm font-semibold text-slate-700">
                      <input
                        type="checkbox"
                        checked={data.requireCreditCard}
                        onChange={(e) => set('requireCreditCard', e.target.checked)}
                      />
                      Require credit card to book
                    </label>
                    <Field label="Reminders note">
                      <textarea
                        className={`${inputClass()} min-h-24 resize-none`}
                        value={data.remindersNote}
                        onChange={(e) => set('remindersNote', e.target.value)}
                        placeholder="How clients are reminded before appointments"
                      />
                    </Field>
                  </>
                )}
              </div>

              <div className="mt-8 flex gap-3">
                {step > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStep((prev) => prev - 1)}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600"
                  >
                    <ChevronLeft size={16} /> Back
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void next()}
                  disabled={saving}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : step === 5 ? 'Finish setup' : 'Continue'}
                  <ChevronRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <div className="mx-auto max-w-xl py-8 text-center">
              <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <Check size={34} />
              </div>
              <h2 className="mt-5 text-3xl font-black text-[#141C34]">You&apos;re all set</h2>
              <p className="mt-2 text-sm text-slate-500">
                Your practice profile is saved. Share your public booking link with clients.
              </p>
              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-violet-100 bg-violet-50 p-3 text-left">
                <Link2 size={18} className="shrink-0 text-violet-600" />
                <a
                  href={bookingUrl}
                  className="min-w-0 flex-1 truncate text-sm font-bold text-violet-900"
                  target="_blank"
                  rel="noreferrer"
                >
                  {bookingUrl}
                </a>
                <button
                  type="button"
                  onClick={() => void copyLink()}
                  className="rounded-xl bg-white px-3 py-2 text-xs font-bold text-violet-700"
                >
                  <Copy size={12} className="mr-1 inline" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={() => setStep(0)}
                  className="rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                >
                  Edit setup
                </button>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-6 py-3 text-sm font-bold text-white hover:bg-violet-700"
                >
                  Go to Dashboard
                  <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
