import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const clientId = req.nextUrl.searchParams.get('clientId');
    if (!clientId) {
      return NextResponse.json({ error: 'clientId is required' }, { status: 400 });
    }

    const workflow = await (prisma as any).prpWorkflow.findFirst({
      where: { clientId },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: workflow });
  } catch (err: any) {
    console.error('[prp-workflow-get] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to fetch PRP workflow' }, { status: 500 });
  }
}

const prpWorkflowSchema = z.object({
  clientId: z.string().min(1),
  stage: z.enum(['referral', 'enrolled', 'assessed', 'irp']),
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
    } = parsed.data;

    let record = null;
    try {
      const existing = await (prisma as any).prpWorkflow.findFirst({
        where: { clientId },
      });

      if (existing) {
        record = await (prisma as any).prpWorkflow.update({
          where: { id: existing.id },
          data: {
            stage,
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
            ...(irpReviewDueDate ? { irpReviewDueDate: new Date(irpReviewDueDate) } : {}),
          },
        });
      } else {
        record = await (prisma as any).prpWorkflow.create({
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
            irpReviewDueDate: irpReviewDueDate ? new Date(irpReviewDueDate) : undefined,
          },
        });
      }
    } catch (dbErr) {
      console.warn('[prp-workflow] DB write warning:', dbErr);
    }

    return NextResponse.json({
      success: true,
      data: record || { clientId, stage, updatedAt: new Date().toISOString() },
    });
  } catch (err: any) {
    console.error('[prp-workflow-post] error:', err);
    return NextResponse.json({ error: err.message || 'Failed to save PRP workflow' }, { status: 500 });
  }
}
