'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, Mail, Phone, UserPlus } from 'lucide-react';
import { Alert, Button, inputClasses } from '@/components/ui';
import { AGE_GROUPS, AVAILABILITY_DAYS, AVAILABILITY_TIMES, CLOSE_REASONS, CONTACT_METHODS, CONTACT_OUTCOMES, NO_RESPONSE_PROMPT_AT, OPEN_STAGES } from '@/lib/waitlist/standard';
import {
  closeWaitlistEntry,
  fetchWaitlistEntry,
  logWaitlistContact,
  reopenWaitlistEntry,
  updateWaitlistEntry,
  type WaitlistContact,
  type WaitlistEntry,
} from '@/features/waitlist/api';
import {
  CrisisGuidance,
  Drawer,
  Field,
  METHOD_LABEL,
  OUTCOME_LABEL,
  SectionTitle,
  StageBadge,
  UrgencyBadge,
  errorMessage,
  formatDate,
  formatDateTime,
  formatYmd,
} from './shared';

const label = (list: readonly (readonly [string, string])[], k: string | null | undefined) => list.find(([v]) => v === k)?.[1] ?? k ?? '';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return null;
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 py-1 text-sm">
      <dt className="text-slate-500">{k}</dt>
      <dd className="min-w-0 break-words text-slate-900">{v}</dd>
    </div>
  );
}

function plusDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Entry details, contact log with outcome + next follow-up, and close / reopen. */
export function EntryDetailDrawer({
  entryId,
  locations,
  canManage,
  canEdit,
  onClose,
  onChanged,
  onEdit,
  onSchedule,
  onConvertOnly,
}: {
  entryId: string;
  locations: { id: string; name: string }[];
  canManage: boolean;
  canEdit: boolean;
  onClose: () => void;
  onChanged: (e: WaitlistEntry) => void;
  onEdit: (e: WaitlistEntry) => void;
  onSchedule: (e: WaitlistEntry) => void;
  onConvertOnly: (e: WaitlistEntry) => void;
}) {
  const [entry, setEntry] = useState<WaitlistEntry | null>(null);
  const [contacts, setContacts] = useState<WaitlistContact[]>([]);
  const [error, setError] = useState('');
  const [method, setMethod] = useState('call');
  const [outcome, setOutcome] = useState('no_answer');
  const [note, setNote] = useState('');
  const [nextDate, setNextDate] = useState(plusDays(2));
  const [saving, setSaving] = useState(false);
  const [closePrompt, setClosePrompt] = useState<string | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [closeNote, setCloseNote] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetchWaitlistEntry(entryId);
      setEntry(r.entry);
      setContacts(r.contacts);
    } catch (err) {
      setError(errorMessage(err, 'Could not load entry'));
    }
  }, [entryId]);
  useEffect(() => {
    void load();
  }, [load]);

  const apply = (e: WaitlistEntry) => {
    setEntry(e);
    onChanged(e);
  };

  const logContact = async () => {
    if (!entry) return;
    setSaving(true);
    setError('');
    try {
      const r = await logWaitlistContact(entry.id, { method, outcome, note: note.trim() || null, nextFollowUpAt: nextDate || null });
      apply(r.entry);
      setNote('');
      const c = await fetchWaitlistEntry(entry.id);
      setContacts(c.contacts);
      if (r.promptClose) {
        setClosePrompt(r.promptClose);
        setCloseReason(r.promptClose);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not log contact'));
    } finally {
      setSaving(false);
    }
  };

  const doClose = async () => {
    if (!entry || !closeReason) return;
    setSaving(true);
    try {
      apply(await closeWaitlistEntry(entry.id, closeReason, closeNote));
      setClosePrompt(null);
    } catch (err) {
      setError(errorMessage(err, 'Could not close'));
    } finally {
      setSaving(false);
    }
  };

  const setStage = async (stage: string) => {
    if (!entry) return;
    try {
      const r = await updateWaitlistEntry(entry.id, { stage: stage as WaitlistEntry['stage'] });
      apply(r.entry);
    } catch (err) {
      setError(errorMessage(err, 'Could not update'));
    }
  };

  const reopen = async () => {
    if (!entry) return;
    try {
      apply(await reopenWaitlistEntry(entry.id));
    } catch (err) {
      setError(errorMessage(err, 'Could not reopen'));
    }
  };

  const open = entry ? (OPEN_STAGES as string[]).includes(entry.stage) : false;
  const locNames = entry ? entry.preferredLocationIds.map((id) => locations.find((l) => l.id === id)?.name ?? 'Unknown site').join(', ') : '';

  return (
    <Drawer
      title={entry ? entry.name : 'Waitlist entry'}
      subtitle={entry ? <span className="inline-flex flex-wrap items-center gap-2"><StageBadge stage={entry.stage} closeReason={entry.closeReason} /> <UrgencyBadge urgency={entry.urgency} safety={entry.safetyScreen} /> <span>{entry.daysWaiting} days waiting</span></span> : null}
      onClose={onClose}
      wide
      footer={
        entry && canManage ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            {open ? (
              <>
                <Button variant="secondary" onClick={() => { setClosePrompt('manual'); setCloseReason(''); }}>
                  Close entry
                </Button>
                <Button variant="secondary" icon={<UserPlus size={16} />} onClick={() => onConvertOnly(entry)}>
                  Convert without scheduling
                </Button>
                <Button icon={<CalendarPlus size={16} />} onClick={() => onSchedule(entry)}>
                  Schedule
                </Button>
              </>
            ) : entry.stage === 'CLOSED' ? (
              <Button variant="secondary" onClick={reopen}>
                Reopen
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {error ? <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {!entry ? (
        <p className="text-sm text-slate-500">Loading...</p>
      ) : (
        <>
          {entry.safetyScreen === 'yes' && open ? <CrisisGuidance className="mb-4" /> : null}
          {(!entry.safetyScreen || entry.safetyScreen === 'not_asked') && open ? (
            <Alert tone="warning" className="mb-4" title="Safety screen not asked yet">
              Ask on first contact, then record the answer with Edit.
            </Alert>
          ) : null}
          {closePrompt ? (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-900">
                {closePrompt === 'no_response'
                  ? `${NO_RESPONSE_PROMPT_AT} or more attempts with no response. Close as "No response"?`
                  : closePrompt === 'declined'
                    ? 'The person declined services. Close the entry?'
                    : 'Close this entry'}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <select className={inputClasses} value={closeReason} onChange={(e) => setCloseReason(e.target.value)} aria-label="Close reason">
                  <option value="">Pick a reason</option>
                  {CLOSE_REASONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
                <input className={inputClasses} value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="Note (optional)" maxLength={500} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="danger" disabled={!closeReason} loading={saving} onClick={doClose}>
                  Close entry
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setClosePrompt(null)}>
                  Keep open
                </Button>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {entry.phone ? (
              <a href={`tel:${entry.phone.replace(/[^\d+]/g, '')}`} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Phone size={15} /> {entry.phone}
              </a>
            ) : null}
            {entry.email ? (
              <a href={`mailto:${entry.email}`} className="inline-flex min-h-10 max-w-full items-center gap-2 truncate rounded-lg border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50">
                <Mail size={15} /> <span className="truncate">{entry.email}</span>
              </a>
            ) : null}
            {canEdit ? (
              <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                Edit
              </Button>
            ) : null}
            {entry.convertedClientId ? (
              <Link href={`/dashboard/clients/${entry.convertedClientId}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                Open chart
              </Link>
            ) : null}
            {entry.convertedAppointmentId ? (
              <Link href={`/dashboard/appointments?appt=${entry.convertedAppointmentId}`} className="inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-semibold text-blue-700 hover:bg-blue-50">
                Open appointment
              </Link>
            ) : null}
          </div>

          <SectionTitle>Details</SectionTitle>
          <dl>
            <Row k="Date of birth" v={formatYmd(entry.dateOfBirth)} />
            <Row k="Age group" v={label(AGE_GROUPS, entry.ageGroup)} />
            <Row k="Service" v={entry.specialty} />
            <Row k="Contact" v={[entry.preferredContactMethod, entry.bestTimeToContact].filter(Boolean).join(' · ')} />
            <Row k="Guardian" v={[entry.guardianName, entry.guardianRelationship, entry.guardianPhone].filter(Boolean).join(' · ')} />
            <Row k="Locations" v={locNames} />
            <Row k="Telehealth OK" v={entry.telehealthOk == null ? '' : entry.telehealthOk ? 'Yes' : 'No'} />
            <Row k="Availability" v={[entry.availabilityDays.map((d) => label(AVAILABILITY_DAYS, d)).join(', '), entry.availabilityTimes.map((t) => label(AVAILABILITY_TIMES, t)).join(', ')].filter(Boolean).join(' · ')} />
            <Row k="Preferences" v={[entry.preferredClinician, entry.clinicianGenderPref ? `${entry.clinicianGenderPref} clinician` : null, entry.languagePref].filter(Boolean).join(' · ')} />
            <Row k="Insurance" v={[entry.insurancePayer, entry.insuranceMemberId ? `ID ${entry.insuranceMemberId}` : null].filter(Boolean).join(' · ')} />
            <Row k="Referral" v={[entry.referralSource, entry.referringProvider].filter(Boolean).join(' · ')} />
            <Row k="Concern" v={entry.presentingConcern} />
            <Row k="Matched clinician" v={entry.clinicianName} />
            <Row k="Added" v={formatDate(entry.createdAt, { year: 'numeric' })} />
            <Row k="Notes" v={entry.notes} />
          </dl>

          {open && canManage ? (
            <>
              <SectionTitle>Stage</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {(['NEW', 'CONTACTED', 'INTAKE_SENT', 'READY'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStage(s)}
                    className={`min-h-10 rounded-lg border px-3 text-sm ${entry.stage === s ? 'border-blue-600 bg-blue-50 font-semibold text-blue-800' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                  >
                    {s === 'NEW' ? 'New' : s === 'CONTACTED' ? 'Contacted' : s === 'INTAKE_SENT' ? 'Intake sent' : 'Ready to schedule'}
                  </button>
                ))}
              </div>

              <SectionTitle>Log a contact attempt</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Method">
                  <select className={inputClasses} value={method} onChange={(e) => setMethod(e.target.value)}>
                    {CONTACT_METHODS.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Outcome">
                  <select className={inputClasses} value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                    {CONTACT_OUTCOMES.map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Next follow-up">
                  <input type="date" className={inputClasses} value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
                </Field>
                <Field label="Note (optional)">
                  <input className={inputClasses} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
                </Field>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Button size="sm" onClick={logContact} loading={saving}>
                  Log attempt
                </Button>
                <span className="text-xs text-slate-500">
                  Unanswered in a row: {entry.noResponseCount}. Text messages are not available yet (SMS registration pending).
                </span>
              </div>
            </>
          ) : null}

          <SectionTitle>Contact log</SectionTitle>
          {contacts.length ? (
            <ol className="space-y-2">
              {contacts.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 p-2 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">
                      {METHOD_LABEL[c.method] ?? c.method}: {OUTCOME_LABEL[c.outcome] ?? c.outcome}
                    </span>
                    <span className="text-xs text-slate-500">{formatDateTime(c.createdAt)}</span>
                  </div>
                  {c.note ? <p className="mt-1 break-words text-slate-700">{c.note}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">
                    {c.createdByName ? `By ${c.createdByName}` : ''}
                    {c.nextFollowUpAt ? ` · Follow up ${formatDate(c.nextFollowUpAt, undefined, 'UTC')}` : ''}
                  </p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-500">No contact attempts yet.</p>
          )}
        </>
      )}
    </Drawer>
  );
}
