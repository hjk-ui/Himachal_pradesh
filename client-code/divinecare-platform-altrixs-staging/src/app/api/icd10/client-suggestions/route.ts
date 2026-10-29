import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveChartAccess } from '@/lib/clients/chartAccess';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { loadDiagnosisList } from '@/lib/diagnoses/store';
import { currentInOrder } from '@/lib/diagnoses/model';
import { checkIcd10Code } from '@/lib/icd10/validate';

export const runtime = 'nodejs';

/**
 * GET /api/icd10/client-suggestions?clientId= — the client's active diagnoses, offered first by
 * the diagnosis picker: the current diagnosis list in rank order (only for roles that may see BH
 * diagnoses; resolved / ruled-out / entered-in-error rows are not offered) and active /
 * chronic problem-list codes. Same chart gate as the client chart (org, caseload / care team,
 * Part 2); audited as a PHI read. Each code carries its FY2027 status so stale codes are flagged.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  const clientId = new URL(req.url).searchParams.get('clientId')?.trim();
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  try {
    const access = await resolveChartAccess({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role }, clientId, '/api/icd10/client-suggestions');
    if (access.ok === false) {
      await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientDiagnoses', patientId: clientId, outcome: 'DENIED', metadata: { reason: access.reason } });
      return NextResponse.json({ success: false, error: access.reason === 'client_not_found' ? 'Client not found' : 'Not allowed to open this chart' }, { status: access.status });
    }
    const client = access.client;
    const problems = await prisma.medicalProblem.findMany({
      where: { clientId: client.id, status: { in: ['active', 'Active', 'ACTIVE', 'chronic', 'Chronic'] } },
      select: { icd10Code: true, name: true },
      take: 50,
    });
    const dx = new Map<string, { code: string; description: string; source: string }>();
    if (canSeeBhDiagnoses(gate.role)) {
      const list = await loadDiagnosisList(gate.organizationId, client.id);
      for (const r of currentInOrder(list.rows)) {
        if (!r.code) continue;
        const label = r.isPrimary ? 'Chart primary' : r.status === 'PROVISIONAL' ? 'Chart (provisional)' : 'Chart diagnosis';
        dx.set(r.code.toUpperCase(), { code: r.code, description: r.dsmName || r.description, source: label });
      }
    }
    for (const p of problems) {
      const code = p.icd10Code?.trim().toUpperCase();
      if (code && !dx.has(code)) dx.set(code, { code, description: p.name, source: 'Problem list' });
    }
    const suggestions = [...dx.values()].map((d) => {
      const c = checkIcd10Code(d.code);
      return { ...d, code: c.status === 'malformed' ? d.code : c.code, description: d.description || c.description || '', billable: c.billable, status: c.status, message: c.message };
    });
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'clientDiagnoses', resourceId: client.id, patientId: client.id, metadata: { diagnoses: suggestions.length } });
    return NextResponse.json({ success: true, suggestions }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('[icd10/client-suggestions]', err);
    return NextResponse.json({ success: false, error: 'Could not load the client diagnoses' }, { status: 500 });
  }
}
