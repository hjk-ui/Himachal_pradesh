import { signIn, signOut } from 'next-auth/react';

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'Request failed');
  }
  return data as T;
}

export async function requestLoginCode(email: string) {
  return postJson<{ success: true; message: string }>('/api/auth/otp/request', {
    email: email.trim().toLowerCase(),
    purpose: 'LOGIN',
  });
}

/** Result of a sign-in step: 'done' = call finishStaffSignIn(ticket); 'mfa' / 'enroll' = two-factor next. */
export type SignInStep = {
  next: 'mfa' | 'enroll' | 'done';
  ticket: string;
  recoveryCodes?: string[];
  remainingRecoveryCodes?: number;
};

/** Step 1: email + password. Errors are generic ("incorrect") or "Too many attempts. Try again in N minutes." */
export async function startStaffSignIn(email: string, password: string) {
  return postJson<SignInStep>('/api/auth/staff/start', { email: email.trim().toLowerCase(), password });
}

/** Step 1 (alternative): email + one-time code. */
export async function startStaffSignInWithCode(email: string, code: string) {
  return postJson<SignInStep>('/api/auth/staff/start', { email: email.trim().toLowerCase(), otp: code.trim() });
}

/** Step 2: authenticator code or recovery code. */
export async function verifyMfaCode(ticket: string, code: string, rememberDevice: boolean) {
  return postJson<SignInStep>('/api/auth/staff/mfa', { ticket, code: code.trim(), rememberDevice });
}

/** Two-factor setup: QR code (data URL rendered by the server) + manual key. */
export async function beginMfaEnrollment(ticket: string) {
  return postJson<{ qr: string; manualKey: string; account: string; otpauthUri: string }>('/api/auth/staff/enroll', { ticket });
}

/** Two-factor setup: confirm the first code -> 10 recovery codes (shown once). */
export async function confirmMfaEnrollment(ticket: string, code: string, rememberDevice: boolean) {
  return postJson<SignInStep>('/api/auth/staff/enroll/confirm', { ticket, code: code.trim(), rememberDevice });
}

/** Final step: exchange the single-use ticket for the NextAuth session. */
export async function finishStaffSignIn(ticket: string) {
  const result = await signIn('credentials', { mode: 'ticket', ticket, redirect: false });
  if (!result) {
    throw Object.assign(new Error('Unable to start login. Try again.'), { code: 'auth/no-response' });
  }
  if (result.error) {
    throw Object.assign(
      new Error(
        result.error === 'Configuration'
          ? 'We could not connect to the authentication service. Please try again in a moment.'
          : 'Your sign-in expired. Start again.'
      ),
      { code: `auth/${result.error}` }
    );
  }
  return { mode: 'live' as const };
}

export class MfaStepRequiredError extends Error {
  constructor(readonly step: SignInStep) {
    super('Two-factor sign-in is required.');
    this.name = 'MfaStepRequiredError';
  }
}

/** Email + code sign-in in one call when no two-factor step is needed; otherwise throws MfaStepRequiredError. */
export async function loginWithEmailCode(email: string, code: string) {
  const step = await startStaffSignInWithCode(email, code);
  if (step.next !== 'done') throw new MfaStepRequiredError(step);
  return finishStaffSignIn(step.ticket);
}

/** Email + password sign-in in one call when no two-factor step is needed; otherwise throws MfaStepRequiredError. */
export async function loginWithEmailPassword(email: string, password: string) {
  const step = await startStaffSignIn(email, password);
  if (step.next !== 'done') throw new MfaStepRequiredError(step);
  return finishStaffSignIn(step.ticket);
}

export async function requestPasswordResetCode(email: string) {
  return postJson<{ success: true; message: string }>('/api/auth/otp/request', {
    email: email.trim().toLowerCase(),
    purpose: 'RESET_PASSWORD',
  });
}

export async function verifyPasswordResetCode(email: string, code: string) {
  return postJson<{ success: true; ticket: string }>('/api/auth/otp/verify-reset', {
    email: email.trim().toLowerCase(),
    code: code.trim(),
  });
}

export async function setNewPassword(ticket: string, newPassword: string) {
  return postJson<{ success: true; message: string }>('/api/auth/password/reset', {
    ticket,
    newPassword,
  });
}

export async function checkNeedsSetup() {
  const res = await fetch('/api/auth/setup');
  const data = await res.json();
  if (!res.ok || data.success === false) {
    throw new Error(data.error || 'Could not check setup status');
  }
  return Boolean(data.needsSetup);
}

export async function createFirstAdmin(input: {
  name: string;
  email: string;
  password: string;
}) {
  return postJson<{ success: true; message: string }>('/api/auth/setup', input);
}

export async function logout() {
  await signOut({ redirect: false });
}
