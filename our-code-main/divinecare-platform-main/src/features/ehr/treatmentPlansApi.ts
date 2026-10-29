import type { PlanCare } from '@/lib/ehr/planLibrary';
import { apiJson } from '@/lib/api-client';

export type TreatmentPlanStatus = 'DRAFT' | 'ACTIVE' | 'NEEDS_REVIEW' | 'EXPIRED' | 'CLOSED';

export type TreatmentPlanGoal = {
  id: string;
  text: string;
  targetDate: string;
  objectives: string[];
  interventions: string[];
  progress: number;
};

export type TreatmentPlanRecord = {
  id: string;
  clientId: string;
  clientName: string;
  clinicianId: string | null;
  clinicianName: string;
  title: string;
  diagnosisCodes: string[];
  status: TreatmentPlanStatus;
  reviewDueAt: string | null;
  startDate: string;
  strengths: string | null;
  presentingProblems: string | null;
  secondaryDx: string | null;
  clientSigned: boolean;
  clinicalDetails?: PlanCare;
  goals: TreatmentPlanGoal[];
};

export async function fetchTreatmentPlans() {
  const data = await apiJson<{ success: true; plans: TreatmentPlanRecord[] }>(
    '/api/ehr/treatment-plans'
  );
  return data.plans;
}

export async function fetchTreatmentPlan(id: string) {
  const data = await apiJson<{ success: true; plan: TreatmentPlanRecord }>(
    `/api/ehr/treatment-plans/${id}`
  );
  return data.plan;
}

export async function createTreatmentPlan(input: {
  clientId: string;
  title: string;
  diagnosisCodes?: string[];
  status?: TreatmentPlanStatus;
  reviewDueAt?: string | null;
  strengths?: string | null;
  presentingProblems?: string | null;
  secondaryDx?: string | null;
  clientSigned?: boolean;
  clinicalDetails?: PlanCare;
  goals?: TreatmentPlanGoal[];
}) {
  const data = await apiJson<{ success: true; plan: TreatmentPlanRecord }>(
    '/api/ehr/treatment-plans',
    { method: 'POST', body: JSON.stringify(input) }
  );
  return data.plan;
}

export async function updateTreatmentPlan(
  id: string,
  input: Partial<{
    title: string;
    diagnosisCodes: string[];
    status: TreatmentPlanStatus;
    reviewDueAt: string | null;
    strengths: string | null;
    presentingProblems: string | null;
    secondaryDx: string | null;
    clientSigned: boolean;
    clinicalDetails: PlanCare;
    goals: TreatmentPlanGoal[];
    action: 'close' | 'make-live';
  }>
) {
  const data = await apiJson<{ success: true; plan: TreatmentPlanRecord }>(
    `/api/ehr/treatment-plans/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  return data.plan;
}
