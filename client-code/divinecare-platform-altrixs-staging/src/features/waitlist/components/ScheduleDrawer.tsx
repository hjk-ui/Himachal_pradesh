'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Copy, ExternalLink, Video, Building2 } from 'lucide-react';
import { Alert, Button, cx, inputClasses } from '@/components/ui';
import { APPOINTMENT_TYPES } from '@/features/appointments/types';
import {
  convertWaitlistEntry,
  fetchSchedulePreview,
  scheduleFromWaitlist,
  type ConversionResponse,
  type DuplicateMatch,
  type SchedulePreview,
  type WaitlistEntry,
} from '@/features/waitlist/api';
import { CrisisGuidance, Drawer, Field, SectionTitle, errorMessage, formatDateTime } from './shared';

type Pick = { clinicianId: string; startsAt: string; endsAt: string } | null;

const NETWORK_LABEL = { yes: 'In network', no: 'Not on panel', unknown: 'Network not on file' } as const;
const LOCATION_LABEL = { yes: 'Works at preferred site', no: 'Not at preferred site', unknown: 'Site not on file', telehealth: 'Telehealth fit' } as const;

/**
 * One-click conversion. mode "schedule": duplicate check, client, clinician + slot, intake,
 * eligibility, all confirmed at once. mode "convert": create / link the client only.
 */
export function ScheduleDrawer({
  entry,
  mode,
  locations,
  onClose,
  onDone,
}: {
  entry: WaitlistEntry;
  mode: 'schedule' | 'convert';
  locations: { id: string; name: string }[];
  onClose: () => void;
  onDone: (entry: WaitlistEntry | undefined) => void;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [clientChoice, setClientChoice] = useState<string>(''); // '' = undecided, 'new', or client id
  const [pick, setPick] = useState<Pick>(null);
  const [type, setType] = useState('');
  const [isVirtual, setIsVirtual] = useState(Boolean(entry.telehealthOk) && !entry.preferredLocationIds.length);
  const [locationId, setLocationId] = useState(entry.preferredLocationIds[0] ?? '');
  const [sendIntake, setSendIntake] = useState(Boolean(entry.email));
  const [runEligibility, setRunEligibility] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ConversionResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    fetchSchedulePreview(entry.id)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setType(p.appointmentType);
        if (p.linkedClientId) setClientChoice(p.linkedClientId);
        else if (!p.duplicates.length) setClientChoice('new');
        setRunEligibility(Boolean(p.eligibility && entry.insurancePayer));
      })
      .catch((err) => live && setLoadError(errorMessage(err, 'Could not load suggestions')));
    return () => {
      live = false;
    };
  }, [entry.id, entry.insurancePayer]);

  const duplicates: DuplicateMatch[] = preview?.duplicates ?? [];
  const pickedClinician = useMemo(() => preview?.clinicians.find((c) => c.clinicianId === pick?.clinicianId) ?? null, [preview, pick]);
  const tz = preview?.timeZone;
  const linkedAlready = Boolean(preview?.linkedClientId);

  const confirm = async (opts: { thenOpenScheduler?: boolean } = {}) => {
    setError('');
    if (!clientChoice) return setError('Choose: link to the existing client, or create a new chart');
    if (mode === 'schedule' && !opts.thenOpenScheduler && !pick) return setError('Pick a time, or use "Pick a time in the scheduler"');
    setSaving(true);
    const linkClientId = clientChoice !== 'new' && !linkedAlready ? clientChoice : null;
    const base = {
      linkClientId,
      createDespiteMatches: clientChoice === 'new' && duplicates.length > 0,
      locationId: locationId || null,
      sendIntake: sendIntake && Boolean(entry.email),
    };
    try {
      let r: ConversionResponse;
      if (mode === 'convert' || opts.thenOpenScheduler) {
        r = await convertWaitlistEntry(entry.id, { ...base, assignedToId: pick?.clinicianId ?? entry.clinicianId ?? null });
      } else {
        r = await scheduleFromWaitlist(entry.id, {
          ...base,
          runEligibility,
          appointment: { clinicianId: pick!.clinicianId, startsAt: pick!.startsAt, endsAt: pick!.endsAt, type, isVirtual },
        });
      }
      setResult(r);
      onDone(r.entry);
      if (opts.thenOpenScheduler) {
        const q = new URLSearchParams({ new: '1', client: r.clientId, type });
        if (pick?.clinicianId) q.set('clinician', pick.clinicianId);
        if (isVirtual) q.set('virtual', '1');
        router.push(`/dashboard/appointments?${q.toString()}`);
      }
    } catch (err) {
      const e = err as Error & { status?: number; data?: { code?: string; duplicates?: DuplicateMatch[] } };
      if (e.status === 409 && e.data?.code === 'POSSIBLE_DUPLICATE' && e.data.duplicates) {
        setPreview((p) => (p ? { ...p, duplicates: e.data!.duplicates! } : p));
        setClientChoice('');
        setError('A possible existing client was found. Link to them or confirm a new chart.');
      } else {
        setError(errorMessage(err, 'Could not complete'));
      }
    } finally {
      setSaving(false);
    }
  };

  const intakeUrl = result?.intake && 'token' in result.intake ? `${typeof window !== 'undefined' ? window.location.origin : ''}/intake/${result.intake.token}` : null;

  if (result) {
    return (
      <Drawer title="Done" subtitle={entry.name} onClose={onClose} footer={<div className="flex justify-end"><Button onClick={onClose}>Close</Button></div>}>
        <div className="space-y-3 text-sm">
          <p className="flex items-center gap-2 font-semibold text-emerald-700">
            <CheckCircle2 size={18} /> {result.linked ? 'Linked to the existing client' : 'Client chart created'}
          </p>
          <Link href={`/dashboard/clients/${result.clientId}`} className="inline-flex min-h-10 items-center gap-1 font-semibold text-blue-700 hover:underline">
            Open chart <ExternalLink size={14} />
          </Link>
          {result.appointmentId ? (
            <p className="flex flex-wrap items-center gap-2">
              <CheckCircle2 size={16} className="text-emerald-700" /> First visit booked{pick ? `: ${formatDateTime(pick.startsAt, tz)}` : ''}
              <Link href={`/dashboard/appointments?appt=${result.appointmentId}`} className="font-semibold text-blue-700 hover:underline">
                Open appointment
              </Link>
            </p>
          ) : null}
          {result.bookingError ? (
            <Alert tone="warning" title="The visit was not booked">
              {result.bookingError} The client is linked to this entry, which stays open as Ready to schedule. Pick another time.
            </Alert>
          ) : null}
          {result.intake ? (
            'token' in result.intake ? (
              <div className="rounded-lg border border-slate-200 p-3">
                <p className="font-semibold text-slate-800">Intake link created</p>
                <p className="mt-1 text-xs text-slate-500">Links are not emailed automatically yet. Copy it into your email to the client.</p>
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded bg-slate-100 px-2 py-1 text-xs">{intakeUrl}</code>
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Copy size={14} />}
                    onClick={() => {
                      if (intakeUrl) void navigator.clipboard?.writeText(intakeUrl).then(() => setCopied(true));
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>
            ) : (
              <Alert tone="warning" title="Intake not sent">{result.intake.error}</Alert>
            )
          ) : null}
          {result.eligibility ? (
            'status' in result.eligibility ? (
              <p>Eligibility check sent: {result.eligibility.status.toLowerCase()}. Results show under EHR, Eligibility.</p>
            ) : (
              <Alert tone="warning" title="Eligibility not checked">{result.eligibility.error}</Alert>
            )
          ) : null}
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'schedule' ? `Schedule ${entry.name}` : `Convert ${entry.name} to a client`}
      subtitle={mode === 'schedule' ? 'Creates the client, books the first visit and marks the entry, in one step.' : 'Creates (or links) the client chart only. No visit is booked.'}
      onClose={onClose}
      wide
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            {mode === 'schedule' ? (
              <Button variant="secondary" disabled={!preview || saving} onClick={() => confirm({ thenOpenScheduler: true })}>
                Pick a time in the scheduler
              </Button>
            ) : null}
            <Button disabled={!preview} loading={saving} onClick={() => confirm()}>
              {mode === 'convert'
                ? clientChoice && clientChoice !== 'new'
                  ? 'Link client'
                  : 'Create client'
                : clientChoice && clientChoice !== 'new'
                  ? 'Link client and book'
                  : 'Create client and book'}
            </Button>
          </div>
        </div>
      }
    >
      {entry.safetyScreen === 'yes' ? <CrisisGuidance className="mb-4" /> : null}
      {loadError ? <Alert tone="danger">{loadError}</Alert> : null}
      {!preview && !loadError ? <p className="text-sm text-slate-500">Checking for an existing chart and open times...</p> : null}

      {preview ? (
        <>
          <SectionTitle>1. Client</SectionTitle>
          {linkedAlready ? (
            <p className="text-sm text-slate-700">
              A client chart is already linked to this entry.{' '}
              <Link href={`/dashboard/clients/${preview.linkedClientId}`} className="font-semibold text-blue-700 hover:underline">
                Open chart
              </Link>
            </p>
          ) : duplicates.length ? (
            <div className="space-y-2">
              <Alert tone="warning" title="Possible existing client">
                Link instead of creating a duplicate chart, unless this is a different person.
              </Alert>
              {duplicates.map((d) => (
                <label key={d.clientId} className="flex min-h-10 cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-2 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                  <input type="radio" name="client" className="mt-1" checked={clientChoice === d.clientId} onChange={() => setClientChoice(d.clientId)} />
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-900">Link to {d.name}</span>
                    {d.mrn ? <span className="text-slate-500"> · MRN {d.mrn}</span> : null}
                    <span className="block text-xs text-slate-500">
                      {d.level === 'strong' ? 'Strong' : 'Possible'} match on {d.basis}
                      {d.status ? ` · ${d.status.toLowerCase()}` : ''}
                    </span>
                  </span>
                </label>
              ))}
              <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
                <input type="radio" name="client" checked={clientChoice === 'new'} onChange={() => setClientChoice('new')} />
                Different person: create a new chart
              </label>
            </div>
          ) : (
            <p className="text-sm text-slate-700">No existing client matches name + date of birth, phone or email. A new chart will be created with the waitlist details.</p>
          )}
          {!linkedAlready && clientChoice === 'new' && locations.length ? (
            <div className="mt-3 max-w-sm">
              <Field label="Home site for the chart">
                <select className={inputClasses} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Practice primary site</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                      {entry.preferredLocationIds.includes(l.id) ? ' (preferred)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          <SectionTitle>{mode === 'schedule' ? '2. Clinician and time' : '2. Assigned clinician (optional)'}</SectionTitle>
          {mode === 'schedule' ? (
            <div className="mb-3 grid gap-3 sm:grid-cols-2">
              <Field label="First visit type" hint={`Suggested for ${preview.service}`}>
                <select className={inputClasses} value={type} onChange={(e) => setType(e.target.value)}>
                  {APPOINTMENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-600">Visit</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsVirtual(false)} className={cx('inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-sm', !isVirtual ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 text-slate-700')}>
                    <Building2 size={15} /> In person
                  </button>
                  <button type="button" onClick={() => setIsVirtual(true)} className={cx('inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg border px-3 text-sm', isVirtual ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 text-slate-700')}>
                    <Video size={15} /> Telehealth
                  </button>
                </div>
                {entry.telehealthOk === false && isVirtual ? <p className="mt-1 text-xs text-amber-700">The person said in person only.</p> : null}
              </div>
            </div>
          ) : null}
          {preview.clinicians.length ? (
            <ul className="space-y-2">
              {preview.clinicians.map((c) => (
                <li key={c.clinicianId} className={cx('rounded-lg border p-3', pick?.clinicianId === c.clinicianId ? 'border-blue-600 bg-blue-50/40' : 'border-slate-200')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 font-semibold text-slate-900">
                      {c.name}
                      {c.credentials ? <span className="font-normal text-slate-500">, {c.credentials}</span> : null}
                      {c.preferred ? <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800">Requested</span> : null}
                    </span>
                    <span className="flex flex-wrap gap-1 text-[11px]">
                      <span className={cx('rounded-full px-2 py-0.5 font-medium', c.inNetwork === 'yes' ? 'bg-emerald-50 text-emerald-700' : c.inNetwork === 'no' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')}>{NETWORK_LABEL[c.inNetwork]}</span>
                      <span className={cx('rounded-full px-2 py-0.5 font-medium', c.location === 'yes' ? 'bg-emerald-50 text-emerald-700' : c.location === 'no' ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600')}>{LOCATION_LABEL[c.location]}</span>
                    </span>
                  </div>
                  {mode === 'schedule' ? (
                    c.slots.length ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {c.slots.map((s) => {
                          const on = pick?.clinicianId === c.clinicianId && pick.startsAt === s.startsAt;
                          return (
                            <button
                              key={s.startsAt}
                              type="button"
                              onClick={() => setPick({ clinicianId: c.clinicianId, startsAt: s.startsAt, endsAt: s.endsAt })}
                              className={cx('min-h-10 rounded-lg border px-3 text-sm', on ? 'border-blue-600 bg-blue-600 font-semibold text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400')}
                            >
                              {formatDateTime(s.startsAt, tz)}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">No open time in the next 3 weeks that fits the stated availability.</p>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPick(pick?.clinicianId === c.clinicianId ? null : { clinicianId: c.clinicianId, startsAt: '', endsAt: '' })}
                      className={cx('mt-2 min-h-10 rounded-lg border px-3 text-sm', pick?.clinicianId === c.clinicianId ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 text-slate-700')}
                    >
                      {pick?.clinicianId === c.clinicianId ? 'Assigned' : 'Assign'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No clinician matches this service, payer and site. Use the scheduler to pick anyone.</p>
          )}
          {mode === 'schedule' ? (
            <p className="mt-2 text-xs text-slate-500">
              Times are open on the practice calendar (practice hours, minus the clinician&apos;s booked visits). Clinician working hours are not set up in Altrixs, so confirm with the clinician when unsure. Gender and language preferences are shown on the entry, not matched.
            </p>
          ) : null}
          {pickedClinician && mode === 'schedule' && pick ? (
            <p className="mt-2 text-sm font-semibold text-slate-800">
              Selected: {pickedClinician.name}, {formatDateTime(pick.startsAt, tz)}, {isVirtual ? 'telehealth' : 'in person'}
            </p>
          ) : null}

          <SectionTitle>3. Also</SectionTitle>
          <div className="space-y-2">
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={sendIntake} disabled={!entry.email} onChange={(e) => setSendIntake(e.target.checked)} />
              Create the intake packet / portal link{!entry.email ? ' (needs an email on the entry)' : ''}
            </label>
            {mode === 'schedule' ? (
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" checked={runEligibility} disabled={!preview.eligibility || !entry.insurancePayer} onChange={(e) => setRunEligibility(e.target.checked)} />
                Run an insurance eligibility check
                {!preview.eligibility ? ' (eligibility is not configured or not available to your role)' : !entry.insurancePayer ? ' (no insurance on the entry)' : ''}
              </label>
            ) : null}
          </div>
        </>
      ) : null}
    </Drawer>
  );
}
