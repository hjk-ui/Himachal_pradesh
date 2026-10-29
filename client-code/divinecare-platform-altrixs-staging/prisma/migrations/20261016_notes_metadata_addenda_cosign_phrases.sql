-- Progress note metadata as real columns (older notes keep it in a hidden comment in body)
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "noteType" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "dateOfService" TIMESTAMP(3);
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "durationMinutes" INTEGER;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "cptCode" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "placeOfService" TEXT;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "telehealth" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "part2" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgressNote" ADD COLUMN IF NOT EXISTS "aiDrafted" BOOLEAN NOT NULL DEFAULT false;

-- Signer, attestation and supervisor co-sign
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "signedById" TEXT;
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "signedByName" TEXT;
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "attestedAt" TIMESTAMP(3);
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "cosignRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "cosignedById" TEXT;
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "cosignedByName" TEXT;
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "cosignedAt" TIMESTAMP(3);
ALTER TABLE "ProgressNoteWorkflow" ADD COLUMN IF NOT EXISTS "supervisorComment" TEXT;

-- Addenda: separate rows; the signed note body never changes
CREATE TABLE IF NOT EXISTS "ProgressNoteAddendum" (
  "id" TEXT NOT NULL,
  "noteId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "authorId" TEXT,
  "authorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProgressNoteAddendum_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProgressNoteAddendum_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "ProgressNote"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProgressNoteAddendum_noteId_createdAt_idx" ON "ProgressNoteAddendum" ("noteId", "createdAt");

-- Smart phrases (ownerId NULL = shared across the organization)
CREATE TABLE IF NOT EXISTS "SmartPhrase" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "ownerId" TEXT,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SmartPhrase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SmartPhrase_organizationId_ownerId_idx" ON "SmartPhrase" ("organizationId", "ownerId");
