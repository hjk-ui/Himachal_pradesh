/**
 * Appointment time-zone repair: REVIEW LIST by default, writes only for ids you name.
 *
 * Bug: the staff booking form sent a naive "2026-10-19" + "09:44" and the UTC server stored it as
 * 09:44 UTC (= 5:44 AM ET) instead of 09:44 ET (= 13:44 UTC). Valant-imported appointments were
 * converted with zonedToUtc and are correct. There is no safe automatic heuristic (an Altrixs
 * booking at 9:44 UTC could be a real 5:44 AM ET visit), so this lists every non-imported
 * appointment with what you need to decide:
 *   createdAt, startsAt UTC, startsAt as practice time, the "if mis-stored" corrected time,
 *   how it was created (staff API audit row / public booking / solo booking / unknown), and the
 *   CREATE audit metadata (newer audit rows record timeInput: 'instant' | 'practice_wall_clock').
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/fix-appointment-timezone.ts
 *   ... --org=<organizationId>        one org
 *   ... --since=2026-10-01            only appointments created on/after this date
 *   ... --apply --ids=<id1>,<id2>     re-read the stored UTC wall clock as practice time for exactly
 *                                     these ids (startsAt and endsAt), with an audit row each
 *
 * --apply without --ids does nothing. Ids/counts only in output: no client names or notes.
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { formatPracticeDateTime, fromPracticeWallTime } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';

/** The instant the user meant if `stored` holds their practice wall clock written as UTC. */
export function reinterpretUtcWallAsPractice(stored: Date, timeZone: string): Date | null {
  const iso = stored.toISOString();
  return fromPracticeWallTime(iso.slice(0, 10), iso.slice(11, 19), timeZone);
}

function arg(name: string) {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const ids = (arg('ids') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const org = arg('org');
  const since = arg('since');

  const rows = await prisma.appointment.findMany({
    where: {
      ...(org ? { organizationId: org } : {}),
      ...(since ? { createdAt: { gte: new Date(`${since}T00:00:00Z`) } } : {}),
      ...(apply && ids.length ? { id: { in: ids } } : {}),
      // NOT(contains) alone would drop rows whose notes are NULL
      OR: [{ notes: null }, { NOT: { notes: { contains: 'Valant code:' } } }],
    },
    select: {
      id: true,
      organizationId: true,
      createdAt: true,
      startsAt: true,
      endsAt: true,
      status: true,
      patientBooked: true,
      confirmationCode: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const audits = rows.length
    ? await prisma.auditLog.findMany({
        where: { resourceType: 'appointment', action: 'CREATE', resourceId: { in: rows.map((r) => r.id) } },
        select: { resourceId: true, createdAt: true, outcome: true, metadata: true },
      })
    : [];
  const auditById = new Map(audits.map((a) => [a.resourceId, a]));

  const tzCache = new Map<string, string>();
  const tzFor = async (orgId: string | null) => {
    const k = orgId ?? '';
    if (!tzCache.has(k)) tzCache.set(k, await getPracticeTimeZone(orgId));
    return tzCache.get(k)!;
  };

  const out = [];
  for (const r of rows) {
    const tz = await tzFor(r.organizationId);
    const audit = auditById.get(r.id);
    const corrected = reinterpretUtcWallAsPractice(r.startsAt, tz);
    const source = audit
      ? 'staff_api'
      : r.confirmationCode && r.patientBooked
        ? 'public_booking'
        : r.confirmationCode
          ? 'solo_booking_or_public'
          : 'unknown_no_create_audit';
    out.push({
      id: r.id,
      organizationId: r.organizationId,
      status: r.status,
      source,
      createdAt: r.createdAt.toISOString(),
      startsAtUtc: r.startsAt.toISOString(),
      startsAtPractice: formatPracticeDateTime(r.startsAt, tz),
      ifMisStoredCorrectedUtc: corrected?.toISOString() ?? null,
      ifMisStoredCorrectedPractice: corrected ? formatPracticeDateTime(corrected, tz) : null,
      auditCreate: audit
        ? { at: audit.createdAt.toISOString(), outcome: audit.outcome, metadata: audit.metadata }
        : null,
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? 'APPLY' : 'DRY RUN (review only)',
        candidates: out.length,
        bySource: out.reduce<Record<string, number>>((m, o) => ({ ...m, [o.source]: (m[o.source] ?? 0) + 1 }), {}),
        note:
          'Valant-imported rows (notes contain "Valant code:") are excluded. Rows booked after the fix carry auditCreate.metadata.timeInput and are correct.',
      },
      null,
      2
    )
  );
  for (const o of out) console.log(JSON.stringify(o));

  if (!apply) return;
  if (!ids.length) {
    console.log('--apply needs --ids=<id1>,<id2>; nothing written.');
    return;
  }
  for (const id of ids) {
    const r = rows.find((x) => x.id === id);
    if (!r) {
      console.log(`skip ${id}: not found / Valant-imported / outside filters`);
      continue;
    }
    const tz = await tzFor(r.organizationId);
    const start = reinterpretUtcWallAsPractice(r.startsAt, tz);
    const end = reinterpretUtcWallAsPractice(r.endsAt, tz);
    if (!start || !end) {
      console.log(`skip ${id}: could not compute corrected time`);
      continue;
    }
    await prisma.appointment.update({ where: { id }, data: { startsAt: start, endsAt: end } });
    await writeAuditLog({
      action: 'UPDATE',
      actorUserId: null,
      actorRole: 'system',
      organizationId: r.organizationId,
      resourceType: 'appointment',
      resourceId: id,
      outcome: 'SUCCESS',
      ipAddress: null,
      userAgent: 'scripts/fix-appointment-timezone.ts',
      metadata: {
        reason: 'timezone_repair_naive_wall_clock_stored_as_utc',
        timeZone: tz,
        fromStartsAt: r.startsAt.toISOString(),
        toStartsAt: start.toISOString(),
        fromEndsAt: r.endsAt.toISOString(),
        toEndsAt: end.toISOString(),
      },
    });
    console.log(`fixed ${id}: ${r.startsAt.toISOString()} -> ${start.toISOString()}`);
  }
}

if (process.argv[1]?.includes('fix-appointment-timezone')) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
