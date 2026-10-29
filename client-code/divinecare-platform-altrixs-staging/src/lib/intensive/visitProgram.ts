import { prisma } from '@/lib/db/prisma';
import { PROGRAM_TYPE_META, isProgramType } from './types';

/**
 * Visit Guide: the client's current intensive program level ('iop' | 'php') when admitted to an
 * IOP / PHP program today, else null. Used as `clientProgram` when resolving the visit kind
 * (src/lib/visits/resolveKind.ts), so "Start visit" for a program client shows the IOP / PHP steps.
 */
export async function intensiveProgramFor(organizationId: string, clientId: string, now: Date): Promise<'iop' | 'php' | null> {
  try {
    const e = await prisma.intensiveEnrollment.findFirst({
      where: { organizationId, clientId, status: 'admitted', admissionDate: { lte: now } },
      orderBy: { admissionDate: 'desc' },
      select: { programId: true },
    });
    if (!e) return null;
    const p = await prisma.intensiveProgram.findFirst({ where: { id: e.programId, organizationId }, select: { programType: true } });
    return p && isProgramType(p.programType) ? PROGRAM_TYPE_META[p.programType].visitKind : null;
  } catch {
    // Intensive tables not migrated yet: no program admissions exist
    return null;
  }
}
