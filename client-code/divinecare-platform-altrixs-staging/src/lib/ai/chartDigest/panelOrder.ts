/**
 * Section order for the in-session "Chart history" side tab (note editor side panel, telehealth
 * in-call drawer). Pure; safe to import in the browser.
 *
 * Audience-first (same split as the pre-visit brief, see briefFacts.ts / previsit audienceFor):
 *  - prescriber (canPrescribe): medication trials, risk, medical first;
 *  - therapist (everyone else): therapy & goals, risk, trauma first.
 * Every section is still listed (nothing hidden); only the order and which open by default differ.
 */
import { canPrescribe } from '@/types/roles';
import { DIGEST_KIND_LABEL, canViewChartDigest, digestKindsFor, medicalAudienceFor, type DigestKind, type MedicalAudience } from '@/lib/ai/chartDigest/access';
import { MEDICAL_SECTION_LABEL, type MedicalPanelSection } from '@/lib/ai/chartDigest/medical/types';
import type { ChartHistoryAudience } from '@/lib/ai/chartDigest/briefFacts';
import type { ItemSection } from '@/lib/ai/chartDigest/types';

export type PanelSection = ItemSection | 'medicationTrials';

export const PANEL_SECTION_LABEL: Record<PanelSection, string> = {
  medicationTrials: 'Medication trials',
  riskHistory: 'Risk history',
  hospitalizations: 'Hospitalizations / ER / residential',
  diagnoses: 'Diagnoses timeline',
  substanceUse: 'Substance use',
  trauma: 'Trauma (summary)',
  therapy: 'Therapy & goals',
  openItems: 'Open items',
  medical: 'Medical / allergies',
  socialFunctional: 'Legal / social / functional',
};

export const PANEL_ORDER: Record<ChartHistoryAudience, PanelSection[]> = {
  prescriber: ['medicationTrials', 'riskHistory', 'medical', 'diagnoses', 'hospitalizations', 'substanceUse', 'openItems', 'therapy', 'trauma', 'socialFunctional'],
  therapist: ['therapy', 'riskHistory', 'trauma', 'openItems', 'diagnoses', 'hospitalizations', 'substanceUse', 'socialFunctional', 'medicationTrials', 'medical'],
};

/** Sections expanded when the tab opens (the rest start collapsed) */
export const PANEL_OPEN_BY_DEFAULT: Record<ChartHistoryAudience, PanelSection[]> = {
  prescriber: ['medicationTrials', 'riskHistory', 'medical'],
  therapist: ['therapy', 'riskHistory', 'trauma'],
};

export function panelAudience(role: string | null | undefined): ChartHistoryAudience {
  return canPrescribe(role) ? 'prescriber' : 'therapist';
}

export function chartHistoryPanelSections(role: string | null | undefined): { key: PanelSection; label: string; defaultOpen: boolean }[] {
  const a = panelAudience(role);
  const open = new Set(PANEL_OPEN_BY_DEFAULT[a]);
  return PANEL_ORDER[a].map((key) => ({ key, label: PANEL_SECTION_LABEL[key], defaultOpen: open.has(key) }));
}

/**
 * Show the session tab at all? Mirrors the API's role gate (access.ts canViewChartDigest) so roles the
 * API always denies never see the tab; any 403 from the GET (care team, protected record) also hides it.
 */
export function canSeeChartHistoryTab(role: string | null | undefined): boolean {
  return canViewChartDigest(role, 'bh');
}

// ─── Medical (primary care) digest ───────────────────────────────────────────

/**
 * Audience-first order for the medical digest. Provider (physician / NP, BH prescriber, leadership):
 * problems, medications, allergies, labs first. Medical assistant: the minimum-necessary subset only
 * (the API sends nothing else; this order just lays it out).
 */
export const MEDICAL_PANEL_ORDER: Record<MedicalAudience, MedicalPanelSection[]> = {
  provider: ['problems', 'medicationTrials', 'allergies', 'labs', 'vitals', 'preventiveDue', 'openItems', 'hospitalizations', 'referrals', 'preventive', 'socialFunctional', 'bhSummary'],
  ma: ['allergies', 'medicationTrials', 'vitals', 'preventiveDue'],
};

export const MEDICAL_PANEL_OPEN_BY_DEFAULT: Record<MedicalAudience, MedicalPanelSection[]> = {
  provider: ['problems', 'medicationTrials', 'allergies', 'labs'],
  ma: ['allergies', 'medicationTrials', 'vitals', 'preventiveDue'],
};

export function medicalHistoryPanelSections(role: string | null | undefined): { key: MedicalPanelSection; label: string; defaultOpen: boolean }[] {
  const a = medicalAudienceFor(role);
  const open = new Set(MEDICAL_PANEL_OPEN_BY_DEFAULT[a]);
  return MEDICAL_PANEL_ORDER[a].map((key) => ({ key, label: MEDICAL_SECTION_LABEL[key], defaultOpen: open.has(key) }));
}

/** Medical history tab: roles the API always denies never see it; a 403 / 404 (not primary care) hides it */
export function canSeeMedicalHistoryTab(role: string | null | undefined): boolean {
  return canViewChartDigest(role, 'medical');
}

/** One side tab per digest kind this viewer may open for this patient (BH first) */
export function chartHistoryTabsFor(role: string | null | undefined, patient: { primaryCare: boolean }): { kind: DigestKind; label: string }[] {
  return digestKindsFor(role, patient).map((kind) => ({ kind, label: DIGEST_KIND_LABEL[kind] }));
}
