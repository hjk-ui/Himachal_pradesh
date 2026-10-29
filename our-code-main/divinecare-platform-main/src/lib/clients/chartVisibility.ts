import type { StaffRole } from '@/types/roles';

const RISK_LEVEL_ONLY = new Set([
  'FRONT_DESK',
  'OFFICE_MANAGER',
  'BILLING',
  'PEER_SUPPORT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'MEDICAL_ASSISTANT',
]);

const PROGRESS_NOTE_ROLES = new Set([
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'THERAPIST',
  'CLINICIAN',
  'PSYCHIATRIST',
  'NP',
  'CASE_MANAGER',
  'PRP_SPECIALIST',
]);

const SCORE_ROLES = new Set([
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'THERAPIST',
  'CLINICIAN',
  'PSYCHIATRIST',
  'NP',
  'CASE_MANAGER',
  'PRP_SPECIALIST',
  'CRISIS_RESPONDER',
]);

const DIAGNOSIS_EDITORS = new Set(['THERAPIST', 'CLINICIAN', 'PSYCHIATRIST', 'NP']);

function roleOf(role: string | null | undefined) {
  return (role || '').toUpperCase();
}

export function canSeeRiskDetail(role: string | null | undefined) {
  const r = roleOf(role);
  return SCORE_ROLES.has(r);
}

/** Chart header for these roles is the risk level only. */
export function bannerShowsRiskOnly(role: string | null | undefined) {
  return RISK_LEVEL_ONLY.has(roleOf(role));
}

export function canSeeCheckInScores(role: string | null | undefined) {
  return SCORE_ROLES.has(roleOf(role));
}

export function canEnterKioskCheckIn(role: string | null | undefined) {
  const r = roleOf(role);
  return r === 'FRONT_DESK' || r === 'OFFICE_MANAGER' || (SCORE_ROLES.has(r) && r !== 'PEER_SUPPORT');
}

export function receivesProgressNoteBody(role: string | null | undefined) {
  const r = roleOf(role);
  if (r === 'FRONT_DESK' || r === 'OFFICE_MANAGER' || r === 'BILLING' || r === 'HR') return false;
  return PROGRESS_NOTE_ROLES.has(r);
}

export function canEditDiagnosis(role: string | null | undefined) {
  return DIAGNOSIS_EDITORS.has(roleOf(role));
}

export function canEditRiskLevel(role: string | null | undefined) {
  const r = roleOf(role);
  return canSeeRiskDetail(role) || r === 'CRISIS_RESPONDER';
}

export function chartTabVisible(role: string | null | undefined, tab: string): boolean {
  const r = roleOf(role);
  if (!r || r === 'HR' || r === 'SUPER_ADMIN') return false;
  if (r === 'PEER_SUPPORT') return tab === 'Overview';
  if (r === 'PHYSICIAN' || r === 'MEDICAL_NP') return tab === 'Overview';
  if (r === 'MEDICAL_ASSISTANT') return tab === 'Overview' || tab === 'Medications';
  if (r === 'CRISIS_RESPONDER') return tab === 'Overview' || tab === 'Alerts' || tab === 'Appointments';

  switch (tab) {
    case 'Overview':
      return true;
    case 'Office Notes':
      return r === 'FRONT_DESK' || r === 'OFFICE_MANAGER' || r === 'ADMIN' || r === 'DIRECTOR' || r === 'PRACTICE_DIRECTOR';
    case 'Check-Ins':
      return canEnterKioskCheckIn(r) || canSeeCheckInScores(r);
    case 'Medications':
      return (
        r === 'THERAPIST' ||
        r === 'CLINICIAN' ||
        r === 'PSYCHIATRIST' ||
        r === 'NP' ||
        r === 'PHYSICIAN' ||
        r === 'MEDICAL_NP' ||
        r === 'MEDICAL_ASSISTANT' ||
        r === 'ADMIN' ||
        r === 'DIRECTOR' ||
        r === 'PRACTICE_DIRECTOR'
      );
    case 'Notes':
      return receivesProgressNoteBody(r);
    case 'Appointments':
      return r !== 'BILLING';
    case 'Alerts':
      return canSeeRiskDetail(r);
    case 'Measures':
      return canSeeCheckInScores(r) && r !== 'PRP_SPECIALIST' && r !== 'CASE_MANAGER';
    case 'Documents':
      return r !== 'BILLING';
    case 'Consents':
      return r === 'FRONT_DESK' || r === 'OFFICE_MANAGER' || r === 'BILLING' || r === 'ADMIN' || r === 'DIRECTOR' || r === 'PRACTICE_DIRECTOR' || PROGRESS_NOTE_ROLES.has(r);
    case 'Eligibility':
      return r === 'FRONT_DESK' || r === 'OFFICE_MANAGER' || r === 'BILLING' || r === 'ADMIN' || r === 'DIRECTOR' || r === 'PRACTICE_DIRECTOR';
    case 'Insurance':
      return r !== 'PEER_SUPPORT';
    default:
      return false;
  }
}

export function isPsychotherapyNote(noteType: string | null | undefined, body: string | null | undefined) {
  const blob = `${noteType || ''} ${body || ''}`;
  return /psychotherapy|process note/i.test(blob);
}

export type ChartRole = StaffRole | string | null | undefined;
