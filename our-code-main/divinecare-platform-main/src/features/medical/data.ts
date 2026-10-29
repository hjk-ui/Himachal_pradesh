import {
  MedicalPatient,
  CriticalLabAlert,
  MedicalClaimItem,
  PayerSetting,
  MedicalVitalRecord,
  MedicalEncounter,
  MedicalLabResult,
  MedicalReferral,
  MedicalProblem,
} from './types';

export const INITIAL_CRITICAL_LAB_ALERTS: CriticalLabAlert[] = [];

export const INITIAL_SOMATIC_DIAGNOSES_STATS: Array<{
  code: string;
  name: string;
  count: number;
  percentage: number;
  color: string;
}> = [];

export const INITIAL_TODAYS_APPOINTMENTS: any[] = [];

export const INITIAL_MEDICAL_PATIENTS: MedicalPatient[] = [];

export const INITIAL_MEDICAL_CLAIMS: MedicalClaimItem[] = [];

export const INITIAL_PAYER_SETTINGS: PayerSetting[] = [];

// LocalStorage helpers to allow live reactivity and persistence across all 12 pages
const STORAGE_KEY_PATIENTS = 'altrixs.medical.patients.v2';
const STORAGE_KEY_ALERTS = 'altrixs.medical.alerts.v2';
const STORAGE_KEY_CLAIMS = 'altrixs.medical.claims.v2';
const STORAGE_KEY_PAYERS = 'altrixs.medical.payers.v2';

export function getMedicalPatients(): MedicalPatient[] {
  if (typeof window === 'undefined') return [];
  try {
    if (localStorage.getItem('altrixs.medical.patients.v1')) {
      localStorage.removeItem('altrixs.medical.patients.v1');
    }
    const raw = localStorage.getItem(STORAGE_KEY_PATIENTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || JSON.stringify(parsed).includes('Robert Chen') || JSON.stringify(parsed).includes('Ebony Squire') || JSON.stringify(parsed).includes('SQUEBO')) {
      localStorage.removeItem(STORAGE_KEY_PATIENTS);
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function saveMedicalPatients(patients: MedicalPatient[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_PATIENTS, JSON.stringify(patients));
    window.dispatchEvent(new Event('medical_patients_updated'));
  } catch {
    /* ignore */
  }
}

export function getMedicalPatientById(id: string): MedicalPatient | undefined {
  const list = getMedicalPatients();
  return list.find((p) => p.id === id || p.mrn === id);
}

export function getCriticalLabAlerts(): CriticalLabAlert[] {
  if (typeof window === 'undefined') return [];
  try {
    if (localStorage.getItem('altrixs.medical.alerts.v1')) {
      localStorage.removeItem('altrixs.medical.alerts.v1');
    }
    const raw = localStorage.getItem(STORAGE_KEY_ALERTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || JSON.stringify(parsed).includes('Ebony Squire') || JSON.stringify(parsed).includes('Maria Elena Rodriguez')) {
      localStorage.removeItem(STORAGE_KEY_ALERTS);
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

export function acknowledgeLabAlert(alertId: string): void {
  const alerts = getCriticalLabAlerts();
  const next = alerts.map((a) => (a.id === alertId ? { ...a, acknowledged: true } : a));
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_ALERTS, JSON.stringify(next));
    window.dispatchEvent(new Event('medical_alerts_updated'));
  }
}

export function getMedicalClaims(): MedicalClaimItem[] {
  if (typeof window === 'undefined') return INITIAL_MEDICAL_CLAIMS;
  try {
    if (localStorage.getItem('altrixs.medical.claims.v1')) {
      localStorage.removeItem('altrixs.medical.claims.v1');
    }
    const raw = localStorage.getItem(STORAGE_KEY_CLAIMS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_CLAIMS, JSON.stringify(INITIAL_MEDICAL_CLAIMS));
      return INITIAL_MEDICAL_CLAIMS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_MEDICAL_CLAIMS;
  }
}

export function saveMedicalClaims(claims: MedicalClaimItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_CLAIMS, JSON.stringify(claims));
    window.dispatchEvent(new Event('medical_claims_updated'));
  } catch {
    /* ignore */
  }
}

export function getPayerSettings(): PayerSetting[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PAYERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePayerSettings(payers: PayerSetting[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_PAYERS, JSON.stringify(payers));
    window.dispatchEvent(new Event('medical_payers_updated'));
  } catch {
    /* ignore */
  }
}

export function calculateBMI(weightLbs: number, heightInches: number): number {
  if (!weightLbs || !heightInches || heightInches <= 0) return 0;
  const bmi = (weightLbs / (heightInches * heightInches)) * 703;
  return Math.round(bmi * 10) / 10;
}

export function getBPStaging(systolic: number, diastolic: number): {
  stage: string;
  badgeClass: string;
  color: string;
} {
  if (systolic < 120 && diastolic < 80) {
    return { stage: 'Normal (<120/80)', badgeClass: 'bg-emerald-50 text-emerald-700 ring-emerald-200', color: '#10B981' };
  }
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) {
    return { stage: 'Elevated (120-129/<80)', badgeClass: 'bg-yellow-50 text-yellow-800 ring-yellow-200', color: '#EAB308' };
  }
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) {
    return { stage: 'Stage 1 HTN (130-139/80-89)', badgeClass: 'bg-amber-50 text-amber-700 ring-amber-200', color: '#F59E0B' };
  }
  return { stage: 'Stage 2 HTN (>=140 or >=90)', badgeClass: 'bg-rose-50 text-rose-700 ring-rose-200', color: '#EF4444' };
}
