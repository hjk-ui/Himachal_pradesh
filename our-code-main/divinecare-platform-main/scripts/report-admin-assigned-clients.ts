/**
 * Report (and optionally fix) clients whose assigned clinician is a non-clinical user —
 * usually the admin who imported or created them.
 *
 * Usage:
 *   npx tsx scripts/report-admin-assigned-clients.ts                 # counts only (default, read-only)
 *   npx tsx scripts/report-admin-assigned-clients.ts --org <orgId>   # one organization
 *   npx tsx scripts/report-admin-assigned-clients.ts --apply         # write suggested assignees
 *
 * A suggestion is only ever someone already tied to the client: a clinical care-team member
 * (flagged primary, then Therapist / Prescriber / …) or, failing that, the clinician with the most
 * recent COMPLETED visit in the last 18 months. Clients with nobody to suggest are left untouched.
 * Output is counts and ids only — no client names or other PHI.
 *
 * Requires DATABASE_URL.
 */
import { Role } from '@prisma/client';
import { prisma } from '../src/lib/db/prisma';
import { isCaseloadRole } from '../src/types/roles';
import { isNonClinicalAssignee, pickSuggestedClinician, type SuggestionCandidate } from '../src/lib/clients/adminAssigned';
import { loadSeenBy } from '../src/lib/clients/seenBy';
import { writeAuditLog } from '../src/lib/audit/writeAuditLog';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const orgIdx = args.indexOf('--org');
const organizationId = orgIdx >= 0 ? args[orgIdx + 1] : undefined;
if (orgIdx >= 0 && !organizationId) {
  console.error('--org needs an organization id');
  process.exit(1);
}

const NON_CLINICAL_ROLES = (Object.values(Role) as Role[]).filter((r) => isNonClinicalAssignee(r));

async function main() {
  const clients = await prisma.client.findMany({
    where: {
      assignedTo: { role: { in: NON_CLINICAL_ROLES } },
      ...(organizationId ? { organizationId } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      assignedToId: true,
      assignedTo: { select: { id: true, name: true, role: true } },
      treatmentTeamMembers: { select: { providerId: true, role: true, isPrimary: true } },
    },
  });

  console.log(
    `${organizationId ? `Organization ${organizationId}` : 'All organizations'}: ${clients.length} client(s) assigned to a non-clinical user`
  );
  if (clients.length === 0) return;

  // Resolve care-team providers' staff roles in one query.
  const providerIds = new Set<string>();
  for (const c of clients) {
    for (const m of c.treatmentTeamMembers) if (m.providerId) providerIds.add(m.providerId);
  }
  const providers = await prisma.user.findMany({
    where: { id: { in: [...providerIds] }, status: 'ACTIVE' },
    select: { id: true, role: true },
  });
  const roleByProvider = new Map(providers.map((u) => [u.id, u.role as string]));
  const seenByMap = await loadSeenBy(clients.map((c) => c.id));

  const byAssignee = new Map<string, { name: string; role: string; total: number; withSuggestion: number }>();
  const plan: Array<{ clientId: string; organizationId: string | null; fromId: string; toId: string; via: string }> = [];

  for (const c of clients) {
    const assignee = c.assignedTo!;
    const row =
      byAssignee.get(assignee.id) ??
      { name: assignee.name ?? assignee.id, role: assignee.role, total: 0, withSuggestion: 0 };
    byAssignee.set(assignee.id, row);
    row.total += 1;

    const candidates: SuggestionCandidate[] = [];
    for (const m of c.treatmentTeamMembers) {
      const role = m.providerId ? roleByProvider.get(m.providerId) : undefined;
      if (!m.providerId || !role || !isCaseloadRole(role)) continue;
      candidates.push({
        providerId: m.providerId,
        role,
        teamRole: m.role,
        isPrimary: m.isPrimary,
        source: 'careTeam',
      });
    }
    for (const s of seenByMap.get(c.id) ?? []) {
      if (!s.providerId || !s.role) continue;
      candidates.push({
        providerId: s.providerId,
        role: s.role,
        teamRole: null,
        isPrimary: false,
        source: 'seenBy',
        lastSeenAt: s.lastSeenAt,
      });
    }

    const pick = pickSuggestedClinician(candidates);
    if (pick && pick.providerId !== assignee.id) {
      row.withSuggestion += 1;
      plan.push({
        clientId: c.id,
        organizationId: c.organizationId,
        fromId: assignee.id,
        toId: pick.providerId,
        via: pick.source,
      });
    }
  }

  console.log('\nBy assignee (staff only):');
  for (const [id, r] of [...byAssignee].sort((a, b) => b[1].total - a[1].total)) {
    console.log(`  ${r.name} [${r.role}] (${id}): ${r.total} client(s), ${r.withSuggestion} with a suggested clinician`);
  }
  const suggested = plan.length;
  console.log(
    `\nSuggested reassignments: ${suggested} (care team: ${plan.filter((p) => p.via === 'careTeam').length}, last completed visit: ${plan.filter((p) => p.via === 'seenBy').length}).` +
      ` No suggestion, left as is: ${clients.length - suggested}.`
  );

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to assign the suggested clinicians.');
    return;
  }

  let applied = 0;
  let failed = 0;
  for (const p of plan) {
    try {
      // Guard: only move the client if it is still on the same non-clinical assignee.
      const res = await prisma.client.updateMany({
        where: { id: p.clientId, assignedToId: p.fromId },
        data: { assignedToId: p.toId, assignedSince: new Date() },
      });
      if (res.count === 1) {
        applied += 1;
        await writeAuditLog({
          action: 'WRITE',
          organizationId: p.organizationId,
          resourceType: 'client_assignment',
          resourceId: p.clientId,
          metadata: { script: 'report-admin-assigned-clients', fromUserId: p.fromId, toUserId: p.toId, via: p.via },
        });
      }
    } catch (err) {
      failed += 1;
      console.error(`  FAIL client ${p.clientId}`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`\nApplied ${applied} of ${plan.length}. Failed: ${failed}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
