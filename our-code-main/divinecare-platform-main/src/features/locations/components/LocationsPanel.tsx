'use client';

import { useState } from 'react';
import { useLocations } from '../hooks/useLocations';
import type { CreateLocationInput, LocationRecord } from '../types';

type Props = {
  canManage: boolean;
};

const emptyForm: CreateLocationInput = {
  name: '',
  code: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
  phone: '',
  timezone: 'America/New_York',
  isPrimary: false,
};

export function LocationsPanel({ canManage }: Props) {
  const { locations, loading, error, add, patch, remove } = useLocations();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LocationRecord | null>(null);
  const [form, setForm] = useState<CreateLocationInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setFormError('');
    setOpen(true);
  };

  const openEdit = (loc: LocationRecord) => {
    setEditing(loc);
    setForm({
      name: loc.name,
      code: loc.code || '',
      addressLine1: loc.addressLine1 || '',
      city: loc.city || '',
      state: loc.state || '',
      postalCode: loc.postalCode || '',
      phone: loc.phone || '',
      timezone: loc.timezone,
      isPrimary: loc.isPrimary,
      active: loc.active,
    });
    setFormError('');
    setOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (editing) {
        await patch(editing.id, form);
      } else {
        await add(form);
      }
      setOpen(false);
    } catch (err: any) {
      setFormError(err.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Practice locations
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Multi-site org structure — clinics, hubs, and telehealth sites
          </p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700"
          >
            + Add location
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-100 bg-white shadow-sm">
        {loading ? (
          <p className="p-5 text-sm text-slate-500">Loading locations…</p>
        ) : locations.length === 0 ? (
          <p className="p-5 text-sm text-slate-500">No locations yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-3 font-semibold">Location</th>
                  <th className="px-5 py-3 font-semibold">Code</th>
                  <th className="px-5 py-3 font-semibold">City / State</th>
                  <th className="px-5 py-3 font-semibold">Staff</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                  {canManage && <th className="px-5 py-3 font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {locations.map((loc) => (
                  <tr key={loc.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-900">{loc.name}</span>
                        {loc.isPrimary && (
                          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-800 ring-1 ring-blue-100">
                            Primary
                          </span>
                        )}
                      </div>
                      {loc.addressLine1 && (
                        <p className="mt-0.5 text-xs text-slate-400">{loc.addressLine1}</p>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{loc.code || '—'}</td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {[loc.city, loc.state].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">{loc.staffCount ?? 0}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          loc.active
                            ? 'bg-blue-50 text-blue-700'
                            : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {loc.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canManage && (
                      <td className="px-5 py-3.5">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => openEdit(loc)}
                            className="text-xs font-semibold text-blue-700 hover:underline"
                          >
                            Edit
                          </button>
                          {!loc.isPrimary && loc.active && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await patch(loc.id, { isPrimary: true });
                                } catch (err: any) {
                                  alert(err.message);
                                }
                              }}
                              className="text-xs font-semibold text-slate-600 hover:underline"
                            >
                              Make primary
                            </button>
                          )}
                          {loc.active && !loc.isPrimary && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm(`Deactivate ${loc.name}?`)) return;
                                try {
                                  await remove(loc.id);
                                } catch (err: any) {
                                  alert(err.message);
                                }
                              }}
                              className="text-xs font-semibold text-rose-600 hover:underline"
                            >
                              Deactivate
                            </button>
                          )}
                          {!loc.active && (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  await patch(loc.id, { active: true });
                                } catch (err: any) {
                                  alert(err.message);
                                }
                              }}
                              className="text-xs font-semibold text-blue-700 hover:underline"
                            >
                              Reactivate
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">
                {editing ? 'Edit location' : 'Add location'}
              </h3>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-xl text-slate-400 hover:text-slate-600"
              >
                ×
              </button>
            </div>

            {formError && (
              <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            <form onSubmit={submit} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Name</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="Main Clinic"
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Code</label>
                  <input
                    value={form.code || ''}
                    onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="MAIN"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">Address</label>
                <input
                  value={form.addressLine1 || ''}
                  onChange={(e) => setForm((f) => ({ ...f, addressLine1: e.target.value }))}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  placeholder="123 Care Ave"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">City</label>
                  <input
                    value={form.city || ''}
                    onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">State</label>
                  <input
                    value={form.state || ''}
                    onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                    placeholder="MD"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">ZIP</label>
                  <input
                    value={form.postalCode || ''}
                    onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Phone</label>
                  <input
                    value={form.phone || ''}
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold text-slate-700">Timezone</label>
                  <input
                    value={form.timezone || ''}
                    onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                    className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.isPrimary)}
                  onChange={(e) => setForm((f) => ({ ...f, isPrimary: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Primary location for this practice
              </label>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                >
                  {saving ? 'Saving…' : editing ? 'Save changes' : 'Create location'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
