import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { requireValantBalancesGate } from '@/lib/billing/valantGate';
import { getAgingLabels, REFERENCE_ONLY_NOTE } from '@/lib/billing/valantBalances';
import { AGING_LABELS_INFERRED_NOTE, DEFAULT_AGING_LABELS, normalizeAgingLabels } from '@/lib/migration/valantAging';
import { isoDate } from '@/lib/migration/valantReportCommon';

export const runtime = 'nodejs';

/** GET /api/billing/valant-balances — bucket labels and the imports available (no patient data) */
export async function GET(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const [labels, imports] = await Promise.all([
      getAgingLabels(gate.organizationId),
      prisma.valantReferenceImport.findMany({
        where: { organizationId: gate.organizationId },
        orderBy: { importedAt: 'desc' },
        take: 100,
      }),
    ]);
    const asOfDates = (type: string) =>
      [...new Set(imports.filter((i) => i.reportType === type && i.asOf).map((i) => isoDate(i.asOf) as string))].sort().reverse();
    const latest = (type: string) => {
      const i = imports.find((x) => x.reportType === type);
      return i
        ? {
            importedAt: i.importedAt.toISOString(), asOf: isoDate(i.asOf), periodStart: isoDate(i.periodStart),
            periodEnd: isoDate(i.periodEnd), rowCount: i.rowCount, matched: i.matched, unmatched: i.unmatched, reconciles: i.reconciles,
          }
        : null;
    };
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: 'valantBalances', metadata: { view: 'summary', imports: imports.length } });
    return NextResponse.json({
      success: true,
      note: REFERENCE_ONLY_NOTE,
      labels: labels.labels,
      labelsConfirmed: labels.confirmed,
      labelsConfirmedAt: labels.confirmedAt,
      displayAllOver120: labels.displayAllOver120,
      defaultLabels: DEFAULT_AGING_LABELS,
      labelsInferredNote: AGING_LABELS_INFERRED_NOTE,
      reports: {
        patient_aging: { latest: latest('patient_aging'), asOfDates: asOfDates('patient_aging') },
        insurance_aging: { latest: latest('insurance_aging'), asOfDates: asOfDates('insurance_aging') },
        combined_aging: { latest: latest('combined_aging'), asOfDates: asOfDates('combined_aging') },
        prepayments: { latest: latest('prepayments') },
        copays: { latest: latest('copays') },
      },
    });
  } catch (err) {
    console.error('[valant-balances GET]', err);
    return NextResponse.json({ success: false, error: 'Could not load Valant balances' }, { status: 500 });
  }
}

const labelsSchema = z.object({
  labels: z.array(z.string().trim().min(1).max(40)).length(5),
  confirmed: z.boolean(),
});

/** PUT /api/billing/valant-balances — edit the five bucket headings / mark them confirmed */
export async function PUT(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = labelsSchema.parse(await req.json());
    const labels = normalizeAgingLabels(body.labels);
    const now = new Date();
    const saved = await prisma.valantAgingSettings.upsert({
      where: { organizationId: gate.organizationId },
      create: {
        organizationId: gate.organizationId, labels, confirmed: body.confirmed, updatedById: gate.userId,
        confirmedById: body.confirmed ? gate.userId : null, confirmedAt: body.confirmed ? now : null,
      },
      update: {
        labels, confirmed: body.confirmed, updatedById: gate.userId,
        confirmedById: body.confirmed ? gate.userId : null, confirmedAt: body.confirmed ? now : null,
      },
    });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'valantAgingSettings', resourceId: gate.organizationId,
      metadata: { confirmed: body.confirmed },
    });
    return NextResponse.json({ success: true, labels, labelsConfirmed: saved.confirmed, labelsConfirmedAt: saved.confirmedAt?.toISOString() ?? null });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'Five non-empty labels are required' }, { status: 400 });
    console.error('[valant-balances PUT]', err);
    return NextResponse.json({ success: false, error: 'Could not save the bucket labels' }, { status: 500 });
  }
}

const over120Schema = z.object({ displayAllOver120: z.boolean() });

/**
 * PATCH /api/billing/valant-balances — turn "show all Valant aging as Over 120" on or off (display only;
 * stored Valant buckets are never changed). Billing A/R roles + leadership, audited.
 */
export async function PATCH(req: Request) {
  const g = await requireValantBalancesGate();
  if (g.denied) return g.denied;
  const { gate } = g;
  try {
    const body = over120Schema.parse(await req.json());
    const before = await getAgingLabels(gate.organizationId);
    const saved = await prisma.valantAgingSettings.upsert({
      where: { organizationId: gate.organizationId },
      create: {
        organizationId: gate.organizationId, labels: before.labels, confirmed: before.confirmed,
        displayAllOver120: body.displayAllOver120, updatedById: gate.userId,
      },
      update: { displayAllOver120: body.displayAllOver120, updatedById: gate.userId },
    });
    await auditPhiAccess({
      gate, req, action: 'UPDATE', resourceType: 'valantAgingSettings', resourceId: gate.organizationId,
      metadata: { setting: 'displayAllOver120', from: before.displayAllOver120, to: saved.displayAllOver120 },
    });
    return NextResponse.json({ success: true, displayAllOver120: saved.displayAllOver120 });
  } catch (err) {
    if (err instanceof z.ZodError) return NextResponse.json({ success: false, error: 'displayAllOver120 must be true or false' }, { status: 400 });
    console.error('[valant-balances PATCH]', err);
    return NextResponse.json({ success: false, error: 'Could not save the setting' }, { status: 500 });
  }
}
