/**
 * Server-side checks shared by every AI feature that reads a client's chart:
 * - Patient AI-drafting consent is checked before any PHI goes to the model.
 * - The client must be in the caller's organization (and caseload, for caseload roles).
 * Note drafting itself lives in the AI Scribe (src/lib/scribe: draft.ts, grounding.ts,
 * sectionDraft.ts): every sentence cites its source and unsupported sentences are withheld.
 * The old ungrounded whole-note drafting route and its prompt were removed (Oct 2026).
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { clientAccessWhere } from '@/lib/clients/orgScope';

export const AI_NOTE_CONSENT_TYPE = 'AI Note Drafting';

export type AiConsentCheck =
  | { status: 'signed' }
  | { status: 'missing'; warning: string }
  | { status: 'declined'; error: string };

/**
 * Most recent 'AI Note Drafting' consent decides:
 * DECLINED blocks drafting; a current SIGNED one allows it; otherwise draft with a warning.
 */
export async function checkAiNoteConsent(organizationId: string, clientId: string): Promise<AiConsentCheck> {
  const latest = await prisma.consentForm.findFirst({
    where: { organizationId, clientId, type: AI_NOTE_CONSENT_TYPE },
    orderBy: [{ updatedAt: 'desc' }],
    select: { status: true, expiresAt: true },
  });
  if (latest?.status === 'DECLINED') {
    return {
      status: 'declined',
      error:
        'This patient declined AI note drafting. Nothing was sent to the AI model; write the note manually.',
    };
  }
  const now = new Date();
  const signed = await prisma.consentForm.findFirst({
    where: {
      organizationId,
      clientId,
      type: AI_NOTE_CONSENT_TYPE,
      status: 'SIGNED',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  });
  if (signed) return { status: 'signed' };
  return { status: 'missing', warning: 'No AI note drafting consent on file' };
}

/** Client must be in the caller's organization and, for caseload roles, assigned to them. */
export async function canAccessClientForAi(input: {
  organizationId: string;
  userId: string;
  role: Role;
  clientId: string;
}): Promise<boolean> {
  const client = await prisma.client.findFirst({
    where: {
      id: input.clientId,
      ...clientAccessWhere({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        actorRole: input.role,
      }),
    },
    select: { id: true },
  });
  return Boolean(client);
}
