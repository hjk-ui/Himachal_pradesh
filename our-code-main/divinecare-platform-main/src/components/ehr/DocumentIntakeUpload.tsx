'use client';

import { useEffect, useRef, useState } from 'react';

const MAX_BYTES = 20 * 1024 * 1024;

const REMATCH_CONFIRM =
  'Re-run this import with the updated matching? Documents in the review queue whose client folder now matches exactly are filed to that chart (read-only, audited), and files that could not be read before are imported. Nothing already imported is duplicated.';

function splitPatients(text: string) {
  const parts = text
    .split(/\n(?=\s*(?:PATIENT|Patient Name)\s*:)/i)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

export function DocumentIntakeUpload() {
  const [fileName, setFileName] = useState('');
  const [text, setText] = useState('');
  const [parts, setParts] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);
  const [zipMessage, setZipMessage] = useState('');
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [clients, setClients] = useState<Array<{ id: string; name: string }>>([]);
  const [pickClient, setPickClient] = useState<Record<string, string>>({});
  const [rematchMsg, setRematchMsg] = useState('');
  const [rematching, setRematching] = useState(false);
  const lastZipRef = useRef<File | null>(null);

  useEffect(() => {
    fetch('/api/clients?limit=200', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        const list = data.clients || data.data || [];
        if (Array.isArray(list)) {
          setClients(
            list.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })).filter(Boolean)
          );
        }
      })
      .catch(() => undefined);
  }, []);

  async function importZip(file: File, opts?: { rematch?: boolean }) {
    setZipMessage('');
    setRematchMsg('');
    if (opts?.rematch) setRematching(true);
    const body = new FormData();
    body.set('file', file);
    if (opts?.rematch) body.set('rematch', '1');
    try {
      const response = await fetch('/api/ehr/documents/zip', { method: 'POST', body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setZipMessage(data.error || 'The ZIP could not be opened.');
        return;
      }
      const deflate64 = typeof data.deflate64 === 'number' ? data.deflate64 : 0;
      setZipMessage(
        `Filed ${data.filed} on charts, ${data.archive} in the billing archive, skipped ${data.skipped} already imported.${
          deflate64 ? ` Read with 7-Zip (Deflate64): ${deflate64}.` : ''
        }`
      );
      setUnmatched(Array.isArray(data.unmatched) ? data.unmatched : []);
      if (opts?.rematch) {
        setRematchMsg('Re-running with updated matching');
      }
    } finally {
      if (opts?.rematch) setRematching(false);
    }
  }

  async function rematchPath(path: string) {
    const clientId = pickClient[path];
    if (!clientId) {
      setRematchMsg('Select a client before rematching — never guess.');
      return;
    }
    const response = await fetch('/api/ehr/documents/zip/rematch', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, clientId }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setRematchMsg(data.error || 'Rematch failed');
      return;
    }
    setUnmatched((prev) => prev.filter((p) => p !== path));
    setRematchMsg(`Matched to ${data.clientName || 'client'}.`);
  }

  function runUpdatedMatching() {
    if (!lastZipRef.current) {
      setRematchMsg('Re-upload the finished ZIP, then use Re-run with updated matching.');
      return;
    }
    if (!window.confirm(REMATCH_CONFIRM)) return;
    setRematchMsg('Re-running with updated matching');
    void importZip(lastZipRef.current, { rematch: true });
  }

  function classify(source: string) {
    const next = splitPatients(source);
    if (!next.length) {
      setFailed(true);
      setError('Classification failed. You can retry without uploading again.');
      setParts([]);
      return;
    }
    setFailed(false);
    setError('');
    setParts(next);
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <h2 className="text-sm font-semibold text-slate-900">Valant documents (ZIP)</h2>
      <p className="mt-1 text-xs text-slate-500">
        Up to 20 MB text / 80 MB ZIP. Method 9 (Deflate64) extracts via inflate64. Unmatched paths go to
        intake review — never auto-guessed.
      </p>
      <input
        type="file"
        className="mt-3 block text-sm"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          if (file.size > MAX_BYTES) {
            setError('File is larger than 20 MB');
            setText('');
            setParts([]);
            setFileName('');
            setFailed(false);
            return;
          }
          const contents = await file.text();
          setFileName(file.name);
          setText(contents);
          classify(contents);
        }}
      />
      <input
        type="file"
        accept=".zip,application/zip"
        aria-label="Open a ZIP"
        className="mt-3 block text-sm"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            lastZipRef.current = file;
            void importZip(file);
          }
          event.target.value = '';
        }}
      />
      {zipMessage ? <p className="mt-2 text-sm text-slate-700">{zipMessage}</p> : null}
      {rematchMsg ? <p className="mt-1 text-sm text-emerald-800">{rematchMsg}</p> : null}
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      {fileName ? <p className="mt-2 text-xs text-slate-500">{fileName}</p> : null}

      <div className="mt-3">
        <button
          type="button"
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-blue-700 disabled:opacity-50"
          data-testid="valant-rerun-matching"
          disabled={rematching}
          onClick={runUpdatedMatching}
        >
          Re-run with updated matching
        </button>
      </div>

      {unmatched.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="text-sm font-semibold text-amber-950">
            Document intake review · {unmatched.length} unmatched
          </p>
          <ul className="mt-2 space-y-2">
            {unmatched.map((path) => (
              <li key={path} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono text-slate-800">{path}</span>
                <select
                  className="rounded-lg border border-slate-200 px-2 py-1 text-xs"
                  value={pickClient[path] || ''}
                  onChange={(e) => setPickClient((prev) => ({ ...prev, [path]: e.target.value }))}
                >
                  <option value="">Select client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => void rematchPath(path)}
                  className="rounded-lg bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white"
                >
                  Match
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {parts.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {parts.map((part, index) => (
            <li key={index} className="rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              Patient block {index + 1}: {part.slice(0, 120)}
              {part.length > 120 ? '…' : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {failed && text ? (
        <button
          type="button"
          className="mt-2 text-xs font-semibold text-blue-600"
          onClick={() => classify(text)}
        >
          Retry classification
        </button>
      ) : null}
    </section>
  );
}
