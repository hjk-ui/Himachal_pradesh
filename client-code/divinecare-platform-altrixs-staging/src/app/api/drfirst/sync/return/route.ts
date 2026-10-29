import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { claimPoll } from '@/lib/drfirst/persistence';
import { requireDrFirstCaller, findDrFirstClient } from '../../_lib/access';
import { syncPatient, totals, stepSummary, patientRetryAfterSeconds } from '../../_lib/sync';

export const dynamic = 'force-dynamic';

/** Only the patient of a launch this recent is refreshed when the prescriber comes back. */
const LAUNCH_LOOKBACK_MS = 2 * 60 * 60_000;
/** Dampens tab switching: one return refresh per user per 20 seconds. */
const RETURN_SYNC_MIN_MS = 20_000;

/**
 * POST /api/drfirst/sync/return — the prescriber came back to Altrixs from Rcopia (the tab became
 * visible again). Refreshes the chart of the patient they last opened in Rcopia (latest
 * DRFIRST_SSO_LAUNCH with a patient in the last 2 hours) so the chart reflects what they did there
 * right away (DrFirst certification call 2026-10-23).
 *
 * Same access as POST /api/drfirst/sync {clientId}: prescriber with their own Rcopia username, the
 * patient on their caseload and past the 42 CFR Part 2 / sensitive-record lock. syncPatient keeps
 * every update_* scope to once per 5 minutes per patient (GM8 / DR2); a throttled refresh says
 * when the chart can update again. Response and audit log carry ids and counts only.
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  if (DEMO_MODE) return NextResponse.json({ success: true, demo: true });

  const claim = await claimPoll(`return_sync:${c.userId}`, RETURN_SYNC_MIN_MS);
  if (!claim.claimed) return NextResponse.json({ success: true, synced: false, reason: 'recent' });

  const launch = await prisma.auditLog.findFirst({
    where: {
      action: 'DRFIRST_SSO_LAUNCH',
      actorUserId: c.userId,
      organizationId: c.organizationId,
      patientId: { not: null },
      createdAt: { gte: new Date(Date.now() - LAUNCH_LOOKBACK_MS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { patientId: true },
  });
  if (!launch?.patientId) return NextResponse.json({ success: true, synced: false, reason: 'no_recent_launch' });

  const found = await findDrFirstClient(c, launch.patientId, { id: true, rcopiaPatientId: true }, '/api/drfirst/sync/return');
  if (found.response) return found.response;
  const client = found.client;
  if (!client.rcopiaPatientId) return NextResponse.json({ success: true, synced: false, reason: 'not_registered' });

  const steps = await syncPatient(c.organizationId, client, c.rcopiaUsername!);
  await writeAuditLog({
    action: 'DRFIRST_MEDICATION_DOWNLOAD',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'prescription',
    resourceId: 'drfirst-sync',
    patientId: client.id,
    outcome: steps.medications.ok && steps.prescriptions.ok ? 'SUCCESS' : 'FAILURE',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: { scope: 'patient', trigger: 'return_from_rcopia', ...totals(steps), steps: stepSummary(steps) },
  });

  const throttled = Object.values(steps).every((s) => s.throttled);
  const retryAfterSeconds = throttled ? await patientRetryAfterSeconds(client.id) : 0;

  return NextResponse.json({ success: true, synced: true, clientId: client.id, totals: totals(steps), throttled, retryAfterSeconds });
}
