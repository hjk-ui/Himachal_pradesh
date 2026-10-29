import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { clientAccessWhere } from '@/lib/clients/orgScope';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { PROGRAM_META } from '@/lib/clinical/serviceEligibility/criteria';
import { GAP_LABELS, PROGRAMS, type EligibilityStatus, type ProgramKey } from '@/lib/clinical/serviceEligibility/types';
import { loadScannerRows } from '@/lib/clinical/serviceEligibility/snapshot';
import { decorateRows, SERVICE_SCANNER_PATH } from '@/lib/clinical/serviceEligibility/server';
import { activeDecision, csvCell, DEFAULT_FILTERS, DISMISS_REASON_LABELS, listRows, TIERS, type Tier, type Workflow } from '@/lib/clinical/serviceEligibility/view';
import type { PayerClass } from '@/lib/clinical/serviceEligibility/payerFit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Program leads and leadership export; caseload roles keep the on-screen worklist. */
const EXPORT_ROLES = new Set(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'PSYCHIATRIST', 'NP', 'PRP_SPECIALIST', 'CASE_MANAGER', 'OFFICE_MANAGER']);

/**
 * GET /api/ehr/scanner/service-eligibility/export?program=prp[&status=candidate&workflow=open...]
 * CSV for program leads: one row per client for the program — the same rows the page lists for
 * those filters (lib/clinical/serviceEligibility/view.ts). Columns: MRN, name, age, clinician,
 * location, payer, status, priority + reasons, data gaps, decision, payer fit, fee estimate.
 * Scope + Part 2 lock as the page; audited as EXPORT with counts only.
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return new Response(JSON.stringify({ success: false, error: gate.error }), { status: gate.status });
  if (!canAccessPath(gate.role, SERVICE_SCANNER_PATH, gate.capabilities) || !EXPORT_ROLES.has(String(gate.role).toUpperCase())) {
    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'serviceEligibilityScan', outcome: 'DENIED', metadata: { reason: 'role' } });
    return new Response(JSON.stringify({ success: false, error: 'Your role cannot export the scanner list' }), { status: 403 });
  }
  const sp = new URL(req.url).searchParams;
  const program = sp.get('program') as ProgramKey | null;
  if (!program || !(PROGRAMS as readonly string[]).includes(program)) {
    return new Response(JSON.stringify({ success: false, error: 'Choose a program to export' }), { status: 400 });
  }
  const filters = {
    ...DEFAULT_FILTERS,
    program,
    status: (sp.get('status') as EligibilityStatus | 'all' | null) ?? 'all',
    workflow: (sp.get('workflow') as Workflow | null) ?? 'open',
    tier: (TIERS as readonly string[]).includes(sp.get('tier') ?? '') ? (sp.get('tier') as Tier) : ('actionable' as const),
    clinician: sp.get('clinician') ?? 'all',
    location: sp.get('location') ?? 'all',
    payer: (sp.get('payer') as PayerClass | 'all' | null) ?? 'all',
    caseload: sp.get('caseload') === 'mine' ? ('mine' as const) : ('all' as const),
    viewerId: gate.userId,
  };
  try {
    const read = await loadScannerRows({
      organizationId: gate.organizationId,
      clientWhere: clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role }),
      lockedIds: (clientIds) => lockedSensitiveClientIds({ organizationId: gate.organizationId, userId: gate.userId, role: gate.role, clientIds }),
    });
    const now = new Date();
    const rows = listRows(await decorateRows(gate.organizationId, read.rows), filters, now);
    const header = ['MRN', 'Client', 'Age', 'Clinician', 'Location', 'Payer', `${PROGRAM_META[program].label} status`, 'Priority', 'Priority reasons', 'Missing data to confirm', 'Decision', 'Payer fit (typical)', 'Prior auth usually', 'Fee estimate (USD, estimate)', 'Estimate basis', 'Scanned'];
    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const d = activeDecision(r, program, now);
      const fit = r.payerFit?.[program];
      const rev = r.revenue?.[program];
      lines.push(
        [
          r.mrn ?? '', r.name, r.age ?? '', r.clinician?.name ?? 'Unassigned', r.location?.name ?? '', r.payer ?? '',
          r.statuses[program].replace('_', ' '), r.priority.level, r.priority.reasons.join('; '),
          (r.gaps[program] ?? []).map((g) => GAP_LABELS[g]).join('; '),
          d ? `${d.action}${d.reason ? ` (${DISMISS_REASON_LABELS[d.reason]})` : ''}${d.snoozeUntil ? ` until ${d.snoozeUntil.slice(0, 10)}` : ''}${d.outcome ? ` — ${d.outcome}` : ''}` : '',
          fit?.coverage ?? '', fit?.priorAuth === null || fit?.priorAuth === undefined ? '' : fit.priorAuth ? 'yes' : 'no',
          rev?.estimateCents != null ? (rev.estimateCents / 100).toFixed(2) : rev?.feeCents != null ? `${(rev.feeCents / 100).toFixed(2)} per unit` : '',
          rev?.basis ?? '', r.scannedAt.slice(0, 10),
        ].map(csvCell).join(',')
      );
    }
    await auditPhiAccess({
      gate, req, action: 'EXPORT', resourceType: 'serviceEligibilityScan', resourceId: program,
      metadata: { program, rows: rows.length, status: filters.status, workflow: filters.workflow, tier: filters.tier, sensitiveHidden: read.sensitiveHidden, clientIds: rows.slice(0, 50).map((r) => r.id) },
    });
    return new Response(`${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="service-eligibility-${program}-${now.toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[scanner/service-eligibility export] failed', err instanceof Error ? err.name : 'unknown');
    return new Response(JSON.stringify({ success: false, error: 'Export failed' }), { status: 500 });
  }
}
