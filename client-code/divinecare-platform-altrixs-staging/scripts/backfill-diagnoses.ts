/**
 * Backfill the client diagnosis list (ClientDiagnosis, prisma/migrations/20261025_diagnosis_list.sql)
 * from the client record (Client.primaryDiagnosis / primaryDiagnosisCode / secondaryDiagnoses,
 * written by the Valant "Diagnoses - Patient" import, intake and the profile form).
 * DRY RUN by default: prints counts and writes nothing. --apply writes.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/backfill-diagnoses.ts
 *   ... --apply                  write (one transaction + history event per client, one HIPAA audit row per client)
 *   ... --org=<organizationId>   limit to one organization
 *
 * Rules (src/lib/diagnoses/backfill.ts): clients that already have a list are skipped; the record's
 * primary becomes rank 1, secondaries follow in their order; codes are taken only where the text
 * holds one (never guessed from words); uncoded text stays an uncoded entry ("Needs coding");
 * codes not in the FY2027 set or header codes are kept (they were on the chart) and flagged on the
 * chart and in the claim scrubber. Source: "Valant import" for Valant-imported clients, otherwise
 * "Client record". The client-record fields are rewritten as the list's derived copy.
 *
 * Output: counts only (no names, codes, ids or free text).
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { planDiagnosisBackfill } from '@/lib/diagnoses/backfill';
import { mergeImportedDiagnoses } from '@/lib/diagnoses/store';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const APPLY = process.argv.includes('--apply');
const ORG = arg('org');
const ACTOR = 'system:backfill-diagnoses';
const BATCH = 500;

async function main() {
  console.log(`Diagnosis list backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes; pass --apply to write)'}${ORG ? ' — one organization' : ''}`);
  const totals = {
    clientsScanned: 0,
    skippedHasList: 0,
    skippedNoDiagnoses: 0,
    clientsToCreate: 0,
    clientsCreated: 0,
    clientsFailed: 0,
    diagnoses: 0,
    coded: 0,
    uncoded: 0,
    notInCodeSet: 0,
    headerCodes: 0,
    valantSource: 0,
  };
  let cursor: string | undefined;
  for (;;) {
    const clients = await prisma.client.findMany({
      where: {
        ...(ORG ? { organizationId: ORG } : {}),
        OR: [{ primaryDiagnosisCode: { not: null } }, { primaryDiagnosis: { not: null } }, { secondaryDiagnoses: { not: null } }],
      },
      select: { id: true, organizationId: true, sourcePlatform: true, primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!clients.length) break;
    cursor = clients[clients.length - 1].id;
    const withList = new Set(
      (await prisma.clientDiagnosis.findMany({ where: { clientId: { in: clients.map((c) => c.id) } }, select: { clientId: true }, distinct: ['clientId'] })).map((r) => r.clientId)
    );
    for (const c of clients) {
      totals.clientsScanned++;
      const plan = planDiagnosisBackfill(c, { hasList: withList.has(c.id) });
      if (plan.action === 'skip') {
        if (plan.reason === 'has_list') totals.skippedHasList++;
        else totals.skippedNoDiagnoses++;
        continue;
      }
      totals.clientsToCreate++;
      totals.diagnoses += plan.entries.length;
      totals.coded += plan.counts.coded;
      totals.uncoded += plan.counts.uncoded;
      totals.notInCodeSet += plan.counts.notInCodeSet;
      totals.headerCodes += plan.counts.header;
      if (plan.source === 'VALANT_IMPORT') totals.valantSource++;
      if (!APPLY) continue;
      if (!c.organizationId) {
        totals.clientsFailed++;
        continue;
      }
      try {
        const res = await mergeImportedDiagnoses(
          { organizationId: c.organizationId, userId: ACTOR, name: 'Diagnosis backfill' },
          c.id,
          plan.entries,
          { source: plan.source, context: 'backfill', createList: true }
        );
        if (res.ok === false) {
          totals.clientsFailed++;
          continue;
        }
        totals.clientsCreated++;
        await writeAuditLog({
          action: 'CREATE',
          actorUserId: null,
          actorRole: 'SYSTEM',
          organizationId: c.organizationId,
          resourceType: 'clientDiagnosis',
          resourceId: c.id,
          patientId: c.id,
          metadata: { context: 'backfill', script: 'backfill-diagnoses', diagnoses: res.added },
        });
      } catch {
        totals.clientsFailed++;
      }
    }
  }
  console.log(JSON.stringify(totals, null, 2));
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error('backfill-diagnoses failed:', err instanceof Error ? err.name : 'error');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
