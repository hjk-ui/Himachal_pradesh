'use client';

import { useState } from 'react';
import { ScanText } from 'lucide-react';
import { Alert, Button, Modal } from '@/components/ui';
import { AiDraftNotice, Labeled, TextArea } from './HrBits';

export type ExtractedFields = {
  credentialType: string | null;
  licenseType: string | null;
  licenseNumber: string | null;
  holderName: string | null;
  issuer: string | null;
  state: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  carrier?: string | null;
  policyNumber?: string | null;
  perClaimLimit?: string | null;
  aggregateLimit?: string | null;
  notes: string[];
};

/**
 * Document intelligence: upload a license / certificate / insurance image or one-page PDF (or
 * paste its text). The fields come back as a DRAFT that prefills the credential form; HR checks
 * them against the document and saves. Nothing is saved here.
 */
export function DocExtractModal({ onClose, onUse }: { onClose: () => void; onUse: (f: ExtractedFields) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: ExtractedFields; engine: 'bedrock' | 'rules'; disclaimer: string } | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      if (file) fd.set('file', file);
      if (text) fd.set('text', text);
      const res = await fetch('/api/hr/ai/extract', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Could not read the document');
      setResult(data.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the document');
    } finally {
      setBusy(false);
    }
  }

  const rows: Array<[string, string | null | undefined]> = result
    ? [
        ['Type', result.data.credentialType],
        ['License type', result.data.licenseType],
        ['Number', result.data.licenseNumber],
        ['Name on document', result.data.holderName],
        ['Issuer', result.data.issuer],
        ['State', result.data.state],
        ['Issued', result.data.issuedAt],
        ['Expires', result.data.expiresAt],
        ['Carrier', result.data.carrier],
        ['Policy', result.data.policyNumber],
        ['Limits', [result.data.perClaimLimit, result.data.aggregateLimit].filter(Boolean).join(' / ') || null],
      ]
    : [];

  return (
    <Modal title="Read a credential document" size="md" onClose={onClose} dismissible={!busy}>
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Labeled label="Document (image or one-page PDF, under 5 MB)">
          <input type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </Labeled>
        <Labeled label="Or paste the text" hint="Useful for a board lookup page or an emailed certificate.">
          <TextArea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </Labeled>
        <div className="flex justify-end">
          <Button icon={<ScanText />} loading={busy} onClick={run} disabled={!file && !text.trim()}>Read document</Button>
        </div>
        {result ? (
          <div className="space-y-3">
            <AiDraftNotice engine={result.engine} disclaimer={result.disclaimer} />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {rows.map(([k, v]) => (
                <div key={k} className="min-w-0">
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className={v ? 'break-words text-slate-900' : 'text-slate-400'}>{v || 'Not found'}</dd>
                </div>
              ))}
            </dl>
            {result.data.notes?.length ? <p className="text-xs text-amber-800">{result.data.notes.join(' · ')}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>Discard</Button>
              <Button onClick={() => onUse(result.data)}>Use in form</Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
