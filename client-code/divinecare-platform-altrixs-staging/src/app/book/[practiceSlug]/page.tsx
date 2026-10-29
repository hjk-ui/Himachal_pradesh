'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, Shield } from 'lucide-react';
import { DEFAULT_PRACTICE_TIME_ZONE, formatWallClock, practiceToday, practiceZoneLabel } from '@/lib/time/practiceTime';
import { formatDateOnly } from '@/lib/time/dateOnly';
import { formatUsd } from '@/lib/format/money';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { FormField } from '@/components/ui/FormField';

type Service = { serviceId: string; name: string; duration: number; fee: number; description: string };
type Practice = {
  slug: string;
  practiceName: string;
  clinicianName: string;
  credentials: string;
  bio: string;
  phone: string;
  website: string;
  address: string;
  languages: string[];
  photoUrl: string | null;
  acceptedInsurances: string[];
  services: Service[];
  cancellationPolicy: string;
  acceptsInsurance: boolean;
  selfPayRate: number;
  slidingScalePolicy: string;
  bookingWindowDays: number;
  selfSchedulingEnabled: boolean;
  requireCreditCard: boolean;
  currentPlan?: string;
};

type PaymentType = 'Insurance' | 'Self-Pay' | 'Sliding Scale';

const STEPS = ['Service', 'Date & time', 'Your information', 'Review', 'Confirmed'];
const STEP_HEADINGS = ['Choose a service', 'Pick a date and time', 'Your information', 'Review your appointment'];

function inputClass() {
  // 44px tall, 16px text on phones (no iOS focus zoom).
  return 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-base text-slate-900 sm:text-sm outline-none placeholder:text-slate-500 focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/30';
}

const FIELD_LABEL = 'mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-slate-600';

export default function PublicBookingPage() {
  const params = useParams<{ practiceSlug: string }>();
  const slug = String(params.practiceSlug || '');
  const [practice, setPractice] = useState<Practice | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [serviceId, setServiceId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [slots, setSlots] = useState<string[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [paymentType, setPaymentType] = useState<PaymentType>('Self-Pay');
  const [insurance, setInsurance] = useState('');
  const [memberId, setMemberId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState('');
  // Move focus to the new step's heading so keyboard and screen-reader users land on it
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const firstStepRender = useRef(true);
  useEffect(() => {
    if (firstStepRender.current) {
      firstStepRender.current = false;
      return;
    }
    stepHeadingRef.current?.focus();
  }, [step]);

  useEffect(() => {
    if (!slug) return;
    void fetch(`/api/book/${slug}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          setMissing(true);
          return;
        }
        setPractice(json.practice);
      })
      .catch(() => setLoadError('Could not load this practice.'));
  }, [slug]);

  useEffect(() => {
    if (!practice || !serviceId || !date) {
      setSlots([]);
      return;
    }
    void fetch(`/api/book/${slug}?serviceId=${encodeURIComponent(serviceId)}&date=${encodeURIComponent(date)}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok || !json.success) {
          setSlots([]);
          return;
        }
        setSlots(json.slots || []);
      })
      .catch(() => setSlots([]));
  }, [practice, slug, serviceId, date]);

  const service = practice?.services.find((item) => item.serviceId === serviceId);
  // Practice calendar day (toISOString() is the UTC day: after 8 PM ET it already reads tomorrow).
  const minDate = useMemo(() => practiceToday(DEFAULT_PRACTICE_TIME_ZONE), []);
  const maxDate = useMemo(() => {
    const [y, m, d] = minDate.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + (practice?.bookingWindowDays || 30), 12)).toISOString().slice(0, 10);
  }, [practice, minDate]);

  const validation = () => {
    if (step === 0 && !serviceId) return 'Select a service.';
    if (step === 1 && (!date || !time)) return 'Select a date and time.';
    if (step === 2) {
      if (!firstName.trim() || !lastName.trim() || !email.trim() || !dob || !reason.trim()) return 'Complete all required fields.';
      if (paymentType === 'Insurance' && (!insurance.trim() || !memberId.trim())) return 'Insurance plan and member ID are required.';
    }
    return null;
  };

  const next = async () => {
    const message = validation();
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    if (step < 3) {
      setStep((prev) => prev + 1);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/book/${slug}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          date,
          time,
          firstName,
          lastName,
          email,
          phone,
          dob,
          paymentType,
          insurance,
          memberId,
          reason,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not confirm booking.');
      setConfirmationCode(json.confirmationCode);
      setStep(4);
    } catch (err: any) {
      setError(err.message || 'Could not confirm booking.');
    } finally {
      setSaving(false);
    }
  };

  if (missing) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-6 text-center">
        <div>
          <h1 className="text-2xl font-black text-[#141C34]">Practice not found</h1>
          <p className="mt-2 text-sm text-slate-500">This booking link is unavailable. Check the URL and try again.</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return <div className="grid min-h-[100dvh] place-items-center text-sm font-semibold text-rose-700">{loadError}</div>;
  }

  if (!practice) {
    return <div className="grid min-h-[100dvh] place-items-center text-sm font-semibold text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-[100dvh] bg-[radial-gradient(circle_at_top_left,#f5f3ff,transparent_34%),#f8fafc]">
      <header className="border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur sm:px-5 sm:py-5">
        <div className="mx-auto flex min-w-0 max-w-4xl items-center gap-4">
          {practice.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={practice.photoUrl} alt="" className="h-14 w-14 shrink-0 rounded-2xl object-cover" />
          ) : (
            <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#141C34] text-lg font-black text-white">
              {(practice.clinicianName || practice.practiceName).slice(0, 1)}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="break-words text-lg font-black text-[#141C34]">{practice.practiceName}</h1>
            <p className="text-sm text-slate-500">
              {practice.clinicianName}
              {practice.credentials ? ` · ${practice.credentials}` : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-4xl px-4 py-6 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-5 sm:py-8">
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5">
          {practice.bio && <p className="break-words text-sm text-slate-600">{practice.bio}</p>}
          <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
            {practice.address && <span>{practice.address}</span>}
            {practice.phone && <span>{practice.phone}</span>}
            {practice.languages.length > 0 && <span>Languages: {practice.languages.join(', ')}</span>}
            {practice.acceptedInsurances.length > 0 && <span>Insurance: {practice.acceptedInsurances.join(', ')}</span>}
          </div>
        </div>

        {!practice.selfSchedulingEnabled && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Online booking is paused for this practice. Please contact the office directly to schedule.
          </div>
        )}

        <ol aria-label="Booking steps" className="mb-4 flex gap-3 overflow-x-auto text-xs font-bold uppercase tracking-[0.12em] text-slate-600">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`shrink-0 ${index === step ? 'text-[#5C2D91]' : ''}`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>

        {error && (
          <div role="alert" className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        )}

        <section aria-labelledby="booking-step-heading" className="rounded-3xl border border-slate-200 bg-white p-4 sm:p-6">
          {step < 4 && (
            <h2
              id="booking-step-heading"
              ref={stepHeadingRef}
              tabIndex={-1}
              className="mb-4 text-lg font-black text-[#141C34] focus:outline-none"
            >
              {STEP_HEADINGS[step]}
            </h2>
          )}

          {step === 0 && (
            <div className="space-y-3">
              {practice.services.map((item) => (
                <button
                  key={item.serviceId}
                  type="button"
                  aria-pressed={serviceId === item.serviceId}
                  onClick={() => setServiceId(item.serviceId)}
                  className={`w-full rounded-2xl border p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] ${serviceId === item.serviceId ? 'border-[#5C2D91] bg-[#F5F3FF]' : 'border-slate-200'}`}
                >
                  <p className="font-bold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-600">
                    {item.duration} min · {formatUsd(item.fee, { trimWholeDollars: true })}
                    {item.description ? ` · ${item.description}` : ''}
                  </p>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <FormField label="Date" required labelClassName={FIELD_LABEL}>
                <input
                  type="date"
                  min={minDate}
                  max={maxDate}
                  className={inputClass()}
                  value={date}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setTime('');
                  }}
                />
              </FormField>
              <div role="group" aria-label="Available times" className="flex flex-wrap gap-2">
                {slots.length === 0 && date && <p className="text-sm text-slate-600">No times available for this date.</p>}
                {slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={time === slot}
                    onClick={() => setTime(slot)}
                    className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-bold focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91] ${time === slot ? 'border-[#5C2D91] bg-[#F5F3FF] text-[#5C2D91]' : 'border-slate-200 text-slate-700'}`}
                  >
                    <Clock size={14} className="mr-1 inline" aria-hidden />
                    {formatWallClock(slot)} {practiceZoneLabel(DEFAULT_PRACTICE_TIME_ZONE)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="First name" required labelClassName={FIELD_LABEL}>
                <input className={inputClass()} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </FormField>
              <FormField label="Last name" required labelClassName={FIELD_LABEL}>
                <input className={inputClass()} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </FormField>
              <FormField label="Email" required labelClassName={FIELD_LABEL}>
                <input type="email" inputMode="email" className={inputClass()} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </FormField>
              <FormField label="Phone" labelClassName={FIELD_LABEL}>
                <input type="tel" inputMode="tel" className={inputClass()} autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </FormField>
              <FormField label="Date of birth" required labelClassName={FIELD_LABEL}>
                <input type="date" className={inputClass()} autoComplete="bday" value={dob} onChange={(e) => setDob(e.target.value)} />
              </FormField>
              <FormField label="How will you pay?" labelClassName={FIELD_LABEL}>
                <select className={inputClass()} value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
                  {practice.acceptsInsurance && <option>Insurance</option>}
                  <option>Self-Pay</option>
                  {practice.slidingScalePolicy && <option>Sliding Scale</option>}
                </select>
              </FormField>
              {paymentType === 'Insurance' && (
                <>
                  <FormField label="Insurance plan" required labelClassName={FIELD_LABEL}>
                    <input className={inputClass()} value={insurance} onChange={(e) => setInsurance(e.target.value)} />
                  </FormField>
                  <FormField label="Member ID" required labelClassName={FIELD_LABEL}>
                    <input className={inputClass()} autoComplete="off" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
                  </FormField>
                </>
              )}
              <FormField label="Reason for visit" required labelClassName={FIELD_LABEL} className="sm:col-span-2">
                <textarea className={`${inputClass()} min-h-24`} value={reason} onChange={(e) => setReason(e.target.value)} />
              </FormField>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm text-slate-700">
              <p><strong>Service:</strong> {service?.name} ({service?.duration} min)</p>
              <p>
                <strong>When:</strong> {formatDateOnly(date, 'long')} at {formatWallClock(time)}{' '}
                {practiceZoneLabel(DEFAULT_PRACTICE_TIME_ZONE)}
              </p>
              <p><strong>Your name:</strong> {firstName} {lastName}</p>
              <p><strong>Payment:</strong> {paymentType}</p>
              <p><strong>Cancellation policy:</strong> {practice.cancellationPolicy}</p>
              {practice.requireCreditCard && <p className="rounded-xl bg-slate-50 p-3 text-slate-600">A card on file is required by this practice. Charge timing is not collected on this form.</p>}
              <p className="flex items-center gap-2 text-slate-600"><Calendar size={14} aria-hidden /> Please review before confirming.</p>
            </div>
          )}

          {step === 4 && (
            <div className="py-8 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check size={28} aria-hidden /></div>
              <h2
                id="booking-step-heading"
                ref={stepHeadingRef}
                tabIndex={-1}
                className="mt-4 text-2xl font-black text-[#141C34] focus:outline-none"
              >
                Appointment confirmed
              </h2>
              <p className="mt-2 break-all text-sm font-bold tracking-[0.18em] text-[#5C2D91]">{confirmationCode}</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-600"><Shield size={14} aria-hidden /> Keep this confirmation code for your records.</p>
            </div>
          )}

          {step < 4 && (
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row">
              {step > 0 && (
                <button type="button" onClick={() => setStep((prev) => prev - 1)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600">
                  <ChevronLeft size={16} aria-hidden /> Back
                </button>
              )}
              <button
                type="button"
                onClick={next}
                disabled={saving || (!practice.selfSchedulingEnabled && step === 3)}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#5C2D91] px-6 py-3 sm:ml-auto sm:w-auto text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Booking…' : step === 3 ? 'Confirm appointment' : 'Continue'} <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          )}
        </section>

        <CrisisFooter className="mt-6" />
      </main>
    </div>
  );
}
