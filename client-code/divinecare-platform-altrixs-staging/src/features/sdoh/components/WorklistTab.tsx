'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { ALL_DOMAINS, DOMAIN_LABEL, type AhcDomain } from '@/lib/sdoh/ahcHrsn';
import {
  ageInDays,
  CLOSE_REASON_LABEL,
  CLOSE_REASONS,
  REFERRAL_STATUS_LABEL,
  REFERRAL_TYPE_LABEL,
  type CloseReason,
  type ReferralStatus,
} from '@/lib/sdoh/workflow';
import { sdohApi, type SdohReferralDto, type Worklist } from '../api';
import { DomainIcon, EmptyState, Pill, formatDate, inputCls, secondaryBtn } from './ui';

const STATUS_TONE: Record<ReferralStatus, 'amber' | 'sky' | 'slate'> = { open: 'amber', connected: 'sky', closed: 'slate' };

function ReferralRow({ r, owners, onChange }: { r: SdohReferralDto; owners: Worklist['owners']; onChange: (r: SdohReferralDto) => void }) {
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState<CloseReason>('need_met');
  const [busy, setBusy] = useState(false);
  const age = ageInDays(new Date(r.createdAt));

  async function patch(body: Parameters<typeof sdohApi.updateReferral>[1], msg: string) {
    setBusy(true);
    try {
      const { referral } = await sdohApi.updateReferral(r.id, body);
      onChange(referral);
      setClosing(false);
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the referral');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/dashboard/clients/${encodeURIComponent(r.clientId)}`} className="text-base font-semibold text-slate-900 hover:underline">
              {r.clientName}
            </Link>
            <Pill tone={STATUS_TONE[r.status]}>{REFERRAL_STATUS_LABEL[r.status]}</Pill>
            {r.status !== 'closed' && <Pill tone={age > 30 ? 'rose' : 'slate'}>{age === 0 ? 'Today' : `${age} day${age === 1 ? '' : 's'}`}</Pill>}
          </div>
          <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-700">
            <span className="text-[#5C2D91]">
              <DomainIcon domain={r.domain as AhcDomain} />
            </span>
            {DOMAIN_LABEL[r.domain as AhcDomain] ?? r.domain}
            {r.resourceName ? <span className="text-slate-500">→ {r.resourceName}</span> : <span className="text-slate-400">· no resource chosen</span>}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Opened {formatDate(r.createdAt)}
            {r.connectedAt ? ` · Connected ${formatDate(r.connectedAt)}` : ''}
            {r.closedAt ? ` · Closed ${formatDate(r.closedAt)} (${CLOSE_REASON_LABEL[r.closeReason as CloseReason] ?? r.closeReason})` : ''}
            {` · ${REFERRAL_TYPE_LABEL[r.referralType]}`}
          </p>
          {r.status !== 'closed' && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              {r.followUpCompletedAt ? (
                <span className="text-emerald-700">Followed up {formatDate(r.followUpCompletedAt)}</span>
              ) : r.followUpDate ? (
                <>
                  <span className={r.followUpDate < new Date().toISOString().slice(0, 10) ? 'font-semibold text-rose-700' : 'text-slate-600'}>
                    Follow-up {r.followUpDate < new Date().toISOString().slice(0, 10) ? 'overdue' : 'due'} {formatDate(`${r.followUpDate}T12:00:00`)}
                  </span>
                  <button type="button" disabled={busy} onClick={() => patch({ followUpCompleted: true }, 'Follow-up recorded')} className="font-semibold text-[#5C2D91] hover:underline">
                    Mark followed up
                  </button>
                </>
              ) : (
                <label className="inline-flex items-center gap-1 text-slate-600">
                  Follow-up date
                  <input type="date" disabled={busy} onChange={(e) => e.target.value && patch({ followUpDate: e.target.value }, 'Follow-up date set')} className="rounded-lg border border-slate-200 px-2 py-1 text-xs" />
                </label>
              )}
            </p>
          )}
        </div>
        <select
          aria-label="Owner"
          value={r.ownerId ?? ''}
          disabled={busy}
          onChange={(e) => patch({ ownerId: e.target.value || null }, 'Owner updated')}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
        >
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          {r.ownerId && !owners.some((o) => o.id === r.ownerId) && <option value={r.ownerId}>{r.ownerName ?? 'Former staff'}</option>}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {r.status === 'open' && (
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => patch({ status: 'connected' }, 'Marked connected')}>
            Mark connected
          </button>
        )}
        {r.status !== 'closed' && !closing && (
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setClosing(true)}>
            Close…
          </button>
        )}
        {r.status === 'connected' && (
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => patch({ status: 'open' }, 'Back to open')}>
            Connection fell through
          </button>
        )}
        {r.status === 'closed' && (
          <button type="button" className={secondaryBtn} disabled={busy} onClick={() => patch({ status: 'open' }, 'Reopened')}>
            Reopen
          </button>
        )}
      </div>
      {closing && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row sm:items-center">
          <select value={reason} onChange={(e) => setReason(e.target.value as CloseReason)} className={`${inputCls} sm:flex-1`} aria-label="Close reason">
            {CLOSE_REASONS.map((c) => (
              <option key={c} value={c}>
                {CLOSE_REASON_LABEL[c]}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button type="button" className={secondaryBtn} onClick={() => setClosing(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center rounded-xl bg-slate-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              disabled={busy}
              onClick={() => patch({ status: 'closed', closeReason: reason }, 'Referral closed')}
            >
              Close referral
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export function WorklistTab({ myUserId, onScreenClient }: { myUserId: string | null; onScreenClient: (id: string, name: string) => void }) {
  const [data, setData] = useState<Worklist | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<'active' | ReferralStatus | 'all'>('active');
  const [domain, setDomain] = useState<'all' | AhcDomain>('all');
  const [owner, setOwner] = useState<'all' | 'me' | 'unassigned'>('all');

  const includeClosed = status === 'closed' || status === 'all';
  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await sdohApi.worklist(includeClosed));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the worklist');
    }
  }, [includeClosed]);
  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const list = data?.referrals ?? [];
    return list.filter((r) => {
      if (status === 'active' && r.status === 'closed') return false;
      if (status !== 'active' && status !== 'all' && r.status !== status) return false;
      if (domain !== 'all' && r.domain !== domain) return false;
      if (owner === 'me' && r.ownerId !== myUserId) return false;
      if (owner === 'unassigned' && r.ownerId) return false;
      return true;
    });
  }, [data, status, domain, owner, myUserId]);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data?.referrals ?? []) if (r.status !== 'closed') m.set(r.domain, (m.get(r.domain) ?? 0) + 1);
    return m;
  }, [data]);

  if (error) return <EmptyState title="Worklist unavailable">{error}</EmptyState>;
  if (!data) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      <div className="min-w-0 space-y-3 lg:col-span-2">
        <div className="flex flex-wrap gap-2">
          {ALL_DOMAINS.filter((d) => counts.get(d)).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDomain(domain === d ? 'all' : d)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                domain === d ? 'border-[#5C2D91] bg-[#5C2D91]/10 font-semibold text-[#5C2D91]' : 'border-slate-200 bg-white text-slate-700'
              }`}
            >
              <DomainIcon domain={d} /> {DOMAIN_LABEL[d]} <span className="font-bold">{counts.get(d)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3">
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" aria-label="Status">
            <option value="active">Open + connected</option>
            <option value="open">Open</option>
            <option value="connected">Connected</option>
            <option value="closed">Closed</option>
            <option value="all">All</option>
          </select>
          <select value={owner} onChange={(e) => setOwner(e.target.value as typeof owner)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm" aria-label="Owner filter">
            <option value="all">Any owner</option>
            <option value="me">Mine</option>
            <option value="unassigned">Unassigned</option>
          </select>
          <button type="button" onClick={() => void load()} className="ml-auto rounded-xl p-2 text-slate-500 hover:bg-slate-100" aria-label="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
        {rows.length === 0 ? (
          <EmptyState title={data.referrals.length ? 'No referrals match these filters' : 'No open referrals'}>
            Referrals are opened from a screening result for each need the client wants help with.
          </EmptyState>
        ) : (
          rows.map((r) => (
            <ReferralRow
              key={r.id}
              r={r}
              owners={data.owners}
              onChange={(next) => setData((d) => (d ? { ...d, referrals: d.referrals.map((x) => (x.id === next.id ? next : x)) } : d))}
            />
          ))
        )}
      </div>

      <div className="space-y-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CalendarClock size={16} className="text-[#5C2D91]" /> Rescreen due
          </h3>
          <p className="mt-1 text-xs text-slate-500">12 months after the last screening. Shown from 30 days before the due date.</p>
          {data.rescreen.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">Nobody is due.</p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100">
              {data.rescreen.map((c) => (
                <li key={c.clientId} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{c.clientName}</p>
                    <p className={`text-xs ${c.state === 'overdue' ? 'text-rose-700' : 'text-amber-700'}`}>
                      {c.state === 'overdue' ? 'Overdue since' : 'Due'} {formatDate(c.dueAt)}
                    </p>
                  </div>
                  <button type="button" className="rounded-lg px-2.5 py-1.5 text-sm font-semibold text-[#5C2D91] hover:bg-[#5C2D91]/10" onClick={() => onScreenClient(c.clientId, c.clientName)}>
                    Screen
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
