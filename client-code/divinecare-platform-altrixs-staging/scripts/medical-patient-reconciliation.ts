/**
 * READ-ONLY report: MedicalPatient rows vs Client rows (one patient record).
 *
 *   npx tsx scripts/medical-patient-reconciliation.ts [organizationId]
 *
 * Prints ids and MRNs only (no names or dates of birth). Nothing is written: linking or
 * retiring a MedicalPatient row is a manual decision for a practice director. See
 * src/lib/medical/reconciliation.ts for the categories.
 */
import { PrismaClient } from '@prisma/client';
import { reconcileMedicalPatients } from '../src/lib/medical/reconciliation';

const prisma = new PrismaClient();
/** Placeholder DOB written when none was documented (src/app/api/medical/_lib/demographics.ts) */
const SENTINEL = '1990-01-01';
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

async function main() {
  const orgFilter = process.argv[2];
  const orgs = await prisma.organization.findMany({
    where: orgFilter ? { id: orgFilter } : {},
    select: { id: true },
  });
  for (const org of orgs) {
    const patients = await prisma.medicalPatient.findMany({
      where: { organizationId: org.id },
      select: { id: true, mrn: true, name: true, dob: true, dateOfBirth: true, bhClientId: true },
    });
    if (!patients.length) continue;
    const clients = await prisma.client.findMany({
      where: { organizationId: org.id },
      select: {
        id: true, mrn: true, name: true, legalFirstName: true, legalLastName: true, dateOfBirth: true,
        _count: { select: { medicalVisits: true, medicalVitals: true, medicalCharges: true } },
      },
    });
    const rows = reconcileMedicalPatients(
      patients.map((p) => {
        const stored = day(p.dateOfBirth);
        const dob = day(p.dob) ?? (stored === SENTINEL ? null : stored);
        return { id: p.id, mrn: p.mrn, name: p.name, dob, bhClientId: p.bhClientId };
      }),
      clients.map((c) => ({
        id: c.id,
        mrn: c.mrn,
        name: c.name,
        legalFirstName: c.legalFirstName,
        legalLastName: c.legalLastName,
        dob: day(c.dateOfBirth),
        hasPrimaryCareRecords: c._count.medicalVisits + c._count.medicalVitals + c._count.medicalCharges > 0,
      }))
    );
    const counts = rows.reduce<Record<string, number>>((acc, r) => ((acc[r.status] = (acc[r.status] ?? 0) + 1), acc), {});
    console.log(`\nOrganization ${org.id}: ${rows.length} MedicalPatient rows`, counts);
    for (const r of rows.filter((x) => x.status !== 'linked_primary_care')) {
      console.log(
        `  ${r.status.padEnd(20)} medicalPatient=${r.medicalPatientId} mrn=${r.mrn}` +
          (r.clientId ? ` client=${r.clientId}` : '') +
          (r.candidateClientIds.length ? ` candidates=${r.candidateClientIds.join(',')}` : '')
      );
    }
  }
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
