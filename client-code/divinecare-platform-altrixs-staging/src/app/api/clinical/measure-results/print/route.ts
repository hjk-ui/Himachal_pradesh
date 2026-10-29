import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { loadPracticeIdentity } from '@/lib/practice/identity';
import { measureGate } from '@/lib/measures/http';
import { instrumentById } from '@/lib/measures/instruments';
import { buildMeasurePrint } from '@/lib/measures/printView';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/clinical/measure-results/print?clientId=&instrumentId= — the printable results summary
 * (Print on a measure in the chart): minimum PHI header, every score with severity and how it was
 * given, change from baseline, the latest item responses and the guide entry. Same access as the
 * chart Measures card (assessment / MBC roles, caseload, Part 2 / VIP lock). Audited MEASURE_PRINT.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId');
  const instrumentId = params.get('instrumentId');
  if (!clientId || !instrumentId || !instrumentById(instrumentId)) {
    return NextResponse.json({ success: false, error: 'clientId and a known instrumentId are required' }, { status: 400 });
  }
  const g = await measureGate(clientId);
  if (g.ok === false) return g.response;
  const scope = g.scope;
  const client = await prisma.client.findFirst({
    where: { AND: [{ id: clientId, organizationId: scope.organizationId }, scope.clientWhere] },
    select: { id: true, name: true, dateOfBirth: true, mrn: true },
  });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  const rows = await prisma.clinicalAssessmentRecord.findMany({
    where: { organizationId: scope.organizationId, clientId, instrumentId },
    select: { id: true, createdAt: true, totalScore: true, severity: true, source: true, administrationType: true, notes: true, safetyFlagged: true },
    orderBy: { createdAt: 'asc' },
    take: 200,
  });
  const latest = rows[rows.length - 1];
  const [items, identity, me] = await Promise.all([
    latest
      ? prisma.assessmentItemAnswer.findMany({ where: { assessmentId: latest.id }, select: { itemId: true, questionText: true, selectedText: true, scoreValue: true, flagged: true } })
      : Promise.resolve([]),
    loadPracticeIdentity(scope.organizationId).catch(() => null),
    prisma.user.findUnique({ where: { id: scope.userId }, select: { name: true } }),
  ]);
  const printable = buildMeasurePrint({
    instrumentId,
    client: { name: client.name, dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null, mrn: client.mrn },
    practiceName: identity?.name ?? null,
    printedBy: me?.name ?? null,
    printedAt: new Date(),
    points: rows.map((r) => ({
      id: r.id,
      date: r.createdAt.toISOString(),
      score: r.totalScore,
      severity: r.severity,
      source: r.source,
      administrationType: r.administrationType,
      notes: r.notes,
      safetyFlagged: r.safetyFlagged,
    })),
    latestItems: items.sort((a, b) => Number(a.itemId.replace(/\D/g, '')) - Number(b.itemId.replace(/\D/g, ''))),
  });
  await auditPhiAccess({
    gate: scope,
    req,
    action: 'MEASURE_PRINT',
    resourceType: 'assessment',
    resourceId: latest?.id ?? null,
    patientId: client.id,
    metadata: { instrumentId, records: rows.length },
  });
  return NextResponse.json({ success: true, printable });
}
