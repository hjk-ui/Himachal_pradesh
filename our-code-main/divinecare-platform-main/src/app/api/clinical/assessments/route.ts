import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireClinicalContext } from '@/lib/clinical/access';
import { prisma } from '@/lib/db/prisma';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';

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

export async function GET(req: Request) {
  const gate = await requireClinicalContext('/dashboard/ehr/assessments');
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
  const params = new URL(req.url).searchParams;
  try {
    const records = await prisma.clinicalAssessmentRecord.findMany({
      where: {
        organizationId: gate.organizationId,
        client: gate.clientWhere,
        ...(params.get('clientId') ? { clientId: params.get('clientId')! } : {}),
        ...(params.get('instrumentId') ? { instrumentId: params.get('instrumentId')! } : {})
      },
      include: { answers: true },
      orderBy: { createdAt: 'desc' },
    });
    const data = records.map((row) => ({
      ...row,
      completedAt: row.createdAt.toISOString(),
      adminType: row.administrationType,
      clinicianVerified: true,
      answers: Object.fromEntries(row.answers.map((answer) => [answer.itemId, answer.scoreValue]))
    }));
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
      select: { id: true, name: true }
    });
    if (!client) return NextResponse.json({ error: 'Patient not found' }, { status: 404 });

    const digital = body.administrationType === 'Digital';
    if (digital && (!instrument.hasDigitalQuestionnaire || !instrument.questions?.every((question) =>
      question.options.some((option) => option.score === body.answers[question.id])) ||
      Object.keys(body.answers).length !== instrument.questions.length)) {
      return NextResponse.json({ error: 'Answer every question using a valid option' }, { status: 400 });
    }
    if (!digital && (body.totalScore === undefined || body.totalScore > (instrument.maxScore ?? Infinity))) {
      return NextResponse.json({ error: 'Enter a score within the instrument range' }, { status: 400 });
    }
    const result = instrument && digital
      ? instrument.calculateResult(body.answers)
      : {
          totalScore: body.totalScore || 0,
          severity: body.severity || 'Completed',
          interpretation: body.interpretation || 'Assessment completed',
          safetyFlagged: body.safetyFlagged,
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

    return NextResponse.json({ success: true, data: record, safetyFlagged: result.safetyFlagged }, { status: 201 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof z.ZodError ? 'Clinician verification and valid assessment input are required' : 'Could not save assessment' }, { status: err instanceof z.ZodError ? 400 : 500 });
  }
}
