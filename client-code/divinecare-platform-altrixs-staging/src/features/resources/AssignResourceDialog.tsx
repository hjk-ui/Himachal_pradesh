'use client';

import { useState } from 'react';
import { Loader2, Search, Send, ShieldAlert } from 'lucide-react';
import { ClinicalModal } from '@/components/clinic/ClinicalModal';
import { FormField } from '@/components/ui';
import { useClients } from '@/features/clients';
import { RESOURCE_NOTIFICATION_BODY } from '@/lib/resources/rules';
import { assignResource } from './api';

const inputCls = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

export type AssignTarget = { id: string; name: string };

/**
 * Send one library item to a client's portal. With a preset client (opened from a chart, note or
 * scribe follow-up) the only step left is Send, so "Assign to client" is two clicks.
 */
export function AssignResourceDialog({
  item,
  presetClient,
  context = 'library',
  contextId,
  sudContext,
  onClose,
  onAssigned,
}: {
  item: { id: string; title: string; sudRelated: boolean };
  presetClient?: AssignTarget | null;
  context?: 'library' | 'chart' | 'note' | 'scribe' | 'sdoh';
  contextId?: string | null;
  sudContext?: boolean;
  onClose: () => void;
  onAssigned: (message: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [client, setClient] = useState<AssignTarget | null>(presetClient ?? null);
  const [message, setMessage] = useState('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { clients, loading } = useClients({ page: 0, pageSize: 20, search: search.trim() || undefined, status: 'ACTIVE' });

  async function send() {
    if (!client) return;
    setBusy(true);
    setError('');
    try {
      await assignResource({ itemId: item.id, clientId: client.id, message: message.trim() || null, dueDate: due || null, context, contextId: contextId ?? null, sudContext });
      onAssigned(`Sent to ${client.name}'s portal`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the resource');
      setBusy(false);
    }
  }

  return (
    <ClinicalModal
      title="Send to client portal"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            disabled={!client || busy}
            className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4a2475] disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Send size={15} aria-hidden />} Send
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-700">
          <span className="font-semibold">{item.title}</span>
        </p>
        {client ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-[#5C2D91]/20 bg-[#5C2D91]/5 px-3 py-2.5">
            <span className="text-sm font-medium text-slate-900">{client.name}</span>
            {!presetClient && (
              <button type="button" onClick={() => setClient(null)} className="text-xs font-semibold text-[#5C2D91] hover:underline">
                Change
              </button>
            )}
          </div>
        ) : (
          <FormField label="Client" required hint="Clients in your caseload">
            {(control) => (
              <div>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input {...control} autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or MRN" className={`${inputCls} pl-9`} />
                </div>
                <ul className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-100" aria-label="Matching clients">
                  {loading && <li className="px-3 py-2 text-sm text-slate-500">Searching…</li>}
                  {!loading && clients.length === 0 && <li className="px-3 py-2 text-sm text-slate-500">No matching active clients</li>}
                  {!loading &&
                    clients.map((c) => (
                      <li key={c.id}>
                        <button type="button" onClick={() => setClient({ id: c.id, name: c.name })} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <span className="font-medium text-slate-900">{c.name}</span>
                          {c.mrn && <span className="text-xs text-slate-500">{c.mrn}</span>}
                        </button>
                      </li>
                    ))}
                </ul>
              </div>
            )}
          </FormField>
        )}
        <FormField label="Message to the client (optional)" hint="Shown with the resource inside the portal only.">
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={2000} className={inputCls} />
        </FormField>
        <FormField label="Please review by (optional)">
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
        </FormField>
        <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          The client is notified in the portal (and on their app if they registered a device) with only: &ldquo;{RESOURCE_NOTIFICATION_BODY}&rdquo; No text message or email is sent.
        </p>
        {(item.sudRelated || sudContext) && (
          <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> Substance use content: this assignment is recorded as 42 CFR Part 2. Its title never appears in a notification.
          </p>
        )}
        {error && <p role="alert" className="text-sm font-medium text-rose-700">{error}</p>}
      </div>
    </ClinicalModal>
  );
}
