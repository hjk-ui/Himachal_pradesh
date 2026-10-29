'use client';

import { useState, useEffect } from 'react';
import { X, User, MapPin, Stethoscope, Shield, Check, Loader2 } from 'lucide-react';
import type { Client, UpdateClientInput, ClientStatus } from '../types';
import { updateClient } from '../api/clientsApi';
import { useAuth } from '@/features/auth';
import { canAssignPatientToClinician } from '@/lib/clients/orgScope';
import toast from 'react-hot-toast';

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
  const [activeTab, setActiveTab] = useState<Tab>('demographics');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [staffDirectory, setStaffDirectory] = useState<Array<{ id: string; name: string; role: string }>>([]);

  const [form, setForm] = useState<UpdateClientInput>({
    name: '',
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
    setError('');
    setActiveTab('demographics');
  }, [client, open]);

  if (!open || !client) return null;

  const set = (key: keyof UpdateClientInput, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name?.trim()) {
      setError('Client name is required');
      setActiveTab('demographics');
      return;
    }

    setError('');
    setSaving(true);

    try {
      const payload: UpdateClientInput = {
        name: form.name.trim(),
        email: form.email?.trim() || null,
        phone: form.phone?.trim() || null,
        dateOfBirth: form.dateOfBirth?.trim() || null,
        gender: form.gender?.trim() || null,
        addressLine1: form.addressLine1?.trim() || null,
        addressLine2: form.addressLine2?.trim() || null,
        city: form.city?.trim() || null,
        state: form.state?.trim() || null,
        postalCode: form.postalCode?.trim() || null,
        emergencyContactName: form.emergencyContactName?.trim() || null,
        emergencyContactPhone: form.emergencyContactPhone?.trim() || null,
        status: form.status,
        riskLevel: form.riskLevel,
        primaryDiagnosis: form.primaryDiagnosis?.trim() || null,
        primaryDiagnosisCode: form.primaryDiagnosisCode?.trim() || null,
        secondaryDiagnoses: form.secondaryDiagnoses?.trim() || null,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl bg-white shadow-2xl border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4.5 bg-slate-50/70">
          <div>
            <h2 className="text-lg font-black text-slate-900 flex items-center gap-2">
              Edit Client Profile
            </h2>
            <p className="text-xs text-slate-500">
              Update demographics, clinical record, and billing information for{' '}
              <span className="font-bold text-purple-900">{client.name}</span>{' '}
              {client.mrn ? <span className="font-mono text-[11px] text-slate-400">({client.mrn})</span> : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-100 px-6 bg-white gap-2 pt-2">
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
                className={`flex items-center gap-1.5 pb-2.5 px-3 text-xs font-bold transition border-b-2 ${
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
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error ? (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs font-semibold text-rose-700">
              {error}
            </div>
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
                <div>
                  <label className={labelClass}>Phone Number</label>
                  <input
                    type="tel"
                    value={form.phone || ''}
                    onChange={(e) => set('phone', e.target.value)}
                    placeholder="(410) 555-0199"
                    className={fieldClass}
                  />
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
                <div>
                  <label className={labelClass}>Gender</label>
                  <select
                    value={form.gender || ''}
                    onChange={(e) => set('gender', e.target.value)}
                    className={fieldClass}
                  >
                    <option value="">Select gender</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                    <option value="Non-Binary">Non-Binary</option>
                    <option value="Transgender Female">Transgender Female</option>
                    <option value="Transgender Male">Transgender Male</option>
                    <option value="Other">Other</option>
                    <option value="Decline to specify">Decline to specify</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: Address & Emergency */}
          {activeTab === 'address' && (
            <div className="space-y-4">
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
                <div>
                  <label className={labelClass}>State</label>
                  <input
                    type="text"
                    value={form.state || ''}
                    onChange={(e) => set('state', e.target.value)}
                    placeholder="MD"
                    className={fieldClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Postal Code</label>
                  <input
                    type="text"
                    value={form.postalCode || ''}
                    onChange={(e) => set('postalCode', e.target.value)}
                    placeholder="21202"
                    className={fieldClass}
                  />
                </div>
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
                <div>
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
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">Assigned Primary Clinician</label>
                  {!canReassign && (
                    <span className="text-[10px] text-slate-400 font-medium">(Only Leadership / Front Desk can reassign)</span>
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
                  <input
                    type="text"
                    value={form.primaryDiagnosisCode || ''}
                    onChange={(e) => set('primaryDiagnosisCode', e.target.value)}
                    placeholder="F33.1"
                    className={fieldClass}
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
          <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-6">
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl px-5 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-95 disabled:opacity-50"
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
