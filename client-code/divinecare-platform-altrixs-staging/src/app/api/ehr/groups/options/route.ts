import { prisma } from '@/lib/db/prisma';
import { gateKind, json } from '../_shared';

export const runtime = 'nodejs';

const FACILITATOR_ROLES = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'CLINICIAN', 'THERAPIST', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'PEER_SUPPORT'] as const;

/** GET ?kind=: facilitator choices (active clinical staff) and practice locations for the group form. */
export async function GET(req: Request) {
  const g = await gateKind(new URL(req.url).searchParams.get('kind'));
  if (g.ok === false) return g.res;
  const [staff, locations] = await Promise.all([
    prisma.user.findMany({
      where: { organizationId: g.actor.organizationId, status: 'ACTIVE', role: { in: [...FACILITATOR_ROLES] } },
      select: { id: true, name: true, email: true, credentials: true, role: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
    prisma.location.findMany({ where: { organizationId: g.actor.organizationId, active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ]);
  return json(200, {
    success: true,
    me: g.actor.userId,
    staff: staff.map((s) => ({ id: s.id, name: s.name?.trim() || s.email, credentials: s.credentials, role: s.role })),
    locations,
  });
}
