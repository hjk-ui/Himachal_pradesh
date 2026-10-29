'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { parsePatientApi, type PatientApiBody } from '@/features/patient/api';

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
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#F4F7F7] px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600/70">Altrixs</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Set your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          Then sign in to your patient account in the app or on this website.
        </p>

        {loading && <p className="mt-6 text-sm text-slate-500">Checking invite…</p>}

        {!loading && error && !invite && !isReset && (
          <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {!loading && (invite || isReset) && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            {invite && <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm">
              <p className="font-semibold text-slate-900">{invite.name}</p>
              <p className="text-slate-500">{invite.email}</p>
            </div>}

            {success && (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <p className="font-semibold">Password updated successfully!</p>
                  <p className="mt-1 text-xs text-emerald-700">You can now open your Altrixs Mobile App and log in with your new password.</p>
                </div>
                <Link
                  href="/patient/login"
                  className="block w-full rounded-xl bg-[#141C34] py-2.5 text-center text-sm font-bold text-white hover:bg-slate-800"
                >
                  Sign in on website
                </Link>
              </div>
            )}

            {!success && isReset && token && (
              <div className="mb-2 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-center">
                <p className="text-xs text-indigo-900">
                  Using a phone with the Altrixs app installed?
                </p>
                <a
                  href={`altrixs://patient/accept?mode=reset&token=${encodeURIComponent(token)}`}
                  className="mt-1.5 inline-block text-xs font-bold text-[#6868D0] underline hover:text-[#5656b8]"
                >
                  Tap here to open in Altrixs Mobile App
                </a>
              </div>
            )}

            {!success && (
              <>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Letter + number, min 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Confirm password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Repeat password"
                    autoComplete="new-password"
                  />
                </div>
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-xl bg-[#141C34] py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {submitting ? 'Saving…' : 'Save password'}
                </button>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}

export default function PatientAcceptPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center text-sm text-slate-500">
          Loading invite…
        </div>
      }
    >
      <AcceptPatientForm />
    </Suspense>
  );
}
