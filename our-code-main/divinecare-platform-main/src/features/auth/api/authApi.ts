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

export async function loginWithEmailCode(email: string, code: string) {
  const result = await signIn('credentials', {
    email: email.trim().toLowerCase(),
    otp: code.trim(),
    mode: 'otp',
    redirect: false,
  });

  if (!result || result.error) {
    throw Object.assign(new Error('Invalid or expired code'), {
      code: 'auth/invalid-otp',
    });
  }

  return { mode: 'live' as const };
}

/** Password login (seed / invited staff after accept) */
export async function loginWithEmailPassword(email: string, password: string) {
  const result = await signIn('credentials', {
    email: email.trim().toLowerCase(),
    password,
    mode: 'password',
    redirect: false,
  });

  if (!result) {
    throw Object.assign(new Error('Unable to start login. Try again.'), {
      code: 'auth/no-response',
    });
  }

  if (result.error) {
    const isConfigurationError = result.error === 'Configuration';
    throw Object.assign(
      new Error(
        isConfigurationError
          ? 'We could not connect to the authentication service. Please try again in a moment.'
          : 'Email or password is incorrect.'
      ),
      { code: `auth/${result.error}` }
    );
  }

  return { mode: 'live' as const };
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
