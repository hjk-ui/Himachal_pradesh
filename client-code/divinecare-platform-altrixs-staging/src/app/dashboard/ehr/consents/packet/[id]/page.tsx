'use client';

/**
 * In-office signing of a consent packet. Staff first record HOW the client is signing (on this
 * device, on paper that will be scanned, or verbally with a witness) and whether an interpreter
 * was used. For signing on the device, staff set a PIN and hand the device over: the packet opens
 * full screen (larger text, no app navigation) and only the staff PIN returns to the app.
 * Evidence (method, interpreter, witness, scanned-paper reference, device, text hashes) is saved
 * with the packet and printed in the PDF audit trail (src/lib/consents/library/evidence.ts).
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Download, Languages, Loader2, Lock, Tablet, Type } from 'lucide-react';
import { PageHeader, Panel } from '@/components/clinic/ui';
import { ConsentPacketForm } from '@/components/consents/ConsentPacketForm';
import type { PacketForSigning } from '@/lib/consents/library/store';
import type { PacketSubmission } from '@/lib/consents/library/signing';
import { SIGNATURE_METHOD_LABEL, STAFF_SIGNATURE_METHODS, validateStaffEvidence, type StaffSignatureMethod } from '@/lib/consents/library/evidence';
import { templateVersion } from '@/lib/consents/library/catalog';
import { Alert } from '@/components/ui';

const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-[13px] text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20';
const label = 'mb-1 block text-[12px] font-semibold text-slate-700';

type Evidence = { signatureMethod: StaffSignatureMethod; interpreterUsed: boolean; language: string; interpreterName: string; witnessName: string; paperDocumentRef: string };

function PinPad({ title, onSubmit, error }: { title: string; onSubmit: (pin: string) => void; error?: string }) {
  const [pin, setPin] = useState('');
  return (
    <form
      className="mx-auto max-w-xs space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(pin);
        setPin('');
      }}
    >
      <label className={label} htmlFor="kiosk-pin">{title}</label>
      <input id="kiosk-pin" className={`${input} text-center text-[18px] tracking-[0.4em]`} inputMode="numeric" autoComplete="off" type="password" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
      {error ? <p role="alert" className="text-[12px] text-rose-700">{error}</p> : null}
      <button type="submit" className="clinic-btn-primary w-full text-sm" disabled={pin.length < 4}>Continue</button>
    </form>
  );
}

export default function InOfficePacketPage() {
  const { id } = useParams<{ id: string }>();
  const [packet, setPacket] = useState<PacketForSigning | null>(null);
  const [clientId, setClientId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [serverErrors, setServerErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ev, setEv] = useState<Evidence>({ signatureMethod: 'in_office_tablet', interpreterUsed: false, language: '', interpreterName: '', witnessName: '', paperDocumentRef: '' });
  // Kiosk: staff PIN (kept in memory on this page only), handed-over state, larger text
  const [pin, setPin] = useState<string | null>(null);
  const [kiosk, setKiosk] = useState<'off' | 'set_pin' | 'client' | 'return'>('off');
  const [pinError, setPinError] = useState('');
  const [large, setLarge] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/consents/library/packets/${encodeURIComponent(id)}`, { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not load');
      setPacket(d.packet);
      setClientId(d.clientId);
      setDone(d.packet.status === 'SIGNED');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the packet');
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const evidence = useMemo(
    () => ({
      signatureMethod: ev.signatureMethod,
      interpreter: ev.interpreterUsed ? { used: true, language: ev.language, name: ev.interpreterName || null } : null,
      witnessName: ev.signatureMethod === 'verbal_witnessed' ? ev.witnessName : null,
      paperDocumentRef: ev.signatureMethod === 'paper_scanned' ? ev.paperDocumentRef : null,
    }),
    [ev]
  );
  const evidenceErrors = useMemo(() => {
    if (!packet) return [];
    const templates = packet.items.map((it) => templateVersion(it.key, it.version)).filter((t): t is NonNullable<typeof t> => Boolean(t));
    return validateStaffEvidence(evidence, templates);
  }, [packet, evidence]);

  const sign = async (sub: PacketSubmission) => {
    setBusy(true);
    setServerErrors([]);
    try {
      const res = await fetch(`/api/consents/library/packets/${encodeURIComponent(id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...sub, evidence }) });
      const d = await res.json();
      if (!res.ok || !d.success) {
        setServerErrors(d.errors ?? [d.error || 'Could not sign']);
        return;
      }
      setDone(true);
      if (kiosk === 'client') setKiosk('return');
    } finally {
      setBusy(false);
    }
  };

  const unlock = (entered: string) => {
    if (entered === pin) {
      setKiosk('off');
      setPinError('');
    } else setPinError('That PIN is not right. Please hand the device back to the staff member.');
  };

  const form =
    packet && !done && packet.status === 'SENT' ? (
      <ConsentPacketForm mode="in_office" items={packet.items} minor={packet.minor} guardian={packet.guardian} defaultPrintedName={packet.clientName} busy={busy} serverErrors={serverErrors} onSubmit={(s) => void sign(s)} />
    ) : null;

  // ── Kiosk (the client holds the device) ──
  if (kiosk === 'client' || kiosk === 'return') {
    return (
      <div className="fixed inset-0 z-[60] overflow-auto bg-white">
        <div className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8" style={large ? { zoom: 1.2 } : undefined}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-[15px] font-bold text-slate-900">{packet?.practiceName ?? 'Consent forms'}</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setLarge((v) => !v)} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200"><Type size={14} aria-hidden /> {large ? 'Normal text' : 'Larger text'}</button>
              {kiosk === 'client' ? <button type="button" onClick={() => setKiosk('return')} className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold text-slate-700 ring-1 ring-slate-200"><Lock size={14} aria-hidden /> Staff</button> : null}
            </div>
          </div>
          {kiosk === 'return' ? (
            <div className="space-y-4 py-10 text-center">
              {done ? <p className="flex items-center justify-center gap-2 text-[16px] font-semibold text-emerald-800"><CheckCircle2 size={20} aria-hidden /> Thank you. Your forms are signed.</p> : null}
              <p className="text-[15px] text-slate-700">Please hand the device back to the staff member.</p>
              <PinPad title="Staff PIN" onSubmit={unlock} error={pinError} />
              {!done ? <button type="button" onClick={() => setKiosk('client')} className="text-[13px] font-semibold text-blue-600 underline">Back to the forms</button> : null}
            </div>
          ) : (
            <>
              <p className="text-[14px] text-slate-700">Please read each section, check the box at the end of it, and sign at the bottom. Ask the staff member if you have questions.</p>
              {form}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {clientId ? (
        <Link href={`/dashboard/ehr/consents/client/${encodeURIComponent(clientId)}`} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:underline"><ArrowLeft size={14} aria-hidden /> Client consents</Link>
      ) : null}
      <PageHeader title={packet ? `Consent packet: ${packet.clientName}` : 'Consent packet'} description={packet?.practiceName ? `${packet.practiceName}. Record how the client is signing, then hand the device over or enter the signed paper form. You are recorded as the staff member present.` : undefined} />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!packet && !error ? <p role="status" className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading…</p> : null}
      {packet && done ? (
        <div className="rounded-lg bg-emerald-50 p-4 text-[13px] text-emerald-900 ring-1 ring-emerald-200">
          <p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={16} aria-hidden /> Signed. Each section was saved with its exact text, version and SHA-256, plus the signing details.</p>
          <a className="mt-2 inline-flex items-center gap-1 text-blue-600 underline" href={`/api/consents/library/packets/${encodeURIComponent(id)}/pdf`}><Download size={13} aria-hidden /> Download the signed PDF (with audit trail)</a>
        </div>
      ) : null}
      {packet && !done && packet.status === 'SENT' ? (
        <>
          <Panel>
            <h2 className="text-[14px] font-bold text-slate-900">How is the client signing?</h2>
            <div className="mt-3 grid gap-2">
              {STAFF_SIGNATURE_METHODS.map((m) => (
                <label key={m} className="flex items-start gap-2 text-[13px] text-slate-800">
                  <input type="radio" name="sigmethod" className="mt-0.5" checked={ev.signatureMethod === m} onChange={() => setEv({ ...ev, signatureMethod: m })} />
                  <span>{SIGNATURE_METHOD_LABEL[m]}</span>
                </label>
              ))}
            </div>
            {ev.signatureMethod === 'paper_scanned' ? (
              <div className="mt-3">
                <label className={label} htmlFor="paper-ref">Where the scanned paper form is filed *</label>
                <input id="paper-ref" className={input} maxLength={200} placeholder="Document name or number in the chart" value={ev.paperDocumentRef} onChange={(e) => setEv({ ...ev, paperDocumentRef: e.target.value })} />
                <p className="mt-1 text-[11.5px] text-slate-500">Enter the client&apos;s answers exactly as written on the paper form below.</p>
              </div>
            ) : null}
            {ev.signatureMethod === 'verbal_witnessed' ? (
              <div className="mt-3">
                <label className={label} htmlFor="witness">Staff witness name *</label>
                <input id="witness" className={input} maxLength={120} value={ev.witnessName} onChange={(e) => setEv({ ...ev, witnessName: e.target.value })} />
              </div>
            ) : null}
            <div className="mt-4 border-t border-slate-100 pt-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-800">
                <input type="checkbox" checked={ev.interpreterUsed} onChange={(e) => setEv({ ...ev, interpreterUsed: e.target.checked })} />
                <Languages size={14} aria-hidden /> An interpreter was used
              </label>
              {ev.interpreterUsed ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className={label} htmlFor="lang">Language *</label>
                    <input id="lang" className={input} maxLength={60} value={ev.language} onChange={(e) => setEv({ ...ev, language: e.target.value })} />
                  </div>
                  <div>
                    <label className={label} htmlFor="interp">Interpreter name or ID</label>
                    <input id="interp" className={input} maxLength={120} value={ev.interpreterName} onChange={(e) => setEv({ ...ev, interpreterName: e.target.value })} />
                  </div>
                </div>
              ) : null}
            </div>
            {evidenceErrors.length ? (
              <ul className="mt-3 list-disc rounded-lg bg-amber-50 p-3 pl-7 text-[12.5px] text-amber-900">
                {evidenceErrors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            ) : null}
            {ev.signatureMethod === 'in_office_tablet' ? (
              <div className="mt-4 border-t border-slate-100 pt-3">
                {kiosk === 'set_pin' ? (
                  <PinPad
                    title="Set a staff PIN (4-8 digits) to return to the app"
                    onSubmit={(p) => {
                      setPin(p);
                      setKiosk('client');
                    }}
                  />
                ) : (
                  <button type="button" disabled={evidenceErrors.length > 0} onClick={() => setKiosk('set_pin')} className="clinic-btn-primary inline-flex items-center gap-1.5 text-sm disabled:opacity-50">
                    <Tablet size={14} aria-hidden /> Hand the device to the client
                  </button>
                )}
                <p className="mt-1 text-[11.5px] text-slate-500">The forms open full screen with larger text. Only your PIN returns to the app.</p>
              </div>
            ) : null}
          </Panel>
          {ev.signatureMethod !== 'in_office_tablet' && !evidenceErrors.length ? form : null}
        </>
      ) : null}
      {packet && !done && packet.status !== 'SENT' ? <p className="text-[13px] text-slate-600">This packet is {packet.status.toLowerCase()}.</p> : null}
    </div>
  );
}
