'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Plug, Plus, Trash2 } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardFooter, CardHeader, ErrorState, FormField, IconButton, LoadingState, StatusBadge, buttonClasses } from '@/components/ui';
import type { MarketingSettingsDTO } from '@/lib/marketing/settings';
import { DAYS } from '@/lib/marketing/constants';
import { Checkbox, Select, TextArea, TextInput, post, useApi } from './shared';

type Data = {
  settings: MarketingSettingsDTO;
  delivery: { sms: boolean; email: boolean; ai: boolean; phoneEvents: boolean; integrations: { key: string; label: string; status: string; setup: string; note: string }[] };
  aiFeatures: { key: string; label: string; description: string }[];
};
type Template = { id: string; name: string; channel: string; subject: string | null; body: string; builtIn: boolean };

const DAY_LABEL: Record<string, string> = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };

export function SettingsTab() {
  const { data, error, loading, reload } = useApi<Data>('/api/marketing/settings');
  const [s, setS] = useState<MarketingSettingsDTO | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if ((loading && !data) || !s || !data) return <LoadingState rows={6} />;
  const save = async () => {
    setBusy(true);
    try {
      await post('/api/marketing/settings', s, 'PUT');
      toast.success('Settings saved');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Integrations" description="Nothing is shown as connected unless it really is on this server." icon={<Plug className="h-4 w-4" aria-hidden />} />
        <ul className="divide-y divide-slate-100">
          {data.delivery.integrations.map((i) => (
            <li key={i.key} className="space-y-1 px-5 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-slate-900">{i.label}</p>
                <StatusBadge tone={i.status === 'ready' ? 'success' : 'neutral'} size="sm">{i.status === 'ready' ? 'Connected' : 'Not connected'}</StatusBadge>
              </div>
              <p className="text-xs text-slate-500">{i.setup}</p>
              <TextInput aria-label={`${i.label} setup note`} placeholder="Setup note (who owns it, status)" value={s.integrationNotes[i.key] ?? ''} onChange={(e) => setS({ ...s, integrationNotes: { ...s.integrationNotes, [i.key]: e.target.value } })} />
            </li>
          ))}
          <li className="px-5 py-3 text-xs text-slate-500">AI drafting: {data.delivery.ai ? 'Amazon Bedrock available (no client PHI is sent).' : 'Bedrock not configured: template drafts are used.'}</li>
        </ul>
      </Card>

      <Card>
        <CardHeader title="Compliance" description="HIPAA marketing rule, CAN-SPAM and TCPA settings." />
        <CardBody className="space-y-4">
          <FormField label="Practice postal address (CAN-SPAM)" required hint="Appears in every marketing email. Marketing email is blocked until set."><TextInput value={s.physicalAddress ?? ''} onChange={(e) => setS({ ...s, physicalAddress: e.target.value })} placeholder="Street, City, MD ZIP" /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Marketing authorization consent template key" hint="Consent library template a client must sign before any marketing (45 CFR 164.508(a)(3))."><TextInput value={s.marketingAuthTemplateKey} onChange={(e) => setS({ ...s, marketingAuthTemplateKey: e.target.value })} /></FormField>
            <FormField label="Testimonial authorization template key"><TextInput value={s.testimonialAuthTemplateKey} onChange={(e) => setS({ ...s, testimonialAuthTemplateKey: e.target.value })} /></FormField>
            <FormField label="Quiet hours start (no marketing texts)"><TextInput type="time" value={s.quietHoursStart} onChange={(e) => setS({ ...s, quietHoursStart: e.target.value })} /></FormField>
            <FormField label="Quiet hours end"><TextInput type="time" value={s.quietHoursEnd} onChange={(e) => setS({ ...s, quietHoursEnd: e.target.value })} /></FormField>
            <FormField label="Small-cell suppression threshold" hint="Client-linked counts below this show as &lt;N in breakdowns (CMS standard 11)."><TextInput type="number" min={1} max={50} value={s.smallCellThreshold} onChange={(e) => setS({ ...s, smallCellThreshold: Number(e.target.value) })} /></FormField>
            <FormField label="Time zone"><TextInput value={s.timeZone} onChange={(e) => setS({ ...s, timeZone: e.target.value })} /></FormField>
          </div>
          <Alert tone="info">The consent library does not yet ship marketing / testimonial authorization templates. Add them in Consents with these keys (or change the keys) before adding authorized clients.</Alert>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Lead response" />
        <CardBody className="space-y-4">
          <FormField label="Speed-to-lead target (minutes)"><TextInput type="number" min={1} max={1440} value={s.speedToLeadMinutes} onChange={(e) => setS({ ...s, speedToLeadMinutes: Number(e.target.value) })} className="w-40" /></FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Business hours</legend>
            {DAYS.map((d) => {
              const h = s.businessHours[d];
              return (
                <div key={d} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="w-24 text-slate-700">{DAY_LABEL[d]}</span>
                  <Checkbox label="Open" checked={Boolean(h)} onChange={(v) => setS({ ...s, businessHours: { ...s.businessHours, [d]: v ? { open: '09:00', close: '17:00' } : null } })} />
                  {h ? (
                    <>
                      <TextInput type="time" aria-label={`${DAY_LABEL[d]} open`} value={h.open} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, [d]: { ...h, open: e.target.value } } })} className="w-32" />
                      <TextInput type="time" aria-label={`${DAY_LABEL[d]} close`} value={h.close} onChange={(e) => setS({ ...s, businessHours: { ...s.businessHours, [d]: { ...h, close: e.target.value } } })} className="w-32" />
                    </>
                  ) : null}
                </div>
              );
            })}
          </fieldset>
          <Checkbox label="After-hours auto-reply to lead texts" checked={s.autoReplyEnabled} onChange={(v) => setS({ ...s, autoReplyEnabled: v })} hint="One reply to a text the lead just sent, outside business hours. STOP is always honored." />
          <FormField label="Auto-reply text"><TextArea rows={2} value={s.autoReplyText ?? ''} onChange={(e) => setS({ ...s, autoReplyText: e.target.value })} placeholder="Thanks for your message. Our office is closed; we will reply next business day. If you are in crisis, call or text 988." /></FormField>
          <Checkbox label="Missed-call text-back" checked={s.missedCallTextBack} onChange={(v) => setS({ ...s, missedCallTextBack: v })} hint={data.delivery.phoneEvents ? 'Phone events connected.' : 'Needs the phone system call-event feed (not connected). Until then, staff log missed calls from the Lead inbox. Only known leads with SMS consent are texted.'} />
          <FormField label="Missed-call text"><TextArea rows={2} value={s.missedCallText ?? ''} onChange={(e) => setS({ ...s, missedCallText: e.target.value })} placeholder="Sorry we missed your call. We will call you back shortly, or reply here." /></FormField>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Brand kit and senders" />
        <CardBody className="space-y-4">
          <p className="text-sm text-slate-700">Logos, colors and brand documents live in <Link className="text-blue-700 underline" href="/dashboard/pr">PR & Marketing, brand assets</Link>.</p>
          <FormField label="Brand voice (used by AI drafts)" hint="e.g. Warm, plain-spoken, hopeful; avoid clinical jargon."><TextArea rows={2} value={s.brandVoice ?? ''} onChange={(e) => setS({ ...s, brandVoice: e.target.value })} /></FormField>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-700">Sender identities</legend>
            {s.senderIdentities.map((id, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Select value={id.kind} onChange={(e) => setS({ ...s, senderIdentities: s.senderIdentities.map((x, j) => (j === i ? { ...x, kind: e.target.value as 'email' | 'sms' } : x)) })} aria-label="Kind" className="w-28"><option value="email">Email</option><option value="sms">SMS</option></Select>
                <TextInput aria-label="Label" placeholder="Label" value={id.label} onChange={(e) => setS({ ...s, senderIdentities: s.senderIdentities.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} className="w-full sm:w-48" />
                <TextInput aria-label="Address" placeholder="hello@practice.com / +1..." value={id.address} onChange={(e) => setS({ ...s, senderIdentities: s.senderIdentities.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)) })} className="min-w-0 flex-1" />
                <IconButton label="Remove sender" icon={<Trash2 className="h-4 w-4" />} onClick={() => setS({ ...s, senderIdentities: s.senderIdentities.filter((_, j) => j !== i) })} />
              </div>
            ))}
            <Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setS({ ...s, senderIdentities: [...s.senderIdentities, { kind: 'email', label: '', address: '' }] })}>Add sender</Button>
            <p className="text-xs text-slate-500">Recorded for setup. Email actually sends from the server&apos;s verified SES identity (EMAIL_FROM); texts from the registered SMS number.</p>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="AI features" description="All drafts need a person's approval. Client PHI is never sent; lead text is redacted first. Usage is logged." />
        <CardBody className="space-y-2">
          {data.aiFeatures.map((f) => (
            <Checkbox key={f.key} label={f.label} hint={f.description} checked={s.aiFeatures[f.key] !== false} onChange={(v) => setS({ ...s, aiFeatures: { ...s.aiFeatures, [f.key]: v } })} />
          ))}
          <Checkbox label="Public web forms enabled" checked={s.publicFormsEnabled} onChange={(v) => setS({ ...s, publicFormsEnabled: v })} />
        </CardBody>
        <CardFooter className="flex justify-end"><Button loading={busy} onClick={save}>Save settings</Button></CardFooter>
      </Card>

      <Templates />
      <p className="text-xs text-slate-500"><Link href="/dashboard/marketing?tab=forms" className={buttonClasses({ variant: 'ghost', size: 'sm' })}>Manage web forms</Link></p>
    </div>
  );
}

function Templates() {
  const { data, reload } = useApi<{ templates: Template[]; tokens: string[] }>('/api/marketing/templates');
  const [f, setF] = useState({ id: '', name: '', channel: 'sms', subject: '', body: '' });
  const save = async (remove = false) => {
    try {
      await post('/api/marketing/templates', { id: f.id || undefined, name: f.name, channel: f.channel, subject: f.subject || null, body: f.body, remove });
      setF({ id: '', name: '', channel: 'sms', subject: '', body: '' });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  return (
    <Card>
      <CardHeader title="Message templates" description={`Tokens: ${(data?.tokens ?? []).map((t) => `{{${t}}}`).join(' ')}. No clinical details.`} />
      <CardBody className="grid gap-4 lg:grid-cols-2">
        <ul className="divide-y divide-slate-100 text-sm">
          {(data?.templates ?? []).map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 truncate text-slate-800">{t.name} <span className="text-xs text-slate-500">({t.channel}{t.builtIn ? ', built-in' : ''})</span></span>
              {!t.builtIn ? <Button size="sm" variant="ghost" onClick={() => setF({ id: t.id, name: t.name, channel: t.channel, subject: t.subject ?? '', body: t.body })}>Edit</Button> : null}
            </li>
          ))}
        </ul>
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Name"><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <FormField label="Channel"><Select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="sms">Text</option><option value="email">Email</option></Select></FormField>
          </div>
          {f.channel === 'email' ? <FormField label="Subject"><TextInput value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></FormField> : null}
          <FormField label="Body"><TextArea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>
          <div className="flex justify-end gap-2">
            {f.id ? <Button variant="secondary" onClick={() => save(true)}>Delete</Button> : null}
            <Button variant="secondary" disabled={f.name.trim().length < 2 || !f.body.trim()} onClick={() => save(false)}>{f.id ? 'Update template' : 'Add template'}</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
