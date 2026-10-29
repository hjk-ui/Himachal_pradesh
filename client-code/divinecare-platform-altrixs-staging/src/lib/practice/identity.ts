/**
 * Practice identity for letters and forms: display name + accreditation (non-PHI).
 * Name comes from Practice settings (DBA, else legal name), else the Organization name.
 * Accreditation is null unless recorded; letters must not claim accreditation that is not on file.
 */
import { prisma } from '@/lib/db/prisma';
import { ACCREDITATION_BODIES } from '@/lib/practice/settings';

export type PracticeIdentity = {
  name: string | null;
  /** e.g. 'CARF'; null when not recorded or 'none' */
  accreditationBody: string | null;
  /** e.g. 'CARF' / 'The Joint Commission'; null when not accredited / not recorded */
  accreditationLabel: string | null;
};

export function accreditationLabel(body: string | null | undefined): string | null {
  if (!body || body === 'none') return null;
  return ACCREDITATION_BODIES.find((a) => a.value === body)?.label ?? body;
}

export async function loadPracticeIdentity(organizationId: string): Promise<PracticeIdentity> {
  let settings: { legalName: string | null; dbaName: string | null; accreditationBody: string | null } | null = null;
  try {
    settings = await prisma.practiceSettings.findUnique({
      where: { organizationId },
      select: { legalName: true, dbaName: true, accreditationBody: true },
    });
  } catch {
    settings = null; // settings table missing: fall back to the organization row
  }
  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const name = settings?.dbaName?.trim() || settings?.legalName?.trim() || org?.name?.trim() || null;
  const body = settings?.accreditationBody && settings.accreditationBody !== 'none' ? settings.accreditationBody : null;
  return { name, accreditationBody: body, accreditationLabel: accreditationLabel(body) };
}
