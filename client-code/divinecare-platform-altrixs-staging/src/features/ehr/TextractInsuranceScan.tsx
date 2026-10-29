'use client';

import { useRef, useState } from 'react';
import { CreditCard, Loader2, ScanLine } from 'lucide-react';

type ExtractedResult = {
  demoMode?: boolean;
  jobId?: string;
  documentType?: string;
  keyValues?: Record<string, string>;
  blocks?: Array<{ blockType: string; text: string; confidence: number }>;
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

export function TextractInsuranceScan({
  clientId,
  compact = false,
}: {
  clientId?: string | null;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedResult | null>(null);

  async function onFile(file: File | null) {
    if (!file) return;
    setScanning(true);
    setError(null);
    setResult(null);
    try {
      const bytesBase64 = await fileToBase64(file);
      const res = await fetch('/api/textract/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bytesBase64,
          documentType: 'insurance_card',
          clientId: clientId || null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 503) {
        throw new Error(json.error || 'Card scanning not configured — enter the card details by hand.');
      }
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Textract analysis failed');
      }
      setResult(json as ExtractedResult);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const fields = result?.keyValues ? Object.entries(result.keyValues) : [];

  return (
    <div
      className={
        compact
          ? 'rounded-xl border border-violet-200 bg-violet-50/60 p-3'
          : 'rounded-2xl border border-violet-200 bg-white p-4 shadow-sm'
      }
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <CreditCard size={16} className="text-[#5C2D91]" />
            <h3 className="text-sm font-bold text-slate-900">Scan insurance card</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Upload a card image — Textract extracts payer, member ID, and plan fields. Check every field against
            the card before saving.
          </p>
        </div>
        <div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.pdf,application/pdf"
            className="hidden"
            onChange={(e) => void onFile(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            disabled={scanning}
            onClick={() => inputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-3 py-2 text-xs font-semibold text-white disabled:opacity-70"
          >
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <ScanLine size={14} />}
            {scanning ? 'Scanning…' : 'Upload card'}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {error}
        </div>
      )}

      {result && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Extracted fields</span>
            {result.jobId ? (
              <span className="normal-case tracking-normal text-slate-500">
                job {result.jobId.slice(0, 8)}…
              </span>
            ) : null}
          </div>
          {fields.length === 0 ? (
            <p className="text-xs text-slate-500">No key/value fields returned.</p>
          ) : (
            <dl className="grid gap-2 sm:grid-cols-2">
              {fields.map(([key, value]) => (
                <div
                  key={key}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                    {key}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold text-slate-900">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
