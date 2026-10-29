'use client';

import { useMemo, useState } from 'react';
import { Button, inputClasses } from '@/components/ui';
import {
  AGE_GROUPS,
  AVAILABILITY_DAYS,
  AVAILABILITY_TIMES,
  CONTACT_PREFERENCES,
  SAFETY_SCREEN_QUESTION,
  WAITLIST_SERVICES,
} from '@/lib/waitlist/standard';
import {
  createWaitlistEntry,
  updateWaitlistEntry,
  type SafetyScreen,
  type WaitlistClinician,
  type WaitlistEntry,
  type WaitlistInput,
  type WaitlistUrgency,
} from '@/features/waitlist/api';
import { CrisisGuidance, Drawer, Field, SectionTitle, errorMessage } from './shared';

const REFERRAL_SOURCES = [
  'Self-referral',
  'Family / friend',
  'Primary care provider',
  'Hospital / ED discharge',
  'School',
  'Court / legal',
  'Other behavioral health provider',
  'Insurance / care manager',
  'Community outreach',
  'Website',
  'Other',
];

type FormState = {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  phone: string;
  email: string;
  preferredContactMethod: string;
  bestTimeToContact: string;
  guardianName: string;
  guardianPhone: string;
  guardianRelationship: string;
  specialty: string;
  ageGroup: string;
  preferredLocationIds: string[];
  telehealthOk: '' | 'yes' | 'no';
  availabilityDays: string[];
  availabilityTimes: string[];
  clinicianGenderPref: string;
  languagePref: string;
  preferredClinicianId: string;
  urgency: WaitlistUrgency;
  payerRegistryId: string;
  insurancePayer: string;
  insuranceMemberId: string;
  referralSource: string;
  referringProvider: string;
  presentingConcern: string;
  safetyScreen: '' | SafetyScreen;
  notes: string;
};

function fromEntry(e: WaitlistEntry | null): FormState {
  return {
    firstName: e?.firstName ?? '',
    lastName: e?.lastName ?? '',
    dateOfBirth: e?.dateOfBirth ?? '',
    phone: e?.phone ?? '',
    email: e?.email ?? '',
    preferredContactMethod: e?.preferredContactMethod ?? '',
    bestTimeToContact: e?.bestTimeToContact ?? '',
    guardianName: e?.guardianName ?? '',
    guardianPhone: e?.guardianPhone ?? '',
    guardianRelationship: e?.guardianRelationship ?? '',
    specialty: e?.specialty ?? '',
    ageGroup: e?.ageGroup ?? '',
    preferredLocationIds: e?.preferredLocationIds ?? [],
    telehealthOk: e?.telehealthOk == null ? '' : e.telehealthOk ? 'yes' : 'no',
    availabilityDays: e?.availabilityDays ?? [],
    availabilityTimes: e?.availabilityTimes ?? [],
    clinicianGenderPref: e?.clinicianGenderPref ?? '',
    languagePref: e?.languagePref ?? '',
    preferredClinicianId: '',
    urgency: e?.urgency ?? 'routine',
    payerRegistryId: e?.payerRegistryId ?? '',
    insurancePayer: e?.insurancePayer ?? '',
    insuranceMemberId: e?.insuranceMemberId ?? '',
    referralSource: e?.referralSource ?? '',
    referringProvider: e?.referringProvider ?? '',
    presentingConcern: e?.presentingConcern ?? '',
    safetyScreen: (e?.safetyScreen as SafetyScreen | null) ?? '',
    notes: e?.notes ?? '',
  };
}

function isMinor(dob: string, ageGroup: string) {
  if (ageGroup === 'child' || ageGroup === 'adolescent') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return false;
  const d = new Date(`${dob}T12:00:00Z`);
  const age = (Date.now() - d.getTime()) / (365.25 * 86_400_000);
  return age < 18;
}

const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

export function EntryFormDrawer({
  entry,
  locations,
  payers,
  clinicians,
  onClose,
  onSaved,
}: {
  entry: WaitlistEntry | null;
  locations: { id: string; name: string }[];
  payers: { id: string; name: string }[];
  clinicians: WaitlistClinician[];
  onClose: () => void;
  onSaved: (entry: WaitlistEntry, crisisGuidance: boolean) => void;
}) {
  const [f, setF] = useState<FormState>(() => fromEntry(entry));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }));
  const minor = useMemo(() => isMinor(f.dateOfBirth, f.ageGroup), [f.dateOfBirth, f.ageGroup]);
  const isEdit = Boolean(entry);
  const legacyService = f.specialty && !(WAITLIST_SERVICES as readonly string[]).includes(f.specialty);

  const save = async () => {
    setError('');
    if (!f.firstName.trim() || !f.lastName.trim()) return setError('First and last name are required');
    if (!f.phone.trim() && !f.email.trim()) return setError('Add a phone number or an email so the person can be reached');
    if (!f.specialty) return setError('Pick the service requested');
    if (!isEdit && !f.safetyScreen) return setError('Ask the safety screen question (or mark it "Not asked")');
    if (minor && !f.guardianName.trim()) return setError('Minors need a parent / guardian name');
    const payer = payers.find((p) => p.id === f.payerRegistryId);
    const clinician = clinicians.find((c) => c.id === f.preferredClinicianId);
    const body: WaitlistInput = {
      firstName: f.firstName.trim(),
      lastName: f.lastName.trim(),
      dateOfBirth: f.dateOfBirth || null,
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      preferredContactMethod: f.preferredContactMethod || null,
      bestTimeToContact: f.bestTimeToContact.trim() || null,
      guardianName: f.guardianName.trim() || null,
      guardianPhone: f.guardianPhone.trim() || null,
      guardianRelationship: f.guardianRelationship.trim() || null,
      specialty: f.specialty,
      ageGroup: f.ageGroup || null,
      preferredLocationIds: f.preferredLocationIds,
      telehealthOk: f.telehealthOk === '' ? null : f.telehealthOk === 'yes',
      availabilityDays: f.availabilityDays,
      availabilityTimes: f.availabilityTimes,
      clinicianGenderPref: f.clinicianGenderPref || null,
      languagePref: f.languagePref.trim() || null,
      urgency: f.urgency,
      payerRegistryId: f.payerRegistryId || null,
      insurancePayer: payer ? payer.name : f.insurancePayer.trim() || null,
      insuranceMemberId: f.insuranceMemberId.trim() || null,
      referralSource: f.referralSource || null,
      referringProvider: f.referringProvider.trim() || null,
      presentingConcern: f.presentingConcern.trim() || null,
      notes: f.notes.trim() || null,
      ...(clinician ? { preferredClinician: clinician.name } : {}),
      ...(f.safetyScreen && f.safetyScreen !== (entry?.safetyScreen ?? '') ? { safetyScreen: f.safetyScreen } : {}),
    };
    setSaving(true);
    try {
      const r = entry ? await updateWaitlistEntry(entry.id, body) : await createWaitlistEntry(body);
      onSaved(r.entry, Boolean(r.crisisGuidance));
    } catch (err) {
      setError(errorMessage(err, 'Could not save'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={isEdit ? `Edit ${entry!.name}` : 'Add to waitlist'}
      subtitle="Waitlist details are PHI. Keep the presenting concern brief."
      onClose={onClose}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saving}>
            {isEdit ? 'Save changes' : 'Add to waitlist'}
          </Button>
        </div>
      }
    >
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <SectionTitle>Safety screen</SectionTitle>
      <fieldset className="rounded-lg border border-slate-200 p-3">
        <legend className="px-1 text-sm font-semibold text-slate-800">{SAFETY_SCREEN_QUESTION}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(
            [
              ['no', 'No'],
              ['yes', 'Yes'],
              ['not_asked', 'Not asked yet'],
            ] as const
          ).map(([v, label]) => (
            <label key={v} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
              <input type="radio" name="safety" checked={f.safetyScreen === v} onChange={() => set('safetyScreen', v)} />
              {label}
            </label>
          ))}
        </div>
        {f.safetyScreen === 'yes' ? <CrisisGuidance className="mt-3" /> : null}
      </fieldset>

      <SectionTitle>Person</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="First name">
          <input className={inputClasses} value={f.firstName} onChange={(e) => set('firstName', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Last name">
          <input className={inputClasses} value={f.lastName} onChange={(e) => set('lastName', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Date of birth">
          <input type="date" className={inputClasses} value={f.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
        </Field>
        <Field label="Age group">
          <select className={inputClasses} value={f.ageGroup} onChange={(e) => set('ageGroup', e.target.value)}>
            <option value="">Not set</option>
            {AGE_GROUPS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <SectionTitle>Contact</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phone">
          <input className={inputClasses} type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email" hint="Needed for the intake link">
          <input className={inputClasses} type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Preferred contact">
          <select className={inputClasses} value={f.preferredContactMethod} onChange={(e) => set('preferredContactMethod', e.target.value)}>
            <option value="">No preference</option>
            {CONTACT_PREFERENCES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Best time to reach">
          <input className={inputClasses} value={f.bestTimeToContact} onChange={(e) => set('bestTimeToContact', e.target.value)} placeholder="e.g. weekdays after 3 PM" />
        </Field>
      </div>

      {minor || f.guardianName ? (
        <>
          <SectionTitle>Parent / guardian</SectionTitle>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <input className={inputClasses} value={f.guardianName} onChange={(e) => set('guardianName', e.target.value)} />
            </Field>
            <Field label="Phone">
              <input className={inputClasses} type="tel" value={f.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} />
            </Field>
            <Field label="Relationship">
              <input className={inputClasses} value={f.guardianRelationship} onChange={(e) => set('guardianRelationship', e.target.value)} placeholder="Mother, legal guardian..." />
            </Field>
          </div>
        </>
      ) : null}

      <SectionTitle>Service and preferences</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Service requested">
          <select className={inputClasses} value={f.specialty} onChange={(e) => set('specialty', e.target.value)}>
            <option value="">Pick a service</option>
            {legacyService ? <option value={f.specialty}>{f.specialty} (as entered)</option> : null}
            {WAITLIST_SERVICES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Urgency" hint={f.safetyScreen === 'yes' ? 'At least Urgent with a positive safety screen' : undefined}>
          <select className={inputClasses} value={f.urgency} onChange={(e) => set('urgency', e.target.value as WaitlistUrgency)}>
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="crisis">Crisis</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Locations they can attend</span>
        <div className="flex flex-wrap gap-2">
          {locations.map((l) => (
            <label key={l.id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
              <input type="checkbox" checked={f.preferredLocationIds.includes(l.id)} onChange={() => set('preferredLocationIds', toggle(f.preferredLocationIds, l.id))} />
              {l.name}
            </label>
          ))}
          {!locations.length ? <span className="text-sm text-slate-500">No clinic sites set up.</span> : null}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Telehealth OK?">
          <select className={inputClasses} value={f.telehealthOk} onChange={(e) => set('telehealthOk', e.target.value as FormState['telehealthOk'])}>
            <option value="">Not asked</option>
            <option value="yes">Yes</option>
            <option value="no">No, in person only</option>
          </select>
        </Field>
        <Field label="Preferred clinician (optional)">
          <select className={inputClasses} value={f.preferredClinicianId} onChange={(e) => set('preferredClinicianId', e.target.value)}>
            <option value="">{entry?.preferredClinician ? `Keep: ${entry.preferredClinician}` : 'No preference'}</option>
            {clinicians.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Available days</span>
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY_DAYS.map(([k, l]) => (
            <label key={k} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
              <input type="checkbox" checked={f.availabilityDays.includes(k)} onChange={() => set('availabilityDays', toggle(f.availabilityDays, k))} />
              {l}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3">
        <span className="mb-1 block text-xs font-semibold text-slate-600">Available times</span>
        <div className="flex flex-wrap gap-2">
          {AVAILABILITY_TIMES.map(([k, l]) => (
            <label key={k} className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm has-[:checked]:border-blue-600 has-[:checked]:bg-blue-50">
              <input type="checkbox" checked={f.availabilityTimes.includes(k)} onChange={() => set('availabilityTimes', toggle(f.availabilityTimes, k))} />
              {l}
            </label>
          ))}
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Clinician gender preference">
          <select className={inputClasses} value={f.clinicianGenderPref} onChange={(e) => set('clinicianGenderPref', e.target.value)}>
            <option value="">No preference</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="nonbinary">Non-binary</option>
          </select>
        </Field>
        <Field label="Language preference">
          <input className={inputClasses} value={f.languagePref} onChange={(e) => set('languagePref', e.target.value)} placeholder="e.g. Spanish" />
        </Field>
      </div>

      <SectionTitle>Insurance and referral</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insurance (payer list)">
          <select className={inputClasses} value={f.payerRegistryId} onChange={(e) => set('payerRegistryId', e.target.value)}>
            <option value="">Not in list / self-pay</option>
            {payers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {!f.payerRegistryId ? (
          <Field label="Insurance (as stated)">
            <input className={inputClasses} value={f.insurancePayer} onChange={(e) => set('insurancePayer', e.target.value)} placeholder="Plan name or Self-pay" />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Member ID">
          <input className={inputClasses} value={f.insuranceMemberId} onChange={(e) => set('insuranceMemberId', e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Referral source">
          <select className={inputClasses} value={f.referralSource} onChange={(e) => set('referralSource', e.target.value)}>
            <option value="">Not set</option>
            {f.referralSource && !REFERRAL_SOURCES.includes(f.referralSource) ? <option value={f.referralSource}>{f.referralSource}</option> : null}
            {REFERRAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Referring provider" className="sm:col-span-2">
          <input className={inputClasses} value={f.referringProvider} onChange={(e) => set('referringProvider', e.target.value)} placeholder="Name and practice" />
        </Field>
      </div>

      <SectionTitle>Reason for seeking care</SectionTitle>
      <Field label="Presenting concern (brief)" hint="One or two lines. Clinical detail belongs in the intake assessment.">
        <textarea className={`${inputClasses} min-h-[64px]`} maxLength={500} value={f.presentingConcern} onChange={(e) => set('presentingConcern', e.target.value)} />
      </Field>
      <div className="mt-3">
        <Field label="Office notes">
          <textarea className={`${inputClasses} min-h-[64px]`} maxLength={2000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}
