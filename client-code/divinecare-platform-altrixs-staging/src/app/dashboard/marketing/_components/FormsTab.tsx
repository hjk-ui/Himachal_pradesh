'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, ExternalLink, FileText, Plus } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, FormField, LoadingState, Modal, StatusBadge, buttonClasses } from '@/components/ui';
import { Checkbox, TextArea, TextInput, post, useApi } from './shared';

type Field = { key: string; label: string; type: string; required: boolean };
type FormRow = { id: string; name: string; slug: string; active: boolean; fields: Field[]; serviceOptions: string[]; locationOptions: string[]; confirmationMessage: string; submissionCount: number; hostedUrl: string; embed: string };
type FormsData = { forms: FormRow[]; standardFields: Field[]; serviceDefaults: string[]; locationDefaults: string[]; orgSlug: string };

const LOCKED = new Set(['firstName', 'lastName', 'contactConsent']);

export function FormsTab() {
  const { data, error, loading, reload } = useApi<FormsData>('/api/marketing/forms');
  const [editing, setEditing] = useState<FormRow | 'new' | null>(null);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  };
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Public intake forms">
        Hosted at your practice address and embeddable with an iframe. Submissions create leads in the pipeline. The form posts in the request body (never the URL), has spam protection and rate limits, never pre-checks the SMS box, asks people not to type health details, and shows 988. Do not add tracking pixels to pages that embed it.
      </Alert>
      <div className="flex justify-end">
        <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>New form</Button>
      </div>
      {!data.forms.length ? (
        <Card><EmptyState icon={<FileText aria-hidden />} title="No forms yet" description="Create an intake request form for your website, Google Business Profile link or listing sites." action={<Button onClick={() => setEditing('new')}>Create a form</Button>} /></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.forms.map((f) => (
            <Card key={f.id}>
              <CardHeader title={f.name} description={`${f.submissionCount} submission${f.submissionCount === 1 ? '' : 's'}`} actions={<StatusBadge tone={f.active ? 'success' : 'neutral'}>{f.active ? 'Live' : 'Off'}</StatusBadge>} />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <a href={f.hostedUrl} target="_blank" rel="noreferrer" className={buttonClasses({ variant: 'secondary', size: 'sm' })}><ExternalLink className="h-4 w-4" aria-hidden /> Open hosted page</a>
                  <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => copy(f.hostedUrl)}>Copy link</Button>
                  <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={() => copy(f.embed)}>Copy embed code</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(f)}>Edit</Button>
                </div>
                <pre className="overflow-x-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{f.embed}</pre>
                <p className="text-xs text-slate-500">Fields: {f.fields.map((x) => x.label).join(', ')}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
      {editing ? <FormEditor data={data} form={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
    </div>
  );
}

function FormEditor({ data, form, onClose, onSaved }: { data: FormsData; form: FormRow | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(form?.name ?? 'Request an appointment');
  const [slug, setSlug] = useState(form?.slug ?? 'request-appointment');
  const [active, setActive] = useState(form?.active ?? true);
  const [fields, setFields] = useState<Record<string, { on: boolean; required: boolean }>>(() => {
    const on = new Set((form?.fields ?? data.standardFields.filter((f) => ['firstName', 'lastName', 'phone', 'email', 'serviceInterest', 'location', 'preferredContact', 'howHeard', 'contactConsent', 'smsConsent'].includes(f.key))).map((f) => f.key));
    return Object.fromEntries(data.standardFields.map((f) => [f.key, { on: on.has(f.key) || LOCKED.has(f.key), required: LOCKED.has(f.key) || Boolean(form?.fields.find((x) => x.key === f.key)?.required) }]));
  });
  const [services, setServices] = useState((form?.serviceOptions.length ? form.serviceOptions : data.serviceDefaults).join('\n'));
  const [locations, setLocations] = useState((form?.locationOptions.length ? form.locationOptions : data.locationDefaults).join('\n'));
  const [confirmation, setConfirmation] = useState(form?.confirmationMessage ?? '');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/marketing/forms', {
        id: form?.id,
        name,
        slug,
        active,
        fields: data.standardFields.filter((f) => fields[f.key]?.on).map((f) => ({ key: f.key, required: fields[f.key].required })),
        serviceOptions: services.split('\n').map((s) => s.trim()).filter(Boolean),
        locationOptions: locations.split('\n').map((s) => s.trim()).filter(Boolean),
        confirmationMessage: confirmation || undefined,
      });
      toast.success('Form saved');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={form ? 'Edit form' : 'New form'} size="lg" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={save}>Save form</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Form name" required><TextInput value={name} onChange={(e) => setName(e.target.value)} /></FormField>
          <FormField label="Page address" hint={`/p/${data.orgSlug}/intake/${slug || '...'}`}><TextInput value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></FormField>
        </div>
        <Checkbox label="Form is live" checked={active} onChange={setActive} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-slate-700">Fields (standard fields only, so every answer lands in a known, minimum-necessary place)</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.standardFields.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2">
                <Checkbox label={f.label} checked={fields[f.key]?.on} disabled={LOCKED.has(f.key)} onChange={(v) => setFields({ ...fields, [f.key]: { ...fields[f.key], on: v } })} />
                {f.key !== 'smsConsent' && !LOCKED.has(f.key) && fields[f.key]?.on ? (
                  <Checkbox label="Required" checked={fields[f.key].required} onChange={(v) => setFields({ ...fields, [f.key]: { ...fields[f.key], required: v } })} />
                ) : null}
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">The SMS consent box is always optional and unchecked (TCPA). There is no free-text &quot;reason for visit&quot; box by design.</p>
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Service options" hint="One per line"><TextArea rows={5} value={services} onChange={(e) => setServices(e.target.value)} /></FormField>
          <FormField label="Location options" hint="One per line"><TextArea rows={5} value={locations} onChange={(e) => setLocations(e.target.value)} /></FormField>
        </div>
        <FormField label="Confirmation message" hint="Shown after submit. Keep 988 for crisis."><TextArea rows={2} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} placeholder="Thank you. Our intake team will contact you within one business day. If you are in crisis, call or text 988." /></FormField>
      </div>
    </Modal>
  );
}
