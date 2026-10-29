import type { PlanCare } from '@/lib/ehr/planLibrary';
import { apiJson } from '@/lib/api-client';
import type { ImportedPlanSource } from '@/lib/migration/valantTreatmentPlans';
import type { PlanSignatures } from '@/components/therapy/PlanSignaturePanel';

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
  /** Imported from Valant: plan content stays in Valant */
  source?: ImportedPlanSource | null;
  /** INITIAL | REVIEW */
  planKind?: string;
  /** Made with the therapist Treatment Plan template */
  hasTemplate?: boolean;
  /** Clinician -> supervisor (pre-licensed authors) -> patient portal */
  signatures?: PlanSignatures;
  /** Plan this one replaces (review, or rewrite of an imported Valant plan) */
  supersedesId?: string | null;
  createdAt?: string;
};

export type ImportedPlanDocument = { id: string; name: string; filedAt: string | null; url: string | null; hasText: boolean };

/** What the chart has for an imported Valant plan: chart diagnoses, filed Valant plan documents, rewrite draft */
export type ImportedPlanContext = {
  chartDiagnoses: { code: string | null; description: string; isPrimary: boolean; from: 'Client record' | 'Problem list' }[];
  documents: ImportedPlanDocument[];
  rewriteDraftId: string | null;
};

export async function fetchImportedPlanContext(id: string) {
  const data = await apiJson<{ success: true; context: ImportedPlanContext }>(
    `/api/ehr/treatment-plans/${encodeURIComponent(id)}/imported-context`
  );
  return data.context;
}

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
    action: 'close';
  }>
) {
  const data = await apiJson<{ success: true; plan: TreatmentPlanRecord }>(
    `/api/ehr/treatment-plans/${id}`,
    { method: 'PATCH', body: JSON.stringify(input) }
  );
  return data.plan;
}
