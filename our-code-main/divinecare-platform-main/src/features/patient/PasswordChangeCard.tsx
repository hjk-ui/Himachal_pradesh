'use client';

import { useState, type FormEvent } from 'react';
import { readPatientApi } from '@/features/patient/api';
import { getPatientToken, setPatientToken } from '@/features/patient/tokenStorage';

export function PasswordChangeCard({
  onSessionExpired,
}: {
  onSessionExpired: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Password rules validation
  const hasMinLength = newPassword.length >= 8 && newPassword.length <= 72;
  const hasLetter = /[A-Za-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasNoSpaces = !/\s/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isFormValid =
    currentPassword.trim().length > 0 &&
    hasMinLength &&
    hasLetter &&
    hasNumber &&
    hasNoSpaces &&
    passwordsMatch;

  function resetForm() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }
    if (!hasMinLength) {
      setError('New password must be between 8 and 72 characters.');
      return;
    }
    if (!hasNoSpaces) {
      setError('Password cannot contain spaces.');
      return;
    }
    if (!hasLetter || !hasNumber) {
      setError('Password must include at least one letter and one number.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }

    const token = getPatientToken();
    if (!token) {
      onSessionExpired();
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/api/patient/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (response.status === 401) {
        onSessionExpired();
        return;
      }

      const data = await readPatientApi<{ token: string; message?: string }>(response);
      if (data.token) {
        // Update session storage so current session remains continuously authenticated
        setPatientToken(data.token);
      }

      setSuccess('Your password has been changed successfully.');
      resetForm();
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Account Security" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Security &amp; Password</h2>
          <p className="text-sm text-slate-500">Manage your patient account password and credentials.</p>
        </div>
        {!isOpen && (
          <button
            type="button"
            onClick={() => {
              resetForm();
              setSuccess('');
              setIsOpen(true);
            }}
            className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50"
          >
            Change password
          </button>
        )}
      </div>

      {success && (
        <div role="status" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800">
          <p className="font-semibold">Password updated!</p>
          <p className="mt-0.5 text-xs text-emerald-700">{success}</p>
        </div>
      )}

      {isOpen && (
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {error && (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Current password</label>
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter current password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setShowCurrent(!showCurrent)}
                aria-label={showCurrent ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                {showCurrent ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">New password</label>
            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={72}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Letter + number, min 8 characters"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setShowNew(!showNew)}
                aria-label={showNew ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                {showNew ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Confirm new password</label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                required
                minLength={8}
                maxLength={72}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                placeholder="Repeat new password"
                className="w-full rounded-lg border border-slate-300 px-3 py-2.5 pr-10 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              />
              <button
                type="button"
                onClick={() => setShowConfirm(!showConfirm)}
                aria-label={showConfirm ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-slate-400 hover:text-slate-600"
              >
                {showConfirm ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          {/* Validation Checklist */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-xs text-slate-600">
            <p className="font-semibold text-slate-700">Password requirements:</p>
            <ul className="mt-2 space-y-1">
              <li className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <span>{hasMinLength ? '✓' : '•'}</span> Between 8 and 72 characters
              </li>
              <li className={`flex items-center gap-1.5 ${hasLetter && hasNumber ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <span>{hasLetter && hasNumber ? '✓' : '•'}</span> Contains at least one letter and one number
              </li>
              <li className={`flex items-center gap-1.5 ${hasNoSpaces && newPassword.length > 0 ? 'text-emerald-700 font-medium' : 'text-slate-500'}`}>
                <span>{hasNoSpaces && newPassword.length > 0 ? '✓' : '•'}</span> No whitespace or spaces
              </li>
              {confirmPassword.length > 0 && (
                <li className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-700 font-medium' : 'text-red-600'}`}>
                  <span>{passwordsMatch ? '✓' : '✗'}</span> Passwords match
                </li>
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={saving || !isFormValid}
              className="rounded-lg bg-[#141C34] px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saving ? 'Updating password…' : 'Save new password'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setIsOpen(false);
                resetForm();
              }}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
