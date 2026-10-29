'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useAuth } from '@/features/auth';
import { PASSWORD_MIN_LENGTH, passwordLengthError } from '@/lib/auth/passwordRules';
import { Alert, Button, Card, CardBody, CardHeader, LoadingState, Page, PageHeader, StatusBadge, buttonClasses, cx, inputClasses, FOCUS_RING } from '@/components/ui';

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
    if (newPassword.length < PASSWORD_MIN_LENGTH) return `Too short — use at least ${PASSWORD_MIN_LENGTH} characters`;
    if (newPassword === currentPassword) return 'Choose a password different from your current one';
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
    if (newPassword && passwordLengthError(newPassword)) {
      setError(passwordLengthError(newPassword) as string);
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
      <Page>
        <LoadingState label="Loading workspace profile…" className="min-h-[40vh]" />
      </Page>
    );
  }

  return (
    <Page className="pb-28 sm:pb-8">
      <PageHeader
        title="Settings"
        description="Account details, security, and professional credentials"
      />

      <Card>
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <div className="flex min-w-0 items-center gap-4">
            <div className="relative shrink-0">
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl bg-blue-50 text-xl font-semibold text-blue-700 ring-1 ring-blue-200">
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt={name || 'Profile'} className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <span aria-hidden className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-blue-600 ring-2 ring-white" />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-semibold text-slate-900">{name || 'Your profile'}</h2>
              <p className="truncate text-sm text-slate-500">{email}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <StatusBadge tone="brand" size="sm">{role || 'STAFF'}</StatusBadge>
                {dirty && <StatusBadge tone="warning" size="sm">Unsaved edits</StatusBadge>}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <label
              className={cx(
                buttonClasses({ variant: 'secondary' }),
                'cursor-pointer focus-within:ring-2 focus-within:ring-blue-600 focus-within:ring-offset-2',
                uploadingPhoto && 'pointer-events-none opacity-50',
              )}
            >
              {uploadingPhoto ? 'Uploading…' : 'Upload photo'}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={uploadingPhoto}
                onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
              />
            </label>
            {image && (
              <Button variant="secondary" disabled={uploadingPhoto} onClick={onRemovePhoto}>
                Remove
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {(error || info) && (
          <div className="space-y-3 lg:col-span-2">
            {error && <Alert tone="danger">{error}</Alert>}
            {info && <Alert tone="info">{info}</Alert>}
          </div>
        )}

        <Card>
          <CardHeader title="Account details" description="Name & login email for this portal" />
          <CardBody className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Full name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                className={inputClasses}
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
                className={inputClasses}
                placeholder="you@clinic.com"
              />
              {emailChanged && (
                <StatusBadge tone="warning" size="sm" className="mt-2">
                  Current password needed below
                </StatusBadge>
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
                className={inputClasses}
                placeholder="+1XXXXXXXXXX"
              />
              <span className="mt-1.5 block text-xs text-slate-500">
                Required for outbound Connect calls. US E.164 only (+1 + 10 digits).
              </span>
            </label>

            <div>
              <span className="mb-1.5 block text-sm font-medium text-slate-700">Role</span>
              <div className="flex min-h-[42px] items-center justify-between gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3">
                <span className="text-sm font-semibold text-slate-800">{role}</span>
                <span className="text-xs text-slate-500">Admin / HR only</span>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Security" description="Password & login protection" />
          <CardBody>
            <div className="rounded-lg bg-slate-50 px-3.5 py-3 text-xs text-slate-600">
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
                placeholder={`Min. ${PASSWORD_MIN_LENGTH} characters`}
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
                  aria-live="polite"
                  className={`text-xs font-semibold ${
                    passwordHint === 'Looks good' ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {passwordHint}
                </p>
              )}
            </div>
          </CardBody>
        </Card>

        {user?.role === 'ADMIN' || user?.role === 'PRACTICE_DIRECTOR' ? (
          <Card className="lg:col-span-2">
            <CardHeader title="Administration" description="Practice-wide tools for Admin / Practice Director" />
            <CardBody className="flex flex-wrap gap-2">
              <Link href="/dashboard/admin/integrations/logs" className={buttonClasses({ variant: 'secondary' })}>
                Integration logs &amp; health
              </Link>
              <Link href="/dashboard/admin/audit-log" className={buttonClasses({ variant: 'secondary' })}>
                HIPAA audit log
              </Link>
            </CardBody>
          </Card>
        ) : null}

        <Card className="lg:col-span-2">
          <CardHeader title="Professional credentials" description="NPI and license details for compliance" />
          <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">NPI</span>
              <input
                value={npi}
                onChange={(e) => setNpi(e.target.value.replace(/\D/g, '').slice(0, 10))}
                inputMode="numeric"
                className={inputClasses}
                placeholder="10-digit NPI"
              />
              <span className="mt-1.5 block text-xs text-slate-500">
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
                className={inputClasses}
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
                className={inputClasses}
              />
            </label>
          </CardBody>
        </Card>

        <Card className="hidden lg:col-span-2 sm:block">
          <CardBody className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">
                {dirty ? 'Ready to update your profile' : 'Everything is up to date'}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Changes apply to your next login session immediately.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" disabled={!dirty || saving} onClick={resetForm}>
                Discard
              </Button>
              <Button type="submit" disabled={saving || !dirty}>
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="fixed inset-x-0 bottom-0 z-20 flex gap-2 border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:hidden">
          <Button variant="secondary" size="lg" disabled={!dirty || saving} onClick={resetForm} className="flex-1">
            Discard
          </Button>
          <Button type="submit" size="lg" disabled={saving || !dirty} className="flex-[1.5]">
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Page>
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
          className={cx(inputClasses, 'pr-16')}
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={`${show ? 'Hide' : 'Show'} ${label.replace(' *', '').toLowerCase()}`}
          className={cx('absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-800', FOCUS_RING)}
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );
}
