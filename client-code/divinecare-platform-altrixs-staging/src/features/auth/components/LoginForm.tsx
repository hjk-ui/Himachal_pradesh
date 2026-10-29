'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { getSession } from 'next-auth/react';
import { Copy, Download, Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { signOut } from 'next-auth/react';
import { currentVersion, formatVersionLabel } from '@/lib/version';
import { postLoginPath } from '@/lib/auth/roleAccess';
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordLengthError } from '@/lib/auth/passwordRules';
import { downloadTextFile } from '@/lib/browser/downloadFile';
import {
  beginMfaEnrollment,
  checkNeedsSetup,
  confirmMfaEnrollment,
  createFirstAdmin,
  finishStaffSignIn,
  requestPasswordResetCode,
  setNewPassword as savePasswordAfterOtp,
  startStaffSignIn,
  verifyMfaCode,
  verifyPasswordResetCode,
  type SignInStep,
} from '../api/authApi';

type Step =
  | 'setup'
  | 'login'
  | 'mfa'
  | 'enroll'
  | 'recovery-codes'
  | 'forgot-email'
  | 'forgot-code'
  | 'forgot-new-password';

type Enrollment = { qr: string; manualKey: string; account: string };

const inputClass =
  'w-full min-h-12 rounded-lg border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 sm:text-[15px]';

const primaryBtnClass =
  'w-full min-h-12 rounded-lg bg-blue-600 px-4 py-3.5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 disabled:cursor-not-allowed disabled:opacity-55 sm:text-[15px]';

const secondaryBtnClass =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50';

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
  // Two-factor sign-in (src/lib/auth/staffSignIn.ts): single-use ticket carried between steps
  const [ticket, setTicket] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [rememberDevice, setRememberDevice] = useState(false);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesSaved, setCodesSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  // ?callbackUrl= set by the proxy when a signed-out user opened a staff page; read once on mount
  // (the error effect below strips the query string).
  const callbackUrlRef = useRef<string | null>(null);

  /** Role landing page (homePathForRole), or the callbackUrl when the role may open it. */
  const goToLanding = async () => {
    const session = await getSession();
    const role = session?.user?.role ?? null;
    router.push(postLoginPath(role, callbackUrlRef.current));
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    callbackUrlRef.current = params.get('callbackUrl');
    const presetEmail = params.get('email');
    if (presetEmail) setEmail(presetEmail);
    if (params.get('reason') === 'idle') {
      setInfo('You were signed out after 15 minutes without activity. Sign in again to continue.');
    } else if (params.get('reason') === 'expired') {
      setInfo('Your session reached its 12-hour limit. Sign in again to continue.');
    } else if (params.get('registered') === '1') {
      setInfo('Account created. Sign in to set up two-factor sign-in.');
    }
  }, []);

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

  /** After the password step: sign in, or go to the two-factor challenge / setup. */
  const continueSignIn = async (res: SignInStep) => {
    setTicket(res.ticket);
    if (res.next === 'done') {
      await finishStaffSignIn(res.ticket);
      await goToLanding();
      return;
    }
    setMfaCode('');
    setUseRecovery(false);
    if (res.next === 'mfa') {
      setStep('mfa');
      return;
    }
    setEnrollment(null);
    setStep('enroll');
    setEnrollment(await beginMfaEnrollment(res.ticket));
  };

  const backToLogin = () => {
    setStep('login');
    setError('');
    setInfo('');
    setCode('');
    setTicket('');
    setMfaCode('');
    setEnrollment(null);
    setRecoveryCodes([]);
    setCodesSaved(false);
  };

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    const lengthError = passwordLengthError(password);
    if (lengthError) {
      setError(lengthError);
      return;
    }
    setLoading(true);
    try {
      await createFirstAdmin({ name, email, password });
      setInfo('Admin created. Set up two-factor sign-in next.');
      await continueSignIn(await startStaffSignIn(email, password));
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
      await continueSignIn(await startStaffSignIn(email, password));
    } catch (err: any) {
      setError(err.message || 'The email or password you entered is incorrect.');
    } finally {
      setLoading(false);
    }
  };

  const handleMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await verifyMfaCode(ticket, mfaCode, rememberDevice);
      await finishStaffSignIn(res.ticket);
      await goToLanding();
    } catch (err: any) {
      setError(err.message || 'That code is not valid. Check your authenticator app and try again.');
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleEnrollConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await confirmMfaEnrollment(ticket, mfaCode, rememberDevice);
      setTicket(res.ticket);
      setRecoveryCodes(res.recoveryCodes ?? []);
      setCodesSaved(false);
      setStep('recovery-codes');
    } catch (err: any) {
      setError(err.message || 'That code is not valid. Check your authenticator app and try again.');
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  };

  const handleFinishEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await finishStaffSignIn(ticket);
      setRecoveryCodes([]);
      await goToLanding();
    } catch (err: any) {
      setError(err.message || 'Your sign-in expired. Start again.');
    } finally {
      setLoading(false);
    }
  };

  const recoveryText = () =>
    [
      `Altrixs recovery codes${enrollment?.account ? ` for ${enrollment.account}` : ''}`,
      'Each code works once. Keep them somewhere safe.',
      '',
      ...recoveryCodes,
      '',
    ].join('\n');

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryText());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Copy is not available in this browser. Use Download instead.');
    }
  };

  const downloadRecoveryCodes = () => downloadTextFile('altrixs-recovery-codes.txt', recoveryText());

  const sendResetCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);
    try {
      const res = await requestPasswordResetCode(email);
      setInfo(res.message);
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
    } catch (err: any) {
      setError(err.message?.startsWith('Too many') ? err.message : 'Invalid or expired code. Try again.');
    } finally {
      setLoading(false);
    }
  };

  const saveNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const lengthError = passwordLengthError(newPassword);
    if (lengthError) {
      setError(lengthError);
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
      : step === 'login'
        ? 'Welcome back'
        : step === 'mfa'
          ? 'Two-factor sign-in'
          : step === 'enroll'
            ? 'Set up two-factor sign-in'
            : step === 'recovery-codes'
              ? 'Save your recovery codes'
              : 'Reset password';
  const subtitle =
    step === 'setup'
      ? 'First-time setup — use your real work email.'
      : step === 'login'
        ? 'Sign in to access your clinic workspace.'
        : step === 'mfa'
          ? useRecovery
            ? 'Enter one of your one-time recovery codes.'
            : 'Enter the 6-digit code from your authenticator app.'
          : step === 'enroll'
            ? 'Altrixs asks for a second step at sign-in to protect patient information.'
            : step === 'recovery-codes'
              ? 'Use one of these if you lose your phone. Each code works once and is shown only now.'
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
          &copy; {new Date().getFullYear()} Altrixs · Version {formatVersionLabel(currentVersion())}
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
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-rose-400 text-[11px] font-bold">
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
                  minLength={PASSWORD_MIN_LENGTH}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  placeholder={PASSWORD_HINT}
                />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Please wait…' : 'Create admin & continue'}
              </button>
            </form>
          )}

          {step === 'login' && (
            <form onSubmit={handleLogin} className="space-y-5">
              <Field label="Work email">
                <input
                  type="email"
                  name="staff-email"
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
                    name="staff-password"
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
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {step === 'mfa' && (
            <form onSubmit={handleMfa} className="space-y-5">
              <Field label={useRecovery ? 'Recovery code' : '6-digit code'}>
                {useRecovery ? (
                  <input
                    type="text"
                    required
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={mfaCode}
                    onChange={(e) => setMfaCode(e.target.value.slice(0, 20))}
                    className={`${inputClass} text-center font-mono text-lg tracking-[0.12em]`}
                    placeholder="xxxxx-xxxxx"
                  />
                ) : (
                  <OtpInput value={mfaCode} onChange={setMfaCode} />
                )}
              </Field>
              <RememberDevice checked={rememberDevice} onChange={setRememberDevice} />
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setMfaCode('');
                  setError('');
                }}
                className="min-h-11 w-full text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline"
              >
                {useRecovery ? 'Use my authenticator app instead' : 'Use a recovery code'}
              </button>
            </form>
          )}

          {step === 'enroll' && (
            <form onSubmit={handleEnrollConfirm} className="space-y-5">
              <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-6 text-slate-600">
                <li>
                  Install an authenticator app on your phone: Google Authenticator, Microsoft
                  Authenticator, 1Password, Authy or Duo Mobile.
                </li>
                <li>In the app, add an account and scan this QR code.</li>
                <li>Enter the 6-digit code the app shows.</li>
              </ol>
              <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                {enrollment ? (
                  // QR rendered on the server as an SVG data URL (the secret never goes to a third party)
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={enrollment.qr}
                    alt="QR code for your authenticator app"
                    width={192}
                    height={192}
                    className="h-48 w-48 rounded-md bg-white p-2"
                  />
                ) : (
                  <div className="flex h-48 w-48 items-center justify-center rounded-md bg-white text-sm text-slate-400">
                    Loading QR code…
                  </div>
                )}
                {enrollment && (
                  <div className="w-full text-center">
                    <p className="text-xs font-semibold text-slate-600">Can&apos;t scan? Enter this key</p>
                    <p className="mt-1 select-all break-all font-mono text-sm font-semibold tracking-wider text-slate-900">
                      {enrollment.manualKey}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">Account: {enrollment.account} · Time-based</p>
                  </div>
                )}
              </div>
              <Field label="6-digit code">
                <OtpInput value={mfaCode} onChange={setMfaCode} />
              </Field>
              <RememberDevice checked={rememberDevice} onChange={setRememberDevice} />
              <button type="submit" disabled={loading || !enrollment} className={primaryBtnClass}>
                {loading ? 'Verifying…' : 'Verify and continue'}
              </button>
            </form>
          )}

          {step === 'recovery-codes' && (
            <form onSubmit={handleFinishEnrollment} className="space-y-5">
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
                <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden /> Two-factor sign-in is on.
              </div>
              <ul className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-900">
                {recoveryCodes.map((c) => (
                  <li key={c} className="text-center">
                    {c}
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={downloadRecoveryCodes} className={secondaryBtnClass}>
                  <Download className="h-4 w-4" aria-hidden /> Download
                </button>
                <button type="button" onClick={() => void copyRecoveryCodes()} className={secondaryBtnClass}>
                  <Copy className="h-4 w-4" aria-hidden /> {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <label className="flex items-start gap-3 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={codesSaved}
                  onChange={(e) => setCodesSaved(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>I saved these recovery codes somewhere safe.</span>
              </label>
              <button type="submit" disabled={loading || !codesSaved} className={primaryBtnClass}>
                {loading ? 'Signing in…' : 'Continue'}
              </button>
            </form>
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
                {loading ? 'Sending…' : 'Send reset code'}
              </button>
            </form>
          )}

          {step === 'forgot-code' && (
            <form onSubmit={verifyResetCode} className="space-y-5">
              <Field label="6-digit code">
                <OtpInput value={code} onChange={setCode} />
              </Field>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Verifying…' : 'Verify code'}
              </button>
            </form>
          )}

          {step === 'forgot-new-password' && (
            <form onSubmit={saveNewPassword} className="space-y-5">
              <Field label="New password">
                <input
                  type="password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className={inputClass}
                  placeholder={PASSWORD_HINT}
                />
              </Field>
              <Field label="Confirm password">
                <input
                  type="password"
                  required
                  minLength={PASSWORD_MIN_LENGTH}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className={inputClass}
                  placeholder="Repeat new password"
                />
              </Field>
              <p className="text-xs leading-5 text-slate-500">
                {PASSWORD_HINT}. Avoid common passwords and your name or email; a short phrase of
                unrelated words works well.
              </p>
              <button type="submit" disabled={loading} className={primaryBtnClass}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}

          {step !== 'setup' && step !== 'recovery-codes' && (
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
                  onClick={backToLogin}
                  className="min-h-11 text-sm font-semibold text-blue-700 hover:text-blue-800 hover:underline"
                >
                  Back to sign in
                </button>
              )}
            </div>
          )}

          <p className="mt-6 border-t border-slate-100 pt-5 text-center text-xs text-slate-500 sm:mt-7">
            Do not share your login credentials with anyone.
          </p>
        </div>
      </main>
    </div>
  );
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="\d{6}"
      maxLength={6}
      required
      autoComplete="one-time-code"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className={`${inputClass} text-center text-lg font-semibold tracking-[0.32em] sm:tracking-[0.4em]`}
      placeholder="------"
    />
  );
}

function RememberDevice({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start gap-3 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
      />
      <span>
        Remember this device for 30 days
        <span className="block text-xs text-slate-500">
          Only on a computer you alone use, never on a shared workstation.
        </span>
      </span>
    </label>
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
    return 'The email or password you entered is incorrect.';
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
