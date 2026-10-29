'use client';

/**
 * AI Scribe transcript risk at signing (src/lib/scribe/riskGate.ts). Shown when the sign was refused
 * because the linked transcript has risk language and the note documents no C-SSRS result, risk
 * level / assessment or safety plan update. The clinician documents the assessment in the note, or
 * records why no further assessment is indicated (min 15 characters; audited).
 */
import { ShieldAlert } from 'lucide-react';
import { RISK_ATTESTATION_MIN, RISK_ATTESTATION_PREFIX, RISK_GATE_CODE } from '@/lib/scribe/riskGate';

/** The sign error is the transcript-risk gate. */
export function isRiskGateError(message: string | null | undefined): boolean {
  return Boolean(message && message.includes(`${RISK_GATE_CODE}:`));
}

/** The error without its machine code (for display). */
export function riskGateMessage(message: string): string {
  return message.replace(new RegExp(`${RISK_GATE_CODE}:\\s*`), '');
}

export function riskAttestationReady(reason: string): boolean {
  return reason.trim().length >= RISK_ATTESTATION_MIN;
}

export function RiskAttestationField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const n = value.trim().length;
  return (
    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
      <p className="flex items-center gap-1.5 font-semibold">
        <ShieldAlert size={14} aria-hidden /> Risk language in the AI Scribe transcript
      </p>
      <p className="mt-1">
        Document the C-SSRS result, the risk level / assessment or the safety plan update in the note, or record why no further assessment is indicated:
      </p>
      <label htmlFor={id} className="mt-2 block font-semibold">
        {RISK_ATTESTATION_PREFIX} …
      </label>
      <textarea
        id={id}
        rows={2}
        maxLength={1000}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="e.g. the statement was a song lyric the client quoted; client denied any thoughts of self-harm when asked."
        className="mt-1 w-full rounded-lg border border-rose-200 bg-white p-2 text-sm text-slate-800"
      />
      <p className="mt-0.5 text-[11px]">{n < RISK_ATTESTATION_MIN ? `At least ${RISK_ATTESTATION_MIN} characters. Recorded with your signature and audited.` : `${n} / 1000 — then sign again.`}</p>
    </div>
  );
}
