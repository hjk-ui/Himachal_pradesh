import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireOrgContext } from '@/lib/auth/tenant';

export const runtime = 'nodejs';

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
    durationMinutes: z.number().int().min(1).max(360).optional().default(55),
    sessionType: z.string().optional(),
    role: z.string().optional(),
    posCode: z.string().optional().default('10'),
  }),
]);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get('sessionId');
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'sessionId is required' }, { status: 400 });
    }

    const [note, vitals, billingDraft, chatMessages, auditLogs] = await Promise.all([
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

    return NextResponse.json({
      success: true,
      data: {
        note,
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
  try {
    const body = inCallActionSchema.parse(await req.json());

    if (body.action === 'save-notes') {
      const note = await prisma.telehealthInCallNote.upsert({
        where: { sessionId: body.sessionId },
        create: {
          sessionId: body.sessionId,
          subjective: body.subjective,
          objective: body.objective,
          assessment: body.assessment,
          plan: body.plan,
          mseAppearance: body.mseAppearance,
          mseMood: body.mseMood,
          mseThought: body.mseThought,
          cssrsRiskScore: body.cssrsRiskScore,
          isSavedToEhr: body.isSavedToEhr ?? false,
          savedAt: body.isSavedToEhr ? new Date() : null,
        },
        update: {
          subjective: body.subjective,
          objective: body.objective,
          assessment: body.assessment,
          plan: body.plan,
          mseAppearance: body.mseAppearance,
          mseMood: body.mseMood,
          mseThought: body.mseThought,
          cssrsRiskScore: body.cssrsRiskScore,
          isSavedToEhr: body.isSavedToEhr ?? false,
          savedAt: body.isSavedToEhr ? new Date() : undefined,
        },
      });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: body.sessionId,
          eventType: 'SOAP_SAVED',
          performedBy: 'CLINICIAN',
          details: `Updated in-call SOAP note (EHR Synced: ${Boolean(body.isSavedToEhr)})`,
        },
      });

      return NextResponse.json({ success: true, note, notes: note });
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
      const duration = body.durationMinutes;
      const type = (body.sessionType || '').toLowerCase();
      const role = (body.role || '').toUpperCase();

      // Clinical Telehealth Billing Rules
      let cptCode = '90834'; // Default 45 min therapy
      let addonCptCode: string | null = null;
      const modifiers = ['95'];
      const posCode = body.posCode || '10'; // POS 10 (Patient Home) or 02 (Other)

      if (type.includes('eval') || type.includes('assessment') || type.includes('intake')) {
        cptCode = '90791'; // Psych Diagnostic Evaluation
      } else if (type.includes('med') || role.includes('NP') || role.includes('PSYCHIATRIST')) {
        cptCode = '99214'; // Established Patient Outpatient E/M Moderate Complexity
        if (duration >= 30) {
          addonCptCode = '+90833'; // Add-on Psychotherapy 30 min with E/M
        }
      } else if (duration >= 53) {
        cptCode = '90837'; // Individual Psychotherapy 60 min (>=53m per CMS)
      } else if (duration >= 38) {
        cptCode = '90834'; // Individual Psychotherapy 45 min
      } else {
        cptCode = '90832'; // Individual Psychotherapy 30 min
      }

      const billingDraft = await prisma.telehealthBillingDraft.upsert({
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
      });

      // Update session status to COMPLETED
      await prisma.telehealthSession.update({
        where: { id: body.sessionId },
        data: {
          status: 'COMPLETED',
          durationMinutes: duration,
          pos: posCode,
          cptModifier: '-95',
        },
      });

      await prisma.telehealthAuditLog.create({
        data: {
          sessionId: body.sessionId,
          eventType: 'SESSION_COMPLETED',
          performedBy: 'CLINICIAN',
          details: `Completed ${duration}m visit. Auto-suggested CPT ${cptCode}${addonCptCode ? ' ' + addonCptCode : ''} with POS ${posCode} and Mod -95`,
        },
      });

      return NextResponse.json({
        success: true,
        billingDraft,
        summary: {
          durationMinutes: duration,
          cptCode,
          addonCptCode,
          posCode,
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
