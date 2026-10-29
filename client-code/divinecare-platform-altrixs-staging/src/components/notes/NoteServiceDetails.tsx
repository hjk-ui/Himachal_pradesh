'use client';

import { Stethoscope, Video } from 'lucide-react';
import type { ServiceContext, ServiceDetail } from '@/lib/notes/serviceDetail';

/**
 * Billing / compliance elements that are not note text: session clock times, telehealth modality,
 * where the client was, telehealth consent, and the chart diagnoses this visit addressed (pointer
 * order). Values default from the linked appointment; nothing is guessed.
 */
export function NoteServiceDetails({
  value,
  onChange,
  context,
  telehealth,
  showTimes,
  disabled,
}: {
  value: ServiceDetail;
  onChange: (next: ServiceDetail) => void;
  context: ServiceContext | null;
  telehealth: boolean;
  /** Structured templates record start / end time in their own Session section */
  showTimes: boolean;
  disabled?: boolean;
}) {
  const set = <K extends keyof ServiceDetail>(key: K, v: ServiceDetail[K]) => onChange({ ...value, [key]: v });
  const coded = (context?.diagnoses || []).filter((d) => d.code);
  const uncoded = (context?.diagnoses || []).filter((d) => !d.code);
  const toggleDx = (code: string) => {
    const has = value.diagnosisCodes.includes(code);
    set('diagnosisCodes', has ? value.diagnosisCodes.filter((c) => c !== code) : [...value.diagnosisCodes, code]);
  };
  const input = 'mt-1 w-full rounded-xl border border-slate-200 p-2 text-sm disabled:opacity-60';

  return (
    <fieldset className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" disabled={disabled}>
      <legend className="flex items-center gap-1.5 px-1 text-xs font-bold uppercase tracking-wide text-[#5C2D91]">
        <Stethoscope size={13} aria-hidden /> Service details (billing)
      </legend>
      {showTimes ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold text-slate-600">
            Start time
            <input type="time" aria-label="Start time" value={value.startTime || ''} onChange={(e) => set('startTime', e.target.value || null)} className={input} />
          </label>
          <label className="text-xs font-semibold text-slate-600">
            End time
            <input type="time" aria-label="End time" value={value.endTime || ''} onChange={(e) => set('endTime', e.target.value || null)} className={input} />
          </label>
        </div>
      ) : null}

      {telehealth ? (
        <div className="mt-3 space-y-2 rounded-lg border border-blue-100 bg-blue-50/50 p-2.5">
          <p className="flex items-center gap-1.5 text-xs font-bold text-blue-800">
            <Video size={13} aria-hidden /> Telehealth
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-slate-700" role="radiogroup" aria-label="Telehealth modality">
            {(
              [
                ['audio_video', 'Audio and video'],
                ['audio_only', 'Audio only'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5">
                <input type="radio" name="telehealth-modality" checked={value.telehealthModality === k} onChange={() => set('telehealthModality', k)} className="accent-[#5C2D91]" />
                {label}
              </label>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-600">
              Client was at
              <select aria-label="Client location" value={value.patientLocationType || ''} onChange={(e) => set('patientLocationType', (e.target.value || null) as ServiceDetail['patientLocationType'])} className={input}>
                <option value="">Select…</option>
                <option value="home">Home (POS 10)</option>
                <option value="other">Other location (POS 02)</option>
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Client&apos;s state during session
              <input
                aria-label="Client state"
                value={value.patientLocationState || ''}
                maxLength={2}
                placeholder="MD"
                onChange={(e) => set('patientLocationState', e.target.value.toUpperCase().replace(/[^A-Z]/g, '') || null)}
                className={input}
              />
            </label>
          </div>
          <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={value.telehealthConsent === true} onChange={(e) => set('telehealthConsent', e.target.checked)} className="mt-0.5 accent-[#5C2D91]" />
            Client&apos;s telehealth consent is on file or was obtained today.
          </label>
        </div>
      ) : null}

      <div className="mt-3">
        <p className="text-xs font-semibold text-slate-600">Diagnoses addressed (claim pointer order)</p>
        {coded.length === 0 ? (
          <p className="mt-1 text-xs text-amber-700">
            No coded diagnosis on the chart. Add the diagnosis on the client&apos;s chart (Diagnoses) so it can be linked; billable notes need one before signing.
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {coded.map((d) => {
              const idx = value.diagnosisCodes.indexOf(d.code as string);
              return (
                <li key={d.code}>
                  <label className="flex items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={idx >= 0} onChange={() => toggleDx(d.code as string)} className="accent-[#5C2D91]" />
                    <span className="font-mono text-xs font-bold text-slate-800">{d.code}</span>
                    <span className="truncate">{d.label}</span>
                    {d.rank === 'primary' ? <span className="rounded bg-violet-100 px-1.5 text-[11px] font-semibold text-[#5C2D91]">Chart primary</span> : null}
                    {d.status === 'PROVISIONAL' ? <span className="rounded bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800">Provisional</span> : null}
                    {idx >= 0 ? <span className="ml-auto rounded bg-slate-200 px-1.5 text-[11px] font-semibold text-slate-700">#{idx + 1}</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {context && value.diagnosisCodes.filter((c) => !coded.some((d) => d.code === c)).length ? (
          <div className="mt-1 text-[11px] text-amber-800">
            Linked but no longer current on the diagnosis list:{' '}
            {value.diagnosisCodes
              .filter((c) => !coded.some((d) => d.code === c))
              .map((c) => (
                <button key={c} type="button" disabled={disabled} onClick={() => toggleDx(c)} className="mr-1 rounded border border-amber-300 px-1 font-mono hover:bg-amber-50" aria-label={`Unlink ${c}`}>
                  {c} (unlink)
                </button>
              ))}
          </div>
        ) : null}
        {uncoded.length ? (
          <p className="mt-1 text-[11px] text-slate-500">Not linkable (no ICD-10 code on the chart): {uncoded.map((d) => d.label).join(', ')}</p>
        ) : null}
      </div>
    </fieldset>
  );
}
