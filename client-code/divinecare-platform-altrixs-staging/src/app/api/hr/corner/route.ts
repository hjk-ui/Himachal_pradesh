import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import {
  canAccessHrCorner,
  createHrEmployee,
  createLeave,
  createRequisition,
  getHrCorner,
  resolveCompliance,
  runPayroll,
  scheduleInterview,
  sendLicenseReminder,
  updateDirectDeposit,
  updateLeaveStatus,
} from '@/lib/hr/corner';

export const runtime = 'nodejs';

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create-employee'),
    name: z.string().trim().min(1).max(120),
    email: z.string().trim().email(),
    jobTitle: z.string().trim().min(1).max(120),
    department: z.string().trim().min(1).max(40),
    employmentType: z.enum(['Full-Time', 'Part-Time', 'Contract']),
    managerName: z.string().trim().max(120).optional(),
    hireDate: z.string().trim().max(20).optional(),
  }),
  z.object({ action: z.literal('run-payroll'), id: z.string().min(1) }),
  z.object({
    action: z.literal('request-leave'),
    employee: z.string().trim().min(1).max(120),
    leaveType: z.enum(['Vacation', 'FMLA', 'Sick', 'Personal']),
    dates: z.string().trim().min(1).max(80),
    days: z.number().int().min(1).max(90),
    notes: z.string().trim().max(240).optional(),
  }),
  z.object({
    action: z.literal('leave-status'),
    id: z.string().min(1),
    status: z.enum(['Approved', 'Denied']),
  }),
  z.object({
    action: z.literal('post-position'),
    title: z.string().trim().min(1).max(160),
    department: z.string().trim().min(1).max(40),
    priority: z.enum(['high', 'medium', 'low']),
    type: z.enum(['Full-Time', 'Part-Time', 'Contract']),
    salary: z.string().trim().max(80).optional(),
  }),
  z.object({
    action: z.literal('schedule-interview'),
    requisitionId: z.string().min(1),
    applicantId: z.string().min(1).optional(),
  }),
  z.object({ action: z.literal('send-reminder'), id: z.string().min(1) }),
  z.object({ action: z.literal('resolve-compliance'), id: z.string().min(1) }),
  z.object({
    action: z.literal('direct-deposit'),
    bankName: z.string().trim().min(1).max(80).optional(),
    accountLast4: z.string().trim().min(4).max(4).optional(),
    routingLast4: z.string().trim().min(4).max(4).optional(),
    percentOnDd: z.number().int().min(0).max(100).optional(),
  }),
]);

async function gate() {
  const ctx = await requireOrgContext();
  if (!ctx.ok) return { ok: false as const, response: NextResponse.json({ success: false, error: ctx.error }, { status: ctx.status }) };
  if (!canAccessHrCorner(ctx.role) || !canAccessPath(ctx.role, '/dashboard/hr')) {
    return { ok: false as const, response: NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true as const, ctx };
}

export async function GET() {
  const g = await gate();
  if (!g.ok) return g.response;
  try {
    const data = await getHrCorner(g.ctx.organizationId);
    if ('schemaReady' in data && data.schemaReady === false) {
      return NextResponse.json({ success: false, error: data.error, schemaReady: false }, { status: 503 });
    }
    return NextResponse.json({ success: true, ...data });
  } catch (err) {
    console.error('[hr/corner GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load HR Corner' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const g = await gate();
  if (!g.ok) return g.response;
  try {
    const body = actionSchema.parse(await req.json());
    const orgId = g.ctx.organizationId;
    switch (body.action) {
      case 'create-employee': {
        // Invite flow: account is INVITED with no password; the employee sets it from the email link.
        const result = await createHrEmployee(orgId, body, g.ctx.userId);
        if ('error' in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, employee: result.employee, invited: true, emailMode: result.emailMode }, { status: 201 });
      }
      case 'run-payroll': {
        const result = await runPayroll(orgId, body.id);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, payroll: result.payroll });
      }
      case 'request-leave': {
        const leave = await createLeave(orgId, body);
        return NextResponse.json({ success: true, leave }, { status: 201 });
      }
      case 'leave-status': {
        const result = await updateLeaveStatus(orgId, body.id, body.status);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, leave: result.leave });
      }
      case 'post-position': {
        const requisition = await createRequisition(orgId, body);
        return NextResponse.json({ success: true, requisition }, { status: 201 });
      }
      case 'schedule-interview': {
        const result = await scheduleInterview(orgId, body.requisitionId, body.applicantId);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, requisition: result.requisition });
      }
      case 'send-reminder': {
        const result = await sendLicenseReminder(orgId, body.id);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, reminderAt: result.reminderAt });
      }
      case 'resolve-compliance': {
        const result = await resolveCompliance(orgId, body.id);
        if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status });
        return NextResponse.json({ success: true, item: result.item });
      }
      case 'direct-deposit': {
        const deposit = await updateDirectDeposit(orgId, body);
        return NextResponse.json({ success: true, deposit });
      }
    }
  } catch (err) {
    const message = err instanceof z.ZodError ? 'Invalid request' : (err as Error).message;
    return NextResponse.json({ success: false, error: message || 'Could not save' }, { status: 400 });
  }
}
