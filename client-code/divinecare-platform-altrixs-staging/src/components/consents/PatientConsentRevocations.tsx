'use client';

/** Patient portal: the client's own signed consents, with a written revocation through the portal. */
import { useCallback, useEffect, useState } from 'react';
import { Loader2, XCircle } from 'lucide-react';

type Revocable = { id: string; title: string; recipient: string | null; signedAt: string | null };

export function PatientConsentRevocations({ call }: { call: <T>(path: string, init?: RequestInit) => Promise<T | null> }) {
  const [rows, setRows] = useState<Revocable[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await call<{ consents: Revocable[] }>('/api/patient/consents');
      setRows(d?.consents ?? []);
    } catch {
      setRows([]);
    }
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  const revoke = async (id: string) => {
    setBusy(true);
    setMessage('');
    try {
      await call('/api/patient/consents', { method: 'POST', body: JSON.stringify({ consentId: id, confirm: true }) });
      setMessage('Your revocation was recorded. The clinic has stopped relying on that consent.');
      setConfirming(null);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not record the revocation.');
    } finally {
      setBusy(false);
    }
  };

  if (!rows || rows.length === 0) return null;
  return (
    <section className="mt-8 rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-bold text-slate-900">Your consents</h2>
      <p className="mt-1 text-xs text-slate-500">You can take back (revoke) a consent at any time. It stops future use; it does not undo anything already done in reliance on it.</p>
      {message ? <p role="status" className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{message}</p> : null}
      <ul className="mt-3 divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="min-w-0 break-words text-sm text-slate-800">
              {r.title}
              {r.recipient ? <span className="text-slate-500"> (to {r.recipient})</span> : null}
              {r.signedAt ? <span className="block text-xs text-slate-500">Signed {new Date(r.signedAt).toLocaleDateString()}</span> : null}
            </span>
            {confirming === r.id ? (
              <span className="flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void revoke(r.id)} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60">
                  {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <XCircle size={13} aria-hidden />}
                  Yes, revoke
                </button>
                <button type="button" onClick={() => setConfirming(null)} className="min-h-10 px-2 text-xs text-slate-600 underline">Cancel</button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirming(r.id)} className="min-h-10 px-2 text-xs font-semibold text-rose-700 underline">Revoke</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
