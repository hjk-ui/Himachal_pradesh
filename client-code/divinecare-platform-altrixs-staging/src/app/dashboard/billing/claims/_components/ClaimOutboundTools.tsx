'use client';

import { useCallback, useEffect, useState } from 'react';
import { Ban, FilePlus2, Loader2, PencilLine, Undo2 } from 'lucide-react';
import {
  cancelClaimCorrection,
  createSecondaryClaim,
  fetchClaimCob,
  fetchClaimCoverages,
  saveClaimCob,
  saveClaimCoverage,
  startClaimCorrection,
  type CasAdjustmentInput,
  type ClaimCoverages,
  type ClaimRecord,
  type CobSource,
  type CoverageRecordUi,
} from '@/features/billing/claimsApi';
import { buttonClasses, cx, FOCUS_RING, inputClasses, Tabs } from '@/components/ui';

const FIELD = cx(inputClasses, 'mt-1');
const SECONDARY_SM = buttonClasses({ variant: 'secondary', size: 'sm' });
const PRIMARY_SM = buttonClasses({ variant: 'primary', size: 'sm' });

const RANK_LABEL: Record<string, string> = { P: 'Primary', S: 'Secondary', T: 'Tertiary' };
const FREQUENCY_LABEL: Record<string, string> = { '1': 'Original', '7': 'Corrected (replacement)', '8': 'Void' };
const RELATIONSHIPS: Array<[string, string]> = [
  ['18', 'Self (patient is the policyholder)'],
  ['01', 'Spouse'],
  ['19', 'Child'],
  ['53', 'Life partner'],
  ['20', 'Employee'],
  ['G8', 'Other relationship'],
  ['21', 'Unknown'],
];
const SENT = ['SUBMITTED', 'ACCEPTED', 'DENIED', 'PAID'];

function errorText(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Waystar outbound actions for one claim: corrected / void claims (CLM05-3 7/8 + REF*F8),
 * secondary / tertiary claims with COB, and the client's insurance coverages (policyholder).
 */
export function ClaimOutboundTools({ claim, onChanged }: { claim: ClaimRecord; onChanged: (row?: ClaimRecord) => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const rank = claim.payerResponsibility || 'P';
  const frequency = claim.frequencyCode || '1';
  const correction = claim.submissionData?.correction;
  const pendingCorrection = claim.status === 'READY' && Boolean(correction) && !claim.submissionInProgress;
  const canCorrect = SENT.includes(claim.status) && !claim.submissionInProgress && Boolean(claim.clearinghouseClaimId || claim.availityClaimId);
  const canCreateNext = ['ACCEPTED', 'PAID', 'DENIED'].includes(claim.status) && rank !== 'T';

  async function act(fn: () => Promise<ClaimRecord>, ok: string) {
    setBusy(true);
    setMessage(null);
    try {
      const row = await fn();
      setMessage({ tone: 'ok', text: ok });
      await onChanged(row);
    } catch (error) {
      setMessage({ tone: 'error', text: errorText(error, 'Claim action failed') });
    } finally {
      setBusy(false);
    }
  }

  function correct(kind: 'replace' | 'void') {
    const what = kind === 'replace' ? 'corrected (replacement) claim' : 'void';
    const pcn = window.prompt(
      `Payer claim control number (ICN / DCN) of the original claim, sent as REF*F8 on the ${what}:`,
      claim.payerClaimControlNumber || ''
    );
    if (pcn == null) return;
    const detail = kind === 'replace'
      ? 'The claim goes back to READY as a corrected claim (frequency 7) under a new claim number. Fix what needs fixing, then send it to Waystar.'
      : 'The claim goes back to READY as a void (frequency 8) under a new claim number. Send it to Waystar to void the original with the payer.';
    if (!window.confirm(detail)) return;
    void act(
      () => startClaimCorrection(claim.id, kind, pcn.trim() || null),
      kind === 'replace' ? 'Ready to send as a corrected claim (frequency 7).' : 'Ready to send as a void (frequency 8).'
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-4 text-sm">
      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Waystar 837</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 break-words text-xs">
        <dt className="text-slate-500">Claim number (CLM01)</dt>
        <dd className="text-right font-mono font-semibold text-slate-800">{claim.claimControlNumber || '—'}</dd>
        <dt className="text-slate-500">Billed to</dt>
        <dd className="text-right font-semibold text-slate-800">{RANK_LABEL[rank] || rank} payer</dd>
        <dt className="text-slate-500">Frequency</dt>
        <dd className={`text-right font-semibold ${frequency === '8' ? 'text-rose-700' : frequency === '7' ? 'text-amber-700' : 'text-slate-800'}`}>{FREQUENCY_LABEL[frequency] || frequency}</dd>
        <dt className="text-slate-500">Payer claim number</dt>
        <dd className="text-right font-mono text-slate-800">{claim.payerClaimControlNumber || '—'}</dd>
        <dt className="text-slate-500">Prior auth (REF*G1)</dt>
        <dd className="text-right text-slate-800">{claim.priorAuthNumber || 'from approved auths at send'}</dd>
      </dl>

      {pendingCorrection ? (
        <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900 ring-1 ring-amber-200">
          <p className="font-semibold">{correction?.kind === 'void' ? 'Void' : 'Corrected claim'} not sent yet.</p>
          <p>It goes out with the next Waystar send of READY claims.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => cancelClaimCorrection(claim.id), 'Correction cancelled; the claim is back to its previous status.')}
            className={cx(SECONDARY_SM, 'mt-2')}
          >
            <Undo2 size={14} aria-hidden /> Cancel {correction?.kind === 'void' ? 'void' : 'correction'}
          </button>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canCorrect ? (
          <>
            <button type="button" disabled={busy} onClick={() => correct('replace')} className={SECONDARY_SM}>
              <PencilLine size={14} aria-hidden /> Send corrected claim
            </button>
            <button type="button" disabled={busy} onClick={() => correct('void')} className={cx(SECONDARY_SM, 'text-rose-700 hover:text-rose-800')}>
              <Ban size={14} aria-hidden /> Void claim
            </button>
          </>
        ) : null}
        {canCreateNext ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => createSecondaryClaim(claim.id), `${rank === 'P' ? 'Secondary' : 'Tertiary'} claim created as DRAFT.`)}
            className={SECONDARY_SM}
          >
            <FilePlus2 size={14} aria-hidden /> Create {rank === 'P' ? 'secondary' : 'tertiary'} claim
          </button>
        ) : null}
      </div>
      {busy ? <p className="flex items-center gap-1 text-xs text-slate-500"><Loader2 size={14} aria-hidden className="animate-spin" /> Working…</p> : null}
      {message ? <p role="status" className={`text-xs ${message.tone === 'ok' ? 'text-emerald-800' : 'text-rose-700'}`}>{message.text}</p> : null}

      {rank !== 'P' ? <CobEditor key={`${claim.id}:${claim.updatedAt}`} claim={claim} onChanged={onChanged} /> : null}
      <CoverageEditor key={`cov:${claim.id}`} claim={claim} />
    </div>
  );
}

// ─── COB (previous payer adjudication) ───────────────────────────────────────

function CobEditor({ claim, onChanged }: { claim: ClaimRecord; onChanged: (row?: ClaimRecord) => Promise<void> | void }) {
  const prevRank = claim.payerResponsibility === 'T' ? 'S' : 'P';
  const [source, setSource] = useState<CobSource | null>(null);
  const [paid, setPaid] = useState('');
  const [paidDate, setPaidDate] = useState('');
  const [adjustments, setAdjustments] = useState<Array<{ group: CasAdjustmentInput['group']; reason: string; amount: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const editable = ['DRAFT', 'READY', 'DENIED'].includes(claim.status) && !claim.submissionInProgress;

  useEffect(() => {
    fetchClaimCob(claim.id)
      .then((data) => {
        setSource(data);
        const staff = data.staff?.[prevRank];
        if (staff) {
          setPaid(String(staff.paidAmount));
          setPaidDate(staff.paidDate);
          setAdjustments(staff.adjustments.map((a) => ({ group: a.group, reason: a.reason, amount: String(a.amount) })));
        }
      })
      .catch((error) => setMessage(errorText(error, 'Could not load COB details')));
  }, [claim.id, prevRank]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const row = await saveClaimCob(claim.id, {
        rank: prevRank,
        paidAmount: Number(paid),
        paidDate,
        adjustments: adjustments.filter((a) => a.reason.trim()).map((a) => ({ group: a.group, reason: a.reason.trim().toUpperCase(), amount: Number(a.amount) })),
      });
      setMessage('COB saved.');
      await onChanged(row);
    } catch (error) {
      setMessage(errorText(error, 'Could not save COB'));
    } finally {
      setBusy(false);
    }
  }

  const charge = ((claim.amountCents ?? 0) / 100).toFixed(2);
  return (
    <details className="rounded-lg bg-slate-50 p-3" open={!source?.era}>
      <summary className={cx('cursor-pointer rounded text-xs font-semibold text-slate-700', FOCUS_RING)}>
        {RANK_LABEL[prevRank]} payer adjudication (COB, loop 2320)
      </summary>
      {source?.era ? (
        <div className="mt-2 text-xs text-emerald-900">
          <p className="font-semibold">Taken from the {RANK_LABEL[prevRank].toLowerCase()} payer 835 at send time.</p>
          <p>Paid ${source.era.paidAmount.toFixed(2)} on {source.era.paidDate}; adjustments {source.era.adjustments.map((a) => `${a.group}-${a.reason} $${a.amount.toFixed(2)}`).join(', ') || 'none at claim level'}.</p>
        </div>
      ) : (
        <div className="mt-2 space-y-2 text-xs">
          <p className="text-slate-600">
            No 835 is posted for the {RANK_LABEL[prevRank].toLowerCase()} claim{source?.previousPayer ? ` (${source.previousPayer})` : ''}. Enter its EOB: charge ${charge} must equal paid + adjustments.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>Paid amount<input disabled={!editable} inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} className={FIELD} /></label>
            <label>Paid / adjudication date<input disabled={!editable} type="date" value={paidDate} onChange={(e) => setPaidDate(e.target.value)} className={FIELD} /></label>
          </div>
          {adjustments.map((a, i) => (
            <div key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-2">
              <label>Group<select disabled={!editable} value={a.group} onChange={(e) => setAdjustments((p) => p.map((x, j) => (j === i ? { ...x, group: e.target.value as CasAdjustmentInput['group'] } : x)))} className={FIELD}>
                {['CO', 'PR', 'OA', 'PI', 'CR'].map((g) => <option key={g} value={g}>{g}</option>)}
              </select></label>
              <label>Reason (CARC)<input disabled={!editable} value={a.reason} onChange={(e) => setAdjustments((p) => p.map((x, j) => (j === i ? { ...x, reason: e.target.value } : x)))} className={FIELD} placeholder="45" /></label>
              <label>Amount<input disabled={!editable} inputMode="decimal" value={a.amount} onChange={(e) => setAdjustments((p) => p.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} className={FIELD} /></label>
              <button type="button" disabled={!editable} onClick={() => setAdjustments((p) => p.filter((_, j) => j !== i))} className={buttonClasses({ variant: 'ghost', size: 'sm', className: 'text-rose-700 hover:text-rose-800' })} aria-label="Remove adjustment">Remove</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={!editable} onClick={() => setAdjustments((p) => [...p, { group: 'CO', reason: '', amount: '' }])} className={SECONDARY_SM}>Add adjustment</button>
            <button type="button" disabled={!editable || busy || !paid || !paidDate} onClick={() => void save()} className={PRIMARY_SM}>{busy ? 'Saving…' : 'Save COB'}</button>
          </div>
        </div>
      )}
      {message ? <p role="status" className="mt-2 text-xs text-slate-700">{message}</p> : null}
    </details>
  );
}

// ─── Coverages (policyholder / secondary / tertiary) ─────────────────────────

const EMPTY: CoverageRecordUi = {
  rank: 'P', payerName: null, memberId: null, groupNumber: null, claimFilingCode: null, subscriberRelationship: '18',
  subscriberFirstName: null, subscriberLastName: null, subscriberMiddleInitial: null, subscriberDob: null, subscriberGender: null, active: true,
};

function CoverageEditor({ claim }: { claim: ClaimRecord }) {
  const [data, setData] = useState<ClaimCoverages | null>(null);
  const [rank, setRank] = useState<'P' | 'S' | 'T'>('P');
  const [form, setForm] = useState<CoverageRecordUi>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const pick = useCallback((d: ClaimCoverages, r: 'P' | 'S' | 'T') => {
    setForm(d.coverages.find((c) => c.rank === r) ?? { ...EMPTY, rank: r });
  }, []);

  const load = useCallback(() => {
    fetchClaimCoverages(claim.id)
      .then((d) => { setData(d); pick(d, rank); })
      .catch((error) => setMessage(errorText(error, 'Could not load coverages')));
  }, [claim.id, pick, rank]);

  async function save() {
    setBusy(true);
    setMessage('');
    try {
      const d = await saveClaimCoverage(claim.id, { ...form, rank });
      setData(d);
      pick(d, rank);
      setMessage('Coverage saved.');
    } catch (error) {
      setMessage(errorText(error, 'Could not save coverage'));
    } finally {
      setBusy(false);
    }
  }

  const set = (patch: Partial<CoverageRecordUi>) => setForm((f) => ({ ...f, ...patch }));
  const dependent = form.subscriberRelationship !== '18';
  return (
    <details className="rounded-lg bg-slate-50 p-3" onToggle={(e) => { if ((e.target as HTMLDetailsElement).open && !data) load(); }}>
      <summary className={cx('cursor-pointer rounded text-xs font-semibold text-slate-700', FOCUS_RING)}>Insurance policyholder and other coverage</summary>
      <div className="mt-2 space-y-2 text-xs">
        <Tabs
          variant="pill"
          label="Coverage rank"
          controlsPanels={false}
          value={rank}
          onChange={(r) => { setRank(r); if (data) pick(data, r); }}
          items={(['P', 'S', 'T'] as const).map((r) => ({ key: r, label: RANK_LABEL[r] }))}
        />
        {rank === 'P' ? (
          <p className="text-slate-600">
            Payer and member ID come from the client record: {data?.primaryOnClient.payerName || 'no payer'} · {data?.primaryOnClient.memberId || 'no member ID'}.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>Payer<input value={form.payerName ?? ''} onChange={(e) => set({ payerName: e.target.value })} className={FIELD} /></label>
            <label>Member ID<input value={form.memberId ?? ''} onChange={(e) => set({ memberId: e.target.value })} className={FIELD} /></label>
            <label>Group number<input value={form.groupNumber ?? ''} onChange={(e) => set({ groupNumber: e.target.value })} className={FIELD} /></label>
            <label>Filing code (optional)<input value={form.claimFilingCode ?? ''} onChange={(e) => set({ claimFilingCode: e.target.value.toUpperCase() })} placeholder="from payer mapping" className={FIELD} /></label>
          </div>
        )}
        <label className="block">Patient relationship to the policyholder
          <select value={form.subscriberRelationship} onChange={(e) => set({ subscriberRelationship: e.target.value })} className={FIELD}>
            {RELATIONSHIPS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        {dependent ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label>Policyholder first name<input value={form.subscriberFirstName ?? ''} onChange={(e) => set({ subscriberFirstName: e.target.value })} className={FIELD} /></label>
            <label>Last name<input value={form.subscriberLastName ?? ''} onChange={(e) => set({ subscriberLastName: e.target.value })} className={FIELD} /></label>
            <label>Middle initial<input maxLength={1} value={form.subscriberMiddleInitial ?? ''} onChange={(e) => set({ subscriberMiddleInitial: e.target.value })} className={FIELD} /></label>
            <label>Date of birth<input type="date" value={form.subscriberDob ?? ''} onChange={(e) => set({ subscriberDob: e.target.value })} className={FIELD} /></label>
            <label>Sex<select value={form.subscriberGender ?? ''} onChange={(e) => set({ subscriberGender: e.target.value })} className={FIELD}>
              <option value="">—</option><option value="F">Female</option><option value="M">Male</option><option value="U">Unknown</option>
            </select></label>
          </div>
        ) : null}
        {rank !== 'P' ? (
          <label className="flex items-center gap-2"><input className="h-4 w-4 rounded border-slate-300 text-blue-600 focus-visible:ring-2 focus-visible:ring-blue-600" type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label>
        ) : null}
        <button type="button" disabled={busy || !data} onClick={() => void save()} className={PRIMARY_SM}>{busy ? 'Saving…' : 'Save coverage'}</button>
        {message ? <p role="status" className="text-slate-700">{message}</p> : null}
      </div>
    </details>
  );
}
