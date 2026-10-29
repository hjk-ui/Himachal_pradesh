import { PatientAppError } from '@/patient/domain/errors';

const MIN = 8;
const MAX = 72;

export function assertPatientPassword(password: string) {
  if (typeof password !== 'string' || password.length < MIN || password.length > MAX) {
    throw new PatientAppError(
      'Password must be 8–72 characters',
      400,
      'weak_password'
    );
  }
  if (new TextEncoder().encode(password).length > MAX) {
    throw new PatientAppError('Password must be at most 72 UTF-8 bytes', 400, 'weak_password');
  }
  if (/\s/.test(password)) {
    throw new PatientAppError('Password cannot contain spaces', 400, 'weak_password');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new PatientAppError(
      'Password must include a letter and a number',
      400,
      'weak_password'
    );
  }
}
