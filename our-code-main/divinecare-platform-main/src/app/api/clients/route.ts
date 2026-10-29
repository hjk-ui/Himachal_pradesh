import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { createClient, listClientsForUser, countClientsForUser } from '@/lib/clients/manage';
import { canAccessClientRoster, canAssignPatientToClinician, canCreateClient } from '@/lib/clients/orgScope';
import { assertActiveClientLimit } from '@/lib/subscription/plans';
import { optionalCuid } from '@/lib/validation/optionalCuid';

const intakeSchema = z.object({
  name: z.string().min(2).max(120),
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
  legalFirstName: z.string().max(80).optional().nullable(),
  middleInitial: z.string().max(5).optional().nullable(),
  legalLastName: z.string().max(80).optional().nullable(),
  locationId: optionalCuid,
  assignedToId: optionalCuid,
  status: z.enum(['ACTIVE', 'INACTIVE', 'DISCHARGED']).optional(),
});

/** GET /api/clients — live Postgres list (replaces Firestore users/clients) */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const baseRole = (gate.session.user.baseRole as typeof gate.role | undefined) ?? gate.role;
  const url = new URL(req.url);
  /** Note Builder / clinical write UIs: Admin Role Preview still needs full org roster */
  const orgRoster =
    url.searchParams.get('roster') === 'org' &&
    (baseRole === 'ADMIN' || baseRole === 'PRACTICE_DIRECTOR');
  const listRole = orgRoster ? baseRole : gate.role;

  if (!canAccessClientRoster(listRole)) {
    return NextResponse.json(
      { success: false, error: 'Not allowed to view clients' },
      { status: 403 }
    );
  }

  try {
    const search = url.searchParams.get('q') || url.searchParams.get('search') || undefined;
    const limitParam = url.searchParams.get('limit') || url.searchParams.get('take');
    const pageParam = url.searchParams.get('page');
    const limit = limitParam ? Math.min(Math.max(1, parseInt(limitParam, 10)), 500) : 250;
    const page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1;
    const skip = (page - 1) * limit;

    const actor = {
      id: gate.userId,
      role: listRole,
      organizationId: gate.organizationId,
    };

    const [clients, total] = await Promise.all([
      listClientsForUser(actor, { search, take: limit, skip }),
      countClientsForUser(actor, { search }),
    ]);

    return NextResponse.json({
      success: true,
      clients,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
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
    const body = intakeSchema.parse(await req.json());
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
    const result = await createClient(body, gate.userId, gate.organizationId, role);
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

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
    return NextResponse.json(
      { success: false, error: err.message || 'Could not create client' },
      { status: 400 }
    );
  }
}
