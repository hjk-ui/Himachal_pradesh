'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { ProfileEditor, type PatientProfileDetails } from '@/features/patient/ProfileEditor';
import { PasswordChangeCard } from '@/features/patient/PasswordChangeCard';

export default function PatientHomePage() {
  const router = useRouter();
  const [me, setMe] = useState<PatientProfileDetails | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const token = getPatientToken();
    if (!token) { router.replace('/patient/login'); return; }
    const controller = new AbortController();
    setError('');
    fetch('/api/patient/me', {
      headers: { Authorization: 'Bearer ' + token },
      signal: controller.signal,
    })
      .then(async (res) => {
        if (res.status === 401) {
          clearPatientToken(); router.replace('/patient/login'); return;
        }
        const data = await readPatientApi<{ client: PatientProfileDetails }>(res);
        if (!controller.signal.aborted) setMe(data.client);
      })
      .catch((err: Error) => {
        if (!controller.signal.aborted) setError(err.message || 'Could not load your profile.');
      });
    return () => controller.abort();
  }, [router, retry]);

  function signOut() {
    clearPatientToken(); router.replace('/patient/login');
  }

  return (
    <main className="mx-auto min-h-[100dvh] max-w-lg px-4 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-600/70">Altrixs</p>
      <h1 className="mt-2 text-2xl font-bold text-slate-900">Your account</h1>
      <p className="mt-1 text-sm text-slate-500">View and update your patient profile.</p>
      {!me && !error && <p role="status" className="mt-6 text-sm text-slate-500">Loading your profile...</p>}
      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
          <p role="alert" className="text-sm text-red-700">{error}</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)}
            className="mt-3 text-sm font-semibold text-blue-700 hover:underline">Try again</button>
        </div>
      )}
      {me && (
        <>
          <ProfileEditor profile={me} onSaved={setMe} onSessionExpired={signOut} />
          <PasswordChangeCard onSessionExpired={signOut} />
        </>
      )}
      <button type="button" onClick={signOut} className="mt-6 text-sm font-semibold text-blue-600 hover:underline">Sign out</button>
    </main>
  );
}
