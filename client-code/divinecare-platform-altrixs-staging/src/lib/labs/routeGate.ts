import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { canEnterLabResults, canOrderLabs, canReleaseLabResults, canReviewLabResults, canViewLabs } from './access';
import type { LabActor } from './manage';

export type LabNeed = 'view' | 'order' | 'enter' | 'review' | 'release';

const CHECK: Record<LabNeed, (role: string) => boolean> = {
  view: canViewLabs,
  order: (r) => canViewLabs(r) && canOrderLabs(r),
  enter: canEnterLabResults,
  review: (r) => canViewLabs(r) && canReviewLabResults(r),
  release: (r) => canViewLabs(r) && canReleaseLabResults(r),
};

const DENIED: Record<LabNeed, string> = {
  view: 'Your role cannot view lab orders.',
  order: 'Only prescribers (psychiatrist, NP, physician, medical NP) can order labs.',
  enter: 'Your role cannot record lab collection or results.',
  review: 'Only prescribers can review and sign off lab results.',
  release: 'Only prescribers can release lab results to the patient portal.',
};

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/** Org context + lab role rule; denied attempts are audited */
export async function labGate(
  req: Request,
  need: LabNeed,
  resourceType = 'labOrder'
): Promise<{ gate: Gate; actor: LabActor; denied?: never } | { denied: NextResponse; gate?: never; actor?: never }> {
  const gate = await requireOrgContext();
  if (!gate.ok) return { denied: NextResponse.json({ success: false, error: gate.error }, { status: gate.status }) };
  if (!CHECK[need](gate.role)) {
    await auditPhiAccess({ gate, req, action: need === 'view' ? 'READ' : 'UPDATE', resourceType, outcome: 'DENIED', metadata: { reason: 'role_not_permitted', need } });
    return { denied: NextResponse.json({ success: false, error: DENIED[need] }, { status: 403 }) };
  }
  return { gate, actor: { organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role as Role } };
}

export function labError(err: unknown, tag: string, fallback: string) {
  if (err instanceof z.ZodError) {
    return NextResponse.json({ success: false, error: err.issues[0]?.message || 'Invalid request' }, { status: 400 });
  }
  console.error(`[${tag}]`, err);
  return NextResponse.json({ success: false, error: fallback }, { status: 500 });
}
