'use client';

import { useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Modal, StatusBadge } from '@/components/ui';
import { ExpiryBadge, Labeled, Select, TextInput } from './HrBits';
import { fmtDate, hrFetch, titleCase } from './hrClient';

export type HrDoc = {
  id: string;
  category: string;
  title: string;
  fileName: string;
  sizeBytes: number | null;
  expiresOn: string | null;
  visibleToEmployee: boolean;
  restricted: boolean;
  source: string;
  status: string;
  uploadedByName: string | null;
  createdAt: string;
};

const CATEGORIES: Array<[string, string]> = [
  ['offer_letter', 'Offer letter'],
  ['license', 'License / registration'],
  ['certificate', 'Certificate'],
  ['training', 'Training certificate'],
  ['health', 'TB / immunization record'],
  ['policy_ack', 'Signed policy'],
  ['payroll_form', 'Payroll form copy'],
  ['performance', 'Performance'],
  ['discipline', 'Corrective action'],
  ['separation', 'Separation'],
  ['other', 'Other'],
];

/** Employee documents with expiry. Downloads go through the audited /api/hr/documents/[id] route. */
export function DocumentsPanel({
  userId,
  docs,
  mode,
  expirations,
  onChanged,
}: {
  userId: string;
  docs: HrDoc[];
  /** hr: full upload + restricted flag; self: self-service upload (pending HR review); ops: credential documents; read */
  mode: 'hr' | 'self' | 'ops' | 'read';
  expirations?: Array<{ source: string; sourceId: string; status: string; dueOn: string | null; daysLeft: number | null }>;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(id: string, action: 'accept' | 'archive') {
    setBusy(id);
    try {
      if (action === 'accept') await hrFetch(`/api/hr/documents/${id}`, { method: 'PATCH', json: { status: 'active' } });
      else await hrFetch(`/api/hr/documents/${id}`, { method: 'DELETE' });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }

  const categories = mode === 'ops' ? CATEGORIES.filter(([k]) => ['license', 'certificate', 'training', 'health'].includes(k)) : mode === 'self' ? CATEGORIES.filter(([k]) => !['discipline', 'performance', 'separation'].includes(k)) : CATEGORIES;

  return (
    <Card>
      <CardHeader
        title="Documents"
        description={mode === 'self' ? 'Uploads go to HR for review.' : 'Files are stored privately; every download is logged.'}
        actions={mode !== 'read' ? <Button size="sm" icon={<Upload />} onClick={() => setOpen(true)}>Upload</Button> : null}
      />
      <CardBody flush>
        {error ? <div className="p-4"><Alert tone="danger">{error}</Alert></div> : null}
        {docs.length === 0 ? (
          <EmptyState compact title="No documents" icon={<FileText />} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {docs.map((d) => {
              const st = expirations?.find((e) => e.source === 'document' && e.sourceId === d.id);
              return (
                <li key={d.id} className="flex flex-col gap-2 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <a href={`/api/hr/documents/${d.id}`} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium text-slate-900 hover:text-blue-700">
                      {d.title}
                    </a>
                    <p className="text-xs text-slate-500">
                      {CATEGORIES.find(([k]) => k === d.category)?.[1] ?? titleCase(d.category)} · {fmtDate(d.createdAt.slice(0, 10))}
                      {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                      {d.expiresOn ? ` · expires ${fmtDate(d.expiresOn)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {d.restricted ? <StatusBadge size="sm" tone="danger">HR only</StatusBadge> : null}
                    {d.status === 'pending_review' ? <StatusBadge size="sm" tone="warning">Waiting for HR</StatusBadge> : null}
                    {st && st.status !== 'current' ? <ExpiryBadge size="sm" status={st.status} dueOn={st.dueOn} daysLeft={st.daysLeft} /> : null}
                    {mode === 'hr' && d.status === 'pending_review' ? (
                      <Button size="sm" variant="secondary" loading={busy === d.id} onClick={() => act(d.id, 'accept')}>Accept</Button>
                    ) : null}
                    {mode === 'hr' ? (
                      <Button size="sm" variant="ghost" disabled={busy === d.id} onClick={() => act(d.id, 'archive')}>Archive</Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardBody>
      {open ? <UploadModal userId={userId} categories={categories} hr={mode === 'hr'} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChanged(); }} /> : null}
    </Card>
  );
}

function UploadModal({ userId, categories, hr, onClose, onSaved }: { userId: string; categories: Array<[string, string]>; hr: boolean; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState(categories[0]?.[0] ?? 'other');
  const [title, setTitle] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [restricted, setRestricted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('userId', userId);
      fd.set('category', category);
      fd.set('title', title || file.name);
      if (expiresOn) fd.set('expiresOn', expiresOn);
      if (hr) fd.set('restricted', String(restricted || category === 'discipline'));
      const res = await fetch('/api/hr/documents', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Upload failed');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Upload document"
      size="sm"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!file}>Upload</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Labeled label="File (PDF, Word or image, under 10 MB)" required>
          <input type="file" accept=".pdf,.doc,.docx,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
        </Labeled>
        <Labeled label="Type">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Title"><TextInput value={title} onChange={(e) => setTitle(e.target.value)} /></Labeled>
        <Labeled label="Expires (optional)" hint="Expiring documents show up in HR reminders."><TextInput type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} /></Labeled>
        {hr ? (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={restricted} onChange={(e) => setRestricted(e.target.checked)} /> HR and leadership only (hidden from the employee)
          </label>
        ) : null}
      </div>
    </Modal>
  );
}
