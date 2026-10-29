import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { gateDiagnosisRoute } from '@/lib/diagnoses/routeGate';
import { isCurrent, isPart2SudCode, REVIEW_CONTEXTS, displayCode } from '@/lib/diagnoses/model';
import { checkChartDiagnosisCode } from '@/lib/diagnoses/rules';
import {
  addDiagnosis,
  listSuggestions,
  loadDiagnosisList,
  loadReviewState,
  previewDiagnosis,
  recordDiagnosisReview,
  reorderDiagnoses,
} from '@/lib/diagnoses/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullish();
const context = z.enum(REVIEW_CONTEXTS).optional();

const bodySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('preview'), code: z.string().trim().min(1).max(12), makePrimary: z.boolean().optional() }),
  z.object({
    action: z.literal('add'),
    code: z.string().trim().min(1).max(12),
    description: z.string().trim().max(500).nullish(),
    dsmName: z.string().trim().max(300).nullish(),
    status: z.enum(['ACTIVE', 'PROVISIONAL']).optional(),
    onsetDate: day,
    makePrimary: z.boolean().optional(),
    comment: z.string().trim().max(1000).nullish(),
    context,
    /** Rcopia problem id when adding from the DrFirst problem list */
    drfirstProblemId: z.string().max(100).nullish(),
  }),
  z.object({ action: z.literal('reorder'), order: z.array(z.string().min(1).max(64)).min(1).max(50), context }),
  z.object({ action: z.literal('review'), comment: z.string().trim().max(1000).nullish(), changed: z.boolean().optional(), context }),
]);

/**
 * GET /api/clients/[id]/diagnoses — the client's diagnosis list (current by rank, then resolved /
 * ruled out / entered in error), review state ("last reviewed by X on date"), pending AI
 * suggestions and DrFirst problem-list codes not on the list (suggestions only: a clinician adds
 * them). Chart gate incl. Part 2; HR / Front Desk / primary care roles are refused.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateDiagnosisRoute(req, id, { write: false });
  if (g.ok === false) return g.response;
  const { gate, clientId } = g.ctx;
  try {
    const [list, review, suggestions, drfirstProblems, sensitive] = await Promise.all([
      loadDiagnosisList(gate.organizationId, clientId),
      loadReviewState(gate.organizationId, clientId),
      listSuggestions(gate.organizationId, clientId),
      prisma.medicalProblem
        .findMany({
          where: { clientId, source: 'drfirst', NOT: { status: { in: ['Resolved', 'Inactive', 'resolved', 'inactive'] } } },
          select: { id: true, icd10Code: true, name: true, rcopiaProblemId: true },
          take: 50,
        })
        .catch(() => []),
      prisma.sensitiveRecord.findFirst({ where: { organizationId: gate.organizationId, clientId }, select: { id: true } }).catch(() => null),
    ]);
    const onList = new Set(list.rows.filter(isCurrent).map((r) => displayCode(r.code || '')));
    const drfirst = drfirstProblems
      .filter((p) => p.icd10Code && /^F/i.test(p.icd10Code.trim()) && !onList.has(displayCode(p.icd10Code)))
      .map((p) => ({ id: p.id, code: displayCode(p.icd10Code!), description: p.name, rcopiaProblemId: p.rcopiaProblemId }));
    const pending = suggestions.filter((s) => !onList.has(displayCode(s.code)));
    const rows = list.rows.map((r) => ({
      ...r,
      issues: r.code && isCurrent(r) ? checkChartDiagnosisCode(r.code, { asPrimary: r.isPrimary, sex: g.ctx.sex }).issues : [],
    }));
    const hasSud = list.rows.some((r) => isCurrent(r) && isPart2SudCode(r.code));
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'clientDiagnoses',
      resourceId: clientId,
      patientId: clientId,
      metadata: { diagnoses: rows.length, structured: list.structured },
    });
    return NextResponse.json(
      {
        success: true,
        rows,
        structured: list.structured,
        migrated: list.migrated,
        review,
        canEdit: g.ctx.canEdit,
        suggestions: pending,
        drfirst,
        // SUD diagnosis on a chart that is not marked protected: remind to protect it if the client is in the Part 2 program
        part2Reminder: hasSud && !sensitive,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (err) {
    console.error('[clients/[id]/diagnoses GET]', err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not load the diagnosis list' }, { status: 500 });
  }
}

/**
 * POST /api/clients/[id]/diagnoses — { action: 'preview' } validates a code (no write);
 * 'add' adds a diagnosis (FY2027 ICD-10-CM; invalid / deleted codes refused, header and
 * unspecified codes warned); 'reorder' sets the rank order (first = primary); 'review' records
 * "Reviewed — no change". Every write keeps history and is audited.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || 'Invalid request' }, { status: 400 });
  const body = parsed.data;
  const g = await gateDiagnosisRoute(req, id, { write: body.action !== 'preview' });
  if (g.ok === false) return g.response;
  const { gate, actor, clientId } = g.ctx;
  try {
    if (body.action === 'preview') {
      return NextResponse.json({ success: true, ...previewDiagnosis({ code: body.code, makePrimary: body.makePrimary, sex: g.ctx.sex }) });
    }
    if (body.action === 'add') {
      const res = await addDiagnosis(actor, clientId, {
        code: body.code,
        description: body.description,
        dsmName: body.dsmName,
        status: body.status,
        onsetDate: body.onsetDate,
        makePrimary: body.makePrimary,
        comment: body.comment,
        context: body.drfirstProblemId ? 'drfirst' : body.context,
        source: body.drfirstProblemId ? 'DRFIRST' : body.context === 'intake' ? 'INTAKE' : 'CLINICIAN',
        sourceRef: body.drfirstProblemId ?? null,
        sex: g.ctx.sex,
      });
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'clientDiagnosis', resourceId: res.ok ? res.row.id : clientId, patientId: clientId,
        outcome: res.ok ? 'SUCCESS' : 'FAILURE',
        metadata: { code: res.ok ? res.row.code : body.code, primary: res.ok ? res.row.isPrimary : undefined, status: body.status ?? 'ACTIVE', context: body.context ?? 'manual', error: res.ok ? undefined : res.status },
      });
      if (res.ok === false) return NextResponse.json({ success: false, error: res.error, issues: res.issues }, { status: res.status });
      return NextResponse.json({ success: true, row: res.row, issues: res.issues });
    }
    if (body.action === 'reorder') {
      const res = await reorderDiagnoses(actor, clientId, body.order, body.context);
      await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'clientDiagnosis', resourceId: clientId, patientId: clientId, outcome: res.ok ? 'SUCCESS' : 'FAILURE', metadata: { change: 'rank', count: body.order.length } });
      if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
      return NextResponse.json({ success: true, rows: res.rows });
    }
    const res = await recordDiagnosisReview(actor, clientId, { context: body.context, comment: body.comment, changed: body.changed });
    await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: 'clientDiagnosisReview', resourceId: clientId, patientId: clientId, outcome: res.ok ? 'SUCCESS' : 'FAILURE', metadata: { context: body.context ?? 'manual', changed: Boolean(body.changed) } });
    if (res.ok === false) return NextResponse.json({ success: false, error: res.error }, { status: res.status });
    return NextResponse.json({ success: true, reviewedAt: res.reviewedAt, review: await loadReviewState(gate.organizationId, clientId) });
  } catch (err) {
    console.error('[clients/[id]/diagnoses POST]', body.action, err instanceof Error ? err.message : err);
    return NextResponse.json({ success: false, error: 'Could not save the diagnosis list' }, { status: 500 });
  }
}
