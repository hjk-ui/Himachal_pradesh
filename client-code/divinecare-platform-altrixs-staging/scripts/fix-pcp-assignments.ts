/**
 * Set the PCP for primary care patients whose PCP is MISSING or MISMATCHED (src/lib/medical/pcpAssignment.ts).
 * DRY RUN by default: prints what it would change and writes nothing.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/fix-pcp-assignments.ts               # dry run
 *   npx tsx --conditions=react-server --env-file=.env scripts/fix-pcp-assignments.ts --apply       # write
 *   ... --only=MISSING | --only=MISMATCH     limit to one status
 *   ... --org=<organizationId>               one organization (default: all)
 *   ... --record-text-matches                also record MATCH patients whose PCP is known only from
 *                                            MedicalPatient.assignedPcp text as the care team member
 *                                            (same PCP; makes the care team the one canonical place)
 *
 * --apply makes the evidence provider the "Primary Care Provider" care team member, removes the
 * previous PCP member (that provider keeps "seen by" access only) and mirrors MedicalPatient.assignedPcp.
 * Each change is audited (resourceType primaryCareProvider: client id, old -> new provider id, evidence
 * counts). Client.assignedToId (behavioral health clinician) is never touched. AMBIGUOUS, NO_EVIDENCE
 * and UNMAPPED_PROVIDER are only listed for staff. Idempotent: a second run finds nothing to do.
 * Output: client ids / MRNs and staff user ids only.
 */
import { prisma } from '@/lib/db/prisma';
import {
  evidenceAuditDetail,
  loadPcpContext,
  loadPcpDecisions,
  primaryCareClientIds,
  setPrimaryCareProvider,
} from '@/lib/medical/pcpAssignmentDb';
import { isTextOnlyMatch, PCP_FIXABLE_STATUSES, shouldFix, type PcpStatus } from '@/lib/medical/pcpAssignment';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

async function main() {
  const apply = process.argv.includes('--apply');
  const onlyRaw = arg('only')?.toUpperCase() ?? null;
  if (onlyRaw && !PCP_FIXABLE_STATUSES.includes(onlyRaw as PcpStatus)) {
    throw new Error(`--only must be one of ${PCP_FIXABLE_STATUSES.join(', ')}`);
  }
  const only = (onlyRaw as PcpStatus | null) ?? null;
  const orgFilter = arg('org');
  const recordText = process.argv.includes('--record-text-matches') && !only;
  const now = new Date();
  console.log(apply ? 'APPLY: writing changes' : 'DRY RUN: nothing is written (add --apply to write)');

  const orgs = await prisma.organization.findMany({ where: orgFilter ? { id: orgFilter } : {}, select: { id: true } });
  for (const org of orgs) {
    const ids = await primaryCareClientIds(org.id);
    if (!ids.length) continue;
    const ctx = await loadPcpContext(org.id);
    const decisions = [...(await loadPcpDecisions(ctx, ids, now)).values()];
    const todo = decisions
      .filter((d) => shouldFix(d.decision, only) || (recordText && isTextOnlyMatch(d.decision)))
      .map((d) => ({ ...d, targetUserId: (d.decision.proposedUserId ?? d.decision.current?.userId)! }));
    const textOnly = decisions.filter((d) => isTextOnlyMatch(d.decision)).length;
    if (textOnly && !recordText) console.log(`  ${textOnly} MATCH patient(s) have the PCP only as intake text; add --record-text-matches to record them on the care team.`);
    console.log(`\nOrganization ${org.id}: ${decisions.length} primary care patients, ${todo.length} to set${only ? ` (only ${only})` : ''}`);

    let changed = 0;
    let unchanged = 0;
    let failed = 0;
    for (const d of todo) {
      const line = `  ${d.decision.status.padEnd(9)} client=${d.clientId} mrn=${d.mrn ?? '-'} ${d.decision.current?.userId ?? '(none)'} -> ${d.targetUserId} ` +
        `(${d.decision.evidence?.inWindow ?? 0} in 12 mo, ${d.decision.evidence?.total ?? 0} total)`;
      if (!apply) {
        console.log(line);
        continue;
      }
      const res = await setPrimaryCareProvider({
        organizationId: org.id,
        clientId: d.clientId,
        newUserId: d.targetUserId,
        actor: { userId: null, role: 'SYSTEM', via: 'fix-script' },
        auditDetail: evidenceAuditDetail(d),
      });
      if (res.ok === false) {
        failed += 1;
        console.log(`${line}  FAILED: ${res.error}`);
      } else if (res.changed) {
        changed += 1;
        console.log(`${line}  set`);
      } else {
        unchanged += 1;
      }
    }
    if (apply) console.log(`  changed ${changed}, already correct ${unchanged}, failed ${failed}`);

    // Never changed here: listed for staff review
    for (const status of ['AMBIGUOUS', 'UNMAPPED_PROVIDER', 'NO_EVIDENCE'] as const) {
      const list = decisions.filter((d) => d.decision.status === status);
      console.log(`\n  ${status} (${list.length}) — staff review, not changed:`);
      for (const d of list) {
        const detail =
          status === 'AMBIGUOUS'
            ? d.decision.contenders.map((t) => `${t.userId ?? `code ${t.code}`}=${t.inWindow}`).join(', ')
            : status === 'UNMAPPED_PROVIDER'
              ? `code ${d.decision.evidence?.code} (${d.decision.evidence?.inWindow ?? 0} in 12 mo)`
              : `current ${d.decision.current?.userId ?? '(none)'}`;
        console.log(`    client=${d.clientId} mrn=${d.mrn ?? '-'} ${detail}`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
