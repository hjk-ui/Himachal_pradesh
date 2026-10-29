'use client';

/**
 * Patient portal: documents to sign (treatment plans sent by the clinician). The patient — or
 * the parent / guardian of a minor — reads the plan exactly as the clinician signed it, then
 * signs with their typed name or declines with a reason.
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { readPatientApi } from '@/features/patient/api';
import { clearPatientToken, getPatientToken } from '@/features/patient/tokenStorage';
import { TreatmentPlanDocumentView } from '@/components/therapy/TreatmentPlanDocument';
import { PATIENT_SIGNER_ATTESTATION, type PlanDocument, type SignatureBlock } from '@/lib/ehr/therapy/planDocument';
import { CarelonFormView } from '@/components/consents/CarelonFormView';
import { CarelonPartAForm } from '@/components/consents/CarelonPartAForm';
import type { CarelonTemplate } from '@/lib/consents/carelon/template';
import type { PartAInput, PartASignature } from '@/lib/consents/carelon/workflow';
import { ConsentPacketForm, type PacketFormItem } from '@/components/consents/ConsentPacketForm';
import { PatientConsentRevocations } from '@/components/consents/PatientConsentRevocations';
import type { MinorRule } from '@/lib/consents/library/composer';
import { PortalPersonSwitcher, type PortalActingAs } from '@/features/patient/PortalPersonSwitcher';
import type { PacketSubmission } from '@/lib/consents/library/signing';
import { ArrowLeft, FileSignature } from 'lucide-react';
import { PORTAL_ACTIONS, PORTAL_BUTTON, PORTAL_MAIN } from '@/features/patient/portalLayout';
import { Alert, Button, buttonClasses, Card, cx, EmptyState, FOCUS_RING, inputClasses, LoadingState, PageHeader, StatusBadge } from '@/components/ui';

type DocStatus = 'AWAITING' | 'SIGNED' | 'DECLINED' | 'NOT_SENT' | 'VERBAL';
type PatientDocument = {
  id: string;
  kind: 'treatment-plan' | 'carelon-attestation' | 'consent-packet';
  title: string;
  status: DocStatus;
  sentAt: string | null;
  clinicianName: string | null;
  signedAt: string | null;
  signedName: string | null;
  declinedAt: string | null;
  declineReason: string | null;
  text?: string;
  /** Structured plan as signed by the clinician (null for older plans: shown as text) */
  document?: PlanDocument | null;
  signatures?: SignatureBlock[];
  /** Carelon non-overlap attestation (Maryland Medicaid): form text, prefilled info, Part A */
  carelon?: {
    template: CarelonTemplate;
    participant: { participantName: string | null; participantId: string | null; dateOfBirth: string | null };
    provider: { organizationName: string | null; npi: string | null; tin: string | null };
    partA: PartASignature | null;
    guardian: { name: string | null; relationship: string | null } | null;
  };
  /** Consent packet (consent library): sections to acknowledge + one final signature */
  packet?: {
    items: PacketFormItem[];
    minor: MinorRule | null;
    guardian: { name: string | null; relationship: string | null; authority: string | null } | null;
    clientName: string;
  };
};

type Relationship = 'Self' | 'Parent' | 'Legal guardian' | 'Guarantor';

const STATUS_TEXT: Record<DocStatus, string> = {
  AWAITING: 'Waiting for your signature',
  SIGNED: 'Signed',
  DECLINED: 'Declined',
  NOT_SENT: 'Not sent',
  VERBAL: 'Agreed verbally',
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function PatientDocumentsPage() {
  const router = useRouter();
  const [docs, setDocs] = useState<PatientDocument[] | null>(null);
  const [open, setOpen] = useState<PatientDocument | null>(null);
  const [error, setError] = useState('');
  const [typedName, setTypedName] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('Self');
  const [cosigning, setCosigning] = useState(false);
  const [agree, setAgree] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Signed in as a guardian / representative: signatures are always as the representative
  const [actingAs, setActingAs] = useState<PortalActingAs | null>(null);
  const repRelationship: Relationship = actingAs?.relationship === 'parent' ? 'Parent' : 'Legal guardian';

  const call = useCallback(
    async <T,>(path: string, init?: RequestInit): Promise<T | null> => {
      const token = getPatientToken();
      if (!token) {
        router.replace('/patient/login');
        return null;
      }
      const res = await fetch(path, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      if (res.status === 401) {
        clearPatientToken();
        router.replace('/patient/login');
        return null;
      }
      return readPatientApi<T>(res);
    },
    [router]
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await call<{ documents: PatientDocument[] }>('/api/patient/documents');
      if (data) setDocs(data.documents);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your documents.');
    }
  }, [call]);
  useEffect(() => {
    void load();
  }, [load]);

  const openDoc = async (id: string) => {
    setError('');
    setAgree(false);
    setTypedName('');
    setDeclining(false);
    setCosigning(false);
    setRelationship(actingAs?.isProxy ? repRelationship : 'Self');
    setReason('');
    try {
      const data = await call<{ document: PatientDocument }>(`/api/patient/documents/${encodeURIComponent(id)}`);
      if (data) setOpen(data.document);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open the document.');
    }
  };

  const respond = async (body: Record<string, unknown>) => {
    if (!open) return;
    setBusy(true);
    setError('');
    try {
      const data = await call<{ document: PatientDocument }>(`/api/patient/documents/${encodeURIComponent(open.id)}/respond`, { method: 'POST', body: JSON.stringify(body) });
      if (data) {
        setOpen(data.document);
        setCosigning(false);
        setTypedName('');
        setAgree(false);
        await load();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your response.');
    } finally {
      setBusy(false);
    }
  };

  const field = cx(inputClasses, 'mt-1.5 h-11 text-base');

  return (
    <main className={PORTAL_MAIN}>
      <PageHeader
        eyebrow="Altrixs"
        title="Documents to sign"
        description="Your treatment plan from your counselor or therapist, and forms the clinic needs you to sign. Read each one, then sign or tell them what you disagree with."
        actions={
          <Link href="/patient/home" className={buttonClasses({ variant: 'ghost', size: 'lg', className: 'h-11 self-start' })}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to your account
          </Link>
        }
      />
      <PortalPersonSwitcher onContext={(a) => { setActingAs(a); if (a?.isProxy) setRelationship(a.relationship === 'parent' ? 'Parent' : 'Legal guardian'); }} />
      {error ? (
        <Alert
          tone="danger"
          className="mt-4"
          actions={!open && docs === null ? <Button variant="secondary" size="lg" className="h-11" onClick={() => void load()}>Try again</Button> : undefined}
        >
          {error}
        </Alert>
      ) : null}

      {!open ? (
        <section className="mt-6 space-y-2" aria-label="Your documents">
          {docs === null && !error ? <LoadingState label="Loading your documents…" /> : null}
          {docs && docs.length === 0 ? (
            <Card>
              <EmptyState
                icon={<FileSignature />}
                title="Nothing to sign right now."
                description="When your care team sends you a treatment plan or form to sign, it will show up here."
              />
            </Card>
          ) : null}
          {docs?.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => void openDoc(d.id)}
              className={cx(
                'flex min-h-[44px] w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-xs transition hover:bg-slate-50 hover:shadow-sm',
                FOCUS_RING,
              )}
            >
              <span className="min-w-0">
                <span className="block break-words text-base font-semibold text-slate-900">{d.title}</span>
                <span className="block text-sm text-slate-500">{d.clinicianName ? `From ${d.clinicianName} · ` : ''}{when(d.sentAt)}</span>
              </span>
              <StatusBadge tone={d.status === 'AWAITING' ? 'warning' : d.status === 'SIGNED' ? 'success' : 'neutral'} className="shrink-0">
                {STATUS_TEXT[d.status]}
              </StatusBadge>
            </button>
          ))}
          <PatientConsentRevocations call={call} />
        </section>
      ) : (
        <section className="mt-6 space-y-4">
          <Button variant="ghost" size="lg" className="-ml-3 h-11" icon={<ArrowLeft />} onClick={() => setOpen(null)}>All documents</Button>
          {open.kind === 'consent-packet' && open.packet ? (
            <>
              {open.status === 'AWAITING' ? (
                <ConsentPacketForm
                  mode="portal"
                  items={open.packet.items}
                  minor={open.packet.minor}
                  guardian={open.packet.guardian}
                  defaultPrintedName={open.packet.clientName}
                  busy={busy}
                  submitLabel="Sign the consent packet"
                  onSubmit={(sub: PacketSubmission) => void respond({ decision: 'consent_packet', ...sub })}
                />
              ) : (
                <Alert tone="success">Signed by {open.signedName} on {when(open.signedAt)}. Ask the clinic for a copy at any time.</Alert>
              )}
              <p className="text-sm text-slate-500">In a crisis, call or text 988 (Suicide &amp; Crisis Lifeline) or call 911.</p>
            </>
          ) : open.kind === 'carelon-attestation' && open.carelon ? (
            <>
              <CarelonFormView template={open.carelon.template} participant={open.carelon.participant} provider={open.carelon.provider} partA={open.carelon.partA} />
              {open.status === 'AWAITING' ? (
                <CarelonPartAForm
                  mode="portal"
                  busy={busy}
                  guardian={open.carelon.guardian}
                  submitLabel="Sign Part A"
                  onSubmit={(v: PartAInput) => void respond({ decision: 'attest', ...v, agree: true })}
                />
              ) : (
                <Alert tone="success">Signed by {open.signedName} on {when(open.signedAt)}. The clinic completes the provider part and sends it to Carelon.</Alert>
              )}
              <p className="text-sm text-slate-500">In a crisis, call or text 988 (Suicide &amp; Crisis Lifeline) or call 911.</p>
            </>
          ) : (
          <>
          {open.document ? (
            <div className="max-h-[70dvh] min-w-0 overflow-auto">
              <TreatmentPlanDocumentView document={open.document} signatures={open.signatures ?? []} />
            </div>
          ) : (
            <Card className="p-5">
              <h2 className="break-words text-lg font-semibold text-slate-900">{open.title}</h2>
              <pre className="mt-3 max-h-[60dvh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-base leading-7 text-slate-800">{open.text}</pre>
            </Card>
          )}
          {open.status === 'SIGNED' || open.status === 'VERBAL' ? (
            <div className="space-y-3">
              {open.status === 'SIGNED' ? (
                <Alert tone="success">Signed by {open.signedName} on {when(open.signedAt)}.</Alert>
              ) : null}
              {!cosigning ? (
                <Button variant="secondary" size="lg" className={cx(PORTAL_BUTTON, 'h-auto whitespace-normal py-2 text-left')} onClick={() => { setCosigning(true); setRelationship('Legal guardian'); setAgree(false); setTypedName(''); }}>
                  Add another signature (guardian or guarantor)
                </Button>
              ) : (
                <Card className="space-y-4 p-5">
                  <label className="block text-sm font-medium text-slate-700">
                    I am signing as
                    <select value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)} className={field}>
                      <option value="Parent">Parent of the client</option>
                      <option value="Legal guardian">Legal guardian of the client</option>
                      <option value="Guarantor">Guarantor (responsible for the bill)</option>
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Type your full name
                    <input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" className={field} />
                  </label>
                  <label className="flex items-start gap-3 text-base text-slate-700">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                    <span>{PATIENT_SIGNER_ATTESTATION} Typing my name is my electronic signature.</span>
                  </label>
                  <div className={PORTAL_ACTIONS}>
                    <Button
                      size="lg"
                      className={PORTAL_BUTTON}
                      disabled={busy || !agree || typedName.trim().length < 2 || relationship === 'Self'}
                      onClick={() => void respond({ decision: 'cosign', typedName: typedName.trim(), signerRelationship: relationship, agree: true })}
                    >
                      {busy ? 'Saving…' : 'Sign'}
                    </Button>
                    <Button variant="secondary" size="lg" className={PORTAL_BUTTON} onClick={() => setCosigning(false)}>
                      Cancel
                    </Button>
                  </div>
                </Card>
              )}
            </div>
          ) : open.status === 'DECLINED' ? (
            <Alert tone="neutral">You declined on {when(open.declinedAt)}. Your counselor will review the plan with you.</Alert>
          ) : open.status === 'AWAITING' ? (
            <Card className="space-y-4 p-5">
              {!declining ? (
                <>
                  <label className="block text-sm font-medium text-slate-700">
                    I am signing as
                    <select value={relationship} onChange={(e) => setRelationship(e.target.value as typeof relationship)} className={field}>
                      {!actingAs?.isProxy && <option value="Self">The client (myself)</option>}
                      <option value="Parent">Parent of the client</option>
                      <option value="Legal guardian">Legal guardian of the client</option>
                      <option value="Guarantor">Guarantor (responsible for the bill)</option>
                    </select>
                  </label>
                  <label className="block text-sm font-medium text-slate-700">
                    Type your full name
                    <input value={typedName} onChange={(e) => setTypedName(e.target.value)} autoComplete="name" className={field} />
                  </label>
                  <label className="flex items-start gap-3 text-base text-slate-700">
                    <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-600" />
                    <span>I have read this treatment plan. {PATIENT_SIGNER_ATTESTATION} Typing my name is my electronic signature.</span>
                  </label>
                  <div className={PORTAL_ACTIONS}>
                    <Button
                      size="lg"
                      className={PORTAL_BUTTON}
                      disabled={busy || !agree || typedName.trim().length < 2}
                      onClick={() => void respond({ decision: 'sign', typedName: typedName.trim(), signerRelationship: relationship, agree: true })}
                    >
                      {busy ? 'Saving…' : 'Sign'}
                    </Button>
                    <Button variant="secondary" size="lg" className={PORTAL_BUTTON} onClick={() => setDeclining(true)}>
                      I don’t agree
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <label className="block text-sm font-medium text-slate-700">
                    What would you like changed?
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={cx(inputClasses, 'mt-1.5 text-base')} />
                  </label>
                  <div className={PORTAL_ACTIONS}>
                    <Button size="lg" className={PORTAL_BUTTON} disabled={busy || reason.trim().length < 3} onClick={() => void respond({ decision: 'decline', reason: reason.trim() })}>
                      Send to my counselor
                    </Button>
                    <Button variant="secondary" size="lg" className={PORTAL_BUTTON} onClick={() => setDeclining(false)}>
                      Back
                    </Button>
                  </div>
                </>
              )}
            </Card>
          ) : null}
          <p className="text-sm text-slate-500">In a crisis, call or text 988 (Suicide &amp; Crisis Lifeline) or call 911.</p>
          </>
          )}
        </section>
      )}
    </main>
  );
}
