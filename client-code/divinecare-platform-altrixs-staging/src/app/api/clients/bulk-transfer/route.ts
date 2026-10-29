import { NextResponse } from 'next/server';
import { invalidateCaseloadScopedCaches } from '@/lib/perf/cache';
import { prisma } from '@/lib/db/prisma';
import { requireFullAdmin } from '@/lib/auth/requireAdmin';
import { getPrimaryLocationId } from '@/lib/org/ensureOrganization';
import { requireWritable } from '@/lib/billing/entitlementsServer';
import {
  MAX_PATIENT_IMPORT_BYTES,
  parsePatientWorkbook,
  patientWorkbookBuffer,
  type PatientExportRow,
  type PatientImportError,
} from '@/lib/clients/bulkTransfer';
import { auditPhiAccess } from '@/lib/audit/requestMeta';

export const runtime = 'nodejs';

const organizationClientWhere = (organizationId: string) => ({
  OR: [
    { location: { organizationId } },
    { AND: [{ locationId: null }, { assignedTo: { organizationId } }] },
  ],
});

function fileNameForToday() {
  return `altrixs-patients-${new Date().toISOString().slice(0, 10)}.xlsx`;
}

export async function GET(req: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const clients = await prisma.client.findMany({
      where: organizationClientWhere(gate.organizationId),
      include: {
        location: { select: { name: true } },
        assignedTo: { select: { email: true } },
      },
      orderBy: { name: 'asc' },
    });
    const rows: PatientExportRow[] = clients.map((client) => ({
      patientId: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      dateOfBirth: client.dateOfBirth,
      gender: client.gender,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      city: client.city,
      state: client.state,
      postalCode: client.postalCode,
      emergencyContactName: client.emergencyContactName,
      emergencyContactPhone: client.emergencyContactPhone,
      insurancePayer: client.insurancePayer,
      insuranceMemberId: client.insuranceMemberId,
      insuranceGroupNumber: client.insuranceGroupNumber,
      primaryDiagnosis: client.primaryDiagnosis,
      primaryDiagnosisCode: client.primaryDiagnosisCode,
      secondaryDiagnoses: client.secondaryDiagnoses,
      location: client.location?.name,
      assignedClinicianEmail: client.assignedTo?.email,
      status: client.status,
      riskLevel: client.riskLevel,
      checkInStreak: client.checkInStreak,
      image: client.image,
      assignedSince: client.assignedSince,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    }));
    const buffer = await patientWorkbookBuffer(rows);
    await auditPhiAccess({ gate, req, action: 'EXPORT', resourceType: 'patient', metadata: { format: 'xlsx', count: rows.length, scope: 'organization' } });
    return new Response(buffer as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileNameForToday()}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[patient bulk export]', error);
    return NextResponse.json({ success: false, error: 'Could not export patients' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const gate = await requireFullAdmin();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: 'Choose an .xlsx file' }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      return NextResponse.json({ success: false, error: 'Only .xlsx files are supported' }, { status: 400 });
    }
    if (file.size > MAX_PATIENT_IMPORT_BYTES) {
      return NextResponse.json({ success: false, error: 'File must be 10 MB or smaller' }, { status: 413 });
    }

    const parsed = await parsePatientWorkbook(await file.arrayBuffer());
    if (parsed.errors.length) {
      return NextResponse.json({ success: false, error: 'Fix the spreadsheet errors and try again', errors: parsed.errors.slice(0, 100) }, { status: 400 });
    }

    const submittedEmails = parsed.rows.flatMap((row) => row.email ? [row.email] : []);
    const [existingClients, globalEmailMatches, locations, staff, primaryLocationId, billing] = await Promise.all([
      prisma.client.findMany({ where: organizationClientWhere(gate.organizationId) }),
      submittedEmails.length
        ? prisma.client.findMany({ where: { email: { in: submittedEmails } }, select: { id: true, email: true } })
        : Promise.resolve([]),
      prisma.location.findMany({ where: { organizationId: gate.organizationId, active: true }, select: { id: true, name: true } }),
      prisma.user.findMany({ where: { organizationId: gate.organizationId, status: 'ACTIVE' }, select: { id: true, email: true } }),
      getPrimaryLocationId(gate.organizationId),
      requireWritable(gate.organizationId),
    ]);

    const byId = new Map(existingClients.map((client) => [client.id, client]));
    const byEmail = new Map(existingClients.filter((client) => client.email).map((client) => [client.email!.toLowerCase(), client]));
    const globalByEmail = new Map(globalEmailMatches.filter((client) => client.email).map((client) => [client.email!.toLowerCase(), client]));
    const locationsByName = new Map(locations.map((location) => [location.name.trim().toLowerCase(), location.id]));
    const staffByEmail = new Map(staff.map((user) => [user.email.toLowerCase(), user.id]));
    const seenIds = new Set<string>();
    const seenEmails = new Set<string>();
    const errors: PatientImportError[] = [];

    const prepared = parsed.rows.map((row) => {
      const byPatientId = row.patientId ? byId.get(row.patientId) : undefined;
      const byPatientEmail = row.email ? byEmail.get(row.email) : undefined;
      const globalEmailMatch = row.email ? globalByEmail.get(row.email) : undefined;
      if (row.patientId && !byPatientId) errors.push({ row: row.rowNumber, field: 'Patient ID', message: 'Patient ID does not belong to this clinic' });
      if (byPatientId && byPatientEmail && byPatientId.id !== byPatientEmail.id) errors.push({ row: row.rowNumber, field: 'Email', message: 'Email belongs to a different patient' });
      const existing = byPatientId || byPatientEmail;
      if (globalEmailMatch && globalEmailMatch.id !== existing?.id) errors.push({ row: row.rowNumber, field: 'Email', message: 'Email already belongs to another patient' });
      if (existing && seenIds.has(existing.id)) errors.push({ row: row.rowNumber, message: 'The same patient appears more than once in the file' });
      if (existing) seenIds.add(existing.id);
      if (row.email && seenEmails.has(row.email)) errors.push({ row: row.rowNumber, field: 'Email', message: 'Email is duplicated in the file' });
      if (row.email) seenEmails.add(row.email);

      let locationId = existing?.locationId || primaryLocationId;
      if (row.location) {
        locationId = locationsByName.get(row.location.trim().toLowerCase()) || null;
        if (!locationId) errors.push({ row: row.rowNumber, field: 'Location', message: 'Location was not found in this clinic' });
      }
      let assignedToId = existing?.assignedToId || gate.userId;
      if (row.assignedClinicianEmail) {
        assignedToId = staffByEmail.get(row.assignedClinicianEmail) || null;
        if (!assignedToId) errors.push({ row: row.rowNumber, field: 'Assigned Clinician Email', message: 'Active clinician was not found in this clinic' });
      }

      return { row, existing, locationId, assignedToId };
    });

    // Tiers are priced per clinician with no active-patient cap; only a read-only account is blocked.
    if (billing.ok === false) {
      errors.push({ row: 1, field: 'Status', message: billing.error });
    }
    if (errors.length) {
      return NextResponse.json({ success: false, error: 'Fix the spreadsheet errors and try again', errors: errors.slice(0, 100) }, { status: 400 });
    }

    let created = 0;
    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of prepared) {
        const { row, existing, locationId, assignedToId } = item;
        const data = {
          name: row.name.trim(), email: row.email, phone: row.phone,
          dateOfBirth: row.dateOfBirth, gender: row.gender,
          addressLine1: row.addressLine1, addressLine2: row.addressLine2,
          city: row.city, state: row.state, postalCode: row.postalCode,
          emergencyContactName: row.emergencyContactName,
          emergencyContactPhone: row.emergencyContactPhone,
          insurancePayer: row.insurancePayer,
          insuranceMemberId: row.insuranceMemberId,
          insuranceGroupNumber: row.insuranceGroupNumber,
          primaryDiagnosis: row.primaryDiagnosis,
          primaryDiagnosisCode: row.primaryDiagnosisCode,
          secondaryDiagnoses: row.secondaryDiagnoses,
          locationId, assignedToId, status: row.status,
          active: row.status === 'ACTIVE', riskLevel: row.riskLevel,
          checkInStreak: row.checkInStreak, image: row.image,
        };
        if (existing) {
          // assignedSince moves only when the primary clinician changes
          const reassigned = (existing.assignedToId ?? null) !== (assignedToId ?? null);
          await tx.client.update({ where: { id: existing.id }, data: reassigned ? { ...data, assignedSince: new Date() } : data });
          updated += 1;
        } else {
          await tx.client.create({ data: { ...data, assignedSince: new Date() } });
          created += 1;
        }
      }
    }, { timeout: 30_000 });

    // New / changed assignments show on the new clinicians' lists and home right away
    invalidateCaseloadScopedCaches(gate.organizationId);
    return NextResponse.json({ success: true, total: prepared.length, created, updated });
  } catch (error) {
    console.error('[patient bulk import]', error);
    return NextResponse.json({ success: false, error: 'Could not import patients. No rows were saved.' }, { status: 500 });
  }
}
