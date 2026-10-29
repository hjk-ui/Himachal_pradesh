/**
 * Homebase sync job (read-only: nothing is written back to Homebase).
 *
 * Pulls locations and employees from Homebase and updates the local employee links.
 * Requires HOMEBASE_API_KEY and HOMEBASE_ORGANIZATION_ID. Without them it exits 0 and reports "not connected".
 *
 * Usage:
 *   npx tsx scripts/homebase-sync.ts
 *
 * Scheduling (ops enables later) — cron, daily at 05:30:
 *   # 30 5 * * * cd /app && npx tsx scripts/homebase-sync.ts >> /var/log/homebase-sync.log 2>&1
 */
import 'dotenv/config';
import { getHomebaseConfig } from '../src/lib/homebase/client';
import { syncHomebase } from '../src/lib/homebase/sync';

async function main() {
  const config = getHomebaseConfig();
  if (!config) {
    console.log('[homebase-sync] Not connected: HOMEBASE_API_KEY / HOMEBASE_ORGANIZATION_ID are not set.');
    return;
  }
  const result = await syncHomebase({ organizationId: config.organizationId, trigger: 'cron' });
  if (!result.connected) {
    console.log('[homebase-sync] Not connected.');
    return;
  }
  if (result.ok === false) {
    console.error('[homebase-sync] FAILED:', result.error);
    process.exitCode = 1;
    return;
  }
  console.log(
    `[homebase-sync] ok: ${result.locations} locations, ${result.employees} employees, ${result.matched} matched`
  );
}

main()
  .catch((err) => {
    console.error('[homebase-sync] fatal', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
