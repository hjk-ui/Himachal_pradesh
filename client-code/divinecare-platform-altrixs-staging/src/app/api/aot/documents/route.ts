import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { findParticipantInOrg, participantOnCaseload } from '../_scope';
import { emptyData, FORM_DEFINITIONS, FORM_TYPES, docMeta, formFields, isFormType, type DocMeta } from '@/lib/aot/forms';
import { aotFormFlags } from '@/lib/aot/forms/deadlines';
import { documentSummary, formsOverview, hrsnSummary, listOutreach, prefillFor } from '@/lib/aot/documents';

export const runtime = 'nodejs';

/**
 * GET /api/aot/documents?participantId= — the participant's MDH AOT forms (status, completeness,
 * due dates) and form flags. No form content is returned here; open one with GET /api/aot/documents/[id].
 */
export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const participantId = new URL(req.url).searchParams.get('participantId') || '';
    const participant = participantId ? await findParticipantInOrg(participantId, gate.organizationId) : null;
    if (!participant || !(await participantOnCaseload(gate, participant))) {
      return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    }

    const [docs, outreach] = await Promise.all([
      prisma.aotDocument.findMany({
        where: { organizationId: gate.organizationId, participantId: participant.id },
        orderBy: [{ formType: 'asc' }, { version: 'desc' }],
      }),
      listOutreach(gate.organizationId, participant.id),
    ]);
    const hrsn = await hrsnSummary(gate, participant, docs);

    await auditPhiAccess({
      gate,
      req,
      action: 'LIST',
      resourceType: 'aotDocument',
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, count: docs.length },
    });

    return NextResponse.json({
      success: true,
      participant: {
        id: participant.id,
        status: participant.status,
        petitionDate: participant.petitionDate,
        hearingDate: participant.hearingDate,
        orderStart: participant.orderStart,
        orderEnd: participant.orderEnd,
        clientId: participant.clientId,
      },
      forms: formsOverview(participant, docs),
      flags: aotFormFlags(participant, docs, outreach),
      hrsn,
    });
  } catch (err: unknown) {
    console.error('[api/aot/documents GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load AOT forms' }, { status: 500 });
  }
}

const createSchema = z.object({
  participantId: z.string().min(1).max(64),
  formType: z.string().refine(isFormType, 'Unknown form type'),
  /** Amend a signed document: the new draft starts from its content and supersedes it when signed */
  amendFromId: z.string().uuid().optional(),
});

/**
 * POST /api/aot/documents — start a draft (prefilled from the chart / participant record), or amend a
 * signed document (new version). Only one open draft per participant and form type: an existing draft
 * is returned instead of creating a second one.
 */
export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const parsed = createSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ success: false, error: 'Invalid request' }, { status: 400 });
    const { participantId, amendFromId } = parsed.data;
    const formType = parsed.data.formType as (typeof FORM_TYPES)[number];
    const participant = await findParticipantInOrg(participantId, gate.organizationId);
    if (!participant) return NextResponse.json({ success: false, error: 'AOT Participant not found' }, { status: 404 });
    const def = FORM_DEFINITIONS[formType];

    const existingDraft = await prisma.aotDocument.findFirst({
      where: { organizationId: gate.organizationId, participantId: participant.id, formType, status: 'draft' },
      orderBy: { version: 'desc' },
    });
    if (existingDraft) {
      return NextResponse.json({ success: true, existing: true, document: documentSummary(existingDraft) });
    }

    const last = await prisma.aotDocument.findFirst({
      where: { participantId: participant.id, formType },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (last?.version ?? 0) + 1;

    let data: Record<string, unknown>;
    let meta: DocMeta;
    let chartNote: string | null = null;
    if (amendFromId) {
      const source = await prisma.aotDocument.findFirst({
        where: { id: amendFromId, organizationId: gate.organizationId, participantId: participant.id, formType, status: 'signed' },
      });
      if (!source) return NextResponse.json({ success: false, error: 'Only a signed document of this form can be amended' }, { status: 409 });
      data = formFields(source.data);
      meta = { signatures: [], amendsId: source.id, prefilled: docMeta(source.data).prefilled ?? {} };
    } else {
      if (!def.multiInstance) {
        const signed = await prisma.aotDocument.findFirst({
          where: { organizationId: gate.organizationId, participantId: participant.id, formType, status: 'signed' },
          select: { id: true },
        });
        if (signed) {
          return NextResponse.json(
            { success: false, error: `A signed ${def.title} exists. Amend it to create a new version.`, signedId: signed.id },
            { status: 409 },
          );
        }
      }
      const pre = await prefillFor(gate, participant, formType);
      data = { ...emptyData(def), ...pre.data };
      if (def.derive) data = def.derive(data);
      meta = { signatures: [], amendsId: null, prefilled: pre.sources };
      chartNote = pre.chartNote;
    }

    const created = await prisma.aotDocument.create({
      data: {
        organizationId: gate.organizationId,
        participantId: participant.id,
        clientId: participant.clientId ?? null,
        formType,
        version,
        status: 'draft',
        data: { ...data, _meta: meta } as Prisma.InputJsonValue,
        createdById: gate.userId,
      },
    });

    await auditPhiAccess({
      gate,
      req,
      action: 'CREATE',
      resourceType: 'aotDocument',
      resourceId: created.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, formType, version, amendsId: amendFromId ?? null, prefilledKeys: Object.keys(meta.prefilled ?? {}).length },
    });

    return NextResponse.json({ success: true, document: documentSummary(created), chartNote }, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ success: false, error: 'Another draft was just created for this form. Reload and open it.' }, { status: 409 });
    }
    console.error('[api/aot/documents POST]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not create the AOT form' }, { status: 500 });
  }
}
