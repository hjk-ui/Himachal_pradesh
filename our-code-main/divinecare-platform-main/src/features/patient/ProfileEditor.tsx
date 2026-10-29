'use client';

import { useState, type FormEvent } from 'react';
import { parsePatientApi, type PatientApiBody } from '@/features/patient/api';
import { getPatientToken } from '@/features/patient/tokenStorage';

type ContactDetails = {
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
};

export type PatientProfileDetails = ContactDetails & {
  id: string;
  name: string;
  email: string;
  image: string | null;
};

type Field = { key: keyof ContactDetails; label: string; maxLength: number; autoComplete: string; type?: 'tel' };

const groups: { title: string; fields: Field[] }[] = [
  { title: 'Contact', fields: [
    { key: 'phone', label: 'Phone number', maxLength: 30, autoComplete: 'tel', type: 'tel' },
  ] },
  { title: 'Address', fields: [
    { key: 'addressLine1', label: 'Address line 1', maxLength: 200, autoComplete: 'address-line1' },
    { key: 'addressLine2', label: 'Address line 2', maxLength: 200, autoComplete: 'address-line2' },
    { key: 'city', label: 'City', maxLength: 100, autoComplete: 'address-level2' },
    { key: 'state', label: 'State / region', maxLength: 100, autoComplete: 'address-level1' },
    { key: 'postalCode', label: 'Postal code', maxLength: 20, autoComplete: 'postal-code' },
  ] },
  { title: 'Emergency contact', fields: [
    { key: 'emergencyContactName', label: 'Emergency contact name', maxLength: 120, autoComplete: 'section-emergency name' },
    { key: 'emergencyContactPhone', label: 'Emergency contact phone', maxLength: 30, autoComplete: 'section-emergency tel', type: 'tel' },
  ] },
];
const fields = groups.flatMap((group) => group.fields);
const draftFor = (profile: PatientProfileDetails) =>
  Object.fromEntries(fields.map(({ key }) => [key, profile[key] ?? ''])) as Record<keyof ContactDetails, string>;

export function ProfileEditor({ profile, onSaved, onSessionExpired }: {
  profile: PatientProfileDetails;
  onSaved: (profile: PatientProfileDetails) => void;
  onSessionExpired: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => draftFor(profile));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState('');

  const changes = Object.fromEntries(fields.flatMap(({ key }) => {
    const value = draft[key].trim() || null;
    return value === (profile[key]?.trim() || null) ? [] : [[key, value]];
  }));

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !Object.keys(changes).length) return;
    const token = getPatientToken();
    if (!token) { onSessionExpired(); return; }
    setSaving(true);
    setError('');
    setFieldErrors({});
    setSuccess('');
    try {
      const response = await fetch('/api/patient/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(changes),
      });
      if (response.status === 401) { onSessionExpired(); return; }
      const body = await response.json() as PatientApiBody<{ client: PatientProfileDetails }>;
      if (!response.ok || !body.success) {
        if (body.error && typeof body.error === 'object') setFieldErrors(body.error.fields || {});
        const message = typeof body.error === 'string' ? body.error : body.error?.message;
        throw new Error(message || 'Could not save your profile. Please try again.');
      }
      const data = parsePatientApi(body);
      onSaved(data.client);
      setDraft(draftFor(data.client));
      setEditing(false);
      setSuccess('Your profile has been updated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-label="Patient profile" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{profile.name}</h2>
          <p className="break-all text-sm text-slate-600">{profile.email}</p>
        </div>
        {!editing && (
          <button type="button" onClick={() => {
            setDraft(draftFor(profile)); setError(''); setFieldErrors({}); setSuccess(''); setEditing(true);
          }} className="rounded-lg border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">
            Edit profile
          </button>
        )}
      </div>
      {success && <p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">{success}</p>}
      {editing ? (
        <form onSubmit={save} className="mt-5 space-y-5">
          <p className="text-sm text-slate-500">Update your contact details below. To change your name or sign-in email, contact your clinic.</p>
          {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          {groups.map((group) => (
            <fieldset key={group.title} disabled={saving} className="space-y-3 disabled:opacity-60">
              <legend className="mb-2 text-sm font-semibold text-slate-900">{group.title}</legend>
              {group.fields.map((field) => {
                const id = 'profile-' + field.key;
                return (
                  <div key={field.key}>
                    <label htmlFor={id} className="mb-1 block text-sm text-slate-700">{field.label}</label>
                    <input id={id} name={field.key} type={field.type || 'text'}
                      autoComplete={field.autoComplete} maxLength={field.maxLength}
                      minLength={field.type === 'tel' ? 5 : undefined} value={draft[field.key]}
                      onChange={(event) => {
                        setDraft((current) => ({ ...current, [field.key]: event.target.value }));
                        setFieldErrors((current) => ({ ...current, [field.key]: '' }));
                      }}
                      aria-invalid={Boolean(fieldErrors[field.key])}
                      aria-describedby={fieldErrors[field.key] ? id + '-error' : undefined}
                      className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                    {fieldErrors[field.key] && <p id={id + '-error'} className="mt-1 text-sm text-red-700">{fieldErrors[field.key]}</p>}
                  </div>
                );
              })}
            </fieldset>
          ))}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={saving || !Object.keys(changes).length}
              className="rounded-lg bg-[#141C34] px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 disabled:opacity-50">
              {saving ? 'Saving...' : 'Save changes'}
            </button>
            <button type="button" disabled={saving} onClick={() => { setEditing(false); setError(''); setFieldErrors({}); }}
              className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="mt-5 space-y-4 text-sm">
          <div><dt className="font-medium text-slate-700">Phone</dt><dd className="mt-1 text-slate-600">{profile.phone || 'Not added'}</dd></div>
          <div>
            <dt className="font-medium text-slate-700">Address</dt>
            <dd className="mt-1 whitespace-pre-line text-slate-600">
              {[profile.addressLine1, profile.addressLine2, [profile.city, profile.state, profile.postalCode].filter(Boolean).join(', ')].filter(Boolean).join('\n') || 'Not added'}
            </dd>
          </div>
          <div>
            <dt className="font-medium text-slate-700">Emergency contact</dt>
            <dd className="mt-1 text-slate-600">{profile.emergencyContactName || 'Not added'}{profile.emergencyContactPhone && <span className="block">{profile.emergencyContactPhone}</span>}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
