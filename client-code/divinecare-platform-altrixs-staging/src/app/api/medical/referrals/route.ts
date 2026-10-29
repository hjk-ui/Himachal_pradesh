import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { bhHandoffSuggestion, canViewPrimaryCareWorkflow, isPrimaryCareProvider } from '@/lib/medical/primaryCareWorkflow';
import { loadPatientCareFacts, referralViews } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowClientGate, workflowGate, zodMessage } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalReferral';

const postSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  kind: z.enum(['specialist', 'imaging', 'internal_bh']),
  target: z.string().trim().max(160).optional().nullable(),
  facility: z.string().trim().max(200).optional().nullable(),
  reason: z.string().trim().max(1000).optional().nullable(),
  urgency: z.enum(['routine', 'urgent', 'stat']).default('routine'),
  cpt: z.string().trim().max(10).optional().nullable(),
  icd10Codes: z.array(z.string().trim().min(3).max(10)).max(12).default([]),
  appointmentId: z.string().trim().max(64).optional().nullable(),
});

/** GET /api/medical/referrals?clientId= — referral / imaging tracking and BH warm handoffs for one patient */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'LIST', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  const clientId = new URL(req.url).searchParams.get('clientId') || '';
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const c = await workflowClientGate(req, g.gate, g.viewer, clientId, { action: 'LIST', resourceType: RESOURCE });
  if (c.ok === false) return c.response;
  try {
    const timeZone = await getPracticeTimeZone(g.viewer.organizationId);
    const rows = await prisma.medicalReferral.findMany({ where: { organizationId: g.viewer.organizationId, clientId }, orderBy: { sentAt: 'desc' }, take: 100 });
    const referrals = await referralViews(g.viewer.organizationId, rows, timeZone);
    await auditPhiAccess({ gate: g.gate, req, action: 'LIST', resourceType: RESOURCE, patientId: clientId, metadata: { count: referrals.length } });
    return NextResponse.json({ success: true, referrals });
  } catch (err) {
    console.error('[medical/referrals GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load referrals' }, { status: 500 });
  }
}

/**
 * POST /api/medical/referrals — physician / medical NP. specialist / imaging: tracked until the
 * report is received. internal_bh: warm handoff to the practice behavioral health team; the reason
 * comes from the primary care screen (PHQ-9 / GAD-7 >= 10) or the provider's own reason, and no
 * behavioral health content is ever returned to primary care (status only).
 */
export async function POST(req: Request) {
  const g = await workflowGate(req, { action: 'CREATE', resourceType: RESOURCE, allow: isPrimaryCareProvider });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the referral') }, { status: 400 });
  }
  const c = await workflowClientGate(req, g.gate, g.viewer, body.clientId, { action: 'CREATE', resourceType: RESOURCE });
  if (c.ok === false) return c.response;
  try {
    const org = g.viewer.organizationId;
    let target = body.target?.trim() || '';
    let reason = body.reason?.trim() || '';
    if (body.kind === 'internal_bh') {
      const open = await prisma.medicalReferral.findFirst({ where: { organizationId: org, clientId: body.clientId, kind: 'internal_bh', status: { in: ['sent', 'scheduled'] } }, select: { id: true } });
      if (open) return NextResponse.json({ success: false, error: 'A warm handoff to the behavioral health team is already open for this patient' }, { status: 409 });
      const timeZone = await getPracticeTimeZone(org);
      const facts = await loadPatientCareFacts(g.viewer, body.clientId, { now: new Date(), timeZone });
      const s = bhHandoffSuggestion({ phq9: facts.scores.phq9, gad7: facts.scores.gad7 });
      target = 'Behavioral health team';
      if (!reason) reason = s.suggested ? `Primary care screen: ${s.reasons.join('; ')}` : '';
      if (!reason) return NextResponse.json({ success: false, error: 'Enter the reason for the handoff' }, { status: 400 });
    } else {
      if (!target) return NextResponse.json({ success: false, error: body.kind === 'imaging' ? 'Enter the imaging study' : 'Enter the specialty' }, { status: 400 });
      if (!reason) return NextResponse.json({ success: false, error: 'Enter the reason for the referral' }, { status: 400 });
    }
    if (body.appointmentId) {
      const appt = await prisma.appointment.findFirst({ where: { id: body.appointmentId, clientId: body.clientId, OR: [{ organizationId: org }, { organizationId: null, client: { organizationId: org } }] }, select: { id: true } });
      if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    const me = await prisma.user.findUnique({ where: { id: g.viewer.userId }, select: { name: true } });
    const row = await prisma.medicalReferral.create({
      data: {
        organizationId: org,
        clientId: body.clientId,
        kind: body.kind,
        target,
        facility: body.kind === 'internal_bh' ? null : body.facility || null,
        reason,
        urgency: body.urgency,
        cpt: body.kind === 'imaging' ? body.cpt || null : null,
        icd10Codes: body.icd10Codes.map((x) => x.toUpperCase()),
        appointmentId: body.appointmentId || null,
        orderedById: g.viewer.userId,
        orderedByName: me?.name ?? null,
      },
    });
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: RESOURCE, resourceId: row.id, patientId: body.clientId, metadata: { kind: body.kind, urgency: body.urgency } });
    return NextResponse.json({ success: true, id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[medical/referrals POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not create the referral' }, { status: 500 });
  }
}
