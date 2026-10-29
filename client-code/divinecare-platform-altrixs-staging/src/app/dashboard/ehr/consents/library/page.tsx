'use client';

/**
 * Consent library: every consent / form template and version with its lifecycle status
 * (Draft → Approved → Active → Retired), review flags, the exact text, and the intake packet
 * selection + Notice of Privacy Practices settings. Approve / activate / retire: admin and
 * practice director only (recorded with who and when). Only Active versions can be sent.
 */
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, FileText, Info, Loader2, Upload } from 'lucide-react';
import { PageHeader, Panel, StatCard } from '@/components/clinic/ui';
import { ConsentBlocks } from '@/components/consents/ConsentPacketForm';
import type { LibraryVersionView } from '@/lib/consents/library/store';
import { REQUIREMENT_RULES } from '@/lib/consents/library/requirements';
import { MAX_REMINDERS, REMINDER_POLICY, VALIDITY_POLICY } from '@/lib/consents/library/decisions';
import { Alert } from '@/components/ui';

type LibraryResponse = {
  versions: LibraryVersionView[];
  keys: string[];
  selection: string[];
  defaultOrder: string[];
  settings: { packetKeys: string[]; packetCustomized: boolean; nppUrl: string | null; nppFileName: string | null; nppEffectiveDate: string | null } | null;
  vars: { practiceName: string | null; practicePhone?: string | null; nppUrl?: string | null };
  canApprove: boolean;
  /** Practice toggle "Automatic consent reminders" (default on) */
  autoReminders?: boolean;
  approverRoles?: string[];
};

const ROLE_LABEL: Record<string, string> = { ADMIN: 'Administrator', PRACTICE_DIRECTOR: 'Practice Director' };

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  APPROVED: 'bg-sky-50 text-sky-800 ring-sky-200',
  DRAFT: 'bg-amber-50 text-amber-800 ring-amber-200',
  RETIRED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const ORIGIN_LABEL: Record<string, string> = {
  practice_packet: "Practice's packet (Valant)",
  proposed: 'Proposed — needs owner/compliance approval',
  proposed_typo_fix: 'Proposed typo fixes — needs approval',
  standard: 'Regulatory standard text',
};

function appliesLabel(a: LibraryVersionView['appliesTo']): string {
  switch (a.kind) {
    case 'all':
      return 'All new clients';
    case 'service':
      return `Only for: ${a.services.join(', ').replace(/_/g, ' ')}`;
    case 'minor':
      return 'Clients under 18';
    case 'medicaid':
      return 'Maryland Medicaid';
    default:
      return 'Added per client';
  }
}

export default function ConsentLibraryPage() {
  const [data, setData] = useState<LibraryResponse | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'flags' | 'draft' | 'active'>('all');
  const [selection, setSelection] = useState<string[]>([]);
  const [npp, setNpp] = useState({ url: '', effective: '' });
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await fetch('/api/consents/library', { cache: 'no-store' });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not load');
      setData(d);
      setSelection(d.selection);
      setNpp({ url: d.settings?.nppUrl ?? '', effective: d.settings?.nppEffectiveDate ?? '' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the library');
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const byKey = useMemo(() => {
    const m = new Map<string, LibraryVersionView[]>();
    for (const v of data?.versions ?? []) m.set(v.key, [...(m.get(v.key) ?? []), v]);
    return m;
  }, [data]);

  const stats = useMemo(() => {
    const vs = data?.versions ?? [];
    return {
      active: vs.filter((v) => v.status === 'ACTIVE').length,
      draft: vs.filter((v) => v.status === 'DRAFT').length,
      decisions: vs.filter((v) => v.status !== 'RETIRED' && v.reviewFlags.some((f) => f.severity === 'needs_decision')).length,
      blocked: vs.filter((v) => v.status === 'ACTIVE' && !v.sendable).length,
    };
  }, [data]);

  // Newest Draft / Approved version of each template that is newer than its Active version (or has none)
  const needsApproval = useMemo(() => {
    const out: { v: LibraryVersionView; activeVersion: number | null; requiredBy: string[] }[] = [];
    for (const [key, vs] of byKey) {
      const active = vs.find((x) => x.status === 'ACTIVE');
      const pending = vs.filter((x) => (x.status === 'DRAFT' || x.status === 'APPROVED') && (!active || x.version > active.version)).sort((a, b) => b.version - a.version)[0];
      if (!pending) continue;
      out.push({ v: pending, activeVersion: active?.version ?? null, requiredBy: REQUIREMENT_RULES.filter((r) => r.key === key).map((r) => r.basis) });
    }
    return out.sort((a, b) => Number(b.requiredBy.length > 0) - Number(a.requiredBy.length > 0) || Number(a.activeVersion !== null) - Number(b.activeVersion !== null) || a.v.title.localeCompare(b.v.title));
  }, [byKey]);
  const approvers = (data?.approverRoles ?? ['ADMIN', 'PRACTICE_DIRECTOR']).map((r) => ROLE_LABEL[r] ?? r).join(' or ');

  const act = async (v: LibraryVersionView, action: 'approve' | 'activate' | 'retire' | 'return_to_draft') => {
    const note = action === 'approve' ? window.prompt(`Approve "${v.title}" version ${v.version}. Optional note (who reviewed it, e.g. compliance):`) : '';
    if (note === null) return;
    if (action === 'activate' && !window.confirm(`Activate version ${v.version} of "${v.title}"? The currently Active version is retired${v.resignOnNewVersion ? ' and clients signed on it will need to re-sign' : ''}.`)) return;
    setBusy(`${v.key}@${v.version}`);
    setMsg('');
    try {
      const res = await fetch('/api/consents/library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: v.key, version: v.version, action, note: note || null }) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not update');
      setMsg(`${v.title} v${v.version}: ${action.replace(/_/g, ' ')} recorded${d.retiredVersion ? ` (version ${d.retiredVersion} retired)` : ''}.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  };

  const saveSettings = async (body: Record<string, unknown>, okText: string) => {
    setBusy('settings');
    setMsg('');
    try {
      const res = await fetch('/api/consents/library', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Could not save');
      setMsg(okText);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(null);
    }
  };

  const uploadNpp = async (file: File) => {
    setBusy('npp');
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch('/api/consents/library/npp', { method: 'POST', body: fd });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error || 'Upload failed');
      setMsg('Notice of Privacy Practices uploaded.');
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setBusy(null);
    }
  };

  const move = (key: string, dir: -1 | 1) =>
    setSelection((s) => {
      const i = s.indexOf(key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const keys = (data?.keys ?? []).filter((k) => {
    const vs = byKey.get(k) ?? [];
    if (filter === 'flags') return vs.some((v) => v.status !== 'RETIRED' && v.reviewFlags.some((f) => f.severity === 'needs_decision'));
    if (filter === 'draft') return vs.some((v) => v.status === 'DRAFT' || v.status === 'APPROVED');
    if (filter === 'active') return vs.some((v) => v.status === 'ACTIVE');
    return true;
  });

  return (
    <div className="space-y-5">
      <Link href="/dashboard/ehr/consents" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-blue-600 hover:underline">
        <ArrowLeft size={14} aria-hidden /> Consent forms
      </Link>
      <PageHeader
        title="Consent library"
        description={`Versioned consent and intake forms for ${data?.vars.practiceName ?? 'the practice'}. The practice's own Valant packet sections are Active; Altrixs-drafted wording is a Draft until an administrator or the practice director approves and activates it. Only Active versions can be sent.`}
      />
      {error ? <Alert tone="danger">{error}</Alert> : null}
      {msg ? <Alert tone="info">{msg}</Alert> : null}
      {!data ? (
        <p role="status" className="flex items-center gap-2 text-[13px] text-slate-500"><Loader2 size={15} className="animate-spin" aria-hidden /> Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Active versions" value={stats.active} tone="green" icon={<CheckCircle2 size={18} />} />
            <StatCard label="Drafts awaiting approval" value={stats.draft} tone="amber" icon={<FileText size={18} />} />
            <StatCard label="Need an owner decision" value={stats.decisions} tone="rose" icon={<AlertTriangle size={18} />} />
            <StatCard label="Active but not sendable" value={stats.blocked} tone="slate" hint="Missing a practice setting" icon={<Info size={18} />} />
          </div>

          {!data.vars.practiceName ? (
            <Alert tone="warning">The practice name is not set. Templates use it ({'{{practiceName}}'}); set the legal or DBA name in Practice setup before sending.</Alert>
          ) : null}

          <Panel>
            <h2 className="text-[14px] font-bold text-slate-900">Needs practice approval ({needsApproval.length})</h2>
            <p className="mt-1 text-[12.5px] text-slate-600">
              Who can approve: <strong>{approvers}</strong> (approve, then activate; recorded with name and date). Altrixs never approves wording. Until a version is Active it cannot be sent, and a consent that is required but not approved is shown as a flag only: it never blocks a check-in.
            </p>
            {needsApproval.length ? (
              <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
                {needsApproval.map(({ v, activeVersion, requiredBy }) => (
                  <li key={`${v.key}@${v.version}`} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0 flex-1">
                      <strong className="text-slate-900">{v.title}</strong> <span className="text-slate-500">v{v.version}</span>
                      <span className="block text-[11.5px] text-slate-500">
                        {activeVersion ? `Replaces active v${activeVersion}` : 'No active version yet'}
                        {requiredBy.length ? ` · Required: ${requiredBy.join('; ')}` : ''}
                        {v.reviewFlags.some((f) => f.severity === 'needs_decision') ? ' · has review notes needing a decision' : ''}
                      </span>
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_TONE[v.status]}`}>{v.status === 'APPROVED' ? 'Approved, not active' : v.statusLabel}</span>
                    <button type="button" onClick={() => setOpen(`${v.key}@${v.version}`)} className="text-[11.5px] font-semibold text-blue-600 hover:underline">Review text</button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[12.5px] text-emerald-700">Every template has its newest version active.</p>
            )}
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="text-[14px] font-bold text-slate-900">Validity and reminders</h2>
                <p className="mt-1 text-[12.5px] text-slate-600">How long a signed consent stays valid, and the automatic reminders clients get.</p>
              </div>
              <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-800">
                <input
                  type="checkbox"
                  checked={data.autoReminders ?? true}
                  disabled={!data.canApprove || busy === 'settings'}
                  onChange={(e) => void saveSettings({ autoReminders: e.target.checked }, e.target.checked ? 'Automatic consent reminders turned on.' : 'Automatic consent reminders turned off.')}
                />
                Automatic consent reminders
              </label>
            </div>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-[12px] font-semibold text-slate-800">Validity</p>
                <table className="mt-1 w-full text-[12px]">
                  <thead className="sr-only"><tr><th scope="col">Consent type</th><th scope="col">Validity rule</th></tr></thead>
                  <tbody>
                    {VALIDITY_POLICY.map((p) => (
                      <tr key={p.label} className="border-t border-slate-100">
                        <td className="py-1 pr-2 text-slate-700">{p.label}</td>
                        <td className="py-1 text-slate-600">{p.rule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-slate-800">Automatic reminders {data.autoReminders === false ? '(off)' : '(on)'}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12px] text-slate-600">
                  {REMINDER_POLICY.map((t) => <li key={t}>{t}</li>)}
                </ul>
                <p className="mt-2 text-[11.5px] text-slate-500">Cap: {MAX_REMINDERS} per packet or consent. {data.canApprove ? '' : `Only the ${approvers} can change this setting.`}</p>
              </div>
            </div>
          </Panel>

          <Panel>
            <h2 className="text-[14px] font-bold text-slate-900">Notice of Privacy Practices</h2>
            <p className="mt-1 text-[12.5px] text-slate-600">The NPP acknowledgment of receipt (45 CFR §164.520) can be sent once the practice links or uploads its Notice. Current: {data.vars.nppUrl ? <a className="text-blue-600 underline" href={data.vars.nppUrl} target="_blank" rel="noreferrer">{data.vars.nppUrl}</a> : 'not set'}</p>
            {data.canApprove ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_180px_auto_auto]">
                <input aria-label="NPP link (https)" className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]" placeholder="https://… link to the NPP on the practice website" value={npp.url} onChange={(e) => setNpp({ ...npp, url: e.target.value })} />
                <input aria-label="NPP effective date" className="rounded-lg border border-slate-300 px-3 py-2 text-[13px]" placeholder="Effective date" value={npp.effective} onChange={(e) => setNpp({ ...npp, effective: e.target.value })} />
                <button type="button" disabled={busy === 'settings'} onClick={() => void saveSettings({ nppUrl: npp.url || null, nppEffectiveDate: npp.effective || null }, 'NPP settings saved.')} className="rounded-lg bg-blue-600 px-3 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60">Save</button>
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-[12.5px] font-semibold text-slate-700">
                  <Upload size={14} aria-hidden /> {busy === 'npp' ? 'Uploading…' : 'Upload PDF'}
                  <input type="file" accept="application/pdf" className="sr-only" onChange={(e) => e.target.files?.[0] && void uploadNpp(e.target.files[0])} />
                </label>
              </div>
            ) : null}
          </Panel>

          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[14px] font-bold text-slate-900">New-client intake packet</h2>
                <p className="text-[12.5px] text-slate-600">Templates the packet may include, in order. Per client, the rules apply: telehealth only with telehealth, PRP sections only for PRP, Part 2 consent for SUD, minor consent under 18, primary care consent for primary care, the emergency-contact release when an emergency contact is given, and the Carelon attestation (its own form) for Maryland Medicaid. Only Active versions are used.</p>
              </div>
              {data.canApprove ? (
                <div className="flex gap-2">
                  <button type="button" onClick={() => setSelection(data.defaultOrder)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-[12px] font-semibold text-slate-700">Reset to default</button>
                  <button type="button" disabled={busy === 'settings'} onClick={() => void saveSettings({ packetKeys: selection }, 'Intake packet saved.')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-60">Save packet</button>
                </div>
              ) : null}
            </div>
            <ol className="mt-3 grid gap-1 md:grid-cols-2">
              {data.keys.map((k) => {
                const vs = byKey.get(k) ?? [];
                const active = vs.find((v) => v.status === 'ACTIVE');
                const on = selection.includes(k);
                return (
                  <li key={k} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-[12.5px]">
                    <input type="checkbox" aria-label={`Include ${vs[0]?.title}`} disabled={!data.canApprove} checked={on} onChange={(e) => setSelection((s) => (e.target.checked ? [...s, k] : s.filter((x) => x !== k)))} />
                    <span className="min-w-0 flex-1 truncate">{on ? `${selection.indexOf(k) + 1}. ` : ''}{active?.title ?? vs[vs.length - 1]?.title}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${active ? (active.sendable ? STATUS_TONE.ACTIVE : STATUS_TONE.RETIRED) : STATUS_TONE.DRAFT}`}>{active ? (active.sendable ? `v${active.version} active` : 'not sendable') : 'no active version'}</span>
                    {on && data.canApprove ? (
                      <>
                        <button type="button" aria-label="Move up" onClick={() => move(k, -1)} className="text-slate-500 hover:text-slate-900"><ArrowUp size={13} /></button>
                        <button type="button" aria-label="Move down" onClick={() => move(k, 1)} className="text-slate-500 hover:text-slate-900"><ArrowDown size={13} /></button>
                      </>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </Panel>

          <div className="flex flex-wrap gap-2">
            {(['all', 'flags', 'draft', 'active'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={`rounded-full px-3 py-1 text-[12px] font-semibold ring-1 ${filter === f ? 'bg-blue-600 text-white ring-blue-600' : 'bg-white text-slate-700 ring-slate-200'}`}>
                {f === 'all' ? 'All templates' : f === 'flags' ? 'Needs owner decision' : f === 'draft' ? 'Drafts / approved' : 'Active'}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {keys.map((k) => (
              <Panel key={k}>
                <h3 className="text-[14px] font-bold text-slate-900">{(byKey.get(k) ?? [])[0]?.title}</h3>
                <div className="mt-2 space-y-2">
                  {(byKey.get(k) ?? []).map((v) => {
                    const id = `${v.key}@${v.version}`;
                    const expanded = open === id;
                    return (
                      <div key={id} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => setOpen(expanded ? null : id)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-900" aria-expanded={expanded}>
                            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />} Version {v.version}
                          </button>
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${STATUS_TONE[v.status]}`}>{v.statusLabel}</span>
                          <span className="text-[11.5px] text-slate-600">{ORIGIN_LABEL[v.origin] ?? v.origin}</span>
                          {v.status === 'ACTIVE' && !v.sendable && v.sendBlockedReason ? <span className="text-[11.5px] text-rose-700">Not sendable: {v.sendBlockedReason}</span> : null}
                          <span className="ml-auto flex flex-wrap gap-1.5">
                            {data.canApprove && v.status === 'DRAFT' ? <button type="button" disabled={busy === id} onClick={() => void act(v, 'approve')} className="rounded-md bg-blue-600 px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60">Approve</button> : null}
                            {data.canApprove && v.status === 'APPROVED' ? <button type="button" disabled={busy === id} onClick={() => void act(v, 'activate')} className="rounded-md bg-emerald-700 px-2 py-1 text-[11.5px] font-semibold text-white disabled:opacity-60">Activate</button> : null}
                            {data.canApprove && v.status === 'APPROVED' ? <button type="button" disabled={busy === id} onClick={() => void act(v, 'return_to_draft')} className="rounded-md border border-slate-300 px-2 py-1 text-[11.5px] font-semibold text-slate-700">Back to draft</button> : null}
                            {data.canApprove && (v.status === 'ACTIVE' || v.status === 'APPROVED') ? <button type="button" disabled={busy === id} onClick={() => window.confirm(`Retire "${v.title}" version ${v.version}? It can no longer be sent.`) && void act(v, 'retire')} className="rounded-md border border-slate-300 px-2 py-1 text-[11.5px] font-semibold text-slate-700">Retire</button> : null}
                          </span>
                        </div>
                        <p className="mt-1 text-[11.5px] text-slate-500">{v.approval} · {appliesLabel(v.appliesTo)} · {v.renewalMonths ? `renews every ${v.renewalMonths} months` : 'no renewal'}{v.resignOnNewVersion ? ' · re-sign required when a new version activates' : ''}{v.signing === 'standalone' ? ' · own signature' : ''}{v.revocable ? ' · revocable' : ''}</p>
                        {v.reviewFlags.length ? (
                          <ul className="mt-2 space-y-1">
                            {v.reviewFlags.map((f, i) => (
                              <li key={i} className={`flex items-start gap-1.5 rounded-md px-2 py-1 text-[12px] ${f.severity === 'needs_decision' ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700'}`}>
                                {f.severity === 'needs_decision' ? <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> : <Info size={13} className="mt-0.5 shrink-0" aria-hidden />}
                                <span>{f.note !== 'new' ? <strong>Review note {f.note}: </strong> : null}{f.text}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {expanded ? (
                          <div className="mt-3 space-y-3">
                            <p className="text-[11.5px] text-slate-500">Source: {v.source}</p>
                            {v.changeNote ? <Alert tone="info">Changes: {v.changeNote}</Alert> : null}
                            <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                              <ConsentBlocks blocks={v.rendered.blocks} />
                              {v.rendered.choices.map((c) => <p key={c.key} className="mt-2 text-[12.5px]"><strong>{c.label}:</strong> {c.options.map((o) => o.label).join(' / ')}</p>)}
                              {v.rendered.checkboxes.map((c) => <p key={c.key} className="mt-1 text-[12.5px]">[ ] {c.label}</p>)}
                              {v.rendered.fields.length ? <p className="mt-2 text-[12.5px]"><strong>Fields:</strong> {v.rendered.fields.map((f) => f.label).join('; ')}</p> : null}
                              <p className="mt-2 text-[12.5px] font-semibold">[ ] {v.rendered.acknowledgment}</p>
                            </div>
                            {v.regulatoryElements?.length ? (
                              <div>
                                <p className="text-[12px] font-semibold text-slate-800">Required elements and where they are</p>
                                <ul className="mt-1 list-disc pl-5 text-[12px] text-slate-700">
                                  {v.regulatoryElements.map((e) => <li key={e.element}>{e.label} <span className="text-slate-500">({e.element}; {e.satisfiedBy})</span></li>)}
                                </ul>
                              </div>
                            ) : null}
                            {v.staffGuidance.length ? (
                              <div>
                                <p className="text-[12px] font-semibold text-slate-800">Staff guidance (not part of the signed form)</p>
                                <ul className="mt-1 list-disc pl-5 text-[12px] text-slate-700">{v.staffGuidance.map((g, i) => <li key={i}>{g}</li>)}</ul>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </Panel>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
