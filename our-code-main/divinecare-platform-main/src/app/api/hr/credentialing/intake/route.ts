import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';

export const runtime = 'nodejs';

const INTAKE_DOCS = [
  'CAQH Profile Completed & Attested',
  'State Medical / Clinical License Copy',
  'DEA Certificate (if prescribing)',
  'State Controlled Substances (CDS) Permit',
  'Malpractice Insurance Certificate (COI)',
  'W-9 Form (DivineCare / MD Behavioral Health)',
  'Board Certification / Degree Transcripts',
  'NPI Confirmation Letter (Type 1)',
  'Current Curriculum Vitae (CV — dated within 30 days)',
  'Government ID / Driver’s License Copy',
];

const INTAKE_PAYERS = [
  'Optum MD (Medicaid BH)',
  'Medicare',
  'CareFirst',
  'Aetna',
  'UHC/Optum',
  'Cigna',
];

const updateDocSchema = z.object({
  providerUserId: z.string().min(1),
  payerName: z.string().optional(),
  documentLabel: z.string().optional(),
  completed: z.boolean().optional(),
  status: z.enum(['active', 'in_process', 'submitted', 'not_started']).optional(),
  note: z.string().optional(),
});

export async function GET() {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  try {
    const enrollments = await prisma.providerPayerEnrollment.findMany({
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json({
      success: true,
      docsList: INTAKE_DOCS,
      payersList: INTAKE_PAYERS,
      enrollments,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Failed to query credentialing intake';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  if (!canAccessPath(gate.role, '/dashboard/hr') && !canAccessPath(gate.role, '/dashboard/hr/credentialing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = updateDocSchema.parse(await req.json());
    const payer = body.payerName || 'Optum MD (Medicaid BH)';

    const existing = await prisma.providerPayerEnrollment.findUnique({
      where: {
        providerUserId_payerName: {
          providerUserId: body.providerUserId,
          payerName: payer,
        },
      },
    });

    let currentChecklist: Array<{ documentName: string; completed: boolean }> =
      Array.isArray(existing?.checklist)
        ? (existing.checklist as any)
        : INTAKE_DOCS.map(d => ({ documentName: d, completed: false }));

    if (body.documentLabel !== undefined && body.completed !== undefined) {
      currentChecklist = currentChecklist.map(doc =>
        doc.documentName === body.documentLabel ? { ...doc, completed: body.completed! } : doc
      );
    }

    const updated = await prisma.providerPayerEnrollment.upsert({
      where: {
        providerUserId_payerName: {
          providerUserId: body.providerUserId,
          payerName: payer,
        },
      },
      update: {
        status: body.status || existing?.status || 'in_process',
        portalNotes: body.note ?? existing?.portalNotes,
        checklist: currentChecklist,
      },
      create: {
        providerUserId: body.providerUserId,
        payerName: payer,
        status: body.status || 'in_process',
        portalNotes: body.note || null,
        checklist: currentChecklist,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: error.flatten() }, { status: 400 });
    }
    const msg = error instanceof Error ? error.message : 'Failed to update credentialing';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
