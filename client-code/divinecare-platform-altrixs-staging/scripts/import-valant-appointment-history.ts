/**
 * Import Valant's historical appointments ("Biller Appointments" report CSV) so client "Last seen",
 * session cadence and behavioral care-team links work from go-live day.
 * DRY RUN by default: reads the database for matching and prints counts; writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/import-valant-appointment-history.ts --file=<csv>
 *   ... --parse-only                  parse the file only (no database): counts, statuses, provider labels
 *   ... --org=<organizationId>        default: the only organization (refuses when there are several)
 *   ... --apply                       write (createMany skipDuplicates in batches; one audit event per run)
 *   ... --treat-uncoded-as-attended   import visits with no code and no status as COMPLETED (else skipped)
 *   ... --since=YYYY-MM-DD --until=YYYY-MM-DD   practice-local date window (inclusive)
 *   ... --no-name-match               providers only via ValantProviderMap (no initial + last name match)
 *   ... --report=<path>               write unmatched chart ids + visit dates (no names) as JSON
 *   ... --close-out-scheduled         past appointments already here at the same slot and still SCHEDULED
 *                                     take Valant's outcome (stamped as imported history: no billing)
 *
 * Every --apply run also fills the provider on imported visits that have none once their Valant label
 * is in ValantProviderMap (e.g. a staff member added after the first run).
 *
 * Rules: src/lib/migration/valantAppointmentHistory.ts. Rows are inserted directly (never through
 * createAppointment): no reminders / SMS / email / push, telehealth rooms, charges, claims, notes or
 * DrFirst sync. Re-runs skip visits already imported (Appointment.externalKey, unique per org).
 *
 * Output: JSON counts only. No patient names, notes or DOBs; chart ids masked (last 2 characters).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  mergeVisits,
  maskChartId,
  nameDobKey,
  parseValantHistoryCsv,
  planValantHistory,
  slotKey,
  summarizeParse,
  VALANT_HISTORY_SOURCE,
  type ClientRef,
} from '@/lib/migration/valantAppointmentHistory';
import { buildProviderCodeMap } from '@/lib/migration/valantProviderMap';

const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const FILE = arg('file');
const APPLY = flag('apply');
const PARSE_ONLY = flag('parse-only');
const TREAT_UNCODED = flag('treat-uncoded-as-attended');
const NAME_MATCH = !flag('no-name-match');
const SINCE = arg('since');
const UNTIL = arg('until');
const REPORT = arg('report');
const CLOSE_OUT = flag('close-out-scheduled');
const BATCH = 1000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fail(error: string, extra: Record<string, unknown> = {}): never {
  console.log(JSON.stringify({ ok: false, error, ...extra }, null, 2));
  process.exit(1);
}

function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function main() {
  if (!FILE) fail('--file=<csv> is required');
  if (SINCE && !DATE_RE.test(SINCE)) fail('--since must be YYYY-MM-DD');
  if (UNTIL && !DATE_RE.test(UNTIL)) fail('--until must be YYYY-MM-DD');
  if (PARSE_ONLY && APPLY) fail('--parse-only and --apply cannot be combined');

  const parsed = parseValantHistoryCsv(readFileSync(FILE, 'utf8'));
  // Header names are report labels, not PHI
  if (!parsed.ok) fail(parsed.error, { headers: parsed.headers });

  if (PARSE_ONLY) {
    console.log(JSON.stringify({ ok: true, mode: 'parse-only', ...summarizeParse(parsed, { treatUncodedAsAttended: TREAT_UNCODED }) }, null, 2));
    return;
  }

  // Database modules load only here, so --parse-only runs without DATABASE_URL
  const { prisma } = await import('@/lib/db/prisma');
  const { writeAuditLog } = await import('@/lib/audit/writeAuditLog');
  const { invalidateCaseloadScopedCaches } = await import('@/lib/perf/cache');

  try {
    let organizationId = arg('org');
    if (!organizationId) {
      const orgs = await prisma.organization.findMany({ select: { id: true }, take: 2 });
      if (orgs.length !== 1) fail(`--org=<id> is required (${orgs.length} organizations found)`);
      organizationId = orgs[0].id;
    } else if (!(await prisma.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) {
      fail('Organization not found');
    }
    const orgId = organizationId;

    const visits = mergeVisits(parsed.rows);
    const hasDob = parsed.rows.some((r) => r.dob);

    const [valantClients, mapRows, staff, imported] = await Promise.all([
      prisma.client.findMany({
        where: { organizationId: orgId, sourcePlatform: 'valant', sourceId: { not: null } },
        select: { id: true, sourceId: true, name: true, location: { select: { name: true } } },
      }),
      prisma.valantProviderMap.findMany({ where: { organizationId: orgId }, select: { codeKey: true, userId: true } }),
      prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
      prisma.appointment.findMany({
        where: { organizationId: orgId, source: VALANT_HISTORY_SOURCE, externalKey: { not: null } },
        select: { externalKey: true },
      }),
    ]);

    const clientsByChartId = new Map<string, ClientRef>();
    for (const c of valantClients) {
      clientsByChartId.set(String(c.sourceId).trim().toUpperCase(), { id: c.id, name: c.name, locationName: c.location?.name ?? null });
    }

    // Name + DOB suggestions only when the export carries DOB (the Biller report does not)
    const clientsByNameDob = new Map<string, string[]>();
    if (hasDob) {
      const all = await prisma.client.findMany({
        where: { organizationId: orgId, dateOfBirth: { not: null } },
        select: { id: true, name: true, dateOfBirth: true },
      });
      for (const c of all) {
        const k = nameDobKey(c.name, c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : null);
        if (k) clientsByNameDob.set(k, [...(clientsByNameDob.get(k) ?? []), c.id]);
      }
    }

    // Appointments already on the matched clients' charts (booked in Altrixs or by the scheduler import)
    const matchedIds = [...new Set(visits.flatMap((v) => {
      const c = clientsByChartId.get(v.chartId.toUpperCase());
      return c ? [c.id] : [];
    }))];
    const times = visits.map((v) => v.startsAt.getTime());
    const existingSlots = new Map<string, { id?: string; clinicianId: string | null; clinicianName: string | null; status: string }[]>();
    if (matchedIds.length && times.length) {
      const from = new Date(Math.min(...times));
      const to = new Date(Math.max(...times));
      for (const ids of chunk(matchedIds, 1000)) {
        const rows = await prisma.appointment.findMany({
          where: {
            clientId: { in: ids },
            startsAt: { gte: from, lte: to },
            OR: [{ source: null }, { source: { not: VALANT_HISTORY_SOURCE } }],
          },
          select: { id: true, clientId: true, startsAt: true, clinicianId: true, clinicianName: true, status: true },
        });
        for (const a of rows) {
          const k = slotKey(a.clientId, a.startsAt);
          existingSlots.set(k, [...(existingSlots.get(k) ?? []), { id: a.id, clinicianId: a.clinicianId, clinicianName: a.clinicianName, status: a.status }]);
        }
      }
    }

    const plan = planValantHistory(
      visits,
      {
        clientsByChartId,
        clientsByNameDob,
        providerMap: buildProviderCodeMap(mapRows),
        staff,
        existingKeys: new Set(imported.map((a) => a.externalKey!).filter(Boolean)),
        existingSlots,
      },
      {
        organizationId: orgId,
        now: new Date(),
        since: SINCE ?? null,
        until: UNTIL ?? null,
        treatUncodedAsAttended: TREAT_UNCODED,
        nameMatchProviders: NAME_MATCH,
      }
    );

    let created = 0;
    let duplicatesOnInsert = 0;
    if (APPLY && plan.creates.length) {
      for (const batch of chunk(plan.creates, BATCH)) {
        const res = await prisma.appointment.createMany({ data: batch, skipDuplicates: true });
        created += res.count;
        duplicatesOnInsert += batch.length - res.count;
      }
    }

    // Close out past SCHEDULED duplicates with Valant's outcome (only still-SCHEDULED rows are touched)
    let closedOut = 0;
    if (APPLY && CLOSE_OUT) {
      for (const c of plan.closeOuts) {
        const res = await prisma.appointment.updateMany({
          where: { id: c.id, organizationId: orgId, status: 'SCHEDULED', startsAt: { lt: new Date() } },
          data: { status: c.status as never, source: VALANT_HISTORY_SOURCE, externalKey: c.externalKey },
        });
        closedOut += res.count;
      }
    }

    // Provider fill-in: imported visits still without a provider whose Valant label is now mapped
    let providersFilled = 0;
    if (APPLY) {
      const codes = await prisma.valantProviderMap.findMany({ where: { organizationId: orgId }, select: { providerCode: true, userId: true } });
      for (const m of codes) {
        const res = await prisma.appointment.updateMany({
          where: { organizationId: orgId, source: VALANT_HISTORY_SOURCE, clinicianId: null, clinicianName: { equals: m.providerCode, mode: 'insensitive' } },
          data: { clinicianId: m.userId },
        });
        providersFilled += res.count;
      }
    }

    const summary = {
      ok: true,
      mode: APPLY ? 'apply' : 'dry-run',
      layout: parsed.layout,
      options: { treatUncodedAsAttended: TREAT_UNCODED, nameMatchProviders: NAME_MATCH, since: SINCE ?? null, until: UNTIL ?? null },
      rowsRead: parsed.recordsRead,
      nonPatientSkipped: parsed.nonPatient,
      patientRows: parsed.rows.length,
      unparsableRows: parsed.errors.length,
      visitsAfterMerge: visits.length,
      matchedClients: plan.counts.matchedClients,
      matchedVisits: plan.counts.matchedVisits,
      unmatchedVisits: plan.counts.unmatchedVisits,
      unmatchedDistinctChartIds: plan.counts.unmatchedChartIds,
      nameDobSuggestions: plan.counts.nameDobSuggestions,
      outsideDateRange: plan.counts.outsideDateRange,
      futureSkipped: plan.counts.future,
      unknownStatusSkipped: plan.counts.unknownStatusSkipped,
      uncodedImportedAsAttended: plan.counts.uncodedImportedAsAttended,
      alreadyImportedSkipped: plan.counts.alreadyImported,
      existingAppointmentSkipped: plan.counts.existingAppointmentSkipped,
      existingPastScheduledAtSameSlot: plan.counts.existingPastScheduled,
      closeOutScheduled: CLOSE_OUT ? { planned: plan.closeOuts.length, closedOut: APPLY ? closedOut : 0 } : 'off (pass --close-out-scheduled)',
      providersFilledOnImportedVisits: APPLY ? providersFilled : 0,
      wouldCreate: plan.counts.wouldCreate,
      created: APPLY ? created : 0,
      duplicatesSkippedOnInsert: duplicatesOnInsert,
      byStatus: plan.byStatus,
      statusBasis: plan.statusBasis,
      unrecognizedStatusText: plan.unrecognizedStatusText,
      virtual: plan.counts.virtual,
      virtualSignals: plan.virtualSignals,
      audioOnly: plan.counts.audioOnly,
      providers: {
        byProviderMap: plan.counts.providerByMap,
        byInitialLastName: plan.counts.providerByName,
        unmatchedVisits: plan.counts.providerUnmatched,
        matchedByName: plan.providersMatchedByName,
        unmatchedLabels: plan.unmatchedProviders,
      },
      location: {
        fromFacility: plan.counts.locationFromFacility,
        fromClientHome: plan.counts.locationFromClient,
        none: plan.counts.locationNone,
        unmatchedFacilities: plan.unmatchedFacilities,
      },
      dateRange: plan.dateRange,
      unmatchedExamples: plan.unmatched.slice(0, 5).map((u) => ({ chartId: maskChartId(u.chartId), date: u.localDate, hasSuggestion: !!u.suggestedClientId })),
    };

    if (REPORT) {
      writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), unmatched: plan.unmatched }, null, 2));
    }

    if (APPLY) {
      await prisma.migrationJob.create({
        data: {
          organizationId: orgId,
          type: 'appointment_history',
          platform: 'valant',
          total: visits.length,
          imported: created,
          errors: parsed.errors.length + plan.counts.unmatchedVisits,
          status: created === plan.creates.length && !plan.counts.unmatchedVisits ? 'success' : created > 0 ? 'partial' : 'failed',
          errorJson: { unmatchedVisits: plan.counts.unmatchedVisits, unmatchedChartIds: plan.counts.unmatchedChartIds, unparsableRows: parsed.errors.length },
        },
      });
      // One audit event per run (counts only)
      await writeAuditLog({
        action: 'CREATE',
        actorUserId: null,
        actorRole: 'SYSTEM',
        organizationId: orgId,
        resourceType: 'migrationJob',
        metadata: {
          importType: 'valant_appointment_history',
          actor: 'system:import-valant-appointment-history',
          rowsRead: parsed.recordsRead,
          created,
          closedOut,
          providersFilled,
          matchedClients: plan.counts.matchedClients,
          unmatchedVisits: plan.counts.unmatchedVisits,
          byStatus: plan.byStatus,
        },
      });
      // In-process caches only: a running web server keeps its own until their short TTL expires
      invalidateCaseloadScopedCaches(orgId);
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // Error class and message only (Prisma errors can echo row values)
  console.error('[import-valant-appointment-history] failed:', err instanceof Error ? `${err.name}: ${err.message.split('\n')[0].slice(0, 200)}` : 'unknown error');
  process.exit(1);
});
