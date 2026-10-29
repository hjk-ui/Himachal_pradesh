import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canEditClientProfile } from '@/lib/clients/orgScope';
import { recordPhiAudit } from '@/lib/audit/phiAudit';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import {
  applyChartDemographics,
  loadIdentifyingInfo,
  type IdentifyingActor,
} from '@/lib/identifying-info/load';
export const runtime = 'nodejs';

/** PHI: never cache. */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const paramsSchema = z.object({ id: z.string().min(1).max(128) });

const postSchema = z.object({
  /** Blank values are rejected — a blank field never clears the chart. */
  changes: z
    .object({
      title: z.string().trim().min(1).max(40).optional(),
      genderIdentity: z.string().trim().min(1).max(50).optional(),
    })
    .strict(),
  /** Where each edited field came from. AI Scribe suggestions are never written to the chart. */
  sources: z.record(z.string().max(40), z.string().max(40)).optional(),
});

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

type OrgGate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

function actorFrom(gate: OrgGate): IdentifyingActor {
  const baseRole = gate.session.user.baseRole as IdentifyingActor['role'] | undefined;
  return {
    userId: gate.userId,
    role: gate.role,
    baseRole: baseRole ?? null,
    organizationId: gate.organizationId,
  };
}

function sensitiveResponse(err: unknown) {
  if (err instanceof SensitiveRecordAccessError) return json(err.body, err.status);
  return null;
}

/** GET — chart demographics, latest vitals, last signed non-Part 2 evaluation, and the visit's modality. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status);

  const parsed = paramsSchema.safeParse(await ctx.params);
  if (!parsed.success) return json({ success: false, error: 'Invalid client id' }, 400);

  const appointmentId = new URL(req.url).searchParams.get('appointmentId');

  try {
    const result = await loadIdentifyingInfo({
      clientId: parsed.data.id,
      appointmentId: appointmentId && appointmentId.length <= 128 ? appointmentId : null,
      actor: actorFrom(gate),
    });
    if (result.ok === false) return json({ success: false, error: result.error }, result.status);
    return json({ success: true, ...result.payload });
  } catch (err) {
    const sensitive = sensitiveResponse(err);
    if (sensitive) return sensitive;
    console.error('[identifying-info GET]', err);
    return json({ success: false, error: 'Could not load identifying information' }, 500);
  }
}

/** POST — "Update chart demographics": write edited values back to the client chart (audited). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return json({ success: false, error: gate.error }, gate.status);

  const parsedParams = paramsSchema.safeParse(await ctx.params);
  if (!parsedParams.success) return json({ success: false, error: 'Invalid client id' }, 400);
  const clientId = parsedParams.data.id;

  if (!canEditClientProfile(gate.role)) {
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'identifying_info.write',
      resourceType: 'patient',
      patientId: clientId,
      outcome: 'DENIED',
    });
    return json({ success: false, error: 'Forbidden' }, 403);
  }

  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    const message = err instanceof z.ZodError ? 'Invalid chart demographics update' : 'Invalid request body';
    return json({ success: false, error: message }, 400);
  }

  // Defense in depth: the client already filters these out.
  const changes = { ...body.changes };
  if (body.sources?.title === 'scribe') delete changes.title;
  if (body.sources?.genderIdentity === 'scribe') delete changes.genderIdentity;

  const actor = actorFrom(gate);
  try {
    const result = await applyChartDemographics({ clientId, changes, actor });
    if (result.ok === false) {
      await recordPhiAudit({
        organizationId: gate.organizationId,
        actorUserId: gate.userId,
        actorRole: gate.role,
        action: 'identifying_info.write',
        resourceType: 'patient',
        patientId: clientId,
        outcome: result.status === 403 ? 'DENIED' : 'FAILURE',
      });
      return json({ success: false, error: result.error }, result.status);
    }

    // WRITE audit: which chart fields changed (names only — no values).
    await recordPhiAudit({
      organizationId: gate.organizationId,
      actorUserId: gate.userId,
      actorRole: gate.role,
      action: 'identifying_info.write',
      resourceType: 'patient',
      resourceId: result.fields.join(','),
      patientId: clientId,
      outcome: 'SUCCESS',
    });
    await writeAuditLog({
      action: 'WRITE',
      actorUserId: gate.userId,
      organizationId: gate.organizationId,
      resourceType: 'client_demographics',
      resourceId: clientId,
      metadata: { source: 'identifying-info', fields: result.fields },
    });

    return json({ success: true, fields: result.fields });
  } catch (err) {
    const sensitive = sensitiveResponse(err);
    if (sensitive) return sensitive;
    console.error('[identifying-info POST]', err);
    return json({ success: false, error: 'Could not update chart demographics' }, 500);
  }
}
