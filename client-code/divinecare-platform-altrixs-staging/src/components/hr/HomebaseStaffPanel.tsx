'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, DataTable, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/ui';
import { Labeled, TextInput } from './HrBits';
import { useHrData } from './hrClient';

type WallTime = { date: string; time: string } | null;
type StaffHours = {
  connected: boolean;
  linked: Array<{ homebaseId: string; name: string; jobTitle: string | null; status: string; linkStatus: string }>;
  timeZone: string;
  shifts: Array<{ id: string; location: string | null; start: WallTime; end: WallTime; role: string | null; deleted: boolean }>;
  timecards: Array<{ id: string; location: string | null; clockIn: WallTime; clockOut: WallTime; breakMinutes: number; workedMinutes: number | null; approved: boolean | null; deleted: boolean }>;
  totalWorkedMinutes: number;
};

const wt = (w: WallTime) => (w ? `${w.date} ${w.time}` : '—');
const hm = (m: number | null) => (m === null ? 'Open' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`);

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Read-only Homebase shifts + timecards on the staff HR record (HR + leadership). */
export function HomebaseStaffPanel({ userId }: { userId: string }) {
  const [period, setPeriod] = useState(() => {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - 13);
    return { start: ymd(start), end: ymd(end) };
  });
  const { data, error, loading, reload } = useHrData<StaffHours>(`/api/hr/homebase/staff/${userId}?start=${period.start}&end=${period.end}`);
  if (loading && !data) return <LoadingState rows={4} />;
  if (error && !data) return <ErrorState description={error} onRetry={reload} />;
  if (!data) return null;
  if (!data.linked.length) {
    return (
      <EmptyState
        title={data.connected ? 'Not linked to a Homebase employee' : 'Homebase is not connected'}
        description={data.connected ? 'Link this person on the Homebase roster match page.' : 'Hours appear here once the practice connects Homebase.'}
        action={<Link className="text-sm font-medium text-blue-700 hover:underline" href={`/dashboard/hr/homebase?tab=${data.connected ? 'roster' : 'connection'}`}>Open Homebase</Link>}
      />
    );
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Labeled label="From"><TextInput type="date" value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} /></Labeled>
        <Labeled label="To"><TextInput type="date" value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} /></Labeled>
        <div className="pb-2 text-sm text-slate-600">
          Linked to {data.linked.map((l) => `${l.name}${l.jobTitle ? ` (${l.jobTitle})` : ''}`).join(', ')} · {hm(data.totalWorkedMinutes)} worked
        </div>
      </div>
      <Card>
        <CardHeader title="Timecards" description={`Read-only from Homebase. Times in ${data.timeZone}.`} />
        <CardBody flush>
          <DataTable
            rows={data.timecards}
            rowKey={(r) => r.id}
            density="compact"
            empty="No timecards in this period"
            columns={[
              { key: 'in', header: 'Clock in', cell: (r) => wt(r.clockIn) },
              { key: 'out', header: 'Clock out', cell: (r) => wt(r.clockOut) },
              { key: 'loc', header: 'Location', cell: (r) => r.location ?? '—', hideOnMobile: true },
              { key: 'brk', header: 'Unpaid break', align: 'right', cell: (r) => `${r.breakMinutes} min`, hideOnMobile: true },
              { key: 'worked', header: 'Worked', align: 'right', cell: (r) => hm(r.workedMinutes) },
              { key: 'st', header: '', cell: (r) => (r.deleted ? <StatusBadge tone="neutral">Deleted in Homebase</StatusBadge> : r.approved ? <StatusBadge tone="success">Approved</StatusBadge> : null) },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Scheduled shifts" />
        <CardBody flush>
          <DataTable
            rows={data.shifts}
            rowKey={(r) => r.id}
            density="compact"
            empty="No shifts in this period"
            columns={[
              { key: 's', header: 'Start', cell: (r) => wt(r.start) },
              { key: 'e', header: 'End', cell: (r) => wt(r.end) },
              { key: 'loc', header: 'Location', cell: (r) => r.location ?? '—', hideOnMobile: true },
              { key: 'role', header: 'Role', cell: (r) => r.role ?? '—', hideOnMobile: true },
              { key: 'st', header: '', cell: (r) => (r.deleted ? <StatusBadge tone="neutral">Deleted in Homebase</StatusBadge> : null) },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}
