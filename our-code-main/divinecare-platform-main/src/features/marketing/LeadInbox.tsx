'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import {
  LEAD_SOURCES,
  LEAD_STAGES,
  LEAD_VIEWS,
  MARKETING_EMPTIES,
  OPEN_LEAD_STAGES,
  type LeadSource,
  type LeadStage,
} from '@/lib/marketing/constants';
import type { MarketingLead } from '@/lib/marketing/manage';

type View = (typeof LEAD_VIEWS)[number];

export default function LeadInbox() {
  const [view, setView] = useState<View>('Pipeline');
  const [leads, setLeads] = useState<MarketingLead[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', email: '', source: 'Phone call' as LeadSource });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<'Messages' | 'Contact & consent' | 'Activity & tasks' | 'Convert to client'>('Messages');
  const selected = useMemo(() => leads.find((l) => l.id === selectedId) || null, [leads, selectedId]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/marketing/leads?includeClosed=${showClosed ? '1' : '0'}`, {
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not load leads');
        return;
      }
      setLeads(Array.isArray(data.leads) ? data.leads : []);
    } finally {
      setLoading(false);
    }
  }, [showClosed]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = useMemo(() => leads.filter((l) => l.stage === 'New').length, [leads]);

  async function createLead(kind: 'new' | 'missed') {
    const name = kind === 'missed' ? form.name.trim() || 'Missed call' : form.name.trim();
    if (!name) {
      setError('Name is required');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/marketing/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: form.phone,
          email: form.email,
          source: kind === 'missed' ? 'Phone call' : form.source,
          notes: kind === 'missed' ? 'Missed call' : '',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not create lead');
        return;
      }
      setForm({ name: '', phone: '', email: '', source: 'Phone call' });
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function patchLead(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/marketing/leads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) await load();
  }

  async function setStage(id: string, stage: LeadStage) {
    await patchLead(id, { stage });
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <PageHeader
        title="Lead inbox"
        description="Capture, screen, and convert leads without putting PHI in ads."
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => void createLead('missed')} loading={creating}>
              Missed call
            </Button>
            <Button size="sm" onClick={() => void createLead('new')} loading={creating}>
              New lead
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowClosed((v) => !v)}>
              {showClosed ? 'Hide closed' : 'Show closed'}
            </Button>
            <Link href="/dashboard/marketing" className="text-sm font-semibold text-blue-600 hover:underline">
              ← Marketing hub
            </Link>
          </>
        }
      />

      {waiting > 0 ? (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="status">
          {waiting} lead(s) waiting for a first response
        </div>
      ) : null}

      {error ? <p className="mb-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {LEAD_VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
              view === v ? 'bg-blue-600 text-white shadow-xs' : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <Card className="mb-4">
        <CardHeader title="New lead" description="Sources stay marketing-safe — no clinical details" />
        <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm font-medium text-slate-700">
            Name *
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Phone
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Email
            <input
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </label>
          <label className="text-sm font-medium text-slate-700">
            Source
            <select
              className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-xs focus:border-blue-600 focus:ring-2 focus:ring-blue-600/20"
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value as LeadSource }))}
            >
              {LEAD_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
        </CardBody>
      </Card>

      {view === 'Conversations' ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">{MARKETING_EMPTIES.noConversations}</p>
          </CardBody>
        </Card>
      ) : null}

      {view === 'Tasks' ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">{MARKETING_EMPTIES.noOpenTasks}</p>
          </CardBody>
        </Card>
      ) : null}

      {(view === 'Pipeline' || view === 'List') && (
        <>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : leads.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-slate-500">
                  {showClosed ? MARKETING_EMPTIES.noLeadsMatch : MARKETING_EMPTIES.noOpenLeads}
                </p>
              </CardBody>
            </Card>
          ) : view === 'Pipeline' ? (
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              {OPEN_LEAD_STAGES.map((stage) => {
                const col = leads.filter((l) => l.stage === stage);
                return (
                  <div key={stage} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{stage}</p>
                    <ul className="mt-2 space-y-2">
                      {col.map((lead) => (
                        <li
                          key={lead.id}
                          className="cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-xs"
                          onClick={() => setSelectedId(lead.id)}
                        >
                          <p className="text-sm font-semibold text-slate-900">{lead.name}</p>
                          <p className="text-xs text-slate-500">{lead.source}</p>
                          <select
                            className="mt-2 w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            value={lead.stage}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => void setStage(lead.id, e.target.value as LeadStage)}
                          >
                            {LEAD_STAGES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : (
            <Card>
              <CardBody className="overflow-x-auto p-0">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Name</th>
                      <th className="px-5 py-3 font-medium">Stage</th>
                      <th className="px-5 py-3 font-medium">Source</th>
                      <th className="px-5 py-3 font-medium">Contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id} className="border-b border-slate-100">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          <button type="button" className="text-left font-medium text-blue-700 hover:underline" onClick={() => setSelectedId(lead.id)}>
                            {lead.name}
                          </button>
                        </td>
                        <td className="px-5 py-3">
                          <select
                            className="rounded-lg border border-slate-300 px-2 py-1 text-xs"
                            value={lead.stage}
                            onChange={(e) => void setStage(lead.id, e.target.value as LeadStage)}
                          >
                            {LEAD_STAGES.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{lead.source}</td>
                        <td className="px-5 py-3 text-slate-600">
                          {[lead.phone, lead.email].filter(Boolean).join(' · ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {selected ? (
        <Card className="mt-4">
          <CardHeader
            title={selected.name}
            description={`${selected.stage} · ${selected.source}`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
                Close
              </Button>
            }
          />
          <CardBody>
            <div className="mb-3 flex flex-wrap gap-2">
              {(['Messages', 'Contact & consent', 'Activity & tasks', 'Convert to client'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDetailTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
                    detailTab === t ? 'bg-blue-600 text-white' : 'border border-slate-300 bg-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            {detailTab === 'Messages' ? (
              <div className="space-y-2">
                {(selected.messages || []).length === 0 ? (
                  <p className="text-sm text-slate-500">{MARKETING_EMPTIES.noConversations}</p>
                ) : (
                  <ul className="text-sm">
                    {selected.messages.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    void patchLead(selected.id, {
                      messages: [...(selected.messages || []), `Staff note ${new Date().toLocaleString()}`],
                    })
                  }
                >
                  Add message
                </Button>
              </div>
            ) : null}
            {detailTab === 'Contact & consent' ? (
              <div className="space-y-2 text-sm">
                <p>Phone: {selected.phone || '—'}</p>
                <p>Email: {selected.email || '—'}</p>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={Boolean(selected.consentSms)}
                    onChange={(e) => void patchLead(selected.id, { consentSms: e.target.checked })}
                  />
                  SMS consent (TCPA)
                </label>
              </div>
            ) : null}
            {detailTab === 'Activity & tasks' ? (
              <div className="space-y-2">
                {(selected.tasks || []).length === 0 ? (
                  <p className="text-sm text-slate-500">{MARKETING_EMPTIES.noOpenTasks}</p>
                ) : (
                  <ul className="text-sm">
                    {selected.tasks.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    void patchLead(selected.id, {
                      tasks: [...(selected.tasks || []), 'Follow up'],
                    })
                  }
                >
                  Add task
                </Button>
              </div>
            ) : null}
            {detailTab === 'Convert to client' ? (
              <div className="space-y-2">
                <Button size="sm" onClick={() => void setStage(selected.id, 'Converted to client')}>
                  Converted to client
                </Button>
                <Button size="sm" variant="secondary" onClick={() => void setStage(selected.id, 'Not a fit')}>
                  Not a fit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void setStage(selected.id, 'Lost')}>
                  Lost
                </Button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
