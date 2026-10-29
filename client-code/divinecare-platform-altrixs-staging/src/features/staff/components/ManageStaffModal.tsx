'use client';

import { useEffect, useState } from 'react';
import { fetchLocations } from '@/features/locations';
import type { LocationRecord } from '@/features/locations';
import { useAuth } from '@/features/auth';
import {
  MEDICAL_DIRECTOR_LABEL,
  MEDICAL_DIRECTOR_SCOPE_MAX,
  canHoldMedicalDirector,
} from '@/lib/auth/medicalDirector';
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
  const [name, setName] = useState('');
  const [roles, setRoles] = useState<StaffRole[]>([DEFAULT_STAFF_ROLE]);
  const [locationId, setLocationId] = useState('');
  const [rcopiaUsername, setRcopiaUsername] = useState('');
  const [medicalDirector, setMedicalDirector] = useState(false);
  const [medicalDirectorScope, setMedicalDirectorScope] = useState('');
  const { user: viewer } = useAuth();
  const [locations, setLocations] = useState<LocationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !user) return;
    setName(user.name || '');
    setRoles(user.roles?.length ? user.roles : [user.role]);
    setLocationId(user.primaryLocationId || '');
    setRcopiaUsername(user.rcopiaUsername || '');
    setMedicalDirector(Boolean(user.isMedicalDirector));
    setMedicalDirectorScope(user.medicalDirectorScope || '');
    setError('');
    fetchLocations(true)
      .then(setLocations)
      .catch(() => setLocations([]));
  }, [open, user]);

  if (!open || !user) return null;

  // Prescriber roles only (validated again on the server); never on your own account.
  const directorEligible = canHoldMedicalDirector(roles[0], roles);
  const isSelf = viewer?.id === user.id;

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
    const trimmedName = name.replace(/\s+/g, ' ').trim();
    if (trimmedName.length < 2) {
      setError('Enter the staff member’s full name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await onSave(user.id, {
        ...(trimmedName !== (user.name || '').trim() ? { name: trimmedName } : {}),
        role: roles[0],
        roles,
        locationId: locationId || null,
        rcopiaUsername: rcopiaUsername.trim() || null,
        ...(isSelf
          ? {}
          : {
              isMedicalDirector: directorEligible && medicalDirector,
              medicalDirectorScope: directorEligible && medicalDirector ? medicalDirectorScope.trim() || null : null,
            }),
      });
      onClose();
    } catch (err: any) {
      setError(err.message || 'Update failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div role="dialog" aria-modal="true" className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Edit staff member</h2>
            <p className="mt-0.5 text-xs text-slate-500">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-2 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
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
            <label htmlFor="staff-name" className="mb-1 block text-sm font-semibold text-slate-700">Full name</label>
            <input
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              autoComplete="off"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Shown on the schedule, client cards and new notes. Notes already signed keep the name they were signed with. A prescriber&apos;s name in DrFirst is changed in DrFirst.
            </p>
          </div>

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

          <div>
            <label className="mb-1 block text-sm font-semibold text-slate-700">DrFirst username</label>
            <input
              value={rcopiaUsername}
              onChange={(e) => setRcopiaUsername(e.target.value)}
              placeholder="Prescribers only, e.g. jsmith"
              autoComplete="off"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-200"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              Their own Rcopia login. E-Prescribe opens DrFirst signed in as this user.
            </p>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
            <label className={`flex items-start gap-2 text-sm ${directorEligible && !isSelf ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
              <input
                type="checkbox"
                checked={directorEligible && medicalDirector}
                disabled={!directorEligible || isSelf}
                onChange={(e) => setMedicalDirector(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-200"
              />
              <span>
                <span className="font-semibold text-slate-800">{MEDICAL_DIRECTOR_LABEL}</span>
                <span className="mt-0.5 block text-[11px] leading-relaxed text-slate-600">
                  {isSelf
                    ? 'You cannot change this on your own account.'
                    : directorEligible
                      ? 'Keeps their role. Adds every client in the practice (all locations), supervisor co-sign and clinical oversight pages. Part 2 / protected records still need break-the-glass. No billing, HR or settings.'
                      : 'Only for a Psychiatrist, NP, Primary Care Physician or Medical NP.'}
                </span>
              </span>
            </label>
            {directorEligible && medicalDirector && !isSelf && (
              <input
                value={medicalDirectorScope}
                onChange={(e) => setMedicalDirectorScope(e.target.value)}
                maxLength={MEDICAL_DIRECTOR_SCOPE_MAX}
                placeholder="Scope (optional), e.g. Behavioral health or Primary care"
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-200"
              />
            )}
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
