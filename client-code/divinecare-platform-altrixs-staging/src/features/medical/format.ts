import type { MedicalPatient } from './types';

/** DOB for display; '' from the API means only a placeholder DOB is on file. */
export function displayDob(p: Pick<MedicalPatient, 'dob'> | null | undefined): string {
  return p?.dob || 'Not documented';
}

/** Age for display; 0 from the API means the DOB is not documented. */
export function displayAge(p: Pick<MedicalPatient, 'age' | 'dob'> | null | undefined): string {
  return p?.dob && p.age >= 0 ? String(p.age) : '?';
}

/** A vital sign for display: '—' when it was not recorded. */
export function vitalText(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : String(v);
}
