'use client';

/**
 * "Send measure" (chart Assessments & outcomes): choose any patient-completable measures and how to
 * deliver them: secure link by email / text, or the patient portal (Questionnaires). One request =
 * one link. Consent, date of birth on the chart and 42 CFR Part 2 are checked server-side
 * (POST /api/clinical/measure-requests). Messages carry no PHI: no measure names, only "a short
 * questionnaire" and the link.
 */
import { useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Modal, cx } from '@/components/ui';
import { sendableInstruments } from '@/lib/measures/instruments';

type Channel = 'email' | 'sms' | 'portal';

const CHANNELS: { key: Channel; label: string; hint: string }[] = [
  { key: 'email', label: 'Email', hint: 'Secure link; email on file, not opted out' },
  { key: 'sms', label: 'Text message', hint: 'Secure link; text consent on file' },
  { key: 'portal', label: 'Patient portal', hint: 'Listed under Questionnaires for an active portal login' },
];

export function SendMeasureModal({ clientId, preselect, onClose, onSent }: { clientId: string; preselect?: string[]; onClose: () => void; onSent: (message: string, ok: boolean) => void }) {
  const instruments = useMemo(() => sendableInstruments(), []);
  const [picked, setPicked] = useState<string[]>(preselect?.filter((id) => instruments.some((i) => i.id === id)) ?? []);
  const [channels, setChannels] = useState<Channel[]>(['email', 'sms', 'portal']);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = instruments.filter((i) => !filter.trim() || `${i.name} ${i.fullName} ${i.category}`.toLowerCase().includes(filter.trim().toLowerCase()));
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  async function send() {
    if (!picked.length || !channels.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/clinical/measure-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, instrumentIds: picked, channels }),
      });
      const data = await res.json().catch(() => ({}));
      const failed = Array.isArray(data.results) ? (data.results as { ok: boolean; message: string }[]).filter((r) => !r.ok).map((r) => r.message) : [];
      const text = [data.message || data.error || (res.ok ? 'Done' : `Could not send (${res.status})`), ...failed].join(' ');
      if (data.success) {
        onSent(text, true);
        onClose();
      } else {
        setError(text);
      }
    } catch {
      setError('Could not send (network error).');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Send measure"
      size="md"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Send />} onClick={() => void send()} disabled={busy || !picked.length || !channels.length}>
            {busy ? 'Sending…' : `Send ${picked.length || ''}`.trim()}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          The patient gets one secure link for everything you pick. The message only says they have a short questionnaire; the link asks for their date of birth first. Clinician-rated and licensed measures are given in session.
        </p>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Measures ({picked.length} chosen)</legend>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter (e.g. PHQ, anxiety)"
            aria-label="Filter measures"
            className="mb-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200">
            {shown.map((i) => (
              <label key={i.id} className="flex cursor-pointer items-start gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-0 hover:bg-slate-50">
                <input type="checkbox" className="mt-0.5" checked={picked.includes(i.id)} onChange={() => setPicked((p) => toggle(p, i.id))} />
                <span className="min-w-0">
                  <span className="font-semibold text-slate-900">{i.name}</span> <span className="text-slate-600">{i.fullName}</span>
                  <span className="block text-xs text-slate-500">{i.category} · {i.questionCount} items · {i.estimatedTime}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium text-slate-700">Send by</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {CHANNELS.map((c) => (
              <label key={c.key} className={cx('flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm', channels.includes(c.key) ? 'border-blue-300 bg-blue-50' : 'border-slate-200')}>
                <input type="checkbox" className="mt-0.5" checked={channels.includes(c.key)} onChange={() => setChannels((x) => toggle(x, c.key))} />
                <span>
                  <span className="font-semibold text-slate-900">{c.label}</span>
                  <span className="block text-xs text-slate-500">{c.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error ? <p className="text-sm text-rose-700">{error}</p> : null}
      </div>
    </Modal>
  );
}
