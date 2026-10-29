import { Prisma, type Role } from '@prisma/client';
import { purgeScribeForSignedNote } from '@/lib/scribe/signPurge';
import { parsePersistedFindings, transcriptRiskGate, type PersistedRiskFinding } from '@/lib/scribe/riskGate';
import { buildAiProvenance } from '@/lib/notes/aiEvidence';
import { prisma } from '@/lib/db/prisma';
import type { LockedNoteSnapshot, ProgressNoteStatus } from './workflow';
import { isCaseloadRole } from '@/types/roles';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { canCosignNote, canSignNote, cosignQueueFilter, cosignRequiredFor, hasCaseloadCosign, hasCosignAuthority, noteTransition, type CosignBasis } from './transitions';
import { isClientOnCaseload, isDesignatedSupervisorOf, loadCosignQueueScope } from './cosignScope';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { isBehavioralHealthDirectorRole, verifiedMedicalDirector } from '@/lib/auth/medicalDirector';
import { findUnfilledBlanks } from '@/lib/ehr/smartPhrases';
import { countAiDraftMarkers } from '@/lib/ai/noteDraftFormats';
import { structuredSignBlockers } from '@/lib/ehr/structuredNotes';
import { checkTreatmentPlanGate, loadLicenseLevel } from '@/lib/ehr/therapy/planStore';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import type { PlanGateTransition } from '@/lib/ehr/therapy/rules';
import { loadNotePolicy } from '@/lib/notes/policy';
import { formatElementsGate } from '@/lib/notes/formatElements';
import { getServiceDetail } from '@/lib/notes/serviceDetail';
import {
  billingElementIssues,
  firstSignBlocker,
  LATE_REASON_MAX_CHARS,
  lateEntryLabel,
  lateEntryReasonError,
  noteDueAt,
  noteTypeIssues,
  prpContactIssues,
} from '@/lib/notes/standard';
import { getPrpNoteDetail } from '@/lib/prp/progressNoteDb';

type WorkflowResult =
  | {
      ok: true;
      status: ProgressNoteStatus;
      snapshot: LockedNoteSnapshot | null;
      /** True when this call applied a new signature (Draft -> Signed/Locked) */
      signed: boolean;
      clientId: string;
      signedByName: string | null;
      cosignRequired: boolean;
      /** Set when this signature was allowed only by the go-live transition (plan pending) */
      planTransition?: PlanGateTransition | null;
      /** AI Scribe transcript-risk gate: how it was satisfied; a new attestation to record */
      riskGate?: { findings: number; satisfiedBy: string | null; attestation: string | null } | null;
    }
  | { ok: false; status: number; error: string };

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
  signedById: string | null;
  signedByName: string | null;
  attestedAt: Date | null;
  cosignRequired: boolean;
  cosignedById: string | null;
  cosignedByName: string | null;
  cosignedAt: Date | null;
  supervisorComment: string | null;
  planPendingUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type NoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  client: { id: string; name: string; image: string | null };
  clinician: { id: string; name: string | null; image: string | null } | null;
};

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

// Table, indexes and columns: prisma/migrations/20261019_runtime_ddl_to_migration.sql (no runtime DDL).

async function getWorkflowRows(noteIds: string[]): Promise<WorkflowRow[]> {
  if (noteIds.length === 0) return [];

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
      "signedById",
      "signedByName",
      "attestedAt",
      "cosignRequired",
      "cosignedById",
      "cosignedByName",
      "cosignedAt",
      "supervisorComment",
      "planPendingUntil",
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
      client: { select: { id: true, name: true, image: true } },
      clinician: { select: { id: true, name: true, image: true } },
    },
  });

  return note as NoteRow | null;
}

/** Is this user a supervisee on a licensure track in this org? Missing table -> false. */
async function isOnLicensureTrack(organizationId: string, userId: string): Promise<boolean> {
  try {
    const track = await prisma.supervisionTrack.findFirst({
      where: { organizationId, superviseeId: userId },
      select: { id: true },
    });
    return Boolean(track);
  } catch {
    return false;
  }
}

async function actorDisplayName(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });
  return user?.name?.trim() || user?.email || null;
}

export async function updateProgressNoteWorkflow(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  status: Exclude<ProgressNoteStatus, 'Draft'>;
  /** Signer confirmed the attestation statement; required (true) whenever a new signature is applied */
  attested?: boolean;
  /**
   * 'group_session': the group sessions module validated the note's required fields, attendance,
   * minutes and POS itself (src/lib/groups); the per-note service-detail checks are skipped.
   */
  source?: 'group_session';
  /** Required when the signature is after the practice sign deadline (late entry), min 10 characters */
  lateEntryReason?: string | null;
  /**
   * AI Scribe transcript risk: "Risk content was reviewed; no further assessment indicated because …"
   * (the reason, min 15 characters). Needed only when a linked capture has risk findings and the
   * note documents no C-SSRS result, risk level / assessment or safety plan update.
   */
  riskAttestation?: string | null;
}): Promise<WorkflowResult> {
  const note = await getNoteRow(input.noteId, input.organizationId);

  if (!note) {
    return { ok: false, status: 404, error: 'Note not found' };
  }

  if (isCaseloadRole(input.actorRole) && note.clinician?.id !== input.actorUserId) {
    return { ok: false, status: 403, error: 'Forbidden' };
  }


  // Looked up outside the transaction: a failed query (e.g. table missing) would abort it.
  const [signerName, onTrack, license, gateNote, policy, serviceDetail, signer, prpDetail] = await Promise.all([
    actorDisplayName(input.actorUserId),
    isOnLicensureTrack(input.organizationId, input.actorUserId),
    loadLicenseLevel(input.organizationId, input.actorUserId).catch(() => null),
    prisma.progressNote.findUnique({
      where: { id: note.id },
      select: { body: true, noteType: true, cptCode: true, appointment: { select: { patientLocationState: true } } },
    }),
    loadNotePolicy(input.organizationId),
    getServiceDetail(note.id),
    prisma.user.findUnique({ where: { id: input.actorUserId }, select: { credentials: true } }).catch(() => null),
    // PRP progress note contact fields (null for other note types / none saved)
    getPrpNoteDetail(note.id),
  ]);
  // AI Scribe captures linked to this note: transcript risk findings gate the signature.
  // Fails closed: if linked captures exist but their findings cannot be read, signing is refused.
  let linkedCaptures: { id: string; findings: PersistedRiskFinding[]; attestation: string | null }[] = [];
  let riskLookupFailed = false;
  try {
    const caps = await prisma.scribeCapture.findMany({
      where: { organizationId: input.organizationId, progressNoteId: note.id },
      select: { id: true, riskFindings: true, riskAttestation: true },
      take: 10,
    });
    linkedCaptures = caps.map((c) => ({ id: c.id, findings: parsePersistedFindings(c.riskFindings), attestation: c.riskAttestation }));
  } catch {
    // Table / column missing (migration not run) or a lookup error: refuse only when captures are linked
    const n = await Promise.resolve()
      .then(() => prisma.scribeCapture.count({ where: { organizationId: input.organizationId, progressNoteId: note.id } }))
      .catch(() => 0);
    riskLookupFailed = n > 0;
  }
  const riskFindings = linkedCaptures.flatMap((c) => c.findings);
  const riskAttestedBefore = linkedCaptures.find((c) => c.findings.length && c.attestation)?.attestation ?? null;
  // Practice settings › Clinical › co-sign roles (default list when not set)
  const cosignRequired = cosignRequiredFor(input.actorRole, onTrack, license?.level === 'PRE_LICENSED', policy.cosignRequiredRoles);
  // Therapy progress notes need an active, signed treatment plan (practice switch, default on).
  // Fails closed: if the plan lookup errors, signing is refused with the reason.
  let planGate: { ok: boolean; message: string; transition?: PlanGateTransition } = { ok: true, message: '' };
  try {
    const meta = gateNote ? resolveNoteMeta(gateNote) : null;
    planGate = await checkTreatmentPlanGate({
      organizationId: input.organizationId,
      clientId: note.client.id,
      noteType: meta?.noteType ?? null,
      cptCode: meta?.cptCode ?? null,
    });
  } catch {
    planGate = { ok: false, message: 'Could not check the client’s treatment plan. Try again; the note is saved as a draft.' };
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
          noteType: true,
          cptCode: true,
          durationMinutes: true,
          dateOfService: true,
          placeOfService: true,
          telehealth: true,
          audioOnly: true,
          part2: true,
          dismissedAt: true,
          createdAt: true,
          client: { select: { id: true, name: true, image: true } },
          clinician: { select: { id: true, name: true, image: true } },
        },
      });
      if (!currentNote) return { ok: false, status: 404, error: 'Note not found' };
      // Dismissed (unsigned, not needed) notes are read-only until the dismissal is undone
      if (currentNote.dismissedAt) return { ok: false, status: 409, error: 'This note was dismissed. Undo the dismissal before signing it.' };
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
          signed: false,
          clientId: existing.clientId,
          signedByName: existing.signedByName ?? null,
          cosignRequired: existing.cosignRequired,
        };
      }

      const now = new Date();

      if (existing?.status === 'SIGNED' && requested === 'LOCKED') {
        // Locking an already-signed note: no new signature; preserve signedAt and the signed body.
        const finalized = await tx.progressNoteWorkflow.update({
          where: { noteId: note.id },
          data: { status: 'LOCKED', lockedAt: now },
        });
        return {
          ok: true,
          status: toPublicStatus(finalized.status),
          snapshot: snapshotFromWorkflowRow(finalized),
          signed: false,
          clientId: finalized.clientId,
          signedByName: finalized.signedByName ?? null,
          cosignRequired: finalized.cosignRequired,
        };
      }

      // From here on a new signature is applied (Draft -> Signed, or Sign & Lock in one step).
      if (
        !canSignNote({
          actorUserId: input.actorUserId,
          actorRole: input.actorRole,
          authorId: currentNote.clinician?.id ?? null,
        })
      ) {
        return {
          ok: false,
          status: 403,
          error: "Only the note's author can sign it. Supervisors co-sign signed notes from Supervisor Review.",
        };
      }
      if (input.attested !== true) {
        return { ok: false, status: 400, error: 'Attestation required' };
      }
      const aiMarkers = countAiDraftMarkers(currentNote.body);
      if (aiMarkers > 0) {
        return {
          ok: false,
          status: 400,
          error: `Review and Accept each AI-drafted section before signing (${aiMarkers} not yet accepted).`,
        };
      }
      const blanks = findUnfilledBlanks(currentNote.body);
      if (blanks > 0) {
        return {
          ok: false,
          status: 400,
          error: `Fill in ${blanks} blank${blanks === 1 ? '' : 's'} ([___]) before signing.`,
        };
      }

      // AI Scribe transcript risk (any note type): documented C-SSRS / risk level / safety plan update, or the attestation
      if (riskLookupFailed) return { ok: false, status: 409, error: 'Could not check the AI Scribe transcript risk review. Try again; the note is saved as a draft.' };
      const riskGate = transcriptRiskGate({ findings: riskFindings, body: currentNote.body, attestation: input.riskAttestation, existingAttestation: riskAttestedBefore });
      if (riskGate.blocked) return { ok: false, status: 400, error: riskGate.message ?? 'Transcript risk review required.' };

      // Structured templates (Psych Med Mgmt, Child / Adult Psych Intake and Re-Eval): CPT chosen, risk rule, reviewed carry-forward
      const [templateBlocker] = structuredSignBlockers({
        noteType: currentNote.noteType || '',
        body: currentNote.body,
        cptCode: currentNote.cptCode,
        durationMinutes: currentNote.durationMinutes,
      });
      if (templateBlocker) return { ok: false, status: 400, error: templateBlocker.message };

      // Treatment plan required before therapy progress notes (drafts are never blocked)
      if (!planGate.ok) return { ok: false, status: 409, error: planGate.message };

      // Required billing / compliance elements and note-type rules (src/lib/notes/standard.ts)
      const currentMeta = resolveNoteMeta(currentNote);
      const elementBlocker = input.source === 'group_session' ? null : firstSignBlocker([
        ...billingElementIssues({
          noteType: currentMeta.noteType,
          body: currentMeta.displayBody,
          cptCode: currentMeta.cptCode,
          dateOfService: currentMeta.dateOfService,
          durationMinutes: currentMeta.durationMinutes,
          telehealth: currentMeta.telehealth || currentNote.audioOnly,
          audioOnly: currentNote.audioOnly,
          placeOfService: currentMeta.placeOfService,
          detail: serviceDetail,
          appointmentPatientState: gateNote?.appointment?.patientLocationState ?? null,
          renderingCredentials: signer?.credentials ?? null,
          requireDiagnosisToSign: policy.requireDiagnosisToSign,
          clientId: currentNote.client.id,
        }),
        ...noteTypeIssues({ noteType: currentMeta.noteType, body: currentMeta.displayBody, part2: currentMeta.part2, formatElements: formatElementsGate(policy, now), now }),
        ...prpContactIssues({
          noteType: currentMeta.noteType,
          body: currentMeta.displayBody,
          detail: prpDetail,
          dateOfService: currentMeta.dateOfService,
          startTime: serviceDetail?.startTime ?? null,
          endTime: serviceDetail?.endTime ?? null,
          durationMinutes: currentMeta.durationMinutes,
          formatElements: formatElementsGate(policy, now),
          now,
        }),
      ]);
      if (elementBlocker) return { ok: false, status: 400, error: elementBlocker };

      // Late entry: signed after the practice deadline needs the clinician's reason (stamped below)
      const lateError = lateEntryReasonError({
        dueAt: noteDueAt(
          (currentNote.dateOfService ?? currentNote.createdAt).toISOString().slice(0, 10),
          serviceDetail?.endTime ?? null,
          policy.deadlineHours,
          policy.timeZone
        ),
        signedAt: now,
        reason: input.lateEntryReason,
      });
      if (lateError) return { ok: false, status: 400, error: lateError };

      // The signed snapshot is the note body exactly as stored; it is never rewritten here.
      // "Treatment plan pending (go-live transition)": stamped with the signature; null = signed normally
      const planTransition = planGate.ok ? planGate.transition ?? null : null;
      const signatureFields = {
        planPendingUntil: planTransition ? new Date(`${planTransition.until}T00:00:00Z`) : null,
        clientId: currentNote.client.id,
        clientName: currentNote.client.name,
        clientImage: currentNote.client.image,
        clinicianId: currentNote.clinician?.id ?? null,
        clinicianName: currentNote.clinician?.name ?? null,
        clinicianImage: currentNote.clinician?.image ?? null,
        body: currentNote.body,
        signedAt: now,
        signedById: input.actorUserId,
        signedByName: signerName,
        attestedAt: now,
        cosignRequired,
      };
      const lockFields = requested === 'LOCKED' ? { lockedAt: now } : {};

      // Sign & Lock may happen in one step (DRAFT -> LOCKED): fewer round-trips over slow DB tunnels.
      const finalized = await tx.progressNoteWorkflow.upsert({
        where: { noteId: note.id },
        create: {
          noteId: note.id,
          status: requested,
          createdAt: currentNote.createdAt,
          ...signatureFields,
          ...lockFields,
        },
        update: {
          status: requested,
          ...signatureFields,
          ...lockFields,
        },
      });

      return {
        ok: true,
        status: toPublicStatus(finalized.status),
        snapshot: finalized.status === 'LOCKED' ? snapshotFromWorkflowRow(finalized) : null,
        signed: true,
        clientId: finalized.clientId,
        signedByName: finalized.signedByName ?? null,
        cosignRequired: finalized.cosignRequired,
        planTransition,
        riskGate: riskGate.findings ? { findings: riskGate.findings, satisfiedBy: riskGate.satisfiedBy ?? null, attestation: riskGate.attestation ?? null } : null,
      };
    },
    // SSH tunnel to RDS can exceed Prisma's default ~5s interactive tx window.
    { maxWait: 20_000, timeout: 45_000 }
  ).then(async (result) => {
    // Timeliness stamp: due under the practice deadline at signing; late entries are labeled.
    if (result.ok && result.signed) {
      await stampTimeliness({
        noteId: note.id,
        organizationId: input.organizationId,
        endTime: serviceDetail?.endTime ?? null,
        policy,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        clientId: result.clientId,
        lateReason: input.lateEntryReason ?? null,
      });
    }
    // AI Scribe: record the risk attestation (audited) and stamp the AI audit evidence on the note
    // BEFORE the transcript / drafts are purged below. Never blocks the signature.
    if (result.ok && result.signed && linkedCaptures.length) {
      await recordScribeSignEvidence({
        noteId: note.id,
        organizationId: input.organizationId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        clientId: result.clientId,
        captures: linkedCaptures,
        riskGate: result.riskGate ?? null,
      });
    }
    // AI Scribe "Delete transcript when the note is signed": purge the capture's transcript and drafts now
    if (result.ok && result.signed) {
      await purgeScribeForSignedNote({ noteId: note.id, organizationId: input.organizationId });
    }
    // The plan rule was overridden by the go-live transition: audited on its own row so it can
    // be reported (who signed which client's note without a plan, and until when it is allowed).
    if (result.ok && result.signed && result.planTransition) {
      await writeAuditLog({
        action: 'TREATMENT_PLAN_GATE_OVERRIDE',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        organizationId: input.organizationId,
        resourceType: 'progressNote',
        resourceId: note.id,
        patientId: result.clientId,
        outcome: 'SUCCESS',
        metadata: {
          reason: result.planTransition.reason,
          transitionUntil: result.planTransition.until,
          status: result.status,
        },
      });
    }
    return result;
  });
}

/**
 * AI Scribe evidence at signing: the risk attestation on the capture (+ SCRIBE_RISK_ATTESTATION audit
 * row, text not in the audit metadata), and ProgressNote.aiProvenance (per-section edit ratio draft →
 * signed, counts, model, prompt version, capture id). A failure is logged only.
 */
async function recordScribeSignEvidence(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  captures: { id: string; findings: PersistedRiskFinding[] }[];
  riskGate: { findings: number; satisfiedBy: string | null; attestation: string | null } | null;
}) {
  try {
    const now = new Date();
    if (input.riskGate?.attestation) {
      const target = input.captures.find((c) => c.findings.length) ?? input.captures[0];
      await prisma.scribeCapture.update({
        where: { id: target.id },
        data: { riskAttestation: input.riskGate.attestation, riskAttestedAt: now, riskAttestedById: input.actorUserId },
      });
      await writeAuditLog({
        action: 'SCRIBE_RISK_ATTESTATION',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        organizationId: input.organizationId,
        resourceType: 'progressNote',
        resourceId: input.noteId,
        patientId: input.clientId,
        outcome: 'SUCCESS',
        metadata: { captureId: target.id, findings: input.riskGate.findings, reasonLength: input.riskGate.attestation.length },
      });
    }
    const [note, draft] = await Promise.all([
      prisma.progressNote.findUnique({ where: { id: input.noteId }, select: { body: true, noteType: true } }),
      prisma.scribeDraft.findFirst({
        where: { sessionId: { in: input.captures.map((c) => c.id) } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, sessionId: true, modelId: true, format: true, content: true },
      }),
    ]);
    if (!note) return;
    const provenance = buildAiProvenance({
      captureId: draft?.sessionId ?? input.captures[0].id,
      draft,
      signedBody: note.body,
      noteType: note.noteType || '',
      riskGate: { findings: input.riskGate?.findings ?? 0, satisfiedBy: input.riskGate?.satisfiedBy ?? null },
      signedAt: now,
    });
    await prisma.progressNote.update({ where: { id: input.noteId }, data: { aiProvenance: JSON.parse(JSON.stringify(provenance)) } });
  } catch (err) {
    console.error('[note sign] AI Scribe evidence failed', err instanceof Error ? err.name : 'unknown');
  }
}

/**
 * Stamp the due time and late-entry label on a newly signed note (ProgressNoteTimeliness).
 * A late signature is audited. Never blocks signing: a failure is logged only.
 */
async function stampTimeliness(input: {
  noteId: string;
  organizationId: string;
  endTime: string | null;
  policy: Awaited<ReturnType<typeof loadNotePolicy>>;
  actorUserId: string;
  actorRole: Role;
  clientId: string;
  lateReason: string | null;
}) {
  try {
    const [note, wf] = await Promise.all([
      prisma.progressNote.findUnique({ where: { id: input.noteId }, select: { dateOfService: true, createdAt: true } }),
      prisma.progressNoteWorkflow.findUnique({ where: { noteId: input.noteId }, select: { signedAt: true } }),
    ]);
    if (!note || !wf?.signedAt) return;
    const dos = (note.dateOfService ?? note.createdAt).toISOString().slice(0, 10);
    const due = noteDueAt(dos, input.endTime, input.policy.deadlineHours, input.policy.timeZone);
    if (!due) return;
    const late = wf.signedAt.getTime() > due.getTime();
    const label = late ? lateEntryLabel(wf.signedAt, dos, input.policy.timeZone) : null;
    const lateReason = late ? (input.lateReason || '').trim().slice(0, LATE_REASON_MAX_CHARS) || null : null;
    await prisma.progressNoteTimeliness.upsert({
      where: { noteId: input.noteId },
      create: { noteId: input.noteId, organizationId: input.organizationId, dueAt: due, signedAt: wf.signedAt, deadlineHours: input.policy.deadlineHours, lateEntry: late, label, lateReason },
      update: { dueAt: due, signedAt: wf.signedAt, deadlineHours: input.policy.deadlineHours, lateEntry: late, label, lateReason },
    });
    if (late) {
      await writeAuditLog({
        action: 'NOTE_LATE_ENTRY',
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        organizationId: input.organizationId,
        resourceType: 'progressNote',
        resourceId: input.noteId,
        patientId: input.clientId,
        outcome: 'SUCCESS',
        metadata: { dueAt: due.toISOString(), signedAt: wf.signedAt.toISOString(), deadlineHours: input.policy.deadlineHours, label, lateReasonRecorded: Boolean(lateReason) },
      });
    }
  } catch (err) {
    console.error('[notes] timeliness stamp failed', err);
  }
}

type CosignResult =
  | {
      ok: true;
      clientId: string;
      cosignedAt: string;
      cosignedByName: string | null;
      supervisorComment: string | null;
      /** Why this reviewer could co-sign (audit metadata) */
      basis: CosignBasis;
    }
  | {
      ok: false;
      status: number;
      error: string;
      /** Set on authority / Part 2 denials (audit metadata) */
      reason?: 'not_supervisor' | 'own_note' | 'sensitive_record';
      clientId?: string;
      canRequestBreakGlass?: true;
    };

/**
 * Supervisor co-signature on a SIGNED or LOCKED note. Never changes the note body or status.
 * Authority: decideCosignScope (leadership / verified Medical Director org-wide; otherwise the
 * author's designated supervisor or, for COSIGN_CASELOAD_ROLES, a client on the reviewer's
 * caseload). Part 2 / VIP locks: assertClientPhiAccess (skip only when the caller just ran it).
 */
export async function cosignProgressNote(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  comment: string | null;
  /** The caller already ran assertClientPhiAccess for this note's client in this request */
  phiAccessChecked?: boolean;
}): Promise<CosignResult> {
  const note = await getNoteRow(input.noteId, input.organizationId);
  if (!note) return { ok: false, status: 404, error: 'Note not found' };

  const workflow = await prisma.progressNoteWorkflow.findUnique({ where: { noteId: note.id } });
  if (!workflow) {
    return { ok: false, status: 409, error: 'Only signed notes can be co-signed.' };
  }

  const authorIds = [workflow.signedById, workflow.clinicianId, note.clinician?.id].filter(
    (id): id is string => Boolean(id)
  );
  const designated = await isDesignatedSupervisorOf(
    input.organizationId,
    input.actorUserId,
    authorIds
  );
  // Medical Director co-sign authority (verified from the DB by requireSession). A primary care
  // medical director does not count as the supervisor of a pre-licensed / licensure-track author.
  const medicalDirector = verifiedMedicalDirector({ userId: input.actorUserId, role: input.actorRole, organizationId: input.organizationId });
  let preLicensedAuthor = false;
  if (medicalDirector && !designated && !isBehavioralHealthDirectorRole(input.actorRole)) {
    const checks = await Promise.all(
      authorIds.map(async (id) =>
        (await isOnLicensureTrack(input.organizationId, id)) ||
        (await loadLicenseLevel(input.organizationId, id).catch(() => null))?.level === 'PRE_LICENSED'
      )
    );
    preLicensedAuthor = checks.some(Boolean);
  }
  const medicalDirectorAuthority = hasCosignAuthority(input.actorRole, { medicalDirector, preLicensedAuthor });
  // Caseload co-sign (Psychiatrist without the Medical Director flag): the note's client is on their caseload
  const clientOnCaseload =
    !designated && !medicalDirectorAuthority && hasCaseloadCosign(input.actorRole)
      ? await isClientOnCaseload({ organizationId: input.organizationId, actorUserId: input.actorUserId, actorRole: input.actorRole }, workflow.clientId)
      : false;
  const allowed = canCosignNote({
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    authorIds,
    status: workflow.status,
    isDesignatedSupervisor: designated,
    medicalDirectorAuthority,
    clientOnCaseload,
  });
  if (allowed.ok === false) {
    const reason = allowed.status !== 403 ? undefined : authorIds.includes(input.actorUserId) ? 'own_note' : 'not_supervisor';
    return { ok: false, status: allowed.status, error: allowed.error, reason, clientId: workflow.clientId };
  }

  // 42 CFR Part 2 / VIP: co-signing needs the same PHI access as opening the chart (break-glass otherwise)
  if (!input.phiAccessChecked) {
    try {
      await assertClientPhiAccess({
        organizationId: input.organizationId,
        userId: input.actorUserId,
        role: input.actorRole,
        clientId: workflow.clientId,
        path: `/api/ehr/notes/${note.id}/cosign`,
      });
    } catch (err) {
      if (err instanceof SensitiveRecordAccessError) {
        return { ok: false, status: 403, error: 'Protected record', reason: 'sensitive_record', clientId: workflow.clientId, canRequestBreakGlass: true };
      }
      throw err;
    }
  }

  if (workflow.cosignedAt) {
    return {
      ok: false,
      status: 409,
      error: `Already co-signed by ${workflow.cosignedByName || 'a supervisor'}.`,
    };
  }

  const now = new Date();
  const cosignedByName = await actorDisplayName(input.actorUserId);
  // Conditional update: two supervisors racing cannot both co-sign.
  const updated = await prisma.progressNoteWorkflow.updateMany({
    where: { noteId: note.id, cosignedAt: null, status: { in: ['SIGNED', 'LOCKED'] } },
    data: {
      cosignedById: input.actorUserId,
      cosignedByName,
      cosignedAt: now,
      supervisorComment: input.comment,
    },
  });
  if (updated.count === 0) {
    return { ok: false, status: 409, error: 'This note was just co-signed by someone else.' };
  }

  return {
    ok: true,
    clientId: workflow.clientId,
    cosignedAt: now.toISOString(),
    cosignedByName,
    supervisorComment: input.comment,
    basis: allowed.basis,
  };
}

export type CosignQueueItem = {
  noteId: string;
  clientId: string;
  clientName: string;
  authorId: string | null;
  authorName: string | null;
  status: ProgressNoteStatus;
  signedAt: string | null;
  signedByName: string | null;
  body: string;
  noteType: string | null;
  dateOfService: string | null;
  durationMinutes: number | null;
  cptCode: string | null;
  placeOfService: string | null;
  telehealth: boolean;
  part2: boolean;
  aiDrafted: boolean;
  createdAt: string;
};

/**
 * Signed notes awaiting a supervisor co-signature that this actor may co-sign (same rule as
 * cosignProgressNote): every note in the org for leadership / a verified Medical Director;
 * a Psychiatrist's supervisees' notes + notes on clients on their caseload; otherwise only
 * licensure-track supervisees' notes. The actor's own notes are never listed. Part 2 / VIP
 * masking is applied by the caller (maskLockedRows).
 */
export async function listCosignQueue(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
}): Promise<CosignQueueItem[]> {
  const { scope, superviseeIds, caseloadClientWhere } = await loadCosignQueueScope(input);
  const scoped = cosignQueueFilter(scope, superviseeIds, caseloadClientWhere);
  if (!scoped) return [];

  const rows = await prisma.progressNoteWorkflow.findMany({
    where: {
      cosignRequired: true,
      cosignedAt: null,
      status: { in: ['SIGNED', 'LOCKED'] },
      note: { client: clientOrgWhere(input.organizationId) },
      AND: [
        { OR: [{ signedById: null }, { signedById: { not: input.actorUserId } }] },
        { OR: [{ clinicianId: null }, { clinicianId: { not: input.actorUserId } }] },
        ...scoped,
      ],
    },
    orderBy: { signedAt: 'asc' },
    take: 200,
    include: {
      note: {
        select: {
          noteType: true,
          dateOfService: true,
          durationMinutes: true,
          cptCode: true,
          placeOfService: true,
          telehealth: true,
          part2: true,
          aiDrafted: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    noteId: row.noteId,
    clientId: row.clientId,
    clientName: row.clientName,
    authorId: row.signedById ?? row.clinicianId ?? null,
    authorName: row.signedByName ?? row.clinicianName ?? null,
    status: toPublicStatus(row.status),
    signedAt: row.signedAt?.toISOString() ?? null,
    signedByName: row.signedByName ?? null,
    body: row.body,
    noteType: row.note.noteType ?? null,
    dateOfService: row.note.dateOfService?.toISOString() ?? null,
    durationMinutes: row.note.durationMinutes ?? null,
    cptCode: row.note.cptCode ?? null,
    placeOfService: row.note.placeOfService ?? null,
    telehealth: row.note.telehealth,
    part2: row.note.part2,
    aiDrafted: row.note.aiDrafted,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function listLockedProgressNoteSnapshots(input: {
  organizationId: string;
}) {

  const workflows = await prisma.$queryRaw<WorkflowRow[]>(Prisma.sql`
    SELECT w.*
    FROM "ProgressNoteWorkflow" w
    INNER JOIN "ProgressNote" n ON n."id" = w."noteId"
    INNER JOIN "Client" c ON c."id" = n."clientId"
    WHERE w."status" = 'LOCKED'
      AND (
        c."organizationId" = ${input.organizationId}
        OR EXISTS (
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
        signedByName: row.signedByName ?? null,
        attestedAt: row.attestedAt?.toISOString() ?? null,
        cosignRequired: Boolean(row.cosignRequired),
        cosignedAt: row.cosignedAt?.toISOString() ?? null,
        cosignedByName: row.cosignedByName ?? null,
        supervisorComment: row.supervisorComment ?? null,
        /** YYYY-MM-DD when signed under the go-live transition with the plan pending */
        planPendingUntil: row.planPendingUntil ? new Date(row.planPendingUntil).toISOString().slice(0, 10) : null,
      },
    ])
  );
}
