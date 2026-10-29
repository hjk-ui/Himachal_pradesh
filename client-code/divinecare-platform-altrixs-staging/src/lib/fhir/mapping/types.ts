/**
 * Plain input shapes for the FHIR mappers — the columns the HealthLake snapshot loader
 * selects from Prisma. Kept structural so mapping stays pure and fixture-testable.
 */

export type OrgRow = { id: string; name: string; active: boolean };

export type LocationRow = {
  id: string;
  organizationId: string;
  name: string;
  code: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  active: boolean;
};

export type UserRow = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: string;
  npi: string | null;
  licenseNumber: string | null;
};

export type ClientRow = {
  id: string;
  organizationId: string | null;
  name: string;
  legalFirstName: string | null;
  middleInitial: string | null;
  legalLastName: string | null;
  email: string | null;
  phone: string | null;
  phoneSecondary: string | null;
  status: string;
  mrn: string | null;
  sourcePlatform: string | null;
  sourceId: string | null;
  dateOfBirth: Date | null;
  gender: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  primaryDiagnosis: string | null;
  primaryDiagnosisCode: string | null;
  secondaryDiagnoses: string | null;
  assignedToId: string | null;
  sensitiveRecord: { noteClassification: string | null } | null;
  /** Standard demographics (20261019_client_demographics_standard.sql); optional for older callers */
  legalMiddleName?: string | null;
  nameSuffix?: string | null;
  preferredName?: string | null;
  administrativeSex?: string | null;
  sexAtBirth?: string | null;
  genderIdentity?: string | null;
  pronouns?: string | null;
  race?: string[] | null;
  ethnicity?: string | null;
  preferredLanguage?: string | null;
  interpreterNeeded?: boolean | null;
  maritalStatus?: string | null;
  county?: string | null;
  phoneType?: string | null;
  phoneSecondaryType?: string | null;
  emergencyContactRelationship?: string | null;
  guardianName?: string | null;
  guardianRelationship?: string | null;
  guardianPhone?: string | null;
  medicaidId?: string | null;
  deceasedAt?: Date | null;
};

export type MedicalProblemRow = {
  id: string;
  clientId: string;
  icd10Code: string | null;
  name: string;
  description: string | null;
  status: string;
  onsetDate: Date | null;
  resolvedDate: Date | null;
  source: string | null;
  rcopiaProblemId: string | null;
  createdAt: Date;
};

export type MedicationRow = {
  id: string;
  clientId: string;
  medicationName: string;
  dosage: string;
  route: string | null;
  frequency: string | null;
  indication: string | null;
  startDate: Date;
  endDate: Date | null;
  stopDate: Date | null;
  active: boolean;
  status: string;
  source: string;
  drugName: string | null;
  brandName: string | null;
  genericName: string | null;
  ndcCode: string | null;
  rxnormId: string | null;
  dosageText: string | null;
  asNeeded: boolean;
  prnReason: string | null;
  rcopiaMedId: string | null;
  prescribedById: string | null;
  createdAt: Date;
};

export type AllergyRow = {
  id: string;
  clientId: string | null;
  allergen: string;
  reaction: string | null;
  severity: string;
  status: string;
  source: string | null;
  rcopiaAllergyId: string | null;
  createdAt: Date;
};

export type AppointmentRow = {
  id: string;
  clientId: string;
  clinicianId: string | null;
  type: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  isVirtual: boolean;
};

export type MedicalVisitRow = {
  id: string;
  clientId: string;
  providerId: string | null;
  visitDate: Date;
  visitType: string;
  cptCode: string | null;
  icd10Codes: string[];
  status: string;
  signedAt: Date | null;
};

export type ProgressNoteRow = {
  id: string;
  clientId: string;
  clinicianId: string | null;
  body: string;
  noteType: string | null;
  dateOfService: Date | null;
  part2: boolean;
  createdAt: Date;
  workflow: {
    status: string;
    signedAt: Date | null;
    lockedAt: Date | null;
    body: string;
    signedById: string | null;
    cosignedById: string | null;
  } | null;
  addenda: Array<{ id: string; reason: string; text: string; authorName: string | null; createdAt: Date }>;
};

export type AssessmentRow = {
  id: string;
  clientId: string;
  instrumentId: string;
  instrumentName: string;
  totalScore: number | null;
  severity: string | null;
  administeredById: string | null;
  createdAt: Date;
};

export type OrgSnapshot = {
  organization: OrgRow;
  locations: LocationRow[];
  users: UserRow[];
  clients: ClientRow[];
  problems: MedicalProblemRow[];
  medications: MedicationRow[];
  allergies: AllergyRow[];
  appointments: AppointmentRow[];
  medicalVisits: MedicalVisitRow[];
  notes: ProgressNoteRow[];
  assessments: AssessmentRow[];
  /** Clients with any Part 2 flagged note, drafts included (classification only) */
  part2NoteClientIds?: string[];
};
