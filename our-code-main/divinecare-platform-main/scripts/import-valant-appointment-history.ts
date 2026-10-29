/**
 * Valant appointment HISTORY import (past visits, for the record only).
 *
 * DRY-RUN BY DEFAULT: nothing is written unless --apply is passed.
 * Rows are written with prisma.appointment.createMany({ skipDuplicates: true }) as source = valant_history.
 * This script never calls createAppointment (no SMS / reminders / claims side effects).
 *
 * Usage:
 *   npx tsx scripts/import-valant-appointment-history.ts --file "C:\path\Appointments.csv" --parse-only
 *   npx tsx scripts/import-valant-appointment-history.ts --file <csv> --org <organizationId>            (dry-run)
 *   npx tsx scripts/import-valant-appointment-history.ts --file <csv> --org <organizationId> --apply
 *
 * Flags:
 *   --file <path>                  Valant Appointments export (CSV, 24 columns). Required.
 *   --parse-only                   Parse and report counts only. Does not touch the database. --org not needed.
 *   --org <organizationId>         Clinic organization to import into. Required unless --parse-only.
 *   --apply                        Write to the database. Without it, this is a dry-run.
 *   --treat-uncoded-as-attended    Rows with no CPT code are imported as COMPLETED. Default: uncoded rows are skipped.
 *   --since YYYY-MM-DD             Only visits on or after this clinic-local date.
 *   --until YYYY-MM-DD             Only visits on or before this clinic-local date. Future visits are never imported.
 *   --no-name-match                Match clients by chart id only (default also accepts one exact full-name match).
 *   --report <path>                Write a JSON report (counts and masked chart ids only; no names).
 *   --close-out-scheduled          Also set past SCHEDULED visits (from an earlier import) to COMPLETED when this
 *                                  history shows the same client at the same start time. Only with --apply.
 *
 * Console output masks chart ids (AB****12) and never prints client names.
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';
import { maskChartId, VALANT_HISTORY_NOTE, VALANT_HISTORY_SOURCE } from '../src/lib/valant/appointmentHistory';
import {
  buildClientMatcher,
  parseAppointmentHistoryRows,
  parseCsv,
  planHistoryImport,
} from '../src/lib/valant/appointmentHistoryImport';

function flag(args: string[], name: string): boolean {
  return args.includes(name);
}

function value(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`${name}=`));
  return eq ? eq.slice(name.length + 1) : undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function main() {
  const args = process.argv.slice(2);
  const file = value(args, '--file');
  const org = value(args, '--org');
  const parseOnly = flag(args, '--parse-only');
  const apply = flag(args, '--apply');
  const since = value(args, '--since');
  const until = value(args, '--until');
  const reportPath = value(args, '--report');
  const treatUncoded = flag(args, '--treat-uncoded-as-attended');
  const nameMatch = !flag(args, '--no-name-match');
  const closeOut = flag(args, '--close-out-scheduled');

  if (!file) return fail('Missing --file <path to the Valant Appointments CSV>.');
  if (!fs.existsSync(file)) return fail('File not found.');
  if (since && !DATE_RE.test(since)) return fail('--since must be YYYY-MM-DD.');
  if (until && !DATE_RE.test(until)) return fail('--until must be YYYY-MM-DD.');
  if (!parseOnly && !org) return fail('Missing --org <organizationId> (or use --parse-only).');
  if (parseOnly && apply) return fail('--parse-only and --apply cannot be combined.');

  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const parsed = parseAppointmentHistoryRows(rows);
  if (parsed.error) return fail(parsed.error);

  console.log(`[valant-history] mode: ${parseOnly ? 'parse-only' : apply ? 'APPLY' : 'dry-run'}`);
  console.log(`[valant-history] rows in file: ${parsed.totalRows}; patient visits parsed: ${parsed.rows.length}`);
  console.log(
    `[valant-history] skipped at parse: non-patient ${parsed.skipped.non_patient}, bad date/time ${parsed.skipped.bad_date_or_time}, no chart id or name ${parsed.skipped.no_chart_id_or_name}`
  );

  if (parseOnly) {
    const coded = parsed.rows.filter((r) => r.coded).length;
    console.log(`[valant-history] coded (has CPT): ${coded}; uncoded: ${parsed.rows.length - coded}`);
    writeReport(reportPath, { mode: 'parse-only', parsed: parsed.rows.length, skipped: parsed.skipped, coded });
    return;
  }

  const prisma = new PrismaClient({ log: ['error'] });
  try {
    const organization = await prisma.organization.findUnique({ where: { id: org! }, select: { id: true } });
    if (!organization) return fail('Organization not found.');

    const clients = await prisma.client.findMany({
      where: { organizationId: organization.id },
      select: { id: true, name: true, mrn: true, sourceId: true },
    });
    const times = parsed.rows.map((r) => r.startsAt.getTime());
    const existing = times.length
      ? await prisma.appointment.findMany({
          where: {
            organizationId: organization.id,
            startsAt: { gte: new Date(Math.min(...times)), lte: new Date(Math.max(...times)) },
          },
          select: { id: true, clientId: true, startsAt: true, status: true, source: true, externalKey: true, createdVia: true },
        })
      : [];

    const plan = planHistoryImport({
      rows: parsed.rows,
      window: { since, until },
      options: { treatUncodedAsAttended: treatUncoded },
      match: buildClientMatcher(clients, { nameMatch }),
      existing,
    });

    console.log('[valant-history] plan:', JSON.stringify(plan.counts));
    const sample = plan.create.slice(0, 5).map((p) => `${maskChartId(p.chartId)} ${p.startsAt.toISOString().slice(0, 10)} (${p.matchedBy})`);
    if (sample.length) console.log('[valant-history] first rows:', sample.join(' | '));
    if (closeOut) console.log(`[valant-history] scheduled visits to close out: ${plan.closeOut.length}`);

    let created = 0;
    let closed = 0;
    if (apply) {
      const result = await prisma.appointment.createMany({
        skipDuplicates: true,
        data: plan.create.map((p) => ({
          organizationId: organization.id,
          clientId: p.clientId,
          clientName: p.clientName,
          clinicianName: p.provider,
          type: 'Imported visit',
          startsAt: p.startsAt,
          endsAt: p.endsAt,
          status: 'COMPLETED' as const,
          noteStatus: 'NOT_STARTED' as const,
          notes: VALANT_HISTORY_NOTE,
          source: VALANT_HISTORY_SOURCE,
          externalKey: p.externalKey,
          createdVia: 'import',
          createdByName: 'Valant appointment history import',
        })),
      });
      created = result.count;
      if (closeOut && plan.closeOut.length) {
        const upd = await prisma.appointment.updateMany({
          where: {
            organizationId: organization.id,
            id: { in: plan.closeOut.map((c) => c.appointmentId) },
            status: 'SCHEDULED',
          },
          data: { status: 'COMPLETED' },
        });
        closed = upd.count;
      }
      console.log(`[valant-history] APPLIED: created ${created}${closeOut ? `, closed out ${closed}` : ''}.`);
    } else {
      console.log('[valant-history] Dry-run only. Re-run with --apply to write.');
    }

    writeReport(reportPath, {
      mode: apply ? 'apply' : 'dry-run',
      counts: plan.counts,
      created,
      closedOut: closed,
      maskedCharts: plan.create.map((p) => maskChartId(p.chartId)),
    });
  } finally {
    await prisma.$disconnect();
  }
}

function writeReport(reportPath: string | undefined, body: unknown) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), ...(body as object) }, null, 2));
  console.log(`[valant-history] report written: ${reportPath}`);
}

function fail(message: string) {
  console.error(`[valant-history] ${message}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('[valant-history] fatal:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
