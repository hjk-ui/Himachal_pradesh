'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Send,
  Star,
  UserCheck,
  X,
} from 'lucide-react';
import {
  createIntakeInvite,
  fetchIntakeInvite,
  fetchIntakeInvites,
  resendIntakeInvite,
  type AppointmentType,
  type IntakeInvite,
  type IntakeStatus,
} from '@/features/intake/api';
import { createClientNote } from '@/features/clients';
import {
  scoreMatches,
  staffUserToStaffMember,
} from '@/features/caseload';
import type { StaffMember } from '@/features/clients/types';
import { PAYER_GROUP_ORDER, payersByGroup } from '@/lib/constants/payers';
import { TextractInsuranceScan } from '@/features/ehr/TextractInsuranceScan';

const GRADIENT = 'linear-gradient(135deg, #5C2D91, #7C3AED)';
const PURPLE = '#5C2D91';
const PAYERS_BY_GROUP = payersByGroup();

type AccompaniedBy =
  | 'Unaccompanied'
  | 'Parent/guardian'
  | 'Spouse/partner'
  | 'Other';

function honorificFromPronouns(pronouns?: string | null) {
  const p = (pronouns || '').toLowerCase();
  if (p.includes('she') || p.includes('her')) return 'Ms.';
  if (p.includes('he') || p.includes('him')) return 'Mr.';
  return 'Mx.';
}

function lastNameFromInvite(invite: IntakeInvite) {
  const data = invite.formData as Record<string, any> | undefined;
  const demo = data?.demographics;
  if (demo?.lastName) return String(demo.lastName);
  const parts = invite.clientName.trim().split(/\s+/);
  return parts.length > 1 ? parts[parts.length - 1] : invite.clientName;
}

function pronounsFromInvite(invite: IntakeInvite) {
  const data = invite.formData as Record<string, any> | undefined;
  return data?.demographics?.pronouns as string | undefined;
}

function buildFirstVisitNoteBody(input: {
  visitType: AppointmentType;
  verbalConsent: boolean;
  accompaniedBy: AccompaniedBy;
  chiefComplaint: string;
  honorific: string;
  lastName: string;
}) {
  const lines = [
    'FIRST VISIT NOTE',
    `Visit type: ${input.visitType}`,
  ];
  if (input.visitType === 'Telehealth') {
    lines.push(
      input.verbalConsent
        ? 'Verbal consent: Patient provided verbal consent to receive care via telehealth.'
        : 'Verbal consent: Not documented.'
    );
  }
  lines.push(
    `Accompanied by: ${input.accompaniedBy}`,
    `Chief complaint: ${input.chiefComplaint.trim()}`,
    '',
    `${input.honorific} ${input.lastName} presented for an initial visit (${input.visitType}).`,
    `Accompanied by: ${input.accompaniedBy}.`,
    `Chief complaint: ${input.chiefComplaint.trim()}.`
  );
  return lines.join('\n');
}

function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86400000));
}

function portalUrlFor(token: string) {
  if (typeof window === 'undefined') return `/intake/${token}`;
  return `${window.location.origin}/intake/${token}`;
}

function StatusBadge({ status }: { status: IntakeStatus }) {
  if (status === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-700">
        <Clock size={12} /> Awaiting Client
      </span>
    );
  }
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
        <CheckCircle2 size={12} /> Completed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-0.5 text-[11px] font-semibold text-red-700">
      <AlertTriangle size={12} /> Expired
    </span>
  );
}

function SubmissionView({ data }: { data: unknown }) {
  if (!data || typeof data !== 'object') {
    return <p className="text-sm text-gray-500">No submission payload on file.</p>;
  }
  const d = data as Record<string, any>;
  const demo = d.demographics || {};
  const ins = d.insurance || {};
  const med = d.medicalHistory || {};
  const consents = d.consents || {};
  const sig = d.signature || {};

  const section = (title: string, rows: [string, unknown][]) => (
    <div className="rounded-xl border border-purple-100 bg-gray-50/80 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-[#5C2D91]">{title}</p>
      <dl className="mt-2 space-y-1.5">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-sm">
            <dt className="text-gray-500">{k}</dt>
            <dd className="max-w-[60%] text-right font-medium text-gray-900">
              {v == null || v === '' ? '—' : String(v)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );

  return (
    <div className="space-y-3">
      {section('Demographics', [
        ['Name', [demo.firstName, demo.lastName].filter(Boolean).join(' ')],
        ['DOB', demo.dateOfBirth],
        ['Phone', demo.phone],
        ['Email', demo.email],
        ['Address', [demo.addressLine1, demo.city, demo.state, demo.postalCode].filter(Boolean).join(', ')],
        ['Emergency', [demo.emergencyContactName, demo.emergencyContactPhone].filter(Boolean).join(' · ')],
      ])}
      {section('Insurance', [
        ['Primary payer', ins.primaryPayer],
        ['Member ID', ins.memberId],
        ['Group #', ins.groupNumber],
        ['Subscriber', ins.subscriberName],
        ['Secondary', ins.secondaryPayer],
      ])}
      {section('Medical History', [
        ['Medications', med.medications],
        ['Allergies', med.allergies],
        ['Prior treatment', med.previousTreatment],
        ['PCP', [med.pcpName, med.pcpPhone].filter(Boolean).join(' · ')],
        ['Reason', med.reasonForSeeking],
        ['Substance use', med.substanceUse],
      ])}
      {section('Consents & Signature', [
        ['HIPAA', consents.hipaa ? 'Agreed' : '—'],
        ['Treatment', consents.treatment ? 'Agreed' : '—'],
        ['Telehealth', consents.telehealth ? 'Agreed' : '—'],
        ['Financial', consents.financial ? 'Agreed' : '—'],
        ['Signed by', sig.fullName],
        ['Signed at', sig.signedAt ? new Date(sig.signedAt).toLocaleString() : '—'],
      ])}
    </div>
  );
}

const INITIAL_INTAKE_FORM = {
  clientName: '',
  clientEmail: '',
  clientPhone: '',
  firstAppointment: '',
  presentingConcern: '',
  payer: '',
  assignedClinicianId: '',
  assignedClinicianName: '',
  appointmentType: 'In Office' as AppointmentType,
  homeless: false,
  // Section 5.2: Guardian / Responsible Party
  guardianName: '',
  guardianRelationship: '',
  guardianPhone: '',
  guardianEmail: '',
  guardianIsEmergencyContact: true,
  // Section 5.2: Expanded Referral Sources (11 options)
  referralSource: 'Self',
  // Section 5.2: Secondary Insurance
  hasSecondaryInsurance: false,
  secondaryPayer: '',
  secondaryMemberId: '',
  secondaryGroupNumber: '',
  secondarySubscriberName: '',
  secondaryRelationship: 'Self',
};

export default function IntakePage() {
  const [invites, setInvites] = useState<IntakeInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | IntakeStatus>('all');
  const [showNew, setShowNew] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [viewInvite, setViewInvite] = useState<IntakeInvite | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [toast, setToast] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [sendVia, setSendVia] = useState<'Email' | 'SMS' | 'Both'>('Email');
  const [showSmartMatch, setShowSmartMatch] = useState(false);
  const [form, setForm] = useState(INITIAL_INTAKE_FORM);

  const [firstVisitInvite, setFirstVisitInvite] = useState<IntakeInvite | null>(null);
  const [fvVisitType, setFvVisitType] = useState<AppointmentType>('In Office');
  const [fvVerbalConsent, setFvVerbalConsent] = useState(false);
  const [fvAccompaniedBy, setFvAccompaniedBy] = useState<AccompaniedBy>('Unaccompanied');
  const [fvChiefComplaint, setFvChiefComplaint] = useState('');
  const [fvSaving, setFvSaving] = useState(false);
  const [fvError, setFvError] = useState('');

  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Load real clinic clinicians (empty until directory returns — no seed staff in production UI)
  useEffect(() => {
    async function loadStaff() {
      try {
        const res = await fetch('/api/staff/directory');
        const data = await res.json();
        if (data.success && Array.isArray(data.users) && data.users.length > 0) {
          setStaffList(data.users.map((u: any) => staffUserToStaffMember(u)));
        }
      } catch (err) {
        console.error('Failed to load clinic staff directory:', err);
      }
    }
    void loadStaff();
  }, []);

  const smartMatches = useMemo(() => {
    return scoreMatches(
      {
        diagnosis: form.presentingConcern || 'Depression and Anxiety',
        insuranceType: form.payer,
      },
      staffList,
      [], // live capacity only from assigned staff caseloads — no fake INITIAL_CLIENTS
      'primaryTherapistId'
    );
  }, [form.presentingConcern, form.payer, staffList]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchIntakeInvites();
      setInvites(rows);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load intake packets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = useMemo(() => invites.filter((f) => f.status === 'pending'), [invites]);
  const expired = useMemo(() => invites.filter((f) => f.status === 'expired'), [invites]);
  const completed = useMemo(() => invites.filter((f) => f.status === 'completed'), [invites]);
  const filtered = useMemo(
    () => (filter === 'all' ? invites : invites.filter((f) => f.status === filter)),
    [filter, invites]
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  function copyLink(token: string) {
    const url = portalUrlFor(token);
    void navigator.clipboard.writeText(url);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  const onCreate = async () => {
    setFormError('');
    if (!form.clientName.trim() || form.clientName.trim().length < 2) {
      setFormError('Client name is required');
      return;
    }
    if (!form.clientEmail.trim() || !form.clientEmail.includes('@')) {
      setFormError('Valid email is required');
      return;
    }
    if (!form.firstAppointment) {
      setFormError('First appointment date is required');
      return;
    }
    if (!form.assignedClinicianId) {
      setFormError('Clinician assignment is mandatory before sending the intake link');
      return;
    }
    if ((sendVia === 'SMS' || sendVia === 'Both') && !form.clientPhone.trim()) {
      setFormError('Phone is required when sending via SMS');
      return;
    }
    setSaving(true);
    try {
      const invite = await createIntakeInvite({
        clientName: form.clientName.trim(),
        clientEmail: form.clientEmail.trim(),
        clientPhone: form.clientPhone.trim() || null,
        firstAppointment: form.firstAppointment || null,
        assignedToId: form.assignedClinicianId || null,
        insurancePayer: form.payer || null,
        appointmentType: form.appointmentType,
        homeless: form.homeless,
        sendVia,
      });
      setInvites((prev) => [invite, ...prev]);
      setShowNew(false);
      setForm(INITIAL_INTAKE_FORM);
      setSendVia('Email');
      setShowSmartMatch(false);
      copyLink(invite.token);
      showToast(`Intake link sent via ${sendVia}`);
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Could not send intake link');
    } finally {
      setSaving(false);
    }
  };

  const onResend = async (invite: IntakeInvite) => {
    setActionId(invite.id);
    try {
      const updated = await resendIntakeInvite(invite.id);
      setInvites((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
      copyLink(updated.token);
      showToast('Fresh link sent — copied to clipboard');
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not resend');
    } finally {
      setActionId(null);
    }
  };

  const onViewSubmission = async (invite: IntakeInvite) => {
    setViewLoading(true);
    try {
      const full = await fetchIntakeInvite(invite.id);
      setViewInvite(full);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not load submission');
    } finally {
      setViewLoading(false);
    }
  };

  const openFirstVisitNote = async (invite: IntakeInvite) => {
    setFvError('');
    setFvVerbalConsent(false);
    setFvAccompaniedBy('Unaccompanied');
    setFvChiefComplaint('');
    try {
      const full = invite.formData ? invite : await fetchIntakeInvite(invite.id);
      const appt =
        full.appointmentType === 'Telehealth' || full.appointmentType === 'In Office'
          ? full.appointmentType
          : 'In Office';
      setFvVisitType(appt);
      setFirstVisitInvite(full);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Could not open First Visit Note');
    }
  };

  const fvHonorific = firstVisitInvite
    ? honorificFromPronouns(pronounsFromInvite(firstVisitInvite))
    : 'Mx.';
  const fvLastName = firstVisitInvite ? lastNameFromInvite(firstVisitInvite) : '';
  const fvPreview = firstVisitInvite
    ? buildFirstVisitNoteBody({
        visitType: fvVisitType,
        verbalConsent: fvVerbalConsent,
        accompaniedBy: fvAccompaniedBy,
        chiefComplaint: fvChiefComplaint || '—',
        honorific: fvHonorific,
        lastName: fvLastName,
      })
    : '';

  const onSaveFirstVisitNote = async () => {
    if (!firstVisitInvite?.clientId) {
      setFvError('Client chart not linked yet — open chart after intake completes.');
      return;
    }
    if (!fvChiefComplaint.trim()) {
      setFvError('Chief complaint is required');
      return;
    }
    if (fvVisitType === 'Telehealth' && !fvVerbalConsent) {
      setFvError('Verbal consent is required for telehealth visits');
      return;
    }
    setFvSaving(true);
    setFvError('');
    try {
      const body = buildFirstVisitNoteBody({
        visitType: fvVisitType,
        verbalConsent: fvVerbalConsent,
        accompaniedBy: fvAccompaniedBy,
        chiefComplaint: fvChiefComplaint,
        honorific: fvHonorific,
        lastName: fvLastName,
      });
      await createClientNote(firstVisitInvite.clientId, body);
      setFirstVisitInvite(null);
      showToast('First Visit Note saved to chart');
    } catch (err: unknown) {
      setFvError(err instanceof Error ? err.message : 'Could not save progress note');
    } finally {
      setFvSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {toast ? (
        <div className="fixed right-4 top-4 z-[60] rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Digital Intake</h1>
          <p className="mt-1 text-sm text-gray-500">
            Send paperless intake forms to new clients before their first appointment
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormError('');
            setShowNew(true);
          }}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-white shadow-sm"
          style={{ background: GRADIENT }}
        >
          <Plus size={16} />
          Send Intake Link
        </button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: 'Awaiting Completion', value: pending.length, color: 'text-amber-600' },
          { label: 'Completed', value: completed.length, color: 'text-green-600' },
          { label: 'Expired (Resend)', value: expired.length, color: 'text-red-600' },
        ].map((k) => (
          <div key={k.label} className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500">{k.label}</p>
            <p className={`mt-1 text-2xl font-extrabold ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {expired.length > 0 ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-600" />
            <div>
              <p className="text-sm font-bold text-red-800">
                {expired.length} intake link{expired.length === 1 ? '' : 's'} expired without
                completion
              </p>
              <p className="mt-1 text-xs text-red-700/90">
                Links expire after 7 days. Resend to give the client a fresh link.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(
          [
            ['all', 'All'],
            ['pending', 'Awaiting Client'],
            ['completed', 'Completed'],
            ['expired', 'Expired'],
          ] as const
        ).map(([value, label]) => {
          const active = filter === value;
          const count =
            value === 'all' ? invites.length : invites.filter((d) => d.status === value).length;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
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

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500">
          <Loader2 className="animate-spin" size={16} /> Loading intake from database…
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-purple-100 bg-white px-6 py-14 text-center shadow-sm">
          <p className="text-sm font-semibold text-gray-900">
            {invites.length === 0 ? 'No intake packets yet' : 'No entries for this filter'}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {invites.length === 0
              ? 'Send a secure link — when the client finishes, data saves to the database and their chart.'
              : 'Try another status filter.'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((item) => {
            const portalUrl = portalUrlFor(item.token);
            const busy = actionId === item.id;
            return (
              <article
                key={item.id}
                className="rounded-2xl border border-purple-100 bg-white p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold text-gray-900">{item.clientName}</h3>
                  <StatusBadge status={item.status} />
                  {item.homeless ? (
                    <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                      Homeless / no fixed address
                    </span>
                  ) : null}
                  {item.appointmentType ? (
                    <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">
                      {item.appointmentType}
                    </span>
                  ) : null}
                  {item.sentCount > 1 ? (
                    <span className="text-xs text-gray-400">Sent {item.sentCount}×</span>
                  ) : null}
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                  <span>{item.clientEmail}</span>
                  {item.clientPhone ? <span>{item.clientPhone}</span> : null}
                  {item.firstAppointment ? <span>First appt: {item.firstAppointment}</span> : null}
                  {item.status === 'pending' ? (
                    <span className="font-medium text-amber-600">
                      Sent {daysSince(item.sentAt)} days ago
                    </span>
                  ) : null}
                  {item.status === 'completed' && item.completedAt ? (
                    <span className="font-medium text-green-600">
                      Completed {new Date(item.completedAt).toLocaleDateString()}
                    </span>
                  ) : null}
                  {item.status === 'expired' ? (
                    <span className="font-medium text-red-600">Expired</span>
                  ) : null}
                </p>

                {item.status !== 'completed' ? (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl bg-gray-50 px-3 py-2.5 sm:flex-row sm:items-center">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-gray-600">
                      {portalUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyLink(item.token)}
                      className="inline-flex min-h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-semibold text-gray-700 hover:bg-white"
                    >
                      {copied === item.token ? (
                        <>
                          <CheckCircle2 size={12} className="text-green-600" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy size={12} /> Copy
                        </>
                      )}
                    </button>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
                  {item.status === 'completed' ? (
                    <>
                      <button
                        type="button"
                        disabled={viewLoading}
                        onClick={() => void onViewSubmission(item)}
                        className="inline-flex min-h-9 items-center rounded-xl px-3 text-sm font-semibold text-white"
                        style={{ background: GRADIENT }}
                      >
                        View Submission
                      </button>
                      <button
                        type="button"
                        onClick={() => void openFirstVisitNote(item)}
                        className="inline-flex min-h-9 items-center rounded-xl border border-purple-200 bg-purple-50 px-3 text-sm font-semibold text-[#5C2D91] hover:bg-purple-100"
                      >
                        First Visit Note
                      </button>
                      {item.clientId ? (
                        <Link
                          href={`/dashboard/clients/${item.clientId}`}
                          className="inline-flex min-h-9 items-center rounded-xl border border-green-200 bg-green-50 px-3 text-sm font-semibold text-green-700 hover:bg-green-100"
                        >
                          Open client chart
                        </Link>
                      ) : null}
                    </>
                  ) : null}
                  {(item.status === 'pending' || item.status === 'expired') && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void onResend(item)}
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        <RefreshCw size={14} />
                        {busy ? 'Resending…' : 'Resend'}
                      </button>
                      <a
                        href={portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-9 items-center gap-1.5 rounded-xl border border-gray-200 px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        <ExternalLink size={14} />
                        Preview Form
                      </a>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-purple-100 bg-purple-50 p-5">
        <p className="mb-3 text-sm font-semibold text-[#5C2D91]">What the Intake Form Collects</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            ['Demographics', 'Name, DOB, address, emergency contact, preferred pronouns'],
            ['Insurance', 'Primary/secondary payer, member ID, group #, subscriber info'],
            [
              'Medical History',
              'Current medications, allergies, past mental health treatment, substance use',
            ],
            ['Release of Information', 'Authorized contacts and providers for PHI sharing'],
            ['HIPAA Notice', 'Privacy practices acknowledgment'],
            ['Informed Consent', 'Treatment consent with typed e-signature and timestamp'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-xl border border-purple-100 bg-white p-3">
              <p className="text-xs font-semibold text-gray-800">{title}</p>
              <p className="mt-0.5 text-xs text-gray-500">{desc}</p>
            </div>
          ))}
        </div>
      </div>

      {showNew ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setShowNew(false)}
          />
          <div className="relative z-10 flex max-h-[min(92vh,820px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-xl">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-3.5 sm:px-6">
              <h2 className="text-lg font-bold text-gray-900">Send Intake Link</h2>
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50"
              >
                <X size={18} />
              </button>
            </div>
            {formError ? (
              <div className="mx-5 mt-3 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:mx-6">
                {formError}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Client Name *
                </label>
                <input
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                  placeholder="Full legal name"
                  value={form.clientName}
                  onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Email *</label>
                  <input
                    type="email"
                    className="w-full rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    placeholder="client@email.com"
                    value={form.clientEmail}
                    onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">Phone</label>
                  <input
                    type="tel"
                    className="w-full rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    placeholder="(301) 555-0000"
                    value={form.clientPhone}
                    onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    First Appointment Date *
                  </label>
                  <input
                    type="date"
                    className="w-full rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    value={form.firstAppointment}
                    onChange={(e) => setForm((p) => ({ ...p, firstAppointment: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-gray-500">
                    Presenting Concern
                  </label>
                  <input
                    type="text"
                    className="w-full rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                    placeholder="e.g. Depression, PTSD, Anxiety"
                    value={form.presentingConcern}
                    onChange={(e) => setForm((p) => ({ ...p, presentingConcern: e.target.value }))}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-500">
                  Appointment Type *
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['In Office', 'Telehealth'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, appointmentType: v }))}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        form.appointmentType === v ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={form.appointmentType === v ? { backgroundColor: PURPLE } : undefined}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                {form.appointmentType === 'Telehealth' ? (
                  <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                    Telehealth: document verbal consent at the first visit before saving the First
                    Visit Note.
                  </div>
                ) : null}
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={form.homeless}
                  onChange={(e) => setForm((p) => ({ ...p, homeless: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-amber-600"
                />
                <span>
                  <span className="block text-xs font-semibold text-amber-900">
                    Client is homeless / no fixed address
                  </span>
                  <span className="mt-0.5 block text-[11px] text-amber-800/90">
                    Waives required street address on the public intake form and shows an SDOH
                    housing banner.
                  </span>
                </span>
              </label>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Insurance / Payer
                </label>
                <select
                  value={form.payer}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      payer: e.target.value,
                      assignedClinicianId: '',
                      assignedClinicianName: '',
                    }))
                  }
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-sm font-medium text-gray-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                >
                  <option value="">Select payer…</option>
                  {PAYER_GROUP_ORDER.map((group) => (
                    <optgroup key={group} label={group}>
                      {PAYERS_BY_GROUP[group].map((payer) => (
                        <option key={payer.id} value={payer.id}>
                          {payer.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              {/* Section 5.2: Expanded Referral Sources (11 options) */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Referral Source *
                </label>
                <select
                  value={form.referralSource}
                  onChange={(e) => setForm((p) => ({ ...p, referralSource: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 p-2.5 text-sm font-medium text-gray-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                >
                  <option value="Self">Self / Walk-in</option>
                  <option value="Primary Care Provider">Primary Care Provider (PCP)</option>
                  <option value="Hospital / Emergency Dept">Hospital / Emergency Department</option>
                  <option value="Court / Probation">Court / Probation Department</option>
                  <option value="School / University">School / University Counselor</option>
                  <option value="Department of Social Services (DSS)">Department of Social Services (DSS)</option>
                  <option value="Faith-Based Organization">Faith-Based Organization</option>
                  <option value="Inpatient Psychiatric Facility">Inpatient Psychiatric Facility</option>
                  <option value="Community Health Worker">Community Health Worker (CHW)</option>
                  <option value="Substance Use Treatment Center">Substance Use Treatment Center</option>
                  <option value="Other Healthcare Provider">Other Healthcare Provider</option>
                </select>
              </div>

              {/* Section 5.2: Guardian / Responsible Party */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
                <span className="block text-xs font-bold text-slate-800">
                  Guardian / Responsible Party (Optional for Adults, Mandatory for Minors)
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    placeholder="Guardian Name"
                    value={form.guardianName}
                    onChange={(e) => setForm((p) => ({ ...p, guardianName: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                  />
                  <input
                    type="text"
                    placeholder="Relationship (e.g. Mother, Spouse)"
                    value={form.guardianRelationship}
                    onChange={(e) => setForm((p) => ({ ...p, guardianRelationship: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                  />
                  <input
                    type="tel"
                    placeholder="Guardian Phone"
                    value={form.guardianPhone}
                    onChange={(e) => setForm((p) => ({ ...p, guardianPhone: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                  />
                  <input
                    type="email"
                    placeholder="Guardian Email"
                    value={form.guardianEmail}
                    onChange={(e) => setForm((p) => ({ ...p, guardianEmail: e.target.value }))}
                    className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                  />
                </div>
                <label className="flex items-center gap-2 text-[11px] text-slate-700 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={form.guardianIsEmergencyContact}
                    onChange={(e) => setForm((p) => ({ ...p, guardianIsEmergencyContact: e.target.checked }))}
                    className="rounded text-[#5C2D91]"
                  />
                  <span>Designate as Primary Emergency Contact</span>
                </label>
              </div>

              {/* Section 5.2: Secondary Insurance Capture */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                <label className="flex items-center justify-between cursor-pointer">
                  <span className="text-xs font-bold text-slate-800">Secondary Insurance Coverage</span>
                  <input
                    type="checkbox"
                    checked={form.hasSecondaryInsurance}
                    onChange={(e) => setForm((p) => ({ ...p, hasSecondaryInsurance: e.target.checked }))}
                    className="rounded text-[#5C2D91]"
                  />
                </label>

                {form.hasSecondaryInsurance && (
                  <div className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-slate-200">
                    <input
                      type="text"
                      placeholder="Secondary Payer Name"
                      value={form.secondaryPayer}
                      onChange={(e) => setForm((p) => ({ ...p, secondaryPayer: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                    />
                    <input
                      type="text"
                      placeholder="Secondary Member ID"
                      value={form.secondaryMemberId}
                      onChange={(e) => setForm((p) => ({ ...p, secondaryMemberId: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                    />
                    <input
                      type="text"
                      placeholder="Secondary Group Number"
                      value={form.secondaryGroupNumber}
                      onChange={(e) => setForm((p) => ({ ...p, secondaryGroupNumber: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                    />
                    <input
                      type="text"
                      placeholder="Subscriber Name"
                      value={form.secondarySubscriberName}
                      onChange={(e) => setForm((p) => ({ ...p, secondarySubscriberName: e.target.value }))}
                      className="w-full rounded-lg border border-slate-200 p-2 text-xs bg-white outline-none focus:border-[#5C2D91]"
                    />
                  </div>
                )}
              </div>

              <TextractInsuranceScan compact />

              {/* Smart Match Button & Recommendations */}
              <div className="rounded-xl border border-purple-100 bg-purple-50/40 p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold text-gray-900">Clinician Assignment *</p>
                    <p className="text-[11px] text-gray-500">
                      Mandatory before sending intake link
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSmartMatch(!showSmartMatch)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-[#5C2D91] shadow-xs hover:bg-purple-50 transition"
                  >
                    <Star size={13} className="fill-[#5C2D91]" />
                    {showSmartMatch ? 'Hide Smart Match' : 'Smart Match — auto rank'}
                  </button>
                </div>

                {/* Direct Clinician Dropdown Picker */}
                <div className="mt-2.5">
                  <select
                    value={form.assignedClinicianId}
                    onChange={(e) => {
                      const selId = e.target.value;
                      const s = staffList.find((st) => st.id === selId);
                      setForm((p) => ({
                        ...p,
                        assignedClinicianId: selId,
                        assignedClinicianName: s ? `${s.name}, ${s.credential}` : '',
                      }));
                    }}
                    className="w-full rounded-xl border border-purple-200 bg-white px-3 py-2 text-xs font-semibold text-gray-800 outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                  >
                    <option value="">-- Select Clinician ({staffList.length} staff available) --</option>
                    {staffList.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.credential})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Ranked recommendation list */}
                {showSmartMatch && (
                  <div className="mt-3 max-h-36 space-y-2 overflow-y-auto border-t border-purple-100 pt-3">
                    {smartMatches.slice(0, 4).map((match) => {
                      const isSelected = form.assignedClinicianId === match.staff.id;
                      return (
                        <div
                          key={match.staff.id}
                          onClick={() =>
                            setForm((p) => ({
                              ...p,
                              assignedClinicianId: match.staff.id,
                              assignedClinicianName: `${match.staff.name}, ${match.staff.credential}`,
                            }))
                          }
                          className={`cursor-pointer rounded-xl border p-2.5 transition text-xs ${
                            isSelected
                              ? 'border-[#5C2D91] bg-purple-100/70 ring-1 ring-[#5C2D91]'
                              : 'border-purple-100 bg-white hover:border-purple-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <span className="font-bold text-gray-900">{match.staff.name}</span>
                              <span className="text-[10px] text-gray-500 font-semibold">
                                {match.staff.credential}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {match.isBestMatch && (
                                <span className="rounded-full bg-[#5C2D91] px-2 py-0.5 text-[10px] font-bold text-white">
                                  Best Match
                                </span>
                              )}
                              <span className="text-[11px] font-bold text-gray-600">
                                {match.assignedCount}/{match.maxCaseload} clients
                              </span>
                            </div>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {match.reasons.map((r, idx) => (
                              <span
                                key={idx}
                                className="rounded bg-purple-50 px-1.5 py-0.5 text-[10px] text-[#5C2D91]"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Caseload Preview Card */}
              {form.assignedClinicianName ? (
                <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50/80 p-3 text-xs font-semibold text-[#5C2D91]">
                  <UserCheck size={16} className="shrink-0" />
                  <span>
                    <strong>{form.assignedClinicianName}</strong> will see this client in their caseload immediately.
                  </span>
                </div>
              ) : (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-xs font-medium text-amber-800">
                  Please assign a clinician using Smart Match before sending the intake link.
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-500">Send Via</label>
                <div className="flex flex-wrap gap-2">
                  {(['Email', 'SMS', 'Both'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setSendVia(v)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        sendVia === v ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={sendVia === v ? { backgroundColor: PURPLE } : undefined}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>
              <div className="rounded-xl bg-purple-50 p-3 text-xs text-[#5C2D91]">
                Client receives a secure link valid for 7 days. Completing the form saves to the
                database and creates/updates their client chart.
              </div>
            </div>
            </div>
            <div className="flex shrink-0 gap-3 border-t border-slate-100 bg-white px-5 py-3.5 sm:px-6">
              <button
                type="button"
                onClick={() => setShowNew(false)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !form.assignedClinicianId}
                onClick={() => void onCreate()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50 transition"
                style={{ background: GRADIENT }}
              >
                <Send size={14} /> {saving ? 'Sending…' : 'Send Intake Link'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {viewInvite ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setViewInvite(null)}
          />
          <div className="relative z-10 max-h-[85vh] w-full max-w-lg overflow-auto rounded-2xl border border-purple-100 bg-white p-5 shadow-xl sm:p-6">
            <h2 className="mb-4 text-lg font-bold text-gray-900">
              Submission · {viewInvite.clientName}
            </h2>
            <SubmissionView data={viewInvite.formData} />
            <div className="mt-4 flex justify-end gap-3">
              {viewInvite.clientId ? (
                <Link
                  href={`/dashboard/clients/${viewInvite.clientId}`}
                  className="rounded-xl px-4 py-2 text-sm font-semibold text-green-700 hover:underline"
                >
                  Open client
                </Link>
              ) : null}
              <button
                type="button"
                onClick={() => setViewInvite(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {firstVisitInvite ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-3 sm:items-center sm:p-4">
          <button
            type="button"
            className="absolute inset-0"
            aria-label="Close"
            onClick={() => setFirstVisitInvite(null)}
          />
          <div className="relative z-10 flex max-h-[min(92vh,820px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-xl">
            <div className="flex shrink-0 items-start justify-between border-b border-slate-100 px-5 py-3.5">
              <div>
                <h2 className="text-lg font-bold text-gray-900">First Visit Note</h2>
                <p className="mt-0.5 text-xs text-gray-500">{firstVisitInvite.clientName}</p>
              </div>
              <button
                type="button"
                onClick={() => setFirstVisitInvite(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-50"
              >
                <X size={18} />
              </button>
            </div>
            {fvError ? (
              <div className="mx-5 mt-3 shrink-0 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {fvError}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-500">Visit type</label>
                <div className="flex flex-wrap gap-2">
                  {(['In Office', 'Telehealth'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => {
                        setFvVisitType(v);
                        if (v !== 'Telehealth') setFvVerbalConsent(false);
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        fvVisitType === v ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={fvVisitType === v ? { backgroundColor: PURPLE } : undefined}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {fvVisitType === 'Telehealth' ? (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={fvVerbalConsent}
                    onChange={(e) => setFvVerbalConsent(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-blue-600"
                  />
                  <span className="text-xs text-blue-900">
                    <span className="font-semibold">Verbal consent obtained *</span>
                    <span className="mt-0.5 block text-blue-800/90">
                      Required to save a telehealth First Visit Note.
                    </span>
                  </span>
                </label>
              ) : null}

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-gray-500">
                  Accompanied by
                </label>
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      'Unaccompanied',
                      'Parent/guardian',
                      'Spouse/partner',
                      'Other',
                    ] as AccompaniedBy[]
                  ).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setFvAccompaniedBy(v)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                        fvAccompaniedBy === v ? 'text-white' : 'bg-gray-100 text-gray-600'
                      }`}
                      style={fvAccompaniedBy === v ? { backgroundColor: PURPLE } : undefined}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-500">
                  Chief complaint *
                </label>
                <textarea
                  rows={3}
                  value={fvChiefComplaint}
                  onChange={(e) => setFvChiefComplaint(e.target.value)}
                  placeholder="Primary reason for this visit"
                  className="w-full resize-none rounded-xl border border-gray-200 p-2.5 text-sm outline-none focus:border-[#5C2D91] focus:ring-2 focus:ring-[#5C2D91]/20"
                />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                  Auto note preview
                </p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {fvHonorific} {fvLastName}
                </p>
                <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed text-slate-600">
                  {fvPreview}
                </pre>
              </div>
            </div>
            <div className="flex shrink-0 gap-3 border-t border-slate-100 bg-white px-5 py-3.5">
              <button
                type="button"
                onClick={() => setFirstVisitInvite(null)}
                className="flex-1 rounded-xl border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={fvSaving || !firstVisitInvite.clientId}
                onClick={() => void onSaveFirstVisitNote()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: GRADIENT }}
              >
                {fvSaving ? 'Saving…' : 'Save Progress Note'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
