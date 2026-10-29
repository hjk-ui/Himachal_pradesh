require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const labels = await p.$queryRawUnsafe(
    "SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'LabOrderStatus' ORDER BY 1"
  );
  console.log('LabOrderStatus=', labels.map((r) => r.enumlabel).join(','));
  await p.$disconnect();
})().catch(async (e) => {
  console.error(e.message);
  await p.$disconnect();
  process.exit(1);
});
