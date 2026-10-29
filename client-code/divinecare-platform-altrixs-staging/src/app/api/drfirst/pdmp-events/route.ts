import { NextRequest, NextResponse } from 'next/server';
import { getPdmpEvents } from '@/lib/services/drfirstCommands';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { requireDrFirstCaller, findDrFirstClient, drFirstCaseloadClientIds } from '../_lib/access';
import { buildClientResolver, downloadWindow, loadOrgPrescribers, parseRcopiaDate } from '../_lib/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/pdmp-events[?patient=<clientId>]
 *
 * Pulls Rcopia's PDMP consultation trail (get_pdmp_events) into
 * maryland_pdmp_audits — the record of Maryland's mandatory PDMP review
 * (Health-General § 21-2A-04.1). Only what DrFirst reports is stored:
 * an event without a reviewer, a review date, or a reviewer NPI (from the
 * event or the reviewer's own staff profile) is skipped and reported, never
 * filled in. Prescriber or ADMIN, each with their own Rcopia username (an ADMIN no longer makes
 * practice-level calls without one). ?patient= must be on the caller's caseload (drFirstClientWhere;
 * leadership and the verified Medical Director org-wide) and pass the 42 CFR Part 2 / sensitive lock.
 * Without ?patient every downloaded event is stored, but `stored` lists only clients on the caller's
 * caseload that pass the Part 2 lock (drFirstCaseloadClientIds); `storedTotal` / `notListed` are counts.
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  if (DEMO_MODE) {
    return NextResponse.json({ success: true, demo: true, events: [], message: 'DrFirst is not configured on this server.' });
  }

  const patientParam = req.nextUrl.searchParams.get('patient');
  let patient: { rcopiaId?: string; externalId?: string } | undefined;
  let onlyClientId: string | undefined;
  if (patientParam) {
    const found = await findDrFirstClient(c, patientParam, { id: true, rcopiaPatientId: true }, '/api/drfirst/pdmp-events');
    if (found.response) return found.response;
    const client = found.client;
    onlyClientId = client.id;
    patient = client.rcopiaPatientId && client.rcopiaPatientId !== client.id ? { rcopiaId: client.rcopiaPatientId } : { externalId: client.id };
  }

  // LastUpdateDate per practice, or per patient for a patient-level call; at most every 5 minutes per scope
  const dl = await downloadWindow('get_pdmp_events', c.organizationId, onlyClientId);
  if (dl.throttled) {
    return NextResponse.json(
      { error: 'DrFirst was checked for this less than 5 minutes ago. Try again shortly.', code: 'THROTTLED', retryAfterSeconds: dl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(dl.retryAfterSeconds) } },
    );
  }
  const result = await getPdmpEvents({ lastUpdateDate: dl.cursor, patient }, c.rcopiaUsername || undefined);
  if (!result.ok) {
    await audit(c, onlyClientId, 'FAILURE', { error: result.error?.code || result.status });
    return NextResponse.json({ error: result.error?.text || 'DrFirst did not return PDMP events', code: result.error?.code }, { status: 502 });
  }

  const resolve = await buildClientResolver(c.organizationId, result.events);
  const staff = await loadOrgPrescribers(c.organizationId);
  // List mode (no ?patient): every row is stored (practice-level compliance trail, cursor advances
  // practice-wide), but the response lists only clients on the caller's caseload that pass the
  // Part 2 / sensitive lock. A failed scope lookup lists nothing (fail closed) and keeps the cursor.
  let visible: Set<string> | null = null;
  if (!onlyClientId) {
    try {
      visible = await drFirstCaseloadClientIds(c, result.events.map(r => resolve(r)));
    } catch (err) {
      console.error('[drfirst-pdmp-events] scope lookup failed', JSON.stringify({ error: err instanceof Error ? err.name : 'unknown' }));
      await audit(c, undefined, 'FAILURE', { error: 'SCOPE_LOOKUP_FAILED' });
      return NextResponse.json({ error: 'Could not check which patients you may see. Try again shortly.', code: 'SCOPE_UNAVAILABLE' }, { status: 503 });
    }
  }
  let notListed = 0;
  let storedCount = 0;
  const stored: { clientId: string; reviewDate: string; reviewerUsername: string; reviewerNpi: string; locationId: string | null }[] = [];
  const skipped = { noClient: 0, noReviewer: 0, noReviewDate: 0, noReviewerNpi: 0, duplicate: 0, failed: 0 };

  for (const ev of result.events) {
    const clientId = resolve(ev);
    if (!clientId || (onlyClientId && clientId !== onlyClientId)) { skipped.noClient += 1; continue; }
    const reviewerUsername = ev.reviewerUsername?.trim();
    if (!reviewerUsername) { skipped.noReviewer += 1; continue; }
    const reviewedAt = parseRcopiaDate(ev.reviewDate);
    if (!reviewedAt) { skipped.noReviewDate += 1; continue; }
    const reviewerNpi = ev.reviewerNpi?.trim() || staff.get(reviewerUsername.toLowerCase())?.npi || null;
    if (!reviewerNpi) { skipped.noReviewerNpi += 1; continue; }
    const locationId = ev.reviewerLocationExternalId?.trim() || null;
    try {
      const dup = await prisma.marylandPdmpAudit.findFirst({
        where: { clientId, reviewerUsername, consultationTimestamp: reviewedAt },
        select: { id: true },
      });
      if (dup) { skipped.duplicate += 1; continue; }
      await prisma.marylandPdmpAudit.create({
        data: { clientId, reviewerUsername, reviewerNpi, locationId, consultationTimestamp: reviewedAt, status: 'reviewed' },
      });
      storedCount += 1;
      if (visible && !visible.has(clientId)) notListed += 1;
      else stored.push({ clientId, reviewDate: reviewedAt.toISOString(), reviewerUsername, reviewerNpi, locationId });
    } catch (err) {
      skipped.failed += 1;
      console.error('[drfirst-pdmp] write failed', JSON.stringify({ error: err instanceof Error ? err.name : 'unknown' }));
    }
  }

  const cursorAdvanced = skipped.failed === 0 ? await dl.save(result.nextCursor) : false;

  await audit(c, onlyClientId, 'SUCCESS', { downloaded: result.events.length, stored: storedCount, ...skipped, cursorAdvanced, notListed });

  return NextResponse.json({
    success: true,
    downloaded: result.events.length,
    stored,
    /** All rows stored by this call, including ones not listed (off caseload / Part 2-locked). */
    storedTotal: storedCount,
    notListed,
    skipped,
    cursorAdvanced,
    complianceNote: 'Maryland Health-General § 21-2A-04.1: query the PDMP before starting a course of treatment with an opioid or a benzodiazepine, and at least every 90 days while it continues.',
  });
}

async function audit(
  c: { userId: string; role: string; organizationId: string; ipAddress: string | null; userAgent: string | null },
  patientId: string | undefined,
  outcome: 'SUCCESS' | 'FAILURE',
  metadata: Record<string, unknown>,
) {
  await writeAuditLog({
    action: 'DRFIRST_PDMP_EVENTS_DOWNLOAD',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'pdmp_audit',
    resourceId: 'get_pdmp_events',
    patientId: patientId ?? null,
    outcome,
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata,
  });
}
