import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canUseGroupKind } from '@/lib/groups/access';
import { groupActor, type GroupActor } from '@/lib/groups/store';
import { isGroupKind, type GroupKind } from '@/lib/groups/types';

/**
 * Shared gate for /api/ehr/groups/*: signed-in clinic staff, the page role of the group's kind
 * (Group Therapy vs SUD Group Counseling), and an audit row for every read / write of group PHI.
 */

export type GroupGate = {
  ok: true;
  actor: GroupActor;
  gate: { organizationId: string; userId: string; role: string };
  kind: GroupKind;
};

export function json(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

export function failJson(r: { status: number; error: string }) {
  return json(r.status, { success: false, error: r.error });
}

async function baseGate() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: json(gate.status, { success: false, error: gate.error }) };
  return { ok: true as const, gate };
}

/** Gate by an explicit kind (?kind= or body.kind). */
export async function gateKind(kindRaw: unknown): Promise<GroupGate | { ok: false; res: NextResponse }> {
  const b = await baseGate();
  if (b.ok === false) return { ok: false as const, res: b.res };
  if (!isGroupKind(kindRaw)) return { ok: false, res: json(400, { success: false, error: 'kind must be psychotherapy or sud' }) };
  if (!canUseGroupKind(b.gate.role, kindRaw)) return { ok: false, res: json(403, { success: false, error: 'Forbidden' }) };
  return { ok: true, actor: groupActor(b.gate), gate: b.gate, kind: kindRaw };
}

/** Gate by a group id: the kind comes from the stored group. */
export async function gateGroup(groupId: string): Promise<GroupGate | { ok: false; res: NextResponse }> {
  const b = await baseGate();
  if (b.ok === false) return { ok: false as const, res: b.res };
  const g = await prisma.clinicalGroup.findFirst({ where: { id: groupId, organizationId: b.gate.organizationId }, select: { kind: true } });
  if (!g || !isGroupKind(g.kind)) return { ok: false, res: json(404, { success: false, error: 'Group not found' }) };
  if (!canUseGroupKind(b.gate.role, g.kind)) return { ok: false, res: json(403, { success: false, error: 'Forbidden' }) };
  return { ok: true, actor: groupActor(b.gate), gate: b.gate, kind: g.kind };
}

/** Gate by a session id: the kind comes from the session's group. */
export async function gateSession(sessionId: string): Promise<GroupGate | { ok: false; res: NextResponse }> {
  const b = await baseGate();
  if (b.ok === false) return { ok: false as const, res: b.res };
  const s = await prisma.clinicalGroupSession.findFirst({
    where: { id: sessionId, organizationId: b.gate.organizationId },
    select: { group: { select: { kind: true } } },
  });
  if (!s || !isGroupKind(s.group.kind)) return { ok: false, res: json(404, { success: false, error: 'Session not found' }) };
  if (!canUseGroupKind(b.gate.role, s.group.kind)) return { ok: false, res: json(403, { success: false, error: 'Forbidden' }) };
  return { ok: true, actor: groupActor(b.gate), gate: b.gate, kind: s.group.kind };
}

/**
 * Audit: one row for the action (ids / counts only), plus one row per client touched so each
 * member's own access history shows the group read or write. SUD groups are flagged Part 2.
 */
export async function auditPhiAccessGroup(
  g: GroupGate,
  req: Request,
  input: { action: string; resourceType: string; resourceId?: string | null; patientIds?: string[]; metadata?: Record<string, unknown>; outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED' }
) {
  const metadata = { kind: g.kind, part2: g.kind === 'sud', count: input.patientIds?.length ?? 0, ...(input.metadata ?? {}) };
  await auditPhiAccess({ gate: g.gate, req, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId ?? null, outcome: input.outcome, metadata });
  for (const patientId of [...new Set(input.patientIds ?? [])]) {
    await auditPhiAccess({ gate: g.gate, req, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId ?? null, patientId, outcome: input.outcome, metadata: { kind: g.kind, part2: g.kind === 'sud' } });
  }
}

export async function readJson<T extends z.ZodTypeAny>(req: Request, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; res: NextResponse }> {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return { ok: false, res: json(400, { success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }) };
  return { ok: true, data: parsed.data };
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const code = z.string().trim().max(12).regex(/^[A-Za-z0-9-]*$/, 'Code must be letters / digits').nullable().optional();

export const groupInputSchema = z.object({
  name: z.string().trim().min(2, 'Name the group').max(120),
  groupType: z.string().trim().min(1).max(40),
  description: z.string().max(2000).nullable().optional(),
  program: z.string().max(120).nullable().optional(),
  facilitatorId: z.string().max(64).nullable().optional(),
  coFacilitatorId: z.string().max(64).nullable().optional(),
  locationId: z.string().max(50).nullable().optional(),
  room: z.string().max(120).nullable().optional(),
  telehealth: z.boolean().optional(),
  capacity: z.number().int().min(1).max(60).optional(),
  defaultDurationMinutes: z.number().int().min(15).max(480).optional(),
  billingCode: code,
  billingMode: z.enum(['per_session', 'attendance_only']).optional(),
  minBillableMinutes: z.number().int().min(1).max(480).nullable().optional(),
  maxBillableGroupSize: z.number().int().min(1).max(60).nullable().optional(),
  enrollment: z.enum(['open', 'closed']).optional(),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  recurFrequency: z.enum(['weekly', 'biweekly', 'monthly']).nullable().optional(),
  recurInterval: z.number().int().min(1).max(4).nullable().optional(),
  recurWeekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  recurStartTime: z.string().regex(HM, 'Start time must be HH:mm').nullable().optional(),
  recurStartDate: z.string().regex(YMD).nullable().optional(),
  recurEndDate: z.string().regex(YMD).nullable().optional(),
});

export const noteValuesSchema = z.record(
  z.string().max(40),
  z.union([z.string().max(4000), z.number(), z.array(z.string().max(200)).max(20), z.null()])
);
