/**
 * Phase 2 — idempotent INSERT of local-only rows into RDS.
 * Never deletes/updates existing RDS production rows (except completing FKs on newly inserted rows).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Prisma, PrismaClient } from '@prisma/client';

type Action = 'INSERT' | 'SKIP' | 'REMAP';
type Op = {
  table: string;
  action: Action;
  localId: string;
  rdsId?: string;
  reason: string;
};

function parseEndpoint(raw: string) {
  const u = new URL(raw);
  const database = decodeURIComponent(u.pathname.replace(/^\//, '')).split('?')[0];
  return { hostname: u.hostname, port: u.port || '5432', database };
}
function formatEndpoint(raw: string) {
  const e = parseEndpoint(raw);
  return `${e.hostname}:${e.port} / ${e.database}`;
}
function assertRdsUsesSshTunnel(raw: string) {
  const e = parseEndpoint(raw);
  const loopback = e.hostname === '127.0.0.1' || e.hostname === 'localhost';
  if (!loopback || e.port !== '5433') {
    throw new Error(
      `RDS_DATABASE_URL must target SSH tunnel 127.0.0.1:5433 (got ${e.hostname}:${e.port} / ${e.database}).`
    );
  }
}
function clientFor(url: string) {
  return new PrismaClient({ datasourceUrl: url, log: ['error'] });
}
function maskEmail(email: string | null | undefined) {
  if (!email) return null;
  const [user, domain] = email.split('@');
  if (!domain) return '(invalid)';
  return `${(user || '').slice(0, 1)}***@${domain}`;
}
function tally(ops: Op[]) {
  const byTable: Record<string, Record<Action, number>> = {};
  for (const op of ops) {
    byTable[op.table] ??= { INSERT: 0, SKIP: 0, REMAP: 0 };
    byTable[op.table][op.action] += 1;
  }
  return byTable;
}

async function main() {
  const localUrl = process.env.DATABASE_URL;
  const rdsUrl = process.env.RDS_DATABASE_URL;
  if (!localUrl) throw new Error('DATABASE_URL is missing');
  if (!rdsUrl) throw new Error('RDS_DATABASE_URL is missing');
  assertRdsUsesSshTunnel(rdsUrl);

  console.log(`LOCAL: ${formatEndpoint(localUrl)}`);
  console.log(`RDS:   ${formatEndpoint(rdsUrl)}`);
  console.log('Phase 2 plan (no writes yet)…');

  const local = clientFor(localUrl);
  const rds = clientFor(rdsUrl);
  const here = dirname(fileURLToPath(import.meta.url));
  const reportsDir = join(here, 'reports');
  mkdirSync(reportsDir, { recursive: true });

  const ops: Op[] = [];
  const conflicts: string[] = [];
  const orgMap = new Map<string, string>();
  const locMap = new Map<string, string>();
  const userMap = new Map<string, string>();
  const clientMap = new Map<string, string>();
  const apptMap = new Map<string, string>();
  const noteMap = new Map<string, string>();

  function need(map: Map<string, string>, id: string | null | undefined, ctx: string): string | null {
    if (id == null) return null;
    const mapped = map.get(id);
    if (!mapped) {
      conflicts.push(`${ctx}: unmapped FK ${id}`);
      return null;
    }
    return mapped;
  }

  try {
    const localDb = (await local.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`)[0]
      ?.current_database;
    const rdsDb = (await rds.$queryRaw<Array<{ current_database: string }>>`SELECT current_database()`)[0]
      ?.current_database;
    if (localDb !== 'altrixs' || rdsDb !== 'altrixs_local') {
      throw new Error(`STOP: unexpected databases local=${localDb} rds=${rdsDb}`);
    }

    const [
      localOrgs,
      rdsOrgs,
      localLocs,
      rdsLocs,
      localUsers,
      rdsUsers,
      localUls,
      rdsUls,
      localClients,
      rdsClients,
      localAppts,
      rdsAppts,
      localNotes,
      rdsNotes,
      localWfs,
      rdsWfs,
      localTps,
      rdsTps,
      localEls,
      rdsEls,
      localPas,
      rdsPas,
      localClaims,
      rdsClaims,
      localMods,
      rdsMods,
      localCheckIns,
      rdsCheckIns,
      localAlerts,
      rdsAlerts,
      localMsgs,
      rdsMsgs,
      localOtps,
      localWait,
      localIntake,
      localConsent,
    ] = await Promise.all([
      local.organization.findMany(),
      rds.organization.findMany(),
      local.location.findMany(),
      rds.location.findMany(),
      local.user.findMany(),
      rds.user.findMany(),
      local.userLocation.findMany(),
      rds.userLocation.findMany(),
      local.client.findMany(),
      rds.client.findMany(),
      local.appointment.findMany(),
      rds.appointment.findMany(),
      local.progressNote.findMany(),
      rds.progressNote.findMany(),
      local.progressNoteWorkflow.findMany(),
      rds.progressNoteWorkflow.findMany(),
      local.treatmentPlan.findMany(),
      rds.treatmentPlan.findMany(),
      local.eligibilityCheck.findMany(),
      rds.eligibilityCheck.findMany(),
      local.priorAuth.findMany(),
      rds.priorAuth.findMany(),
      local.claim.findMany(),
      rds.claim.findMany(),
      local.clinicModuleState.findMany(),
      rds.clinicModuleState.findMany(),
      local.checkIn.findMany({ select: { id: true } }),
      rds.checkIn.findMany({ select: { id: true } }),
      local.riskAlert.findMany({ select: { id: true } }),
      rds.riskAlert.findMany({ select: { id: true } }),
      local.message.findMany({ select: { id: true } }),
      rds.message.findMany({ select: { id: true } }),
      local.emailOtp.findMany({ select: { id: true } }),
      local.waitlistEntry.findMany({ select: { id: true } }),
      local.intakeInvite.findMany({ select: { id: true } }),
      local.consentForm.findMany({ select: { id: true } }),
    ]);

    const rdsOrgById = new Map(rdsOrgs.map((o) => [o.id, o]));
    const rdsOrgBySlug = new Map(rdsOrgs.map((o) => [o.slug, o]));
    for (const o of localOrgs) {
      const byId = rdsOrgById.get(o.id);
      const bySlug = rdsOrgBySlug.get(o.slug);
      if (byId) {
        orgMap.set(o.id, byId.id);
        ops.push({ table: 'Organization', action: 'SKIP', localId: o.id, rdsId: byId.id, reason: 'same primary key' });
      } else if (bySlug) {
        orgMap.set(o.id, bySlug.id);
        ops.push({
          table: 'Organization',
          action: 'REMAP',
          localId: o.id,
          rdsId: bySlug.id,
          reason: `slug ${o.slug}`,
        });
      } else {
        orgMap.set(o.id, o.id);
        ops.push({ table: 'Organization', action: 'INSERT', localId: o.id, reason: `new slug ${o.slug}` });
      }
    }

    const rdsLocById = new Map(rdsLocs.map((l) => [l.id, l]));
    const rdsLocByOrgName = new Map(rdsLocs.map((l) => [`${l.organizationId}::${l.name}`, l]));
    for (const l of localLocs) {
      const mappedOrg = need(orgMap, l.organizationId, `Location ${l.id} organizationId`);
      if (!mappedOrg) continue;
      const byId = rdsLocById.get(l.id);
      const byName = rdsLocByOrgName.get(`${mappedOrg}::${l.name}`);
      if (byId) {
        locMap.set(l.id, byId.id);
        ops.push({ table: 'Location', action: 'SKIP', localId: l.id, rdsId: byId.id, reason: 'same primary key' });
      } else if (byName) {
        locMap.set(l.id, byName.id);
        ops.push({
          table: 'Location',
          action: 'REMAP',
          localId: l.id,
          rdsId: byName.id,
          reason: `org+name ${l.name}`,
        });
      } else {
        locMap.set(l.id, l.id);
        ops.push({ table: 'Location', action: 'INSERT', localId: l.id, reason: `new location ${l.name}` });
      }
    }

    const rdsUserById = new Map(rdsUsers.map((u) => [u.id, u]));
    const rdsUserByEmail = new Map(rdsUsers.map((u) => [u.email.toLowerCase(), u]));
    for (const u of localUsers) {
      const byId = rdsUserById.get(u.id);
      const byEmail = rdsUserByEmail.get(u.email.toLowerCase());
      if (byId) {
        userMap.set(u.id, byId.id);
        ops.push({ table: 'User', action: 'SKIP', localId: u.id, rdsId: byId.id, reason: 'same primary key' });
      } else if (byEmail) {
        userMap.set(u.id, byEmail.id);
        ops.push({
          table: 'User',
          action: 'REMAP',
          localId: u.id,
          rdsId: byEmail.id,
          reason: `email ${maskEmail(u.email)}`,
        });
      } else {
        userMap.set(u.id, u.id);
        if (u.organizationId) need(orgMap, u.organizationId, `User ${u.id} organizationId`);
        if (u.primaryLocationId) need(locMap, u.primaryLocationId, `User ${u.id} primaryLocationId`);
        ops.push({ table: 'User', action: 'INSERT', localId: u.id, reason: `new email ${maskEmail(u.email)}` });
      }
    }
    for (const u of localUsers) {
      if (u.invitedById && userMap.get(u.id) === u.id) {
        need(userMap, u.invitedById, `User ${u.id} invitedById`);
      }
    }

    const rdsUlById = new Map(rdsUls.map((x) => [x.id, x]));
    const rdsUlPair = new Set(rdsUls.map((x) => `${x.userId}::${x.locationId}`));
    const plannedUlPairs = new Set<string>();
    for (const ul of localUls) {
      const mappedUser = need(userMap, ul.userId, `UserLocation ${ul.id} userId`);
      const mappedLoc = need(locMap, ul.locationId, `UserLocation ${ul.id} locationId`);
      if (!mappedUser || !mappedLoc) continue;
      const pair = `${mappedUser}::${mappedLoc}`;
      if (rdsUlById.get(ul.id)) {
        ops.push({ table: 'UserLocation', action: 'SKIP', localId: ul.id, reason: 'same primary key' });
      } else if (rdsUlPair.has(pair) || plannedUlPairs.has(pair)) {
        ops.push({
          table: 'UserLocation',
          action: 'SKIP',
          localId: ul.id,
          reason: 'mapped (userId,locationId) already exists',
        });
      } else {
        plannedUlPairs.add(pair);
        ops.push({ table: 'UserLocation', action: 'INSERT', localId: ul.id, reason: 'new membership' });
      }
    }

    const rdsClientById = new Map(rdsClients.map((c) => [c.id, c]));
    const rdsClientByEmail = new Map(
      rdsClients.filter((c) => c.email).map((c) => [c.email!.toLowerCase(), c])
    );
    for (const c of localClients) {
      const byId = rdsClientById.get(c.id);
      const byEmail = c.email ? rdsClientByEmail.get(c.email.toLowerCase()) : undefined;
      if (byId) {
        clientMap.set(c.id, byId.id);
        ops.push({ table: 'Client', action: 'SKIP', localId: c.id, reason: 'same primary key — not rewritten' });
      } else if (byEmail) {
        clientMap.set(c.id, byEmail.id);
        ops.push({
          table: 'Client',
          action: 'REMAP',
          localId: c.id,
          rdsId: byEmail.id,
          reason: 'email match — not inserting duplicate',
        });
      } else {
        conflicts.push(`Client ${c.id} is local-only; unexpected given Phase 1. Stopping that insert.`);
      }
    }

    const skipSame = (
      table: string,
      localIds: string[],
      rdsIds: Set<string>,
      map?: Map<string, string>
    ) => {
      for (const id of localIds) {
        if (rdsIds.has(id)) {
          map?.set(id, id);
          ops.push({ table, action: 'SKIP', localId: id, reason: 'same primary key' });
        }
      }
    };
    skipSame(
      'CheckIn',
      localCheckIns.map((x) => x.id),
      new Set(rdsCheckIns.map((x) => x.id))
    );
    skipSame(
      'RiskAlert',
      localAlerts.map((x) => x.id),
      new Set(rdsAlerts.map((x) => x.id))
    );
    skipSame(
      'Message',
      localMsgs.map((x) => x.id),
      new Set(rdsMsgs.map((x) => x.id))
    );
    for (const id of localCheckIns.map((x) => x.id)) {
      if (!rdsCheckIns.some((r) => r.id === id)) {
        conflicts.push(`CheckIn ${id} local-only — not in Phase 1 plan; unresolved.`);
      }
    }
    for (const id of localAlerts.map((x) => x.id)) {
      if (!rdsAlerts.some((r) => r.id === id)) {
        conflicts.push(`RiskAlert ${id} local-only — unresolved.`);
      }
    }
    for (const id of localMsgs.map((x) => x.id)) {
      if (!rdsMsgs.some((r) => r.id === id)) {
        conflicts.push(`Message ${id} local-only — unresolved.`);
      }
    }
    if (localOtps.length) conflicts.push(`EmailOtp has ${localOtps.length} local rows — unexpected.`);
    if (localWait.length) conflicts.push(`WaitlistEntry has ${localWait.length} local rows — unexpected.`);
    if (localIntake.length) conflicts.push(`IntakeInvite has ${localIntake.length} local rows — unexpected.`);
    if (localConsent.length) conflicts.push(`ConsentForm has ${localConsent.length} local rows — unexpected.`);

    const rdsApptById = new Map(rdsAppts.map((a) => [a.id, a]));
    for (const a of localAppts) {
      if (rdsApptById.has(a.id)) {
        apptMap.set(a.id, a.id);
        ops.push({ table: 'Appointment', action: 'SKIP', localId: a.id, reason: 'same primary key' });
      } else {
        const clientId = need(clientMap, a.clientId, `Appointment ${a.id} clientId`);
        if (a.clinicianId) need(userMap, a.clinicianId, `Appointment ${a.id} clinicianId`);
        if (clientId) {
          apptMap.set(a.id, a.id);
          ops.push({ table: 'Appointment', action: 'INSERT', localId: a.id, reason: 'local-only appointment' });
        }
      }
    }

    const rdsNoteById = new Map(rdsNotes.map((n) => [n.id, n]));
    for (const n of localNotes) {
      if (rdsNoteById.has(n.id)) {
        noteMap.set(n.id, n.id);
        ops.push({ table: 'ProgressNote', action: 'SKIP', localId: n.id, reason: 'same primary key' });
      } else {
        if (need(clientMap, n.clientId, `ProgressNote ${n.id} clientId`)) {
          if (n.clinicianId) need(userMap, n.clinicianId, `ProgressNote ${n.id} clinicianId`);
          noteMap.set(n.id, n.id);
          ops.push({ table: 'ProgressNote', action: 'INSERT', localId: n.id, reason: 'local-only note' });
        }
      }
    }

    const rdsWfById = new Map(rdsWfs.map((w) => [w.noteId, w]));
    for (const w of localWfs) {
      if (rdsWfById.has(w.noteId)) {
        ops.push({ table: 'ProgressNoteWorkflow', action: 'SKIP', localId: w.noteId, reason: 'same noteId' });
      } else {
        if (need(noteMap, w.noteId, `ProgressNoteWorkflow ${w.noteId} noteId`)) {
          need(clientMap, w.clientId, `ProgressNoteWorkflow ${w.noteId} clientId`);
          if (w.clinicianId) need(userMap, w.clinicianId, `ProgressNoteWorkflow ${w.noteId} clinicianId`);
          ops.push({
            table: 'ProgressNoteWorkflow',
            action: 'INSERT',
            localId: w.noteId,
            reason: 'local-only workflow',
          });
        }
      }
    }

    const planChild = <T extends { id: string; organizationId: string; clientId: string }>(
      table: string,
      rows: T[],
      rdsRows: T[],
      extra?: (row: T) => void
    ) => {
      const byId = new Map(rdsRows.map((r) => [r.id, r]));
      for (const row of rows) {
        if (byId.has(row.id)) {
          ops.push({ table, action: 'SKIP', localId: row.id, reason: 'same primary key' });
        } else {
          need(orgMap, row.organizationId, `${table} ${row.id} organizationId`);
          need(clientMap, row.clientId, `${table} ${row.id} clientId`);
          extra?.(row);
          ops.push({ table, action: 'INSERT', localId: row.id, reason: `local-only ${table}` });
        }
      }
    };
    planChild('TreatmentPlan', localTps, rdsTps, (r) => {
      if (r.clinicianId) need(userMap, r.clinicianId, `TreatmentPlan ${r.id} clinicianId`);
    });
    planChild('EligibilityCheck', localEls, rdsEls, (r) => {
      if ((r as { checkedById?: string | null }).checkedById) {
        need(userMap, (r as { checkedById?: string | null }).checkedById, `EligibilityCheck ${r.id} checkedById`);
      }
    });
    planChild('PriorAuth', localPas, rdsPas, (r) => {
      if ((r as { createdById?: string | null }).createdById) {
        need(userMap, (r as { createdById?: string | null }).createdById, `PriorAuth ${r.id} createdById`);
      }
    });

    const rdsClaimById = new Map(rdsClaims.map((c) => [c.id, c]));
    const rdsClaimByNote = new Map(
      rdsClaims.filter((c) => c.progressNoteId).map((c) => [c.progressNoteId!, c])
    );
    for (const c of localClaims) {
      if (rdsClaimById.has(c.id)) {
        ops.push({ table: 'Claim', action: 'SKIP', localId: c.id, reason: 'same primary key' });
        continue;
      }
      need(orgMap, c.organizationId, `Claim ${c.id} organizationId`);
      need(clientMap, c.clientId, `Claim ${c.id} clientId`);
      if (c.appointmentId) need(apptMap, c.appointmentId, `Claim ${c.id} appointmentId`);
      const mappedNote = c.progressNoteId ? need(noteMap, c.progressNoteId, `Claim ${c.id} progressNoteId`) : null;
      if (mappedNote && rdsClaimByNote.has(mappedNote) && rdsClaimByNote.get(mappedNote)!.id !== c.id) {
        conflicts.push(`Claim ${c.id} unique progressNoteId ${mappedNote} already used on RDS`);
        continue;
      }
      ops.push({ table: 'Claim', action: 'INSERT', localId: c.id, reason: 'local-only claim' });
    }

    const rdsModById = new Map(rdsMods.map((m) => [m.id, m]));
    const rdsModByOrgModule = new Map(rdsMods.map((m) => [`${m.organizationId}::${m.module}`, m]));
    const plannedModKeys = new Set<string>();
    for (const m of localMods) {
      const mappedOrg = need(orgMap, m.organizationId, `ClinicModuleState ${m.id} organizationId`);
      if (!mappedOrg) continue;
      const key = `${mappedOrg}::${m.module}`;
      const byId = rdsModById.get(m.id);
      const byKey = rdsModByOrgModule.get(key);
      if (byId) {
        ops.push({ table: 'ClinicModuleState', action: 'SKIP', localId: m.id, reason: 'same primary key' });
      } else if (byKey || plannedModKeys.has(key)) {
        ops.push({
          table: 'ClinicModuleState',
          action: 'REMAP',
          localId: m.id,
          rdsId: byKey?.id,
          reason: `preserve RDS state for ${m.module}`,
        });
      } else {
        plannedModKeys.add(key);
        ops.push({ table: 'ClinicModuleState', action: 'INSERT', localId: m.id, reason: `missing module ${m.module}` });
      }
    }

    const byTable = tally(ops);
    const rdsOnlyIds = {
      Organization: rdsOrgs.filter((o) => !localOrgs.some((l) => l.id === o.id)).map((o) => o.id),
      Location: rdsLocs.filter((o) => !localLocs.some((l) => l.id === o.id)).map((o) => o.id),
      User: rdsUsers.filter((o) => !localUsers.some((l) => l.id === o.id)).map((o) => o.id),
      Message: rdsMsgs.filter((o) => !localMsgs.some((l) => l.id === o.id)).map((o) => o.id),
      ClinicModuleState: rdsMods.filter((o) => !localMods.some((l) => l.id === o.id)).map((o) => o.id),
    };

    const plan = {
      generatedAt: new Date().toISOString(),
      phase: 2,
      connections: { local: formatEndpoint(localUrl), rds: formatEndpoint(rdsUrl) },
      databases: { local: localDb, rds: rdsDb },
      counts: byTable,
      totals: ops.reduce(
        (acc, op) => {
          acc[op.action] += 1;
          return acc;
        },
        { INSERT: 0, SKIP: 0, REMAP: 0 }
      ),
      unresolvedConflicts: conflicts,
      rdsOnlyIdsToPreserve: rdsOnlyIds,
      identityMaps: {
        orgRemaps: [...orgMap.entries()].filter(([a, b]) => a !== b),
        locRemaps: [...locMap.entries()].filter(([a, b]) => a !== b),
        userRemaps: [...userMap.entries()].filter(([a, b]) => a !== b),
      },
      ops,
    };
    writeFileSync(join(reportsDir, 'phase2-plan.json'), `${JSON.stringify(plan, null, 2)}\n`);
    const planLines = [
      `Phase 2 plan ${plan.generatedAt}`,
      `LOCAL: ${plan.connections.local}`,
      `RDS:   ${plan.connections.rds}`,
      '',
      'TABLE'.padEnd(24) + 'INSERT'.padStart(8) + 'SKIP'.padStart(8) + 'REMAP'.padStart(8),
    ];
    for (const [table, c] of Object.entries(byTable)) {
      planLines.push(table.padEnd(24) + String(c.INSERT).padStart(8) + String(c.SKIP).padStart(8) + String(c.REMAP).padStart(8));
    }
    planLines.push('');
    planLines.push(`TOTAL INSERT=${plan.totals.INSERT} SKIP=${plan.totals.SKIP} REMAP=${plan.totals.REMAP}`);
    planLines.push(`Unresolved conflicts: ${conflicts.length}`);
    for (const c of conflicts) planLines.push(`  - ${c}`);
    writeFileSync(join(reportsDir, 'phase2-plan.txt'), `${planLines.join('\n')}\n`);
    console.log(planLines.join('\n'));
    console.log(`Wrote ${join(reportsDir, 'phase2-plan.txt')}`);

    if (conflicts.length) {
      throw new Error(`STOP: ${conflicts.length} unresolved conflict(s). No RDS writes.`);
    }

    const insertIds = (table: string) =>
      new Set(ops.filter((o) => o.table === table && o.action === 'INSERT').map((o) => o.localId));

    const orgInsert = insertIds('Organization');
    const locInsert = insertIds('Location');
    const userInsert = insertIds('User');
    const ulInsert = insertIds('UserLocation');
    const apptInsert = insertIds('Appointment');
    const noteInsert = insertIds('ProgressNote');
    const wfInsert = insertIds('ProgressNoteWorkflow');
    const tpInsert = insertIds('TreatmentPlan');
    const elInsert = insertIds('EligibilityCheck');
    const paInsert = insertIds('PriorAuth');
    const claimInsert = insertIds('Claim');
    const modInsert = insertIds('ClinicModuleState');

    console.log('\nNo unresolved conflicts. Executing Phase 2 inserts on RDS…');

    await rds.$transaction(
      async (tx) => {
        for (const o of localOrgs) {
          if (!orgInsert.has(o.id)) continue;
          if (await tx.organization.findUnique({ where: { id: o.id } })) continue;
          if (await tx.organization.findUnique({ where: { slug: o.slug } })) continue;
          await tx.organization.create({
            data: {
              id: o.id,
              name: o.name,
              slug: o.slug,
              active: o.active,
              createdAt: o.createdAt,
              updatedAt: o.updatedAt,
            },
          });
        }

        for (const l of localLocs) {
          if (!locInsert.has(l.id)) continue;
          if (await tx.location.findUnique({ where: { id: l.id } })) continue;
          const organizationId = orgMap.get(l.organizationId)!;
          const dup = await tx.location.findUnique({
            where: { organizationId_name: { organizationId, name: l.name } },
          });
          if (dup) continue;
          await tx.location.create({
            data: {
              id: l.id,
              organizationId,
              name: l.name,
              code: l.code,
              addressLine1: l.addressLine1,
              addressLine2: l.addressLine2,
              city: l.city,
              state: l.state,
              postalCode: l.postalCode,
              phone: l.phone,
              timezone: l.timezone,
              active: l.active,
              isPrimary: l.isPrimary,
              createdAt: l.createdAt,
              updatedAt: l.updatedAt,
            },
          });
        }

        const pendingInvite: Array<{ id: string; invitedById: string }> = [];
        for (const u of localUsers) {
          if (!userInsert.has(u.id)) continue;
          if (await tx.user.findUnique({ where: { id: u.id } })) continue;
          if (await tx.user.findUnique({ where: { email: u.email } })) continue;
          const invitedById = u.invitedById ? userMap.get(u.invitedById) : null;
          const inviterExists = invitedById
            ? Boolean(await tx.user.findUnique({ where: { id: invitedById } }))
            : false;
          await tx.user.create({
            data: {
              id: u.id,
              name: u.name,
              email: u.email,
              passwordHash: u.passwordHash,
              role: u.role,
              roles: u.roles,
              status: u.status,
              image: u.image,
              organizationId: u.organizationId ? orgMap.get(u.organizationId) : null,
              npi: u.npi,
              licenseNumber: u.licenseNumber,
              licenseExpiresAt: u.licenseExpiresAt,
              inviteTokenHash: u.inviteTokenHash,
              inviteExpiresAt: u.inviteExpiresAt,
              invitedById: inviterExists ? invitedById : null,
              primaryLocationId: u.primaryLocationId ? locMap.get(u.primaryLocationId) : null,
              createdAt: u.createdAt,
              updatedAt: u.updatedAt,
            },
          });
          if (u.invitedById && !inviterExists) {
            const mapped = userMap.get(u.invitedById);
            if (mapped) pendingInvite.push({ id: u.id, invitedById: mapped });
          }
        }
        for (const p of pendingInvite) {
          if (await tx.user.findUnique({ where: { id: p.invitedById } })) {
            await tx.user.update({ where: { id: p.id }, data: { invitedById: p.invitedById } });
          }
        }

        for (const ul of localUls) {
          if (!ulInsert.has(ul.id)) continue;
          if (await tx.userLocation.findUnique({ where: { id: ul.id } })) continue;
          const userId = userMap.get(ul.userId)!;
          const locationId = locMap.get(ul.locationId)!;
          const dup = await tx.userLocation.findUnique({
            where: { userId_locationId: { userId, locationId } },
          });
          if (dup) continue;
          await tx.userLocation.create({
            data: {
              id: ul.id,
              userId,
              locationId,
              isPrimary: ul.isPrimary,
              createdAt: ul.createdAt,
            },
          });
        }

        for (const a of localAppts) {
          if (!apptInsert.has(a.id)) continue;
          if (await tx.appointment.findUnique({ where: { id: a.id } })) continue;
          await tx.appointment.create({
            data: {
              id: a.id,
              clientId: clientMap.get(a.clientId)!,
              clinicianId: a.clinicianId ? userMap.get(a.clinicianId) : null,
              type: a.type,
              startsAt: a.startsAt,
              endsAt: a.endsAt,
              status: a.status,
              isVirtual: a.isVirtual,
              notes: a.notes,
              createdAt: a.createdAt,
              updatedAt: a.updatedAt,
            },
          });
        }

        for (const n of localNotes) {
          if (!noteInsert.has(n.id)) continue;
          if (await tx.progressNote.findUnique({ where: { id: n.id } })) continue;
          await tx.progressNote.create({
            data: {
              id: n.id,
              clientId: clientMap.get(n.clientId)!,
              clinicianId: n.clinicianId ? userMap.get(n.clinicianId) : null,
              body: n.body,
              createdAt: n.createdAt,
              updatedAt: n.updatedAt,
            },
          });
        }

        for (const w of localWfs) {
          if (!wfInsert.has(w.noteId)) continue;
          if (await tx.progressNoteWorkflow.findUnique({ where: { noteId: w.noteId } })) continue;
          await tx.progressNoteWorkflow.create({
            data: {
              noteId: noteMap.get(w.noteId)!,
              status: w.status,
              signedAt: w.signedAt,
              lockedAt: w.lockedAt,
              clientId: clientMap.get(w.clientId)!,
              clientName: w.clientName,
              clientImage: w.clientImage,
              clinicianId: w.clinicianId ? userMap.get(w.clinicianId) : null,
              clinicianName: w.clinicianName,
              clinicianImage: w.clinicianImage,
              body: w.body,
              createdAt: w.createdAt,
              updatedAt: w.updatedAt,
            },
          });
        }

        for (const t of localTps) {
          if (!tpInsert.has(t.id)) continue;
          if (await tx.treatmentPlan.findUnique({ where: { id: t.id } })) continue;
          await tx.treatmentPlan.create({
            data: {
              id: t.id,
              organizationId: orgMap.get(t.organizationId)!,
              clientId: clientMap.get(t.clientId)!,
              clinicianId: t.clinicianId ? userMap.get(t.clinicianId) : null,
              title: t.title,
              diagnosisCodes: t.diagnosisCodes,
              status: t.status,
              reviewDueAt: t.reviewDueAt,
              goals: t.goals === null ? Prisma.JsonNull : t.goals,
              strengths: t.strengths,
              presentingProblems: t.presentingProblems,
              createdAt: t.createdAt,
              updatedAt: t.updatedAt,
            },
          });
        }

        for (const e of localEls) {
          if (!elInsert.has(e.id)) continue;
          if (await tx.eligibilityCheck.findUnique({ where: { id: e.id } })) continue;
          await tx.eligibilityCheck.create({
            data: {
              id: e.id,
              organizationId: orgMap.get(e.organizationId)!,
              clientId: clientMap.get(e.clientId)!,
              payerName: e.payerName,
              memberId: e.memberId,
              dos: e.dos,
              status: e.status,
              rawRequest: e.rawRequest === null ? Prisma.JsonNull : e.rawRequest,
              rawResponse: e.rawResponse === null ? Prisma.JsonNull : e.rawResponse,
              checkedAt: e.checkedAt,
              checkedById: e.checkedById ? userMap.get(e.checkedById) : null,
              createdAt: e.createdAt,
              updatedAt: e.updatedAt,
            },
          });
        }

        for (const p of localPas) {
          if (!paInsert.has(p.id)) continue;
          if (await tx.priorAuth.findUnique({ where: { id: p.id } })) continue;
          await tx.priorAuth.create({
            data: {
              id: p.id,
              organizationId: orgMap.get(p.organizationId)!,
              clientId: clientMap.get(p.clientId)!,
              payer: p.payer,
              authNumber: p.authNumber,
              cptCodes: p.cptCodes,
              unitsApproved: p.unitsApproved,
              unitsUsed: p.unitsUsed,
              status: p.status,
              startDate: p.startDate,
              endDate: p.endDate,
              notes: p.notes,
              createdById: p.createdById ? userMap.get(p.createdById) : null,
              createdAt: p.createdAt,
              updatedAt: p.updatedAt,
            },
          });
        }

        for (const c of localClaims) {
          if (!claimInsert.has(c.id)) continue;
          if (await tx.claim.findUnique({ where: { id: c.id } })) continue;
          if (c.progressNoteId) {
            const existing = await tx.claim.findUnique({ where: { progressNoteId: noteMap.get(c.progressNoteId) } });
            if (existing) continue;
          }
          await tx.claim.create({
            data: {
              id: c.id,
              organizationId: orgMap.get(c.organizationId)!,
              clientId: clientMap.get(c.clientId)!,
              appointmentId: c.appointmentId ? apptMap.get(c.appointmentId) : null,
              progressNoteId: c.progressNoteId ? noteMap.get(c.progressNoteId) : null,
              cptCode: c.cptCode,
              units: c.units,
              amountCents: c.amountCents,
              payer: c.payer,
              status: c.status,
              denialReason: c.denialReason,
              createdAt: c.createdAt,
              updatedAt: c.updatedAt,
            },
          });
        }

        for (const m of localMods) {
          if (!modInsert.has(m.id)) continue;
          if (await tx.clinicModuleState.findUnique({ where: { id: m.id } })) continue;
          const organizationId = orgMap.get(m.organizationId)!;
          const dup = await tx.clinicModuleState.findUnique({
            where: { organizationId_module: { organizationId, module: m.module } },
          });
          if (dup) continue;
          await tx.clinicModuleState.create({
            data: {
              id: m.id,
              organizationId,
              module: m.module,
              data: m.data === null ? Prisma.JsonNull : m.data,
              createdAt: m.createdAt,
              updatedAt: m.updatedAt,
            },
          });
        }
      },
      { maxWait: 20000, timeout: 180000 }
    );

    const afterRdsOnly = {
      Organization: (await rds.organization.findMany({ select: { id: true } })).map((x) => x.id),
      Location: (await rds.location.findMany({ select: { id: true } })).map((x) => x.id),
      User: (await rds.user.findMany({ select: { id: true } })).map((x) => x.id),
      Message: (await rds.message.findMany({ select: { id: true } })).map((x) => x.id),
      ClinicModuleState: (await rds.clinicModuleState.findMany({ select: { id: true } })).map((x) => x.id),
    };
    const missingPreserved: Record<string, string[]> = {};
    for (const [table, ids] of Object.entries(rdsOnlyIds)) {
      missingPreserved[table] = ids.filter((id) => !afterRdsOnly[table as keyof typeof afterRdsOnly].includes(id));
    }

    const fkOrphans = await rds.$queryRaw<Array<{ table: string; cnt: number }>>`
      SELECT 'Appointment.clinician' AS table, COUNT(*)::int AS cnt
      FROM "Appointment" a
      WHERE a."clinicianId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = a."clinicianId")
      UNION ALL
      SELECT 'ProgressNote.clinician', COUNT(*)::int
      FROM "ProgressNote" n
      WHERE n."clinicianId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = n."clinicianId")
      UNION ALL
      SELECT 'Location.organization', COUNT(*)::int
      FROM "Location" l
      WHERE NOT EXISTS (SELECT 1 FROM "Organization" o WHERE o.id = l."organizationId")
      UNION ALL
      SELECT 'Claim.progressNote', COUNT(*)::int
      FROM "Claim" c
      WHERE c."progressNoteId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "ProgressNote" n WHERE n.id = c."progressNoteId")
    `;

    const audit = {
      generatedAt: new Date().toISOString(),
      applied: true,
      totals: plan.totals,
      rdsOnlyStillPresent: missingPreserved,
      fkOrphans,
    };
    writeFileSync(join(reportsDir, 'phase2-audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log('\nPhase 2 writes finished. RDS-only missing after merge:');
    console.log(JSON.stringify(missingPreserved));
    console.log('FK orphan counts:', JSON.stringify(fkOrphans));
  } finally {
    await local.$disconnect();
    await rds.$disconnect();
  }

  console.log('\nRe-running Phase 1 comparison…');
  const compare = spawnSync('npx', ['tsx', '--env-file=.env', 'scripts/db-merge/compare.ts'], {
    encoding: 'utf8',
    windowsHide: true,
    shell: true,
    cwd: join(here, '..', '..'),
  });
  console.log(compare.stdout || '');
  if (compare.status !== 0) {
    console.error(compare.stderr || 'compare failed');
    process.exit(compare.status || 1);
  }
}

main().catch((err) => {
  console.error(`Phase 2 failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
