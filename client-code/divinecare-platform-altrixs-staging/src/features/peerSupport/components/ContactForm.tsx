'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { CONTACT_MODES, CONTACT_MODE_LABEL, SUGGESTED_TOPICS, type ContactMode } from '@/lib/peerSupport/workflow';
import { peerApi, type FollowUpItem, type PeerGoalDto } from '../api';
import { ClientPicker, Modal, TopicPicker, formatDate, inputCls, labelCls, nowLocalInput, primaryBtn, secondaryBtn, type PickedClient } from './ui';

/** Fast contact log: client, when, how, topics, a short peer note, next follow-up. */
export function ContactForm({
  caseload,
  initialClient,
  openFollowUps,
  onClose,
  onSaved,
}: {
  caseload: PickedClient[];
  initialClient: PickedClient | null;
  openFollowUps: FollowUpItem[];
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [client, setClient] = useState<PickedClient | null>(initialClient);
  const [contactAt, setContactAt] = useState(nowLocalInput());
  const [mode, setMode] = useState<ContactMode>('in_person');
  const [duration, setDuration] = useState('30');
  const [topics, setTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [goals, setGoals] = useState<PeerGoalDto[]>([]);
  const [goalIds, setGoalIds] = useState<string[]>([]);
  const [closeIds, setCloseIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientFollowUps = client ? openFollowUps.filter((f) => f.clientId === client.id) : [];

  useEffect(() => {
    setGoalIds([]);
    setGoals([]);
    if (!client) return;
    setCloseIds(openFollowUps.filter((f) => f.clientId === client.id).map((f) => f.contactId));
    let live = true;
    peerApi
      .goals({ clientId: client.id })
      .then((r) => live && setGoals(r.goals))
      .catch(() => live && setGoals([]));
    return () => {
      live = false;
    };
  }, [client, openFollowUps]);

  async function save() {
    if (!client) return setError('Pick a client');
    setSaving(true);
    setError(null);
    try {
      const r = await peerApi.createContact({
        clientId: client.id,
        contactAt: new Date(contactAt).toISOString(),
        mode,
        durationMinutes: duration ? Math.max(0, Math.round(Number(duration))) : null,
        topics,
        goalIds,
        notes: notes.trim() || null,
        followUpAt: followUpAt || null,
        completesFollowUpIds: closeIds,
      });
      onSaved(`Contact with ${client.name} logged${r.followUpsCompleted ? `; ${r.followUpsCompleted} follow-up closed` : ''}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Log a contact" onClose={onClose} wide>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Client</label>
          <ClientPicker caseload={caseload} value={client} onChange={setClient} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className={labelCls} htmlFor="pc-at">When</label>
            <input id="pc-at" type="datetime-local" value={contactAt} max={nowLocalInput()} onChange={(e) => setContactAt(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls} htmlFor="pc-mode">How</label>
            <select id="pc-mode" value={mode} onChange={(e) => setMode(e.target.value as ContactMode)} className={inputCls}>
              {CONTACT_MODES.map((m) => (
                <option key={m} value={m}>{CONTACT_MODE_LABEL[m]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="pc-dur">Minutes</label>
            <input id="pc-dur" type="number" min={0} max={1440} value={duration} onChange={(e) => setDuration(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Topics</label>
          <TopicPicker value={topics} onChange={setTopics} suggestions={SUGGESTED_TOPICS} />
        </div>
        {goals.length > 0 && (
          <div>
            <label className={labelCls}>Goals worked on</label>
            <div className="space-y-1">
              {goals.map((g) => (
                <label key={g.id} className="flex items-start gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={goalIds.includes(g.id)}
                    onChange={(e) => setGoalIds((prev) => (e.target.checked ? [...prev, g.id] : prev.filter((x) => x !== g.id)))}
                  />
                  {g.goal}
                </label>
              ))}
            </div>
          </div>
        )}
        <div>
          <label className={labelCls} htmlFor="pc-notes">Peer note</label>
          <textarea id="pc-notes" rows={4} maxLength={4000} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="What you did together and what's next, in plain words." />
          <p className="mt-1 flex items-start gap-1 text-xs text-slate-500">
            <Info size={12} className="mt-0.5 shrink-0" />
            Non-clinical peer note. Leave out diagnoses, therapy content and substance-use treatment details; tell the client&apos;s clinician directly about safety concerns.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls} htmlFor="pc-fu">Next follow-up (optional)</label>
            <input id="pc-fu" type="date" value={followUpAt} onChange={(e) => setFollowUpAt(e.target.value)} className={inputCls} />
          </div>
          {clientFollowUps.length > 0 && (
            <div>
              <p className={labelCls}>This contact completes</p>
              {clientFollowUps.map((f) => (
                <label key={f.contactId} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={closeIds.includes(f.contactId)}
                    onChange={(e) => setCloseIds((prev) => (e.target.checked ? [...prev, f.contactId] : prev.filter((x) => x !== f.contactId)))}
                  />
                  Follow-up due {formatDate(f.followUpAt)}
                </label>
              ))}
            </div>
          )}
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" onClick={save} disabled={saving || !client} className={primaryBtn}>{saving ? 'Saving…' : 'Save contact'}</button>
        </div>
      </div>
    </Modal>
  );
}
