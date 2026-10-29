'use client';

import { useState } from 'react';
import { BadgeCheck, ExternalLink, Plus, ScanText } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, Modal, StatusBadge } from '@/components/ui';
import { ExpiryBadge, Labeled, Select, TextArea, TextInput } from './HrBits';
import { fmtDate, fmtDateTime, hrFetch, titleCase } from './hrClient';
import { DocExtractModal, type ExtractedFields } from './DocExtractModal';

export type CredentialRow = {
  id: string;
  credentialType: string;
  title: string;
  licenseNumber: string;
  licenseType: string | null;
  issuer: string;
  state: string | null;
  issuedAt: string | null;
  expiresAt: string;
  ceuRequired: number;
  documentUrl: string | null;
  documentName: string | null;
  verifiedAt: string | null;
  verificationMethod: string | null;
  verifiedByName: string | null;
  verificationRef: string | null;
  details: Record<string, unknown> | null;
  lookup: { label: string; url: string } | null;
};
export type ComplianceRow = { id: string; kind: string; label: string | null; completedOn: string | null; expiresOn: string | null; status: string; result: string | null; identifier: string | null; verifiedByName: string | null; notes: string | null };
export type ExclusionRow = { id: string; source: string; checkedOn: string; result: string; reference: string | null; checkedByName: string | null };
export type ExpirationRow = { key: string; source: string; sourceId: string; label: string; category: string; dueOn: string | null; status: string; daysLeft: number | null };
export type CredentialBundle = {
  credentials: CredentialRow[];
  compliance: ComplianceRow[];
  exclusions: ExclusionRow[];
  payerEnrollments: Array<{ id: string; payerName: string; status: string; effectiveDate: string | null }>;
};

const CRED_TYPES: Array<[string, string]> = [
  ['LICENSE', 'Professional license'],
  ['DEA', 'DEA registration'],
  ['CDS', 'Maryland CDS registration'],
  ['BOARD_CERTIFICATION', 'Board certification'],
  ['CERTIFICATION', 'Certification'],
  ['CPR_BLS', 'CPR / BLS'],
  ['MALPRACTICE', 'Malpractice insurance'],
];
const COMPLIANCE_TYPES: Array<[string, string]> = [
  ['TB_TEST', 'TB screening'],
  ['FLU_VACCINE', 'Flu vaccine / declination'],
  ['HEP_B', 'Hepatitis B / declination'],
  ['BACKGROUND_CHECK', 'Background check'],
  ['CJIS_FINGERPRINT', 'CJIS fingerprinting'],
  ['I9', 'Form I-9 completed'],
  ['CAQH_ATTESTATION', 'CAQH re-attestation'],
  ['MEDICAID_ENROLLMENT', 'Maryland Medicaid (ePREP) enrollment'],
  ['OTHER', 'Other'],
];
const LICENSE_TYPES = ['LCSW-C', 'LCSW', 'LMSW', 'LCPC', 'LGPC', 'LCMFT', 'LGMFT', 'LCADC', 'LGADC', 'PSYCHOLOGIST', 'MD', 'CRNP-PMH', 'CRNP', 'RN', 'CPRP', 'CPRS'];
const METHODS: Array<[string, string]> = [
  ['board_website', 'State board online lookup'],
  ['primary_source_letter', 'Primary source letter'],
  ['nppes', 'NPPES NPI registry'],
  ['dea_lookup', 'DEA registration validation'],
  ['caqh', 'CAQH ProView'],
  ['other', 'Other'],
];
const EXCL_LABEL: Record<string, string> = { OIG_LEIE: 'OIG LEIE', SAM_GOV: 'SAM.gov', MD_MEDICAID: 'Maryland Medicaid' };

/**
 * Credentials and compliance for one person: licenses / registrations with primary source
 * verification, compliance records, exclusion history and payer enrollment. `editable` = HR,
 * leadership or Office Manager; the employee sees a read-only view.
 */
export function CredentialsPanel({
  userId,
  bundle,
  expirations,
  editable,
  canScan,
  onChanged,
}: {
  userId: string;
  bundle: CredentialBundle;
  expirations: ExpirationRow[];
  editable: boolean;
  canScan: boolean;
  onChanged: () => void;
}) {
  const [adding, setAdding] = useState<null | 'credential' | 'compliance'>(null);
  const [verifying, setVerifying] = useState<CredentialRow | null>(null);
  const statusFor = (source: string, id: string) => expirations.find((e) => e.source === source && e.sourceId === id);
  const caqh = expirations.find((e) => e.source === 'caqh');

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Licenses, registrations and insurance"
          description="Primary source verification is recorded on each credential (date, method, by whom)."
          actions={editable ? <Button size="sm" icon={<Plus />} onClick={() => setAdding('credential')}>Add credential</Button> : null}
        />
        <CardBody flush>
          {bundle.credentials.length === 0 ? (
            <EmptyState compact title="No credentials on file" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {bundle.credentials.map((c) => {
                const st = statusFor('credential', c.id);
                return (
                  <li key={c.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{c.title}</span>
                        <StatusBadge size="sm" tone="brand">{CRED_TYPES.find(([k]) => k === c.credentialType)?.[1] ?? titleCase(c.credentialType)}</StatusBadge>
                        {st ? <ExpiryBadge size="sm" status={st.status} dueOn={st.dueOn} daysLeft={st.daysLeft} /> : <StatusBadge size="sm">Superseded</StatusBadge>}
                      </div>
                      <p className="text-sm text-slate-600">
                        {[c.licenseType, c.licenseNumber && `#${c.licenseNumber}`, c.state, c.issuer].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-xs text-slate-500">
                        Issued {fmtDate(c.issuedAt)} · Expires {fmtDate(c.expiresAt)}
                        {c.details && Object.keys(c.details).length
                          ? ` · ${Object.entries(c.details).filter(([, v]) => v).map(([k, v]) => `${titleCase(k)}: ${v}`).join(' · ')}`
                          : ''}
                      </p>
                      <p className="text-xs">
                        {c.verifiedAt ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> Verified {fmtDateTime(c.verifiedAt)} via {METHODS.find(([k]) => k === c.verificationMethod)?.[1] ?? c.verificationMethod} by {c.verifiedByName}
                            {c.verificationRef ? ` (${c.verificationRef})` : ''}
                          </span>
                        ) : (
                          <span className="text-amber-700">Not verified at the primary source yet</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {c.lookup ? (
                        <a href={c.lookup.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50">
                          {c.lookup.label} <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : null}
                      {c.documentUrl ? (
                        <a href={c.documentUrl} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100">
                          {c.documentName || 'Document'}
                        </a>
                      ) : null}
                      {editable ? <Button size="sm" variant="secondary" onClick={() => setVerifying(c)}>Record verification</Button> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Compliance records"
          description="TB, immunizations, background check, fingerprints, I-9 completion, CAQH and Maryland Medicaid. No identity document images."
          actions={editable ? <Button size="sm" icon={<Plus />} onClick={() => setAdding('compliance')}>Add record</Button> : null}
        />
        <CardBody flush>
          {caqh ? (
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3 text-sm">
              <span>CAQH re-attestation</span>
              <ExpiryBadge status={caqh.status} dueOn={caqh.dueOn} daysLeft={caqh.daysLeft} size="sm" />
            </div>
          ) : null}
          {bundle.compliance.length === 0 ? (
            <EmptyState compact title="No compliance records yet" />
          ) : (
            <ul className="divide-y divide-slate-100">
              {bundle.compliance.map((r) => {
                const st = statusFor('compliance', r.id);
                return (
                  <li key={r.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900">{r.label || COMPLIANCE_TYPES.find(([k]) => k === r.kind)?.[1] || r.kind}</p>
                      <p className="text-xs text-slate-500">
                        {[r.completedOn && `Completed ${fmtDate(r.completedOn)}`, r.expiresOn && `Expires ${fmtDate(r.expiresOn)}`, r.result, r.identifier, r.verifiedByName && `Recorded by ${r.verifiedByName}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.status !== 'complete' ? <StatusBadge size="sm">{titleCase(r.status)}</StatusBadge> : null}
                      {st && st.status !== 'no_expiry' ? <ExpiryBadge size="sm" status={st.status} dueOn={st.dueOn} daysLeft={st.daysLeft} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Exclusion checks" description="Most recent first. Recorded monthly from the Credentialing tab." />
          <CardBody flush>
            {bundle.exclusions.length === 0 ? (
              <EmptyState compact title="No checks recorded" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {bundle.exclusions.slice(0, 12).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>{EXCL_LABEL[e.source] ?? e.source} · {fmtDate(e.checkedOn)}</span>
                    <StatusBadge size="sm" tone={e.result === 'clear' ? 'success' : 'danger'}>{titleCase(e.result)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Payer enrollment" description="From the payer enrollment tracker on Credentialing." />
          <CardBody flush>
            {bundle.payerEnrollments.length === 0 ? (
              <EmptyState compact title="No payer enrollments tracked" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {bundle.payerEnrollments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                    <span>{p.payerName}{p.effectiveDate ? ` · effective ${fmtDate(p.effectiveDate)}` : ''}</span>
                    <StatusBadge size="sm" tone={p.status === 'active' ? 'success' : p.status === 'not_started' ? 'neutral' : 'info'}>{titleCase(p.status)}</StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      {adding === 'credential' ? <CredentialForm userId={userId} canScan={canScan} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); onChanged(); }} /> : null}
      {adding === 'compliance' ? <ComplianceForm userId={userId} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); onChanged(); }} /> : null}
      {verifying ? <VerifyForm credential={verifying} onClose={() => setVerifying(null)} onSaved={() => { setVerifying(null); onChanged(); }} /> : null}
    </div>
  );
}

function CredentialForm({ userId, canScan, onClose, onSaved }: { userId: string; canScan: boolean; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    credentialType: 'LICENSE',
    title: '',
    licenseType: '',
    licenseNumber: '',
    issuer: '',
    credentialState: 'MD',
    issuedAt: '',
    expiresAt: '',
    ceuRequired: '',
    carrier: '',
    policyNumber: '',
    perClaimLimit: '',
    aggregateLimit: '',
  });
  const [scan, setScan] = useState(false);
  const [fromAi, setFromAi] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));

  function useExtract(x: ExtractedFields) {
    setF((cur) => ({
      ...cur,
      credentialType: x.credentialType || cur.credentialType,
      licenseType: x.licenseType || cur.licenseType,
      licenseNumber: x.licenseNumber || cur.licenseNumber,
      issuer: x.issuer || cur.issuer,
      credentialState: x.state || cur.credentialState,
      issuedAt: x.issuedAt || cur.issuedAt,
      expiresAt: x.expiresAt || cur.expiresAt,
      title: cur.title || [x.licenseType, CRED_TYPES.find(([k]) => k === x.credentialType)?.[1]].filter(Boolean).join(' ') || cur.title,
      carrier: x.carrier || cur.carrier,
      policyNumber: x.policyNumber || cur.policyNumber,
      perClaimLimit: x.perClaimLimit || cur.perClaimLimit,
      aggregateLimit: x.aggregateLimit || cur.aggregateLimit,
    }));
    setFromAi(true);
    setScan(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const details =
        f.credentialType === 'MALPRACTICE'
          ? { carrier: f.carrier || null, policyNumber: f.policyNumber || null, perClaimLimit: f.perClaimLimit || null, aggregateLimit: f.aggregateLimit || null }
          : null;
      await hrFetch('/api/hr/credentials', {
        method: 'POST',
        json: {
          userId,
          credentialType: f.credentialType,
          title: f.title || CRED_TYPES.find(([k]) => k === f.credentialType)?.[1],
          licenseNumber: f.licenseNumber || (f.credentialType === 'MALPRACTICE' ? f.policyNumber : '') || 'n/a',
          issuer: f.issuer || f.carrier || 'Not recorded',
          issuedAt: f.issuedAt || null,
          expiresAt: f.expiresAt,
          licenseType: f.licenseType || null,
          credentialState: f.credentialState || null,
          ceuRequired: f.ceuRequired ? Number(f.ceuRequired) : undefined,
          details,
        },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Add credential"
      size="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save} disabled={!f.expiresAt}>Save credential</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {canScan ? (
          <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-4 py-3">
            <span className="text-sm text-slate-600">Have the document? Read it to prefill the form.</span>
            <Button size="sm" variant="secondary" icon={<ScanText />} onClick={() => setScan(true)}>Read document</Button>
          </div>
        ) : null}
        {fromAi ? <Alert tone="info">Fields were prefilled from the document. Check each one against the document before saving.</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Type">
            <Select value={f.credentialType} onChange={(e) => set('credentialType', e.target.value)}>
              {CRED_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Title" hint="e.g. Maryland LCSW-C license"><TextInput value={f.title} onChange={(e) => set('title', e.target.value)} /></Labeled>
          {['LICENSE', 'CERTIFICATION', 'BOARD_CERTIFICATION'].includes(f.credentialType) ? (
            <Labeled label="License type">
              <Select value={f.licenseType} onChange={(e) => set('licenseType', e.target.value)}>
                <option value="">Not set</option>
                {LICENSE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </Select>
            </Labeled>
          ) : null}
          <Labeled label={f.credentialType === 'MALPRACTICE' ? 'Policy number' : 'Number'}>
            <TextInput value={f.credentialType === 'MALPRACTICE' ? f.policyNumber : f.licenseNumber} onChange={(e) => set(f.credentialType === 'MALPRACTICE' ? 'policyNumber' : 'licenseNumber', e.target.value)} />
          </Labeled>
          <Labeled label={f.credentialType === 'MALPRACTICE' ? 'Carrier' : 'Issuer'}>
            <TextInput value={f.credentialType === 'MALPRACTICE' ? f.carrier : f.issuer} onChange={(e) => set(f.credentialType === 'MALPRACTICE' ? 'carrier' : 'issuer', e.target.value)} />
          </Labeled>
          <Labeled label="State"><TextInput maxLength={2} value={f.credentialState} onChange={(e) => set('credentialState', e.target.value.toUpperCase())} /></Labeled>
          <Labeled label="Issued"><TextInput type="date" value={f.issuedAt} onChange={(e) => set('issuedAt', e.target.value)} /></Labeled>
          <Labeled label="Expires" required><TextInput type="date" value={f.expiresAt} onChange={(e) => set('expiresAt', e.target.value)} /></Labeled>
          {f.credentialType === 'MALPRACTICE' ? (
            <>
              <Labeled label="Per-claim limit"><TextInput value={f.perClaimLimit} onChange={(e) => set('perClaimLimit', e.target.value)} placeholder="$1,000,000" /></Labeled>
              <Labeled label="Aggregate limit"><TextInput value={f.aggregateLimit} onChange={(e) => set('aggregateLimit', e.target.value)} placeholder="$3,000,000" /></Labeled>
            </>
          ) : null}
          {f.credentialType === 'LICENSE' ? (
            <Labeled label="CEU hours this cycle" hint="Leave blank to use the HR setting for this license type."><TextInput type="number" min={0} value={f.ceuRequired} onChange={(e) => set('ceuRequired', e.target.value)} /></Labeled>
          ) : null}
        </div>
      </div>
      {scan ? <DocExtractModal onClose={() => setScan(false)} onUse={useExtract} /> : null}
    </Modal>
  );
}

function ComplianceForm({ userId, onClose, onSaved }: { userId: string; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: 'TB_TEST', label: '', completedOn: '', expiresOn: '', status: 'complete', result: '', identifier: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await hrFetch('/api/hr/compliance', {
        method: 'POST',
        json: { userId, ...f, label: f.label || null, completedOn: f.completedOn || null, expiresOn: f.expiresOn || null, result: f.result || null, identifier: f.identifier || null, notes: f.notes || null },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Add compliance record"
      size="md"
      onClose={onClose}
      dismissible={!busy}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button loading={busy} onClick={save}>Save record</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {f.kind === 'I9' ? <Alert tone="info">Record that the I-9 is complete. Do not upload identity documents unless practice policy allows it.</Alert> : null}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Labeled label="Record">
            <Select value={f.kind} onChange={(e) => set('kind', e.target.value)}>
              {COMPLIANCE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </Select>
          </Labeled>
          <Labeled label="Status">
            <Select value={f.status} onChange={(e) => set('status', e.target.value)}>
              {['complete', 'pending', 'declined', 'exempt', 'not_applicable'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
            </Select>
          </Labeled>
          <Labeled label={f.kind === 'CAQH_ATTESTATION' ? 'Attested on' : 'Completed on'}><TextInput type="date" value={f.completedOn} onChange={(e) => set('completedOn', e.target.value)} /></Labeled>
          <Labeled label="Expires / next due" hint={f.kind === 'CAQH_ATTESTATION' ? 'Leave blank: due date comes from the CAQH cycle in HR settings.' : undefined}>
            <TextInput type="date" value={f.expiresOn} onChange={(e) => set('expiresOn', e.target.value)} />
          </Labeled>
          <Labeled label="Result"><TextInput value={f.result} onChange={(e) => set('result', e.target.value)} placeholder="e.g. negative, clear" /></Labeled>
          <Labeled label="Reference" hint="ePREP number, vendor order id (no SSN)"><TextInput value={f.identifier} onChange={(e) => set('identifier', e.target.value)} /></Labeled>
        </div>
        <Labeled label="Notes"><TextArea rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Labeled>
      </div>
    </Modal>
  );
}

function VerifyForm({ credential, onClose, onSaved }: { credential: CredentialRow; onClose: () => void; onSaved: () => void }) {
  const [method, setMethod] = useState(credential.credentialType === 'DEA' ? 'dea_lookup' : 'board_website');
  const [verifiedOn, setVerifiedOn] = useState(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    try {
      await hrFetch(`/api/hr/credentials/${credential.id}/verify`, { method: 'POST', json: { method, verifiedOn, reference: reference || null } });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={`Verify ${credential.title}`}
      size="sm"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2 p-4">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={save}>Record verification</Button>
        </div>
      }
    >
      <div className="space-y-4 p-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {credential.lookup ? (
          <a href={credential.lookup.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:underline">
            Open {credential.lookup.label} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : null}
        <Labeled label="Method">
          <Select value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Labeled>
        <Labeled label="Verified on"><TextInput type="date" value={verifiedOn} onChange={(e) => setVerifiedOn(e.target.value)} /></Labeled>
        <Labeled label="Reference" hint="Lookup confirmation, status shown, or letter date"><TextInput value={reference} onChange={(e) => setReference(e.target.value)} /></Labeled>
      </div>
    </Modal>
  );
}
