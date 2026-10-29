'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { ProfileEditor, type PatientProfileDetails } from '@/features/patient/ProfileEditor';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { PortalPersonSwitcher } from '@/features/patient/PortalPersonSwitcher';
import { PORTAL_BUTTON, PORTAL_MAIN } from '@/features/patient/portalLayout';
import { BookOpen, ChevronRight, ClipboardList, CreditCard, FileSignature, LogOut } from 'lucide-react';
import { Button, Card, cx, ErrorState, FOCUS_RING, LoadingState, PageHeader } from '@/components/ui';

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

  const navLink = cx(
    'mt-3 flex min-h-[44px] items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-base font-semibold text-slate-900 shadow-xs transition hover:bg-slate-50 hover:shadow-sm',
    FOCUS_RING,
  );

  return (
    <main className={cx(PORTAL_MAIN, 'max-w-lg')}>
      <PageHeader eyebrow="Altrixs" title="Your account" description="View and update your patient profile." />
      <PortalPersonSwitcher />
      {!me && !error && <LoadingState label="Loading your profile…" className="mt-6" />}
      {error && (
        <Card className="mt-6">
          <ErrorState title="We couldn't load your profile" description={error} onRetry={() => setRetry((value) => value + 1)} />
        </Card>
      )}
      {me && (
        <nav aria-label="Your portal" className="mt-6">
          <Link href="/patient/documents" className={cx(navLink, 'mt-0')}>
            <span className="flex min-w-0 items-center gap-3">
              <FileSignature className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <span className="min-w-0">
                Documents to sign
                <span className="block text-sm font-normal text-slate-500">Treatment plans from your counselor</span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
          <Link href="/patient/measures" className={navLink}>
            <span className="flex min-w-0 items-center gap-3">
              <ClipboardList className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <span className="min-w-0">
                Questionnaires
                <span className="block text-sm font-normal text-slate-500">Forms to complete for your care team</span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
          <Link href="/patient/resources" className={navLink}>
            <span className="flex min-w-0 items-center gap-3">
              <BookOpen className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <span className="min-w-0">
                My resources
                <span className="block text-sm font-normal text-slate-500">Information your care team shared</span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
          <Link href="/patient/billing" className={navLink}>
            <span className="flex min-w-0 items-center gap-3">
              <CreditCard className="h-5 w-5 shrink-0 text-blue-600" aria-hidden />
              <span className="min-w-0">
                Billing &amp; payments
                <span className="block text-sm font-normal text-slate-500">Saved card, automatic payments, receipts</span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-400" aria-hidden />
          </Link>
        </nav>
      )}
      {me && <ProfileEditor profile={me} onSaved={setMe} onSessionExpired={signOut} />}
      <Button variant="ghost" size="lg" icon={<LogOut />} onClick={signOut} className={cx('mt-6', PORTAL_BUTTON)}>Sign out</Button>
      <CrisisFooter className="mt-8" />
    </main>
  );
}
