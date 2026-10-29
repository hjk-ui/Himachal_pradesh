import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

/** FHIR / internal identifier system for clinic MRNs */
export const ALTRIXS_MRN_SYSTEM = 'urn:altrixs:mrn';

const MRN_RE = /^ALT-[A-Z0-9]{2,8}-\d{4}-\d{6}$/;

/** Normalize staff-entered MRN (uppercase, trim, collapse spaces). */
export function normalizeMrnInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

export function isValidMrnFormat(mrn: string): boolean {
  return MRN_RE.test(mrn);
}

function orgCodeFromSlug(slug: string): string {
  const cleaned = slug
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);
  return cleaned.length >= 2 ? cleaned : `ORG${cleaned}`.slice(0, 6).padEnd(3, 'X');
}

function buildMrn(orgCode: string, year: number, seq: number): string {
  return `ALT-${orgCode}-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Atomically allocate the next unique MRN for an organization.
 * Format: ALT-{ORGCODE}-{YYYY}-{######}
 */
export async function allocateNextMrn(
  organizationId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<string> {
  const year = new Date().getFullYear();

  for (let attempt = 0; attempt < 8; attempt++) {
    const org = await db.organization.update({
      where: { id: organizationId },
      data: { mrnNextSequence: { increment: 1 } },
      select: { slug: true, mrnNextSequence: true },
    });

    // After increment, mrnNextSequence is the value just consumed.
    const seq = org.mrnNextSequence - 1;
    const mrn = buildMrn(orgCodeFromSlug(org.slug), year, Math.max(1, seq));

    const clash = await db.client.findFirst({
      where: { organizationId, mrn },
      select: { id: true },
    });
    if (!clash) return mrn;
  }

  // Extremely unlikely collision fallback — include time fragment
  const org = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { slug: true },
  });
  const stamp = Date.now().toString().slice(-6);
  return buildMrn(orgCodeFromSlug(org.slug), year, Number(stamp) || 1);
}

/**
 * Resolve organizationId for a client from explicit value, location, or assignee.
 */
export async function resolveClientOrganizationId(client: {
  id: string;
  organizationId?: string | null;
  locationId?: string | null;
  assignedToId?: string | null;
}): Promise<string | null> {
  if (client.organizationId) return client.organizationId;

  if (client.locationId) {
    const loc = await prisma.location.findUnique({
      where: { id: client.locationId },
      select: { organizationId: true },
    });
    if (loc?.organizationId) return loc.organizationId;
  }

  if (client.assignedToId) {
    const user = await prisma.user.findUnique({
      where: { id: client.assignedToId },
      select: { organizationId: true },
    });
    if (user?.organizationId) return user.organizationId;
  }

  return null;
}

/**
 * Ensure client has organizationId + mrn persisted. Idempotent.
 * Call on create paths and lazily on read for legacy rows.
 */
export async function ensureClientMrn(clientId: string): Promise<{
  organizationId: string | null;
  mrn: string | null;
}> {
  const existing = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      organizationId: true,
      mrn: true,
      locationId: true,
      assignedToId: true,
    },
  });
  if (!existing) return { organizationId: null, mrn: null };
  if (existing.organizationId && existing.mrn) {
    return { organizationId: existing.organizationId, mrn: existing.mrn };
  }

  const organizationId =
    existing.organizationId || (await resolveClientOrganizationId(existing));
  if (!organizationId) {
    return { organizationId: null, mrn: existing.mrn };
  }

  if (existing.mrn && !existing.organizationId) {
    await prisma.client.update({
      where: { id: clientId },
      data: { organizationId },
    });
    return { organizationId, mrn: existing.mrn };
  }

  return prisma.$transaction(async (tx) => {
    const again = await tx.client.findUnique({
      where: { id: clientId },
      select: { organizationId: true, mrn: true },
    });
    if (again?.organizationId && again.mrn) {
      return { organizationId: again.organizationId, mrn: again.mrn };
    }

    const mrn = again?.mrn || (await allocateNextMrn(organizationId, tx));
    try {
      const updated = await tx.client.update({
        where: { id: clientId },
        data: {
          organizationId,
          mrn,
        },
        select: { organizationId: true, mrn: true },
      });
      return {
        organizationId: updated.organizationId,
        mrn: updated.mrn,
      };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const retryMrn = await allocateNextMrn(organizationId, tx);
        const updated = await tx.client.update({
          where: { id: clientId },
          data: { organizationId, mrn: retryMrn },
          select: { organizationId: true, mrn: true },
        });
        return {
          organizationId: updated.organizationId,
          mrn: updated.mrn,
        };
      }
      throw err;
    }
  });
}

/**
 * Validate and reserve a staff-chosen MRN for an organization (unique).
 */
export async function assertMrnAvailable(
  organizationId: string,
  rawMrn: string,
  excludeClientId?: string
): Promise<{ ok: true; mrn: string } | { ok: false; error: string }> {
  const mrn = normalizeMrnInput(rawMrn);
  if (mrn.length < 4 || mrn.length > 40) {
    return { ok: false, error: 'MRN must be 4–40 characters' };
  }
  if (!/^[A-Z0-9][A-Z0-9\-]*$/.test(mrn)) {
    return {
      ok: false,
      error: 'MRN may only contain letters, numbers, and hyphens',
    };
  }

  const clash = await prisma.client.findFirst({
    where: {
      organizationId,
      mrn,
      ...(excludeClientId ? { id: { not: excludeClientId } } : {}),
    },
    select: { id: true, name: true },
  });
  if (clash) {
    return {
      ok: false,
      error: `MRN ${mrn} is already assigned to another client in this clinic`,
    };
  }
  return { ok: true, mrn };
}
