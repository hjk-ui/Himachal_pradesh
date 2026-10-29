import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { FORM_DEFINITIONS, docMeta, formFields, parseFormData, signingState, type FormType } from '@/lib/aot/forms';
import { documentSummary, isMedicalDirector, loadDocumentInOrg } from '@/lib/aot/documents';
import { canSeeAotClinical, participantOnCaseload } from '../../_scope';

export const runtime = 'nodejs';

/**
 * GET /api/aot/documents/[id] — one form with its content, signatures and prefill sources.
 * ?purpose=print is audited as PRINT (print / save-as-PDF view); otherwise READ.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const { id } = await ctx.params;
    const found = await loadDocumentInOrg(id, gate.organizationId);
    if (!found || !(await participantOnCaseload(gate, found.participant))) {
      return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 });
    }
    const { doc, participant } = found;
    const def = FORM_DEFINITIONS[doc.formType as FormType];
    const print = new URL(req.url).searchParams.get('purpose') === 'print';
    const meta = docMeta(doc.data);
    const sign = signingState(def, doc.data, { role: gate.role, medicalDirector: isMedicalDirector(gate) });
    // Form content (affidavit, MSE, diagnosis, plan): EHR clinical roles. A non-clinical role
    // (CCT case manager / CPRS staff line) may open only a form it has a signature line on.
    if (!canSeeAotClinical(gate.role) && sign.mySlots.length === 0) {
      await auditPhiAccess({
        gate, req, action: 'READ', resourceType: 'aotDocument', resourceId: doc.id, patientId: participant.clientId ?? null,
        outcome: 'DENIED', metadata: { participantId: participant.id, formType: doc.formType, reason: 'role_not_permitted' },
      });
      return NextResponse.json({ success: false, error: 'AOT form content is limited to the treating clinicians' }, { status: 403 });
    }
    const versions = await prisma.aotDocument.findMany({
      where: { organizationId: gate.organizationId, participantId: doc.participantId, formType: doc.formType },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, signedAt: true, signedByName: true },
    });

    await auditPhiAccess({
      gate,
      req,
      action: print ? 'PRINT' : 'READ',
      resourceType: 'aotDocument',
      resourceId: doc.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, formType: doc.formType, version: doc.version, status: doc.status },
    });

    return NextResponse.json({
      success: true,
      document: {
        ...documentSummary(doc),
        participantId: doc.participantId,
        data: formFields(doc.data),
        signatures: meta.signatures ?? [],
        prefilled: meta.prefilled ?? {},
      },
      participant: { id: participant.id, name: participant.name, status: participant.status },
      versions,
      canSign: doc.status === 'draft' ? sign.mySlots.map((s) => s.id) : [],
      locked: doc.status !== 'draft' || (meta.signatures?.length ?? 0) > 0,
    });
  } catch (err: unknown) {
    console.error('[api/aot/documents/[id] GET]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not load the form' }, { status: 500 });
  }
}

const patchSchema = z.object({ data: z.record(z.string(), z.unknown()) });

/** PATCH /api/aot/documents/[id] — save a draft. Signed documents and drafts with any signature are locked. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireOrgContext();
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  try {
    const { id } = await ctx.params;
    const body = patchSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) return NextResponse.json({ success: false, error: 'Invalid form data' }, { status: 400 });
    // Editing form content: EHR clinical roles only
    if (!canSeeAotClinical(gate.role)) {
      return NextResponse.json({ success: false, error: 'AOT form content is limited to the treating clinicians' }, { status: 403 });
    }
    const found = await loadDocumentInOrg(id, gate.organizationId);
    if (!found) return NextResponse.json({ success: false, error: 'Form not found' }, { status: 404 });
    const { doc, participant } = found;
    const meta = docMeta(doc.data);
    if (doc.status !== 'draft') {
      return NextResponse.json({ success: false, error: 'This form is signed and locked. Amend it to create a new version.' }, { status: 409 });
    }
    if ((meta.signatures?.length ?? 0) > 0) {
      return NextResponse.json({ success: false, error: 'Signing has started; the content is locked. Amend after signing to change it.' }, { status: 409 });
    }

    const parsed = parseFormData(doc.formType as FormType, body.data.data);
    if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });

    // Optimistic lock: the update only applies while the row is still an unsigned draft.
    const res = await prisma.aotDocument.updateMany({
      where: { id: doc.id, status: 'draft', updatedAt: doc.updatedAt },
      data: { data: { ...parsed.data, _meta: meta } as Prisma.InputJsonValue },
    });
    if (res.count === 0) {
      return NextResponse.json({ success: false, error: 'The form changed while you were editing. Reload it.' }, { status: 409 });
    }
    const updated = await prisma.aotDocument.findUnique({ where: { id: doc.id } });

    await auditPhiAccess({
      gate,
      req,
      action: 'WRITE',
      resourceType: 'aotDocument',
      resourceId: doc.id,
      patientId: participant.clientId ?? null,
      metadata: { participantId: participant.id, formType: doc.formType, version: doc.version },
    });

    return NextResponse.json({ success: true, document: { ...documentSummary(updated!), data: formFields(updated!.data) } });
  } catch (err: unknown) {
    console.error('[api/aot/documents/[id] PATCH]', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not save the form' }, { status: 500 });
  }
}
