/**
 * Active clients whose primary (Client.assignedToId) is a non-clinical account — Admin, Office
 * Manager, Front Desk, Billing, HR... (the Valant client import used to default to the importing
 * admin when Valant had no provider). READ-ONLY by default; prints COUNTS ONLY (no names, emails,
 * MRNs or ids).
 *
 *   npx tsx scripts/report-admin-assigned-clients.ts                      # all orgs, report only
 *   SEED_ORG_SLUG=<slug> npx tsx scripts/report-admin-assigned-clients.ts # one org
 *
 * --apply-suggestions (needs the owner's approval; requires SEED_ORG_SLUG): reassigns ONLY clients
 * whose most recent completed visit was with an active clinician (caseload role), and sets the rest
 * to NULL (Unassigned). Each update is guarded on the current assignee so a chart changed since the
 * report is left alone. Plan logic: src/lib/clients/adminAssignedPlan.ts.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { nonClinicalAssigneeUserWhere } from '../src/lib/clients/careTeam';
import { planAdminAssigned } from '../src/lib/clients/adminAssignedPlan';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply-suggestions');

async function main() {
  const slug = process.env.SEED_ORG_SLUG?.trim();
  if (APPLY && !slug) {
    console.error('--apply-suggestions needs SEED_ORG_SLUG (one organization at a time). Nothing was written.');
    process.exitCode = 1;
    return;
  }
  const orgs = await prisma.organization.findMany({ where: slug ? { slug } : undefined, orderBy: { slug: 'asc' }, select: { id: true, slug: true } });
  let written = 0;
  for (const org of orgs) {
    const clients = await prisma.client.findMany({
      where: { organizationId: org.id, status: 'ACTIVE', assignedTo: nonClinicalAssigneeUserWhere() },
      select: { id: true, assignedToId: true, assignedTo: { select: { role: true } } },
    });
    const ids = clients.map((c) => c.id);
    const visits = ids.length
      ? await prisma.appointment.findMany({
          where: { clientId: { in: ids }, status: 'COMPLETED', startsAt: { lt: new Date() } },
          select: { clientId: true, clinicianId: true, startsAt: true },
        })
      : [];
    const clinicianIds = [...new Set(visits.map((v) => v.clinicianId).filter((id): id is string => Boolean(id)))];
    const staff = clinicianIds.length
      ? await prisma.user.findMany({ where: { organizationId: org.id, id: { in: clinicianIds } }, select: { id: true, role: true, roles: true, status: true } })
      : [];
    const plan = planAdminAssigned(
      ids,
      visits,
      staff.map((s) => ({ id: s.id, role: String(s.role), roles: s.roles.map(String), status: String(s.status) }))
    );
    const byRole = new Map<string, number>();
    for (const c of clients) byRole.set(String(c.assignedTo?.role ?? 'unknown'), (byRole.get(String(c.assignedTo?.role ?? 'unknown')) || 0) + 1);
    const k = plan.counts;
    console.log(`\n${org.slug}`);
    console.log(`  active clients assigned to a non-clinical account: ${k.total}${byRole.size ? ` (by assignee role: ${[...byRole.entries()].sort().map(([r, n]) => `${r}=${n}`).join(', ')})` : ''}`);
    console.log(`  with a completed visit: ${k.withCompletedVisit} · never had a completed visit: ${k.withoutCompletedVisit}`);
    console.log(`  clear suggestion (latest completed-visit clinician): ${k.suggested} across ${k.distinctSuggestedClinicians} clinician(s)`);
    console.log(`  would be set to Unassigned: ${k.toUnassigned} (of which latest visit clinician unclear: ${k.unclearLatestClinician})`);

    if (APPLY && k.total) {
      for (const c of clients) {
        const next = plan.decisions.get(c.id) ?? null;
        // Guarded on the current assignee: a chart reassigned since the report is left alone
        const r = await prisma.client.updateMany({ where: { id: c.id, organizationId: org.id, assignedToId: c.assignedToId }, data: { assignedToId: next } });
        written += r.count;
      }
      console.log(`  applied: ${written} client(s) updated`);
    }
  }
  console.log(`\n${orgs.length} org(s). ${APPLY ? `${written} client(s) updated.` : 'Nothing was written (report only).'}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
