'use client';

/**
 * One client's consents: what is required (intake packet rules), signed (version, date, signer),
 * pending, expired, revoked or needing re-sign; send the packet to the portal or sign it in office;
 * send a single form (ROI to a named recipient, Part 2 consent, card authorization...); record a
 * revocation; download signed PDFs (audited).
 */
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, FileSignature, Globe, Info, Loader2, PenLine, Send, XCircle } from 'lucide-react';
import { PageHeader, Panel, StatCard } from '@/components/clinic/ui';
import { CONSENT_STATE_LABEL, type ClientConsentItem } from '@/lib/consents/library/status';
import { SERVICE_LABEL, type ComposeResult, type PacketClientContext } from '@/lib/consents/library/composer';
import { templateVersion } from '@/lib/consents/library/catalog';
import { RECEIVED_VIA_LABEL, REVOCATION_CHANNELS, type RevocationChannel } from '@/lib/consents/library/revocation';
import { Alert } from '@/components/ui';

type View = {
  client: { id: string; name: string; mrn: string | null; age: number | null };
  context: PacketClientContext;
  composition: ComposeResult;
  items: ClientConsentItem[];
  packets: { id: string; status: string; method: string; sentAt: string; signedAt: string | null; signerName: string | null; itemCount: number; viewedAt: string | null; lastSentAt: string | null; sendCount: number; deliveryChannels: string[] }[];
  sendableTemplates: { key: string; version: number; title: string; signing: string }[];
};

const TONE: Record<string, string> = {
  signed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  pending: 'bg-sky-50 text-sky-800 ring-sky-200',
  missing: 'bg-rose-50 text-rose-800 ring-rose-200',
  expired: 'bg-amber-50 text-amber-800 ring-amber-200',
  revoked: 'bg-slate-200 text-slate-800 ring-slate-300',
  needs_resign: 'bg-blue-50 text-blue-600 ring-blue-200',
  declined: 'bg-slate-100 text-slate-700 ring-slate-200',
};

const LEGACY_REVOCABLE = new Set(['informed-consent-treatment', 'telehealth-consent', 'ai-note-drafting-consent', 'roi-authorization']);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);

function revocable(i: ClientConsentItem) {
  if (!i.rowId || (i.state !== 'signed' && i.state !== 'expired' && i.state !== 'needs_resign')) return false;
  if (i.legacy) return LEGACY_REVOCABLE.has(i.templateKey);
  return Boolean(i.signedVersion && templateVersion(i.templateKey, i.signedVersion)?.revocable);
}

export default function ClientConsentsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [single, setSingle] = useState({ key: '', recipientName: '', purpose: '' });
  // Visit Guide / due-item link (?template=telehealth-consent): that form is preselected under "Send a single form"
  useEffect(() => {
    if (!view || single.key) return;
    const wanted = new URLSearchParams(window.location.search).get('template');
    if (wanted && view.sendableTemplates.some((t) => t.key === wanted)) setSingle((s) => ({ ...s, key: wanted }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);
  /** Portal sends also notify by (texts go through the SMS consent gate; no PHI) */
  const [notify, setNotify] = useState<('email' | 'sms')[]>([]);
  const [revoking, setRevoking] = useState<ClientConsentItem | null>(null);
  const [rev, setRev] = useState<{ receivedOn: string; method: 'verbal' | 'written'; receivedVia: RevocationChannel; note: string; channels: ('sms' | 'email' | 'voicemail')[] }>({ receivedOn: today(), method: 'written', receivedVia: 'in_person', note: '', channels: [] });

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/consents/library/clients/${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not load');
      setView(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load consents');
    }
  }, [clientId]);
  useEffect(() => {
    void load();
  }, [load]);

  const required = useMemo(() => (view?.items ?? []).filter((i) => i.required), [view]);
  const other = useMemo(() => (view?.items ?? []).filter((i) => !i.required), [view]);
  const needs = required.filter((i) => i.needsAction).length;

  const send = async (method: 'portal' | 'in_office', keys?: string[]) => {
    setBusy(true);
    setMsg('');
    try {
      const prefill = keys && (single.recipientName || single.purpose) ? { [keys[0]]: { ...(single.recipientName ? { recipientName: single.recipientName } : {}), ...(single.purpose ? { purpose: single.purpose } : {}), ...(keys[0] === 'part2-consent' && single.recipientName ? { recipientType: 'named' } : {}) } } : undefined;
      const res = await fetch(`/api/consents/library/clients/${encodeURIComponent(clientId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method, keys, prefill, notify: ['portal', ...notify] }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not send');
      if (method === 'in_office') {
        router.push(`/dashboard/ehr/consents/packet/${encodeURIComponent(d.packetId)}`);
        return;
      }
      const notes = ((d.notify ?? []) as { channel: string; ok: boolean; message: string }[]).map((n) => `${n.channel === 'sms' ? 'Text' : n.channel === 'email' ? 'Email' : 'Portal'}: ${n.message}`);
      setMsg(`Sent ${d.itemCount} section${d.itemCount === 1 ? '' : 's'} to the patient portal (Documents to sign).${d.carelonAttestation ? ' Maryland Medicaid: the Carelon attestation is handled on its own form.' : ''}${notes.length ? ` ${notes.join(' ')}` : ''}`);
      setSingle({ key: '', recipientName: '', purpose: '' });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };

  const remind = async (id: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/consents/library/packets/${encodeURIComponent(id)}/resend`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: ['portal', ...notify] }) });
      const d = await res.json().catch(() => ({}));
      setMsg(res.ok && d.success ? (d.results as { channel: string; message: string }[]).map((n) => `${n.channel === 'sms' ? 'Text' : n.channel === 'email' ? 'Email' : 'Portal'}: ${n.message}`).join(' ') : d.error || 'Could not send');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const cancelPacket = async (id: string) => {
    const reason = window.prompt('Reason for cancelling this unsigned packet:');
    if (!reason) return;
    const res = await fetch(`/api/consents/library/packets/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    const d = await res.json().catch(() => ({}));
    setMsg(res.ok && d.success ? 'Packet cancelled.' : d.error || 'Could not cancel');
    await load();
  };

  const submitRevocation = async () => {
    if (!revoking?.rowId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/consents/library/forms/${encodeURIComponent(revoking.rowId)}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receivedOn: rev.receivedOn, method: rev.method, receivedVia: rev.receivedVia, note: rev.note || null, channels: rev.channels.length ? rev.channels : undefined }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not record the revocation');
      const effects: string[] = d.effects ?? [];
      setMsg(`Revocation recorded.${effects.length ? ` Stopped: ${effects.map((e) => e.replace(/_/g, ' ')).join(', ')}.` : ''}${d.writtenConfirmationNeeded ? ' HIPAA / Part 2 expect a written revocation: ask the client to confirm in writing (portal or paper).' : ''}`);
      setRevoking(null);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not record the revocation');
    } finally {
      setBusy(false);
    }
  };

  const row = (i: ClientConsentItem) => (
    <tr key={i.itemKey} className="border-t border-slate-100 align-top">
      <td className="py-2 pr-3">
        <span className="font-semibold text-slate-900">{i.title}</span>
        {i.recipient ? <span className="block text-[11.5px] text-slate-500">To {i.recipient}</span> : null}
        {i.reason ? <span className="block text-[11.5px] text-slate-500">{i.reason}</span> : null}
      </td>
      <td className="py-2 pr-3">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${TONE[i.state]}`}>{CONSENT_STATE_LABEL[i.state]}</span>
        {i.standard === 'expiring' ? <span className="mt-1 block text-[11px] font-semibold text-amber-700">{i.detail}</span> : null}
      </td>
      <td className="py-2 pr-3 text-[12px]">{i.legacy ? 'earlier form' : i.signedVersion ? `v${i.signedVersion}` : '—'}{i.activeVersion && i.signedVersion && i.activeVersion !== i.signedVersion ? ` (current v${i.activeVersion})` : ''}</td>
      <td className="py-2 pr-3 text-[12px]">{day(i.signedAt)}{i.signerName ? <span className="block text-slate-500">{i.signerName}</span> : null}</td>
      <td className="py-2 pr-3 text-[12px]">{i.revokedAt ? `Revoked ${day(i.revokedAt)}` : day(i.expiresAt)}</td>
      <td className="py-2 text-right text-[12px]">
        <span className="inline-flex flex-wrap justify-end gap-2">
          {i.rowId && !i.legacy && i.state !== 'pending' ? (
            <a href={`/api/consents/library/forms/${encodeURIComponent(i.rowId)}/pdf`} className="inline-flex items-center gap-1 text-blue-600 underline"><Download size={12} aria-hidden /> PDF</a>
          ) : null}
          {revocable(i) ? (
            <button type="button" onClick={() => { setRevoking(i); setRev({ receivedOn: today(), method: 'written', receivedVia: 'in_person', note: '', channels: [] }); }} className="inline-flex items-center gap-1 text-rose-700 underline">
              <XCircle size={12} aria-hidden /> Revoke
            </button>
          ) : null}
        </span>
      </td>
    </tr>
  );

  return (
    <div className="space-y-5">
      <Link href="/dashboard/ehr/consents" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:underline"><ArrowLeft size={14} aria-hidden /> Consents</Link>
      <PageHeader
        title={view ? `Consents: ${view.client.name}` : 'Consents'}
        description="Required consents come from the client's programs and services and the practice's intake packet. Only Active template versions are sent; each signed section keeps the exact text and version the client saw."
        actions={
          view ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 text-[12px] text-slate-600">
                Also notify by
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={notify.includes('email')} onChange={(e) => setNotify(e.target.checked ? [...notify, 'email'] : notify.filter((x) => x !== 'email'))} /> email</label>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={notify.includes('sms')} onChange={(e) => setNotify(e.target.checked ? [...notify, 'sms'] : notify.filter((x) => x !== 'sms'))} /> text</label>
              </span>
              <Link href={`/dashboard/clients/${encodeURIComponent(view.client.id)}?tab=documents`} className="rounded-lg border border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700">Open chart</Link>
              <button type="button" disabled={busy} onClick={() => void send('portal')} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"><Globe size={14} aria-hidden /> Send packet to portal</button>
              <button type="button" disabled={busy} onClick={() => void send('in_office')} className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-3 py-2 text-[12.5px] font-semibold text-blue-600 disabled:opacity-60"><PenLine size={14} aria-hidden /> Sign in office</button>
            </div>
          ) : null
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {msg ? <Alert tone="info">{msg}</Alert> : null}
      {!view ? (
        <p role="status" className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Required" value={required.length} tone="violet" />
            <StatCard label="Need action" value={needs} tone={needs ? 'rose' : 'green'} />
            <StatCard label="Signed" value={required.filter((i) => i.state === 'signed').length} tone="green" />
            <StatCard label="Awaiting client" value={required.filter((i) => i.state === 'pending').length} tone="blue" />
          </div>

          <Panel>
            <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-slate-700">
              <Info size={14} className="text-blue-600" aria-hidden />
              {view.client.age !== null ? `Age ${view.client.age}. ` : 'Date of birth not on file (minor rules cannot be checked). '}
              Services: {view.context.services.map((s) => SERVICE_LABEL[s]).join(', ') || 'none recorded'}.
              {view.context.emergencyContact ? ` Emergency contact: ${view.context.emergencyContact.name}.` : ' No emergency contact on file.'}
            </p>
            {view.composition.minor ? <Alert tone="warning" className="mt-2">Under 18: {view.composition.minor.explanation}</Alert> : null}
            {view.composition.carelonAttestation ? (
              <p className="mt-2 text-[12.5px] text-slate-700">Maryland Medicaid: the Carelon non-overlap attestation is also required. <Link className="text-blue-600 underline" href={`/dashboard/ehr/consents/carelon/${encodeURIComponent(view.client.id)}`}>Open the Carelon form</Link></p>
            ) : null}
          </Panel>

          {view.composition.requiredUnavailable?.length ? (
            <p className="rounded-lg bg-amber-50 p-3 text-[12.5px] text-amber-900 ring-1 ring-amber-200">
              Required for this client but the template is not approved yet: {view.composition.requiredUnavailable.map((u) => u.title).join('; ')}. <Link className="font-semibold text-blue-600 underline" href="/dashboard/ehr/consents/library">Library</Link>
            </p>
          ) : null}

          <Panel>
            <h2 className="mb-2 text-[14px] font-bold text-slate-900">Required consents</h2>
            {required.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-xs font-semibold text-slate-600"><tr><th scope="col" className="py-1 pr-3">Consent</th><th scope="col" className="py-1 pr-3">Status</th><th scope="col" className="py-1 pr-3">Version</th><th scope="col" className="py-1 pr-3">Signed</th><th scope="col" className="py-1 pr-3">Expires</th><th scope="col" /></tr></thead>
                  <tbody>{required.map(row)}</tbody>
                </table>
              </div>
            ) : (
              <p className="text-[12.5px] text-slate-500">No Active templates apply to this client yet (see Consents &gt; Library).</p>
            )}
          </Panel>

          {other.length ? (
            <Panel>
              <h2 className="mb-2 text-[14px] font-bold text-slate-900">Other consents and authorizations on file</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12.5px]">
                  <thead className="text-xs font-semibold text-slate-600"><tr><th scope="col" className="py-1 pr-3">Consent</th><th scope="col" className="py-1 pr-3">Status</th><th scope="col" className="py-1 pr-3">Version</th><th scope="col" className="py-1 pr-3">Signed</th><th scope="col" className="py-1 pr-3">Expires</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                  <tbody>{other.map(row)}</tbody>
                </table>
              </div>
            </Panel>
          ) : null}

          <Panel>
            <h2 className="text-[14px] font-bold text-slate-900">Send a single form</h2>
            <p className="text-[12.5px] text-slate-600">For example a release of information to a named recipient (one per recipient), a Part 2 consent, a card-on-file authorization or a psychiatric medication consent. Only Active templates are listed.</p>
            <div className="mt-2 grid gap-2 md:grid-cols-[repeat(3,minmax(0,1fr))_auto_auto]">
              <select aria-label="Template" className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]" value={single.key} onChange={(e) => setSingle({ ...single, key: e.target.value })}>
                <option value="">Choose a form…</option>
                {view.sendableTemplates.map((t) => <option key={t.key} value={t.key}>{t.title} (v{t.version})</option>)}
              </select>
              <input aria-label="Recipient name" className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]" placeholder="Recipient (ROI / Part 2)" value={single.recipientName} onChange={(e) => setSingle({ ...single, recipientName: e.target.value })} />
              <input aria-label="Purpose" className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]" placeholder="Purpose (ROI / Part 2)" value={single.purpose} onChange={(e) => setSingle({ ...single, purpose: e.target.value })} />
              <button type="button" disabled={busy || !single.key} onClick={() => void send('portal', [single.key])} className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-50"><Send size={14} aria-hidden /> Portal</button>
              <button type="button" disabled={busy || !single.key} onClick={() => void send('in_office', [single.key])} className="inline-flex items-center gap-1 rounded-lg border border-blue-600 px-3 py-2 text-[12.5px] font-semibold text-blue-600 disabled:opacity-50"><PenLine size={14} aria-hidden /> In office</button>
            </div>
          </Panel>

          {view.composition.skipped.length ? (
            <Panel>
              <h2 className="text-[14px] font-bold text-slate-900">Not in this client&apos;s packet</h2>
              <ul className="mt-1 list-disc pl-5 text-[12px] text-slate-600">{view.composition.skipped.map((s) => <li key={s.key}>{s.title}: {s.reason}</li>)}</ul>
            </Panel>
          ) : null}

          <Panel>
            <h2 className="mb-2 text-[14px] font-bold text-slate-900">Packets</h2>
            {view.packets.length ? (
              <ul className="divide-y divide-slate-100 text-[12.5px]">
                {view.packets.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                    <FileSignature size={14} className="text-blue-600" aria-hidden />
                    <span className="font-semibold">{p.itemCount} section{p.itemCount === 1 ? '' : 's'}</span>
                    <span className="text-slate-600">{p.method === 'portal' ? 'Patient portal' : p.method === 'intake' ? 'Intake packet' : 'In office'} · sent {day(p.sentAt)}</span>
                    <span className="text-slate-600">{p.status === 'SIGNED' ? `Signed ${day(p.signedAt)} by ${p.signerName}` : p.status === 'VOIDED' ? 'Cancelled' : 'Awaiting signature'}</span>
                    {p.status === 'SENT' && p.method === 'portal' ? (
                      <span className="text-slate-500">{p.viewedAt ? `Opened ${day(p.viewedAt)}` : 'Not opened yet'}{p.sendCount > 1 ? ` · reminded ${p.sendCount - 1}x` : ''}{p.deliveryChannels.length ? ` · ${p.deliveryChannels.map((c) => (c === 'sms' ? 'text' : c)).join(', ')}` : ''}</span>
                    ) : null}
                    <span className="ml-auto flex gap-3">
                      {p.status === 'SIGNED' ? <a className="inline-flex items-center gap-1 text-blue-600 underline" href={`/api/consents/library/packets/${encodeURIComponent(p.id)}/pdf`}><Download size={12} aria-hidden /> PDF</a> : null}
                      {p.status === 'SENT' && p.method === 'portal' ? <button type="button" disabled={busy} onClick={() => void remind(p.id)} className="text-blue-600 underline disabled:opacity-50">Remind</button> : null}
                      {p.status === 'SENT' ? <Link className="text-blue-600 underline" href={`/dashboard/ehr/consents/packet/${encodeURIComponent(p.id)}`}>Sign in office</Link> : null}
                      {p.status === 'SENT' ? <button type="button" onClick={() => void cancelPacket(p.id)} className="text-slate-600 underline">Cancel</button> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-slate-500">No packets yet.</p>
            )}
          </Panel>
        </>
      )}

      {revoking ? (
        <div role="dialog" aria-modal="true" aria-label="Record revocation" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 shadow-xs">
            <h2 className="text-[15px] font-bold text-slate-900">Record revocation: {revoking.title}</h2>
            <p className="mt-1 text-[12.5px] text-slate-600">From now on Altrixs stops relying on this consent. It does not undo anything already done in reliance on it.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-semibold text-slate-700">Date received
                <input type="date" max={today()} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]" value={rev.receivedOn} onChange={(e) => setRev({ ...rev, receivedOn: e.target.value })} />
              </label>
              <label className="text-[12px] font-semibold text-slate-700">Verbal or written
                <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]" value={rev.method} onChange={(e) => setRev({ ...rev, method: e.target.value as 'verbal' | 'written' })}>
                  <option value="written">Written</option>
                  <option value="verbal">Verbal</option>
                </select>
              </label>
              <label className="text-[12px] font-semibold text-slate-700">How received
                <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]" value={rev.receivedVia} onChange={(e) => setRev({ ...rev, receivedVia: e.target.value as RevocationChannel })}>
                  {REVOCATION_CHANNELS.map((c) => <option key={c} value={c}>{RECEIVED_VIA_LABEL[c]}</option>)}
                </select>
              </label>
              {revoking.templateKey === 'communication-consent' ? (
                <fieldset className="text-[12px] font-semibold text-slate-700">
                  <legend>Channels (none checked = all)</legend>
                  {(['sms', 'email', 'voicemail'] as const).map((c) => (
                    <label key={c} className="mr-3 inline-flex items-center gap-1 font-normal">
                      <input type="checkbox" checked={rev.channels.includes(c)} onChange={(e) => setRev({ ...rev, channels: e.target.checked ? [...rev.channels, c] : rev.channels.filter((x) => x !== c) })} />
                      {c === 'sms' ? 'Text' : c === 'email' ? 'Email' : 'Voicemail'}
                    </label>
                  ))}
                </fieldset>
              ) : null}
              <label className="text-[12px] font-semibold text-slate-700 sm:col-span-2">Note (optional)
                <textarea maxLength={500} rows={2} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-[13px]" value={rev.note} onChange={(e) => setRev({ ...rev, note: e.target.value })} />
              </label>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setRevoking(null)} className="rounded-lg border border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700">Cancel</button>
              <button type="button" disabled={busy} onClick={() => void submitRevocation()} className="rounded-lg bg-rose-700 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">Record revocation</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
