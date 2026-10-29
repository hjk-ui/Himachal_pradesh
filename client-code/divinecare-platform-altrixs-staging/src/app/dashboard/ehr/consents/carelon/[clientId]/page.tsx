'use client';

/**
 * One client's Carelon non-overlap attestation: Medicaid rule result, prefill (participant /
 * provider), send to the portal, record the participant's signature in office, provider Part B,
 * the Carelon portal submission date, and the signed PDF. Older attestations are listed below.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, FileSignature, Loader2, Send, XCircle } from 'lucide-react';
import { PageHeader, Panel } from '@/components/clinic/ui';
import { CarelonFormView } from '@/components/consents/CarelonFormView';
import { CarelonPartAForm } from '@/components/consents/CarelonPartAForm';
import { carelonTemplate, type CarelonTemplate } from '@/lib/consents/carelon/template';
import { formatPracticeMdY } from '@/lib/consents/carelon/prefill';
import { CARELON_STATUS_LABEL, REQUIREMENT_LABEL, validatePartB, type CarelonFormData, type CarelonStatus, type PartAInput, type RequirementState } from '@/lib/consents/carelon/workflow';
import { practiceToday } from '@/lib/time/practiceTime';
import { Alert } from '@/components/ui';

type Attestation = {
  id: string;
  status: CarelonStatus;
  statusLabel: string;
  version: string;
  createdAt: string;
  sentAt: string | null;
  neededReasons: string[];
  clientSignedAt: string | null;
  providerSignedAt: string | null;
  submittedAt: string | null;
  supersededAt: string | null;
  formData: CarelonFormData;
  blanks: string[];
};

type ViewData = {
  client: { id: string; name: string; mrn: string | null; status: string };
  medicaid: { medicaid: boolean; reasons: string[]; payerName: string | null };
  requirement: { state: RequirementState; needsAction: boolean; submitted: boolean; currentId: string | null; openId: string | null };
  attestations: Attestation[];
  prefill: {
    participant: { participantName: string | null; participantId: string | null; participantIdSource: string | null; dateOfBirth: string | null; warnings: string[] };
    provider: { optionKey: string | null; organizationName: string | null; npi: string | null; tin: string | null };
    providerOptions: { key: string; label: string; npi: string | null; tinMasked: string | null; organizationName: string | null; source: string }[];
    defaultOptionKey: string | null;
    blockers: string[];
  };
  timeZone: string;
  permissions: { manage: boolean; signProvider: boolean; markSubmitted: boolean };
  ruleExplanation: string[];
  comarNote: string;
  services: { value: string; label: string; auto: boolean }[];
};

const btn = 'inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-40';
const primary = `${btn} bg-blue-600 text-white hover:opacity-90`;
const secondary = `${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

export default function CarelonClientPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = String(params?.clientId || '');
  const [data, setData] = useState<ViewData | null>(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [inOffice, setInOffice] = useState(false);
  const [service, setService] = useState('');
  const [reason, setReason] = useState('');
  const [maNumber, setMaNumber] = useState('');
  const [partB, setPartB] = useState({ printedName: '', title: '', signature: '', agree: false });
  const [submittedOn, setSubmittedOn] = useState('');
  const [reference, setReference] = useState('');
  const [voidReason, setVoidReason] = useState('');
  const [showVoid, setShowVoid] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch(`/api/consents/carelon?clientId=${encodeURIComponent(clientId)}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || 'Could not load');
      setData(json as ViewData);
      if (!submittedOn) {
        const [y, m, d] = practiceToday(json.timeZone).split('-');
        setSubmittedOn(`${m}/${d}/${y}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the attestation');
    }
  }, [clientId, submittedOn]);

  useEffect(() => {
    if (clientId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const call = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    setErrors([]);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok || !json.success) {
        setError(json.error || 'Could not save');
        setErrors(Array.isArray(json.errors) ? json.errors : []);
        return false;
      }
      await load();
      return true;
    } catch {
      setError('Network error: try again');
      return false;
    } finally {
      setBusy(false);
    }
  };
  const act = (id: string, body: Record<string, unknown>) => call(`/api/consents/carelon/${encodeURIComponent(id)}`, body);

  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        {error ? <Alert tone="danger">{error}</Alert> : <p role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 size={14} className="animate-spin" /> Loading…</p>}
      </div>
    );
  }

  const open = data.attestations.find((a) => a.id === data.requirement.openId) ?? null;
  const current = data.attestations.find((a) => a.id === data.requirement.currentId) ?? null;
  const history = data.attestations.filter((a) => a.id !== open?.id && a.id !== current?.id);
  const tz = data.timeZone;
  const p = data.prefill;
  const template: CarelonTemplate = open?.formData.document?.template ?? carelonTemplate(open?.formData.version)!;
  const partBErrors = validatePartB(partB);

  return (
    <div className="space-y-5">
      <BackLink />
      <PageHeader
        eyebrow="Altrixs · Consents · Carelon"
        title={data.client.name}
        description={`${data.client.mrn ? `MRN ${data.client.mrn} · ` : ''}Carelon non-overlap attestation · ${REQUIREMENT_LABEL[data.requirement.state]}`}
        actions={<Link href={`/dashboard/clients/${encodeURIComponent(data.client.id)}`} className={secondary}>Open chart</Link>}
      />

      <Panel>
        <h2 className="text-sm font-semibold text-slate-900">Maryland Medicaid</h2>
        {data.medicaid.medicaid ? (
          <ul className="mt-1 list-disc pl-5 text-[13px] text-slate-600">{data.medicaid.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        ) : (
          <p className="mt-1 flex items-start gap-1.5 text-[13px] text-amber-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Not detected as Maryland Medicaid, so the attestation is not required. You can still start one if the client has Medicaid that is not on file yet (add the coverage too).</p>
        )}
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-slate-600">How Medicaid is detected</summary>
          <div className="mt-1 space-y-1 text-xs text-slate-600">{data.ruleExplanation.map((r) => <p key={r}>{r}</p>)}</div>
        </details>
      </Panel>

      {error ? (
        <div role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          {error}
          {errors.length > 1 ? <ul className="mt-1 list-disc pl-5">{errors.slice(1).map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </div>
      ) : null}

      {!open && data.permissions.manage ? (
        <Panel>
          <h2 className="text-sm font-semibold text-slate-900">{current ? 'New attestation needed?' : 'Start the attestation'}</h2>
          <p className="mt-1 text-[13px] text-slate-600">{current ? data.comarNote : 'One completed attestation is required on file for every Maryland Medicaid client.'}</p>
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold text-slate-600">
              New service (optional)
              <select value={service} onChange={(e) => setService(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 p-2 text-sm">
                <option value="">None (standing Medicaid requirement)</option>
                {data.services.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>
            <label className="min-w-[14rem] flex-1 text-xs font-semibold text-slate-600">
              Note (optional)
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" />
            </label>
            <button type="button" disabled={busy} className={primary} onClick={() => void call('/api/consents/carelon', { clientId: data.client.id, service: service || null, reason: reason || null })}>
              <FileSignature size={15} /> {current ? 'Mark new attestation needed' : 'Start attestation'}
            </button>
          </div>
        </Panel>
      ) : null}

      {open ? (
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Current request: {CARELON_STATUS_LABEL[open.status]}</h2>
              {open.neededReasons.length ? <p className="text-xs text-slate-500">{open.neededReasons.join(' · ')}</p> : null}
            </div>
            <a href={`/api/consents/carelon/${encodeURIComponent(open.id)}/pdf`} className={secondary}><Download size={15} /> {open.formData.document ? 'PDF' : 'Print prefilled form'}</a>
          </div>

          {!open.formData.document ? (
            <>
              {p.blockers.length ? (
                <div className="rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
                  <p className="font-semibold">The form cannot be signed yet:</p>
                  <ul className="mt-1 list-disc pl-5">{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                  <p className="mt-1">Provider NPI and TIN come from Practice settings &gt; Profile (organization NPI, EIN) or Billing &gt; Payer settings &gt; Billing providers.</p>
                </div>
              ) : null}
              {p.participant.warnings.map((w) => <p key={w} className="text-xs text-amber-800">{w}</p>)}
              {!p.participant.participantId || p.participant.participantIdSource === 'coverage_member_id' ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs font-semibold text-slate-600">
                    Participant ID: 11-digit Maryland Medicaid (MA) number
                    <input value={maNumber} onChange={(e) => setMaNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 11))} inputMode="numeric" className="mt-1 block rounded-lg border border-slate-300 p-2 text-sm" />
                  </label>
                  <button type="button" disabled={busy || maNumber.length !== 11} className={secondary} onClick={() => void act(open.id, { action: 'set_participant_id', medicaidId: maNumber })}>Save to client</button>
                </div>
              ) : null}
              {p.providerOptions.length > 1 ? (
                <label className="block text-xs font-semibold text-slate-600">
                  Provider NPI on the form
                  <select value={p.provider.optionKey ?? ''} disabled={busy} onChange={(e) => void act(open.id, { action: 'set_provider', optionKey: e.target.value })} className="mt-1 block w-full max-w-xl rounded-lg border border-slate-300 p-2 text-sm">
                    {p.providerOptions.map((o) => (
                      <option key={o.key} value={o.key}>{o.label} · NPI {o.npi} · TIN {o.tinMasked ?? 'missing'}{o.key === p.defaultOptionKey ? ' (default: bills PBHS)' : ''}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}

          <CarelonFormView
            template={template}
            participant={open.formData.document?.participant ?? p.participant}
            provider={open.formData.document?.provider ?? p.provider}
            partA={open.formData.partA}
            partB={open.formData.partB}
            maskTin
          />

          {(open.status === 'NOT_STARTED' || open.status === 'SENT') && data.permissions.manage ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy || p.blockers.length > 0} className={primary} onClick={() => void act(open.id, { action: 'send' })}>
                  <Send size={15} /> {open.status === 'SENT' ? 'Resend to patient portal' : 'Send to patient portal'}
                </button>
                <button type="button" disabled={busy || p.blockers.length > 0} className={secondary} onClick={() => setInOffice((v) => !v)}>
                  <FileSignature size={15} /> Sign in office now
                </button>
                <button type="button" disabled={busy} className={secondary} onClick={() => setShowVoid((v) => !v)}><XCircle size={15} /> Cancel request</button>
              </div>
              {open.status === 'SENT' && open.sentAt ? <p className="text-xs text-slate-500">Sent to the portal (Documents to sign) on {formatPracticeMdY(open.sentAt, tz)}.</p> : null}
              {inOffice ? (
                <CarelonPartAForm mode="in_office" busy={busy} submitLabel="Record Part A signature" onCancel={() => setInOffice(false)} onSubmit={(v: PartAInput) => void act(open.id, { action: 'sign_participant', partA: v }).then((ok) => ok && setInOffice(false))} />
              ) : null}
            </div>
          ) : null}

          {open.status === 'CLIENT_SIGNED' ? (
            <div className="space-y-3">
              {open.blanks.length ? (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900 ring-1 ring-amber-200">
                  <span>Signed in the intake packet with blank fields: {open.blanks.join(', ')}. Add them to the chart / practice settings, then fill them in.</span>
                  {open.blanks.includes('Participant ID') ? (
                    <span className="flex items-center gap-1">
                      <input value={maNumber} onChange={(e) => setMaNumber(e.target.value.replace(/[^\d]/g, '').slice(0, 11))} placeholder="11-digit MA number" className="rounded border border-amber-300 p-1 text-sm" />
                      <button type="button" disabled={busy || maNumber.length !== 11} className={secondary} onClick={() => void act(open.id, { action: 'set_participant_id', medicaidId: maNumber })}>Save</button>
                    </span>
                  ) : null}
                  <button type="button" disabled={busy} className={secondary} onClick={() => void act(open.id, { action: 'fill_blanks' })}>Fill from chart</button>
                </div>
              ) : null}
              {data.permissions.signProvider ? (
                <div className="space-y-3 rounded-xl border border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-slate-900">Part B: provider or authorized provider representative</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs font-semibold text-slate-600">Printed name
                      <input value={partB.printedName} onChange={(e) => setPartB({ ...partB, printedName: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600">Title
                      <input value={partB.title} onChange={(e) => setPartB({ ...partB, title: e.target.value })} placeholder="e.g. LCPC, Therapist; Office Manager" className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" />
                    </label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Signature: type your printed name again
                      <input value={partB.signature} onChange={(e) => setPartB({ ...partB, signature: e.target.value })} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 font-serif text-base italic" />
                    </label>
                  </div>
                  <label className="flex items-start gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={partB.agree} onChange={(e) => setPartB({ ...partB, agree: e.target.checked })} className="mt-1 h-4 w-4" />
                    <span>I attest to Part B statements 1 to 4 above. Typing my name is my electronic signature.</span>
                  </label>
                  <button type="button" disabled={busy || partBErrors.length > 0 || open.blanks.length > 0} className={primary} onClick={() => void act(open.id, { action: 'sign_provider', partB })}>
                    <CheckCircle2 size={15} /> Sign Part B and complete
                  </button>
                </div>
              ) : null}
              {data.permissions.manage ? <button type="button" disabled={busy} className={secondary} onClick={() => setShowVoid((v) => !v)}><XCircle size={15} /> Cancel request</button> : null}
            </div>
          ) : null}

          {showVoid ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-3">
              <label className="min-w-[16rem] flex-1 text-xs font-semibold text-slate-600">Reason for cancelling
                <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-2 text-sm" />
              </label>
              <button type="button" disabled={busy || voidReason.trim().length < 3} className={secondary} onClick={() => void act(open.id, { action: 'void', reason: voidReason }).then((ok) => ok && setShowVoid(false))}>Cancel this request</button>
            </div>
          ) : null}
        </Panel>
      ) : null}

      {current ? (
        <Panel className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-900">On file: {CARELON_STATUS_LABEL[current.status]}{current.providerSignedAt ? ` · completed ${formatPracticeMdY(current.providerSignedAt, tz)}` : ''}</h2>
            <a href={`/api/consents/carelon/${encodeURIComponent(current.id)}/pdf`} className={secondary}><Download size={15} /> Signed PDF</a>
          </div>
          {current.status === 'SUBMITTED' && current.formData.submission ? (
            <p className="text-[13px] text-emerald-800">Submitted to Carelon on {current.formData.submission.submittedOn}{current.formData.submission.recordedByName ? ` (recorded by ${current.formData.submission.recordedByName})` : ''}{current.formData.submission.reference ? `, reference ${current.formData.submission.reference}` : ''}.</p>
          ) : data.permissions.markSubmitted ? (
            <div className="space-y-2 rounded-lg bg-slate-50 p-3">
              <p className="text-[13px] text-slate-700">Download the signed PDF, upload it in Carelon&apos;s provider portal, then record the date here. Altrixs does not send it to Carelon.</p>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs font-semibold text-slate-600">Submitted on (MM/DD/YYYY)
                  <input value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} className="mt-1 block w-36 rounded-lg border border-slate-300 p-2 text-sm" />
                </label>
                <label className="text-xs font-semibold text-slate-600">Carelon reference (optional)
                  <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className="mt-1 block w-48 rounded-lg border border-slate-300 p-2 text-sm" />
                </label>
                <button type="button" disabled={busy} className={primary} onClick={() => void act(current.id, { action: 'mark_submitted', submittedOn, reference: reference || null })}><Send size={15} /> Record Carelon submission</button>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-slate-600">Signed; not yet recorded as submitted to Carelon (front office records it).</p>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-semibold text-slate-600">View the signed form</summary>
            {current.formData.document ? (
              <div className="mt-2">
                <CarelonFormView template={current.formData.document.template} participant={current.formData.document.participant} provider={current.formData.document.provider} partA={current.formData.partA} partB={current.formData.partB} maskTin />
              </div>
            ) : null}
          </details>
        </Panel>
      ) : null}

      {history.length ? (
        <Panel>
          <h2 className="text-sm font-semibold text-slate-900">Earlier attestations</h2>
          <ul className="mt-2 divide-y divide-slate-100 text-[13px]">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{CARELON_STATUS_LABEL[h.status]} · started {formatPracticeMdY(h.createdAt, tz)}{h.providerSignedAt ? ` · completed ${formatPracticeMdY(h.providerSignedAt, tz)}` : ''}{h.neededReasons.length ? ` · ${h.neededReasons.join(' · ')}` : ''}</span>
                {h.formData.document ? <a href={`/api/consents/carelon/${encodeURIComponent(h.id)}/pdf`} className="font-semibold text-blue-600 hover:underline">PDF</a> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/dashboard/ehr/consents/carelon" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:underline">
      <ArrowLeft size={14} /> Carelon attestations
    </Link>
  );
}
