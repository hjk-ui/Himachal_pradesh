'use client';

import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Inbox,
  ListChecks,
  Mail,
  MessageSquare,
  Phone,
  PhoneMissed,
  Plus,
  Search,
  Sparkles,
  UserCheck,
  UserPlus,
  KanbanSquare,
  List,
} from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  FormField,
  LoadingState,
  Modal,
  StatusBadge,
  Tabs,
  cx,
} from '@/components/ui';
import { formatDuration } from '@/lib/marketing/leads';
import { LEAD_SOURCES, OPEN_STAGES, PREFERRED_CONTACT } from '@/lib/marketing/constants';
import type { LeadDTO } from '@/lib/marketing/leadService';
import { Checkbox, DraftNotice, Select, TextArea, TextInput, fmtDate, post, useApi, useNow } from './shared';

type Named = { id: string; name: string; role?: string };
type Template = { id: string; name: string; channel: string; subject: string | null; body: string; builtIn: boolean };
type LeadsData = {
  leads: LeadDTO[];
  speedTargetMinutes: number;
  stages: { key: string; label: string; closed: boolean }[];
  assignees: Named[];
  templates: Template[];
  partners: { id: string; name: string }[];
  events: { id: string; title: string; startsAt: string }[];
  clinicians: Named[];
  locations: { id: string; name: string }[];
  serviceInterests: string[];
  lostReasons: string[];
  aiSuggestions: boolean;
};
type Detail = {
  lead: LeadDTO;
  activities: { id: string; kind: string; summary: string; actorName: string | null; createdAt: string }[];
  messages: { id: string; channel: string; direction: string; subject: string | null; body: string; status: string; reason: string | null; createdAt: string }[];
  tasks: { id: string; title: string; dueAt: string | null; status: string; source: string }[];
};
type Conversation = { leadId: string; name: string; stageLabel: string; optedOut: boolean; lastMessage: string; lastDirection: string; lastChannel: string; lastAt: string; unread: number };
type View = 'pipeline' | 'list' | 'inbox' | 'tasks';

const STAGE_TONE: Record<string, 'neutral' | 'info' | 'brand' | 'success' | 'warning' | 'danger'> = {
  new: 'warning',
  contacted: 'info',
  screening: 'info',
  insurance_verified: 'brand',
  scheduled: 'brand',
  converted: 'success',
  not_a_fit: 'neutral',
  lost: 'neutral',
};

function SpeedBadge({ lead, now, target }: { lead: LeadDTO; now: number; target: number }) {
  const minutes = lead.firstResponseAt ? lead.speed.minutes : Math.max(0, Math.round((now - new Date(lead.createdAt).getTime()) / 60000));
  const overdue = minutes > target;
  if (lead.firstResponseAt) return <StatusBadge tone={overdue ? 'warning' : 'success'} size="sm" icon={<Clock aria-hidden />}>Responded in {formatDuration(minutes)}</StatusBadge>;
  if (!OPEN_STAGES.includes(lead.stage as (typeof OPEN_STAGES)[number])) return null;
  return <StatusBadge tone={overdue ? 'danger' : 'warning'} size="sm" icon={<Clock aria-hidden />}>Waiting {formatDuration(minutes)}</StatusBadge>;
}

export function LeadsWorkspace() {
  const [q, setQ] = useState('');
  const [closed, setClosed] = useState(false);
  const url = `/api/marketing/leads?${new URLSearchParams({ ...(q.trim().length >= 2 ? { q: q.trim() } : {}), ...(closed ? { closed: '1' } : {}) }).toString()}`;
  const { data, error, loading, reload } = useApi<LeadsData>(url);
  const [view, setView] = useState<View>('pipeline');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [missed, setMissed] = useState(false);
  const [closing, setClosing] = useState<{ id: string; stage: 'lost' | 'not_a_fit' } | null>(null);
  const now = useNow();

  const moveStage = async (id: string, stage: string) => {
    if (stage === 'lost' || stage === 'not_a_fit') return setClosing({ id, stage });
    if (stage === 'converted') {
      setOpenId(id);
      toast('Use Convert to client in the lead to create the client and intake appointment.');
      return;
    }
    try {
      await post(`/api/marketing/leads/${id}`, { stage }, 'PATCH');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not move lead');
    }
  };

  const unread = data?.leads.reduce((a, l) => a + l.unread, 0) ?? 0;
  const waiting = data?.leads.filter((l) => !l.firstResponseAt && OPEN_STAGES.includes(l.stage as (typeof OPEN_STAGES)[number])).length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs
          variant="pill"
          label="Lead views"
          controlsPanels={false}
          value={view}
          onChange={setView}
          items={[
            { key: 'pipeline', label: 'Pipeline', icon: <KanbanSquare aria-hidden className="h-4 w-4" /> },
            { key: 'list', label: 'List', icon: <List aria-hidden className="h-4 w-4" /> },
            { key: 'inbox', label: 'Conversations', icon: <Inbox aria-hidden className="h-4 w-4" />, count: unread, countTone: 'attention' },
            { key: 'tasks', label: 'Tasks', icon: <ListChecks aria-hidden className="h-4 w-4" /> },
          ]}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative block w-full sm:w-auto">
            <span className="sr-only">Search leads</span>
            <Search aria-hidden className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, email" className="w-full pl-8 sm:w-56" />
          </label>
          <Checkbox label="Show closed" checked={closed} onChange={setClosed} />
          <Button variant="secondary" size="sm" icon={<PhoneMissed className="h-4 w-4" aria-hidden />} onClick={() => setMissed(true)}>
            Missed call
          </Button>
          <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)}>
            New lead
          </Button>
        </div>
      </div>

      {waiting > 0 ? (
        <Alert tone="warning" title={`${waiting} lead${waiting === 1 ? '' : 's'} waiting for a first response`}>
          Speed-to-lead target: {data?.speedTargetMinutes ?? 15} minutes. Calls and sent messages stop the timer.
        </Alert>
      ) : null}

      {error ? <ErrorState description={error} onRetry={reload} /> : null}
      {loading && !data ? <LoadingState label="Loading leads" rows={6} /> : null}

      {data && view === 'pipeline' ? <Pipeline data={data} now={now} onOpen={setOpenId} onMove={moveStage} /> : null}
      {data && view === 'list' ? <LeadList data={data} now={now} onOpen={setOpenId} /> : null}
      {data && view === 'inbox' ? <Conversations data={data} onChanged={reload} /> : null}
      {data && view === 'tasks' ? <TaskList onOpenLead={setOpenId} /> : null}

      {openId && data ? <LeadModal id={openId} data={data} now={now} onClose={() => setOpenId(null)} onChanged={reload} /> : null}
      {creating && data ? <NewLeadModal data={data} onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); void reload(); setOpenId(id); }} /> : null}
      {missed ? <MissedCallModal onClose={() => setMissed(false)} /> : null}
      {closing && data ? (
        <CloseLeadModal
          stage={closing.stage}
          reasons={data.lostReasons}
          onClose={() => setClosing(null)}
          onConfirm={async (reason) => {
            try {
              await post(`/api/marketing/leads/${closing.id}`, { stage: closing.stage, lostReason: reason }, 'PATCH');
              setClosing(null);
              await reload();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Could not close lead');
            }
          }}
        />
      ) : null}
    </div>
  );
}

function LeadCard({ lead, now, target, onOpen }: { lead: LeadDTO; now: number; target: number; onOpen: () => void }) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => e.dataTransfer.setData('text/lead-id', lead.id)}
      onClick={onOpen}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-xs transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
          {lead.firstName} {lead.lastName}
        </p>
        {lead.unread ? <StatusBadge tone="brand" size="sm">{lead.unread} new</StatusBadge> : null}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">
        {lead.sourceLabel}
        {lead.serviceInterest ? ` · ${lead.serviceInterest}` : ''}
      </p>
      <div className="mt-2 flex flex-wrap gap-1">
        <SpeedBadge lead={lead} now={now} target={target} />
        {lead.possibleClientMatch ? <StatusBadge tone="warning" size="sm" icon={<AlertTriangle aria-hidden />}>Possible existing client</StatusBadge> : null}
        {lead.smsOptedOut ? <StatusBadge tone="neutral" size="sm">STOP</StatusBadge> : null}
      </div>
      <p className="mt-2 text-xs text-slate-500">{lead.assignedToName ? `Assigned: ${lead.assignedToName}` : 'Unassigned'}</p>
    </button>
  );
}

function Pipeline({ data, now, onOpen, onMove }: { data: LeadsData; now: number; onOpen: (id: string) => void; onMove: (id: string, stage: string) => void }) {
  const cols = data.stages.filter((s) => !s.closed || data.leads.some((l) => l.stage === s.key));
  if (!data.leads.length) {
    return (
      <Card>
        <EmptyState icon={<UserPlus aria-hidden />} title="No open leads" description="Leads from your web forms, phone calls, partners and events appear here. Add one with New lead." />
      </Card>
    );
  }
  return (
    <div className="clinic-scroll-x -mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {cols.map((s) => {
          const items = data.leads.filter((l) => l.stage === s.key);
          return (
            <section
              key={s.key}
              aria-label={s.label}
              className="w-64 shrink-0 rounded-xl border border-slate-200 bg-slate-50"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/lead-id');
                if (id && data.leads.find((l) => l.id === id)?.stage !== s.key) onMove(id, s.key);
              }}
            >
              <header className="flex items-center justify-between px-3 py-2">
                <h3 className="text-sm font-semibold text-slate-900">{s.label}</h3>
                <span className="text-xs tabular-nums text-slate-500">{items.length}</span>
              </header>
              <div className="space-y-2 px-2 pb-2">
                {items.map((l) => (
                  <LeadCard key={l.id} lead={l} now={now} target={data.speedTargetMinutes} onOpen={() => onOpen(l.id)} />
                ))}
                {!items.length ? <p className="px-1 py-4 text-center text-xs text-slate-500">Drop a lead here</p> : null}
              </div>
            </section>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-slate-500">Drag a card to move it, or open the lead to change its stage. Converting always goes through Convert to client.</p>
    </div>
  );
}

function LeadList({ data, now, onOpen }: { data: LeadsData; now: number; onOpen: (id: string) => void }) {
  if (!data.leads.length) return <Card><EmptyState title="No leads match" description="Try another search or show closed leads." /></Card>;
  return (
    <Card>
      <div className="clinic-scroll-x overflow-x-auto">
        <table className="w-full min-w-[760px] divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {['Name', 'Stage', 'Source', 'Speed to lead', 'Assigned', 'Created'].map((h, i) => (
                <th key={h} scope="col" className={cx('px-4 py-2 text-left text-xs font-semibold text-slate-600', i === 0 && 'sticky left-0 z-10 bg-slate-50')}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.leads.map((l) => (
              <tr key={l.id} className="group hover:bg-slate-50">
                <td className="sticky left-0 z-10 bg-white px-4 py-3 group-hover:bg-slate-50">
                  <button type="button" className="font-medium text-blue-700 hover:underline" onClick={() => onOpen(l.id)}>{l.firstName} {l.lastName}</button>
                  {l.possibleClientMatch ? <span className="ml-2"><StatusBadge tone="warning" size="sm">Possible existing client</StatusBadge></span> : null}
                </td>
                <td className="px-4 py-3"><StatusBadge tone={STAGE_TONE[l.stage]} size="sm">{l.stageLabel}</StatusBadge></td>
                <td className="px-4 py-3 text-slate-700">{l.sourceLabel}</td>
                <td className="px-4 py-3"><SpeedBadge lead={l} now={now} target={data.speedTargetMinutes} /></td>
                <td className="px-4 py-3 text-slate-700">{l.assignedToName ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{fmtDate(l.createdAt, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Thread({ messages }: { messages: Detail['messages'] }) {
  if (!messages.length) return <p className="py-6 text-center text-sm text-slate-500">No messages yet.</p>;
  return (
    <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
      {messages.map((m) => (
        <li key={m.id} className={cx('flex', m.direction === 'inbound' ? 'justify-start' : 'justify-end')}>
          <div className={cx('max-w-[85%] rounded-lg px-3 py-2 text-sm', m.direction === 'inbound' ? 'bg-slate-100 text-slate-900' : 'bg-blue-50 text-slate-900 ring-1 ring-blue-200')}>
            {m.subject ? <p className="text-xs font-semibold text-slate-700">{m.subject}</p> : null}
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
              {m.channel === 'sms' ? 'Text' : 'Email'} · {fmtDate(m.createdAt, true)}
              {m.direction === 'outbound' ? (
                <StatusBadge size="sm" tone={m.status === 'sent' ? 'success' : m.status === 'queued' ? 'warning' : m.status === 'blocked' || m.status === 'failed' ? 'danger' : 'neutral'}>
                  {m.status === 'queued' ? `Queued${m.reason ? `: ${m.reason.replace(/_/g, ' ')}` : ''}` : m.status === 'blocked' ? `Not sent: ${(m.reason ?? '').replace(/_/g, ' ')}` : m.status}
                </StatusBadge>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Composer({ leadId, lead, templates, aiOn, onSent }: { leadId: string; lead: LeadDTO; templates: Template[]; aiOn: boolean; onSent: () => void }) {
  const [channel, setChannel] = useState<'sms' | 'email'>(lead.smsConsent && !lead.smsOptedOut ? 'sms' : 'email');
  const [body, setBody] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [suggest, setSuggest] = useState<{ replies: string[]; engine: 'bedrock' | 'rules' } | null>(null);
  const fill = (t: string) => t.replace(/\{\{\s*firstName\s*\}\}/g, lead.firstName);
  const send = async () => {
    setBusy(true);
    try {
      const r = await post<{ success: true; status: string; message: string }>(`/api/marketing/leads/${leadId}/messages`, { channel, body, subject: channel === 'email' ? subject : null });
      if (r.status === 'sent') toast.success(r.message);
      else toast(r.message, { icon: <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden /> });
      setBody('');
      setSubject('');
      onSent();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not send');
    } finally {
      setBusy(false);
    }
  };
  const getSuggestions = async () => {
    try {
      const r = await post<{ success: true; draft: { data: { replies: string[] }; engine: 'bedrock' | 'rules' } }>(`/api/marketing/leads/${leadId}/suggest`, {});
      setSuggest({ replies: r.draft.data.replies, engine: r.draft.engine });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not get suggestions');
    }
  };
  const smsBlocked = channel === 'sms' && (!lead.smsConsent || lead.smsOptedOut);
  return (
    <div className="space-y-3 rounded-lg bg-slate-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Channel">
          <Select value={channel} onChange={(e) => setChannel(e.target.value as 'sms' | 'email')}>
            <option value="sms">Text message</option>
            <option value="email">Email</option>
          </Select>
        </FormField>
        <FormField label="Template">
          <Select
            value=""
            onChange={(e) => {
              const t = templates.find((x) => x.id === e.target.value);
              if (t) {
                setBody(fill(t.body));
                if (t.subject) setSubject(t.subject);
                setChannel(t.channel === 'email' ? 'email' : 'sms');
              }
            }}
          >
            <option value="">Choose a template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </FormField>
      </div>
      {smsBlocked ? <Alert tone="warning">{lead.smsOptedOut ? 'This number replied STOP. Texts are blocked.' : 'No SMS consent recorded. Record verbal consent in Contact & consent first, or use email or a call.'}</Alert> : null}
      {channel === 'email' ? (
        <FormField label="Subject">
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
        </FormField>
      ) : null}
      <FormField label="Message" hint="About their inquiry only. No clinical details by text or email; offer a call instead.">
        <TextArea rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={1600} />
      </FormField>
      {suggest ? (
        <div className="space-y-2">
          <DraftNotice engine={suggest.engine} />
          {suggest.replies.map((r, i) => (
            <button key={i} type="button" className="block w-full rounded-lg border border-slate-200 bg-white p-2 text-left text-sm text-slate-700 hover:bg-slate-50" onClick={() => setBody(r)}>
              {r}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {aiOn ? (
          <Button variant="secondary" size="sm" icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={getSuggestions}>
            Suggest replies
          </Button>
        ) : null}
        <Button size="sm" loading={busy} disabled={!body.trim() || smsBlocked} icon={channel === 'sms' ? <MessageSquare className="h-4 w-4" aria-hidden /> : <Mail className="h-4 w-4" aria-hidden />} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}

function LeadModal({ id, data, now, onClose, onChanged }: { id: string; data: LeadsData; now: number; onClose: () => void; onChanged: () => void }) {
  const { data: d, error, loading, reload } = useApi<Detail & { success: true }>(`/api/marketing/leads/${id}`);
  const [section, setSection] = useState<'messages' | 'details' | 'activity' | 'convert'>('messages');
  const [note, setNote] = useState('');
  const refresh = async () => {
    await reload();
    onChanged();
  };
  useEffect(() => {
    void post(`/api/marketing/leads/${id}`, { action: 'read' }).catch(() => {});
  }, [id]);
  const patch = async (body: Record<string, unknown>) => {
    try {
      await post(`/api/marketing/leads/${id}`, body, 'PATCH');
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const action = async (body: Record<string, unknown>, okMsg: string) => {
    try {
      await post(`/api/marketing/leads/${id}`, body);
      toast.success(okMsg);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save');
    }
  };
  const lead = d?.lead;
  return (
    <Modal title={lead ? `${lead.firstName} ${lead.lastName}` : 'Lead'} onClose={onClose} size="xl">
      {error ? <ErrorState description={error} onRetry={reload} /> : null}
      {loading && !d ? <LoadingState rows={5} /> : null}
      {lead && d ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={STAGE_TONE[lead.stage]}>{lead.stageLabel}</StatusBadge>
            <StatusBadge tone="neutral">{lead.sourceLabel}{lead.sourceDetail ? `: ${lead.sourceDetail}` : ''}</StatusBadge>
            <SpeedBadge lead={lead} now={now} target={data.speedTargetMinutes} />
            {lead.possibleClientMatch ? <StatusBadge tone="warning" icon={<AlertTriangle aria-hidden />}>Possible existing client: check the client list before converting</StatusBadge> : null}
          </div>
          {lead.stage === 'converted' ? <Alert tone="success" title="Converted to client">Communication now happens from the client chart (clinical messaging). Marketing to clients needs a signed marketing authorization.</Alert> : null}
          {lead.stage !== 'converted' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <FormField label="Stage">
                <Select value={lead.stage} onChange={(e) => {
                  const v = e.target.value;
                  if (v === 'lost' || v === 'not_a_fit') {
                    const reason = window.prompt(`Reason (${data.lostReasons.join(', ')})`);
                    if (reason) void patch({ stage: v, lostReason: reason });
                  } else if (v === 'converted') setSection('convert');
                  else void patch({ stage: v });
                }}>
                  {data.stages.map((s) => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Assigned to">
                <Select value={lead.assignedToId ?? ''} onChange={(e) => void patch({ assignedToId: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {data.assignees.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Log a call">
                <Select value="" onChange={(e) => e.target.value && void action({ action: 'call', outcome: e.target.value }, 'Call logged')}>
                  <option value="">Choose outcome</option>
                  <option value="reached">Reached</option>
                  <option value="voicemail">Left voicemail</option>
                  <option value="no_answer">No answer</option>
                  <option value="wrong_number">Wrong number</option>
                </Select>
              </FormField>
            </div>
          ) : null}
          <Tabs
            label="Lead sections"
            controlsPanels={false}
            value={section}
            onChange={setSection}
            items={[
              { key: 'messages', label: 'Messages' },
              { key: 'details', label: 'Contact & consent' },
              { key: 'activity', label: 'Activity & tasks', count: d.tasks.filter((t) => t.status === 'open').length },
              ...(lead.stage !== 'converted' && lead.stage !== 'lost' && lead.stage !== 'not_a_fit' ? [{ key: 'convert' as const, label: 'Convert to client' }] : []),
            ]}
          />
          {section === 'messages' ? (
            <div className="space-y-3">
              <Thread messages={d.messages} />
              {lead.stage !== 'converted' ? <Composer leadId={id} lead={lead} templates={data.templates} aiOn={data.aiSuggestions} onSent={refresh} /> : null}
            </div>
          ) : null}
          {section === 'details' ? <LeadDetails lead={lead} data={data} onSave={patch} /> : null}
          {section === 'activity' ? (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-slate-900">Activity</h3>
                <div className="flex gap-2">
                  <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (contact / scheduling only)" aria-label="Note" />
                  <Button size="sm" variant="secondary" disabled={!note.trim()} onClick={async () => { await action({ action: 'note', text: note }, 'Note added'); setNote(''); }}>Add</Button>
                </div>
                <ol className="max-h-72 space-y-2 overflow-y-auto">
                  {d.activities.map((a) => (
                    <li key={a.id} className="rounded-lg border border-slate-100 p-2 text-sm text-slate-700">
                      {a.summary}
                      <span className="block text-xs text-slate-500">{fmtDate(a.createdAt, true)}{a.actorName ? ` · ${a.actorName}` : ''}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <LeadTasks leadId={id} tasks={d.tasks} onChanged={refresh} />
            </div>
          ) : null}
          {section === 'convert' ? <ConvertForm lead={lead} data={data} onDone={refresh} /> : null}
          {lead.stage === 'scheduled' ? (
            <div className="flex justify-end">
              <Button variant="secondary" size="sm" onClick={() => void action({ action: 'no_show' }, 'Marked as missed intake')}>Mark missed intake</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}

function LeadDetails({ lead, data, onSave }: { lead: LeadDTO; data: LeadsData; onSave: (b: Record<string, unknown>) => Promise<void> }) {
  const [f, setF] = useState({
    firstName: lead.firstName,
    lastName: lead.lastName,
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    dateOfBirth: lead.dateOfBirth ?? '',
    serviceInterest: lead.serviceInterest ?? '',
    insurance: lead.insurance ?? '',
    preferredContact: lead.preferredContact ?? '',
    notes: lead.notes ?? '',
    partnerId: lead.partnerId ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const disabled = lead.stage === 'converted';
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="First name" required><TextInput value={f.firstName} onChange={set('firstName')} disabled={disabled} /></FormField>
        <FormField label="Last name" required><TextInput value={f.lastName} onChange={set('lastName')} disabled={disabled} /></FormField>
        <FormField label="Mobile phone"><TextInput value={f.phone} onChange={set('phone')} disabled={disabled} /></FormField>
        <FormField label="Email"><TextInput type="email" value={f.email} onChange={set('email')} disabled={disabled} /></FormField>
        <FormField label="Date of birth" hint="Used to match existing clients."><TextInput type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} disabled={disabled} /></FormField>
        <FormField label="Service interest">
          <Select value={f.serviceInterest} onChange={set('serviceInterest')} disabled={disabled}>
            <option value="">Not set</option>
            {data.serviceInterests.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </FormField>
        <FormField label="Insurance plan (name only)"><TextInput value={f.insurance} onChange={set('insurance')} disabled={disabled} /></FormField>
        <FormField label="Preferred contact">
          <Select value={f.preferredContact} onChange={set('preferredContact')} disabled={disabled}>
            <option value="">Not set</option>
            {PREFERRED_CONTACT.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Referral partner">
          <Select value={f.partnerId} onChange={set('partnerId')} disabled={disabled}>
            <option value="">None</option>
            {data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </FormField>
      </div>
      <FormField label="Notes" hint="Minimum necessary: contact and scheduling facts only. Clinical details go in the intake assessment after conversion.">
        <TextArea rows={3} value={f.notes} onChange={set('notes')} disabled={disabled} />
      </FormField>
      <div className="space-y-2 rounded-lg bg-slate-50 p-3">
        <h3 className="text-sm font-semibold text-slate-900">Consent</h3>
        <Checkbox label="Agreed to be contacted about this inquiry" checked={lead.contactConsent} disabled={disabled} onChange={(v) => void onSave({ contactConsent: v })} />
        <Checkbox
          label="SMS consent"
          hint={lead.smsOptedOut ? 'Replied STOP. Only the person can opt back in by replying START.' : 'Check only when the person agreed to texts (web form or verbal, recorded with date and source).'}
          checked={lead.smsConsent}
          disabled={disabled || lead.smsOptedOut}
          onChange={(v) => void onSave({ smsConsent: v })}
        />
        <Checkbox label="Email updates opt-in (newsletters, events)" hint={lead.emailOptedOut ? 'Unsubscribed.' : undefined} checked={lead.emailConsent} disabled={disabled || lead.emailOptedOut} onChange={(v) => void onSave({ emailConsent: v })} />
      </div>
      {!disabled ? (
        <div className="flex justify-end">
          <Button onClick={() => void onSave({ ...f, dateOfBirth: f.dateOfBirth || null, partnerId: f.partnerId || null, preferredContact: f.preferredContact || null, serviceInterest: f.serviceInterest || null })}>Save details</Button>
        </div>
      ) : null}
    </div>
  );
}

function LeadTasks({ leadId, tasks, onChanged }: { leadId: string; tasks: Detail['tasks']; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Follow-up tasks</h3>
      <div className="flex flex-wrap gap-2">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Call back Tuesday" aria-label="Task" className="min-w-0 flex-1" />
        <TextInput type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due" className="w-full sm:w-48" />
        <Button size="sm" variant="secondary" disabled={title.trim().length < 2} onClick={async () => {
          try {
            await post('/api/marketing/leads/tasks', { leadId, title, dueAt: due ? new Date(due).toISOString() : null });
            setTitle('');
            setDue('');
            onChanged();
          } catch (e) {
            toast.error(e instanceof Error ? e.message : 'Could not add task');
          }
        }}>Add</Button>
      </div>
      <ul className="space-y-1">
        {tasks.map((t) => (
          <li key={t.id} className="flex items-center gap-2 text-sm">
            <Checkbox label={<span className={t.status === 'done' ? 'text-slate-500 line-through' : ''}>{t.title}{t.dueAt ? ` · due ${fmtDate(t.dueAt, true)}` : ''}{t.source === 'automation' ? ' (automation)' : ''}</span>} checked={t.status === 'done'} onChange={async (v) => { await post('/api/marketing/leads/tasks', { id: t.id, done: v }, 'PATCH'); onChanged(); }} />
          </li>
        ))}
        {!tasks.length ? <li className="text-sm text-slate-500">No tasks.</li> : null}
      </ul>
    </div>
  );
}

function ConvertForm({ lead, data, onDone }: { lead: LeadDTO; data: LeadsData; onDone: () => void }) {
  const [f, setF] = useState({ date: '', startTime: '10:00', clinicianId: '', appointmentType: 'Initial Assessment', isVirtual: false, locationId: '' });
  const [busy, setBusy] = useState(false);
  const [match, setMatch] = useState<string | null>(null);
  const submit = async (confirmNewPerson = false) => {
    setBusy(true);
    try {
      const r = await post<{ success: true; appointmentError: string | null }>(`/api/marketing/leads/${lead.id}/convert`, { ...f, locationId: f.locationId || null, confirmNewPerson });
      if (r.appointmentError) toast(`Client created. Appointment not booked: ${r.appointmentError}`);
      else toast.success('Client created and intake appointment booked.');
      onDone();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not convert';
      if (/possible existing client/i.test(msg)) setMatch(msg);
      else toast.error(msg);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3">
      <Alert tone="info">Creates the client (same rules as New intake) and books the intake appointment. The lead closes as Converted and its automations stop. Only the lead&apos;s name, contact, date of birth and insurance plan carry over.</Alert>
      {match ? (
        <Alert tone="warning" title="Possible existing client" actions={<Button size="sm" variant="secondary" loading={busy} onClick={() => void submit(true)}>This is a new person, convert</Button>}>
          {match}
        </Alert>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Intake date" required><TextInput type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></FormField>
        <FormField label="Start time" required><TextInput type="time" value={f.startTime} onChange={(e) => setF({ ...f, startTime: e.target.value })} /></FormField>
        <FormField label="Clinician" required>
          <Select value={f.clinicianId} onChange={(e) => setF({ ...f, clinicianId: e.target.value })}>
            <option value="">Choose clinician</option>
            {data.clinicians.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Location">
          <Select value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
            <option value="">Lead preference / none</option>
            {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </FormField>
        <FormField label="Appointment type"><TextInput value={f.appointmentType} onChange={(e) => setF({ ...f, appointmentType: e.target.value })} /></FormField>
        <div className="pt-6"><Checkbox label="Telehealth visit" checked={f.isVirtual} onChange={(v) => setF({ ...f, isVirtual: v })} /></div>
      </div>
      <div className="flex justify-end">
        <Button icon={<UserCheck className="h-4 w-4" aria-hidden />} loading={busy} disabled={!f.date || !f.startTime || !f.clinicianId} onClick={() => void submit(false)}>Convert to client</Button>
      </div>
    </div>
  );
}

function NewLeadModal({ data, onClose, onCreated }: { data: LeadsData; onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', email: '', dateOfBirth: '', source: 'phone', sourceDetail: '', partnerId: '', eventId: '', serviceInterest: '', locationId: '', insurance: '', preferredContact: 'phone', contactConsent: true, smsConsent: false, notes: '', assignedToId: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    setBusy(true);
    try {
      const r = await post<{ success: true; leadId: string; possibleClientMatch: { basis: string } | null; duplicateLead: { basis: string } | null }>('/api/marketing/leads', {
        ...f,
        dateOfBirth: f.dateOfBirth || null,
        partnerId: f.partnerId || null,
        eventId: f.eventId || null,
        locationId: f.locationId || null,
        assignedToId: f.assignedToId || null,
        serviceInterest: f.serviceInterest || null,
        email: f.email || null,
      });
      if (r.possibleClientMatch) toast(`Possible existing client (matched on ${r.possibleClientMatch.basis}).`);
      if (r.duplicateLead) toast(`Possible duplicate of an open lead (${r.duplicateLead.basis}).`);
      onCreated(r.leadId);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create lead');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New lead" onClose={onClose} size="lg" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={!f.firstName.trim() || !f.lastName.trim()} onClick={save}>Create lead</Button></>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="First name" required><TextInput value={f.firstName} onChange={set('firstName')} /></FormField>
          <FormField label="Last name" required><TextInput value={f.lastName} onChange={set('lastName')} /></FormField>
          <FormField label="Mobile phone"><TextInput value={f.phone} onChange={set('phone')} /></FormField>
          <FormField label="Email"><TextInput type="email" value={f.email} onChange={set('email')} /></FormField>
          <FormField label="Date of birth" hint="Optional; helps find existing clients."><TextInput type="date" value={f.dateOfBirth} onChange={set('dateOfBirth')} /></FormField>
          <FormField label="Source" required>
            <Select value={f.source} onChange={set('source')}>
              {LEAD_SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </Select>
          </FormField>
          {f.source === 'referral_partner' ? (
            <FormField label="Referral partner">
              <Select value={f.partnerId} onChange={set('partnerId')}>
                <option value="">Choose partner</option>
                {data.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
          ) : null}
          {f.source === 'community_event' ? (
            <FormField label="Event">
              <Select value={f.eventId} onChange={set('eventId')}>
                <option value="">Choose event</option>
                {data.events.map((e) => <option key={e.id} value={e.id}>{e.title} ({fmtDate(e.startsAt)})</option>)}
              </Select>
            </FormField>
          ) : null}
          <FormField label="Source detail"><TextInput value={f.sourceDetail} onChange={set('sourceDetail')} placeholder="e.g. Psychology Today, BCBS directory" /></FormField>
          <FormField label="Service interest">
            <Select value={f.serviceInterest} onChange={set('serviceInterest')}>
              <option value="">Not set</option>
              {data.serviceInterests.map((s) => <option key={s}>{s}</option>)}
            </Select>
          </FormField>
          <FormField label="Location">
            <Select value={f.locationId} onChange={set('locationId')}>
              <option value="">No preference</option>
              {data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Insurance plan (name only)"><TextInput value={f.insurance} onChange={set('insurance')} /></FormField>
          <FormField label="Assign to">
            <Select value={f.assignedToId} onChange={set('assignedToId')}>
              <option value="">Unassigned</option>
              {data.assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Notes" hint="Contact and scheduling facts only. If the caller is in crisis, follow the crisis protocol and share 988."><TextArea rows={2} value={f.notes} onChange={set('notes')} /></FormField>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <Checkbox label="Caller agreed to be contacted about this inquiry" checked={f.contactConsent} onChange={(v) => setF({ ...f, contactConsent: v })} />
          <Checkbox label="Caller agreed to receive text messages (verbal consent, recorded now)" hint="Read the consent: texts about their inquiry, msg & data rates may apply, reply STOP to opt out." checked={f.smsConsent} onChange={(v) => setF({ ...f, smsConsent: v })} />
        </div>
      </div>
    </Modal>
  );
}

function CloseLeadModal({ stage, reasons, onClose, onConfirm }: { stage: 'lost' | 'not_a_fit'; reasons: string[]; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState(reasons[0] ?? 'Other');
  return (
    <Modal title={stage === 'lost' ? 'Close lead as Lost' : 'Close lead as Not a fit'} size="sm" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => onConfirm(reason)}>Close lead</Button></>}>
      <FormField label="Reason" required>
        <Select value={reason} onChange={(e) => setReason(e.target.value)}>
          {reasons.map((r) => <option key={r}>{r}</option>)}
        </Select>
      </FormField>
      {stage === 'not_a_fit' ? <p className="mt-2 text-xs text-slate-500">If the person needs a different level of care, share referral resources and 988 for crisis.</p> : null}
    </Modal>
  );
}

function MissedCallModal({ onClose }: { onClose: () => void }) {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Log a missed call" size="sm" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={busy} disabled={phone.replace(/\D/g, '').length < 10} onClick={async () => {
      setBusy(true);
      try {
        const r = await post<{ success: true; texted: boolean }>('/api/marketing/leads/missed-call', { phone });
        toast.success(r.texted ? 'Text-back sent and call-back task created.' : 'Call-back task created.');
        onClose();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not log');
      } finally {
        setBusy(false);
      }
    }}>Log call</Button></>}>
      <div className="space-y-3">
        <FormField label="Caller number" required><TextInput value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" /></FormField>
        <p className="text-xs text-slate-500">Text-back goes only to a known lead who gave SMS consent (setting in Marketing settings). Unknown callers get a call-back task, never a cold text. Automatic missed-call capture needs the phone system connected.</p>
      </div>
    </Modal>
  );
}

function Conversations({ data, onChanged }: { data: LeadsData; onChanged: () => void }) {
  const { data: c, error, loading, reload } = useApi<{ conversations: Conversation[] }>('/api/marketing/leads/conversations');
  const [active, setActive] = useState<string | null>(null);
  const list = useMemo(() => c?.conversations ?? [], [c]);
  const current = active ?? list[0]?.leadId ?? null;
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !c) return <LoadingState rows={4} />;
  if (!list.length) return <Card><EmptyState icon={<Inbox aria-hidden />} title="No conversations yet" description="Texts and emails with leads appear here, including replies to your texts." /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <Card>
        <ul className="divide-y divide-slate-100">
          {list.map((x) => (
            <li key={x.leadId}>
              <button type="button" onClick={() => setActive(x.leadId)} className={cx('w-full px-4 py-3 text-left hover:bg-slate-50', current === x.leadId && 'bg-blue-50')}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-slate-900">{x.name}</span>
                  {x.unread ? <StatusBadge tone="brand" size="sm">{x.unread}</StatusBadge> : null}
                </div>
                <p className="truncate text-xs text-slate-500">{x.lastDirection === 'inbound' ? '' : 'You: '}{x.lastMessage}</p>
                <p className="text-[11px] text-slate-500">{x.stageLabel} · {fmtDate(x.lastAt, true)}{x.optedOut ? ' · STOP' : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      {current ? <ConversationPane key={current} id={current} data={data} onChanged={() => { void reload(); onChanged(); }} /> : null}
    </div>
  );
}

function ConversationPane({ id, data, onChanged }: { id: string; data: LeadsData; onChanged: () => void }) {
  const { data: d, reload } = useApi<Detail>(`/api/marketing/leads/${id}`);
  useEffect(() => {
    void post(`/api/marketing/leads/${id}`, { action: 'read' }).then(onChanged).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!d) return <Card><CardBody><LoadingState rows={3} /></CardBody></Card>;
  return (
    <Card>
      <CardHeader title={`${d.lead.firstName} ${d.lead.lastName}`} description={`${d.lead.stageLabel} · ${d.lead.phone ?? d.lead.email ?? ''}`} icon={<Phone className="h-4 w-4" aria-hidden />} />
      <CardBody className="space-y-3">
        <Thread messages={d.messages} />
        {d.lead.stage !== 'converted' ? <Composer leadId={id} lead={d.lead} templates={data.templates} aiOn={data.aiSuggestions} onSent={() => { void reload(); onChanged(); }} /> : <Alert tone="info">Converted to client: continue in the client chart.</Alert>}
      </CardBody>
    </Card>
  );
}

function TaskList({ onOpenLead }: { onOpenLead: (id: string) => void }) {
  const now = useNow();
  const [mine, setMine] = useState(false);
  const { data, error, loading, reload } = useApi<{ tasks: { id: string; title: string; dueAt: string | null; leadId: string | null; leadName: string | null; source: string }[] }>(`/api/marketing/leads/tasks${mine ? '?mine=1' : ''}`);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  const tasks = data?.tasks ?? [];
  const nowMs = now;
  return (
    <Card>
      <CardHeader title="Open follow-up tasks" actions={<Checkbox label="Mine only" checked={mine} onChange={setMine} />} />
      {!tasks.length ? (
        <EmptyState icon={<CheckCircle2 aria-hidden />} title="No open tasks" description="Tasks from automations and staff appear here." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {tasks.map((t) => {
            const overdue = t.dueAt && new Date(t.dueAt).getTime() < nowMs;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-slate-900">{t.title}</p>
                  <p className="text-xs text-slate-500">
                    {t.leadName ? <button type="button" className="text-blue-700 hover:underline" onClick={() => t.leadId && onOpenLead(t.leadId)}>{t.leadName}</button> : 'No lead'}
                    {t.dueAt ? ` · due ${fmtDate(t.dueAt, true)}` : ''}
                    {t.source === 'automation' ? ' · automation' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {overdue ? <StatusBadge tone="danger" size="sm">Overdue</StatusBadge> : null}
                  <Button size="sm" variant="secondary" onClick={async () => { await post('/api/marketing/leads/tasks', { id: t.id, done: true }, 'PATCH'); await reload(); }}>Done</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
