'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  PhoneCall,
  Plus,
  X,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/features/auth';
import {
  closeWaitlistEntry,
  convertWaitlistEntry,
  convertWaitlistToIntake,
  createWaitlistEntry,
  fetchWaitlist,
  matchWaitlistEntry,
  updateWaitlistEntry,
  type WaitlistClinician,
  type WaitlistEntry,
  type WaitlistStatus,
  type WaitlistUrgency,
} from '@/features/waitlist/api';

const SPECIALTIES = [
  'CBT',
  'Trauma',
  'DBT',
  'Family Therapy',
  'Substance Use',
  'Anger Management',
  'Mindfulness',
  'Medication Management',
];

const INSURERS = ['Medicaid', 'Medicare', 'BCBS', 'Aetna', 'CareFirst', 'Uninsured', 'Other'];

const REFERRAL_SOURCES = [
  'Self-referral',
  'Primary Care',
  'Hospital Discharge',
  'Court-Ordered',
  'Community Outreach',
  'Other Provider',
];

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';
const PURPLE = '#5C2D91';

const emptyForm = {
  name: '',
  email: '',
  phone: '',
  specialty: 'CBT',
  urgency: 'routine' as WaitlistUrgency,
  insurancePayer: 'Medicaid',
  referralSource: 'Self-referral',
  notes: '',
};

const inputClass =
  'w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20';

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?';
}

function phoneHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, '')}`;
}

function firstNameOf(name: string) {
  const part = name.trim().split(/\s+/)[0];
  return part || 'Client';
}

function StatusBadge({ status }: { status: WaitlistStatus }) {
  const map = {
    waiting: { cls: 'bg-blue-50 text-blue-700', icon: <Clock size={12} />, label: 'Waiting' },
    matched: { cls: 'bg-purple-50 text-purple-700', icon: <Zap size={12} />, label: 'Matched' },
    scheduled: {
      cls: 'bg-green-50 text-green-700',
      icon: <CheckCircle2 size={12} />,
      label: 'Scheduled',
    },
    closed: { cls: 'bg-gray-100 text-gray-600', icon: <X size={12} />, label: 'Closed' },
  } as const;
  const m = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${m.cls}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

function UrgencyBadge({ urgency }: { urgency: WaitlistUrgency }) {
  const cls =
    urgency === 'crisis'
      ? 'bg-red-50 text-red-700'
      : urgency === 'urgent'
        ? 'bg-amber-50 text-amber-700'
        : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${cls}`}>
      {urgency}
    </span>
  );
}

function ModalShell({
  title,
  subtitle,
  children,
  onClose,
  maxW = 'max-w-lg',
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  maxW?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overflow-x-hidden overscroll-contain bg-slate-900/40 p-3 sm:items-center">
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div
        className={`relative z-10 my-auto flex max-h-[min(90dvh,40rem)] w-full ${maxW} flex-col rounded-2xl border border-purple-100 bg-white p-5 shadow-xl`}
      >
        <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-gray-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-gray-500">{label}</label>
      {children}
    </div>
  );
}

export default function WaitlistPage() {
  const router = useRouter();
  const { user } = useAuth();
  const canMatchClinician = user?.role === 'ADMIN';

  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [clinicians, setClinicians] = useState<WaitlistClinician[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | WaitlistStatus>('all');

  const [showAdd, setShowAdd] = useState(false);
  const [editEntry, setEditEntry] = useState<WaitlistEntry | null>(null);
  const [matchEntry, setMatchEntry] = useState<WaitlistEntry | null>(null);
  const [selectedClinicianId, setSelectedClinicianId] = useState('');
  const [clinicianQuery, setClinicianQuery] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWaitlist();
      setEntries(data.entries);
      setClinicians(data.clinicians);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load waitlist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = useMemo(() => entries.filter((e) => e.status === 'waiting'), [entries]);
  const urgentWaiting = useMemo(
    () => waiting.filter((e) => e.urgency === 'urgent' || e.urgency === 'crisis'),
    [waiting]
  );
  const avgWaitDays = useMemo(() => {
    if (!waiting.length) return 0;
    return Math.round(waiting.reduce((s, e) => s + e.daysWaiting, 0) / waiting.length);
  }, [waiting]);

  /** Clinicians available to match — from org staff in DB (not static). */
  const availableClinicians = clinicians.length;

  const statusCounts = useMemo(
    () => ({
      all: entries.length,
      waiting: entries.filter((e) => e.status === 'waiting').length,
      matched: entries.filter((e) => e.status === 'matched').length,
      scheduled: entries.filter((e) => e.status === 'scheduled').length,
      closed: entries.filter((e) => e.status === 'closed').length,
    }),
    [entries]
  );

  const filtered = useMemo(
    () => (filterStatus === 'all' ? entries : entries.filter((e) => e.status === filterStatus)),
    [entries, filterStatus]
  );

  const matchClinicians = useMemo(() => {
    const q = clinicianQuery.trim().toLowerCase();
    if (!q) return clinicians;
    return clinicians.filter(
      (c) => c.name.toLowerCase().includes(q) || c.role.replaceAll('_', ' ').toLowerCase().includes(q)
    );
  }, [clinicians, clinicianQuery]);

  const openAdd = () => {
    setForm(emptyForm);
    setFormError('');
    setShowAdd(true);
  };

  const openEdit = (entry: WaitlistEntry) => {
    setForm({
      name: entry.name,
      email: entry.email || '',
      phone: entry.phone || '',
      specialty: entry.specialty || 'CBT',
      urgency: entry.urgency,
      insurancePayer: entry.insurancePayer || 'Medicaid',
      referralSource: entry.referralSource || 'Self-referral',
      notes: entry.notes || '',
    });
    setFormError('');
    setEditEntry(entry);
  };

  const validateForm = () => {
    if (!form.name.trim() || form.name.trim().length < 2) {
      setFormError('Client name is required');
      return false;
    }
    if (!form.phone.trim()) {
      setFormError('Phone is required');
      return false;
    }
    return true;
  };

  const onAdd = async () => {
    if (!validateForm()) return;
    setSaving(true);
    setFormError('');
    try {
      const entry = await createWaitlistEntry({
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        specialty: form.specialty,
        urgency: form.urgency,
        insurancePayer: form.insurancePayer,
        referralSource: form.referralSource,
        notes: form.notes.trim() || null,
      });
      setEntries((prev) => [entry, ...prev]);
      setShowAdd(false);
      setForm(emptyForm);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not add to waitlist');
    } finally {
      setSaving(false);
    }
  };

  const onSaveEdit = async () => {
    if (!editEntry || !validateForm()) return;
    setSaving(true);
    setFormError('');
    try {
      const updated = await updateWaitlistEntry(editEntry.id, {
        name: form.name.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        specialty: form.specialty,
        urgency: form.urgency,
        insurancePayer: form.insurancePayer,
        referralSource: form.referralSource,
        notes: form.notes.trim() || null,
      });
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditEntry(null);
      setForm(emptyForm);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setSaving(false);
    }
  };

  const onConfirmMatch = async () => {
    if (!matchEntry || !selectedClinicianId) return;
    setActionId(matchEntry.id);
    try {
      const updated = await matchWaitlistEntry(matchEntry.id, selectedClinicianId);
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setMatchEntry(null);
      setSelectedClinicianId('');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not match clinician');
    } finally {
      setActionId(null);
    }
  };

  const onConvert = async (entry: WaitlistEntry) => {
    if (
      !confirm(
        `Convert ${entry.name} to a client${entry.clinicianName ? ` and assign ${entry.clinicianName}` : ''}?`
      )
    ) {
      return;
    }
    setActionId(entry.id);
    try {
      const result = await convertWaitlistEntry(entry.id);
      setEntries((prev) => prev.map((e) => (e.id === result.entry.id ? result.entry : e)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not convert to client');
    } finally {
      setActionId(null);
    }
  };

  const onConvertToIntake = async (entry: WaitlistEntry) => {
    if (!entry.email) {
      alert('Add an email on this waitlist entry before sending intake');
      return;
    }
    if (
      !confirm(
        `Send a digital intake link to ${entry.name} (${entry.email})?`
      )
    ) {
      return;
    }
    setActionId(entry.id);
    try {
      const result = await convertWaitlistToIntake(entry.id);
      const url = `${window.location.origin}/intake/${result.invite.token}`;
      void navigator.clipboard.writeText(url);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id && (e.status === 'waiting' || e.status === 'matched')
            ? { ...e, status: 'scheduled' as WaitlistStatus }
            : e
        )
      );
      alert(
        result.reused
          ? `Existing intake link copied (open / paste for client):\n${url}`
          : `Intake link created and copied. Share this with the client (email does not auto-send):\n${url}`
      );
      router.push('/dashboard/clients/intake');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not create intake');
    } finally {
      setActionId(null);
    }
  };

  const onClose = async (entry: WaitlistEntry) => {
    if (!confirm(`Close waitlist entry for ${entry.name}?`)) return;
    setActionId(entry.id);
    try {
      const updated = await closeWaitlistEntry(entry.id);
      setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not close entry');
    } finally {
      setActionId(null);
    }
  };

  const formFields = (
    <>
      {formError ? (
        <div className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {formError}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Client Name">
          <input
            className={inputClass}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Full name"
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputClass}
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            placeholder="(301) 555-0100"
          />
        </Field>
        <Field label="Email (optional)">
          <input
            className={inputClass}
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="for intake link"
          />
        </Field>
        <Field label="Specialty">
          <select
            className={inputClass}
            value={form.specialty}
            onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
          >
            {SPECIALTIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Insurance">
          <select
            className={inputClass}
            value={form.insurancePayer}
            onChange={(e) => setForm((f) => ({ ...f, insurancePayer: e.target.value }))}
          >
            {INSURERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Referral Source">
          <select
            className={inputClass}
            value={form.referralSource}
            onChange={(e) => setForm((f) => ({ ...f, referralSource: e.target.value }))}
          >
            {REFERRAL_SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Urgency">
          <select
            className={inputClass}
            value={form.urgency}
            onChange={(e) => setForm((f) => ({ ...f, urgency: e.target.value as WaitlistUrgency }))}
          >
            <option value="routine">Routine</option>
            <option value="urgent">Urgent</option>
            <option value="crisis">Crisis</option>
          </select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Notes">
          <textarea
            className={`${inputClass} min-h-[88px] resize-y`}
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Clinical notes, preferences…"
          />
        </Field>
      </div>
    </>
  );

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-gray-500">
        Loading waitlist…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Waitlist Manager</h1>
          <p className="mt-1 text-sm text-gray-500">
            Match incoming clients to available clinicians
            {user?.role === 'FRONT_DESK' ? ' · Front desk' : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white shadow-sm"
          style={{ background: GRADIENT }}
        >
          <Plus size={16} />
          Add to Waitlist
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
          <button type="button" onClick={() => void load()} className="ml-2 font-semibold underline">
            Retry
          </button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        {[
          { label: 'Total Waiting', value: waiting.length, color: 'text-blue-600' },
          { label: 'Urgent / Crisis', value: urgentWaiting.length, color: 'text-amber-600' },
          { label: 'Avg Wait days', value: avgWaitDays, color: 'text-gray-800' },
          { label: 'Clinicians', value: availableClinicians, color: 'text-green-600' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm sm:p-5">
            <p className="text-xs font-semibold text-gray-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-extrabold sm:text-3xl ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {urgentWaiting.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-bold text-amber-900">
                {urgentWaiting.length} urgent client
                {urgentWaiting.length === 1 ? '' : 's'} need prompt matching
              </p>
              <p className="mt-1 text-xs text-amber-800/80">
                Urgent referrals should be matched within 5 business days per COMAR outpatient
                standards.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['waiting', 'Waiting'],
            ['matched', 'Matched'],
            ['scheduled', 'Scheduled'],
            ['closed', 'Closed'],
          ] as const
        ).map(([value, label]) => {
          const active = filterStatus === value;
          const count = statusCounts[value];
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilterStatus(value)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold transition ${
                active ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={active ? { backgroundColor: PURPLE } : undefined}
            >
              {label}
              <span className={active ? 'opacity-90' : 'text-gray-400'}>{count}</span>
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-purple-100 bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-gray-900">
            {entries.length === 0 ? 'Waitlist is empty' : 'No entries for this filter'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {entries.length === 0
              ? 'Add a client from your clinic — data saves to the database.'
              : 'Try another status or add someone to the waitlist.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filtered.map((entry) => (
            <article
              key={entry.id}
              className="flex flex-col rounded-2xl border border-purple-100 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-gray-900">{entry.name}</h3>
                    <StatusBadge status={entry.status} />
                    <UrgencyBadge urgency={entry.urgency} />
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-2">
                    <p>
                      <span className="font-semibold text-gray-600">Specialty:</span> {entry.specialty}
                    </p>
                    <p>
                      <span className="font-semibold text-gray-600">Insurance:</span>{' '}
                      {entry.insurancePayer || '—'}
                    </p>
                    <p>
                      <span className="font-semibold text-gray-600">Referral:</span>{' '}
                      {entry.referralSource || '—'}
                    </p>
                    <p className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      <span className="font-semibold text-gray-600">{entry.daysWaiting} days</span> waiting
                    </p>
                  </div>
                </div>
                {entry.phone ? (
                  <a
                    href={phoneHref(entry.phone)}
                    className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    aria-label={`Call ${firstNameOf(entry.name)}`}
                    title="Name only · dial via device (number hidden)"
                  >
                    <PhoneCall size={14} />
                    Call {firstNameOf(entry.name)}
                  </a>
                ) : null}
              </div>

              {entry.notes ? (
                <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
                  {entry.notes}
                </div>
              ) : null}

              {entry.status === 'matched' && entry.clinicianName ? (
                <p className="mt-3 text-sm font-semibold" style={{ color: PURPLE }}>
                  Matched to: {entry.clinicianName}
                </p>
              ) : null}

              {entry.status === 'scheduled' && entry.clinicianName ? (
                <p className="mt-3 text-sm font-semibold text-green-700">
                  Scheduled with: {entry.clinicianName}
                </p>
              ) : null}

              <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4 mt-4">
                {entry.status === 'waiting' ? (
                  <>
                    {canMatchClinician ? (
                      <button
                        type="button"
                        disabled={actionId === entry.id}
                        onClick={() => {
                          setSelectedClinicianId('');
                          setClinicianQuery('');
                          setMatchEntry(entry);
                        }}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-white disabled:opacity-60"
                        style={{ background: GRADIENT }}
                      >
                        <Zap size={14} />
                        Match to Clinician
                      </button>
                    ) : (
                      <span className="text-xs text-slate-400">
                        Clinic Admin assigns clinician
                      </span>
                    )}
                    <button
                      type="button"
                      disabled={actionId === entry.id || !entry.email}
                      onClick={() => void onConvertToIntake(entry)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-60"
                      title={!entry.email ? 'Add email on this entry first' : undefined}
                    >
                      Send Intake
                    </button>
                  </>
                ) : null}
                {entry.status === 'matched' ? (
                  <>
                    <button
                      type="button"
                      disabled={actionId === entry.id}
                      onClick={() => void onConvert(entry)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-green-600 px-3 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
                    >
                      <CheckCircle2 size={14} />
                      Convert to Client
                    </button>
                    <button
                      type="button"
                      disabled={actionId === entry.id || !entry.email}
                      onClick={() => void onConvertToIntake(entry)}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 text-sm font-semibold text-green-700 hover:bg-green-100 disabled:opacity-60"
                      title={!entry.email ? 'Add email on this entry first' : undefined}
                    >
                      Send Intake
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => openEdit(entry)}
                  className="inline-flex min-h-9 items-center rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Edit
                </button>
                {entry.status !== 'closed' ? (
                  <button
                    type="button"
                    disabled={actionId === entry.id}
                    onClick={() => void onClose(entry)}
                    className="ml-auto inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-semibold text-gray-500 hover:bg-gray-50 hover:text-gray-700 disabled:opacity-60"
                  >
                    Close Entry
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {showAdd ? (
        <ModalShell title="Add to Waitlist" onClose={() => setShowAdd(false)}>
          {formFields}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onAdd()}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: GRADIENT }}
            >
              {saving ? 'Saving…' : 'Add to Waitlist'}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {editEntry ? (
        <ModalShell
          title="Edit Waitlist Entry"
          subtitle={editEntry.name}
          onClose={() => setEditEntry(null)}
        >
          {formFields}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditEntry(null)}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSaveEdit()}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: GRADIENT }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </ModalShell>
      ) : null}

      {matchEntry ? (
        <ModalShell
          title="Match Clinician"
          subtitle={`${matchEntry.name} — ${matchEntry.specialty} · ${matchEntry.insurancePayer || '—'}`}
          onClose={() => {
            setMatchEntry(null);
            setClinicianQuery('');
          }}
          maxW="max-w-md"
        >
          {clinicians.length === 0 ? (
            <p className="text-sm text-gray-500">No clinicians available in the database.</p>
          ) : (
            <>
              <div className="sticky top-0 z-10 shrink-0 space-y-2 bg-white pb-2">
                <p className="text-xs font-semibold text-gray-500">Select clinician</p>
                <input
                  type="search"
                  value={clinicianQuery}
                  onChange={(e) => setClinicianQuery(e.target.value)}
                  placeholder="Search by name…"
                  className={inputClass}
                  aria-label="Search clinicians"
                />
              </div>
              <div className="min-h-0 max-h-[min(60vh,24rem)] flex-1 overflow-x-hidden overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
                {matchClinicians.length === 0 ? (
                  <p className="px-1 py-6 text-center text-sm text-gray-500">No clinicians match that search.</p>
                ) : (
                  <div className="space-y-2">
                    {matchClinicians.map((c) => {
                      const selected = selectedClinicianId === c.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => setSelectedClinicianId(c.id)}
                          className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition ${
                            selected
                              ? 'border-[#5C2D91] bg-purple-50'
                              : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
                          }`}
                        >
                          <div
                            className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full text-xs font-bold text-white"
                            style={{ backgroundColor: PURPLE }}
                          >
                            {c.image ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={c.image} alt="" className="h-full w-full object-cover" />
                            ) : (
                              initials(c.name)
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-gray-900">{c.name}</p>
                            <p className="truncate text-xs text-gray-500">
                              {c.role.replaceAll('_', ' ')}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
          <div className="mt-5 flex shrink-0 justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setMatchEntry(null);
                setClinicianQuery('');
              }}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!selectedClinicianId || actionId === matchEntry.id}
              onClick={() => void onConfirmMatch()}
              className="rounded-xl px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
              style={{ background: GRADIENT }}
            >
              {actionId === matchEntry.id ? 'Matching…' : 'Confirm Match'}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </div>
  );
}
