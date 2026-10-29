/**
 * Who may sign each MDH AOT form slot (pure; the API enforces it, the editor uses it to show the button).
 *
 *   - AOT Treatment Plan (MDH#0001BHA): the testifying psychiatrist (PSYCHIATRIST role) or the verified Medical Director.
 *   - Psychiatrist Affidavit (MDH#0004BHA): PSYCHIATRIST role only. A Medical Director signs only when their
 *     active role is Psychiatrist (an NP / PCP medical director is not a psychiatrist).
 *   - Plan for Continued Treatment: CCT psychiatrist, CCT case manager and CCT staff each sign their own line.
 *   - EP notification, complaint, continued-plan staff line: AOT clinical staff (the court-report roles plus CPRS / peer support).
 *   - Non-responsive letter: signed as "AOT Regional Program Director": practice director / director / admin.
 */
export const PSYCHIATRIST_ROLES = ['PSYCHIATRIST'] as const;
export const CASE_MANAGER_ROLES = ['CASE_MANAGER'] as const;
/** Same list as AOT_COURT_REPORT_ROLES in src/app/api/aot/_scope.ts, plus peer support (CPRS) */
export const AOT_STAFF_SIGN_ROLES = [
  'PSYCHIATRIST',
  'NP',
  'THERAPIST',
  'CLINICIAN',
  'CASE_MANAGER',
  'PEER_SUPPORT',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
] as const;
export const PROGRAM_DIRECTOR_ROLES = ['PRACTICE_DIRECTOR', 'DIRECTOR', 'ADMIN'] as const;

export type SignActor = { role: string | null | undefined; medicalDirector?: boolean };

export function canSignSlot(
  slot: { roles: readonly string[]; allowMedicalDirector?: boolean },
  actor: SignActor,
): boolean {
  const role = String(actor.role ?? '').toUpperCase();
  if (slot.roles.includes(role)) return true;
  return !!slot.allowMedicalDirector && !!actor.medicalDirector;
}
