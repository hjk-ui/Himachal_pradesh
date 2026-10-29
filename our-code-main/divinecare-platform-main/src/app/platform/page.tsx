'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';

type Org = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  userCount: number;
  locationCount: number;
};

const inputClass =
  'min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-blue-600 sm:text-sm';

const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

export default function PlatformOrgsPage() {
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [primaryLocationName, setPrimaryLocationName] = useState('');
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/platform/orgs');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
      setOrgs(data.organizations);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load organizations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !ownerEmail.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/platform/orgs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ownerName: ownerName.trim() || undefined,
          ownerEmail: ownerEmail.trim(),
          primaryLocationName: primaryLocationName.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Create failed');
      toast.success(data.message || 'Clinic created · owner invite sent');
      setName('');
      setOwnerName('');
      setPrimaryLocationName('');
      setOwnerEmail('');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not create organization');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (org: Org) => {
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !org.active }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      toast.success(org.active ? 'Organization suspended' : 'Organization activated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update organization');
    }
  };

  const deleteOrg = async (org: Org) => {
    const ok = window.confirm(
      `Permanently delete “${org.name}”? This removes the clinic, its staff, clients, and records. This cannot be undone.`
    );
    if (!ok) return;
    setDeletingId(org.id);
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast.success(`${org.name} deleted`);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not delete organization');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="mb-6 sm:mb-8">
        <h1 className="text-2xl font-semibold text-slate-900">Organizations (clinics)</h1>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-500">
          Super admins onboard clinics from here. Enter the clinic name and owner email, and the owner will
          receive an invite email. If you set a password, the owner can sign in immediately as that clinic ADMIN.
        </p>
      </div>

      <form
        onSubmit={createOrg}
        className="mb-8 space-y-4 rounded-lg border border-slate-200 bg-white p-4"
      >
        <p className="text-sm font-semibold text-slate-800">Onboard new clinic</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Clinic name *</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sunrise Hospital"
              className={inputClass}
              required
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Owner name</span>
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="e.g. Dr. Sharma"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">
              Primary location name
            </span>
            <input
              value={primaryLocationName}
              onChange={(e) => setPrimaryLocationName(e.target.value)}
              placeholder="e.g. Main Clinic"
              className={inputClass}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Owner email *</span>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@clinic.com"
              className={inputClass}
              required
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={creating}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-55 sm:w-auto"
        >
          {creating ? 'Creating and inviting...' : 'Create clinic + invite owner'}
        </button>
      </form>

      {loading ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {orgs.map((org) => (
              <article key={org.id} className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/platform/orgs/${org.id}`}
                      className="block truncate font-semibold text-blue-700 hover:underline"
                    >
                      {org.name}
                    </Link>
                    <p className="mt-1 truncate text-sm text-slate-500">{org.slug}</p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      org.active ? 'bg-blue-50 text-blue-800' : 'bg-rose-50 text-rose-700'
                    }`}
                  >
                    {org.active ? 'Active' : 'Suspended'}
                  </span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Users</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{org.userCount}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-400">Locations</dt>
                    <dd className="mt-1 font-semibold text-slate-900">{org.locationCount}</dd>
                  </div>
                </dl>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Link href={`/platform/orgs/${org.id}`} className={secondaryButtonClass}>
                    Manage users
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggleActive(org)}
                    className={secondaryButtonClass}
                  >
                    {org.active ? 'Suspend' : 'Activate'}
                  </button>
                  <button
                    type="button"
                    disabled={deletingId === org.id}
                    onClick={() => void deleteOrg(org)}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <Trash2 size={16} aria-hidden />
                    Delete
                  </button>
                </div>
              </article>
            ))}
            {orgs.length === 0 && (
              <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                No organizations yet.
              </div>
            )}
          </div>

          <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white md:block">
            <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Slug</th>
                <th className="px-4 py-3 font-medium">Users</th>
                <th className="px-4 py-3 font-medium">Locations</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {orgs.map((org) => (
                <tr key={org.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/platform/orgs/${org.id}`}
                      className="text-blue-700 hover:underline"
                    >
                      {org.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{org.slug}</td>
                  <td className="px-4 py-3">{org.userCount}</td>
                  <td className="px-4 py-3">{org.locationCount}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        org.active
                          ? 'bg-blue-50 text-blue-800'
                          : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {org.active ? 'Active' : 'Suspended'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/platform/orgs/${org.id}`}
                      className="mr-3 text-sm font-medium text-blue-600 hover:underline"
                    >
                      Manage users
                    </Link>
                    <button
                      type="button"
                      onClick={() => toggleActive(org)}
                      className="text-sm font-medium text-slate-600 hover:text-slate-900"
                    >
                      {org.active ? 'Suspend' : 'Activate'}
                    </button>
                    <button
                      type="button"
                      title="Permanently delete clinic"
                      aria-label={`Delete ${org.name}`}
                      disabled={deletingId === org.id}
                      onClick={() => void deleteOrg(org)}
                      className="ml-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                    No organizations yet.
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
