import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'fs/promises';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireClinicalContext } from '@/lib/clinical/access';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { detectFileType, MAX_UPLOAD_BYTES } from '@/lib/docIntake/process';
import { FILING_PATH } from '@/lib/docIntake/classify';
import { uploadDir, uploadPath } from '@/lib/storage/privateUploads';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { safetyAlertsFor } from '@/lib/measures/safety';
import { paperAdministeredAt, paperEnteredLabel, scorePaperMeasure } from '@/lib/measures/paper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const fields = z.object({
  clientId: z.string().min(1).max(60),
  instrumentId: z.string().min(1).max(60),
  administeredOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(['items', 'total']),
  totalScore: z.coerce.number().optional(),
  safetyItemScore: z.coerce.number().optional(),
  answers: z.string().max(20_000).optional(),
  respondentType: z.enum(['Self', 'Parent / guardian', 'Teacher', 'Clinician']).default('Self'),
  notes: z.string().max(2000).optional(),
});

/**
 * POST /api/clinical/measure-results/paper (multipart): a completed PAPER measure from the chart
 * (Assessments & outcomes > Upload paper measure). Fields: clientId, instrumentId, administeredOn
 * (date on the form), mode items | total, answers (JSON { itemId: score }) or totalScore (+
 * safetyItemScore for PHQ-9 / PHQ-A / EPDS), file (the scan: PDF / JPEG / PNG, <= 20 MB).
 *
 * Same roles as entering an assessment (EHR > Assessments), caseload and Part 2 / VIP lock checked.
 * Scores with the same catalog scoring as the in-session form and the patient link; the scan is
 * filed to Chart > Documents > Measures; the record is source 'paper', administrationType 'Paper',
 * dated the form date and labelled "Paper — entered by <staff>". Audited MEASURE_PAPER_ENTERED.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ success: false, error: 'Send the form as multipart form data' }, { status: 400 });
  }
  const raw = Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string' && v !== ''));
  const parsed = fields.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ success: false, error: 'Choose the client, the measure and the date on the form' }, { status: 400 });
  const body = parsed.data;

  const gate = await requireClinicalContext('/dashboard/ehr/assessments', { clientId: body.clientId });
  if (!gate.ok) return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });

  const client = await prisma.client.findFirst({ where: { AND: [{ id: body.clientId, organizationId: gate.organizationId }, gate.clientWhere] }, select: { id: true, name: true, assignedToId: true } });
  if (!client) return NextResponse.json({ success: false, error: 'Client not found' }, { status: 404 });

  const administeredAt = paperAdministeredAt(body.administeredOn);
  if (!administeredAt) return NextResponse.json({ success: false, error: 'Enter the date written on the form (not in the future)' }, { status: 400 });

  let answers: Record<string, number> | null = null;
  if (body.mode === 'items') {
    try {
      const a = JSON.parse(body.answers ?? '{}');
      answers = a && typeof a === 'object' && !Array.isArray(a) ? Object.fromEntries(Object.entries(a).filter(([, v]) => typeof v === 'number')) as Record<string, number> : null;
    } catch {
      answers = null;
    }
  }
  const scored = scorePaperMeasure({ instrumentId: body.instrumentId, mode: body.mode, answers, totalScore: body.totalScore ?? null, safetyItemScore: body.safetyItemScore ?? null });
  if (scored.ok === false) return NextResponse.json({ success: false, error: scored.error }, { status: 400 });
  const s = scored.scored;

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ success: false, error: 'Attach the scan of the paper form' }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ success: false, error: 'File is larger than 20 MB' }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = detectFileType(bytes);
  if (!type) return NextResponse.json({ success: false, error: 'Only PDF, JPEG and PNG files are accepted' }, { status: 415 });

  const staff = await prisma.user.findUnique({ where: { id: gate.userId }, select: { name: true, credentials: true } });
  const enteredBy = paperEnteredLabel([staff?.name, staff?.credentials].filter(Boolean).join(', '));

  try {
    // The scan, filed straight to the chart (staff chose the client; no OCR / matching needed)
    const doc = await prisma.documentIntake.create({
      data: {
        source: 'Scan',
        documentType: 'Measures',
        confidenceScore: 1,
        suggestedClientId: client.id,
        suggestedFilingPath: FILING_PATH.Measures,
        s3RawKey: 'pending',
        status: 'filed',
        filedByUserId: gate.userId,
        filedAt: new Date(),
        organizationId: gate.organizationId,
        uploadedById: gate.userId,
        fileName: (file.name || `paper-measure.${type.ext}`).slice(0, 200),
        mimeType: type.mime,
        fileSize: bytes.byteLength,
        matchStatus: 'matched',
        matchReason: 'Uploaded from the chart with a paper measure',
        extractedFields: [
          { label: 'Title', value: `${s.instrumentName} (paper) ${body.administeredOn}` },
          { label: 'Document date', value: body.administeredOn },
        ] as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const storedName = `${doc.id}.${type.ext}`;
    const abs = uploadPath('intake-docs', storedName);
    if (!abs) throw new Error('Invalid stored file name');
    await mkdir(uploadDir('intake-docs'), { recursive: true });
    await writeFile(abs, bytes);
    await prisma.documentIntake.update({ where: { id: doc.id }, data: { s3RawKey: storedName } });

    const record = await prisma.clinicalAssessmentRecord.create({
      data: {
        organizationId: gate.organizationId,
        clientId: client.id,
        instrumentId: s.instrumentId,
        instrumentName: s.instrumentName,
        category: s.category,
        administrationType: 'Paper',
        respondentType: body.respondentType,
        totalScore: s.totalScore,
        severity: s.severity,
        interpretation: s.interpretation,
        safetyFlagged: s.safetyFlagged,
        safetyNotes: s.safetyNotes,
        notes: [enteredBy, body.notes?.trim()].filter(Boolean).join('. '),
        administeredById: gate.userId,
        source: 'paper',
        sourceDocumentId: doc.id,
        createdAt: administeredAt,
        answers: { create: s.answers.map((a) => ({ itemId: a.itemId, questionText: a.questionText, scoreValue: a.scoreValue, selectedText: a.selectedText, flagged: a.flagged })) },
      },
      select: { id: true },
    });

    // A positive safety item raises the same HIGH risk alert as a patient link (treating clinician)
    let alertId: string | null = null;
    for (const a of safetyAlertsFor([s])) {
      const created = await prisma.riskAlert.create({
        data: {
          organizationId: gate.organizationId,
          clientId: client.id,
          clientName: client.name,
          clinicianId: client.assignedToId ?? gate.userId,
          type: a.type,
          severity: a.severity,
          source: 'assessment',
          sourceId: record.id,
          description: a.description.replace('on a questionnaire the patient completed before the visit', `on a paper form dated ${body.administeredOn}`).replace(' The patient was shown 988 / 911 crisis resources.', ''),
          reviewed: false,
        },
        select: { id: true },
      });
      alertId = created.id;
    }

    await auditPhiAccess({
      gate,
      req,
      action: 'MEASURE_PAPER_ENTERED',
      resourceType: 'assessment',
      resourceId: record.id,
      patientId: client.id,
      metadata: { instrumentId: s.instrumentId, mode: body.mode, documentId: doc.id, answerCount: s.answers.length, safetyFlagged: s.safetyFlagged, riskAlertId: alertId, administeredOn: body.administeredOn },
    });
    invalidateInboxForOrg(gate.organizationId);
    return NextResponse.json(
      {
        success: true,
        id: record.id,
        documentId: doc.id,
        totalScore: s.totalScore,
        severity: s.severity,
        safetyFlagged: s.safetyFlagged,
        message: s.safetyFlagged
          ? `${s.instrumentName} saved (${s.totalScore}, ${s.severity}). Safety item endorsed: complete a safety assessment (C-SSRS) and safety plan today.`
          : `${s.instrumentName} saved (${s.totalScore}, ${s.severity}). The scan is filed to Chart > Documents > Measures.`,
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[measure-paper] error:', err instanceof Error ? err.message.split('\n')[0] : 'unknown');
    return NextResponse.json({ success: false, error: 'Could not save the paper measure' }, { status: 500 });
  }
}
