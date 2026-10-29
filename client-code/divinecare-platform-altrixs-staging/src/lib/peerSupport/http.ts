import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { PeerError, type PeerActor } from './manage';
import {
  CONTACT_MODES,
  GOAL_DOMAINS,
  GOAL_STATUSES,
  MAX_TOPICS,
  PEER_SUPPORT_PATH,
  PLACEMENT_STATUSES,
  PLACEMENT_TYPES,
  parseDateInput,
} from './workflow';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}

export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

export type PeerGate = { organizationId: string; userId: string; role: PeerActor['actorRole'] };

/** Org context + the /dashboard/peer-support role rule. Denials are audited. */
export async function peerGate(req: Request, resourceType: string, action: string) {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: fail(gate.error, gate.status) };
  const g: PeerGate = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  if (!canAccessPath(gate.role, PEER_SUPPORT_PATH)) {
    await auditPhiAccess({ gate: g, req, action, resourceType, outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return { ok: false as const, res: fail('Forbidden', 403) };
  }
  const actor: PeerActor = { organizationId: g.organizationId, actorUserId: g.userId, actorRole: g.role };
  return { ok: true as const, gate: g, actor };
}

/** Maps errors to responses and audits refusals (404 out-of-scope, 403 protected / not author). */
export async function errorResponse(
  error: unknown,
  fallback: string,
  audit: { gate: PeerGate; req: Request; action: string; resourceType: string; resourceId?: string | null; patientId?: string | null }
) {
  if (error instanceof PeerError) {
    if (error.status === 403 || error.status === 404) {
      await auditPhiAccess({ ...audit, outcome: 'DENIED', metadata: { reason: error.status === 404 ? 'not_in_scope' : 'forbidden' } });
    }
    return fail(error.message, error.status);
  }
  if (error instanceof z.ZodError) return fail('Check the form and try again', 400);
  if (error instanceof SyntaxError) return fail('Invalid request body', 400);
  console.error('[peer-support]', error);
  await auditPhiAccess({ ...audit, outcome: 'FAILURE' });
  return fail(fallback, 500);
}

const id = z.string().trim().min(1).max(64);
const text = (max: number) => z.string().max(max).nullable().optional();
/** ISO date or datetime -> Date (date-only lands at local noon). */
const when = z
  .string()
  .max(40)
  .refine((v) => parseDateInput(v) !== null, 'Invalid date')
  .transform((v) => parseDateInput(v) as Date);
const optionalWhen = z.union([when, z.null()]).optional();
const topics = z.array(z.string().max(40)).max(MAX_TOPICS * 2).optional();

export const createContactSchema = z.object({
  clientId: id,
  contactAt: when,
  mode: z.enum(CONTACT_MODES),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  topics,
  goalIds: z.array(id).max(20).optional(),
  notes: text(4000),
  followUpAt: optionalWhen,
  completesFollowUpIds: z.array(id).max(20).optional(),
});

export const updateContactSchema = z.object({
  followUpDone: z.boolean().optional(),
  followUpAt: optionalWhen,
  mode: z.enum(CONTACT_MODES).optional(),
  durationMinutes: z.number().int().min(0).max(24 * 60).nullable().optional(),
  topics,
  notes: text(4000),
  goalIds: z.array(id).max(20).optional(),
});

export const voidContactSchema = z.object({ reason: z.string().trim().min(3).max(500) });

export const createGoalSchema = z.object({
  clientId: id,
  goal: z.string().trim().min(1).max(500),
  domain: z.enum(GOAL_DOMAINS),
  status: z.enum(GOAL_STATUSES).optional(),
  targetDate: optionalWhen,
  progressNote: text(2000),
});

export const updateGoalSchema = z.object({
  goal: z.string().trim().min(1).max(500).optional(),
  domain: z.enum(GOAL_DOMAINS).optional(),
  status: z.enum(GOAL_STATUSES).optional(),
  targetDate: optionalWhen,
  progressNote: text(2000),
});

const placementFields = {
  placementType: z.enum(PLACEMENT_TYPES),
  organizationName: text(200),
  resourceId: id.nullable().optional(),
  status: z.enum(PLACEMENT_STATUSES).optional(),
  startDate: optionalWhen,
  endDate: optionalWhen,
  hoursPerWeek: z.number().min(0).max(80).nullable().optional(),
  notes: text(2000),
};
export const createPlacementSchema = z.object({ clientId: id, ...placementFields });
export const updatePlacementSchema = z.object(placementFields).partial();

export const legacyImportSchema = z.object({
  kind: z.enum(['contact', 'goal', 'placement']),
  legacyId: z.string().trim().min(1).max(80),
  clientId: id,
  peerUserId: id,
  contactAt: optionalWhen,
  mode: z.enum(CONTACT_MODES).optional(),
  domain: z.enum(GOAL_DOMAINS).optional(),
  placementType: z.enum(PLACEMENT_TYPES).optional(),
});
