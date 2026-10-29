'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  PLACEMENT_STATUSES,
  PLACEMENT_STATUS_LABEL,
  PLACEMENT_TYPES,
  PLACEMENT_TYPE_LABEL,
  type PlacementStatus,
  type PlacementType,
} from '@/lib/peerSupport/workflow';
import { peerApi, type CommunityResource, type PeerPlacementDto } from '../api';
import { ClientPicker, EmptyState, LegacyBadge, Modal, Pill, formatDate, inputCls, labelCls, primaryBtn, secondaryBtn, stickyFirstTd, stickyFirstTh, type PickedClient } from './ui';

const STATUS_TONE: Record<string, 'emerald' | 'amber' | 'slate'> = { active: 'emerald', pending: 'amber', completed: 'slate', ended: 'slate' };

/** Community integration placements: employment, volunteer, education, social club, housing / recovery residence. */
export function PlacementsPanel({ caseload, resources }: { caseload: PickedClient[]; resources: CommunityResource[] }) {
  const [rows, setRows] = useState<PeerPlacementDto[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await peerApi.placements({ includeClosed: showClosed });
      setRows(r.placements);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load placements');
    } finally {
      setLoading(false);
    }
  }, [showClosed]);
  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(p: PeerPlacementDto, status: PlacementStatus) {
    try {
      await peerApi.updatePlacement(p.id, { status, ...(status === 'ended' || status === 'completed' ? { endDate: new Date().toISOString().slice(0, 10) } : {}) });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Show completed and ended
        </label>
        <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
          <Plus size={16} /> Add placement
        </button>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading placements…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No community placements">Record a job, volunteer role, class, social club or housing program a client starts with your support.</EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
              <tr>
                <th scope="col" className={`${stickyFirstTh} px-4 py-2`}>Client</th>
                <th className="px-4 py-2">Placement</th>
                <th className="px-4 py-2">Started</th>
                <th className="px-4 py-2">Hours/week</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className={`${stickyFirstTd} px-4 py-2 font-medium text-slate-900`}>{p.clientName}</td>
                  <td className="px-4 py-2">
                    <span className="font-medium text-slate-800">{p.organizationName}</span> {p.source === 'legacy' && <LegacyBadge />}
                    <span className="block text-xs text-slate-500">
                      {PLACEMENT_TYPE_LABEL[p.placementType as PlacementType] ?? p.placementType}
                      {p.resourceName ? ' · in resource directory' : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-slate-600">{formatDate(p.startDate)}</td>
                  <td className="px-4 py-2 text-slate-600">{p.hoursPerWeek ?? '—'}</td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <Pill tone={STATUS_TONE[p.status] ?? 'slate'}>{PLACEMENT_STATUS_LABEL[p.status as PlacementStatus] ?? p.status}</Pill>
                      <select aria-label="Change status" value={p.status} onChange={(e) => void setStatus(p, e.target.value as PlacementStatus)} className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs sm:h-8">
                        {PLACEMENT_STATUSES.map((s) => (
                          <option key={s} value={s}>{PLACEMENT_STATUS_LABEL[s]}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && (
        <PlacementForm
          caseload={caseload}
          resources={resources}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
          }}
        />
      )}
    </div>
  );
}

function PlacementForm({ caseload, resources, onClose, onSaved }: { caseload: PickedClient[]; resources: CommunityResource[]; onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState<PickedClient | null>(null);
  const [placementType, setType] = useState<PlacementType>('volunteer');
  const [resourceId, setResourceId] = useState('');
  const [organizationName, setOrg] = useState('');
  const [status, setStatus] = useState<PlacementStatus>('pending');
  const [startDate, setStart] = useState('');
  const [hours, setHours] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!client) return setError('Pick a client');
    if (!organizationName.trim() && !resourceId) return setError('Name the organization or pick it from the directory');
    setSaving(true);
    setError(null);
    try {
      await peerApi.createPlacement({
        clientId: client.id,
        placementType,
        organizationName: organizationName.trim() || null,
        resourceId: resourceId || null,
        status,
        startDate: startDate || null,
        hoursPerWeek: hours ? Number(hours) : null,
        notes: notes.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a community placement" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Client</label>
          <ClientPicker caseload={caseload} value={client} onChange={setClient} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="pp-type">Type</label>
            <select id="pp-type" value={placementType} onChange={(e) => setType(e.target.value as PlacementType)} className={inputCls}>
              {PLACEMENT_TYPES.map((t) => (
                <option key={t} value={t}>{PLACEMENT_TYPE_LABEL[t]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="pp-status">Status</label>
            <select id="pp-status" value={status} onChange={(e) => setStatus(e.target.value as PlacementStatus)} className={inputCls}>
              {PLACEMENT_STATUSES.map((s) => (
                <option key={s} value={s}>{PLACEMENT_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </div>
        </div>
        {resources.length > 0 && (
          <div>
            <label className={labelCls} htmlFor="pp-res">From the resource directory (optional)</label>
            <select id="pp-res" value={resourceId} onChange={(e) => setResourceId(e.target.value)} className={inputCls}>
              <option value="">Not in the directory</option>
              {resources.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="pp-org">Organization</label>
          <input id="pp-org" maxLength={200} value={organizationName} onChange={(e) => setOrg(e.target.value)} className={inputCls} placeholder={resourceId ? 'Uses the directory name if left blank' : 'Employer, program or club'} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="pp-start">Start date</label>
            <input id="pp-start" type="date" value={startDate} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="pp-hours">Hours per week</label>
            <input id="pp-hours" type="number" min={0} max={80} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="pp-notes">Notes</label>
          <textarea id="pp-notes" rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={primaryBtn}>{saving ? 'Saving…' : 'Save placement'}</button>
        </div>
      </div>
    </Modal>
  );
}
