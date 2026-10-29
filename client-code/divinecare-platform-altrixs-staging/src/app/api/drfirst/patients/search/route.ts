import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { requireDrFirstCaller, drFirstClientWhere } from '../../_lib/access';
import { lookupRcopiaPatient } from '../../_lib/patientLookup';
import { syncPatient, totals } from '../../_lib/sync';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ clientId: z.string().min(1) });

/**
 * POST /api/drfirst/patients/search { clientId } — find this chart's patient in
 * Rcopia: by our external id first, then by the chart's legal last name + DOB
 * (matched locally against a practice download; nothing about the patient is
 * sent to DrFirst). Exactly one candidate -> Client.rcopiaPatientId is linked
 * now; several -> they are returned for staff to confirm with
 * POST /api/drfirst/patients/link. Search criteria always come from the chart,
 * never from the request. Prescriber or ADMIN; org + caseload scope.
 * The audit row carries counts only.
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'clientId is required' }, { status: 400 });

  const client = await prisma.client.findFirst({
    where: drFirstClientWhere(c, parsed.data.clientId),
    select: { id: true, rcopiaPatientId: true, legalLastName: true, dateOfBirth: true },
  });
  if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
  if (DEMO_MODE) {
    return NextResponse.json({ success: true, demo: true, linked: false, candidates: [], message: 'DrFirst is not configured on this server.' });
  }
  if (client.rcopiaPatientId && client.rcopiaPatientId !== client.id) {
    return NextResponse.json({ success: true, linked: true, alreadyLinked: true, rcopiaPatientId: client.rcopiaPatientId, candidates: [] });
  }

  const result = await lookupRcopiaPatient(client, c.rcopiaUsername || undefined);
  let linkedTo: string | null = null;
  if (result.ok && result.candidates.length === 1) {
    linkedTo = result.candidates[0].rcopiaId;
    await prisma.client.update({ where: { id: client.id }, data: { rcopiaPatientId: linkedTo } });
  }
  // Auto-linked: pull the patient's DrFirst medications, prescriptions, allergies and problems now
  let history: Record<string, number> | null = null;
  if (linkedTo && c.rcopiaUsername) {
    try {
      history = totals(await syncPatient(c.organizationId, { id: client.id, rcopiaPatientId: linkedTo }, c.rcopiaUsername));
    } catch (err) {
      console.error('[drfirst-search] history download failed:', err instanceof Error ? err.name : 'unknown');
    }
  }

  await writeAuditLog({
    action: 'DRFIRST_PATIENT_SEARCH',
    actorUserId: c.userId,
    actorRole: c.role,
    organizationId: c.organizationId,
    resourceType: 'patient',
    resourceId: client.id,
    patientId: client.id,
    outcome: result.ok ? 'SUCCESS' : 'FAILURE',
    ipAddress: c.ipAddress,
    userAgent: c.userAgent,
    metadata: {
      candidates: result.candidates.length,
      matchedBy: [...new Set(result.candidates.map(x => x.matchedBy))],
      excluded: result.excluded,
      pagesScanned: result.pagesScanned,
      truncated: result.truncated,
      nameDobSearched: result.nameDobSearched,
      autoLinked: Boolean(linkedTo),
      ...(history ? { history } : {}),
      errorCode: result.error ?? null,
    },
  });

  if (!result.ok) {
    return NextResponse.json({ error: 'DrFirst patient search failed', code: result.error }, { status: 502 });
  }
  return NextResponse.json({
    success: true,
    linked: Boolean(linkedTo),
    rcopiaPatientId: linkedTo,
    history,
    candidates: linkedTo ? [] : result.candidates,
    excluded: result.excluded,
    truncated: result.truncated,
    nameDobSearched: result.nameDobSearched,
    ...(!result.nameDobSearched && !result.candidates.length
      ? { message: 'No DrFirst patient has this chart as its external id, and the chart has no legal last name and date of birth to search by.' }
      : {}),
  });
}
