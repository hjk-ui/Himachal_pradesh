import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import {
  allowedGapActions,
  CARE_GAP_KEYS,
  canViewPrimaryCareWorkflow,
  gapActionError,
  isMedicalAssistant,
  MA_GAP_ACTIONS,
  PROVIDER_GAP_ACTIONS,
  type CareGapKey,
  type GapAction,
} from '@/lib/medical/primaryCareWorkflow';
import { loadPatientCareFacts, loadPrimaryCareSettings } from '@/lib/medical/primaryCareWorkflowDb';
import { workflowClientGate, workflowGate, zodMessage } from '../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalCareGap';
const ACTIONS = [...PROVIDER_GAP_ACTIONS, ...MA_GAP_ACTIONS] as [GapAction, ...GapAction[]];

const postSchema = z.object({
  clientId: z.string().trim().min(1).max(64),
  gapKey: z.enum(CARE_GAP_KEYS as [CareGapKey, ...CareGapKey[]]),
  action: z.enum(ACTIONS),
  performedOn: z.string().trim().max(10).nullable().optional(),
  kind: z.string().trim().max(40).nullable().optional(),
  source: z.string().trim().max(200).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
  method: z.enum(['phone', 'portal', 'letter']).nullable().optional(),
  appointmentId: z.string().trim().max(64).nullable().optional(),
});

/** GET /api/medical/care-gaps?clientId=&appointmentId= — care gaps (screening guidance) + actions at this visit */
export async function GET(req: Request) {
  const g = await workflowGate(req, { action: 'READ', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  const params = new URL(req.url).searchParams;
  const clientId = params.get('clientId') || '';
  const appointmentId = params.get('appointmentId') || null;
  if (!clientId) return NextResponse.json({ success: false, error: 'clientId is required' }, { status: 400 });
  const c = await workflowClientGate(req, g.gate, g.viewer, clientId, { action: 'READ', resourceType: RESOURCE });
  if (c.ok === false) return c.response;
  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(g.viewer.organizationId);
    const settings = await loadPrimaryCareSettings(g.viewer.organizationId);
    const facts = await loadPatientCareFacts(g.viewer, clientId, { now, timeZone, disabledGaps: settings.careGapsDisabled });
    const day = (d: Date | null) => (d ? toPracticeWallTime(d, timeZone).date : null);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: RESOURCE, patientId: clientId, metadata: { appointmentId, gaps: facts.careGaps.length } });
    return NextResponse.json({
      success: true,
      careGaps: facts.careGaps,
      screenings: facts.screenings,
      thisVisit: appointmentId
        ? facts.actions
            .filter((a) => a.appointmentId === appointmentId)
            .map((a) => ({ gapKey: a.gapKey, action: a.action, performedOn: a.performedOn ? a.performedOn.toISOString().slice(0, 10) : null, source: a.source, reason: a.reason, kind: a.kind, by: a.recordedByName, at: day(a.createdAt) }))
        : [],
      lastOutreach: facts.lastOutreach,
      allowedActions: allowedGapActions(g.viewer.role),
    });
  } catch (err) {
    console.error('[medical/care-gaps GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load care gaps' }, { status: 500 });
  }
}

/**
 * POST /api/medical/care-gaps — record one action. Physician / medical NP: completed, ordered,
 * done elsewhere (date + source), declined, not applicable (reason), reopened, outreach. Medical
 * Assistant: patient-reported "done elsewhere" (date + source; never closes the gap) and outreach.
 */
export async function POST(req: Request) {
  const g = await workflowGate(req, { action: 'CREATE', resourceType: RESOURCE, allow: (r) => allowedGapActions(r).length > 0 });
  if (g.ok === false) return g.response;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the care gap entry') }, { status: 400 });
  }
  if (!allowedGapActions(g.viewer.role).includes(body.action)) {
    await auditPhiAccess({ gate: g.gate, req, action: 'CREATE', resourceType: RESOURCE, patientId: body.clientId, outcome: 'DENIED', metadata: { reason: 'action_not_permitted', action: body.action } });
    return NextResponse.json(
      { success: false, error: isMedicalAssistant(g.viewer.role) ? 'A Medical Assistant records what the patient reports; the provider closes the gap.' : 'Your role cannot record this action' },
      { status: 403 }
    );
  }
  const c = await workflowClientGate(req, g.gate, g.viewer, body.clientId, { action: 'CREATE', resourceType: RESOURCE });
  if (c.ok === false) return c.response;
  try {
    const timeZone = await getPracticeTimeZone(g.viewer.organizationId);
    const today = toPracticeWallTime(new Date(), timeZone).date;
    const error = gapActionError(body.gapKey, body, today);
    if (error) return NextResponse.json({ success: false, error }, { status: 400 });
    if (body.appointmentId) {
      const appt = await prisma.appointment.findFirst({
        where: { id: body.appointmentId, clientId: body.clientId, OR: [{ organizationId: g.viewer.organizationId }, { organizationId: null, client: { organizationId: g.viewer.organizationId } }] },
        select: { id: true },
      });
      if (!appt) return NextResponse.json({ success: false, error: 'Appointment not found' }, { status: 404 });
    }
    const me = await prisma.user.findUnique({ where: { id: g.viewer.userId }, select: { name: true } });
    const row = await prisma.medicalCareGapAction.create({
      data: {
        organizationId: g.viewer.organizationId,
        clientId: body.clientId,
        gapKey: body.gapKey,
        action: body.action,
        performedOn: body.performedOn ? new Date(`${body.performedOn}T12:00:00Z`) : body.action === 'completed' ? new Date(`${today}T12:00:00Z`) : null,
        kind: body.kind || null,
        source: body.source || null,
        reason: body.reason || null,
        method: body.method || null,
        appointmentId: body.appointmentId || null,
        patientReported: body.action === 'reported_elsewhere',
        recordedById: g.viewer.userId,
        recordedByName: me?.name ?? null,
        recordedByRole: g.viewer.role,
      },
    });
    await auditPhiAccess({
      gate: g.gate,
      req,
      action: 'CREATE',
      resourceType: RESOURCE,
      resourceId: row.id,
      patientId: body.clientId,
      metadata: { gapKey: body.gapKey, action: body.action, appointmentId: body.appointmentId ?? null },
    });
    return NextResponse.json({ success: true, id: row.id }, { status: 201 });
  } catch (err) {
    console.error('[medical/care-gaps POST]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not record the care gap action' }, { status: 500 });
  }
}
