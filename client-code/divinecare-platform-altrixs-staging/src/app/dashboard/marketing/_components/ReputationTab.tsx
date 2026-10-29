'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { MessageSquareQuote, Plus, ShieldCheck, Sparkles, Star } from 'lucide-react';
import { Alert, Button, Card, CardBody, CardHeader, EmptyState, ErrorState, FormField, LoadingState, Modal, StatusBadge } from '@/components/ui';
import { Select, TextArea, TextInput, fmtDate, post, useApi } from './shared';

type Review = { id: string; source: string; locationName: string | null; rating: number; authorName: string | null; body: string; reviewedAt: string; responseDraft: string | null; responseStatus: string };
type Testimonial = { id: string; quote: string; displayName: string; status: string; authorizationSignedAt: string | null; authorizationExpiresAt: string | null; authorizationRevokedAt: string | null; hasClientLink: boolean; usable: boolean };
type Data = { reviews: Review[]; averageRating: number | null; trend: { month: string; count: number; average: number | null }[]; testimonials: Testimonial[]; sources: string[] };

function Stars({ n }: { n: number }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} aria-hidden className={`h-3.5 w-3.5 ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} />)}
    </span>
  );
}

export function ReputationTab() {
  const { data, error, loading, reload } = useApi<Data>('/api/marketing/reviews');
  const [adding, setAdding] = useState(false);
  const [addingT, setAddingT] = useState(false);
  const [filter, setFilter] = useState<'all' | 'needs' | 'low'>('needs');
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const list = data.reviews.filter((r) => (filter === 'needs' ? r.responseStatus !== 'posted' : filter === 'low' ? r.rating <= 3 : true));
  return (
    <div className="space-y-6">
      <Alert tone="warning" title="HIPAA rule for review replies" icon={<ShieldCheck aria-hidden />}>
        Never confirm that a reviewer is or was a patient, and never mention visits, providers, conditions, dates or their name, even if they did. Every reply is checked before it can be saved, approved or posted. Post approved replies on the review site by hand until Google Business Profile is connected.
      </Alert>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardBody><p className="text-sm text-slate-500">Average rating</p><p className="text-2xl font-semibold tabular-nums text-slate-900">{data.averageRating ?? '—'}</p></CardBody></Card>
        <Card><CardBody><p className="text-sm text-slate-500">Reviews on file</p><p className="text-2xl font-semibold tabular-nums text-slate-900">{data.reviews.length}</p></CardBody></Card>
        <Card><CardBody><p className="text-sm text-slate-500">Last 6 months</p><p className="text-sm text-slate-700">{data.trend.map((t) => `${t.month.slice(5)}: ${t.average ?? '—'}`).join(' · ')}</p></CardBody></Card>
      </div>
      <Card>
        <CardHeader
          title="Review inbox"
          actions={
            <div className="flex flex-wrap gap-2">
              <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} aria-label="Filter reviews" className="w-full sm:w-44">
                <option value="needs">Needs a reply</option>
                <option value="low">1-3 stars</option>
                <option value="all">All</option>
              </Select>
              <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAdding(true)}>Add review</Button>
            </div>
          }
        />
        {!list.length ? (
          <EmptyState icon={<Star aria-hidden />} title="No reviews here" description="Add reviews from Google, Facebook or listing sites by hand. They will import automatically once Google Business Profile is connected." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((r) => <ReviewRow key={r.id} review={r} onChanged={reload} />)}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="Testimonial library" description="Usable only while a signed authorization is on file. Client testimonials need the testimonial authorization from the consent library." icon={<MessageSquareQuote className="h-4 w-4" aria-hidden />} actions={<Button size="sm" variant="secondary" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setAddingT(true)}>Add testimonial</Button>} />
        {!data.testimonials.length ? (
          <EmptyState title="No testimonials" description="Add a testimonial with its signed authorization." />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.testimonials.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0 max-w-2xl">
                  <p className="text-sm text-slate-800">&ldquo;{t.quote}&rdquo;</p>
                  <p className="text-xs text-slate-500">{t.displayName} · authorization {t.authorizationSignedAt ? `signed ${fmtDate(t.authorizationSignedAt)}` : 'missing'}{t.authorizationExpiresAt ? `, expires ${fmtDate(t.authorizationExpiresAt)}` : ''}{t.authorizationRevokedAt ? ', revoked' : ''}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge tone={t.usable ? 'success' : t.status === 'retired' ? 'neutral' : 'warning'} size="sm">{t.usable ? 'Usable' : t.status === 'approved' ? 'Authorization not current' : t.status}</StatusBadge>
                  {t.status === 'pending' ? <Button size="sm" variant="secondary" onClick={async () => { try { await post('/api/marketing/testimonials', { id: t.id, action: 'approve' }, 'PATCH'); await reload(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not approve'); } }}>Approve</Button> : null}
                  {t.status !== 'retired' ? <Button size="sm" variant="ghost" onClick={async () => { await post('/api/marketing/testimonials', { id: t.id, action: 'retire' }, 'PATCH'); await reload(); }}>Retire</Button> : null}
                  {!t.authorizationRevokedAt ? <Button size="sm" variant="ghost" onClick={async () => { if (window.confirm('Record that the person revoked their authorization? The testimonial is retired everywhere.')) { await post('/api/marketing/testimonials', { id: t.id, action: 'revoke' }, 'PATCH'); await reload(); } }}>Revoked</Button> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Alert tone="info" title="Asking for reviews">Send review requests from Campaigns to event attendees, partners and newsletter subscribers who opted in, or to clients only with a signed marketing authorization. Never ask a client for a review by text from the clinical system.</Alert>
      {adding ? <AddReview sources={data.sources} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} /> : null}
      {addingT ? <AddTestimonial onClose={() => setAddingT(false)} onSaved={() => { setAddingT(false); void reload(); }} /> : null}
    </div>
  );
}

function ReviewRow({ review, onChanged }: { review: Review; onChanged: () => void }) {
  const [text, setText] = useState(review.responseDraft ?? '');
  const [issue, setIssue] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const draft = async () => {
    setBusy('draft');
    try {
      const r = await post<{ success: true; draft: { data: { reply: string }; engine: string; notes: string[] } }>(`/api/marketing/reviews/${review.id}`, {});
      setText(r.draft.data.reply);
      setIssue(r.draft.notes[0] ?? null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not draft');
    } finally {
      setBusy(null);
    }
  };
  const act = async (action: 'save' | 'approve' | 'posted') => {
    setBusy(action);
    setIssue(null);
    try {
      await post(`/api/marketing/reviews/${review.id}`, { action, text }, 'PATCH');
      toast.success(action === 'posted' ? 'Marked as posted' : action === 'approve' ? 'Reply approved' : 'Saved');
      onChanged();
    } catch (e) {
      setIssue(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };
  return (
    <li className="space-y-2 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Stars n={review.rating} />
        <span className="text-sm font-medium text-slate-900">{review.authorName ?? 'Anonymous'}</span>
        <span className="text-xs text-slate-500">{review.source}{review.locationName ? ` · ${review.locationName}` : ''} · {fmtDate(review.reviewedAt)}</span>
        <StatusBadge size="sm" tone={review.responseStatus === 'posted' ? 'success' : review.responseStatus === 'approved' ? 'info' : 'warning'}>{review.responseStatus === 'none' ? 'No reply' : review.responseStatus}</StatusBadge>
      </div>
      {review.body ? <p className="whitespace-pre-wrap text-sm text-slate-700">{review.body}</p> : null}
      {review.responseStatus !== 'posted' ? (
        <div className="space-y-2 rounded-lg bg-slate-50 p-3">
          <TextArea rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" placeholder="Draft a reply, or use Draft safe reply" />
          {issue ? <Alert tone="danger">{issue}</Alert> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant="secondary" loading={busy === 'draft'} icon={<Sparkles className="h-4 w-4" aria-hidden />} onClick={draft}>Draft safe reply</Button>
            <Button size="sm" variant="secondary" loading={busy === 'save'} disabled={!text.trim()} onClick={() => act('save')}>Save</Button>
            {review.responseStatus === 'approved' ? (
              <Button size="sm" loading={busy === 'posted'} onClick={() => act('posted')}>Mark posted</Button>
            ) : (
              <Button size="sm" loading={busy === 'approve'} disabled={!text.trim()} onClick={() => act('approve')}>Approve reply</Button>
            )}
          </div>
        </div>
      ) : (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">Reply: {review.responseDraft}</p>
      )}
    </li>
  );
}

function AddReview({ sources, onClose, onSaved }: { sources: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ source: sources[0] ?? 'Google Business Profile', rating: '5', authorName: '', body: '', reviewedAt: new Date().toISOString().slice(0, 10), locationName: '' });
  return (
    <Modal title="Add a review" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => { try { await post('/api/marketing/reviews', { ...f, rating: Number(f.rating), reviewedAt: f.reviewedAt ? new Date(f.reviewedAt).toISOString() : null }); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); } }}>Add review</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Source"><Select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>{sources.map((s) => <option key={s}>{s}</option>)}</Select></FormField>
        <FormField label="Rating"><Select value={f.rating} onChange={(e) => setF({ ...f, rating: e.target.value })}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} stars</option>)}</Select></FormField>
        <FormField label="Reviewer (as shown publicly)"><TextInput value={f.authorName} onChange={(e) => setF({ ...f, authorName: e.target.value })} /></FormField>
        <FormField label="Date"><TextInput type="date" value={f.reviewedAt} onChange={(e) => setF({ ...f, reviewedAt: e.target.value })} /></FormField>
        <FormField label="Location (practice site)"><TextInput value={f.locationName} onChange={(e) => setF({ ...f, locationName: e.target.value })} /></FormField>
        <FormField label="Review text" className="sm:col-span-2"><TextArea rows={4} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function AddTestimonial({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ quote: '', displayName: '', isClient: false, clientId: '', authorizationSignedAt: '', authorizationExpiresAt: '', authorizationRef: '' });
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [q, setQ] = useState('');
  const search = async () => {
    try {
      const r = await fetch(`/api/clients?q=${encodeURIComponent(q)}&limit=10`).then((x) => x.json());
      setClients((r.clients ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })));
    } catch {
      setClients([]);
    }
  };
  return (
    <Modal title="Add testimonial" size="lg" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={async () => {
      try {
        await post('/api/marketing/testimonials', {
          quote: f.quote,
          displayName: f.displayName,
          clientId: f.isClient ? f.clientId || null : null,
          authorizationSignedAt: !f.isClient && f.authorizationSignedAt ? new Date(f.authorizationSignedAt).toISOString() : null,
          authorizationExpiresAt: !f.isClient && f.authorizationExpiresAt ? new Date(f.authorizationExpiresAt).toISOString() : null,
          authorizationRef: f.authorizationRef || null,
        });
        onSaved();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not save');
      }
    }}>Save</Button></>}>
      <div className="space-y-3">
        <FormField label="Quote" required><TextArea rows={3} value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} /></FormField>
        <FormField label="Display name" hint='How it will appear, e.g. "Community partner" or "A. M., Bowie"' required><TextInput value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} /></FormField>
        <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={f.isClient} onChange={(e) => setF({ ...f, isClient: e.target.checked })} /> This person is a client (uses the signed testimonial authorization from Consents)</label>
        {f.isClient ? (
          <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <div className="flex gap-2"><TextInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client" aria-label="Search client" /><Button variant="secondary" onClick={search}>Search</Button></div>
            <Select value={f.clientId} onChange={(e) => setF({ ...f, clientId: e.target.value })} aria-label="Client">
              <option value="">Choose client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
            <p className="text-xs text-slate-500">Saving fails unless the client has signed the testimonial authorization. Nothing from the chart is shown here.</p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            <FormField label="Release signed on" required><TextInput type="date" value={f.authorizationSignedAt} onChange={(e) => setF({ ...f, authorizationSignedAt: e.target.value })} /></FormField>
            <FormField label="Expires"><TextInput type="date" value={f.authorizationExpiresAt} onChange={(e) => setF({ ...f, authorizationExpiresAt: e.target.value })} /></FormField>
            <FormField label="Where the signed release is kept"><TextInput value={f.authorizationRef} onChange={(e) => setF({ ...f, authorizationRef: e.target.value })} /></FormField>
          </div>
        )}
      </div>
    </Modal>
  );
}
