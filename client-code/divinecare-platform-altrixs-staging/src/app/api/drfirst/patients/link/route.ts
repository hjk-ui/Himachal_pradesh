import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canViewClientMedications, clientAccessWhere } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { canPrescribe } from '@/types/roles';
import type { Role } from '@prisma/client';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { codificationReadiness, diagnosisProblems, matchesNameAndDob } from '@/lib/drfirst/chartMapping';
import { applyPart2ProblemRule, PART2_WITHHELD_NOTICE } from '@/lib/drfirst/part2Problems';
import { DEMO_MODE } from '@/lib/services/drfirstRcopiaService';
import { requireDrFirstCaller, drFirstClientWhere } from '../../_lib/access';
import { fetchRcopiaPatient } from '../../_lib/patientLookup';
import { ALLERGY_SELECT, drFirstPart2Status, MEDICATION_SELECT } from '../../_lib/chartPush';
import { OFFICE_VISIT_EVENT_TYPE, PATIENT_REVIEW_ACK_EVENT_TYPE, PATIENT_REVIEW_EVENT_TYPE, syncPatient, totals } from '../../_lib/sync';

export const dynamic = 'force-dynamic';

/**
 * GET /api/drfirst/patients/link?clientId= — the chart's DrFirst state for the
 * Medications tab: link status, DrFirst problem-list rows, open patient review
 * items (update_patient differences), recent downloaded office visits, and drug-code readiness
 * (local medications / drug allergies DrFirst would receive as free text: MUM2 / AUM2).
 * Medication-list roles only (canViewClientMedications: not Peer Support, Case Manager, PRP, Front
 * Desk, Office Manager, Billing or HR); chart gate (org, caseload / care team, 42 CFR Part 2 /
 * sensitive-record lock), the same rule as GET /api/clients/[id]/medications. No DrFirst call.
 */
export async function GET(req: NextRequest) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const role = String(gate.role);

  const clientId = req.nextUrl.searchParams.get('clientId');
  if (!clientId) return NextResponse.json({ error: 'clientId query parameter required' }, { status: 400 });
  const access = await gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role,
    clientId,
    path: `/api/drfirst/patients/link?clientId=${clientId}`,
    roleAllowed: canViewClientMedications(role),
  });
  if (access.ok === false) {
    await writeAuditLog({
      action: 'READ', actorUserId: gate.userId, actorRole: role, organizationId: gate.organizationId,
      resourceType: 'drfirst_chart', resourceId: clientId, patientId: access.status === 404 ? null : clientId,
      outcome: 'DENIED', ...auditRequestMeta(req), metadata: { reason: access.reason },
    });
    return NextResponse.json({ error: access.error }, { status: access.status });
  }
  const client = await prisma.client.findFirst({
    where: { id: clientId, ...clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: role as Role }) },
    select: { id: true, rcopiaPatientId: true, primaryDiagnosisCode: true, primaryDiagnosis: true, secondaryDiagnoses: true },
  });
  if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

  const [problems, events, localMeds, allergies] = await Promise.all([
    prisma.medicalProblem.findMany({
      where: { clientId: client.id, source: 'drfirst' },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      take: 50,
      select: { id: true, icd10Code: true, name: true, status: true, onsetDate: true, notes: true, updatedAt: true },
    }),
    prisma.clinicalEvent.findMany({
      where: {
        organizationId: gate.organizationId, clientId: client.id,
        eventType: { in: [PATIENT_REVIEW_EVENT_TYPE, PATIENT_REVIEW_ACK_EVENT_TYPE, OFFICE_VISIT_EVENT_TYPE] },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, eventType: true, payloadJson: true, createdAt: true },
    }),
    prisma.clientMedication.findMany({ where: { clientId: client.id, rcopiaMedId: null }, select: MEDICATION_SELECT, take: 200 }),
    prisma.medicalAllergy.findMany({ where: { clientId: client.id }, select: ALLERGY_SELECT, take: 200 }),
  ]);
  const codification = codificationReadiness(localMeds, allergies);
  // 42 CFR Part 2: SUD diagnoses the DrFirst push withholds (Part 2 client, no covering consent); count only
  const { problems: chartProblems } = diagnosisProblems(client);
  const part2Withheld = chartProblems.length
    ? applyPart2ProblemRule(chartProblems, await drFirstPart2Status(gate.organizationId, client.id).catch(() => ({ part2Client: true, consentCovers: false }))).withheld.length
    : 0;
  const part2Notice = part2Withheld ? { withheld: part2Withheld, message: PART2_WITHHELD_NOTICE } : null;

  const acked = new Set(
    events.filter(e => e.eventType === PATIENT_REVIEW_ACK_EVENT_TYPE)
      .map(e => String((e.payloadJson as Record<string, unknown> | null)?.reviewEventId || '')),
  );
  const reviewItems = events
    .filter(e => e.eventType === PATIENT_REVIEW_EVENT_TYPE && !acked.has(e.id))
    .slice(0, 5)
    .map(e => {
      const p = (e.payloadJson || {}) as Record<string, unknown>;
      return {
        id: e.id,
        createdAt: e.createdAt,
        differences: Array.isArray(p.differences) ? p.differences : [],
        linkConflict: p.linkConflict ?? null,
        deletedInDrFirst: Boolean(p.deletedInDrFirst),
      };
    });
  const officeVisits = events
    .filter(e => e.eventType === OFFICE_VISIT_EVENT_TYPE)
    .slice(0, 10)
    .map(e => {
      const p = (e.payloadJson || {}) as Record<string, unknown>;
      return { id: e.id, visitDate: p.visitDate ?? null, renderingProviderUsername: p.renderingProviderUsername ?? null, origin: p.origin ?? null, deleted: Boolean(p.deleted) };
    });

  await writeAuditLog({
    action: 'READ',
    actorUserId: gate.userId,
    actorRole: role,
    organizationId: gate.organizationId,
    resourceType: 'drfirst_chart',
    resourceId: client.id,
    patientId: client.id,
    ...auditRequestMeta(req),
    metadata: {
      problems: problems.length, reviewItems: reviewItems.length, officeVisits: officeVisits.length,
      medicationsUncoded: codification.medicationsUncoded, allergiesUncoded: codification.allergiesUncoded,
      part2Withheld,
    },
  });

  return NextResponse.json({
    success: true,
    configured: !DEMO_MODE,
    linked: Boolean(client.rcopiaPatientId),
    canLink: canPrescribe(role) || role === 'ADMIN',
    problems,
    reviewItems,
    officeVisits,
    codification,
    part2Notice,
  });
}

const linkSchema = z.union([
  z.object({ clientId: z.string().min(1), rcopiaPatientId: z.string().regex(/^\d{1,20}$/) }),
  z.object({ clientId: z.string().min(1), acknowledgeReviewId: z.string().min(1) }),
]);

/**
 * POST /api/drfirst/patients/link
 *  { clientId, rcopiaPatientId } — staff confirm one candidate from
 *    /api/drfirst/patients/search. The Rcopia patient is re-read and linked only
 *    if it still exists, is not deleted, is not linked to another chart, and
 *    carries this chart's id as external id or matches its last name + DOB.
 *  { clientId, acknowledgeReviewId } — mark a DrFirst patient review item as
 *    reviewed (the chart is not changed).
 * Prescriber or ADMIN; org + caseload scope; audited.
 */
export async function POST(req: NextRequest) {
  const g = await requireDrFirstCaller(req, { allowAdmin: true, requireRcopiaUser: true });
  if (g.response) return g.response;
  const c = g.caller;

  const parsed = linkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  const body = parsed.data;

  const client = await prisma.client.findFirst({
    where: drFirstClientWhere(c, body.clientId),
    select: { id: true, rcopiaPatientId: true, legalLastName: true, dateOfBirth: true },
  });
  if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

  const audit = (action: string, outcome: 'SUCCESS' | 'FAILURE', metadata: Record<string, unknown>) =>
    writeAuditLog({
      action, actorUserId: c.userId, actorRole: c.role, organizationId: c.organizationId,
      resourceType: 'patient', resourceId: client.id, patientId: client.id, outcome,
      ipAddress: c.ipAddress, userAgent: c.userAgent, metadata,
    });

  if ('acknowledgeReviewId' in body) {
    const item = await prisma.clinicalEvent.findFirst({
      where: { id: body.acknowledgeReviewId, organizationId: c.organizationId, clientId: client.id, eventType: PATIENT_REVIEW_EVENT_TYPE },
      select: { id: true },
    });
    if (!item) return NextResponse.json({ error: 'Review item not found' }, { status: 404 });
    await prisma.clinicalEvent.create({
      data: {
        organizationId: c.organizationId, clientId: client.id, eventType: PATIENT_REVIEW_ACK_EVENT_TYPE,
        payloadJson: { reviewEventId: item.id }, createdById: c.userId,
      },
    });
    await audit('DRFIRST_PATIENT_REVIEW_ACK', 'SUCCESS', { reviewEventId: item.id });
    return NextResponse.json({ success: true });
  }

  if (DEMO_MODE) return NextResponse.json({ error: 'DrFirst is not configured on this server.' }, { status: 503 });
  if (client.rcopiaPatientId && client.rcopiaPatientId !== client.id) {
    return NextResponse.json({ error: 'This chart is already linked to a DrFirst patient.' }, { status: 409 });
  }
  const other = await prisma.client.findFirst({
    where: { rcopiaPatientId: body.rcopiaPatientId, id: { not: client.id } },
    select: { id: true },
  });
  if (other) {
    await audit('DRFIRST_PATIENT_LINK', 'FAILURE', { reason: 'linked_elsewhere' });
    return NextResponse.json({ error: 'That DrFirst patient is already linked to another chart.' }, { status: 409 });
  }

  const res = await fetchRcopiaPatient(body.rcopiaPatientId, c.rcopiaUsername || undefined);
  if (!res.ok) {
    await audit('DRFIRST_PATIENT_LINK', 'FAILURE', { errorCode: res.error ?? null });
    return NextResponse.json({ error: 'DrFirst could not be reached to confirm the patient', code: res.error }, { status: 502 });
  }
  const p = res.patient;
  const matchedBy = p?.externalId === client.id ? 'external_id' : p && matchesNameAndDob(client, p) ? 'name_dob' : null;
  if (!p || p.deleted || !matchedBy) {
    await audit('DRFIRST_PATIENT_LINK', 'FAILURE', { reason: !p ? 'not_found' : p.deleted ? 'deleted' : 'no_match' });
    return NextResponse.json({ error: 'That DrFirst patient does not match this chart (external id, or last name and date of birth).' }, { status: 409 });
  }
  if (p.externalId && p.externalId !== client.id) {
    const owner = await prisma.client.findFirst({ where: { id: p.externalId }, select: { id: true } });
    if (owner) {
      await audit('DRFIRST_PATIENT_LINK', 'FAILURE', { reason: 'external_id_of_other_chart' });
      return NextResponse.json({ error: 'That DrFirst patient belongs to another chart.' }, { status: 409 });
    }
  }

  await prisma.client.update({ where: { id: client.id }, data: { rcopiaPatientId: body.rcopiaPatientId } });
  // Pull the patient's DrFirst medications, prescriptions, allergies and problems onto the chart now
  const history = await pullHistory(c.organizationId, { id: client.id, rcopiaPatientId: body.rcopiaPatientId }, c.rcopiaUsername);
  await audit('DRFIRST_PATIENT_LINK', 'SUCCESS', { matchedBy, ...(history ? { history } : {}) });
  return NextResponse.json({ success: true, linked: true, rcopiaPatientId: body.rcopiaPatientId, matchedBy, history });
}

/** History download right after linking; a failure is reported, never undoes the link. Counts only. */
async function pullHistory(organizationId: string, client: { id: string; rcopiaPatientId: string }, rcopiaUsername: string | null) {
  if (!rcopiaUsername) return null;
  try {
    return totals(await syncPatient(organizationId, client, rcopiaUsername));
  } catch (err) {
    console.error('[drfirst-link] history download failed:', err instanceof Error ? err.name : 'unknown');
    return null;
  }
}
