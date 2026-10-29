import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { submitPriorAuth, checkPriorAuthStatus, clearinghouseMode } from '@/lib/integrations/clearinghouse';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { validateIcd10Codes } from '@/lib/icd10/validate';

const schema = z.object({
  requestId: z.string().uuid(), patientId: z.string().min(1),
  memberId: z.string().trim().min(1).max(100), payerId: z.string().trim().min(1).max(100),
  payerName: z.string().trim().min(1).max(200), vendor: z.enum(['Carelon', 'Availity']),
  cptCodes: z.array(z.string().regex(/^\d{5}$/)).min(1).max(20),
  diagnosisCodes: z.array(z.string().regex(/^[A-Z][0-9A-Z]{2}(\.[0-9A-Z]{1,4})?$/)).min(1).max(12)
    .superRefine((codes, ctx) => { for (const e of validateIcd10Codes(codes, { requireBillable: true }).errors) ctx.addIssue({ code: 'custom', message: e }); }),
  requestedUnits: z.number().int().positive().max(10000),
  startDate: z.iso.date(), endDate: z.iso.date(), clinicalRationale: z.string().trim().min(1).max(20000),
}).refine(v => v.endDate >= v.startDate, 'End date must follow start date');
const include = { client: { select: { name: true, insuranceMemberId: true } } } as const;
type Row = Prisma.PriorAuthGetPayload<{ include: typeof include }>;
function serialize(row: Row) {
  return { id: row.id, patientId: row.clientId, patientName: row.client.name,
    memberId: row.client.insuranceMemberId, payerName: row.payer, vendor: row.vendor,
    referenceNumber: row.authNumber, cptCodes: row.cptCodes, diagnosisCodes: row.diagnosisCodes,
    requestedUnits: row.requestedUnits, approvedUnits: row.unitsApproved,
    // Valant imports keep the native status (externalStatus only marks the import)
    status: row.vendor === 'valant' ? row.status : row.externalStatus ?? row.status, startDate: row.startDate, endDate: row.endDate,
    message: row.notes, submittedAt: row.createdAt, demoMode: row.demoMode };
}
const mode = () => ({ Carelon: clearinghouseMode('Carelon'), Availity: clearinghouseMode('Availity') });
const nativeStatus = (status: string) => status === 'APPROVED' ? 'APPROVED' as const : status === 'DENIED' ? 'DENIED' as const : 'SUBMITTED' as const;

export async function GET(request: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/prior-auth');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const rows = await prisma.priorAuth.findMany({ where: { organizationId: gate.organizationId, client: gate.clientWhere, vendor: { not: null } }, include, orderBy: { createdAt: 'desc' } });
    await auditPhiAccess({ gate, req: request, action: 'LIST', resourceType: 'priorAuth', metadata: { count: rows.length } });
    return NextResponse.json({ success: true, data: rows.map(serialize), mode: mode() });
  } catch { return NextResponse.json({ error: 'Could not load authorizations' }, { status: 500 }); }
}

export async function POST(request: Request) {
  const gate = await requireClinicalContext('/dashboard/billing/prior-auth');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const scope = { organizationId: gate.organizationId, client: gate.clientWhere };
  try {
    if (body && typeof body === 'object' && 'action' in body && body.action === 'batch_check') {
      const pending = await prisma.priorAuth.findMany({ where: { ...scope, status: 'SUBMITTED', authNumber: { not: null }, vendor: { in: ['Carelon', 'Availity'] } }, take: 50 });
      const errors: string[] = [];
      for (const row of pending) {
        try {
          const result = await checkPriorAuthStatus(row.authNumber!, row.vendor as 'Carelon' | 'Availity', row.demoMode);
          await prisma.priorAuth.update({ where: { id: row.id }, data: { externalStatus: result.status, status: row.demoMode ? 'DRAFT' : nativeStatus(result.status), unitsApproved: result.approvedUnits } });
        } catch { errors.push(`Status could not be checked for authorization ${row.id}`); }
      }
      const rows = await prisma.priorAuth.findMany({ where: { ...scope, vendor: { not: null } }, include, orderBy: { createdAt: 'desc' } });
      await auditPhiAccess({
        gate, req: request, action: 'WRITE', resourceType: 'priorAuth',
        metadata: {
          operation: 'batch_status_check',
          checked: pending.length,
          errorCount: errors.length,
          listed: rows.length,
          priorAuthIds: pending.map((r) => r.id).slice(0, 50),
          clientIds: [...new Set(pending.map((r) => r.clientId))].slice(0, 50),
          fields: ['externalStatus', 'status', 'unitsApproved'],
        },
      });
      return NextResponse.json({ success: true, data: rows.map(serialize), errors, mode: mode() });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Complete all required authorization fields with valid values' }, { status: 400 });
    const input = parsed.data;
    const client = await prisma.client.findFirst({ where: { id: input.patientId, AND: [gate.clientWhere] } });
    if (!client) {
      await auditPhiAccess({
        gate, req: request, action: 'SUBMIT', resourceType: 'priorAuth', patientId: input.patientId,
        outcome: 'DENIED', metadata: { vendor: input.vendor, reason: 'patient_not_found' },
      });
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }
    const existing = await prisma.priorAuth.findFirst({ where: { ...scope, submissionKey: input.requestId }, include });
    if (existing) {
      await auditPhiAccess({
        gate, req: request, action: 'READ', resourceType: 'priorAuth', resourceId: existing.id,
        patientId: existing.clientId, metadata: { reason: 'duplicate_request' },
      });
      return NextResponse.json({ success: true, data: serialize(existing) });
    }
    if (!client.dateOfBirth) return NextResponse.json({ error: 'Patient date of birth is required' }, { status: 400 });
    const currentMode = clearinghouseMode(input.vendor);
    if (currentMode === 'unconfigured') return NextResponse.json({ error: 'Clearinghouse is not configured' }, { status: 503 });
    // Reserve the unique request before contacting the payer to prevent duplicate submissions.
    const row = await prisma.priorAuth.create({ data: {
      organizationId: gate.organizationId, clientId: client.id, createdById: gate.userId,
      payer: input.payerName, payerId: input.payerId, vendor: input.vendor, submissionKey: input.requestId,
      cptCodes: input.cptCodes, diagnosisCodes: input.diagnosisCodes, requestedUnits: input.requestedUnits,
      unitsApproved: 0, startDate: new Date(input.startDate), endDate: new Date(input.endDate),
      status: 'DRAFT', externalStatus: 'SUBMITTING', demoMode: currentMode === 'demo', notes: input.clinicalRationale,
    } });
    try {
      const result = await submitPriorAuth({ ...input, patientName: client.name, dob: client.dateOfBirth.toISOString().slice(0, 10) });
      const updated = await prisma.priorAuth.update({ where: { id: row.id }, data: {
        authNumber: result.referenceNumber, externalStatus: result.status,
        status: result.demoMode ? 'DRAFT' : nativeStatus(result.status), unitsApproved: result.approvedUnits ?? 0,
        demoMode: result.demoMode, notes: result.message,
      }, include });
      await auditPhiAccess({
        gate, req: request, action: 'SUBMIT', resourceType: 'priorAuth', resourceId: updated.id,
        patientId: client.id,
        metadata: { vendor: input.vendor, payerId: input.payerId, demoMode: result.demoMode, cptCount: input.cptCodes.length },
      });
      return NextResponse.json({ success: true, data: serialize(updated) }, { status: 201 });
    } catch {
      await auditPhiAccess({
        gate, req: request, action: 'SUBMIT', resourceType: 'priorAuth', resourceId: row.id,
        patientId: client.id, outcome: 'FAILURE', metadata: { vendor: input.vendor, payerId: input.payerId },
      });
      await prisma.priorAuth.update({ where: { id: row.id }, data: { externalStatus: 'SUBMISSION_UNKNOWN', notes: 'Submission could not be confirmed. Reconcile with the clearinghouse portal before creating another request.' } });
      return NextResponse.json({ error: 'Submission could not be confirmed. Check the clearinghouse portal before resubmitting.' }, { status: 502 });
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return NextResponse.json({ error: 'This request is already being processed. Refresh authorization history.' }, { status: 409 });
    return NextResponse.json({ error: 'Could not process authorization' }, { status: 500 });
  }
}
