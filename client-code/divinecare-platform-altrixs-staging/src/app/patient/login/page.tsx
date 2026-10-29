'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { readPatientApi } from '@/features/patient/api';
import { setPatientToken } from '@/features/patient/tokenStorage';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { Alert, Button, Card, cx, FOCUS_RING, inputClasses } from '@/components/ui';

export default function PatientLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch('/api/patient/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await readPatientApi<{ token: string }>(res);
      setPatientToken(data.token);
      router.push('/patient/home');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not sign in');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-10">
      <Card className="w-full max-w-md p-5 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-wider text-blue-700">Altrixs</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Patient sign in</h1>
        <p className="mt-1 text-sm text-slate-500">Website login for your clinic account. This is not the staff portal.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {error && <Alert tone="danger">{error}</Alert>}
          <div>
            <label htmlFor="patient-login-email" className="mb-1.5 block text-sm font-medium text-slate-700">
              Email
            </label>
            <input
              id="patient-login-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cx(inputClasses, 'h-11 text-base')}
              autoComplete="username"
            />
          </div>
          <div>
            <label htmlFor="patient-login-password" className="mb-1.5 block text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="patient-login-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cx(inputClasses, 'h-11 text-base')}
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" size="lg" loading={submitting} className="h-11 w-full">
            {submitting ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-slate-500">
          Staff?{' '}
          <Link href="/login" className={cx('rounded font-semibold text-blue-700 hover:underline', FOCUS_RING)}>
            Clinic login
          </Link>
        </p>

        <CrisisFooter className="mt-6" />
      </Card>
    </div>
  );
}
