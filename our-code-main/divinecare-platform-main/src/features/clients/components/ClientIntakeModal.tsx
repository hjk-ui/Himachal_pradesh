'use client';

import { useState, useEffect } from 'react';
import type { CreateClientInput } from '../types';

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateClientInput, avatarFile?: File | null) => Promise<void>;
};

const fieldClass = 'clinic-input';

const labelClass = 'mb-1 block text-xs font-semibold text-slate-500';

export function ClientIntakeModal({ open, onClose, onSubmit }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [staffDirectory, setStaffDirectory] = useState<Array<{ id: string; name: string; role: string }>>([]);

  useEffect(() => {
    if (!open) return;
    async function loadDirectory() {
      try {
        const res = await fetch('/api/staff/directory');
        const data = await res.json();
        if (data.success && Array.isArray(data.users)) {
          setStaffDirectory(data.users);
        }
      } catch (err) {
        console.error('Failed to load staff directory in intake modal:', err);
      }
    }
    void loadDirectory();
  }, [open]);
  const [form, setForm] = useState<CreateClientInput>({
    name: '',
    legalFirstName: '',
    middleInitial: '',
    legalLastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    addressLine1: '',
    city: '',
    state: '',
    postalCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    insurancePayer: '',
    insuranceMemberId: '',
    insuranceGroupNumber: '',
    primaryDiagnosis: '',
    primaryDiagnosisCode: '',
    secondaryDiagnoses: '',
  });

  if (!open) return null;

  const set = (key: keyof CreateClientInput, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const resetAvatar = () => {
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarFile(null);
    setAvatarPreview(null);
  };

  const pickAvatar = (file: File | null) => {
    resetAvatar();
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) {
      setError('Use JPG, PNG, WEBP, or GIF for the client photo');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Client photo must be under 10MB');
      return;
    }
    setError('');
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const closeModal = () => {
    resetAvatar();
    setError('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('Client name is required');
      return;
    }
    setSaving(true);
    try {
      const payload: CreateClientInput = {
        ...form,
        assignedToId: form.assignedToId?.trim() ? form.assignedToId.trim() : null,
      };
      await onSubmit(payload, avatarFile);
      setForm({
        name: '',
        email: '',
        phone: '',
        dateOfBirth: '',
        gender: '',
        addressLine1: '',
        city: '',
        state: '',
        postalCode: '',
        emergencyContactName: '',
        emergencyContactPhone: '',
        insurancePayer: '',
        insuranceMemberId: '',
        insuranceGroupNumber: '',
        primaryDiagnosis: '',
        primaryDiagnosisCode: '',
        secondaryDiagnoses: '',
      });
      resetAvatar();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Could not save client');
    } finally {
      setSaving(false);
    }
  };

  const initials = (form.name || 'Client')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">New client intake</h2>
            <p className="text-xs text-slate-500">Demographics · insurance · diagnosis</p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-6 px-5 py-5">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Demographics
            </h3>
            <div className="flex flex-col gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 sm:flex-row sm:items-center">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-50 text-sm font-semibold text-blue-700 ring-1 ring-blue-100">
                {avatarPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatarPreview} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900">Client photo</p>
                <p className="text-xs text-slate-500">Shown in the client roster and profile.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="clinic-btn-secondary cursor-pointer">
                  Upload photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={saving}
                    onChange={(e) => pickAvatar(e.target.files?.[0] || null)}
                  />
                </label>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={resetAvatar}
                    className="clinic-btn-secondary"
                    disabled={saving}
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
            {/* DrFirst / Surescripts Legal Name Notice */}
            <div className="rounded-xl border border-purple-100 bg-purple-50/50 p-3 sm:col-span-2">
              <div className="flex items-start gap-2">
                <span className="text-xs font-semibold text-[#5C2D91]">DrFirst E-Prescribe Standard:</span>
                <p className="text-xs text-purple-900/80">
                  Client Legal Name (as on the insurance card — required for DrFirst & Surescripts identity matching).
                </p>
              </div>
            </div>

            <div className="grid grid-cols-12 gap-3 sm:col-span-2">
              <div className="col-span-12 sm:col-span-5">
                <label className={labelClass}>Legal First Name *</label>
                <input
                  className={fieldClass}
                  placeholder="e.g. John"
                  value={form.legalFirstName || ''}
                  onChange={(e) => {
                    const first = e.target.value;
                    const mi = form.middleInitial || '';
                    const last = form.legalLastName || '';
                    const full = [first, mi, last].filter(Boolean).join(' ');
                    setForm((prev) => ({
                      ...prev,
                      legalFirstName: first,
                      name: full || prev.name,
                    }));
                  }}
                  required
                />
              </div>
              <div className="col-span-4 sm:col-span-2">
                <label className={labelClass}>M.I.</label>
                <input
                  className={fieldClass}
                  placeholder="A"
                  maxLength={1}
                  value={form.middleInitial || ''}
                  onChange={(e) => {
                    const mi = e.target.value.toUpperCase().slice(0, 1);
                    const first = form.legalFirstName || '';
                    const last = form.legalLastName || '';
                    const full = [first, mi, last].filter(Boolean).join(' ');
                    setForm((prev) => ({
                      ...prev,
                      middleInitial: mi,
                      name: full || prev.name,
                    }));
                  }}
                />
              </div>
              <div className="col-span-8 sm:col-span-5">
                <label className={labelClass}>Legal Last Name *</label>
                <input
                  className={fieldClass}
                  placeholder="e.g. Doe"
                  value={form.legalLastName || ''}
                  onChange={(e) => {
                    const last = e.target.value;
                    const first = form.legalFirstName || '';
                    const mi = form.middleInitial || '';
                    const full = [first, mi, last].filter(Boolean).join(' ');
                    setForm((prev) => ({
                      ...prev,
                      legalLastName: last,
                      name: full || prev.name,
                    }));
                  }}
                  required
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  className={fieldClass}
                  value={form.email || ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Phone</label>
                <input
                  className={fieldClass}
                  value={form.phone || ''}
                  onChange={(e) => set('phone', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Date of birth</label>
                <input
                  type="date"
                  className={fieldClass}
                  value={form.dateOfBirth || ''}
                  onChange={(e) => set('dateOfBirth', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Gender</label>
                <select
                  className={fieldClass}
                  value={form.gender || ''}
                  onChange={(e) => set('gender', e.target.value)}
                >
                  <option value="">Select…</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Address</label>
                <input
                  className={fieldClass}
                  value={form.addressLine1 || ''}
                  onChange={(e) => set('addressLine1', e.target.value)}
                  placeholder="Street address"
                />
              </div>
              <div>
                <label className={labelClass}>City</label>
                <input
                  className={fieldClass}
                  value={form.city || ''}
                  onChange={(e) => set('city', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    className={fieldClass}
                    value={form.state || ''}
                    onChange={(e) => set('state', e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelClass}>ZIP</label>
                  <input
                    className={fieldClass}
                    value={form.postalCode || ''}
                    onChange={(e) => set('postalCode', e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className={labelClass}>Emergency contact</label>
                <input
                  className={fieldClass}
                  value={form.emergencyContactName || ''}
                  onChange={(e) => set('emergencyContactName', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Emergency phone</label>
                <input
                  className={fieldClass}
                  value={form.emergencyContactPhone || ''}
                  onChange={(e) => set('emergencyContactPhone', e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Insurance
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={labelClass}>Payer / plan</label>
                <input
                  className={fieldClass}
                  value={form.insurancePayer || ''}
                  onChange={(e) => set('insurancePayer', e.target.value)}
                  placeholder="e.g. Medicaid, Blue Cross"
                />
              </div>
              <div>
                <label className={labelClass}>Member ID</label>
                <input
                  className={fieldClass}
                  value={form.insuranceMemberId || ''}
                  onChange={(e) => set('insuranceMemberId', e.target.value)}
                />
              </div>
              <div>
                <label className={labelClass}>Group number</label>
                <input
                  className={fieldClass}
                  value={form.insuranceGroupNumber || ''}
                  onChange={(e) => set('insuranceGroupNumber', e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Diagnosis
            </h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Primary diagnosis</label>
                <input
                  className={fieldClass}
                  value={form.primaryDiagnosis || ''}
                  onChange={(e) => set('primaryDiagnosis', e.target.value)}
                  placeholder="e.g. Major depressive disorder"
                />
              </div>
              <div>
                <label className={labelClass}>ICD-10 / DSM code</label>
                <input
                  className={fieldClass}
                  value={form.primaryDiagnosisCode || ''}
                  onChange={(e) => set('primaryDiagnosisCode', e.target.value)}
                  placeholder="e.g. F32.1"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>Secondary diagnoses</label>
                <input
                  className={fieldClass}
                  value={form.secondaryDiagnoses || ''}
                  onChange={(e) => set('secondaryDiagnoses', e.target.value)}
                  placeholder="Optional, comma-separated"
                />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
              Care Assignment
            </h3>
            <div>
              <label className={labelClass}>Assign to Clinician</label>
              <select
                className={fieldClass}
                value={form.assignedToId || ''}
                onChange={(e) => set('assignedToId', e.target.value)}
              >
                <option value="">Unassigned (assign later)</option>
                {staffDirectory.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.role.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                The assigned clinician will immediately see this client in their caseload.
              </p>
            </div>
          </section>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end pt-1 pb-2">
            <button
              type="button"
              onClick={closeModal}
              className="min-h-[44px] px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="clinic-btn-primary min-h-[44px] disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
