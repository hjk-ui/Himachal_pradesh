'use client';

/**
 * Patient portal: "My resources". Only the resources the care team sent to this patient
 * (server scope: patientAssignmentWhere). Opening one marks it viewed; the patient can mark it
 * done. Crisis lines are always at the top.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, CheckCircle2, Download, ExternalLink, Phone } from 'lucide-react';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { CrisisLinesList } from '@/features/resources/CrisisLinesButton';
import { PortalPersonSwitcher } from '@/features/patient/PortalPersonSwitcher';
import type { PatientResourceDto } from '@/lib/resources/types';
import { PORTAL_ACTIONS, PORTAL_BUTTON, PORTAL_MAIN } from '@/features/patient/portalLayout';
import { Alert, Button, buttonClasses, Card, cardClasses, cx, EmptyState, FOCUS_RING, LoadingState, PageHeader, StatusBadge } from '@/components/ui';

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString([], { dateStyle: 'medium' }) : '');

export default function PatientResourcesPage() {
  const router = useRouter();
  const [items, setItems] = useState<PatientResourceDto[] | null>(null);
  const [open, setOpen] = useState<PatientResourceDto | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);

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

  const load = useCallback(() => {
    setError('');
    call<{ resources: PatientResourceDto[] }>('/api/patient/resources')
      .then((d) => d && setItems(d.resources))
      .catch((e: Error) => setError(e.message || 'Could not load your resources.'));
  }, [call]);
  useEffect(load, [load]);

  async function openItem(r: PatientResourceDto) {
    setOpen(r);
    try {
      const d = await call<{ resource: PatientResourceDto }>(`/api/patient/resources/${encodeURIComponent(r.id)}`);
      if (d) { setOpen(d.resource); setItems((list) => list?.map((x) => (x.id === r.id ? d.resource : x)) ?? null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open this resource.');
    }
  }

  async function markDone(r: PatientResourceDto) {
    setBusy(true);
    try {
      const d = await call<{ resource: PatientResourceDto }>(`/api/patient/resources/${encodeURIComponent(r.id)}`, { method: 'POST', body: JSON.stringify({ action: 'completed' }) });
      if (d) { setOpen(d.resource); setItems((list) => list?.map((x) => (x.id === r.id ? d.resource : x)) ?? null); }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  async function download(r: PatientResourceDto) {
    const token = getPatientToken();
    if (!token) { router.replace('/patient/login'); return; }
    setBusy(true);
    try {
      const res = await fetch(`/api/patient/resources/${encodeURIComponent(r.id)}/file`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Could not download the file.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = r.fileName || 'resource';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not download the file.');
    } finally {
      setBusy(false);
    }
  }

  const newCount = items?.filter((i) => i.status === 'sent').length ?? 0;

  return (
    <main className={cx(PORTAL_MAIN, 'max-w-lg')}>
      <Link href="/patient/home" className={cx('-ml-1 inline-flex min-h-[44px] items-center gap-1 rounded px-1 text-sm font-semibold text-slate-600 hover:text-slate-900', FOCUS_RING)}>
        <ArrowLeft size={14} aria-hidden /> Your account
      </Link>
      <PageHeader className="mt-1" title="My resources" description="Information your care team shared with you." />
      <PortalPersonSwitcher />

      <section aria-label="Crisis help" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-base font-semibold text-rose-900">In crisis? Call or text 988. In an emergency call 911.</p>
          <a href="tel:988" className={cx('inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-2 text-sm font-semibold text-white hover:bg-rose-800', FOCUS_RING)}>
            <Phone size={14} aria-hidden /> 988
          </a>
        </div>
        <button type="button" onClick={() => setShowCrisis((v) => !v)} aria-expanded={showCrisis} className={cx('mt-2 inline-flex min-h-[44px] items-center rounded text-sm font-semibold text-rose-900 underline', FOCUS_RING)}>
          {showCrisis ? 'Hide other help lines' : 'More help lines'}
        </button>
        {showCrisis && <div className="mt-3"><CrisisLinesList /></div>}
      </section>

      {error && (
        <Alert
          tone="danger"
          className="mt-4"
          actions={<Button variant="secondary" size="lg" className="h-11" onClick={load}>Try again</Button>}
        >
          {error}
        </Alert>
      )}
      {!items && !error && <LoadingState label="Loading your resources…" className="mt-6" />}
      {items && items.length === 0 && (
        <Card className="mt-6">
          <EmptyState
            icon={<BookOpen />}
            title="Nothing here yet."
            description="When your care team shares a resource, it will appear here."
          />
        </Card>
      )}

      {items && items.length > 0 && !open && (
        <>
          {newCount > 0 && <p className="mt-6"><StatusBadge tone="brand">{newCount} new</StatusBadge></p>}
          <ul className="mt-2 space-y-2">
            {items.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => openItem(r)}
                  className={cx(
                    'flex min-h-[44px] w-full items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:bg-slate-50 hover:shadow-sm',
                    FOCUS_RING,
                  )}
                >
                  <span className="min-w-0">
                    <span className="block break-words text-base font-semibold text-slate-900">{r.title}</span>
                    <span className="mt-0.5 block text-sm text-slate-500">
                      Shared {when(r.sentAt)}{r.fromName ? ` by ${r.fromName}` : ''}{r.dueDate ? ` · please review by ${when(`${r.dueDate}T12:00:00`)}` : ''}
                    </span>
                  </span>
                  <StatusBadge tone={r.status === 'completed' ? 'success' : r.status === 'viewed' ? 'neutral' : 'brand'} className="shrink-0">
                    {r.status === 'completed' ? 'Done' : r.status === 'viewed' ? 'Opened' : 'New'}
                  </StatusBadge>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <article className={cx(cardClasses, 'mt-6 p-5')}>
          <Button variant="ghost" size="lg" className="-ml-3 h-11" icon={<ArrowLeft />} onClick={() => setOpen(null)}>Back to my resources</Button>
          <h2 className="mt-3 break-words text-lg font-semibold text-slate-900">{open.title}</h2>
          {open.publisher && <p className="text-sm text-slate-500">From {open.publisher}</p>}
          {open.message && (
            <blockquote className="mt-3 rounded-lg border-l-4 border-blue-600 bg-blue-50 px-3 py-2 text-base text-slate-700">
              {open.message}
              {open.fromName && <span className="mt-1 block text-sm text-slate-500">{open.fromName}</span>}
            </blockquote>
          )}
          {open.summary && <p className="mt-3 text-base text-slate-700">{open.summary}</p>}
          {open.body && <div className="mt-3 whitespace-pre-wrap break-words text-base leading-relaxed text-slate-800">{open.body}</div>}
          {(open.contactPhone || open.contactText) && (
            <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-900">
              {open.contactText ?? `Call ${open.contactPhone}`}
            </p>
          )}
          <div className={cx('mt-4', PORTAL_ACTIONS)}>
            {open.url && (
              <a href={open.url} target="_blank" rel="noopener noreferrer" className={buttonClasses({ size: 'lg', className: PORTAL_BUTTON })}>
                <ExternalLink size={15} aria-hidden /> Open {open.publisher ? 'website' : 'link'}
              </a>
            )}
            {open.contactPhone && (
              <a href={`tel:${open.contactPhone.replace(/[^\d]/g, '')}`} className={buttonClasses({ variant: 'secondary', size: 'lg', className: PORTAL_BUTTON })}>
                <Phone size={15} aria-hidden /> Call {open.contactPhone}
              </a>
            )}
            {open.hasFile && (
              <Button variant="secondary" size="lg" className={PORTAL_BUTTON} onClick={() => download(open)} loading={busy} icon={<Download />}>
                Download
              </Button>
            )}
            {open.status !== 'completed' ? (
              <Button variant="secondary" size="lg" className={PORTAL_BUTTON} onClick={() => markDone(open)} disabled={busy} icon={<CheckCircle2 />}>
                Mark as done
              </Button>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700"><CheckCircle2 size={15} aria-hidden /> Done {when(open.completedAt)}</p>
            )}
          </div>
          {open.url && <p className="mt-3 text-sm text-slate-500">This link opens a website outside the patient portal.</p>}
        </article>
      )}
    </main>
  );
}
