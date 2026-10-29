import type { ConsentFormStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere, clientByIdWhere } from '@/lib/clients/orgScope';

const CONSENT_ROLES: Role[] = [
  'ADMIN',
  'DIRECTOR',
  'PRACTICE_DIRECTOR',
  'CLINICIAN',
  'THERAPIST',
  'PSYCHIATRIST',
  'NP',
  'FRONT_DESK',
  'OFFICE_MANAGER',
];

export function canAccessConsents(role: Role | undefined | null) {
  return Boolean(role && CONSENT_ROLES.includes(role));
}

export const CONSENT_TYPE_OPTIONS = [
  'Consent to Treat',
  'HIPAA Notice',
  'Telehealth Consent',
  'Release of Information',
  'Photography/Media',
  'Research Participation',
  'SMS Consent',
] as const;

export type ConsentTypeOption = (typeof CONSENT_TYPE_OPTIONS)[number];

export type ConsentListItem = {
  id: string;
  clientId: string;
  clientName: string;
  type: string;
  status: 'pending' | 'signed' | 'expired' | 'declined';
  method: string;
  sentAt: string;
  signedAt: string | null;
  expiresAt: string | null;
  signedByName: string | null;
  notes: string | null;
};

function emptyToNull(v?: string | null) {
  if (v == null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function toUiStatus(
  status: ConsentFormStatus,
  expiresAt: Date | null
): ConsentListItem['status'] {
  if (status === 'SIGNED') {
    if (expiresAt && expiresAt.getTime() < Date.now()) return 'expired';
    return 'signed';
  }
  if (status === 'EXPIRED') return 'expired';
  if (status === 'DECLINED') return 'declined';
  return 'pending';
}

function serialize(row: {
  id: string;
  clientId: string;
  type: string;
  status: ConsentFormStatus;
  method: string;
  sentAt: Date;
  signedAt: Date | null;
  expiresAt: Date | null;
  signedByName: string | null;
  notes: string | null;
  client: { name: string };
}): ConsentListItem {
  return {
    id: row.id,
    clientId: row.clientId,
    clientName: row.client.name,
    type: row.type,
    status: toUiStatus(row.status, row.expiresAt),
    method: row.method,
    sentAt: row.sentAt.toISOString().slice(0, 10),
    signedAt: row.signedAt?.toISOString().slice(0, 10) ?? null,
    expiresAt: row.expiresAt?.toISOString().slice(0, 10) ?? null,
    signedByName: row.signedByName,
    notes: row.notes,
  };
}

function defaultExpiry(type: string, from = new Date()): Date | null {
  const d = new Date(from);
  switch (type) {
    case 'Telehealth Consent':
      d.setMonth(d.getMonth() + 6);
      return d;
    case 'Photography/Media':
      return null;
    default:
      d.setFullYear(d.getFullYear() + 1);
      return d;
  }
}

async function expireStale(organizationId: string) {
  await prisma.consentForm.updateMany({
    where: {
      organizationId,
      status: 'SIGNED',
      expiresAt: { lt: new Date() },
    },
    data: { status: 'EXPIRED' },
  });
}

export async function listConsents(
  organizationId: string,
  actor: { userId: string; role: Role },
  clientId?: string
) {
  await expireStale(organizationId);
  const scopedClients = clientAccessWhere({
    organizationId,
    actorUserId: actor.userId,
    actorRole: actor.role,
  });
  const rows = await prisma.consentForm.findMany({
    where: {
      organizationId,
      ...(clientId
        ? {
            clientId,
            client: {
              AND: [clientByIdWhere(clientId, organizationId), scopedClients],
            },
          }
        : { client: scopedClients }),
    },
    include: { client: { select: { name: true } } },
    orderBy: { sentAt: 'desc' },
  });
  return rows.map(serialize);
}

export async function createConsents(
  organizationId: string,
  actorUserId: string,
  actorRole: Role,
  input: {
    clientId: string;
    types: string[];
    method?: string;
    notes?: string | null;
  }
) {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId,
        actorUserId,
        actorRole,
      }),
    },
    select: { id: true, name: true },
  });
  if (!client) {
    return { ok: false as const, error: 'Client not found', status: 404 };
  }

  const types = [...new Set(input.types.map((t) => t.trim()).filter(Boolean))];
  if (types.length === 0) {
    return { ok: false as const, error: 'Select at least one consent type', status: 400 };
  }
  for (const t of types) {
    if (!(CONSENT_TYPE_OPTIONS as readonly string[]).includes(t)) {
      return { ok: false as const, error: `Invalid consent type: ${t}`, status: 400 };
    }
  }

  const method = emptyToNull(input.method) || 'In-Person';
  const notes = emptyToNull(input.notes);
  const now = new Date();

  const created = await prisma.$transaction(
    types.map((type) =>
      prisma.consentForm.create({
        data: {
          organizationId,
          clientId: client.id,
          type,
          status: 'PENDING',
          method,
          notes,
          sentAt: now,
          createdById: actorUserId,
        },
        include: { client: { select: { name: true } } },
      })
    )
  );

  return { ok: true as const, consents: created.map(serialize) };
}

export async function signConsent(
  organizationId: string,
  id: string,
  input?: { signedByName?: string | null }
) {
  await expireStale(organizationId);
  const existing = await prisma.consentForm.findFirst({
    where: { id, organizationId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Consent not found', status: 404 };
  }
  if (existing.status === 'SIGNED') {
    return { ok: true as const, consent: serialize(existing) };
  }
  if (existing.status === 'DECLINED') {
    // Signing again is how staff turn SMS consent back on.
  }

  const signedAt = new Date();
  const expiresAt = existing.expiresAt || defaultExpiry(existing.type, signedAt);
  const updated = await prisma.consentForm.update({
    where: { id },
    data: {
      status: 'SIGNED',
      signedAt,
      expiresAt,
      signedByName:
        emptyToNull(input?.signedByName) || existing.client.name || 'Client',
    },
    include: { client: { select: { name: true } } },
  });

  if (/sms/i.test(existing.type)) {
    await prisma.client
      .update({
        where: { id: existing.clientId },
        data: {
          smsConsent: true,
          smsConsentAt: signedAt,
          smsConsentSource: 'consent_form',
          smsOptOutAt: null,
        },
      })
      .catch(() => undefined);
  }

  return { ok: true as const, consent: serialize(updated) };
}

export async function declineConsent(organizationId: string, id: string) {
  const existing = await prisma.consentForm.findFirst({
    where: { id, organizationId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Consent not found', status: 404 };
  }
  const updated = await prisma.consentForm.update({
    where: { id },
    data: { status: 'DECLINED' },
    include: { client: { select: { name: true } } },
  });
  return { ok: true as const, consent: serialize(updated) };
}

export async function resendConsent(organizationId: string, id: string) {
  await expireStale(organizationId);
  const existing = await prisma.consentForm.findFirst({
    where: { id, organizationId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Consent not found', status: 404 };
  }
  if (existing.status !== 'PENDING') {
    return { ok: false as const, error: 'Only pending consents can be resent', status: 400 };
  }

  const updated = await prisma.consentForm.update({
    where: { id },
    data: { sentAt: new Date() },
    include: { client: { select: { name: true } } },
  });

  return { ok: true as const, consent: serialize(updated) };
}
