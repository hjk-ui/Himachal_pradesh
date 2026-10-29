import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';
import { INTENSIVE_BILLING_PATH, INTENSIVE_PATH } from './access';
import { IntensiveError, type IntensiveActor } from './store';
import { ATTENDANCE_STATUSES, BILLING_MODES, CARE_LEVELS, DISCHARGE_REASONS, OUTREACH_METHODS, PROGRAM_TYPES, SESSION_TYPES, UNIT_TYPES } from './types';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}
export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

/**
 * Org context + the page rule (program hub, or the charge-drafts page for billing). With `write`,
 * the plan must allow program writes. Every route audits its PHI access (ids / counts only).
 */
export async function intensiveGate(opts: { write?: boolean; billing?: boolean } = {}) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: fail(gate.error, gate.status) };
  const path = opts.billing ? INTENSIVE_BILLING_PATH : INTENSIVE_PATH;
  if (!canAccessPath(gate.role, path, gate.capabilities)) return { ok: false as const, res: fail('Forbidden', 403) };
  if (opts.write) {
    const plan = await requireFeatureWrite(gate.organizationId, 'programs');
    if (plan.ok === false) return { ok: false as const, res: fail(plan.error, plan.status) };
  }
  const actor: IntensiveActor = {
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    name: gate.session.user?.name ?? null,
    medicalDirector: Boolean(gate.capabilities?.medicalDirector),
  };
  return { ok: true as const, gate: { organizationId: gate.organizationId, userId: gate.userId, role: String(gate.role) }, actor };
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof IntensiveError) return fail(error.message, error.status);
  if (error instanceof z.ZodError) return fail('Check the form and try again', 400);
  if (error instanceof SyntaxError) return fail('Invalid request body', 400);
  console.error('[intensive]', error instanceof Error ? error.message : 'unknown');
  return fail(fallback, 500);
}

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).nullable().optional();
export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const posInt = (max: number) => z.number().int().min(1).max(max).nullable().optional();
const code = z.string().trim().regex(/^[A-Za-z0-9]{4,7}$/);

export const programSchema = z.object({
  id: id.nullable().optional(),
  name: z.string().trim().min(1).max(120),
  locationId: id.nullable().optional(),
  programType: z.enum(PROGRAM_TYPES),
  ageGroup: z.enum(['adult', 'adolescent']),
  active: z.boolean().optional(),
  phpLicensureConfirmed: z.boolean().optional(),
  sudFocus: z.boolean().optional(),
  schedule: z
    .object({
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      blocks: z
        .array(
          z.object({
            key: z.string().trim().max(20).optional(),
            label: z.string().trim().max(60),
            start: z.string().regex(/^\d{2}:\d{2}$/),
            minutes: z.number().int().min(5).max(600),
            sessionType: z.enum(SESSION_TYPES),
          }),
        )
        .min(1)
        .max(12),
    })
    .optional(),
  minWeeklyHours: z.number().min(1).max(60).nullable().optional(),
  initialPlanDays: posInt(90),
  planReviewDays: posInt(365),
  authRenewalLeadDays: posInt(60),
  followUpWindowDays: posInt(60),
  missedDayOutreachHours: posInt(168),
  billingMode: z.enum(BILLING_MODES).optional(),
  perDiemCode: code.nullable().optional(),
  serviceCodes: z.record(z.enum(SESSION_TYPES), code.nullable()).nullable().optional(),
  unitRules: z
    .array(z.object({ code, unit: z.enum(UNIT_TYPES), minMinutes: z.number().int().min(1).max(1440).nullable(), rounding: z.enum(['midpoint', 'whole']) }))
    .max(20)
    .nullable()
    .optional(),
  linkedGroupIds: z.array(id).max(20).optional(),
});

export const referralSchema = z.object({
  programId: id,
  clientId: id,
  referralDate: day,
  referralSource: text(200),
  referralReason: text(2000),
});

export const admissionPatchSchema = z.object({
  action: z.literal('update'),
  screening: z
    .object({
      criteria: z.record(z.string().max(40), z.boolean()),
      criteriaOverride: text(1000),
      locusRecordId: id.nullable().optional(),
      asamScores: z.record(z.string(), z.number().int().min(0).max(4)).nullable().optional(),
      levelNote: text(2000),
    })
    .optional(),
  priorAuthId: id.nullable().optional(),
  newAuth: z
    .object({
      payer: z.string().trim().min(1).max(120),
      authNumber: text(60),
      unitsApproved: z.number().int().min(1).max(10000),
      startDate: day,
      endDate: day,
      codes: z.array(code).max(10).optional(),
    })
    .nullable()
    .optional(),
  psychEvalDate: day.nullable().optional(),
  psychEvalNoteId: id.nullable().optional(),
  admissionDate: day.nullable().optional(),
  primaryClinicianId: id.nullable().optional(),
  prescriberId: id.nullable().optional(),
  caseManagerId: id.nullable().optional(),
  treatmentPlanId: id.nullable().optional(),
});

export const enrollmentActionSchema = z.discriminatedUnion('action', [
  admissionPatchSchema,
  z.object({ action: z.literal('admit') }),
  z.object({ action: z.literal('decline'), reason: z.string().trim().min(1).max(1000) }),
  z.object({
    action: z.literal('discharge'),
    dischargeDate: day,
    reason: z.enum(DISCHARGE_REASONS),
    stepDownLevel: z.enum(CARE_LEVELS),
    aftercarePlan: z.string().trim().min(1).max(4000),
    dischargeSummaryNoteId: id.nullable().optional(),
    followUpAppointmentId: id.nullable().optional(),
    followUpDate: day.nullable().optional(),
    followUpProvider: text(200),
    transitionNotes: text(4000),
  }),
  z.object({
    action: z.literal('review'),
    weekStart: day,
    summary: text(4000),
    planChanges: text(2000),
    levelOfCareDecision: text(500),
    prescriberSign: z.boolean().optional(),
  }),
]);

export const attendanceSchema = z.object({
  programId: id,
  date: day,
  marks: z
    .array(
      z.object({
        enrollmentId: id,
        blockKey: z.string().trim().min(1).max(20),
        status: z.enum(ATTENDANCE_STATUSES),
        minutes: z.number().int().min(0).max(600).nullable().optional(),
        progressNoteId: id.nullable().optional(),
        note: text(1000),
      }),
    )
    .min(1)
    .max(500),
});

export const outreachSchema = z.object({
  followUpId: id,
  method: z.enum(OUTREACH_METHODS),
  outcome: z.string().trim().min(1).max(500),
  note: text(1000),
  resolve: z.boolean().optional(),
});

export const chargeGenerateSchema = z.object({ programId: id, from: day, to: day });
export const chargePatchSchema = z.object({ id, action: z.enum(['void', 'restore']) });
