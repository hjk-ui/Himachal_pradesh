'use client';

/**
 * Recording-consent attestation before any capture (Maryland all-party consent,
 * Md. Cts. & Jud. Proc. §10-402). One row per person who can be heard; capture cannot start
 * until each one agreed, the script was read and the clinician confirms everyone is listed.
 * The server re-validates the same rules (src/lib/scribe/consent.ts) and stores who / when.
 */
import { useState } from 'react';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import {
  CONSENT_METHODS,
  MD_RECORDING_STATUTE,
  PARTICIPANT_LABELS,
  PARTICIPANT_ROLES,
  RECORDING_CONSENT_SCRIPT,
  validateRecordingConsent,
  type CaptureMode,
  type ConsentMethod,
  type ConsentParticipant,
  type RecordingConsentInput,
} from '@/lib/scribe/consent';

export function ConsentGate({
  mode,
  busy,
  onConfirm,
}: {
  mode: CaptureMode;
  busy: boolean;
  onConfirm: (consent: RecordingConsentInput) => void;
}) {
  const [method, setMethod] = useState<ConsentMethod>('verbal');
  const [participants, setParticipants] = useState<ConsentParticipant[]>([{ role: 'CLIENT', consented: false }]);
  const [allParties, setAllParties] = useState(false);
  const [scriptRead, setScriptRead] = useState(false);
  const [clinicianOnly, setClinicianOnly] = useState(false);
  const input: RecordingConsentInput = { method, participants, allPartiesConfirmed: allParties, scriptRead, clinicianOnly };
  const check = validateRecordingConsent(mode, input);

  if (mode === 'dictation') {
    return (
      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input type="checkbox" className="mt-1" checked={clinicianOnly} onChange={(e) => setClinicianOnly(e.target.checked)} />
          Only my voice will be captured: the client and other people are not present or cannot be heard.
        </label>
        <button
          type="button"
          disabled={!check.ok || busy}
          onClick={() => onConfirm(input)}
          className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
        >
          <ShieldCheck size={16} /> Confirm and continue
        </button>
      </div>
    );
  }

  const update = (i: number, patch: Partial<ConsentParticipant>) => setParticipants((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <div>
        <p className="text-sm font-semibold text-slate-900">Recording consent (required)</p>
        <p className="text-xs text-slate-600">
          Maryland requires every person in the conversation to agree before it is recorded or transcribed ({MD_RECORDING_STATUTE}). Read this to the client and anyone else present:
        </p>
      </div>
      <blockquote className="rounded-lg border-l-4 border-[#5C2D91]/40 bg-white px-3 py-2 text-sm italic text-slate-700">{RECORDING_CONSENT_SCRIPT}</blockquote>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-semibold text-slate-600">Consent given</span>
        {CONSENT_METHODS.map((m) => (
          <label key={m} className="flex items-center gap-1.5">
            <input type="radio" name="consent-method" checked={method === m} onChange={() => setMethod(m)} />
            {m === 'verbal' ? 'Verbally' : 'In writing'}
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-semibold text-slate-600">Everyone who can be heard</p>
        {participants.map((p, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2">
            <select
              aria-label="Participant role"
              value={p.role}
              onChange={(e) => update(i, { role: e.target.value as ConsentParticipant['role'] })}
              className="rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            >
              {PARTICIPANT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {PARTICIPANT_LABELS[r]}
                </option>
              ))}
            </select>
            <input
              aria-label="Relationship (optional)"
              placeholder="Relationship (optional)"
              value={p.label || ''}
              maxLength={60}
              onChange={(e) => update(i, { label: e.target.value })}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-sm"
            />
            <label className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
              <input type="checkbox" checked={p.consented} onChange={(e) => update(i, { consented: e.target.checked })} />
              Agreed
            </label>
            {participants.length > 1 && (
              <button type="button" aria-label="Remove participant" onClick={() => setParticipants((prev) => prev.filter((_, idx) => idx !== i))} className="rounded p-1 text-slate-400 hover:text-rose-600">
                <Trash2 size={14} />
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setParticipants((prev) => [...prev, { role: 'FAMILY', consented: false }])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#5C2D91] hover:underline"
        >
          <Plus size={12} /> Add a participant
        </button>
      </div>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={scriptRead} onChange={(e) => setScriptRead(e.target.checked)} />I read or explained the statement above.
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1" checked={allParties} onChange={(e) => setAllParties(e.target.checked)} />
        Everyone who can be heard is listed and agreed. If anyone declines, I will not record.
      </label>
      {check.ok === false && <p className="text-xs text-amber-800">{check.message}</p>}
      <button
        type="button"
        disabled={!check.ok || busy}
        onClick={() => onConfirm(input)}
        className="inline-flex items-center gap-2 rounded-xl bg-[#5C2D91] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
      >
        <ShieldCheck size={16} /> Record consent attestation
      </button>
    </div>
  );
}
