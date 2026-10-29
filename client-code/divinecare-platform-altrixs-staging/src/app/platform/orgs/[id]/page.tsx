'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { CLINIC_ADMIN_ROLE_OPTIONS, type ClinicAdminRole } from '@/lib/platform/clinic-roles';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/passwordRules';

type OrgUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  createdAt: string;
};

type OrgLocation = {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  timezone: string;
  active: boolean;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
};

type OrgDetail = {
  id: string;
  name: string;
  slug: string;
  active: boolean;
  createdAt: string;
  userCount: number;
  locations: OrgLocation[];
  users: OrgUser[];
};

type LocationFormState = {
  name: string;
  code: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string;
  timezone: string;
  isPrimary: boolean;
  active: boolean;
};

const emptyLocationForm: LocationFormState = {
  name: '',
  code: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  timezone: 'America/New_York',
  isPrimary: false,
  active: true,
};

const inputClass =
  'min-h-12 w-full rounded-md border border-slate-300 px-3 py-2 text-base outline-none focus:border-blue-600 sm:text-sm';

const primaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-55';

const secondaryButtonClass =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';

export default function PlatformOrgDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<ClinicAdminRole>('ADMIN');
  const [newPassword, setNewPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const [locationMode, setLocationMode] = useState<'create' | 'edit'>('create');
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [locationForm, setLocationForm] = useState<LocationFormState>(emptyLocationForm);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/platform/orgs/${params.id}`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Failed to load');
      setOrg(data.organization);
      setName(data.organization.name);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load organization');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    load();
  }, [load]);

  const currentLocation = useMemo(
    () => org?.locations.find((loc) => loc.id === editingLocationId) || null,
    [editingLocationId, org?.locations]
  );

  const resetLocationForm = useCallback(() => {
    setLocationMode('create');
    setEditingLocationId(null);
    setLocationForm(emptyLocationForm);
    setLocationError('');
  }, []);

  const openCreateLocation = () => {
    resetLocationForm();
  };

  const openEditLocation = (loc: OrgLocation) => {
    setLocationMode('edit');
    setEditingLocationId(loc.id);
    setLocationForm({
      name: loc.name,
      code: loc.code || '',
      addressLine1: loc.addressLine1 || '',
      addressLine2: loc.addressLine2 || '',
      city: loc.city || '',
      state: loc.state || '',
      postalCode: loc.postalCode || '',
      phone: loc.phone || '',
      timezone: loc.timezone || 'America/New_York',
      isPrimary: loc.isPrimary,
      active: loc.active,
    });
    setLocationError('');
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      toast.success('Organization updated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  const toggleOrgActive = async () => {
    if (!org) return;
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

  const deleteOrg = async () => {
    if (!org) return;
    const ok = window.confirm(
      `Permanently delete “${org.name}”? This removes the clinic, its staff, clients, and records. This cannot be undone.`
    );
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed');
      toast.success(`${org.name} deleted`);
      router.push('/platform');
    } catch (err: any) {
      toast.error(err.message || 'Could not delete organization');
      setDeleting(false);
    }
  };

  const patchUser = async (id: string, body: { role?: string; status?: string }) => {
    try {
      const res = await fetch(`/api/platform/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      toast.success('Access updated');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update user');
    }
  };

  const createUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setCreating(true);
    try {
      const res = await fetch('/api/platform/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: org.id,
          name: newName.trim(),
          email: newEmail.trim(),
          role: newRole,
          password: newPassword.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Create failed');
      toast.success(data.message || 'User created');
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('ADMIN');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not create user');
    } finally {
      setCreating(false);
    }
  };

  const submitLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setLocationSaving(true);
    setLocationError('');
    try {
      const payload = {
        name: locationForm.name.trim(),
        code: locationForm.code.trim() || undefined,
        addressLine1: locationForm.addressLine1.trim() || undefined,
        addressLine2: locationForm.addressLine2.trim() || undefined,
        city: locationForm.city.trim() || undefined,
        state: locationForm.state.trim() || undefined,
        postalCode: locationForm.postalCode.trim() || undefined,
        phone: locationForm.phone.trim() || undefined,
        timezone: locationForm.timezone.trim() || 'America/New_York',
        isPrimary: locationForm.isPrimary,
        active: locationForm.active,
      };

      const res = await fetch(
        locationMode === 'create'
          ? `/api/platform/orgs/${org.id}/locations`
          : `/api/platform/orgs/${org.id}/locations/${editingLocationId}`,
        {
          method: locationMode === 'create' ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      );
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Save failed');
      toast.success(locationMode === 'create' ? 'Location added' : 'Location updated');
      resetLocationForm();
      await load();
    } catch (err: any) {
      setLocationError(err.message || 'Could not save location');
    } finally {
      setLocationSaving(false);
    }
  };

  const updateLocation = async (locId: string, body: Record<string, unknown>) => {
    if (!org) return;
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}/locations/${locId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not update location');
    }
  };

  const deactivateLocation = async (locId: string) => {
    if (!org) return;
    try {
      const res = await fetch(`/api/platform/orgs/${org.id}/locations/${locId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'Update failed');
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Could not deactivate location');
    }
  };

  if (loading) {
    return <p className="text-sm text-slate-500">Loading…</p>;
  }

  if (!org) {
    return (
      <div>
        <p className="text-sm text-rose-600">Organization not found.</p>
        <Link href="/platform" className="mt-3 inline-block text-sm text-blue-600 hover:underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/platform" className="text-sm font-medium text-blue-600 hover:underline">
        Back to organizations
      </Link>
      <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-slate-900">{org.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            Clinic organization · {org.slug} · {org.users.length} users ·{' '}
            {org.active ? 'Active' : 'Suspended'}
          </p>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap">
          <button
            type="button"
            onClick={toggleOrgActive}
            className={secondaryButtonClass}
          >
            {org.active ? 'Suspend organization' : 'Activate organization'}
          </button>
          <button
            type="button"
            onClick={() => void deleteOrg()}
            disabled={deleting}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            <Trash2 size={15} />
            {deleting ? 'Deleting…' : 'Delete clinic'}
          </button>
        </div>
      </div>

      <form onSubmit={save} className="mt-6 max-w-md rounded-lg border border-slate-200 bg-white p-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Organization name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>
        <button
          type="submit"
          disabled={saving}
          className={`${primaryButtonClass} mt-4 w-full sm:w-auto`}
        >
          {saving ? 'Saving…' : 'Save name'}
        </button>
      </form>

      <div className="mt-10 rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Locations</h2>
            <p className="mt-1 text-sm text-slate-500">
              Add locations here, then edit them or mark one as the primary site.
            </p>
          </div>
          <button
            type="button"
            onClick={openCreateLocation}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:w-auto"
          >
            Add location
          </button>
        </div>

        {locationError && (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {locationError}
          </div>
        )}

        <form
          onSubmit={submitLocation}
          className="mt-4 grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Location name *</span>
              <input
                required
                value={locationForm.name}
                onChange={(e) => setLocationForm((f) => ({ ...f, name: e.target.value }))}
                className={inputClass}
                placeholder="Main Clinic"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Code</span>
              <input
                value={locationForm.code}
                onChange={(e) => setLocationForm((f) => ({ ...f, code: e.target.value }))}
                className={inputClass}
                placeholder="MAIN"
              />
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Address line 1</span>
            <input
              value={locationForm.addressLine1}
              onChange={(e) => setLocationForm((f) => ({ ...f, addressLine1: e.target.value }))}
              className={inputClass}
              placeholder="123 Care Ave"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Address line 2</span>
            <input
              value={locationForm.addressLine2}
              onChange={(e) => setLocationForm((f) => ({ ...f, addressLine2: e.target.value }))}
              className={inputClass}
              placeholder="Suite 200"
            />
          </label>

          <div className="grid gap-3 md:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">City</span>
              <input
                value={locationForm.city}
                onChange={(e) => setLocationForm((f) => ({ ...f, city: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">State</span>
              <input
                value={locationForm.state}
                onChange={(e) => setLocationForm((f) => ({ ...f, state: e.target.value }))}
                className={inputClass}
                placeholder="MD"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">ZIP</span>
              <input
                value={locationForm.postalCode}
                onChange={(e) => setLocationForm((f) => ({ ...f, postalCode: e.target.value }))}
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Phone</span>
              <input
                value={locationForm.phone}
                onChange={(e) => setLocationForm((f) => ({ ...f, phone: e.target.value }))}
                className={inputClass}
              />
            </label>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Timezone</span>
              <input
                value={locationForm.timezone}
                onChange={(e) => setLocationForm((f) => ({ ...f, timezone: e.target.value }))}
                className={inputClass}
                placeholder="America/New_York"
              />
            </label>
            <div className="grid gap-2 pb-1 sm:flex sm:items-end sm:gap-4">
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:border-0 sm:bg-transparent sm:px-0">
                <input
                  type="checkbox"
                  checked={locationForm.isPrimary}
                  onChange={(e) => setLocationForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                />
                Primary location
              </label>
              <label className="flex min-h-11 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 sm:border-0 sm:bg-transparent sm:px-0">
                <input
                  type="checkbox"
                  checked={locationForm.active}
                  onChange={(e) => setLocationForm((f) => ({ ...f, active: e.target.checked }))}
                />
                Active
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="submit"
              disabled={locationSaving}
              className={`${primaryButtonClass} w-full sm:w-auto`}
            >
              {locationSaving ? 'Saving…' : locationMode === 'edit' ? 'Save location changes' : 'Create location'}
            </button>
            {locationMode === 'edit' ? (
              <button
                type="button"
                onClick={resetLocationForm}
                className="inline-flex min-h-11 w-full items-center justify-center rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:w-auto"
              >
                Cancel edit
              </button>
            ) : null}
          </div>

          {locationMode === 'edit' && currentLocation && (
            <p className="text-xs text-slate-500">
              Editing {currentLocation.name}. Save changes to update this clinic location.
            </p>
          )}
        </form>

        <div className="mt-4 grid gap-3 md:hidden">
          {org.locations.map((loc) => (
            <article key={loc.id} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold text-slate-900">{loc.name}</h3>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {loc.code || '-'} - {loc.timezone}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    loc.active ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {loc.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div className="mt-3 text-sm text-slate-600">
                <p>{loc.addressLine1 || '-'}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {[loc.city, loc.state, loc.postalCode].filter(Boolean).join(', ') || '-'}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{loc.phone || '-'}</p>
              </div>
              {loc.isPrimary ? (
                <span className="mt-3 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                  Primary
                </span>
              ) : null}
              <div className="mt-4 grid gap-2">
                <button
                  type="button"
                  onClick={() => openEditLocation(loc)}
                  className={secondaryButtonClass}
                >
                  Edit
                </button>
                {!loc.isPrimary && loc.active && (
                  <button
                    type="button"
                    onClick={() => updateLocation(loc.id, { isPrimary: true })}
                    className={secondaryButtonClass}
                  >
                    Make primary
                  </button>
                )}
                {loc.active ? (
                  <button
                    type="button"
                    onClick={() => deactivateLocation(loc.id)}
                    className="inline-flex min-h-11 items-center justify-center rounded-md border border-rose-200 px-3 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50"
                  >
                    Deactivate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => updateLocation(loc.id, { active: true })}
                    className={secondaryButtonClass}
                  >
                    Reactivate
                  </button>
                )}
              </div>
            </article>
          ))}
          {org.locations.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
              No locations yet. Add the first clinic location above.
            </div>
          )}
        </div>

        <div className="mt-4 hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Location</th>
                <th className="px-4 py-3 font-medium">Address</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {org.locations.map((loc) => (
                <tr key={loc.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{loc.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {loc.code || '-'} · {loc.timezone}
                    </div>
                    {loc.isPrimary ? (
                      <span className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">
                        Primary
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <div>{loc.addressLine1 || '-'}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {[loc.city, loc.state, loc.postalCode].filter(Boolean).join(', ') || '-'}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{loc.phone || '-'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        loc.active ? 'bg-blue-50 text-blue-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {loc.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openEditLocation(loc)}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Edit
                      </button>
                      {!loc.isPrimary && loc.active && (
                        <button
                          type="button"
                          onClick={() => updateLocation(loc.id, { isPrimary: true })}
                          className="text-xs font-medium text-slate-700 hover:underline"
                        >
                          Make primary
                        </button>
                      )}
                      {loc.active ? (
                        <button
                          type="button"
                          onClick={() => deactivateLocation(loc.id)}
                          className="text-xs font-medium text-rose-700 hover:underline"
                        >
                          Deactivate
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => updateLocation(loc.id, { active: true })}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Reactivate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {org.locations.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No locations yet. Add the first clinic location above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-10">
        <h2 className="text-lg font-semibold text-slate-900">Users &amp; access</h2>
        <p className="mt-1 text-sm text-slate-500">
          Change staff roles, deactivate accounts, or create a new user for this clinic.
        </p>

        <form
          onSubmit={createUser}
          className="mt-4 grid gap-3 rounded-lg border border-slate-200 bg-white p-4 md:grid-cols-2"
        >
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Full name</span>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={inputClass}
              placeholder="Clinic Admin"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Work email</span>
            <input
              required
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className={inputClass}
              placeholder="admin@clinic.com"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Access role</span>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as ClinicAdminRole)}
              className={inputClass}
            >
              {CLINIC_ADMIN_ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Password (optional)</span>
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              placeholder="Blank = email invite"
              minLength={PASSWORD_MIN_LENGTH}
            />
            <span className="mt-1 block text-xs text-slate-500">
              Enter a password to sign in immediately. Leave it blank to send an invite email.
            </span>
          </label>
          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={creating}
              className={`${primaryButtonClass} w-full sm:w-auto`}
            >
              {creating ? 'Creating…' : 'Create user for this organization'}
            </button>
          </div>
        </form>

        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Access (role)</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {org.users.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{u.name || '-'}</div>
                    <div className="text-xs text-slate-500">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={u.role}
                      onChange={(e) => patchUser(u.id, { role: e.target.value })}
                      className="rounded border border-slate-200 px-2 py-1 text-xs"
                    >
                      {CLINIC_ADMIN_ROLE_OPTIONS.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        u.status === 'ACTIVE'
                          ? 'bg-blue-50 text-blue-800'
                          : u.status === 'INVITED'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-rose-50 text-rose-700'
                      }`}
                    >
                      {u.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {u.status === 'ACTIVE' ? (
                      <button
                        type="button"
                        onClick={() => patchUser(u.id, { status: 'DEACTIVATED' })}
                        className="text-xs font-medium text-rose-700 hover:underline"
                      >
                        Remove access
                      </button>
                    ) : u.status === 'DEACTIVATED' ? (
                      <button
                        type="button"
                        onClick={() => patchUser(u.id, { status: 'ACTIVE' })}
                        className="text-xs font-medium text-blue-600 hover:underline"
                      >
                        Restore access
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">Pending invite</span>
                    )}
                  </td>
                </tr>
              ))}
              {org.users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    There are no users in this organization yet. Create the first ADMIN above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
