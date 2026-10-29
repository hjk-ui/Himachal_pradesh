'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  GOAL_DOMAINS,
  GOAL_DOMAIN_LABEL,
  GOAL_STATUSES,
  GOAL_STATUS_LABEL,
  type GoalDomain,
  type GoalStatus,
} from '@/lib/peerSupport/workflow';
import { peerApi, type PeerGoalDto } from '../api';
import { ClientPicker, EmptyState, LegacyBadge, Modal, Pill, formatDate, inputCls, labelCls, primaryBtn, secondaryBtn, type PickedClient } from './ui';

const COLUMNS: { status: GoalStatus; tone: 'brand' | 'amber' | 'slate' | 'emerald' }[] = [
  { status: 'active', tone: 'brand' },
  { status: 'in_progress', tone: 'amber' },
  { status: 'on_hold', tone: 'slate' },
  { status: 'achieved', tone: 'emerald' },
];

export function GoalsBoard({
  caseload,
  addFor,
  onAddHandled,
  onChanged,
}: {
  caseload: PickedClient[];
  addFor: PickedClient | null | undefined;
  onAddHandled: () => void;
  onChanged: () => void;
}) {
  const [goals, setGoals] = useState<PeerGoalDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<PickedClient | null | false>(false);
  const [noteFor, setNoteFor] = useState<PeerGoalDto | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await peerApi.goals({ includeClosed: true });
      setGoals(r.goals);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load goals');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (addFor !== undefined) {
      setAdding(addFor);
      onAddHandled();
    }
  }, [addFor, onAddHandled]);

  async function setStatus(g: PeerGoalDto, status: GoalStatus) {
    try {
      await peerApi.updateGoal(g.id, { status });
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    }
  }

  const discontinued = goals.filter((g) => g.status === 'discontinued').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">Recovery goals in the client&apos;s own words. Move a card by changing its status.</p>
        <button type="button" className={primaryBtn} onClick={() => setAdding(null)}>
          <Plus size={16} /> Add goal
        </button>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading goals…</p>
      ) : goals.length === 0 ? (
        <EmptyState title="No recovery goals yet">Add a goal with the client, in their words, from your caseload.</EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {COLUMNS.map((col) => {
            const items = goals.filter((g) => g.status === col.status);
            return (
              <div key={col.status} className="min-w-0 rounded-2xl bg-slate-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Pill tone={col.tone}>{GOAL_STATUS_LABEL[col.status]}</Pill>
                  <span className="text-xs font-semibold text-slate-500">{items.length}</span>
                </div>
                <div className="space-y-2">
                  {items.map((g) => {
                    const last = g.progressNotes[g.progressNotes.length - 1];
                    return (
                      <div key={g.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-2">
                          <p className="min-w-0 break-words text-sm font-semibold text-slate-900">{g.goal}</p>
                          {g.source === 'legacy' && <LegacyBadge />}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          {g.clientName} · {GOAL_DOMAIN_LABEL[g.domain as GoalDomain] ?? g.domain}
                          {g.targetDate ? ` · target ${formatDate(g.targetDate)}` : ''}
                        </p>
                        {last && <p className="mt-2 line-clamp-3 text-xs text-slate-600">{last.text}</p>}
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <select
                            aria-label="Goal status"
                            value={g.status}
                            onChange={(e) => void setStatus(g, e.target.value as GoalStatus)}
                            className="h-10 rounded-lg border border-slate-200 bg-white px-2 text-xs sm:h-8"
                          >
                            {GOAL_STATUSES.map((s) => (
                              <option key={s} value={s}>{GOAL_STATUS_LABEL[s]}</option>
                            ))}
                          </select>
                          <button type="button" onClick={() => setNoteFor(g)} className="min-h-10 text-xs font-semibold text-[#5C2D91] hover:underline sm:min-h-0">
                            Progress note
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {discontinued > 0 && <p className="text-xs text-slate-500">{discontinued} discontinued goal{discontinued === 1 ? '' : 's'} not shown.</p>}

      {adding !== false && (
        <GoalForm
          caseload={caseload}
          initialClient={adding}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await load();
            onChanged();
          }}
        />
      )}
      {noteFor && (
        <ProgressNoteForm
          goal={noteFor}
          onClose={() => setNoteFor(null)}
          onSaved={async () => {
            setNoteFor(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function GoalForm({ caseload, initialClient, onClose, onSaved }: { caseload: PickedClient[]; initialClient: PickedClient | null; onClose: () => void; onSaved: () => void }) {
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const [goal, setGoal] = useState('');
  const [domain, setDomain] = useState<GoalDomain>('recovery');
  const [targetDate, setTargetDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!client || !goal.trim()) return setError('Pick a client and write the goal');
    setSaving(true);
    setError(null);
    try {
      await peerApi.createGoal({ clientId: client.id, goal: goal.trim(), domain, targetDate: targetDate || null, progressNote: note.trim() || null });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Add a recovery goal" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Client</label>
          <ClientPicker caseload={caseload} value={client} onChange={setClient} />
        </div>
        <div>
          <label className={labelCls} htmlFor="pg-goal">Goal, in the client&apos;s words</label>
          <textarea id="pg-goal" rows={2} maxLength={500} value={goal} onChange={(e) => setGoal(e.target.value)} className={inputCls} placeholder='e.g. "Get my own apartment by spring"' />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="pg-domain">Area</label>
            <select id="pg-domain" value={domain} onChange={(e) => setDomain(e.target.value as GoalDomain)} className={inputCls}>
              {GOAL_DOMAINS.map((d) => (
                <option key={d} value={d}>{GOAL_DOMAIN_LABEL[d]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="pg-target">Target date (optional)</label>
            <input id="pg-target" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls} htmlFor="pg-note">First step (optional)</label>
          <input id="pg-note" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving} className={primaryBtn}>{saving ? 'Saving…' : 'Save goal'}</button>
        </div>
      </div>
    </Modal>
  );
}

function ProgressNoteForm({ goal, onClose, onSaved }: { goal: PeerGoalDto; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!text.trim()) return;
    setSaving(true);
    try {
      await peerApi.updateGoal(goal.id, { progressNote: text.trim() });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Progress note" onClose={onClose}>
      <p className="text-sm font-semibold text-slate-900">{goal.goal}</p>
      <p className="mb-3 text-xs text-slate-500">{goal.clientName}</p>
      {goal.progressNotes.length > 0 && (
        <ul className="mb-3 max-h-48 space-y-2 overflow-y-auto">
          {goal.progressNotes.map((n, i) => (
            <li key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold">{formatDate(n.at)}{n.byName ? ` · ${n.byName}` : ''}</span>
              <br />
              {n.text}
            </li>
          ))}
        </ul>
      )}
      <textarea rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} className={inputCls} placeholder="What changed since last time?" />
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Close</button>
        <button type="button" onClick={save} disabled={saving || !text.trim()} className={primaryBtn}>Add note</button>
      </div>
    </Modal>
  );
}
