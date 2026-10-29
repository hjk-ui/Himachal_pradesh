import type { Client, EhrProgressNote } from '@/features/clients/types';
import type { TreatmentPlanRecord } from './treatmentPlansApi';

// Demo preview records intentionally empty — no sample clients, notes, or plans.
export const CLINICAL_DEMO_CLIENTS: Client[] = [];
export const CLINICAL_DEMO_NOTES: EhrProgressNote[] = [];
export const CLINICAL_DEMO_PLANS: TreatmentPlanRecord[] = [];
