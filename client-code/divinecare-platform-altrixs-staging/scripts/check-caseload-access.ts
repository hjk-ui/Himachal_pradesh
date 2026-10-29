/**
 * Read-only check that every clinician can see their own clients through the real access rule
 * (clientAccessWhere): primary assigned + linked treatment team (+ own appointments).
 *   npx tsx --env-file=.env scripts/check-caseload-access.ts
 * Prints staff role / status and counts only (no patient data). "missing" must be 0.
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

const ROLES = ['THERAPIST', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT', 'CLINICIAN', 'PHYSICIAN', 'MEDICAL_NP', 'MEDICAL_ASSISTANT'];

async function main() {
  const staff = await prisma.user.findMany({
    where: { role: { in: ROLES as Role[] }, organizationId: { not: null }, status: { not: 'DEACTIVATED' } },
    select: { id: true, name: true, role: true, status: true, organizationId: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });
  let totalMissing = 0;
  console.log('staff | role | status | own clients (assigned + team) | visible | own not visible');
  for (const u of staff) {
    const own = await prisma.client.findMany({
      where: { OR: [{ assignedToId: u.id }, { treatmentTeamMembers: { some: { providerId: u.id } } }] },
      select: { id: true },
    });
    const visible = await prisma.client.findMany({
      where: { AND: [clientAccessWhere({ organizationId: u.organizationId!, actorUserId: u.id, actorRole: u.role as Role }), { id: { in: own.map((c) => c.id) } }] },
      select: { id: true },
    });
    const total = await prisma.client.count({ where: clientAccessWhere({ organizationId: u.organizationId!, actorUserId: u.id, actorRole: u.role as Role }) });
    const missing = own.length - visible.length;
    totalMissing += missing;
    console.log(`${u.name} | ${u.role} | ${u.status} | ${own.length} | ${total} | ${missing}`);
  }
  console.log(`TOTAL own-but-not-visible: ${totalMissing}`);
}

main()
  .catch((err) => { console.error('check failed:', err instanceof Error ? err.message : err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
