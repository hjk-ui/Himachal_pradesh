import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';
import { isClinicalStaff } from '@/lib/auth/roles';
import { canAccessClientChartNotes } from '@/lib/clients/orgScope';
import { gateClientRoute } from '@/lib/clients/clientRouteGate';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { resolveTelehealthPos } from '@/lib/telehealth/pos';
import { loadPracticeSettings } from '@/lib/practice/store';
import { triggerAutopayAfterVisitStatus } from '@/lib/patientPayments/visitTrigger';
import { verifiedAdminBaseRole } from '@/lib/auth/requireSession';
import { createClientNote } from '@/lib/clients/notes';
import { watchProgressNote } from '@/lib/ai/riskWatch/hooks';
import {
  buildInCallDraftBody,
  missingInCallSelections,
  psychotherapyCptForMinutes,
} from '@/lib/telehealth/inCallCoding';

export const runtime = 'nodejs';

type Gate = { organizationId: string; userId: string; role: string };

/**
 * Session in the caller's org AND the caller may see its SOAP note / vitals / billing draft:
 * the session's own clinician, or a role that reads BH chart notes with chart access to the
 * client (org, Part 2, caseload). Denials are audited; a session outside the org is a 404.
 */
async function sessionAccess(
  req: Request,
  gate: Gate,
  sessionId: string,
): Promise<{ ok: true } | { ok: false; status: 403 | 404; error: string }> {
  const session = await prisma.telehealthSession.findFirst({
    where: { id: sessionId, organizationId: gate.organizationId },
    select: { id: true, clientId: true, clinicianId: true },
  });
  if (!session) return { ok: false, status: 404, error: 'Session not found' };
  if (session.clinicianId && session.clinicianId === gate.userId) return { ok: true };
  const access = await gateClientRoute({
    organizationId: gate.organizationId,
    userId: gate.userId,
    role: gate.role,
    clientId: session.clientId,
    path: '/api/telehealth/in-call',
    roleAllowed: canAccessClientChartNotes(gate.role),
  });
  if (access.ok === false) {
    await auditPhiAccess({
      gate,
      req,
      action: 'READ',
      resourceType: 'telehealthInCall',
      resourceId: session.id,
      patientId: session.clientId,
      outcome: 'DENIED',
      metadata: { reason: access.reason },
    });
    return { ok: false, status: access.status === 404 ? 404 : 403, error: access.status === 404 ? 'Session not found' : 'Forbidden' };
  }
  return { ok: true };
}

const inCallActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('save-notes'),
    sessionId: z.string().min(1),
    subjective: z.string().optional().nullable(),
    objective: z.string().optional().nullable(),
    assessment: z.string().optional().nullable(),
    plan: z.string().optional().nullable(),
    mseAppearance: z.string().optional().nullable(),
    mseMood: z.string().optional().nullable(),
    mseThought: z.string().optional().nullable(),
    cssrsRiskScore: z.string().optional().nullable(),
    isSavedToEhr: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('save-vitals'),
    sessionId: z.string().min(1),
    bloodPressure: z.string().optional().nullable(),
    pulse: z.number().int().optional().nullable(),
    weightLbs: z.number().optional().nullable(),
    sideEffects: z.string().optional().nullable(),
    aimsScore: z.number().int().optional().nullable(),
    qtcWarning: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('send-message'),
    sessionId: z.string().min(1),
    senderRole: z.string().min(1),
    senderName: z.string().min(1),
    message: z.string().min(1),
  }),
  z.object({
    action: z.literal('end-session'),
    sessionId: z.string().min(1),
    /** Elapsed call minutes measured by the client. No default: unknown time = no time-based CPT. */
    durationMinutes: z.number().int().min(1).max(360).optional().nullable(),
    sessionType: z.string().optional(),
    role: z.string().optional(),
    /** Staff-entered POS; used only when the patient's check-in location is missing. Never defaulted. */
    posCode: z.string().max(8).optional().nullable(),
  }),
]);

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // SOAP notes, vitals and chat are clinical PHI — not for billing/HR/front-desk roles
  if (!isClinicalStaff(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }
    const access = await sessionAccess(req, gate, sessionId);
    if (access.ok === false) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    const [sessionRow, note, vitals, billingDraft, chatMessages, auditLogs] = await Promise.all([
      prisma.telehealthSession.findUnique({
        where: { id: sessionId },
        select: { patientLocationType: true, appointmentId: true },
      }),
      prisma.telehealthInCallNote.findUnique({ where: { sessionId } }),
      prisma.telehealthVitals.findUnique({ where: { sessionId } }),
      prisma.telehealthBillingDraft.findUnique({ where: { sessionId } }),
      prisma.telehealthChatMessage.findMany({
        where: { sessionId },
        orderBy: { sentAt: 'asc' },
        take: 100,
      }),
      prisma.telehealthAuditLog.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'desc' },
        take: 50,
      }),
    ]);

    const apptLocation = sessionRow?.appointmentId
      ? await prisma.appointment.findUnique({
          where: { id: sessionRow.appointmentId },
          select: { patientLocationType: true },
        })
      : null;
    const posPreview = resolveTelehealthPos({
      patientLocationType: sessionRow?.patientLocationType ?? apptLocation?.patientLocationType ?? null,
      settings: await loadPracticeSettings(gate.organizationId),
    });

    return NextResponse.json({
      success: true,
      data: {
        note,
        posPreview,
        vitals,
        billingDraft,
        chatMessages,
        auditLogs,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch in-call data';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (!gate.ok) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  // SOAP notes, vitals and chat are clinical PHI — not for billing/HR/front-desk roles
  if (!isClinicalStaff(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  try {
    const body = inCallActionSchema.parse(await req.json());
    const access = await sessionAccess(req, gate, body.sessionId);
    if (access.ok === false) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status });
    }

    if (body.action === 'save-notes') {
      // MSE / C-SSRS are saved only when explicitly chosen (blank = not chosen, never a default)
      const fields = {
        subjective: body.subjective ?? null,
        objective: body.objective ?? null,
        assessment: body.assessment ?? null,
        plan: body.plan ?? null,
        mseAppearance: body.mseAppearance?.trim() || null,
        mseMood: body.mseMood?.trim() || null,
        mseThought: body.mseThought?.trim() || null,
        cssrsRiskScore: body.cssrsRiskScore?.trim() || null,
      };
      const existing = await prisma.telehealthInCallNote.findUnique({
        where: { sessionId: body.sessionId },
        select: { progressNoteId: true },
      });

      if (body.isSavedToEhr && !existing?.progressNoteId) {
        const missing = missingInCallSelections(fields);
        if (missing.length > 0) {
          return NextResponse.json(
            {
              success: false,
              error: `Choose ${missing.join(', ')} (or "Not assessed") before creating the chart note.`,
              missing,
            },
            { status: 400 }
          );
        }
      }

      // Autosave only updates the session scratch note; the isSavedToEhr flag is never cleared here.
      let note = await prisma.telehealthInCallNote.upsert({
        where: { sessionId: body.sessionId },
        create: { sessionId: body.sessionId, ...fields },
        update: fields,
      });

      let draftNoteId: string | null = existing?.progressNoteId ?? null;
      let draftCreated = false;
      if (body.isSavedToEhr && !draftNoteId) {
        const session = await prisma.telehealthSession.findUnique({
          where: { id: body.sessionId },
          select: { clientId: true, appointmentId: true, sessionDate: true },
        });
        if (!session) {
          return NextResponse.json({ success: false, error: 'Session not found' }, { status: 404 });
        }
        const dos = session.sessionDate.toISOString().slice(0, 10);
        const baseRole = await verifiedAdminBaseRole(gate.userId);
        const created = await createClientNote({
          clientId: session.clientId,
          organizationId: gate.organizationId,
          actorUserId: gate.userId,
          actorRole: gate.role as Parameters<typeof createClientNote>[0]['actorRole'],
          actorBaseRole: baseRole,
          body: buildInCallDraftBody(fields),
          meta: {
            noteType: 'SOAP',
            dateOfService: session.sessionDate.getTime() <= Date.now() + 36 * 3600 * 1000 ? dos : null,
            telehealth: true,
          },
        });
        if (created.ok === false) {
          return NextResponse.json({ success: false, error: created.error }, { status: created.status });
        }
        // Link once: a concurrent click that lost the race removes its duplicate draft
        const linked = await prisma.telehealthInCallNote.updateMany({
          where: { sessionId: body.sessionId, progressNoteId: null },
          data: { progressNoteId: created.note.id, isSavedToEhr: true, savedAt: new Date() },
        });
        if (linked.count === 0) {
          await prisma.progressNote.delete({ where: { id: created.note.id } }).catch(() => undefined);
          const winner = await prisma.telehealthInCallNote.findUnique({ where: { sessionId: body.sessionId } });
          draftNoteId = winner?.progressNoteId ?? null;
        } else {
          draftNoteId = created.note.id;
          draftCreated = true;
          if (session.appointmentId) {
            await prisma.progressNote
              .update({ where: { id: created.note.id }, data: { appointmentId: session.appointmentId } })
              .catch(() => undefined);
          }
          await auditPhiAccess({
            gate,
            req,
            action: 'WRITE',
            resourceType: 'clientNote',
            resourceId: created.note.id,
            patientId: session.clientId,
            metadata: { source: 'telehealth_in_call', sessionId: body.sessionId },
          });
          await watchProgressNote({
            noteId: created.note.id,
            organizationId: gate.organizationId,
            actorUserId: gate.userId,
            actorRole: gate.role as Parameters<typeof watchProgressNote>[0]['actorRole'],
          }).catch(() => undefined);
        }
        note = (await prisma.telehealthInCallNote.findUnique({ where: { sessionId: body.sessionId } })) ?? note;
      }

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: body.sessionId,
          eventType: draftCreated ? 'DRAFT_NOTE_CREATED' : 'SOAP_SAVED',
          performedBy: 'CLINICIAN',
          details: draftCreated
            ? `Draft progress note ${draftNoteId} created from the in-call SOAP note (unsigned)`
            : 'Updated in-call SOAP note (session scratch only)',
        },
      });

      return NextResponse.json({ success: true, note, notes: note, draftNoteId, draftCreated });
    }

    if (body.action === 'save-vitals') {
      const vitals = await prisma.telehealthVitals.upsert({
        where: { sessionId: body.sessionId },
        create: {
          sessionId: body.sessionId,
          bloodPressure: body.bloodPressure,
          pulse: body.pulse,
          weightLbs: body.weightLbs,
          sideEffects: body.sideEffects,
          aimsScore: body.aimsScore ?? 0,
          qtcWarning: body.qtcWarning ?? false,
        },
        update: {
          bloodPressure: body.bloodPressure,
          pulse: body.pulse,
          weightLbs: body.weightLbs,
          sideEffects: body.sideEffects,
          aimsScore: body.aimsScore ?? 0,
          qtcWarning: body.qtcWarning ?? false,
        },
      });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: body.sessionId,
          eventType: 'VITALS_SAVED',
          performedBy: 'CLINICIAN',
          details: `BP: ${body.bloodPressure || 'N/A'}, Pulse: ${body.pulse || 'N/A'}, QTc Alert: ${Boolean(body.qtcWarning)}`,
        },
      });

      return NextResponse.json({ success: true, vitals });
    }

    if (body.action === 'send-message') {
      const message = await prisma.telehealthChatMessage.create({
        data: {
          sessionId: body.sessionId,
          senderRole: body.senderRole,
          senderName: body.senderName,
          message: body.message,
        },
      });
      return NextResponse.json({ success: true, message }, { status: 201 });
    }

    if (body.action === 'end-session') {
      const duration = body.durationMinutes ?? null;
      const role = (body.role || '').toUpperCase();

      const addonCptCode: string | null = null;
      const modifiers = ['95'];
      // Same helper as /api/telehealth/end: patient's check-in location, else staff entry, else null.
      const sessionRow = await prisma.telehealthSession.findUnique({
        where: { id: body.sessionId },
        select: { patientLocationType: true, appointmentId: true },
      });
      const apptLocation = sessionRow?.appointmentId
        ? await prisma.appointment.findUnique({ where: { id: sessionRow.appointmentId }, select: { patientLocationType: true, type: true } })
        : null;
      // The visit's CURRENT type wins over what the call view sent: it may have changed during the
      // visit (PATCH /api/appointments/[id]/visit-type)
      const type = (apptLocation?.type || body.sessionType || '').toLowerCase();
      const posResult = resolveTelehealthPos({
        patientLocationType: sessionRow?.patientLocationType ?? apptLocation?.patientLocationType ?? null,
        staffPos: body.posCode,
        settings: await loadPracticeSettings(gate.organizationId),
      });
      const posCode = posResult.pos;

      // Suggested code only from what is known: never a default time or a guessed E/M level.
      let cptCode: string | null = null;
      let codingNote: string | null = null;
      if (type.includes('eval') || type.includes('assessment') || type.includes('intake')) {
        cptCode = '90791'; // Psych diagnostic evaluation (not time-based)
      } else if (type.includes('med') || role.includes('NP') || role.includes('PSYCHIATRIST')) {
        codingNote = 'E/M level and any psychotherapy add-on are chosen in the signed note';
      } else {
        cptCode = psychotherapyCptForMinutes(duration);
        if (!cptCode) codingNote = duration == null ? 'Session time not recorded' : 'Under 16 min: no psychotherapy code';
      }

      const billingDraft =
        cptCode && duration != null
          ? await prisma.telehealthBillingDraft.upsert({
              where: { sessionId: body.sessionId },
              create: {
                sessionId: body.sessionId,
                cptCode,
                addonCptCode,
                posCode,
                modifiers,
                durationMinutes: duration,
                isApproved: false,
              },
              update: {
                cptCode,
                addonCptCode,
                posCode,
                modifiers,
                durationMinutes: duration,
              },
            })
          : null;

      // Update session status to COMPLETED
      await prisma.telehealthSession.update({
        where: { id: body.sessionId },
        data: {
          status: 'COMPLETED',
          ...(duration != null ? { durationMinutes: duration } : {}),
          ...(posCode ? { pos: posCode } : {}),
          cptModifier: '-95',
        },
      });
      // Linked appointment: AutoPay decides from that appointment's current status (background, idempotent)
      void triggerAutopayAfterVisitStatus(sessionRow?.appointmentId, null, { userId: gate.userId, role: String(gate.role) });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: body.sessionId,
          eventType: 'SESSION_COMPLETED',
          performedBy: 'CLINICIAN',
          details: `Completed visit (${duration != null ? `${duration} min` : 'time not recorded'}). ${cptCode ? `Suggested CPT ${cptCode}` : `No CPT suggested (${codingNote})`} with ${posCode ? `POS ${posCode}` : 'POS pending (patient location not captured)'} and Mod -95`,
        },
      });

      return NextResponse.json({
        success: true,
        billingDraft,
        summary: {
          durationMinutes: duration,
          cptCode,
          codingNote,
          addonCptCode,
          posCode,
          placeOfServiceSource: posResult.source,
          needsPlaceOfService: !posCode,
          modifiers,
        },
      });
    }

    return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid payload', issues: err.issues }, { status: 400 });
    }
    const msg = err instanceof Error ? err.message : 'In-call operation failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
