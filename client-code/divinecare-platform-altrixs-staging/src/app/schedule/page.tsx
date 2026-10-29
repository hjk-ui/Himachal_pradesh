'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Lock,
  MapPin,
  Shield,
  Video,
} from 'lucide-react';

const BRAND = '#5C2D91';
const CTA = 'linear-gradient(135deg, #5C2D91, #7C3AED)';
const TZ = 'America/New_York';

const STEPS = [
  { id: 'service', label: 'Service' },
  { id: 'provider', label: 'Provider' },
  { id: 'datetime', label: 'Date & Time' },
  { id: 'info', label: 'Your Info' },
  { id: 'confirm', label: 'Confirm' },
  { id: 'done', label: 'Done' },
] as const;

type StepId = (typeof STEPS)[number]['id'];

const INSURANCE_OPTIONS = [
  'Medicaid MD Healthy Connection',
  'Medicare',
  'BCBS',
  'Aetna',
  'United',
  'CareFirst',
  'Cigna',
  'Self-Pay',
] as const;

type PublicService = {
  id: string;
  title: string;
  durationMin: number;
  durationLabel: string;
  telehealth: boolean;
  inPerson: boolean;
  enabled: boolean;
};

type PublicSettings = {
  practiceName: string;
  practiceCity: string;
  contactPhone: string | null;
  contactEmail: string | null;
  services: PublicService[];
  minNoticeDays: number;
  bookAheadDays: number;
  rules: { requireInsurance: boolean; newClientsOnly: boolean };
  embed: { color: string; mode: string };
};

type Provider = { id: string | null; name: string; role: string | null };
type Slot = { startsAt: string; endsAt: string };

type BookResult = {
  appointmentId: string;
  confirmationCode: string;
  startsAt: string;
  endsAt: string;
  service: string;
  modality: string;
  contactPhone: string | null;
  contactEmail: string | null;
  practiceName: string | null;
};

function inputClass() {
  // 44px tall, 16px text on phones (no iOS focus zoom).
  return 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-900 sm:text-sm outline-none focus:border-[#5C2D91] focus:ring-4 focus:ring-purple-100';
}

function easternParts(d: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: get('weekday'),
    time: `${get('hour')}:${get('minute')} ${get('dayPeriod')}`.trim(),
  };
}

function formatEasternDate(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

function formatEasternTime(iso: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).format(new Date(iso));
}

function ymdInEastern(d: Date) {
  const p = easternParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function startOfMonth(year: number, month: number) {
  return new Date(year, month, 1);
}

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(
    new Date(year, month, 1)
  );
}

function orgQuery(org: string | null) {
  return org ? `org=${encodeURIComponent(org)}` : '';
}

function PublicScheduleContent() {
  const searchParams = useSearchParams();
  const org = searchParams.get('org') || searchParams.get('organizationSlug');
  const embed = searchParams.get('embed') === 'true';

  const [step, setStep] = useState<StepId>('service');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('Practice');
  const [settings, setSettings] = useState<PublicSettings | null>(null);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [modality, setModality] = useState<'telehealth' | 'in_person' | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState<string | null | undefined>(undefined);
  const [providersLoading, setProvidersLoading] = useState(false);

  const todayParts = easternParts(new Date());
  const [calYear, setCalYear] = useState(todayParts.year);
  const [calMonth, setCalMonth] = useState(todayParts.month - 1);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [startsAt, setStartsAt] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [dob, setDob] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [insurance, setInsurance] = useState('');
  const [memberId, setMemberId] = useState('');
  const [notes, setNotes] = useState('');
  const [hipaaConsent, setHipaaConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<BookResult | null>(null);

  const selectedService = useMemo(
    () => settings?.services.find((s) => s.id === serviceId) || null,
    [settings, serviceId]
  );

  const selectedProvider = useMemo(() => {
    if (providerId === undefined) return null;
    return providers.find((p) => p.id === providerId) || null;
  }, [providers, providerId]);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const q = orgQuery(org);
      const res = await fetch(`/api/scheduling/settings/public${q ? `?${q}` : ''}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Practice not found');
      setOrgId(json.organization.id);
      setOrgName(json.organization.name);
      setSettings(json.settings);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load scheduling');
    } finally {
      setLoading(false);
    }
  }, [org]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  const loadProviders = useCallback(
    async (svcId: string) => {
      setProvidersLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ service: svcId });
        if (org) params.set('org', org);
        const res = await fetch(`/api/scheduling/providers?${params}`);
        const json = await res.json();
        if (!res.ok || !json.success) throw new Error(json.error || 'Could not load providers');
        setProviders(json.providers || []);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Could not load providers');
      } finally {
        setProvidersLoading(false);
      }
    },
    [org]
  );

  const loadSlots = useCallback(async () => {
    if (!serviceId) return;
    setSlotsLoading(true);
    setError(null);
    try {
      const from = new Date(calYear, calMonth, 1);
      const to = new Date(calYear, calMonth + 1, 0, 23, 59, 59, 999);
      const params = new URLSearchParams({
        service: serviceId,
        from: from.toISOString(),
        to: to.toISOString(),
      });
      if (providerId) params.set('provider', providerId);
      if (org) params.set('org', org);
      const res = await fetch(`/api/scheduling/slots?${params}`);
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load availability');
      setSlots(json.slots || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load availability');
      setSlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, [serviceId, providerId, calYear, calMonth, org]);

  useEffect(() => {
    if (step === 'datetime' && serviceId) void loadSlots();
  }, [step, serviceId, loadSlots]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const key = ymdInEastern(new Date(slot.startsAt));
      const list = map.get(key) || [];
      list.push(slot);
      map.set(key, list);
    }
    return map;
  }, [slots]);

  const daySlots = selectedDay ? slotsByDay.get(selectedDay) || [] : [];

  const todayYmd = ymdInEastern(new Date());
  const maxBookDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (settings?.bookAheadDays ?? 30));
    return ymdInEastern(d);
  }, [settings?.bookAheadDays]);

  const goPrevMonth = () => {
    setSelectedDay(null);
    setStartsAt(null);
    if (calMonth === 0) {
      setCalYear((y) => y - 1);
      setCalMonth(11);
    } else {
      setCalMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    setSelectedDay(null);
    setStartsAt(null);
    if (calMonth === 11) {
      setCalYear((y) => y + 1);
      setCalMonth(0);
    } else {
      setCalMonth((m) => m + 1);
    }
  };

  const resetFlow = () => {
    setStep('service');
    setServiceId(null);
    setModality(null);
    setProviders([]);
    setProviderId(undefined);
    setSelectedDay(null);
    setStartsAt(null);
    setSlots([]);
    setFirstName('');
    setLastName('');
    setDob('');
    setPhone('');
    setEmail('');
    setInsurance('');
    setMemberId('');
    setNotes('');
    setHipaaConsent(false);
    setResult(null);
    setError(null);
    const now = easternParts(new Date());
    setCalYear(now.year);
    setCalMonth(now.month - 1);
  };

  const selectService = (svc: PublicService) => {
    setServiceId(svc.id);
    setModality(null);
    setProviderId(undefined);
    setStartsAt(null);
    setSelectedDay(null);
  };

  const continueFromService = async () => {
    if (!serviceId || !modality || !selectedService) return;
    if (modality === 'telehealth' && !selectedService.telehealth) return;
    if (modality === 'in_person' && !selectedService.inPerson) return;
    await loadProviders(serviceId);
    setStep('provider');
  };

  const continueFromProvider = () => {
    if (providerId === undefined) return;
    setStep('datetime');
  };

  const continueFromDateTime = () => {
    if (!startsAt) return;
    setStep('info');
  };

  const continueFromInfo = () => {
    if (!firstName.trim() || !lastName.trim() || !dob || !phone.trim() || !email.trim()) {
      setError('Please complete all required fields.');
      return;
    }
    if (settings?.rules.requireInsurance && !insurance.trim()) {
      setError('Insurance is required for online booking.');
      return;
    }
    setError(null);
    setStep('confirm');
  };

  const submitBooking = async () => {
    if (!hipaaConsent || !serviceId || !modality || !startsAt) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        serviceId,
        modality,
        providerId: providerId ?? null,
        startsAt,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        dob,
        phone: phone.trim(),
        email: email.trim(),
        insurance: insurance || undefined,
        memberId: memberId || undefined,
        notes: notes || undefined,
        hipaaConsent: true as const,
      };
      if (orgId) body.organizationId = orgId;
      if (org) body.organizationSlug = org;

      const res = await fetch('/api/scheduling/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not complete booking');
      setResult({
        appointmentId: json.appointmentId,
        confirmationCode: json.confirmationCode,
        startsAt: json.startsAt,
        endsAt: json.endsAt,
        service: json.service,
        modality: json.modality,
        contactPhone: json.contactPhone,
        contactEmail: json.contactEmail,
        practiceName: json.practiceName,
      });
      setStep('done');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not complete booking');
    } finally {
      setSubmitting(false);
    }
  };

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const practiceTitle = settings?.practiceName || orgName;

  if (loading) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
        Loading scheduling…
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-slate-50 px-4">
        <div className="max-w-md rounded-2xl border border-rose-200 bg-white p-6 text-center shadow-sm">
          <p className="font-semibold text-rose-700">{error || 'Practice not found'}</p>
        </div>
      </div>
    );
  }

  const firstOfMonth = startOfMonth(calYear, calMonth);
  const leadBlanks = firstOfMonth.getDay();
  const totalDays = daysInMonth(calYear, calMonth);

  return (
    <div className={`min-h-[100dvh] ${embed ? 'bg-white' : 'bg-slate-50'}`}>
      {!embed ? (
        <header className="text-white" style={{ background: BRAND }}>
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
            <div className="min-w-0">
              <p className="text-lg font-black tracking-tight">Altrixs</p>
              <p className="truncate text-sm text-white/85">{practiceTitle}</p>
            </div>
            <div className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-xs font-semibold">
              <Lock size={12} />
              HIPAA Secure
            </div>
          </div>
        </header>
      ) : null}

      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {!embed && step !== 'done' ? (
          <nav className="mb-6 overflow-x-auto">
            <ol className="flex min-w-max items-center gap-1">
              {STEPS.filter((s) => s.id !== 'done').map((s, i) => {
                const active = i === stepIndex;
                const done = i < stepIndex;
                return (
                  <li key={s.id} className="flex items-center gap-1">
                    {i > 0 ? <span className="mx-1 h-px w-4 bg-slate-200 sm:w-6" /> : null}
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold sm:text-xs ${
                        active
                          ? 'text-white'
                          : done
                            ? 'bg-purple-100 text-[#5C2D91]'
                            : 'bg-slate-100 text-slate-500'
                      }`}
                      style={active ? { background: CTA } : undefined}
                    >
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-black/10 text-[11px]">
                        {done ? <Check size={12} /> : i + 1}
                      </span>
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          {step === 'service' ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Choose a service</h1>
                <p className="mt-1 text-sm text-slate-500">Select what you need, then how you’d like to meet.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {settings.services.map((svc) => {
                  const active = serviceId === svc.id;
                  return (
                    <button
                      key={svc.id}
                      type="button"
                      onClick={() => selectService(svc)}
                      className={`rounded-xl border p-4 text-left transition ${
                        active
                          ? 'border-[#5C2D91] bg-purple-50 ring-2 ring-[#5C2D91]/30'
                          : 'border-slate-200 hover:border-purple-200'
                      }`}
                    >
                      <p className="font-semibold text-slate-900">{svc.title}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                        <Clock size={12} />
                        {svc.durationLabel}
                      </p>
                      <p className="mt-2 text-[11px] font-medium text-slate-500">
                        {[svc.telehealth ? 'Telehealth' : null, svc.inPerson ? 'In-person' : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </button>
                  );
                })}
              </div>

              {selectedService ? (
                <div className="space-y-3 border-t border-slate-100 pt-4">
                  <p className="text-sm font-semibold text-slate-800">How would you like to meet?</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedService.telehealth ? (
                      <button
                        type="button"
                        onClick={() => setModality('telehealth')}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left ${
                          modality === 'telehealth'
                            ? 'border-[#5C2D91] bg-purple-50 ring-2 ring-[#5C2D91]/30'
                            : 'border-slate-200'
                        }`}
                      >
                        <Video className="mt-0.5 text-[#5C2D91]" size={18} />
                        <div>
                          <p className="font-semibold text-slate-900">Video / Telehealth</p>
                          <p className="text-xs text-slate-500">Secure online visit</p>
                        </div>
                      </button>
                    ) : null}
                    {selectedService.inPerson ? (
                      <button
                        type="button"
                        onClick={() => setModality('in_person')}
                        className={`flex items-start gap-3 rounded-xl border p-4 text-left ${
                          modality === 'in_person'
                            ? 'border-[#5C2D91] bg-purple-50 ring-2 ring-[#5C2D91]/30'
                            : 'border-slate-200'
                        }`}
                      >
                        <MapPin className="mt-0.5 text-[#5C2D91]" size={18} />
                        <div>
                          <p className="font-semibold text-slate-900">In-Person</p>
                          <p className="text-xs text-slate-500">{settings.practiceCity}</p>
                        </div>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div className="flex justify-end">
                <button
                  type="button"
                  disabled={!serviceId || !modality}
                  onClick={() => void continueFromService()}
                  className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: CTA }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 'provider' ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Choose a provider</h1>
                <p className="mt-1 text-sm text-slate-500">Pick a clinician or any available provider.</p>
              </div>
              {providersLoading ? (
                <p className="text-sm font-semibold text-slate-500">Loading providers…</p>
              ) : (
                <div className="space-y-2">
                  {providers.map((p) => {
                    const key = p.id ?? 'any';
                    const active = providerId === p.id;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setProviderId(p.id)}
                        className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${
                          active
                            ? 'border-[#5C2D91] bg-purple-50 ring-2 ring-[#5C2D91]/30'
                            : 'border-slate-200 hover:border-purple-200'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="break-words font-semibold text-slate-900">{p.name}</p>
                          {p.role ? <p className="text-xs text-slate-500">{p.role}</p> : null}
                        </div>
                        {active ? <Check className="shrink-0 text-[#5C2D91]" size={18} /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep('service')}
                  className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={providerId === undefined}
                  onClick={continueFromProvider}
                  className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: CTA }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 'datetime' ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Pick a date & time</h1>
                <p className="mt-1 text-sm text-slate-500">
                  Times shown in Eastern Time (America/New_York).
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 p-2 sm:p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={goPrevMonth}
                    aria-label="Previous month"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <p className="inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Calendar size={16} className="text-[#5C2D91]" />
                    {monthLabel(calYear, calMonth)}
                  </p>
                  <button
                    type="button"
                    onClick={goNextMonth}
                    aria-label="Next month"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                    <div key={d} className="py-1">
                      {d}
                    </div>
                  ))}
                </div>
                <div className="mt-1 grid grid-cols-7 gap-1">
                  {Array.from({ length: leadBlanks }).map((_, i) => (
                    <div key={`blank-${i}`} />
                  ))}
                  {Array.from({ length: totalDays }).map((_, i) => {
                    const day = i + 1;
                    const ymd = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                    const isPast = ymd < todayYmd;
                    const beyondAhead = ymd > maxBookDate;
                    const hasSlots = (slotsByDay.get(ymd) || []).length > 0;
                    const disabled = isPast || beyondAhead || (!hasSlots && !slotsLoading);
                    const selected = selectedDay === ymd;
                    return (
                      <button
                        key={ymd}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          setSelectedDay(ymd);
                          setStartsAt(null);
                        }}
                        className={`aspect-square min-w-0 rounded-lg text-sm font-semibold transition ${
                          selected
                            ? 'text-white'
                            : disabled
                              ? 'cursor-not-allowed text-slate-300'
                              : hasSlots
                                ? 'bg-purple-50 text-[#5C2D91] hover:bg-purple-100'
                                : 'text-slate-700 hover:bg-slate-50'
                        }`}
                        style={selected ? { background: CTA } : undefined}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              {slotsLoading ? (
                <p className="text-sm font-semibold text-slate-500">Loading available times…</p>
              ) : selectedDay ? (
                <div>
                  <p className="mb-2 text-sm font-semibold text-slate-800">
                    Available on {selectedDay} (ET)
                  </p>
                  {daySlots.length === 0 ? (
                    <p className="text-sm text-slate-500">No open times this day. Try another date.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {daySlots.map((slot) => {
                        const active = startsAt === slot.startsAt;
                        return (
                          <button
                            key={slot.startsAt}
                            type="button"
                            onClick={() => setStartsAt(slot.startsAt)}
                            className={`min-h-11 rounded-xl border px-3 py-2 text-sm font-semibold ${
                              active
                                ? 'border-transparent text-white'
                                : 'border-slate-200 text-slate-800 hover:border-purple-200'
                            }`}
                            style={active ? { background: CTA } : undefined}
                          >
                            {formatEasternTime(slot.startsAt)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">Select a date to see open times.</p>
              )}

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep('provider')}
                  className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!startsAt}
                  onClick={continueFromDateTime}
                  className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: CTA }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 'info' ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Your information</h1>
                <p className="mt-1 text-sm text-slate-500">We’ll use this to confirm your appointment.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">First name *</span>
                  <input className={inputClass()} value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Last name *</span>
                  <input className={inputClass()} value={lastName} onChange={(e) => setLastName(e.target.value)} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Date of birth *</span>
                  <input
                    type="date"
                    className={inputClass()}
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Phone *</span>
                  <input
                    type="tel"
                    className={inputClass()}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Email *</span>
                  <input
                    type="email"
                    className={inputClass()}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">
                    Insurance {settings.rules.requireInsurance ? '*' : '(optional)'}
                  </span>
                  <select
                    className={inputClass()}
                    value={insurance}
                    onChange={(e) => setInsurance(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {INSURANCE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Member ID</span>
                  <input className={inputClass()} value={memberId} onChange={(e) => setMemberId(e.target.value)} />
                </label>
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-sm font-semibold text-slate-700">Notes</span>
                  <textarea
                    className={`${inputClass()} min-h-[88px]`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Anything we should know before your visit?"
                  />
                </label>
              </div>
              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep('datetime')}
                  className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={continueFromInfo}
                  className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                  style={{ background: CTA }}
                >
                  Continue
                </button>
              </div>
            </div>
          ) : null}

          {step === 'confirm' ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-xl font-bold text-slate-900">Confirm appointment</h1>
                <p className="mt-1 text-sm text-slate-500">Review details, then confirm to book.</p>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <table className="w-full table-fixed text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {[
                      ['Service', selectedService?.title || '—'],
                      ['Modality', modality === 'telehealth' ? 'Telehealth' : 'In-Person'],
                      ['Provider', selectedProvider?.name || 'Any Available'],
                      ['Date', startsAt ? formatEasternDate(startsAt) : '—'],
                      ['Time', startsAt ? formatEasternTime(startsAt) : '—'],
                      ['Name', `${firstName} ${lastName}`.trim()],
                      ['Phone', phone],
                      ['Email', email],
                      ['Insurance', insurance || '—'],
                    ].map(([label, value]) => (
                      <tr key={label}>
                        <th className="w-24 bg-slate-50 px-3 py-2.5 text-left align-top sm:w-36 sm:px-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {label}
                        </th>
                        <td className="break-words px-3 py-2.5 font-medium text-slate-900 [overflow-wrap:anywhere] sm:px-4">{value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <label className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 rounded text-[#5C2D91]"
                  checked={hipaaConsent}
                  onChange={(e) => setHipaaConsent(e.target.checked)}
                />
                <span>
                  <span className="font-semibold">HIPAA privacy notice</span>
                  <span className="mt-1 block text-xs text-amber-900/90">
                    I acknowledge that my health information may be used as described in the Notice of Privacy
                    Practices to schedule and provide care.
                  </span>
                </span>
              </label>

              <div className="flex justify-between gap-2">
                <button
                  type="button"
                  onClick={() => setStep('info')}
                  className="min-h-11 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!hipaaConsent || submitting}
                  onClick={() => void submitBooking()}
                  className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  style={{ background: CTA }}
                >
                  {submitting ? 'Booking…' : 'Confirm Appointment'}
                </button>
              </div>
            </div>
          ) : null}

          {step === 'done' && result ? (
            <div className="space-y-5 text-center">
              <div
                className="mx-auto grid h-14 w-14 place-items-center rounded-full text-white"
                style={{ background: CTA }}
              >
                <Check size={28} />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">You’re booked</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {result.practiceName || practiceTitle} has your appointment.
                </p>
              </div>
              <div className="rounded-2xl border border-purple-200 bg-purple-50 px-4 py-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-[#5C2D91]">Confirmation</p>
                <p className="mt-1 break-all font-mono text-2xl font-black tracking-wider text-[#5C2D91] sm:text-3xl">
                  {result.confirmationCode}
                </p>
                <p className="mt-3 text-sm font-medium text-slate-700">
                  {result.service} · {formatEasternDate(result.startsAt)} · {formatEasternTime(result.startsAt)}
                </p>
              </div>
              {(result.contactPhone || result.contactEmail) && (
                <p className="text-sm text-slate-600">
                  Questions?{' '}
                  {result.contactPhone ? <span className="font-semibold">{result.contactPhone}</span> : null}
                  {result.contactPhone && result.contactEmail ? ' · ' : null}
                  {result.contactEmail ? <span className="break-all font-semibold">{result.contactEmail}</span> : null}
                </p>
              )}
              <button
                type="button"
                onClick={resetFlow}
                className="min-h-11 rounded-xl px-5 py-2.5 text-sm font-bold text-white"
                style={{ background: CTA }}
              >
                Schedule Another
              </button>
            </div>
          ) : null}
        </div>
      </main>

      {!embed ? (
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 py-5 text-xs font-medium text-slate-500 sm:px-6">
            <span className="inline-flex items-center gap-1">
              <Shield size={12} className="text-[#5C2D91]" />
              HIPAA Compliant
            </span>
            <span>256-bit Encryption</span>
            <a href="/privacy" className="inline-flex min-h-10 items-center hover:text-[#5C2D91]">
              Privacy Policy
            </a>
            <a href="/support" className="inline-flex min-h-10 items-center hover:text-[#5C2D91]">
              Support
            </a>
            {/* No public Notice of Privacy Practices page exists yet (/npp was a dead link); the NPP is given at intake. */}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

export default function PublicSchedulePage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-[100dvh] place-items-center bg-slate-50 text-sm font-semibold text-slate-500">
          Loading scheduling…
        </div>
      }
    >
      <PublicScheduleContent />
    </Suspense>
  );
}
