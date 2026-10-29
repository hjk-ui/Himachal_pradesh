'use client';

/**
 * IOP / PHP charge drafts (billing + leadership; Office Manager reads). Drafts are built from
 * program attendance under each program's billing mode, codes and unit rules. They are DRAFTS only:
 * nothing is submitted from here and no fee is stored; billing builds claims with the existing
 * claim tools after checking each draft. Held drafts list why.
 */
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { HOLD_REASON_LABEL } from '@/lib/intensive/types';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  FOCUS_RING,
  FormField,
  LoadingState,
  Page,
  PageHeader,
  StatusBadge,
  cx,
  inputClasses,
} from '@/components/ui';
import { errText } from '../shared';

type Charge = {
  id: string; programId: string; programName: string; clientId: string | null; clientName: string; mrn: string | null; serviceDate: string;
  code: string; units: number; minutes: number; status: 'draft' | 'held' | 'void'; holdReasons: string[]; part2: boolean;
};
type ProgramOpt = { id: string; name: string; typeLabel: string };

function monthStart(today: string) {
  return `${today.slice(0, 8)}01`;
}

export default function IntensiveChargeDraftsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [programId, setProgramId] = useState('');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<Charge[]>([]);
  const [canGenerate, setCanGenerate] = useState(false);
  const [programs, setPrograms] = useState<ProgramOpt[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from, to, ...(programId ? { programId } : {}), ...(status ? { status } : {}) });
      const r = await apiJson<{ charges: Charge[]; programs: ProgramOpt[]; canGenerate: boolean }>(`/api/intensive/charges?${qs.toString()}`);
      setRows(r.charges);
      setPrograms(r.programs);
      setCanGenerate(r.canGenerate);
      setErr(null);
    } catch (e) {
      setErr(errText(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, programId, status]);
  useEffect(() => {
    void load();
  }, [load]);
  const programChoices = programs.map((p) => ({ id: p.id, name: `${p.name} · ${p.typeLabel}` }));

  const generate = async () => {
    if (!programId) return setErr('Choose a program to generate drafts for');
    setBusy(true);
    setErr(null);
    try {
      const r = await apiJson<{ result: { created: number; updated: number; held: number; enrollments: number; skipped: unknown[] } }>('/api/intensive/charges', {
        method: 'POST',
        body: JSON.stringify({ programId, from, to }),
      });
      setMsg(`Drafts: ${r.result.created} new, ${r.result.updated} refreshed, ${r.result.held} held, ${r.result.skipped.length} not drafted (no attended minutes / under minimum / billed by group note).`);
      await load();
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (id: string, action: 'void' | 'restore') => {
    try {
      await apiJson('/api/intensive/charges', { method: 'PATCH', body: JSON.stringify({ id, action }) });
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };

  const totals = rows.reduce((s, r) => (r.status === 'void' ? s : { ...s, [r.status]: (s[r.status] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <Page>
      <Link href="/dashboard/billing" className={cx('inline-flex items-center gap-1 rounded text-sm font-medium text-blue-700 hover:text-blue-800', FOCUS_RING)}>
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Billing
      </Link>
      <PageHeader
        title="IOP / PHP charge drafts"
        description="Built from program attendance. Drafts only: never submitted from here, no fees. Codes and unit rules are program settings for billing to confirm with each payer."
        actions={
          canGenerate && (
            <Button icon={<RefreshCw />} loading={busy} disabled={busy || !programId} onClick={generate}>
              Generate / refresh drafts
            </Button>
          )
        }
      />
      {err && <Alert tone="danger">{err}</Alert>}
      {msg && <Alert tone="success">{msg}</Alert>}
      <Card>
        <CardHeader title="Filters" />
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <FormField label="Program">
              <select className={inputClasses} value={programId} onChange={(e) => setProgramId(e.target.value)}>
                <option value="">All programs</option>
                {programChoices.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label="From">
              <input type="date" className={inputClasses} value={from} onChange={(e) => setFrom(e.target.value)} />
            </FormField>
            <FormField label="To">
              <input type="date" className={inputClasses} value={to} max={today} onChange={(e) => setTo(e.target.value)} />
            </FormField>
            <FormField label="Status">
              <select className={inputClasses} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All</option><option value="draft">Ready for billing review</option><option value="held">Held</option><option value="void">Voided</option>
              </select>
            </FormField>
          </div>
          <p className="mt-3 text-xs text-slate-500">{totals.draft ?? 0} ready for review · {totals.held ?? 0} held. Regenerating refreshes drafts from current attendance; voided drafts stay voided.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Charge drafts" />
        {loading && !rows.length ? (
          <LoadingState rows={4} label="Loading charge drafts…" />
        ) : !rows.length ? (
          <EmptyState compact title="No charge drafts in this range." />
        ) : (
          <div className="clinic-scroll-x">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="bg-slate-50">
                <tr className="text-left text-xs font-semibold text-slate-600">
                  <th scope="col" className="sticky left-0 z-10 bg-slate-50 px-4 py-2.5">Date</th>
                  <th scope="col" className="px-4 py-2.5">Client</th>
                  <th scope="col" className="px-4 py-2.5">Program</th>
                  <th scope="col" className="px-4 py-2.5">Code</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Units</th>
                  <th scope="col" className="px-4 py-2.5 text-right">Minutes</th>
                  <th scope="col" className="px-4 py-2.5">Status</th>
                  <th scope="col" className="sticky right-0 z-10 bg-slate-50 px-4 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.id} className="group align-top text-slate-700 hover:bg-slate-50">
                    <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-4 py-3 group-hover:bg-slate-50">{r.serviceDate}</td>
                    <td className="px-4 py-3">{r.clientName}<p className="text-xs text-slate-500">{r.mrn ?? ''}{r.part2 ? ' · 42 CFR Part 2' : ''}</p></td>
                    <td className="px-4 py-3 text-xs">{r.programName}</td>
                    <td className="px-4 py-3 font-mono">{r.code === 'UNSET' ? 'not set' : r.code}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.units}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.minutes}</td>
                    <td className="px-4 py-3">
                      <StatusBadge tone={r.status === 'draft' ? 'info' : r.status === 'held' ? 'warning' : 'neutral'}>{r.status === 'draft' ? 'Ready for review' : r.status === 'held' ? 'Held' : 'Voided'}</StatusBadge>
                      {r.status === 'held' && <ul className="mt-1 text-xs text-amber-800">{r.holdReasons.map((h) => <li key={h}>{HOLD_REASON_LABEL[h] ?? h}</li>)}</ul>}
                    </td>
                    <td className="sticky right-0 z-10 bg-white px-4 py-3 text-right group-hover:bg-slate-50">
                      {canGenerate && (r.status === 'void' ? <Button size="sm" variant="secondary" onClick={() => act(r.id, 'restore')}>Restore</Button> : <Button size="sm" variant="secondary" onClick={() => act(r.id, 'void')}>Void</Button>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Page>
  );
}
