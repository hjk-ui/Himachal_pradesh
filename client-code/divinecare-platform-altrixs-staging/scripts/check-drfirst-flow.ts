/**
 * Read-only health check of the DrFirst data flow (counts and command names only, never patient data):
 *   npx tsx --env-file=.env scripts/check-drfirst-flow.ts
 * - configuration (demo mode, register-on-launch)
 * - download cursors per command and organization (DR1 / GM7) and how old they are
 * - Rcopia API calls in the last 7 days per command: ok / failed, last success, last error code
 * - rows in the tables the sweep writes, and prescribers missing a DrFirst username or NPI
 */
import { prisma } from '@/lib/db/prisma';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';

const ageMin = (d: Date | null | undefined) => (d ? Math.round((Date.now() - d.getTime()) / 60_000) : null);

async function main() {
  console.log('== DrFirst configuration');
  console.log(`  demo mode: ${DEMO_MODE}`);
  console.log(`  DRFIRST_REGISTER_ON_LAUNCH: ${process.env.DRFIRST_REGISTER_ON_LAUNCH === 'true'}`);

  console.log('\n== Download cursors (minutes since last advance)');
  const cursors = await prisma.drFirstSyncCursor.findMany({ orderBy: { commandName: 'asc' } });
  if (!cursors.length) console.log('  none: no download has completed yet');
  for (const c of cursors) console.log(`  ${c.commandName.padEnd(48)} ${String(ageMin(c.updatedAt)).padStart(7)} min`);

  console.log('\n== Rcopia calls, last 7 days');
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const grouped = await prisma.drFirstApiLog.groupBy({
    by: ['kind', 'command', 'ok'],
    where: { createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  const commands = Array.from(new Set(grouped.map(g => `${g.kind}:${g.command}`))).sort();
  if (!commands.length) console.log('  no calls logged');
  for (const key of commands) {
    const cut = key.indexOf(':');
    const kind = key.slice(0, cut);
    const command = key.slice(cut + 1);
    const ok = grouped.find(g => g.kind === kind && g.command === command && g.ok);
    const bad = grouped.find(g => g.kind === kind && g.command === command && !g.ok);
    let lastErr = '';
    if (bad) {
      const e = await prisma.drFirstApiLog.findFirst({
        where: { kind, command, ok: false, createdAt: { gte: since } },
        orderBy: { createdAt: 'desc' },
        select: { errorCode: true, status: true },
      });
      lastErr = ` last error: ${e?.errorCode || e?.status || 'unknown'}`;
    }
    console.log(
      `  ${key.padEnd(44)} ok ${String(ok?._count._all ?? 0).padStart(5)}  failed ${String(bad?._count._all ?? 0).padStart(4)}` +
        `  last ok ${ok?._max.createdAt ? `${ageMin(ok._max.createdAt)} min ago` : 'never'}${lastErr}`,
    );
  }

  console.log('\n== Rows written by the download sweep');
  const [rx, rxPending, rxSent, fills, changes, changesOpen, renewals, renewalsOpen, linked] = await Promise.all([
    prisma.rcopiaPrescription.count(),
    prisma.rcopiaPrescription.count({ where: { lifecycleStatus: { in: ['pending', 'needs_review'] } } }),
    prisma.rcopiaPrescription.count({ where: { lifecycleStatus: { in: ['signed', 'completed'] } } }),
    prisma.rcopiaRxfillEvent.count(),
    prisma.rcopiaRxchangeRequest.count(),
    prisma.rcopiaRxchangeRequest.count({ where: { status: 'pending' } }),
    prisma.rcopiaRefillNotification.count(),
    prisma.rcopiaRefillNotification.count({ where: { actionTaken: 'pending' } }),
    prisma.client.count({ where: { rcopiaPatientId: { not: null } } }),
  ]);
  console.log(`  prescriptions ${rx} (pending ${rxPending}, signed/completed ${rxSent})`);
  console.log(`  pharmacy fill events ${fills}`);
  console.log(`  change requests ${changes} (open ${changesOpen})`);
  console.log(`  renewal requests ${renewals} (open ${renewalsOpen})`);
  console.log(`  patients linked to DrFirst ${linked}`);

  console.log('\n== Prescribers');
  const prescribers = await prisma.user.findMany({
    where: { role: { in: ['PSYCHIATRIST', 'NP', 'PHYSICIAN', 'MEDICAL_NP'] }, status: 'ACTIVE' },
    select: { rcopiaUsername: true, npi: true },
  });
  const noUser = prescribers.filter(p => !p.rcopiaUsername?.trim()).length;
  const noNpi = prescribers.filter(p => !/^\d{10}$/.test(p.npi?.trim() || '')).length;
  console.log(`  active prescribers ${prescribers.length}; without DrFirst username ${noUser}; without valid NPI ${noNpi}`);
}

main()
  .catch(err => {
    console.error('check failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
