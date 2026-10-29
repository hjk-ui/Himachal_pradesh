'use client';
import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import type { ClaimRecord } from '@/features/billing/claimsApi';

type SftpInfo = { active: boolean; usageIndicator?: 'T' | 'P'; statusLine?: string | null; configProblems?: string[] };
type SftpResult = { claimId: string; displayId: string; success: boolean; errors?: string[]; error?: string; dryRun?: boolean; batchId?: string };
type SftpOutcome = {
  dryRun: boolean;
  usageIndicator: 'T' | 'P';
  batch: null | { batchId: string; fileName: string; transferId: string; claimCount: number; totalCharges: number; delivery: 'completed' | 'unconfirmed'; deliveryNote?: string };
  configProblems: string[];
  results: SftpResult[];
};

function sendConfirmText(count: number, usage: 'T' | 'P' | undefined) {
  return usage === 'P'
    ? `Send ${count} claim${count === 1 ? '' : 's'} to Waystar in PRODUCTION (ISA15=P)? Payers will adjudicate them.`
    : `Send ${count} claim${count === 1 ? '' : 's'} to the Waystar test account (ISA15=T)?`;
}

export function ClaimsClearinghousePanel({ claims, selected, onChanged }: { claims: ClaimRecord[]; selected: ClaimRecord | null; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState('loading');
  const [sftp, setSftp] = useState<SftpInfo>({ active: false });
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [outcome, setOutcome] = useState<SftpOutcome | null>(null);
  useEffect(() => {
    apiJson<{ mode: string; waystarSftp?: SftpInfo }>('/api/billing/claims/batch-submit')
      .then(data => { setMode(data.mode); setSftp(data.waystarSftp ?? { active: false }); })
      .catch(() => setMode('unavailable'));
  }, []);
  const eligible = claims.filter(claim => (sftp.active ? claim.status === 'READY' : ['DRAFT', 'READY', 'DENIED'].includes(claim.status)) && !claim.submissionInProgress);
  async function batch() {
    setBusy(true); setMessage(''); setOutcome(null);
    try {
      const data = await apiJson<{ results: { claimId: string; success: boolean; error?: string; demoMode?: boolean }[] }>('/api/billing/claims/batch-submit', { method: 'POST', body: JSON.stringify({ claimIds: ids }) });
      setMessage(data.results.map(result => `${claims.find(claim => claim.id === result.claimId)?.displayId ?? result.claimId}: ${result.success ? result.demoMode ? 'DEMO only' : 'Submitted' : result.error}`).join('\n'));
      setIds([]); await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Submission failed'); }
    finally { setBusy(false); }
  }
  async function sftpBatch(dryRun: boolean) {
    if (!dryRun && !window.confirm(sendConfirmText(ids.length, sftp.usageIndicator))) return;
    setBusy(true); setMessage(''); setOutcome(null);
    try {
      const data = await apiJson<SftpOutcome>('/api/billing/claims/batch-submit', { method: 'POST', body: JSON.stringify({ claimIds: ids, dryRun }) });
      setOutcome(data);
      if (!dryRun && data.batch) setIds(previous => previous.filter(id => !data.results.some(r => r.claimId === id && r.success)));
      await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Submission failed'); }
    finally { setBusy(false); }
  }
  const statusTone = sftp.active
    ? sftp.usageIndicator === 'P' ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-200' : 'bg-violet-50 text-[#5C2D91] ring-1 ring-violet-200'
    : mode === 'configured' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900';
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="font-bold">Claims clearinghouse</h2>
    <p className={`rounded-lg p-3 text-sm ${statusTone}`}>
      {sftp.active
        ? <><span className="font-bold">{sftp.statusLine}</span> Only READY claims are sent. Selected claims go out together in one 837 file; claims that fail the pre-send checks stay here with the reason.</>
        : mode === 'demo' ? 'DEMO: no claims are sent to a payer, and claim statuses remain unchanged.' : mode === 'configured' ? 'Clearinghouse configured. Submissions use the selected claims and saved billing details.' : 'Clearinghouse is not available. You can prepare claims and save their billing details.'}
      {!sftp.active && sftp.statusLine ? <span className="mt-1 block text-xs">{sftp.statusLine}</span> : null}
    </p>
    {sftp.active && sftp.configProblems?.length ? (
      <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
        <p className="font-bold">Billing setup blocks sending until fixed on the server:</p>
        <ul className="mt-1 list-disc pl-5">{sftp.configProblems.map(problem => <li key={problem}>{problem}</li>)}</ul>
      </div>
    ) : null}
    <details><summary className="cursor-pointer text-sm font-semibold">Select claims for batch submission (maximum 50{sftp.active ? ', READY only' : ''})</summary>
      <div className="my-3 grid max-h-52 gap-2 overflow-y-auto sm:grid-cols-2">{eligible.map(claim => <label key={claim.id} className="flex gap-2 text-sm">
        <input type="checkbox" checked={ids.includes(claim.id)} disabled={busy || (!ids.includes(claim.id) && ids.length >= 50)} onChange={event => setIds(previous => event.target.checked ? [...previous, claim.id] : previous.filter(id => id !== claim.id))} />
        {claim.displayId} · {claim.clientName}
      </label>)}</div>
      {eligible.length === 0 ? <p className="my-3 text-sm text-slate-500">No {sftp.active ? 'READY ' : ''}claims to select.</p> : null}
      {sftp.active ? (
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !ids.length} onClick={() => void sftpBatch(true)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50">{busy ? 'Working…' : `Run pre-send check (${ids.length})`}</button>
          <button disabled={busy || !ids.length || Boolean(sftp.configProblems?.length)} onClick={() => void sftpBatch(false)} className="rounded-lg bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sending…' : `Send ${ids.length} to Waystar in one batch`}</button>
        </div>
      ) : (
        <button disabled={busy || !ids.length || !['configured', 'demo'].includes(mode)} onClick={() => void batch()} className="rounded-lg bg-purple-800 px-4 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Submitting…' : `Submit selected (${ids.length})`}</button>
      )}
    </details>
    {outcome ? <SftpOutcomeView outcome={outcome} /> : null}
    {selected && <ClaimSubmissionForm key={`${selected.id}:${selected.updatedAt}`} claim={selected} enabled={['configured', 'demo'].includes(mode) && !(sftp.active && sftp.configProblems?.length)} sftp={sftp} onChanged={onChanged} />}
    {message && <p role="status" className="whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm">{message}</p>}
  </section>;
}

function SftpOutcomeView({ outcome }: { outcome: SftpOutcome }) {
  const failed = outcome.results.filter(result => !result.success);
  const passed = outcome.results.filter(result => result.success);
  return <div role="status" className="space-y-3 rounded-lg bg-slate-50 p-3 text-sm">
    {outcome.dryRun ? (
      <p className="font-bold text-slate-800">Pre-send check: {passed.length} ready to send, {failed.length} blocked. Nothing was sent.</p>
    ) : outcome.batch ? (
      <div>
        <p className="font-bold text-emerald-800">Sent {outcome.batch.claimCount} claim{outcome.batch.claimCount === 1 ? '' : 's'} to Waystar ({outcome.usageIndicator === 'P' ? 'production' : 'test, ISA15=T'}).</p>
        <p className="text-xs text-slate-600">Batch {outcome.batch.batchId} · file {outcome.batch.fileName} · transfer {outcome.batch.transferId} · ${outcome.batch.totalCharges.toFixed(2)}</p>
        <p className={`text-xs ${outcome.batch.delivery === 'completed' ? 'text-emerald-700' : 'text-amber-800'}`}>
          {outcome.batch.delivery === 'completed' ? 'Delivered to Waystar /Upload.' : outcome.batch.deliveryNote || 'Delivery not yet confirmed.'}
        </p>
      </div>
    ) : (
      <p className="font-bold text-rose-800">Nothing was sent.</p>
    )}
    {failed.length ? (
      <div>
        <p className="font-semibold text-rose-800">Not sent ({failed.length})</p>
        <ul className="mt-1 space-y-2">{failed.map(result => <li key={result.claimId} className="rounded-md bg-white p-2 ring-1 ring-rose-100">
          <span className="font-bold text-slate-900">{result.displayId}</span>
          <ul className="mt-1 list-disc pl-5 text-rose-800">{(result.errors?.length ? result.errors : [result.error || 'Not sent']).map(error => <li key={error}>{error}</li>)}</ul>
        </li>)}</ul>
      </div>
    ) : null}
    {outcome.dryRun && passed.length ? <p className="text-emerald-800">Ready: {passed.map(result => result.displayId).join(', ')}</p> : null}
  </div>;
}

function ClaimSubmissionForm({ claim, enabled, sftp, onChanged }: { claim: ClaimRecord; enabled: boolean; sftp: SftpInfo; onChanged: () => Promise<void> }) {
  // Waystar payer ID: what staff saved, else the payer mapping (Billing > Payer settings)
  const mapped = claim.waystarPayer ?? null;
  const savedPayerId = claim.submissionData?.payerId ?? '';
  const [payerId, setPayerId] = useState(savedPayerId || mapped?.payerId || '');
  const [diagnoses, setDiagnoses] = useState(claim.submissionData?.diagnosisCodes?.join(', ') ?? '');
  const [place, setPlace] = useState(claim.submissionData?.placeOfService ?? '11');
  const [filing, setFiling] = useState<string>((savedPayerId ? claim.submissionData?.claimFilingCode : mapped?.claimFilingCode) ?? claim.submissionData?.claimFilingCode ?? 'CI');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const editable = ['DRAFT', 'READY', 'DENIED'].includes(claim.status) && !claim.submissionInProgress;
  const canSubmit = sftp.active ? claim.status === 'READY' && !claim.submissionInProgress : editable;
  const sent = claim.submissionData?.waystarSftp;
  async function action(kind: 'save' | 'submit' | 'status') {
    if (kind === 'submit' && sftp.active && !window.confirm(sendConfirmText(1, sftp.usageIndicator))) return;
    setBusy(true); setMessage('');
    try {
      if (kind !== 'status') await apiJson(`/api/billing/claims/${claim.id}/submission`, { method: 'PATCH', body: JSON.stringify({ payerId, diagnosisCodes: diagnoses.split(',').map(code => code.trim().toUpperCase()).filter(Boolean), placeOfService: place, claimFilingCode: filing }) });
      if (kind === 'submit') {
        const data = await apiJson<{ demoMode: boolean; batch?: { batchId: string; delivery: string } }>(`/api/billing/claims/${claim.id}/submit`, { method: 'POST' });
        setMessage(data.batch ? `Sent to Waystar in batch ${data.batch.batchId}${data.batch.delivery === 'completed' ? '' : ' (delivery not yet confirmed)'}.` : data.demoMode ? 'DEMO completed. No payer submission.' : 'Claim submitted.');
      } else if (kind === 'status') {
        const data = await apiJson<{ payerStatus: string }>(`/api/billing/claims/${claim.id}/status`);
        setMessage(data.payerStatus);
      } else setMessage('Billing details saved.');
      await onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Claim action failed');
      if (kind === 'submit') await onChanged();
    }
    finally { setBusy(false); }
  }
  return <div className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-bold">Submission details · {claim.displayId}{claim.claimControlNumber ? <span className="ml-2 font-mono text-xs font-normal text-slate-500">CLM01 {claim.claimControlNumber}</span> : null}</h3>
    {claim.frequencyCode === '7' || claim.frequencyCode === '8' ? (
      <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
        {claim.frequencyCode === '8' ? 'Void' : 'Corrected claim'} (frequency {claim.frequencyCode}) replacing payer claim {claim.payerClaimControlNumber || '(number missing)'}.
      </p>
    ) : null}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">{sftp.active ? 'Waystar payer ID' : 'Payer trading partner ID'}<input disabled={!editable} value={payerId} onChange={e => setPayerId(e.target.value)} className="mt-1 block w-full rounded border p-2" />
        {mapped ? (
          <span className={`mt-1 block text-xs ${mapped.verified ? 'text-slate-500' : 'text-amber-800'}`}>
            Mapping for {mapped.payerName}: {mapped.payerId}{mapped.verified ? '' : ' (unverified: test files only until confirmed)'}{payerId && payerId.toUpperCase() !== mapped.payerId ? ' · differs from what is entered' : ''}
          </span>
        ) : claim.payer ? (
          <span className="mt-1 block text-xs text-rose-700">No Waystar payer ID mapped for {claim.payer}. Add it in Billing &gt; Payer settings.</span>
        ) : null}
      </label>
      <label className="text-sm">ICD-10 codes, separated by commas<input disabled={!editable} value={diagnoses} onChange={e => setDiagnoses(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm">Place of service<input disabled={!editable} value={place} onChange={e => setPlace(e.target.value)} className="mt-1 block w-full rounded border p-2" /></label>
      <label className="text-sm">Insurance type<select disabled={!editable} value={filing} onChange={e => setFiling(e.target.value)} className="mt-1 block w-full rounded border p-2"><option value="CI">Commercial</option><option value="MC">Medicaid</option><option value="MB">Medicare</option><option value="BL">Blue Cross / Blue Shield</option>{['CI', 'MC', 'MB', 'BL'].includes(filing) ? null : <option value={filing}>{filing} (from payer mapping)</option>}</select></label>
    </div>
    <p className="text-xs text-slate-500">Tracking: {claim.clearinghouseClaimId || claim.availityClaimId || 'Not submitted'} {claim.clearinghouseDemo ? '(DEMO)' : ''}{claim.clearinghouseProvider ? ` · ${claim.clearinghouseProvider === 'waystar_sftp' ? 'Waystar SFTP' : claim.clearinghouseProvider}` : ''}</p>
    {sent ? (
      <div className="rounded-lg bg-violet-50 p-3 text-xs text-slate-700 ring-1 ring-violet-100">
        <p className="font-bold text-[#5C2D91]">Waystar batch {sent.batchId} ({sent.usageIndicator === 'P' ? 'production' : 'test'})</p>
        <p>File {sent.fileName} · sent {new Date(sent.sentAt).toLocaleString()} · {sent.delivery === 'completed' ? 'delivered' : sent.deliveryNote || 'delivery not confirmed'}</p>
        {sent.responses?.length ? (
          <ul className="mt-1 space-y-1">{sent.responses.slice(-5).map(response => <li key={`${response.file}:${response.at}`} className={response.accepted === false ? 'text-rose-800' : response.accepted ? 'text-emerald-800' : ''}>
            {response.type} {response.accepted === true ? 'accepted' : response.accepted === false ? 'rejected' : 'received'}: {response.reason}
          </li>)}</ul>
        ) : <p className="mt-1">No 999 / 277CA applied yet.</p>}
      </div>
    ) : null}
    {claim.submissionError && <p role="alert" className="text-sm text-red-700">{claim.submissionError}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !editable} onClick={() => void action('save')} className="rounded bg-slate-100 px-3 py-2 text-sm disabled:opacity-50">Save billing details</button>
      <button disabled={busy || !canSubmit || !enabled} onClick={() => void action('submit')} className="rounded bg-purple-800 px-3 py-2 text-sm text-white disabled:opacity-50">{sftp.active ? 'Send to Waystar' : 'Submit claim'}</button>
      <button disabled={busy || !(claim.clearinghouseClaimId || claim.availityClaimId)} onClick={() => void action('status')} className="rounded bg-slate-100 px-3 py-2 text-sm disabled:opacity-50">{sent ? 'Last Waystar response' : 'Check payer status (277)'}</button>
    </div>
    {sftp.active && claim.status !== 'READY' && editable ? <p className="text-xs text-slate-500">Mark the claim ready to send it to Waystar.</p> : null}
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>;
}
