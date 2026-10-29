'use client';

/**
 * PRP progress note contact fields (src/lib/prp/progressNote.ts). One note per contact: date and
 * start / end time are the note's own fields (prefilled from the appointment); this panel records
 * contact type, location, who took part, the IRP objectives addressed, interventions, progress,
 * collaboration, the participant's signature, and shows the next booked appointment.
 */
import Link from 'next/link';
import { AlertTriangle, CalendarPlus, ClipboardList, PenLine, RotateCcw } from 'lucide-react';
import { pillBtn, inputCls } from '@/components/notes/structuredNoteUi';
import { bookFollowUpHref } from '@/components/visits/visitGuideHelpers';
import {
  PRP_COLLABORATORS,
  PRP_CONTACT_TYPES,
  PRP_INTERVENTIONS,
  PRP_NOTE_LOCATIONS,
  PRP_PARTICIPANT_ATTESTATION,
  PRP_PARTICIPANTS,
  PRP_PROGRESS,
  PRP_SIGNATURE_REASONS,
  irpWarnings,
  normalizeParticipants,
  type PrpContactType,
  type PrpNoteDetail,
} from '@/lib/prp/progressNote';
import type { PrpNoteContext } from '@/lib/prp/progressNoteDb';

const label = 'text-xs font-semibold text-slate-600';
const group = 'space-y-1.5';

export function PrpNoteFields({
  value,
  onChange,
  context,
  contactType,
  onContactType,
  clientId,
  dateOfService,
  disabled,
}: {
  value: PrpNoteDetail;
  onChange: (next: PrpNoteDetail) => void;
  context: PrpNoteContext | null;
  contactType: PrpContactType;
  onContactType: (t: PrpContactType) => void;
  clientId: string;
  dateOfService: string;
  disabled?: boolean;
}) {
  const set = <K extends keyof PrpNoteDetail>(key: K, v: PrpNoteDetail[K]) => onChange({ ...value, [key]: v });
  const toggle = <T extends string>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const objectives = context?.irp.objectives ?? [];
  const selectedKeys = new Set(value.objectives.map((o) => o.key));
  const warnings = context ? irpWarnings(context.irp) : [];
  const suggestion = context?.suggestedObjectives ?? [];
  const next = context?.nextAppointment ?? null;

  return (
    <fieldset className="space-y-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3" disabled={disabled}>
      <legend className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-[#5C2D91]">
        <ClipboardList size={13} aria-hidden /> PRP contact
      </legend>

      {warnings.length ? (
        <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900" role="status">
          {warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
          <Link href={`/dashboard/prp/irp?clientId=${encodeURIComponent(clientId)}`} className="font-semibold underline">
            Open the IRP
          </Link>
        </div>
      ) : null}

      <div className={group}>
        <p className={label}>Contact type</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Contact type">
          {PRP_CONTACT_TYPES.map((t) => (
            <button key={t.value} type="button" role="radio" aria-checked={contactType === t.value} className={pillBtn(contactType === t.value)} onClick={() => onContactType(t.value)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={group}>
        <p className={label}>Location</p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Location">
          {PRP_NOTE_LOCATIONS.map((l) => (
            <button key={l.value} type="button" role="radio" aria-checked={value.location === l.value} className={pillBtn(value.location === l.value)} onClick={() => set('location', value.location === l.value ? null : l.value)}>
              {l.label}
            </button>
          ))}
        </div>
        {value.location === 'offsite' ? (
          <input aria-label="Community location" placeholder="Community location (e.g. library, grocery store, client's home)" maxLength={200} value={value.communityLocation ?? ''} onChange={(e) => set('communityLocation', e.target.value || null)} className={inputCls} />
        ) : null}
      </div>

      <div className={group}>
        <p className={label}>Individuals involved (with PRP staff)</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Individuals involved">
          {PRP_PARTICIPANTS.map((p) => {
            const on = value.participants.includes(p.value);
            return (
              <button
                key={p.value}
                type="button"
                aria-pressed={on}
                disabled={p.value === 'patient'}
                title={p.value === 'patient' ? 'Always included' : undefined}
                className={pillBtn(on)}
                onClick={() => set('participants', normalizeParticipants(toggle(value.participants, p.value)))}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        {value.participants.some((p) => p !== 'patient') ? (
          <input aria-label="Other individuals" placeholder="Names / relationship of the others involved" maxLength={200} value={value.participantsOther ?? ''} onChange={(e) => set('participantsOther', e.target.value || null)} className={inputCls} />
        ) : null}
      </div>

      <div className={group}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={label}>IRP objective(s) addressed</p>
          {suggestion.length && !value.objectives.length ? (
            <button type="button" className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#5C2D91] hover:bg-violet-50" onClick={() => set('objectives', suggestion)}>
              <RotateCcw size={12} aria-hidden /> Use objectives from last note{context?.previousNoteDate ? ` (${context.previousNoteDate})` : ''}
            </button>
          ) : null}
        </div>
        {objectives.length ? (
          <ul className="space-y-1">
            {objectives.map((o) => (
              <li key={o.key}>
                <label className="flex min-h-[36px] cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-blue-600"
                    checked={selectedKeys.has(o.key)}
                    onChange={() =>
                      set('objectives', selectedKeys.has(o.key) ? value.objectives.filter((x) => x.key !== o.key) : [...value.objectives, { key: o.key, label: o.label }])
                    }
                  />
                  <span className="min-w-0 break-words">{o.label}</span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">{context ? 'No objectives on the IRP yet.' : 'Loading the IRP…'}</p>
        )}
        <input aria-label="Other issue addressed" placeholder="Other (current issue not on the IRP)" maxLength={500} value={value.objectiveOther ?? ''} onChange={(e) => set('objectiveOther', e.target.value || null)} className={inputCls} />
      </div>

      <div className={group}>
        <p className={label}>Intervention(s) used — describe them in the Intervention section below</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Interventions">
          {PRP_INTERVENTIONS.map((i) => {
            const on = value.interventions.includes(i.value);
            return (
              <button key={i.value} type="button" aria-pressed={on} className={pillBtn(on)} onClick={() => set('interventions', toggle(value.interventions, i.value))}>
                {i.label}
              </button>
            );
          })}
        </div>
      </div>

      <label className={`block ${label}`}>
        Progress toward the objective(s) — describe the response in Participant Response below
        <select aria-label="Progress toward objectives" value={value.progress ?? ''} onChange={(e) => set('progress', (e.target.value || null) as PrpNoteDetail['progress'])} className={`mt-1 ${inputCls}`}>
          <option value="">Select…</option>
          {PRP_PROGRESS.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </label>

      <div className={group}>
        <p className={label}>Communication or collaboration with</p>
        <div className="flex flex-wrap gap-1.5" aria-label="Collaboration">
          {PRP_COLLABORATORS.map((c) => {
            const on = value.collaboration.includes(c.value);
            return (
              <button key={c.value} type="button" aria-pressed={on} className={pillBtn(on)} onClick={() => set('collaboration', toggle(value.collaboration, c.value))}>
                {c.label}
              </button>
            );
          })}
        </div>
        {value.collaboration.length ? (
          <input aria-label="Collaboration note" placeholder="Who, and what was communicated" maxLength={500} value={value.collaborationNote ?? ''} onChange={(e) => set('collaborationNote', e.target.value || null)} className={inputCls} />
        ) : null}
      </div>

      <div className={`${group} rounded-lg border border-slate-200 bg-white p-2.5`}>
        <p className={`flex items-center gap-1.5 ${label}`}>
          <PenLine size={13} aria-hidden /> Participant signature
        </p>
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Participant signature">
          <button type="button" role="radio" aria-checked={value.patientSignatureStatus === 'signed'} className={pillBtn(value.patientSignatureStatus === 'signed', 'good')} onClick={() => set('patientSignatureStatus', 'signed')}>
            Sign on this device
          </button>
          <button type="button" role="radio" aria-checked={value.patientSignatureStatus === 'not_obtained'} className={pillBtn(value.patientSignatureStatus === 'not_obtained', 'warn')} onClick={() => set('patientSignatureStatus', 'not_obtained')}>
            Unable to obtain
          </button>
        </div>
        {value.patientSignatureStatus === 'signed' ? (
          <div className="space-y-1">
            <p className="text-xs text-slate-600">Hand the device to the participant: {PRP_PARTICIPANT_ATTESTATION} They type their full name to sign.</p>
            <input aria-label="Participant signature (typed full name)" placeholder="Participant types full name" maxLength={120} value={value.patientSignatureName ?? ''} onChange={(e) => set('patientSignatureName', e.target.value || null)} className={`${inputCls} text-base italic`} style={{ fontFamily: 'cursive' }} />
            {value.patientSignedAt ? <p className="text-[11px] text-slate-500">Signed {new Date(value.patientSignedAt).toLocaleString()}</p> : null}
          </div>
        ) : null}
        {value.patientSignatureStatus === 'not_obtained' ? (
          <div className="space-y-1">
            <select aria-label="Reason the signature was not obtained" value={value.patientSignatureReason ?? ''} onChange={(e) => set('patientSignatureReason', (e.target.value || null) as PrpNoteDetail['patientSignatureReason'])} className={inputCls}>
              <option value="">Reason…</option>
              {PRP_SIGNATURE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            {value.patientSignatureReason === 'other' ? (
              <input aria-label="Other reason" placeholder="Explain" maxLength={300} value={value.patientSignatureReasonOther ?? ''} onChange={(e) => set('patientSignatureReasonOther', e.target.value || null)} className={inputCls} />
            ) : null}
          </div>
        ) : null}
        <p className="text-[11px] text-slate-500">PRP staff signature: your electronic signature (name, credentials, date) is applied when you sign the note.</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2.5 text-sm">
        <p className="min-w-0 text-slate-700">
          <span className="font-semibold">Follow-up: </span>
          {next
            ? `${new Date(next.startsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · ${next.type}${next.clinicianName ? ` · ${next.clinicianName}` : ''}`
            : context
              ? 'No appointment booked.'
              : '…'}
        </p>
        <Link
          href={bookFollowUpHref({ clientId, days: null, from: dateOfService, type: null })}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <CalendarPlus size={13} aria-hidden /> Book follow-up
        </Link>
      </div>
    </fieldset>
  );
}
