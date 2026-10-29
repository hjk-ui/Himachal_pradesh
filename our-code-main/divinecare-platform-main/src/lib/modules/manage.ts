import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { stripDemoModuleData } from './demoData';

export async function getModuleData<T>(organizationId: string, module: string): Promise<T | null> {
  const row = await prisma.clinicModuleState.findUnique({
    where: {
      organizationId_module: { organizationId, module },
    },
  });
  if (!row) return null;
  const cleaned = stripDemoModuleData(row.data as T);
  // Reads must never delete stored records based on a display/demo heuristic.
  return cleaned;
}

export async function saveModuleData<T>(organizationId: string, module: string, data: T) {
  const payload = data as Prisma.InputJsonValue;
  await prisma.clinicModuleState.upsert({
    where: {
      organizationId_module: { organizationId, module },
    },
    create: { organizationId, module, data: payload },
    update: { data: payload },
  });
}

export async function getModuleSnapshot(organizationId: string, module: string) {
  const row = await prisma.clinicModuleState.findUnique({
    where: { organizationId_module: { organizationId, module } },
  });
  return { data: row ? stripDemoModuleData(row.data) : null, version: row?.updatedAt.toISOString() ?? 'new' };
}

export class ModuleConflictError extends Error {
  constructor() { super('Another editor changed these records. Copy your unsaved changes, then reload and reconcile before saving'); }
}

/** Conditional writes for updated clients; legacy callers retain their old envelope during rollout. */
export async function saveModuleSnapshot(organizationId: string, module: string, data: unknown, version?: string) {
  if (version === undefined) {
    await saveModuleData(organizationId, module, data);
    return (await getModuleSnapshot(organizationId, module)).version;
  }
  const payload = data as Prisma.InputJsonValue;
  if (version === 'new') {
    try {
      const row = await prisma.clinicModuleState.create({ data: { organizationId, module, data: payload } });
      return row.updatedAt.toISOString();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ModuleConflictError();
      throw error;
    }
  }
  const previous = new Date(version);
  if (!Number.isFinite(previous.getTime())) throw new Error('Invalid record version');
  const updatedAt = new Date(Math.max(Date.now(), previous.getTime() + 1));
  const result = await prisma.clinicModuleState.updateMany({
    where: { organizationId, module, updatedAt: previous },
    data: { data: payload, updatedAt },
  });
  if (result.count !== 1) throw new ModuleConflictError();
  return updatedAt.toISOString();
}
