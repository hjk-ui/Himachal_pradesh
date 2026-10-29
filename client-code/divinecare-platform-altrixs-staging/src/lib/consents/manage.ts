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
  'AI Note Drafting',
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

async function expireStale(organizationId: string) {
  await prisma.consentForm.updateMany({
    where: {
      organizationId,
      formKey: null,
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
      // Structured, versioned forms (e.g. the Carelon non-overlap attestation) have their own
      // workflow and page (/dashboard/ehr/consents/carelon); they are not signed from this list.
      formKey: null,
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

/**
 * Retired (consents standard, 2026-10-21): the simple consent records had no template text, no
 * signature and no evidence ("Mark signed" by staff; "DocuSign" / "Email" delivery that never sent
 * anything). New consents are sent and signed through the consent library (versioned text, typed
 * e-signature, SHA-256 of the signed text, audit trail). Existing records stay readable and count
 * as signed where they were signed (LEGACY_TYPE_TO_KEY); they can still be revoked.
 */
export const LEGACY_CONSENT_RETIRED =
  "Simple consent records are retired. Send the consent from the client's Consents page (consent library), where it is signed with its exact text and an audit trail.";

export async function createConsents(
  _organizationId: string,
  _actorUserId: string,
  _actorRole: Role,
  _input: { clientId: string; types: string[]; method?: string; notes?: string | null }
) {
  void _organizationId;
  void _actorUserId;
  void _actorRole;
  void _input;
  return { ok: false as const, error: LEGACY_CONSENT_RETIRED, status: 410 };
}

export async function signConsent(
  organizationId: string,
  id: string,
  _input?: { signedByName?: string | null }
) {
  void _input;
  await expireStale(organizationId);
  const existing = await prisma.consentForm.findFirst({
    where: { id, organizationId },
    include: { client: { select: { name: true } } },
  });
  if (!existing) {
    return { ok: false as const, error: 'Consent not found', status: 404 };
  }
  if (existing.formKey) {
    return { ok: false as const, error: 'This form is signed through its own workflow (Consents > Carelon attestations)', status: 400 };
  }
  if (existing.status === 'SIGNED') {
    return { ok: true as const, consent: serialize(existing) };
  }
  // Staff can no longer mark a consent signed without a signature record (consents standard)
  return { ok: false as const, error: LEGACY_CONSENT_RETIRED, status: 410, clientId: existing.clientId };
}

/** Retired: bumping sentAt sent nothing to the client. Packets are re-sent from the hub (notifyPacket). */
export async function resendConsent(organizationId: string, id: string) {
  const existing = await prisma.consentForm.findFirst({ where: { id, organizationId }, select: { id: true, clientId: true, formKey: true } });
  if (!existing) {
    return { ok: false as const, error: 'Consent not found', status: 404 };
  }
  if (existing.formKey) {
    return { ok: false as const, error: 'This form is sent through its own workflow (Consents > Carelon attestations)', status: 400 };
  }
  return { ok: false as const, error: LEGACY_CONSENT_RETIRED, status: 410, clientId: existing.clientId };
}
