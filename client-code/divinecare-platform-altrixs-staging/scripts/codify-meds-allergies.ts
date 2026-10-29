/**
 * Backfill RxNorm codes on existing free-text medications and allergies (DrFirst MUM2-MUM4 / AUM2).
 *
 * Usage:
 *   npx tsx scripts/codify-meds-allergies.ts                 dry run: report only, nothing written
 *   npx tsx scripts/codify-meds-allergies.ts --apply         write the unambiguous exact matches
 *   options: --org <organizationId>   one organization only
 *            --limit <n>              at most n medications and n allergies
 *            --json <file>            also write the full plan (ids, text, reasons, candidates) as JSON
 *
 * Rules (src/lib/drugs/codify.ts):
 *  - Only an exact, single match is applied: the RxNorm code already on the record, an exact RxNorm
 *    name, or exactly one product of the drug at the recorded strength (and recorded form, if any);
 *    for allergies exactly one RxNorm ingredient for the name (or a brand with one ingredient).
 *  - A strength is never guessed: no strength, several strengths or several forms -> staff review.
 *  - Obvious food / environmental allergens (peanut, latex ...) are classified, never coded.
 *  - Local records only: rows downloaded from DrFirst are coded in Rcopia and never sent back.
 * Only drug names leave Altrixs (NLM RxNav); the report prints record ids, never patient names.
 * Requires DATABASE_URL. Re-runnable: coded rows are skipped, and a row coded meanwhile is not overwritten.
 */
import { writeFileSync } from 'node:fs';
import { prisma } from '../src/lib/db/prisma';
import { rxnav } from '../src/lib/drugs/rxnav';
import { backfillUpdates, planBackfill, type BackfillItem } from '../src/lib/drugs/backfill';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const APPLY = process.argv.includes('--apply');
const ORG = arg('--org');
const LIMIT = arg('--limit') ? Math.max(1, Number.parseInt(arg('--limit')!, 10) || 1) : undefined;
const JSON_OUT = arg('--json');

function line(i: BackfillItem): string {
  const r = i.result;
  const cands = 'candidates' in r && r.candidates.length
    ? `\n        candidates: ${r.candidates.slice(0, 6).map(c => `${c.rxcui} ${c.display}`).join(' | ')}`
    : '';
  const code = i.code ? ` -> RxNorm ${i.code.rxcui} ${i.code.display}` : '';
  return `  [${i.kind}] ${i.id} client ${i.clientId ?? '-'}: "${i.text}" (${r.reason ?? ''})${code}${cands}`;
}

async function main() {
  const clientScope = ORG ? { client: { organizationId: ORG } } : {};
  const medications = await prisma.clientMedication.findMany({
    where: { rcopiaMedId: null, drugCodedAt: null, ...clientScope },
    select: { id: true, clientId: true, medicationName: true, drugName: true, dosage: true, brandName: true, genericName: true, rxnormId: true },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });
  const allergies = await prisma.medicalAllergy.findMany({
    where: {
      rxnormId: null,
      OR: [{ source: null }, { source: { not: 'drfirst' } }],
      AND: [{ OR: [{ allergenType: null }, { allergenType: 'drug' }] }],
      ...clientScope,
    },
    select: { id: true, clientId: true, allergen: true, allergenType: true },
    orderBy: { createdAt: 'asc' },
    ...(LIMIT ? { take: LIMIT } : {}),
  });

  console.log(`Drug codification backfill (${APPLY ? 'APPLY' : 'dry run'})${ORG ? ` org ${ORG}` : ''}`);
  console.log(`Uncoded local medications: ${medications.length}; uncoded drug / unclassified allergies: ${allergies.length}`);

  const plan = await planBackfill({ medications, allergies }, rxnav());
  const by = (s: string) => plan.items.filter(i => i.result.status === s);

  const show = (title: string, items: BackfillItem[]) => {
    if (!items.length) return;
    console.log(`\n${title} (${items.length})`);
    for (const i of items) console.log(line(i));
  };
  show(APPLY ? 'Applied: exact single matches' : 'Would apply: exact single matches', by('exact'));
  show(APPLY ? 'Classified as non-drug allergies' : 'Would classify as non-drug allergies', by('non_drug'));
  show('Staff review needed (ambiguous: pick in the chart with "Not coded — code it")', by('review'));
  show('No RxNorm match (leave as free text or correct the name)', by('no_match'));
  show('RxNav unavailable (re-run later)', by('unavailable'));

  const written = { medications: 0, allergies: 0 };
  if (APPLY) {
    const updates = backfillUpdates(plan);
    for (const u of updates.medications) {
      // Never overwrite a row someone coded while this ran
      const r = await prisma.clientMedication.updateMany({ where: { id: u.id, drugCodedAt: null }, data: u.data });
      written.medications += r.count;
    }
    for (const u of updates.allergies) {
      const r = await prisma.medicalAllergy.updateMany({ where: { id: u.id, rxnormId: null }, data: u.data });
      written.allergies += r.count;
    }
  }

  console.log('\nCounts');
  for (const kind of ['medication', 'allergy'] as const) {
    const c = plan.counts[kind];
    console.log(
      `  ${kind === 'medication' ? 'Medications' : 'Allergies  '}: total ${c.total} | exact ${c.exact} | review ${c.review} | no match ${c.no_match}` +
        (kind === 'allergy' ? ` | non-drug ${c.non_drug}` : '') +
        ` | skipped ${c.skip} | unavailable ${c.unavailable}`,
    );
  }
  if (APPLY) console.log(`  Written: ${written.medications} medications, ${written.allergies} allergies`);
  else console.log('  Dry run: nothing written. Re-run with --apply to write the exact matches.');

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, JSON.stringify({ applied: APPLY, counts: plan.counts, written, items: plan.items }, null, 2));
    console.log(`  Plan written to ${JSON_OUT}`);
  }
}

main()
  .catch(err => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
