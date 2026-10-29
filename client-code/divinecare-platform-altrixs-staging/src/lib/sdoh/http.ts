import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { ALL_DOMAINS } from './ahcHrsn';
import { CLOSE_REASONS, REFERRAL_STATUSES, REFERRAL_TYPES, RESOURCE_DOMAINS } from './workflow';
import { COUNTIES } from '@/lib/resources/community';
import { SDOH_PATH, SdohError, type SdohActor } from './manage';

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export function ok(body: Record<string, unknown>, status = 200) {
  return NextResponse.json({ success: true, ...body }, { status, headers: NO_STORE });
}

export function fail(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status, headers: NO_STORE });
}

/** Org context + the /dashboard/sdoh role rule. */
export async function sdohGate() {
  const gate = await requireOrgContext();
  if (!gate.ok) return { ok: false as const, res: fail(gate.error, gate.status) };
  if (!canAccessPath(gate.role, SDOH_PATH)) return { ok: false as const, res: fail('Forbidden', 403) };
  const actor: SdohActor = { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role };
  return { ok: true as const, gate: { organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, actor };
}

export function errorResponse(error: unknown, fallback: string) {
  if (error instanceof SdohError) return fail(error.message, error.status);
  if (error instanceof z.ZodError) return fail('Check the form and try again', 400);
  if (error instanceof SyntaxError) return fail('Invalid request body', 400);
  console.error('[sdoh]', error);
  return fail(fallback, 500);
}

const id = z.string().trim().min(1).max(64);
const answer = z.union([z.string().max(40), z.array(z.string().max(40)).max(10), z.null()]);
const domain = z.enum(ALL_DOMAINS as [string, ...string[]]);
const resourceDomain = z.enum(RESOURCE_DOMAINS);
const text = (max: number) => z.string().max(max).nullable().optional();

export const screeningSchema = z.object({
  submissionId: z.string().regex(/^[a-z0-9][a-z0-9_-]{11,63}$/i, 'Invalid submission ID'),
  clientId: id,
  answers: z.record(z.string().max(8), answer),
  includeSupplemental: z.boolean().default(false),
  respondent: z.enum(['self', 'caregiver']).default('self'),
  notes: text(2000),
});

export const confirmCodesSchema = z.object({ codes: z.array(z.string().max(10)).min(1).max(20) });

export const createReferralSchema = z.object({
  clientId: id,
  domain,
  screeningId: id.nullable().optional(),
  resourceId: id.nullable().optional(),
  ownerId: id.nullable().optional(),
  notes: text(2000),
  referralType: z.enum(REFERRAL_TYPES).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Follow-up date must be YYYY-MM-DD').nullable().optional(),
  libraryItemId: id.nullable().optional(),
});

export const updateReferralSchema = z.object({
  status: z.enum(REFERRAL_STATUSES).optional(),
  closeReason: z.enum(CLOSE_REASONS).nullable().optional(),
  notes: text(2000),
  ownerId: id.nullable().optional(),
  resourceId: id.nullable().optional(),
  referralType: z.enum(REFERRAL_TYPES).optional(),
  followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Follow-up date must be YYYY-MM-DD').nullable().optional(),
  followUpCompleted: z.boolean().optional(),
});

const resourceFields = {
  name: z.string().trim().min(1).max(200),
  domains: z.array(resourceDomain).min(1).max(RESOURCE_DOMAINS.length),
  address: text(300),
  city: text(120),
  state: text(40),
  postalCode: text(20),
  phone: text(60),
  website: z
    .string()
    .trim()
    .max(300)
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'Website must start with http:// or https://')
    .nullable()
    .optional(),
  hours: text(200),
  languages: z.array(z.string().max(40)).max(20).optional(),
  cost: text(120),
  eligibilityNotes: text(2000),
  active: z.boolean().optional(),
  verified: z.boolean().optional(),
  counties: z.array(z.enum(COUNTIES.map((c) => c.value) as [string, ...string[]])).max(COUNTIES.length).optional(),
  email: z.string().trim().max(200).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Email is not valid').nullable().optional(),
  verificationSource: text(300),
};
export const createResourceSchema = z.object(resourceFields);
export const updateResourceSchema = z.object(resourceFields).partial();
