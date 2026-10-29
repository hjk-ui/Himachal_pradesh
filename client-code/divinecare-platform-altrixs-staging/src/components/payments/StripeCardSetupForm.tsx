'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import { loadStripeJs, type StripeElements, type StripeJs } from './stripeJs';

/**
 * Stripe Payment Element for a SetupIntent (card, usage off_session). Used by the patient portal and by
 * staff in the office with the patient present. On success it hands back the SetupIntent id; the server
 * then reads brand / last 4 / expiry from Stripe. No card data passes through Altrixs.
 */
export function StripeCardSetupForm({
  clientSecret,
  publishableKey,
  stripeAccount,
  testMode,
  submitLabel = 'Save card',
  onSaved,
  onCancel,
}: {
  clientSecret: string;
  publishableKey: string;
  stripeAccount?: string | null;
  testMode?: boolean;
  submitLabel?: string;
  onSaved: (setupIntentId: string) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const stripeRef = useRef<StripeJs | null>(null);
  const elementsRef = useRef<StripeElements | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let destroy: (() => void) | null = null;
    (async () => {
      try {
        const stripe = await loadStripeJs(publishableKey, stripeAccount);
        if (cancelled || !host.current) return;
        const elements = stripe.elements({ clientSecret, appearance: { theme: 'stripe' } });
        const el = elements.create('payment', { layout: 'tabs' });
        el.mount(host.current);
        destroy = () => el.destroy();
        stripeRef.current = stripe;
        elementsRef.current = elements;
        setReady(true);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the secure card form.');
      }
    })();
    return () => {
      cancelled = true;
      destroy?.();
    };
  }, [clientSecret, publishableKey, stripeAccount]);

  const submit = async () => {
    const stripe = stripeRef.current;
    const elements = elementsRef.current;
    if (!stripe || !elements) return;
    setBusy(true);
    setError('');
    try {
      const checked = await elements.submit();
      if (checked.error) throw new Error(checked.error.message || 'Check the card details.');
      const r = await stripe.confirmSetup({ elements, redirect: 'if_required', confirmParams: { return_url: window.location.href } });
      if (r.error) throw new Error(r.error.message || 'The card could not be saved.');
      if (!r.setupIntent || r.setupIntent.status !== 'succeeded') throw new Error('The card was not confirmed. Please try again.');
      await onSaved(r.setupIntent.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The card could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {testMode ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
          TEST MODE: use a Stripe test card (4242 4242 4242 4242). No real card is charged.
        </p>
      ) : null}
      <div ref={host} className="min-h-[120px] rounded-xl border border-slate-200 bg-white p-3" />
      {!ready && !error ? (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Loading the secure card form…
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <p className="flex items-center gap-1.5 text-xs text-slate-500">
        <Lock size={12} aria-hidden /> Card details go directly to our payment processor (Stripe). We only keep the card type, last four digits and expiration date.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
        ) : null}
        <button type="button" onClick={() => void submit()} disabled={!ready || busy} className="inline-flex items-center gap-1.5 rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-bold text-white hover:bg-[#4A2475] disabled:opacity-50">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null} {submitLabel}
        </button>
      </div>
    </div>
  );
}
