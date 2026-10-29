'use client';

import { useCallback, useEffect, useState } from 'react';
import { Download, FileSignature, Printer } from 'lucide-react';
import { Alert, Button, Card, CardBody, LoadingState, Page, PageHeader } from '@/components/ui';
import { BaaDocument } from '@/components/legal/BaaDocument';
import {
  BaaAcceptanceFields,
  EMPTY_BAA_ACCEPTANCE,
  baaClientError,
  baaRequestBody,
  type BaaAcceptanceValue,
} from '@/components/legal/BaaAcceptanceFields';
import { BAA_DRAFT_BANNER, BAA_VERSION, baaPlainText } from '@/lib/legal/baa';

type Acceptance = {
  id: string;
  signerName: string;
  signerTitle: string;
  signerEmail: string;
  baaVersion: string;
  textSha256: string;
  acceptedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  source: string;
};

type Payload = {
  success: boolean;
  error?: string;
  organizationName?: string;
  currentVersion?: string;
  currentTextSha256?: string;
  legalReviewed?: boolean;
  needsAcceptance?: boolean;
  acceptances?: Acceptance[];
};

function acceptanceRows(a: Acceptance, orgName: string): [string, string][] {
  return [
    ['Organization', orgName],
    ['Accepted by', `${a.signerName}, ${a.signerTitle} <${a.signerEmail}>`],
    ['Accepted at', new Date(a.acceptedAt).toISOString()],
    ['BAA version', a.baaVersion],
    ['Text SHA-256', a.textSha256],
    ['IP address', a.ipAddress || 'not recorded'],
    ['Browser', a.userAgent || 'not recorded'],
    ['Recorded via', a.source === 'registration' ? 'registration' : 'admin acceptance'],
  ];
}

/** Admin / Practice Director: the accepted BAA with acceptance details, printable and downloadable. */
export default function BaaAdminPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<BaaAcceptanceValue>(EMPTY_BAA_ACCEPTANCE);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/baa', { cache: 'no-store' })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Payload | null;
        if (!r.ok || !d?.success) throw new Error(d?.error || 'Could not load the BAA record');
        setData(d);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the BAA record'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const latest = data?.acceptances?.[0] ?? null;
  const earlier = data?.acceptances?.slice(1) ?? [];
  const orgName = data?.organizationName || '';

  const download = () => {
    if (!latest) return;
    const lines = [
      baaPlainText(),
      '--- Electronic acceptance record ---',
      ...acceptanceRows(latest, orgName).map(([k, v]) => `${k}: ${v}`),
    ];
    if (latest.baaVersion !== BAA_VERSION) {
      lines.push(`Note: the text above is version ${BAA_VERSION}; the accepted version was ${latest.baaVersion}.`);
    }
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `altrixs-baa-${latest.baaVersion}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const accept = async () => {
    const msg = baaClientError(form);
    if (msg) {
      setError(msg);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/baa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baaRequestBody(form)),
      });
      const d = (await r.json().catch(() => null)) as { success?: boolean; error?: string } | null;
      if (!r.ok || !d?.success) throw new Error(d?.error || 'Could not record the acceptance');
      setForm(EMPTY_BAA_ACCEPTANCE);
      load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not record the acceptance');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Page width="narrow">
      <PageHeader
        title="Business Associate Agreement"
        description="The BAA your organization accepted with Altrixs, and who accepted it."
        actions={
          latest ? (
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={download}>
                Download
              </Button>
            </div>
          ) : null
        }
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {!data && !error ? <LoadingState label="Loading BAA record…" /> : null}
      {data && !data.legalReviewed ? (
        <Alert tone="warning" title={BAA_DRAFT_BANNER} className="print:hidden">
          The agreement text is a draft and may be updated after legal review. You will be asked to accept the
          final version.
        </Alert>
      ) : null}
      {data?.needsAcceptance ? (
        <Card className="print:hidden">
          <CardBody>
            <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
              <FileSignature className="h-4 w-4" aria-hidden /> Accept the current BAA (version {BAA_VERSION})
            </h2>
            <BaaAcceptanceFields organizationName={orgName} value={form} onChange={setForm} />
            <div className="mt-4">
              <Button onClick={accept} loading={saving}>
                Accept the Business Associate Agreement
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}
      {latest ? (
        <Card>
          <CardBody>
            <h2 className="mb-2 text-base font-bold text-slate-900">Acceptance record</h2>
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
              {acceptanceRows(latest, orgName).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-semibold text-slate-600">{k}</dt>
                  <dd className="break-all text-slate-900">{v}</dd>
                </div>
              ))}
            </dl>
            {latest.baaVersion !== BAA_VERSION ? (
              <p className="mt-3 text-xs text-amber-700">
                The text below is version {BAA_VERSION}. Your organization accepted version {latest.baaVersion}.
              </p>
            ) : null}
            {earlier.length > 0 ? (
              <p className="mt-3 text-xs text-slate-500">
                Earlier acceptances:{' '}
                {earlier
                  .map((a) => `${a.baaVersion} by ${a.signerName} on ${new Date(a.acceptedAt).toLocaleDateString()}`)
                  .join('; ')}
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
      {data ? (
        <Card>
          <CardBody>
            <BaaDocument headingLevel="h2" />
          </CardBody>
        </Card>
      ) : null}
    </Page>
  );
}
