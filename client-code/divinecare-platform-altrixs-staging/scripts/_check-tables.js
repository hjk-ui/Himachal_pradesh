require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const needed = [
  'MigrationJob',
  'TmsCourse',
  'TmsSession',
  'TmsPhq9',
  'SpravatoEnrollment',
  'SpravatoSession',
  'PrpReferral',
  'PrpEnrollment',
  'PriorAuth',
  'SensitiveRecord',
  'SensitiveAccessLog',
  'BreakTheGlassGrant',
];

(async () => {
  const rows = await p.$queryRawUnsafe(
    `SELECT tablename FROM pg_tables WHERE schemaname='public'`
  );
  const set = new Set(rows.map((r) => r.tablename));
  for (const t of needed) {
    console.log(`${t}: ${set.has(t) ? 'YES' : 'NO'}`);
  }
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e);
  await p.$disconnect();
  process.exit(1);
});
