'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';

type PlatformUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  organizationId: string | null;
  organizationName: string | null;
  organizationUserCount?: number;
  createdAt: string;
};

type OrgOption = { id: string; name: string };

const controlClass =
  'min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-blue-600 sm:text-sm';

export default function PlatformUsersPage() {
  const searchParams = useSearchParams();
  const initialOrg = searchParams.get('organizationId') || '';
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [organizationId, setOrganizationId] = useState(initialOrg);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  const loadOrgs = useCallback(async () => {
    const res = await fetch('/api/platform/orgs');
    const data = await res.json();
    if (res.ok && data.success) {
      setOrgs(
        data.organizations.map((o: OrgOption) => ({
          id: o.id,
          name: o.name,
        }))
      );
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('role', 'ADMIN');
      if (organizationId) params.set('organizationId', organizationId);
      if (q.trim()) params.set('q', q.trim());
      const res = await fetch(`/api/platform/users?${params}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
      setUsers(data.users);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load clinic admins');
    } finally {
      setLoading(false);
    }
  }, [organizationId, q]);

  useEffect(() => {
    loadOrgs();
  }, [loadOrgs]);

  useEffect(() => {
    load();
  }, [load]);

  const patchUser = async (id: string, body: { status?: string }) => {
    try {
      const res = await fetch(`/api/platform/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      toast.success('Admin updated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update admin');
    }
  };

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Clinic admins</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
          The platform lists each clinic&apos;s ADMIN first. Open an admin to view that clinic&apos;s
          full staff directory, including clinicians, front desk, and billing.
        </p>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(180px,240px)] md:max-w-xl">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search admin name or email"
          className={controlClass}
        />
        <select
          value={organizationId}
          onChange={(e) => setOrganizationId(e.target.value)}
          className={controlClass}
        >
          <option value="">All organizations</option>
          {orgs.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {users.map((u) => (
              <article key={u.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {u.organizationId ? (
                      <Link href={`/platform/orgs/${u.organizationId}`} className="block">
                        <p className="truncate font-semibold text-blue-700 hover:underline">
                          {u.name || '-'}
                        </p>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{u.email}</p>
                      </Link>
                    ) : (
                      <>
                        <p className="truncate font-semibold text-slate-900">{u.name || '-'}</p>
                        <p className="mt-0.5 truncate text-sm text-slate-500">{u.email}</p>
                      </>
                    )}
                  </div>
                  <StatusPill status={u.status} />
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Organization</dt>
                    <dd className="mt-1 truncate font-medium text-slate-900">
                      {u.organizationName || '-'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Staff</dt>
                    <dd className="mt-1 font-medium text-slate-900">
                      {u.organizationUserCount ?? 0}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {u.organizationId && (
                    <Link
                      href={`/platform/orgs/${u.organizationId}`}
                      className="inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-blue-600 hover:bg-slate-50"
                    >
                      View clinic staff
                    </Link>
                  )}
                  <UserStatusAction user={u} onPatch={patchUser} />
                </div>
              </article>
            ))}
            {users.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No clinic admins found.
              </div>
            )}
          </div>

          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Clinic admin</th>
                  <th className="px-4 py-3 font-medium">Organization</th>
                  <th className="px-4 py-3 font-medium">Staff in clinic</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
                  >
                    <td className="px-4 py-3">
                      {u.organizationId ? (
                        <Link
                          href={`/platform/orgs/${u.organizationId}`}
                          className="block hover:opacity-90"
                        >
                          <div className="font-medium text-blue-700 hover:underline">
                            {u.name || '-'}
                          </div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </Link>
                      ) : (
                        <>
                          <div className="font-medium text-slate-900">{u.name || '-'}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-700">{u.organizationName || '-'}</td>
                    <td className="px-4 py-3 text-slate-700">{u.organizationUserCount ?? 0}</td>
                    <td className="px-4 py-3">
                      <StatusPill status={u.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-3">
                        {u.organizationId && (
                          <Link
                            href={`/platform/orgs/${u.organizationId}`}
                            className="text-xs font-medium text-blue-600 hover:underline"
                          >
                            View clinic staff
                          </Link>
                        )}
                        <UserStatusAction user={u} onPatch={patchUser} compact />
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                      No clinic admins found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
        status === 'ACTIVE'
          ? 'bg-blue-50 text-blue-800'
          : status === 'INVITED'
            ? 'bg-amber-50 text-amber-800'
            : 'bg-rose-50 text-rose-700'
      }`}
    >
      {status}
    </span>
  );
}

function UserStatusAction({
  user,
  onPatch,
  compact = false,
}: {
  user: PlatformUser;
  onPatch: (id: string, body: { status?: string }) => void;
  compact?: boolean;
}) {
  const base = compact
    ? 'text-xs font-medium hover:underline'
    : 'inline-flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-sm font-medium';

  if (user.status === 'ACTIVE') {
    return (
      <button
        type="button"
        onClick={() => onPatch(user.id, { status: 'DEACTIVATED' })}
        className={
          compact
            ? `${base} text-rose-700`
            : `${base} border-rose-200 text-rose-700 hover:bg-rose-50`
        }
      >
        Deactivate
      </button>
    );
  }

  if (user.status === 'DEACTIVATED') {
    return (
      <button
        type="button"
        onClick={() => onPatch(user.id, { status: 'ACTIVE' })}
        className={
          compact
            ? `${base} text-blue-600`
            : `${base} border-slate-200 text-blue-600 hover:bg-slate-50`
        }
      >
        Reactivate
      </button>
    );
  }

  return (
    <span
      className={
        compact
          ? 'text-xs text-slate-500'
          : 'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500'
      }
    >
      Pending invite
    </span>
  );
}
