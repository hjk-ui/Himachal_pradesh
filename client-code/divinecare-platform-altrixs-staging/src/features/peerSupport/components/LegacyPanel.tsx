'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  CONTACT_MODES,
  CONTACT_MODE_LABEL,
  GOAL_DOMAINS,
  GOAL_DOMAIN_LABEL,
  PLACEMENT_TYPES,
  PLACEMENT_TYPE_LABEL,
  type ContactMode,
  type GoalDomain,
  type LegacyKind,
  type PlacementType,
} from '@/lib/peerSupport/workflow';
import { peerApi, type LegacyOverview } from '../api';
import { ClientPicker, Modal, inputCls, labelCls, primaryBtn, secondaryBtn, stickyLastTd, stickyLastTh, type PickedClient } from './ui';

const KIND_LABEL: Record<LegacyKind, string> = { contact: 'Contact', goal: 'Goal', placement: 'Placement' };
type Entry = LegacyOverview['entries'][number];

/**
 * Old hand-entered rows (free-text names). Leadership files each one to a client they pick;
 * nothing is matched by name. Filed rows are marked Legacy. The old lists are left untouched.
 */
export function LegacyPanel({ overview, myUserId, onFiled }: { overview: LegacyOverview; myUserId: string | null; onFiled: () => void }) {
  const [filing, setFiling] = useState<Entry | null>(null);
  const c = overview.counts;
  const pending = c.contact.pending + c.goal.pending + c.placement.pending;
  const imported = c.contact.imported + c.goal.imported + c.placement.imported;
  const samples = c.contact.sampleRows + c.goal.sampleRows + c.placement.sampleRows;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-semibold">
          <AlertTriangle size={16} /> {pending} legacy entr{pending === 1 ? 'y' : 'ies'} from the old peer support lists
        </p>
        <p className="mt-1">
          These were typed with a free-text name and are not linked to any chart, so they are not counted on this page. Each one must be filed to the right client by a person.
          {imported > 0 && ` ${imported} already filed.`}
          {samples > 0 && ` ${samples} built-in sample row${samples === 1 ? '' : 's'} (not real clients) will not be imported.`}
        </p>
        <p className="mt-1 text-xs">
          Contacts {c.contact.pending} · Goals {c.goal.pending} · Placements {c.placement.pending}
        </p>
        {!overview.canImport && <p className="mt-2 text-xs font-semibold">A director or admin can file these from this page.</p>}
      </div>

      {overview.canImport && overview.entries.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-2">Type</th>
                <th className="px-4 py-2">Name as typed</th>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Entry</th>
                <th scope="col" className={`${stickyLastTh} px-4 py-2`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {overview.entries.map((e) => (
                <tr key={`${e.kind}-${e.legacyId}`}>
                  <td className="px-4 py-2 text-slate-600">{KIND_LABEL[e.kind]}</td>
                  <td className="px-4 py-2 font-medium text-slate-900">{e.clientLabel || '(no name)'}</td>
                  <td className="px-4 py-2 text-slate-600">{e.date || '—'}</td>
                  <td className="px-4 py-2 text-slate-700">
                    {e.summary}
                    {e.detail && <span className="block max-w-xs truncate text-xs text-slate-500 lg:max-w-md">{e.detail}</span>}
                  </td>
                  <td className={`${stickyLastTd} px-4 py-2 text-right`}>
                    {e.group ? (
                      <span className="text-xs text-slate-500">Group entry: cannot be filed to one chart</span>
                    ) : (
                      <button type="button" className={secondaryBtn} onClick={() => setFiling(e)}>File to client</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filing && (
        <FileForm
          entry={filing}
          peers={overview.peers}
          myUserId={myUserId}
          onClose={() => setFiling(null)}
          onSaved={() => {
            setFiling(null);
            onFiled();
          }}
        />
      )}
    </div>
  );
}

function FileForm({ entry, peers, myUserId, onClose, onSaved }: { entry: Entry; peers: { id: string; name: string }[]; myUserId: string | null; onClose: () => void; onSaved: () => void }) {
  const s = entry.suggested as Record<string, unknown>;
  const [client, setClient] = useState<PickedClient | null>(null);
  const [peerUserId, setPeer] = useState(peers[0]?.id ?? myUserId ?? '');
  const [contactAt, setContactAt] = useState(entry.kind === 'contact' ? entry.date ?? '' : '');
  const [mode, setMode] = useState<ContactMode>((s.mode as ContactMode) ?? 'in_person');
  const [domain, setDomain] = useState<GoalDomain | ''>('');
  const [placementType, setType] = useState<PlacementType | ''>((s.placementType as PlacementType) ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!client) return setError('Pick the client this entry belongs to');
    if (!peerUserId) return setError('Pick the staff member who made it');
    if (entry.kind === 'goal' && !domain) return setError('Pick the goal area');
    if (entry.kind === 'placement' && !placementType) return setError('Pick the placement type');
    if (entry.kind === 'contact' && !contactAt) return setError('Enter the contact date');
    setSaving(true);
    setError(null);
    try {
      await peerApi.importLegacy({
        kind: entry.kind,
        legacyId: entry.legacyId,
        clientId: client.id,
        peerUserId,
        ...(entry.kind === 'contact' ? { contactAt, mode } : {}),
        ...(entry.kind === 'goal' && domain ? { domain } : {}),
        ...(entry.kind === 'placement' && placementType ? { placementType } : {}),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not file');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`File legacy ${KIND_LABEL[entry.kind].toLowerCase()}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl bg-slate-50 p-3 text-sm">
          <p className="text-xs font-semibold text-slate-500">Name as typed on the old page</p>
          <p className="font-semibold text-slate-900">{entry.clientLabel || '(no name)'}</p>
          <p className="mt-1 text-slate-700">{entry.summary}</p>
          {entry.detail && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{entry.detail}</p>}
          {entry.author && <p className="mt-1 text-xs text-slate-500">Specialist as typed: {entry.author}</p>}
        </div>
        <div>
          <label className={labelCls}>Client this entry belongs to</label>
          <ClientPicker caseload={[]} value={client} onChange={setClient} hint="Search and confirm the right person. Names are never matched automatically." />
        </div>
        <div>
          <label className={labelCls} htmlFor="lg-peer">Made by</label>
          <select id="lg-peer" value={peerUserId} onChange={(e) => setPeer(e.target.value)} className={inputCls}>
            {peers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {myUserId && !peers.some((p) => p.id === myUserId) && <option value={myUserId}>Me (filed on behalf of the team)</option>}
          </select>
        </div>
        {entry.kind === 'contact' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="lg-date">Contact date</label>
              <input id="lg-date" type="date" value={contactAt} onChange={(e) => setContactAt(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls} htmlFor="lg-mode">How</label>
              <select id="lg-mode" value={mode} onChange={(e) => setMode(e.target.value as ContactMode)} className={inputCls}>
                {CONTACT_MODES.map((m) => (
                  <option key={m} value={m}>{CONTACT_MODE_LABEL[m]}</option>
                ))}
              </select>
            </div>
          </div>
        )}
        {entry.kind === 'goal' && (
          <div>
            <label className={labelCls} htmlFor="lg-domain">Goal area</label>
            <select id="lg-domain" value={domain} onChange={(e) => setDomain(e.target.value as GoalDomain)} className={inputCls}>
              <option value="">Pick one</option>
              {GOAL_DOMAINS.map((d) => (
                <option key={d} value={d}>{GOAL_DOMAIN_LABEL[d]}</option>
              ))}
            </select>
          </div>
        )}
        {entry.kind === 'placement' && (
          <div>
            <label className={labelCls} htmlFor="lg-type">Placement type</label>
            <select id="lg-type" value={placementType} onChange={(e) => setType(e.target.value as PlacementType)} className={inputCls}>
              <option value="">Pick one</option>
              {PLACEMENT_TYPES.map((t) => (
                <option key={t} value={t}>{PLACEMENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={primaryBtn}>{saving ? 'Filing…' : 'File as legacy entry'}</button>
        </div>
      </div>
    </Modal>
  );
}
