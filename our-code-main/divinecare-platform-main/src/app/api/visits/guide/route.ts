import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { buildVisitGuide, upsertChecklistItem } from '@/lib/visits/resolve-guide';
import { resolveVisitKind } from '@/lib/visits/kinds';
import { prisma } from '@/lib/db/prisma';
import { evaluateDigestAccess, loadDigestFacts } from '@/lib/chart-digest/access';
import { loadEnrichedBrief } from '@/lib/previsit/enrichedBrief';

export const runtime = 'nodejs';

const CLINICAL_PATHS = [
  '/dashboard/ehr/notes',
  '/dashboard/medical/visits',
  '/dashboard/scribe',
] as const;

function canUseVisitGuide(role: Parameters<typeof canAccessPath>[0]): boolean {
  return CLINICAL_PATHS.some((path) => canAccessPath(role, path));
}

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseVisitGuide(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(req.url);
  const clientId = url.searchParams.get('clientId');
  const appointmentId = url.searchParams.get('appointmentId');
  const kind = url.searchParams.get('kind');
  const antipsychotic = url.searchParams.get('antipsychotic') === '1';
  const telehealth = url.searchParams.get('telehealth');
  const opioidBenzo = url.searchParams.get('opioidBenzo');

  if (clientId) {
    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: gate.organizationId },
      select: { id: true },
    });
    if (!client) {
      return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
    }
  }

  const guide = await buildVisitGuide({
    organizationId: gate.organizationId,
    clientId,
    appointmentId,
    kind,
    antipsychotic,
    telehealth: telehealth === null ? undefined : telehealth === '1',
    opioidBenzo: opioidBenzo === null ? undefined : opioidBenzo === '1',
  });

  // Enriched previsit facts: same visibility rules as chart history (role, care team, protected records).
  let enrichedBrief: Awaited<ReturnType<typeof loadEnrichedBrief>> | null = null;
  if (clientId) {
    const audience = guide.kind === 'primary_care' ? 'pc' : 'bh';
    try {
      const facts = await loadDigestFacts(
        { userId: gate.userId, role: gate.role, organizationId: gate.organizationId },
        clientId
      );
      const access = facts
        ? evaluateDigestAccess({
            role: gate.role,
            kind: audience === 'pc' ? 'medical' : 'bh',
            action: 'view',
            aiConsentDeclined: false, // facts only; no AI is involved in the brief
            aiConfigured: true,
            onCareTeam: facts.onCareTeam,
            sensitiveRecord: facts.sensitiveRecord,
          })
        : null;
      if (access?.ok) {
        enrichedBrief = await loadEnrichedBrief({
          organizationId: gate.organizationId,
          clientId,
          audience,
        });
      }
    } catch (err) {
      console.error('[visit-guide] enriched brief failed', err);
    }
  }

  return NextResponse.json({ success: true, guide, enrichedBrief });
}

const patchSchema = z.object({
  clientId: z.string().min(1),
  appointmentId: z.string().optional().nullable(),
  kind: z.string().min(1),
  stepKey: z.string().min(1),
  done: z.boolean(),
  note: z.string().trim().max(2000).optional().nullable(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canUseVisitGuide(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid checklist update' }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: { id: parsed.data.clientId, organizationId: gate.organizationId },
    select: { id: true },
  });
  if (!client) {
    return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });
  }

  const row = await upsertChecklistItem({
    organizationId: gate.organizationId,
    clientId: client.id,
    appointmentId: parsed.data.appointmentId,
    visitKind: resolveVisitKind(parsed.data.kind),
    stepKey: parsed.data.stepKey,
    done: parsed.data.done,
    note: parsed.data.note,
    userId: gate.userId,
  });

  const guide = await buildVisitGuide({
    organizationId: gate.organizationId,
    clientId: client.id,
    appointmentId: parsed.data.appointmentId,
    kind: parsed.data.kind,
  });

  return NextResponse.json({ success: true, item: row, guide });
}
