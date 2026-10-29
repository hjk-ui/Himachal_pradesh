import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createEmployee } from '@/lib/hr/people';
import { startChecklist } from '@/lib/hr/checklists';
import { computeExpirations } from '@/lib/hr/expirations';
import { auditHr, hrGate, hrJsonError, hrServerError, loadRoster, practiceTodayFor } from '@/lib/hr/server';
import { isHrAdminRole } from '@/lib/hr/standard';
import { CLINIC_ADMIN_ROLE_VALUES } from '@/lib/platform/clinic-roles';

export const runtime = 'nodejs';

/**
 * GET /api/hr/people: the HR roster (HR, leadership, Office Manager). Office Manager gets the
 * directory columns and credential status only (no pay, personal or discipline fields exist here).
 */
export async function GET(req: Request) {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const includeFormer = new URL(req.url).searchParams.get('former') === '1';
    const roster = await loadRoster(g.ctx.organizationId, { includeDeactivated: includeFormer });
    const { items } = await computeExpirations(g.ctx.organizationId, { attentionOnly: true, roster });
    const attention = new Map<string, { expired: number; due: number }>();
    for (const i of items) {
      const a = attention.get(i.userId) ?? { expired: 0, due: 0 };
      if (i.status === 'expired' || i.status === 'missing') a.expired += 1;
      else a.due += 1;
      attention.set(i.userId, a);
    }
    const nameOf = new Map(roster.map((p) => [p.userId, p.name]));
    await auditHr(g.ctx, req, 'LIST', 'hrPeople', null, { count: roster.length });
    return NextResponse.json({
      success: true,
      canEdit: isHrAdminRole(g.ctx.role),
      people: roster
        .filter((p) => includeFormer || p.hrStatus !== 'Terminated')
        .map((p) => ({
          userId: p.userId,
          name: p.name,
          preferredName: p.preferredName,
          email: p.email,
          role: p.role,
          accountStatus: p.accountStatus,
          credentials: p.credentials,
          jobTitle: p.jobTitle,
          department: p.department,
          programs: p.programs,
          employmentType: p.employmentType,
          workerType: p.workerType,
          hrStatus: p.hrStatus,
          hireDate: p.hireDate,
          managerName: p.managerUserId ? nameOf.get(p.managerUserId) ?? null : null,
          locationNames: p.locationNames,
          hasProfile: Boolean(p.profileId),
          attention: attention.get(p.userId) ?? { expired: 0, due: 0 },
        })),
    });
  } catch (err) {
    return hrServerError('people list', err);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  role: z.enum(CLINIC_ADMIN_ROLE_VALUES),
  jobTitle: z.string().trim().min(1).max(120),
  department: z.string().trim().max(60).default(''),
  employmentType: z.enum(['Full-Time', 'Part-Time', 'Per Diem', 'Contract']),
  workerType: z.enum(['W2', '1099', 'PER_DIEM']).optional(),
  hireDate: z.string().trim().max(10).optional().nullable(),
  managerUserId: z.string().trim().max(128).optional().nullable(),
  programs: z.array(z.string().trim().max(40)).max(10).optional(),
  sendInvite: z.boolean().default(true),
  startOnboarding: z.boolean().default(true),
});

/** POST /api/hr/people: new hire (Altrixs invite + HR profile + onboarding checklist). */
export async function POST(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the new hire details', 400);
  }
  // Leadership roles are granted by an administrator / practice director only (no HR escalation).
  if (['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR'].includes(body.role) && !['ADMIN', 'PRACTICE_DIRECTOR'].includes(g.ctx.role)) {
    return hrJsonError('Only an administrator or practice director can add leadership accounts', 403);
  }
  try {
    const result = await createEmployee(g.ctx, body);
    if (!result.ok) return hrJsonError(result.error, result.status);
    let checklistId: string | null = null;
    if (body.startOnboarding) {
      const start = body.hireDate || (await practiceTodayFor(g.ctx.organizationId));
      const c = await startChecklist(g.ctx, { userId: result.userId, kind: 'onboarding', startOn: start });
      if (c.ok) checklistId = c.id;
    }
    await auditHr(g.ctx, req, 'CREATE', 'hrEmployee', result.userId, { invited: result.invited, onboarding: Boolean(checklistId) });
    return NextResponse.json({ success: true, userId: result.userId, invited: result.invited, checklistId }, { status: 201 });
  } catch (err) {
    return hrServerError('people create', err);
  }
}
