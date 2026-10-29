/**
 * Backfill structured client legal names (and other deterministic demographic fixes).
 * DRY RUN by default: prints what would change and writes nothing. --apply writes.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/backfill-client-legal-names.ts
 *   ... --apply                  write the changes (one HIPAA audit row per updated client)
 *   ... --org=<organizationId>   limit to one organization
 *   ... --samples=5              sample ids per category (default 5)
 *
 * Rules (src/lib/clients/demographicsBackfill.ts): never guesses.
 *  - Legal first / last: only from a display name in "Last, First M" form (the comma fixes the
 *    family name). The Valant client import never kept its raw rows, so there is no other source;
 *    charts imported with first / last columns already have them.
 *  - Everything else ("First Last" with no comma, two given-name words, one name only, digits)
 *    is flagged: needsNameReview = true with the reason; staff confirm it in Edit Client.
 *  - administrativeSex only from a legacy gender that literally says male / female.
 *  - State / ZIP normalized only when exact ("Maryland" -> MD, "212011234" -> "21201-1234").
 *
 * Output: counts plus client ids / MRNs only (no names, no free text).
 * Imports plain lib modules only (no next-auth / next/navigation chains).
 */
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { planClientBackfill, type BackfillRow } from '@/lib/clients/demographicsBackfill';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const APPLY = process.argv.includes('--apply');
const ORG = arg('org');
const SAMPLES = Math.max(0, Number(arg('samples') ?? 5) || 5);

type Sample = { id: string; mrn: string | null };

async function main() {
  console.log(`Client legal-name backfill — ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes; pass --apply to write)'}${ORG ? ` — org ${ORG}` : ''}`);

  const rows = await prisma.client.findMany({
    where: ORG ? { organizationId: ORG } : {},
    select: {
      id: true, mrn: true, organizationId: true, status: true, name: true,
      legalFirstName: true, legalLastName: true, middleInitial: true, nameSuffix: true,
      needsNameReview: true, nameReviewReason: true, gender: true, administrativeSex: true,
      state: true, postalCode: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  const counts = {
    total: rows.length,
    nameAlreadySet: 0, nameParsed: 0, nameFlagged: 0, nameAlreadyFlagged: 0,
    sexAlreadySet: 0, sexMapped: 0, sexMissing: 0, sexUnmapped: 0,
    stateNormalized: 0, zipNormalized: 0,
    toUpdate: 0, updated: 0, failed: 0,
  };
  const reasons = new Map<string, number>();
  const genderBuckets = new Map<string, number>();
  const samples: Record<string, Sample[]> = { parsed: [], flagged: [], sexMapped: [], sexNeedsEntry: [] };
  const sample = (key: string, c: { id: string; mrn: string | null }) => {
    if (samples[key].length < SAMPLES) samples[key].push({ id: c.id, mrn: c.mrn });
  };

  for (const c of rows) {
    const plan = planClientBackfill(c as BackfillRow);
    if (plan.name === 'already_set') counts.nameAlreadySet++;
    if (plan.name === 'parsed') { counts.nameParsed++; sample('parsed', c); }
    if (plan.name === 'flagged') { counts.nameFlagged++; sample('flagged', c); }
    if (plan.name === 'already_flagged') counts.nameAlreadyFlagged++;
    if (plan.nameReason && (plan.name === 'flagged' || plan.name === 'already_flagged')) {
      reasons.set(plan.nameReason, (reasons.get(plan.nameReason) ?? 0) + 1);
    }
    if (plan.sex === 'already_set') counts.sexAlreadySet++;
    if (plan.sex === 'mapped') { counts.sexMapped++; sample('sexMapped', c); }
    if (plan.sex === 'missing') { counts.sexMissing++; sample('sexNeedsEntry', c); }
    if (plan.sex === 'unmapped') {
      counts.sexUnmapped++;
      sample('sexNeedsEntry', c);
      genderBuckets.set(plan.legacyGenderBucket!, (genderBuckets.get(plan.legacyGenderBucket!) ?? 0) + 1);
    }
    if (plan.stateNormalized) counts.stateNormalized++;
    if (plan.zipNormalized) counts.zipNormalized++;

    const fields = Object.keys(plan.data);
    if (!fields.length) continue;
    counts.toUpdate++;
    if (!APPLY) continue;
    try {
      await prisma.client.update({ where: { id: c.id }, data: plan.data });
      counts.updated++;
      await writeAuditLog({
        action: 'UPDATE',
        actorUserId: null,
        actorRole: 'system',
        organizationId: c.organizationId,
        resourceType: 'patient',
        resourceId: c.id,
        patientId: c.id,
        outcome: 'SUCCESS',
        metadata: { script: 'backfill-client-legal-names', fields, nameOutcome: plan.name, sexOutcome: plan.sex },
      });
    } catch (err) {
      counts.failed++;
      console.error(`  FAIL ${c.id}: ${err instanceof Error ? err.name : 'error'}`);
    }
  }

  console.log('\nLegal name');
  console.log(`  already set (first + last)        ${counts.nameAlreadySet}`);
  console.log(`  parsed from "Last, First M"       ${counts.nameParsed}`);
  console.log(`  flagged for staff review (new)    ${counts.nameFlagged}`);
  console.log(`  already flagged                   ${counts.nameAlreadyFlagged}`);
  for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`    - ${r}: ${n}`);
  console.log('\nSex (administrativeSex, X12 / Rcopia)');
  console.log(`  already set                       ${counts.sexAlreadySet}`);
  console.log(`  mapped from legacy male / female  ${counts.sexMapped}`);
  console.log(`  missing (needs entry)             ${counts.sexMissing}`);
  console.log(`  legacy value not mappable         ${counts.sexUnmapped}`);
  for (const [g, n] of [...genderBuckets.entries()].sort((a, b) => b[1] - a[1])) console.log(`    - legacy "${g}": ${n}`);
  console.log('\nAddress formats');
  console.log(`  state normalized to USPS code     ${counts.stateNormalized}`);
  console.log(`  ZIP normalized (5 / ZIP+4)        ${counts.zipNormalized}`);
  console.log(`\nClients ${APPLY ? 'updated' : 'that would be updated'}: ${APPLY ? counts.updated : counts.toUpdate} of ${counts.total}${counts.failed ? ` (${counts.failed} failed)` : ''}`);
  for (const [k, list] of Object.entries(samples)) {
    if (list.length) console.log(`  sample ${k}: ${list.map((s) => `${s.id}${s.mrn ? ` (${s.mrn})` : ''}`).join(', ')}`);
  }
  if (!APPLY && counts.toUpdate) console.log('\nDry run only. Re-run with --apply to write.');
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
