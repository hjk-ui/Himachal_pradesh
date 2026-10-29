'use client';

import { useState, useEffect } from 'react';
import type { CreateClientInput } from '../types';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import { useAuth } from '@/features/auth';
import { canEditClientDiagnoses } from '@/lib/clients/orgScope';
import { clientNameFromLegal } from '@/lib/clients/legalName';
import {
  ADMINISTRATIVE_SEX,
  LANGUAGES,
  PHONE_TYPES,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
} from '@/lib/clients/demographics';
import { CodeSelect, DemographicsGapNotice, StateSelect } from './DemographicsInputs';

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreateClientInput, avatarFile?: File | null) => Promise<void>;
};

const fieldClass = 'clinic-input';

const labelClass = 'mb-1 block text-xs font-semibold text-slate-500';

export function ClientIntakeModal({ open, onClose, onSubmit }: Props) {
  const { user } = useAuth();
  // Diagnoses are a clinical determination (licensed BH / leadership); others add them later on the chart
  const canEditDx = canEditClientDiagnoses(user?.role);
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
    phoneType: '',
    dateOfBirth: '',
    administrativeSex: '',
    preferredLanguage: '',
    addressLine1: '',
    addressLine2: '',
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
    if (!form.legalFirstName?.trim() || !form.legalLastName?.trim()) {
      setError('Legal first and last name are required');
      return;
    }
    // Same format rules the API enforces (src/lib/clients/demographics.ts)
    const phoneOk = (v?: string | null) => !v?.trim() || normalizeUsPhone(v) !== null;
    if (!phoneOk(form.phone) || !phoneOk(form.emergencyContactPhone)) {
      setError('Phone numbers must be valid 10-digit US numbers');
      return;
    }
    if (form.state?.trim() && !normalizeStateCode(form.state)) {
      setError('State must be a 2-letter US state code');
      return;
    }
    if (form.postalCode?.trim() && !normalizeUsZip(form.postalCode)) {
      setError('ZIP must be 5 digits or ZIP+4 (12345-6789)');
      return;
    }
    setSaving(true);
    try {
      const blankToNull = (v?: string | null) => (v?.trim() ? v.trim() : null);
      const payload: CreateClientInput = {
        ...form,
        // Client.name is derived from the legal name ("First Last")
        name: clientNameFromLegal(form),
        administrativeSex: blankToNull(form.administrativeSex),
        preferredLanguage: blankToNull(form.preferredLanguage),
        phoneType: blankToNull(form.phoneType),
        assignedToId: form.assignedToId?.trim() ? form.assignedToId.trim() : null,
      };
      await onSubmit(payload, avatarFile);
      setForm({
        name: '',
        legalFirstName: '',
        middleInitial: '',
        legalLastName: '',
        email: '',
        phone: '',
        phoneType: '',
        dateOfBirth: '',
        administrativeSex: '',
        preferredLanguage: '',
        addressLine1: '',
        addressLine2: '',
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

  const initials = (clientNameFromLegal(form) || 'Client')
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-100 bg-white px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-900">New client intake</h2>
            <p className="text-xs text-slate-500">Demographics · insurance · diagnosis</p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form onSubmit={submit} className="space-y-6 px-4 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:px-5">
          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </div>
          )}
          {form.legalFirstName || form.legalLastName ? <DemographicsGapNotice input={form} /> : null}

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
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
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2 grid grid-cols-6 gap-3">
                <div className="col-span-5 sm:col-span-2">
                  <label className={labelClass}>Legal first name *</label>
                  <input className={fieldClass} value={form.legalFirstName || ''} onChange={(e) => set('legalFirstName', e.target.value)} maxLength={80} required />
                </div>
                <div className="col-span-1">
                  <label className={labelClass}>M.I.</label>
                  <input className={fieldClass} value={form.middleInitial || ''} onChange={(e) => set('middleInitial', e.target.value)} maxLength={2} />
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <label className={labelClass}>Legal last name *</label>
                  <input className={fieldClass} value={form.legalLastName || ''} onChange={(e) => set('legalLastName', e.target.value)} maxLength={80} required />
                </div>
                <p className="col-span-6 text-[11px] text-slate-500">As on the insurance card or photo ID (sent to DrFirst and on claims).</p>
              </div>
              <div>
                <label className={labelClass}>Preferred name</label>
                <input className={fieldClass} value={form.preferredName || ''} onChange={(e) => set('preferredName', e.target.value)} maxLength={80} placeholder="Optional" />
              </div>
              <div>
                <label className={labelClass}>Suffix</label>
                <input className={fieldClass} value={form.nameSuffix || ''} onChange={(e) => set('nameSuffix', e.target.value)} maxLength={20} placeholder="e.g. Jr., III" />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  className={fieldClass}
                  value={form.email || ''}
                  onChange={(e) => set('email', e.target.value)}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className={labelClass}>Phone</label>
                  <input
                    type="tel"
                    className={fieldClass}
                    value={form.phone || ''}
                    onChange={(e) => set('phone', e.target.value)}
                    placeholder="(410) 555-0199"
                  />
                </div>
                <CodeSelect id="intake-phone-type" label="Type" value={form.phoneType} onChange={(v) => set('phoneType', v)} options={PHONE_TYPES} placeholder="—" className={fieldClass} labelClassName={labelClass} />
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
              <CodeSelect
                id="intake-admin-sex"
                label="Sex (as on insurance card / ID)"
                value={form.administrativeSex}
                onChange={(v) => set('administrativeSex', v)}
                options={ADMINISTRATIVE_SEX}
                placeholder="Select…"
                className={fieldClass}
                labelClassName={labelClass}
              />
              <CodeSelect id="intake-language" label="Preferred language" value={form.preferredLanguage} onChange={(v) => set('preferredLanguage', v)} options={LANGUAGES} className={fieldClass} labelClassName={labelClass} />
              <p className="sm:col-span-2 -mt-1 text-[11px] text-slate-500">Gender identity, pronouns, race, ethnicity and guarantor are in Edit Client after the chart is created.</p>
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
                <label className={labelClass}>Apt / Suite / Unit</label>
                <input className={fieldClass} value={form.addressLine2 || ''} onChange={(e) => set('addressLine2', e.target.value)} />
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
                <StateSelect id="intake-state" label="State" value={form.state} onChange={(v) => set('state', v)} className={fieldClass} labelClassName={labelClass} />
                <div>
                  <label className={labelClass}>ZIP</label>
                  <input
                    className={fieldClass}
                    value={form.postalCode || ''}
                    onChange={(e) => set('postalCode', e.target.value)}
                    placeholder="21202"
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
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
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

          {canEditDx ? (
          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
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
                <Icd10CodeInput
                  value={form.primaryDiagnosisCode || ''}
                  onChange={(c, picked) => {
                    set('primaryDiagnosisCode', c);
                    if (picked && !form.primaryDiagnosis?.trim()) set('primaryDiagnosis', picked.description);
                  }}
                  context="bh"
                  placeholder="e.g. F32.1 or words"
                  ariaLabel="ICD-10 code"
                  inputClassName={`${fieldClass} pl-7`}
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
          ) : null}

          <section className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
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
