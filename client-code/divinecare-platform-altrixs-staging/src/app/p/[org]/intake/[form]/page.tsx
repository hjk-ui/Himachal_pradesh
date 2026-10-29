'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { FormField } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';
import { INPUT, cx } from '@/components/ui/tokens';
import { PORTAL_CHECK, PORTAL_FIELD } from '@/features/patient/portalLayout';

/** Public form field: 16px text + 44px tall on phones. */
const FIELD = cx(INPUT, PORTAL_FIELD);

type Field = { key: string; label: string; type: string; required: boolean; help?: string; options?: string[] };
type PublicForm = {
  practiceName: string;
  practicePhone: string | null;
  formName: string;
  fields: Field[];
  serviceOptions: string[];
  locationOptions: string[];
  howHeardOptions: string[];
  contactConsentText: string;
  smsConsentText: string;
  notice: string;
  renderedAt: number;
};

/**
 * Hosted public intake request form. No analytics, pixels or third-party scripts. Answers are
 * POSTed in the request body only (never the URL). The SMS consent box starts unchecked.
 */
export default function PublicIntakeFormPage() {
  const params = useParams<{ org: string; form: string }>();
  const [embed, setEmbed] = useState(false);
  useEffect(() => {
    setEmbed(new URLSearchParams(window.location.search).get('embed') === '1');
  }, []);
  const [form, setForm] = useState<PublicForm | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [values, setValues] = useState<Record<string, string | boolean>>({ contactConsent: false, smsConsent: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [topError, setTopError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/marketing/public/forms/${params.org}/${params.form}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => (d.success ? setForm(d.form) : setNotFound(true)))
      .catch(() => setNotFound(true));
  }, [params.org, params.form]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    setErrors({});
    setTopError(null);
    try {
      const res = await fetch(`/api/marketing/public/forms/${params.org}/${params.form}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, renderedAt: form.renderedAt }),
      });
      const d = await res.json();
      if (d.success) setDone(d.message);
      else {
        setErrors(d.errors ?? {});
        setTopError(d.error ?? 'Please check the highlighted fields.');
      }
    } catch {
      setTopError('We could not send your request. Please call our office.');
    } finally {
      setBusy(false);
    }
  };

  const set = (k: string, v: string | boolean) => setValues((x) => ({ ...x, [k]: v }));
  const options = (f: Field) => (f.key === 'serviceInterest' ? form!.serviceOptions : f.key === 'location' ? form!.locationOptions : f.key === 'howHeard' ? form!.howHeardOptions : f.options ?? []);

  return (
    <main className={embed ? 'bg-white p-4' : 'min-h-[100dvh] bg-slate-50 px-4 py-6 sm:py-8'}>
      <div className={embed ? '' : 'mx-auto max-w-xl'}>
        {notFound ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 text-sm text-slate-700">This form is not available. Please call the practice directly.</div>
        ) : !form ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : done ? (
          <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs" role="status">
            <CheckCircle2 className="h-8 w-8 text-emerald-600" aria-hidden />
            <h1 className="mt-2 text-xl font-semibold text-slate-900">Request received</h1>
            <p className="mt-1 text-sm text-slate-700">{done}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-6 shadow-xs" noValidate>
            <div>
              <p className="text-sm font-medium text-blue-700">{form.practiceName}</p>
              <h1 className="break-words text-xl font-semibold text-slate-900">{form.formName}</h1>
            </div>
            <p className="flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {form.notice}
            </p>
            {topError ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700 ring-1 ring-rose-200" role="alert">{topError}</p> : null}
            {/* Honeypot: hidden from people and screen readers */}
            <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
              <label>
                Website
                <input tabIndex={-1} autoComplete="off" value={String(values.website ?? '')} onChange={(e) => set('website', e.target.value)} />
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {form.fields
                .filter((f) => f.type !== 'checkbox')
                .map((f) => (
                  <FormField key={f.key} label={f.label} required={f.required} hint={f.help} error={errors[f.key]} className={f.key === 'email' || f.key === 'insurance' || f.key === 'howHeard' ? 'sm:col-span-2' : ''}>
                    {f.type === 'select' ? (
                      <select className={FIELD} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>
                        <option value="">Choose…</option>
                        {options(f).map((o) => <option key={o}>{o}</option>)}
                      </select>
                    ) : (
                      <input
                        className={FIELD}
                        type={f.type === 'email' ? 'email' : f.type === 'phone' ? 'tel' : f.type === 'date' ? 'date' : 'text'}
                        autoComplete={f.key === 'firstName' ? 'given-name' : f.key === 'lastName' ? 'family-name' : f.key === 'email' ? 'email' : f.key === 'phone' ? 'tel' : f.key === 'dateOfBirth' ? 'bday' : 'off'}
                        value={String(values[f.key] ?? '')}
                        onChange={(e) => set(f.key, e.target.value)}
                      />
                    )}
                  </FormField>
                ))}
            </div>
            <fieldset className="space-y-3">
              <legend className="sr-only">Consent</legend>
              <label className="flex items-start gap-2 text-sm text-slate-700">
                <input type="checkbox" className={PORTAL_CHECK} checked={Boolean(values.contactConsent)} onChange={(e) => set('contactConsent', e.target.checked)} aria-invalid={errors.contactConsent ? true : undefined} />
                <span>{form.contactConsentText} <span className="text-rose-700">*</span></span>
              </label>
              {errors.contactConsent ? <p className="text-xs text-rose-700">{errors.contactConsent}</p> : null}
              {form.fields.some((f) => f.key === 'smsConsent') ? (
                <label className="flex items-start gap-2 text-sm text-slate-700">
                  <input type="checkbox" className={PORTAL_CHECK} checked={Boolean(values.smsConsent)} onChange={(e) => set('smsConsent', e.target.checked)} />
                  <span>{form.smsConsentText} (optional)</span>
                </label>
              ) : null}
              {errors.smsConsent ? <p className="text-xs text-rose-700">{errors.smsConsent}</p> : null}
            </fieldset>
            <Button type="submit" size="lg" loading={busy} className="min-h-11 w-full">Send request</Button>
            <p className="text-xs text-slate-500">Your information is kept private by {form.practiceName} and used only to respond to this request.{form.practicePhone ? ` Questions? Call ${form.practicePhone}.` : ''}</p>
            <CrisisFooter />
          </form>
        )}
      </div>
    </main>
  );
}
