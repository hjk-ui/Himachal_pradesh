'use client';

/**
 * Record one care gap action (POST /api/medical/care-gaps). The allowed actions come from the
 * server (role rule): a Medical Assistant records only a patient report or outreach; the provider
 * records ordered / done elsewhere / declined / not applicable / done at this visit.
 */
import { useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { careGapDef, GAP_ACTION_LABEL, type GapAction } from '@/lib/medical/primaryCareWorkflow';
import { buttonClasses } from '@/components/ui';

export function CareGapActionForm({
  clientId,
  appointmentId,
  gapKey,
  actions,
  onSaved,
  compact = false,
}: {
  clientId: string;
  appointmentId?: string | null;
  gapKey: string;
  actions: GapAction[];
  onSaved: () => void;
  compact?: boolean;
}) {
  const usable = actions.filter((a) => a !== 'outreach' && a !== 'reopened');
  const [action, setAction] = useState<GapAction | ''>('');
  const [performedOn, setPerformedOn] = useState('');
  const [source, setSource] = useState('');
  const [reason, setReason] = useState('');
  const [kind, setKind] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const def = careGapDef(gapKey);
  if (!usable.length) return null;
  const needsDate = action === 'done_elsewhere' || action === 'reported_elsewhere';
  const needsKind = Boolean(def?.kinds) && (action === 'done_elsewhere' || action === 'completed');

  const save = async () => {
    if (!action) return;
    setBusy(true);
    setError('');
    try {
      await apiJson('/api/medical/care-gaps', {
        method: 'POST',
        body: JSON.stringify({
          clientId,
          appointmentId: appointmentId || null,
          gapKey,
          action,
          performedOn: needsDate ? performedOn : null,
          source: needsDate ? source : null,
          reason: action === 'not_applicable' || action === 'refused' ? reason : null,
          kind: needsKind ? kind : null,
        }),
      });
      setAction('');
      setPerformedOn('');
      setSource('');
      setReason('');
      setKind('');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const input = 'rounded-lg border border-slate-200 px-2 py-1 text-xs outline-none focus:border-blue-600';
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? '' : 'mt-1.5'}`}>
      <select aria-label="Care gap action" value={action} onChange={(e) => setAction(e.target.value as GapAction | '')} className={input}>
        <option value="">Record…</option>
        {usable.map((a) => (
          <option key={a} value={a}>
            {GAP_ACTION_LABEL[a]}
          </option>
        ))}
      </select>
      {needsKind && def?.kinds ? (
        <select aria-label="Test type" value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
          <option value="">Test type…</option>
          {def.kinds.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      ) : null}
      {needsDate ? (
        <>
          <input type="date" aria-label="Date done" value={performedOn} onChange={(e) => setPerformedOn(e.target.value)} className={input} />
          <input aria-label="Where it was done" placeholder="Where (source)" value={source} onChange={(e) => setSource(e.target.value)} className={`${input} w-40`} />
        </>
      ) : null}
      {action === 'not_applicable' || action === 'refused' ? (
        <input
          aria-label="Reason"
          placeholder={action === 'not_applicable' ? 'Reason (required)' : 'Reason (optional)'}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className={`${input} w-48`}
        />
      ) : null}
      {action ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className={buttonClasses({ size: 'sm' })}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      ) : null}
      {action === 'reported_elsewhere' ? <span className="text-[11px] text-slate-500">Recorded as patient-reported; the provider verifies and closes the gap.</span> : null}
      {error ? <span className="text-[11px] font-semibold text-rose-700">{error}</span> : null}
    </div>
  );
}
