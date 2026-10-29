import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findParticipantInOrg } from '../_scope';
import { listOutreach } from '@/lib/aot/documents';
import { failedOutreachStreak, suggestNonResponsiveLetter, LETTER_SUGGEST_AFTER_FAILED } from '@/lib/aot/forms/deadlines';

export const runtime = 'nodejs';

/** GET /api/aot/outreach?participantId= — the participant's outreach attempts, newest first. */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const participant = await findParticipantInOrg(new URL(req.url).searchParams.get('participantId') || '', gate.organizationId);
    if (!participant) return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    const [attempts, lastLetter] = await Promise.all([
      listOutreach(gate.organizationId, participant.id),
      prisma.aotDocument.findFirst({
        where: { organizationId: gate.organizationId, participantId: participant.id, formType: 'nonresponsive_letter', status: 'signed' },
        orderBy: { signedAt: 'desc' },
        select: { signedAt: true },
      }),
    ]);

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'aotOutreachAttempt',
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, count: attempts.length },
    });

    return NextResponse.json({
      success: true,
      attempts,
      failedStreak: failedOutreachStreak(attempts),
      suggestLetter: suggestNonResponsiveLetter(attempts, lastLetter?.signedAt ?? null),
      threshold: LETTER_SUGGEST_AFTER_FAILED,
    });
  } catch (err: unknown) {
    console.error('[api/aot/outreach GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load outreach attempts' }, { status: 500 });
  }
}

const postSchema = z.object({
  participantId: z.string().min(1).max(64),
  attemptedAt: z.string().refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date'),
  method: z.enum(['phone', 'mail', 'in_person', 'text', 'email', 'other']),
  staffRole: z.enum(['cprs', 'case_manager', 'psychiatrist', 'other']),
  result: z.string().trim().min(2).max(1000),
});

/** POST /api/aot/outreach — log an outreach attempt (not in the future). */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const parsed = postSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Enter the date, method, staff role and result' }, { status: 400 });
    const participant = await findParticipantInOrg(parsed.data.participantId, gate.organizationId);
    if (!participant) return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    const at = new Date(/^\d{4}-\d{2}-\d{2}$/.test(parsed.data.attemptedAt) ? `${parsed.data.attemptedAt}T12:00:00Z` : parsed.data.attemptedAt);
    if (at.getTime() > Date.now() + 36 * 3600000) {
      return NextResponse.json({ success: false, error: 'An outreach attempt cannot be in the future' }, { status: 400 });
    }

    const created = await prisma.aotOutreachAttempt.create({
      data: {
        organizationId: gate.organizationId,
        participantId: participant.id,
        attemptedAt: at,
        method: parsed.data.method,
        staffRole: parsed.data.staffRole,
        result: parsed.data.result,
        createdById: gate.userId,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'aotOutreachAttempt',
      resourceId: created.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, method: created.method, staffRole: created.staffRole },
    });

    return NextResponse.json({ success: true, attempt: created }, { status: 201 });
  } catch (err: unknown) {
    console.error('[api/aot/outreach POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not save the outreach attempt' }, { status: 500 });
  }
}
