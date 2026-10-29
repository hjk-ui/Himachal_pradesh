'use client';

import { useState, useEffect } from 'react';
import { X, User, MapPin, Stethoscope, Shield, Check, Loader2 } from 'lucide-react';
import type { Client, UpdateClientInput, ClientStatus } from '../types';
import { updateClient } from '../api/clientsApi';
import { useAuth } from '@/features/auth';
import { canAssignPatientToClinician, canEditClientDiagnoses, canEditClientRiskLevel } from '@/lib/clients/orgScope';
import toast from 'react-hot-toast';
import { Icd10CodeInput } from '@/components/clinical/Icd10Picker';
import {
  ADDRESS_STATUS,
  ADMINISTRATIVE_SEX,
  ETHNICITY,
  GENDER_IDENTITY,
  LANGUAGES,
  MARITAL_STATUS,
  PHONE_TYPES,
  PRONOUNS,
  RELATIONSHIPS,
  SEX_AT_BIRTH,
  SEXUAL_ORIENTATION,
  isValidMedicaidId,
  normalizeStateCode,
  normalizeUsPhone,
  normalizeUsZip,
  type StructuredDemographics,
} from '@/lib/clients/demographics';
import { CodeSelect, DemographicsGapNotice, RaceCheckboxes, StateSelect } from './DemographicsInputs';

/** Structured fields sent only when changed here (a client loaded from a list may not carry them) */
const STRUCTURED_KEYS = [
  'legalMiddleName', 'administrativeSex', 'sexAtBirth', 'genderIdentity', 'sexualOrientation', 'pronouns',
  'ethnicity', 'preferredLanguage', 'maritalStatus', 'county', 'phoneType', 'phoneSecondaryType',
  'emergencyContactRelationship', 'guardianName', 'guardianRelationship', 'guardianPhone',
  'guarantorFirstName', 'guarantorLastName', 'guarantorRelationship', 'guarantorDateOfBirth', 'guarantorPhone',
  'guarantorAddressLine1', 'guarantorAddressLine2', 'guarantorCity', 'guarantorState', 'guarantorPostalCode',
  'medicaidId', 'deceasedAt', 'phoneSecondary', 'addressStatus',
] as const;
type StructuredKey = (typeof STRUCTURED_KEYS)[number];

function structuredFrom(client: Client): Record<StructuredKey, string> & { race: string[]; interpreterNeeded: '' | 'yes' | 'no' } {
  const out = Object.fromEntries(STRUCTURED_KEYS.map((k) => [k, ((client as StructuredDemographics & { phoneSecondary?: string | null })[k] as string | null | undefined) || ''])) as Record<StructuredKey, string>;
  return {
    ...out,
    race: client.race ?? [],
    interpreterNeeded: client.interpreterNeeded == null ? '' : client.interpreterNeeded ? 'yes' : 'no',
  };
}

type Props = {
  open: boolean;
  client: Client | null;
  onClose: () => void;
  onUpdated?: (client: Partial<Client>) => void;
};

type Tab = 'demographics' | 'address' | 'clinical' | 'insurance';

const fieldClass = 'clinic-input w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-purple-600 focus:ring-1 focus:ring-purple-600 transition';
const labelClass = 'mb-1 block text-xs font-bold text-slate-700';

export function EditClientModal({ open, client, onClose, onUpdated }: Props) {
  const { user } = useAuth();
  const canReassign = canAssignPatientToClinician(user?.role);
  // Diagnoses / risk level: licensed BH clinicians and leadership (the API drops them for other roles)
  const canEditDx = canEditClientDiagnoses(user?.role);
  const canEditRisk = canEditClientRiskLevel(user?.role);
  const [activeTab, setActiveTab] = useState<Tab>('demographics');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [staffDirectory, setStaffDirectory] = useState<Array<{ id: string; name: string; role: string }>>([]);
  const [demo, setDemo] = useState<ReturnType<typeof structuredFrom> | null>(null);

  const [form, setForm] = useState<UpdateClientInput>({
    name: '',
    legalFirstName: '',
    middleInitial: '',
    legalLastName: '',
    preferredName: '',
    nameSuffix: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    gender: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    postalCode: '',
    emergencyContactName: '',
    emergencyContactPhone: '',
    status: 'ACTIVE',
    riskLevel: 'LOW',
    primaryDiagnosis: '',
    primaryDiagnosisCode: '',
    secondaryDiagnoses: '',
    assignedToId: '',
    insurancePayer: '',
    insuranceMemberId: '',
    insuranceGroupNumber: '',
  });

  // Load staff directory for clinician dropdown
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
        console.error('Failed to load staff directory in edit modal:', err);
      }
    }
    void loadDirectory();
  }, [open]);

  // Pre-fill form when client changes or modal opens
  useEffect(() => {
    if (!client || !open) return;
    let dobStr = '';
    if (client.dateOfBirth) {
      try {
        dobStr = new Date(client.dateOfBirth).toISOString().slice(0, 10);
      } catch {
        dobStr = String(client.dateOfBirth).slice(0, 10);
      }
    }

    setForm({
      name: client.name || '',
      legalFirstName: client.legalFirstName || '',
      middleInitial: client.middleInitial || '',
      legalLastName: client.legalLastName || '',
      preferredName: client.preferredName || '',
      nameSuffix: client.nameSuffix || '',
      email: client.email || '',
      phone: client.phone || '',
      dateOfBirth: dobStr,
      gender: client.gender || '',
      addressLine1: client.addressLine1 || '',
      addressLine2: (client as any).addressLine2 || '',
      city: client.city || '',
      state: client.state || '',
      postalCode: client.postalCode || '',
      emergencyContactName: client.emergencyContactName || '',
      emergencyContactPhone: client.emergencyContactPhone || '',
      status: (client.status as ClientStatus) || 'ACTIVE',
      riskLevel: (client.risk ? String(client.risk).toUpperCase() : 'LOW'),
      primaryDiagnosis: client.primaryDiagnosis || '',
      primaryDiagnosisCode: client.primaryDiagnosisCode || '',
      secondaryDiagnoses: client.secondaryDiagnoses || '',
      assignedToId: client.assignedToId || '',
      insurancePayer: client.insurancePayer || '',
      insuranceMemberId: client.insuranceMemberId || '',
      insuranceGroupNumber: client.insuranceGroupNumber || '',
    });
    setDemo(structuredFrom(client));
    setError('');
    setActiveTab('demographics');
  }, [client, open]);

  if (!open || !client || !demo) return null;

  const set = (key: keyof UpdateClientInput, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };
  const setD = <K extends keyof NonNullable<typeof demo>>(key: K, value: NonNullable<typeof demo>[K]) => {
    setDemo((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  // Live readiness for e-prescribing / claims from what is on screen
  const readinessInput = {
    ...form,
    needsNameReview: client.needsNameReview && !(form.legalFirstName?.trim() && form.legalLastName?.trim()
      && (form.legalFirstName !== client.legalFirstName || form.legalLastName !== client.legalLastName)),
    administrativeSex: demo.administrativeSex || null,
    gender: demo.administrativeSex ? null : client.gender,
    insuranceType: client.insuranceType,
    medicaidId: demo.medicaidId,
    addressStatus: demo.addressStatus || null,
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) {
      setError('Client name is required');
      setActiveTab('demographics');
      return;
    }
    // Standard formats: same rules the API enforces (src/lib/clients/demographics.ts)
    const formatError = (() => {
      const phoneOk = (v?: string | null) => !v?.trim() || normalizeUsPhone(v) !== null;
      if (!phoneOk(form.phone)) return ['demographics', 'Phone must be a valid 10-digit US number'] as const;
      if (!phoneOk(demo.phoneSecondary)) return ['address', 'Secondary phone must be a valid 10-digit US number'] as const;
      if (form.state?.trim() && !normalizeStateCode(form.state)) return ['address', 'State must be a 2-letter US state code'] as const;
      if (form.postalCode?.trim() && !normalizeUsZip(form.postalCode)) return ['address', 'ZIP must be 5 digits or ZIP+4 (12345-6789)'] as const;
      if (!phoneOk(form.emergencyContactPhone)) return ['address', 'Emergency contact phone must be a valid 10-digit US number'] as const;
      if (!phoneOk(demo.guardianPhone) || !phoneOk(demo.guarantorPhone)) return ['address', 'Guardian / guarantor phone must be a valid 10-digit US number'] as const;
      if (demo.guarantorPostalCode.trim() && !normalizeUsZip(demo.guarantorPostalCode)) return ['address', 'Guarantor ZIP must be 5 digits or ZIP+4'] as const;
      if (demo.medicaidId.trim() && !isValidMedicaidId(demo.medicaidId)) return ['insurance', 'Maryland Medicaid (MA) number must be 11 digits'] as const;
      return null;
    })();
    if (formatError) {
      setError(formatError[1]);
      setActiveTab(formatError[0]);
      return;
    }
    const initial = structuredFrom(client);
    const structuredChanges: Record<string, unknown> = Object.fromEntries(
      STRUCTURED_KEYS.filter((k) => demo[k].trim() !== initial[k].trim()).map((k) => [k, demo[k].trim() || null])
    );
    if (demo.race.join('|') !== initial.race.join('|')) structuredChanges.race = demo.race;
    if (demo.interpreterNeeded !== initial.interpreterNeeded) {
      structuredChanges.interpreterNeeded = demo.interpreterNeeded === '' ? null : demo.interpreterNeeded === 'yes';
    }

    setError('');
    setSaving(true);

    try {
      const payload: UpdateClientInput = {
        name: form.name.trim(),
        // Only name parts that were changed here (a client loaded from a list may not carry them)
        ...Object.fromEntries(
          (['legalFirstName', 'middleInitial', 'legalLastName', 'preferredName', 'nameSuffix'] as const)
            .filter((k) => (form[k] || '').trim() !== ((client[k] as string | null | undefined) || '').trim())
            .map((k) => [k, (form[k] || '').trim() || null])
        ),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        dateOfBirth: form.dateOfBirth?.trim() || null,
        // Legacy Client.gender follows the structured Sex on the server; it is not edited here
        ...structuredChanges,
        addressLine1: form.addressLine1?.trim() || null,
        addressLine2: form.addressLine2?.trim() || null,
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        postalCode: form.postalCode?.trim() || null,
        emergencyContactName: form.emergencyContactName?.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone?.trim() || null,
        status: form.status,
        ...(canEditRisk ? { riskLevel: form.riskLevel } : {}),
        ...(canEditDx
          ? {
              primaryDiagnosis: form.primaryDiagnosis?.trim() || null,
              primaryDiagnosisCode: form.primaryDiagnosisCode?.trim() || null,
              secondaryDiagnoses: form.secondaryDiagnoses?.trim() || null,
            }
          : {}),
        ...(canReassign ? { assignedToId: form.assignedToId?.trim() || null } : {}),
        insurancePayer: form.insurancePayer?.trim() || null,
        insuranceMemberId: form.insuranceMemberId?.trim() || null,
        insuranceGroupNumber: form.insuranceGroupNumber?.trim() || null,
      };

      const updated = (await updateClient(client.id, payload)) as any;
      if (updated?.portalSyncNotice?.message) {
        toast.success(updated.portalSyncNotice.message);
      } else {
        toast.success('Client profile updated successfully');
      }
      if (onUpdated) {
        onUpdated(updated);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to update client');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-xs sm:items-center sm:p-4">
      <div className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-slate-100 bg-white shadow-2xl sm:max-h-[90dvh] sm:rounded-xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              Edit Client Profile
            </h2>
            <p className="break-words text-xs text-slate-500">
              Update demographics, clinical record, and billing information for{' '}
              <span className="font-bold text-purple-900">{client.name}</span>{' '}
              {client.mrn ? <span className="font-mono text-[11px] text-slate-400">({client.mrn})</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close edit client"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-200 hover:text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5C2D91]"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-100 bg-white px-4 pt-2 [scrollbar-width:thin] sm:px-6">
          {[
            { id: 'demographics', label: 'Demographics', icon: User },
            { id: 'address', label: 'Address & Contact', icon: MapPin },
            { id: 'clinical', label: 'Clinical & Care', icon: Stethoscope },
            { id: 'insurance', label: 'Insurance & Billing', icon: Shield },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id as Tab)}
                className={`flex min-h-10 shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 text-xs font-bold transition ${
                  isActive
                    ? 'border-purple-600 text-purple-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6">
          {error ? (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-700">
              {error}
            </div>
          ) : null}
          <DemographicsGapNotice input={readinessInput} />
          {client.needsNameReview ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Legal name needs review{client.nameReviewReason ? `: ${client.nameReviewReason}` : ''}. Confirm the legal first and last name below and save.
            </p>
          ) : null}

          {/* TAB 1: Demographics */}
          {activeTab === 'demographics' && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={form.name || ''}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Eleanor Vance"
                  className={fieldClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-6 gap-4">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Legal first name</label>
                  <input type="text" value={form.legalFirstName || ''} onChange={(e) => set('legalFirstName', e.target.value)} maxLength={80} className={fieldClass} />
                </div>
                <div className="sm:col-span-1">
                  <label className={labelClass}>M.I.</label>
                  <input type="text" value={form.middleInitial || ''} onChange={(e) => set('middleInitial', e.target.value)} maxLength={2} className={fieldClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>Legal last name</label>
                  <input type="text" value={form.legalLastName || ''} onChange={(e) => set('legalLastName', e.target.value)} maxLength={80} className={fieldClass} />
                </div>
                <div className="sm:col-span-1">
                  <label className={labelClass}>Suffix</label>
                  <input type="text" value={form.nameSuffix || ''} onChange={(e) => set('nameSuffix', e.target.value)} maxLength={20} placeholder="Jr." className={fieldClass} />
                </div>
                <div className="sm:col-span-3">
                  <label className={labelClass}>Preferred name</label>
                  <input type="text" value={form.preferredName || ''} onChange={(e) => set('preferredName', e.target.value)} maxLength={80} className={fieldClass} />
                </div>
                <p className="sm:col-span-3 self-end text-[11px] text-slate-500">
                  Treatment plans print the name as Preferred [First] M. Last, Suffix (MRN).
                </p>
                <div className="sm:col-span-3">
                  <label className={labelClass}>Legal middle name</label>
                  <input type="text" value={demo.legalMiddleName} onChange={(e) => setD('legalMiddleName', e.target.value)} maxLength={80} placeholder="Full middle name, if any" className={fieldClass} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Email Address</label>
                  <input
                    type="email"
                    value={form.email || ''}
                    onChange={(e) => set('email', e.target.value)}
                    placeholder="client@example.com"
                    className={fieldClass}
                  />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className={labelClass}>Phone Number</label>
                    <input
                      type="tel"
                      value={form.phone || ''}
                      onChange={(e) => set('phone', e.target.value)}
                      placeholder="(410) 555-0199"
                      className={fieldClass}
                    />
                  </div>
                  <CodeSelect id="edit-phone-type" label="Type" value={demo.phoneType} onChange={(v) => setD('phoneType', v)} options={PHONE_TYPES} placeholder="—" className={fieldClass} labelClassName={labelClass} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Date of Birth</label>
                  <input
                    type="date"
                    value={form.dateOfBirth || ''}
                    onChange={(e) => set('dateOfBirth', e.target.value)}
                    className={fieldClass}
                  />
                </div>
                <CodeSelect
                  id="edit-admin-sex"
                  label="Sex (as on insurance card / ID)"
                  value={demo.administrativeSex}
                  onChange={(v) => setD('administrativeSex', v)}
                  options={ADMINISTRATIVE_SEX}
                  className={fieldClass}
                  labelClassName={labelClass}
                  hint={!demo.administrativeSex && client.gender ? `Previously recorded gender: "${client.gender}". Set Sex for claims and e-prescribing.` : 'Sent on claims (X12 DMG) and to DrFirst.'}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                <CodeSelect id="edit-sex-birth" label="Sex assigned at birth" value={demo.sexAtBirth} onChange={(v) => setD('sexAtBirth', v)} options={SEX_AT_BIRTH} className={fieldClass} labelClassName={labelClass} />
                <CodeSelect id="edit-gender-identity" label="Gender identity" value={demo.genderIdentity} onChange={(v) => setD('genderIdentity', v)} options={GENDER_IDENTITY} className={fieldClass} labelClassName={labelClass} />
                <CodeSelect id="edit-pronouns" label="Pronouns" value={demo.pronouns} onChange={(v) => setD('pronouns', v)} options={PRONOUNS} className={fieldClass} labelClassName={labelClass} />
                <CodeSelect id="edit-orientation" label="Sexual orientation" value={demo.sexualOrientation} onChange={(v) => setD('sexualOrientation', v)} options={SEXUAL_ORIENTATION} className={fieldClass} labelClassName={labelClass} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100 pt-3">
                <RaceCheckboxes value={demo.race} onChange={(codes) => setD('race', codes)} labelClassName={labelClass} />
                <div className="space-y-3">
                  <CodeSelect id="edit-ethnicity" label="Ethnicity" value={demo.ethnicity} onChange={(v) => setD('ethnicity', v)} options={ETHNICITY} className={fieldClass} labelClassName={labelClass} />
                  <CodeSelect id="edit-marital" label="Marital status" value={demo.maritalStatus} onChange={(v) => setD('maritalStatus', v)} options={MARITAL_STATUS} className={fieldClass} labelClassName={labelClass} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 pt-3">
                <CodeSelect id="edit-language" label="Preferred language" value={demo.preferredLanguage} onChange={(v) => setD('preferredLanguage', v)} options={LANGUAGES} className={fieldClass} labelClassName={labelClass} />
                <div>
                  <label htmlFor="edit-interpreter" className={labelClass}>Interpreter needed</label>
                  <select id="edit-interpreter" value={demo.interpreterNeeded} onChange={(e) => setD('interpreterNeeded', e.target.value as '' | 'yes' | 'no')} className={fieldClass}>
                    <option value="">Not recorded</option>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="edit-deceased" className={labelClass}>Date of death</label>
                  <input id="edit-deceased" type="date" value={demo.deceasedAt} onChange={(e) => setD('deceasedAt', e.target.value)} className={fieldClass} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Address & Emergency */}
          {activeTab === 'address' && (
            <div className="space-y-4">
              <CodeSelect
                id="edit-address-status"
                label="No street address?"
                value={demo.addressStatus}
                onChange={(v) => setD('addressStatus', v)}
                options={ADDRESS_STATUS}
                placeholder="Address on file"
                className={fieldClass}
                labelClassName={labelClass}
                hint="For e-prescribing, a client with no fixed address is sent as HOMELESS / UNKNOWN with the clinic's city, state and ZIP."
              />
              <div>
                <label className={labelClass}>Street Address</label>
                <input
                  type="text"
                  value={form.addressLine1 || ''}
                  onChange={(e) => set('addressLine1', e.target.value)}
                  placeholder="1234 N Calvert St"
                  className={fieldClass}
                />
              </div>

              <div>
                <label className={labelClass}>Apt / Suite / Unit</label>
                <input
                  type="text"
                  value={form.addressLine2 || ''}
                  onChange={(e) => set('addressLine2', e.target.value)}
                  placeholder="Apt 4B"
                  className={fieldClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>City</label>
                  <input
                    type="text"
                    value={form.city || ''}
                    onChange={(e) => set('city', e.target.value)}
                    placeholder="Baltimore"
                    className={fieldClass}
                  />
                </div>
                <StateSelect id="edit-state" label="State" value={form.state} onChange={(v) => set('state', v)} className={fieldClass} labelClassName={labelClass} />
                <div>
                  <label className={labelClass}>Postal Code</label>
                  <input
                    type="text"
                    value={form.postalCode || ''}
                    onChange={(e) => set('postalCode', e.target.value)}
                    placeholder="21202 or 21202-1234"
                    className={fieldClass}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className={labelClass}>County</label>
                  <input type="text" value={demo.county} onChange={(e) => setD('county', e.target.value)} placeholder="e.g. Prince George's" className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>Secondary phone</label>
                  <input type="tel" value={demo.phoneSecondary} onChange={(e) => setD('phoneSecondary', e.target.value)} placeholder="(301) 555-0142" className={fieldClass} />
                </div>
                <CodeSelect id="edit-phone2-type" label="Secondary phone type" value={demo.phoneSecondaryType} onChange={(v) => setD('phoneSecondaryType', v)} options={PHONE_TYPES} placeholder="—" className={fieldClass} labelClassName={labelClass} />
              </div>

              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">Emergency Contact</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={labelClass}>Emergency Contact Name</label>
                    <input
                      type="text"
                      value={form.emergencyContactName || ''}
                      onChange={(e) => set('emergencyContactName', e.target.value)}
                      placeholder="e.g. John Doe (Spouse)"
                      className={fieldClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Emergency Contact Phone</label>
                    <input
                      type="tel"
                      value={form.emergencyContactPhone || ''}
                      onChange={(e) => set('emergencyContactPhone', e.target.value)}
                      placeholder="(410) 555-0188"
                      className={fieldClass}
                    />
                  </div>
                  <CodeSelect id="edit-ec-rel" label="Relationship" value={demo.emergencyContactRelationship} onChange={(v) => setD('emergencyContactRelationship', v)} options={RELATIONSHIPS} className={fieldClass} labelClassName={labelClass} />
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-2">Legal guardian / personal representative</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>Guardian name</label>
                    <input type="text" value={demo.guardianName} onChange={(e) => setD('guardianName', e.target.value)} className={fieldClass} />
                  </div>
                  <CodeSelect id="edit-guardian-rel" label="Relationship" value={demo.guardianRelationship} onChange={(v) => setD('guardianRelationship', v)} options={RELATIONSHIPS} className={fieldClass} labelClassName={labelClass} />
                  <div>
                    <label className={labelClass}>Guardian phone</label>
                    <input type="tel" value={demo.guardianPhone} onChange={(e) => setD('guardianPhone', e.target.value)} className={fieldClass} />
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-3">
                <h4 className="text-xs font-black uppercase tracking-wider text-slate-500 mb-1">Guarantor (responsible party)</h4>
                <p className="mb-2 text-[11px] text-slate-500">Leave blank when the client is responsible for their own balance.</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className={labelClass}>First name</label>
                    <input type="text" value={demo.guarantorFirstName} onChange={(e) => setD('guarantorFirstName', e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Last name</label>
                    <input type="text" value={demo.guarantorLastName} onChange={(e) => setD('guarantorLastName', e.target.value)} className={fieldClass} />
                  </div>
                  <CodeSelect id="edit-guarantor-rel" label="Relationship to client" value={demo.guarantorRelationship} onChange={(v) => setD('guarantorRelationship', v)} options={RELATIONSHIPS} className={fieldClass} labelClassName={labelClass} />
                  <div>
                    <label className={labelClass}>Date of birth</label>
                    <input type="date" value={demo.guarantorDateOfBirth} onChange={(e) => setD('guarantorDateOfBirth', e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Phone</label>
                    <input type="tel" value={demo.guarantorPhone} onChange={(e) => setD('guarantorPhone', e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Street address</label>
                    <input type="text" value={demo.guarantorAddressLine1} onChange={(e) => setD('guarantorAddressLine1', e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Apt / Suite</label>
                    <input type="text" value={demo.guarantorAddressLine2} onChange={(e) => setD('guarantorAddressLine2', e.target.value)} className={fieldClass} />
                  </div>
                  <div>
                    <label className={labelClass}>City</label>
                    <input type="text" value={demo.guarantorCity} onChange={(e) => setD('guarantorCity', e.target.value)} className={fieldClass} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <StateSelect id="edit-guarantor-state" label="State" value={demo.guarantorState} onChange={(v) => setD('guarantorState', v)} className={fieldClass} labelClassName={labelClass} />
                    <div>
                      <label className={labelClass}>ZIP</label>
                      <input type="text" value={demo.guarantorPostalCode} onChange={(e) => setD('guarantorPostalCode', e.target.value)} className={fieldClass} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: Clinical & Care */}
          {activeTab === 'clinical' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Client Status</label>
                  <select
                    value={form.status || 'ACTIVE'}
                    onChange={(e) => set('status', e.target.value as ClientStatus)}
                    className={fieldClass}
                  >
                    <option value="ACTIVE">ACTIVE — In active treatment</option>
                    <option value="INACTIVE">INACTIVE — On hold / dormant</option>
                    <option value="DISCHARGED">DISCHARGED — Completed / transferred</option>
                  </select>
                </div>
                {canEditRisk && <div>
                  <label className={labelClass}>Clinical Risk Level</label>
                  <select
                    value={String(form.riskLevel || 'LOW').toUpperCase()}
                    onChange={(e) => set('riskLevel', e.target.value)}
                    className={fieldClass}
                  >
                    <option value="LOW">LOW — Routine outpatient</option>
                    <option value="MEDIUM">MEDIUM — Moderate symptoms / watchful</option>
                    <option value="HIGH">HIGH — Critical / high risk / safety protocol</option>
                  </select>
                </div>}
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">Assigned Primary Clinician</label>
                  {!canReassign && (
                    <span className="text-[11px] text-slate-500 font-medium">(Only Leadership / Front Desk can reassign)</span>
                  )}
                </div>
                <select
                  disabled={!canReassign}
                  value={form.assignedToId || ''}
                  onChange={(e) => set('assignedToId', e.target.value)}
                  className={`${fieldClass} ${!canReassign ? 'bg-slate-100 cursor-not-allowed opacity-80' : ''}`}
                >
                  <option value="">Unassigned (Waitlist / Pool)</option>
                  {staffDirectory.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.role})
                    </option>
                  ))}
                </select>
              </div>

              {canEditDx && (<>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className={labelClass}>Primary Diagnosis</label>
                  <input
                    type="text"
                    value={form.primaryDiagnosis || ''}
                    onChange={(e) => set('primaryDiagnosis', e.target.value)}
                    placeholder="e.g. Major Depressive Disorder, Recurrent"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>ICD-10 Code</label>
                  <Icd10CodeInput
                    value={form.primaryDiagnosisCode || ''}
                    onChange={(c, picked) => {
                      set('primaryDiagnosisCode', c);
                      if (picked && !form.primaryDiagnosis?.trim()) set('primaryDiagnosis', picked.description);
                    }}
                    context="bh"
                    placeholder="F33.1 or words"
                    ariaLabel="ICD-10 code"
                    inputClassName={`${fieldClass} pl-7`}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Secondary Diagnoses / Comorbidities</label>
                <input
                  type="text"
                  value={form.secondaryDiagnoses || ''}
                  onChange={(e) => set('secondaryDiagnoses', e.target.value)}
                  placeholder="e.g. Generalized Anxiety Disorder (F41.1), Insomnia (G47.00)"
                  className={fieldClass}
                />
              </div>
              </>)}
            </div>
          )}

          {/* TAB 4: Insurance & Billing */}
          {activeTab === 'insurance' && (
            <div className="space-y-4">
              <div>
                <label className={labelClass}>Insurance Payer</label>
                <input
                  type="text"
                  value={form.insurancePayer || ''}
                  onChange={(e) => set('insurancePayer', e.target.value)}
                  placeholder="e.g. Maryland Medicaid, CareFirst BlueCross, Aetna"
                  className={fieldClass}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Member ID</label>
                  <input
                    type="text"
                    value={form.insuranceMemberId || ''}
                    onChange={(e) => set('insuranceMemberId', e.target.value)}
                    placeholder="e.g. MDM123456789"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Maryland Medicaid (MA) number</label>
                  <input type="text" inputMode="numeric" value={demo.medicaidId} onChange={(e) => setD('medicaidId', e.target.value)} maxLength={11} placeholder="11 digits" className={fieldClass} />
                </div>
                <div>
                  <label className={labelClass}>Group Number</label>
                  <input
                    type="text"
                    value={form.insuranceGroupNumber || ''}
                    onChange={(e) => set('insuranceGroupNumber', e.target.value)}
                    placeholder="e.g. GRP-98214"
                    className={fieldClass}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Modal Actions */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="min-h-10 rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #5C2D91, #7C3AED)' }}
              >
                {saving ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Saving Changes…
                  </>
                ) : (
                  <>
                    <Check size={14} /> Save Client Changes
                  </>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
