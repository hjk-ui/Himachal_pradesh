import type { Role, WaitlistStatus, WaitlistUrgency } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { createClient } from '@/lib/clients/manage';
import { canAccessPath } from '@/lib/auth/roleAccess';
import { CLINICAL_SPECIALTY_ROLES } from '@/types/roles';

/** Staff who can be matched from the waitlist (caseload + leadership). */
const MATCHABLE_CLINICIAN_ROLES: Role[] = [
  'ADMIN',
  'PRACTICE_DIRECTOR',
  'DIRECTOR',
  'CLINICIAN',
  ...CLINICAL_SPECIALTY_ROLES,
];

export function canAccessWaitlist(role: Role) {
  return canAccessPath(role, '/dashboard/clients/waitlist');
}

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function daysWaiting(createdAt: Date) {
  return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86_400_000));
}

function serializeEntry(row: {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  specialty: string;
  urgency: WaitlistUrgency;
  status: WaitlistStatus;
  insurancePayer: string | null;
  referralSource: string | null;
  notes: string | null;
  preferredClinician: string | null;
  clinicianId: string | null;
  convertedClientId: string | null;
  matchedAt: Date | null;
  convertedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  clinician: { id: string; name: string | null; email: string } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    specialty: row.specialty,
    urgency: row.urgency.toLowerCase() as 'routine' | 'urgent' | 'crisis',
    status: row.status.toLowerCase() as 'waiting' | 'matched' | 'scheduled' | 'closed',
    insurancePayer: row.insurancePayer,
    referralSource: row.referralSource,
    notes: row.notes,
    preferredClinician: row.preferredClinician,
    clinicianId: row.clinicianId,
    clinicianName: row.clinician?.name || row.clinician?.email || null,
    convertedClientId: row.convertedClientId,
    matchedAt: row.matchedAt?.toISOString() ?? null,
    convertedAt: row.convertedAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    daysWaiting: daysWaiting(row.createdAt),
  };
}

const entryInclude = {
  clinician: { select: { id: true, name: true, email: true } },
} as const;

export type CreateWaitlistInput = {
  name: string;
  email?: string | null;
  phone?: string | null;
  specialty: string;
  urgency?: 'routine' | 'urgent' | 'crisis';
  insurancePayer?: string | null;
  referralSource?: string | null;
  notes?: string | null;
  preferredClinician?: string | null;
};

export type UpdateWaitlistInput = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  specialty?: string;
  urgency?: 'routine' | 'urgent' | 'crisis';
  insurancePayer?: string | null;
  referralSource?: string | null;
  notes?: string | null;
  preferredClinician?: string | null;
  status?: 'waiting' | 'matched' | 'scheduled' | 'closed';
};

function urgencyToDb(v?: string | null): WaitlistUrgency {
  const u = (v || 'routine').toLowerCase();
  if (u === 'urgent') return 'URGENT';
  if (u === 'crisis') return 'CRISIS';
  return 'ROUTINE';
}

function statusToDb(v: string): WaitlistStatus {
  const s = v.toLowerCase();
  if (s === 'matched') return 'MATCHED';
  if (s === 'scheduled') return 'SCHEDULED';
  if (s === 'closed') return 'CLOSED';
  return 'WAITING';
}

export async function listWaitlistClinicians(organizationId: string) {
  const users = await prisma.user.findMany({
    where: {
      organizationId,
      status: { in: ['ACTIVE', 'INVITED'] },
      role: { in: MATCHABLE_CLINICIAN_ROLES },
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true, image: true },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name || u.email,
    email: u.email,
    role: u.role,
    image: u.image,
  }));
}

export async function listWaitlistEntries(organizationId: string) {
  const rows = await prisma.waitlistEntry.findMany({
    where: { organizationId },
    orderBy: [{ createdAt: 'desc' }, { urgency: 'desc' }],
    include: entryInclude,
  });
  return rows.map(serializeEntry);
}

export async function createWaitlistEntry(
  organizationId: string,
  input: CreateWaitlistInput
) {
  const name = input.name.trim();
  if (name.length < 2) {
    return { ok: false as const, error: 'Name is required', status: 400 };
  }
  const specialty = input.specialty.trim();
  if (!specialty) {
    return { ok: false as const, error: 'Specialty is required', status: 400 };
  }

  const row = await prisma.waitlistEntry.create({
    data: {
      organizationId,
      name,
      email: emptyToNull(input.email)?.toLowerCase() ?? null,
      phone: emptyToNull(input.phone),
      specialty,
      urgency: urgencyToDb(input.urgency),
      insurancePayer: emptyToNull(input.insurancePayer),
      referralSource: emptyToNull(input.referralSource),
      notes: emptyToNull(input.notes),
      preferredClinician: emptyToNull(input.preferredClinician),
      status: 'WAITING',
    },
    include: entryInclude,
  });

  return { ok: true as const, entry: serializeEntry(row) };
}

export async function updateWaitlistEntry(
  organizationId: string,
  id: string,
  input: UpdateWaitlistInput
) {
  const existing = await prisma.waitlistEntry.findFirst({
    where: { id, organizationId },
  });
  if (!existing) {
    return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  }

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) {
      return { ok: false as const, error: 'Name is required', status: 400 };
    }
    data.name = name;
  }
  if (input.email !== undefined) data.email = emptyToNull(input.email)?.toLowerCase() ?? null;
  if (input.phone !== undefined) data.phone = emptyToNull(input.phone);
  if (input.specialty !== undefined) {
    const specialty = input.specialty.trim();
    if (!specialty) {
      return { ok: false as const, error: 'Specialty is required', status: 400 };
    }
    data.specialty = specialty;
  }
  if (input.urgency !== undefined) data.urgency = urgencyToDb(input.urgency);
  if (input.insurancePayer !== undefined) {
    data.insurancePayer = emptyToNull(input.insurancePayer);
  }
  if (input.referralSource !== undefined) {
    data.referralSource = emptyToNull(input.referralSource);
  }
  if (input.notes !== undefined) data.notes = emptyToNull(input.notes);
  if (input.preferredClinician !== undefined) {
    data.preferredClinician = emptyToNull(input.preferredClinician);
  }
  if (input.status !== undefined) {
    const status = statusToDb(input.status);
    data.status = status;
    if (status === 'CLOSED') data.closedAt = new Date();
  }

  const row = await prisma.waitlistEntry.update({
    where: { id },
    data,
    include: entryInclude,
  });

  return { ok: true as const, entry: serializeEntry(row) };
}

export async function matchWaitlistEntry(
  organizationId: string,
  id: string,
  clinicianId: string
) {
  const existing = await prisma.waitlistEntry.findFirst({
    where: { id, organizationId },
  });
  if (!existing) {
    return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  }
  if (existing.status === 'CLOSED') {
    return { ok: false as const, error: 'Entry is closed', status: 400 };
  }

  const clinician = await prisma.user.findFirst({
    where: {
      id: clinicianId,
      organizationId,
      status: 'ACTIVE',
      role: { in: MATCHABLE_CLINICIAN_ROLES },
    },
  });
  if (!clinician) {
    return { ok: false as const, error: 'Clinician not found', status: 400 };
  }

  const row = await prisma.waitlistEntry.update({
    where: { id },
    data: {
      clinicianId,
      status: 'MATCHED',
      matchedAt: new Date(),
    },
    include: entryInclude,
  });

  return { ok: true as const, entry: serializeEntry(row) };
}

export async function closeWaitlistEntry(organizationId: string, id: string) {
  return updateWaitlistEntry(organizationId, id, { status: 'closed' });
}

export async function convertWaitlistEntry(
  organizationId: string,
  id: string,
  actorUserId: string
) {
  const existing = await prisma.waitlistEntry.findFirst({
    where: { id, organizationId },
    include: entryInclude,
  });
  if (!existing) {
    return { ok: false as const, error: 'Waitlist entry not found', status: 404 };
  }
  if (existing.convertedClientId) {
    return {
      ok: false as const,
      error: 'Already converted to a client',
      status: 409,
    };
  }
  if (existing.status === 'CLOSED') {
    return { ok: false as const, error: 'Entry is closed', status: 400 };
  }
  if (existing.status === 'WAITING' || !existing.clinicianId) {
    return {
      ok: false as const,
      error: 'Match a clinician before converting to a client',
      status: 400,
    };
  }

  const created = await createClient(
    {
      name: existing.name,
      email: existing.email,
      phone: existing.phone,
      insurancePayer: existing.insurancePayer,
      assignedToId: existing.clinicianId,
      status: 'ACTIVE',
      secondaryDiagnoses: existing.specialty
        ? `Waitlist specialty: ${existing.specialty}`
        : null,
    },
    actorUserId,
    organizationId
  );

  if (!created.ok) {
    return {
      ok: false as const,
      error: created.error,
      status: created.status,
    };
  }

  const row = await prisma.waitlistEntry.update({
    where: { id },
    data: {
      status: 'SCHEDULED',
      convertedClientId: created.client.id,
      convertedAt: new Date(),
    },
    include: entryInclude,
  });

  return {
    ok: true as const,
    entry: serializeEntry(row),
    client: {
      id: created.client.id,
      name: created.client.name,
    },
  };
}
