'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card, CardBody } from '@/components/ui/Card';
import { EMPLOYEE_RECORD_TABS, HR_EMPTIES, PEOPLE_FILTERS } from '@/lib/hr/constants';
import { useStaff } from '@/features/staff/hooks/useStaff';

export default function HrPeoplePage() {
  const { users, loading } = useStaff();
  const params = useSearchParams();
  const [filter, setFilter] = useState<(typeof PEOPLE_FILTERS)[number]>('Active');
  const [showHire, setShowHire] = useState(false);

  useEffect(() => {
    if (params.get('new') === '1') setShowHire(true);
  }, [params]);

  const filtered = useMemo(() => {
    const list = users || [];
    if (filter === 'Former staff' || filter === 'Terminated') {
      return list.filter((u) => u.status === 'DEACTIVATED');
    }
    if (filter === 'Onboarding') return list.filter((u) => u.status === 'INVITED');
    return list.filter((u) => u.status === 'ACTIVE' || u.status === 'INVITED');
  }, [users, filter]);

  return (
    <>
      <PageHeader
        title="People"
        description="Employment records — HR has no client PHI on this surface."
        actions={
          <>
            <Button variant="secondary" size="sm">
              Export
            </Button>
            <Button variant="secondary" size="sm">
              Draft job posting / offer
            </Button>
            <Button size="sm" onClick={() => setShowHire(true)}>
              New hire
            </Button>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {PEOPLE_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${
              filter === f ? 'bg-blue-600 text-white shadow-xs' : 'border border-slate-300 bg-white text-slate-700'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {showHire ? (
        <Card className="mb-4">
          <CardBody>
            <p className="text-sm font-semibold text-slate-900">New hire</p>
            <p className="mt-1 text-sm text-slate-500">Add new hire from Admin › Users &amp; Roles invite, or continue here.</p>
            <div className="mt-3 flex gap-2">
              <Link href="/dashboard/admin">
                <Button size="sm">Add new hire</Button>
              </Link>
              <Button size="sm" variant="ghost" onClick={() => setShowHire(false)}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-500">{HR_EMPTIES.noStaffMatch}</p>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="overflow-x-auto p-0">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Role</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Record</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-slate-100">
                    <td className="px-5 py-3 font-medium text-slate-900">{u.name || '—'}</td>
                    <td className="px-5 py-3 text-slate-600">{u.email}</td>
                    <td className="px-5 py-3 text-slate-600">{u.role}</td>
                    <td className="px-5 py-3 text-slate-600">{u.status}</td>
                    <td className="px-5 py-3">
                      <Link
                        href={`/dashboard/hr/people/${u.id}`}
                        className="text-sm font-semibold text-blue-600 hover:underline"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <p className="mt-4 text-xs text-slate-500">
        Employee tabs: {EMPLOYEE_RECORD_TABS.join(' · ')}
      </p>
    </>
  );
}
