'use client';

/**
 * Consents hub (front desk + clinicians): ONE worklist of required consents that are missing,
 * expiring within 30 days, expired or revoked, grouped by client, with filters (location,
 * program, clinician, consent type, status, visit on or before a date), counts and bulk
 * "send packet" (each client gets only what they still need). Tabs: Packets (sent / opened /
 * signed, resend) and the Library. Real data only: the worklist is the required-consent rules
 * (src/lib/consents/library/requirements.ts) applied to the practice's Active templates.
 */
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CalendarClock, CheckCircle2, Download, FileSignature, Inbox, Loader2, Mail, MessageSquare, RefreshCw, Search, Send, ShieldCheck } from 'lucide-react';
import { EmptyState, PageHeader, Panel } from '@/components/clinic/ui';
import { PROGRAM_LABEL, WORKLIST_PROGRAMS, type WorklistClient, type WorklistCounts, type WorklistProgram, type WorklistStatusFilter } from '@/lib/consents/library/worklistCore';
import { STANDARD_STATUS_LABEL, type StandardStatus } from '@/lib/consents/library/requirements';
import { Alert } from '@/components/ui';

type WorklistResponse = {
  clients: WorklistClient[];
  counts: WorklistCounts;
  unavailable: { key: string; title: string; clients: number }[];
  hiddenSensitiveClients: number;
  timeZone: string;
  options: { locations: { id: string; name: string }[]; clinicians: { id: string; name: string }[]; templates: { key: string; title: string }[] };
};

type PacketRow = {
  id: string;
  clientId: string;
  clientName: string;
  mrn: string | null;
  status: string;
  method: string;
  itemCount: number;
  sentAt: string;
  viewedAt: string | null;
  signedAt: string | null;
  lastSentAt: string | null;
  sendCount: number;
  channels: string[];
  signerName: string | null;
};

type Channel = 'portal' | 'email' | 'sms';

const TONE: Record<StandardStatus, string> = {
  complete: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  missing: 'bg-rose-50 text-rose-800 ring-rose-200',
  expiring: 'bg-amber-50 text-amber-800 ring-amber-200',
  expired: 'bg-amber-50 text-amber-800 ring-amber-200',
  revoked: 'bg-slate-200 text-slate-800 ring-slate-300',
};

const STATUS_TABS: { value: WorklistStatusFilter; label: string }[] = [
  { value: 'needs_attention', label: 'Needs attention' },
  { value: 'missing', label: 'Missing' },
  { value: 'expiring', label: 'Expiring (30 days)' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
  { value: 'complete', label: 'Complete' },
];

const input = 'rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[13px] text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';

function day(iso: string | null, tz?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', ...(tz ? { timeZone: tz } : {}) });
}
function dayTime(iso: string | null, tz?: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) });
}
function ymd(d: Date) {
  return d.toLocaleDateString('en-CA');
}

function countFor(c: WorklistCounts | undefined, v: WorklistStatusFilter): number | null {
  if (!c) return null;
  if (v === 'needs_attention') return c.needsAttention;
  if (v === 'all') return null;
  return c[v];
}

function ChannelPicker({ value, onChange }: { value: Channel[]; onChange: (v: Channel[]) => void }) {
  const toggle = (c: Channel) => onChange(value.includes(c) ? value.filter((x) => x !== c) : [...value, c]);
  return (
    <span className="inline-flex flex-wrap items-center gap-3 text-[12.5px] text-slate-700">
      <span className="inline-flex items-center gap-1 font-semibold"><Inbox size={13} aria-hidden /> Portal</span>
      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={value.includes('email')} onChange={() => toggle('email')} /> <Mail size={13} aria-hidden /> Email</label>
      <label className="inline-flex items-center gap-1"><input type="checkbox" checked={value.includes('sms')} onChange={() => toggle('sms')} /> <MessageSquare size={13} aria-hidden /> Text</label>
    </span>
  );
}

function Worklist() {
  const [data, setData] = useState<WorklistResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<WorklistStatusFilter>('needs_attention');
  const [f, setF] = useState({ search: '', locationId: '', clinicianId: '', program: '' as '' | WorklistProgram, templateKey: '', dueBefore: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<Channel[]>(['portal']);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'warn'; lines: string[] } | null>(null);
  // "Today" / "Next 7 days" on this device's calendar (computed once)
  const [quickDates] = useState(() => {
    const now = new Date();
    return { today: ymd(now), week: ymd(new Date(now.getTime() + 7 * 86_400_000)) };
  });

  const query = useMemo(() => {
    const p = new URLSearchParams({ status });
    for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
    return p.toString();
  }, [status, f]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/consents/worklist?${query}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not load');
      setData(d);
      setSelected((prev) => new Set([...prev].filter((id) => d.clients.some((c: WorklistClient) => c.clientId === id))));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the consents worklist');
    } finally {
      setLoading(false);
    }
  }, [query]);
  useEffect(() => {
    const t = setTimeout(() => void load(), f.search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, f.search]);

  const sendable = useMemo(() => (data?.clients ?? []).filter((c) => c.bulkSendable), [data]);
  const allSelected = sendable.length > 0 && sendable.every((c) => selected.has(c.clientId));

  const send = async () => {
    if (!selected.size) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/consents/worklist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientIds: [...selected], channels }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not send');
      const results = d.results as { clientId: string; outcome: string; message: string; notify: { channel: string; ok: boolean; message: string }[] }[];
      const name = (id: string) => data?.clients.find((c) => c.clientId === id)?.clientName ?? 'Client';
      const sent = results.filter((r) => r.outcome === 'sent').length;
      const reminded = results.filter((r) => r.outcome === 'reminded').length;
      const problems = results.flatMap((r) => [
        ...(r.outcome === 'sent' || r.outcome === 'reminded' ? [] : [`${name(r.clientId)}: ${r.message}`]),
        ...r.notify.filter((n) => !n.ok).map((n) => `${name(r.clientId)} (${n.channel === 'sms' ? 'text' : n.channel}): ${n.message}`),
      ]);
      setMsg({ tone: problems.length ? 'warn' : 'ok', lines: [`${sent} packet${sent === 1 ? '' : 's'} sent, ${reminded} reminder${reminded === 1 ? '' : 's'}.`, ...problems.slice(0, 12)] });
      setSelected(new Set());
      await load();
    } catch (e) {
      setMsg({ tone: 'warn', lines: [e instanceof Error ? e.message : 'Could not send'] });
    } finally {
      setBusy(false);
    }
  };

  const tz = data?.timeZone;
  const { today, week } = quickDates;
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Consent status">
        {STATUS_TABS.map((t) => {
          const n = countFor(data?.counts, t.value);
          const on = status === t.value;
          return (
            <button key={t.value} type="button" role="tab" aria-selected={on} onClick={() => setStatus(t.value)} className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 transition ${on ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50'}`}>
              {t.label}
              {n !== null ? <span className={`ml-1.5 tabular-nums ${on ? 'text-white/90' : 'text-slate-500'}`}>{n}</span> : null}
            </button>
          );
        })}
      </div>

      <Panel>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
          <label className="relative lg:col-span-2">
            <span className="sr-only">Search client or MRN</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-2.5 text-slate-500" aria-hidden />
            <input className={`${input} w-full pl-8`} placeholder="Client name or MRN" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
          </label>
          <select aria-label="Location" className={input} value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
            <option value="">All locations</option>
            {data?.options.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <select aria-label="Program" className={input} value={f.program} onChange={(e) => setF({ ...f, program: e.target.value as '' | WorklistProgram })}>
            <option value="">All programs</option>
            {WORKLIST_PROGRAMS.map((p) => <option key={p} value={p}>{PROGRAM_LABEL[p]}</option>)}
          </select>
          <select aria-label="Clinician" className={input} value={f.clinicianId} onChange={(e) => setF({ ...f, clinicianId: e.target.value })}>
            <option value="">All clinicians</option>
            {data?.options.clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select aria-label="Consent type" className={input} value={f.templateKey} onChange={(e) => setF({ ...f, templateKey: e.target.value })}>
            <option value="">All consent types</option>
            {data?.options.templates.map((t) => <option key={t.key} value={t.key}>{t.title}</option>)}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-slate-600">
          <CalendarClock size={14} aria-hidden />
          <span>Next visit on or before</span>
          <input type="date" aria-label="Next visit on or before" className={input} value={f.dueBefore} onChange={(e) => setF({ ...f, dueBefore: e.target.value })} />
          <button type="button" className="rounded-md px-2 py-1 font-semibold text-blue-600 hover:bg-blue-50" onClick={() => setF({ ...f, dueBefore: today })}>Today</button>
          <button type="button" className="rounded-md px-2 py-1 font-semibold text-blue-600 hover:bg-blue-50" onClick={() => setF({ ...f, dueBefore: week })}>Next 7 days</button>
          {f.dueBefore ? <button type="button" className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100" onClick={() => setF({ ...f, dueBefore: '' })}>Any date</button> : null}
        </div>
      </Panel>

      {data?.unavailable.length ? (
        <div className="rounded-lg bg-amber-50 p-3 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
          <p className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} aria-hidden /> Required, but the template is not approved yet</p>
          <ul className="mt-1 list-disc pl-5">
            {data.unavailable.map((u) => <li key={u.key}>{u.title}: {u.clients} client{u.clients === 1 ? '' : 's'}</li>)}
          </ul>
          <Link href="/dashboard/ehr/consents/library" className="mt-1 inline-block font-semibold text-blue-600 underline">Review in the Library</Link>
        </div>
      ) : null}
      {data?.hiddenSensitiveClients ? <p className="text-[12px] text-slate-500">{data.hiddenSensitiveClients} client{data.hiddenSensitiveClients === 1 ? '' : 's'} with restricted (Part 2 / sensitive) records not shown.</p> : null}

      {selected.size ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-xl bg-blue-50 px-4 py-3 ring-1 ring-blue-200">
          <span className="text-[13px] font-semibold text-blue-600">{selected.size} selected</span>
          <ChannelPicker value={channels} onChange={(v) => setChannels(['portal', ...v.filter((c) => c !== 'portal')])} />
          <button type="button" disabled={busy} onClick={() => void send()} className="clinic-btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
            {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />} Send packet
          </button>
          <span className="text-[11.5px] text-slate-600">Each client gets only the forms they still need; a packet already out is re-sent as a reminder. Texts and emails never name the forms.</span>
        </div>
      ) : null}
      {msg ? (
        <div role="status" className={`rounded-lg p-3 text-[12.5px] ring-1 ${msg.tone === 'ok' ? 'bg-emerald-50 text-emerald-900 ring-emerald-200' : 'bg-amber-50 text-amber-900 ring-amber-200'}`}>
          {msg.lines.map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</p>)}
        </div>
      ) : null}

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <Panel padding={false}>
        {loading && !data ? (
          <p role="status" className="flex items-center gap-2 p-6 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading…</p>
        ) : !data || data.clients.length === 0 ? (
          <EmptyState title={status === 'complete' ? 'No complete consents match these filters.' : 'Nothing needs attention for these filters.'} description="Clients show here when a consent required for their programs and services is missing, expiring, expired or revoked." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <input type="checkbox" aria-label="Select all clients that can be sent a packet" checked={allSelected} disabled={!sendable.length} onChange={() => setSelected(allSelected ? new Set() : new Set(sendable.map((c) => c.clientId)))} />
                  </th>
                  <th scope="col" className="px-3 py-2.5">Client</th>
                  <th scope="col" className="px-3 py-2.5">Next visit</th>
                  <th scope="col" className="px-3 py-2.5">Consents</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.clients.map((c) => (
                  <tr key={c.clientId} className="align-top hover:bg-slate-50/60">
                    <td className="px-3 py-3">
                      <input type="checkbox" aria-label={`Select ${c.clientName}`} disabled={!c.bulkSendable} checked={selected.has(c.clientId)} onChange={() => toggleOne(c.clientId)} />
                    </td>
                    <td className="px-3 py-3">
                      <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(c.clientId)}`} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline">{c.clientName}</Link>
                      <p className="text-[11.5px] text-slate-500">{[c.mrn ? `MRN ${c.mrn}` : null, c.facets.locationName, c.facets.clinicianName].filter(Boolean).join(' · ') || '—'}</p>
                      {c.facets.programs.length ? <p className="text-[11px] text-slate-500">{c.facets.programs.map((p) => PROGRAM_LABEL[p]).join(', ')}</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-slate-700">{c.facets.nextVisitAt ? dayTime(c.facets.nextVisitAt, tz) : <span className="text-slate-500">None scheduled</span>}</td>
                    <td className="px-3 py-3">
                      <ul className="flex flex-wrap gap-1.5">
                        {c.items.map((i) => (
                          <li key={i.itemKey} title={[i.detail, i.reason ? `Why required: ${i.reason}` : null, i.expiresAt ? `Expires ${day(i.expiresAt, tz)}` : null, i.revokedAt ? `Revoked ${day(i.revokedAt, tz)}` : null].filter(Boolean).join(' · ')} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ${TONE[i.standard]}`}>
                            {i.title}
                            <span className="font-normal opacity-80">· {i.detail ?? STANDARD_STATUS_LABEL[i.standard]}</span>
                          </li>
                        ))}
                      </ul>
                      {c.openPacketId ? <p className="mt-1 text-[11px] text-slate-500">A packet is waiting in the portal.</p> : null}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(c.clientId)}`} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-blue-600 ring-1 ring-blue-200 hover:bg-blue-50">
                        <FileSignature size={13} aria-hidden /> Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

const PACKET_STATUS = [
  { value: 'SENT', label: 'Waiting for signature' },
  { value: 'SIGNED', label: 'Signed' },
  { value: 'VOIDED', label: 'Cancelled' },
  { value: 'all', label: 'All' },
] as const;

function Packets() {
  const [status, setStatus] = useState<(typeof PACKET_STATUS)[number]['value']>('SENT');
  const [rows, setRows] = useState<PacketRow[] | null>(null);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState('');
  const [channels, setChannels] = useState<Channel[]>(['portal', 'email']);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/consents/packets?status=${status}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not load');
      setRows(d.packets);
      setHidden(d.hiddenSensitiveClients ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load packets');
    }
  }, [status]);
  useEffect(() => {
    void load();
  }, [load]);

  const remind = async (p: PacketRow) => {
    setBusy(p.id);
    setMsg('');
    try {
      const res = await fetch(`/api/consents/library/packets/${encodeURIComponent(p.id)}/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not send');
      setMsg(`${p.clientName}: ${(d.results as { channel: string; ok: boolean; message: string }[]).map((r) => `${r.channel === 'sms' ? 'text' : r.channel}: ${r.message}`).join(' ')}`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select aria-label="Packet status" className={input} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          {PACKET_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        {status === 'SENT' ? (
          <span className="inline-flex items-center gap-2 text-[12.5px] text-slate-600">Remind by: <ChannelPicker value={channels} onChange={(v) => setChannels(['portal', ...v.filter((c) => c !== 'portal')])} /></span>
        ) : null}
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100"><RefreshCw size={13} aria-hidden /> Refresh</button>
      </div>
      {msg ? <p role="status" className="rounded-lg bg-slate-50 p-2.5 text-[12.5px] text-slate-700 ring-1 ring-slate-200">{msg}</p> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {hidden ? <p className="text-[12px] text-slate-500">{hidden} client{hidden === 1 ? '' : 's'} with restricted records not shown.</p> : null}
      <Panel padding={false}>
        {!rows ? (
          <p role="status" className="flex items-center gap-2 p-6 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading…</p>
        ) : rows.length === 0 ? (
          <EmptyState title="No packets" description="Packets sent in the last 180 days show here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-3 py-2.5">Client</th>
                  <th scope="col" className="px-3 py-2.5">Forms</th>
                  <th scope="col" className="px-3 py-2.5">Sent</th>
                  <th scope="col" className="px-3 py-2.5">Opened</th>
                  <th scope="col" className="px-3 py-2.5">Signed</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/60">
                    <td className="px-3 py-2.5">
                      <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(p.clientId)}`} className="font-semibold text-slate-900 hover:text-blue-600 hover:underline">{p.clientName}</Link>
                      <p className="text-[11.5px] text-slate-500">{p.method === 'portal' ? 'Patient portal' : p.method === 'intake' ? 'Online intake' : 'In office'}</p>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{p.itemCount}</td>
                    <td className="px-3 py-2.5">
                      {dayTime(p.sentAt)}
                      {p.sendCount > 1 ? <p className="text-[11px] text-slate-500">Reminded {p.sendCount - 1}x, last {dayTime(p.lastSentAt)}</p> : null}
                      {p.channels.length ? <p className="text-[11px] text-slate-500">{p.channels.map((c) => (c === 'sms' ? 'text' : c)).join(', ')}</p> : null}
                    </td>
                    <td className="px-3 py-2.5">{p.viewedAt ? dayTime(p.viewedAt) : <span className="text-slate-500">{p.method === 'portal' ? 'Not yet' : '—'}</span>}</td>
                    <td className="px-3 py-2.5">{p.signedAt ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} aria-hidden /> {dayTime(p.signedAt)}</span> : p.status === 'VOIDED' ? 'Cancelled' : <span className="text-slate-500">Waiting</span>}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-right">
                      {p.status === 'SIGNED' ? (
                        <a href={`/api/consents/library/packets/${encodeURIComponent(p.id)}/pdf`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:underline"><Download size={13} aria-hidden /> Signed PDF</a>
                      ) : p.status === 'SENT' && p.method === 'in_office' ? (
                        <Link href={`/dashboard/ehr/consents/packet/${encodeURIComponent(p.id)}`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:underline"><FileSignature size={13} aria-hidden /> Sign in office</Link>
                      ) : p.status === 'SENT' ? (
                        <button type="button" disabled={busy === p.id} onClick={() => void remind(p)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-blue-600 ring-1 ring-blue-200 hover:bg-blue-50 disabled:opacity-50">
                          {busy === p.id ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Send size={13} aria-hidden />} Remind
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function ConsentsHub() {
  const router = useRouter();
  const params = useSearchParams();
  const clientId = params.get('clientId');
  const [tab, setTab] = useState<'worklist' | 'packets'>(params.get('tab') === 'packets' ? 'packets' : 'worklist');

  // Older chart links (?clientId=) open that client's consents
  useEffect(() => {
    if (clientId) router.replace(`/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`);
  }, [clientId, router]);

  const tabClass = (on: boolean) => `inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-semibold ${on ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Consents" description="Who still needs a consent before their visit, what is expiring, and what was revoked. Send packets, track them, and manage the consent library." />
      <nav className="flex flex-wrap gap-1 border-b border-slate-200" aria-label="Consents sections">
        <button type="button" className={tabClass(tab === 'worklist')} onClick={() => setTab('worklist')}><ShieldCheck size={14} aria-hidden /> Worklist</button>
        <button type="button" className={tabClass(tab === 'packets')} onClick={() => setTab('packets')}><Send size={14} aria-hidden /> Packets</button>
        <Link href="/dashboard/ehr/consents/library" className={tabClass(false)}><BookOpen size={14} aria-hidden /> Library</Link>
        <Link href="/dashboard/ehr/consents/carelon" className={tabClass(false)}><FileSignature size={14} aria-hidden /> Carelon attestations</Link>
      </nav>
      {tab === 'worklist' ? <Worklist /> : <Packets />}
    </div>
  );
}

export default function ConsentsPage() {
  return (
    <Suspense fallback={null}>
      <ConsentsHub />
    </Suspense>
  );
}
