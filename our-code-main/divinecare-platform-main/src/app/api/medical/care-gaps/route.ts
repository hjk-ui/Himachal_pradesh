import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  CARE_GAP_CATALOG,
  listCareGaps,
  applyCareGapAction,
} from '@/lib/medical/care-gaps';
import { assertMedicalClientAccess } from '@/lib/medical/access';

export const runtime = 'nodejs';

const READ_ROLES = new Set([
  'MEDICAL_ASSISTANT',
  'PHYSICIAN',
  'MEDICAL_NP',
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !READ_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const clientId = new URL(req.url).searchParams.get('clientId') || '';
  if (!clientId) {
    return NextResponse.json({
      success: true,
      catalog: CARE_GAP_CATALOG,
      gaps: [],
      note: 'Provide clientId for patient gaps; dates never invented — none on file until recorded',
    });
  }
  const access = await assertMedicalClientAccess(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    clientId
  );
  if (access.ok === false) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }
  const gaps = await listCareGaps(gate.organizationId, clientId);
  return NextResponse.json({
    success: true,
    catalog: CARE_GAP_CATALOG,
    gaps: gaps.map((g) => ({
      ...g,
      lastDoneDisplay: g.lastDoneAt || 'none on file',
    })),
  });
}

const postSchema = z.object({
  clientId: z.string().min(1),
  gapId: z.string().min(1),
  action: z.enum([
    'completed',
    'ordered',
    'done_elsewhere',
    'refused',
    'not_applicable',
    'reopened',
    'reported_elsewhere',
    'outreach',
  ]),
  note: z.string().max(500).optional(),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessPath(gate.role, '/dashboard/medical') || !READ_ROLES.has(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = postSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid care-gap action' }, { status: 400 });
  }

  const access = await assertMedicalClientAccess(
    { organizationId: gate.organizationId, userId: gate.userId, role: gate.role },
    parsed.data.clientId
  );
  if (access.ok === false) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status });
  }

  const isMa = gate.role === 'MEDICAL_ASSISTANT';
  const role = isMa ? 'ma' : 'provider';
  if (isMa && parsed.data.action !== 'reported_elsewhere' && parsed.data.action !== 'outreach') {
    return NextResponse.json(
      {
        success: false,
        error: 'MA may only mark done elsewhere / outreach — cannot close or met a gap',
      },
      { status: 403 }
    );
  }

  const result = await applyCareGapAction(
    gate.organizationId,
    parsed.data.clientId,
    parsed.data.gapId,
    { role, action: parsed.data.action, note: parsed.data.note }
  );
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    success: true,
    gaps: result.gaps.map((g) => ({
      ...g,
      lastDoneDisplay: g.lastDoneAt || 'none on file',
    })),
  });
}
