'use client';

/**
 * Treatment plan signatures: clinician → supervisor (only when the author is pre-licensed) →
 * patient via the portal. Every action is checked again on the server
 * (POST /api/ehr/treatment-plans/[id]/signatures).
 */
import { useState, type ReactNode } from 'react';
import { CheckCircle2, Clock, PenLine, Send, ShieldCheck, Undo2, UserCheck, XCircle } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { PATIENT_SIGNATURE_LABELS, type PatientSignatureStatus } from '@/lib/ehr/therapy/rules';
import { PATIENT_SIGNER_ATTESTATION, PROVIDER_SIGNER_ATTESTATION, type OtherSignature, type PersonSignerRole } from '@/lib/ehr/therapy/planDocument';
import { inputCls, smallBtn } from '@/components/notes/structuredNoteUi';

export type PlanSignatures = {
  clinicianSignedAt: string | null;
  clinicianSignedByName: string | null;
  supervisorRequired: boolean;
  supervisorSignedAt: string | null;
  supervisorSignedByName: string | null;
  patientStatus: PatientSignatureStatus;
  patientSentAt: string | null;
  patientSignedAt: string | null;
  patientSignedName: string | null;
  patientDeclinedAt: string | null;
  patientDeclineReason: string | null;
  patientVerbalBy: string | null;
  /** Guardian(s), guarantor, other signers, other providers */
  others?: OtherSignature[];
};

export type PanelPlan = {
  id: string;
  status: string;
  clinicianId: string | null;
  signatures: PlanSignatures;
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export function PlanSignaturePanel({
  plan,
  currentUserId,
  onChanged,
  /** Sign is offered here only when the parent has no sign button of its own */
  allowSign = true,
  blockers = [],
}: {
  plan: PanelPlan;
  currentUserId: string | null;
  onChanged: () => void;
  allowSign?: boolean;
  blockers?: string[];
}) {
  const s = plan.signatures;
  const isAuthor = Boolean(currentUserId && plan.clinicianId === currentUserId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [attested, setAttested] = useState(false);
  const [comment, setComment] = useState('');
  const [verbalBy, setVerbalBy] = useState('');
  const [verbalOpen, setVerbalOpen] = useState(false);
  const [inOfficeOpen, setInOfficeOpen] = useState(false);
  const [signerRole, setSignerRole] = useState<PersonSignerRole>('Guardian');
  const [signerName, setSignerName] = useState('');
  const [signerRelationship, setSignerRelationship] = useState('');
  const [signerAttested, setSignerAttested] = useState(false);
  const [providerAttested, setProviderAttested] = useState(false);
  const others = s.others ?? [];
  const patientDone = s.patientStatus === 'SIGNED' || s.patientStatus === 'VERBAL';

  const act = async (body: Record<string, unknown>, confirmText?: string): Promise<boolean> => {
    if (confirmText && !window.confirm(confirmText)) return false;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiJson<{ success: true; portalAccount: boolean }>(`/api/ehr/treatment-plans/${encodeURIComponent(plan.id)}/signatures`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if ((body.action === 'sign' || body.action === 'send') && res.portalAccount === false) {
        setNotice('Sent to the portal, but this client has no portal account yet. Invite them from the client chart, or record verbal consent (telehealth).');
      }
      onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the signature');
      return false;
    } finally {
      setBusy(false);
    }
  };

  const row = (icon: ReactNode, title: string, body: ReactNode) => (
    <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0 flex-1 space-y-1.5 text-xs text-slate-700">
        <p className="font-semibold text-slate-900">{title}</p>
        {body}
      </div>
    </div>
  );

  const patientIcon =
    s.patientStatus === 'SIGNED' || s.patientStatus === 'VERBAL' ? (
      <CheckCircle2 size={16} className="text-emerald-700" />
    ) : s.patientStatus === 'DECLINED' ? (
      <XCircle size={16} className="text-rose-600" />
    ) : (
      <Clock size={16} className="text-amber-700" />
    );

  return (
    <div className="space-y-2">
      {row(
        s.clinicianSignedAt ? <CheckCircle2 size={16} className="text-emerald-700" /> : <PenLine size={16} className="text-slate-500" />,
        'Clinician signature',
        s.clinicianSignedAt ? (
          <p>Signed by {s.clinicianSignedByName || 'clinician'} · {when(s.clinicianSignedAt)}</p>
        ) : allowSign ? (
          isAuthor ? (
            <>
              {blockers.length ? (
                <ul className="list-disc pl-4 text-rose-700">
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              ) : null}
              <label className="flex items-start gap-2">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={attested} onChange={(e) => setAttested(e.target.checked)} />
                <span><strong>{PROVIDER_SIGNER_ATTESTATION}</strong> Signing sends it to the client’s portal for signature.</span>
              </label>
              <button type="button" disabled={!attested || busy || blockers.length > 0} className={`${smallBtn} border-blue-600/40 text-blue-600`} onClick={() => void act({ action: 'sign', attested: true })}>
                <PenLine size={12} /> Sign &amp; send to client
              </button>
            </>
          ) : (
            <p className="text-slate-500">Not signed. Only the plan’s clinician can sign it.</p>
          )
        ) : (
          <p className="text-slate-500">Not signed.</p>
        )
      )}
      {row(
        !s.supervisorRequired ? (
          <ShieldCheck size={16} className="text-slate-500" />
        ) : s.supervisorSignedAt ? (
          <CheckCircle2 size={16} className="text-emerald-700" />
        ) : (
          <Clock size={16} className="text-amber-700" />
        ),
        'Supervisor signature',
        !s.clinicianSignedAt ? (
          <p className="text-slate-500">Required only when the clinician is pre-licensed (decided when the clinician signs).</p>
        ) : !s.supervisorRequired ? (
          <p className="text-slate-500">Not required — the clinician is licensed.</p>
        ) : s.supervisorSignedAt ? (
          <p>Signed by {s.supervisorSignedByName || 'supervisor'} · {when(s.supervisorSignedAt)}</p>
        ) : (
          <>
            <p className="font-semibold text-amber-800">Awaiting supervisor signature (pre-licensed clinician). The plan is not active until it is signed.</p>
            {!isAuthor ? (
              <>
                <p className="text-[11px] text-slate-600">Attestation: {PROVIDER_SIGNER_ATTESTATION}</p>
                <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Supervisor comment (optional)" className={inputCls} />
                <button type="button" disabled={busy} className={`${smallBtn} border-emerald-300 text-emerald-800`} onClick={() => void act({ action: 'cosign', comment: comment.trim() || null })}>
                  <UserCheck size={12} /> Co-sign as supervisor
                </button>
              </>
            ) : null}
          </>
        )
      )}
      {row(
        patientIcon,
        `Client signature — ${PATIENT_SIGNATURE_LABELS[s.patientStatus]}`,
        <>
          {s.patientStatus === 'AWAITING' && s.patientSentAt ? <p>Sent to the client portal {when(s.patientSentAt)}.</p> : null}
          {s.patientStatus === 'SIGNED' ? <p>Signed by {s.patientSignedName || 'client'} · {when(s.patientSignedAt)}</p> : null}
          {s.patientStatus === 'VERBAL' ? <p>Verbal consent obtained by {s.patientVerbalBy} · {when(s.patientSignedAt)}</p> : null}
          {s.patientStatus === 'DECLINED' ? (
            <p className="text-rose-700">
              Declined {when(s.patientDeclinedAt)}{s.patientDeclineReason ? ` — “${s.patientDeclineReason}”` : ''}. Review the plan with the client, then re-send.
            </p>
          ) : null}
          {s.clinicianSignedAt && (s.patientStatus === 'AWAITING' || s.patientStatus === 'DECLINED' || s.patientStatus === 'NOT_SENT') ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={smallBtn} onClick={() => void act({ action: 'send' })}>
                <Send size={12} /> {s.patientStatus === 'NOT_SENT' ? 'Send to client portal' : 'Re-send to client portal'}
              </button>
              <button type="button" className={smallBtn} onClick={() => setVerbalOpen(!verbalOpen)}>
                Record verbal consent (telehealth)
              </button>
            </div>
          ) : null}
          {verbalOpen ? (
            <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
              <p className="text-[11px] text-slate-500">
                Per the clinic ITP form: read the whole plan to the client (or parent / guardian), answer questions, and record that they agreed.
              </p>
              <input value={verbalBy} onChange={(e) => setVerbalBy(e.target.value)} placeholder="Verbal consent obtained by (staff name)" className={inputCls} />
              <button type="button" disabled={busy || verbalBy.trim().length < 2} className={smallBtn} onClick={() => void act({ action: 'verbal', obtainedBy: verbalBy.trim() })}>
                Save verbal consent
              </button>
            </div>
          ) : null}
        </>
      )}
      {s.clinicianSignedAt ? (
        row(
          others.length ? <CheckCircle2 size={16} className="text-emerald-700" /> : <PenLine size={16} className="text-slate-500" />,
          'Guardian(s), guarantor and other signers',
          <>
            {others.length ? (
              <ul className="space-y-0.5">
                {others.map((o) => (
                  <li key={o.id}>
                    <strong>{o.role}</strong>: {o.name}
                    {o.relationship ? ` (${o.relationship})` : ''} · {when(o.signedAt)} · {o.method === 'portal' ? 'portal' : o.method === 'in-app' ? 'in Altrixs' : `in office${o.recordedBy ? `, recorded by ${o.recordedBy}` : ''}`}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-500">None yet. Guardians and the guarantor can sign in the portal after the patient, or in office here.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {isAuthor ? (
                <button type="button" className={smallBtn} onClick={() => setInOfficeOpen(!inOfficeOpen)}>
                  <PenLine size={12} /> Record in-office signature
                </button>
              ) : null}
            </div>
            {inOfficeOpen ? (
              <div className="space-y-1.5 rounded-lg border border-slate-200 p-2">
                <label className="block text-[11px] font-semibold text-slate-600">
                  Signer
                  <select value={signerRole} onChange={(e) => setSignerRole(e.target.value as PersonSignerRole)} className={`mt-0.5 ${inputCls}`}>
                    {!patientDone ? <option value="Patient">Patient</option> : null}
                    <option value="Guardian">Guardian</option>
                    <option value="Guarantor">Guarantor</option>
                    <option value="Other signer">Other signer</option>
                  </select>
                </label>
                <input value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Signer’s full name (typed by the signer)" className={inputCls} />
                <input
                  value={signerRelationship}
                  onChange={(e) => setSignerRelationship(e.target.value)}
                  placeholder={signerRole === 'Patient' ? 'Relationship (leave blank for self)' : 'Relationship to the patient (e.g. mother, legal guardian)'}
                  className={inputCls}
                />
                <label className="flex items-start gap-2 text-[11px]">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={signerAttested} onChange={(e) => setSignerAttested(e.target.checked)} />
                  <span>
                    The signer read the plan and agreed: <strong>{PATIENT_SIGNER_ATTESTATION}</strong>
                  </span>
                </label>
                <button
                  type="button"
                  disabled={busy || !signerAttested || signerName.trim().length < 2 || (signerRole !== 'Patient' && !signerRelationship.trim())}
                  className={smallBtn}
                  onClick={() =>
                    void act({ action: 'inOffice', role: signerRole, typedName: signerName.trim(), relationship: signerRelationship.trim() || null, attested: true }).then((ok) => {
                      if (!ok) return;
                      setSignerName('');
                      setSignerRelationship('');
                      setSignerAttested(false);
                      setInOfficeOpen(false);
                    })
                  }
                >
                  Save signature
                </button>
              </div>
            ) : null}
            {!isAuthor && currentUserId ? (
              <div className="space-y-1 rounded-lg border border-slate-200 p-2">
                <label className="flex items-start gap-2 text-[11px]">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-blue-600" checked={providerAttested} onChange={(e) => setProviderAttested(e.target.checked)} />
                  <span>
                    Sign as another provider on the care team: <strong>{PROVIDER_SIGNER_ATTESTATION}</strong>
                  </span>
                </label>
                <button type="button" disabled={busy || !providerAttested} className={smallBtn} onClick={() => void act({ action: 'providerSign', attested: true })}>
                  <UserCheck size={12} /> Sign as provider
                </button>
              </div>
            ) : null}
          </>
        )
      ) : null}
      {s.clinicianSignedAt ? (
        <button
          type="button"
          disabled={busy}
          className={`${smallBtn} text-slate-500`}
          onClick={() => void act({ action: 'reopen' }, 'Reopen this plan for editing? All signatures (clinician, supervisor, client) are cleared and the plan stops being active until it is signed again.')}
        >
          <Undo2 size={12} /> Reopen for edits
        </button>
      ) : null}
      {notice ? <p className="text-xs text-amber-700">{notice}</p> : null}
      {error ? <p className="text-xs text-rose-700">{error}</p> : null}
    </div>
  );
}
