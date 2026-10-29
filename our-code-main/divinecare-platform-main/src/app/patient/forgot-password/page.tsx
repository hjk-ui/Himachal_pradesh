'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { readPatientApi } from '@/features/patient/api';

export default function PatientForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/patient/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      });
      await readPatientApi(res);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset instructions. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#F4F7F7] px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600/70">Altrixs</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-900">Forgot your password?</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter your email address and we will send you instructions to reset your password.
        </p>

        {submitted ? (
          <div className="mt-6 space-y-5">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <p className="font-semibold text-emerald-900">Check your email</p>
              <p className="mt-1 text-xs leading-relaxed text-emerald-700">
                If an active patient account exists for <span className="font-semibold">{email}</span>, password reset instructions have been sent.
              </p>
              <p className="mt-2 text-xs text-emerald-600">
                The link is valid for 30 minutes. If you do not see it in a few minutes, check your spam or junk folder.
              </p>
            </div>

            <Link
              href="/patient/login"
              className="block w-full rounded-xl bg-[#141C34] py-2.5 text-center text-sm font-bold text-white hover:bg-blue-700"
            >
              Return to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {error && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="patient-forgot-email" className="mb-1 block text-sm font-semibold text-slate-700">
                Account email
              </label>
              <input
                id="patient-forgot-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                autoComplete="email"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-xl bg-[#141C34] py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {submitting ? 'Sending instructions…' : 'Send reset link'}
            </button>

            <div className="pt-2 text-center">
              <Link href="/patient/login" className="text-xs font-semibold text-blue-600 hover:underline">
                Back to patient sign in
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
