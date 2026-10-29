import { randomUUID } from 'node:crypto';
import type { Prisma, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

const REMINDER = 'hr:reminder:';
const CHECKLIST = 'hr:checklist:';
const PTO = 'hr:pto:';
const REVIEW = 'hr:review:';
const GOAL = 'hr:goal:';
const TRAINING = 'hr:training-req:';
const SETTINGS = 'hr:settings';
const EMPLOYEE = 'hr:employee:';

export type HrReminder = {
  id: string;
  title: string;
  status: 'open' | 'done' | 'dismissed';
  createdAt: string;
  updatedAt: string;
};

export type HrChecklistTask = { id: string; label: string; done: boolean };
export type HrChecklist = {
  id: string;
  type: 'onboarding' | 'offboarding';
  staffUserId: string;
  staffName: string;
  status: 'In progress' | 'Complete' | 'Cancelled';
  tasks: HrChecklistTask[];
  createdAt: string;
  updatedAt: string;
};

export type HrPtoRequest = {
  id: string;
  staffUserId: string;
  staffName: string;
  startDate: string;
  endDate: string;
  reason: string;
  status: 'pending' | 'approved' | 'denied';
  createdAt: string;
  updatedAt: string;
};

export type HrReview = {
  id: string;
  staffUserId: string;
  staffName: string;
  status: 'open' | 'completed';
  summary: string;
  createdAt: string;
  updatedAt: string;
};

function asRecord(data: unknown): Record<string, unknown> {
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
}

async function listByPrefix<T>(organizationId: string, pfx: string): Promise<T[]> {
  const rows = await prisma.clinicModuleState.findMany({
    where: { organizationId, module: { startsWith: pfx } },
    orderBy: { updatedAt: 'desc' },
  });
  return rows.map((r) => ({ id: r.module.slice(pfx.length), ...asRecord(r.data) }) as T);
}

async function upsertModule(
  organizationId: string,
  module: string,
  data: Record<string, unknown>
) {
  const json = data as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: { organizationId_module: { organizationId, module } },
    create: { organizationId, module, data: json },
    update: { data: json },
  });
}

/** OM may see employment/credentials/training — not pay, discipline, or personal profile fields. */
export function hrFieldAccess(role: Role) {
  const isOm = role === 'OFFICE_MANAGER';
  const isHrPersonnel = ['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR', 'HR'].includes(role);
  return {
    canSeeCompensation: isHrPersonnel && !isOm,
    canSeeDiscipline: isHrPersonnel && !isOm,
    canSeePersonal: !isOm,
    canApprovePto: isHrPersonnel,
    canManageSettings: isHrPersonnel,
  };
}

export async function listReminders(organizationId: string) {
  return listByPrefix<HrReminder>(organizationId, REMINDER);
}

export async function createReminder(organizationId: string, title: string) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const data: Omit<HrReminder, 'id'> = {
    title: title.trim() || 'Reminder',
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  await upsertModule(organizationId, `${REMINDER}${id}`, data);
  return { id, ...data };
}

export async function setReminderStatus(
  organizationId: string,
  id: string,
  status: HrReminder['status']
) {
  const module = `${REMINDER}${id}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  const next = { ...asRecord(existing.data), status, updatedAt: new Date().toISOString() };
  await upsertModule(organizationId, module, next);
  return { ok: true as const, item: { id, ...next } };
}

export async function listChecklists(organizationId: string, type?: 'onboarding' | 'offboarding') {
  const all = await listByPrefix<HrChecklist>(organizationId, CHECKLIST);
  return type ? all.filter((c) => c.type === type) : all;
}

export async function startChecklist(
  organizationId: string,
  input: {
    type: 'onboarding' | 'offboarding';
    staffUserId: string;
    staffName: string;
  }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const defaults =
    input.type === 'onboarding'
      ? ['I-9 / onboarding packet', 'Systems access', 'Credential upload', 'Policy acknowledgment']
      : ['Collect badge / keys', 'Disable Altrixs login', 'Final pay checklist', 'Exit interview'];
  const data: Omit<HrChecklist, 'id'> = {
    type: input.type,
    staffUserId: input.staffUserId,
    staffName: input.staffName,
    status: 'In progress',
    tasks: defaults.map((label) => ({ id: randomUUID(), label, done: false })),
    createdAt: now,
    updatedAt: now,
  };
  await upsertModule(organizationId, `${CHECKLIST}${id}`, data);
  return { id, ...data };
}

export async function setChecklistTaskDone(
  organizationId: string,
  checklistId: string,
  taskId: string,
  done: boolean
) {
  const module = `${CHECKLIST}${checklistId}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  const cur = asRecord(existing.data);
  const tasks = Array.isArray(cur.tasks) ? [...(cur.tasks as HrChecklistTask[])] : [];
  const nextTasks = tasks.map((t) => (t.id === taskId ? { ...t, done } : t));
  const allDone = nextTasks.length > 0 && nextTasks.every((t) => t.done);
  const next = {
    ...cur,
    tasks: nextTasks,
    status: allDone ? 'Complete' : cur.status === 'Cancelled' ? 'Cancelled' : 'In progress',
    updatedAt: new Date().toISOString(),
  };
  await upsertModule(organizationId, module, next);
  return { ok: true as const, item: { id: checklistId, ...next } };
}

export async function setChecklistStatus(
  organizationId: string,
  checklistId: string,
  status: HrChecklist['status']
) {
  const module = `${CHECKLIST}${checklistId}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  const next = { ...asRecord(existing.data), status, updatedAt: new Date().toISOString() };
  await upsertModule(organizationId, module, next);
  return { ok: true as const, item: { id: checklistId, ...next } };
}

export async function listPto(organizationId: string) {
  return listByPrefix<HrPtoRequest>(organizationId, PTO);
}

export async function createPto(
  organizationId: string,
  input: Omit<HrPtoRequest, 'id' | 'status' | 'createdAt' | 'updatedAt'>
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const data = { ...input, status: 'pending' as const, createdAt: now, updatedAt: now };
  await upsertModule(organizationId, `${PTO}${id}`, data);
  return { id, ...data };
}

export async function setPtoStatus(
  organizationId: string,
  id: string,
  status: HrPtoRequest['status']
) {
  const module = `${PTO}${id}`;
  const existing = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  if (!existing) return { ok: false as const, error: 'Not found', status: 404 };
  const next = { ...asRecord(existing.data), status, updatedAt: new Date().toISOString() };
  await upsertModule(organizationId, module, next);
  return { ok: true as const, item: { id, ...next } };
}

export async function listReviews(organizationId: string) {
  return listByPrefix<HrReview>(organizationId, REVIEW);
}

export async function createReview(
  organizationId: string,
  input: { staffUserId: string; staffName: string; summary?: string }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const data = {
    staffUserId: input.staffUserId,
    staffName: input.staffName,
    status: 'open' as const,
    summary: input.summary || '',
    createdAt: now,
    updatedAt: now,
  };
  await upsertModule(organizationId, `${REVIEW}${id}`, data);
  return { id, ...data };
}

export async function listGoals(organizationId: string) {
  return listByPrefix<{ id: string; title: string; staffName: string }>(organizationId, GOAL);
}

export async function createGoal(
  organizationId: string,
  input: { title: string; staffName: string }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const data = { ...input, createdAt: now, updatedAt: now };
  await upsertModule(organizationId, `${GOAL}${id}`, data);
  return { id, ...data };
}

export async function listRequiredTrainings(organizationId: string) {
  return listByPrefix<{ id: string; title: string; hours: number }>(organizationId, TRAINING);
}

export async function createRequiredTraining(
  organizationId: string,
  input: { title: string; hours?: number }
) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const data = {
    title: input.title.trim(),
    hours: input.hours ?? 1,
    createdAt: now,
    updatedAt: now,
  };
  await upsertModule(organizationId, `${TRAINING}${id}`, data);
  return { id, ...data };
}

export async function getHrSettings(organizationId: string) {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module: SETTINGS } },
  });
  const d = asRecord(row?.data);
  return {
    expirationsDays: Number(d.expirationsDays ?? 30),
    mdSickLeaveDays: Number(d.mdSickLeaveDays ?? 5),
    ptoDays: Number(d.ptoDays ?? 15),
    ceuHours: Number(d.ceuHours ?? 20),
    templates: String(d.templates || ''),
    policies: String(d.policies || ''),
    aiEnabled: Boolean(d.aiEnabled),
  };
}

export async function saveHrSettings(
  organizationId: string,
  patch: Record<string, unknown>
) {
  const prev = await getHrSettings(organizationId);
  const data = { ...prev, ...patch };
  await upsertModule(organizationId, SETTINGS, data);
  return data;
}

export async function getEmployeeRecord(organizationId: string, userId: string) {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module: `${EMPLOYEE}${userId}` },
    },
  });
  const d = asRecord(row?.data);
  return {
    userId,
    compensationNote: String(d.compensationNote || ''),
    personalNote: String(d.personalNote || ''),
    correctiveNote: String(d.correctiveNote || ''),
    documents: Array.isArray(d.documents) ? (d.documents as string[]) : [],
  };
}

export async function saveEmployeeRecord(
  organizationId: string,
  userId: string,
  patch: Record<string, unknown>
) {
  const prev = await getEmployeeRecord(organizationId, userId);
  const data = { ...prev, ...patch, userId };
  await upsertModule(organizationId, `${EMPLOYEE}${userId}`, data);
  return data;
}

export async function dashboardSnapshot(organizationId: string) {
  const [reminders, checklists, users] = await Promise.all([
    listReminders(organizationId),
    listChecklists(organizationId),
    prisma.user.count({
      where: { organizationId, status: { in: ['ACTIVE', 'INVITED'] }, role: { not: 'SUPER_ADMIN' } },
    }),
  ]);
  const openReminders = reminders.filter((r) => r.status === 'open');
  const onboarding = checklists.filter((c) => c.type === 'onboarding' && c.status === 'In progress');
  const offboarding = checklists.filter(
    (c) => c.type === 'offboarding' && c.status === 'In progress'
  );
  return {
    kpis: {
      expiredOrMissing: 0,
      dueWithin30: 0,
      exclusionDue: 0,
      headcount: users,
    },
    reminders: openReminders,
    waitingOnYou: openReminders.slice(0, 5),
    onboarding,
    offboarding,
  };
}
