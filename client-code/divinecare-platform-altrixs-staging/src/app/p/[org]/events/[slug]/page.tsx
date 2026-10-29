'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarDays, CheckCircle2, MapPin } from 'lucide-react';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { FormField } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';
import { INPUT, cx } from '@/components/ui/tokens';
import { PORTAL_CHECK, PORTAL_FIELD } from '@/features/patient/portalLayout';

/** Public form field: 16px text + 44px tall on phones. */
const FIELD = cx(INPUT, PORTAL_FIELD);

type PublicEvent = { practiceName: string; title: string; eventType: string; startsAt: string; endsAt: string; locationName: string; description: string; closed: boolean; smsConsentText: string; renderedAt: number };

/** Public community event registration. No tracking scripts. Consent boxes start unchecked. */
export default function PublicEventPage() {
  const params = useParams<{ org: string; slug: string }>();
  const [ev, setEv] = useState<PublicEvent | null>(null);
  const [missing, setMissing] = useState(false);
  const [f, setF] = useState({ name: '', email: '', phone: '', emailConsent: false, smsConsent: false, website: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/marketing/public/events/${params.org}/${params.slug}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.success ? setEv(d.event) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [params.org, params.slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ev) return;
    setBusy(true);
    setErrors({});
    try {
      const r = await fetch(`/api/marketing/public/events/${params.org}/${params.slug}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f, renderedAt: ev.renderedAt }) });
      const d = await r.json();
      if (d.success) setDone(d.message);
      else setErrors({ ...(d.errors ?? {}), _: d.error ?? '' });
    } catch {
      setErrors({ _: 'Registration failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  };
  const when = ev ? `${new Date(ev.startsAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}` : '';

  return (
    <main className="min-h-[100dvh] bg-slate-50 px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-xl space-y-4">
        {missing ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 text-sm text-slate-700">Registration for this event is not open.</div>
        ) : !ev ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs">
              <p className="text-sm font-medium text-blue-700">{ev.practiceName} · {ev.eventType}</p>
              <h1 className="break-words text-xl font-semibold text-slate-900">{ev.title}</h1>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-700"><CalendarDays className="h-4 w-4 shrink-0" aria-hidden /> {when}</p>
              <p className="mt-1 flex items-start gap-2 text-sm text-slate-700"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> <span className="min-w-0 break-words">{ev.locationName}</span></p>
              {ev.description ? <p className="mt-3 whitespace-pre-wrap break-words text-sm text-slate-700">{ev.description}</p> : null}
            </div>
            {done ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6" role="status"><CheckCircle2 className="h-7 w-7 text-emerald-600" aria-hidden /><p className="mt-2 text-sm text-slate-800">{done}</p></div>
            ) : ev.closed ? (
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 text-sm text-slate-700">This event has ended.</div>
            ) : (
              <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs" noValidate>
                <h2 className="text-base font-semibold text-slate-900">Register</h2>
                {errors._ ? <p className="text-sm text-rose-700" role="alert">{errors._}</p> : null}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label>Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
                </div>
                <FormField label="Name" required error={errors.name}><input className={FIELD} autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
                <FormField label="Email" error={errors.email}><input className={FIELD} type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
                <FormField label="Mobile phone" error={errors.phone}><input className={FIELD} type="tel" autoComplete="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
                <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className={PORTAL_CHECK} checked={f.emailConsent} onChange={(e) => setF({ ...f, emailConsent: e.target.checked })} /><span>Email me event reminders and future community events from {ev.practiceName}. Unsubscribe anytime. (optional)</span></label>
                <label className="flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" className={PORTAL_CHECK} checked={f.smsConsent} onChange={(e) => setF({ ...f, smsConsent: e.target.checked })} /><span>{ev.smsConsentText} (optional)</span></label>
                <Button type="submit" size="lg" loading={busy} className="min-h-11 w-full">Register</Button>
                <CrisisFooter />
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}
