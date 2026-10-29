import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { assertClientPhiAccess, SensitiveRecordAccessError } from '@/lib/privacy/sensitiveAccess';
import { AI_NOTE_CONSENT_TYPE } from '@/lib/ai/noteDraftSafety';
import { findAccessibleClient } from '@/lib/scribe/store';
import { jsonError, scribeGate } from '../_lib/gate';

export const runtime = 'nodejs';

const bodySchema = z.object({
  clientId: z.string().min(1).max(128),
  decision: z.enum(['consented', 'declined']),
  method: z.enum(['verbal', 'written', 'portal']),
  /** Person who gave or declined consent: the client, or their guardian / representative */
  givenBy: z.enum(['client', 'representative']).default('client'),
  representativeName: z.string().trim().max(120).optional().nullable(),
  representativeRelationship: z.string().trim().max(80).optional().nullable(),
});

/**
 * POST /api/scribe/ai-consent: the clinician records the client's AI Note Drafting decision at the
 * point of care (industry practice for ambient documentation: verbal or written consent documented
 * by the clinician before the session). Stored as the same ConsentForm row the rest of the app
 * checks (checkAiNoteConsent); a later decision supersedes an earlier one. Audited.
 */
export async function POST(req: Request) {
  const g = await scribeGate();
  if (g.ok === false) return g.response;
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(400, 'Choose consented or declined, and how it was given');
  const body = parsed.data;
  if (body.givenBy === 'representative' && (!body.representativeName || !body.representativeRelationship)) {
    return jsonError(400, "Enter the representative's name and relationship to the client");
  }
  const client = await findAccessibleClient(g.actor, body.clientId);
  if (!client) return jsonError(404, 'Client not found');
  try {
    await assertClientPhiAccess({ ...g.actor, clientId: body.clientId, path: '/api/scribe/ai-consent' });
  } catch (err) {
    if (err instanceof SensitiveRecordAccessError) return NextResponse.json(err.body, { status: err.status });
    throw err;
  }

  const staff = await prisma.user.findUnique({ where: { id: g.actor.userId }, select: { name: true, email: true } });
  const staffName = staff?.name || staff?.email || 'Staff member';
  const signer =
    body.givenBy === 'representative'
      ? `${body.representativeName} (${body.representativeRelationship}, for ${client.name})`
      : client.name;
  const methodLabel = body.method === 'verbal' ? 'Verbal' : body.method === 'written' ? 'Written' : 'Patient portal';
  const now = new Date();

  const row = await prisma.consentForm.create({
    data: {
      organizationId: g.actor.organizationId,
      clientId: body.clientId,
      type: AI_NOTE_CONSENT_TYPE,
      status: body.decision === 'consented' ? 'SIGNED' : 'DECLINED',
      method: methodLabel,
      sentAt: now,
      signedAt: now,
      signedByName: signer,
      notes:
        `${body.decision === 'consented' ? 'Consent given' : 'Declined'} (${methodLabel.toLowerCase()}), recorded by ${staffName} ` +
        'at the point of care. Client was told: sessions are transcribed by AWS under the practice BAA, an AI drafts the note, ' +
        'the clinician reviews and signs it, and the client may decline or withdraw at any time without affecting care.',
      createdById: g.actor.userId,
    },
    select: { id: true, status: true },
  });

  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'CREATE',
    resourceType: 'consentForm',
    resourceId: row.id,
    patientId: body.clientId,
    metadata: { type: AI_NOTE_CONSENT_TYPE, decision: body.decision, method: body.method, givenBy: body.givenBy },
  });

  return NextResponse.json({ success: true, consent: body.decision === 'consented' ? 'signed' : 'declined' });
}
