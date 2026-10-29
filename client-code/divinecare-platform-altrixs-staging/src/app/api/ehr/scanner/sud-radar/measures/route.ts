import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { canUseSudRadar } from '@/lib/clinical/sudRadar/access';
import { assignSudMeasures } from '@/lib/clinical/sudRadar/assignMeasures';
import { assignmentSummary, parseSudMeasureKeys } from '@/lib/clinical/sudRadar/measures';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientIds: z.array(z.string().min(1).max(64)).min(1).max(200),
  measures: z.array(z.string().max(20)).min(1).max(10),
});

/**
 * POST /api/ehr/scanner/sud-radar/measures — "Assign substance-use measures" from the SUD
 * Referral Radar (one client or the selected clients). Puts the ticked measures (AUDIT,
 * CAGE-AID, NIDA-Modified ASSIST, BAM) on the MBC outcome schedule; a measure already open for
 * the client is skipped. Same gates as the radar: radar roles only, the caller's caseload
 * (clientAccessWhere), clients with an open radar signal, and no protected (42 CFR Part 2)
 * client the caller cannot open. Each client assignment is audit-logged (SUD_MEASURES_ASSIGNED).
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseSudRadar(gate.role, gate.capabilities)) {
    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'outcomeSchedule', outcome: 'DENIED', metadata: { reason: 'role_not_permitted', source: 'sud-radar' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  const measures = parsed.success ? parseSudMeasureKeys(parsed.data.measures) : [];
  if (!parsed.success || !measures.length) {
    return NextResponse.json({ success: false, error: 'Pick at least one client and one measure' }, { status: 400 });
  }
  const requested = [...new Set(parsed.data.clientIds)];

  try {
    const clients = await prisma.client.findMany({
      where: {
        AND: [
          clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
          { id: { in: requested } },
          { radarSignals: { some: { organizationId: gate.organizationId, status: { in: ['new', 'reviewed', 'referred'] } } } },
        ],
      },
      select: { id: true, name: true },
    });
    const locked = await lockedSensitiveClientIds({
      organizationId: gate.organizationId,
      userId: gate.userId,
      role: gate.role,
      clientIds: clients.map((c) => c.id),
    });
    const allowed = clients.filter((c) => !locked.has(c.id));
    const notAllowed = requested.length - allowed.length;
    if (!allowed.length) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'outcomeSchedule', outcome: 'DENIED',
        metadata: { reason: 'no_permitted_clients', requested: requested.length, protected: locked.size, source: 'sud-radar' },
      });
      return NextResponse.json({ success: false, error: 'None of these clients can be assigned measures from the radar' }, { status: 404 });
    }

    const plan = await assignSudMeasures({
      organizationId: gate.organizationId,
      actor: { userId: gate.userId, role: String(gate.role) },
      clients: allowed,
      measures,
      trigger: 'manual',
    });
    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'outcomeSchedule', resourceId: 'sud-radar-measures',
      metadata: { source: 'sud-radar', measures, clients: allowed.length, assigned: plan.add.length, skipped: plan.skipped.length, notAllowed },
    });
    return NextResponse.json({
      success: true,
      assigned: plan.add.map((a) => ({ clientId: a.patientId, measure: a.measure, frequency: a.frequency })),
      skipped: plan.skipped,
      notAllowed,
      message: assignmentSummary(plan) + (notAllowed ? ` ${notAllowed} client${notAllowed === 1 ? '' : 's'} not on your radar list were left out.` : ''),
    });
  } catch (err) {
    console.error('[ehr/scanner/sud-radar/measures POST]', err instanceof Error ? err.message : 'unknown error');
    return NextResponse.json({ success: false, error: 'Could not assign the measures' }, { status: 500 });
  }
}
