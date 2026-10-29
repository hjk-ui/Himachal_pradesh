'use client';

/**
 * Stripe.js loader for patient card capture (PCI SAQ A): the script is loaded from js.stripe.com, as
 * Stripe requires, and the card fields are Stripe-hosted iframes. Card numbers never touch Altrixs.
 */

export type StripeElement = { mount: (el: HTMLElement) => void; destroy: () => void; on?: (event: string, cb: (e: { complete?: boolean; error?: { message?: string } }) => void) => void };
export type StripeElements = { create: (type: 'payment', opts?: Record<string, unknown>) => StripeElement; submit: () => Promise<{ error?: { message?: string } }> };
export type StripeJs = {
  elements: (opts: Record<string, unknown>) => StripeElements;
  confirmSetup: (opts: { elements: StripeElements; redirect: 'if_required'; confirmParams?: Record<string, unknown> }) => Promise<{ error?: { message?: string }; setupIntent?: { id: string; status: string } }>;
  confirmCardPayment: (clientSecret: string, data?: Record<string, unknown>) => Promise<{ error?: { message?: string }; paymentIntent?: { id: string; status: string } }>;
};

declare global {
  interface Window {
    Stripe?: (key: string, opts?: Record<string, unknown>) => StripeJs;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Stripe.js runs in the browser only'));
  if (window.Stripe) return Promise.resolve();
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.stripe.com/v3/';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        loading = null;
        reject(new Error('Could not load the secure card form. Check your connection and try again.'));
      };
      document.head.appendChild(s);
    });
  }
  return loading;
}

export async function loadStripeJs(publishableKey: string, stripeAccount?: string | null): Promise<StripeJs> {
  await loadScript();
  if (!window.Stripe) throw new Error('Could not load the secure card form.');
  return window.Stripe(publishableKey, stripeAccount ? { stripeAccount } : undefined);
}
