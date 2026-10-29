import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { ResourceError, type ResourceActor } from '@/lib/resources/store';

/**
 * Shared gate for /api/resources/*: a signed-in clinic user; each store function applies the
 * role rules (src/lib/resources/access.ts). Every assignment, view and download is audit-logged
 * with ids only (never resource titles, which can reveal SUD treatment).
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}

export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

export async function resourceGate() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: fail(gate.error, gate.status) };
  const actor: ResourceActor = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
  return { ok: true as const, actor, gate: { organizationId: gate.organizationId, userId: gate.userId, role: gate.role as string } };
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof ResourceError) return fail(error.message, error.status);
  if (error instanceof z.ZodError) return fail(error.issues[0]?.message || 'Check the form and try again', 400);
  if (error instanceof SyntaxError) return fail('Invalid request body', 400);
  console.error('[resources]', error);
  return fail(fallback, 500);
}

type Gate = { organizationId: string; userId: string; role: string };

/** One audit row per client touched (each client's access history shows it), or one org row when none. */
export async function auditPhiAccessResource(
  gate: Gate,
  req: Request,
  input: { action: string; resourceType: string; resourceId?: string | null; patientIds?: string[]; outcome?: 'SUCCESS' | 'FAILURE' | 'DENIED'; metadata?: Record<string, unknown> },
) {
  const ids = [...new Set(input.patientIds ?? [])];
  const metadata = { module: 'resource-library', ...(input.metadata ?? {}) };
  if (!ids.length) {
    await writeAuditLog({
      action: input.action,
      actorUserId: gate.userId,
      actorRole: gate.role,
      organizationId: gate.organizationId,
      resourceType: input.resourceType,
      resourceId: input.resourceId ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      metadata,
      ...auditRequestMeta(req),
    });
    return;
  }
  for (const patientId of ids) {
    await auditPhiAccess({ gate, req, action: input.action, resourceType: input.resourceType, resourceId: input.resourceId ?? null, patientId, outcome: input.outcome, metadata });
  }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const text = (max: number) => z.string().max(max).nullable().optional();

export const itemInputSchema = z.object({
  audience: z.enum(['patient', 'staff']).optional(),
  kind: z.enum(['handout', 'link', 'video', 'article', 'crisis', 'community']),
  title: z.string().trim().min(2, 'Give the resource a title').max(300),
  summary: text(2000),
  body: text(50_000),
  url: z
    .string()
    .trim()
    .max(1000)
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Links must start with https:// or http://')
    .nullable()
    .optional(),
  contactPhone: text(60),
  contactText: text(120),
  topics: z.array(z.string().max(40)).max(20).optional(),
  audiences: z.array(z.enum(['adult', 'teen', 'child', 'caregiver'])).max(4).optional(),
  language: z.string().max(10).optional(),
  readingLevel: text(40),
  publisher: text(200),
  licenseNote: text(1000),
  staffCategory: z.enum(['policy', 'form', 'training', 'other']).nullable().optional(),
  visibleRoles: z.array(z.string().max(40)).max(30).optional(),
  sudRelated: z.boolean().optional(),
});

export const itemUpdateSchema = itemInputSchema.partial().extend({
  status: z.enum(['draft', 'active', 'retired']).optional(),
  markReviewed: z.boolean().optional(),
  markLinkChecked: z.boolean().optional(),
});

export const assignSchema = z.object({
  itemId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64),
  message: text(2000),
  dueDate: z.string().regex(YMD, 'Due date must be YYYY-MM-DD').nullable().optional(),
  context: z.enum(['library', 'chart', 'note', 'scribe', 'sdoh']).optional(),
  contextId: text(64),
  sudContext: z.boolean().optional(),
});
