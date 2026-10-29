/**
 * Load one organization's rows for FHIR mapping (org-scoped reads only).
 * Signed / locked notes only; drafts are read just for the Part 2 flag (client id only).
 */
import type { PrismaClient } from '@prisma/client';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { ASSESSMENT_LOINC } from '@/lib/fhir/mapping/observation';
import type { OrgSnapshot } from '@/lib/fhir/mapping/types';

const CHUNK = 2000;

function chunks<T>(list: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

async function byClient<T>(ids: string[], load: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
  const out: T[] = [];
  for (const c of chunks(ids)) out.push(...(await load(c)));
  return out;
}

export async function loadOrgSnapshot(db: PrismaClient, organizationId: string): Promise<OrgSnapshot | null> {
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, name: true, active: true },
  });
  if (!organization) return null;

  const [locations, users, clients] = await Promise.all([
    db.location.findMany({
      where: { organizationId },
      select: {
        id: true, organizationId: true, name: true, code: true, addressLine1: true, addressLine2: true,
        city: true, state: true, postalCode: true, phone: true, active: true,
      },
    }),
    db.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, role: true, status: true, npi: true, licenseNumber: true },
    }),
    db.client.findMany({
      where: clientOrgFilter(organizationId),
      select: {
        id: true, organizationId: true, name: true, legalFirstName: true, middleInitial: true, legalLastName: true,
        email: true, phone: true, phoneSecondary: true, status: true, mrn: true, sourcePlatform: true, sourceId: true,
        dateOfBirth: true, gender: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true,
        emergencyContactName: true, emergencyContactPhone: true, primaryDiagnosis: true, primaryDiagnosisCode: true,
        secondaryDiagnoses: true, assignedToId: true,
        legalMiddleName: true, nameSuffix: true, preferredName: true, administrativeSex: true, sexAtBirth: true,
        genderIdentity: true, pronouns: true, race: true, ethnicity: true, preferredLanguage: true, interpreterNeeded: true,
        maritalStatus: true, county: true, phoneType: true, phoneSecondaryType: true, emergencyContactRelationship: true,
        guardianName: true, guardianRelationship: true, guardianPhone: true, medicaidId: true, deceasedAt: true,
        sensitiveRecord: { select: { noteClassification: true } },
      },
    }),
  ]);
  const ids = clients.map((c) => c.id);

  const [problems, medications, allergies, appointments, medicalVisits, notes, part2Flags, assessments] = await Promise.all([
    byClient(ids, (c) =>
      db.medicalProblem.findMany({
        where: { clientId: { in: c } },
        select: {
          id: true, clientId: true, icd10Code: true, name: true, description: true, status: true, onsetDate: true,
          resolvedDate: true, source: true, rcopiaProblemId: true, createdAt: true,
        },
      })
    ),
    byClient(ids, (c) =>
      db.clientMedication.findMany({
        where: { clientId: { in: c } },
        select: {
          id: true, clientId: true, medicationName: true, dosage: true, route: true, frequency: true, indication: true,
          startDate: true, endDate: true, stopDate: true, active: true, status: true, source: true, drugName: true,
          brandName: true, genericName: true, ndcCode: true, rxnormId: true, dosageText: true, asNeeded: true,
          prnReason: true, rcopiaMedId: true, prescribedById: true, createdAt: true,
        },
      })
    ),
    byClient(ids, (c) =>
      db.medicalAllergy.findMany({
        where: { clientId: { in: c } },
        select: {
          id: true, clientId: true, allergen: true, reaction: true, severity: true, status: true, source: true,
          rcopiaAllergyId: true, createdAt: true,
        },
      })
    ),
    byClient(ids, (c) =>
      db.appointment.findMany({
        // Appointment.organizationId may be null on legacy rows; the client scope decides.
        where: { clientId: { in: c }, OR: [{ organizationId }, { organizationId: null }] },
        select: { id: true, clientId: true, clinicianId: true, type: true, startsAt: true, endsAt: true, status: true, isVirtual: true },
      })
    ),
    byClient(ids, (c) =>
      db.medicalVisit.findMany({
        where: { clientId: { in: c } },
        select: {
          id: true, clientId: true, providerId: true, visitDate: true, visitType: true, cptCode: true, icd10Codes: true,
          status: true, signedAt: true,
        },
      })
    ),
    byClient(ids, (c) =>
      db.progressNote.findMany({
        where: { clientId: { in: c }, workflow: { status: { in: ['SIGNED', 'LOCKED'] } } },
        select: {
          id: true, clientId: true, clinicianId: true, body: true, noteType: true, dateOfService: true, part2: true,
          createdAt: true,
          workflow: {
            select: { status: true, signedAt: true, lockedAt: true, body: true, signedById: true, cosignedById: true },
          },
          addenda: { select: { id: true, reason: true, text: true, authorName: true, createdAt: true } },
        },
      })
    ),
    byClient(ids, (c) =>
      db.progressNote.findMany({
        where: { clientId: { in: c }, OR: [{ part2: true }, { body: { contains: 'part2="true"' } }] },
        select: { clientId: true },
        distinct: ['clientId'],
      })
    ),
    byClient(ids, (c) =>
      db.clinicalAssessmentRecord.findMany({
        where: { organizationId, clientId: { in: c }, instrumentId: { in: Object.keys(ASSESSMENT_LOINC) } },
        select: {
          id: true, clientId: true, instrumentId: true, instrumentName: true, totalScore: true, severity: true,
          administeredById: true, createdAt: true,
        },
      })
    ),
  ]);

  return {
    organization,
    locations,
    users: users.map((u) => ({ ...u, role: String(u.role), status: String(u.status) })),
    clients: clients.map((c) => ({
      ...c,
      status: String(c.status),
      // Any SensitiveRecord marks the client restricted (fail closed)
      sensitiveRecord: c.sensitiveRecord ? { noteClassification: c.sensitiveRecord.noteClassification } : null,
    })),
    problems,
    medications,
    allergies,
    appointments: appointments.map((a) => ({ ...a, status: String(a.status) })),
    medicalVisits,
    notes: notes.map((n) => ({ ...n, workflow: n.workflow ? { ...n.workflow, status: String(n.workflow.status) } : null })),
    part2NoteClientIds: part2Flags.map((p) => p.clientId),
    assessments,
  };
}
