/**
 * Transcript risk gates signing. Pure, browser-safe (the sign path, the editor and the quality
 * check apply the same rule).
 *
 * The risk scan of an AI Scribe capture (risk.ts: suicide / self-harm / homicide / abuse /
 * hopelessness, i.e. C-SSRS, duty-to-warn and Maryland mandated-report prompts) is stored on the
 * capture (ScribeCapture.riskFindings: line id, time, category, concept, severity; no quotes).
 * A note linked to a capture with findings — any note type, SOAP / DAP / BIRP / CBT … included —
 * signs only when the note documents a C-SSRS result, a risk level / risk assessment, or a safety
 * plan update, OR the clinician records the attestation "Risk content was reviewed; no further
 * assessment indicated because …" (reason at least 15 characters, audited, stored on the capture).
 * Findings also feed the note quality check's risk flags.
 */
import type { TranscriptRisk } from './risk';

export type PersistedRiskFinding = {
  lineId: string;
  at: string;
  category: string;
  concept: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
};

export const RISK_ATTESTATION_PREFIX = 'Risk content was reviewed; no further assessment indicated because';
export const RISK_ATTESTATION_MIN = 15;
export const RISK_GATE_CODE = 'TRANSCRIPT_RISK';

/** Findings to store on the capture: no quotes (minimum necessary), at most 50. */
export function persistableFindings(risk: Pick<TranscriptRisk, 'findings'>): PersistedRiskFinding[] {
  return risk.findings.slice(0, 50).map((f) => ({ lineId: f.lineId, at: f.at, category: f.category, concept: f.concept, label: f.label, severity: f.severity }));
}

export function parsePersistedFindings(v: unknown): PersistedRiskFinding[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object')
    .map((f): PersistedRiskFinding => ({
      lineId: String(f.lineId ?? ''),
      at: String(f.at ?? ''),
      category: String(f.category ?? ''),
      concept: String(f.concept ?? ''),
      label: String(f.label ?? f.concept ?? ''),
      severity: f.severity === 'high' ? 'high' : f.severity === 'medium' ? 'medium' : 'low',
    }))
    .filter((f) => f.category);
}

const EMPTY_VALUE = /^(not assessed|not documented|none on file|n\/a|-+|\[___\])?$/i;

/** The note documents a C-SSRS result, a risk level / assessment, or a safety plan update. */
export function riskAssessedInNote(body: string): { documented: boolean; by: string | null } {
  const lines = body.split('\n');
  const valueOf = (re: RegExp) =>
    lines
      .map((l) => l.match(re)?.[1]?.trim())
      .find((v) => v != null && !EMPTY_VALUE.test(v));
  const cssrs =
    valueOf(/^\s*C-?SSRS[^:\n]*:\s*(.+)$/i) ??
    (/\b(C-?SSRS|Columbia(?: Suicide Severity Rating Scale)?)\b[^\n]{0,80}\b(negative|positive|screen(ed)?|score[ds]?|no risk|low|moderate|high|completed|administered|\d)\b/i.test(body) ? 'narrative' : undefined);
  if (cssrs) return { documented: true, by: 'C-SSRS result' };
  const level =
    valueOf(/^\s*(?:Overall )?(?:suicide )?risk level:\s*(.+)$/im) ??
    (/\brisk (level|assessment|formulation)\b[^\n]{0,60}\b(low|moderate|high|imminent|minimal|no acute)\b|\b(low|moderate|high|imminent|minimal) (acute |chronic )?(suicide |violence |overall )?risk\b/i.test(body)
      ? 'narrative'
      : undefined);
  if (level) return { documented: true, by: 'risk level / assessment' };
  const safety =
    valueOf(/^\s*Safety plan[^:\n]*:\s*(.+)$/im) ??
    (/\b(safety plan|stanley[- ]brown)\b[^\n]{0,80}\b(reviewed|updated|completed|created|developed|revised|in place|on file|given|provided)\b|\b(reviewed|updated|completed|created|developed|revised)\b[^\n]{0,40}\bsafety plan\b/i.test(body)
      ? 'narrative'
      : undefined);
  if (safety) return { documented: true, by: 'safety plan update' };
  return { documented: false, by: null };
}

export function riskAttestationError(reason: string | null | undefined): string | null {
  const r = stripPrefix(reason ?? '').trim();
  if (r.length < RISK_ATTESTATION_MIN) return `Give the reason no further risk assessment is indicated (at least ${RISK_ATTESTATION_MIN} characters).`;
  return null;
}

function stripPrefix(text: string): string {
  const t = text.trim();
  return t.toLowerCase().startsWith(RISK_ATTESTATION_PREFIX.toLowerCase()) ? t.slice(RISK_ATTESTATION_PREFIX.length).replace(/^[\s:,….]+/, '') : t;
}

/** Full attestation sentence as stored and audited. */
export function riskAttestationText(reason: string): string {
  return `${RISK_ATTESTATION_PREFIX} ${stripPrefix(reason).trim().replace(/\.?$/, '.')}`;
}

export function findingSummary(findings: PersistedRiskFinding[]): string {
  const cats = [...new Set(findings.map((f) => CATEGORY_LABEL[f.category] ?? f.category))];
  return cats.join(', ');
}

const CATEGORY_LABEL: Record<string, string> = {
  suicide: 'suicide',
  self_harm: 'self-harm',
  homicide: 'homicide / violence (duty to warn)',
  abuse_danger: 'abuse / danger (mandated report)',
  hopelessness: 'hopelessness',
};

export type RiskGateResult =
  | { blocked: false; findings: number; satisfiedBy: string | null; attestation: string | null; message?: undefined }
  | { blocked: true; findings: number; message: string; satisfiedBy?: undefined; attestation?: undefined };

/**
 * Sign gate. `existingAttestation` = an attestation already recorded on the capture; `attestation`
 * = one sent with this sign request.
 */
export function transcriptRiskGate(input: {
  findings: PersistedRiskFinding[];
  body: string;
  attestation?: string | null;
  existingAttestation?: string | null;
}): RiskGateResult {
  const n = input.findings.length;
  if (!n) return { blocked: false, findings: 0, satisfiedBy: null, attestation: null };
  const doc = riskAssessedInNote(input.body);
  if (doc.documented) return { blocked: false, findings: n, satisfiedBy: doc.by, attestation: null };
  if (input.existingAttestation && !riskAttestationError(input.existingAttestation)) {
    return { blocked: false, findings: n, satisfiedBy: 'attestation on file', attestation: null };
  }
  if (input.attestation != null && input.attestation.trim()) {
    const err = riskAttestationError(input.attestation);
    if (err) return { blocked: true, findings: n, message: `${RISK_GATE_CODE}: ${err}` };
    return { blocked: false, findings: n, satisfiedBy: 'attestation', attestation: riskAttestationText(input.attestation) };
  }
  return {
    blocked: true,
    findings: n,
    message: `${RISK_GATE_CODE}: The AI Scribe transcript has risk language (${findingSummary(input.findings)}). Document a C-SSRS result, the risk level / assessment, or a safety plan update — or record "${RISK_ATTESTATION_PREFIX} …" with your reason.`,
  };
}

/** Plain-language flags for the note quality check. */
export function riskFlagsFromFindings(findings: PersistedRiskFinding[]): string[] {
  if (!findings.length) return [];
  const high = findings.filter((f) => f.severity === 'high').length;
  return [`AI Scribe transcript risk language: ${findingSummary(findings)} (${findings.length} finding${findings.length === 1 ? '' : 's'}${high ? `, ${high} high` : ''})`];
}
