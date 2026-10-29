'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { parsePatientApi, type PatientApiBody } from '@/features/patient/api';
import { Alert, Button, buttonClasses, Card, cx, FOCUS_RING, inputClasses, LoadingState } from '@/components/ui';

function AcceptPatientForm() {
  const params = useSearchParams();
  const token = params.get('token') || '';
  const isReset = params.get('mode') === 'reset';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState<{ name: string; email: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing password link token');
      setLoading(false);
      return;
    }
    if (isReset) {
      setLoading(false);
      return;
    }
    fetch(`/api/patient/invite/preview?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = (await res.json()) as PatientApiBody<{ invite: { name: string; email: string } }>;
        const data = parsePatientApi(body);
        setInvite(data.invite);
      })
      .catch((err: Error) => setError(err.message || 'Invalid invite'))
      .finally(() => setLoading(false));
  }, [token, isReset]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 8 || password.length > 72) {
      setError('Password must be 8–72 characters');
      return;
    }
    if (/\s/.test(password) || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError('Password must include a letter and a number, with no spaces');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(isReset ? '/api/patient/reset-password' : '/api/patient/invite/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const body = (await res.json()) as PatientApiBody<{ email: string; name: string }>;
      parsePatientApi(body);
      setSuccess(body.message || 'Password saved. Sign in on the website.');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not save password');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Altrixs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Set your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Then sign in to your patient account in the app or on this website.
        </p>

        {loading && <LoadingState label="Checking invite…" className="mt-6 py-8" />}

        {!loading && error && !invite && !isReset && (
          <Alert tone="danger" className="mt-6">
            {error}
          </Alert>
        )}

        {!loading && (invite || isReset) && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {invite && <div className="rounded-lg bg-slate-50 px-3 py-3 text-sm">
              <p className="break-words font-semibold text-slate-900">{invite.name}</p>
              <p className="break-all text-slate-500">{invite.email}</p>
            </div>}

            {success && (
              <div className="space-y-3">
                <Alert tone="success" title="Password updated successfully!">
                  You can now open your Altrixs Mobile App and log in with your new password.
                </Alert>
                <Link
                  href="/patient/login"
                  className={buttonClasses({ size: 'lg', className: 'h-11 w-full' })}
                >
                  Sign in on website
                </Link>
              </div>
            )}

            {!success && isReset && token && (
              <div className="mb-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-center">
                <p className="text-sm text-blue-900">
                  Using a phone with the Altrixs app installed?
                </p>
                <a
                  href={`altrixs://patient/accept?mode=reset&token=${encodeURIComponent(token)}`}
                  className={cx('mt-1.5 inline-flex min-h-[44px] items-center rounded text-sm font-semibold text-blue-700 underline hover:text-blue-800', FOCUS_RING)}
                >
                  Tap here to open in Altrixs Mobile App
                </a>
              </div>
            )}

            {!success && (
              <>
                {error && <Alert tone="danger">{error}</Alert>}
                <div>
                  <label htmlFor="patient-accept-password" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Password
                  </label>
                  <input
                    id="patient-accept-password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={cx(inputClasses, 'h-11 text-base')}
                    placeholder="Letter + number, min 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label htmlFor="patient-accept-confirm" className="mb-1.5 block text-sm font-medium text-slate-700">
                    Confirm password
                  </label>
                  <input
                    id="patient-accept-confirm"
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className={cx(inputClasses, 'h-11 text-base')}
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" size="lg" loading={submitting} className="h-11 w-full">
                  {submitting ? 'Saving…' : 'Save password'}
                </Button>
              </>
            )}
          </form>
        )}
      </Card>
    </div>
  );
}

export default function PatientAcceptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50">
          <LoadingState label="Loading invite…" />
        </div>
      }
    >
      <AcceptPatientForm />
    </Suspense>
  );
}
