/**
 * One-time copy of the legacy Group Sessions blob (ClinicModuleState module 'group-sessions')
 * into clinical_groups / clinical_group_members / clinical_group_sessions / clinical_group_attendance.
 *
 * Usage:
 *   npx tsx scripts/migrate-group-sessions-blob.ts                 dry run, every organization
 *   npx tsx scripts/migrate-group-sessions-blob.ts --org <orgId>   dry run, one organization
 *   npx tsx scripts/migrate-group-sessions-blob.ts --apply         write
 *
 * Idempotent: a group whose legacy id is already in clinical_groups (legacySourceId) is skipped;
 * members upsert on (group, client); sessions upsert on (group, start). The blob itself is never
 * changed or deleted. Rules (what is and is not copied) are in src/lib/groups/blobMigration.ts.
 * Prints counts only (no client names). Requires DATABASE_URL and migration 20261019_group_sessions.sql.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { planBlobMigration, emptyCounts, type MigrationCounts } from '../src/lib/groups/blobMigration';
import { fromPracticeWallTime } from '../src/lib/time/practiceTime';
import { getPracticeTimeZone } from '../src/lib/time/practiceTimeServer';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const orgArg = args.includes('--org') ? args[args.indexOf('--org') + 1] : null;

async function migrateOrg(organizationId: string, blob: unknown): Promise<MigrationCounts & { written: number }> {
  const [clients, staff, existing] = await Promise.all([
    prisma.client.findMany({ where: { organizationId }, select: { id: true } }),
    prisma.user.findMany({ where: { organizationId, status: 'ACTIVE' }, select: { id: true, name: true } }),
    prisma.clinicalGroup.findMany({ where: { organizationId, legacySourceId: { not: null } }, select: { legacySourceId: true } }),
  ]);
  const staffByName = new Map<string, string[]>();
  for (const u of staff) {
    const key = u.name?.trim().toLowerCase();
    if (!key) continue;
    staffByName.set(key, [...(staffByName.get(key) ?? []), u.id]);
  }
  const plan = planBlobMigration(blob, {
    clientIds: new Set(clients.map((c) => c.id)),
    staffByName,
    alreadyMigrated: new Set(existing.map((e) => e.legacySourceId!)),
  });
  let written = 0;
  if (!APPLY) return { ...plan.counts, written };
  const tz = await getPracticeTimeZone(organizationId);
  for (const g of plan.groups) {
    await prisma.$transaction(async (tx) => {
      const group = await tx.clinicalGroup.create({
        data: {
          organizationId,
          kind: g.kind,
          groupType: g.groupType,
          name: g.name,
          description: g.description,
          facilitatorId: g.facilitatorId,
          room: g.room,
          telehealth: g.telehealth,
          capacity: g.capacity,
          defaultDurationMinutes: g.defaultDurationMinutes,
          billingCode: g.billingCode,
          billingMode: g.billingMode,
          status: g.status,
          part2: false,
          recurFrequency: g.recurFrequency,
          recurWeekdays: g.recurWeekdays,
          recurStartTime: g.recurStartTime,
          recurStartDate: g.recurStartDate ? new Date(`${g.recurStartDate}T00:00:00Z`) : null,
          recurEndDate: g.recurEndDate ? new Date(`${g.recurEndDate}T00:00:00Z`) : null,
          legacySourceId: g.legacyId,
        },
      });
      const memberIds = new Map<string, string>();
      for (const m of g.members) {
        const row = await tx.clinicalGroupMember.upsert({
          where: { groupId_clientId: { groupId: group.id, clientId: m.clientId } },
          create: {
            organizationId,
            groupId: group.id,
            clientId: m.clientId,
            status: m.status,
            joinedOn: new Date(`${m.joinedOn}T00:00:00Z`),
            leftOn: m.leftOn ? new Date(`${m.leftOn}T00:00:00Z`) : null,
          },
          update: {},
        });
        memberIds.set(m.clientId, row.id);
      }
      const sessionIds = new Map<string, string>();
      for (const s of g.sessions) {
        const start = fromPracticeWallTime(s.date, s.startTime, tz);
        if (!start) continue;
        const row = await tx.clinicalGroupSession.upsert({
          where: { groupId_startsAt: { groupId: group.id, startsAt: start } },
          create: {
            organizationId,
            groupId: group.id,
            startsAt: start,
            endsAt: new Date(start.getTime() + s.durationMinutes * 60_000),
            durationMinutes: s.durationMinutes,
            telehealth: g.telehealth,
            room: g.room,
            status: s.status,
            facilitatorId: g.facilitatorId,
            legacySourceId: s.legacyId,
          },
          update: {},
        });
        sessionIds.set(s.legacyId, row.id);
      }
      if (g.draft && sessionIds.get(g.draft.sessionLegacyId)) {
        const sessionId = sessionIds.get(g.draft.sessionLegacyId)!;
        if (g.draft.sharedText) {
          // Unsigned draft text; the facilitator reviews it in the shared section before any signing
          await tx.clinicalGroupSession.update({
            where: { id: sessionId },
            data: { sharedNote: { legacyText: g.draft.sharedText } as Prisma.InputJsonValue },
          });
        }
        for (const a of g.draft.attendance) {
          await tx.clinicalGroupAttendance.upsert({
            where: { sessionId_clientId: { sessionId, clientId: a.clientId } },
            create: {
              organizationId,
              sessionId,
              groupId: group.id,
              clientId: a.clientId,
              memberId: memberIds.get(a.clientId) ?? null,
              status: a.status,
              individualNote: a.legacyNoteText ? ({ legacyText: a.legacyNoteText } as Prisma.InputJsonValue) : Prisma.DbNull,
            },
            update: {},
          });
        }
      }
    });
    written++;
  }
  return { ...plan.counts, written };
}

async function main() {
  const rows = await prisma.clinicModuleState.findMany({
    where: { module: 'group-sessions', ...(orgArg ? { organizationId: orgArg } : {}) },
    select: { organizationId: true, data: true },
  });
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} organization blob(s) with module 'group-sessions'`);
  const total = { ...emptyCounts(), written: 0 };
  for (const r of rows) {
    const c = await migrateOrg(r.organizationId, r.data);
    console.log(`org ${r.organizationId}:`, JSON.stringify(c));
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += c[k];
  }
  console.log('TOTAL:', JSON.stringify(total));
  if (!APPLY) console.log('Nothing written. Re-run with --apply to copy.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
