'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { StripeCardSetupForm } from '@/components/payments/StripeCardSetupForm';

type Start = { success: boolean; clientSecret: string; publishableKey: string; stripeAccount: string | null; mode: 'test' | 'live' };
type Done = { success: boolean; card: { brand: string | null; last4: string | null; expiry: string | null }; packetId: string | null; signUrl: string | null; authorizationError: string | null };

/**
 * In-office card capture with the patient present (staff-initiated SetupIntent). After the card is saved,
 * the client signs the Card-on-File Authorization (prefilled with the card) on the in-office signing page.
 */
export function CardSetupDialog({ clientId, clientName, onClose, onSaved }: { clientId: string; clientName: string; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState<Start | null>(null);
  const [error, setError] = useState<{ message: string; code: string | null } | null>(null);
  const [done, setDone] = useState<Done | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<Start>('/api/billing/autopay/card-setup', { method: 'POST', body: JSON.stringify({ action: 'start', clientId }) })
      .then((r) => !cancelled && setStart(r))
      .catch((e: Error & { data?: { code?: string } }) => !cancelled && setError({ message: e.message, code: e.data?.code ?? null }));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const complete = async (setupIntentId: string) => {
    const r = await apiJson<Done>('/api/billing/autopay/card-setup', { method: 'POST', body: JSON.stringify({ action: 'complete', clientId, setupIntentId }) });
    setDone(r);
    onSaved();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="card-setup-title">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="card-setup-title" className="text-lg font-semibold text-slate-900">Save a card for {clientName}</h2>
            <p className="mt-0.5 text-sm text-slate-500">With the client present. The client types the card in the secure Stripe form.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-slate-500 hover:bg-slate-100" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="mt-4">
          {done ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
                <CheckCircle2 size={16} aria-hidden /> {done.card.brand ?? 'Card'} ending {done.card.last4} saved (exp {done.card.expiry}).
              </p>
              {done.signUrl ? (
                <p className="text-sm text-slate-700">
                  Nothing is charged until the client signs the Card-on-File Authorization and picks what it covers.{' '}
                  <Link href={done.signUrl} className="font-semibold text-blue-700 hover:underline">
                    Open the authorization to sign now
                  </Link>
                  .
                </p>
              ) : (
                <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  The card is saved but the authorization could not be sent{done.authorizationError ? `: ${done.authorizationError}` : '.'} Send the Card-on-File Authorization from the client&apos;s Consents page.
                </p>
              )}
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                  Done
                </button>
              </div>
            </div>
          ) : error ? (
            <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              <p>{error.message}</p>
              {error.code === 'authorization_not_approved' ? (
                <Link href="/dashboard/ehr/consents/library" className="font-semibold text-blue-700 hover:underline">
                  Open the consent library
                </Link>
              ) : null}
            </div>
          ) : start ? (
            <StripeCardSetupForm
              clientSecret={start.clientSecret}
              publishableKey={start.publishableKey}
              stripeAccount={start.stripeAccount}
              testMode={start.mode === 'test'}
              onSaved={complete}
              onCancel={onClose}
            />
          ) : (
            <p role="status" className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={14} className="animate-spin" aria-hidden /> Starting a secure card setup…
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
