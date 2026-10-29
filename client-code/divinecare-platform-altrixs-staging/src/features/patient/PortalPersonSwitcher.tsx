'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ShieldCheck } from 'lucide-react';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken, setPatientToken } from '@/features/patient/tokenStorage';
import { Alert, cx, inputClasses } from '@/components/ui';

export type PortalActingAs = {
  clientId: string;
  clientName: string;
  relationship: 'self' | 'parent' | 'legal_guardian' | 'authorized_representative';
  accessLevel: 'full' | 'limited';
  isProxy: boolean;
  actorName: string;
};

type Person = { clientId: string; name: string; relationship: PortalActingAs['relationship']; accessLevel: 'full' | 'limited'; isProxy: boolean };

type SessionData = { activeClientId: string | null; actingAs: PortalActingAs | null; people: Person[] };

const REL_LABEL: Record<PortalActingAs['relationship'], string> = {
  self: 'you',
  parent: 'parent',
  legal_guardian: 'legal guardian',
  authorized_representative: 'authorized representative',
};

/**
 * Portal header: "Viewing: Child A" picker for a login that manages more than one person, and the
 * "Acting as guardian for …" banner. Switching asks the server for a new session token
 * (POST /api/patient/session/switch); the server re-checks the link, so the picker is a convenience only.
 * When the current person's access ended, it moves to the first person still available.
 */
export function PortalPersonSwitcher({ onContext }: { onContext?: (actingAs: PortalActingAs | null) => void }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getPatientToken();
    if (!token) return;
    const controller = new AbortController();
    fetch('/api/patient/session', { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal })
      .then(async (res) => {
        if (res.status === 401) {
          clearPatientToken();
          window.location.replace('/patient/login');
          return;
        }
        const d = await readPatientApi<SessionData>(res);
        if (controller.signal.aborted) return;
        setData(d);
        onContext?.(d.actingAs);
        if (!d.actingAs && d.people.length > 0) void switchTo(d.people[0].clientId);
      })
      .catch(() => undefined);
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function switchTo(clientId: string) {
    const token = getPatientToken();
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/patient/session/switch', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      });
      const d = await readPatientApi<{ token: string }>(res);
      setPatientToken(d.token);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch.');
      setBusy(false);
    }
  }

  if (!data) return null;
  const acting = data.actingAs;
  const many = data.people.length > 1;
  if (!acting && !many) return null;

  return (
    <div className="mt-4 space-y-2">
      {many && (
        <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-base text-slate-700 shadow-xs">
          <span className="shrink-0 font-semibold">Viewing:</span>
          <span className="relative min-w-0 flex-1">
            <select
              aria-label="Choose whose account to view"
              value={acting?.clientId ?? ''}
              disabled={busy}
              onChange={(e) => e.target.value && void switchTo(e.target.value)}
              className={cx(inputClasses, 'h-11 appearance-none pr-8 text-base font-semibold')}
            >
              {!acting && <option value="">Choose a person</option>}
              {data.people.map((p) => (
                <option key={p.clientId} value={p.clientId}>
                  {p.isProxy ? p.name : `${p.name} (you)`}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-500" />
          </span>
        </label>
      )}
      {acting?.isProxy && (
        <div role="status" className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <ShieldCheck size={16} aria-hidden className="mt-0.5 shrink-0 text-amber-700" />
          <span className="min-w-0 break-words">
            Acting as {REL_LABEL[acting.relationship]} for <strong>{acting.clientName}</strong>.
            {acting.accessLevel === 'limited' ? ' Some records stay private to them.' : ''} Messages and signatures are recorded under your name.
          </span>
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
