'use client';

/**
 * Patient portal: payments. The patient (or a guardian acting for them) saves or replaces a card with the
 * secure Stripe form, sees whether automatic payments are on and what the signed Card-on-File
 * Authorization covers, sees charges and receipts, confirms a payment their card issuer flagged, and turns
 * automatic payments off (revokes the authorization through the consent library).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { StripeCardSetupForm } from '@/components/payments/StripeCardSetupForm';
import { loadStripeJs } from '@/components/payments/stripeJs';
// Portal proxy access: "Viewing: …" switcher + guardian banner (the API scopes by the active person)
import { PortalPersonSwitcher } from '@/features/patient/PortalPersonSwitcher';
import { PORTAL_ACTIONS, PORTAL_BUTTON, PORTAL_MAIN } from '@/features/patient/portalLayout';
import { ArrowLeft, CreditCard, Receipt, Trash2 } from 'lucide-react';
import { Alert, Button, buttonClasses, cx, EmptyState, FOCUS_RING, LoadingState, PageHeader, StatusBadge } from '@/components/ui';

type Charge = {
  id: string;
  kind: string;
  amountCents: number;
  refundedCents: number;
  status: string;
  statusLabel: string;
  needsAction: boolean;
  receiptNumber: string | null;
  card: string | null;
  date: string;
};
type Summary = {
  available: boolean;
  authorizationTemplateReady: boolean;
  testMode: boolean;
  card: { brand: string | null; last4: string | null; expiry: string | null } | null;
  autopayOn: boolean;
  authorization: { signedAt: string | null; covers: string[] } | null;
  authorizationToSign: boolean;
  charges: Charge[];
};
type Setup = { clientSecret: string; publishableKey: string; stripeAccount: string | null; testMode: boolean };

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString([], { dateStyle: 'medium' });
const brand = (b: string | null) => (b ? b.charAt(0).toUpperCase() + b.slice(1) : 'Card');

export default function PatientBillingPage() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [setup, setSetup] = useState<Setup | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Charge | null>(null);

  const call = useCallback(
    async <T,>(init?: RequestInit): Promise<T | null> => {
      const token = getPatientToken();
      if (!token) {
        router.replace('/patient/login');
        return null;
      }
      const res = await fetch('/api/patient/payments', { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      if (res.status === 401) {
        clearPatientToken();
        router.replace('/patient/login');
        return null;
      }
      return readPatientApi<T>(res);
    },
    [router]
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const d = await call<Summary>();
      if (d) setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your payments.');
    }
  }, [call]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async <T,>(body: Record<string, unknown>) => call<T>({ method: 'POST', body: JSON.stringify(body) });

  const startSetup = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const s = await post<Setup>({ action: 'setup_start' });
      if (s) setSetup(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the card form.');
    } finally {
      setBusy(false);
    }
  };

  const saved = async (setupIntentId: string) => {
    const r = await post<{ card: { brand: string | null; last4: string | null }; authorizationSent: boolean }>({ action: 'setup_complete', setupIntentId });
    setSetup(null);
    if (r) {
      setNotice(
        r.authorizationSent
          ? `${brand(r.card.brand)} ending ${r.card.last4} is saved. To turn on automatic payments, sign the Card-on-File Authorization in Documents and choose what it may be used for.`
          : `${brand(r.card.brand)} ending ${r.card.last4} is saved. The office will send you the Card-on-File Authorization to sign.`
      );
    }
    await load();
  };

  const confirmPayment = async (c: Charge) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await post<{ clientSecret: string; paymentMethodId: string | null; publishableKey: string; stripeAccount: string | null }>({ action: 'confirm', chargeId: c.id });
      if (!r) return;
      const stripe = await loadStripeJs(r.publishableKey, r.stripeAccount);
      const res = await stripe.confirmCardPayment(r.clientSecret, r.paymentMethodId ? { payment_method: r.paymentMethodId } : undefined);
      if (res.error) throw new Error(res.error.message || 'The payment was not confirmed.');
      setNotice('Thank you. Your payment was confirmed; it shows as paid once the payment processor finishes.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The payment was not confirmed.');
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async (removeCard: boolean) => {
    const q = removeCard
      ? 'Remove your saved card and turn off automatic payments? Payments already made are not affected.'
      : 'Turn off automatic payments? This revokes your Card-on-File Authorization. Payments already made are not affected.';
    if (!window.confirm(q)) return;
    setBusy(true);
    setError('');
    try {
      await post({ action: 'turn_off', removeCard, confirm: true });
      setNotice(removeCard ? 'Your card was removed and automatic payments are off.' : 'Automatic payments are off.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not turn off automatic payments.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={PORTAL_MAIN}>
      <PageHeader
        eyebrow="Altrixs"
        title="Payments"
        description="Your saved card, automatic payments and receipts."
        actions={
          <Link href="/patient/home" className={buttonClasses({ variant: 'ghost', size: 'lg', className: 'h-11 self-start' })}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to your account
          </Link>
        }
      />
      <PortalPersonSwitcher />
      {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}
      {notice ? <Alert tone="success" className="mt-4">{notice}</Alert> : null}
      {data === null && !error ? <LoadingState label="Loading your payments…" className="mt-6" /> : null}

      {data ? (
        <>
          {data.charges.some((c) => c.needsAction) ? (
            <Alert tone="warning" className="mt-4">Your card issuer asked you to confirm a payment. Use &quot;Confirm payment&quot; below.</Alert>
          ) : null}
          {data.authorizationToSign ? (
            <Alert tone="brand" className="mt-4">
              A Card-on-File Authorization is waiting for your signature.{' '}
              <Link href="/patient/documents" className={cx('rounded font-semibold underline', FOCUS_RING)}>Open Documents</Link>
            </Alert>
          ) : null}

          <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-xs" aria-labelledby="card-h">
            <h2 id="card-h" className="text-base font-semibold text-slate-900">Saved card</h2>
            {data.card ? (
              <p className="mt-1 text-base text-slate-700">{brand(data.card.brand)} ending {data.card.last4} · expires {data.card.expiry}</p>
            ) : (
              <p className="mt-1 text-base text-slate-500">No card saved.</p>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-2 text-base text-slate-700">
              Automatic payments: <StatusBadge tone={data.autopayOn ? 'success' : 'neutral'}>{data.autopayOn ? 'On' : 'Off'}</StatusBadge>
            </p>
            {data.authorization ? (
              <div className="mt-2 text-sm text-slate-500">
                Your authorization{data.authorization.signedAt ? ` (signed ${day(data.authorization.signedAt)})` : ''} covers: {data.authorization.covers.join('; ') || 'nothing selected'}.
              </div>
            ) : null}
            {setup ? (
              <div className="mt-4">
                <StripeCardSetupForm clientSecret={setup.clientSecret} publishableKey={setup.publishableKey} stripeAccount={setup.stripeAccount} testMode={setup.testMode} onSaved={saved} onCancel={() => setSetup(null)} />
              </div>
            ) : data.available && data.authorizationTemplateReady ? (
              <div className={cx('mt-4', PORTAL_ACTIONS)}>
                <Button size="lg" className={PORTAL_BUTTON} disabled={busy} icon={<CreditCard />} onClick={() => void startSetup()}>
                  {data.card ? 'Replace card' : 'Save a card'}
                </Button>
                {data.autopayOn ? (
                  <Button variant="secondary" size="lg" className={PORTAL_BUTTON} disabled={busy} onClick={() => void turnOff(false)}>
                    Turn off automatic payments
                  </Button>
                ) : null}
                {data.card ? (
                  <Button variant="secondary" size="lg" className="min-h-11 w-full border-rose-200 text-rose-700 sm:w-auto hover:bg-rose-50 hover:text-rose-800" disabled={busy} icon={<Trash2 />} onClick={() => void turnOff(true)}>
                    Remove card
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-base text-slate-500">
                Automatic card payments are not available online yet. Contact the billing office for payment options.
              </p>
            )}
            {!setup && !(data.available && data.authorizationTemplateReady) && data.autopayOn ? (
              <Button variant="secondary" size="lg" className={cx('mt-3', PORTAL_BUTTON)} disabled={busy} onClick={() => void turnOff(false)}>
                Turn off automatic payments
              </Button>
            ) : null}
          </section>

          <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-xs" aria-labelledby="charges-h">
            <h2 id="charges-h" className="border-b border-slate-200 px-5 py-4 text-base font-semibold text-slate-900">Payments and receipts</h2>
            {data.charges.length === 0 ? (
              <EmptyState
                compact
                icon={<Receipt />}
                title="No payments yet."
                description="When a payment is made, it will show here with a receipt you can open."
              />
            ) : null}
            <ul className="divide-y divide-slate-100 px-5">
              {data.charges.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-base">
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-semibold text-slate-900">{c.kind} · <span className="tabular-nums">{money(c.amountCents)}</span></span>
                    <span className="block text-sm text-slate-500">
                      {day(c.date)} · {c.statusLabel}
                      {c.refundedCents ? ` · ${money(c.refundedCents)} refunded` : ''}
                      {c.card ? ` · ${c.card}` : ''}
                    </span>
                  </span>
                  <span className={cx('w-full sm:w-auto', PORTAL_ACTIONS)}>
                    {c.needsAction ? (
                      <Button size="lg" className={PORTAL_BUTTON} disabled={busy} onClick={() => void confirmPayment(c)}>
                        Confirm payment
                      </Button>
                    ) : null}
                    {c.receiptNumber ? (
                      <Button
                        variant="secondary"
                        size="lg"
                        className={PORTAL_BUTTON}
                        icon={<Receipt />}
                        aria-expanded={receipt?.id === c.id}
                        onClick={() => setReceipt(receipt?.id === c.id ? null : c)}
                      >
                        Receipt
                      </Button>
                    ) : null}
                  </span>
                  {receipt?.id === c.id ? (
                    <div className="w-full rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                      <p className="font-semibold text-slate-900">Payment receipt</p>
                      <p className="break-all">Receipt number: {c.receiptNumber}</p>
                      <p>Date: {day(c.date)}</p>
                      <p>Amount: {money(c.amountCents)}{c.refundedCents ? ` (refunded ${money(c.refundedCents)})` : ''}</p>
                      <p>Paid with: {c.card ?? 'Card on file'}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          {data.testMode ? <Alert tone="warning" className="mt-4">Payments are in TEST MODE: no real card is charged.</Alert> : null}
        </>
      ) : null}
    </main>
  );
}
