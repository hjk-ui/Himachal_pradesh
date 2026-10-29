/**
 * Owner request (Oct 19 2026): in-app video (Amazon Chime) is the default telehealth platform,
 * and upcoming Zoom visits move to in-app.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/switch-telehealth-to-in-app.ts          # dry run
 *   npx tsx --conditions=react-server --env-file=.env scripts/switch-telehealth-to-in-app.ts --apply  # write
 *
 * Changes (only with --apply):
 *  - TelehealthSettings.defaultPlatform -> 'chime' (in-app) for every organization
 *  - UPCOMING virtual appointments (startsAt >= now) whose telehealth provider is Zoom:
 *    provider -> 'in_app', stored Zoom meeting/link fields removed so the in-app join link is used;
 *    Appointment.telehealthPlatform 'zoom' -> 'chime'
 *  - UPCOMING telehealth sessions on platform 'zoom' -> 'chime'
 * Past visits are left exactly as they happened. Every change is audited (counts and ids only).
 */
import { prisma } from '@/lib/db/prisma';
import { parseTelehealthMeta, writeTelehealthMeta } from '@/lib/telehealth/meta';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

const APPLY = process.argv.includes('--apply');

async function main() {
  const now = new Date();
  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  for (const org of orgs) {
    const settings = await prisma.telehealthSettings.findUnique({ where: { organizationId: org.id }, select: { defaultPlatform: true } });

    const appts = await prisma.appointment.findMany({
      where: {
        isVirtual: true,
        startsAt: { gte: now },
        OR: [{ organizationId: org.id }, { client: { organizationId: org.id } }],
      },
      select: { id: true, notes: true, telehealthPlatform: true },
    });
    const toSwitch = appts.filter((a) => {
      const meta = parseTelehealthMeta(a.notes);
      return meta.provider === 'zoom' || (!meta.provider && (a.telehealthPlatform ?? '').toLowerCase() === 'zoom');
    });

    const sessions = await prisma.telehealthSession.findMany({
      where: { organizationId: org.id, sessionDate: { gte: new Date(now.getTime() - 86_400_000) }, platform: 'ZOOM', status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      select: { id: true },
    });

    console.log(
      `${org.name}: default platform ${settings?.defaultPlatform ?? '(not set)'} -> chime | upcoming virtual appointments ${appts.length}, on Zoom ${toSwitch.length} | upcoming Zoom sessions ${sessions.length}`
    );
    if (!APPLY) continue;

    await prisma.telehealthSettings.upsert({
      where: { organizationId: org.id },
      create: { organizationId: org.id, defaultPlatform: 'CHIME' },
      update: { defaultPlatform: 'CHIME' },
    });
    for (const a of toSwitch) {
      const meta = parseTelehealthMeta(a.notes);
      const { zoomMeetingId: _m, zoomJoinUrl: _j, zoomStartUrl: _s, ...rest } = meta;
      await prisma.appointment.update({
        where: { id: a.id },
        data: {
          notes: writeTelehealthMeta(a.notes, { ...rest, provider: 'in_app' }),
          ...((a.telehealthPlatform ?? '').toLowerCase() === 'zoom' ? { telehealthPlatform: 'chime' } : {}),
        },
      });
    }
    if (sessions.length) {
      await prisma.telehealthSession.updateMany({ where: { id: { in: sessions.map((s) => s.id) } }, data: { platform: 'CHIME' } });
    }
    await writeAuditLog({
      action: 'TELEHEALTH_DEFAULT_SWITCHED_TO_IN_APP',
      actorUserId: null,
      actorRole: 'system',
      organizationId: org.id,
      resourceType: 'telehealthSettings',
      metadata: {
        previousDefault: settings?.defaultPlatform ?? null,
        appointmentsSwitched: toSwitch.length,
        appointmentIds: toSwitch.slice(0, 200).map((a) => a.id),
        sessionsSwitched: sessions.length,
        via: 'scripts/switch-telehealth-to-in-app.ts (owner request)',
      },
    });
    console.log(`  applied: default chime, ${toSwitch.length} appointments, ${sessions.length} sessions`);
  }
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
