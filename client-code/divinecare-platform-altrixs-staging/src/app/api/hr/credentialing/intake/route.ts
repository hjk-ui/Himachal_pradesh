import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadPracticeIdentity } from '@/lib/practice/identity';

export const runtime = 'nodejs';

/** Stored checklist key (practice-neutral); the UI shows the practice name from Practice settings. */
const W9_DOC = 'W-9 Form (Group Practice)';
/** Older rows stored the W-9 item under a hard-coded practice name. */
const LEGACY_W9_DOCS = new Set(['W-9 Form (MD Behavioral Health)']);

function normalizeChecklist(raw: unknown): Array<{ documentName: string; completed: boolean }> | null {
  if (!Array.isArray(raw)) return null;
  return raw.map((d: { documentName?: string; completed?: boolean }) => ({
    documentName: LEGACY_W9_DOCS.has(String(d?.documentName)) ? W9_DOC : String(d?.documentName ?? ''),
    completed: Boolean(d?.completed),
  }));
}

/** Provider must be a user of the caller's organization (the enrollment table has no org column). */
async function orgUserIds(organizationId: string): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { organizationId }, select: { id: true } });
  return users.map((u) => u.id);
}

const INTAKE_DOCS = [
  'CAQH Profile Completed & Attested',
  'State Medical / Clinical License Copy',
  'DEA Certificate (if prescribing)',
  'State Controlled Substances (CDS) Permit',
  'Malpractice Insurance Certificate (COI)',
  W9_DOC,
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

  if (!canAccessPath(gate.role, '/dashboard/hr') && !canAccessPath(gate.role, '/dashboard/hr/credentialing')) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const ids = await orgUserIds(gate.organizationId);
    const rows = ids.length
      ? await prisma.providerPayerEnrollment.findMany({
          where: { providerUserId: { in: ids } },
          orderBy: { updatedAt: 'desc' },
        })
      : [];
    const enrollments = rows.map((r) => ({ ...r, checklist: normalizeChecklist(r.checklist) ?? [] }));
    const identity = await loadPracticeIdentity(gate.organizationId);

    return NextResponse.json({
      success: true,
      docsList: INTAKE_DOCS,
      w9Doc: W9_DOC,
      practiceName: identity.name,
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
    const provider = await prisma.user.findFirst({
      where: { id: body.providerUserId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!provider) {
      return NextResponse.json({ success: false, error: 'Provider not found' }, { status: 404 });
    }
    const payer = body.payerName || 'Optum MD (Medicaid BH)';
    const documentLabel =
      body.documentLabel !== undefined && LEGACY_W9_DOCS.has(body.documentLabel) ? W9_DOC : body.documentLabel;

    const existing = await prisma.providerPayerEnrollment.findUnique({
      where: {
        providerUserId_payerName: {
          providerUserId: body.providerUserId,
          payerName: payer,
        },
      },
    });

    let currentChecklist: Array<{ documentName: string; completed: boolean }> =
      normalizeChecklist(existing?.checklist) ?? INTAKE_DOCS.map(d => ({ documentName: d, completed: false }));

    if (documentLabel !== undefined && body.completed !== undefined) {
      currentChecklist = currentChecklist.map(doc =>
        doc.documentName === documentLabel ? { ...doc, completed: body.completed! } : doc
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
