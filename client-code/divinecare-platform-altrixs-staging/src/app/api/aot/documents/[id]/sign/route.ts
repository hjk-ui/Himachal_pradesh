import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import {
  FORM_DEFINITIONS,
  canSignSlot,
  docMeta,
  formFields,
  missingItems,
  signingState,
  type FormSignature,
  type FormType,
} from '@/lib/aot/forms';
import { documentSummary, isMedicalDirector, loadDocumentInOrg } from '@/lib/aot/documents';

export const runtime = 'nodejs';

const bodySchema = z.object({
  /** Signature line (defaults to the only line the caller may sign) */
  slot: z.string().max(40).optional(),
  title: z.string().trim().max(120).optional(),
  /** The signer checked the attestation box */
  attest: z.literal(true),
});

/**
 * POST /api/aot/documents/[id]/sign — sign one signature line. The signature is the signed-in user's name,
 * the server time and the form's attestation text. The content must be complete; the first signature
 * locks it. When every line is signed the document becomes 'signed' and, if it amends an earlier version,
 * that version becomes 'superseded'.
 *   - Psychiatrist Affidavit: also marks the participant's affidavit deadline done.
 *   - EP notification: also records the emergency petition as an escalation event on the participant.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const { id } = await ctx.params;
    const body = bodySchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ success: false, error: 'Confirm the attestation to sign' }, { status: 400 });
    const found = await loadDocumentInOrg(id, gate.organizationId);
    if (!found) return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 });
    const { doc, participant } = found;
    if (doc.status !== 'draft') return NextResponse.json({ success: false, error: 'This form is already signed' }, { status: 409 });

    const type = doc.formType as FormType;
    const def = FORM_DEFINITIONS[type];
    const actor = { role: gate.role, medicalDirector: isMedicalDirector(gate) };
    const state = signingState(def, doc.data, actor);
    const slot = body.data.slot ? def.signers.find((s) => s.id === body.data.slot) : state.mySlots[0];
    if (!slot) {
      return NextResponse.json(
        { success: false, error: `You cannot sign this form. Signer: ${def.signers.map((s) => s.roleHint).join(' / ')}` },
        { status: 403 },
      );
    }
    if (!canSignSlot(slot, actor)) {
      return NextResponse.json({ success: false, error: `Only ${slot.roleHint} can sign "${slot.label}"` }, { status: 403 });
    }
    if (state.signatures.some((s) => s.slot === slot.id)) {
      return NextResponse.json({ success: false, error: `"${slot.label}" is already signed` }, { status: 409 });
    }
    if (state.signatures.some((s) => s.userId === gate.userId)) {
      return NextResponse.json({ success: false, error: 'You already signed another line of this form' }, { status: 409 });
    }
    const fields = formFields(doc.data);
    const missing = missingItems(def, fields);
    if (missing.length) {
      return NextResponse.json({ success: false, error: 'The form is incomplete', missing }, { status: 422 });
    }
    const name = gate.session.user.name?.trim();
    if (!name) return NextResponse.json({ success: false, error: 'Your account has no name on file to sign with' }, { status: 409 });
    if (slot.askTitle && !body.data.title) {
      return NextResponse.json({ success: false, error: 'Enter your title to sign' }, { status: 400 });
    }

    const now = new Date();
    const signature: FormSignature = {
      slot: slot.id,
      userId: gate.userId,
      name,
      role: String(gate.role),
      title: body.data.title || null,
      signedAt: now.toISOString(),
      attestation: def.attestation,
    };
    const meta = docMeta(doc.data);
    const signatures = [...(meta.signatures ?? []), signature];
    const complete = def.signers.every((s) => signatures.some((x) => x.slot === s.id));

    const updated = await prisma.$transaction(async (tx) => {
      const res = await tx.aotDocument.updateMany({
        where: { id: doc.id, status: 'draft', updatedAt: doc.updatedAt },
        data: {
          data: { ...fields, _meta: { ...meta, signatures } } as Prisma.InputJsonValue,
          ...(complete
            ? {
                status: 'signed',
                signedById: gate.userId,
                signedByName: signatures.map((s) => s.name).join('; '),
                signedAt: now,
              }
            : {}),
        },
      });
      if (res.count === 0) return null;
      if (complete && meta.amendsId) {
        await tx.aotDocument.updateMany({
          where: { id: meta.amendsId, organizationId: gate.organizationId, participantId: doc.participantId, status: 'signed' },
          data: { status: 'superseded' },
        });
      }
      if (complete && type === 'psychiatrist_affidavit') {
        const deadlines = Array.isArray(participant.deadlines) ? (participant.deadlines as Record<string, unknown>[]) : [];
        if (deadlines.some((d) => String(d.label ?? '').toLowerCase().includes('affidavit') && d.status !== 'done')) {
          await tx.aotParticipant.update({
            where: { id: participant.id },
            data: {
              deadlines: deadlines.map((d) =>
                String(d.label ?? '').toLowerCase().includes('affidavit') && d.status !== 'done'
                  ? { ...d, status: 'done', basis: `${String(d.basis ?? '')} — MDH#0004BHA signed ${now.toISOString().slice(0, 10)}` }
                  : d,
              ) as Prisma.InputJsonValue,
            },
          });
        }
      }
      if (complete && type === 'ep_notification') {
        const events = Array.isArray(participant.escalationEvents) ? (participant.escalationEvents as Record<string, unknown>[]) : [];
        await tx.aotParticipant.update({
          where: { id: participant.id },
          data: {
            escalationEvents: [
              ...events,
              {
                date: typeof fields.epDate === 'string' && fields.epDate ? fields.epDate : now.toISOString().slice(0, 10),
                event: 'Emergency petition for evaluation',
                action: `Notification of Petition for Emergency Evaluation (MDH#0003BHA) signed by ${name}`,
                kind: 'emergency_petition',
                documentId: doc.id,
              },
            ] as Prisma.InputJsonValue,
          },
        });
      }
      return tx.aotDocument.findUnique({ where: { id: doc.id } });
    });
    if (!updated) {
      return NextResponse.json({ success: false, error: 'The form changed while you were signing. Reload it and sign again.' }, { status: 409 });
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'SIGN',
      resourceType: 'aotDocument',
      resourceId: doc.id,
      patientId: participant.clientId ?? null,
      metadata: {
        participantId: participant.id,
        formType: type,
        version: doc.version,
        slot: slot.id,
        complete,
        superseded: complete ? meta.amendsId ?? null : null,
      },
    });

    return NextResponse.json({ success: true, complete, document: documentSummary(updated) });
  } catch (err: unknown) {
    console.error('[api/aot/documents/[id]/sign POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not sign the form' }, { status: 500 });
  }
}
