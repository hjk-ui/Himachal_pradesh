'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Calendar, Check, ChevronLeft, ChevronRight, Clock, Shield } from 'lucide-react';

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
  currentPlan: string;
};

type PaymentType = 'Insurance' | 'Self-Pay' | 'Sliding Scale';

const STEPS = ['Service', 'Date & time', 'Your information', 'Review', 'Confirmed'];

function inputClass() {
  return 'w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100';
}

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
  const minDate = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (practice?.bookingWindowDays || 30));
    return d.toISOString().slice(0, 10);
  }, [practice]);

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
      <div className="grid min-h-screen place-items-center bg-slate-50 px-6 text-center">
        <div>
          <h1 className="text-2xl font-black text-[#141C34]">Practice not found</h1>
          <p className="mt-2 text-sm text-slate-500">This booking link is unavailable. Check the URL and try again.</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return <div className="grid min-h-screen place-items-center text-sm font-semibold text-rose-700">{loadError}</div>;
  }

  if (!practice) {
    return <div className="grid min-h-screen place-items-center text-sm font-semibold text-slate-500">Loading…</div>;
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,#eef2ff,transparent_34%),#f8fafc]">
      <header className="border-b border-slate-200 bg-white/90 px-5 py-5 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-4">
          {practice.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={practice.photoUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" />
          ) : (
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-[#141C34] text-lg font-black text-white">
              {(practice.clinicianName || practice.practiceName).slice(0, 1)}
            </div>
          )}
          <div>
            <h1 className="text-lg font-black text-[#141C34]">{practice.practiceName}</h1>
            <p className="text-sm text-slate-500">
              {practice.clinicianName}
              {practice.credentials ? ` · ${practice.credentials}` : ''}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-5 py-8">
        <div className="mb-6 rounded-3xl border border-slate-200 bg-white p-5">
          {practice.bio && <p className="text-sm text-slate-600">{practice.bio}</p>}
          <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
            {practice.address && <span>{practice.address}</span>}
            {practice.phone && <span>{practice.phone}</span>}
            {practice.languages.length > 0 && <span>Languages: {practice.languages.join(', ')}</span>}
            {practice.acceptedInsurances.length > 0 && <span>Insurance: {practice.acceptedInsurances.join(', ')}</span>}
          </div>
        </div>

        {!practice.selfSchedulingEnabled && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
            Online self-scheduling requires a Solo or Growth plan. You can still view this practice profile.
          </div>
        )}

        <div className="mb-4 flex gap-2 overflow-x-auto text-xs font-bold uppercase tracking-[0.12em] text-slate-400">
          {STEPS.map((label, index) => (
            <span key={label} className={index === step ? 'text-[#6868D0]' : ''}>{index + 1}. {label}</span>
          ))}
        </div>

        {error && <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</div>}

        <section className="rounded-3xl border border-slate-200 bg-white p-6">
          {step === 0 && (
            <div className="space-y-3">
              {practice.services.map((item) => (
                <button
                  key={item.serviceId}
                  type="button"
                  onClick={() => setServiceId(item.serviceId)}
                  className={`w-full rounded-2xl border p-4 text-left ${serviceId === item.serviceId ? 'border-[#6868D0] bg-[#EEF0FE]' : 'border-slate-200'}`}
                >
                  <p className="font-bold text-slate-900">{item.name}</p>
                  <p className="text-sm text-slate-500">{item.duration} min · ${item.fee}{item.description ? ` · ${item.description}` : ''}</p>
                </button>
              ))}
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <label className="block text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                Date
                <input type="date" min={minDate} max={maxDate} className={`${inputClass()} mt-1.5`} value={date} onChange={(e) => { setDate(e.target.value); setTime(''); }} />
              </label>
              <div className="flex flex-wrap gap-2">
                {slots.length === 0 && date && <p className="text-sm text-slate-500">No times available for this date.</p>}
                {slots.map((slot) => (
                  <button key={slot} type="button" onClick={() => setTime(slot)} className={`rounded-xl border px-3 py-2 text-sm font-bold ${time === slot ? 'border-[#6868D0] bg-[#EEF0FE] text-[#4F46E5]' : 'border-slate-200 text-slate-700'}`}>
                    <Clock size={14} className="mr-1 inline" />{slot}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <input className={inputClass()} placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              <input className={inputClass()} placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
              <input className={inputClass()} placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <input className={inputClass()} placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <input type="date" className={inputClass()} value={dob} onChange={(e) => setDob(e.target.value)} />
              <select className={inputClass()} value={paymentType} onChange={(e) => setPaymentType(e.target.value as PaymentType)}>
                {practice.acceptsInsurance && <option>Insurance</option>}
                <option>Self-Pay</option>
                {practice.slidingScalePolicy && <option>Sliding Scale</option>}
              </select>
              {paymentType === 'Insurance' && (
                <>
                  <input className={inputClass()} placeholder="Insurance plan" value={insurance} onChange={(e) => setInsurance(e.target.value)} />
                  <input className={inputClass()} placeholder="Member ID" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
                </>
              )}
              <textarea className={`${inputClass()} min-h-24 sm:col-span-2`} placeholder="Reason for visit" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 text-sm text-slate-700">
              <p><strong>Service:</strong> {service?.name} ({service?.duration} min)</p>
              <p><strong>When:</strong> {date} at {time}</p>
              <p><strong>Client:</strong> {firstName} {lastName}</p>
              <p><strong>Payment:</strong> {paymentType}</p>
              <p><strong>Cancellation policy:</strong> {practice.cancellationPolicy}</p>
              {practice.requireCreditCard && <p className="rounded-xl bg-slate-50 p-3 text-slate-500">A card on file is required by this practice. Charge timing is not collected on this form.</p>}
              <p className="flex items-center gap-2 text-slate-500"><Calendar size={14} /> Please review before confirming.</p>
            </div>
          )}

          {step === 4 && (
            <div className="py-8 text-center">
              <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-emerald-600"><Check size={28} /></div>
              <h2 className="mt-4 text-2xl font-black text-[#141C34]">Appointment confirmed</h2>
              <p className="mt-2 text-sm font-bold tracking-[0.18em] text-[#6868D0]">{confirmationCode}</p>
              <p className="mt-6 text-sm text-slate-600">If you are in crisis, call or text <strong>988</strong>.</p>
              <p className="mt-2 flex items-center justify-center gap-2 text-xs text-slate-400"><Shield size={14} /> Keep this confirmation code for your records.</p>
            </div>
          )}

          {step < 4 && (
            <div className="mt-8 flex gap-3">
              {step > 0 && (
                <button type="button" onClick={() => setStep((prev) => prev - 1)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-600">
                  <ChevronLeft size={16} /> Back
                </button>
              )}
              <button
                type="button"
                onClick={next}
                disabled={saving || (!practice.selfSchedulingEnabled && step === 3)}
                className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#6868D0] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? 'Booking…' : step === 3 ? 'Confirm appointment' : 'Continue'} <ChevronRight size={16} />
              </button>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
