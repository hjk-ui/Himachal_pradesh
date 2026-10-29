'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { acceptInvite, fetchInvitePreview } from '@/features/staff/api/staffApi';
import { PASSWORD_HINT, PASSWORD_MIN_LENGTH, passwordLengthError } from '@/lib/auth/passwordRules';

function AcceptInviteForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [invite, setInvite] = useState<{
    name: string | null;
    email: string;
    role: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setError('Missing invite token');
      setLoading(false);
      return;
    }
    fetchInvitePreview(token)
      .then(setInvite)
      .catch((err: any) => setError(err.message || 'Invalid invite'))
      .finally(() => setLoading(false));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const lengthError = passwordLengthError(password);
    if (lengthError) {
      setError(lengthError);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const result = await acceptInvite(token, password);
      setSuccess(result.message || 'Account activated');
      setTimeout(() => router.push('/login'), 1200);
    } catch (err: any) {
      setError(err.message || 'Could not activate account');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#F4F7F7] px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600/70">
          Altrixs
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">
          Accept invitation
        </h1>
        <p className="mt-1 text-sm text-slate-500">Set your password to activate your staff account.</p>

        {loading && <p className="mt-6 text-sm text-slate-500">Checking invite…</p>}

        {!loading && error && !invite && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
            <Link href="/login" className="inline-flex min-h-10 items-center text-sm font-semibold text-blue-600 hover:underline">
              Back to login
            </Link>
          </div>
        )}

        {!loading && invite && (
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm">
              <p className="break-words font-semibold text-slate-900">{invite.name || 'Staff member'}</p>
              <p className="break-all text-slate-500">{invite.email}</p>
              <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-blue-600">
                {invite.role.replace(/_/g, ' ')}
              </p>
            </div>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            {success && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                {success}
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-blue-200 sm:text-sm"
                placeholder={PASSWORD_HINT}
                autoComplete="new-password"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">
                Confirm password
              </label>
              <input
                type="password"
                required
                minLength={PASSWORD_MIN_LENGTH}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-base outline-none focus:ring-2 focus:ring-blue-200 sm:text-sm"
                placeholder="Repeat password"
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={submitting || !!success}
              className="min-h-11 w-full rounded-xl bg-[#141C34] py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? 'Activating…' : 'Activate account'}
            </button>

            <p className="text-center text-xs text-slate-400">
              Already activated?{' '}
              <Link href="/login" className="font-semibold text-blue-600 hover:underline">
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[100dvh] items-center justify-center text-sm text-slate-500">
          Loading invite…
        </div>
      }
    >
      <AcceptInviteForm />
    </Suspense>
  );
}
