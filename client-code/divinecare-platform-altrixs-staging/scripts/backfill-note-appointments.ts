/**
 * Link existing progress notes to the appointment they document (ProgressNote.appointmentId,
 * migration 20261019_rcm_blockers.sql). A note is linked ONLY when exactly one appointment of the
 * same client, with the same clinician, falls on the note's practice date of service
 * (cancelled / no-show / late-cancel appointments are ignored). Ambiguous or unmatched notes are
 * listed and left unlinked; nothing is guessed.
 *
 * Usage:
 *   npx tsx scripts/backfill-note-appointments.ts            # dry run (default): report only
 *   npx tsx scripts/backfill-note-appointments.ts --apply    # write the links
 *   ... --org <organizationId>                               # limit to one organization
 *
 * Output lists note / appointment ids only (no PHI). Requires DATABASE_URL. Safe to re-run:
 * notes that already have an appointment are skipped.
 */
import { prisma } from '../src/lib/db/prisma';
import { matchNoteToAppointment } from '../src/lib/billing/claimRules';

const DEFAULT_TZ = 'America/New_York';

function arg(name: string) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const org = arg('--org');
  const notes = await prisma.progressNote.findMany({
    where: {
      appointmentId: null,
      dateOfService: { not: null },
      clinicianId: { not: null },
      ...(org ? { client: { organizationId: org } } : {}),
    },
    select: { id: true, clientId: true, clinicianId: true, dateOfService: true, client: { select: { organizationId: true } } },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${apply ? 'APPLY' : 'DRY RUN'}: ${notes.length} note(s) without an appointment link`);

  const tzByOrg = new Map<string, string>();
  const counts: Record<string, number> = { matched: 0, none: 0, ambiguous: 0, 'no-dos': 0, 'no-clinician': 0 };
  let written = 0;
  for (const note of notes) {
    const orgId = note.client.organizationId ?? '';
    if (orgId && !tzByOrg.has(orgId)) {
      const settings = await prisma.practiceSettings.findUnique({ where: { organizationId: orgId }, select: { timeZone: true } }).catch(() => null);
      tzByOrg.set(orgId, settings?.timeZone || DEFAULT_TZ);
    }
    const tz = tzByOrg.get(orgId) || DEFAULT_TZ;
    const dos = note.dateOfService!;
    // Appointments within a day either side of the date; the matcher compares practice dates
    const from = new Date(dos.getTime() - 36 * 3600_000);
    const to = new Date(dos.getTime() + 60 * 3600_000);
    const appts = await prisma.appointment.findMany({
      where: { clientId: note.clientId, clinicianId: note.clinicianId, startsAt: { gte: from, lt: to } },
      select: { id: true, clientId: true, clinicianId: true, startsAt: true, status: true },
    });
    const m = matchNoteToAppointment(note, appts, tz);
    counts[m.reason] = (counts[m.reason] ?? 0) + 1;
    if (m.reason === 'ambiguous') console.log(`  ambiguous: note ${note.id} (${appts.length} candidate appointments)`);
    if (m.appointmentId) {
      if (apply) {
        const r = await prisma.progressNote.updateMany({ where: { id: note.id, appointmentId: null }, data: { appointmentId: m.appointmentId } });
        written += r.count;
      } else {
        console.log(`  would link note ${note.id} -> appointment ${m.appointmentId}`);
      }
    }
  }
  console.log(`matched ${counts.matched}, no appointment ${counts.none}, ambiguous ${counts.ambiguous}`);
  if (apply) console.log(`linked ${written} note(s)`);
  else console.log('Dry run only. Re-run with --apply to write the links.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
