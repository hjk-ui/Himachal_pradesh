'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { Mail, Plus, Send, Users } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, FormField, LoadingState, Modal, StatusBadge, Tabs } from '@/components/ui';
import { Checkbox, Select, TextArea, TextInput, fmtDate, post, useApi } from './shared';

type Kind = { key: string; label: string };
type Campaign = {
  id: string;
  name: string;
  channel: 'email' | 'sms';
  audience: Audience;
  subjectA: string | null;
  subjectB: string | null;
  body: string;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  metrics: { recipients: number; sent: number; delivered: number; unsubscribed: number; blocked: number; queued: number };
  variantStats: { A: { sent: number }; B: { sent: number } } | null;
};
type Audience = { kinds?: string[]; tags?: string[]; partnerIds?: string[]; eventIds?: string[]; attendedOnly?: boolean };
type Data = { campaigns: Campaign[]; partners: { id: string; name: string }[]; events: { id: string; title: string; startsAt: string }[]; tags: string[]; kinds: Kind[] };
type Contact = { id: string; name: string; email: string | null; phone: string | null; kind: string; tags: string[]; emailConsent: boolean; emailOptedOut: boolean; smsConsent: boolean; smsOptedOut: boolean; authorization: string | null };

export function CampaignsTab() {
  const [view, setView] = useState<'campaigns' | 'audience'>('campaigns');
  return (
    <div className="space-y-4">
      <Tabs variant="pill" label="Campaign views" controlsPanels={false} value={view} onChange={setView} items={[{ key: 'campaigns', label: 'Campaigns' }, { key: 'audience', label: 'Audience & consent' }]} />
      {view === 'campaigns' ? <CampaignList /> : <AudienceList />}
    </div>
  );
}

function CampaignList() {
  const { data, error, loading, reload } = useApi<Data>('/api/marketing/campaigns');
  const [editing, setEditing] = useState<Campaign | 'new' | null>(null);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const act = async (id: string, action: string) => {
    try {
      const r = await post<{ success: true; sent?: number; queued?: number; blocked?: number; matched?: number }>('/api/marketing/campaigns', { action, id });
      if (action === 'send') toast.success(`Matched ${r.matched ?? 0}: sent ${r.sent ?? 0}, queued ${r.queued ?? 0}, not sent (consent) ${r.blocked ?? 0}`);
      else toast.success('Updated');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };
  return (
    <div className="space-y-4">
      <Alert tone="info">
        Audiences use non-clinical attributes only (contact type, tags, partners, events). Clients are included only with a signed marketing authorization. Every send checks opt-in, unsubscribes and STOP; emails carry an unsubscribe link and the practice address. Opens and clicks are not tracked (no tracking pixels).
      </Alert>
      <div className="flex justify-end"><Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>New campaign</Button></div>
      <Card>
        {!data.campaigns.length ? (
          <EmptyState icon={<Mail aria-hidden />} title="No campaigns yet" description="Send newsletters, event invitations and review requests to opted-in audiences." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.campaigns.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900">{c.name} <span className="text-xs text-slate-500">({c.channel === 'sms' ? 'Text' : 'Email'})</span></p>
                  <p className="text-xs text-slate-500">
                    {c.sentAt ? `Sent ${fmtDate(c.sentAt, true)} · ${c.metrics.recipients} matched · ${c.metrics.sent} sent · ${c.metrics.queued} queued · ${c.metrics.blocked} not sent (consent) · ${c.metrics.unsubscribed} unsubscribed` : c.scheduledAt ? `Scheduled ${fmtDate(c.scheduledAt, true)}` : 'Not sent'}
                    {c.variantStats ? ` · A/B: A ${c.variantStats.A.sent}, B ${c.variantStats.B.sent}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge size="sm" tone={c.status === 'sent' ? 'success' : c.status === 'review' ? 'warning' : c.status === 'approved' || c.status === 'scheduled' ? 'info' : c.status === 'queued' ? 'warning' : 'neutral'}>{c.status}</StatusBadge>
                  {c.status === 'draft' ? <><Button size="sm" variant="ghost" onClick={() => setEditing(c)}>Edit</Button><Button size="sm" variant="secondary" onClick={() => act(c.id, 'submit')}>Submit for review</Button></> : null}
                  {c.status === 'review' ? <><Button size="sm" variant="secondary" onClick={() => act(c.id, 'reject')}>Send back</Button><Button size="sm" onClick={() => act(c.id, 'approve')}>Approve</Button></> : null}
                  {c.status === 'approved' ? <>{c.scheduledAt ? <Button size="sm" variant="secondary" onClick={() => act(c.id, 'schedule')}>Schedule</Button> : null}<Button size="sm" icon={<Send className="h-4 w-4" aria-hidden />} onClick={() => window.confirm('Send this campaign now to everyone in the audience who opted in?') && act(c.id, 'send')}>Send now</Button></> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing ? <CampaignEditor data={data} campaign={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
    </div>
  );
}

function CampaignEditor({ data, campaign, onClose, onSaved }: { data: Data; campaign: Campaign | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: campaign?.name ?? '',
    channel: campaign?.channel ?? ('email' as 'email' | 'sms'),
    subjectA: campaign?.subjectA ?? '',
    subjectB: campaign?.subjectB ?? '',
    body: campaign?.body ?? '',
    scheduledAt: campaign?.scheduledAt ? campaign.scheduledAt.slice(0, 16) : '',
  });
  const [aud, setAud] = useState<Audience>(campaign?.audience ?? { kinds: ['newsletter'] });
  const [preview, setPreview] = useState<{ matched: number; sendable: number; blocked: number; deferred: number; blockedReasons: Record<string, number> } | null>(null);
  const toggle = (k: keyof Audience, v: string) => {
    const list = (aud[k] as string[] | undefined) ?? [];
    setAud({ ...aud, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
    setPreview(null);
  };
  const doPreview = async () => {
    try {
      setPreview(await post('/api/marketing/campaigns', { action: 'preview', audience: aud, channel: f.channel }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not preview');
    }
  };
  const save = async () => {
    try {
      await post('/api/marketing/campaigns', { action: 'save', id: campaign?.id, ...f, subjectB: f.subjectB || null, audience: aud, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null });
      toast.success('Saved as draft');
      onSaved();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  return (
    <Modal title={campaign ? 'Edit campaign' : 'New campaign'} size="xl" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={f.name.trim().length < 2 || !f.body.trim()} onClick={save}>Save draft</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
          <FormField label="Channel">
            <Select value={f.channel} onChange={(e) => { setF({ ...f, channel: e.target.value as 'email' | 'sms' }); setPreview(null); }}>
              <option value="email">Email</option>
              <option value="sms">Text message</option>
            </Select>
          </FormField>
        </div>
        <fieldset className="space-y-2 rounded-lg bg-slate-50 p-3">
          <legend className="text-sm font-semibold text-slate-900">Audience (non-clinical attributes only)</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {data.kinds.map((k) => <Checkbox key={k.key} label={k.label} checked={(aud.kinds ?? []).includes(k.key)} onChange={() => toggle('kinds', k.key)} />)}
          </div>
          {data.tags.length ? (
            <div><p className="text-xs font-medium text-slate-600">Tags (any)</p><div className="mt-1 flex flex-wrap gap-2">{data.tags.map((t) => <Checkbox key={t} label={t} checked={(aud.tags ?? []).includes(t)} onChange={() => toggle('tags', t)} />)}</div></div>
          ) : null}
          {data.partners.length ? (
            <FormField label="Partner contacts of"><Select multiple value={aud.partnerIds ?? []} onChange={(e) => { setAud({ ...aud, partnerIds: Array.from(e.target.selectedOptions).map((o) => o.value) }); setPreview(null); }} className="h-24">{data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></FormField>
          ) : null}
          {data.events.length ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField label="Registered for event"><Select multiple value={aud.eventIds ?? []} onChange={(e) => { setAud({ ...aud, eventIds: Array.from(e.target.selectedOptions).map((o) => o.value) }); setPreview(null); }} className="h-24">{data.events.map((ev) => <option key={ev.id} value={ev.id}>{ev.title}</option>)}</Select></FormField>
              <div className="pt-6"><Checkbox label="Attended only" checked={Boolean(aud.attendedOnly)} onChange={(v) => setAud({ ...aud, attendedOnly: v })} /></div>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Users className="h-4 w-4" aria-hidden />} onClick={doPreview}>Preview audience</Button>
            {preview ? <span className="text-sm text-slate-700">{preview.matched} match · {preview.sendable} can receive now · {preview.deferred} after quiet hours · {preview.blocked} excluded ({Object.entries(preview.blockedReasons).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ') || 'none'})</span> : null}
          </div>
        </fieldset>
        {f.channel === 'email' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Subject (A)" required><TextInput value={f.subjectA} onChange={(e) => setF({ ...f, subjectA: e.target.value })} /></FormField>
            <FormField label="Subject (B, optional A/B test)" hint="Recipients alternate between A and B."><TextInput value={f.subjectB} onChange={(e) => setF({ ...f, subjectB: e.target.value })} /></FormField>
          </div>
        ) : null}
        <FormField label="Message" hint={f.channel === 'sms' ? 'Practice name and "Reply STOP to opt out." are added automatically. Max 480 characters.' : 'Unsubscribe link, practice address and 988 line are added automatically. Token: {{firstName}}.'}>
          <TextArea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
        </FormField>
        <FormField label="Send time (optional, after approval)"><TextInput type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} className="w-full sm:w-64" /></FormField>
        <CardBody className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">Workflow: save draft, submit for review, someone other than the author approves (leadership may self-approve), then send or schedule.</CardBody>
      </div>
    </Modal>
  );
}

function AudienceList() {
  const { data, error, loading, reload } = useApi<{ contacts: Contact[]; kinds: Kind[] }>('/api/marketing/contacts');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState('');
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const list = data.contacts.filter((c) => !kind || c.kind === kind);
  const patch = async (body: Record<string, unknown>) => {
    try {
      await post('/api/marketing/contacts', body, 'PATCH');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };
  return (
    <Card>
      <CardHeader
        title="Audience contacts"
        description="Newsletter subscribers, event attendees, partner contacts, community members and authorized clients."
        actions={<div className="flex w-full flex-wrap gap-2 sm:w-auto"><Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Filter by type" className="w-full sm:w-56"><option value="">All types</option>{data.kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select><Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>Add contact</Button></div>}
      />
      {!list.length ? (
        <EmptyState title="No contacts" description="Event registrations add contacts automatically. Add newsletter subscribers or partner contacts by hand." />
      ) : (
        <div className="clinic-scroll-x overflow-x-auto">
          <table className="w-full min-w-[760px] divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr>{['Name', 'Type', 'Email', 'Text', 'Tags', ''].map((h) => <th key={h} scope="col" className="px-4 py-2 text-left text-xs font-semibold text-slate-600">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {list.map((c) => (
                <tr key={c.id}>
                  <td className="px-4 py-2.5 text-slate-900">{c.name}{c.authorization && c.authorization !== 'valid' ? <span className="ml-2"><StatusBadge tone="danger" size="sm">Authorization {c.authorization}</StatusBadge></span> : null}</td>
                  <td className="px-4 py-2.5 text-slate-700">{data.kinds.find((k) => k.key === c.kind)?.label ?? c.kind}</td>
                  <td className="px-4 py-2.5">{c.email ? <StatusBadge size="sm" tone={c.emailOptedOut ? 'neutral' : c.emailConsent ? 'success' : 'warning'}>{c.emailOptedOut ? 'Unsubscribed' : c.emailConsent ? 'Opted in' : 'No opt-in'}</StatusBadge> : '—'}</td>
                  <td className="px-4 py-2.5">{c.phone ? <StatusBadge size="sm" tone={c.smsOptedOut ? 'neutral' : c.smsConsent ? 'success' : 'warning'}>{c.smsOptedOut ? 'STOP' : c.smsConsent ? 'Opted in' : 'No consent'}</StatusBadge> : '—'}</td>
                  <td className="px-4 py-2.5 text-slate-700">{c.tags.join(', ') || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Select value="" aria-label={`Actions for ${c.name}`} className="w-40" onChange={(e) => {
                      const v = e.target.value;
                      if (v === 'unsub') void patch({ id: c.id, emailOptOut: true });
                      if (v === 'stop') void patch({ id: c.id, smsOptOut: true });
                      if (v === 'remove' && window.confirm('Remove this contact?')) void patch({ id: c.id, remove: true });
                    }}>
                      <option value="">Actions</option>
                      <option value="unsub">Record email unsubscribe</option>
                      <option value="stop">Record text opt-out</option>
                      <option value="remove">Remove</option>
                    </Select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding ? <AddContact kinds={data.kinds} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} /> : null}
    </Card>
  );
}

function AddContact({ kinds, onClose, onSaved }: { kinds: Kind[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', kind: 'newsletter', tags: '', emailConsent: false, smsConsent: false, clientId: '' });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  return (
    <Modal title="Add contact" size="lg" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try {
        await post('/api/marketing/contacts', { ...f, email: f.email || null, phone: f.phone || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean), clientId: f.kind === 'client_authorized' ? f.clientId || null : null });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save');
      }
    }}>Add</Button></>}>
      <div className="space-y-3">
        <FormField label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</Select></FormField>
        {f.kind === 'client_authorized' ? (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <Alert tone="warning">HIPAA: a client can join only with a signed marketing authorization from the consent library. Diagnoses, programs and appointments are never used to target them.</Alert>
            <div className="flex gap-2"><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client" aria-label="Search client" /><Button variant="secondary" onClick={async () => { const r = await fetch(`/api/clients?q=${encodeURIComponent(q)}&limit=10`).then((x) => x.json()).catch(() => ({})); setClients((r.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))); }}>Search</Button></div>
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} aria-label="Client"><option value="">Choose client</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Name" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
            <FormField label="Email"><TextInput type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></FormField>
            <FormField label="Mobile"><TextInput value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></FormField>
          </div>
        )}
        <FormField label="Tags" hint="Comma separated, non-clinical (e.g. school counselor, faith leader, Bowie)."><TextInput value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></FormField>
        <Checkbox label="Opted in to marketing email (record how: sign-up sheet, website, verbal)" checked={f.emailConsent} onChange={(v) => setF({ ...f, emailConsent: v })} />
        <Checkbox label="Gave written consent to marketing texts" checked={f.smsConsent} onChange={(v) => setF({ ...f, smsConsent: v })} hint="TCPA requires prior express written consent for marketing texts." />
      </div>
    </Modal>
  );
}
