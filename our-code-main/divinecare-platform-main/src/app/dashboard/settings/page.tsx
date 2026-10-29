'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useAuth } from '@/features/auth';
import { PageHeader, Panel, Badge } from '@/components/clinic/ui';
import { DocumentationPolicyPanel } from '@/components/notes/DocumentationPolicyPanel';

type ProfileUser = {
  id: string;
  name: string | null;
  email: string;
  phone?: string | null;
  role: string;
  image?: string | null;
  npi?: string | null;
  licenseNumber?: string | null;
  licenseExpiresAt?: string | null;
  createdAt: string;
};

export default function SettingsPage() {
  const { user } = useAuth();
  const { update } = useSession();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [originalEmail, setOriginalEmail] = useState('');
  const [originalName, setOriginalName] = useState('');
  const [originalPhone, setOriginalPhone] = useState('');
  const [npi, setNpi] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [licenseExpiresAt, setLicenseExpiresAt] = useState('');
  const [originalNpi, setOriginalNpi] = useState('');
  const [originalLicenseNumber, setOriginalLicenseNumber] = useState('');
  const [originalLicenseExpiresAt, setOriginalLicenseExpiresAt] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [role, setRole] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/profile');
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Could not load profile');
        }
        if (cancelled) return;
        const p = data.user as ProfileUser;
        setName(p.name || '');
        setOriginalName(p.name || '');
        setEmail(p.email);
        setOriginalEmail(p.email);
        setPhone(p.phone || '');
        setOriginalPhone(p.phone || '');
        setNpi(p.npi || '');
        setOriginalNpi(p.npi || '');
        setLicenseNumber(p.licenseNumber || '');
        setOriginalLicenseNumber(p.licenseNumber || '');
        setLicenseExpiresAt(p.licenseExpiresAt || '');
        setOriginalLicenseExpiresAt(p.licenseExpiresAt || '');
        setRole(p.role);
        setImage(p.image || null);
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || 'Could not load profile');
          if (user) {
            setName(user.name || user.displayName || '');
            setOriginalName(user.name || user.displayName || '');
            setEmail(user.email || '');
            setOriginalEmail(user.email || '');
            setRole(user.role || '');
            setImage(user.image || null);
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const emailChanged = email.trim().toLowerCase() !== originalEmail.trim().toLowerCase();
  const nameChanged = name.trim() !== originalName.trim();
  const phoneChanged = phone.trim() !== originalPhone.trim();
  const credentialsChanged =
    npi.trim() !== originalNpi.trim() ||
    licenseNumber.trim() !== originalLicenseNumber.trim() ||
    licenseExpiresAt !== originalLicenseExpiresAt;
  const passwordChanging = Boolean(newPassword);
  const needsCurrentPassword = emailChanged || passwordChanging;
  const dirty = nameChanged || emailChanged || phoneChanged || passwordChanging || credentialsChanged;

  const passwordHint = useMemo(() => {
    if (!newPassword) return '';
    if (newPassword.length < 8) return 'Too short — use at least 8 characters';
    if (newPassword === currentPassword) return 'Choose a different password than current';
    if (confirmPassword && newPassword !== confirmPassword) return 'Passwords do not match yet';
    return 'Looks good';
  }, [newPassword, confirmPassword, currentPassword]);

  const initials = (name || email || 'U')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');

    if (!dirty) {
      setInfo('No changes to save.');
      return;
    }
    if (newPassword && newPassword.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    if (newPassword && newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }
    if (needsCurrentPassword && !currentPassword) {
      setError('Enter your current password to change email or password.');
      return;
    }
    if (npi.trim() && !/^\d{10}$/.test(npi.trim())) {
      setError('NPI must be exactly 10 digits.');
      return;
    }
    if (phone.trim() && !/^\+1\d{10}$/.test(phone.trim())) {
      setError('Phone must be US E.164 format: +1 followed by 10 digits.');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone: phone.trim(),
          npi: npi.trim(),
          licenseNumber: licenseNumber.trim(),
          licenseExpiresAt: licenseExpiresAt || '',
          currentPassword: currentPassword || undefined,
          newPassword: newPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Update failed');
      }

      await update({
        name: data.user.name,
        email: data.user.email,
        image: data.user.image ?? image,
      });

      setOriginalName(data.user.name || '');
      setOriginalEmail(data.user.email);
      setName(data.user.name || '');
      setEmail(data.user.email);
      setPhone(data.user.phone || '');
      setOriginalPhone(data.user.phone || '');
      setNpi(data.user.npi || '');
      setOriginalNpi(data.user.npi || '');
      setLicenseNumber(data.user.licenseNumber || '');
      setOriginalLicenseNumber(data.user.licenseNumber || '');
      setLicenseExpiresAt(data.user.licenseExpiresAt || '');
      setOriginalLicenseExpiresAt(data.user.licenseExpiresAt || '');
      if (data.user.image !== undefined) setImage(data.user.image);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setInfo('Profile updated successfully.');
    } catch (err: any) {
      setError(err.message || 'Could not update profile');
    } finally {
      setSaving(false);
    }
  };

  const onPickPhoto = async (file: File | null) => {
    if (!file) return;
    setError('');
    setInfo('');
    setUploadingPhoto(true);
    try {
      const body = new FormData();
      body.append('avatar', file);
      const res = await fetch('/api/profile/avatar', { method: 'POST', body });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Upload failed');
      }
      setImage(data.user.image);
      await update({
        name: data.user.name,
        email: data.user.email,
        image: data.user.image,
      });
      setInfo('Profile photo updated — visible across the portal.');
    } catch (err: any) {
      setError(err.message || 'Could not upload photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const onRemovePhoto = async () => {
    setError('');
    setInfo('');
    setUploadingPhoto(true);
    try {
      const res = await fetch('/api/profile/avatar', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Could not remove photo');
      }
      setImage(null);
      await update({
        name: data.user.name,
        email: data.user.email,
        image: null,
      });
      setInfo('Profile photo removed.');
    } catch (err: any) {
      setError(err.message || 'Could not remove photo');
    } finally {
      setUploadingPhoto(false);
    }
  };

  const resetForm = () => {
    setName(originalName);
    setEmail(originalEmail);
    setPhone(originalPhone);
    setNpi(originalNpi);
    setLicenseNumber(originalLicenseNumber);
    setLicenseExpiresAt(originalLicenseExpiresAt);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setInfo('');
  };

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-slate-500">
        Loading workspace profile…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 pb-28 sm:pb-8">
      <PageHeader
        title="Settings"
        description="Account details, security, and professional credentials"
      />

      <Panel className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-xl font-semibold text-blue-700 ring-1 ring-blue-100">
              {image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={image} alt={name || 'Profile'} className="h-full w-full object-cover" />
              ) : (
                initials
              )}
            </div>
            <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-blue-500 ring-2 ring-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{name || 'Your profile'}</h2>
            <p className="text-sm text-slate-500">{email}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="blue">{role || 'STAFF'}</Badge>
              {dirty && <Badge tone="amber">Unsaved edits</Badge>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <label className="clinic-btn-secondary cursor-pointer">
            {uploadingPhoto ? 'Uploading…' : 'Upload photo'}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={uploadingPhoto}
              onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
            />
          </label>
          {image && (
            <button
              type="button"
              disabled={uploadingPhoto}
              onClick={onRemovePhoto}
              className="clinic-btn-secondary disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </Panel>

      <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-2">
        {(error || info) && (
          <div className="lg:col-span-2 space-y-3">
            {error && (
              <div
                role="alert"
                className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
              >
                {error}
              </div>
            )}
            {info && (
              <div
                role="status"
                className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
              >
                {info}
              </div>
            )}
          </div>
        )}

        <Panel>
          <h2 className="text-sm font-semibold text-slate-900">Account details</h2>
          <p className="mt-0.5 text-xs text-slate-500">Name & login email for this portal</p>

          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                className="clinic-input"
                placeholder="Your full name"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Login email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="clinic-input"
                placeholder="you@clinic.com"
              />
              {emailChanged && (
                <span className="mt-2 inline-flex rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-100">
                  Current password needed below
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                Phone (Amazon Connect)
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.trim())}
                className="clinic-input"
                placeholder="+1XXXXXXXXXX"
              />
              <span className="mt-1.5 block text-[11px] text-slate-400">
                Required for outbound Connect calls. US E.164 only (+1 + 10 digits).
              </span>
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Role</span>
              <div className="flex min-h-[42px] items-center justify-between rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3">
                <span className="text-sm font-semibold text-slate-800">{role}</span>
                <span className="text-[11px] text-slate-400">Admin / HR only</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel>
          <h2 className="text-sm font-semibold text-slate-900">Integration logs & health</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Admin / Practice Director can review vendor call metadata.
          </p>
          <a
            href="/dashboard/admin/integrations/logs"
            className="mt-3 inline-flex text-sm font-semibold text-[#5C2D91] hover:underline"
          >
            Open integration logs
          </a>
        </Panel>

        <Panel>
          <h2 className="text-sm font-semibold text-slate-900">Security</h2>
          <p className="mt-0.5 text-xs text-slate-500">Password & login protection</p>

          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
            Leave new password empty if you only want to update name or email.
          </div>

          <div className="mt-4 space-y-4">
            <PasswordField
              label={needsCurrentPassword ? 'Current password *' : 'Current password'}
              value={currentPassword}
              onChange={setCurrentPassword}
              show={showCurrent}
              onToggle={() => setShowCurrent((v) => !v)}
              autoComplete="current-password"
              placeholder={
                needsCurrentPassword ? 'Required for this change' : 'Only if changing email/password'
              }
            />

            <PasswordField
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              show={showNew}
              onToggle={() => setShowNew((v) => !v)}
              autoComplete="new-password"
              placeholder="Min. 8 characters"
            />

            <PasswordField
              label="Confirm new password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              show={showNew}
              onToggle={() => setShowNew((v) => !v)}
              autoComplete="new-password"
              placeholder="Repeat new password"
            />

            {passwordHint && (
              <p
                className={`text-xs font-semibold ${
                  passwordHint === 'Looks good' ? 'text-blue-700' : 'text-amber-700'
                }`}
              >
                {passwordHint}
              </p>
            )}
          </div>
        </Panel>

        <Panel className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-slate-900">Professional credentials</h2>
          <p className="mt-0.5 text-xs text-slate-500">NPI and license details for compliance</p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">NPI</span>
              <input
                value={npi}
                onChange={(e) => setNpi(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                className="clinic-input"
                placeholder="10-digit NPI"
              />
              <span className="mt-1.5 block text-[11px] text-slate-400">
                National Provider Identifier (optional)
              </span>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                License number
              </span>
              <input
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="clinic-input"
                placeholder="e.g. LCSW-07823"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">
                License expiration
              </span>
              <input
                type="date"
                value={licenseExpiresAt}
                onChange={(e) => setLicenseExpiresAt(e.target.value)}
                className="clinic-input"
              />
            </label>
          </div>
        </Panel>

        <div className="clinic-card hidden items-center justify-between gap-4 px-6 py-4 lg:col-span-2 sm:flex">
          <div>
            <p className="text-sm font-semibold text-slate-800">
              {dirty ? 'Ready to update your profile' : 'Everything is up to date'}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Changes apply to your next login session immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!dirty || saving}
              onClick={resetForm}
              className="clinic-btn-secondary disabled:opacity-40"
            >
              Discard
            </button>
            <button type="submit" disabled={saving || !dirty} className="clinic-btn-primary disabled:opacity-40">
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>

        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl sm:hidden">
          <button
            type="button"
            disabled={!dirty || saving}
            onClick={resetForm}
            className="clinic-btn-secondary min-h-[50px] flex-1 disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="submit"
            disabled={saving || !dirty}
            className="clinic-btn-primary min-h-[50px] flex-[1.5] disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
      <DocumentationPolicyPanel />
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
  placeholder: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>
      <div className="relative">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          className="clinic-input pr-16"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );
}
