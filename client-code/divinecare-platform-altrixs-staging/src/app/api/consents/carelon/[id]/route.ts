import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { applyStaffAction, type StaffAction } from '@/lib/consents/carelon/store';
import { CARELON_FORM_KEY } from '@/lib/consents/carelon/template';
import { canManageCarelon } from '@/lib/consents/carelon/workflow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const text = (max: number) => z.string().trim().max(max);
const partA = z.object({
  signerType: z.enum(['participant', 'representative']),
  printedName: text(120),
  relationship: text(80).optional().nullable(),
  authority: text(300).optional().nullable(),
  signature: text(120),
  agree: z.boolean(),
});
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('send') }),
  z.object({ action: z.literal('sign_participant'), partA }),
  z.object({ action: z.literal('sign_provider'), partB: z.object({ printedName: text(120), title: text(120), signature: text(120), agree: z.boolean() }) }),
  z.object({ action: z.literal('mark_submitted'), submittedOn: text(20), reference: text(80).optional().nullable() }),
  z.object({ action: z.literal('void'), reason: text(500) }),
  z.object({ action: z.literal('set_provider'), optionKey: text(80) }),
  z.object({ action: z.literal('set_participant_id'), medicaidId: text(20) }),
  z.object({ action: z.literal('fill_blanks') }),
]);

const AUDIT_ACTION: Record<StaffAction['action'], string> = {
  send: 'SEND',
  sign_participant: 'SIGN',
  sign_provider: 'SIGN',
  mark_submitted: 'UPDATE',
  void: 'UPDATE',
  set_provider: 'UPDATE',
  set_participant_id: 'UPDATE',
  fill_blanks: 'UPDATE',
};

/**
 * POST /api/consents/carelon/[id] — one workflow step on a Carelon non-overlap attestation:
 * send to the portal, record the participant's Part A in office, sign Part B (provider),
 * record the Carelon portal submission, cancel an unfinished request, pick the provider NPI,
 * enter the MA number, or fill blanks left by an intake-packet signature.
 * Role rules in src/lib/consents/carelon/workflow.ts; chart access (org, caseload, Part 2) first.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canManageCarelon(gate.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  const { id } = await ctx.params;
  if (!id || id.length > 128) return NextResponse.json({ success: false, error: 'Invalid attestation' }, { status: 400 });
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const body = parsed.data as StaffAction;
  try {
    const row = await prisma.consentForm.findFirst({ where: { id, organizationId: gate.organizationId, formKey: CARELON_FORM_KEY }, select: { clientId: true } });
    if (!row) return NextResponse.json({ success: false, error: 'Attestation not found' }, { status: 404 });
    const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, row.clientId, `/api/consents/carelon/${id}`);
    const audit = (outcome: 'SUCCESS' | 'DENIED' | 'FAILURE', metadata: Record<string, unknown>) =>
      auditPhiAccess({ gate, req, action: AUDIT_ACTION[body.action], resourceType: 'carelonAttestation', resourceId: id, patientId: row.clientId, outcome, metadata: { operation: body.action, ...metadata } });
    if (access.ok === false) {
      await audit('DENIED', { reason: access.reason });
      return NextResponse.json({ success: false, error: access.status === 404 ? 'Attestation not found' : 'Forbidden' }, { status: access.status });
    }
    const result = await applyStaffAction({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, id, body);
    if (result.ok === false) {
      await audit(result.status === 403 ? 'DENIED' : 'FAILURE', { status: result.status });
      return NextResponse.json({ success: false, error: result.error, errors: (result as { errors?: string[] }).errors ?? [result.error] }, { status: result.status });
    }
    invalidateInboxForOrg(gate.organizationId);
    await audit('SUCCESS', {
      status: result.attestation.status,
      ...(body.action === 'sign_participant' ? { signerType: body.partA.signerType, method: 'in_office' } : {}),
      ...(body.action === 'sign_provider' ? { pdfStored: result.pdfStored ?? false } : {}),
      ...(body.action === 'set_provider' ? { optionKey: body.optionKey } : {}),
      ...(result.filled ? { filled: result.filled } : {}),
    });
    return NextResponse.json({ success: true, attestation: result.attestation });
  } catch (err) {
    console.error('[consents/carelon/[id] POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not update the attestation' }, { status: 500 });
  }
}
