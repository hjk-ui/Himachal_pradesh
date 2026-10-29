'use client';

import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  RISK_ATTESTATION_MAX,
  RISK_ATTESTATION_MIN,
  RISK_ATTESTATION_PREFIX,
  STIGMA_PANEL_COPY,
  detectStigmaWording,
  detectTranscriptRisk,
  validateRiskAttestationReason,
} from '@/lib/scribe-safety/transcriptRiskGate';

type Props = {
  /** Transcript (or drafted note text) to scan. */
  text: string;
  /** Clinician's reason — the words after the fixed prefix. */
  reason: string;
  onReasonChange: (reason: string) => void;
  disabled?: boolean;
};

/** Shown beside the scribe draft. Renders nothing when there is no risk language and no wording to review. */
export function RiskLanguagePanel({ text, reason, onReasonChange, disabled = false }: Props) {
  const scan = useMemo(() => detectTranscriptRisk(text), [text]);
  const wording = useMemo(() => detectStigmaWording(text), [text]);
  const checked = useMemo(() => validateRiskAttestationReason(reason), [reason]);

  if (!scan.flagged && wording.length === 0) return null;

  const trimmedLength = reason.trim().length;
  const showError = scan.flagged && trimmedLength > 0 && checked.ok === false;

  return (
    <section
      aria-label={STIGMA_PANEL_COPY.heading}
      className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950"
    >
      <h3 className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="h-4 w-4" aria-hidden />
        {STIGMA_PANEL_COPY.heading}
      </h3>

      {scan.flagged && (
        <div className="mt-2 space-y-2">
          <p>{STIGMA_PANEL_COPY.intro}</p>
          <ul className="list-disc space-y-1 pl-5">
            {scan.matches.map((m) => (
              <li key={m.category}>
                <span className="font-medium">{m.label}:</span> {m.excerpt}
              </li>
            ))}
          </ul>

          <label className="mt-3 block font-medium" htmlFor="risk-attestation-reason">
            {STIGMA_PANEL_COPY.attestationLabel}
          </label>
          <p className="text-xs text-amber-900">{STIGMA_PANEL_COPY.attestationHelp}</p>
          <div className="rounded-lg border border-amber-300 bg-white p-2">
            <span className="text-xs text-slate-500">{RISK_ATTESTATION_PREFIX}</span>
            <textarea
              id="risk-attestation-reason"
              value={reason}
              disabled={disabled}
              maxLength={RISK_ATTESTATION_MAX + 50}
              rows={3}
              placeholder={STIGMA_PANEL_COPY.attestationPlaceholder}
              onChange={(e) => onReasonChange(e.target.value)}
              className="mt-1 w-full resize-y rounded border border-slate-200 p-2 text-sm text-slate-900"
            />
            <div className="mt-1 flex justify-between text-xs">
              <span className={showError ? 'text-red-700' : 'text-slate-500'}>
                {showError && checked.ok === false
                  ? checked.error
                  : `${RISK_ATTESTATION_MIN}–${RISK_ATTESTATION_MAX} characters`}
              </span>
              <span className="text-slate-500">
                {trimmedLength}/{RISK_ATTESTATION_MAX}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="mt-3">
        <h4 className="font-medium">{STIGMA_PANEL_COPY.wordingHeading}</h4>
        {wording.length === 0 ? (
          <p className="text-xs text-amber-900">{STIGMA_PANEL_COPY.noWording}</p>
        ) : (
          <>
            <p className="text-xs text-amber-900">{STIGMA_PANEL_COPY.wordingHelp}</p>
            <ul className="mt-1 space-y-1">
              {wording.map((w) => (
                <li key={w.avoid}>
                  {STIGMA_PANEL_COPY.avoidLabel} <strong>{w.avoid}</strong>, {STIGMA_PANEL_COPY.preferLabel.toLowerCase()}{' '}
                  <strong>{w.prefer}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

export default RiskLanguagePanel;
