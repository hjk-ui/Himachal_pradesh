'use client';

import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Clock,
  FileText,
  Filter,
  Lock,
  MapPin,
  Plus,
  Search,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useModuleList } from '@/lib/modules/useModuleList';
import { useClients } from '@/features/clients';

type SessionStatus = 'scheduled' | 'active' | 'finalized';
type GroupType = 'Psychotherapy' | 'PRP';
type AttendanceStatus = 'Present' | 'Absent' | 'Excused' | 'Late';
type MembershipStatus = 'Active' | 'Inactive';
type NoteStatus = 'draft' | 'signed' | 'locked';
type OccurrenceStatus = 'upcoming' | 'completed' | 'cancelled';

interface GroupOccurrence {
  id: string;
  date: string;
  startTime: string;
  duration: number;
  status: OccurrenceStatus;
}

interface GroupMember {
  id: string;
  clientId: string;
  name: string;
  membershipStatus: MembershipStatus;
  membershipStart: string;
  membershipEnd: string | null;
  attendance: AttendanceStatus;
  arrivalTime: string | null;
  departureTime: string | null;
  individualNote: string;
}

interface GroupNote {
  status: NoteStatus;
  commonText: string;
  individualized: Record<string, string>;
  cosignRequired: boolean;
  signedBy: string | null;
  signedAt: string | null;
  lockedAt: string | null;
}

interface GroupSession {
  id: string;
  name: string;
  groupType: GroupType;
  description: string;
  facilitator: string;
  additionalStaff: string[];
  location: string;
  mode: 'In-person' | 'Telehealth';
  startDate: string;
  endDate: string | null;
  recurrence: {
    frequency: 'Weekly' | 'Biweekly';
    days: string[];
    startTime: string;
    duration: number;
    timezone: string;
  };
  capacity: number;
  active: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  nextSession: string;
  occurrences: GroupOccurrence[];
  members: GroupMember[];
  note: GroupNote;
  prp: {
    serviceCode: 'H2017' | null;
    dailyAttendanceRequired: boolean;
    comarChecklist: string[];
  };
}

interface CreateGroupForm {
  name: string;
  groupType: GroupType;
  facilitator: string;
  location: string;
  mode: 'In-person';
  frequency: 'Weekly' | 'Biweekly';
  day: string;
  startTime: string;
  duration: number;
  capacity: number;
}

const today = new Date().toISOString().slice(0, 10);

const INITIAL_GROUPS: GroupSession[] = [];

const STATUS_META: Record<SessionStatus, { label: string; color: string; bg: string }> = {
  scheduled: { label: 'Scheduled', color: '#6366f1', bg: '#eef2ff' },
  active: { label: 'In progress', color: '#d97706', bg: '#fef3c7' },
  finalized: { label: 'Finalized', color: '#0f766e', bg: '#ccfbf1' },
};

const ATTENDANCE_META: Record<AttendanceStatus, string> = {
  Present: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  Late: 'bg-amber-50 text-amber-700 ring-amber-100',
  Excused: 'bg-blue-50 text-blue-700 ring-blue-100',
  Absent: 'bg-rose-50 text-rose-700 ring-rose-100',
};

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function GroupBadge({ status }: { status: SessionStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: meta.color, background: meta.bg }}>
      {meta.label}
    </span>
  );
}

function sessionStatusFromNoteStatus(status: NoteStatus): SessionStatus {
  if (status === 'locked') return 'finalized';
  if (status === 'signed') return 'active';
  return 'scheduled';
}

function PanelTitle({
  title,
  description,
  icon,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="text-sm font-bold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-slate-500">{description}</p> : null}
      </div>
      {icon ? <div className="text-slate-400">{icon}</div> : null}
    </div>
  );
}

export default function GroupSessionsPage() {
  const { clients } = useClients();
  const clientPool = useMemo(
    () => clients.map((client) => ({ id: client.id, name: client.name })),
    [clients]
  );
  const [groups, setGroups] = useModuleList<GroupSession>('group-sessions', INITIAL_GROUPS);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | GroupType>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | SessionStatus>('all');
  const [facilitatorFilter, setFacilitatorFilter] = useState<'all' | string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [newMemberId, setNewMemberId] = useState('');
  const [newGroup, setNewGroup] = useState<CreateGroupForm>({
    name: '',
    groupType: 'Psychotherapy' as GroupType,
    facilitator: 'Dr. Renee Jackson, LCSW',
    location: 'Room A',
    mode: 'In-person',
    frequency: 'Weekly',
    day: 'Tuesday',
    startTime: '10:00',
    duration: 60,
    capacity: 10,
  });

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      const searchHit =
        group.name.toLowerCase().includes(query.toLowerCase()) ||
        group.facilitator.toLowerCase().includes(query.toLowerCase()) ||
        group.location.toLowerCase().includes(query.toLowerCase());
      const typeHit = typeFilter === 'all' || group.groupType === typeFilter;
      const statusHit = statusFilter === 'all' || sessionStatusFromNoteStatus(group.note.status) === statusFilter;
      const facilitatorHit = facilitatorFilter === 'all' || group.facilitator === facilitatorFilter;
      return searchHit && typeHit && statusHit && facilitatorHit;
    });
  }, [groups, query, typeFilter, statusFilter, facilitatorFilter]);

  useEffect(() => {
    if (!filteredGroups.length) return;
    if (!filteredGroups.some((group) => group.id === selectedId)) {
      setSelectedId(filteredGroups[0].id);
    }
  }, [filteredGroups, selectedId]);

  const selected = useMemo(
    () => groups.find((group) => group.id === selectedId) ?? groups[0],
    [groups, selectedId]
  );

  const facilitators = useMemo(
    () => Array.from(new Set(groups.map((group) => group.facilitator))),
    [groups]
  );

  const updateGroup = (groupId: string, updater: (group: GroupSession) => GroupSession) => {
    setGroups((prev) => prev.map((group) => (group.id === groupId ? updater(group) : group)));
  };

  const updateMember = (
    groupId: string,
    memberId: string,
    patch: Partial<GroupMember>
  ) => {
    updateGroup(groupId, (group) => ({
      ...group,
      updatedAt: today,
      members: group.members.map((member) =>
        member.id === memberId ? { ...member, ...patch } : member
      ),
    }));
  };

  const updateNote = (groupId: string, patch: Partial<GroupNote>) => {
    updateGroup(groupId, (group) => ({
      ...group,
      updatedAt: today,
      note: { ...group.note, ...patch, status: patch.status ?? group.note.status },
    }));
  };

  const presentMembers =
    selected?.members.filter(
      (member) => member.membershipStatus === 'Active' && member.attendance !== 'Absent'
    ) ?? [];
  const notesReady =
    presentMembers.length > 0 &&
    Boolean(selected?.note.commonText.trim()) &&
    presentMembers.every((member) => {
      const text = selected?.note.individualized[member.id] ?? member.individualNote;
      return text.trim().length > 0;
    });
  const capacityCount = selected?.members.filter((member) => member.membershipStatus === 'Active').length ?? 0;

  const handleAddMember = () => {
    if (!selected || !newMemberId) return;
    if (capacityCount >= selected.capacity) return;
    const candidate = clientPool.find((client) => client.id === newMemberId);
    if (!candidate) return;
    if (selected.members.some((member) => member.clientId === candidate.id)) return;

    updateGroup(selected.id, (group) => ({
      ...group,
      updatedAt: today,
      members: [
        ...group.members,
        {
          id: `${group.id}-${candidate.id}`,
          clientId: candidate.id,
          name: candidate.name,
          membershipStatus: 'Active',
          membershipStart: today,
          membershipEnd: null,
          attendance: 'Excused',
          arrivalTime: null,
          departureTime: null,
          individualNote: '',
        },
      ],
    }));
    setNewMemberId('');
  };

  const handleDeactivateMember = (memberId: string) => {
    if (!selected) return;
    updateMember(selected.id, memberId, {
      membershipStatus: 'Inactive',
      membershipEnd: today,
      attendance: 'Excused',
    });
  };

  const handleCreateGroup = () => {
    const id = `gs-${Date.now()}`;
    const nextGroup: GroupSession = {
      id,
      name: newGroup.name.trim() || 'New Group',
      groupType: newGroup.groupType,
      description:
        newGroup.groupType === 'PRP'
          ? 'PRP group with H2017 attendance and documentation foundation.'
          : 'Psychotherapy group with recurring attendance and note workflow.',
      facilitator: newGroup.facilitator,
      additionalStaff: [],
      location: newGroup.location,
      mode: newGroup.mode,
      startDate: today,
      endDate: null,
      recurrence: {
        frequency: newGroup.frequency,
        days: [newGroup.day],
        startTime: newGroup.startTime,
        duration: newGroup.duration,
        timezone: 'America/New_York',
      },
      capacity: newGroup.capacity,
      active: true,
      createdBy: 'Clinic Admin',
      createdAt: today,
      updatedAt: today,
      nextSession: today,
      occurrences: [
        {
          id: `${id}-oc-1`,
          date: today,
          startTime: newGroup.startTime,
          duration: newGroup.duration,
          status: 'upcoming',
        },
      ],
      members: [],
      note: {
        status: 'draft',
        commonText: '',
        individualized: {},
        cosignRequired: newGroup.groupType === 'PRP',
        signedBy: null,
        signedAt: null,
        lockedAt: null,
      },
      prp: {
        serviceCode: newGroup.groupType === 'PRP' ? 'H2017' : null,
        dailyAttendanceRequired: newGroup.groupType === 'PRP',
        comarChecklist: newGroup.groupType === 'PRP'
          ? ['Daily attendance log', 'Facilitator signature', 'Member service record', 'H2017 foundation']
          : [],
      },
    };

    setGroups((prev) => [nextGroup, ...prev]);
    setSelectedId(id);
    setShowCreate(false);
    setNewGroup({
      name: '',
      groupType: 'Psychotherapy',
      facilitator: 'Dr. Renee Jackson, LCSW',
      location: 'Room A',
      mode: 'In-person',
      frequency: 'Weekly',
      day: 'Tuesday',
      startTime: '10:00',
      duration: 60,
      capacity: 10,
    });
  };

  const handleSignNote = () => {
    if (!selected) return;
    if (!selected.note.commonText.trim() || !notesReady) return;
    updateNote(selected.id, {
      status: 'signed',
      signedBy: selected.facilitator,
      signedAt: new Date().toISOString(),
    });
  };

  const handleLockNote = () => {
    if (!selected) return;
    updateNote(selected.id, {
      status: 'locked',
      lockedAt: new Date().toISOString(),
    });
  };

  const activeGroups = groups.filter((group) => group.active).length;
  const prpGroups = groups.filter((group) => group.groupType === 'PRP').length;
  const nextSessions = groups.filter((group) => group.note.status !== 'locked').length;
  const filledCapacity = groups.reduce((sum, group) => sum + group.members.filter((member) => member.membershipStatus === 'Active').length, 0);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <div className="flex flex-col gap-3 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Altrixs - Clinical</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">Group Sessions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Recurring groups, membership, attendance, group notes, and PRP documentation foundation
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
        >
          <Plus size={16} />
          New Group
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Groups</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{groups.length}</p>
          <p className="mt-1 text-xs text-slate-500">{activeGroups} active, {prpGroups} PRP groups</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming sessions</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{nextSessions}</p>
          <p className="mt-1 text-xs text-slate-500">Recurring schedule and occurrence list</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Active members</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{filledCapacity}</p>
          <p className="mt-1 text-xs text-slate-500">Capacity tracked per group</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">H2017 foundation</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{prpGroups}</p>
          <p className="mt-1 text-xs text-slate-500">PRP groups with daily attendance logging</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.1fr_1.4fr]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <PanelTitle
              title="Find groups"
              description="Search, type filter, facilitator filter, and status filter"
              icon={<Filter size={15} />}
            />
            <div className="space-y-3 px-5 py-4">
              <div className="relative">
                <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search group name, facilitator, or location"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-3 text-sm outline-none ring-0 focus:border-slate-300"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value as 'all' | GroupType)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="all">All types</option>
                  <option value="Psychotherapy">Psychotherapy</option>
                  <option value="PRP">PRP</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as 'all' | SessionStatus)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="all">All note states</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="active">Active</option>
                  <option value="finalized">Finalized</option>
                </select>
                <select
                  value={facilitatorFilter}
                  onChange={(e) => setFacilitatorFilter(e.target.value)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm"
                >
                  <option value="all">All facilitators</option>
                  {facilitators.map((facilitator) => (
                    <option key={facilitator} value={facilitator}>
                      {facilitator}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {filteredGroups.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-8 text-center text-slate-500">
                <Users className="mx-auto h-8 w-8 text-slate-300 mb-2" />
                <p className="text-sm font-semibold text-slate-700">No group sessions found</p>
                <p className="text-xs text-slate-400 mt-1">
                  Create a new group session to manage recurring therapy cohorts and attendance.
                </p>
              </div>
            )}
            {filteredGroups.map((group) => {
              const activeCount = group.members.filter((member) => member.membershipStatus === 'Active').length;
              const attendanceRate = activeCount
                ? Math.round(
                    (group.members.filter((member) => member.attendance === 'Present').length / activeCount) * 100
                  )
                : 0;
              const selected = group.id === selectedId;

              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedId(group.id)}
                  className={`w-full rounded-2xl border p-4 text-left shadow-sm transition ${
                    selected ? 'border-slate-400 bg-slate-50' : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{group.name}</h3>
                        <GroupBadge status={sessionStatusFromNoteStatus(group.note.status)} />
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">
                          {group.groupType}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">{group.facilitator} - {group.location}</p>
                      <p className="mt-1 text-xs text-slate-500">Next session {formatDate(group.nextSession)} at {group.recurrence.startTime}</p>
                    </div>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                      {activeCount}/{group.capacity}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                    <span>{attendanceRate}% attendance rate</span>
                    <span className="h-1.5 flex-1 rounded-full bg-slate-100">
                      <span
                        className="block h-1.5 rounded-full bg-slate-900"
                        style={{ width: `${Math.min(100, (activeCount / group.capacity) * 100)}%` }}
                      />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <PanelTitle
              title="Workflow rules"
              description="Attendance first, then common note, then individual customizations, then sign and lock"
              icon={<ClipboardList size={15} />}
            />
            <div className="space-y-2 px-5 py-4 text-sm text-slate-600">
              <p>1. Load the active members for the selected occurrence.</p>
              <p>2. Mark attendance and preserve absent or inactive history.</p>
              <p>3. Write one group note with per-member customizations.</p>
              <p>4. Sign the note, then lock it after review.</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          {selected ? (
            <>
              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <PanelTitle
                  title={selected.name}
                  description={`${selected.groupType} - ${selected.facilitator} - ${selected.location}`}
                  icon={<Calendar size={15} />}
                />
                <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
                  <div className="space-y-3 text-sm text-slate-600">
                    <div className="flex items-start gap-3">
                      <MapPin size={14} className="mt-0.5 text-slate-400" />
                      <div>
                        <p className="font-semibold text-slate-900">Group details</p>
                        <p>{selected.description}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock size={14} className="mt-0.5 text-slate-400" />
                      <div>
                        <p className="font-semibold text-slate-900">Recurring schedule</p>
                        <p>
                          {selected.recurrence.frequency} on {selected.recurrence.days.join(', ')} at {selected.recurrence.startTime}
                        </p>
                        <p>
                          {selected.recurrence.duration} min in {selected.recurrence.timezone}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Users size={14} className="mt-0.5 text-slate-400" />
                      <div>
                        <p className="font-semibold text-slate-900">Membership</p>
                        <p>{selected.members.filter((member) => member.membershipStatus === 'Active').length} active members out of {selected.capacity}</p>
                        <p>Created by {selected.createdBy} on {formatDate(selected.createdAt)}</p>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Upcoming occurrences</p>
                      <div className="mt-2 space-y-2 text-sm text-slate-700">
                        {selected.occurrences.map((occurrence) => (
                          <div key={occurrence.id} className="flex items-center justify-between">
                            <span>{formatDate(occurrence.date)} - {occurrence.startTime}</span>
                            <span className="text-xs text-slate-500">{occurrence.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Available actions</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
                        <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">Manage members</span>
                        <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">Record attendance</span>
                        <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">Write group note</span>
                        <span className="rounded-full bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200">Sign note</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <PanelTitle
                  title="Attendance"
                  description="One attendance record per member for the selected group"
                  icon={<CheckCircle2 size={15} />}
                />
                <div className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={newMemberId}
                      onChange={(e) => setNewMemberId(e.target.value)}
                      className="min-w-52 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                    >
                      <option value="">Add permitted client</option>
                      {clientPool.filter(
                        (client) => !selected.members.some((member) => member.clientId === client.id)
                      ).map((client) => (
                        <option key={client.id} value={client.id}>
                          {client.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAddMember}
                      disabled={!newMemberId || capacityCount >= selected.capacity}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <UserPlus size={14} />
                      Add member
                    </button>
                    {capacityCount >= selected.capacity && (
                      <span className="text-xs font-medium text-rose-600">Capacity reached</span>
                    )}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <div className="min-w-[720px]">
                    <div className="grid grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      <span>Member</span>
                      <span>Membership</span>
                      <span>Attendance</span>
                      <span>Arrival / Depart</span>
                      <span>Action</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {selected.members.map((member) => {
                        const isActive = member.membershipStatus === 'Active';
                        return (
                          <div key={member.id} className="grid grid-cols-[1.4fr_0.9fr_0.8fr_0.8fr_0.8fr] gap-3 px-4 py-4 text-sm">
                            <div className="flex items-start gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
                                {initials(member.name)}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-slate-900">{member.name}</p>
                                <p className="text-xs text-slate-500">Since {formatDate(member.membershipStart)}</p>
                                {member.membershipEnd && (
                                  <p className="text-xs text-slate-400">Ended {formatDate(member.membershipEnd)}</p>
                                )}
                              </div>
                            </div>

                            <div>
                              <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${isActive ? 'bg-blue-50 text-blue-700 ring-blue-100' : 'bg-slate-100 text-slate-500 ring-slate-200'}`}>
                                {member.membershipStatus}
                              </span>
                            </div>

                            <div>
                              <select
                                value={member.attendance}
                                onChange={(e) =>
                                  updateMember(selected.id, member.id, { attendance: e.target.value as AttendanceStatus })
                                }
                                disabled={!isActive || selected.note.status === 'locked'}
                                className={`rounded-lg border px-2 py-1 text-xs ${ATTENDANCE_META[member.attendance]} ${!isActive || selected.note.status === 'locked' ? 'opacity-60' : ''}`}
                              >
                                <option value="Present">Present</option>
                                <option value="Late">Late</option>
                                <option value="Excused">Excused</option>
                                <option value="Absent">Absent</option>
                              </select>
                              <div className="mt-1 text-xs text-slate-500">
                                {member.attendance === 'Present' || member.attendance === 'Late'
                                  ? 'Counts toward attendance log'
                                  : 'History retained'}
                              </div>
                            </div>

                            <div className="text-xs text-slate-600">
                              <p>{member.arrivalTime ?? ' - '}</p>
                              <p>{member.departureTime ?? ' - '}</p>
                            </div>

                            <div className="flex items-start justify-between gap-2">
                              <div className="text-xs text-slate-500">
                                <p className="max-w-[170px] truncate">{member.individualNote || 'No individual note yet'}</p>
                              </div>
                              <button
                                type="button"
                                onClick={() => handleDeactivateMember(member.id)}
                                disabled={!isActive}
                                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <PanelTitle
                  title="Group note"
                  description="Write one common note, then customize each attendee's record"
                  icon={<FileText size={15} />}
                />
                <div className="space-y-4 px-5 py-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Common group note
                      </label>
                      <textarea
                        value={selected.note.commonText}
                        onChange={(e) =>
                          updateNote(selected.id, {
                            commonText: e.target.value,
                            status: 'draft',
                          })
                        }
                        disabled={selected.note.status === 'locked'}
                        rows={5}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none disabled:bg-slate-50"
                        placeholder="Document goals, interventions, group dynamics, and common clinical content."
                      />
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Finalize flow</p>
                      <div className="mt-3 space-y-2">
                        <p>Attendance complete: {presentMembers.length} members ready for note creation.</p>
                        <p>Individual customizations: each attendee keeps their own response and plan text.</p>
                        <p>Signature state: {selected.note.status}</p>
                        <p>Supervisor cosign required: {selected.note.cosignRequired ? 'Yes' : 'No'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {selected.members
                      .filter((member) => member.membershipStatus === 'Active' && member.attendance !== 'Absent')
                      .map((member) => (
                        <div key={member.id} className="rounded-xl border border-slate-200 p-4">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-slate-900">{member.name}</p>
                              <p className="text-xs text-slate-500">Linked to group occurrence and client EHR</p>
                            </div>
                            <BadgeCheck size={14} className="text-slate-400" />
                          </div>
                          <textarea
                            value={selected.note.individualized[member.id] ?? member.individualNote}
                            onChange={(e) =>
                              updateNote(selected.id, {
                                individualized: {
                                  ...selected.note.individualized,
                                  [member.id]: e.target.value,
                                },
                              })
                            }
                            disabled={selected.note.status === 'locked'}
                            rows={3}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none disabled:bg-slate-50"
                            placeholder="Client-specific response, progress, and follow-up."
                          />
                        </div>
                      ))}
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={handleSignNote}
                      disabled={!notesReady || selected.note.status === 'locked'}
                      className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <CheckCircle2 size={15} />
                      Sign note
                    </button>
                    <button
                      type="button"
                      onClick={handleLockNote}
                      disabled={selected.note.status !== 'signed'}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Lock size={15} />
                      Lock note
                    </button>
                    {selected.note.cosignRequired && (
                      <span className="inline-flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 ring-1 ring-inset ring-amber-100">
                        <AlertTriangle size={14} />
                        Supervisor cosign required for this PRP group
                      </span>
                    )}
                    {selected.note.status === 'locked' && selected.note.lockedAt && (
                      <span className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-100">
                        <Lock size={14} />
                        Locked {new Date(selected.note.lockedAt).toLocaleString('en-US')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {selected.groupType === 'PRP' && (
                <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <PanelTitle
                    title="PRP documentation foundation"
                    description="COMAR-related fields, H2017 code, and daily attendance log"
                    icon={<ClipboardList size={15} />}
                  />
                  <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Service code</p>
                      <p className="mt-2 text-2xl font-semibold text-slate-900">{selected.prp.serviceCode ?? 'Pending'}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        Daily attendance is required before PRP documentation can be finalized.
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">COMAR checklist</p>
                      <div className="mt-2 space-y-1 text-sm text-slate-600">
                        {selected.prp.comarChecklist.map((item) => (
                          <p key={item}>- {item}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
                <PanelTitle
                  title="Occurrence history"
                  description="Upcoming and completed occurrences stay linked to the same group"
                  icon={<Clock size={15} />}
                />
                <div className="space-y-2 px-5 py-4">
                  {selected.occurrences.map((occurrence) => (
                    <div key={occurrence.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
                      <div>
                        <p className="font-semibold text-slate-900">{formatDate(occurrence.date)}</p>
                        <p className="text-xs text-slate-500">
                          {occurrence.startTime} - {occurrence.duration} min
                        </p>
                      </div>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
                        {occurrence.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
              <p className="text-sm font-semibold text-slate-800">No matching group found</p>
              <p className="mt-1 text-sm text-slate-500">Clear filters to see available group sessions.</p>
            </div>
          )}
        </div>
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Create new group</h2>
                <p className="text-sm text-slate-500">
                  Create a recurring group shell with attendance and note flow
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="rounded-full px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <input
                value={newGroup.name}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, name: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Group name"
              />
              <select
                value={newGroup.groupType}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, groupType: e.target.value as GroupType }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <option value="Psychotherapy">Psychotherapy</option>
                <option value="PRP">PRP</option>
              </select>
              <input
                value={newGroup.facilitator}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, facilitator: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Facilitator"
              />
              <input
                value={newGroup.location}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, location: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Location"
              />
              <select
                value={newGroup.frequency}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, frequency: e.target.value as 'Weekly' | 'Biweekly' }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              >
                <option value="Weekly">Weekly</option>
                <option value="Biweekly">Biweekly</option>
              </select>
              <input
                value={newGroup.day}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, day: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Day of week"
              />
              <input
                type="time"
                value={newGroup.startTime}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, startTime: e.target.value }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
              />
              <input
                type="number"
                min={1}
                value={newGroup.duration}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, duration: Number(e.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Duration"
              />
              <input
                type="number"
                min={1}
                value={newGroup.capacity}
                onChange={(e) => setNewGroup((prev) => ({ ...prev, capacity: Number(e.target.value) }))}
                className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
                placeholder="Capacity"
              />
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowCreate(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreateGroup}
                className="flex-1 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white"
              >
                Create group
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
