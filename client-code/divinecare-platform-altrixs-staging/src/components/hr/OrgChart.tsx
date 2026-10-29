'use client';

import { useMemo, useState } from 'react';
import { Network, Users } from 'lucide-react';
import { Alert, Card, CardBody, CardHeader, EmptyState, ErrorState, LoadingState, Page, PageHeader, StatCard, StatGrid, Tabs } from '@/components/ui';
import { FILTER_SELECT, FilterBar, Initials, SearchField, Select } from './HrBits';
import { roleLabel, useHrData } from './hrClient';

type Person = {
  userId: string;
  name: string;
  preferredName: string | null;
  pronouns: string | null;
  jobTitle: string;
  department: string;
  role: string;
  programs: string[];
  locationNames: string[];
  email: string;
  workPhone: string | null;
  managerUserId: string | null;
  credentials: string | null;
};
type Count = { label: string; count: number };
type Analytics = {
  headcount: number;
  hires12m: number;
  separations12m: number;
  turnover12mPct: number | null;
  avgTenureYears: number | null;
  missingHireDates: number;
  series: Array<{ month: string; headcount: number }>;
  byLocation: Count[];
  byProgram: Count[];
  byDepartment: Count[];
  byRole: Count[];
  byWorkerType: Count[];
};

export function OrgChart() {
  const { data, error, loading, reload } = useHrData<{ people: Person[]; analytics: Analytics | null; viewerUserId: string }>('/api/hr/org-chart');
  const [view, setView] = useState<'directory' | 'chart' | 'workforce'>('directory');
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState('');
  const [program, setProgram] = useState('');
  const people = useMemo(() => data?.people ?? [], [data]);
  const locs = useMemo(() => [...new Set(people.flatMap((p) => p.locationNames))].sort(), [people]);
  const programs = useMemo(() => [...new Set(people.flatMap((p) => p.programs))].sort(), [people]);
  const filtered = people.filter(
    (p) =>
      (!q || `${p.name} ${p.jobTitle} ${p.role} ${p.department}`.toLowerCase().includes(q.toLowerCase())) &&
      (!loc || p.locationNames.includes(loc)) &&
      (!program || p.programs.includes(program)),
  );
  const items = [
    { key: 'directory' as const, label: 'Directory' },
    { key: 'chart' as const, label: 'Org chart' },
    ...(data?.analytics ? [{ key: 'workforce' as const, label: 'Headcount & turnover' }] : []),
  ];

  return (
    <Page width="full">
      <PageHeader eyebrow="HR" title="Org chart & directory" description="Who works where, in which program, and who they report to." />
      {loading && !data ? <LoadingState rows={6} /> : null}
      {error && !data ? <ErrorState description={error} onRetry={reload} /> : null}
      {data ? (
        <>
          <Tabs label="Org views" value={view} onChange={setView} items={items} />
          {view !== 'workforce' ? (
            <FilterBar>
              <SearchField label="Search staff" placeholder="Search name or title" value={q} onChange={setQ} />
              <Select aria-label="Location" value={loc} onChange={(e) => setLoc(e.target.value)} className={FILTER_SELECT}>
                <option value="">All locations</option>
                {locs.map((l) => <option key={l}>{l}</option>)}
              </Select>
              <Select aria-label="Program" value={program} onChange={(e) => setProgram(e.target.value)} className={FILTER_SELECT}>
                <option value="">All programs</option>
                {programs.map((l) => <option key={l}>{l}</option>)}
              </Select>
            </FilterBar>
          ) : null}
          {view === 'directory' ? (
            filtered.length === 0 ? (
              <Card><EmptyState title="No one matches" icon={<Users />} /></Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filtered.map((p) => (
                  <Card key={p.userId} className="p-4">
                    <div className="flex items-start gap-3">
                      <Initials name={p.name} size={40} />
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold text-slate-900">
                          {p.preferredName ? `${p.preferredName} (${p.name})` : p.name}
                          {p.credentials ? <span className="font-normal text-slate-500">, {p.credentials}</span> : null}
                        </p>
                        <p className="text-slate-600">{p.jobTitle || roleLabel(p.role)}{p.pronouns ? ` · ${p.pronouns}` : ''}</p>
                        <p className="text-xs text-slate-500">{[p.locationNames.join(', '), p.programs.join(', ')].filter(Boolean).join(' · ') || 'No location set'}</p>
                        <p className="mt-1 truncate text-xs"><a className="text-blue-700 hover:underline" href={`mailto:${p.email}`}>{p.email}</a>{p.workPhone ? ` · ${p.workPhone}` : ''}</p>
                        {p.managerUserId ? <p className="text-xs text-slate-500">Reports to {people.find((m) => m.userId === p.managerUserId)?.name ?? '—'}</p> : null}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )
          ) : null}
          {view === 'chart' ? <Tree people={filtered.length === people.length ? people : filtered} /> : null}
          {view === 'workforce' && data.analytics ? <Workforce a={data.analytics} /> : null}
        </>
      ) : null}
    </Page>
  );
}

function Tree({ people }: { people: Person[] }) {
  const ids = new Set(people.map((p) => p.userId));
  const roots = people.filter((p) => !p.managerUserId || !ids.has(p.managerUserId));
  const kids = (id: string) => people.filter((p) => p.managerUserId === id);
  const noManager = roots.filter((r) => kids(r.userId).length === 0);
  const tops = roots.filter((r) => kids(r.userId).length > 0);
  const Node = ({ p, depth }: { p: Person; depth: number }) => (
    <li>
      {/* Indent caps at 4 levels so deep reporting lines stay inside a phone screen. */}
      <div className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2" style={{ marginLeft: Math.min(depth, 4) * 16 }}>
        <Initials name={p.name} size={28} />
        <span className="min-w-0 break-words text-sm">
          <span className="font-medium text-slate-900">{p.name}</span>
          <span className="text-slate-500"> · {p.jobTitle || roleLabel(p.role)}</span>
        </span>
      </div>
      {kids(p.userId).length ? (
        <ul className="mt-1.5 space-y-1.5 border-l border-slate-200 pl-2">
          {kids(p.userId).map((c) => <Node key={c.userId} p={c} depth={depth + 1} />)}
        </ul>
      ) : null}
    </li>
  );
  return (
    <Card>
      <CardHeader title="Reporting lines" icon={<Network />} description="From each person's manager in their HR record." />
      <CardBody className="space-y-4">
        {tops.length ? <ul className="space-y-1.5">{tops.map((p) => <Node key={p.userId} p={p} depth={0} />)}</ul> : null}
        {noManager.length ? (
          <Alert tone="info" title={`${noManager.length} without a manager set`}>
            {noManager.map((p) => p.name).join(', ')}. Set managers on the People tab.
          </Alert>
        ) : null}
      </CardBody>
    </Card>
  );
}

function Bars({ title, rows }: { title: string; rows: Count[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No data</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((r) => (
              <li key={r.label} className="grid grid-cols-[minmax(0,8.75rem)_minmax(0,1fr)_2rem] items-center gap-2 text-sm">
                <span className="truncate text-slate-700">{roleLabel(r.label) === r.label ? r.label : roleLabel(r.label)}</span>
                <span className="h-2 rounded-full bg-slate-100"><span className="block h-2 rounded-full bg-blue-600" style={{ width: `${(r.count / max) * 100}%` }} /></span>
                <span className="text-right tabular-nums text-slate-600">{r.count}</span>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function Workforce({ a }: { a: Analytics }) {
  const max = Math.max(1, ...a.series.map((s) => s.headcount));
  return (
    <div className="space-y-6">
      <StatGrid columns={4}>
        <StatCard label="Headcount" value={a.headcount} />
        <StatCard label="Hires (12 months)" value={a.hires12m} />
        <StatCard label="Separations (12 months)" value={a.separations12m} />
        <StatCard label="Turnover (12 months)" value={a.turnover12mPct == null ? 'No data' : `${a.turnover12mPct}%`} hint={a.avgTenureYears != null ? `Average tenure ${a.avgTenureYears} years` : undefined} />
      </StatGrid>
      {a.missingHireDates ? <Alert tone="warning">{a.missingHireDates} staff have no hire date, so headcount history and tenure are incomplete.</Alert> : null}
      <Card>
        <CardHeader title="Headcount by month" description="Staff employed at month end (from hire and end dates)." />
        <CardBody>
          <div className="flex h-40 items-end gap-2" role="img" aria-label={`Headcount by month: ${a.series.map((s) => `${s.month} ${s.headcount}`).join(', ')}`}>
            {a.series.map((s) => (
              <div key={s.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] tabular-nums text-slate-600">{s.headcount}</span>
                <div className="w-full rounded-t bg-blue-600" style={{ height: `${(s.headcount / max) * 120}px` }} />
                <span className="text-[10px] text-slate-500">{s.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Bars title="By location" rows={a.byLocation} />
        <Bars title="By program" rows={a.byProgram} />
        <Bars title="By role" rows={a.byRole} />
        <Bars title="By worker type" rows={a.byWorkerType} />
      </div>
    </div>
  );
}
