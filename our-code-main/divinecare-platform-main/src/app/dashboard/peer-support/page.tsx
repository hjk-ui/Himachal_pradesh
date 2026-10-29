'use client';

import { Fragment, useMemo, useState } from 'react';
import {
  Award,
  BookOpen,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Filter,
  GraduationCap,
  Heart,
  Home,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Target,
  TrendingUp,
  Users,
  UsersRound,
  X,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import {
  type CommunityPlacement,
  type ContactEntry,
  type ContactType,
  type GoalStatus,
  type PeerMeta,
  type PlacementType,
  type RecoveryGoal,
  CONTACT_TYPES,
  DEFAULT_SPECIALIST,
  PEER_META_SEED,
  formatMonthYear,
  formatPeerDate,
  normalizeGoal,
  startOfMonth,
} from '@/features/compliance/peerSupportData';

type TabKey = 'contacts' | 'goals' | 'community';
type ContactFilter = 'week' | 'month' | 'mine' | 'all';

const CONTACT_TYPE_STYLE: Record<ContactType, string> = {
  'Individual phone call': 'bg-sky-100 text-sky-800',
  'In-person meeting': 'bg-emerald-100 text-emerald-800',
  'Group session': 'bg-violet-100 text-violet-800',
  'Community outing': 'bg-orange-100 text-orange-800',
  'Employment support': 'bg-amber-100 text-amber-800',
  'Crisis support': 'bg-red-100 text-red-800',
  'Peer check-in': 'bg-indigo-100 text-indigo-800',
  'Family meeting': 'bg-pink-100 text-pink-800',
};

const GOAL_STATUS_STYLE: Record<GoalStatus, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  'In Progress': 'bg-amber-50 text-amber-800',
  Completed: 'bg-indigo-50 text-indigo-700',
  'On Hold': 'bg-slate-100 text-slate-600',
};

const PLACEMENT_STATUS: Record<string, string> = {
  Active: 'bg-emerald-50 text-emerald-700',
  Pending: 'bg-orange-50 text-orange-800',
  Completed: 'bg-slate-100 text-slate-600',
  Ended: 'bg-slate-100 text-slate-500',
};

const PLACEMENT_ICON: Record<PlacementType, typeof Heart> = {
  Volunteer: Heart,
  'Competitive Employment': Building2,
  'Social Club': UsersRound,
  'Housing Program': Home,
  Education: GraduationCap,
  Internship: Building2,
};

const PLACEMENT_ICON_COLOR: Record<PlacementType, string> = {
  Volunteer: 'text-violet-600 bg-violet-50',
  'Competitive Employment': 'text-emerald-600 bg-emerald-50',
  'Social Club': 'text-orange-600 bg-orange-50',
  'Housing Program': 'text-sky-600 bg-sky-50',
  Education: 'text-indigo-600 bg-indigo-50',
  Internship: 'text-teal-600 bg-teal-50',
};

const emptyContact = {
  date: new Date().toISOString().slice(0, 10),
  client: '',
  contactType: 'Individual phone call' as ContactType,
  duration: 30,
  topics: '',
  goalsAddressed: '',
  response: '',
  specialist: DEFAULT_SPECIALIST,
};

const emptyGoal = {
  client: '',
  title: '',
  status: 'Active' as GoalStatus,
  daysIn: 0,
  goalDays: 90,
  notes: '',
};

const emptyPlacement = {
  client: '',
  activityType: 'Volunteer' as PlacementType,
  organization: '',
  startDate: '',
  status: 'Pending' as CommunityPlacement['status'],
  hoursPerWeek: '',
  notes: '',
};

export default function PeerSupportPage() {
  const [contacts, setContacts, { loading: loadingC }] = useModuleList<ContactEntry>('peer-contacts', []);
  const [goalsRaw, setGoals, { loading: loadingG }] = useModuleList<RecoveryGoal>('peer-goals', []);
  const [placements, setPlacements, { loading: loadingP }] = useModuleList<CommunityPlacement>(
    'peer-placements',
    []
  );
  const [metaList] = useModuleList<PeerMeta>('peer-meta', []);

  const [tab, setTab] = useState<TabKey>('contacts');
  const [contactFilter, setContactFilter] = useState<ContactFilter>('week');
  const [expandedContact, setExpandedContact] = useState<string | null>(null);
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({
    'Darnell P.': true,
    'Marcus T.': true,
  });
  const [showContactModal, setShowContactModal] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalModalClient, setGoalModalClient] = useState('');
  const [showPlacementModal, setShowPlacementModal] = useState(false);
  const [contactForm, setContactForm] = useState(emptyContact);
  const [goalForm, setGoalForm] = useState(emptyGoal);
  const [placementForm, setPlacementForm] = useState(emptyPlacement);

  const loading = loadingC || loadingG || loadingP;
  const goals = useMemo(() => goalsRaw.map(normalizeGoal), [goalsRaw]);
  const meta: PeerMeta = metaList[0]?.version === 1 ? metaList[0] : PEER_META_SEED;

  const clients = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) if (!c.client.startsWith('Group')) set.add(c.client);
    for (const g of goals) set.add(g.client);
    for (const p of placements) set.add(p.client);
    return [...set].sort();
  }, [contacts, goals, placements]);

  const filteredContacts = useMemo(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 6);
    const weekStart = weekAgo.toISOString().slice(0, 10);
    const monthStart = startOfMonth();
    return contacts
      .filter((c) => {
        if (contactFilter === 'week') return c.date >= weekStart;
        if (contactFilter === 'month') return c.date >= monthStart;
        if (contactFilter === 'mine') return c.specialist === DEFAULT_SPECIALIST;
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [contacts, contactFilter]);

  const goalsByClient = useMemo(() => {
    const map = new Map<string, RecoveryGoal[]>();
    for (const g of goals) {
      if (!map.has(g.client)) map.set(g.client, []);
      map.get(g.client)!.push(g);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [goals]);

  function saveContact() {
    if (!contactForm.client.trim() || !contactForm.response.trim()) return;
    const next: ContactEntry = {
      id: `pc-${Date.now()}`,
      date: contactForm.date,
      client: contactForm.client.trim(),
      contactType: contactForm.contactType,
      duration: Number(contactForm.duration) || 0,
      topics: contactForm.topics
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      goalsAddressed: contactForm.goalsAddressed
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      response: contactForm.response.trim(),
      specialist: contactForm.specialist || DEFAULT_SPECIALIST,
    };
    setContacts((prev) => [next, ...prev]);
    setContactForm(emptyContact);
    setShowContactModal(false);
    setTab('contacts');
    setExpandedContact(next.id);
  }

  function saveGoal() {
    if (!goalForm.client.trim() || !goalForm.title.trim()) return;
    const progress =
      goalForm.goalDays > 0
        ? Math.min(100, Math.round((goalForm.daysIn / goalForm.goalDays) * 100))
        : 10;
    const next: RecoveryGoal = {
      id: `pg-${Date.now()}`,
      client: goalForm.client.trim(),
      title: goalForm.title.trim(),
      status: goalForm.status,
      daysIn: goalForm.daysIn,
      goalDays: goalForm.goalDays,
      progress,
      notes: goalForm.notes.trim(),
    };
    setGoals((prev) => [next, ...prev]);
    setExpandedClients((prev) => ({ ...prev, [next.client]: true }));
    setGoalForm(emptyGoal);
    setShowGoalModal(false);
    setTab('goals');
  }

  function savePlacement() {
    if (!placementForm.client.trim() || !placementForm.organization.trim()) return;
    const next: CommunityPlacement = {
      id: `pp-${Date.now()}`,
      client: placementForm.client.trim(),
      activityType: placementForm.activityType,
      organization: placementForm.organization.trim(),
      startDate: placementForm.startDate || null,
      status: placementForm.status,
      hoursPerWeek: placementForm.hoursPerWeek ? Number(placementForm.hoursPerWeek) : null,
      notes: placementForm.notes.trim(),
    };
    setPlacements((prev) => [next, ...prev]);
    setPlacementForm(emptyPlacement);
    setShowPlacementModal(false);
    setTab('community');
  }

  function cycleGoalStatus(id: string) {
    const order: GoalStatus[] = ['Active', 'In Progress', 'Completed', 'On Hold'];
    setGoals((prev) =>
      prev.map((g) => {
        if (g.id !== id) return g;
        const next = order[(order.indexOf(g.status) + 1) % order.length];
        return {
          ...g,
          status: next,
          progress: next === 'Completed' ? 100 : g.progress,
        };
      })
    );
  }

  if (loading && contacts.length === 0 && goals.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Peer Support</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Peer specialist contact logs, recovery goal tracking, and community integration
            documentation
          </p>
        </div>
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          Loading peer support…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Peer Support</h1>
          <p className="mt-1 text-sm text-slate-500">
            Peer specialist contact logs, recovery goal tracking, and community integration
            documentation
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowContactModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
        >
          <Plus size={16} />
          New Contact
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Active Peer Clients</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <Users size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{meta.activePeerClients}</p>
          <p className="mt-1 text-xs text-slate-500">{meta.newClientsThisMonth} new this month</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Contacts This Week</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
              <Phone size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{meta.contactsThisWeekLabel}</p>
          <p className="mt-1 text-xs text-emerald-600">+{meta.contactsVsLastWeek} vs last week</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Recovery Goals Active</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-violet-50 text-violet-600">
              <Target size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">{meta.recoveryGoalsActive}</p>
          <p className="mt-1 text-xs text-slate-500">
            {meta.goalsCompletedQuarter} completed this quarter
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between">
            <p className="text-xs font-medium text-slate-500">Community Placements</p>
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600">
              <MapPin size={18} />
            </span>
          </div>
          <p className="mt-2 text-3xl font-bold text-slate-900">
            {placements.length || meta.communityPlacements}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {meta.employmentCount} employment, {meta.volunteerSocialCount} volunteer/social
          </p>
        </div>
      </div>

      <div className="flex w-fit flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {(
          [
            { id: 'contacts' as const, label: 'Contact Log', icon: MessageSquare },
            { id: 'goals' as const, label: 'Recovery Goals', icon: Target },
            { id: 'community' as const, label: 'Community Integration', icon: MapPin },
          ]
        ).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
                active ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <t.icon size={15} className={active ? 'text-indigo-600' : ''} />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'contacts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Filter size={14} className="text-slate-400" />
              <span className="text-xs font-semibold text-slate-500">Filter:</span>
              {(
                [
                  { id: 'week' as const, label: 'This Week' },
                  { id: 'month' as const, label: 'This Month' },
                  { id: 'mine' as const, label: 'My Contacts' },
                  { id: 'all' as const, label: 'All Contacts' },
                ]
              ).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setContactFilter(f.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    contactFilter === f.id
                      ? 'bg-indigo-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-500">{filteredContacts.length} entries</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Contact Type</th>
                    <th className="px-4 py-3">Duration</th>
                    <th className="px-4 py-3">Topics</th>
                    <th className="px-4 py-3">Goal Addressed</th>
                    <th className="px-4 py-3">Peer Specialist</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filteredContacts.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-sm text-slate-500">
                        No contacts for this filter.
                      </td>
                    </tr>
                  )}
                  {filteredContacts.map((c) => {
                    const open = expandedContact === c.id;
                    return (
                      <Fragment key={c.id}>
                        <tr
                          className="cursor-pointer border-b border-slate-100 hover:bg-slate-50/70"
                          onClick={() => setExpandedContact(open ? null : c.id)}
                        >
                          <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                            {formatPeerDate(c.date)}
                          </td>
                          <td className="px-4 py-3.5 font-semibold text-slate-900">{c.client}</td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${CONTACT_TYPE_STYLE[c.contactType]}`}
                            >
                              {c.contactType}
                            </span>
                          </td>
                          <td className="px-4 py-3.5">
                            <span className="inline-flex items-center gap-1 text-slate-600">
                              <Clock size={13} className="text-slate-400" />
                              {c.duration} min
                            </span>
                          </td>
                          <td className="max-w-[180px] truncate px-4 py-3.5 text-slate-600">
                            {c.topics.join(', ')}
                          </td>
                          <td className="max-w-[180px] truncate px-4 py-3.5 text-slate-600">
                            {c.goalsAddressed.join(', ') || '—'}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3.5 text-slate-600">
                            {c.specialist}
                          </td>
                          <td className="px-4 py-3.5 text-slate-400">
                            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                          </td>
                        </tr>
                        {open && (
                          <tr className="border-b border-slate-100 bg-slate-50/40">
                            <td colSpan={8} className="px-4 py-4">
                              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                                Response / outcome
                              </p>
                              <p className="mt-1 text-sm text-slate-700">{c.response}</p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowContactModal(true)}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-indigo-200 bg-white py-3 text-sm font-semibold text-indigo-600 hover:bg-indigo-50/50"
          >
            <Plus size={16} />
            Log New Contact
          </button>

          {/* CPRS credential card */}
          <div className="rounded-2xl border border-amber-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Award size={20} className="text-amber-500" />
              <h2 className="text-sm font-bold text-slate-900">CPRS Credential — Active Peer Specialist</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Peer Specialist
                </p>
                <p className="mt-1 font-semibold text-slate-900">{meta.cprs.name}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Certification Date
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-slate-700">
                  <Calendar size={14} className="text-slate-400" />
                  {formatMonthYear(meta.cprs.certificationDate)}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Renewal Due
                </p>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-orange-600">
                  <Calendar size={14} />
                  {formatMonthYear(meta.cprs.renewalDue)}
                </p>
                {meta.cprs.renewalOverdue && (
                  <p className="mt-1 text-xs font-semibold text-red-600">
                    Renewal overdue — action required
                  </p>
                )}
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  Clinical Supervision
                </p>
                <p className="mt-1 text-sm text-slate-700">{meta.cprs.clinicalSupervision}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="inline-flex items-center gap-2 text-xs text-slate-500">
                <TrendingUp size={14} className="text-slate-400" />
                Last supervision: {formatPeerDate(meta.cprs.lastSupervision)} — next scheduled:{' '}
                {formatPeerDate(meta.cprs.nextSupervision)}
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <BookOpen size={14} />
                CEU Tracker
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === 'goals' && (
        <div className="space-y-4">
          <p className="text-sm text-slate-500">
            Recovery goals are self-defined by the client alongside their peer specialist — distinct
            from clinical treatment plan goals.
          </p>
          {goalsByClient.map(([client, clientGoals]) => {
            const open = expandedClients[client] !== false;
            const activeCount = clientGoals.filter(
              (g) => g.status === 'Active' || g.status === 'In Progress'
            ).length;
            return (
              <div
                key={client}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedClients((prev) => ({ ...prev, [client]: !open }))
                  }
                  className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
                      <Heart size={18} />
                    </span>
                    <div>
                      <p className="font-bold text-slate-900">{client}</p>
                      <p className="text-xs text-slate-500">{activeCount} active goals</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span>{clientGoals.length} total</span>
                    {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>
                </button>
                {open && (
                  <div className="space-y-3 border-t border-slate-100 px-4 py-4">
                    {clientGoals.map((g) => {
                      const pct =
                        g.goalDays > 0
                          ? Math.min(100, Math.round((g.daysIn / g.goalDays) * 100))
                          : g.progress;
                      return (
                        <div
                          key={g.id}
                          className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-3"
                        >
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-violet-50 text-violet-600">
                            <Target size={14} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="font-semibold text-slate-900">{g.title}</p>
                              <button
                                type="button"
                                onClick={() => cycleGoalStatus(g.id)}
                                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${GOAL_STATUS_STYLE[g.status]}`}
                                title="Click to cycle status"
                              >
                                {g.status}
                              </button>
                            </div>
                            <div className="mt-2">
                              <div className="mb-1 flex justify-between text-[11px] text-slate-500">
                                <span>
                                  {g.daysIn} days in
                                  {g.notes ? ` · ${g.notes}` : ''}
                                </span>
                                {g.goalDays > 0 && <span>Goal: {g.goalDays} days</span>}
                              </div>
                              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => {
                        setGoalForm({ ...emptyGoal, client });
                        setGoalModalClient(client);
                        setShowGoalModal(true);
                      }}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      <Plus size={14} />
                      Add Recovery Goal
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === 'community' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-500">
              Employment, education, volunteer, and social community placements supported by peer
              specialists.
            </p>
            <button
              type="button"
              onClick={() => setShowPlacementModal(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              <Plus size={16} />
              Add Placement
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Client</th>
                    <th className="px-4 py-3">Activity Type</th>
                    <th className="px-4 py-3">Organization</th>
                    <th className="px-4 py-3">Start Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Hrs/Wk</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {placements.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-sm text-slate-500">
                        No community placements yet.
                      </td>
                    </tr>
                  )}
                  {placements.map((p) => {
                    const Icon = PLACEMENT_ICON[p.activityType] || MapPin;
                    const iconColor = PLACEMENT_ICON_COLOR[p.activityType] || 'text-slate-600 bg-slate-50';
                    return (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0">
                        <td className="px-4 py-3.5 font-semibold text-slate-900">{p.client}</td>
                        <td className="px-4 py-3.5">
                          <span className="inline-flex items-center gap-2 text-slate-700">
                            <span
                              className={`grid h-7 w-7 place-items-center rounded-lg ${iconColor}`}
                            >
                              <Icon size={14} />
                            </span>
                            {p.activityType}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">{p.organization}</td>
                        <td className="px-4 py-3.5 text-slate-600">
                          {p.startDate ? (
                            <span className="inline-flex items-center gap-1">
                              <Calendar size={13} className="text-slate-400" />
                              {formatPeerDate(p.startDate)}
                            </span>
                          ) : (
                            <span className="text-orange-600">Pending</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PLACEMENT_STATUS[p.status]}`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-700">
                          {p.hoursPerWeek != null ? p.hoursPerWeek : 'N/A'}
                        </td>
                        <td className="max-w-[280px] px-4 py-3.5 text-slate-600">{p.notes}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Contact modal */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Log New Contact</h2>
                <p className="text-sm text-slate-500">Document peer engagement and goals addressed</p>
              </div>
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <label className="space-y-1 text-sm sm:col-span-1">
                <span className="font-medium text-slate-700">Date</span>
                <input
                  type="date"
                  value={contactForm.date}
                  onChange={(e) => setContactForm({ ...contactForm, date: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Client</span>
                <input
                  list="peer-clients"
                  value={contactForm.client}
                  onChange={(e) => setContactForm({ ...contactForm, client: e.target.value })}
                  placeholder="e.g. Darnell P."
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <datalist id="peer-clients">
                  {clients.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Contact type</span>
                <select
                  value={contactForm.contactType}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, contactType: e.target.value as ContactType })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  {CONTACT_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium text-slate-700">Duration (min)</span>
                <input
                  type="number"
                  min={5}
                  value={contactForm.duration}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, duration: Number(e.target.value) })
                  }
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Topics (comma-separated)</span>
                <input
                  value={contactForm.topics}
                  onChange={(e) => setContactForm({ ...contactForm, topics: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Goal addressed</span>
                <input
                  value={contactForm.goalsAddressed}
                  onChange={(e) =>
                    setContactForm({ ...contactForm, goalsAddressed: e.target.value })
                  }
                  placeholder="Recovery goal: …"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
              <label className="space-y-1 text-sm sm:col-span-2">
                <span className="font-medium text-slate-700">Response / outcome</span>
                <textarea
                  rows={3}
                  value={contactForm.response}
                  onChange={(e) => setContactForm({ ...contactForm, response: e.target.value })}
                  className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowContactModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveContact}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Save contact
              </button>
            </div>
          </div>
        </div>
      )}

      {showGoalModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">
                Add Recovery Goal{goalModalClient ? ` — ${goalModalClient}` : ''}
              </h2>
              <button type="button" onClick={() => setShowGoalModal(false)} className="p-2 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-3 p-5">
              {!goalModalClient && (
                <input
                  value={goalForm.client}
                  onChange={(e) => setGoalForm({ ...goalForm, client: e.target.value })}
                  placeholder="Client"
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              )}
              <input
                value={goalForm.title}
                onChange={(e) => setGoalForm({ ...goalForm, title: e.target.value })}
                placeholder="Goal description"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  min={0}
                  value={goalForm.daysIn}
                  onChange={(e) => setGoalForm({ ...goalForm, daysIn: Number(e.target.value) })}
                  placeholder="Days in"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
                <input
                  type="number"
                  min={1}
                  value={goalForm.goalDays}
                  onChange={(e) => setGoalForm({ ...goalForm, goalDays: Number(e.target.value) })}
                  placeholder="Goal days"
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <textarea
                rows={2}
                value={goalForm.notes}
                onChange={(e) => setGoalForm({ ...goalForm, notes: e.target.value })}
                placeholder="Notes (optional)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowGoalModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveGoal}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Save goal
              </button>
            </div>
          </div>
        </div>
      )}

      {showPlacementModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-bold text-slate-900">Add Placement</h2>
              <button
                type="button"
                onClick={() => setShowPlacementModal(false)}
                className="p-2 text-slate-500"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid gap-3 p-5 sm:grid-cols-2">
              <input
                list="peer-clients"
                value={placementForm.client}
                onChange={(e) => setPlacementForm({ ...placementForm, client: e.target.value })}
                placeholder="Client"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
              />
              <select
                value={placementForm.activityType}
                onChange={(e) =>
                  setPlacementForm({
                    ...placementForm,
                    activityType: e.target.value as PlacementType,
                  })
                }
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {(Object.keys(PLACEMENT_ICON) as PlacementType[]).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <select
                value={placementForm.status}
                onChange={(e) =>
                  setPlacementForm({
                    ...placementForm,
                    status: e.target.value as CommunityPlacement['status'],
                  })
                }
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              >
                {['Active', 'Pending', 'Completed', 'Ended'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
              <input
                value={placementForm.organization}
                onChange={(e) =>
                  setPlacementForm({ ...placementForm, organization: e.target.value })
                }
                placeholder="Organization"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
              />
              <input
                type="date"
                value={placementForm.startDate}
                onChange={(e) => setPlacementForm({ ...placementForm, startDate: e.target.value })}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="number"
                value={placementForm.hoursPerWeek}
                onChange={(e) =>
                  setPlacementForm({ ...placementForm, hoursPerWeek: e.target.value })
                }
                placeholder="Hrs/Wk"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              />
              <textarea
                rows={2}
                value={placementForm.notes}
                onChange={(e) => setPlacementForm({ ...placementForm, notes: e.target.value })}
                placeholder="Notes"
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm sm:col-span-2"
              />
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={() => setShowPlacementModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={savePlacement}
                className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Save placement
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
