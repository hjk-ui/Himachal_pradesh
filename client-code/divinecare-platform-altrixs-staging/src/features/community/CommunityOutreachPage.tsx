'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays,
  ChevronDown,
  ChevronUp,
  Clock,
  Handshake,
  Heart,
  MapPin,
  Plus,
  Star,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  createCommunityEvent,
  createCommunityPartner,
  createCommunityVolunteer,
  fetchCommunity,
  signUpVolunteer,
  updateCommunityEvent,
  type CommunityEventDTO,
  type CommunityPartnerDTO,
  type CommunityVolunteerDTO,
} from '@/features/community/api';
import { EVENT_TYPES, PARTNER_CATEGORIES } from '@/lib/community/constants';

type Tab = 'events' | 'partners' | 'volunteers' | 'create';
type Filter = 'all' | 'upcoming' | 'completed' | string;

const PURPLE = '#5C2D91';
const TYPE_PILL: Record<string, string> = {
  'Health Fair': 'bg-emerald-50 text-emerald-700',
  'Support Group': 'bg-violet-100 text-violet-700',
  'School Outreach': 'bg-sky-100 text-sky-700',
  'Wellness Event': 'bg-teal-50 text-teal-700',
  Training: 'bg-rose-100 text-rose-700',
  Panel: 'bg-orange-100 text-orange-700',
};

const PARTNER_STYLE: Record<string, { bg: string; icon: string; pill: string }> = {
  Government: { bg: '#F5F3FF', icon: '#2563eb', pill: 'bg-blue-100 text-blue-700' },
  Faith: { bg: '#FFFBEB', icon: '#d97706', pill: 'bg-amber-100 text-amber-700' },
  Education: { bg: '#F0FDF4', icon: '#15803d', pill: 'bg-emerald-100 text-emerald-700' },
  Nonprofit: { bg: '#F5F3FF', icon: '#5C2D91', pill: 'bg-violet-100 text-violet-700' },
  Corporate: { bg: '#F9FAFB', icon: '#4b5563', pill: 'bg-slate-100 text-slate-700' },
};

function formatTimeRange(startIso: string, endIso: string) {
  const opts: Intl.DateTimeFormatOptions = {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  };
  const start = new Date(startIso).toLocaleTimeString('en-US', opts);
  const end = new Date(endIso).toLocaleTimeString('en-US', opts);
  return `${start} – ${end}`;
}

function formatLongDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

function monthDay(iso: string) {
  const month = new Date(iso)
    .toLocaleDateString('en-US', { month: 'short', timeZone: 'America/New_York' })
    .toUpperCase();
  const day = new Date(iso).toLocaleDateString('en-US', {
    day: 'numeric',
    timeZone: 'America/New_York',
  });
  return { month, day };
}

function dateInputValue(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

function timeInputValue(iso: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = parts.find((p) => p.type === 'hour')?.value.padStart(2, '0') ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value.padStart(2, '0') ?? '00';
  return `${hour}:${minute}`;
}

function flyerText(event: CommunityEventDTO) {
  return [
    event.title,
    `${formatLongDate(event.startsAt)} · ${formatTimeRange(event.startsAt, event.endsAt)}`,
    event.locationName,
    event.description,
    event.tags.join(' · '),
  ].join('\n');
}

function printFlyer(event: CommunityEventDTO) {
  const html = `<!doctype html><html><head><title>${event.title}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; padding: 48px; color: #0f172a; }
    h1 { color: #5050C5; margin-bottom: 8px; }
    .meta { color: #64748b; margin: 8px 0; }
    .tag { display: inline-block; background: #F5F3FF; color: #5050C5; padding: 4px 10px; border-radius: 999px; margin: 4px 6px 0 0; font-size: 12px; }
  </style></head><body>
  <p style="letter-spacing:0.16em;font-size:11px;font-weight:700;color:#5C2D91;">EVENTS &amp; OUTREACH</p>
  <h1>${event.title}</h1>
  <p class="meta">${formatLongDate(event.startsAt)} · ${formatTimeRange(event.startsAt, event.endsAt)}</p>
  <p class="meta">${event.locationName}</p>
  <p>${event.description}</p>
  <p>${event.tags.map((t) => `<span class="tag">${t}</span>`).join('')}</p>
  </body></html>`;
  const w = window.open('', '_blank', 'noopener,noreferrer');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  bg,
}: {
  label: string;
  value: string;
  icon: typeof CalendarDays;
  accent: string;
  bg: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl" style={{ backgroundColor: bg }}>
        <Icon size={20} style={{ color: accent }} />
      </div>
      <p className="text-2xl font-bold sm:text-3xl" style={{ color: accent }}>
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-500">{label}</p>
    </div>
  );
}

const emptyDraft = {
  title: '',
  type: 'Health Fair',
  date: '',
  startTime: '',
  endTime: '',
  location: '',
  expected: '',
  volunteers: '',
  desc: '',
};

export default function CommunityOutreachPage() {
  const [events, setEvents] = useState<CommunityEventDTO[]>([]);
  const [partners, setPartners] = useState<CommunityPartnerDTO[]>([]);
  const [volunteers, setVolunteers] = useState<CommunityVolunteerDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('events');
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    title: '',
    eventType: 'Health Fair',
    date: '',
    startTime: '',
    endTime: '',
    locationName: '',
    expectedAttendees: 0,
    volunteersNeeded: 0,
    description: '',
  });
  const [partnerOpen, setPartnerOpen] = useState(false);
  const [partnerDraft, setPartnerDraft] = useState({ name: '', category: 'Nonprofit' });
  const [volunteerOpen, setVolunteerOpen] = useState(false);
  const [volunteerDraft, setVolunteerDraft] = useState({ name: '', role: '' });
  const [signupEvent, setSignupEvent] = useState<CommunityEventDTO | null>(null);
  const [signupVolunteerId, setSignupVolunteerId] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 3200);
  };

  const load = useCallback(async () => {
    try {
      const data = await fetchCommunity();
      setEvents(data.events);
      setPartners(data.partners);
      setVolunteers(data.volunteers);
      setError(null);
      setExpanded((prev) => prev ?? data.events.find((e) => e.isFeatured)?.id ?? data.events[0]?.id ?? null);
    } catch (err) {
      setError((err as Error).message || 'Could not load community outreach');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedEvents = useMemo(() => {
    const upcoming = events.filter((e) => e.status === 'upcoming').sort((a, b) => +new Date(a.startsAt) - +new Date(b.startsAt));
    const completed = events.filter((e) => e.status === 'completed').sort((a, b) => +new Date(b.startsAt) - +new Date(a.startsAt));
    return [...upcoming, ...completed];
  }, [events]);

  const featured = useMemo(() => {
    const flagged = sortedEvents.find((e) => e.isFeatured && e.status === 'upcoming');
    return flagged ?? sortedEvents.find((e) => e.status === 'upcoming') ?? sortedEvents[0] ?? null;
  }, [sortedEvents]);

  const statsMonth = featured ? new Date(featured.startsAt) : new Date();
  const monthKey = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'numeric',
    year: 'numeric',
  }).format(statsMonth);
  const monthEvents = useMemo(
    () =>
      events.filter((e) => {
        const key = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          month: 'numeric',
          year: 'numeric',
        }).format(new Date(e.startsAt));
        return key === monthKey;
      }),
    [events, monthKey]
  );
  const attendeeTotal = monthEvents.reduce((sum, e) => sum + e.registeredCount, 0);
  const attendeeLabel =
    attendeeTotal >= 340 ? `${Math.floor(attendeeTotal / 10) * 10}+` : String(attendeeTotal);
  const monthShort = statsMonth.toLocaleDateString('en-US', { month: 'short' });

  const filteredEvents = useMemo(() => {
    if (filter === 'all') return sortedEvents;
    if (filter === 'upcoming' || filter === 'completed') {
      return sortedEvents.filter((e) => e.status === filter);
    }
    return sortedEvents.filter((e) => e.eventType === filter);
  }, [sortedEvents, filter]);

  const activeVolunteers = volunteers.filter((v) => v.status === 'active');

  const openCreate = () => {
    setTab('create');
    setError(null);
  };

  const openManage = (event: CommunityEventDTO) => {
    setTab('events');
    setExpanded(event.id);
    setEditingId(event.id);
    setEdit({
      title: event.title,
      eventType: event.eventType,
      date: dateInputValue(event.startsAt),
      startTime: timeInputValue(event.startsAt),
      endTime: timeInputValue(event.endsAt),
      locationName: event.locationName,
      expectedAttendees: event.expectedAttendees,
      volunteersNeeded: event.volunteersNeeded,
      description: event.description,
    });
  };

  const shareFlyer = async (event: CommunityEventDTO) => {
    const text = flyerText(event);
    try {
      if (navigator.share) {
        await navigator.share({ title: event.title, text });
        showToast('Flyer shared');
        return;
      }
    } catch {
      /* fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('Flyer copied to clipboard');
    } catch {
      showToast('Copy this flyer from Print view');
      printFlyer(event);
    }
  };

  const exportCalendar = async () => {
    try {
      const res = await fetch('/api/community/export?format=ics');
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'community-events.ics';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Calendar downloaded');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const submitEvent = async () => {
    if (!draft.title.trim() || !draft.date || !draft.location.trim()) {
      setError('Event title, date, and location are required.');
      return;
    }
    setSaving(true);
    try {
      const event = await createCommunityEvent({
        title: draft.title.trim(),
        eventType: draft.type,
        date: draft.date,
        startTime: draft.startTime || '09:00',
        endTime: draft.endTime || draft.startTime || '10:00',
        locationName: draft.location.trim(),
        description: draft.desc.trim(),
        expectedAttendees: Number(draft.expected) || 0,
        volunteersNeeded: Number(draft.volunteers) || 0,
      });
      setEvents((prev) => [event, ...prev]);
      setDraft(emptyDraft);
      setTab('events');
      setExpanded(event.id);
      setError(null);
      showToast('Event created');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const event = await updateCommunityEvent(id, {
        title: edit.title,
        eventType: edit.eventType,
        date: edit.date,
        startTime: edit.startTime,
        endTime: edit.endTime,
        locationName: edit.locationName,
        description: edit.description,
        expectedAttendees: Number(edit.expectedAttendees) || 0,
        volunteersNeeded: Number(edit.volunteersNeeded) || 0,
      });
      setEvents((prev) => prev.map((item) => (item.id === id ? event : item)));
      setEditingId(null);
      showToast('Event updated');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const confirmSignup = async () => {
    if (!signupEvent) return;
    setSaving(true);
    try {
      const result = await signUpVolunteer(signupEvent.id, signupVolunteerId || undefined);
      setEvents((prev) => prev.map((item) => (item.id === result.event.id ? result.event : item)));
      if (result.volunteer) {
        setVolunteers((prev) =>
          prev.map((item) => (item.id === result.volunteer!.id ? result.volunteer! : item))
        );
      }
      setSignupEvent(null);
      showToast('Volunteer signed up');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addPartner = async () => {
    if (!partnerDraft.name.trim()) {
      setError('Partner name is required.');
      return;
    }
    setSaving(true);
    try {
      const partner = await createCommunityPartner(partnerDraft);
      setPartners((prev) => [...prev, partner]);
      setPartnerDraft({ name: '', category: 'Nonprofit' });
      setPartnerOpen(false);
      showToast('Partner added');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const addVolunteer = async () => {
    if (!volunteerDraft.name.trim() || !volunteerDraft.role.trim()) {
      setError('Volunteer name and role are required.');
      return;
    }
    setSaving(true);
    try {
      const volunteer = await createCommunityVolunteer(volunteerDraft);
      setVolunteers((prev) => [volunteer, ...prev]);
      setVolunteerDraft({ name: '', role: '' });
      setVolunteerOpen(false);
      showToast('Volunteer added');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1360px] space-y-5 overflow-x-hidden sm:space-y-6">
      {toast && (
        <div role="status" className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-50 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-2xl bg-slate-900 px-4 py-2 text-center text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}

      <header className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
            Events &amp; Outreach
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Community engagement · Outreach events · Partnerships
          </p>
        </div>
        <div className="flex flex-shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void exportCalendar()}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload size={15} />
            Export Calendar
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-white shadow-sm"
            style={{ background: PURPLE }}
          >
            <Plus size={15} />
            Create Event
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <StatCard
          label="Events This Month"
          value={loading ? '—' : String(monthEvents.length)}
          icon={CalendarDays}
          accent={PURPLE}
          bg="#F5F3FF"
        />
        <StatCard
          label={`Total Attendees (${monthShort})`}
          value={loading ? '—' : attendeeLabel}
          icon={Users}
          accent="#0d9488"
          bg="#ccfbf1"
        />
        <StatCard
          label="Community Partners"
          value={loading ? '—' : String(partners.length)}
          icon={Handshake}
          accent="#B45309"
          bg="#FEF9E7"
        />
        <StatCard
          label="Volunteers"
          value={loading ? '—' : String(volunteers.length)}
          icon={Heart}
          accent="#ea580c"
          bg="#fff7ed"
        />
      </div>

      {featured && (
        <section className="overflow-hidden rounded-[1.5rem] bg-gradient-to-br from-[#7C6CE0] to-[#5B54C8] p-5 text-white shadow-[0_20px_50px_rgba(91,84,200,0.28)] sm:p-7">
          <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 max-w-3xl">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium">
                <Star size={11} fill="currentColor" />
                Next Major Event
              </span>
              <h2 className="mt-3 text-xl font-bold leading-snug sm:text-3xl">{featured.title}</h2>
              <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-white/85">
                <Clock size={13} />
                {formatLongDate(featured.startsAt)} · {formatTimeRange(featured.startsAt, featured.endsAt)}
              </p>
              <p className="mt-1 flex items-start gap-1.5 text-sm text-white/85">
                <MapPin size={13} className="mt-0.5 flex-shrink-0" />
                {featured.locationName}
              </p>
              <p className="mt-4 max-w-2xl text-sm leading-relaxed text-white/90">{featured.description}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {featured.tags.map((tag) => (
                  <span key={tag} className="rounded-full bg-white/15 px-2.5 py-1 text-xs">
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openManage(featured)}
                  className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-[#5B54C8]"
                >
                  Manage Event
                </button>
                <button
                  type="button"
                  onClick={() => void shareFlyer(featured)}
                  className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
                >
                  Share Flyer
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSignupEvent(featured);
                    setSignupVolunteerId(activeVolunteers[0]?.id || '');
                  }}
                  className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/25"
                >
                  Volunteer Sign-Up
                </button>
              </div>
            </div>
            <div className="w-full flex-shrink-0 lg:max-w-[220px] lg:pt-6 lg:text-right">
              <p className="text-5xl font-bold leading-none">{featured.registeredCount}</p>
              <p className="mt-1 text-sm text-white/80">registered</p>
              <p className="text-xs text-white/60">of {featured.expectedAttendees} expected</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/20">
                <div
                  className="h-2 rounded-full bg-white"
                  style={{
                    width: `${Math.min(100, Math.round((featured.registeredCount / Math.max(1, featured.expectedAttendees)) * 100))}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </section>
      )}

      <div className="min-w-0 overflow-hidden rounded-[1.25rem] border border-slate-200/80 bg-white shadow-sm">
        {error && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800 sm:px-5">
            {error}
          </div>
        )}
        <div className="flex overflow-x-auto border-b border-slate-200/80">
          {(
            [
              ['events', 'Events'],
              ['partners', 'Partners'],
              ['volunteers', 'Volunteers'],
              ['create', '+ New Event'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-4 py-3.5 text-sm font-medium transition-colors sm:px-5 ${
                tab === key
                  ? 'border-[#5C2D91] text-[#5C2D91]'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'events' && (
          <div className="p-4 sm:p-6">
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1">
              {(['all', 'upcoming', 'completed', 'Health Fair', 'School Outreach', 'Support Group'] as const).map(
                (item) => {
                  const label = item === 'all' ? 'All' : item === 'upcoming' ? 'Upcoming' : item === 'completed' ? 'Completed' : item;
                  const active = filter === item;
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setFilter(item)}
                      className={`flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        active ? 'text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                      style={active ? { background: PURPLE } : undefined}
                    >
                      {label}
                    </button>
                  );
                }
              )}
            </div>

            {loading ? (
              <p className="py-8 text-center text-sm text-slate-500">Loading events…</p>
            ) : filteredEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">No events match this filter.</p>
            ) : (
              <div className="space-y-3">
                {filteredEvents.map((event) => {
                  const { month, day } = monthDay(event.startsAt);
                  const open = expanded === event.id;
                  const full = event.registeredCount >= event.expectedAttendees && event.expectedAttendees > 0;
                  return (
                    <div key={event.id} className="overflow-hidden rounded-xl border border-slate-200">
                      <button
                        type="button"
                        className="flex w-full min-w-0 flex-col gap-3 p-4 text-left hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4"
                        onClick={() => setExpanded(open ? null : event.id)}
                      >
                        <div className="w-14 flex-shrink-0 text-left sm:text-center">
                          <p className="text-xs font-medium text-slate-500">{month}</p>
                          <p className="text-xl font-semibold text-[#5C2D91]">{day}</p>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">{event.title}</p>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_PILL[event.eventType] || 'bg-slate-100 text-slate-700'}`}
                            >
                              {event.eventType}
                            </span>
                            {event.status === 'completed' && (
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                                Completed
                              </span>
                            )}
                          </div>
                          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={11} />
                              {formatTimeRange(event.startsAt, event.endsAt)}
                            </span>
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <MapPin size={11} className="flex-shrink-0" />
                              <span className="truncate">{event.locationName}</span>
                            </span>
                          </p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:flex-shrink-0 sm:flex-col sm:items-end">
                          <div className="text-left sm:text-right">
                            <p className={`text-base font-bold ${full ? 'text-violet-800' : 'text-[#5C2D91]'}`}>
                              {event.registeredCount}/{event.expectedAttendees} attendees
                            </p>
                          </div>
                          {open ? (
                            <ChevronUp size={16} className="text-slate-500" />
                          ) : (
                            <ChevronDown size={16} className="text-slate-500" />
                          )}
                        </div>
                      </button>

                      {open && (
                        <div className="border-t border-slate-200/80 bg-slate-50 px-4 pb-4 pt-3">
                          {editingId === event.id ? (
                            <div className="mb-3 grid gap-2 sm:grid-cols-2">
                              <input
                                value={edit.title}
                                onChange={(e) => setEdit((p) => ({ ...p, title: e.target.value }))}
                                className={inputClass}
                                placeholder="Event title"
                              />
                              <select
                                value={edit.eventType}
                                onChange={(e) => setEdit((p) => ({ ...p, eventType: e.target.value }))}
                                className={inputClass}
                              >
                                {EVENT_TYPES.map((type) => (
                                  <option key={type}>{type}</option>
                                ))}
                              </select>
                              <input
                                type="date"
                                value={edit.date}
                                onChange={(e) => setEdit((p) => ({ ...p, date: e.target.value }))}
                                className={inputClass}
                              />
                              <input
                                value={edit.locationName}
                                onChange={(e) => setEdit((p) => ({ ...p, locationName: e.target.value }))}
                                className={inputClass}
                                placeholder="Location"
                              />
                              <input
                                type="time"
                                value={edit.startTime}
                                onChange={(e) => setEdit((p) => ({ ...p, startTime: e.target.value }))}
                                className={inputClass}
                              />
                              <input
                                type="time"
                                value={edit.endTime}
                                onChange={(e) => setEdit((p) => ({ ...p, endTime: e.target.value }))}
                                className={inputClass}
                              />
                              <textarea
                                value={edit.description}
                                onChange={(e) => setEdit((p) => ({ ...p, description: e.target.value }))}
                                className={`${inputClass} min-h-20 sm:col-span-2`}
                              />
                              <div className="flex gap-2 sm:col-span-2">
                                <button
                                  type="button"
                                  disabled={saving}
                                  onClick={() => void saveEdit(event.id)}
                                  className="rounded-lg px-3 py-2 text-xs font-semibold text-white"
                                  style={{ background: PURPLE }}
                                >
                                  Save event
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="mb-3 text-sm text-slate-700">{event.description}</p>
                          )}
                          <div className="mb-3 flex flex-wrap gap-2">
                            {event.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-violet-100 px-2.5 py-1 text-xs text-violet-700">
                                {tag}
                              </span>
                            ))}
                          </div>
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                              <Heart size={12} />
                              {event.volunteersSignedUp} volunteers
                            </span>
                            <div className="flex flex-wrap gap-3 text-sm font-medium text-[#5C2D91]">
                              <button type="button" onClick={() => openManage(event)}>
                                Edit Event
                              </button>
                              {/* Events store only an attendee count — no contacts and no send route exist yet. */}
                              <button
                                type="button"
                                disabled
                                title="Not connected yet: attendee contacts aren't stored and no reminder service is wired. Send reminders from your email or SMS tool."
                                className="cursor-not-allowed text-slate-500"
                              >
                                Send Reminders
                              </button>
                              <button type="button" onClick={() => printFlyer(event)}>
                                Print Flyer
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {tab === 'partners' && (
          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">Community organizations and institutional partners</p>
              <button
                type="button"
                onClick={() => setPartnerOpen(true)}
                className="text-sm font-medium text-[#5C2D91] hover:underline"
              >
                + Add Partner
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {partners.map((partner) => {
                const style = PARTNER_STYLE[partner.category] || PARTNER_STYLE.Nonprofit;
                return (
                  <div
                    key={partner.id}
                    className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200/80 p-4"
                  >
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                      style={{ background: style.bg }}
                    >
                      <Handshake size={16} style={{ color: style.icon }} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{partner.name}</p>
                      <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${style.pill}`}>
                        {partner.category}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === 'volunteers' && (
          <div className="p-4 sm:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-500">{activeVolunteers.length} active volunteers</p>
              <button
                type="button"
                onClick={() => setVolunteerOpen(true)}
                className="text-sm font-medium text-[#5C2D91] hover:underline"
              >
                + Add Volunteer
              </button>
            </div>
            <div className="space-y-3">
              {activeVolunteers.map((volunteer) => (
                <div
                  key={volunteer.id}
                  className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-slate-200/80 p-4 sm:flex-nowrap sm:gap-4"
                >
                  <div
                    className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ background: PURPLE }}
                  >
                    {volunteer.name[0]}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{volunteer.name}</p>
                    <p className="text-xs text-slate-500">{volunteer.role}</p>
                  </div>
                  <div className="ml-auto flex items-center gap-3 sm:ml-0">
                    <div className="text-right">
                      <p className="text-lg font-bold text-slate-900">{volunteer.eventCount}</p>
                      <p className="text-xs text-slate-500">events</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                      active
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div className="p-4 sm:p-6">
            <h2 className="mb-5 text-lg font-semibold text-slate-900">Create Community Event</h2>
            <div className="max-w-3xl space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Event Title</label>
                <input
                  value={draft.title}
                  onChange={(e) => setDraft((p) => ({ ...p, title: e.target.value }))}
                  className={inputClass}
                  placeholder="e.g. Mental Health Awareness Fair"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Event Type</label>
                  <select
                    value={draft.type}
                    onChange={(e) => setDraft((p) => ({ ...p, type: e.target.value }))}
                    className={inputClass}
                  >
                    {EVENT_TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Event Date</label>
                  <input
                    type="date"
                    value={draft.date}
                    onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Start Time</label>
                  <input
                    type="time"
                    value={draft.startTime}
                    onChange={(e) => setDraft((p) => ({ ...p, startTime: e.target.value }))}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">End Time</label>
                  <input
                    type="time"
                    value={draft.endTime}
                    onChange={(e) => setDraft((p) => ({ ...p, endTime: e.target.value }))}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Location / Address</label>
                <input
                  value={draft.location}
                  onChange={(e) => setDraft((p) => ({ ...p, location: e.target.value }))}
                  className={inputClass}
                  placeholder="Full address or virtual link"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Expected Attendees</label>
                  <input
                    type="number"
                    min={0}
                    value={draft.expected}
                    onChange={(e) => setDraft((p) => ({ ...p, expected: e.target.value }))}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Volunteers Needed</label>
                  <input
                    type="number"
                    min={0}
                    value={draft.volunteers}
                    onChange={(e) => setDraft((p) => ({ ...p, volunteers: e.target.value }))}
                    className={inputClass}
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Description</label>
                <textarea
                  value={draft.desc}
                  onChange={(e) => setDraft((p) => ({ ...p, desc: e.target.value }))}
                  rows={4}
                  className={`${inputClass} resize-none`}
                  placeholder="Event description for flyers and social media…"
                />
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setTab('events')}
                  className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void submitEvent()}
                  className="rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  style={{ background: PURPLE }}
                >
                  {saving ? 'Creating…' : 'Create Event'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {(partnerOpen || volunteerOpen || signupEvent) && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0 cursor-default"
            aria-label="Close"
            onClick={() => {
              setPartnerOpen(false);
              setVolunteerOpen(false);
              setSignupEvent(null);
            }}
          />
          <div className="relative z-10 max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <h3 className="text-lg font-semibold text-slate-900">
                {partnerOpen ? 'Add Partner' : volunteerOpen ? 'Add Volunteer' : 'Volunteer Sign-Up'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPartnerOpen(false);
                  setVolunteerOpen(false);
                  setSignupEvent(null);
                }}
              >
                <X size={18} className="text-slate-500" />
              </button>
            </div>
            {partnerOpen && (
              <div className="space-y-3">
                <input
                  value={partnerDraft.name}
                  onChange={(e) => setPartnerDraft((p) => ({ ...p, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Organization name"
                />
                <select
                  value={partnerDraft.category}
                  onChange={(e) => setPartnerDraft((p) => ({ ...p, category: e.target.value }))}
                  className={inputClass}
                >
                  {PARTNER_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addPartner()}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-white"
                  style={{ background: PURPLE }}
                >
                  Save partner
                </button>
              </div>
            )}
            {volunteerOpen && (
              <div className="space-y-3">
                <input
                  value={volunteerDraft.name}
                  onChange={(e) => setVolunteerDraft((p) => ({ ...p, name: e.target.value }))}
                  className={inputClass}
                  placeholder="Full name"
                />
                <input
                  value={volunteerDraft.role}
                  onChange={(e) => setVolunteerDraft((p) => ({ ...p, role: e.target.value }))}
                  className={inputClass}
                  placeholder="Role (e.g. Registration)"
                />
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void addVolunteer()}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-white"
                  style={{ background: PURPLE }}
                >
                  Save volunteer
                </button>
              </div>
            )}
            {signupEvent && (
              <div className="space-y-3">
                <p className="text-sm text-slate-600">
                  Sign a volunteer up for <span className="font-semibold">{signupEvent.title}</span>.
                </p>
                <select
                  value={signupVolunteerId}
                  onChange={(e) => setSignupVolunteerId(e.target.value)}
                  className={inputClass}
                >
                  <option value="">Walk-up (count only)</option>
                  {volunteers.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} — {v.role}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void confirmSignup()}
                  className="w-full rounded-xl py-3 text-sm font-semibold text-white"
                  style={{ background: PURPLE }}
                >
                  Confirm sign-up
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
