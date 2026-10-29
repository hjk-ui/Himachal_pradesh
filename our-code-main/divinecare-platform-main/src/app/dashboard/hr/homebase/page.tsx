'use client';

import { useCallback, useEffect, useState } from 'react';
import { HOMEBASE_COPY, HOMEBASE_TABS, type HomebaseTab } from '@/lib/homebase/copy';

type Status = {
  connected: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    locationCount: number;
    employeeCount: number;
    matchedCount: number;
    error: string | null;
  } | null;
};
type Location = { id: string; name: string };
type RosterRow = {
  linkId: string;
  displayName: string | null;
  homebaseLocationId: string | null;
  matchStatus: string;
  userId: string | null;
  userName: string | null;
};
type Staff = { id: string; name: string | null };
type HoursRow = {
  homebaseEmployeeId: string;
  displayName: string | null;
  userName: string | null;
  matchStatus: string;
  regularHours: number;
  overtimeHours: number;
  totalHours: number;
};
type Payroll = {
  matched: HoursRow[];
  unmatched: HoursRow[];
  matchedTotalHours: number;
  unmatchedTotalHours: number;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.error || 'Something went wrong');
  return data as T;
}

const th = 'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500';
const td = 'px-3 py-2 text-sm text-slate-800';

function Empty({ text }: { text: string }) {
  return <p className="px-3 py-6 text-sm text-slate-500">{text}</p>;
}

export default function HomebasePage() {
  const [tab, setTab] = useState<HomebaseTab>('Connection');
  const [status, setStatus] = useState<Status | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [hours, setHours] = useState<HoursRow[]>([]);
  const [payroll, setPayroll] = useState<Payroll | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>('/api/hr/homebase/status'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load Homebase status');
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    setError(null);
    const run = async () => {
      try {
        if (tab === 'Locations') setLocations((await api<{ locations: Location[] }>('/api/hr/homebase/locations')).locations);
        if (tab === 'Roster match') {
          const d = await api<{ roster: RosterRow[]; staff: Staff[] }>('/api/hr/homebase/roster');
          setRoster(d.roster);
          setStaff(d.staff);
        }
        if (tab === 'Hours') setHours((await api<{ hours: HoursRow[] }>('/api/hr/homebase/hours')).hours);
        if (tab === 'Payroll reconciliation') setPayroll((await api<{ payroll: Payroll }>('/api/hr/homebase/payroll')).payroll);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load Homebase data');
      }
    };
    void run();
  }, [tab, status?.connected]);

  const syncNow = async () => {
    setSyncing(true);
    setError(null);
    try {
      await api('/api/hr/homebase/sync', { method: 'POST' });
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const match = async (linkId: string, userId: string | null, ignore = false) => {
    try {
      await api('/api/hr/homebase/roster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkId, userId, ignore }),
      });
      const d = await api<{ roster: RosterRow[]; staff: Staff[] }>('/api/hr/homebase/roster');
      setRoster(d.roster);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save match');
    }
  };

  const connected = Boolean(status?.connected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900">{HOMEBASE_COPY.title}</h1>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              connected ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {connected ? HOMEBASE_COPY.connected : HOMEBASE_COPY.notConnected}
          </span>
          <button
            type="button"
            onClick={syncNow}
            disabled={!connected || syncing}
            className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {syncing ? HOMEBASE_COPY.syncing : HOMEBASE_COPY.syncNow}
          </button>
        </div>
      </div>

      <div role="tablist" className="flex flex-wrap gap-1 border-b border-slate-200">
        {HOMEBASE_TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        {tab === 'Connection' && (
          <div className="space-y-2 p-4 text-sm text-slate-700">
            {!connected && <p>{HOMEBASE_COPY.notConnectedHelp}</p>}
            {connected && status?.lastRun ? (
              <p>
                Last sync {new Date(status.lastRun.startedAt).toLocaleString()} · {status.lastRun.status.toLowerCase()} ·{' '}
                {status.lastRun.locationCount} locations · {status.lastRun.employeeCount} employees ·{' '}
                {status.lastRun.matchedCount} matched
                {status.lastRun.error ? ` · ${status.lastRun.error}` : ''}
              </p>
            ) : (
              connected && <p>{HOMEBASE_COPY.neverSynced}</p>
            )}
          </div>
        )}

        {tab === 'Locations' &&
          (locations.length === 0 ? (
            <Empty text={HOMEBASE_COPY.emptyLocations} />
          ) : (
            <table className="w-full">
              <thead>
                <tr><th className={th}>Location</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {locations.map((l) => (
                  <tr key={l.id}><td className={td}>{l.name || l.id}</td></tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'Roster match' &&
          (roster.length === 0 ? (
            <Empty text={HOMEBASE_COPY.emptyRoster} />
          ) : (
            <table className="w-full">
              <thead>
                <tr><th className={th}>Homebase employee</th><th className={th}>Status</th><th className={th}>Staff member</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {roster.map((r) => (
                  <tr key={r.linkId}>
                    <td className={td}>{r.displayName || '—'}</td>
                    <td className={td}>{r.matchStatus.toLowerCase()}</td>
                    <td className={td}>
                      <select
                        aria-label={`Match ${r.displayName || 'employee'}`}
                        value={r.userId ?? ''}
                        onChange={(e) => match(r.linkId, e.target.value || null)}
                        className="rounded border border-slate-300 px-2 py-1"
                      >
                        <option value="">Not matched</option>
                        {staff.map((s) => (
                          <option key={s.id} value={s.id}>{s.name || s.id}</option>
                        ))}
                      </select>
                      {r.matchStatus !== 'IGNORED' && !r.userId && (
                        <button type="button" onClick={() => match(r.linkId, null, true)} className="ml-2 text-xs text-slate-500 underline">
                          Not staff here
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}

        {tab === 'Hours' &&
          (hours.length === 0 ? (
            <Empty text={HOMEBASE_COPY.emptyHours} />
          ) : (
            <HoursTable rows={hours} />
          ))}

        {tab === 'Payroll reconciliation' &&
          (!payroll || payroll.matched.length + payroll.unmatched.length === 0 ? (
            <Empty text={HOMEBASE_COPY.emptyPayroll} />
          ) : (
            <div className="space-y-4 p-2">
              <div>
                <h3 className="px-3 pt-2 text-sm font-semibold">Matched · {payroll.matchedTotalHours} h</h3>
                <HoursTable rows={payroll.matched} />
              </div>
              {payroll.unmatched.length > 0 && (
                <div>
                  <h3 className="px-3 text-sm font-semibold">Unmatched · {payroll.unmatchedTotalHours} h</h3>
                  <HoursTable rows={payroll.unmatched} />
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

function HoursTable({ rows }: { rows: HoursRow[] }) {
  return (
    <table className="w-full">
      <thead>
        <tr>
          <th className={th}>Employee</th>
          <th className={th}>Staff member</th>
          <th className={th}>Regular</th>
          <th className={th}>Overtime</th>
          <th className={th}>Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((r) => (
          <tr key={r.homebaseEmployeeId}>
            <td className={td}>{r.displayName || '—'}</td>
            <td className={td}>{r.userName || '—'}</td>
            <td className={td}>{r.regularHours}</td>
            <td className={td}>{r.overtimeHours}</td>
            <td className={td}>{r.totalHours}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
