'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Bot, MessageSquare, Minimize2, Search, Sparkles } from 'lucide-react';
import type { DashboardOverview as OverviewData } from '../types';

type CopilotResult = {
  title: string;
  body: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

type Props = {
  data: OverviewData;
  firstName?: string | null;
};

const QUICK_PROMPTS = [
  'How many patients today?',
  'High risk clients',
  'Today appointments',
  'Open roster',
] as const;

function normalize(value: string) {
  return value.trim().toLowerCase();
}

function isTodayQuery(query: string) {
  return /(\baaj\b|\baj\b|\btoday\b|\btoday's\b|\bkitna\b|\bkitne\b|\bkitni\b)/i.test(query);
}

function isRiskQuery(query: string) {
  return /high\s*risk|\brisk\b/i.test(query);
}

function isAlertQuery(query: string) {
  return /\balert(s)?\b|\brisk alert(s)?\b/i.test(query);
}

function isAppointmentQuery(query: string) {
  return /\bappointment(s)?\b|\bschedule\b|\bboard\b|\bvisit(s)?\b/i.test(query);
}

function isCountQuery(query: string) {
  return /\bkitna\b|\bkitne\b|\bkitni\b|\bcount\b|\bhow many\b|\bhow much\b|\bremaining\b|\bleft\b|\bbacha\b|\bbache\b|\bbaki\b/i.test(query);
}

function isProfileQuery(query: string) {
  return /\bprofile\b|\bopen\b|\bshow\b|\bfind\b|\bsearch\b|\bdhoondo\b/i.test(query);
}

function extractTokens(query: string) {
  return normalize(query)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9@.-]/g, ''))
    .filter((token) => token.length > 1);
}

function isTodayPatientCountQuery(query: string) {
  const compact = normalize(query).replace(/[^a-z0-9]+/g, '');
  return (
    (/(\baaj\b|\baj\b|\btoday\b)/i.test(query) &&
      /(\bkitna\b|\bkitne\b|\bkitni\b|\bhowmany\b|\bcount\b|\bremaining\b|\bleft\b|\bbacha\b|\bbache\b|\bbaki\b)/i.test(query)) ||
    (/\bpatient(s)?\b|\bclient(s)?\b/i.test(query) &&
      /(\bkitna\b|\bkitne\b|\bkitni\b|\bcount\b|\bremaining\b|\bleft\b|\bbacha\b|\bbache\b|\bbaki\b)/i.test(query)) ||
    compact.includes('aajkitnepatient') ||
    compact.includes('aajkitnapatient') ||
    compact.includes('todayhowmanypatient') ||
    compact.includes('todaypatientcount')
  );
}

export function DashboardCopilot({ data, firstName }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CopilotResult | null>(null);
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const todayAppointments = data.appointments;
  const completedAppointments = todayAppointments.filter((appt) => appt.status === 'completed').length;
  const openAppointments = todayAppointments.filter((appt) => appt.status !== 'completed').length;
  const highRiskClients = data.clients.filter((client) => client.risk === 'high');
  const avgMood =
    data.clients.length > 0
      ? Math.round((data.clients.reduce((sum, client) => sum + client.mood, 0) / data.clients.length) * 10) /
        10
      : 0;

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  const suggestions = useMemo(() => {
    const clientOptions = [...data.clients]
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 3)
      .map((client) => `${client.name} profile`);

    return [...QUICK_PROMPTS, ...clientOptions];
  }, [data.clients]);

  const answer = (rawQuery: string): CopilotResult => {
    const q = normalize(rawQuery);
    const tokens = extractTokens(rawQuery);
    const matchedClients = data.clients
      .filter((client) => tokens.some((token) => client.name.toLowerCase().includes(token)))
      .slice(0, 3);

    if (isTodayPatientCountQuery(q)) {
      return {
        title: 'Today patient count',
        body: `${todayAppointments.length} patients are on today's schedule.`,
        primaryHref: '/dashboard/appointments',
        primaryLabel: 'Open board',
        secondaryHref: '/dashboard/clients',
        secondaryLabel: 'Open roster',
      };
    }

    if (tokens.length > 0 && matchedClients.length > 0 && isProfileQuery(q)) {
      const top = matchedClients[0];
      return {
        title: `${top.name} profile found`,
        body: `Risk ${top.risk}, last check-in ${top.lastCheckIn}, streak ${top.streak}d.`,
        primaryHref: `/dashboard/clients/${top.id}`,
        primaryLabel: 'Open profile',
        secondaryHref: '/dashboard/clients',
        secondaryLabel: 'Open roster',
      };
    }

    if (isRiskQuery(q)) {
      return {
        title: 'High risk review',
        body: `${highRiskClients.length} clients are high risk right now.`,
        primaryHref: '/dashboard/clients?risk=high',
        primaryLabel: 'Open clients',
        secondaryHref: '/dashboard/alerts',
        secondaryLabel: 'View alerts',
      };
    }

    if (isAlertQuery(q)) {
      return {
        title: 'Alert queue',
        body: `${data.alerts.length} alerts are waiting on review.`,
        primaryHref: '/dashboard/alerts',
        primaryLabel: 'Open alerts',
        secondaryHref: '/dashboard/clients',
        secondaryLabel: 'Open roster',
      };
    }

    if (isTodayQuery(q) && (isAppointmentQuery(q) || isCountQuery(q))) {
      return {
        title: 'Today board',
        body: `${todayAppointments.length} appointments today, ${completedAppointments} completed, ${openAppointments} still open.`,
        primaryHref: '/dashboard/appointments',
        primaryLabel: 'Open board',
        secondaryHref: '/dashboard/clients',
        secondaryLabel: 'Open roster',
      };
    }

    if (isAppointmentQuery(q)) {
      return {
        title: 'Appointments',
        body: `${todayAppointments.length} appointments in the live schedule.`,
        primaryHref: '/dashboard/appointments',
        primaryLabel: 'Open appointments',
        secondaryHref: '/dashboard/clients',
        secondaryLabel: 'Open roster',
      };
    }

    if (/mood|wellness|stress/i.test(q)) {
      return {
        title: 'Wellness snapshot',
        body: `Average mood is ${avgMood}/10 across visible clients.`,
        primaryHref: '/dashboard/clients',
        primaryLabel: 'Open roster',
        secondaryHref: '/dashboard/alerts',
        secondaryLabel: 'View alerts',
      };
    }

    if (q.length > 0) {
      return {
        title: 'I found this',
        body: 'I could not find an exact match. Try patient name, diagnosis, risk, or appointments.',
        primaryHref: '/dashboard/clients',
        primaryLabel: 'Open roster',
        secondaryHref: '/dashboard/appointments',
        secondaryLabel: 'Open board',
      };
    }

    return {
      title: 'Ask me anything',
      body: firstName
        ? `Hi ${firstName}, you can ask: “how many patients today”, “high risk clients”, or any client name.`
        : 'You can ask: “how many patients today”, “high risk clients”, or any client name.',
      primaryHref: '/dashboard/appointments',
      primaryLabel: 'Open board',
      secondaryHref: '/dashboard/clients',
      secondaryLabel: 'Open roster',
    };
  };

  const runQuery = (value: string) => {
    const next = value.trim();
    if (!next) return;
    setOpen(true);
    setThinking(true);
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
    timerRef.current = window.setTimeout(() => {
      setResult(answer(next));
      setThinking(false);
    }, 500);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runQuery(query);
  };

  const onPrompt = (prompt: string) => {
    setQuery(prompt);
    runQuery(prompt);
  };

  return (
    <div className="fixed bottom-5 right-5 z-50">
      {open ? (
        <div className="w-[min(92vw,360px)] overflow-hidden rounded-[1.5rem] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#EEF0FE] text-[#6868D0]">
                <Bot size={18} />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Dashboard copilot
                </p>
                <p className="truncate text-sm font-semibold text-slate-900">
                  {thinking ? 'Thinking...' : result?.title || 'Ask me anything'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:bg-slate-50"
              aria-label="Minimize copilot"
            >
              <Minimize2 size={16} />
            </button>
          </div>

          <div className="px-4 py-4">
            <div className="text-sm leading-6 text-slate-600">
              {thinking ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-[#6868D0]" />
                    <span
                      className="h-2 w-2 animate-pulse rounded-full bg-[#6868D0]"
                      style={{ animationDelay: '120ms' }}
                    />
                    <span
                      className="h-2 w-2 animate-pulse rounded-full bg-[#6868D0]"
                      style={{ animationDelay: '240ms' }}
                    />
                  </span>
                  <span>Thinking...</span>
                </div>
              ) : (
                <p>
                  {result?.body ||
                    'Type here and I will suggest the right page or patient profile.'}
                </p>
              )}
            </div>

            {(result?.primaryHref || result?.secondaryHref) && (
              <div className="mt-3 flex flex-wrap gap-2">
                {result.primaryHref && result.primaryLabel && (
                  <Link
                    href={result.primaryHref}
                    className="inline-flex items-center gap-1 rounded-xl bg-[#141C34] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#1d2850]"
                  >
                    {result.primaryLabel}
                    <ArrowRight size={14} />
                  </Link>
                )}
                {result.secondaryHref && result.secondaryLabel && (
                  <Link
                    href={result.secondaryHref}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-[#6868D0]/30 hover:text-[#141C34]"
                  >
                    {result.secondaryLabel}
                  </Link>
                )}
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-4">
              <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                <Search size={15} className="shrink-0 text-slate-400" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="How many patients today?"
                  className="w-full bg-transparent text-sm font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="grid h-8 w-8 place-items-center rounded-xl bg-[#6868D0] text-white transition hover:bg-[#5b5bc0]"
                  aria-label="Send"
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>

            <div className="mt-3 flex flex-wrap gap-2">
              {suggestions.slice(0, 4).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => onPrompt(item)}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#6868D0]/30 hover:text-[#141C34]"
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)] transition hover:-translate-y-0.5 hover:border-[#6868D0]/30"
          aria-label="Open dashboard copilot"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-[#141C34] text-white">
            <MessageSquare size={18} />
          </span>
          <span className="hidden pr-1 text-sm font-semibold text-slate-700 sm:inline">
            Ask Copilot
          </span>
          <span className="hidden rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500 sm:inline">
            AI Chat
          </span>
          <Sparkles size={14} className="hidden text-[#6868D0] sm:inline" />
        </button>
      )}
    </div>
  );
}
