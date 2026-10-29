export const PATIENT_TOKEN_KEY = 'altrixs_patient_token';

export function getPatientToken() {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(PATIENT_TOKEN_KEY);
}

export function setPatientToken(token: string) {
  sessionStorage.setItem(PATIENT_TOKEN_KEY, token);
}

export function clearPatientToken() {
  sessionStorage.removeItem(PATIENT_TOKEN_KEY);
}
