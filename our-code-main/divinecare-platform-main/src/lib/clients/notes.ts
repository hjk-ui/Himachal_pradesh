import type { Prisma, Role } from '@prisma/client';
import { parseNoteMeta } from '@/lib/ehr/noteTemplates';
export { parseNoteMeta } from '@/lib/ehr/noteTemplates';
import { prisma } from '@/lib/db/prisma';
import { loadWorkflowStatuses } from '@/lib/notes/workflow-store';
import { canAccessClientChartNotes, canWriteClientChartNotes, clientOrgFilter } from '@/lib/clients/orgScope';
import { isPsychotherapyNote, receivesProgressNoteBody } from '@/lib/clients/chartVisibility';
import { nameTokenMatches } from '@/lib/staff/nameMatch';
import { recordPhiAudit } from '@/lib/audit/phiAudit';
import { isCaseloadRole } from '@/types/roles';
import { NOT_DISMISSED } from '@/lib/notes/dismiss';

type ClientAccessResult =
  | { ok: true; client: { id: string; assignedToId: string | null } }
  | { ok: false; status: number; error: string };

export type SerializedProgressNote = {
  id: string;
  body: string;
  createdAt: string;
  clinicianName: string | null;
  clinicianEmail: string | null;
  clinicianImage: string | null;
  workflowStatus: 'Draft' | 'Signed' | 'Locked';
  signedAt: string | null;
  lockedAt: string | null;
  noteType: string | null;
  durationMinutes: number | null;
  billingCode?: string | null;
  telehealth?: boolean;
  placeOfService?: string | null;
  sudConfidential?: boolean;
  dismissedAt?: string | null;
  dismissReason?: string | null;
};

export type SerializedEhrProgressNote = SerializedProgressNote & {
  clientId: string;
  clientName: string;
  clientImage: string | null;
};

type NotesError = { ok: false; status: number; error: string };
type ListNotesResult = { ok: true; notes: SerializedProgressNote[] } | NotesError;
type ListEhrNotesResult =
  | {
      ok: true;
      notes: SerializedEhrProgressNote[];
      stats: { today: number; unsigned: number; thisWeek: number; total: number };
    }
  | NotesError;
type CreateNoteResult = { ok: true; note: SerializedProgressNote } | NotesError;

async function findAllowedClient(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  /** Real account role — Admin Role Preview must still write notes to DB */
  actorBaseRole?: Role | null;
}): Promise<ClientAccessResult> {
  const client = await prisma.client.findFirst({
    where: { id: input.clientId, ...clientOrgFilter(input.organizationId) },
    select: { id: true, assignedToId: true },
  });

  if (!client) {
    return { ok: false as const, status: 404, error: 'Client not found' };
  }

  const elevated =
    input.actorBaseRole === 'ADMIN' || input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (elevated) {
    return { ok: true as const, client };
  }

  if (isCaseloadRole(input.actorRole) && client.assignedToId !== input.actorUserId) {
    const actor = prisma.user
      ? await prisma.user
          .findUnique({
            where: { id: input.actorUserId },
            select: { name: true },
          })
          .catch(() => null)
      : null;
    const actorName = actor?.name?.trim();
    const namedThreads = await prisma.messageThread.findMany({
      where: { clientId: input.clientId, organizationId: input.organizationId },
      select: { forwardedTo: true, assignedStaff: true },
      take: 50,
    });
    const hasForwardedThread = namedThreads.some(
      (thread) =>
        thread.forwardedTo === input.actorUserId ||
        thread.assignedStaff === input.actorUserId ||
        nameTokenMatches(thread.forwardedTo, actorName) ||
        nameTokenMatches(thread.assignedStaff, actorName)
    );
    if (!hasForwardedThread) {
      return { ok: false as const, status: 403, error: 'Forbidden' };
    }
  }

  return { ok: true as const, client };
}

function authorMayReadPsychotherapy(note: { body: string; clinicianId?: string | null }, actorUserId?: string) {
  const meta = parseNoteMeta(note.body);
  if (!isPsychotherapyNote(meta.noteType, note.body)) return true;
  return Boolean(note.clinicianId) && note.clinicianId === actorUserId;
}

function serializeNote(note: {
  id: string;
  body: string;
  clinicianId?: string | null;
  createdAt: Date;
  dismissedAt?: Date | null;
  dismissReason?: string | null;
  clinician: { name: string | null; email: string; image: string | null } | null;
  workflow: {
    status: 'DRAFT' | 'SIGNED' | 'LOCKED';
    signedAt: Date | null;
    lockedAt: Date | null;
    clinicianName?: string | null;
    clinicianImage?: string | null;
  } | null;
}, actorUserId?: string): SerializedProgressNote {
  const meta = parseNoteMeta(note.body);
  const psychotherapy = isPsychotherapyNote(meta.noteType, note.body);
  const author = Boolean(note.clinicianId) && note.clinicianId === actorUserId;
  const body = psychotherapy && !author ? '' : meta.displayBody || note.body;
  return {
    id: note.id,
    body,
    createdAt: note.createdAt.toISOString(),
    clinicianName: note.workflow?.clinicianName || note.clinician?.name || null,
    clinicianEmail: note.clinician?.email ?? null,
    clinicianImage: note.workflow?.clinicianImage || note.clinician?.image || null,
    workflowStatus: note.workflow?.status === 'SIGNED'
      ? 'Signed'
      : note.workflow?.status === 'LOCKED'
        ? 'Locked'
        : 'Draft',
    signedAt: note.workflow?.signedAt?.toISOString() ?? null,
    lockedAt: note.workflow?.lockedAt?.toISOString() ?? null,
    noteType: meta.noteType,
    durationMinutes: meta.durationMinutes,
    billingCode: meta.billingCode,
    telehealth: meta.telehealth,
    placeOfService: meta.placeOfService,
    sudConfidential: meta.sudConfidential,
    dismissedAt: note.dismissedAt?.toISOString() ?? null,
    dismissReason: note.dismissReason ?? null,
  };
}

export async function listClientNotes(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
}): Promise<ListNotesResult> {
  const canRead =
    canAccessClientChartNotes(input.actorRole) ||
    input.actorBaseRole === 'ADMIN' ||
    input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (!canRead) {
    await recordPhiAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'progressNote.read',
      resourceType: 'clinicalNote',
      patientId: input.clientId,
      outcome: 'DENIED',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  if (!receivesProgressNoteBody(input.actorRole)) {
    await recordPhiAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'progressNote.read',
      resourceType: 'clinicalNote',
      patientId: input.clientId,
      outcome: 'DENIED',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }

  const notes = await prisma.progressNote.findMany({
    where: { clientId: input.clientId },
    orderBy: { createdAt: 'desc' },
    include: {
      clinician: { select: { name: true, email: true, image: true } },
    },
  });

  const workflowMap = await loadWorkflowStatuses(notes.map((note) => note.id));

  return {
    ok: true as const,
    notes: notes
      .filter((note) => authorMayReadPsychotherapy(note, input.actorUserId))
      .map((note) =>
      serializeNote({
        ...note,
        workflow: workflowMap.get(note.id)
          ? {
              status: workflowMap.get(note.id)!.status === 'Signed'
                ? 'SIGNED'
                : workflowMap.get(note.id)!.status === 'Locked'
                  ? 'LOCKED'
                  : 'DRAFT',
              signedAt: workflowMap.get(note.id)!.signedAt ? new Date(workflowMap.get(note.id)!.signedAt!) : null,
              lockedAt: workflowMap.get(note.id)!.lockedAt ? new Date(workflowMap.get(note.id)!.lockedAt!) : null,
              clinicianName: workflowMap.get(note.id)!.clinicianName,
              clinicianImage: workflowMap.get(note.id)!.clinicianImage,
            }
          : null,
      }, input.actorUserId)
    ),
  };
}

export async function listEhrProgressNotes(input: {
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  includeDismissed?: boolean;
}): Promise<ListEhrNotesResult> {
  if (!receivesProgressNoteBody(input.actorRole)) {
    await recordPhiAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'progressNote.read',
      resourceType: 'clinicalNote',
      outcome: 'DENIED',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const orgClientWhere = clientOrgFilter(input.organizationId);
  const clientWhere =
    isCaseloadRole(input.actorRole)
      ? { AND: [orgClientWhere, { assignedToId: input.actorUserId }] }
      : orgClientWhere;

  const noteWhere = {
    client: clientWhere,
    ...(input.includeDismissed ? {} : NOT_DISMISSED),
  };
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart);
  const day = weekStart.getDay();
  weekStart.setDate(weekStart.getDate() + (day === 0 ? -6 : 1 - day));

  const [notes, total, today, thisWeek, draftWorkflows] = await Promise.all([
    prisma.progressNote.findMany({
      where: noteWhere,
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        client: { select: { id: true, name: true, image: true } },
        clinician: { select: { name: true, email: true, image: true } },
      },
    }),
    prisma.progressNote.count({ where: noteWhere }),
    prisma.progressNote.count({
      where: { ...noteWhere, createdAt: { gte: dayStart } },
    }),
    prisma.progressNote.count({
      where: { ...noteWhere, createdAt: { gte: weekStart } },
    }),
    prisma.progressNoteWorkflow.count({
      where: {
        status: 'DRAFT',
        note: { ...noteWhere, ...NOT_DISMISSED },
      },
    }),
  ]);
  const workflowMap = await loadWorkflowStatuses(notes.map((note) => note.id));

  return {
    ok: true as const,
    stats: {
      today,
      unsigned: draftWorkflows,
      thisWeek,
      total,
    },
    notes: notes
      .filter((note) => authorMayReadPsychotherapy(note, input.actorUserId))
      .map((note) => {
      const workflow = workflowMap.get(note.id);
      return {
        ...serializeNote({
          ...note,
          workflow: workflow
            ? {
                status:
                  workflow.status === 'Signed'
                    ? 'SIGNED'
                    : workflow.status === 'Locked'
                      ? 'LOCKED'
                      : 'DRAFT',
                signedAt: workflow.signedAt ? new Date(workflow.signedAt) : null,
                lockedAt: workflow.lockedAt ? new Date(workflow.lockedAt) : null,
                clinicianName: workflow.clinicianName,
                clinicianImage: workflow.clinicianImage,
              }
            : null,
        }, input.actorUserId),
        clientId: note.client.id,
        clientName: note.client.name,
        clientImage: note.client.image ?? null,
      };
    }),
  };
}

export async function createClientNote(input: {
  clientId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role;
  actorBaseRole?: Role | null;
  body: string;
  aiProvenance?: Record<string, unknown> | null;
  transcriptRiskFlagged?: boolean;
}): Promise<CreateNoteResult> {
  const canWrite =
    canWriteClientChartNotes(input.actorRole) ||
    input.actorBaseRole === 'ADMIN' ||
    input.actorBaseRole === 'PRACTICE_DIRECTOR';
  if (!canWrite) {
    await recordPhiAudit({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: 'progressNote.write',
      resourceType: 'clinicalNote',
      patientId: input.clientId,
      outcome: 'DENIED',
    });
    return { ok: false, status: 403, error: 'Forbidden' };
  }
  const allowed = await findAllowedClient(input);
  if (allowed.ok === false) {
    return { ok: false, status: allowed.status, error: allowed.error };
  }

  const body = input.body.trim();
  if (!body) {
    return { ok: false as const, status: 400, error: 'Note is required' };
  }

  const note = await prisma.progressNote.create({
    data: {
      clientId: input.clientId,
      clinicianId: input.actorUserId,
      body,
      ...(input.aiProvenance
        ? { aiProvenance: input.aiProvenance as Prisma.InputJsonObject }
        : {}),
      ...(input.transcriptRiskFlagged ? { transcriptRiskFlagged: true } : {}),
    },
    include: {
      clinician: { select: { name: true, email: true, image: true } },
    },
  });

  await recordPhiAudit({
    organizationId: input.organizationId,
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: 'progressNote.write',
    resourceType: 'clinicalNote',
    resourceId: note.id,
    patientId: input.clientId,
    outcome: 'SUCCESS',
  });

  return {
    ok: true as const,
    note: serializeNote({
      ...note,
      workflow: null,
    }, input.actorUserId),
  };
}
