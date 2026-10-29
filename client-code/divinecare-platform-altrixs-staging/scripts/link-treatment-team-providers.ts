/**
 * Link name-only treatment-team rows (ClientTreatmentTeamMember.providerId = null, mostly from the
 * Valant import) to the staff account they name, so the clinician's care-team access works.
 *   npx tsx --env-file=.env scripts/link-treatment-team-providers.ts            dry run: counts only
 *   npx tsx --env-file=.env scripts/link-treatment-team-providers.ts --apply    write providerId
 * Matching, per organization, only when exactly ONE staff user matches (never a guess):
 *   1. Valant provider map (ValantProviderMap.codeKey, e.g. "k.daniel")
 *   2. full name ("Jane Doe" / "Doe, Jane"), credentials after a comma or dash ignored
 *   3. first initial + last name ("K.Daniel", "K Daniel") when unique
 * Prints counts and the unmatched / ambiguous team names (staff names, no patient data).
 */
import { prisma } from '@/lib/db/prisma';

const APPLY = process.argv.includes('--apply');
const CREDENTIALS = /\b(lcsw-c|lcsw|lcpc|lgpc|lmsw|lgsw|lcmft|lgmft|lcadc|lgadc|cprs|crnp|pmhnp-bc|pmhnp|fnp-bc|fnp|np|md|do|phd|psyd|rn|lpc|ma|ms|msw|med|bc)\b\.?/g;

const key = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
function nameParts(raw: string): { first: string; last: string } | null {
  let s = raw.toLowerCase().replace(CREDENTIALS, ' ').replace(/[()]/g, ' ');
  let first = '';
  let last = '';
  if (/^[^,]+,[^,]+/.test(s) && !/^[a-z]\.\s*[a-z]/.test(s)) {
    // "Doe, Jane" (a trailing ", LCPC" was already stripped)
    const [l, f] = s.split(',');
    last = l.trim();
    first = (f || '').trim().split(/\s+/)[0] || '';
  } else {
    s = s.replace(/,.*$/, '').replace(/\s+-\s+.*$/, '');
    const words = s.replace(/\./g, '. ').trim().split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    first = words[0].replace(/\.$/, '');
    last = words[words.length - 1];
  }
  first = first.replace(/[^a-z'-]/g, '');
  last = last.replace(/[^a-z'-]/g, '');
  return first && last ? { first, last } : null;
}

async function main() {
  const rows = await prisma.clientTreatmentTeamMember.findMany({
    where: { providerId: null },
    select: { id: true, name: true, client: { select: { organizationId: true } } },
  });
  const orgIds = [...new Set(rows.map((r) => r.client?.organizationId).filter((x): x is string => Boolean(x)))];
  const out = { apply: APPLY, rows: rows.length, linked: 0, byMap: 0, byFullName: 0, byInitial: 0, ambiguous: 0, unmatched: 0, noOrg: 0 };
  const unmatched = new Map<string, number>();
  const ambiguous = new Map<string, number>();

  for (const orgId of orgIds) {
    const [users, maps] = await Promise.all([
      prisma.user.findMany({ where: { organizationId: orgId }, select: { id: true, name: true } }),
      prisma.valantProviderMap.findMany({ where: { organizationId: orgId }, select: { codeKey: true, userId: true } }),
    ]);
    const mapByCode = new Map(maps.map((m) => [m.codeKey, m.userId]));
    const parsed = users
      .map((u) => ({ id: u.id, p: nameParts(u.name || '') }))
      .filter((u): u is { id: string; p: { first: string; last: string } } => Boolean(u.p));

    const updates = new Map<string, string[]>(); // userId -> row ids
    for (const r of rows.filter((x) => x.client?.organizationId === orgId)) {
      const n = r.name || '';
      let userId: string | null = mapByCode.get(key(n)) ?? null;
      let how: 'byMap' | 'byFullName' | 'byInitial' | null = userId ? 'byMap' : null;
      const p = userId ? null : nameParts(n);
      if (!userId && p) {
        const full = parsed.filter((u) => u.p.first === p.first && u.p.last === p.last);
        if (full.length === 1) { userId = full[0].id; how = 'byFullName'; }
        else if (full.length > 1) { ambiguous.set(n, (ambiguous.get(n) || 0) + 1); out.ambiguous += 1; continue; }
        else {
          const init = parsed.filter((u) => u.p.last === p.last && u.p.first[0] === p.first[0]);
          if (init.length === 1) { userId = init[0].id; how = 'byInitial'; }
          else if (init.length > 1) { ambiguous.set(n, (ambiguous.get(n) || 0) + 1); out.ambiguous += 1; continue; }
        }
      }
      if (!userId || !how) { unmatched.set(n, (unmatched.get(n) || 0) + 1); out.unmatched += 1; continue; }
      out[how] += 1;
      out.linked += 1;
      updates.set(userId, [...(updates.get(userId) || []), r.id]);
    }
    if (APPLY) {
      for (const [userId, ids] of updates) {
        for (let i = 0; i < ids.length; i += 500) {
          await prisma.clientTreatmentTeamMember.updateMany({ where: { id: { in: ids.slice(i, i + 500) }, providerId: null }, data: { providerId: userId } });
        }
      }
    }
  }
  out.noOrg = rows.filter((r) => !r.client?.organizationId).length;

  console.log(JSON.stringify(out));
  const top = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([n, c]) => `  ${c}\t${n}`).join('\n');
  if (ambiguous.size) console.log(`Ambiguous team names (more than one staff match; not linked):\n${top(ambiguous)}`);
  if (unmatched.size) console.log(`Unmatched team names (no staff account; not linked):\n${top(unmatched)}`);
  if (!APPLY) console.log('Dry run: nothing written. Re-run with --apply to link the matches above.');
}

main()
  .catch((err) => { console.error('link-treatment-team-providers failed:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
