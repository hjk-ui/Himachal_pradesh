import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { requireFeatureWrite } from '@/lib/billing/entitlementsServer';
import { PRP_PATH, PrpError, type PrpActor } from './program';
import { PRP_ENROLLMENT_STATUSES, PRP_REPORT_TYPES, PRP_SERVICE_TYPES } from './reports';
import { PRP_DISCHARGE_TYPES, PRP_LOCATIONS } from './standard';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}

export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

/**
 * Org context + the /dashboard/prp page rule. With `writeRoles`, the role must also be in that set
 * and the plan must allow program writes.
 */
export async function prpGate(writeRoles?: Set<string>) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: fail(gate.error, gate.status) };
  if (!canAccessPath(gate.role, PRP_PATH)) return { ok: false as const, res: fail('Forbidden', 403) };
  if (writeRoles) {
    if (!writeRoles.has(String(gate.role))) return { ok: false as const, res: fail('Your role cannot change PRP records', 403) };
    const plan = await requireFeatureWrite(gate.organizationId, 'programs');
    if (plan.ok === false) return { ok: false as const, res: fail(plan.error, plan.status) };
  }
  const actor: PrpActor = {
    organizationId: gate.organizationId,
    actorUserId: gate.userId,
    actorRole: gate.role,
    actorName: gate.session.user?.name ?? null,
  };
  return { ok: true as const, gate: { organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, actor };
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof PrpError) return fail(error.message, error.status);
  if (error instanceof z.ZodError) return fail('Check the form and try again', 400);
  if (error instanceof SyntaxError) return fail('Invalid request body', 400);
  console.error('[prp]', error instanceof Error ? error.message : 'unknown');
  return fail(fallback, 500);
}

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().trim().max(max).nullable().optional();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const groupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  schedule: text(200),
  facilitatorId: id.nullable().optional(),
  location: text(120),
  active: z.boolean().optional(),
});
export const groupPatchSchema = groupSchema.partial();

export const attendanceSchema = z.object({
  serviceDate: day,
  serviceType: z.enum(PRP_SERVICE_TYPES),
  groupId: id.nullable().optional(),
  minutes: z.number().int().min(1).max(600).nullable().optional(),
  /** Session-level documentation (each entry may override) */
  location: z.enum(PRP_LOCATIONS).nullable().optional(),
  intervention: text(2000),
  entries: z
    .array(
      z.object({
        enrollmentId: id,
        present: z.boolean(),
        billable: z.boolean().optional(),
        minutes: z.number().int().min(1).max(600).nullable().optional(),
        note: text(1000),
        location: z.enum(PRP_LOCATIONS).nullable().optional(),
        irpGoal: text(300),
        intervention: text(2000),
        response: text(2000),
      }),
    )
    .min(1)
    .max(200),
});

export const enrollmentPatchSchema = z.object({
  status: z.enum(PRP_ENROLLMENT_STATUSES).optional(),
  dischargeReason: text(500),
  dischargeType: z.enum(PRP_DISCHARGE_TYPES.map((t) => t.value) as [string, ...string[]]).nullable().optional(),
  transitionPlan: text(4000),
  aftercarePlan: text(4000),
  specialistId: id.nullable().optional(),
});

export const morsSchema = z.object({
  enrollmentId: id,
  month: monthSchema,
  rating: z.number().int().min(1).max(8),
  note: text(1000),
});

export const reportTypeSchema = z.enum(PRP_REPORT_TYPES);
