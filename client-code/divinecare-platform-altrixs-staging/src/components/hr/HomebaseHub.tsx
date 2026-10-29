'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Link2, PlugZap, RefreshCw, Save, Unlink } from 'lucide-react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  LoadingState,
  Page,
  PageHeader,
  StatCard,
  StatGrid,
  StatusBadge,
  Tabs,
  type DataTableColumn,
} from '@/components/ui';
import { Labeled, Select, TextInput } from './HrBits';
import { fmtDateTime, hrFetch, roleLabel, useHrData } from './hrClient';

// ─── Types (mirror src/lib/hr/homebase/*) ────────────────────────────────────

type Status = {
  connection: { connected: boolean; reason: string; label: string; apiHost: string | null };
  lastSync: { at: string; status: string } | null;
  runs: Array<{ id: string; trigger: string; status: string; rangeStart: string; rangeEnd: string; counts: Record<string, number> | null; error: string | null; startedAt: string; finishedAt: string | null }>;
  counts: { locations: number; employees: number; shifts: number; timecards: number };
  locations: Array<{ homebaseId: string; name: string; city: string | null; altrixsLocationId: string | null; suggestedLocationId: string | null; mappedAt: string | null }>;
  altrixsLocations: Array<{ id: string; name: string }>;
};
type RosterRow = {
  key: string;
  category: 'matched' | 'suggested' | 'unmatched_homebase' | 'unmatched_altrixs';
  homebaseId: string | null;
  homebaseName: string | null;
  homebaseEmail: string | null;
  homebaseStatus: string | null;
  homebaseJobTitle: string | null;
  homebaseLocations: string[];
  userId: string | null;
  altrixsName: string | null;
  altrixsEmail: string | null;
  altrixsStatus: string | null;
  altrixsRole: string | null;
  linkStatus: string;
  suggestedUserId: string | null;
  suggestedName: string | null;
  flags: string[];
};
type RosterData = { rows: RosterRow[]; counts: Record<string, number>; staffOptions: Array<{ userId: string; name: string; role: string }> };
type PayRow = { homebaseId: string; name: string; userId: string | null; altrixsName: string | null; hours: number; days: number; timecards: number; openTimecards: number; breakMinutes: number };
type PayData = { start: string; end: string; timeZone: string; rows: PayRow[]; totalHours: number };
type ReconRow = {
  userId: string;
  name: string;
  role: string;
  homebaseLinked: boolean;
  clockedHours: number;
  clockedDays: number;
  openTimecards: number;
  completedVisits: number;
  scheduledVisits: number;
  scheduledVisitMinutes: number;
  signedNotes: number;
  unsignedNotes: number;
  unsignedPastDue: number;
  visitDaysWithoutClockIn: string[];
  visitsWithoutClockIn: number;
  clockedDaysWithoutVisits: string[];
  flags: string[];
};
type ReconData = { start: string; end: string; deadlineHours: number; rows: ReconRow[]; totals: { clinicians: number; clockedHours: number; completedVisits: number; unsignedPastDue: number; flagged: number } };

const ROSTER_FLAG_TEXT: Record<string, string> = {
  active_in_homebase_deactivated_in_altrixs: 'Active in Homebase, deactivated in Altrixs',
  archived_in_homebase_active_in_altrixs: 'Archived in Homebase, Altrixs account active',
  active_in_altrixs_missing_from_homebase: 'Active in Altrixs, not in Homebase',
  active_in_homebase_no_altrixs_account: 'Active in Homebase, no Altrixs account linked',
};
const RECON_FLAG_TEXT: Record<string, string> = {
  unsigned_notes_before_payroll: 'Unsigned notes past due',
  visits_without_clock_in: 'Visits with no clock-in',
  clocked_days_without_visits: 'Clocked days with no visits',
  not_linked_to_homebase: 'Not linked to Homebase',
  open_timecards: 'Open timecards',
};
const CATEGORY_LABEL: Record<RosterRow['category'], string> = {
  matched: 'Matched',
  suggested: 'Suggested (confirm)',
  unmatched_homebase: 'Only in Homebase',
  unmatched_altrixs: 'Only in Altrixs',
};

type TabKey = 'connection' | 'locations' | 'roster' | 'pay' | 'reconcile';

function ymdLocal(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function defaultPeriod() {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 13);
  return { start: ymdLocal(start), end: ymdLocal(end) };
}

function PeriodPicker({ value, onChange }: { value: { start: string; end: string }; onChange: (v: { start: string; end: string }) => void }) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <Labeled label="From">
        <TextInput type="date" value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
      </Labeled>
      <Labeled label="To">
        <TextInput type="date" value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
      </Labeled>
    </div>
  );
}

// ─── Hub ─────────────────────────────────────────────────────────────────────

export function HomebaseHub() {
  const params = useSearchParams();
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>((params.get('tab') as TabKey) || 'connection');
  const status = useHrData<Status>('/api/hr/homebase');
  const changeTab = (k: TabKey) => {
    setTab(k);
    router.replace(`/dashboard/hr/homebase?tab=${k}`, { scroll: false });
  };

  if (status.loading && !status.data) return <Page><LoadingState rows={6} /></Page>;
  if (status.error && !status.data) return <Page><ErrorState description={status.error} onRetry={status.reload} /></Page>;
  const s = status.data;
  if (!s) return null;
  const unmapped = s.locations.filter((l) => !l.altrixsLocationId).length;

  return (
    <Page>
      <PageHeader
        title="Homebase"
        description="Read-only link to Homebase (payroll and timekeeping). Homebase stays the system of record for pay and time; Altrixs never sends anything to Homebase."
        badges={<StatusBadge tone={s.connection.connected ? 'success' : 'neutral'}>{s.connection.connected ? 'Connected (read-only)' : 'Not connected'}</StatusBadge>}
      />
      <Tabs
        label="Homebase sections"
        value={tab}
        onChange={changeTab}
        items={[
          { key: 'connection', label: 'Connection' },
          { key: 'locations', label: 'Locations', count: unmapped || undefined, countTone: 'attention' },
          { key: 'roster', label: 'Roster match' },
          { key: 'pay', label: 'Pay period hours' },
          { key: 'reconcile', label: 'Payroll reconciliation' },
        ]}
      />
      {tab === 'connection' ? <ConnectionPanel status={s} onSynced={status.reload} /> : null}
      {tab === 'locations' ? <LocationsPanel status={s} onSaved={status.reload} /> : null}
      {tab === 'roster' ? <RosterPanel /> : null}
      {tab === 'pay' ? <PayPeriodPanel /> : null}
      {tab === 'reconcile' ? <ReconciliationPanel /> : null}
    </Page>
  );
}

// ─── Connection ──────────────────────────────────────────────────────────────

function ConnectionPanel({ status: s, onSynced }: { status: Status; onSynced: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);
  const sync = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await hrFetch<{ status: string; counts: Record<string, number>; error: string | null }>('/api/hr/homebase/sync', { method: 'POST', json: {} });
      const c = r.counts;
      const text = `${c.locations} locations, ${c.employees} employees, ${c.shifts} shifts, ${c.timecards} timecards synced.`;
      setMsg(r.status === 'success' ? { tone: 'success', text } : { tone: 'warning', text: `${text} ${r.error ?? ''}` });
      onSynced();
    } catch (e) {
      setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'Sync failed' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      {msg ? <Alert tone={msg.tone}>{msg.text}</Alert> : null}
      <Card>
        <CardHeader
          icon={<PlugZap />}
          title="Connection"
          description={s.connection.label}
          actions={
            s.connection.connected ? (
              <Button onClick={sync} disabled={busy} loading={busy}>
                <RefreshCw className="h-4 w-4" aria-hidden /> Sync now
              </Button>
            ) : null
          }
        />
        <CardBody>
          {s.connection.connected ? (
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">API</dt><dd className="font-medium">{s.connection.apiHost ?? '—'}</dd></div>
              <div><dt className="text-slate-500">Last sync</dt><dd className="font-medium">{s.lastSync ? `${fmtDateTime(s.lastSync.at)} (${s.lastSync.status})` : 'Not synced yet'}</dd></div>
            </dl>
          ) : (
            <div className="space-y-3 text-sm text-slate-700">
              <p>No Homebase data is shown until the practice connects its own Homebase account. Altrixs does not show sample employees or hours.</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>In Homebase, an account owner opens Settings, then API Settings, and requests a read-only API key (Homebase approves it).</li>
                <li>Send the key to the Altrixs administrator through a secure channel (never email or chat).</li>
                <li>The administrator stores it in AWS Secrets Manager as altrixs/staging/homebase (HOMEBASE_API_KEY, HOMEBASE_ORGANIZATION_ID) and restarts the app.</li>
                <li>Come back here and choose Sync now, then map locations and review the roster.</li>
              </ol>
            </div>
          )}
        </CardBody>
      </Card>
      <StatGrid>
        <StatCard label="Locations" value={s.counts.locations} />
        <StatCard label="Employees" value={s.counts.employees} />
        <StatCard label="Shifts cached" value={s.counts.shifts} />
        <StatCard label="Timecards cached" value={s.counts.timecards} />
      </StatGrid>
      <Card>
        <CardHeader title="Recent syncs" />
        <CardBody flush>
          <DataTable
            rows={s.runs}
            rowKey={(r) => r.id}
            empty="No syncs yet"
            density="compact"
            columns={[
              { key: 'at', header: 'Started', cell: (r) => fmtDateTime(r.startedAt) },
              { key: 'trigger', header: 'Trigger', cell: (r) => (r.trigger === 'cron' ? 'Scheduled' : 'Sync now') },
              { key: 'range', header: 'Range', cell: (r) => `${r.rangeStart} to ${r.rangeEnd}`, hideOnMobile: true },
              { key: 'status', header: 'Result', cell: (r) => <StatusBadge tone={r.status === 'success' ? 'success' : r.status === 'failed' ? 'danger' : 'warning'}>{r.status}</StatusBadge> },
              {
                key: 'counts',
                header: 'Counts',
                hideOnMobile: true,
                cell: (r) => (r.counts ? `${r.counts.employees ?? 0} employees, ${r.counts.timecards ?? 0} timecards` : '—'),
              },
              { key: 'error', header: 'Note', cell: (r) => r.error ?? '', hideOnMobile: true },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Locations ───────────────────────────────────────────────────────────────

function LocationsPanel({ status: s, onSaved }: { status: Status; onSaved: () => void }) {
  const initial = useMemo(() => Object.fromEntries(s.locations.map((l) => [l.homebaseId, l.altrixsLocationId ?? l.suggestedLocationId ?? ''])), [s.locations]);
  const [map, setMap] = useState<Record<string, string>>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => setMap(initial), [initial]);
  if (!s.locations.length) {
    return <EmptyState title="No Homebase locations yet" description={s.connection.connected ? 'Run Sync now on the Connection tab.' : 'Connect Homebase first (Connection tab).'} />;
  }
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await hrFetch('/api/hr/homebase/locations', {
        method: 'PUT',
        json: { mappings: s.locations.map((l) => ({ homebaseId: l.homebaseId, altrixsLocationId: map[l.homebaseId] || null })) },
      });
      setMsg('Location mapping saved.');
      onSaved();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Location mapping"
        description="Match each Homebase location to an Altrixs clinic. Suggestions come from the names; save to confirm."
        actions={<Button onClick={save} disabled={busy} loading={busy}><Save className="h-4 w-4" aria-hidden /> Save mapping</Button>}
      />
      <CardBody className="space-y-3">
        {msg ? <Alert tone="info">{msg}</Alert> : null}
        {s.locations.map((l) => (
          <div key={l.homebaseId} className="grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div>
              <div className="font-medium text-slate-900">{l.name}</div>
              {l.city ? <div className="text-xs text-slate-500">{l.city}</div> : null}
            </div>
            <Select aria-label={`Altrixs location for ${l.name}`} value={map[l.homebaseId] ?? ''} onChange={(e) => setMap({ ...map, [l.homebaseId]: e.target.value })}>
              <option value="">Not mapped</option>
              {s.altrixsLocations.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <div>
              {l.altrixsLocationId ? <StatusBadge tone="success">Saved</StatusBadge> : l.suggestedLocationId ? <StatusBadge tone="info">Suggested</StatusBadge> : <StatusBadge tone="warning">Unmapped</StatusBadge>}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

// ─── Roster ──────────────────────────────────────────────────────────────────

function RosterPanel() {
  const { data, error, loading, reload } = useHrData<RosterData>('/api/hr/homebase/roster');
  const [filter, setFilter] = useState<'all' | 'flagged' | RosterRow['category']>('all');
  const [pick, setPick] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (homebaseId: string, action: 'confirm' | 'reject' | 'link' | 'unlink', userId?: string) => {
    setMsg(null);
    try {
      await hrFetch('/api/hr/homebase/roster', { method: 'POST', json: { homebaseId, action, userId: userId ?? null } });
      await reload();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : 'Could not update');
    }
  };
  if (loading && !data) return <LoadingState rows={6} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return null;
  const rows = data.rows.filter((r) => (filter === 'all' ? true : filter === 'flagged' ? r.flags.length > 0 : r.category === filter));
  const columns: DataTableColumn<RosterRow>[] = [
    {
      key: 'hb',
      header: 'Homebase',
      cell: (r) =>
        r.homebaseId ? (
          <div>
            <div className="font-medium">{r.homebaseName ?? '—'}</div>
            <div className="text-xs text-slate-500">{[r.homebaseJobTitle, r.homebaseLocations.join(', '), r.homebaseStatus].filter(Boolean).join(' · ')}</div>
            {r.homebaseEmail ? <div className="text-xs text-slate-500">{r.homebaseEmail}</div> : null}
          </div>
        ) : (
          <span className="text-slate-400">Not in Homebase</span>
        ),
    },
    {
      key: 'ax',
      header: 'Altrixs',
      cell: (r) =>
        r.userId ? (
          <div>
            <Link className="font-medium text-blue-700 hover:underline" href={`/dashboard/hr/people/${r.userId}?tab=homebase`}>{r.altrixsName}</Link>
            <div className="text-xs text-slate-500">{[roleLabel(r.altrixsRole), r.altrixsStatus === 'DEACTIVATED' ? 'Deactivated' : r.altrixsStatus === 'INVITED' ? 'Invited' : null].filter(Boolean).join(' · ')}</div>
          </div>
        ) : r.suggestedName ? (
          <span className="text-slate-700">Suggested: {r.suggestedName}</span>
        ) : (
          <span className="text-slate-400">No account linked</span>
        ),
    },
    {
      key: 'cat',
      header: 'Status',
      cell: (r) => (
        <div className="space-y-1">
          <StatusBadge tone={r.category === 'matched' ? 'success' : r.category === 'suggested' ? 'info' : 'warning'}>
            {CATEGORY_LABEL[r.category]}
            {r.category === 'matched' ? (r.linkStatus === 'email' ? ' by email' : ' by HR') : ''}
          </StatusBadge>
          {r.flags.map((f) => (
            <div key={f} className="text-xs text-amber-800">{ROSTER_FLAG_TEXT[f] ?? f}</div>
          ))}
        </div>
      ),
    },
    {
      key: 'act',
      header: 'Action',
      cell: (r) => {
        if (!r.homebaseId) return null;
        const hb = r.homebaseId;
        if (r.category === 'matched') {
          return <Button size="sm" variant="ghost" onClick={() => act(hb, 'unlink')}><Unlink className="h-4 w-4" aria-hidden /> Unlink</Button>;
        }
        if (r.category === 'suggested') {
          return (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => act(hb, 'confirm')}>Confirm</Button>
              <Button size="sm" variant="secondary" onClick={() => act(hb, 'reject')}>Not the same person</Button>
            </div>
          );
        }
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Link to staff member" className="w-auto min-w-[12rem] max-w-full" value={pick[hb] ?? ''} onChange={(e) => setPick({ ...pick, [hb]: e.target.value })}>
              <option value="">Choose staff…</option>
              {data.staffOptions.map((o) => (
                <option key={o.userId} value={o.userId}>{o.name} ({roleLabel(o.role)})</option>
              ))}
            </Select>
            <Button size="sm" variant="secondary" disabled={!pick[hb]} onClick={() => act(hb, 'link', pick[hb])}><Link2 className="h-4 w-4" aria-hidden /> Link</Button>
          </div>
        );
      },
    },
  ];
  return (
    <div className="space-y-4">
      {msg ? <Alert tone="danger">{msg}</Alert> : null}
      <StatGrid>
        <StatCard label="Matched" value={data.counts.matched ?? 0} />
        <StatCard label="Suggested" value={data.counts.suggested ?? 0} />
        <StatCard label="Only in Homebase" value={data.counts.unmatched_homebase ?? 0} />
        <StatCard label="Only in Altrixs" value={data.counts.unmatched_altrixs ?? 0} />
      </StatGrid>
      <div className="flex flex-wrap items-end gap-3">
        <Labeled label="Show">
          <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">Everyone</option>
            <option value="flagged">Needs review (onboarding / offboarding)</option>
            <option value="matched">Matched</option>
            <option value="suggested">Suggested</option>
            <option value="unmatched_homebase">Only in Homebase</option>
            <option value="unmatched_altrixs">Only in Altrixs</option>
          </Select>
        </Labeled>
      </div>
      <Card>
        <CardBody flush>
          <DataTable rows={rows} rowKey={(r) => r.key} columns={columns} empty="No one in this view" caption="Homebase roster compared with Altrixs staff" />
        </CardBody>
      </Card>
      <p className="text-xs text-slate-500">Email matches link automatically. Name matches are suggestions until HR confirms them.</p>
    </div>
  );
}

// ─── Pay period ──────────────────────────────────────────────────────────────

function PayPeriodPanel() {
  const [period, setPeriod] = useState(defaultPeriod);
  const { data, error, loading, reload } = useHrData<PayData>(`/api/hr/homebase/pay-period?start=${period.start}&end=${period.end}`);
  return (
    <div className="space-y-4">
      <PeriodPicker value={period} onChange={setPeriod} />
      {error ? <ErrorState description={error} onRetry={reload} /> : null}
      <Card>
        <CardHeader title="Hours per employee" description={data ? `${data.totalHours} hours in total, from synced Homebase timecards (${data.timeZone}).` : undefined} />
        <CardBody flush>
          <DataTable
            rows={data?.rows ?? []}
            loading={loading}
            rowKey={(r) => r.homebaseId}
            empty="No timecards in this period. Sync Homebase first, or pick another period."
            columns={[
              {
                key: 'name',
                header: 'Employee',
                cell: (r) => (
                  <div>
                    <div className="font-medium">{r.name}</div>
                    {r.userId ? <Link className="text-xs text-blue-700 hover:underline" href={`/dashboard/hr/people/${r.userId}?tab=homebase`}>{r.altrixsName ?? 'HR record'}</Link> : <div className="text-xs text-slate-500">Not linked</div>}
                  </div>
                ),
              },
              { key: 'hours', header: 'Hours', align: 'right', cell: (r) => <span className="tabular-nums">{r.hours}</span> },
              { key: 'days', header: 'Days', align: 'right', cell: (r) => r.days },
              { key: 'cards', header: 'Timecards', align: 'right', cell: (r) => r.timecards, hideOnMobile: true },
              { key: 'breaks', header: 'Unpaid breaks (min)', align: 'right', cell: (r) => r.breakMinutes, hideOnMobile: true },
              { key: 'open', header: 'Open', align: 'right', cell: (r) => (r.openTimecards ? <StatusBadge tone="warning">{r.openTimecards}</StatusBadge> : '0') },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

// ─── Reconciliation ──────────────────────────────────────────────────────────

function ReconciliationPanel() {
  const [period, setPeriod] = useState(defaultPeriod);
  const { data, error, loading, reload } = useHrData<ReconData>(`/api/hr/homebase/reconciliation?start=${period.start}&end=${period.end}`);
  const csvHref = `/api/hr/homebase/reconciliation?start=${period.start}&end=${period.end}&format=csv`;
  return (
    <div className="space-y-4">
      <Alert tone="info" title="Counts only">
        This report never shows client names, record numbers or diagnoses: only visit and note counts and minutes per clinician.
      </Alert>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PeriodPicker value={period} onChange={setPeriod} />
        <a className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50" href={csvHref}>
          <Download className="h-4 w-4" aria-hidden /> Export CSV
        </a>
      </div>
      {error ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <StatGrid>
          <StatCard label="Clinicians" value={data.totals.clinicians} />
          <StatCard label="Clocked hours" value={data.totals.clockedHours} />
          <StatCard label="Completed visits" value={data.totals.completedVisits} />
          <StatCard label="Unsigned notes past due" value={data.totals.unsignedPastDue} />
        </StatGrid>
      ) : null}
      <Card>
        <CardHeader title="Clocked hours vs. documented visits" description={data ? `Notes count as past due after ${data.deadlineHours} hours unsigned.` : undefined} />
        <CardBody flush>
          <DataTable
            rows={data?.rows ?? []}
            loading={loading}
            rowKey={(r) => r.userId}
            empty="No clinicians with hours or visits in this period"
            columns={[
              { key: 'name', header: 'Clinician', cell: (r) => <div><div className="font-medium">{r.name}</div><div className="text-xs text-slate-500">{roleLabel(r.role)}</div></div> },
              { key: 'hours', header: 'Clocked h', align: 'right', cell: (r) => (r.homebaseLinked ? <span className="tabular-nums">{r.clockedHours}</span> : <span className="text-slate-400">—</span>) },
              { key: 'visits', header: 'Completed visits', align: 'right', cell: (r) => r.completedVisits },
              { key: 'mins', header: 'Visit minutes', align: 'right', cell: (r) => r.scheduledVisitMinutes, hideOnMobile: true },
              { key: 'signed', header: 'Signed notes', align: 'right', cell: (r) => r.signedNotes, hideOnMobile: true },
              { key: 'past', header: 'Unsigned past due', align: 'right', cell: (r) => (r.unsignedPastDue ? <StatusBadge tone="danger">{r.unsignedPastDue}</StatusBadge> : '0') },
              {
                key: 'flags',
                header: 'Flags',
                cell: (r) => (
                  <div className="space-y-0.5 text-xs">
                    {r.flags.map((f) => (
                      <div key={f} className={f === 'not_linked_to_homebase' ? 'text-slate-500' : 'text-amber-800'}>
                        {RECON_FLAG_TEXT[f] ?? f}
                        {f === 'visits_without_clock_in' ? ` (${r.visitDaysWithoutClockIn.length} days)` : ''}
                        {f === 'clocked_days_without_visits' ? ` (${r.clockedDaysWithoutVisits.length} days)` : ''}
                      </div>
                    ))}
                  </div>
                ),
              },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
