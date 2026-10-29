'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  CalendarClock,
  CheckCircle2,
  History,
  ListChecks,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Target,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canEditClientProfile } from '@/lib/clients/orgScope';
import { CONTACT_MODE_LABEL, type ContactMode } from '@/lib/peerSupport/workflow';
import { peerApi, type Caseload, type CommunityResource, type LegacyOverview, type PeerContactDto } from '@/features/peerSupport/api';
import { ContactForm } from '@/features/peerSupport/components/ContactForm';
import { GoalsBoard } from '@/features/peerSupport/components/GoalsBoard';
import { PlacementsPanel } from '@/features/peerSupport/components/PlacementsPanel';
import { ResourcesPanel } from '@/features/peerSupport/components/ResourcesPanel';
import { LegacyPanel } from '@/features/peerSupport/components/LegacyPanel';
import {
  ClientPicker,
  EmptyState,
  LegacyBadge,
  Modal,
  Pill,
  formatDate,
  formatDateTime,
  inputCls,
  labelCls,
  primaryBtn,
  relativeDays,
  secondaryBtn,
  stickyFirstTd,
  stickyFirstTh,
  stickyLastTd,
  stickyLastTh,
  type PickedClient,
} from '@/features/peerSupport/components/ui';

type TabKey = 'caseload' | 'followups' | 'contacts' | 'goals' | 'placements' | 'resources' | 'legacy';

export default function PeerSupportPage() {
  const { user } = useAuth();
  const role = user?.role ?? '';
  const isPeer = role === 'PEER_SUPPORT';
  const canAssign = canEditClientProfile(role);
  const canManageDirectory = canAccessPath(role, '/dashboard/sdoh');

  const [tab, setTab] = useState<TabKey>('caseload');
  const [caseload, setCaseload] = useState<Caseload | null>(null);
  const [resources, setResources] = useState<CommunityResource[]>([]);
  const [legacy, setLegacy] = useState<LegacyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [contactFor, setContactFor] = useState<PickedClient | null | false>(false);
  const [goalFor, setGoalFor] = useState<PickedClient | null | undefined>(undefined);
  const [assigning, setAssigning] = useState(false);
  const [goalsVersion, setGoalsVersion] = useState(0);

  const load = useCallback(async () => {
    try {
      const [c, r, l] = await Promise.all([
        peerApi.caseload(),
        peerApi.resources().catch(() => ({ resources: [] as CommunityResource[] })),
        peerApi.legacy().catch(() => null),
      ]);
      setCaseload(c);
      setResources(r.resources);
      setLegacy(l);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load peer support');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const picks: PickedClient[] = useMemo(() => (caseload?.clients ?? []).map((c) => ({ id: c.id, name: c.name })), [caseload]);
  const s = caseload?.summary;
  const legacyPending = legacy ? legacy.counts.contact.pending + legacy.counts.goal.pending + legacy.counts.placement.pending : 0;
  const followUpCount = caseload?.followUps.length ?? 0;

  const tabs: { key: TabKey; label: string; icon: typeof Users; badge?: number }[] = [
    { key: 'caseload', label: isPeer ? 'My caseload' : 'Peer caseload', icon: Users },
    { key: 'followups', label: 'Follow-ups', icon: CalendarClock, badge: followUpCount || undefined },
    { key: 'contacts', label: 'Contact log', icon: MessageSquare },
    { key: 'goals', label: 'Goals', icon: Target },
    { key: 'placements', label: 'Community placements', icon: MapPin },
    { key: 'resources', label: 'Community resources', icon: BookMarked },
    ...(legacy && legacyPending > 0 ? [{ key: 'legacy' as const, label: 'Legacy entries', icon: History, badge: legacyPending }] : []),
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Peer Support</h1>
          <p className="mt-1 text-sm text-slate-500">
            {isPeer
              ? 'Clients you are assigned to or on the care team of: contacts, recovery goals and community placements.'
              : 'Peer specialist contacts, recovery goals and community placements for clients in your scope.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAssign && (
            <button type="button" className={secondaryBtn} onClick={() => setAssigning(true)}>
              <UserPlus size={16} /> Assign a peer specialist
            </button>
          )}
          <button type="button" className={primaryBtn} onClick={() => setContactFor(null)}>
            <Plus size={16} /> Log contact
          </button>
        </div>
      </div>

      {toast && <p className="rounded-xl bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800">{toast}</p>}
      {error && <p className="rounded-xl bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label={isPeer ? 'Clients on my caseload' : 'Clients with peer support'} value={s?.caseloadSize} icon={Users} />
        <Tile label="Contacts this month" value={s?.contactsThisMonth} icon={Phone} />
        <Tile label="Clients engaged, last 30 days" value={s?.clientsEngaged30d} icon={CheckCircle2} sub={s && s.caseloadSize ? `of ${s.caseloadSize}` : undefined} />
        <Tile label="Open goals" value={s?.openGoals} icon={Target} />
        <Tile
          label="Follow-ups overdue"
          value={s?.followUpsOverdue}
          icon={CalendarClock}
          tone={s && s.followUpsOverdue > 0 ? 'rose' : undefined}
          sub={s ? `${s.followUpsDueToday} due today` : undefined}
        />
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === t.key ? 'bg-white text-blue-600 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <t.icon size={15} />
            {t.label}
            {t.badge ? <span className="rounded-full bg-blue-600 px-1.5 text-[11px] text-white">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">Loading peer support…</p>
      ) : !caseload ? null : (
        <>
          {tab === 'caseload' && (
            <CaseloadTable
              caseload={caseload}
              isPeer={isPeer}
              onLog={(c) => setContactFor(c)}
              onGoal={(c) => {
                setGoalFor(c);
                setTab('goals');
              }}
            />
          )}
          {tab === 'followups' && <FollowUps caseload={caseload} onLog={(c) => setContactFor(c)} onChanged={load} />}
          {tab === 'contacts' && <ContactLog onChanged={load} />}
          {tab === 'goals' && (
            <GoalsBoard key={goalsVersion} caseload={picks} addFor={goalFor} onAddHandled={() => setGoalFor(undefined)} onChanged={load} />
          )}
          {tab === 'placements' && <PlacementsPanel caseload={picks} resources={resources} />}
          {tab === 'resources' && <ResourcesPanel resources={resources} canManage={canManageDirectory} />}
          {tab === 'legacy' && legacy && (
            <LegacyPanel
              overview={legacy}
              myUserId={user?.id ?? null}
              onFiled={() => {
                setToast('Entry filed to the client as a legacy record.');
                setGoalsVersion((v) => v + 1);
                void load();
              }}
            />
          )}
        </>
      )}

      {contactFor !== false && (
        <ContactForm
          caseload={picks}
          initialClient={contactFor}
          openFollowUps={caseload?.followUps ?? []}
          onClose={() => setContactFor(false)}
          onSaved={(msg) => {
            setContactFor(false);
            setToast(msg);
            void load();
          }}
        />
      )}
      {assigning && caseload && (
        <AssignPeer
          peers={caseload.peers}
          onClose={() => setAssigning(false)}
          onSaved={(msg) => {
            setAssigning(false);
            setToast(msg);
            void load();
          }}
        />
      )}
    </div>
  );
}

function Tile({ label, value, icon: Icon, sub, tone }: { label: string; value: number | undefined; icon: typeof Users; sub?: string; tone?: 'rose' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
      <div className="flex items-start justify-between">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <span className={`grid h-8 w-8 place-items-center rounded-xl ${tone === 'rose' ? 'bg-rose-50 text-rose-600' : 'bg-blue-600/10 text-blue-600'}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900">{value ?? '—'}</p>
      {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

function CaseloadTable({ caseload, isPeer, onLog, onGoal }: { caseload: Caseload; isPeer: boolean; onLog: (c: PickedClient) => void; onGoal: (c: PickedClient) => void }) {
  if (caseload.clients.length === 0) {
    return (
      <EmptyState title={isPeer ? 'No clients on your caseload yet' : 'No clients with peer support yet'}>
        {isPeer
          ? 'Clients appear here when you are added to their care team (or made their assigned staff). Ask the client’s clinician or a director to add you.'
          : 'Add a peer specialist to a client’s care team with “Assign a peer specialist”, or log a contact.'}
      </EmptyState>
    );
  }
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
          <tr>
            <th scope="col" className={`${stickyFirstTh} px-4 py-2`}>Client</th>
            {!isPeer && <th className="px-4 py-2">Peer specialist</th>}
            <th className="px-4 py-2">Last contact</th>
            <th className="px-4 py-2">Next follow-up</th>
            <th className="px-4 py-2">Open goals</th>
            <th scope="col" className={`${stickyLastTh} px-4 py-2`}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {caseload.clients.map((c) => {
            const overdue = c.nextFollowUpAt && c.nextFollowUpAt.slice(0, 10) < today;
            return (
              <tr key={c.id}>
                <td className={`${stickyFirstTd} max-w-[14rem] px-4 py-2`}>
                  <span className="font-medium text-slate-900">{c.name}</span>
                  {c.status === 'INACTIVE' && <span className="ml-2 text-xs text-slate-500">Inactive</span>}
                  {isPeer && c.assignment === 'assigned' && <span className="ml-2 text-xs text-slate-500">Assigned</span>}
                </td>
                {!isPeer && <td className="px-4 py-2 text-slate-600">{c.peerSpecialists.join(', ') || '—'}</td>}
                <td className="px-4 py-2 text-slate-600" title={formatDateTime(c.lastContactAt)}>{relativeDays(c.lastContactAt)}</td>
                <td className="px-4 py-2">
                  {c.nextFollowUpAt ? <Pill tone={overdue ? 'rose' : 'sky'}>{formatDate(c.nextFollowUpAt)}</Pill> : <span className="text-slate-500">—</span>}
                </td>
                <td className="px-4 py-2 text-slate-600">{c.openGoals}</td>
                <td className={`${stickyLastTd} px-4 py-2 text-right`}>
                  <div className="flex justify-end gap-3 whitespace-nowrap">
                    <button type="button" className="min-h-10 text-xs font-semibold text-blue-600 hover:underline sm:min-h-0" onClick={() => onLog({ id: c.id, name: c.name })}>Log contact</button>
                    <button type="button" className="min-h-10 text-xs font-semibold text-blue-600 hover:underline sm:min-h-0" onClick={() => onGoal({ id: c.id, name: c.name })}>Add goal</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {caseload.truncated && <p className="px-4 py-2 text-xs text-slate-500">Showing the first 500 clients.</p>}
    </div>
  );
}

function FollowUps({ caseload, onLog, onChanged }: { caseload: Caseload; onLog: (c: PickedClient) => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function done(id: string) {
    setBusy(id);
    try {
      await peerApi.updateContact(id, { followUpDone: true });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update');
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {caseload.followUps.length === 0 ? (
        <EmptyState title="No follow-ups due or overdue">
          {caseload.upcomingFollowUps ? `${caseload.upcomingFollowUps} upcoming.` : 'Set a follow-up date when you log a contact.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {caseload.followUps.map((f) => (
            <li key={f.contactId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-900">{f.clientName}</p>
                <p className="text-xs text-slate-500">
                  Due {formatDate(f.followUpAt)} · set after a {CONTACT_MODE_LABEL[f.lastContactMode as ContactMode]?.toLowerCase() ?? f.lastContactMode} contact
                  {f.peerName && !f.mine ? ` by ${f.peerName}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Pill tone={f.state === 'overdue' ? 'rose' : 'amber'}>{f.state === 'overdue' ? 'Overdue' : 'Due today'}</Pill>
                <button type="button" className={secondaryBtn} onClick={() => onLog({ id: f.clientId, name: f.clientName })}>Log contact</button>
                <button type="button" className={secondaryBtn} disabled={busy === f.contactId} onClick={() => void done(f.contactId)}>Mark done</button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {caseload.upcomingFollowUps > 0 && caseload.followUps.length > 0 && <p className="text-xs text-slate-500">{caseload.upcomingFollowUps} more upcoming.</p>}
    </div>
  );
}

function ContactLog({ onChanged }: { onChanged: () => void }) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<PeerContactDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<PeerContactDto | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await peerApi.contacts({ days });
      setRows(r.contacts);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load contacts');
    } finally {
      setLoading(false);
    }
  }, [days]);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-600" htmlFor="pc-days">Show</label>
        <select id="pc-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm">
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last 12 months</option>
        </select>
      </div>
      {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {loading ? (
        <p className="text-sm text-slate-500">Loading contacts…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No contacts in this period" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {rows.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" onClick={() => setOpen(open === c.id ? null : c.id)}>
                <span>
                  <span className="font-medium text-slate-900">{c.clientName}</span>{' '}
                  <span className="text-xs text-slate-500">
                    {formatDateTime(c.contactAt)} · {CONTACT_MODE_LABEL[c.mode as ContactMode] ?? c.mode}
                    {c.durationMinutes ? ` · ${c.durationMinutes} min` : ''}
                    {c.peerName ? ` · ${c.peerName}` : ''}
                  </span>{' '}
                  {c.source === 'legacy' && <LegacyBadge />}
                </span>
                <span className="flex flex-wrap gap-1">
                  {c.topics.slice(0, 4).map((t) => (
                    <Pill key={t}>{t}</Pill>
                  ))}
                </span>
              </button>
              {open === c.id && (
                <div className="mt-2 space-y-2 text-sm text-slate-700">
                  {c.notes ? <p className="whitespace-pre-wrap">{c.notes}</p> : <p className="text-slate-500">No note.</p>}
                  {c.followUpAt && (
                    <p className="text-xs text-slate-500">
                      Follow-up {formatDate(c.followUpAt)}
                      {c.followUpDoneAt ? ` · done ${formatDate(c.followUpDoneAt)}` : ''}
                    </p>
                  )}
                  {c.canEdit && (
                    <button type="button" className="text-xs font-semibold text-rose-700 hover:underline" onClick={() => setVoiding(c)}>
                      Void this entry
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {voiding && (
        <VoidForm
          contact={voiding}
          onClose={() => setVoiding(null)}
          onSaved={async () => {
            setVoiding(null);
            await load();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function VoidForm({ contact, onClose, onSaved }: { contact: PeerContactDto; onClose: () => void; onSaved: () => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      await peerApi.voidContact(contact.id, reason.trim());
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not void');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Void contact" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-600">
        The entry stays on record but no longer shows in lists or counts. Contact with {contact.clientName} on {formatDate(contact.contactAt)}.
      </p>
      <label className={labelCls} htmlFor="void-reason">Reason</label>
      <input id="void-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} className={inputCls} placeholder="e.g. Logged for the wrong client" />
      {error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
        <button type="button" onClick={save} disabled={saving || reason.trim().length < 3} className={primaryBtn}>Void</button>
      </div>
    </Modal>
  );
}

/** Adds a peer specialist to the client's treatment team through the existing care-team API. */
function AssignPeer({ peers, onClose, onSaved }: { peers: { id: string; name: string }[]; onClose: () => void; onSaved: (msg: string) => void }) {
  const [client, setClient] = useState<PickedClient | null>(null);
  const [peerId, setPeerId] = useState(peers[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!client || !peerId) return;
    setSaving(true);
    setError(null);
    try {
      await peerApi.assignPeer(client.id, peerId);
      onSaved(`${peers.find((p) => p.id === peerId)?.name ?? 'Peer specialist'} added to ${client.name}'s care team.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not assign');
    } finally {
      setSaving(false);
    }
  }
  return (
    <Modal title="Assign a peer specialist" onClose={onClose}>
      {peers.length === 0 ? (
        <p className="text-sm text-slate-600">No active staff have the Peer Support role in this clinic.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Client</label>
            <ClientPicker caseload={[]} value={client} onChange={setClient} hint="The peer specialist is added to this client’s care team and sees peer support records for them only." />
          </div>
          <div>
            <label className={labelCls} htmlFor="assign-peer">Peer specialist</label>
            <select id="assign-peer" value={peerId} onChange={(e) => setPeerId(e.target.value)} className={inputCls}>
              {peers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
            <button type="button" onClick={save} disabled={saving || !client} className={primaryBtn}>
              <ListChecks size={16} /> Add to care team
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
