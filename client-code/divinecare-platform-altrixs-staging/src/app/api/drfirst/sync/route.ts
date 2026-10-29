import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientOrgFilter } from '@/lib/clients/orgScope';
import type { Role } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { requireDrFirstCaller, isCronRequest, findDrFirstClient } from '../_lib/access';
import { syncOrganization, syncPatient, totals, stepSummary, patientRetryAfterSeconds, type StepResult } from '../_lib/sync';
import { JOB_LOCK_KEYS, withJobLock } from '@/lib/jobs/advisoryLock';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';

export const dynamic = 'force-dynamic';

/** Cap on a prescriber's "my patients" sync (each patient is two Rcopia calls). */
const MAX_PATIENTS_PER_SYNC = 25;

/** Org-level syncs move the shared cursors: same advisory lock as scripts/drfirst-sync.ts (cron). */
const SYNC_BUSY = { success: false, error: 'A DrFirst sync is already running. Try again when it finishes.' };

/**
 * POST /api/drfirst/sync — pull Rcopia data into the Altrixs chart.
 *
 * - Cron: `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret: <CRON_SECRET>`.
 *   Syncs DEFAULT_ORG, or every active organization when it is unset.
 *   Practice-level (no RcopiaUserName).
 * - ADMIN (with their own Rcopia username), body {} : practice-wide delta sync (update_patient, update_medication, update_prescription,
 *   update_prescription_events, update_allergy, update_problem, update_rxfill, update_rxchange,
 *   update_notification, update_patient_office_visits) for the caller's
 *   organization, cursor per org.
 * - Prescriber (canPrescribe), body { clientId? } : that patient (on the caller's
 *   caseload — drFirstClientWhere: assigned, treatment team or appointment; verified
 *   Medical Director org-wide — and past the 42 CFR Part 2 / sensitive-record lock,
 *   same rule as /api/drfirst/sso) or, without clientId, the caller's own patients
 *   (assigned to them, or with a medication they prescribed, within their caseload
 *   scope) that are registered in Rcopia; Part 2-locked charts are skipped. Signs as the caller's own
 *   User.rcopiaUsername; never touches the org cursors.
 *
 * Response and audit log carry ids and counts only.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get('x-cron-secret') || req.headers.get('authorization')?.startsWith('Bearer ')) {
    return cronSync(req);
  }

  const g = await requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  if (DEMO_MODE) {
    return NextResponse.json({ success: true, demo: true, message: 'DrFirst is not configured on this server; nothing was synced.' });
  }

  const body = (await req.json().catch(() => ({}))) as { clientId?: unknown };
  const clientId = typeof body.clientId === 'string' && body.clientId.trim() ? body.clientId.trim() : undefined;

  // ADMIN without a patient: practice-wide sync for the admin's own org
  if (!c.isPrescriber || (c.isAdmin && !clientId)) {
    if (clientId) return NextResponse.json({ error: 'Patient sync is for prescribers.' }, { status: 403 });
    const run = await withJobLock(JOB_LOCK_KEYS.drfirstSync, () =>
      syncOrganization(c.organizationId, c.rcopiaUsername || undefined, {
        userId: c.userId, role: c.role, ipAddress: c.ipAddress, userAgent: c.userAgent,
      })
    );
    if (!run.acquired) return NextResponse.json(SYNC_BUSY, { status: 409 });
    const steps = run.result;
    await writeAuditLog({
      action: 'DRFIRST_SYNC_ORG',
      actorUserId: c.userId,
      actorRole: c.role,
      organizationId: c.organizationId,
      resourceType: 'prescription',
      resourceId: 'drfirst-sync',
      outcome: Object.values(steps).every(s => s.ok) ? 'SUCCESS' : 'FAILURE',
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      metadata: { scope: 'organization', ...totals(steps), steps: stepSummary(steps) },
    });
    return NextResponse.json({ success: true, scope: 'organization', data: steps });
  }

  const rcopiaUsername = c.rcopiaUsername!;
  let clients: { id: string; rcopiaPatientId: string | null }[];
  if (clientId) {
    const found = await findDrFirstClient(c, clientId, { id: true, rcopiaPatientId: true }, '/api/drfirst/sync');
    if (found.response) return found.response;
    const client = found.client;
    if (!client.rcopiaPatientId) {
      return NextResponse.json({ error: 'This patient is not registered in DrFirst yet.' }, { status: 409 });
    }
    clients = [client];
  } else {
    const mine = await prisma.client.findMany({
      where: {
        AND: [
          clientOrgFilter(c.organizationId),
          clientAccessWhere({ organizationId: c.organizationId, actorUserId: c.userId, actorRole: c.role as Role }),
          { rcopiaPatientId: { not: null } },
          { OR: [{ assignedToId: c.userId }, { medications: { some: { prescribedById: c.userId } } }] },
        ],
      },
      select: { id: true, rcopiaPatientId: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_PATIENTS_PER_SYNC,
    });
    const locked = await lockedSensitiveClientIds({ organizationId: c.organizationId, userId: c.userId, role: c.role, clientIds: mine.map((m) => m.id) });
    clients = mine.filter((m) => !locked.has(m.id));
  }

  const results: Record<string, { medications: StepResult; prescriptions: StepResult }> = {};
  for (const client of clients) {
    results[client.id] = await syncPatient(c.organizationId, client, rcopiaUsername);
    await writeAuditLog({
      action: 'DRFIRST_MEDICATION_DOWNLOAD',
      actorUserId: c.userId,
      actorRole: c.role,
      organizationId: c.organizationId,
      resourceType: 'prescription',
      resourceId: 'drfirst-sync',
      patientId: client.id,
      outcome: results[client.id].medications.ok && results[client.id].prescriptions.ok ? 'SUCCESS' : 'FAILURE',
      ipAddress: c.ipAddress,
      userAgent: c.userAgent,
      metadata: { scope: 'patient', ...totals(results[client.id]), steps: stepSummary(results[client.id]) },
    });
  }

  // One patient whose every step was throttled (GM8 / DR2): say when the chart can refresh again
  const only = clientId ? results[clientId] : undefined;
  const retryAfterSeconds = only && Object.values(only).every(s => s.throttled) ? await patientRetryAfterSeconds(clientId!) : 0;

  return NextResponse.json({
    success: true,
    scope: clientId ? 'patient' : 'my_patients',
    retryAfterSeconds,
    patients: clients.length,
    truncated: !clientId && clients.length === MAX_PATIENTS_PER_SYNC,
    data: results,
  });
}

async function cronSync(req: NextRequest) {
  if (!isCronRequest(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (DEMO_MODE) return NextResponse.json({ success: true, demo: true, message: 'DrFirst is not configured; nothing was synced.' });

  const only = process.env.DEFAULT_ORG?.trim();
  const orgs = await prisma.organization.findMany({
    where: only ? { id: only } : { active: true },
    select: { id: true },
  });
  if (only && !orgs.length) return NextResponse.json({ error: 'DEFAULT_ORG does not match an organization' }, { status: 500 });

  const meta = auditRequestMeta(req);
  const results: Record<string, Record<string, StepResult>> = {};
  const run = await withJobLock(JOB_LOCK_KEYS.drfirstSync, async () => {
    for (const org of orgs) {
      results[org.id] = await syncOrganization(org.id, undefined, { userId: null, role: 'system', ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null });
      await writeAuditLog({
        action: 'DRFIRST_SYNC_ORG',
        actorUserId: null,
        actorRole: 'system',
        organizationId: org.id,
        resourceType: 'prescription',
        resourceId: 'drfirst-sync-cron',
        outcome: Object.values(results[org.id]).every(s => s.ok) ? 'SUCCESS' : 'FAILURE',
        ...meta,
        metadata: { scope: 'organization', trigger: 'cron', ...totals(results[org.id]), steps: stepSummary(results[org.id]) },
      });
    }
  });
  if (!run.acquired) return NextResponse.json(SYNC_BUSY, { status: 409 });
  return NextResponse.json({ success: true, organizations: orgs.length, data: results });
}
