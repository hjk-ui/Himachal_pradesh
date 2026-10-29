'use client';

import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Copy, Download, FileText, Megaphone, Plus, Sparkles } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, ErrorState, FormField, IconButton, LoadingState, Modal, StatusBadge, Tabs, buttonClasses } from '@/components/ui';
import { Checkbox, DraftNotice, TextArea, TextInput, fmtDate, post, useApi } from './shared';

type Post = { id: string; channels: string[]; content: string; hashtags: string[]; imagePrompt: string | null; status: string; scheduledAt: string | null; reviewNote: string | null; campaignTag: string | null };
type Data = { posts: Post[]; legacy: { id: string; channels: string[]; content: string; status: string; scheduledAt: string | null }[]; channels: string[] };

const NEXT: Record<string, { to: string; label: string }[]> = {
  draft: [{ to: 'review', label: 'Submit for review' }],
  review: [{ to: 'approved', label: 'Approve' }, { to: 'draft', label: 'Send back' }],
  approved: [{ to: 'scheduled', label: 'Schedule' }, { to: 'exported', label: 'Mark exported' }, { to: 'posted', label: 'Mark posted' }],
  scheduled: [{ to: 'posted', label: 'Mark posted' }, { to: 'exported', label: 'Mark exported' }],
  exported: [{ to: 'posted', label: 'Mark posted' }],
  posted: [],
};

export function SocialTab() {
  const [view, setView] = useState<'planner' | 'content'>('planner');
  return (
    <div className="space-y-4">
      <Tabs variant="pill" label="Social views" controlsPanels={false} value={view} onChange={setView} items={[{ key: 'planner', label: 'Social planner' }, { key: 'content', label: 'Press & page copy' }]} />
      {view === 'planner' ? <Planner /> : <ContentTools />}
    </div>
  );
}

function Planner() {
  const { data, error, loading, reload } = useApi<Data>('/api/marketing/social');
  const [editing, setEditing] = useState<Post | 'new' | null>(null);
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const days = useMemo(() => {
    const first = new Date(month);
    const start = new Date(first);
    start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [month]);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={6} />;
  if (!data) return null;
  const all = [...data.posts.map((p) => ({ ...p, legacy: false })), ...data.legacy.map((p) => ({ ...p, hashtags: [], imagePrompt: null, reviewNote: null, campaignTag: null, legacy: true }))];
  const onDay = (d: Date) => all.filter((p) => p.scheduledAt && new Date(p.scheduledAt).toDateString() === d.toDateString());
  const move = async (id: string, to: string) => {
    try {
      await post('/api/marketing/social', { action: 'move', id, to });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };
  const queue = data.posts.filter((p) => p.status !== 'posted');
  return (
    <div className="space-y-4">
      <Alert tone="info">Posting is manual until Meta / Google Business Profile are connected: approved posts are scheduled here, then copied or exported (CSV) and posted by hand. Never post client photos, stories or identifiable details without a signed authorization.</Alert>
      <div className="flex flex-wrap justify-end gap-2">
        <a href="/api/marketing/social?format=csv" className={buttonClasses({ variant: 'secondary' })}><Download className="h-4 w-4" aria-hidden /> Export approved (CSV)</a>
        <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>New post</Button>
      </div>
      <Card>
        <CardHeader
          title={month.toLocaleString('en-US', { month: 'long', year: 'numeric' })}
          actions={<div className="flex gap-1"><IconButton label="Previous month" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} /><IconButton label="Next month" icon={<ChevronRight className="h-4 w-4" />} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} /></div>}
        />
        <div className="clinic-scroll-x overflow-x-auto">
          <div className="grid min-w-[700px] grid-cols-7 border-t border-slate-100">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <div key={d} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{d}</div>)}
            {days.map((d) => (
              <div key={d.toISOString()} className={`min-h-[88px] border-t border-slate-100 p-1.5 ${d.getMonth() !== month.getMonth() ? 'bg-slate-50/60' : ''}`}>
                <p className="text-xs text-slate-500">{d.getDate()}</p>
                {onDay(d).map((p) => (
                  <button key={p.id} type="button" disabled={p.legacy} onClick={() => !p.legacy && setEditing(p as Post)} className="mt-1 block w-full truncate rounded bg-blue-50 px-1.5 py-0.5 text-left text-[11px] text-blue-800 ring-1 ring-blue-200 disabled:bg-slate-100 disabled:text-slate-600 disabled:ring-slate-200">
                    {p.channels.join(', ')}: {p.content}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      </Card>
      <Card>
        <CardHeader title="Approval queue" description="Draft, review, approved, scheduled, exported or posted. Editing a post sends it back to draft." />
        <ul className="divide-y divide-slate-100">
          {queue.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0 max-w-2xl">
                <p className="text-sm text-slate-800">{p.content}</p>
                <p className="text-xs text-slate-500">{p.channels.join(', ')} · {p.scheduledAt ? fmtDate(p.scheduledAt, true) : 'No date'} {p.hashtags.length ? `· ${p.hashtags.join(' ')}` : ''}</p>
                {p.reviewNote ? <p className="text-xs text-amber-800">Reviewer note: {p.reviewNote}</p> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge size="sm" tone={p.status === 'approved' || p.status === 'scheduled' ? 'info' : p.status === 'review' ? 'warning' : 'neutral'}>{p.status}</StatusBadge>
                <IconButton label="Copy text" icon={<Copy className="h-4 w-4" />} onClick={async () => { await navigator.clipboard.writeText(`${p.content}\n\n${p.hashtags.join(' ')}`.trim()); toast.success('Copied'); }} />
                {p.status !== 'posted' ? <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button> : null}
                {(NEXT[p.status] ?? []).map((n) => <Button key={n.to} size="sm" variant={n.to === 'approved' ? 'primary' : 'secondary'} onClick={() => move(p.id, n.to)}>{n.label}</Button>)}
              </div>
            </li>
          ))}
          {!queue.length ? <li className="px-5 py-6 text-center text-sm text-slate-500">No posts in progress.</li> : null}
        </ul>
      </Card>
      {editing ? <PostEditor channels={data.channels} post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
    </div>
  );
}

function PostEditor({ channels, post: p, onClose, onSaved }: { channels: string[]; post: Post | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ channels: p?.channels ?? ['Facebook'], content: p?.content ?? '', hashtags: (p?.hashtags ?? []).join(' '), imagePrompt: p?.imagePrompt ?? '', scheduledAt: p?.scheduledAt ? p.scheduledAt.slice(0, 16) : '', campaignTag: p?.campaignTag ?? '' });
  const [topic, setTopic] = useState('');
  const [ai, setAi] = useState<{ engine: 'bedrock' | 'rules'; notes: string[]; imagePrompts: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const generate = async () => {
    setBusy(true);
    try {
      const r = await post<{ success: true; draft: { engine: 'bedrock' | 'rules'; notes: string[]; data: { caption: string; hashtags: string[]; imagePrompts: string[] } } }>('/api/marketing/ai', { feature: 'socialCaption', topic, channels: f.channels });
      setF({ ...f, content: r.draft.data.caption, hashtags: r.draft.data.hashtags.join(' '), imagePrompt: r.draft.data.imagePrompts[0] ?? f.imagePrompt });
      setAi({ engine: r.draft.engine, notes: r.draft.notes, imagePrompts: r.draft.data.imagePrompts });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not generate');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={p ? 'Edit post' : 'New post'} size="lg" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.content.trim() || !f.channels.length} onClick={async () => {
      try {
        await post('/api/marketing/social', { action: 'save', id: p?.id, channels: f.channels, content: f.content, hashtags: f.hashtags.split(/\s+/).filter(Boolean), imagePrompt: f.imagePrompt || null, scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : null, campaignTag: f.campaignTag || null });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save');
      }
    }}>Save draft</Button></>}>
      <div className="space-y-4">
        <fieldset><legend className="mb-1 text-sm font-medium text-slate-700">Channels</legend><div className="flex flex-wrap gap-3">{channels.map((c) => <Checkbox key={c} label={c} checked={f.channels.includes(c)} onChange={(v) => setF({ ...f, channels: v ? [...f.channels, c] : f.channels.filter((x) => x !== c) })} />)}</div></fieldset>
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <FormField label="AI caption and hashtags" hint="Describe the topic. No client stories or details."><TextInput value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="e.g. Free community wellness fair in Bowie on Saturday" /></FormField>
          <div className="flex justify-end"><Button size="sm" variant="secondary" loading={busy} disabled={topic.trim().length < 2} icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={generate}>Generate</Button></div>
          {ai ? <><DraftNotice engine={ai.engine} />{ai.notes.map((n) => <p key={n} className="text-xs text-amber-800">{n}</p>)}{ai.imagePrompts.length > 1 ? <p className="text-xs text-slate-600">Other image idea: {ai.imagePrompts[1]}</p> : null}</> : null}
        </div>
        <FormField label="Post text" required><TextArea rows={5} value={f.content} onChange={(e) => setF({ ...f, content: e.target.value })} /></FormField>
        <FormField label="Hashtags" hint="Space separated"><TextInput value={f.hashtags} onChange={(e) => setF({ ...f, hashtags: e.target.value })} /></FormField>
        <FormField label="Image prompt / idea"><TextInput value={f.imagePrompt} onChange={(e) => setF({ ...f, imagePrompt: e.target.value })} /></FormField>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Post date and time"><TextInput type="datetime-local" value={f.scheduledAt} onChange={(e) => setF({ ...f, scheduledAt: e.target.value })} /></FormField>
          <FormField label="Campaign tag"><TextInput value={f.campaignTag} onChange={(e) => setF({ ...f, campaignTag: e.target.value })} /></FormField>
        </div>
      </div>
    </Modal>
  );
}

function ContentTools() {
  const [pr, setPr] = useState({ headline: '', facts: '', quote: '', spokesperson: '', city: 'Bowie, Md.', contact: '' });
  const [prOut, setPrOut] = useState<{ body: string; engine: 'bedrock' | 'rules'; saved: boolean } | null>(null);
  const [lp, setLp] = useState({ service: '', location: '', audience: '' });
  const [lpOut, setLpOut] = useState<{ engine: 'bedrock' | 'rules'; data: { headline: string; subheadline: string; bullets: string[]; cta: string; adVariants: string[]; complianceNotes: string[] } } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const runPr = async (saveDraft: boolean) => {
    setBusy('pr');
    try {
      const r = await post<{ success: true; draft: { engine: 'bedrock' | 'rules'; data: { body: string } }; releaseId: string | null }>('/api/marketing/ai', { feature: 'pressRelease', ...pr, quote: pr.quote || undefined, spokesperson: pr.spokesperson || undefined, contact: pr.contact || undefined, saveDraft });
      setPrOut({ body: r.draft.data.body, engine: r.draft.engine, saved: Boolean(r.releaseId) });
      if (r.releaseId) toast.success('Saved as a draft press release in PR & Marketing');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Press release drafting" icon={<Megaphone className="h-4 w-4" aria-hidden />} description="Uses only the facts you enter. Saved drafts go to the press release review flow." />
        <CardBody className="space-y-3">
          <FormField label="Headline" required><TextInput value={pr.headline} onChange={(e) => setPr({ ...pr, headline: e.target.value })} /></FormField>
          <FormField label="Key facts" hint="Who, what, when, where, why. No client information." required><TextArea rows={4} value={pr.facts} onChange={(e) => setPr({ ...pr, facts: e.target.value })} /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Quote"><TextInput value={pr.quote} onChange={(e) => setPr({ ...pr, quote: e.target.value })} /></FormField>
            <FormField label="Quote by"><TextInput value={pr.spokesperson} onChange={(e) => setPr({ ...pr, spokesperson: e.target.value })} /></FormField>
            <FormField label="Dateline city"><TextInput value={pr.city} onChange={(e) => setPr({ ...pr, city: e.target.value })} /></FormField>
            <FormField label="Media contact"><TextInput value={pr.contact} onChange={(e) => setPr({ ...pr, contact: e.target.value })} /></FormField>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" loading={busy === 'pr'} disabled={pr.headline.length < 4 || pr.facts.length < 10} icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={() => runPr(false)}>Draft</Button>
            <Button loading={busy === 'pr'} disabled={pr.headline.length < 4 || pr.facts.length < 10} icon={<FileText className="h-4 w-4" aria-hidden />} onClick={() => runPr(true)}>Draft and save</Button>
          </div>
          {prOut ? <div className="space-y-2"><DraftNotice engine={prOut.engine} /><pre className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800">{prOut.body}</pre></div> : null}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Landing page and ad copy" icon={<Sparkles className="h-4 w-4" aria-hidden />} description="Drafts for your website and search ads." />
        <CardBody className="space-y-3">
          <FormField label="Service" required><TextInput value={lp.service} onChange={(e) => setLp({ ...lp, service: e.target.value })} placeholder="e.g. Child and adolescent therapy" /></FormField>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Location"><TextInput value={lp.location} onChange={(e) => setLp({ ...lp, location: e.target.value })} placeholder="Silver Spring, MD" /></FormField>
            <FormField label="Audience (general)"><TextInput value={lp.audience} onChange={(e) => setLp({ ...lp, audience: e.target.value })} placeholder="Parents and caregivers" /></FormField>
          </div>
          <div className="flex justify-end"><Button variant="secondary" loading={busy === 'lp'} disabled={lp.service.length < 2} icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={async () => {
            setBusy('lp');
            try {
              const r = await post<{ success: true; draft: NonNullable<typeof lpOut> }>('/api/marketing/ai', { feature: 'landingCopy', service: lp.service, location: lp.location || undefined, audience: lp.audience || undefined });
              setLpOut(r.draft);
            } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not draft'); } finally { setBusy(null); }
          }}>Draft copy</Button></div>
          {lpOut ? (
            <div className="space-y-2 text-sm text-slate-800">
              <DraftNotice engine={lpOut.engine} />
              <p className="text-base font-semibold">{lpOut.data.headline}</p>
              <p>{lpOut.data.subheadline}</p>
              <ul className="list-disc pl-5">{lpOut.data.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
              <p className="font-medium">Button: {lpOut.data.cta}</p>
              <p className="text-xs font-semibold text-slate-600">Ad variants</p>
              <ul className="list-disc pl-5">{lpOut.data.adVariants.map((b) => <li key={b}>{b}</li>)}</ul>
              <Alert tone="warning" title="Before publishing"><ul className="list-disc pl-4">{lpOut.data.complianceNotes.map((n) => <li key={n}>{n}</li>)}</ul></Alert>
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}
