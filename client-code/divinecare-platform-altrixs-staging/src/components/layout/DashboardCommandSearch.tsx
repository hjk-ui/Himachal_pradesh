'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CalendarPlus,
  ClipboardList,
  ClipboardPlus,
  FilePen,
  FileText,
  Inbox,
  Keyboard,
  Link2,
  ListTodo,
  Mic,
  MessageSquare,
  Pill,
  PlayCircle,
  Search,
  ShieldAlert,
  Star,
  UserRound,
  X,
} from 'lucide-react';
import { ClientAvatar } from '@/components/clinic/ClientAvatar';
import { fetchAppointmentsWithZone, type Appointment } from '@/features/appointments';
import { DEFAULT_PRACTICE_TIME_ZONE, formatWallClock, practiceToday, practiceZoneLabel } from '@/lib/time/practiceTime';
import { fetchClients, type Client } from '@/features/clients';
import { listStaff } from '@/features/staff/api/staffApi';
import type { StaffUser } from '@/features/staff/types';
import { canPrescribe, type StaffRole } from '@/types/roles';
import { canAccessPath, type AccessCapabilities } from '@/lib/auth/roleAccess';
import { hrefPath } from '@/components/layout/navConfig';
import type { RecentClient } from '@/components/layout/navStorage';
import { useAuth } from '@/features/auth';
import { assessmentHref, canStartVisit } from '@/components/visits/visitGuideHelpers';
import { startSessionHref } from '@/lib/scribe/sessionStart';
import { openRcopia } from '@/lib/drfirst/openRcopiaClient';
import { KeyboardShortcutsDialog } from '@/components/layout/KeyboardShortcutsDialog';
import {
  clientIdInContext,
  matchesAllWords,
  resolveShortcut,
  SEQUENCE_TIMEOUT_MS,
  shortcutEligible,
} from '@/components/layout/shortcuts';

function normalize(value: string) {
  return value.trim().toLowerCase();
}

type NavSearchItem = { href: string; label: string; section: string; keywords?: string };

function navMatches(item: NavSearchItem, q: string) {
  return `${item.label} ${item.section} ${item.href} ${item.keywords ?? ''}`.toLowerCase().includes(q);
}

type QuickAction = {
  id: string;
  label: string;
  href: string;
  keywords: string;
  icon: ReactNode;
};

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'book',
    label: 'Book appointment',
    href: '/dashboard/appointments?new=1',
    keywords: 'new appointment schedule book visit',
    icon: <ClipboardPlus size={15} />,
  },
  {
    id: 'inbox',
    label: 'Open inbox',
    href: '/dashboard/inbox',
    keywords: 'inbox to do messages results',
    icon: <Inbox size={15} />,
  },
  {
    id: 'todo',
    label: 'My To-Do',
    href: '/dashboard/tasks',
    keywords: 'to-do todo tasks',
    icon: <ListTodo size={15} />,
  },
  {
    id: 'intake',
    label: 'Send New Intake Link',
    href: '/dashboard/clients/intake',
    keywords: 'intake link send new digital forms',
    icon: <Link2 size={15} />,
  },
  {
    id: 'risk',
    label: 'View Risk Alerts',
    href: '/dashboard/alerts',
    keywords: 'risk alerts safety flag crisis',
    icon: <ShieldAlert size={15} />,
  },
  {
    id: 'note',
    label: 'Write Progress Note',
    href: '/dashboard/ehr/notes',
    keywords: 'progress note soap write documentation',
    icon: <FileText size={15} />,
  },
  {
    id: 'scribe',
    label: 'Start AI Scribe',
    href: '/dashboard/scribe',
    keywords: 'ai scribe dictation transcript',
    icon: <Mic size={15} />,
  },
  {
    id: 'comms',
    label: 'Communications',
    href: '/dashboard/communications',
    keywords: 'communications connect sms call message',
    icon: <MessageSquare size={15} />,
  },
];

/** One selectable row of the palette (keyboard navigation runs over all rows in order). */
type PaletteItem = {
  key: string;
  label: string;
  sub?: string;
  /** Navigate here, or run() for in-place actions (DrFirst opens its own tab) */
  href?: string;
  run?: () => void;
  icon: ReactNode;
  trailing?: ReactNode;
  keywords?: string;
  /** Show the icon in a brand chip (actions) */
  chip?: boolean;
};

type PaletteSection = {
  id: string;
  title: string;
  description: string;
  items: PaletteItem[];
  /** Always render the section (with the empty / loading text) */
  persistent?: boolean;
  emptyText?: string;
  loadingText?: string;
  headerLink?: { href: string; label: string };
};

const iconChip = (icon: ReactNode) => (
  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">{icon}</span>
);

export function DashboardCommandSearch({
  role,
  capabilities,
  navItems = [],
  pinnedHrefs = [],
  recentClients = [],
}: {
  role?: StaffRole | null;
  /** DB-verified capabilities (Medical Director) from the dashboard layout */
  capabilities?: AccessCapabilities;
  navItems?: NavSearchItem[];
  pinnedHrefs?: string[];
  recentClients?: RecentClient[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  /** When the palette opened (the "next visit" is the next one not over at that moment) */
  const [openedAt, setOpenedAt] = useState(0);
  const [contextClientId, setContextClientId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingG = useRef<{ at: number } | null>(null);
  // "Today" on the practice clock, matching the API's practice-clock appointment dates
  const [timeZone, setTimeZone] = useState(DEFAULT_PRACTICE_TIME_ZONE);
  const today = useMemo(() => practiceToday(timeZone), [timeZone]);
  const isHrSearch = role === 'HR';
  const [isMac, setIsMac] = useState(false);
  const allowed = useCallback((href: string) => !role || canAccessPath(role, hrefPath(href), capabilities), [role, capabilities]);

  useEffect(() => {
    try {
      const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
      setIsMac(/mac|iphone|ipad/i.test(nav.userAgentData?.platform || nav.platform || nav.userAgent));
    } catch {
      /* keep Ctrl */
    }
  }, []);
  const shortcutLabel = isMac ? '⌘ K' : 'Ctrl K';

  // The client in view (chart, or ?clientId= on a page): "n" and the "for <client>" actions use it
  useEffect(() => {
    setContextClientId(clientIdInContext(pathname, typeof window === 'undefined' ? '' : window.location.search));
  }, [pathname, open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key;
      if (!key) return;
      if ((event.metaKey || event.ctrlKey) && key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
        return;
      }
      if (key === 'Escape') {
        setOpen(false);
        return;
      }
      // Global shortcuts: never while typing, with a modifier, or over an open dialog
      if (!shortcutEligible(event)) return;
      if (document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]')) return;
      const pending = pendingG.current && Date.now() - pendingG.current.at < SEQUENCE_TIMEOUT_MS;
      const { command, pendingG: nextPending } = resolveShortcut(Boolean(pending), key);
      pendingG.current = nextPending ? { at: Date.now() } : null;
      if (!command) return;
      event.preventDefault();
      if (command.kind === 'search') setOpen(true);
      else if (command.kind === 'help') setHelpOpen(true);
      else if (command.kind === 'go') {
        if (!role || canAccessPath(role, command.href, capabilities)) router.push(command.href);
      } else if (command.kind === 'new_note') {
        const clientId = clientIdInContext(window.location.pathname, window.location.search);
        if (clientId && (!role || canAccessPath(role, '/dashboard/ehr/notes', capabilities))) {
          router.push(`/dashboard/ehr/notes?clientId=${encodeURIComponent(clientId)}`);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, capabilities, router]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setNotice(null);
      return;
    }

    inputRef.current?.focus();
    setOpenedAt(Date.now());

    if (isHrSearch && (staff.length || loading)) {
      return;
    }

    if (!isHrSearch && (clients.length || appointments.length || loading)) {
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    if (isHrSearch) {
      listStaff()
        .then((users) => {
          if (!cancelled) setStaff(users);
        })
        .catch(() => {
          if (!cancelled) setError('Staff search data could not be loaded.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    // Only today's appointments are shown, so ask for today only (the unfiltered list was the whole
    // organization's appointment history on every first Ctrl K).
    Promise.allSettled([fetchClients(), fetchAppointmentsWithZone({ date: today })]).then((results) => {
      if (cancelled) return;

      const [clientsRes, apptsRes] = results;
      const nextClients = clientsRes.status === 'fulfilled' ? clientsRes.value : [];
      const nextAppointments = apptsRes.status === 'fulfilled' ? apptsRes.value.appointments : [];
      if (apptsRes.status === 'fulfilled') setTimeZone(apptsRes.value.timeZone);

      setClients(nextClients);
      setAppointments(nextAppointments);

      if (clientsRes.status === 'rejected' && apptsRes.status === 'rejected') {
        setError('Search data could not be loaded.');
      }

      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [appointments.length, clients.length, isHrSearch, loading, open, staff.length, today]);

  const q = normalize(query);

  const allowedNav = useMemo(() => {
    const seen = new Set<string>();
    return navItems.filter((item) => {
      if (role && !canAccessPath(role, hrefPath(item.href), capabilities)) return false;
      if (seen.has(item.href)) return false;
      seen.add(item.href);
      return true;
    });
  }, [navItems, role, capabilities]);

  const pinnedNav = useMemo(() => {
    const byHref = new Map(allowedNav.map((item) => [item.href, item]));
    return pinnedHrefs
      .map((href) => byHref.get(href))
      .filter((item): item is NavSearchItem => Boolean(item))
      .filter((item) => !q || navMatches(item, q));
  }, [allowedNav, pinnedHrefs, q]);

  const filteredNav = useMemo(() => {
    const pinnedSet = new Set(pinnedHrefs);
    const rest = allowedNav.filter((item) => !pinnedSet.has(item.href));
    if (!q) return rest.slice(0, 10);
    return rest.filter((item) => navMatches(item, q)).slice(0, 12);
  }, [allowedNav, pinnedHrefs, q]);

  const canOpenCharts = !role || canAccessPath(role, '/dashboard/clients');
  const filteredRecent = useMemo(() => {
    if (!canOpenCharts) return [];
    if (!q) return recentClients;
    return recentClients.filter((c) => `${c.name} ${c.mrn ?? ''}`.toLowerCase().includes(q));
  }, [canOpenCharts, q, recentClients]);

  const filteredClients = useMemo(() => {
    const ordered = [...clients].sort((a, b) => a.name.localeCompare(b.name));
    if (!q) return ordered.slice(0, 8);
    return ordered
      .filter((client) => {
        const haystack = [
          client.name,
          client.email,
          client.phone,
          client.primaryDiagnosis,
          client.primaryDiagnosisCode,
          client.secondaryDiagnoses,
          client.assignedToName,
          client.locationName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 8);
  }, [clients, q]);

  const todayAppointments = useMemo(() => {
    const matches = appointments.filter((appt) => appt.date === today);
    if (!q) return matches.slice(0, 6);
    return matches
      .filter((appt) => {
        const haystack = [appt.clientName, appt.type, appt.clinicianName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 6);
  }, [appointments, q, today]);

  const openCount = todayAppointments.filter(
    (appt) => appt.status === 'scheduled' || appt.status === 'checked-in'
  ).length;

  // The signed-in clinician's next visit today (in session first, else the next one not yet over)
  const userId = user?.id ?? null;
  const nextVisit = useMemo(() => {
    if (!userId) return null;
    const now = openedAt;
    const mine = appointments
      .filter((a) => a.date === today && a.clinicianId === userId && canStartVisit(a.status, a.noteStatus))
      .filter((a) => a.status === 'in-session' || ((a.status === 'scheduled' || a.status === 'checked-in') && (!a.endsAt || Date.parse(a.endsAt) > now)))
      .sort((a, b) => (a.status === 'in-session' ? -1 : b.status === 'in-session' ? 1 : `${a.startTime}`.localeCompare(b.startTime)));
    return mine[0] ?? null;
  }, [appointments, today, userId, openedAt]);

  const clientName = useCallback(
    (id: string) => clients.find((c) => c.id === id)?.name || recentClients.find((c) => c.id === id)?.name || null,
    [clients, recentClients]
  );

  // ── Actions (run, not just find) ────────────────────────────────────────────
  const actionItems = useMemo((): PaletteItem[] => {
    const items: PaletteItem[] = [];
    // Same target as the Today panel's StartSessionButton: the visit's note with AI Scribe ready
    const sessionHref = nextVisit
      ? startSessionHref({ appointmentId: nextVisit.id, clientId: nextVisit.clientId, date: nextVisit.date, isVirtual: nextVisit.isVirtual, groupSessionId: nextVisit.groupSessionId })
      : null;
    if (nextVisit && sessionHref && allowed(sessionHref)) {
      items.push({
        key: 'start-next',
        label: 'Start session (next visit)',
        sub: `${nextVisit.clientName} · ${formatWallClock(nextVisit.startTime)} ${practiceZoneLabel(nextVisit.timeZone ?? timeZone)}`,
        href: sessionHref,
        icon: <PlayCircle size={15} />,
        chip: true,
        keywords: 'start session visit next begin',
      });
    }
    for (const a of QUICK_ACTIONS) {
      if (!allowed(a.href)) continue;
      items.push({ key: `qa-${a.id}`, label: a.label, href: a.href, icon: a.icon, keywords: a.keywords, chip: true });
    }
    if (canPrescribe(role)) {
      const ctx = contextClientId;
      items.push({
        key: 'drfirst',
        label: 'Open DrFirst',
        sub: ctx ? `For ${clientName(ctx) || 'this client'}` : 'Messages and renewals',
        icon: <Pill size={15} />,
        chip: true,
        keywords: 'drfirst rcopia e-prescribe prescription rx erx',
        run: () => {
          // openRcopia opens the tab synchronously, so call it straight from the key / click
          void openRcopia(ctx ? { patient: ctx, screen: 'patient' } : { screen: 'message' }).then((r) => {
            if (!r.ok || r.message) setNotice(r.message || 'DrFirst could not be opened.');
          });
        },
      });
    }
    return q ? items.filter((i) => matchesAllWords(`${i.label} ${i.sub ?? ''} ${i.keywords ?? ''}`, q)) : items;
  }, [nextVisit, allowed, timeZone, role, contextClientId, clientName, q]);

  // "New note for <client>", "Write treatment plan for <client>", "Give PHQ-9 to <client>":
  // the client in view, plus clients whose name matches a word of the search
  const clientActionItems = useMemo((): PaletteItem[] => {
    if (!canOpenCharts) return [];
    const words = q.split(/\s+/).filter((w) => w.length >= 2);
    const targets: { id: string; name: string }[] = [];
    if (contextClientId) targets.push({ id: contextClientId, name: clientName(contextClientId) || 'this client' });
    if (words.length) {
      for (const c of clients) {
        if (targets.length >= 4) break;
        const n = c.name.toLowerCase();
        if (c.id !== contextClientId && words.some((w) => n.includes(w))) targets.push({ id: c.id, name: c.name });
      }
    }
    const out: PaletteItem[] = [];
    for (const t of targets) {
      const id = encodeURIComponent(t.id);
      const candidates: PaletteItem[] = [
        { key: `note-${t.id}`, label: `New note for ${t.name}`, href: `/dashboard/ehr/notes?clientId=${id}`, icon: <FilePen size={15} />, chip: true, keywords: 'progress note write document' },
        { key: `plan-${t.id}`, label: `Write treatment plan for ${t.name}`, href: `/dashboard/ehr/treatment-plans?clientId=${id}`, icon: <ClipboardList size={15} />, chip: true, keywords: 'treatment plan goals' },
        { key: `phq9-${t.id}`, label: `Give PHQ-9 to ${t.name}`, href: assessmentHref('PHQ-9', t.id), icon: <BarChart3 size={15} />, chip: true, keywords: 'phq-9 phq9 depression measure assessment' },
        { key: `book-${t.id}`, label: `Book appointment for ${t.name}`, href: `/dashboard/appointments?new=1&client=${id}`, icon: <CalendarPlus size={15} />, chip: true, keywords: 'book schedule follow-up appointment' },
      ];
      for (const c of candidates) {
        if (!c.href || !allowed(c.href)) continue;
        // No search: every action for the client in view. Search: actions whose words all match,
        // so "jane" lists Jane's actions and "note jane" only her new note.
        if (!q || matchesAllWords(`${c.label} ${c.keywords ?? ''}`, q)) out.push(c);
      }
    }
    return out.slice(0, 12);
  }, [canOpenCharts, q, contextClientId, clientName, clients, allowed]);

  const sections = useMemo((): PaletteSection[] => {
    const list: PaletteSection[] = [
      { id: 'actions', title: 'Actions', description: 'Do it from here: Enter runs the highlighted action', items: actionItems },
      { id: 'client-actions', title: 'Client actions', description: 'For the client in view or the client you searched', items: clientActionItems },
      {
        id: 'recent',
        title: 'Recent clients',
        description: 'Charts you opened recently',
        items: filteredRecent.map((c) => ({
          key: `recent-${c.id}`,
          label: c.name,
          sub: c.mrn ? `MRN ${c.mrn}` : undefined,
          href: `/dashboard/clients/${encodeURIComponent(c.id)}`,
          icon: <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700"><UserRound size={15} aria-hidden /></span>,
        })),
      },
      {
        id: 'pinned',
        title: 'Pinned pages',
        description: 'Starred in the sidebar',
        items: pinnedNav.map((item) => ({ key: `pin-${item.href}`, label: item.label, sub: item.section, href: item.href, icon: <Star size={14} className="shrink-0 fill-[#D4A017] text-[#D4A017]" aria-hidden /> })),
      },
      {
        id: 'pages',
        title: 'Pages',
        description: 'Jump to any page you can open',
        items: filteredNav.map((item) => ({ key: `nav-${item.section}-${item.href}`, label: item.label, sub: item.section, href: item.href, icon: null })),
      },
      {
        id: 'today',
        title: "Today's patients",
        description: 'Open profile from the appointment board',
        persistent: true,
        loadingText: 'Loading search data…',
        emptyText: 'No matching appointments today.',
        headerLink: { href: '/dashboard/appointments', label: 'Open board' },
        items: todayAppointments.map((appt) => ({
          key: `appt-${appt.id}`,
          label: appt.clientName,
          sub: `${formatWallClock(appt.startTime)} ${practiceZoneLabel(appt.timeZone ?? timeZone)} - ${appt.type}`,
          href: `/dashboard/clients/${appt.clientId}`,
          icon: <ClientAvatar name={appt.clientName} image={appt.clientImage} size="sm" />,
          trailing: (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              <CalendarClock size={12} />
              {appt.status.replace('-', ' ')}
            </span>
          ),
        })),
      },
      {
        id: 'clients',
        title: 'Client profiles',
        description: 'Search and open patient profile directly',
        persistent: true,
        loadingText: 'Loading clients…',
        emptyText: 'No clients match your search.',
        items: filteredClients.map((client) => ({
          key: `client-${client.id}`,
          label: client.name,
          sub: [client.email, client.phone].filter(Boolean).join(' - ') || 'No contact on file',
          href: `/dashboard/clients/${client.id}`,
          icon: <ClientAvatar name={client.name} image={client.image} size="sm" />,
          trailing: (
            <span className="clinic-badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">{client.risk} risk</span>
          ),
        })),
      },
    ];
    return list.filter((s) => s.persistent || s.items.length > 0);
  }, [actionItems, clientActionItems, filteredRecent, pinnedNav, filteredNav, todayAppointments, filteredClients, timeZone]);

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  /** Index of each section's first row in `flat` (keyboard navigation runs across sections) */
  const sectionStarts = useMemo(() => {
    const starts: number[] = [];
    let n = 0;
    for (const sec of sections) {
      starts.push(n);
      n += sec.items.length;
    }
    return starts;
  }, [sections]);

  useEffect(() => {
    setActiveIndex(0);
  }, [q, open]);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`cmd-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const activate = (item: PaletteItem | undefined) => {
    if (!item) return;
    if (item.run) item.run();
    else if (item.href) router.push(item.href);
    setOpen(false);
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (isHrSearch || !flat.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + flat.length) % flat.length);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(flat.length - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(flat[Math.min(activeIndex, flat.length - 1)]);
    }
  };

  const filteredStaff = useMemo(() => {
    const ordered = [...staff].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
    if (!q) return ordered.slice(0, 10);
    return ordered
      .filter((user) => {
        const haystack = [
          user.name,
          user.email,
          user.role,
          user.status,
          user.primaryLocationName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 10);
  }, [q, staff]);

  const activeStaff = staff.filter((user) => user.status === 'ACTIVE').length;
  const invitedStaff = staff.filter((user) => user.status === 'INVITED').length;

  const renderItem = (item: PaletteItem, index: number) => {
    const active = index === activeIndex;
    const className = `flex w-full items-center gap-3 px-4 py-3 text-left transition ${active ? 'bg-blue-50' : 'hover:bg-slate-50'}`;
    const body = (
      <>
        {item.icon ? (item.chip ? iconChip(item.icon) : item.icon) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{item.label}</p>
          {item.sub ? <p className="truncate text-xs text-slate-500">{item.sub}</p> : null}
        </div>
        {item.trailing ?? <ArrowRight size={14} className="text-slate-500" aria-hidden />}
      </>
    );
    const common = {
      id: `cmd-opt-${index}`,
      role: 'option' as const,
      'aria-selected': active,
      onMouseEnter: () => setActiveIndex(index),
      className,
    };
    return item.run ? (
      <button key={item.key} type="button" {...common} onClick={() => activate(item)}>
        {body}
      </button>
    ) : (
      <Link key={item.key} href={item.href as string} {...common} onClick={() => setOpen(false)}>
        {body}
      </Link>
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm sm:h-10 font-semibold text-slate-700 shadow-sm transition hover:border-blue-600/30 hover:text-slate-900 hover:shadow-[0_10px_24px_rgba(20,28,52,0.08)]"
        aria-label={`${isHrSearch ? 'Search staff' : 'Search patients and pages'} (${shortcutLabel})`}
        aria-keyshortcuts="Control+K Meta+K /"
      >
        <Search size={15} />
        <span className="hidden sm:inline">{isHrSearch ? 'Search staff' : 'Search'}</span>
        <kbd className="hidden rounded-md border border-slate-200 bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] font-bold text-slate-500 sm:inline">
          {shortcutLabel}
        </kbd>
      </button>

      {helpOpen ? <KeyboardShortcutsDialog isMac={isMac} onClose={() => setHelpOpen(false)} /> : null}

      {open && (
        <div className="fixed inset-0 z-[90]">
          <button
            type="button"
            aria-label="Close search"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />
          <div className="absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] mx-auto flex max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top))] max-w-3xl flex-col overflow-hidden rounded-2xl border sm:inset-x-4 sm:top-4 border-slate-200/80 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.2)]">
            <div className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-3 sm:py-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <Search size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                  {isHrSearch ? 'Staff search' : 'Command palette'}
                </p>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onInputKeyDown}
                  {...(isHrSearch
                    ? {}
                    : {
                        role: 'combobox',
                        'aria-expanded': true,
                        'aria-controls': 'cmd-listbox',
                        'aria-activedescendant': flat.length ? `cmd-opt-${activeIndex}` : undefined,
                        'aria-label': 'Search actions, pages and patients',
                      })}
                  placeholder={
                    isHrSearch
                      ? 'Search staff name, email, role, location…'
                      : 'Type an action or a name: "note jane", "phq-9", "start session"…'
                  }
                  className="mt-1 w-full border-0 bg-transparent p-0 text-base font-semibold text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-0"
                />
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grid h-10 w-10 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-700"
                aria-label="Close search panel"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 max-h-[70dvh] flex-1 overflow-y-auto overscroll-contain p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4">
              {isHrSearch ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Staff
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{staff.length}</p>
                      <p className="mt-1 text-xs text-slate-500">portal accounts</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Active
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{activeStaff}</p>
                      <p className="mt-1 text-xs text-slate-500">ready to work</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Invites
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{invitedStaff}</p>
                      <p className="mt-1 text-xs text-slate-500">pending setup</p>
                    </div>
                  </div>

                  {error && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}

                  <section className="rounded-xl border border-slate-200/80 bg-white">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                      <div>
                        <h3 className="text-sm font-black text-slate-900">Staff directory</h3>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Search HR records by name, role, email, or location
                        </p>
                      </div>
                      <Link
                        href="/dashboard/hr"
                        onClick={() => setOpen(false)}
                        className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                      >
                        HR home <ArrowRight size={14} />
                      </Link>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {loading ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                          Loading staff…
                        </div>
                      ) : filteredStaff.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-500">
                          No staff match your search.
                        </div>
                      ) : (
                        filteredStaff.map((user) => (
                          <Link
                            key={user.id}
                            href="/dashboard/hr"
                            onClick={() => setOpen(false)}
                            className="flex items-center gap-3 px-4 py-3 transition hover:bg-slate-50"
                          >
                            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-bold text-blue-700">
                              {(user.name || user.email).slice(0, 1).toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="truncate text-sm font-semibold text-slate-900">
                                  {user.name || user.email}
                                </p>
                                <span className="clinic-badge bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                                  {user.role.replaceAll('_', ' ')}
                                </span>
                              </div>
                              <p className="truncate text-xs text-slate-500">
                                {[user.email, user.primaryLocationName, user.status]
                                  .filter(Boolean)
                                  .join(' - ')}
                              </p>
                            </div>
                            <ArrowRight size={14} className="text-slate-500" />
                          </Link>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              ) : (
                <>
                  <div className="mb-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Today
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">
                        {todayAppointments.length}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">patients on board</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Open
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">{openCount}</p>
                      <p className="mt-1 text-xs text-slate-500">scheduled or checked in</p>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                        Profiles
                      </p>
                      <p className="mt-1 text-2xl font-black text-slate-900">
                        {filteredClients.length}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">matching clients</p>
                    </div>
                  </div>

                  {error && (
                    <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {error}
                    </div>
                  )}
                  {notice && (
                    <div role="status" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {notice}
                    </div>
                  )}

                  <div id="cmd-listbox" role="listbox" aria-label="Commands and results" className="space-y-4">
                    {sections.map((section, sectionIndex) => {
                      const start = sectionStarts[sectionIndex] ?? 0;
                      return (
                        <section key={section.id} role="group" aria-label={section.title} className="rounded-xl border border-slate-200/80 bg-white">
                          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                            <div>
                              <h3 className="text-sm font-black text-slate-900">{section.title}</h3>
                              <p className="mt-0.5 text-xs text-slate-500">{section.description}</p>
                            </div>
                            {section.headerLink ? (
                              <Link
                                href={section.headerLink.href}
                                onClick={() => setOpen(false)}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 hover:text-blue-700"
                              >
                                {section.headerLink.label} <ArrowRight size={14} />
                              </Link>
                            ) : null}
                          </div>
                          <div className="divide-y divide-slate-100">
                            {section.persistent && loading ? (
                              <div className="px-4 py-8 text-center text-sm text-slate-500">{section.loadingText}</div>
                            ) : section.items.length === 0 ? (
                              <div className="px-4 py-8 text-center text-sm text-slate-500">{section.emptyText}</div>
                            ) : (
                              section.items.map((item, i) => renderItem(item, start + i))
                            )}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                  <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-500">
                    <Keyboard size={13} aria-hidden /> Arrow keys to move, Enter to run, Esc to close. Press ? on any page for shortcuts.
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
