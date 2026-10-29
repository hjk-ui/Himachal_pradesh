import { Prisma, type Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { LockedNoteSnapshot, ProgressNoteStatus } from './workflow';
import { isCaseloadRole } from '@/types/roles';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { noteTransition } from './transitions';
import { evaluateTreatmentPlanSignGate } from './maryland-sign-gate';
import { evaluateDiagnosisSignGate } from '@/lib/diagnoses/signGate';
import {
  evaluateTranscriptRiskGate,
  noteNeedsRiskAttestation,
} from '@/lib/scribe-safety/transcriptRiskGate';

type WorkflowResult =
  | {
      ok: true;
      status: ProgressNoteStatus;
      snapshot: LockedNoteSnapshot | null;
      exceptionLabel?: string;
    }
  | { ok: false; status: number; error: string; code?: string };

type WorkflowRow = {
  noteId: string;
  status: string;
  signedAt: Date | null;
  lockedAt: Date | null;
  clientId: string;
  clientName: string;
  clientImage: string | null;
  clinicianId: string | null;
  clinicianName: string | null;
  clinicianImage: string | null;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

type NoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  client: { id: string; name: string; image: string | null };
  clinician: { id: string; name: string | null; image: string | null } | null;
  aiProvenance: unknown;
  transcriptRiskFlagged: boolean;
  riskAttestation: string | null;
};

let schemaReady = false;

function clientOrgWhere(organizationId: string) {
  return clientOrgFilter(organizationId);
}

function toPublicStatus(status: string | null | undefined): ProgressNoteStatus {
  if (status === 'SIGNED') return 'Signed';
  if (status === 'LOCKED') return 'Locked';
  return 'Draft';
}

function snapshotFromWorkflowRow(row: WorkflowRow): LockedNoteSnapshot {
  return {
    noteId: row.noteId,
    clientId: row.clientId,
    clientName: row.clientName,
    clientImage: row.clientImage ?? null,
    clinicianName: row.clinicianName ?? null,
    clinicianImage: row.clinicianImage ?? null,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    lockedAt: row.lockedAt?.toISOString() ?? row.createdAt.toISOString(),
  };
}

async function ensureWorkflowTable() {
  if (schemaReady) return;

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ProgressNoteWorkflow" (
      "noteId" TEXT NOT NULL,
      "status" "ProgressNoteWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
      "signedAt" TIMESTAMP(3),
      "lockedAt" TIMESTAMP(3),
      "clientId" TEXT NOT NULL,
      "clientName" TEXT NOT NULL,
      "clientImage" TEXT,
      "clinicianId" TEXT,
      "clinicianName" TEXT,
      "clinicianImage" TEXT,
      "body" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ProgressNoteWorkflow_pkey" PRIMARY KEY ("noteId")
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_status_lockedAt_idx"
    ON "ProgressNoteWorkflow" ("status", "lockedAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_clientId_lockedAt_idx"
    ON "ProgressNoteWorkflow" ("clientId", "lockedAt")
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "ProgressNoteWorkflow_clinicianId_lockedAt_idx"
    ON "ProgressNoteWorkflow" ("clinicianId", "lockedAt")
  `);

  schemaReady = true;
}

async function getWorkflowRows(noteIds: string[]): Promise<WorkflowRow[]> {
  if (noteIds.length === 0) return [];
  await ensureWorkflowTable();

  return prisma.$queryRaw<WorkflowRow[]>(Prisma.sql`
    SELECT
      "noteId",
      "status",
      "signedAt",
      "lockedAt",
      "clientId",
      "clientName",
      "clientImage",
      "clinicianId",
      "clinicianName",
      "clinicianImage",
      "body",
      "createdAt",
      "updatedAt"
    FROM "ProgressNoteWorkflow"
    WHERE "noteId" IN (${Prisma.join(noteIds)})
  `);
}

async function getNoteRow(noteId: string, organizationId: string): Promise<NoteRow | null> {
  const note = await prisma.progressNote.findFirst({
    where: { id: noteId, client: clientOrgWhere(organizationId) },
    select: {
      id: true,
      body: true,
      createdAt: true,
      aiProvenance: true,
      transcriptRiskFlagged: true,
      riskAttestation: true,
      client: { select: { id: true, name: true, image: true } },
      clinician: { select: { id: true, name: true, image: true } },
    },
  });

  return note as NoteRow | null;
}

export async function updateProgressNoteWorkflow(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  status: Exclude<ProgressNoteStatus, 'Draft'>;
  lateEntryReason?: string | null;
  /** Clinician's words after "Risk content was reviewed; no further assessment indicated because " */
  riskAttestationReason?: string | null;
}): Promise<WorkflowResult> {
  const note = await getNoteRow(input.noteId, input.organizationId);

  if (!note) {
    return { ok: false, status: 404, error: 'Note not found' };
  }

  if (isCaseloadRole(input.actorRole) && note.clinician?.id !== input.actorUserId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }

  await ensureWorkflowTable();

  const existingBeforeTx = await prisma.progressNoteWorkflow.findUnique({
    where: { noteId: note.id },
    select: { status: true },
  });
  const willFinalizeFromDraft =
    !existingBeforeTx || existingBeforeTx.status === 'DRAFT';

  let exceptionLabel: string | undefined;
  if (willFinalizeFromDraft) {
    const gate = await evaluateTreatmentPlanSignGate({
      organizationId: input.organizationId,
      clientId: note.client.id,
      noteBody: note.body,
      noteCreatedAt: note.createdAt,
      lateEntryReason: input.lateEntryReason,
    });
    if (gate.ok === false) {
      return { ok: false, status: 422, error: gate.error };
    }
    exceptionLabel = gate.exceptionLabel;

    const dxGate = await evaluateDiagnosisSignGate({
      organizationId: input.organizationId,
      clientId: note.client.id,
    });
    if (dxGate.ok === false) {
      return { ok: false, status: 422, error: dxGate.error, code: 'DIAGNOSIS_REQUIRED' };
    }

    const riskGate = evaluateTranscriptRiskGate({
      flagged: noteNeedsRiskAttestation(note),
      storedAttestation: note.riskAttestation,
      attestationReason: input.riskAttestationReason,
    });
    if (riskGate.ok === false) {
      return { ok: false, status: 422, error: riskGate.error, code: riskGate.code };
    }
    if (riskGate.attestationText) {
      await prisma.progressNote.update({
        where: { id: note.id },
        data: {
          transcriptRiskFlagged: true,
          riskAttestation: riskGate.attestationText,
          riskAttestedAt: new Date(),
          riskAttestedById: input.actorUserId,
        },
      });
    }
  }

  return prisma.$transaction(
    async (tx): Promise<WorkflowResult> => {
      // Serialize finalization on the durable note even if no workflow row exists yet.
      await tx.$queryRaw(
        Prisma.sql`SELECT "id" FROM "ProgressNote" WHERE "id" = ${note.id} FOR UPDATE`
      );
      const currentNote = await tx.progressNote.findFirst({
        where: { id: note.id, client: clientOrgWhere(input.organizationId) },
        select: {
          id: true,
          body: true,
          createdAt: true,
          client: { select: { id: true, name: true, image: true } },
          clinician: { select: { id: true, name: true, image: true } },
        },
      });
      if (!currentNote) return { ok: false, status: 404, error: 'Note not found' };
      if (isCaseloadRole(input.actorRole) && currentNote.clinician?.id !== input.actorUserId) {
        return { ok: false, status: 403, error: 'Forbidden' };
      }
      const existing = await tx.progressNoteWorkflow.findUnique({ where: { noteId: note.id } });
      const requested = input.status === 'Signed' ? 'SIGNED' : 'LOCKED';
      const transition = noteTransition(existing?.status ?? 'DRAFT', requested);
      if (!transition.allowed) {
        return {
          ok: false,
          status: 409,
          error:
            existing?.status === 'LOCKED'
              ? 'A locked note cannot be reopened. Use an addendum for corrections.'
              : 'Sign the note before locking it.',
        };
      }
      if (!transition.changed && existing) {
        return {
          ok: true,
          status: toPublicStatus(existing.status),
          snapshot: existing.status === 'LOCKED' ? snapshotFromWorkflowRow(existing) : null,
        };
      }
      const now = new Date();
      const snapshotFields = {
        clientId: currentNote.client.id,
        clientName: currentNote.client.name,
        clientImage: currentNote.client.image,
        clinicianId: currentNote.clinician?.id ?? null,
        clinicianName: currentNote.clinician?.name ?? null,
        clinicianImage: currentNote.clinician?.image ?? null,
        body: currentNote.body,
      };

      let finalized;
      if (existing?.status === 'SIGNED' && requested === 'LOCKED') {
        // Preserve original signedAt when locking.
        finalized = await tx.progressNoteWorkflow.update({
          where: { noteId: note.id },
          data: { status: 'LOCKED', lockedAt: now },
        });
      } else if (requested === 'LOCKED') {
        // Sign & Lock in one step (DRAFT → LOCKED) — fewer round-trips over slow DB tunnels.
        finalized = await tx.progressNoteWorkflow.upsert({
          where: { noteId: note.id },
          create: {
            noteId: note.id,
            status: 'LOCKED',
            signedAt: now,
            lockedAt: now,
            createdAt: currentNote.createdAt,
            ...snapshotFields,
          },
          update: {
            status: 'LOCKED',
            signedAt: existing?.signedAt ?? now,
            lockedAt: now,
            ...snapshotFields,
          },
        });
      } else {
        finalized = await tx.progressNoteWorkflow.upsert({
          where: { noteId: note.id },
          create: {
            noteId: note.id,
            status: 'SIGNED',
            signedAt: now,
            createdAt: currentNote.createdAt,
            ...snapshotFields,
          },
          update: {
            status: 'SIGNED',
            signedAt: now,
            ...snapshotFields,
          },
        });
      }

      return {
        ok: true,
        status: toPublicStatus(finalized.status),
        snapshot: finalized.status === 'LOCKED' ? snapshotFromWorkflowRow(finalized) : null,
        exceptionLabel,
      };
    },
    // SSH tunnel to RDS can exceed Prisma's default ~5s interactive tx window.
    { maxWait: 20_000, timeout: 45_000 }
  );
}

export async function listLockedProgressNoteSnapshots(input: {
  organizationId: string;
}) {
  await ensureWorkflowTable();

  const workflows = await prisma.$queryRaw<WorkflowRow[]>(Prisma.sql`
    SELECT w.*
    FROM "ProgressNoteWorkflow" w
    INNER JOIN "ProgressNote" n ON n."id" = w."noteId"
    INNER JOIN "Client" c ON c."id" = n."clientId"
    WHERE w."status" = 'LOCKED'
      AND (
        EXISTS (
          SELECT 1
          FROM "Location" l
          WHERE l."id" = c."locationId"
            AND l."organizationId" = ${input.organizationId}
        )
        OR EXISTS (
          SELECT 1
          FROM "User" u
          WHERE u."id" = c."assignedToId"
            AND u."organizationId" = ${input.organizationId}
        )
      )
    ORDER BY w."lockedAt" DESC
    LIMIT 100
  `);

  return workflows.map(snapshotFromWorkflowRow);
}

export async function loadWorkflowStatuses(noteIds: string[]) {
  const rows = await getWorkflowRows(noteIds);
  return new Map(
    rows.map((row) => [
      row.noteId,
      {
        status: toPublicStatus(row.status),
        signedAt: row.signedAt?.toISOString() ?? null,
        lockedAt: row.lockedAt?.toISOString() ?? null,
        clinicianName: row.clinicianName ?? null,
        clinicianImage: row.clinicianImage ?? null,
      },
    ])
  );
}
