import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { canSeeBhDiagnoses } from '@/lib/clients/chartSectionAccess';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveSensitiveAccessMap } from '@/lib/privacy/sensitiveAccess';
import { chartDiagnoses, summarizeDiagnoses, type ChartDiagnosis } from '@/lib/clients/diagnosisOverviewCore';
import { loadDiagnosisListsFor } from '@/lib/diagnoses/store';
import { currentInOrder } from '@/lib/diagnoses/model';
import { checkIcd10Code } from '@/lib/icd10/validate';

/** Coding problem shown on the overview (so coders / clinicians can fix the list before claims) */
function codingFlag(code: string | null): string | null {
  if (!code) return 'Not coded';
  const c = checkIcd10Code(code);
  if (c.status === 'malformed' || c.status === 'unknown' || c.status === 'deleted') return 'Not in FY2027 code set';
  if (!c.billable) return 'Not billable (header code)';
  if (/^F/i.test(c.code) && c.description && /unspecified/i.test(c.description)) return 'Unspecified';
  return null;
}

export const runtime = 'nodejs';

/**
 * GET /api/ehr/diagnoses/overview — read-only chart diagnoses from the client record, with
 * counts computed over every client the caller may see (not the 250-row roster page).
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  if (!canAccessPath(gate.role, '/dashboard/ehr/diagnoses') || !canSeeBhDiagnoses(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const rows = await prisma.client.findMany({
      where: {
        AND: [
          clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
          { status: 'ACTIVE' },
        ],
      },
      select: {
        id: true,
        name: true,
        primaryDiagnosisCode: true,
        primaryDiagnosis: true,
        secondaryDiagnoses: true,
        assignedTo: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const summary = summarizeDiagnoses(rows);
    const withDx = rows.filter((r) => chartDiagnoses(r).length > 0);

    let sensitive = new Map<string, { alias: string | null; canAccessSensitive: boolean }>();
    try {
      sensitive = await resolveSensitiveAccessMap({
        organizationId: gate.organizationId,
        userId: gate.userId,
        role: gate.role,
        clientIds: withDx.map((r) => r.id),
      });
    } catch {
      sensitive = new Map(withDx.map((r) => [r.id, { alias: null, canAccessSensitive: false }]));
    }

    // Saved diagnosis lists (rank, status, full descriptions); the client record otherwise
    const lists = await loadDiagnosisListsFor(
      gate.organizationId,
      withDx.filter((r) => !(sensitive.get(r.id) && !sensitive.get(r.id)!.canAccessSensitive)).map((r) => r.id)
    );
    const clients = withDx.map((r) => {
      const s = sensitive.get(r.id);
      const locked = Boolean(s && !s.canAccessSensitive);
      const list = lists.get(r.id);
      const dx: ChartDiagnosis[] = list
        ? currentInOrder(list).map((d) => ({ code: d.code, label: d.dsmName || d.description || d.code || '', rank: d.isPrimary ? 'primary' : 'secondary', status: d.status }))
        : chartDiagnoses(r);
      return {
        clientId: r.id,
        name: locked ? s?.alias || 'Protected Client' : r.name,
        clinician: locked ? null : r.assignedTo?.name ?? null,
        // Part 2 / sensitive charts: no diagnoses without access
        diagnoses: locked ? [] : dx.map((d) => ({ ...d, flag: codingFlag(d.code) })),
        locked,
      };
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'chartDiagnoses',
      metadata: { clients: clients.length },
    });
    return NextResponse.json(
      { success: true, summary, clients, activeClients: rows.length },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[ehr/diagnoses/overview]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load chart diagnoses' }, { status: 500 });
  }
}
