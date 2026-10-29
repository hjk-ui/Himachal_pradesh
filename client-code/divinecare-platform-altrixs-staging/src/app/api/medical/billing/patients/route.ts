import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { medicalProgramClientWhere } from '@/lib/medical/medicalProgram';
import { isCaseloadRole } from '@/types/roles';
import { canUseMedicalBillingPicker } from '@/lib/billing/billingAccess';
import { ageFromDob, documentedDob } from '../../_lib/demographics';

export const runtime = 'nodejs';

const MAX_ROWS = 500;

/**
 * Patient picker for the primary care charge form (/dashboard/medical/billing): id, MRN, name and
 * DOB only. Billing may open medical billing but not the primary care roster (/api/medical/patients
 * also carries problem lists, contacts and demographics), so the page showed "Forbidden". Bounded
 * and select-only, unlike the full roster.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // Billing core, plus Physician / Medical NP for their own charge form (their
  // list is care-team scoped by clientAccessWhere below)
  if (!canAccessPath(gate.role, '/dashboard/medical/billing') || !canUseMedicalBillingPicker(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'medicalPatient', outcome: 'DENIED', metadata: { reason: 'role_not_permitted', view: 'billing-picker' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  try {
    const accessWhere = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    const shadows = await prisma.medicalPatient.findMany({
      where: { organizationId: gate.organizationId },
      select: { id: true, mrn: true, name: true, dateOfBirth: true, dob: true, bhClientId: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
    });
    let visible = shadows;
    if (isCaseloadRole(gate.role)) {
      const linked = shadows.map((p) => p.bhClientId).filter((v): v is string => Boolean(v));
      const allowed = linked.length
        ? await prisma.client.findMany({ where: { AND: [accessWhere, { id: { in: linked } }] }, select: { id: true } })
        : [];
      const ok = new Set(allowed.map((c) => c.id));
      visible = shadows.filter((p) => p.bhClientId && ok.has(p.bhClientId));
    }
    const linkedIds = visible.map((p) => p.bhClientId).filter((v): v is string => Boolean(v));
    const linkedMrns = visible.map((p) => p.mrn);
    const programClients = await prisma.client.findMany({
      where: {
        AND: [
          accessWhere,
          medicalProgramClientWhere(),
          { id: { notIn: linkedIds } },
          { OR: [{ mrn: null }, { mrn: { notIn: linkedMrns } }] },
        ],
      },
      select: { id: true, mrn: true, name: true, dateOfBirth: true },
      orderBy: { updatedAt: 'desc' },
      take: MAX_ROWS,
    });

    const patients = [
      ...visible.map((p) => {
        const dob = documentedDob(p);
        return { id: p.id, clientId: p.bhClientId, mrn: p.mrn, name: p.name, dob, age: ageFromDob(dob) };
      }),
      ...programClients.map((c) => {
        const dob = documentedDob({ dateOfBirth: c.dateOfBirth });
        return { id: c.id, clientId: c.id, mrn: c.mrn ?? '', name: c.name, dob, age: ageFromDob(dob) };
      }),
    ];

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'medicalPatient',
      metadata: { view: 'billing-picker', count: patients.length, ids: patients.slice(0, 50).map((p) => p.id) },
    });
    return NextResponse.json({ success: true, patients }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[medical/billing/patients GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load patients' }, { status: 500 });
  }
}
