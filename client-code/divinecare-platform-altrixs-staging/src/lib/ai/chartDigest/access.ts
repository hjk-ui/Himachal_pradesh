/**
 * Who sees which chart history digest. Pure and browser-safe: the API (service.ts,
 * medical/service.ts) and the browser mirror (panelOrder.ts) both import these rules, so a tab is
 * never shown to a role the API always refuses.
 *
 * Two digests per client (ClientChartDigest.kind):
 *  - 'bh'      behavioral health history: brief roles that read BH chart notes (leadership and
 *              licensed BH clinicians). Never primary-care roles, HR, billing, front desk, peer support.
 *  - 'medical' primary-care history (primary-care patients only): primary-care providers, BH
 *              prescribers (integrated care: labs, allergies, medical meds) and leadership.
 *              The medical assistant sees a minimum-necessary subset only (allergies, medications,
 *              vitals, preventive care due): never the full history, never the behavioral health summary.
 * Regenerate: BH = licensed BH clinicians; medical = primary-care providers. Both also need the
 * client's care team (checked server side).
 */
import { canAccessClientChartNotes, canRequestClientBriefing } from '@/lib/clients/orgScope';

export type DigestKind = 'bh' | 'medical';
export const DIGEST_KINDS: readonly DigestKind[] = ['bh', 'medical'];

export const DIGEST_KIND_LABEL: Record<DigestKind, string> = {
  bh: 'Behavioral health history',
  medical: 'Medical history',
};

const LICENSED_BH = new Set(['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP']);
const PRIMARY_CARE_PROVIDERS = new Set(['PHYSICIAN', 'MEDICAL_NP']);
const MEDICAL_VIEWERS = new Set(['PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT', 'PSYCHIATRIST', 'NP', 'ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);

const up = (role: string | null | undefined) => String(role ?? '').toUpperCase();

export function parseDigestKind(v: unknown): DigestKind | null {
  return v === 'bh' || v === 'medical' ? v : null;
}

/** View one kind of digest (the chart gate and, for medical, the primary-care patient check still apply) */
export function canViewChartDigest(role: string | null | undefined, kind: DigestKind = 'bh'): boolean {
  if (!role) return false;
  if (kind === 'medical') return MEDICAL_VIEWERS.has(up(role));
  return canRequestClientBriefing(role) && canAccessClientChartNotes(role);
}

/** Any digest at all (the route's first gate) */
export function canViewAnyChartDigest(role: string | null | undefined): boolean {
  return canViewChartDigest(role, 'bh') || canViewChartDigest(role, 'medical');
}

/** Regenerate (care-team link checked separately) */
export function canGenerateChartDigest(role: string | null | undefined, kind: DigestKind = 'bh'): boolean {
  return kind === 'medical' ? PRIMARY_CARE_PROVIDERS.has(up(role)) : LICENSED_BH.has(up(role));
}

/** Medical digest audience: 'ma' = minimum-necessary subset; 'provider' = full medical history */
export type MedicalAudience = 'provider' | 'ma';
export function medicalAudienceFor(role: string | null | undefined): MedicalAudience {
  return up(role) === 'MEDICAL_ASSISTANT' ? 'ma' : 'provider';
}

/**
 * Tabs for this viewer and patient, in display order. BH: whenever the role may read BH history
 * (unchanged behaviour). Medical: only for primary-care patients. A patient who is both, viewed by a
 * BH prescriber or leadership, gets both tabs; primary-care roles never read BH history, so they get
 * the medical tab only (with its minimum-necessary behavioral health summary).
 */
export function digestKindsFor(role: string | null | undefined, patient: { primaryCare: boolean }): DigestKind[] {
  const out: DigestKind[] = [];
  const medical = patient.primaryCare && canViewChartDigest(role, 'medical');
  if (canViewChartDigest(role, 'bh')) out.push('bh');
  if (medical) out.push('medical');
  return out;
}

/** Default kind when a request names none: BH for BH readers (backward compatible), else medical */
export function defaultDigestKind(role: string | null | undefined): DigestKind {
  return canViewChartDigest(role, 'bh') ? 'bh' : 'medical';
}

/** scripts/chart-digest.ts --kind: bh (default) | medical | auto (by patient type) */
export type ScriptKindArg = 'bh' | 'medical' | 'auto';
export function parseScriptKind(v: string | null | undefined): ScriptKindArg | null {
  const k = String(v ?? 'bh').trim().toLowerCase();
  return k === 'bh' || k === 'medical' || k === 'auto' ? k : null;
}

/** auto: primary-care patients get the medical digest, BH patients the BH one, both get both */
export function kindsForScript(arg: ScriptKindArg, patient: { primaryCare: boolean; behavioral: boolean }): DigestKind[] {
  if (arg === 'bh') return ['bh'];
  if (arg === 'medical') return patient.primaryCare ? ['medical'] : [];
  const out: DigestKind[] = [];
  if (patient.behavioral || !patient.primaryCare) out.push('bh');
  if (patient.primaryCare) out.push('medical');
  return out;
}
