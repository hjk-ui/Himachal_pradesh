'use client';

import { useEffect, useState } from 'react';
import { fetchLocations } from '@/features/locations';
import type { LocationRecord } from '@/features/locations';
import { DEFAULT_STAFF_ROLE, STAFF_ROLES, type InviteStaffInput, type StaffRole } from '../types';

type Props = {
  open: boolean;
  onClose: () => void;
  onInvite: (input: InviteStaffInput) => Promise<{ message?: string }>;
};

export function InviteStaffModal({ open, onClose, onInvite }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([DEFAULT_STAFF_ROLE]);
  const [locationId, setLocationId] = useState('');
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (!open) return;
    fetchLocations(true)
      .then((rows) => {
        setLocations(rows);
        const primary = rows.find((l) => l.isPrimary) || rows[0];
        setLocationId(primary?.id || '');
      })
      .catch(() => setLocations([]));
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setName('');
    setEmail('');
    setRoles([DEFAULT_STAFF_ROLE]);
    setError('');
    setSuccess('');
  };

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
    setError('');
    setSuccess('');
    if (roles.length === 0) {
      setError('Select at least one role');
      return;
    }
    setLoading(true);
    try {
      const result = await onInvite({
        name,
        email,
        role: roles[0],
        roles,
        locationId: locationId || null,
      });
      setSuccess(result.message || 'Invitation sent');
      setName('');
      setEmail('');
      setRoles([DEFAULT_STAFF_ROLE]);
      setTimeout(() => {
        reset();
        onClose();
      }, 900);
    } catch (err: any) {
      setError(err.message || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">Invite staff</h2>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-xl text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        </div>
        <p className="mb-4 text-xs text-slate-500">
          They get an email to set a password. Tick every dashboard they may open. Two or more
          roles → a switcher appears above Sign out after they log in.
        </p>

        {error && (
          <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
            {success}
          </div>
        )}

        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Full name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="Dr. Jane Doe"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Work email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
              placeholder="jane@clinic.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">
              Dashboard access
            </label>
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
            <p className="mt-1 text-[11px] text-slate-500">
              Selected: {roles.map((r) => STAFF_ROLES.find((x) => x.value === r)?.label ?? r).join(', ')}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">Location</label>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            >
              {locations.length === 0 ? (
                <option value="">Primary location (auto)</option>
              ) : (
                locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                    {l.isPrimary ? ' (Primary)' : ''}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="rounded-xl bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
            Email invite includes a one-time activation link. No temporary password is shared in
            chat.
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                reset();
                onClose();
              }}
              className="flex-1 rounded-xl bg-slate-100 py-2.5 text-sm font-semibold text-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white disabled:opacity-60 hover:bg-blue-700"
            >
              {loading ? 'Sending…' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
