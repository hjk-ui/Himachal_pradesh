import { NextRequest, NextResponse } from 'next/server';
import { getReviewStatus } from '@/lib/services/drfirstCommands';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { requireDrFirstCaller, findDrFirstClient, drFirstCaseloadClientIds } from '../_lib/access';
import { buildClientResolver, downloadWindow, loadOrgPrescribers, parseRcopiaDate } from '../_lib/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/review-status[?patient=<clientId>]
 *
 * Pulls Rcopia's medication-reconciliation review trail (get_review_status)
 * into rcopia_med_rec_attestations. Only reviews DrFirst actually reports are
 * stored: a review without a reviewer, a date, or a reviewer NPI (from the
 * review or the reviewer's own staff profile) is skipped and reported.
 * Prescriber or ADMIN, each with their own Rcopia username (an ADMIN no longer makes practice-level
 * calls without one). ?patient= must be on the caller's caseload (drFirstClientWhere; leadership and
 * the verified Medical Director org-wide) and pass the 42 CFR Part 2 / sensitive-record lock.
 * Without ?patient every downloaded review is stored, but `statuses` lists only clients on the caller's
 * caseload that pass the Part 2 lock (drFirstCaseloadClientIds); the rest are counted in `notListed`.
 */
export async function GET(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  if (DEMO_MODE) {
    return NextResponse.json({ success: true, demo: true, statuses: [], message: 'DrFirst is not configured on this server.' });
  }

  const patientParam = req.nextUrl.searchParams.get('patient');
  let patients: { rcopiaId?: string; externalId?: string }[] | undefined;
  let onlyClientId: string | undefined;
  if (patientParam) {
    const found = await findDrFirstClient(c, patientParam, { id: true, rcopiaPatientId: true }, '/api/drfirst/review-status');
    if (found.response) return found.response;
    const client = found.client;
    onlyClientId = client.id;
    patients = [client.rcopiaPatientId && client.rcopiaPatientId !== client.id ? { rcopiaId: client.rcopiaPatientId } : { externalId: client.id }];
  }

  // LastUpdateDate per practice, or per patient for a patient-level call; at most every 5 minutes per scope
  const dl = await downloadWindow('get_review_status', c.organizationId, onlyClientId);
  if (dl.throttled) {
    return NextResponse.json(
      { error: 'DrFirst was checked for this less than 5 minutes ago. Try again shortly.', code: 'THROTTLED', retryAfterSeconds: dl.retryAfterSeconds },
      { status: 429, headers: { 'Retry-After': String(dl.retryAfterSeconds) } },
    );
  }
  const result = await getReviewStatus({ lastUpdateDate: dl.cursor, patients }, c.rcopiaUsername || undefined);
  if (!result.ok) {
    await audit(c, onlyClientId, 'FAILURE', { error: result.error?.code || result.status });
    return NextResponse.json({ error: result.error?.text || 'DrFirst did not return review status', code: result.error?.code }, { status: 502 });
  }

  const resolve = await buildClientResolver(c.organizationId, result.statuses);
  const staff = await loadOrgPrescribers(c.organizationId);
  // List mode (no ?patient): every row is stored (practice-level compliance trail, cursor advances
  // practice-wide), but the response lists only clients on the caller's caseload that pass the
  // Part 2 / sensitive lock. A failed scope lookup lists nothing (fail closed) and keeps the cursor.
  let visible: Set<string> | null = null;
  if (!onlyClientId) {
    try {
      visible = await drFirstCaseloadClientIds(c, result.statuses.map(r => resolve(r)));
    } catch (err) {
      console.error('[drfirst-review-status] scope lookup failed', JSON.stringify({ error: err instanceof Error ? err.name : 'unknown' }));
      await audit(c, undefined, 'FAILURE', { error: 'SCOPE_LOOKUP_FAILED' });
      return NextResponse.json({ error: 'Could not check which patients you may see. Try again shortly.', code: 'SCOPE_UNAVAILABLE' }, { status: 503 });
    }
  }
  let notListed = 0;
  const skipped = { noClient: 0, noReviewer: 0, noReviewDate: 0, noReviewerNpi: 0, duplicate: 0, failed: 0 };
  let stored = 0;
  const statuses: { clientId: string; medicationComplete: boolean | null; medicationReviews: number; allergyReviews: number; problemReviews: number }[] = [];

  for (const st of result.statuses) {
    const clientId = resolve(st);
    if (!clientId || (onlyClientId && clientId !== onlyClientId)) { skipped.noClient += 1; continue; }
    if (visible && !visible.has(clientId)) notListed += 1;
    else statuses.push({
      clientId,
      medicationComplete: st.medication.complete ?? null,
      medicationReviews: st.medication.reviews.length,
      allergyReviews: st.allergy.reviews.length,
      problemReviews: st.problem.reviews.length,
    });
    for (const rev of st.medication.reviews) {
      const reviewerUsername = rev.reviewerUsername?.trim();
      if (!reviewerUsername) { skipped.noReviewer += 1; continue; }
      const attestationDate = parseRcopiaDate(rev.reviewDate);
      if (!attestationDate) { skipped.noReviewDate += 1; continue; }
      const reviewerNpi = rev.reviewerNpi?.trim() || staff.get(reviewerUsername.toLowerCase())?.npi || null;
      if (!reviewerNpi) { skipped.noReviewerNpi += 1; continue; }
      try {
        const dup = await prisma.rcopiaMedRecAttestation.findFirst({
          where: { clientId, reviewerUsername, attestationDate },
          select: { id: true },
        });
        if (dup) { skipped.duplicate += 1; continue; }
        await prisma.rcopiaMedRecAttestation.create({
          data: { clientId, reviewerUsername, reviewerNpi, attestationDate, meaningfulUseCertified: true },
        });
        stored += 1;
      } catch (err) {
        skipped.failed += 1;
        console.error('[drfirst-review-status] write failed', JSON.stringify({ error: err instanceof Error ? err.name : 'unknown' }));
      }
    }
  }

  const cursorAdvanced = skipped.failed === 0 ? await dl.save(result.nextCursor) : false;

  await audit(c, onlyClientId, 'SUCCESS', { downloaded: result.statuses.length, stored, ...skipped, cursorAdvanced, notListed });

  return NextResponse.json({
    success: true,
    downloaded: result.statuses.length,
    stored,
    skipped,
    cursorAdvanced,
    statuses,
    /** Downloaded rows not listed: off the caller's caseload or Part 2 / sensitive-locked (still stored). */
    notListed,
    meaningfulUseNote: 'Meaningful Use Med-Reconciliation Attestation Audit Log',
  });
}

async function audit(
  c: { userId: string; role: string; organizationId: string; ipAddress: string | null; userAgent: string | null },
  patientId: string | undefined,
  outcome: 'SUCCESS' | 'FAILURE',
  metadata: Record<string, unknown>,
) {
  await writeAuditLog({
    action: 'DRFIRST_REVIEW_STATUS_DOWNLOAD',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'med_rec_attestation',
    resourceId: 'get_review_status',
    patientId: patientId ?? null,
    outcome,
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata,
  });
}
