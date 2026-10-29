'use client';

import { useState } from 'react';
import { Copy, Sparkles } from 'lucide-react';
import { Alert, Button, Modal } from '@/components/ui';
import { AiDraftNotice, Labeled, Select, TextArea, TextInput } from './HrBits';
import { hrFetch, PROGRAM_OPTIONS, roleLabel, STAFF_ROLE_OPTIONS } from './hrClient';

type Draft = { data: { text: string }; engine: 'bedrock' | 'rules'; disclaimer: string };

/** Job description / offer letter draft (AI or template). HR edits and copies; nothing is saved. */
export function AiWritingModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    kind: 'job_description' as 'job_description' | 'offer_letter',
    jobTitle: '',
    role: 'THERAPIST',
    location: '',
    program: '',
    workerType: 'W2',
    payType: 'hourly',
    payText: '',
    candidateName: '',
    startDate: '',
    supervisorTitle: '',
  });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function generate() {
    if (!form.jobTitle.trim()) return setError('Enter the job title');
    setBusy(true);
    setError(null);
    try {
      const r = await hrFetch<{ draft: Draft }>('/api/hr/ai/writing', { method: 'POST', json: form });
      setDraft(r.draft);
      setText(r.draft.data.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not draft');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Draft a job description or offer letter" size="lg" onClose={onClose}>
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Document">
            <Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>
              <option value="job_description">Job description</option>
              <option value="offer_letter">Offer letter</option>
            </Select>
          </Labeled>
          <Labeled label="Job title" required>
            <TextInput value={form.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} placeholder="Outpatient therapist (LCSW-C / LCPC)" />
          </Labeled>
          <Labeled label="Altrixs role">
            <Select value={form.role} onChange={(e) => set('role', e.target.value)}>
              {STAFF_ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Location">
            <TextInput value={form.location} onChange={(e) => set('location', e.target.value)} placeholder="Bowie" />
          </Labeled>
          <Labeled label="Program">
            <Select value={form.program} onChange={(e) => set('program', e.target.value)}>
              <option value="">Not specified</option>
              {PROGRAM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Classification">
            <Select value={form.workerType} onChange={(e) => set('workerType', e.target.value)}>
              <option value="W2">W-2 employee</option>
              <option value="1099">1099 contractor</option>
              <option value="PER_DIEM">Per diem</option>
            </Select>
          </Labeled>
          <Labeled label="Pay type">
            <Select value={form.payType} onChange={(e) => set('payType', e.target.value)}>
              <option value="hourly">Hourly</option>
              <option value="salary">Salary</option>
              <option value="per_visit">Per visit</option>
            </Select>
          </Labeled>
          <Labeled label="Pay (only what you want in the draft)" hint="Left blank, the draft shows a placeholder. AI never invents pay.">
            <TextInput value={form.payText} onChange={(e) => set('payText', e.target.value)} />
          </Labeled>
          {form.kind === 'offer_letter' ? (
            <>
              <Labeled label="Candidate name">
                <TextInput value={form.candidateName} onChange={(e) => set('candidateName', e.target.value)} />
              </Labeled>
              <Labeled label="Start date">
                <TextInput type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </Labeled>
              <Labeled label="Reports to (title)">
                <TextInput value={form.supervisorTitle} onChange={(e) => set('supervisorTitle', e.target.value)} placeholder="Clinical director" />
              </Labeled>
            </>
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button icon={<Sparkles />} loading={busy} onClick={generate}>
            {draft ? 'Draft again' : 'Draft'}
          </Button>
        </div>
        {draft ? (
          <div className="space-y-2">
            <AiDraftNotice engine={draft.engine} disclaimer={draft.disclaimer} />
            <TextArea value={text} onChange={(e) => setText(e.target.value)} rows={16} aria-label="Draft text" />
            <div className="flex justify-end">
              <Button
                variant="secondary"
                icon={<Copy />}
                onClick={async () => {
                  await navigator.clipboard.writeText(text).catch(() => undefined);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy text'}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
