import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { docMeta, formFields } from '@/lib/aot/forms';
import { documentSummary, loadDocumentInOrg } from '@/lib/aot/documents';

export const runtime = 'nodejs';

const bodySchema = z.object({
  trackingNumber: z.string().trim().min(6).max(60),
  mailedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/**
 * POST /api/aot/documents/[id]/mailed — record that a signed non-responsive letter (MDH#0002BHA) was sent
 * by certified mail: tracking number + mailed date on the letter, and a 'mail' attempt in the outreach log.
 * Staff mail the letter themselves; Altrixs sends nothing.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const { id } = await ctx.params;
    const body = bodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ success: false, error: 'Enter the certified-mail tracking number and mailed date' }, { status: 400 });
    const found = await loadDocumentInOrg(id, gate.organizationId);
    if (!found) return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 });
    const { doc, participant } = found;
    if (doc.formType !== 'nonresponsive_letter' || doc.status !== 'signed') {
      return NextResponse.json({ success: false, error: 'Only a signed non-responsive letter can be marked as mailed' }, { status: 409 });
    }
    const meta = docMeta(doc.data);
    if (meta.mailing) return NextResponse.json({ success: false, error: 'This letter is already recorded as mailed' }, { status: 409 });
    if (body.data.mailedDate < (doc.signedAt?.toISOString().slice(0, 10) ?? '')) {
      return NextResponse.json({ success: false, error: 'The mailed date cannot be before the letter was signed' }, { status: 400 });
    }

    const mailing = { ...body.data, recordedAt: new Date().toISOString(), recordedById: gate.userId };
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.aotDocument.update({
        where: { id: doc.id },
        data: { data: { ...formFields(doc.data), _meta: { ...meta, mailing } } as Prisma.InputJsonValue },
      });
      await tx.aotOutreachAttempt.create({
        data: {
          organizationId: gate.organizationId,
          participantId: participant.id,
          attemptedAt: new Date(`${body.data.mailedDate}T12:00:00Z`),
          method: 'mail',
          staffRole: 'other',
          result: `Certified letter MDH#0002BHA mailed (v${doc.version}), tracking # ${body.data.trackingNumber}`,
          createdById: gate.userId,
        },
      });
      return u;
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'aotDocument',
      resourceId: doc.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, formType: doc.formType, event: 'certified_mail_recorded' },
    });

    return NextResponse.json({ success: true, document: documentSummary(updated) });
  } catch (err: unknown) {
    console.error('[api/aot/documents/[id]/mailed POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not record the mailing' }, { status: 500 });
  }
}
