import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import {
  createClient,
  listClientPageForUser,
  listClientPayersForUser,
  listClientsForUser,
  type ClientListOptions,
} from '@/lib/clients/manage';
import { parseClientListQuery } from '@/lib/clients/listQuery';
import { canAccessClientRoster, canAssignPatientToClinician, canCreateClient, canEditClientDiagnoses } from '@/lib/clients/orgScope';
import { assertActiveClientLimit } from '@/lib/subscription/plans';
import { optionalCuid } from '@/lib/validation/optionalCuid';
import { MEDICAL_PROGRAM } from '@/lib/medical/medicalProgram';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { mergeImportedDiagnoses } from '@/lib/diagnoses/store';
import { parseLegacyDiagnoses } from '@/lib/diagnoses/model';
import { clientNameFromLegal, hasLegalName, legalNameFields, preferredNameFields } from '@/lib/clients/legalName';
import { addressContactFields, demographicFields } from '@/lib/clients/demographics';

const intakeSchema = z.object({
  name: z.string().min(2).max(120),
  // DrFirst-ready structured name; when present, name is kept in sync as "First Last".
  ...legalNameFields,
  ...preferredNameFields,
  email: z.string().email().optional().nullable().or(z.literal('')),
  phone: z.string().max(40).optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().max(40).optional().nullable(),
  addressLine1: z.string().max(200).optional().nullable(),
  addressLine2: z.string().max(200).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(40).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  emergencyContactName: z.string().max(120).optional().nullable(),
  emergencyContactPhone: z.string().max(40).optional().nullable(),
  insurancePayer: z.string().max(120).optional().nullable(),
  insuranceMemberId: z.string().max(80).optional().nullable(),
  insuranceGroupNumber: z.string().max(80).optional().nullable(),
  primaryDiagnosis: z.string().max(200).optional().nullable(),
  primaryDiagnosisCode: z.string().max(40).optional().nullable(),
  secondaryDiagnoses: z.string().max(500).optional().nullable(),
  locationId: optionalCuid,
  assignedToId: optionalCuid,
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCHARGED']).optional(),
  // Standard demographics (code sets in src/lib/clients/demographics.ts); state / ZIP / phones validated
  ...demographicFields,
  ...addressContactFields,
});

/** GET /api/clients — live Postgres list (replaces Firestore users/clients) */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const url = new URL(req.url);
  /** Note Builder / clinical write UIs: Admin Role Preview still needs full org roster.
   *  The admin base role is re-read from the DB (cached), never trusted from the JWT. */
  const adminBaseRole =
    url.searchParams.get('roster') === 'org' ? await verifiedAdminBaseRole(gate.userId) : null;
  const orgRoster = adminBaseRole !== null;
  const listRole = adminBaseRole ?? gate.role;

  if (!canAccessClientRoster(listRole)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view clients' },
      { status: 403 }
    );
  }

  try {
    // Query parsing / filters / sort: src/lib/clients/listQuery.ts (every filter narrows clientAccessWhere)
    const q = parseClientListQuery(url.searchParams);
    // Family Practice keeps its original param: searchParams.get('program') === MEDICAL_PROGRAM
    const program = url.searchParams.get('program') === MEDICAL_PROGRAM ? MEDICAL_PROGRAM : q.program;
    const actor = { id: gate.userId, role: listRole, organizationId: gate.organizationId };
    const options: ClientListOptions = {
      search: q.search,
      take: q.take,
      skip: q.skip,
      status: q.status,
      locationId: q.locationId,
      program,
      sort: q.sort,
      dir: q.dir,
      letter: q.letter,
      clinicianId: q.clinicianId,
      clinicianRole: q.clinicianRole,
      mine: q.mine,
      payer: q.payer,
      risk: q.risk,
      noUpcoming: q.noUpcoming,
      needsDemographics: q.needsDemographics,
      unassigned: q.unassigned,
    };
    // Total only when asked, so the many callers that just want a roster don't pay for a count
    const withTotal = url.searchParams.get('withTotal') === '1';
    const { clients, total } = withTotal
      ? await listClientPageForUser(actor, options)
      : { clients: await listClientsForUser(actor, options), total: undefined };
    // Payer choices for the filter (only for roles that may see insurance)
    const payers = url.searchParams.get('facets') === '1' ? await listClientPayersForUser(actor) : undefined;
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'patient',
      metadata: {
        count: clients.length,
        searched: Boolean(q.search),
        status: q.status ?? null,
        program: program ?? null,
        orgRoster,
        sort: q.sort ?? null,
        filters: {
          letter: q.letter ?? null,
          clinician: Boolean(q.clinicianId),
          mine: q.mine,
          payer: Boolean(q.payer),
          risk: q.risk ?? null,
          noUpcoming: q.noUpcoming,
          needsDemographics: q.needsDemographics,
          unassigned: q.unassigned,
        },
      },
    });
    return NextResponse.json({
      success: true,
      clients,
      ...(total !== undefined ? { total } : {}),
      ...(payers ? { payers } : {}),
    });
  } catch (err) {
    console.error('[clients GET]', err);
    return NextResponse.json(
      { success: false, error: 'Failed to load clients' },
      { status: 500 }
    );
  }
}

/** POST /api/clients — client intake (demographics, insurance, dx) */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const role = gate.role;
  if (!canCreateClient(role)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to create clients' },
      { status: 403 }
    );
  }

  try {
    const parsed = intakeSchema.parse(await req.json());
    const body = hasLegalName(parsed) ? { ...parsed, name: clientNameFromLegal(parsed) } : parsed;
    if (body.assignedToId && !canAssignPatientToClinician(role)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Only Admin, Practice Director, Front Desk, or Office Manager can assign a clinician',
        },
        { status: 403 }
      );
    }
    if ((body.status || 'ACTIVE') === 'ACTIVE') {
      const entitlement = await assertActiveClientLimit(gate.organizationId);
      if (!entitlement.ok) {
        return NextResponse.json(
          { success: false, error: entitlement.error, upgradeRequired: true },
          { status: 402 }
        );
      }
    }
    // Diagnoses are a clinical determination: same rule as the profile (licensed BH / leadership)
    if (!canEditClientDiagnoses(role)) {
      delete (body as Record<string, unknown>).primaryDiagnosis;
      delete (body as Record<string, unknown>).primaryDiagnosisCode;
      delete (body as Record<string, unknown>).secondaryDiagnoses;
    }
    const result = await createClient(body, gate.userId, gate.organizationId, role);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }
    // Intake diagnoses start the client's diagnosis list (source Intake)
    if (body.primaryDiagnosisCode || body.primaryDiagnosis || body.secondaryDiagnoses) {
      const intakeDx = parseLegacyDiagnoses({ primaryDiagnosisCode: body.primaryDiagnosisCode, primaryDiagnosis: body.primaryDiagnosis, secondaryDiagnoses: body.secondaryDiagnoses });
      const merged = await mergeImportedDiagnoses(
        { organizationId: gate.organizationId, userId: gate.userId, name: null },
        result.client.id,
        intakeDx,
        { source: 'INTAKE', context: 'intake', createList: true }
      ).catch((e: unknown) => ({ ok: false as const, status: 500, error: e instanceof Error ? e.message : 'list not created' }));
      await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'clientDiagnosis', resourceId: result.client.id, patientId: result.client.id, outcome: merged.ok ? 'SUCCESS' : 'FAILURE', metadata: { context: 'intake', diagnoses: intakeDx.length } });
    }

    await auditPhiAccess({ gate, req, action: 'CREATE', resourceType: 'patient', resourceId: result.client.id, patientId: result.client.id });
    return NextResponse.json(
      {
        success: true,
        client: {
          id: result.client.id,
          name: result.client.name,
          email: result.client.email,
          phone: result.client.phone,
          status: result.client.status,
          primaryDiagnosis: result.client.primaryDiagnosis,
          insurancePayer: result.client.insurancePayer,
        },
        appInvite: result.appInvite,
      },
      { status: 201 }
    );
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: err.issues[0]?.message || 'Invalid request' }, { status: 400 });
    }
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create client' },
      { status: 400 }
    );
  }
}
