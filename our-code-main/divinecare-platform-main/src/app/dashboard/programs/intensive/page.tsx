'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useClients } from '@/features/clients';
import { useAuth } from '@/features/auth';
import { INTENSIVE_HUB_TABS, type IntensiveHubTabId } from '@/lib/programs/intensive-hub';

const TRACKS = [
  { id: 'mh-iop', label: 'Mental-health IOP', part2: false },
  { id: 'sud-iop', label: 'SUD IOP', part2: true },
  { id: 'php', label: 'PHP', part2: false },
] as const;

type Enrollment = {
  id: string;
  clientId: string;
  clientName: string;
  track: string;
  days: string[];
  status: string;
  part2?: boolean;
};

export default function IntensiveProgramsPage() {
  const { user } = useAuth();
  const search = useSearchParams();
  const leadership =
    user?.role === 'ADMIN' ||
    user?.role === 'DIRECTOR' ||
    user?.role === 'PRACTICE_DIRECTOR' ||
    user?.role === 'PHYSICIAN';

  const visibleTabs = useMemo(
    () => INTENSIVE_HUB_TABS.filter((t) => !t.leadershipOnly || leadership),
    [leadership]
  );

  const [hubTab, setHubTab] = useState<IntensiveHubTabId>('roster');
  const [query, setQuery] = useState('');
  const { clients } = useClients({ search: query, limit: 50 });
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [phpLicensed, setPhpLicensed] = useState(false);
  const [clientId, setClientId] = useState('');
  const [track, setTrack] = useState<(typeof TRACKS)[number]['id']>('mh-iop');
  const [days, setDays] = useState('Monday, Wednesday, Thursday');
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/programs/intensive', { cache: 'no-store' })
      .then((response) => response.json())
      .then((data) => {
        if (!data.success) return;
        setRows(data.enrollments || []);
        setPhpLicensed(Boolean(data.phpLicensed));
      })
      .catch(() => undefined);
  }, []);

  function chooseTrack(next: (typeof TRACKS)[number]['id']) {
    setTrack(next);
    setDays(
      next === 'php'
        ? 'Monday, Tuesday, Wednesday, Thursday, Friday'
        : 'Monday, Wednesday, Thursday'
    );
  }

  async function save() {
    setMessage('');
    const response = await fetch('/api/programs/intensive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId,
        track,
        days: days
          .split(',')
          .map((day) => day.trim())
          .filter(Boolean),
        status: 'active',
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok === false) {
      setMessage(data.error || 'The enrollment was not saved.');
      return;
    }
    setRows((prev) => [data.enrollment, ...prev]);
    setMessage(track === 'sud-iop' ? 'SUD IOP saved. This track is Part 2.' : 'Enrollment saved.');
  }

  async function confirmPhp() {
    const response = await fetch('/api/programs/intensive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmPhpLicensure: true }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) setPhpLicensed(true);
    setMessage(response.ok ? 'PHP licensure confirmed.' : data.error || 'PHP was not confirmed.');
  }

  const active = rows.filter((r) => !/discharg|declin/i.test(r.status));
  const discharged = rows.filter((r) => /discharg/i.test(r.status));
  const referred = rows.filter((r) => /refer|screen/i.test(r.status));

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Intensive programs</h1>
          <p className="text-sm text-slate-500">
            Mental-health IOP, SUD IOP, and PHP. Charge drafts only — no claim submit from this module.
          </p>
        </div>
        <Link
          href="/dashboard/programs/intensive/billing"
          className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Billing drafts
        </Link>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-1.5">
        {visibleTabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setHubTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
              hubTab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {hubTab === 'roster' || hubTab === 'census' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-900">
            {hubTab === 'roster' ? "Today's roster" : 'Census & weekly hours / My program clients'}
          </h2>
          <ul className="mt-2 divide-y text-sm">
            {active.length === 0 ? (
              <li className="py-2 text-slate-500">No active enrollments on your caseload.</li>
            ) : (
              active.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span>
                    {row.clientName} · {row.track} · {row.days.join(', ')}
                    {row.part2 ? ' · Part 2' : ''}
                  </span>
                  <Link
                    href={`/dashboard/programs/intensive/${row.id}`}
                    className="text-xs font-semibold text-indigo-700 hover:underline"
                  >
                    Episode
                  </Link>
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {hubTab === 'referrals' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
          <h2 className="font-semibold">Referrals & admissions</h2>
          <p className="text-sm text-slate-500">
            {referred.length} referral/screening rows · enroll below when appropriate
          </p>
          <div className="flex flex-wrap gap-2">
            {TRACKS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => chooseTrack(item.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                  track === item.id ? 'bg-indigo-700 text-white' : 'border border-slate-300'
                }`}
              >
                {item.label}
                {item.part2 ? ' · Part 2' : ''}
              </button>
            ))}
          </div>
          {track === 'php' && !phpLicensed ? (
            <p className="text-sm text-amber-800">
              PHP starts inactive until phpLicensureConfirmed.
            </p>
          ) : null}
          <label className="block text-sm font-semibold">
            Client
            <input
              className="mt-1 block w-full rounded-lg border px-2 py-1.5"
              placeholder="Find a client"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <select
              className="mt-1 block w-full rounded-lg border px-2 py-1.5"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
            >
              <option value="">Choose a client on your caseload</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold">
            Week days
            <input
              className="mt-1 block w-full rounded-lg border px-2 py-1.5"
              value={days}
              onChange={(event) => setDays(event.target.value)}
            />
          </label>
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-lg bg-indigo-700 px-3 py-2 text-sm font-semibold text-white"
          >
            Save enrollment
          </button>
          {message ? <p className="text-sm text-slate-700">{message}</p> : null}
        </section>
      ) : null}

      {hubTab === 'outreach' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Missed-day outreach</h2>
          <p className="mt-1 text-sm text-slate-500">
            Default window 24 hours after a missed day — none on file until attendance is logged.
          </p>
        </section>
      ) : null}

      {hubTab === 'discharges' ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold">Discharges</h2>
          <ul className="mt-2 divide-y text-sm">
            {discharged.length === 0 ? (
              <li className="py-2 text-slate-500">No discharges yet.</li>
            ) : (
              discharged.map((row) => (
                <li key={row.id} className="py-2">
                  {row.clientName} · {row.track}
                </li>
              ))
            )}
          </ul>
        </section>
      ) : null}

      {hubTab === 'director' && leadership ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="font-semibold">Program director</h2>
          <p className="text-sm text-slate-600">
            Active census: {active.length} · PHP licensure:{' '}
            {phpLicensed ? 'confirmed' : 'not confirmed'}
          </p>
          {!phpLicensed ? (
            <button
              type="button"
              onClick={() => void confirmPhp()}
              className="rounded-lg border border-amber-300 px-3 py-1.5 text-sm font-semibold"
            >
              Confirm PHP licensure
            </button>
          ) : null}
          {message ? <p className="text-sm text-slate-700">{message}</p> : null}
        </section>
      ) : null}

      {hubTab === 'setup' && leadership ? (
        <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
          <h2 className="font-semibold">Program setup</h2>
          <p className="text-sm text-slate-600">
            Policy defaults until confirmed: IOP adult min 9 hrs/wk · adolescent 6 · PHP 20 · plan
            review IOP 30 / PHP 14 · missed-day outreach 24h · follow-up window 7 days.
          </p>
          <p className="text-sm text-slate-500">
            Hold reasons include no_auth, auth exhausted, below minimum, PHP psych eval missing, note
            missing, policy_unconfirmed.
          </p>
        </section>
      ) : null}
    </div>
  );
}
