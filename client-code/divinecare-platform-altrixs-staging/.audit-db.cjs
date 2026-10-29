const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient({ log: [] });
(async () => {
  try {
    await p.$queryRawUnsafe('SELECT 1');
    console.log('Database connectivity: PASS');
    const tables = await p.$queryRawUnsafe("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()");
    console.log('Database table count:', tables.length);
  } catch (e) { console.log('Database check failed:', e.code || e.name); process.exitCode = 1; }
  finally { await p.$disconnect(); }
})();
