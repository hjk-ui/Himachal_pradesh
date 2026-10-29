import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import type { Role } from '@prisma/client';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canUsePrpWorkflow, prpWorkflowWriteBlock } from '@/lib/prp/workflowAccess';
import { irpFinalizeBlockers, resolveIrpReviewDue } from '@/lib/prp/standard';
import { loadPrpSettingsRow } from '@/lib/prp/settings';
import { ageOn } from '@/lib/ehr/psychMedMgmt';
import { clinicDate } from '@/lib/workflows/dates';

export const dynamic = 'force-dynamic';

// PrpWorkflow has no organizationId — tenant scope goes through the client, narrowed to the
// actor's caseload / care team (clientAccessWhere).
async function clientInScope(clientId: string, gate: { organizationId: string; userId: string; role: Role }) {
  return prisma.client.findFirst({
    where: {
      AND: [
        clientByIdWhere(clientId, gate.organizationId),
        clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
      ],
    },
    select: { id: true, dateOfBirth: true },
  });
}

export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!canUsePrpWorkflow(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'prpWorkflow', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }
    if (!(await clientInScope(clientId, gate))) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    const workflow = await prisma.prpWorkflow.findFirst({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'prpWorkflow',
      resourceId: workflow?.id ?? null,
      patientId: clientId,
      metadata: { found: Boolean(workflow), stage: workflow?.stage ?? null },
    });

    return NextResponse.json({ success: true, data: workflow });
  } catch (err: unknown) {
    console.error('[prp-workflow-get] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Failed to fetch PRP workflow' }, { status: 500 });
  }
}

const STAGES = ['referral', 'enrolled', 'assessed', 'irp'] as const;

function jsonStatus(v: unknown): string | undefined {
  return v && typeof v === 'object' ? ((v as Record<string, unknown>).status as string | undefined) : undefined;
}

const prpWorkflowSchema = z.object({
  clientId: z.string().min(1),
  stage: z.enum(STAGES),
  // Required to change a signed assessment or a final IRP. No UI sends it yet (amendments not built).
  amend: z.literal(true).optional(),
  referralData: z.record(z.string(), z.any()).optional(),
  enrollmentData: z.record(z.string(), z.any()).optional(),
  assessmentData: z.record(z.string(), z.any()).optional(),
  irpData: z.record(z.string(), z.any()).optional(),
  qualifyingIcd10: z.string().optional(),
  recommendedDomains: z.array(z.string()).optional(),
  medicalNecessityStrength: z.enum(['weak', 'moderate', 'strong']).optional(),
  prescriberNpi: z.string().optional(),
  prescriberSignature: z.string().optional(),
  irpEffectiveDate: z.string().optional(),
  irpReviewDueDate: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  if (!canUsePrpWorkflow(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'prpWorkflow', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const json = await req.json();
    const parsed = prpWorkflowSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 400 });
    }

    const {
      clientId,
      stage,
      referralData,
      enrollmentData,
      assessmentData,
      irpData,
      qualifyingIcd10,
      recommendedDomains,
      medicalNecessityStrength,
      prescriberNpi,
      prescriberSignature,
      irpEffectiveDate,
      irpReviewDueDate,
      amend,
    } = parsed.data;

    const blocked = prpWorkflowWriteBlock(gate.role, parsed.data);
    if (blocked) {
      await auditPhiAccess({ gate, req, action: 'WRITE', resourceType: 'prpWorkflow', patientId: clientId, outcome: 'DENIED', metadata: { reason: blocked } });
      return NextResponse.json({ error: 'Your role cannot save this part of the PRP record' }, { status: 403 });
    }

    const client = await clientInScope(clientId, gate);
    if (!client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // Finalizing an IRP (COMAR 10.63 PRP): rehabilitation goals, participant + staff signatures with
    // dates, and a review date within the practice interval (adult / under 18), computed when blank.
    let finalReviewDue: Date | null = null;
    if (irpData && jsonStatus(irpData) === 'final') {
      const age = ageOn(client.dateOfBirth ? client.dateOfBirth.toISOString() : null, clinicDate());
      const blockers = irpFinalizeBlockers(irpData, { minor: age != null && age < 18 });
      if (blockers.length) {
        return NextResponse.json({ error: `The IRP cannot be finalized yet. Missing: ${blockers.join('; ')}`, missing: blockers }, { status: 400 });
      }
      const settings = await loadPrpSettingsRow(gate.organizationId);
      const review = resolveIrpReviewDue({
        effectiveDate: irpEffectiveDate || (typeof irpData.date === 'string' ? irpData.date : null),
        enteredReviewDate: irpReviewDueDate || (typeof irpData.nextIRPReviewDate === 'string' ? irpData.nextIRPReviewDate : null),
        ageYears: age,
        practiceDays: settings?.prpIrpReviewDays ?? null,
      });
      if (review.ok === false) return NextResponse.json({ error: review.error }, { status: 400 });
      finalReviewDue = review.reviewDue;
    }

    const existing = await prisma.prpWorkflow.findFirst({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
    });

    // Signed / finalized documents are locked: a later draft save must not overwrite them.
    if (existing && !amend) {
      if (assessmentData && jsonStatus(existing.assessmentData) === 'signed') {
        return NextResponse.json(
          { error: 'The assessment on file is signed and locked; changes need an amendment.' },
          { status: 409 }
        );
      }
      if (irpData && jsonStatus(existing.irpData) === 'final') {
        return NextResponse.json(
          { error: 'The IRP on file is finalized and locked; changes need an amendment.' },
          { status: 409 }
        );
      }
    }

    // The workflow stage only moves forward.
    const existingIdx = existing ? STAGES.indexOf(existing.stage as (typeof STAGES)[number]) : -1;
    const nextStage = existingIdx > STAGES.indexOf(stage) ? STAGES[existingIdx] : stage;

    // DB failures surface as 500 — the client must never be told a draft saved when it did not.
    const record = existing
      ? await prisma.prpWorkflow.update({
          where: { id: existing.id },
          data: {
            stage: nextStage,
            ...(referralData ? { referralData } : {}),
            ...(enrollmentData ? { enrollmentData } : {}),
            ...(assessmentData ? { assessmentData } : {}),
            ...(irpData ? { irpData } : {}),
            ...(qualifyingIcd10 ? { qualifyingIcd10 } : {}),
            ...(recommendedDomains ? { recommendedDomains } : {}),
            ...(medicalNecessityStrength ? { medicalNecessityStrength } : {}),
            ...(prescriberNpi ? { prescriberNpi } : {}),
            ...(prescriberSignature ? { prescriberSignature } : {}),
            ...(irpEffectiveDate ? { irpEffectiveDate: new Date(irpEffectiveDate) } : {}),
            ...(finalReviewDue ? { irpReviewDueDate: finalReviewDue } : irpReviewDueDate ? { irpReviewDueDate: new Date(irpReviewDueDate) } : {}),
          },
        })
      : await prisma.prpWorkflow.create({
          data: {
            clientId,
            stage,
            referralData: referralData || {},
            enrollmentData: enrollmentData || {},
            assessmentData: assessmentData || {},
            irpData: irpData || {},
            qualifyingIcd10,
            recommendedDomains: recommendedDomains || [],
            medicalNecessityStrength,
            prescriberNpi,
            prescriberSignature,
            irpEffectiveDate: irpEffectiveDate ? new Date(irpEffectiveDate) : undefined,
            irpReviewDueDate: finalReviewDue ?? (irpReviewDueDate ? new Date(irpReviewDueDate) : undefined),
          },
        });

    await auditPhiAccess({
      gate,
      req,
      action: existing ? 'WRITE' : 'CREATE',
      resourceType: 'prpWorkflow',
      resourceId: record.id,
      patientId: clientId,
      metadata: {
        stage: record.stage,
        amend: amend === true,
        assessmentStatus: jsonStatus(record.assessmentData) ?? null,
        irpStatus: jsonStatus(record.irpData) ?? null,
        fields: Object.entries(parsed.data)
          .filter(([k, v]) => k !== 'clientId' && k !== 'amend' && v !== undefined && v !== null && v !== '')
          .map(([k]) => k),
      },
    });

    return NextResponse.json({ success: true, data: record });
  } catch (err: unknown) {
    console.error('[prp-workflow-post] error:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Failed to save PRP workflow' }, { status: 500 });
  }
}
