'use client';

/**
 * Patient portal: "Questionnaires". Open questionnaires the care team sent (by email, text or to
 * the portal). Start opens the secure questionnaire page, which asks for the date of birth first.
 * Proxies (guardians / representatives) see none. Crisis lines are on the questionnaire page.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ClipboardList } from 'lucide-react';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { PortalPersonSwitcher } from '@/features/patient/PortalPersonSwitcher';
import { PORTAL_BUTTON, PORTAL_MAIN } from '@/features/patient/portalLayout';
import { CrisisFooter } from '@/components/ui/CrisisFooter';
import { Alert, Button, Card, cx, EmptyState, FOCUS_RING, LoadingState, PageHeader } from '@/components/ui';

type Item = { id: string; formCount: number; sentAt: string | null; expiresAt: string; started: boolean };

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: 'medium' }) : '');

export default function PatientMeasuresPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
      const token = getPatientToken();
      if (!token) { router.replace('/patient/login'); return null; }
      const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      if (res.status === 401) { clearPatientToken(); router.replace('/patient/login'); return null; }
      return readPatientApi<T>(res);
    },
    [router],
  );

  useEffect(() => {
    call<{ measures: Item[] }>('/api/patient/measures')
      .then((d) => d && setItems(d.measures))
      .catch((e: Error) => setError(e.message || 'Could not load your questionnaires.'));
  }, [call]);

  async function start(id: string) {
    setBusy(id);
    setError('');
    try {
      const d = await call<{ path: string }>(`/api/patient/measures/${encodeURIComponent(id)}/start`, { method: 'POST', body: '{}' });
      if (d?.path) window.location.assign(d.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this questionnaire.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className={cx(PORTAL_MAIN, 'max-w-lg')}>
      <Link href="/patient/home" className={cx('inline-flex items-center gap-1 rounded text-sm font-semibold text-slate-600 hover:text-slate-900', FOCUS_RING)}>
        <ArrowLeft className="h-4 w-4" aria-hidden /> Your account
      </Link>
      <PageHeader title="Questionnaires" description="Short forms from your care team. Your answers go to your clinician." />
      <PortalPersonSwitcher />
      {error ? <Alert tone="danger" className="mt-4">{error}</Alert> : null}
      {!items && !error ? <LoadingState label="Loading…" className="mt-6" /> : null}
      {items && !items.length ? (
        <Card className="mt-6">
          <EmptyState icon={<ClipboardList />} title="Nothing to complete" description="When your care team sends a questionnaire it shows here." />
        </Card>
      ) : null}
      {items?.length ? (
        <ul className="mt-6 space-y-3">
          {items.map((m) => (
            <li key={m.id}>
              <Card className="p-4">
                <div className="text-base font-semibold text-slate-900">
                  Questionnaire{m.formCount > 1 ? ` (${m.formCount} short forms)` : ''}
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {m.sentAt ? `Sent ${when(m.sentAt)}. ` : ''}Open until {when(m.expiresAt)}. You will be asked for your date of birth first.
                </p>
                <Button size="lg" className={cx('mt-3', PORTAL_BUTTON)} disabled={busy === m.id} onClick={() => void start(m.id)}>
                  {busy === m.id ? 'Opening…' : m.started ? 'Continue' : 'Start'}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
      <CrisisFooter className="mt-8" />
    </main>
  );
}
