'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getSession } from 'next-auth/react';
import { Eye, EyeOff } from 'lucide-react';
import { signOut } from 'next-auth/react';
import {
  checkNeedsSetup,
  createFirstAdmin,
  loginWithEmailPassword,
  requestPasswordResetCode,
  setNewPassword as savePasswordAfterOtp,
  verifyPasswordResetCode,
} from '../api/authApi';
import { safeCallbackForRole } from '@/lib/auth/safeCallback';
import { validateStaffPassword } from '@/lib/security/passwordPolicy';
import { MfaChallenge } from '@/components/auth/MfaChallenge';

type Step = 'setup' | 'login' | 'mfa' | 'forgot-email' | 'forgot-code' | 'forgot-new-password';

const inputClass =
  'w-full min-h-12 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:text-[15px]';

const primaryBtnClass =
  'w-full min-h-12 rounded-lg bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-55 sm:text-[15px]';

export default function LoginForm() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetTicket, setResetTicket] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    checkNeedsSetup()
      .then((needs) => {
        if (needs) setStep('setup');
      })
      .catch((err: any) => {
        setError(err.message || 'Could not connect to the authentication service.');
      });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (!authError) return;

    // Stale JWT can cause /login ↔ /dashboard redirect loops — clear it first.
    if (authError === 'SessionExpired') {
      void signOut({ redirect: false });
    }

    setError(messageForAuthError(authError));
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    const passwordCheck = validateStaffPassword(password, { name, email });
    if (!passwordCheck.ok) {
      setError(passwordCheck.error);
      return;
    }
    setLoading(true);
    try {
      await createFirstAdmin({ name, email, password });
      setInfo('Admin created. Signing you in...');
      await loginWithEmailPassword(email, password);
      const session = await getSession();
      const callback = new URLSearchParams(window.location.search).get('callbackUrl');
      const role = (session?.user as { role?: string } | undefined)?.role;
      router.push(safeCallbackForRole(role, callback));
    } catch (err: any) {
      setError(err.message || 'Could not create admin');
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      await loginWithEmailPassword(email, password);
      if (await needsMfaChallenge()) {
        setStep('mfa');
        return;
      }
      await finishSignIn();
    } catch (err: any) {
      setError(err.message || 'Email or password is incorrect.');
    } finally {
      setLoading(false);
    }
  };

  /** Password step succeeded — does this sign-in still owe a second factor? */
  const needsMfaChallenge = async () => {
    try {
      const res = await fetch('/api/auth/mfa/verify', { credentials: 'same-origin' });
      const data = (await res.json()) as { challenge?: boolean };
      return Boolean(res.ok && data.challenge);
    } catch {
      return false;
    }
  };

  const finishSignIn = async () => {
    const session = await getSession();
    const callback = new URLSearchParams(window.location.search).get('callbackUrl');
    const role = (session?.user as { role?: string } | undefined)?.role;
    router.push(safeCallbackForRole(role, callback));
  };

  const cancelMfa = async () => {
    await signOut({ redirect: false });
    setPassword('');
    setError('');
    setStep('login');
  };

  const sendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await requestPasswordResetCode(email);
      setInfo(res.message + ' (Dev: check terminal for code if SMTP not set.)');
      setStep('forgot-code');
      setCode('');
    } catch (err: any) {
      setError(err.message || 'Could not send code');
    } finally {
      setLoading(false);
    }
  };

  const verifyResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await verifyPasswordResetCode(email, code);
      setResetTicket(res.ticket);
      setStep('forgot-new-password');
      setNewPassword('');
      setConfirmPassword('');
    } catch {
      setError('Invalid or expired code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const passwordCheck = validateStaffPassword(newPassword, { email });
    if (!passwordCheck.ok) {
      setError(passwordCheck.error);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await savePasswordAfterOtp(resetTicket, newPassword);
      setInfo('Password updated. You can sign in now.');
      setStep('login');
      setPassword('');
      setCode('');
      setResetTicket('');
    } catch (err: any) {
      setError(err.message || 'Could not update password');
    } finally {
      setLoading(false);
    }
  };

  const title =
    step === 'setup'
      ? 'Create admin account'
      : step === 'login' || step === 'mfa'
        ? 'Welcome back'
        : 'Reset password';
  const subtitle =
    step === 'setup'
      ? 'First-time setup - use your real work email.'
      : step === 'login' || step === 'mfa'
        ? 'Sign in to access your clinic workspace.'
        : step === 'forgot-email'
          ? 'Enter your work email to receive a reset code.'
          : step === 'forgot-code'
            ? `Enter the 6-digit code sent to ${email}`
            : 'Choose a new secure password.';

  return (
    <div
      className="flex min-h-[100svh] flex-col overflow-x-hidden bg-slate-50 lg:min-h-[100dvh] lg:flex-row"
      style={{ fontFamily: 'var(--font-clinic-sans)' }}
    >
      <aside className="relative flex shrink-0 flex-col items-center justify-center bg-[#141C34] px-4 pb-6 pt-[calc(env(safe-area-inset-top)+1.25rem)] text-center text-white sm:px-8 sm:py-8 lg:min-h-[100dvh] lg:w-[42%] lg:px-12">
        <WaveDivider />

        <p className="mb-3 text-sm font-medium tracking-wide text-white/90 sm:mb-5 sm:text-lg lg:text-xl">
          Welcome to
        </p>

        <div className="relative h-14 w-full max-w-[190px] sm:h-20 sm:max-w-[270px] lg:h-[104px] lg:max-w-[320px]">
          <Image
            src="/altrixs-logo.png"
            alt="Altrixs"
            fill
            priority
            className="object-contain brightness-0 invert"
            sizes="(max-width: 640px) 190px, (max-width: 1024px) 270px, 320px"
          />
        </div>

        <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-100/85 sm:mt-5 sm:text-[15px]">
          One workspace for doctors, clinicians, admins, and clinic staff.
        </p>

        <p className="mt-4 hidden text-[11px] text-slate-300/55 sm:block lg:absolute lg:bottom-6 lg:left-0 lg:right-0 lg:mt-0">
          &copy; {new Date().getFullYear()} Altrixs
        </p>
      </aside>

      <main className="flex flex-1 items-start justify-center bg-slate-50 px-4 py-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] sm:px-8 sm:py-8 lg:min-h-[100dvh] lg:w-[58%] lg:items-center lg:px-16 lg:py-10">
        <div className="w-full max-w-[440px] rounded-xl border border-slate-200 bg-white px-4 py-5 shadow-[0_20px_60px_rgba(20,28,52,0.10)] sm:px-8 sm:py-8">
          <div className="mb-6 sm:mb-7">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">
              Secure staff portal
            </p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-950 sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">{subtitle}</p>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-5 flex gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-5 text-rose-700"
            >
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-rose-400 text-[10px] font-bold">
                !
              </span>
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div
              role="status"
              className="mb-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm leading-5 text-blue-800"
            >
              {info}
            </div>
          )}

          {step === 'setup' && (
            <form onSubmit={handleSetup} className="space-y-5">
              <Field label="Full name">
                <input
                  type="text"
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                  placeholder="Your full name"
                />
              </Field>
              <Field label="Work email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@clinic.com"
                />
              </Field>
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 12 characters"
                />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Please wait...' : 'Create admin & continue'}
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5" autoComplete="on">
              <Field label="Work email">
                <input
                  type="email"
                  name="username"
                  required
                  autoComplete="username"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@clinic.com"
                />
              </Field>
              <Field label="Password">
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    name="current-password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-14`}
                    placeholder="Password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-1.5 top-1/2 flex min-h-10 min-w-10 -translate-y-1/2 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                    aria-label={showPw ? 'Hide password' : 'Show password'}
                    title={showPw ? 'Hide password' : 'Show password'}
                  >
                    {showPw ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
                  </button>
                </div>
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Signing in...' : 'Log in'}
              </button>
            </form>
          )}

          {step === 'mfa' && (
            <MfaChallenge onVerified={finishSignIn} onCancel={() => void cancelMfa()} />
          )}

          {step === 'forgot-email' && (
            <form onSubmit={sendResetCode} className="space-y-5">
              <Field label="Work email">
                <input
                  type="email"
                  required
                  autoComplete="email"
                  inputMode="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                  placeholder="you@clinic.com"
                />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Sending...' : 'Send reset code'}
              </button>
            </form>
          )}

          {step === 'forgot-code' && (
            <form onSubmit={verifyResetCode} className="space-y-5">
              <Field label="6-digit code">
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className={`${inputClass} text-center text-lg font-semibold tracking-[0.32em] sm:tracking-[0.4em]`}
                  placeholder="------"
                />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Verifying...' : 'Verify code'}
              </button>
            </form>
          )}

          {step === 'forgot-new-password' && (
            <form onSubmit={saveNewPassword} className="space-y-5">
              <Field label="New password">
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder="At least 12 characters"
                />
              </Field>
              <Field label="Confirm password">
                <input
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Repeat new password"
                />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>
          )}

          {step !== 'setup' && step !== 'mfa' && (
            <div className="mt-6 text-center">
              {step === 'login' ? (
                <button
                  type="button"
                  onClick={() => {
                    setStep('forgot-email');
                    setError('');
                    setInfo('');
                    setCode('');
                  }}
                  className="min-h-11 text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                >
                  Forgot password?
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setStep('login');
                    setError('');
                    setInfo('');
                    setCode('');
                  }}
                  className="min-h-11 text-sm font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  Back to sign in
                </button>
              )}
            </div>
          )}

          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-xs text-slate-400 sm:mt-7">
            Do not share your login credentials with anyone.
          </p>
        </div>
      </main>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-slate-700">{label}</span>
      {children}
    </label>
  );
}

function messageForAuthError(error: string) {
  if (error === 'Configuration') {
    return 'We could not connect to the authentication service. Please try again in a moment.';
  }

  if (error === 'CredentialsSignin') {
    return 'Email or password is incorrect.';
  }

  if (error === 'SessionExpired') {
    return 'Your session ended. Please sign in again.';
  }

  return 'We could not sign you in. Please check your details and try again.';
}

function WaveDivider() {
  return (
    <svg
      className="pointer-events-none absolute inset-y-0 right-0 hidden h-full w-12 translate-x-full text-[#141C34] lg:block"
      viewBox="0 0 48 100"
      preserveAspectRatio="none"
      aria-hidden
    >
      <path
        d="M0 0 C28 8 28 20 0 28 C28 38 28 48 0 58 C28 68 28 80 0 88 C20 94 20 97 0 100 L0 100 L0 0 Z"
        fill="currentColor"
      />
    </svg>
  );
}
