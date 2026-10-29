import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { AOT_CLINICAL_FIELDS, canSeeAotClinical, findParticipantInOrg, participantOnCaseload, redactAotParticipant } from '../../_scope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { normalizeChecklist, orderTermProblem, petitionerIssueIn } from '@/lib/aot/mdh';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const participant = await findParticipantInOrg(id, gate.organizationId);

    // Peer / CM / PRP: only participants on their caseload (same rule as the participants list)
    if (!participant || !(await participantOnCaseload(gate, participant))) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'aotParticipant',
      resourceId: participant.id,
      patientId: participant.clientId ?? null,
      metadata: { clinical: canSeeAotClinical(gate.role) },
    });

    // Affidavit / MSE / diagnosis / eligibility / non-adherence: EHR clinical roles only
    return NextResponse.json({ success: true, participant: redactAotParticipant(participant, gate.role) });
  } catch (err: unknown) {
    console.error('[aot/participants/[id] GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Error fetching AOT participant' },
      { status: 500 }
    );
  }
}

const dateStr = z.string().trim().min(8).max(40);
const jsonArray = z.array(z.record(z.string(), z.unknown())).max(500);

const patchSchema = z.object({
  status: z.string().trim().min(1).max(40).optional(),
  county: z.string().trim().min(1).max(120).optional(),
  diagnosis: z.string().trim().min(1).max(500).optional(),
  petitionDate: dateStr.optional(),
  hearingDate: dateStr.optional(),
  orderStart: dateStr.optional(),
  orderEnd: dateStr.optional(),
  eligibilityData: z.record(z.string(), z.unknown()).optional(),
  psychiatristAffidavit: z.record(z.string(), z.unknown()).optional(),
  deadlines: jsonArray.optional(),
  teamCadence: jsonArray.optional(),
  escalationEvents: jsonArray.optional(),
  // MDH petition checklist: merged into eligibilityData.petitionChecklist (other eligibility keys kept).
  petitionChecklist: z.record(z.string(), z.unknown()).optional(),
  // Sign the affidavit in psychiatristAffidavit. Signer and time are set here, never by the client.
  signAffidavit: z.literal(true).optional(),
});

// Roles that may sign the AOT physician affidavit.
const AFFIDAVIT_SIGNER_ROLES = new Set(['PSYCHIATRIST', 'NP', 'PHYSICIAN']);
const SIGNATURE_KEYS = ['signed', 'signedAt', 'signedById', 'signedByName'] as const;

function isSignedAffidavit(v: unknown): boolean {
  return !!v && typeof v === 'object' && (v as Record<string, unknown>).signed === true;
}

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const { id } = await ctx.params;
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid AOT participant update' }, { status: 400 });
    }
    const body = parsed.data;
    const existing = await findParticipantInOrg(id, gate.organizationId);
    if (!existing || !(await participantOnCaseload(gate, existing))) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }
    // Clinical columns (diagnosis, eligibility criteria, affidavit, non-adherence events) and the
    // affidavit signature: EHR clinical roles only. Others may update the operational fields.
    if (!canSeeAotClinical(gate.role)) {
      const clinical = [...AOT_CLINICAL_FIELDS, 'signAffidavit'].filter((k) => (body as Record<string, unknown>)[k] !== undefined);
      if (clinical.length) {
        await auditPhiAccess({
          gate, req, action: 'WRITE', resourceType: 'aotParticipant', resourceId: existing.id,
          patientId: existing.clientId ?? null, outcome: 'DENIED', metadata: { reason: 'clinical_fields_not_permitted', fields: clinical },
        });
        return NextResponse.json({ success: false, error: 'Your role cannot change clinical AOT fields' }, { status: 403 });
      }
    }

    // MDH: an order term may not exceed one year (checked against the stored date the request leaves unchanged).
    const termProblem = orderTermProblem(body.orderStart ?? existing.orderStart, body.orderEnd ?? existing.orderEnd);
    if (termProblem && (body.orderStart || body.orderEnd)) {
      return NextResponse.json({ success: false, error: termProblem }, { status: 400 });
    }
    const petitionerIssue = petitionerIssueIn(body.eligibilityData);
    if (petitionerIssue) {
      return NextResponse.json({ success: false, error: petitionerIssue }, { status: 400 });
    }
    let eligibilityData: Record<string, unknown> | undefined = body.eligibilityData;
    if (body.petitionChecklist) {
      const base =
        eligibilityData ??
        (existing.eligibilityData && typeof existing.eligibilityData === 'object' && !Array.isArray(existing.eligibilityData)
          ? (existing.eligibilityData as Record<string, unknown>)
          : {});
      const checklist = normalizeChecklist(body.petitionChecklist);
      // "By" defaults to the signed-in user when an item is marked done without a name.
      for (const entry of Object.values(checklist)) {
        if (entry.done && !entry.by) entry.by = gate.session.user.name ?? null;
      }
      eligibilityData = { ...base, petitionChecklist: checklist };
    }

    let affidavit: Record<string, unknown> | undefined;
    if (body.psychiatristAffidavit || body.signAffidavit) {
      if (isSignedAffidavit(existing.psychiatristAffidavit)) {
        return NextResponse.json(
          { success: false, error: 'This affidavit is already signed and locked' },
          { status: 409 }
        );
      }
      if (!body.psychiatristAffidavit) {
        return NextResponse.json({ success: false, error: 'Affidavit content is required to sign' }, { status: 400 });
      }
      // Drop any client-supplied signature fields; only the sign action below sets them.
      affidavit = { ...body.psychiatristAffidavit };
      for (const k of SIGNATURE_KEYS) delete affidavit[k];
      if (body.signAffidavit) {
        if (!AFFIDAVIT_SIGNER_ROLES.has(String(gate.role))) {
          return NextResponse.json(
            { success: false, error: 'Only a psychiatrist, physician, or NP can sign the affidavit' },
            { status: 403 }
          );
        }
        affidavit.signed = true;
        affidavit.signedAt = new Date().toISOString();
        affidavit.signedById = gate.userId;
        affidavit.signedByName = gate.session.user.name ?? null;
      }
    }

    const updated = await prisma.aotParticipant.update({
      where: { id },
      data: {
        status: body.status,
        county: body.county,
        diagnosis: body.diagnosis,
        petitionDate: body.petitionDate ? new Date(body.petitionDate) : undefined,
        hearingDate: body.hearingDate ? new Date(body.hearingDate) : undefined,
        orderStart: body.orderStart ? new Date(body.orderStart) : undefined,
        orderEnd: body.orderEnd ? new Date(body.orderEnd) : undefined,
        eligibilityData: eligibilityData as Prisma.InputJsonValue | undefined,
        psychiatristAffidavit: affidavit as Prisma.InputJsonValue | undefined,
        deadlines: body.deadlines as Prisma.InputJsonValue | undefined,
        teamCadence: body.teamCadence as Prisma.InputJsonValue | undefined,
        escalationEvents: body.escalationEvents as Prisma.InputJsonValue | undefined,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'aotParticipant',
      resourceId: updated.id,
      patientId: updated.clientId ?? null,
      metadata: { fields: Object.keys(body), signed: body.signAffidavit === true },
    });

    return NextResponse.json({ success: true, participant: redactAotParticipant(updated, gate.role) });
  } catch (err: unknown) {
    console.error('[aot/participants/[id] PATCH]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json(
      { success: false, error: 'Error updating AOT participant' },
      { status: 500 }
    );
  }
}
