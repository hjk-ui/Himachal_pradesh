import { prisma } from '@/lib/db/prisma';

export type MedicalTaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled';

export type MedicalTask = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  note: string;
  status: MedicalTaskStatus;
  assignedToRole: 'MEDICAL_ASSISTANT' | 'PHYSICIAN' | 'MEDICAL_NP' | 'ANY';
  createdById: string | null;
  appointmentId: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  note: string;
  status: string;
  assignedToRole: string;
  createdById: string | null;
  appointmentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): MedicalTask {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    title: row.title,
    note: row.note,
    status: row.status as MedicalTaskStatus,
    assignedToRole: row.assignedToRole as MedicalTask['assignedToRole'],
    createdById: row.createdById,
    appointmentId: row.appointmentId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMedicalTasks(
  organizationId: string,
  filter?: { status?: MedicalTaskStatus; clientId?: string }
): Promise<MedicalTask[]> {
  const rows = await prisma.medicalMaTask.findMany({
    where: {
      organizationId,
      ...(filter?.status ? { status: filter.status } : {}),
      ...(filter?.clientId ? { clientId: filter.clientId } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toDto);
}

export async function createMedicalTask(
  organizationId: string,
  input: {
    clientId: string;
    clientName: string;
    title: string;
    note?: string;
    assignedToRole?: MedicalTask['assignedToRole'];
    appointmentId?: string | null;
    actorUserId: string;
  }
): Promise<MedicalTask> {
  const row = await prisma.medicalMaTask.create({
    data: {
      organizationId,
      clientId: input.clientId,
      clientName: input.clientName,
      title: input.title.trim(),
      note: (input.note || '').trim(),
      status: 'open',
      assignedToRole: input.assignedToRole || 'MEDICAL_ASSISTANT',
      appointmentId: input.appointmentId || null,
      createdById: input.actorUserId,
    },
  });
  return toDto(row);
}

export async function patchMedicalTask(
  organizationId: string,
  id: string,
  patch: { status?: MedicalTaskStatus; note?: string; title?: string }
): Promise<{ ok: true; task: MedicalTask } | { ok: false; error: string }> {
  const existing = await prisma.medicalMaTask.findFirst({
    where: { id, organizationId },
  });
  if (!existing) return { ok: false, error: 'Task not found' };
  const row = await prisma.medicalMaTask.update({
    where: { id },
    data: {
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
    },
  });
  return { ok: true, task: toDto(row) };
}
