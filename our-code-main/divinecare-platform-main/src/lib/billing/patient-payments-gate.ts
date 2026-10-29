import { stripeConfigured, stripeKeyMode } from '@/lib/stripe/config';

/**
 * Patient Autopay / patient-side charges — live Stripe keys refused unless approved.
 * Staging: test keys + PATIENT_PAYMENTS_LIVE_APPROVED unset/false.
 */
export function patientPaymentsLiveApproved(): boolean {
  return process.env.PATIENT_PAYMENTS_LIVE_APPROVED?.trim().toLowerCase() === 'true';
}

export function assertPatientPaymentsAllowed():
  | { ok: true; mode: 'test' | 'live' | 'stub' | 'unconfigured' }
  | { ok: false; error: string; status: 403 } {
  const mode = stripeKeyMode();
  if (mode === 'live' && !patientPaymentsLiveApproved()) {
    return {
      ok: false,
      status: 403,
      error:
        'Live Stripe keys are refused for patient payments until PATIENT_PAYMENTS_LIVE_APPROVED=true.',
    };
  }
  if (mode === 'live') return { ok: true, mode: 'live' };
  if (mode === 'test') return { ok: true, mode: 'test' };
  if (!stripeConfigured()) return { ok: true, mode: 'stub' };
  return { ok: true, mode: 'unconfigured' };
}

export function patientPaymentsModeLabel(): string {
  const gate = assertPatientPaymentsAllowed();
  if (!gate.ok) return 'blocked (live keys without approval)';
  if (gate.mode === 'test') return 'test mode';
  if (gate.mode === 'live') return 'live (approved)';
  if (gate.mode === 'stub') return 'stub / no Stripe';
  return 'unknown';
}
