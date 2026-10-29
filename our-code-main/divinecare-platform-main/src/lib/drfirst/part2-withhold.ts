import { prisma } from '@/lib/db/prisma';
import { CURRENT_DIAGNOSIS_STATUSES } from '@/lib/diagnoses/types';
import { isSudDiagnosisCode } from '@/lib/diagnoses/sud';

/** Shown to staff whenever SUD diagnoses are held back from DrFirst. */
export const PART2_WITHHOLD_NOTICE = 'SUD diagnoses not sent to DrFirst: no Part 2 consent on file';

export type DrFirstDiagnosis = { code: string; description: string; isPrimary: boolean };

/** A signed, unexpired consent form that names 42 CFR Part 2. */
export async function hasPart2ConsentOnFile(organizationId: string, clientId: string): Promise<boolean> {
  const now = new Date();
  const forms = await prisma.consentForm.findMany({
    where: {
      organizationId,
      clientId,
      status: 'SIGNED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { type: true },
  });
  return forms.some((f) => /part\s*2|42\s*cfr/i.test(f.type));
}

/** Pure split used by tests and by `loadDrFirstDiagnoses`. */
export function partitionDiagnosesForDrFirst<T extends { code: string }>(
  diagnoses: T[],
  part2ConsentOnFile: boolean
): { send: T[]; withheld: T[]; notice: string | null } {
  if (part2ConsentOnFile) return { send: diagnoses, withheld: [], notice: null };
  const send = diagnoses.filter((d) => !isSudDiagnosisCode(d.code));
  const withheld = diagnoses.filter((d) => isSudDiagnosisCode(d.code));
  return { send, withheld, notice: withheld.length > 0 ? PART2_WITHHOLD_NOTICE : null };
}

/**
 * Current diagnoses that may go to DrFirst for this client. Used by register-on-launch and patient sync.
 * Withheld codes are returned only as a count — never the SUD code itself.
 */
export async function loadDrFirstDiagnoses(
  organizationId: string,
  clientId: string
): Promise<{ diagnoses: DrFirstDiagnosis[]; withheldCount: number; notice: string | null }> {
  const rows = await prisma.clientDiagnosis.findMany({
    where: { organizationId, clientId, status: { in: [...CURRENT_DIAGNOSIS_STATUSES] } },
    orderBy: [{ isPrimary: 'desc' }, { rank: 'asc' }],
    select: { code: true, description: true, isPrimary: true },
  });
  const consent = await hasPart2ConsentOnFile(organizationId, clientId);
  const { send, withheld, notice } = partitionDiagnosesForDrFirst(rows, consent);
  return { diagnoses: send, withheldCount: withheld.length, notice };
}
