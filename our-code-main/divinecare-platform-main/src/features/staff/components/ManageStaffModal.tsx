'use client';

import { useEffect, useState } from 'react';
import { fetchLocations } from '@/features/locations';
import type { LocationRecord } from '@/features/locations';
import {
  DEFAULT_STAFF_ROLE,
  STAFF_ROLES,
  type StaffRole,
  type StaffUser,
  type UpdateStaffInput,
} from '../types';

type Props = {
  open: boolean;
  user: StaffUser | null;
  onClose: () => void;
  onSave: (userId: string, input: UpdateStaffInput) => Promise<void>;
};

export function ManageStaffModal({ open, user, onClose, onSave }: Props) {
  const [roles, setRoles] = useState<StaffRole[]>([DEFAULT_STAFF_ROLE]);
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setRoles(user.roles?.length ? user.roles : [user.role]);
    setLocationId(user.primaryLocationId || '');
    setError('');
    fetchLocations(true)
      .then(setLocations)
      .catch(() => setLocations([]));
  }, [open, user]);

  if (!open || !user) return null;

  const toggleRole = (r: StaffRole) => {
    setRoles((prev) => {
      if (prev.includes(r)) {
        if (prev.length === 1) return prev;
        return prev.filter((x) => x !== r);
      }
      return [...prev, r];
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roles.length === 0) {
      setError('Select at least one role');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSave(user.id, {
        role: roles[0],
        roles,
        locationId: locationId || null,
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Assign dashboards</h2>
            <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-xl text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              Dashboard access
            </label>
            <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
              Tick every role this person may use. Two or more ticks → they get a dropdown above
              Sign out. One tick → no dropdown. Only Clinic Admin can change this.
            </p>
            <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-slate-200 p-2.5">
              {STAFF_ROLES.map((r) => {
                const checked = roles.includes(r.value);
                return (
                  <label
                    key={r.value}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRole(r.value)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-200"
                    />
                    <span className="font-medium text-slate-800">{r.label}</span>
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="">No location</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.isPrimary ? ' (Primary)' : ''}
                </option>
              ))}
            </select>
          </div>

          <p className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
            After you save, they should <span className="font-semibold text-slate-800">Sign out</span> and
            sign in once so the sidebar dropdown updates. Status:{' '}
            <span className="font-semibold text-slate-800">{user.status || 'ACTIVE'}</span>
          </p>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60"
            >
              {loading ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
