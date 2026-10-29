'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  BAA_DRAFT_BANNER,
  BAA_LEGAL_REVIEWED,
  BAA_TITLE,
  BAA_VERSION,
  baaAttestation,
} from '@/lib/legal/baa';

type Acceptance = {
  id: string;
  version: string;
  textSha256: string;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  acceptedAt: string;
  via: string;
  ip?: string | null;
  userAgent?: string | null;
};

export default function AdminBaaPage() {
  const [plainText, setPlainText] = useState('');
  const [orgName, setOrgName] = useState('');
  const [latest, setLatest] = useState<Acceptance | null>(null);
  const [currentAccepted, setCurrentAccepted] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerTitle, setSignerTitle] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [forbidden, setForbidden] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/baa', { cache: 'no-store' });
    if (res.status === 403) {
      setForbidden(true);
      return;
    }
    const data = await res.json();
    if (!data.success) {
      setError(data.error || 'Unable to load BAA');
      return;
    }
    setPlainText(data.plainText || '');
    setOrgName(data.orgName || '');
    setLatest(data.latest || null);
    setCurrentAccepted(Boolean(data.currentAccepted));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const downloadTxt = () => {
    const blob = new Blob([plainText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `altrixs-baa-${BAA_VERSION}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const res = await fetch('/api/admin/baa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accepted,
          version: BAA_VERSION,
          signerName,
          signerTitle,
          signerEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Accept failed');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Accept failed');
    } finally {
      setSaving(false);
    }
  };

  if (forbidden) {
    return (
      <div className="p-6 text-sm text-slate-600">
        Only Admin / Practice Director can manage the Business Associate Agreement.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-[#141C34]">{BAA_TITLE}</h1>
        <p className="text-sm text-slate-500">Version {BAA_VERSION}</p>
      </div>
      {!BAA_LEGAL_REVIEWED ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-900">
          {BAA_DRAFT_BANNER}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Print
        </button>
        <button
          type="button"
          onClick={downloadTxt}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
        >
          Download altrixs-baa-{BAA_VERSION}.txt
        </button>
      </div>

      <pre className="whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
        {plainText}
      </pre>

      {currentAccepted && latest ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Acceptance on file</p>
          <p className="mt-1">
            Org: {orgName} · By {latest.signerName} ({latest.signerTitle}) ·{' '}
            {new Date(latest.acceptedAt).toLocaleString()} · version {latest.version} · SHA-256{' '}
            {latest.textSha256.slice(0, 12)}… · via {latest.via}
            {latest.ip ? ` · IP ${latest.ip}` : ''}
          </p>
          {latest.userAgent ? (
            <p className="mt-1 truncate text-xs text-emerald-800">Browser: {latest.userAgent}</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <p className="text-sm font-semibold text-[#141C34]">Accept card</p>
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Signer name"
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Signer title"
            value={signerTitle}
            onChange={(e) => setSignerTitle(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            placeholder="Signer email"
            type="email"
            value={signerEmail}
            onChange={(e) => setSignerEmail(e.target.value)}
          />
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-1"
            />
            <span>{baaAttestation(orgName || 'this organization')}</span>
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            disabled={saving || !accepted}
            onClick={() => void submit()}
            className="rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 hover:bg-[#141C34]"
          >
            {saving ? 'Saving…' : 'Accept Business Associate Agreement'}
          </button>
        </div>
      )}
    </div>
  );
}
