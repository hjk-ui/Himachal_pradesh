'use client';

import { useState } from 'react';
import { BookCheck, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { Alert, Button, Modal as UiModal, cardClasses, cx } from '@/components/ui';

/**
 * Billing → Valant Balances: post Valant patient opening balances and prepayment credits to the Altrixs
 * ledger (dry-run preview, then confirm). Re-posting replaces earlier postings; "Unpost all" supersedes
 * them. Insurance A/R is never posted (Valant run-out).
 */

type KindStatus = {
  active: number; totalCents: number; asOf: string | null; sourceRef: string | null;
  lastPostedAt: string | null; lastPostedBy: string | null; byClient: Record<string, number>;
};
export type PostingStatus = {
  schemaReady: boolean;
  canPost: boolean;
  kinds: { opening_balance: KindStatus; prepayment_credit: KindStatus };
  lastUnpostedAt: string | null;
};
type Kind = 'opening_balance' | 'prepayment_credit';

type Who = { clientId: string | null; clientName: string | null; mrn: string | null };
type Preview = {
  kind: Kind;
  asOf: string | null;
  warning: string;
  counts: { post: number; replace: number; unchanged: number; added: number; removed: number; excluded: number };
  totals: { postCents: number; previousActiveCents: number; changeCents: number };
  diffs: (Who & { beforeCents: number | null; afterCents: number | null })[];
  expected: { asOf: string | null; count: number; totalCents: number };
  reconciliation: Record<string, number | boolean>;
  // opening balances
  reportTotalCents?: number | null;
  unmatched?: { valantPatientId: string; totalCents: number }[];
  zeroCount?: number;
  // prepayments
  periodStart?: string | null;
  periodEnd?: string | null;
  excluded?: (Who & { valantName: string; netCents: number; reason: string; reasonText: string })[];
};

const CHECKBOX = 'h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600';
const KIND_TITLE: Record<Kind, string> = { opening_balance: 'Patient opening balances', prepayment_credit: 'Prepayment credits' };

function Money({ cents }: { cents: number | null | undefined }) {
  return <span className={`tabular-nums ${cents != null && cents < 0 ? 'text-rose-700' : ''}`}>{formatCents(cents)}</span>;
}

export function ValantLedgerPostingPanel({ status, onChanged }: { status: PostingStatus | null; onChanged: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [unposting, setUnposting] = useState(false);

  if (!status) return null;
  if (!status.schemaReady) {
    return (
      <Alert tone="warning">
        The patient ledger table is not on this database yet (apply prisma/migrations/20261017_patient_ledger_entries.sql).
      </Alert>
    );
  }

  const runPreview = async (kind: Kind) => {
    setBusy(`preview-${kind}`);
    setError(null);
    setMessage(null);
    try {
      const d = await apiJson<{ preview: Preview | null; note?: string }>('/api/billing/valant-balances/ledger', {
        method: 'POST',
        body: JSON.stringify({ action: 'preview', kind }),
      });
      if (!d.preview) setMessage(d.note ?? 'Nothing to post');
      else setPreview(d.preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preview');
    } finally {
      setBusy(null);
    }
  };

  const post = async (p: Preview) => {
    setBusy('post');
    setError(null);
    try {
      const d = await apiJson<{ result: { posted: number; replaced: number; removed: number; totalCents: number } }>('/api/billing/valant-balances/ledger', {
        method: 'POST',
        body: JSON.stringify({ action: 'post', kind: p.kind, confirm: true, expected: p.expected }),
      });
      setPreview(null);
      setMessage(
        `${KIND_TITLE[p.kind]} posted: ${d.result.posted} patients, ${formatCents(d.result.totalCents)}` +
          (d.result.replaced || d.result.removed ? ` (replaced ${d.result.replaced}, removed ${d.result.removed} earlier postings)` : '')
      );
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not post');
    } finally {
      setBusy(null);
    }
  };

  const unpostAll = async () => {
    setBusy('unpost');
    setError(null);
    try {
      const d = await apiJson<{ result: { superseded: number } }>('/api/billing/valant-balances/ledger', {
        method: 'POST',
        body: JSON.stringify({ action: 'unpost', confirm: true }),
      });
      setUnposting(false);
      setMessage(`Unposted ${d.result.superseded} Valant ledger entries. History is kept.`);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unpost');
    } finally {
      setBusy(null);
    }
  };

  const anyPosted = status.kinds.opening_balance.active + status.kinds.prepayment_credit.active > 0;

  return (
    <div className={cx(cardClasses, 'p-4')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookCheck size={18} className="text-blue-600" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900">Posted to the Altrixs ledger</h2>
        </div>
        {status.canPost ? (
          <div className="flex flex-wrap gap-2">
            {(['opening_balance', 'prepayment_credit'] as const).map((k) => (
              <Button
                key={k}
                size="sm"
                variant="secondary"
                disabled={Boolean(busy)}
                onClick={() => void runPreview(k)}
                icon={busy === `preview-${k}` ? <Loader2 className="animate-spin" /> : undefined}
              >
                {k === 'opening_balance' ? 'Post patient opening balances' : 'Post prepayment credits'}
              </Button>
            ))}
            <Button
              size="sm"
              variant="ghost"
              disabled={Boolean(busy) || !anyPosted}
              onClick={() => setUnposting(true)}
              className="text-rose-700 hover:bg-rose-50 hover:text-rose-800"
            >
              Unpost all Valant postings
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Billing and practice leadership can post.</p>
        )}
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(['opening_balance', 'prepayment_credit'] as const).map((k) => {
          const s = status.kinds[k];
          return (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
              <p className="font-semibold text-slate-700">{KIND_TITLE[k]}</p>
              {s.active ? (
                <p className="mt-0.5 text-slate-600">
                  {s.active} patients · <Money cents={s.totalCents} /> · as of {s.asOf ?? '—'}
                </p>
              ) : (
                <p className="mt-0.5 text-slate-500">Not posted</p>
              )}
              {s.lastPostedAt ? (
                <p className="text-xs text-slate-500">
                  Last posted {new Date(s.lastPostedAt).toLocaleString()}{s.lastPostedBy ? ` by ${s.lastPostedBy}` : ''}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      {status.lastUnpostedAt && !anyPosted ? (
        <p className="mt-2 text-xs text-slate-500">Last unposted {new Date(status.lastUnpostedAt).toLocaleString()}</p>
      ) : null}
      {message ? <Alert tone="success" className="mt-3">{message}</Alert> : null}
      {error ? <Alert tone="danger" className="mt-3">{error}</Alert> : null}

      {preview ? <PreviewDialog p={preview} busy={busy === 'post'} onClose={() => setPreview(null)} onPost={() => void post(preview)} /> : null}

      {unposting ? (
        <Modal title="Unpost all Valant postings" onClose={() => setUnposting(false)}>
          <p className="text-sm text-slate-700">
            This removes every Valant opening balance ({status.kinds.opening_balance.active} patients, {formatCents(status.kinds.opening_balance.totalCents)}) and
            prepayment credit ({status.kinds.prepayment_credit.active} patients, {formatCents(status.kinds.prepayment_credit.totalCents)}) from patient balances.
            The entries are kept as history (marked unposted), never deleted. Payments, claims and statements already sent are not changed.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setUnposting(false)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={busy === 'unpost'} onClick={() => void unpostAll()}>
              {busy === 'unpost' ? 'Unposting…' : 'Unpost all'}
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <UiModal title={title} onClose={onClose} size="lg">
      {children}
    </UiModal>
  );
}

function PreviewDialog({ p, busy, onClose, onPost }: { p: Preview; busy: boolean; onClose: () => void; onPost: () => void }) {
  const [ack, setAck] = useState(false);
  const rec = p.reconciliation;
  const reconciles = Boolean(rec.reconciles);
  const isOpening = p.kind === 'opening_balance';
  return (
    <Modal title={`Dry run: ${KIND_TITLE[p.kind]}`} onClose={onClose}>
      <div className="space-y-3 text-xs text-slate-700">
        <p>
          {isOpening ? <>Current Patient Aging snapshot as of <b>{p.asOf}</b>.</> : <>Prepayments report {p.periodStart} to <b>{p.periodEnd}</b>.</>}{' '}
          Nothing is written until you post.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Patients to post" value={String(p.counts.post)} />
          <Stat label="Total to post" value={<Money cents={p.totals.postCents} />} />
          <Stat label="Replace earlier postings" value={`${p.counts.replace} (${p.counts.unchanged} unchanged)`} />
          <Stat label="Earlier postings removed" value={String(p.counts.removed)} />
          <Stat label="Currently posted total" value={<Money cents={p.totals.previousActiveCents} />} />
          <Stat label="Change" value={<Money cents={p.totals.changeCents} />} />
          <Stat label={isOpening ? 'Unmatched (not posted)' : 'Excluded (not posted)'} value={String(p.counts.excluded)} />
          {isOpening ? <Stat label="Matched with $0 total" value={String(p.zeroCount ?? 0)} /> : null}
        </div>

        <div className={`rounded-lg border px-3 py-2 ${reconciles ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-rose-200 bg-rose-50 text-rose-900'}`}>
          <p className="flex items-center gap-1 font-semibold">
            {reconciles ? <CheckCircle2 size={14} className="text-emerald-700" aria-hidden /> : <XCircle size={14} className="text-rose-700" aria-hidden />}
            {reconciles ? 'Reconciles' : 'Does not reconcile — posting is blocked'}
          </p>
          {isOpening ? (
            <p className="mt-0.5">
              Snapshot total <Money cents={rec.snapshotTotalCents as number} /> ({rec.snapshotRows as number} rows) = matched <Money cents={rec.matchedTotalCents as number} /> ({rec.matchedRows as number}) + unmatched{' '}
              <Money cents={rec.unmatchedTotalCents as number} /> ({rec.unmatchedRows as number}). Posted total = matched total.
              {p.reportTotalCents != null ? <> Valant report total <Money cents={p.reportTotalCents} />.</> : null}
            </p>
          ) : (
            <p className="mt-0.5">
              All rows net <Money cents={rec.allRowsNetCents as number} /> ({rec.transactions as number} rows) = posted patients net <Money cents={rec.postedNetCents as number} /> + excluded net{' '}
              <Money cents={rec.excludedNetCents as number} />. Each credit = minus the patient&apos;s net.
            </p>
          )}
        </div>

        {p.diffs.length ? (
          <details open={p.diffs.length <= 25}>
            <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Changes ({p.diffs.length})</summary>
            <div className="clinic-scroll-x">
            <table className="mt-1 min-w-full">
              <thead className="text-slate-600">
                <tr>
                  <th scope="col" className="py-1 text-left font-semibold">Patient</th>
                  <th scope="col" className="py-1 text-right font-semibold">Posted now</th>
                  <th scope="col" className="py-1 text-right font-semibold">After posting</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.diffs.slice(0, 500).map((d, i) => (
                  <tr key={`${d.clientId}-${i}`}>
                    <td className="py-1">{d.clientName ?? d.clientId}{d.mrn ? <span className="ml-1 text-slate-500">{d.mrn}</span> : null}</td>
                    <td className="py-1 text-right">{d.beforeCents == null ? '—' : <Money cents={d.beforeCents} />}</td>
                    <td className="py-1 text-right">{d.afterCents == null ? 'removed' : <Money cents={d.afterCents} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        ) : (
          <p className="text-slate-500">No changes from what is posted now.</p>
        )}

        {p.unmatched?.length ? (
          <details>
            <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Unmatched Valant IDs, not posted ({p.unmatched.length})</summary>
            <ul className="mt-1 grid grid-cols-2 gap-x-4 sm:grid-cols-3">
              {p.unmatched.map((u) => (
                <li key={u.valantPatientId} className="flex justify-between gap-2">
                  <span>{u.valantPatientId}</span>
                  <Money cents={u.totalCents} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {p.excluded?.length ? (
          <details>
            <summary className="cursor-pointer rounded font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">Excluded, not posted ({p.excluded.length})</summary>
            <div className="clinic-scroll-x">
            <table className="mt-1 min-w-full">
              <thead className="sr-only">
                <tr>
                  <th scope="col">Patient</th>
                  <th scope="col">Reason</th>
                  <th scope="col">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {p.excluded.map((e, i) => (
                  <tr key={`${e.clientId ?? e.valantName}-${i}`}>
                    <td className="py-1">{e.clientName ?? e.valantName}</td>
                    <td className="py-1 text-slate-500">{e.reasonText}</td>
                    <td className="py-1 text-right"><Money cents={e.netCents} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </details>
        ) : null}

        <Alert tone="warning" title={`${p.warning} (as of ${isOpening ? p.asOf : p.periodEnd}).`}>
          <p>Every patient&apos;s earlier Valant {isOpening ? 'opening balance' : 'prepayment credit'} is replaced by the amount above; patients not listed lose theirs. Nothing is added on top.</p>
          <label className="mt-2 flex items-center gap-2 font-semibold">
            <input type="checkbox" className={CHECKBOX} checked={ack} onChange={(e) => setAck(e.target.checked)} /> I understand
          </label>
        </Alert>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ack || !reconciles || busy} onClick={onPost}>
            {busy ? 'Posting…' : `Post ${p.counts.post} patients (${formatCents(p.totals.postCents)})`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
