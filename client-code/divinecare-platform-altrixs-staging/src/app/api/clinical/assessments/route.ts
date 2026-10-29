import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { prisma } from '@/lib/db/prisma';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { withoutLockedClients } from '@/lib/privacy/lockedRows';
import { scoreFromTotal } from '@/lib/measures/guide';
import { raiseSessionSafetyAlert, sessionScored } from '@/lib/measures/sessionSafety';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';

const submitSchema = z.object({
  clientId: z.string().min(1),
  instrumentId: z.string().min(1),
  instrumentName: z.string().optional(),
  category: z.string().optional(),
  administrationType: z.enum(['Digital', 'Manual']).default('Digital'),
  respondentType: z.string().default('Self'),
  totalScore: z.number().nonnegative().optional(),
  severity: z.string().optional(),
  interpretation: z.string().optional(),
  safetyFlagged: z.boolean().default(false),
  safetyNotes: z.string().optional(),
  notes: z.string().optional(),
  clinicianVerified: z.literal(true),
  answers: z.record(z.string(), z.number()).default({}),
});

/** Most recent records returned per request (was unbounded, answers included). */
const MAX_RECORDS = 1000;

export async function GET(req: Request) {
  // Readers: the assessments page roles plus the MBC page roles (crisis responders open MBC and its
  // assessment trends for clients in their scope). Submitting stays on the assessments page roles.
  const params = new URL(req.url).searchParams;
  // One-client read: Part 2 / VIP lock (403 + break-glass) via requireClinicalContext
  const one = { clientId: params.get('clientId') };
  let gate = await requireClinicalContext('/dashboard/ehr/assessments', one);
  if (!gate.ok && gate.status === 403 && gate.error === 'Forbidden') gate = await requireClinicalContext('/dashboard/mbc', one);
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    // List feed: drop Part 2 / VIP clients this actor may not open
    const records = await withoutLockedClients(gate, await prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: gate.organizationId,
        client: gate.clientWhere,
        ...(params.get('clientId') ? { clientId: params.get('clientId')! } : {}),
        ...(params.get('instrumentId') ? { instrumentId: params.get('instrumentId')! } : {})
      },
      include: { answers: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECORDS,
    }));
    const data = records.map((row) => ({
      ...row,
      completedAt: row.createdAt.toISOString(),
      adminType: row.administrationType,
      clinicianVerified: true,
      answers: Object.fromEntries(row.answers.map((answer) => [answer.itemId, answer.scoreValue]))
    }));
    await auditPhiAccess({
      gate, req, action: 'LIST', resourceType: 'assessment', patientId: params.get('clientId') || null,
      metadata: { count: data.length, clientId: params.get('clientId') || null, instrumentId: params.get('instrumentId') || null },
    });
    return NextResponse.json({ success: true, data, records: data });
  } catch {
    return NextResponse.json({ error: 'Could not load assessment history' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireClinicalContext('/dashboard/ehr/assessments');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  try {
    const body = submitSchema.parse(await req.json());
    const instrument = ASSESSMENT_CATALOG.find((entry) => entry.id === body.instrumentId);
    if (!instrument) return NextResponse.json({ error: 'Unknown assessment instrument' }, { status: 400 });
    
    const client = await prisma.client.findFirst({
      where: { id: body.clientId, AND: [gate.clientWhere] },
      select: { id: true, name: true, assignedToId: true }
    });
    if (!client) {
      await auditPhiAccess({
        gate, req, action: 'CREATE', resourceType: 'assessment', patientId: body.clientId,
        outcome: 'DENIED', metadata: { instrumentId: body.instrumentId, reason: 'patient_not_found' },
      });
      return NextResponse.json({ error: 'Patient not found' }, { status: 404 });
    }

    const digital = body.administrationType === 'Digital';
    if (digital && (!instrument.hasDigitalQuestionnaire || !instrument.questions?.every((question) =>
      question.options.some((option) => option.score === body.answers[question.id])) ||
      Object.keys(body.answers).length !== instrument.questions.length)) {
      return NextResponse.json({ error: 'Answer every question using a valid option' }, { status: 400 });
    }
    if (!digital && (body.totalScore === undefined || body.totalScore > (instrument.maxScore ?? Infinity))) {
      return NextResponse.json({ error: 'Enter a score within the instrument range' }, { status: 400 });
    }
    // Score only: the clinician's severity if given, else the instrument's own scoring of the total
    const fromTotal = !digital && !body.severity?.trim() ? scoreFromTotal(instrument.id, body.totalScore || 0) : null;
    const result = instrument && digital
      ? instrument.calculateResult(body.answers)
      : {
          totalScore: body.totalScore || 0,
          severity: body.severity || fromTotal?.severity || 'Completed',
          interpretation: body.interpretation || fromTotal?.interpretation || 'Assessment completed',
          safetyFlagged: body.safetyFlagged || Boolean(fromTotal?.safetyFlagged),
          safetyNotes: body.safetyNotes,
        };

    const answerEntries =
      digital && instrument.questions
        ? instrument.questions.map((question) => ({
            itemId: question.id,
            questionText: question.text,
            scoreValue: body.answers[question.id],
            selectedText: question.options.find((option) => option.score === body.answers[question.id])?.label,
            flagged: question.options.some((option) => option.score === body.answers[question.id] && option.flagged),
          }))
        : Object.entries(body.answers).map(([itemId, scoreValue]) => ({
            itemId,
            questionText: itemId,
            scoreValue,
            selectedText: scoreValue === 1 ? 'Yes' : scoreValue === 0 ? 'No' : String(scoreValue),
            flagged: false,
          }));

    const record = await prisma.clinicalAssessmentRecord.create({
      data: {
        organizationId: gate.organizationId,
        clientId: body.clientId,
        instrumentId: body.instrumentId,
        instrumentName: instrument.name,
        category: instrument.category,
        administrationType: body.administrationType,
        respondentType: body.respondentType,
        totalScore: result.totalScore,
        severity: result.severity,
        interpretation: result.interpretation,
        safetyFlagged: result.safetyFlagged,
        safetyNotes: result.safetyNotes,
        notes: body.notes,
        administeredById: gate.userId,
        answers: { create: answerEntries },
      },
    });

    // PHQ-9 threshold → EventBridge / ClinicalEvent (demoMode when bus unset)
    if (body.instrumentId === 'phq-9' && typeof result.totalScore === 'number' && result.totalScore >= 20) {
      try {
        const { recordClinicalEvent } = await import('@/lib/clinical/events');
        await recordClinicalEvent({
          organizationId: gate.organizationId,
          eventType: 'phq9-alert',
          clientId: body.clientId,
          clientName: client.name,
          createdById: gate.userId,
          payload: { score: result.totalScore, threshold: 20, assessmentId: record.id },
        });
      } catch (alertErr) {
        console.error('[assessments] phq9-alert failed', alertErr);
      }
    }

    // Positive critical item: the same HIGH risk alert as a patient link / paper entry (once per record)
    const scored = sessionScored({ instrumentId: instrument.id, instrumentName: instrument.name, category: instrument.category, answers: digital ? body.answers : {}, result });
    let riskAlertIds: string[] = [];
    if (scored.safetyFlagged) {
      try {
        const raised = await raiseSessionSafetyAlert(prisma, { organizationId: gate.organizationId, client, actorUserId: gate.userId, recordId: record.id, scored });
        riskAlertIds = raised.created;
        for (const id of raised.created) {
          await auditPhiAccess({
            gate, req, action: 'CREATE', resourceType: 'riskAlert', resourceId: id, patientId: client.id,
            metadata: { feature: 'assessment-in-session', assessmentId: record.id, instrumentId: body.instrumentId, severity: 'high' },
          });
        }
        if (raised.created.length) invalidateInboxForOrg(gate.organizationId);
      } catch (alertErr) {
        console.error('[assessments] safety alert failed', alertErr instanceof Error ? alertErr.message : 'unknown');
      }
    }

    await auditPhiAccess({
      gate, req, action: 'CREATE', resourceType: 'assessment', resourceId: record.id, patientId: client.id,
      metadata: {
        instrumentId: body.instrumentId,
        administrationType: body.administrationType,
        answerCount: answerEntries.length,
        safetyFlagged: Boolean(scored.safetyFlagged),
        riskAlertIds,
      },
    });
    return NextResponse.json({ success: true, data: record, safetyFlagged: scored.safetyFlagged, riskAlertIds }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof z.ZodError ? 'Clinician verification and valid assessment input are required' : 'Could not save assessment' }, { status: err instanceof z.ZodError ? 400 : 500 });
  }
}
