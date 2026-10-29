/**
 * Treatment plan content libraries (server): the Practice Library (shared by the practice, kept
 * on the Goal Bank page) and each provider's Personal Library. Stored in ClinicModuleState JSON;
 * these module keys are not reachable through the generic /api/modules route (unknown modules
 * are refused there), so every read and write goes through /api/ehr/treatment-plans/library.
 *
 * Valant's library and the Wiley PracticePlanners® library are licensed third-party content and
 * are not included (planHierarchy LIBRARY_SOURCES).
 */
import type { Role } from '@prisma/client';
import { getModuleData, saveModuleData } from '@/lib/modules/manage';
import { sanitizeLibrary, type LibraryItem } from '@/lib/ehr/therapy/planHierarchy';

export const PRACTICE_LIBRARY_MODULE = 'tp-library:practice';
export const personalLibraryModule = (userId: string) => `tp-library:user:${userId}`;

/** Who maintains the Practice Library (everyone with plan access can use it and keep a Personal Library). */
const PRACTICE_LIBRARY_EDITORS = new Set<string>(['ADMIN', 'DIRECTOR', 'PRACTICE_DIRECTOR']);
export function canEditPracticeLibrary(role: Role | string | null | undefined): boolean {
  return Boolean(role && PRACTICE_LIBRARY_EDITORS.has(String(role)));
}

export type Libraries = { practice: LibraryItem[]; personal: LibraryItem[] };

async function read(organizationId: string, module: string): Promise<LibraryItem[]> {
  try {
    return sanitizeLibrary(await getModuleData(organizationId, module));
  } catch {
    return [];
  }
}

export async function loadLibraries(organizationId: string, userId: string): Promise<Libraries> {
  const [practice, personal] = await Promise.all([read(organizationId, PRACTICE_LIBRARY_MODULE), read(organizationId, personalLibraryModule(userId))]);
  return { practice, personal };
}

export async function saveLibrary(organizationId: string, scope: 'practice' | 'personal', userId: string, items: unknown): Promise<LibraryItem[]> {
  const clean = sanitizeLibrary(items);
  await saveModuleData(organizationId, scope === 'practice' ? PRACTICE_LIBRARY_MODULE : personalLibraryModule(userId), clean);
  return clean;
}

/** Text of a library item by id (library editing rule checks). */
export function libraryText(libs: Libraries, source: 'practice' | 'personal', id: string): string | null {
  return (source === 'practice' ? libs.practice : libs.personal).find((i) => i.id === id)?.text ?? null;
}
