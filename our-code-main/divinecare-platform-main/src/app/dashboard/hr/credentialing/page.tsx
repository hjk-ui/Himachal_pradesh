'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Plus,
  ShieldCheck,
  CheckSquare,
  Square,
  Building2,
  Users,
} from 'lucide-react';
import {
  createStaffCredential,
  fetchStaffCredentials,
  renewStaffCredential,
  updateStaffCredential,
  uploadCredentialDocument,
  type CredentialStaffOption,
  type DerivedCredentialStatus,
  type StaffCredentialRecord,
  type StaffCredentialType,
} from '@/features/hr/credentialsApi';

const PURPLE = '#6D28D9';

// ─── Payer Enrollment Intake Models ───────────────────────────────────────────
type EnrollmentStatus = 'active' | 'in_process' | 'submitted' | 'not_started';

const ENROLLMENT_PROVIDERS = [
  { id: 'prov-jackson', name: 'Dr. Renee Jackson, MD', role: 'Psychiatrist', npi: '1043829101', specialty: 'Adult & Addiction Psychiatry' },
  { id: 'prov-edwards', name: 'Marcus Edwards, LCSW-C', role: 'Lead Therapist', npi: '1982736450', specialty: 'Trauma & SUD Therapy' },
  { id: 'prov-patel', name: 'Dr. Anita Patel, PMHNP', role: 'Psych Nurse Practitioner', npi: '1472839102', specialty: 'Medication Management & SBIRT' },
  { id: 'prov-torres', name: 'Jasmine Torres, LMSW', role: 'Associate Clinician', npi: '1829304192', specialty: 'PRP & Outpatient Counseling' },
];

const ENROLLMENT_PAYERS = [
  'Optum MD Medicaid BH',
  'Medicare Novitas',
  'CareFirst BCBS',
  'Aetna BH',
  'UHC/Optum',
  'Cigna',
];

const ONBOARDING_DOCS_10 = [
  'CAQH Profile Completed & Attested',
  'State Medical / Clinical License Copy',
  'DEA Certificate (if prescribing)',
  'State Controlled Substances (CDS) Permit',
  'Malpractice Insurance Certificate (COI)',
  'W-9 Form (DivineCare / MD Behavioral Health)',
  'Board Certification / Degree Transcripts',
  'NPI Confirmation Letter (Type 1)',
  'Current Curriculum Vitae (CV — dated within 30 days)',
  'Government ID / Driver’s License Copy',
];

const ENROLLMENT_STATUS_META: Record<EnrollmentStatus, { label: string; color: string; bg: string }> = {
  active: { label: 'Active', color: '#15803d', bg: '#dcfce7' },
  in_process: { label: 'In Process', color: '#b45309', bg: '#fef3c7' },
  submitted: { label: 'Submitted', color: '#1d4ed8', bg: '#dbeafe' },
  not_started: { label: 'Not Started', color: '#64748b', bg: '#f1f5f9' },
};

const TYPE_LABELS: Record<StaffCredentialType, string> = {
  LICENSE: 'License',
  CEU: 'CEU',
  MALPRACTICE: 'Malpractice Ins.',
  DEA: 'DEA',
  CERTIFICATION: 'Certification',
  BACKGROUND_CHECK: 'Background',
  SUPERVISION: 'Supervision',
};

const TYPE_COLORS: Record<StaffCredentialType, string> = {
  LICENSE: '#6D28D9',
  CEU: '#2563eb',
  MALPRACTICE: '#ea580c',
  DEA: '#0f766e',
  CERTIFICATION: '#6D28D9',
  BACKGROUND_CHECK: '#4b5563',
  SUPERVISION: '#7c3aed',
};

const STATUS_CONFIG: Record<
  DerivedCredentialStatus,
  { label: string; color: string; bg: string; icon: React.ReactNode }
> = {
  active: { label: 'Active', color: '#15803d', bg: '#dcfce7', icon: <CheckCircle2 size={12} /> },
  expiring_soon: {
    label: 'Expiring Soon',
    color: '#c2410c',
    bg: '#ffedd5',
    icon: <Clock size={12} />,
  },
  expired: { label: 'Expired', color: '#dc2626', bg: '#fee2e2', icon: <AlertTriangle size={12} /> },
};

const STAFF_ORDER = ['Dr. Renee Jackson', 'Marcus Edwards', 'Dr. Anita Patel', 'Jasmine Torres'];

const EMPTY_FORM = {
  userId: '',
  credentialType: 'LICENSE' as StaffCredentialType,
  title: '',
  issuer: '',
  licenseNumber: '',
  issuedAt: '',
  expiresAt: '',
  ceuRequired: 0,
  ceuCompleted: 0,
};

const FILTER_PILLS: { id: 'all' | DerivedCredentialStatus; label: string }[] = [
  { id: 'all', label: 'All Statuses' },
  { id: 'active', label: 'Active' },
  { id: 'expiring_soon', label: 'Expiring Soon' },
  { id: 'expired', label: 'Expired' },
];

function expiryCopy(cred: StaffCredentialRecord) {
  if (cred.derivedStatus === 'expired') {
    return `Expired ${Math.abs(cred.daysUntilExpiry)} days ago`;
  }
  return `Expires in ${cred.daysUntilExpiry} day${cred.daysUntilExpiry === 1 ? '' : 's'}`;
}

function defaultRenewDate(cred: StaffCredentialRecord) {
  const base =
    cred.daysUntilExpiry >= 0 ? new Date(`${cred.expiresAt}T12:00:00`) : new Date();
  base.setFullYear(base.getFullYear() + 1);
  return base.toISOString().slice(0, 10);
}

function fieldClass() {
  return 'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-300';
}

export default function CredentialingPage() {
  const [credentials, setCredentials] = useState<StaffCredentialRecord[]>([]);
  const [staff, setStaff] = useState<CredentialStaffOption[]>([]);
  const [schemaReady, setSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStaff, setFilterStaff] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | DerivedCredentialStatus>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<StaffCredentialRecord | null>(null);
  const [renewing, setRenewing] = useState<StaffCredentialRecord | null>(null);
  const [renewDate, setRenewDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);

  // ─── Payer Enrollment Intake State ─────────────────────────────────────────
  const [mainTab, setMainTab] = useState<'credentials' | 'payer_intake'>('credentials');
  const [enrollmentMatrix, setEnrollmentMatrix] = useState<Record<string, Record<string, EnrollmentStatus>>>({
    'prov-jackson': {
      'Optum MD Medicaid BH': 'active',
      'Medicare Novitas': 'active',
      'CareFirst BCBS': 'active',
      'Aetna BH': 'active',
      'UHC/Optum': 'active',
      'Cigna': 'active',
    },
    'prov-edwards': {
      'Optum MD Medicaid BH': 'active',
      'Medicare Novitas': 'in_process',
      'CareFirst BCBS': 'active',
      'Aetna BH': 'active',
      'UHC/Optum': 'in_process',
      'Cigna': 'submitted',
    },
    'prov-patel': {
      'Optum MD Medicaid BH': 'active',
      'Medicare Novitas': 'submitted',
      'CareFirst BCBS': 'in_process',
      'Aetna BH': 'in_process',
      'UHC/Optum': 'submitted',
      'Cigna': 'not_started',
    },
    'prov-torres': {
      'Optum MD Medicaid BH': 'in_process',
      'Medicare Novitas': 'not_started',
      'CareFirst BCBS': 'submitted',
      'Aetna BH': 'not_started',
      'UHC/Optum': 'in_process',
      'Cigna': 'not_started',
    },
  });

  const [providerChecklists, setProviderChecklists] = useState<Record<string, Record<string, boolean>>>({
    'prov-jackson': ONBOARDING_DOCS_10.reduce((acc, d) => ({ ...acc, [d]: true }), {}),
    'prov-edwards': ONBOARDING_DOCS_10.reduce((acc, d, i) => ({ ...acc, [d]: i < 9 }), {}),
    'prov-patel': ONBOARDING_DOCS_10.reduce((acc, d, i) => ({ ...acc, [d]: i < 7 }), {}),
    'prov-torres': ONBOARDING_DOCS_10.reduce((acc, d, i) => ({ ...acc, [d]: i < 5 }), {}),
  });

  const [selectedChecklistProvider, setSelectedChecklistProvider] = useState<string>('prov-jackson');

  const cycleStatus = async (providerId: string, payer: string) => {
    const current = enrollmentMatrix[providerId]?.[payer] || 'not_started';
    const nextMap: Record<EnrollmentStatus, EnrollmentStatus> = {
      active: 'in_process',
      in_process: 'submitted',
      submitted: 'not_started',
      not_started: 'active',
    };
    const next = nextMap[current];
    setEnrollmentMatrix(prev => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || {}),
        [payer]: next,
      },
    }));

    try {
      await fetch('/api/hr/credentialing/intake', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerUserId: providerId,
          payerName: payer,
          status: next,
        }),
      });
    } catch (e) {
      console.warn('Could not persist status change:', e);
    }
  };

  const toggleChecklistDoc = async (providerId: string, docName: string) => {
    const current = Boolean(providerChecklists[providerId]?.[docName]);
    const next = !current;
    setProviderChecklists(prev => ({
      ...prev,
      [providerId]: {
        ...(prev[providerId] || {}),
        [docName]: next,
      },
    }));

    try {
      await fetch('/api/hr/credentialing/intake', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerUserId: providerId,
          documentLabel: docName,
          completed: next,
        }),
      });
    } catch (e) {
      console.warn('Could not persist document checklist change:', e);
    }
  };

  const load = useCallback(async () => {
    const data = await fetchStaffCredentials();
    setCredentials(data.credentials);
    setStaff(data.staff);
    setSchemaReady(data.schemaReady !== false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load()
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load credentials');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  const upsert = (row: StaffCredentialRecord) => {
    setCredentials((prev) => {
      const next = prev.some((c) => c.id === row.id)
        ? prev.map((c) => (c.id === row.id ? row : c))
        : [row, ...prev];
      return next;
    });
  };

  const stats = useMemo(() => {
    const active = credentials.filter((c) => c.derivedStatus === 'active').length;
    const expiring = credentials.filter((c) => c.derivedStatus === 'expiring_soon').length;
    const expired = credentials.filter((c) => c.derivedStatus === 'expired').length;
    const attention = credentials
      .filter((c) => c.derivedStatus === 'expired' || c.derivedStatus === 'expiring_soon')
      .sort((a, b) => {
        if (a.derivedStatus !== b.derivedStatus) {
          return a.derivedStatus === 'expired' ? -1 : 1;
        }
        const ia = STAFF_ORDER.indexOf(a.staffName);
        const ib = STAFF_ORDER.indexOf(b.staffName);
        if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        return a.daysUntilExpiry - b.daysUntilExpiry;
      });
    return { active, expiring, expired, attention };
  }, [credentials]);

  const filtered = credentials.filter(
    (c) =>
      (filterStaff === 'all' || c.userId === filterStaff) &&
      (filterStatus === 'all' || c.derivedStatus === filterStatus)
  );

  const staffGroups = useMemo(() => {
    const map = new Map<string, StaffCredentialRecord[]>();
    for (const cred of filtered) {
      const list = map.get(cred.userId) ?? [];
      list.push(cred);
      map.set(cred.userId, list);
    }
    return [...map.entries()].sort((a, b) => {
      const na = a[1][0]?.staffName || '';
      const nb = b[1][0]?.staffName || '';
      const ia = STAFF_ORDER.indexOf(na);
      const ib = STAFF_ORDER.indexOf(nb);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return na.localeCompare(nb);
    });
  }, [filtered]);

  const filterStaffOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of credentials) {
      if (!seen.has(c.userId)) seen.set(c.userId, c.staffName);
    }
    return [...seen.entries()].sort((a, b) => {
      const ia = STAFF_ORDER.indexOf(a[1]);
      const ib = STAFF_ORDER.indexOf(b[1]);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a[1].localeCompare(b[1]);
    });
  }, [credentials]);

  const openAdd = () => {
    setEditing(null);
    const preferred =
      staff.find((s) => s.name === 'Dr. Renee Jackson')?.id ||
      filterStaffOptions[0]?.[0] ||
      staff[0]?.id ||
      '';
    setForm({ ...EMPTY_FORM, userId: preferred });
    setShowModal(true);
  };

  const openEdit = (cred: StaffCredentialRecord) => {
    setEditing(cred);
    setForm({
      userId: cred.userId,
      credentialType: cred.credentialType,
      title: cred.title,
      issuer: cred.issuer,
      licenseNumber: cred.licenseNumber,
      issuedAt: cred.issuedAt || '',
      expiresAt: cred.expiresAt,
      ceuRequired: cred.ceuRequired,
      ceuCompleted: cred.ceuCompleted,
    });
    setShowModal(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = {
        userId: form.userId,
        credentialType: form.credentialType,
        title: form.title,
        issuer: form.issuer,
        licenseNumber: form.licenseNumber,
        issuedAt: form.issuedAt || null,
        expiresAt: form.expiresAt,
        ceuRequired: Number(form.ceuRequired) || 0,
        ceuCompleted: Number(form.ceuCompleted) || 0,
      };
      const row = editing
        ? await updateStaffCredential(editing.id, payload)
        : await createStaffCredential(payload);
      upsert(row);
      setShowModal(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save credential');
    } finally {
      setSaving(false);
    }
  };

  const confirmRenew = async () => {
    if (!renewing) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await renewStaffCredential(renewing.id, renewDate || undefined);
      upsert(updated);
      setRenewing(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not renew credential');
    } finally {
      setSaving(false);
    }
  };

  const onPickFile = async (file: File | undefined) => {
    const id = uploadFor.current;
    uploadFor.current = null;
    if (!id || !file) return;
    setError(null);
    try {
      upsert(await uploadCredentialDocument(id, file));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload document');
    }
  };

  const toggle = (userId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] min-w-0 space-y-5 overflow-x-hidden pb-8">
      {/* Main Tab Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setMainTab('credentials')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              mainTab === 'credentials'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <FileText size={15} /> Staff Credentials
          </button>
          <button
            type="button"
            onClick={() => setMainTab('payer_intake')}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all ${
              mainTab === 'payer_intake'
                ? 'bg-purple-700 text-white shadow-sm'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Building2 size={15} /> Payer Enrollment Intake
          </button>
        </div>

        {mainTab === 'credentials' && (
          <button
            type="button"
            onClick={openAdd}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white shadow-sm"
            style={{ backgroundColor: PURPLE }}
          >
            <Plus size={16} /> Add Credential
          </button>
        )}
      </div>

      {mainTab === 'credentials' && (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                Staff Credentialing
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Track licenses, CEUs, malpractice, and certifications
              </p>
            </div>
          </header>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : null}
      {!schemaReady ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Credential records are not on this database yet. Apply the latest Prisma schema, then refresh.
        </p>
      ) : null}

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Active', value: stats.active, color: '#16a34a' },
          { label: 'Expiring (60 days)', value: stats.expiring, color: '#ea580c' },
          { label: 'Expired', value: stats.expired, color: '#dc2626' },
        ].map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-slate-200/80 bg-white px-5 py-4 shadow-[0_4px_16px_rgba(15,23,42,0.06)]"
          >
            <p className="text-sm text-slate-500">{card.label}</p>
            <p className="mt-1 text-3xl font-bold" style={{ color: card.color }}>
              {card.value}
            </p>
          </div>
        ))}
      </section>

      {stats.attention.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-orange-300 bg-[#fff8e8]">
          <p className="flex items-center gap-2 px-4 py-3 text-sm font-bold text-slate-900">
            <AlertTriangle size={16} className="text-amber-500" />
            {stats.attention.length} Credential{stats.attention.length === 1 ? '' : 's'} Need Attention
          </p>
          <div className="divide-y divide-orange-100 border-t border-orange-200/70">
            {stats.attention.map((cred) => (
              <div
                key={cred.id}
                className="flex flex-col gap-1 bg-white px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-sm text-slate-800">
                  {cred.staffName} — {cred.title}
                </p>
                <p
                  className={`text-sm font-semibold ${
                    cred.derivedStatus === 'expired' ? 'text-red-600' : 'text-orange-500'
                  }`}
                >
                  {expiryCopy(cred)}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <select
          value={filterStaff}
          onChange={(e) => setFilterStaff(e.target.value)}
          className="w-full shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 sm:w-auto"
        >
          <option value="all">All Staff</option>
          {filterStaffOptions.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1">
          {FILTER_PILLS.map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setFilterStatus(pill.id)}
              className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                filterStatus === pill.id
                  ? 'text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
              style={filterStatus === pill.id ? { backgroundColor: PURPLE } : undefined}
            >
              {pill.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? <p className="text-sm text-slate-500">Loading credentials…</p> : null}

      {!loading && staffGroups.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-white px-5 py-8 text-center text-sm text-slate-500">
          No credentials match these filters.
        </p>
      ) : null}

      <div className="space-y-3">
        {staffGroups.map(([userId, creds]) => {
          const staffName = creds[0]?.staffName || 'Staff';
          const isOpen = expanded.has(userId);
          const hasAlert = creds.some((c) => c.derivedStatus !== 'active');
          const initials = staffName
            .split(' ')
            .map((n) => n[0])
            .join('')
            .replace('.', '')
            .slice(0, 2)
            .toUpperCase();

          return (
            <div
              key={userId}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.04)]"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left sm:px-5"
                onClick={() => toggle(userId)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: PURPLE }}
                  >
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-slate-900">
                      <span className="truncate">{staffName}</span>
                      {hasAlert ? (
                        <AlertTriangle size={14} className="shrink-0 text-amber-500" />
                      ) : null}
                    </p>
                    <p className="text-xs text-slate-500">
                      {creds.length} credential{creds.length === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
                {isOpen ? (
                  <ChevronUp size={18} style={{ color: PURPLE }} className="shrink-0" />
                ) : (
                  <ChevronDown size={18} className="shrink-0 text-slate-400" />
                )}
              </button>

              {isOpen ? (
                <div className="space-y-3 border-t border-slate-100 px-4 py-3 sm:px-5">
                  {creds.map((cred) => {
                    const cfg = STATUS_CONFIG[cred.derivedStatus];
                    const ceuPct =
                      cred.ceuRequired > 0
                        ? Math.min(100, Math.round((cred.ceuCompleted / cred.ceuRequired) * 100))
                        : 0;
                    return (
                      <div key={cred.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-3 sm:p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                            style={{ backgroundColor: TYPE_COLORS[cred.credentialType] }}
                          >
                            {TYPE_LABELS[cred.credentialType]}
                          </span>
                          <span className="text-sm font-semibold text-slate-800">{cred.title}</span>
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                            style={{ color: cfg.color, backgroundColor: cfg.bg }}
                          >
                            {cfg.icon}
                            {cfg.label}
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                              Issuing Body
                            </p>
                            <p className="text-sm text-slate-800">{cred.issuer}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                              License / Policy #
                            </p>
                            <p className="text-sm text-slate-800">{cred.licenseNumber}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                              Expires
                            </p>
                            <p
                              className={`text-sm font-medium ${
                                cred.derivedStatus === 'expired'
                                  ? 'text-red-600'
                                  : cred.derivedStatus === 'expiring_soon'
                                    ? 'text-orange-500'
                                    : 'text-slate-800'
                              }`}
                            >
                              {cred.expiresAt}
                              {cred.derivedStatus === 'expired'
                                ? ` (${Math.abs(cred.daysUntilExpiry)} days ago)`
                                : cred.derivedStatus === 'expiring_soon'
                                  ? ` (${cred.daysUntilExpiry} days)`
                                  : ''}
                            </p>
                          </div>
                        </div>

                        {cred.ceuRequired > 0 ? (
                          <div className="mt-3">
                            <div className="mb-1 flex items-center justify-between text-xs">
                              <span className="font-medium text-slate-600">
                                CEU: {cred.ceuCompleted}/{cred.ceuRequired} hrs
                              </span>
                              <span className="font-semibold text-slate-500">{ceuPct}%</span>
                            </div>
                            <div className="h-2.5 overflow-hidden rounded-full bg-orange-100">
                              <div
                                className="h-full rounded-full bg-[#ea580c]"
                                style={{ width: `${ceuPct}%` }}
                              />
                            </div>
                          </div>
                        ) : null}

                        {cred.documentUrl ? (
                          <a
                            href={cred.documentUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 inline-block text-xs font-medium text-violet-700 hover:underline"
                          >
                            {cred.documentName || 'View document'}
                          </a>
                        ) : null}

                        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 font-medium text-slate-600 hover:text-slate-900"
                            onClick={() => {
                              uploadFor.current = cred.id;
                              fileRef.current?.click();
                            }}
                          >
                            <FileText size={14} /> Upload Doc
                          </button>
                          <button
                            type="button"
                            className="font-medium text-slate-600 hover:text-slate-900"
                            onClick={() => openEdit(cred)}
                          >
                            Edit
                          </button>
                          {cred.derivedStatus !== 'active' ? (
                            <button
                              type="button"
                              className="font-semibold text-orange-500 hover:underline"
                              onClick={() => {
                                setRenewing(cred);
                                setRenewDate(defaultRenewDate(cred));
                              }}
                            >
                              Mark Renewed
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      </>
      )}

      {/* Payer Enrollment Intake Tab */}
      {mainTab === 'payer_intake' && (
        <div className="space-y-6">
          <header>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              Payer Enrollment Intake
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Individual provider enrollment status under group contracts and onboarding documentation intake
            </p>
          </header>

          {/* Explanation Callout */}
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex gap-3 text-sm text-indigo-900 shadow-sm">
            <ShieldCheck className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-indigo-950">Individual Provider Enrollment Under Group Contracts</p>
              <p className="text-xs text-indigo-800 mt-1 leading-relaxed">
                Even when DivineCare / MD Behavioral Health holds group commercial and Medicaid contracts, each rendering provider (MD, DO, PMHNP, LCSW-C) must be individually credentialed and linked to our group TIN/NPI in each payer&apos;s provider directory before billing. Click any status badge in the matrix to update enrollment stage. CAQH profiles require re-attestation every 120 days.
              </p>
            </div>
          </div>

          {/* Provider x Payer Matrix */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Building2 size={18} className="text-purple-600" />
                  Provider × Payer Enrollment Matrix
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click any pill to cycle status: Active → In Process → Submitted → Not Started
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {Object.entries(ENROLLMENT_STATUS_META).map(([key, meta]) => (
                  <span
                    key={key}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-medium"
                    style={{ color: meta.color, backgroundColor: meta.bg }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                    {meta.label}
                  </span>
                ))}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4 min-w-[200px]">Clinician / NPI</th>
                    {ENROLLMENT_PAYERS.map(payer => (
                      <th key={payer} className="py-3 px-3 text-center min-w-[130px]">{payer}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ENROLLMENT_PROVIDERS.map(prov => (
                    <tr key={prov.id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900">{prov.name}</div>
                        <div className="text-xs text-slate-500 font-mono">NPI: {prov.npi} · {prov.role}</div>
                        <div className="text-[11px] text-purple-700 mt-0.5 font-medium">{prov.specialty}</div>
                      </td>
                      {ENROLLMENT_PAYERS.map(payer => {
                        const status = enrollmentMatrix[prov.id]?.[payer] || 'not_started';
                        const meta = ENROLLMENT_STATUS_META[status];
                        return (
                          <td key={payer} className="py-3.5 px-3 text-center">
                            <button
                              type="button"
                              onClick={() => void cycleStatus(prov.id, payer)}
                              title="Click to cycle status"
                              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold transition-all hover:scale-105 active:scale-95 shadow-xs cursor-pointer"
                              style={{ color: meta.color, backgroundColor: meta.bg }}
                            >
                              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                              {meta.label}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-Provider Onboarding Document Checklist */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <CheckSquare size={18} className="text-purple-600" />
                  Provider Onboarding Document Checklist (10 Standard Items)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Click checkboxes to toggle verification status for each credentialing dossier
                </p>
              </div>

              {/* Provider Selector Tabs */}
              <div className="flex flex-wrap gap-1.5 bg-slate-100 p-1 rounded-xl">
                {ENROLLMENT_PROVIDERS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedChecklistProvider(p.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      selectedChecklistProvider === p.id
                        ? 'bg-white text-purple-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {p.name.split(',')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Selected Provider Progress */}
            {(() => {
              const activeProv = ENROLLMENT_PROVIDERS.find(p => p.id === selectedChecklistProvider)!;
              const checklist = providerChecklists[selectedChecklistProvider] || {};
              const completedCount = ONBOARDING_DOCS_10.filter(d => checklist[d]).length;
              const pct = Math.round((completedCount / ONBOARDING_DOCS_10.length) * 100);

              return (
                <div className="space-y-4 pt-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-purple-50/60 border border-purple-100 rounded-xl p-3.5">
                    <div>
                      <span className="text-xs font-bold text-purple-950">{activeProv.name}</span>
                      <span className="text-xs text-purple-700 ml-2">({activeProv.role} · NPI {activeProv.npi})</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="w-32 bg-purple-100 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="h-full bg-purple-700 rounded-full transition-all duration-300"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-bold text-purple-900">
                        {completedCount} / 10 ({pct}%)
                      </span>
                    </div>
                  </div>

                  {/* 10 Checklist Items Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {ONBOARDING_DOCS_10.map((doc, idx) => {
                      const isDone = Boolean(checklist[doc]);
                      return (
                        <button
                          key={doc}
                          type="button"
                          onClick={() => void toggleChecklistDoc(selectedChecklistProvider, doc)}
                          className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                            isDone
                              ? 'bg-green-50/40 border-green-200 text-slate-800'
                              : 'bg-white border-slate-200 text-slate-700 hover:border-purple-200 hover:bg-slate-50'
                          }`}
                        >
                          <div className="mt-0.5 shrink-0">
                            {isDone ? (
                              <CheckCircle2 size={18} className="text-green-600" />
                            ) : (
                              <Square size={18} className="text-slate-300" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className={`text-xs font-semibold ${isDone ? 'text-slate-900 line-through opacity-85' : 'text-slate-800'}`}>
                              {idx + 1}. {doc}
                            </p>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              {isDone ? 'Verified and in provider credentialing packet' : 'Pending clinician upload or coordinator receipt'}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.doc,.docx,application/pdf,image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          void onPickFile(file);
        }}
      />

      {showModal ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl sm:p-6">
            <h2 className="mb-5 text-lg font-bold text-slate-900">
              {editing ? 'Edit Credential' : 'Add Credential'}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">Staff Member</label>
                <select
                  value={form.userId}
                  disabled={Boolean(editing)}
                  onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                  className={fieldClass()}
                >
                  <option value="">Select staff</option>
                  {staff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">Credential Type</label>
                <select
                  value={form.credentialType}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, credentialType: e.target.value as StaffCredentialType }))
                  }
                  className={fieldClass()}
                >
                  {Object.entries(TYPE_LABELS).map(([key, value]) => (
                    <option key={key} value={key}>
                      {key === 'MALPRACTICE'
                        ? 'Malpractice'
                        : key === 'BACKGROUND_CHECK'
                          ? 'Background Check'
                          : value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="mb-1 block text-xs font-medium text-slate-500">Title / Description</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className={fieldClass()}
                  placeholder="e.g. LCSW — Maryland"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Issuing Body</label>
                <input
                  value={form.issuer}
                  onChange={(e) => setForm((f) => ({ ...f, issuer: e.target.value }))}
                  className={fieldClass()}
                  placeholder="MD Board of Social Work"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">License / Policy #</label>
                <input
                  value={form.licenseNumber}
                  onChange={(e) => setForm((f) => ({ ...f, licenseNumber: e.target.value }))}
                  className={fieldClass()}
                  placeholder="LCSW-12345"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Issued</label>
                <input
                  type="date"
                  value={form.issuedAt}
                  onChange={(e) => setForm((f) => ({ ...f, issuedAt: e.target.value }))}
                  className={fieldClass()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Expires</label>
                <input
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))}
                  className={fieldClass()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">CEU Hours Required</label>
                <input
                  type="number"
                  min={0}
                  value={form.ceuRequired}
                  onChange={(e) => setForm((f) => ({ ...f, ceuRequired: Number(e.target.value) }))}
                  className={fieldClass()}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">CEU Hours Completed</label>
                <input
                  type="number"
                  min={0}
                  value={form.ceuCompleted}
                  onChange={(e) => setForm((f) => ({ ...f, ceuCompleted: Number(e.target.value) }))}
                  className={fieldClass()}
                />
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowModal(false);
                  setEditing(null);
                }}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  saving ||
                  !form.userId ||
                  !form.title ||
                  !form.issuer ||
                  !form.licenseNumber ||
                  !form.expiresAt
                }
                onClick={() => void save()}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: PURPLE }}
              >
                {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Credential'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {renewing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-xl">
            <h2 className="text-lg font-bold text-slate-900">Mark Renewed</h2>
            <p className="mt-1 text-sm text-slate-500">
              {renewing.staffName} — {renewing.title}. Default extends expiry by one year.
            </p>
            <label className="mt-4 mb-1 block text-xs font-medium text-slate-500">New expiration date</label>
            <input
              type="date"
              value={renewDate}
              onChange={(e) => setRenewDate(e.target.value)}
              className={fieldClass()}
            />
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => setRenewing(null)}
                className="flex-1 rounded-lg border border-slate-200 py-2.5 text-sm font-medium text-slate-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !renewDate}
                onClick={() => void confirmRenew()}
                className="flex-1 rounded-lg py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: PURPLE }}
              >
                {saving ? 'Saving…' : 'Save Renewal'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
