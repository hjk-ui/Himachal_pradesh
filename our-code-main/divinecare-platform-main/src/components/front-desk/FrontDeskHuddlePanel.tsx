'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import {
  HUDDLE_TAB_LABELS,
  HUDDLE_TABS,
  type HuddleTab,
} from '@/lib/front-desk/huddle-checklist';
import type { HuddleAppointmentRow } from '@/lib/front-desk/huddle';

type EodTile = { id: string; label: string; count: number };

export function FrontDeskHuddlePanel() {
  const [tab, setTab] = useState<HuddleTab>('today');
  const [day, setDay] = useState('');
  const [appointments, setAppointments] = useState<HuddleAppointmentRow[]>([]);
  const [eod, setEod] = useState<EodTile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiJson<{
      success: boolean;
      day?: string;
      appointments?: HuddleAppointmentRow[];
      eod?: EodTile[];
      error?: string;
    }>(`/api/front-desk/huddle?tab=${tab}`)
      .then((res) => {
        if (cancelled) return;
        if (!res.success) {
          setError(res.error || 'Unable to load huddle');
          return;
        }
        setError(null);
        setDay(res.day || '');
        setAppointments(res.appointments || []);
        setEod(res.eod || []);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Unable to load huddle');
      });
    return () => {
      cancelled = true;
    };
  }, [tab]);

  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
      data-testid="front-desk-huddle"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">Front desk huddle</h2>
          <p className="text-xs text-slate-500">
            Minimum necessary — no notes, diagnoses, medications, or risk detail
            {day ? ` · ${day}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-1">
          {HUDDLE_TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                tab === t ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              {HUDDLE_TAB_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-amber-800">{error}</p> : null}

      {tab === 'end_of_day' ? (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {eod.map((tile) => (
            <div
              key={tile.id}
              className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2"
            >
              <p className="text-lg font-bold tabular-nums text-slate-900">{tile.count}</p>
              <p className="text-xs font-medium text-slate-600">{tile.label}</p>
            </div>
          ))}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {appointments.length === 0 ? (
            <li className="py-3 text-sm text-slate-500">No appointments for this day.</li>
          ) : (
            appointments.map((appt) => (
              <li key={appt.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-slate-900">{appt.clientName}</p>
                  <span className="text-xs text-slate-500">
                    {new Date(appt.startsAt).toLocaleTimeString([], {
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${
                      appt.readiness === 'Ready'
                        ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                        : appt.readiness === 'Cancelled'
                          ? 'bg-slate-50 text-slate-600 ring-slate-200'
                          : appt.readiness === 'Resolve first'
                            ? 'bg-rose-50 text-rose-800 ring-rose-200'
                            : 'bg-amber-50 text-amber-900 ring-amber-200'
                    }`}
                  >
                    {appt.readiness}
                  </span>
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === appt.id ? null : appt.id)}
                    className="ml-auto text-xs font-semibold text-slate-600 hover:underline"
                  >
                    Checklist
                  </button>
                  <Link
                    href={appt.href}
                    className="text-xs font-semibold text-violet-700 hover:underline"
                  >
                    Open
                  </Link>
                </div>
                {expanded === appt.id ? (
                  <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                    {appt.checklist.map((item) => (
                      <li
                        key={item.label}
                        className={`text-xs ${item.done ? 'text-emerald-700' : 'text-slate-600'}`}
                      >
                        {item.done ? '✓' : '○'} {item.label}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))
          )}
        </ul>
      )}
    </section>
  );
}
