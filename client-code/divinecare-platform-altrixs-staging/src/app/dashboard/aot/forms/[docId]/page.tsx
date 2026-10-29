'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Save,
  PenLine,
  Printer,
  FilePlus2,
  Database,
  AlertTriangle,
  Lock,
  Mail,
  History,
} from 'lucide-react';
import FormEditor from '@/components/aot/forms/FormEditor';
import { Alert, buttonClasses, Card, LoadingState, Page, StatusBadge } from '@/components/ui';
import { getDefinition, missingItems, progress, type FormData, type FormSignature } from '@/lib/aot/forms';
import { MANDATORY_REPORTING_PROMPT, mandatoryReportingTriggered } from '@/lib/aot/forms/complaint';

type Loaded = {
  document: {
    id: string;
    formType: string;
    title: string;
    mdhNumber: string | null;
    version: number;
    status: string;
    participantId: string;
    data: FormData;
    signatures: FormSignature[];
    prefilled: Record<string, string>;
    amendsId: string | null;
    mailing: { trackingNumber: string; mailedDate: string } | null;
  };
  participant: { id: string; name: string; status: string };
  versions: { id: string; version: number; status: string; signedAt: string | null; signedByName: string | null }[];
  canSign: string[];
  locked: boolean;
};

const STATUS_LABEL: Record<string, string> = { draft: 'Draft', signed: 'Signed', superseded: 'Superseded' };

export default function AotFormEditorPage() {
  const params = useParams<{ docId: string }>();
  const router = useRouter();
  const docId = String(params?.docId ?? '');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [data, setData] = useState<FormData>({});
  const [prefilled, setPrefilled] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [serverMissing, setServerMissing] = useState<string[] | null>(null);
  const [attest, setAttest] = useState(false);
  const [title, setTitle] = useState('');
  const [slot, setSlot] = useState('');
  const [mail, setMail] = useState({ trackingNumber: '', mailedDate: '' });
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/aot/documents/${encodeURIComponent(docId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not load the form (${res.status})`);
      setLoaded(json);
      setData(json.document.data ?? {});
      setPrefilled(json.document.prefilled ?? {});
      setDirty(false);
      setSlot((prev) => (prev && json.canSign.includes(prev) ? prev : json.canSign[0] ?? ''));
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the form');
    }
  }, [docId]);

  useEffect(() => {
    if (docId) load();
  }, [docId, load]);

  const def = loaded ? getDefinition(loaded.document.formType) : null;
  const missing = useMemo(() => (def ? missingItems(def, data) : []), [def, data]);
  const prog = useMemo(() => (def ? progress(def, data) : null), [def, data]);
  const warnings = useMemo(() => (def?.warnings ? def.warnings(data, new Date()) : []), [def, data]);
  const editable = !!loaded && !loaded.locked;

  if (loadError) {
    return <Page width="narrow"><Alert tone="danger">{loadError}</Alert></Page>;
  }
  if (!loaded || !def) return <Page width="narrow"><Card><LoadingState label="Loading form…" /></Card></Page>;

  const doc = loaded.document;
  const backHref = `/dashboard/aot?participant=${encodeURIComponent(doc.participantId)}&tab=forms`;

  const save = async (): Promise<boolean> => {
    setBusy('save');
    setMsg(null);
    try {
      const res = await fetch(`/api/aot/documents/${encodeURIComponent(doc.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Save failed (${res.status})`);
      setDirty(false);
      setMsg({ text: 'Draft saved.', error: false });
      await load();
      return true;
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error ? err.message : 'Save failed', error: true });
      return false;
    } finally {
      setBusy('');
    }
  };

  const fillFromChart = async () => {
    setBusy('prefill');
    setMsg(null);
    try {
      const res = await fetch(`/api/aot/documents/prefill?participantId=${encodeURIComponent(doc.participantId)}&formType=${encodeURIComponent(doc.formType)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not load chart values (${res.status})`);
      const filled: string[] = [];
      const next = { ...data };
      const src = { ...prefilled };
      for (const [k, v] of Object.entries(json.data as FormData)) {
        const cur = next[k];
        const empty = cur === undefined || cur === null || cur === '' || (Array.isArray(cur) && cur.length === 0);
        if (empty) {
          next[k] = v;
          src[k] = json.sources?.[k] ?? 'Chart';
          filled.push(k);
        }
      }
      setData(def.derive ? def.derive(next) : next);
      setPrefilled(src);
      if (filled.length) setDirty(true);
      setMsg({
        text: `${filled.length ? `Filled ${filled.length} empty field(s) from the chart — review and save.` : 'No empty fields had chart values.'}${json.chartNote ? ` ${json.chartNote}` : ''}`,
        error: false,
      });
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not load chart values', error: true });
    } finally {
      setBusy('');
    }
  };

  const sign = async () => {
    if (dirty && !(await save())) return;
    setBusy('sign');
    setMsg(null);
    setServerMissing(null);
    try {
      const res = await fetch(`/api/aot/documents/${encodeURIComponent(doc.id)}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: slot || undefined, title: title || undefined, attest: true }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        if (Array.isArray(json?.missing)) setServerMissing(json.missing);
        throw new Error(json?.error || `Signing failed (${res.status})`);
      }
      setAttest(false);
      setTitle('');
      setMsg({ text: json.complete ? 'Signed. The form is locked; amend it to make changes.' : 'Your signature was added. Waiting for the other signers.', error: false });
      await load();
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error ? err.message : 'Signing failed', error: true });
    } finally {
      setBusy('');
    }
  };

  const amend = async () => {
    setBusy('amend');
    setMsg(null);
    try {
      const res = await fetch('/api/aot/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantId: doc.participantId, formType: doc.formType, amendFromId: doc.id }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not start an amendment (${res.status})`);
      router.push(`/dashboard/aot/forms/${json.document.id}`);
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not start an amendment', error: true });
      setBusy('');
    }
  };

  const recordMailing = async () => {
    setBusy('mail');
    setMsg(null);
    try {
      const res = await fetch(`/api/aot/documents/${encodeURIComponent(doc.id)}/mailed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mail),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) throw new Error(json?.error || `Could not record the mailing (${res.status})`);
      setMsg({ text: 'Mailing recorded and added to the outreach log.', error: false });
      await load();
    } catch (err: unknown) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not record the mailing', error: true });
    } finally {
      setBusy('');
    }
  };

  const signer = def.signers.find((s) => s.id === slot);
  const pendingSlots = def.signers.filter((s) => !doc.signatures.some((x) => x.slot === s.id));

  return (
    <Page className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a href={backHref} className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-blue-700">
          <ArrowLeft className="h-4 w-4" /> {loaded.participant.name} — Forms
        </a>
        <div className="ml-auto flex flex-wrap gap-2">
          {editable && (
            <>
              <button onClick={fillFromChart} disabled={!!busy} className={buttonClasses({ variant: 'secondary' })}>
                <Database className="h-4 w-4" /> {busy === 'prefill' ? 'Loading…' : 'Fill blanks from chart'}
              </button>
              <button onClick={save} disabled={!!busy || !dirty} className={buttonClasses()}>
                <Save className="h-4 w-4" /> {busy === 'save' ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
              </button>
            </>
          )}
          {doc.status === 'signed' && (
            <button onClick={amend} disabled={!!busy} className={buttonClasses({ variant: 'secondary' })}>
              <FilePlus2 className="h-4 w-4" /> {busy === 'amend' ? 'Starting…' : 'Amend (new version)'}
            </button>
          )}
          <a href={`/dashboard/aot/forms/${doc.id}/print`} className={buttonClasses({ variant: 'secondary' })}>
            <Printer className="h-4 w-4" /> Print / PDF
          </a>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">{def.title}</h1>
          {def.mdhNumber && <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600">{def.mdhNumber}</span>}
          <span className="text-[11px] px-2 py-0.5 rounded bg-slate-100 text-slate-600">Revised {def.revised}</span>
          <StatusBadge size="sm" tone={doc.status === 'signed' ? 'success' : doc.status === 'superseded' ? 'neutral' : 'warning'}>
            {STATUS_LABEL[doc.status] ?? doc.status} · v{doc.version}
          </StatusBadge>
          {loaded.locked && <Lock className="h-4 w-4 text-slate-500" aria-label="Locked" />}
        </div>
        <p className="text-xs text-slate-500 mt-1">{def.purpose} Altrixs does not send this form anywhere: staff review, sign, print or save it as PDF and send it themselves.</p>
        {def.wordingVerified && (
          <p className="text-xs text-emerald-700 mt-1 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5" /> {def.wordingVerified}
          </p>
        )}
        {doc.amendsId && <p className="text-xs text-slate-500 mt-1">Amends an earlier signed version; signing this one supersedes it.</p>}
      </div>

      {msg && <Alert tone={msg.error ? 'danger' : 'success'}>{msg.text}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <FormEditor
            def={def}
            data={data}
            readOnly={!editable}
            prefilled={editable ? prefilled : undefined}
            onChange={(next) => {
              setData(next);
              setDirty(true);
            }}
          />
        </div>

        <aside className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">Completeness {prog ? `· ${prog.pct}%` : ''}</h3>
            <div className="h-1.5 rounded-full bg-slate-100 mb-3">
              <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${prog?.pct ?? 0}%` }} />
            </div>
            {missing.length === 0 ? (
              <p className="text-xs text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> All required items are complete.</p>
            ) : (
              <ul className="space-y-1 max-h-72 overflow-y-auto">
                {missing.map((m) => (
                  <li key={m} className="text-xs text-slate-700 flex gap-1.5"><XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" />{m}</li>
                ))}
              </ul>
            )}
            {serverMissing && serverMissing.length > 0 && <p className="mt-2 text-[11px] text-rose-700">The server found {serverMissing.length} missing item(s); fix them and sign again.</p>}
            {warnings.map((w) => (
              <p key={w} className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</p>
            ))}
            {def.type === 'complaint' && mandatoryReportingTriggered(data) && (
              <p className="mt-2 text-xs text-rose-800 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1.5 flex gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{MANDATORY_REPORTING_PROMPT}</p>
            )}
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1.5"><PenLine className="h-4 w-4 text-blue-600" /> Signatures</h3>
            <ul className="space-y-1.5 mb-3">
              {def.signers.map((s) => {
                const sig = doc.signatures.find((x) => x.slot === s.id);
                return (
                  <li key={s.id} className="text-xs">
                    <p className="font-semibold text-slate-700">{s.label}</p>
                    {sig ? (
                      <p className="text-emerald-700">{sig.name}{sig.title ? `, ${sig.title}` : ''} · {new Date(sig.signedAt).toLocaleString()}</p>
                    ) : (
                      <p className="text-slate-500">Not signed · {s.roleHint}</p>
                    )}
                  </li>
                );
              })}
            </ul>
            {doc.status === 'draft' && loaded.canSign.length > 0 && pendingSlots.length > 0 && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                {loaded.canSign.length > 1 && (
                  <select value={slot} onChange={(e) => setSlot(e.target.value)} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs">
                    {loaded.canSign.map((id) => (
                      <option key={id} value={id}>{def.signers.find((s) => s.id === id)?.label ?? id}</option>
                    ))}
                  </select>
                )}
                {signer?.askTitle && (
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Your title" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                )}
                <label className="flex items-start gap-2 text-xs text-slate-700">
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} className="mt-0.5 accent-blue-600" />
                  <span>{def.attestation} Your signature is your name as it appears on your account and the current date and time.</span>
                </label>
                <button
                  onClick={sign}
                  disabled={!attest || missing.length > 0 || !!busy || (signer?.askTitle && !title.trim())}
                  title={missing.length ? 'Complete every required item first' : ''}
                  className={buttonClasses({ className: 'w-full' })}
                >
                  <PenLine className="h-4 w-4" /> {busy === 'sign' ? 'Signing…' : `Sign as ${signer?.label ?? 'signer'}`}
                </button>
              </div>
            )}
            {doc.status === 'draft' && loaded.canSign.length === 0 && pendingSlots.length > 0 && (
              <p className="text-[11px] text-slate-500">Your role cannot sign this form. Signer: {pendingSlots.map((s) => s.roleHint).join(' / ')}.</p>
            )}
          </div>

          {def.type === 'nonresponsive_letter' && doc.status === 'signed' && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1.5"><Mail className="h-4 w-4 text-blue-600" /> Certified mail</h3>
              {doc.mailing ? (
                <p className="text-xs text-slate-700">Mailed {doc.mailing.mailedDate} · tracking # {doc.mailing.trackingNumber}</p>
              ) : (
                <div className="space-y-2">
                  <input value={mail.trackingNumber} onChange={(e) => setMail((m) => ({ ...m, trackingNumber: e.target.value }))} placeholder="Certified mail tracking number" className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                  <input type="date" value={mail.mailedDate} onChange={(e) => setMail((m) => ({ ...m, mailedDate: e.target.value }))} className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs" />
                  <button onClick={recordMailing} disabled={!mail.trackingNumber || !mail.mailedDate || !!busy} className={buttonClasses({ size: 'sm', className: 'w-full' })}>
                    {busy === 'mail' ? 'Saving…' : 'Record mailing'}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-1.5"><History className="h-4 w-4 text-slate-500" /> Versions</h3>
            <ul className="space-y-1">
              {loaded.versions.map((v) => (
                <li key={v.id} className="text-xs">
                  <a href={`/dashboard/aot/forms/${v.id}`} className={`hover:underline ${v.id === doc.id ? 'font-semibold text-blue-700' : 'text-slate-700'}`}>
                    v{v.version} · {STATUS_LABEL[v.status] ?? v.status}
                    {v.signedAt ? ` · ${new Date(v.signedAt).toLocaleDateString()}${v.signedByName ? ` · ${v.signedByName}` : ''}` : ''}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </Page>
  );
}
