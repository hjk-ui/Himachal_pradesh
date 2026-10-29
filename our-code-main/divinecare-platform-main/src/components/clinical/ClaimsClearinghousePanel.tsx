'use client';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { ClaimRecord } from '@/features/billing/claimsApi';

export function ClaimsClearinghousePanel({ claims, selected, onChanged }: { claims: ClaimRecord[]; selected: ClaimRecord | null; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState('loading');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => { apiJson<{ mode: string }>('/api/billing/claims/batch-submit').then(data => setMode(data.mode)).catch(() => setMode('unavailable')); }, []);
  const eligible = claims.filter(claim => ['DRAFT', 'READY', 'DENIED'].includes(claim.status) && !claim.submissionInProgress);
  async function batch() {
    setBusy(true); setMessage('');
    try {
      const data = await apiJson<{ results: { claimId: string; success: boolean; error?: string; demoMode?: boolean }[] }>('/api/billing/claims/batch-submit', { method: 'POST', body: JSON.stringify({ claimIds: ids }) });
      setMessage(data.results.map(result => `${claims.find(claim => claim.id === result.claimId)?.displayId ?? result.claimId}: ${result.success ? result.demoMode ? 'DEMO only' : 'Submitted' : result.error}`).join('\n'));
      setIds([]); await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Submission failed'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="font-bold">Claims clearinghouse</h2>
    <p className={`rounded-lg p-3 text-sm ${mode === 'configured' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>
      {mode === 'demo' ? 'DEMO: no claims are sent to a payer, and claim statuses remain unchanged.' : mode === 'configured' ? 'Clearinghouse configured. Submissions use the selected claims and saved billing details.' : 'Clearinghouse is not available. You can prepare claims and save their billing details.'}
    </p>
    <details><summary className="cursor-pointer text-sm font-semibold">Select claims for batch submission (maximum 50)</summary>
      <div className="my-3 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">{eligible.map(claim => <label key={claim.id} className="flex gap-2 text-sm">
        <input type="checkbox" checked={ids.includes(claim.id)} disabled={busy || (!ids.includes(claim.id) && ids.length >= 50)} onChange={event => setIds(previous => event.target.checked ? [...previous, claim.id] : previous.filter(id => id !== claim.id))} />
        {claim.displayId} · {claim.clientName}
      </label>)}</div>
      <button disabled={busy || !ids.length || !['configured', 'demo'].includes(mode)} onClick={() => void batch()} className="rounded-lg bg-purple-800 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Submitting…' : `Submit selected (${ids.length})`}</button>
    </details>
    {selected && <ClaimSubmissionForm key={`${selected.id}:${selected.updatedAt}`} claim={selected} enabled={['configured', 'demo'].includes(mode)} onChanged={onChanged} />}
    {message && <p role="status" className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
  </section>;
}
function ClaimSubmissionForm({ claim, enabled, onChanged }: { claim: ClaimRecord; enabled: boolean; onChanged: () => Promise<void> }) {
  const [payerId, setPayerId] = useState(claim.submissionData?.payerId ?? '');
  const [diagnoses, setDiagnoses] = useState(claim.submissionData?.diagnosisCodes.join(', ') ?? '');
  const [place, setPlace] = useState(claim.submissionData?.placeOfService ?? '11');
  const [filing, setFiling] = useState(claim.submissionData?.claimFilingCode ?? 'CI');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const editable = ['DRAFT', 'READY', 'DENIED'].includes(claim.status) && !claim.submissionInProgress;
  async function action(kind: 'save' | 'submit' | 'status') {
    setBusy(true); setMessage('');
    try {
      if (kind !== 'status') await apiJson(`/api/billing/claims/${claim.id}/submission`, { method: 'PATCH', body: JSON.stringify({ payerId, diagnosisCodes: diagnoses.split(',').map(code => code.trim().toUpperCase()).filter(Boolean), placeOfService: place, claimFilingCode: filing }) });
      if (kind === 'submit') {
        const data = await apiJson<{ demoMode: boolean }>(`/api/billing/claims/${claim.id}/submit`, { method: 'POST' });
        setMessage(data.demoMode ? 'DEMO completed. No payer submission.' : 'Claim submitted.');
      } else if (kind === 'status') {
        const data = await apiJson<{ payerStatus: string }>(`/api/billing/claims/${claim.id}/status`);
        setMessage(data.payerStatus);
      } else setMessage('Billing details saved.');
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Claim action failed'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-bold">Submission details · {claim.displayId}</h3>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Payer trading partner ID<input disabled={!editable} value={payerId} onChange={e => setPayerId(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm">ICD-10 codes, separated by commas<input disabled={!editable} value={diagnoses} onChange={e => setDiagnoses(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm">Place of service<input disabled={!editable} value={place} onChange={e => setPlace(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm">Insurance type<select disabled={!editable} value={filing} onChange={e => setFiling(e.target.value as typeof filing)} className="mt-1 block w-full rounded border p-2"><option value="CI">Commercial</option><option value="MC">Medicaid</option><option value="MB">Medicare</option><option value="BL">Blue Cross / Blue Shield</option></select></label>
    </div>
    <p className="text-xs text-slate-500">Tracking: {claim.clearinghouseClaimId || claim.availityClaimId || 'Not submitted'} {claim.clearinghouseDemo ? '(DEMO)' : ''}{claim.clearinghouseProvider ? ` · ${claim.clearinghouseProvider}` : ''}</p>
    {claim.submissionError && <p role="alert" className="text-sm text-red-700">{claim.submissionError}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !editable} onClick={() => void action('save')} className="rounded bg-slate-100 px-3 py-2 text-sm disabled:opacity-50">Save billing details</button>
      <button disabled={busy || !editable || !enabled} onClick={() => void action('submit')} className="rounded bg-purple-800 px-3 py-2 text-sm text-white disabled:opacity-50">Submit claim</button>
      <button disabled={busy || !(claim.clearinghouseClaimId || claim.availityClaimId)} onClick={() => void action('status')} className="rounded bg-slate-100 px-3 py-2 text-sm disabled:opacity-50">Check payer status (277)</button>
    </div>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
