-- ============================================================================
-- MIGRATION: 20261022_hr_standard.sql
-- TARGET: PostgreSQL 12+. Idempotent: safe to run more than once.
-- WHY: HR to industry standard (HRIS + healthcare credentialing): one employee record,
--   credential primary-source verification, compliance items (TB, immunizations, background,
--   fingerprints, I-9, CAQH, Maryland Medicaid ePREP), monthly exclusion checks, onboarding /
--   offboarding checklists, in-app HR reminders, training requirements + CEUs, time off with a
--   ledger, performance reviews / goals, discipline, self-service change requests, policy
--   documents + acknowledgments, and HR policy settings. /dashboard/hr/*.
-- ADDS:
--   * enum values StaffCredentialType: CDS, BOARD_CERTIFICATION, CPR_BLS (not used in this file)
--   * columns on "StaffCredential" (state, license type, verification, details)
--   * columns on "StaffHrProfile" (personal, employment, compensation summary, CAQH / Medicaid ids)
--   * tables staff_compliance_records, hr_exclusion_checks, hr_documents, hr_checklist_templates,
--     hr_checklists, hr_checklist_tasks, hr_tasks, hr_training_requirements,
--     hr_training_completions, hr_time_off_requests, hr_time_off_ledger, hr_performance_reviews,
--     hr_goals, hr_discipline_records, hr_profile_change_requests, hr_policy_documents,
--     hr_policy_acknowledgments, hr_settings
-- NOT STORED: SSN, bank / routing numbers, I-9 document images (unless a practice setting says
--   so), client names or any client PHI (caseload handoff keeps a count only).
-- NOT TOUCHED: no rows are seeded. Regulatory numbers (CEU hours, sick-leave caps) start null
--   ("practice policy, confirm"), except the HWFA 1-per-30 accrual default, CAQH 120 days and a
--   30-day exclusion interval, all editable and labeled for confirmation in HR settings.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'StaffCredentialType') THEN
    ALTER TYPE "StaffCredentialType" ADD VALUE IF NOT EXISTS 'CDS';
    ALTER TYPE "StaffCredentialType" ADD VALUE IF NOT EXISTS 'BOARD_CERTIFICATION';
    ALTER TYPE "StaffCredentialType" ADD VALUE IF NOT EXISTS 'CPR_BLS';
  END IF;
END $$;

ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "credentialState" VARCHAR(2);
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "licenseType" TEXT;
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "verificationMethod" TEXT;
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "verifiedById" TEXT;
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "verifiedByName" TEXT;
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "verificationRef" TEXT;
ALTER TABLE "StaffCredential" ADD COLUMN IF NOT EXISTS "details" JSONB;

ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "legalFirstName" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "legalMiddleName" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "legalLastName" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "preferredName" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "pronouns" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "dateOfBirth" DATE;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "personalEmail" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "personalPhone" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "workPhone" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "addressLine1" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "addressLine2" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "city" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "state" VARCHAR(2);
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "postalCode" VARCHAR(10);
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "emergencyContacts" JSONB;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "employeeNumber" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "workerType" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "fte" DOUBLE PRECISION;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "programs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "managerUserId" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "clinicalSupervisorUserId" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "terminationDate" DATE;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "separationType" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "rehireEligible" BOOLEAN;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "payType" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "payRateCents" INTEGER;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "compEffectiveOn" DATE;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "payrollSystem" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "payrollExternalId" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "caqhId" TEXT;
ALTER TABLE "StaffHrProfile" ADD COLUMN IF NOT EXISTS "medicaidProviderId" TEXT;
CREATE INDEX IF NOT EXISTS "StaffHrProfile_managerUserId_idx" ON "StaffHrProfile" ("managerUserId");

CREATE TABLE IF NOT EXISTS staff_compliance_records (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "label"          TEXT,
  "completedOn"    DATE,
  "expiresOn"      DATE,
  "status"         TEXT NOT NULL DEFAULT 'complete',
  "result"         TEXT,
  "identifier"     TEXT,
  "verifiedById"   TEXT,
  "verifiedByName" TEXT,
  "notes"          TEXT,
  "documentId"     TEXT,
  "createdById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "staff_compliance_records_organizationId_kind_idx" ON staff_compliance_records ("organizationId", "kind");
CREATE INDEX IF NOT EXISTS "staff_compliance_records_organizationId_userId_idx" ON staff_compliance_records ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_exclusion_checks (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "source"         TEXT NOT NULL,
  "checkedOn"      DATE NOT NULL,
  "result"         TEXT NOT NULL,
  "reference"      TEXT,
  "notes"          TEXT,
  "checkedById"    TEXT NOT NULL,
  "checkedByName"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_exclusion_checks_org_user_source_idx" ON hr_exclusion_checks ("organizationId", "userId", "source", "checkedOn");

CREATE TABLE IF NOT EXISTS hr_documents (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "category"          TEXT NOT NULL,
  "title"             TEXT NOT NULL,
  "fileName"          TEXT NOT NULL,
  "storedName"        TEXT NOT NULL,
  "mimeType"          TEXT,
  "sizeBytes"         INTEGER,
  "expiresOn"         DATE,
  "visibleToEmployee" BOOLEAN NOT NULL DEFAULT TRUE,
  "restricted"        BOOLEAN NOT NULL DEFAULT FALSE,
  "source"            TEXT NOT NULL DEFAULT 'hr',
  "status"            TEXT NOT NULL DEFAULT 'active',
  "uploadedById"      TEXT NOT NULL,
  "uploadedByName"    TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_documents_organizationId_userId_idx" ON hr_documents ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_checklist_templates (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "roles"          TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "items"          JSONB NOT NULL,
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "updatedById"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_checklist_templates_org_kind_active_idx" ON hr_checklist_templates ("organizationId", "kind", "active");

CREATE TABLE IF NOT EXISTS hr_checklists (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "templateId"     TEXT,
  "templateName"   TEXT NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'active',
  "startOn"        DATE NOT NULL,
  "meta"           JSONB,
  "createdById"    TEXT NOT NULL,
  "completedAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_checklists_org_kind_status_idx" ON hr_checklists ("organizationId", "kind", "status");
CREATE INDEX IF NOT EXISTS "hr_checklists_org_user_idx" ON hr_checklists ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_checklist_tasks (
  "id"              TEXT PRIMARY KEY,
  "organizationId"  TEXT NOT NULL,
  "checklistId"     TEXT NOT NULL,
  "userId"          TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "label"           TEXT NOT NULL,
  "category"        TEXT NOT NULL,
  "ownerType"       TEXT NOT NULL,
  "assigneeUserId"  TEXT,
  "dueOn"           DATE,
  "sortOrder"       INTEGER NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'open',
  "completedAt"     TIMESTAMP(3),
  "completedById"   TEXT,
  "completedByName" TEXT,
  "note"            TEXT,
  "requiresAck"     BOOLEAN NOT NULL DEFAULT FALSE,
  "acknowledgedAt"  TIMESTAMP(3),
  "requiresUpload"  BOOLEAN NOT NULL DEFAULT FALSE,
  "documentId"      TEXT,
  "systemAction"    TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_checklist_tasks_org_checklist_idx" ON hr_checklist_tasks ("organizationId", "checklistId");
CREATE INDEX IF NOT EXISTS "hr_checklist_tasks_org_user_status_idx" ON hr_checklist_tasks ("organizationId", "userId", "status");

CREATE TABLE IF NOT EXISTS hr_tasks (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "subjectUserId"  TEXT,
  "audience"       TEXT NOT NULL,
  "assigneeUserId" TEXT,
  "kind"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "detail"         TEXT,
  "dueOn"          DATE,
  "severity"       TEXT NOT NULL DEFAULT 'info',
  "status"         TEXT NOT NULL DEFAULT 'open',
  "sourceType"     TEXT,
  "sourceId"       TEXT,
  "dedupeKey"      TEXT NOT NULL,
  "href"           TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "completedById"  TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_tasks_organizationId_dedupeKey_key" ON hr_tasks ("organizationId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "hr_tasks_org_status_audience_idx" ON hr_tasks ("organizationId", "status", "audience");
CREATE INDEX IF NOT EXISTS "hr_tasks_org_assignee_status_idx" ON hr_tasks ("organizationId", "assigneeUserId", "status");

CREATE TABLE IF NOT EXISTS hr_training_requirements (
  "id"                  TEXT PRIMARY KEY,
  "organizationId"      TEXT NOT NULL,
  "key"                 TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "category"            TEXT NOT NULL DEFAULT 'compliance',
  "frequencyMonths"     INTEGER,
  "roles"               TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dueWithinDaysOfHire" INTEGER,
  "active"              BOOLEAN NOT NULL DEFAULT TRUE,
  "policyNote"          TEXT,
  "updatedById"         TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_training_requirements_organizationId_key_key" ON hr_training_requirements ("organizationId", "key");

CREATE TABLE IF NOT EXISTS hr_training_completions (
  "id"                    TEXT PRIMARY KEY,
  "organizationId"        TEXT NOT NULL,
  "userId"                TEXT NOT NULL,
  "requirementId"         TEXT,
  "title"                 TEXT NOT NULL,
  "completedOn"           DATE NOT NULL,
  "expiresOn"             DATE,
  "hours"                 DOUBLE PRECISION,
  "ceuEligible"           BOOLEAN NOT NULL DEFAULT FALSE,
  "credentialId"          TEXT,
  "provider"              TEXT,
  "certificateNumber"     TEXT,
  "certificateDocumentId" TEXT,
  "status"                TEXT NOT NULL DEFAULT 'verified',
  "source"                TEXT NOT NULL DEFAULT 'hr',
  "recordedById"          TEXT NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_training_completions_org_user_idx" ON hr_training_completions ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "hr_training_completions_org_req_idx" ON hr_training_completions ("organizationId", "requirementId");

CREATE TABLE IF NOT EXISTS hr_time_off_requests (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "type"              TEXT NOT NULL,
  "startDate"         DATE NOT NULL,
  "endDate"           DATE NOT NULL,
  "hours"             DOUBLE PRECISION NOT NULL,
  "note"              TEXT,
  "status"            TEXT NOT NULL DEFAULT 'pending',
  "approverId"        TEXT,
  "approverName"      TEXT,
  "decidedAt"         TIMESTAMP(3),
  "decisionNote"      TEXT,
  "scheduleConflicts" INTEGER,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_time_off_requests_org_status_idx" ON hr_time_off_requests ("organizationId", "status");
CREATE INDEX IF NOT EXISTS "hr_time_off_requests_org_user_start_idx" ON hr_time_off_requests ("organizationId", "userId", "startDate");

CREATE TABLE IF NOT EXISTS hr_time_off_ledger (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "bucket"         TEXT NOT NULL,
  "entryType"      TEXT NOT NULL,
  "hours"          DOUBLE PRECISION NOT NULL,
  "effectiveOn"    DATE NOT NULL,
  "hoursWorked"    DOUBLE PRECISION,
  "requestId"      TEXT,
  "note"           TEXT,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_time_off_ledger_org_user_bucket_idx" ON hr_time_off_ledger ("organizationId", "userId", "bucket");

CREATE TABLE IF NOT EXISTS hr_performance_reviews (
  "id"                TEXT PRIMARY KEY,
  "organizationId"    TEXT NOT NULL,
  "userId"            TEXT NOT NULL,
  "reviewerId"        TEXT,
  "reviewType"        TEXT NOT NULL,
  "periodStart"       DATE,
  "periodEnd"         DATE,
  "dueOn"             DATE,
  "status"            TEXT NOT NULL DEFAULT 'not_started',
  "selfReview"        TEXT,
  "selfSubmittedAt"   TIMESTAMP(3),
  "managerNotes"      TEXT,
  "managerReview"     TEXT,
  "overallRating"     TEXT,
  "metrics"           JSONB,
  "aiDraftUsed"       BOOLEAN NOT NULL DEFAULT FALSE,
  "managerSignedAt"   TIMESTAMP(3),
  "managerSignedById" TEXT,
  "employeeAckAt"     TIMESTAMP(3),
  "employeeComment"   TEXT,
  "createdById"       TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_performance_reviews_org_user_idx" ON hr_performance_reviews ("organizationId", "userId");
CREATE INDEX IF NOT EXISTS "hr_performance_reviews_org_status_idx" ON hr_performance_reviews ("organizationId", "status");

CREATE TABLE IF NOT EXISTS hr_goals (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "description"    TEXT,
  "dueOn"          DATE,
  "status"         TEXT NOT NULL DEFAULT 'not_started',
  "progressPct"    INTEGER NOT NULL DEFAULT 0,
  "reviewId"       TEXT,
  "createdById"    TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_goals_org_user_idx" ON hr_goals ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_discipline_records (
  "id"                 TEXT PRIMARY KEY,
  "organizationId"     TEXT NOT NULL,
  "userId"             TEXT NOT NULL,
  "actionType"         TEXT NOT NULL,
  "issuedOn"           DATE NOT NULL,
  "summary"            TEXT NOT NULL,
  "expectations"       TEXT,
  "issuedById"         TEXT NOT NULL,
  "issuedByName"       TEXT,
  "sharedWithEmployee" BOOLEAN NOT NULL DEFAULT TRUE,
  "employeeAckAt"      TIMESTAMP(3),
  "employeeComment"    TEXT,
  "documentId"         TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_discipline_records_org_user_idx" ON hr_discipline_records ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_profile_change_requests (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "changes"        JSONB NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'pending',
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "reviewNote"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_profile_change_requests_org_status_idx" ON hr_profile_change_requests ("organizationId", "status");

CREATE TABLE IF NOT EXISTS hr_policy_documents (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "kind"           TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "version"        TEXT NOT NULL,
  "effectiveOn"    DATE,
  "sections"       JSONB NOT NULL,
  "requiresAck"    BOOLEAN NOT NULL DEFAULT TRUE,
  "active"         BOOLEAN NOT NULL DEFAULT TRUE,
  "uploadedById"   TEXT NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "hr_policy_documents_org_active_idx" ON hr_policy_documents ("organizationId", "active");

CREATE TABLE IF NOT EXISTS hr_policy_acknowledgments (
  "id"             TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL,
  "policyId"       TEXT NOT NULL,
  "userId"         TEXT NOT NULL,
  "version"        TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_policy_acknowledgments_policyId_userId_version_key" ON hr_policy_acknowledgments ("policyId", "userId", "version");
CREATE INDEX IF NOT EXISTS "hr_policy_acknowledgments_org_user_idx" ON hr_policy_acknowledgments ("organizationId", "userId");

CREATE TABLE IF NOT EXISTS hr_settings (
  "id"                                TEXT PRIMARY KEY,
  "organizationId"                    TEXT NOT NULL,
  "blockSchedulingWhenLicenseExpired" BOOLEAN NOT NULL DEFAULT FALSE,
  "dueSoonDays"                       INTEGER NOT NULL DEFAULT 60,
  "urgentDays"                        INTEGER NOT NULL DEFAULT 30,
  "caqhAttestationDays"               INTEGER NOT NULL DEFAULT 120,
  "exclusionCheckIntervalDays"        INTEGER NOT NULL DEFAULT 30,
  "sickAccrualHoursWorked"            DOUBLE PRECISION DEFAULT 30,
  "sickAnnualAccrualCap"              DOUBLE PRECISION,
  "sickBalanceCap"                    DOUBLE PRECISION,
  "sickAnnualUsageCap"                DOUBLE PRECISION,
  "ptoPolicy"                         JSONB,
  "ceuRequirements"                   JSONB,
  "immunizationPolicy"                JSONB,
  "cprRequiredRoles"                  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "i9StoreDocumentImages"             BOOLEAN NOT NULL DEFAULT FALSE,
  "aiDocumentExtract"                 BOOLEAN NOT NULL DEFAULT FALSE,
  "aiWritingDrafts"                   BOOLEAN NOT NULL DEFAULT FALSE,
  "aiReviewAssistant"                 BOOLEAN NOT NULL DEFAULT FALSE,
  "aiPolicyQa"                        BOOLEAN NOT NULL DEFAULT FALSE,
  "aiDigest"                          BOOLEAN NOT NULL DEFAULT FALSE,
  "policyConfirmedAt"                 TIMESTAMP(3),
  "policyConfirmedById"               TEXT,
  "updatedById"                       TEXT,
  "createdAt"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "hr_settings_organizationId_key" ON hr_settings ("organizationId");
