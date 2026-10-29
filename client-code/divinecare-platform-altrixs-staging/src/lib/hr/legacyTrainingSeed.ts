/**
 * Legacy training catalog seed for the old ClinicModuleState "hr-trainings-catalog" module
 * (scripts/seed-ehr-modules.ts). The HR hub now uses hr_training_requirements.
 */
type TrainingDef = { id: string; name: string; shortName: string; frequency: string };
type LegacyStaffTraining = { id: string; name: string; role: string; hireDate: string; isNewHire: boolean; trainings: unknown[]; orientation: unknown[] };

export const HR_TRAININGS_CATALOG_SEED: TrainingDef[] = [
  { id: 'cpr', name: 'CPR / First Aid', shortName: 'CPR/FA', frequency: '2yr' },
  { id: 'qpr', name: 'Suicide Prevention — QPR', shortName: 'QPR', frequency: 'Annual' },
  { id: 'mandatory', name: 'Mandatory Reporter', shortName: 'Mand. Rep.', frequency: 'Annual' },
  { id: 'hipaa', name: 'HIPAA Privacy', shortName: 'HIPAA', frequency: 'Annual' },
  { id: 'crisis', name: 'Crisis De-escalation', shortName: 'Crisis DE', frequency: 'Annual' },
  { id: 'trauma', name: 'Trauma-Informed Care', shortName: 'TIC', frequency: '2yr' },
  { id: 'cultural', name: 'Cultural Competency', shortName: 'Cultural', frequency: 'Annual' },
  { id: 'mi', name: 'Motivational Interviewing', shortName: 'MI', frequency: 'One-time' },
  { id: 'documentation', name: 'Documentation Standards', shortName: 'Doc Stds', frequency: 'Annual' },
  { id: 'fire', name: 'Fire Safety / Emergency', shortName: 'Fire Safety', frequency: 'Annual' },
];

export const HR_TRAINING_STAFF_SEED: LegacyStaffTraining[] = [];
