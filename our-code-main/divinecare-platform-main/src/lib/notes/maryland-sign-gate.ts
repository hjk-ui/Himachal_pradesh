import { prisma } from '@/lib/db/prisma';
import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { extractNoteCpt } from '@/lib/billing/noteCoding';
import {
  getPracticeClinicalSettings,
  isWithinGoLiveTransition,
  TREATMENT_PLAN_PENDING_LABEL,
} from '@/lib/practice/clinical-settings';
import { clinicDate } from '@/lib/workflows/dates';
import { requiresLateEntryReason } from './notes-policy';

const THERAPY_NOTE_TYPES = new Set([
  'SOAP',
  'DAP',
  'BIRP',
  'GIRP',
  'PIE',
  'CBT',
  'DBT',
  'MFT',
  'EMDR',
  'Group',
  'SUD',
]);

const TIMED_THERAPY_CPT = new Set(['90832', '90834', '90837', '90846', '90847', '90853']);

const EXEMPT_NOTE_TYPES = new Set(['Psych Eval', 'Discharge', 'Telephone']);

const CRISIS_CPT = new Set(['90839', '90840']);

export type SignGateResult =
  | { ok: true; exceptionLabel?: string }
  | { ok: false; error: string };

function requiresTreatmentPlan(noteType: string | undefined, cpt: string | null): boolean {
  if (noteType && EXEMPT_NOTE_TYPES.has(noteType)) return false;
  if (cpt && CRISIS_CPT.has(cpt)) return false;
  if (noteType && THERAPY_NOTE_TYPES.has(noteType)) return true;
  if (cpt && TIMED_THERAPY_CPT.has(cpt)) return true;
  return false;
}

export async function evaluateTreatmentPlanSignGate(input: {
  organizationId: string;
  clientId: string;
  noteBody: string;
  noteCreatedAt?: Date;
  lateEntryReason?: string | null;
}): Promise<SignGateResult> {
  if (input.noteCreatedAt) {
    const late = requiresLateEntryReason(input.noteCreatedAt, input.lateEntryReason);
    if (!late.ok) return { ok: false, error: late.error || 'Late-entry reason required' };
  }

  const meta = parseNoteMeta(input.noteBody);
  const cpt = extractNoteCpt(input.noteBody) || meta.billingCode || null;
  const noteType = meta.noteType || undefined;

  if (!requiresTreatmentPlan(noteType, cpt)) {
    return { ok: true };
  }

  const active = await prisma.treatmentPlan.findFirst({
    where: {
      organizationId: input.organizationId,
      clientId: input.clientId,
      status: 'ACTIVE',
    },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, reviewDueAt: true },
  });

  if (active) {
    const today = clinicDate();
    if (active.reviewDueAt) {
      const due = active.reviewDueAt.toISOString().slice(0, 10);
      if (due < today) {
        // Plan exists but review overdue — still "on file"; warn via exception is not a hard block
        // Staging: active plan required to sign; overdue is a separate Visit Guide concern.
      }
    }
    return { ok: true };
  }

  const settings = await getPracticeClinicalSettings(input.organizationId);
  if (isWithinGoLiveTransition(settings.goLiveDate)) {
    return { ok: true, exceptionLabel: TREATMENT_PLAN_PENDING_LABEL };
  }

  return {
    ok: false,
    error:
      'An active treatment plan is required to sign this therapy / timed CPT note. Create or activate a plan first.',
  };
}
