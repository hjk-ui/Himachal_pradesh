'use client';

import { useState } from 'react';
import toast from 'react-hot-toast';
import { CalendarDays, Copy, Handshake, Plus } from 'lucide-react';
import { Alert, Button, Card, CardHeader, EmptyState, ErrorState, FormField, LoadingState, Modal, StatusBadge } from '@/components/ui';
import { partnerTypeLabel } from '@/lib/marketing/constants';
import { Checkbox, Select, TextArea, TextInput, fmtDate, money, post, useApi, useNow } from './shared';

type Partner = { id: string; name: string; category: string; partnerType: string | null; ownerUserId: string | null; ownerName: string | null; contactName: string | null; contactEmail: string | null; contactPhone: string | null; status: string; lastTouchAt: string | null; notes: string; referralLeads: number; touches: { id: string; kind: string; summary: string; touchedAt: string; actorName: string | null }[] };
type PData = { partners: Partner[]; owners: { id: string; name: string }[]; partnerTypes: { key: string; label: string }[]; touchKinds: string[] };
type Ev = { id: string; title: string; eventType: string; status: string; startsAt: string; locationName: string; registrationSlug: string | null; registrationOpen: boolean; registrations: number; attended: number; costCents: number; leads: number; publicUrl: string | null };
type Reg = { id: string; name: string; email: string | null; phone: string | null; emailConsent: boolean; smsConsent: boolean; attended: boolean };

export function PartnersTab() {
  return (
    <div className="space-y-6">
      <Partners />
      <Events />
    </div>
  );
}

function Partners() {
  const { data, error, loading, reload } = useApi<PData>('/api/marketing/partners');
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [touch, setTouch] = useState<Partner | null>(null);
  const now = useNow(60000);
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={4} />;
  if (!data) return null;
  const sixty = now - 60 * 24 * 3600000;
  return (
    <Card>
      <CardHeader title="Referral partners" description="Schools, hospitals, PCPs, courts, faith and community organizations. Referral volume is a count only; no client information is stored here." icon={<Handshake className="h-4 w-4" aria-hidden />} actions={<Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setEditing('new')}>Add partner</Button>} />
      {!data.partners.length ? (
        <EmptyState title="No partners yet" description="Add the organizations that refer to you and log every touchpoint." />
      ) : (
        <div className="clinic-scroll-x overflow-x-auto">
          <table className="w-full min-w-[900px] divide-y divide-slate-100 text-sm">
            <thead className="bg-slate-50"><tr>{['Partner', 'Type', 'Owner', 'Contact', 'Status', 'Last touch', 'Referred leads', ''].map((h, i) => <th key={h} scope="col" className={`px-4 py-2 text-left text-xs font-semibold text-slate-600${i === 0 ? ' sticky left-0 z-10 bg-slate-50' : ''}`}>{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.partners.map((p) => (
                <tr key={p.id} className="group hover:bg-slate-50">
                  <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-slate-900 group-hover:bg-slate-50">{p.name}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.partnerType ? partnerTypeLabel(p.partnerType) : p.category}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.ownerName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-700">{p.contactName ?? '—'}</td>
                  <td className="px-4 py-2.5"><StatusBadge size="sm" tone={p.status === 'active' ? 'success' : p.status === 'prospect' ? 'info' : 'neutral'}>{p.status}</StatusBadge></td>
                  <td className="px-4 py-2.5">{p.lastTouchAt ? fmtDate(p.lastTouchAt) : '—'} {!p.lastTouchAt || new Date(p.lastTouchAt).getTime() < sixty ? <StatusBadge size="sm" tone="warning">Due</StatusBadge> : null}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{p.referralLeads}</td>
                  <td className="px-4 py-2.5 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="secondary" onClick={() => setTouch(p)}>Log touch</Button><Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <PartnerEditor data={data} partner={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload(); }} /> : null}
      {touch ? <TouchModal partner={touch} kinds={data.touchKinds} onClose={() => setTouch(null)} onSaved={() => { setTouch(null); void reload(); }} /> : null}
    </Card>
  );
}

function PartnerEditor({ data, partner, onClose, onSaved }: { data: PData; partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ name: partner?.name ?? '', partnerType: partner?.partnerType ?? 'community_org', ownerUserId: partner?.ownerUserId ?? '', contactName: partner?.contactName ?? '', contactEmail: partner?.contactEmail ?? '', contactPhone: partner?.contactPhone ?? '', status: partner?.status ?? 'active', notes: partner?.notes ?? '' });
  return (
    <Modal title={partner ? 'Edit partner' : 'Add partner'} size="lg" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={f.name.trim().length < 2} onClick={async () => {
      try {
        await post('/api/marketing/partners', { action: 'save', id: partner?.id, ...f, ownerUserId: f.ownerUserId || null, category: partner?.category ?? partnerTypeLabel(f.partnerType) });
        onSaved();
      } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    }}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Organization" required><TextInput value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></FormField>
        <FormField label="Type"><Select value={f.partnerType} onChange={(e) => setF({ ...f, partnerType: e.target.value })}>{data.partnerTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select></FormField>
        <FormField label="Relationship owner"><Select value={f.ownerUserId} onChange={(e) => setF({ ...f, ownerUserId: e.target.value })}><option value="">None</option>{data.owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></FormField>
        <FormField label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">Active</option><option value="prospect">Prospect</option><option value="inactive">Inactive</option></Select></FormField>
        <FormField label="Contact name"><TextInput value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></FormField>
        <FormField label="Contact email"><TextInput value={f.contactEmail} onChange={(e) => setF({ ...f, contactEmail: e.target.value })} /></FormField>
        <FormField label="Contact phone"><TextInput value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} /></FormField>
        <FormField label="Notes" hint="Relationship notes only. Never client information." className="sm:col-span-2"><TextArea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></FormField>
      </div>
      {partner?.touches.length ? (
        <div className="mt-4"><h3 className="text-sm font-semibold text-slate-900">Recent touches</h3><ul className="mt-1 space-y-1 text-sm text-slate-700">{partner.touches.map((t) => <li key={t.id}>{fmtDate(t.touchedAt)} · {t.kind}: {t.summary}{t.actorName ? ` (${t.actorName})` : ''}</li>)}</ul></div>
      ) : null}
    </Modal>
  );
}

function TouchModal({ partner, kinds, onClose, onSaved }: { partner: Partner; kinds: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ kind: kinds[0] ?? 'Visit', summary: '', touchedAt: new Date().toISOString().slice(0, 10) });
  return (
    <Modal title={`Log touch: ${partner.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={f.summary.trim().length < 2} onClick={async () => {
      try { await post('/api/marketing/partners', { action: 'touch', partnerId: partner.id, ...f, touchedAt: new Date(f.touchedAt).toISOString() }); onSaved(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not save'); }
    }}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Type"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{kinds.map((k) => <option key={k}>{k}</option>)}</Select></FormField>
        <FormField label="Date"><TextInput type="date" value={f.touchedAt} onChange={(e) => setF({ ...f, touchedAt: e.target.value })} /></FormField>
        <FormField label="Summary" hint="No client names or details." className="sm:col-span-2"><TextArea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></FormField>
      </div>
    </Modal>
  );
}

function Events() {
  const [open, setOpen] = useState<Ev | null>(null);
  const now = useNow(60000);
  const { data, error, loading, reload } = useApi<{ events: Ev[]; registrations: Reg[] }>('/api/marketing/events');
  if (error) return <ErrorState description={error} onRetry={reload} />;
  if (loading && !data) return <LoadingState rows={3} />;
  if (!data) return null;
  const update = async (id: string, body: Record<string, unknown>) => {
    try {
      await post('/api/marketing/events', { action: 'update', id, ...body });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update');
    }
  };
  const upcoming = data.events.filter((e) => new Date(e.startsAt).getTime() >= now - 24 * 3600000).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  return (
    <Card>
      <CardHeader title="Events, registration and outreach calendar" description="Create events in Events & Outreach; open public registration here and track attendance and cost." icon={<CalendarDays className="h-4 w-4" aria-hidden />} />
      {!data.events.length ? (
        <EmptyState title="No events" description="Add community events from Events & Outreach." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {(upcoming.length ? upcoming : data.events.slice(0, 10)).map((e) => (
            <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-slate-900">{e.title}</p>
                <p className="text-xs text-slate-500">{fmtDate(e.startsAt, true)} · {e.locationName} · {e.registrations} registered · {e.attended} attended · {e.leads} leads · cost {money(e.costCents)}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox label="Registration open" checked={e.registrationOpen} onChange={(v) => update(e.id, { registrationOpen: v })} />
                {e.publicUrl && e.registrationOpen ? <Button size="sm" variant="secondary" icon={<Copy className="h-4 w-4" aria-hidden />} onClick={async () => { await navigator.clipboard.writeText(e.publicUrl!); toast.success('Registration link copied'); }}>Copy link</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => { const v = window.prompt('Event cost in USD (for ROI)', String(e.costCents / 100)); if (v != null && !Number.isNaN(Number(v))) void update(e.id, { costCents: Math.round(Number(v) * 100) }); }}>Cost</Button>
                <Button size="sm" variant="secondary" onClick={() => setOpen(e)}>Attendance</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open ? <Attendance ev={open} onClose={() => { setOpen(null); void reload(); }} /> : null}
    </Card>
  );
}

function Attendance({ ev, onClose }: { ev: Ev; onClose: () => void }) {
  const { data, reload } = useApi<{ registrations: Reg[] }>(`/api/marketing/events?eventId=${ev.id}`);
  const regs = data?.registrations ?? [];
  return (
    <Modal title={`Attendance: ${ev.title}`} size="lg" onClose={onClose}>
      <Alert tone="info">Marking attendance can start the review-request recipe for attendees who opted in to email.</Alert>
      <ul className="mt-3 divide-y divide-slate-100">
        {regs.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <span className="text-slate-800">{r.name} <span className="text-xs text-slate-500">{r.email ?? r.phone ?? ''}{r.emailConsent ? ' · email opt-in' : ''}{r.smsConsent ? ' · text opt-in' : ''}</span></span>
            <Checkbox label="Attended" checked={r.attended} onChange={async (v) => { await post('/api/marketing/events', { action: 'attendance', registrationId: r.id, attended: v }); await reload(); }} />
          </li>
        ))}
        {!regs.length ? <li className="py-6 text-center text-sm text-slate-500">No registrations yet.</li> : null}
      </ul>
    </Modal>
  );
}
