import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { loadCredentialBundle, loadEmployee, listChangeRequests, updateEmployee } from '@/lib/hr/people';
import { computeExpirations } from '@/lib/hr/expirations';
import { canSeeDocument, listHrDocuments } from '@/lib/hr/documents';
import { trainingMatrix } from '@/lib/hr/training';
import { balancesFor, ledgerFor, listTimeOff } from '@/lib/hr/timeOff';
import { listDiscipline, listGoals, listReviews } from '@/lib/hr/performance';
import { listChecklists } from '@/lib/hr/checklists';
import { auditHr, hrGate, hrJsonError, hrServerError, loadRoster, practiceTodayFor } from '@/lib/hr/server';

export const runtime = 'nodejs';

/**
 * GET /api/hr/people/[userId]: one employee record, filtered by the viewer's relationship
 * (HR / leadership all; Office Manager credentials + training; the employee their own record
 * without pay; their manager / clinical supervisor non-sensitive work data). Peers: 403.
 */
export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const g = await hrGate('staff');
  if (g.ok === false) return g.response;
  const { userId } = await ctx.params;
  try {
    const roster = await loadRoster(g.ctx.organizationId, { includeDeactivated: true });
    const view = await loadEmployee(g.ctx, userId, roster);
    if (!view) return hrJsonError('Employee not found', 404);
    if (view.relationship === 'peer') {
      await auditHr(g.ctx, req, 'READ', 'hrEmployee', userId, { relationship: 'peer' }, 'DENIED');
      return hrJsonError('Forbidden', 403);
    }
    const { access, relationship } = view;
    const orgId = g.ctx.organizationId;
    const isAdmin = relationship === 'hr' || relationship === 'leadership';
    const today = await practiceTodayFor(orgId);
    const [credentialBundle, expirations, documents, training, timeOff, reviews, goals, discipline, checklists, changeRequests] = await Promise.all([
      access.credentials ? loadCredentialBundle(orgId, userId) : null,
      access.credentials || access.training ? computeExpirations(orgId, { userId, roster }) : null,
      access.documents || relationship === 'office_manager' ? listHrDocuments(orgId, userId) : [],
      access.training ? trainingMatrix(orgId, { userIds: [userId], roster }) : null,
      access.timeOff
        ? Promise.all([listTimeOff(g.ctx, { userIds: [userId] }), balancesFor(orgId, [userId]), isAdmin || relationship === 'self' ? ledgerFor(orgId, userId) : []])
        : null,
      access.performance ? listReviews(g.ctx, { userIds: [userId] }) : [],
      access.performance ? listGoals(orgId, [userId]) : [],
      access.discipline ? listDiscipline(orgId, { userId }) : relationship === 'self' ? listDiscipline(orgId, { userId, employeeView: true }) : [],
      isAdmin || relationship === 'self' || relationship === 'manager'
        ? listChecklists(orgId, { userId, today })
        : [],
      isAdmin || relationship === 'self' ? listChangeRequests(orgId, { userId }) : [],
    ]);
    const visibleDocs = documents.filter((d) => canSeeDocument({ userId: g.ctx.userId, relationship, access }, d));
    // Account link: role and Altrixs account status (no credentials or tokens).
    const account = await prisma.user.findFirst({
      where: { id: userId, organizationId: orgId },
      select: { role: true, roles: true, status: true, rcopiaUsername: true, createdAt: true },
    });
    await auditHr(g.ctx, req, 'READ', 'hrEmployee', userId, {
      relationship,
      personal: access.personal,
      compensation: access.compensation,
      discipline: access.discipline,
    });
    return NextResponse.json({
      success: true,
      relationship,
      access,
      record: view.record,
      account: account
        ? { role: String(account.role), roles: account.roles.map(String), status: String(account.status), drfirstLinked: Boolean(account.rcopiaUsername), createdAt: account.createdAt.toISOString() }
        : null,
      credentials: credentialBundle,
      expirations: expirations?.items ?? [],
      documents: visibleDocs,
      training: training?.rows[0] ?? null,
      requirements: training?.requirements ?? [],
      timeOff: timeOff ? { requests: timeOff[0], balance: timeOff[1][userId] ?? { pto: 0, sick: 0 }, ledger: timeOff[2] } : null,
      reviews,
      goals,
      discipline,
      checklists,
      changeRequests,
      people: roster.filter((p) => p.hrStatus !== 'Terminated').map((p) => ({ userId: p.userId, name: p.name, role: p.role })),
    });
  } catch (err) {
    return hrServerError('employee read', err);
  }
}

const nullableStr = (max: number) => z.string().trim().max(max).nullable().optional();
const patchSchema = z
  .object({
    legalFirstName: nullableStr(80),
    legalMiddleName: nullableStr(80),
    legalLastName: nullableStr(80),
    preferredName: nullableStr(80),
    pronouns: nullableStr(40),
    dateOfBirth: nullableStr(10),
    personalEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')),
    personalPhone: nullableStr(30),
    workPhone: nullableStr(30),
    addressLine1: nullableStr(120),
    addressLine2: nullableStr(120),
    city: nullableStr(80),
    state: nullableStr(2),
    postalCode: nullableStr(10),
    emergencyContacts: z
      .array(z.object({ name: z.string().trim().min(1).max(120), relationship: z.string().trim().max(60).optional(), phone: z.string().trim().min(3).max(30), altPhone: z.string().trim().max(30).optional() }))
      .max(4)
      .optional(),
    jobTitle: z.string().trim().max(120).optional(),
    department: z.string().trim().max(60).optional(),
    programs: z.array(z.string().trim().max(40)).max(10).optional(),
    employmentType: z.enum(['Full-Time', 'Part-Time', 'Per Diem', 'Contract']).optional(),
    workerType: z.enum(['W2', '1099', 'PER_DIEM']).nullable().optional(),
    fte: z.number().min(0).max(1).nullable().optional(),
    employeeNumber: nullableStr(40),
    hrStatus: z.enum(['Active', 'On Leave', 'Onboarding', 'Offboarding', 'Terminated']).optional(),
    hireDate: nullableStr(10),
    terminationDate: nullableStr(10),
    separationType: z.enum(['voluntary', 'involuntary', 'retirement', 'end_of_contract', 'other']).nullable().optional(),
    rehireEligible: z.boolean().nullable().optional(),
    managerUserId: nullableStr(128),
    clinicalSupervisorUserId: nullableStr(128),
    payType: z.enum(['hourly', 'salary', 'per_visit']).nullable().optional(),
    payRateCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    compEffectiveOn: nullableStr(10),
    payrollSystem: nullableStr(60),
    payrollExternalId: nullableStr(60),
    caqhId: nullableStr(20),
    medicaidProviderId: nullableStr(30),
    deaNumber: nullableStr(12),
    npi: z.string().trim().regex(/^\d{10}$/).nullable().optional().or(z.literal('')),
  })
  .strict();

/** PATCH /api/hr/people/[userId]: HR / leadership edit (compensation fields: HR / leadership only). */
export async function PATCH(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  const { userId } = await ctx.params;
  let body: z.infer<typeof patchSchema>;
  try {
    body = patchSchema.parse(await req.json());
  } catch (err) {
    const first = err instanceof z.ZodError ? err.issues[0]?.path.join('.') : '';
    return hrJsonError(first ? `Check ${first}` : 'Invalid update', 400);
  }
  try {
    const view = await loadEmployee(g.ctx, userId);
    if (!view) return hrJsonError('Employee not found', 404);
    const clean = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === '' ? null : v]));
    const result = await updateEmployee(g.ctx, userId, clean, view.access);
    if (!result.ok) return hrJsonError(result.error, result.status);
    await auditHr(g.ctx, req, 'UPDATE', 'hrEmployee', userId, { fields: result.changed });
    return NextResponse.json({ success: true, changed: result.changed });
  } catch (err) {
    return hrServerError('employee update', err);
  }
}
