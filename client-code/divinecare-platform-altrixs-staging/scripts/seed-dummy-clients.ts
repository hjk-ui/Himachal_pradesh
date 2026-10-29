/**
 * Seed 10 realistic dummy clients into a clinic org for demo/testing.
 *
 *   npm run db:seed:dummy-clients
 *   SEED_ORG_SLUG=altrixs npm run db:seed:dummy-clients
 */
import "dotenv/config";
import { PrismaClient, RiskLevel, ClientStatus } from "@prisma/client";

const prisma = new PrismaClient();
const ORG_SLUG = process.env.SEED_ORG_SLUG?.trim() || "altrixs";
const ASSIGNEE_EMAILS = (process.env.SEED_ASSIGNEE_EMAILS || "gaurav@mindaptix.com,altrixs@email.com")
  .split(",")
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

const DUMMY: Array<{
  name: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  insurancePayer: string;
  insuranceMemberId: string;
  insuranceGroupNumber: string;
  primaryDiagnosis: string;
  primaryDiagnosisCode: string;
  secondaryDiagnoses?: string;
  status: ClientStatus;
  riskLevel: RiskLevel;
  checkInStreak: number;
}> = [
  {
    name: "Aisha Rahman",
    email: "aisha.rahman@example.com",
    phone: "(415) 555-0142",
    dateOfBirth: "1992-03-14",
    gender: "Female",
    addressLine1: "842 Valencia St",
    city: "San Francisco",
    state: "CA",
    postalCode: "94110",
    emergencyContactName: "Omar Rahman",
    emergencyContactPhone: "(415) 555-0198",
    insurancePayer: "Blue Cross Blue Shield",
    insuranceMemberId: "BCBS-88421093",
    insuranceGroupNumber: "GRP-44102",
    primaryDiagnosis: "Major depressive disorder, single episode, moderate",
    primaryDiagnosisCode: "F32.1",
    secondaryDiagnoses: "Generalized anxiety disorder (F41.1)",
    status: "ACTIVE",
    riskLevel: "LOW",
    checkInStreak: 12,
  },
  {
    name: "Marcus Chen",
    email: "marcus.chen@example.com",
    phone: "(650) 555-0177",
    dateOfBirth: "1987-11-02",
    gender: "Male",
    addressLine1: "221 Castro St Apt 4B",
    city: "Mountain View",
    state: "CA",
    postalCode: "94041",
    emergencyContactName: "Linda Chen",
    emergencyContactPhone: "(650) 555-0110",
    insurancePayer: "Aetna",
    insuranceMemberId: "AET-30918827",
    insuranceGroupNumber: "GRP-77201",
    primaryDiagnosis: "Generalized anxiety disorder",
    primaryDiagnosisCode: "F41.1",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    checkInStreak: 5,
  },
  {
    name: "Sofia Alvarez",
    email: "sofia.alvarez@example.com",
    phone: "(408) 555-0133",
    dateOfBirth: "1995-07-28",
    gender: "Female",
    addressLine1: "910 Bird Ave",
    city: "San Jose",
    state: "CA",
    postalCode: "95125",
    emergencyContactName: "Diego Alvarez",
    emergencyContactPhone: "(408) 555-0165",
    insurancePayer: "Medicaid",
    insuranceMemberId: "MED-55102938",
    insuranceGroupNumber: "CA-MEDI-09",
    primaryDiagnosis: "PTSD",
    primaryDiagnosisCode: "F43.10",
    secondaryDiagnoses: "Insomnia disorder (F51.01)",
    status: "ACTIVE",
    riskLevel: "HIGH",
    checkInStreak: 2,
  },
  {
    name: "James Okafor",
    email: "james.okafor@example.com",
    phone: "(510) 555-0188",
    dateOfBirth: "1980-01-19",
    gender: "Male",
    addressLine1: "1442 Telegraph Ave",
    city: "Oakland",
    state: "CA",
    postalCode: "94612",
    emergencyContactName: "Ngozi Okafor",
    emergencyContactPhone: "(510) 555-0122",
    insurancePayer: "UnitedHealthcare",
    insuranceMemberId: "UHC-77264110",
    insuranceGroupNumber: "GRP-33018",
    primaryDiagnosis: "Bipolar II disorder",
    primaryDiagnosisCode: "F31.81",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    checkInStreak: 8,
  },
  {
    name: "Priya Nair",
    email: "priya.nair@example.com",
    phone: "(925) 555-0149",
    dateOfBirth: "1998-09-05",
    gender: "Female",
    addressLine1: "55 Railroad Ave",
    city: "Danville",
    state: "CA",
    postalCode: "94526",
    emergencyContactName: "Anil Nair",
    emergencyContactPhone: "(925) 555-0171",
    insurancePayer: "Kaiser Permanente",
    insuranceMemberId: "KP-11829475",
    insuranceGroupNumber: "GRP-90512",
    primaryDiagnosis: "Social anxiety disorder",
    primaryDiagnosisCode: "F40.10",
    status: "ACTIVE",
    riskLevel: "LOW",
    checkInStreak: 21,
  },
  {
    name: "Elena Vasquez",
    email: "elena.vasquez@example.com",
    phone: "(831) 555-0155",
    dateOfBirth: "1975-04-22",
    gender: "Female",
    addressLine1: "308 Ocean St",
    city: "Santa Cruz",
    state: "CA",
    postalCode: "95060",
    emergencyContactName: "Miguel Vasquez",
    emergencyContactPhone: "(831) 555-0190",
    insurancePayer: "Cigna",
    insuranceMemberId: "CIG-64028193",
    insuranceGroupNumber: "GRP-22841",
    primaryDiagnosis: "Adjustment disorder with mixed anxiety and depressed mood",
    primaryDiagnosisCode: "F43.23",
    status: "INACTIVE",
    riskLevel: "LOW",
    checkInStreak: 0,
  },
  {
    name: "Noah Patel",
    email: "noah.patel@example.com",
    phone: "(707) 555-0128",
    dateOfBirth: "2001-12-11",
    gender: "Male",
    addressLine1: "18 Healdsburg Ave",
    city: "Healdsburg",
    state: "CA",
    postalCode: "95448",
    emergencyContactName: "Meera Patel",
    emergencyContactPhone: "(707) 555-0160",
    insurancePayer: "Blue Shield of California",
    insuranceMemberId: "BSC-90218374",
    insuranceGroupNumber: "GRP-66103",
    primaryDiagnosis: "ADHD, predominantly inattentive",
    primaryDiagnosisCode: "F90.0",
    status: "ACTIVE",
    riskLevel: "LOW",
    checkInStreak: 15,
  },
  {
    name: "Grace Kim",
    email: "grace.kim@example.com",
    phone: "(415) 555-0166",
    dateOfBirth: "1989-06-30",
    gender: "Female",
    addressLine1: "1200 Geary Blvd Unit 12",
    city: "San Francisco",
    state: "CA",
    postalCode: "94109",
    emergencyContactName: "David Kim",
    emergencyContactPhone: "(415) 555-0139",
    insurancePayer: "Anthem",
    insuranceMemberId: "ANT-44102918",
    insuranceGroupNumber: "GRP-15077",
    primaryDiagnosis: "Panic disorder",
    primaryDiagnosisCode: "F41.0",
    secondaryDiagnoses: "Agoraphobia (F40.00)",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    checkInStreak: 4,
  },
  {
    name: "Tyrone Brooks",
    email: "tyrone.brooks@example.com",
    phone: "(510) 555-0199",
    dateOfBirth: "1972-08-08",
    gender: "Male",
    addressLine1: "670 International Blvd",
    city: "Oakland",
    state: "CA",
    postalCode: "94606",
    emergencyContactName: "Sharon Brooks",
    emergencyContactPhone: "(510) 555-0144",
    insurancePayer: "Medicare",
    insuranceMemberId: "MCR-1EG4TE5MK72",
    insuranceGroupNumber: "N/A",
    primaryDiagnosis: "Persistent depressive disorder (dysthymia)",
    primaryDiagnosisCode: "F34.1",
    status: "DISCHARGED",
    riskLevel: "LOW",
    checkInStreak: 0,
  },
  {
    name: "Hannah Brooks",
    email: "hannah.brooks@example.com",
    phone: "(925) 555-0107",
    dateOfBirth: "1994-02-17",
    gender: "Non-binary",
    addressLine1: "401 Hartz Ave",
    city: "Danville",
    state: "CA",
    postalCode: "94526",
    emergencyContactName: "Jordan Brooks",
    emergencyContactPhone: "(925) 555-0182",
    insurancePayer: "Health Net",
    insuranceMemberId: "HN-88301462",
    insuranceGroupNumber: "GRP-44890",
    primaryDiagnosis: "Obsessive-compulsive disorder",
    primaryDiagnosisCode: "F42.2",
    status: "ACTIVE",
    riskLevel: "MEDIUM",
    checkInStreak: 9,
  },
];

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    include: {
      locations: { where: { isPrimary: true }, take: 1 },
      users: {
        where: {
          email: { in: ASSIGNEE_EMAILS },
          status: "ACTIVE",
        },
      },
    },
  });

  if (!org) {
    throw new Error(`Organization "${ORG_SLUG}" not found. Create clinic first.`);
  }

  const locationId = org.locations[0]?.id;
  if (!locationId) {
    throw new Error("No primary location on Altrixs org.");
  }

  const assignee =
    ASSIGNEE_EMAILS.map((email) => org.users.find((u) => u.email === email)).find(Boolean) ??
    (await prisma.user.findFirst({
      where: { organizationId: org.id, status: "ACTIVE", role: { in: ["CLINICIAN", "ADMIN"] } },
    }));

  if (!assignee) {
    throw new Error("No active clinician/admin to assign clients to.");
  }

  let created = 0;
  let skipped = 0;

  for (const row of DUMMY) {
    const existing = await prisma.client.findFirst({
      where: { email: row.email },
    });
    if (existing) {
      skipped += 1;
      console.log(`skip (exists): ${row.name}`);
      continue;
    }

    const active = row.status === "ACTIVE";
    await prisma.client.create({
      data: {
        name: row.name,
        email: row.email,
        phone: row.phone,
        dateOfBirth: new Date(row.dateOfBirth),
        gender: row.gender,
        addressLine1: row.addressLine1,
        city: row.city,
        state: row.state,
        postalCode: row.postalCode,
        emergencyContactName: row.emergencyContactName,
        emergencyContactPhone: row.emergencyContactPhone,
        insurancePayer: row.insurancePayer,
        insuranceMemberId: row.insuranceMemberId,
        insuranceGroupNumber: row.insuranceGroupNumber,
        primaryDiagnosis: row.primaryDiagnosis,
        primaryDiagnosisCode: row.primaryDiagnosisCode,
        secondaryDiagnoses: row.secondaryDiagnoses ?? null,
        status: row.status,
        active,
        riskLevel: row.riskLevel,
        checkInStreak: row.checkInStreak,
        locationId,
        assignedToId: assignee.id,
      },
    });
    created += 1;
    console.log(`created: ${row.name}`);
  }

  // Also seed a few into M.D clinic location if it exists (unassigned org demo)
  const md = await prisma.organization.findFirst({
    where: { slug: "m-d-clinic" },
    include: { locations: { where: { isPrimary: true }, take: 1 } },
  });
  if (md?.locations[0]) {
    console.log(`\nNote: M.D clinic has no staff users yet — skipped seeding there.`);
    console.log(`Invite an owner for "${md.name}" first, then re-run if needed.`);
  }

  console.log(`\nDone. created=${created} skipped=${skipped}`);
  console.log(`Org: ${org.name}`);
  console.log(`Location: ${org.locations[0].name} (${locationId})`);
  console.log(`Assigned to: ${assignee.email} (${assignee.role})`);
  console.log(`\nLogin as admin (see all) or gaurav@mindaptix.com (assigned clients) → /dashboard/clients`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
