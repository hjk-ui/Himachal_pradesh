import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { UNKNOWN_DOB, ageFromDob, documentedDob, realValue } from '../_lib/demographics';
import { canAccessClientRoster, clientAccessWhere } from '@/lib/clients/orgScope';
import { medicalProgramClientWhere } from '@/lib/medical/medicalProgram';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { loadPrimaryCareRoster, parseRosterQuery } from '@/lib/medical/primaryCareRoster';
import { prismaRosterSource } from '@/lib/medical/primaryCareRosterDb';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { isCaseloadScoped } from '@/lib/auth/medicalDirector';
import { maskClientPii } from '@/lib/privacy/pii';
import { withoutLockedClients } from '@/lib/privacy/lockedRows';

type Gate = Extract<Awaited<ReturnType<typeof requireOrgContext>>, { ok: true }>;

/** Primary care area rule; refusals are audited */
async function deniedRole(gate: Gate, req: Request, action: string) {
  if (canAccessPath(gate.role, '/dashboard/medical/patients')) return null;
  await auditPhiAccess({ gate, req, action, resourceType: 'medicalPatient', outcome: 'DENIED', metadata: { reason: 'role_not_permitted' } });
  return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
}

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const denied = await deniedRole(gate, req, 'LIST');
  if (denied) return denied;

  const url = new URL(req.url);
  if (url.searchParams.get('view') === 'roster') return rosterGet(gate, req, url);

  try {
    // Caseload / primary care roles: only clients on their caseload or care team (same as the chart)
    const accessWhere = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    // Older MedicalPatient rows (demographics shadow of a client). They are no longer created
    // from the client list on first visit; scripts/medical-patient-reconciliation.ts reports them.
    const allPatients = await prisma.medicalPatient.findMany({
      where: { organizationId: gate.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    let patients = allPatients;
    if (isCaseloadScoped({ role: gate.role, userId: gate.userId, organizationId: gate.organizationId })) {
      // Unlinked rows have no assignment / care team to check, so caseload roles do not see them
      const linked = allPatients.map((p) => p.bhClientId).filter((v): v is string => Boolean(v));
      const allowed = linked.length
        ? await prisma.client.findMany({ where: { AND: [accessWhere, { id: { in: linked } }] }, select: { id: true } })
        : [];
      const ok = new Set(allowed.map((c) => c.id));
      patients = allPatients.filter((p) => p.bhClientId && ok.has(p.bhClientId));
    }

    // One patient record: Family Practice clients with no MedicalPatient row are listed by client id
    const linkedIds = patients.map((p) => p.bhClientId).filter((v): v is string => Boolean(v));
    const linkedMrns = patients.map((p) => p.mrn);
    const programClients = await prisma.client.findMany({
      where: {
        AND: [
          accessWhere,
          medicalProgramClientWhere(),
          { id: { notIn: linkedIds } },
          { OR: [{ mrn: null }, { mrn: { notIn: linkedMrns } }] },
        ],
      },
      select: {
        id: true, mrn: true, name: true, legalFirstName: true, dateOfBirth: true, gender: true, phone: true, email: true,
        addressLine1: true, city: true, state: true, emergencyContactName: true, insurancePayer: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    const asShadow = (c: (typeof programClients)[number]) => ({
      id: c.id,
      organizationId: gate.organizationId,
      mrn: c.mrn ?? '',
      name: c.name,
      firstName: c.legalFirstName,
      lastName: null,
      dateOfBirth: c.dateOfBirth ?? UNKNOWN_DOB,
      dob: c.dateOfBirth,
      gender: c.gender || 'Unknown',
      phone: c.phone,
      email: c.email,
      address: [c.addressLine1, c.city, c.state].filter(Boolean).join(', ') || null,
      emergencyContact: c.emergencyContactName,
      primaryPayer: c.insurancePayer,
      primaryInsurance: null,
      secondaryPayer: null,
      assignedPcp: '',
      hba1cOverdue: false,
      egfrDeclining: false,
      nextAppointmentDate: null,
      bhClientId: c.id,
      crossReferencedBhId: null,
      hasPart2Consent: false,
      consent42CfrPart2: false,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });
    // 42 CFR Part 2 / VIP clients this viewer may not open are left out (fail closed)
    const roster = await withoutLockedClients(gate, [...patients, ...programClients.map(asShadow)], (p) => p.bhClientId);
    // Problem list (ICD-10 codes, free-text notes): only roles with the Problem List page
    // (not Front Desk, Office Manager, Therapist, Case Manager...)
    const canSeeProblems = canAccessPath(gate.role, '/dashboard/medical/problem-list', gate.capabilities);

    const clientIds = roster.map((p) => p.bhClientId).filter(Boolean) as string[];
    const clientMrns = roster.map((p) => p.mrn).filter(Boolean);
    const clients = await prisma.client.findMany({
      where: {
        organizationId: gate.organizationId,
        OR: [
          { id: { in: clientIds } },
          { mrn: { in: clientMrns } },
        ],
      },
      select: {
        id: true,
        mrn: true,
        primaryDiagnosis: true,
        primaryDiagnosisCode: true,
        medicalProblems: canSeeProblems && {
          select: {
            id: true,
            icd10Code: true,
            name: true,
            description: true,
            category: true,
            status: true,
            isChronic: true,
            onsetDate: true,
            notes: true,
          },
        },
      },
    });

    const clientMap = new Map();
    for (const c of clients) {
      if (c.id) clientMap.set(c.id, c);
      if (c.mrn) clientMap.set(c.mrn, c);
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'medicalPatient',
      metadata: {
        count: roster.length,
        ids: roster.slice(0, 50).map((p) => p.id),
        programClients: programClients.length,
        problems: canSeeProblems,
      },
    });

    return NextResponse.json({
      success: true,
      patients: roster.map((p) => {
        const client = (p.bhClientId ? clientMap.get(p.bhClientId) : null) || clientMap.get(p.mrn);
        // '' / 0 when only the placeholder DOB is on file; the UI shows "Not documented".
        const dobStr = documentedDob(p);
        const age = ageFromDob(dobStr);

        // Contact PII masked for roles without PII access (maskClientPii)
        const pii = maskClientPii({ phone: p.phone || '', email: p.email || '', addressLine1: realValue(p.address) || '' }, gate.role);
        const problems = (canSeeProblems ? client?.medicalProblems || [] : []).map((mp: any) => ({
          id: mp.id,
          icd10: mp.icd10Code || '',
          needsCoding: !(mp.icd10Code ?? '').trim(),
          description: mp.name || mp.description || mp.icd10Code || '',
          onsetDate: mp.onsetDate ? mp.onsetDate.toISOString().slice(0, 10) : '',
          status: mp.isChronic && mp.status !== 'Resolved' ? 'Chronic' : (mp.status || 'Active'),
          category: mp.category || 'Other',
          notes: mp.notes || undefined,
        }));

        return {
          id: p.id,
          clientId: client?.id || null,
          mrn: p.mrn,
          name: p.name,
          preferredName: p.firstName || p.name.split(' ')[0] || p.name,
          dob: dobStr,
          age,
          gender: p.gender || 'Unknown',
          pronouns: '',
          pcp: p.assignedPcp || '',
          phone: pii.phone,
          email: pii.email,
          hasCareGaps: Boolean(p.hba1cOverdue || p.egfrDeclining),
          hasAbnormalLabs: false,
          hasCriticalPanicLab: false,
          lastVisit: '—',
          nextVisit: p.nextAppointmentDate ? `Scheduled for ${p.nextAppointmentDate.toISOString().split('T')[0]}` : null,
          demographics: {
            legalName: p.name,
            preferredName: p.firstName || p.name.split(' ')[0] || p.name,
            dateOfBirth: dobStr,
            sexAtBirth: p.gender?.toLowerCase() === 'female' ? 'Female' : p.gender?.toLowerCase() === 'male' ? 'Male' : 'Unknown',
            genderIdentity: p.gender || 'Unknown',
            sexualOrientation: 'Not Specified',
            pronouns: 'Not specified',
            ombRace: 'Not Specified',
            ombEthnicity: 'Not Specified',
            preferredLanguage: 'Not specified',
            interpreterNeeded: false,
            portalStatus: 'Active',
            primaryInsurance: {
              payerName: realValue(p.primaryPayer || p.primaryInsurance),
              payerId: '',
              memberId: '',
              groupNumber: '',
              subscriberName: p.name,
              subscriberDob: dobStr,
              relationship: 'Self',
            },
            guarantor: {
              name: p.name,
              relationship: 'Self',
              phone: pii.phone,
              address: pii.addressLine1 || realValue(p.address),
            },
            emergencyContacts: realValue(p.emergencyContact)
              ? [
                  {
                    name: p.emergencyContact,
                    relationship: 'Contact',
                    phone: '',
                    isAuthorizedProxy: true,
                  },
                ]
              : [],
            codeStatus: 'Not Documented',
            advanceDirectives: {
              hasLivingWill: false,
              hasPOLST: false,
            },
            chartFlags: [],
          },
          problems,
          medications: [],
          allergies: [],
          vitals: [],
          labs: [],
          preventiveCare: [],
          referrals: [],
          encounters: [],
        };
      }),
    });
  } catch (err: unknown) {
    console.error('[medical/patients] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not fetch medical patients' },
      { status: 500 }
    );
  }
}

/**
 * GET ?view=roster — the Primary care patients list (/dashboard/medical/patients): one page of
 * primary-care patients (src/lib/medical/primaryCareRoster.ts) with the total, scoped to the
 * viewer's client access, protected records masked. Filters: q (name / MRN / DOB), locationId,
 * providerId, status, page, pageSize.
 */
async function rosterGet(gate: Gate, req: Request, url: URL) {
  if (!canAccessClientRoster(gate.role)) {
    await auditPhiAccess({ gate, req, action: 'LIST', resourceType: 'medicalPatient', outcome: 'DENIED', metadata: { reason: 'role_not_permitted', view: 'roster' } });
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const viewer = { organizationId: gate.organizationId, userId: gate.userId, role: gate.role };
    const access = clientAccessWhere({ organizationId: gate.organizationId, actorUserId: gate.userId, actorRole: gate.role });
    const [result, timeZone] = await Promise.all([
      loadPrimaryCareRoster(prismaRosterSource(viewer), viewer, access, parseRosterQuery(url.searchParams)),
      getPracticeTimeZone(gate.organizationId),
    ]);
    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'medicalPatient',
      metadata: {
        view: 'roster',
        count: result.rows.length,
        total: result.total,
        page: result.page,
        masked: result.maskedCount,
        searched: Boolean(result.query.q),
        locationId: result.query.locationId,
        providerId: result.query.providerId,
        status: result.query.status,
        pcpFilter: result.query.pcp,
        pcpReview: result.query.pcpReview,
        sort: result.query.sort,
        ids: result.rows.slice(0, 50).map((r) => r.clientId),
      },
    });
    return NextResponse.json({ success: true, ...result, timeZone });
  } catch (err: unknown) {
    console.error('[medical/patients roster] GET failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load primary care patients' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }

  const denied = await deniedRole(gate, req, 'CREATE');
  if (denied) return denied;

  try {
    const body = await req.json();
    const name = body.name || `${body.firstName || ''} ${body.lastName || ''}`.trim() || 'New Patient';
    const mrn = body.mrn || `MED-${Math.floor(10000 + Math.random() * 90000)}`;
    const realDob = body.dob || body.dateOfBirth ? new Date(body.dob || body.dateOfBirth) : null;
    const dob = realDob || UNKNOWN_DOB;

    const created = await prisma.medicalPatient.create({
      data: {
        organizationId: gate.organizationId,
        mrn,
        name,
        firstName: body.firstName || name.split(' ')[0] || null,
        lastName: body.lastName || name.split(' ').slice(1).join(' ') || null,
        dateOfBirth: dob,
        dob: realDob,
        gender: body.gender || 'Unknown',
        phone: body.phone || null,
        email: body.email || null,
        address: body.address || null,
        emergencyContact: body.emergencyContact || null,
        primaryPayer: body.primaryInsurance || body.primaryPayer || null,
        primaryInsurance: body.primaryInsurance || body.primaryPayer || null,
        secondaryPayer: body.secondaryPayer || null,
        assignedPcp: body.assignedPcp || body.pcp || undefined,
        hba1cOverdue: Boolean(body.hba1cOverdue),
        egfrDeclining: Boolean(body.egfrDeclining),
        nextAppointmentDate: body.nextAppointmentDate ? new Date(body.nextAppointmentDate) : null,
        bhClientId: body.bhClientId || body.crossReferencedBhId || null,
        crossReferencedBhId: body.bhClientId || body.crossReferencedBhId || null,
        hasPart2Consent: Boolean(body.hasPart2Consent || body.consent42CfrPart2),
        consent42CfrPart2: Boolean(body.hasPart2Consent || body.consent42CfrPart2),
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'medicalPatient',
      resourceId: created.id,
      patientId: created.bhClientId ?? null,
      metadata: { fields: body && typeof body === 'object' ? Object.keys(body).slice(0, 50) : [] },
    });

    return NextResponse.json({
      success: true,
      patient: {
        id: created.id,
        mrn: created.mrn,
        name: created.name,
        dob: documentedDob(created),
        gender: created.gender,
        primaryInsurance: created.primaryInsurance,
        crossReferencedBhId: created.crossReferencedBhId,
        consent42CfrPart2: created.consent42CfrPart2,
      },
    }, { status: 201 });
  } catch (err: unknown) {
    console.error('[medical/patients] POST failed', err instanceof Error ? err.name : 'error');
    return NextResponse.json(
      { success: false, error: 'Could not create medical patient' },
      { status: 500 }
    );
  }
}

