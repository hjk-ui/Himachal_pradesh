import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { toPracticeWallTime } from '@/lib/time/practiceTime';
import { ASSESSMENT_CATALOG } from '@/features/ehr/assessments/catalog';
import {
  auditCPositive,
  bmiFromImperial,
  bpRecheckState,
  canRoomPatients,
  canViewPrimaryCareWorkflow,
  fallsScreenPositive,
  isPrimaryCareProvider,
  openCareGaps,
  phq2Positive,
  phqTotal,
  screeningSafetyFlags,
  usableStandingOrders,
  vitalEntryErrors,
  vitalFlags,
  type RoomingVitals,
} from '@/lib/medical/primaryCareWorkflow';
import {
  loadPatientCareFacts,
  loadPrimaryCareAppointment,
  loadPrimaryCareSettings,
  PC_SCREENING_CATEGORY,
  sexFrom,
} from '@/lib/medical/primaryCareWorkflowDb';
import { loadCurrentPcp } from '@/lib/medical/pcpAssignmentDb';
import { raiseRoomingSafetyAlert, roomingSafetyPrompt, roomingSafetyRecipient, roomingScored, ROOMING_SAFETY_PROMPT } from '@/lib/medical/roomingSafety';
import type { ScoredMeasure } from '@/lib/measures/scoring';
import { invalidateInboxForOrg } from '@/lib/inbox/cacheStore';
import { workflowClientGate, workflowGate, zodMessage } from '../../_lib/workflowGate';

export const runtime = 'nodejs';

const RESOURCE = 'medicalRooming';
const vitalNum = z.union([z.number(), z.null()]).optional();
const item = (max: number) => z.number().int().min(0).max(max);

const vitalsSchema = z
  .object({
    systolic: vitalNum,
    diastolic: vitalNum,
    heartRate: vitalNum,
    respRate: vitalNum,
    temperatureF: vitalNum,
    spO2: vitalNum,
    heightIn: vitalNum,
    weightLbs: vitalNum,
    pain: vitalNum,
    takenAt: z.string().datetime().nullable().optional(),
    recheck: z
      .object({ systolic: z.number(), diastolic: z.number(), takenAt: z.string().datetime().nullable().optional() })
      .nullable()
      .optional(),
  })
  .strict();

const checksSchema = z
  .object({
    allergies: z.object({ status: z.enum(['no_changes', 'updated']) }).nullable().optional(),
    meds: z
      .object({
        reviewed: z.boolean(),
        /** outside meds the patient reports: stored as "reported" for the provider to reconcile */
        reported: z
          .array(z.object({ name: z.string().trim().min(1).max(120), dose: z.string().trim().max(60).optional().nullable(), frequency: z.string().trim().max(60).optional().nullable(), note: z.string().trim().max(200).optional().nullable() }))
          .max(30)
          .default([]),
      })
      .nullable()
      .optional(),
    pharmacy: z.object({ status: z.enum(['confirmed', 'changed', 'none']), name: z.string().trim().max(160).optional().nullable() }).nullable().optional(),
    screenings: z
      .object({
        phq2: z.object({ items: z.array(item(3)).length(2) }).nullable().optional(),
        phq9: z.object({ items: z.array(item(3)).length(9) }).nullable().optional(),
        gad7: z.object({ items: z.array(item(3)).length(7) }).nullable().optional(),
        auditC: z.object({ items: z.array(item(4)).length(3) }).nullable().optional(),
        tobacco: z.object({ status: z.enum(['never', 'former', 'current_every_day', 'current_some_days', 'declined']) }).nullable().optional(),
        falls: z.object({ fell: z.boolean(), unsteady: z.boolean(), worried: z.boolean() }).nullable().optional(),
        declined: z.array(z.enum(['depression', 'tobacco', 'alcohol', 'falls', 'sdoh'])).max(5).default([]),
      })
      .nullable()
      .optional(),
    poc: z.array(z.object({ key: z.string().trim().min(1).max(60), result: z.string().trim().min(1).max(60) })).max(20).default([]),
  })
  .strict();

const putSchema = z.object({
  action: z.enum(['save', 'ready', 'in_room']),
  identityConfirmed: z.boolean().optional(),
  identifiers: z.array(z.enum(['name', 'dob', 'phone', 'address', 'photo_id'])).max(5).optional(),
  chiefComplaint: z.string().trim().max(500).nullable().optional(),
  vitals: vitalsSchema.nullable().optional(),
  checks: checksSchema.nullable().optional(),
});

type StoredScreen = { items: number[]; total: number | null; positive?: boolean; item9?: number; recordId?: string | null };
type StoredChecks = {
  allergies?: { status: string; at: string } | null;
  meds?: { reviewed: boolean; reported: unknown[]; at: string } | null;
  pharmacy?: { status: string; name?: string | null; at: string } | null;
  screenings?: {
    phq2?: StoredScreen | null;
    phq9?: StoredScreen | null;
    gad7?: StoredScreen | null;
    auditC?: StoredScreen | null;
    tobacco?: { status: string; at: string } | null;
    falls?: { fell: boolean; unsteady: boolean; worried: boolean; positive: boolean; at: string } | null;
    declined?: string[];
  } | null;
  poc?: { key: string; name: string; result: string; unit: string | null; at: string; byName: string | null }[];
};

/** GET /api/medical/rooming/[appointmentId] — rooming record + what the MA needs to room the patient */
export async function GET(req: Request, ctx: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await ctx.params;
  const g = await workflowGate(req, { action: 'READ', resourceType: RESOURCE, allow: canViewPrimaryCareWorkflow });
  if (g.ok === false) return g.response;
  const { gate, viewer } = g;
  const appt = await loadPrimaryCareAppointment(gate.organizationId, appointmentId);
  if (!appt) return NextResponse.json({ success: false, error: 'Primary care appointment not found' }, { status: 404 });
  const c = await workflowClientGate(req, gate, viewer, appt.clientId, { action: 'READ', resourceType: RESOURCE });
  if (c.ok === false) return c.response;

  try {
    const now = new Date();
    const timeZone = await getPracticeTimeZone(gate.organizationId);
    const settings = await loadPrimaryCareSettings(gate.organizationId);
    const [rooming, facts, client, shadows, meds, lastRx] = await Promise.all([
      prisma.medicalRooming.findUnique({ where: { appointmentId } }),
      loadPatientCareFacts(viewer, appt.clientId, { now, timeZone, disabledGaps: settings.careGapsDisabled }),
      prisma.client.findFirst({ where: { id: appt.clientId, organizationId: gate.organizationId }, select: { name: true, dateOfBirth: true, sexAtBirth: true, administrativeSex: true, mrn: true, phone: true } }),
      prisma.medicalPatient.findMany({ where: { organizationId: gate.organizationId, bhClientId: appt.clientId }, select: { id: true } }),
      prisma.clientMedication.findMany({
        where: { clientId: appt.clientId, active: true },
        select: { id: true, medicationName: true, dosage: true, frequency: true, source: true },
        orderBy: { medicationName: 'asc' },
        take: 100,
      }),
      prisma.rcopiaPrescription.findFirst({ where: { clientId: appt.clientId, pharmacyName: { not: null } }, select: { pharmacyName: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
    ]);
    const allergies = await prisma.medicalAllergy.findMany({
      where: { OR: [{ clientId: appt.clientId }, ...(shadows.length ? [{ patientId: { in: shadows.map((s) => s.id) } }] : [])], status: { not: 'Inactive' } },
      select: { id: true, allergen: true, reaction: true, severity: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const vitals = (rooming?.vitals ?? null) as RoomingVitals | null;
    await auditPhiAccess({ gate, req, action: 'READ', resourceType: RESOURCE, resourceId: rooming?.id ?? null, patientId: appt.clientId, metadata: { appointmentId, status: rooming?.status ?? 'none' } });
    return NextResponse.json({
      success: true,
      appointment: {
        id: appt.id,
        clientId: appt.clientId,
        startsAt: appt.startsAt.toISOString(),
        time: toPracticeWallTime(appt.startsAt, timeZone).time,
        type: appt.type,
        status: appt.status,
        isVirtual: appt.isVirtual,
        clinician: appt.clinician?.name || appt.clinicianName || null,
      },
      patient: {
        name: client?.name ?? c.client.name,
        dob: client?.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
        mrn: client?.mrn ?? null,
        ageYears: facts.ageYears,
        sex: sexFrom(client?.sexAtBirth, client?.administrativeSex),
      },
      rooming: rooming
        ? {
            id: rooming.id,
            status: rooming.status,
            identityConfirmed: rooming.identityConfirmed,
            identifiers: rooming.identifiers,
            chiefComplaint: rooming.chiefComplaint,
            vitals,
            checks: rooming.checks,
            vitalsWritten: rooming.vitalIds.length,
            roomedByName: rooming.roomedByName,
            roomedAt: rooming.roomedAt?.toISOString() ?? null,
            inRoomAt: rooming.inRoomAt?.toISOString() ?? null,
          }
        : null,
      derived: {
        bmi: vitals ? bmiFromImperial(vitals.weightLbs, vitals.heightIn) : null,
        flags: [...(vitals ? vitalFlags(vitals) : []), ...screeningSafetyFlags((rooming?.checks as StoredChecks | null)?.screenings)],
        recheck: vitals ? bpRecheckState(vitals, now) : { state: 'not_needed' },
      },
      safetyPrompt: roomingSafetyPrompt(screeningSafetyFlags((rooming?.checks as StoredChecks | null)?.screenings).length),
      allergies,
      medications: meds,
      pharmacyOnFile: lastRx?.pharmacyName ? { name: lastRx.pharmacyName, from: 'last DrFirst prescription' } : null,
      screenings: facts.screenings,
      careGaps: openCareGaps(facts.careGaps),
      // Only Medical Director-approved standing orders are offered to the MA
      standingOrders: usableStandingOrders(settings.pocStandingOrders),
      canEdit: canRoomPatients(viewer.role),
      canMarkInRoom: isPrimaryCareProvider(viewer.role),
    });
  } catch (err) {
    console.error('[medical/rooming GET]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not load rooming' }, { status: 500 });
  }
}

function score(instrumentId: string, items: number[]) {
  const inst = ASSESSMENT_CATALOG.find((i) => i.id === instrumentId);
  if (!inst?.calculateResult) return null;
  const answers = Object.fromEntries(items.map((v, i) => [`q${i + 1}`, v]));
  return { inst, answers, result: inst.calculateResult(answers) };
}

/** PUT /api/medical/rooming/[appointmentId] — save draft, "Ready for provider", or "In room" (provider) */
export async function PUT(req: Request, ctx: { params: Promise<{ appointmentId: string }> }) {
  const { appointmentId } = await ctx.params;
  const g = await workflowGate(req, { action: 'UPDATE', resourceType: RESOURCE, allow: canRoomPatients });
  if (g.ok === false) return g.response;
  const { gate, viewer } = g;
  const appt = await loadPrimaryCareAppointment(gate.organizationId, appointmentId);
  if (!appt) return NextResponse.json({ success: false, error: 'Primary care appointment not found' }, { status: 404 });
  const c = await workflowClientGate(req, gate, viewer, appt.clientId, { action: 'UPDATE', resourceType: RESOURCE });
  if (c.ok === false) return c.response;

  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ success: false, error: zodMessage(err, 'Check the rooming entries') }, { status: 400 });
  }

  try {
    const now = new Date();
    const existing = await prisma.medicalRooming.findUnique({ where: { appointmentId } });
    if (existing && existing.organizationId !== gate.organizationId) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });

    if (body.action === 'in_room') {
      if (!isPrimaryCareProvider(viewer.role)) return NextResponse.json({ success: false, error: 'Only the physician or nurse practitioner marks the visit started' }, { status: 403 });
      const row = existing
        ? await prisma.medicalRooming.update({ where: { id: existing.id }, data: { status: 'in_room', inRoomAt: existing.inRoomAt ?? now, inRoomById: existing.inRoomById ?? viewer.userId } })
        : await prisma.medicalRooming.create({ data: { organizationId: gate.organizationId, appointmentId, clientId: appt.clientId, status: 'in_room', inRoomAt: now, inRoomById: viewer.userId } });
      await auditPhiAccess({ gate, req, action: 'UPDATE', resourceType: RESOURCE, resourceId: row.id, patientId: appt.clientId, metadata: { appointmentId, event: 'in_room' } });
      return NextResponse.json({ success: true, status: row.status, inRoomAt: row.inRoomAt?.toISOString() ?? null });
    }

    const firstWritten = Boolean(existing?.vitalIds.length);
    const prevVitals = (existing?.vitals ?? null) as RoomingVitals | null;
    // Vitals already filed to the flowsheet are kept; only a missing BP recheck can still be added
    let vitals: RoomingVitals | null = body.vitals === undefined ? prevVitals : body.vitals;
    if (firstWritten && prevVitals) vitals = { ...prevVitals, recheck: prevVitals.recheck ?? vitals?.recheck ?? null };
    if (vitals) {
      if (!vitals.takenAt && Object.entries(vitals).some(([k, v]) => k !== 'recheck' && k !== 'takenAt' && v != null)) vitals = { ...vitals, takenAt: now.toISOString() };
      if (vitals.recheck && !vitals.recheck.takenAt) vitals = { ...vitals, recheck: { ...vitals.recheck, takenAt: now.toISOString() } };
      const errors = vitalEntryErrors(vitals);
      if (errors.length) return NextResponse.json({ success: false, error: errors[0], errors }, { status: 400 });
    }

    const settings = await loadPrimaryCareSettings(gate.organizationId);
    const prevChecks = (existing?.checks ?? {}) as StoredChecks;
    const at = now.toISOString();
    const checks: StoredChecks = { ...prevChecks };
    const inChecks = body.checks;
    if (inChecks) {
      if (inChecks.allergies !== undefined) checks.allergies = inChecks.allergies ? { status: inChecks.allergies.status, at } : null;
      if (inChecks.meds !== undefined) checks.meds = inChecks.meds ? { reviewed: inChecks.meds.reviewed, reported: inChecks.meds.reported, at } : null;
      if (inChecks.pharmacy !== undefined) checks.pharmacy = inChecks.pharmacy ? { status: inChecks.pharmacy.status, name: inChecks.pharmacy.name ?? null, at } : null;
      if (inChecks.screenings !== undefined) {
        const s = inChecks.screenings;
        const prev = prevChecks.screenings ?? {};
        // Screens already filed as assessment records stay as filed
        const keep = <T extends StoredScreen>(p: T | null | undefined, next: T | null): T | null => (p?.recordId ? p : next);
        const sex = sexFrom(...(await prisma.client.findFirst({ where: { id: appt.clientId }, select: { sexAtBirth: true, administrativeSex: true } }).then((r) => [r?.sexAtBirth, r?.administrativeSex] as const)));
        checks.screenings = s
          ? {
              phq2: keep(prev.phq2, s.phq2 ? { items: s.phq2.items, total: phqTotal(s.phq2.items, 2), positive: phq2Positive(phqTotal(s.phq2.items, 2)) } : null),
              phq9: keep(prev.phq9, s.phq9 ? { items: s.phq9.items, total: phqTotal(s.phq9.items, 9), item9: s.phq9.items[8] } : null),
              gad7: keep(prev.gad7, s.gad7 ? { items: s.gad7.items, total: phqTotal(s.gad7.items, 7) } : null),
              auditC: keep(
                prev.auditC,
                s.auditC ? { items: s.auditC.items, total: s.auditC.items.reduce((a, b) => a + b, 0), positive: auditCPositive(s.auditC.items.reduce((a, b) => a + b, 0), sex) } : null
              ),
              tobacco: s.tobacco ? { status: s.tobacco.status, at: prev.tobacco?.status === s.tobacco.status ? prev.tobacco.at : at } : null,
              falls: s.falls ? { ...s.falls, positive: fallsScreenPositive(s.falls), at } : null,
              declined: s.declined,
            }
          : null;
      }
      if (inChecks.poc.length || prevChecks.poc?.length) {
        // Server rule: a new or changed result is accepted only under an APPROVED standing order. A result
        // already recorded (unchanged) is kept even if its order was retired since.
        const byKey = new Map(usableStandingOrders(settings.pocStandingOrders).map((o) => [o.key, o]));
        const prevPoc = new Map((prevChecks.poc ?? []).map((p) => [p.key, p]));
        const unknown = inChecks.poc.find((p) => !byKey.has(p.key) && prevPoc.get(p.key)?.result !== p.result);
        if (unknown) return NextResponse.json({ success: false, error: 'That point-of-care test has no approved standing order (Medical Director approval needed)' }, { status: 400 });
        const me = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { name: true } });
        checks.poc = inChecks.poc.map((p) => {
          const old = prevPoc.get(p.key);
          if (old && old.result === p.result) return old;
          const o = byKey.get(p.key)!;
          return { key: p.key, name: o.name, result: p.result, unit: o.unit ?? null, at, byName: me?.name ?? null };
        });
      }
    }

    const identifiers = body.identifiers ?? existing?.identifiers ?? [];
    const identityConfirmed = body.identityConfirmed ?? existing?.identityConfirmed ?? false;
    const chiefComplaint = body.chiefComplaint === undefined ? existing?.chiefComplaint ?? null : body.chiefComplaint || null;

    const warnings: string[] = [];
    let vitalIds = existing?.vitalIds ?? [];
    let status = existing?.status ?? 'draft';
    const me = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { name: true } });
    const createdRecords: string[] = [];
    /** Screens filed in this request whose critical item / scoring flags safety (raise the risk alert) */
    const safetyFiled: { recordId: string; instrumentId: string; scored: ScoredMeasure }[] = [];

    if (body.action === 'ready') {
      if (!identityConfirmed || new Set(identifiers).size < 2) return NextResponse.json({ success: false, error: 'Confirm the patient with two identifiers (for example name and date of birth)' }, { status: 400 });
      if (!chiefComplaint) return NextResponse.json({ success: false, error: 'Enter the chief complaint / reason for visit' }, { status: 400 });
    }

    // File a completed screening as an assessment record (primary care screening category). With
    // onlySafety, only a screen whose safety item is positive is filed (on any save, so the provider
    // is alerted right away instead of at "Ready for provider"); a filed screen stays as filed.
    const scr = checks.screenings;
    const file = async (key: 'phq2' | 'phq9' | 'gad7', instrumentId: string, onlySafety = false) => {
      const sc = scr?.[key];
      if (!sc || sc.recordId || sc.total == null) return;
      const scored = score(instrumentId, sc.items);
      if (!scored) return;
      const safety = roomingScored({ instrumentId, instrumentName: scored.inst.name, category: scored.inst.category, answers: scored.answers, result: scored.result });
      if (onlySafety && !safety.safetyFlagged) return;
      const rec = await prisma.clinicalAssessmentRecord.create({
        data: {
          organizationId: gate.organizationId,
          clientId: appt.clientId,
          instrumentId,
          instrumentName: scored.inst.name,
          category: PC_SCREENING_CATEGORY,
          administrationType: 'Manual',
          respondentType: 'Self',
          totalScore: scored.result.totalScore,
          severity: scored.result.severity,
          interpretation: scored.result.interpretation,
          safetyFlagged: Boolean(scored.result.safetyFlagged) || safety.safetyFlagged,
          safetyNotes: scored.result.safetyNotes,
          notes: 'Primary care rooming',
          administeredById: viewer.userId,
          answers: {
            create: (scored.inst.questions ?? []).map((q) => ({
              itemId: q.id,
              questionText: q.text,
              scoreValue: scored.answers[q.id],
              selectedText: q.options.find((o) => o.score === scored.answers[q.id])?.label,
              flagged: q.options.some((o) => o.score === scored.answers[q.id] && o.flagged),
            })),
          },
        },
      });
      sc.recordId = rec.id;
      createdRecords.push(rec.id);
      if (safety.safetyFlagged) safetyFiled.push({ recordId: rec.id, instrumentId, scored: safety });
    };
    if (scr) {
      await file('phq2', 'phq-2', true);
      await file('phq9', 'phq-9', true);
      await file('gad7', 'gad-7', true);
    }

    if (body.action === 'ready') {
      if (vitals) {
        const rc = bpRecheckState(vitals, now);
        if (rc.state === 'wait' || rc.state === 'due') warnings.push('Blood pressure was 140/90 or higher and no recheck is recorded');
      } else if (!appt.isVirtual) {
        warnings.push('No vitals recorded');
      }
      const s = checks.screenings;
      if (s?.phq2?.positive && !s.phq9) warnings.push('PHQ-2 is positive: the PHQ-9 is not recorded');

      // File vitals to the flowsheet (first set, then the recheck as its own reading)
      const hasFirst = vitals && ['systolic', 'heartRate', 'respRate', 'temperatureF', 'spO2', 'heightIn', 'weightLbs'].some((k) => (vitals as Record<string, unknown>)[k] != null);
      if (vitals && hasFirst && vitalIds.length === 0) {
        const v = await prisma.medicalVital.create({
          data: {
            clientId: appt.clientId,
            recordedById: viewer.userId,
            recordedAt: vitals.takenAt ? new Date(vitals.takenAt) : now,
            systolic: vitals.systolic ?? null,
            bpSystolic: vitals.systolic ?? null,
            diastolic: vitals.diastolic ?? null,
            bpDiastolic: vitals.diastolic ?? null,
            heartRate: vitals.heartRate ?? null,
            respiratoryRate: vitals.respRate ?? null,
            respRate: vitals.respRate ?? null,
            temperature: vitals.temperatureF ?? null,
            spO2: vitals.spO2 ?? null,
            o2Sat: vitals.spO2 ?? null,
            weightLbs: vitals.weightLbs ?? null,
            heightInches: vitals.heightIn ?? null,
            bmi: bmiFromImperial(vitals.weightLbs, vitals.heightIn),
          },
        });
        vitalIds = [v.id];
      }
      if (vitals?.recheck && vitalIds.length === 1) {
        const r = await prisma.medicalVital.create({
          data: {
            clientId: appt.clientId,
            recordedById: viewer.userId,
            recordedAt: vitals.recheck.takenAt ? new Date(vitals.recheck.takenAt) : now,
            systolic: vitals.recheck.systolic,
            bpSystolic: vitals.recheck.systolic,
            diastolic: vitals.recheck.diastolic,
            bpDiastolic: vitals.recheck.diastolic,
          },
        });
        vitalIds = [...vitalIds, r.id];
      }

      // File completed screenings as assessment records (primary care screening category)
      if (s) {
        await file('phq2', 'phq-2');
        await file('phq9', 'phq-9');
        await file('gad7', 'gad-7');
        if (s.auditC && !s.auditC.recordId && s.auditC.total != null) {
          const rec = await prisma.clinicalAssessmentRecord.create({
            data: {
              organizationId: gate.organizationId,
              clientId: appt.clientId,
              instrumentId: 'audit-c',
              instrumentName: 'AUDIT-C',
              category: PC_SCREENING_CATEGORY,
              administrationType: 'Manual',
              respondentType: 'Self',
              totalScore: s.auditC.total,
              severity: s.auditC.positive ? 'Positive screen' : 'Negative screen',
              interpretation: `AUDIT-C ${s.auditC.total}/12`,
              notes: 'Primary care rooming',
              administeredById: viewer.userId,
              answers: { create: s.auditC.items.map((v, i) => ({ itemId: `q${i + 1}`, questionText: `AUDIT-C item ${i + 1}`, scoreValue: v, selectedText: String(v), flagged: false })) },
            },
          });
          s.auditC.recordId = rec.id;
          createdRecords.push(rec.id);
        }
      }
      if (status === 'draft') status = 'ready';
    }

    const data = {
      status,
      identityConfirmed,
      identifiers,
      chiefComplaint,
      vitals: (vitals ?? undefined) as Prisma.InputJsonValue | undefined,
      checks: checks as unknown as Prisma.InputJsonValue,
      vitalIds,
      ...(body.action === 'ready' && !existing?.roomedAt ? { roomedAt: now, roomedById: viewer.userId, roomedByName: me?.name ?? null } : {}),
    };
    const row = existing
      ? await prisma.medicalRooming.update({ where: { id: existing.id }, data })
      : await prisma.medicalRooming.create({ data: { organizationId: gate.organizationId, appointmentId, clientId: appt.clientId, ...data } });

    // Positive safety screen: the same HIGH risk alert as EHR > Assessments, once per record, to the
    // PCP (else the rendering provider, else the person who entered it)
    const riskAlertIds: string[] = [];
    if (safetyFiled.length) {
      try {
        const pcp = await loadCurrentPcp(gate.organizationId, appt.clientId).catch(() => null);
        const recipientUserId = roomingSafetyRecipient({ pcpUserId: pcp?.userId ?? null, renderingProviderId: appt.clinicianId, enteredById: viewer.userId });
        for (const f of safetyFiled) {
          const raised = await raiseRoomingSafetyAlert(prisma, {
            organizationId: gate.organizationId,
            client: { id: appt.clientId, name: appt.client?.name ?? c.client.name ?? null },
            recipientUserId,
            actorUserId: viewer.userId,
            recordId: f.recordId,
            scored: f.scored,
          });
          for (const id of raised.created) {
            riskAlertIds.push(id);
            await auditPhiAccess({
              gate, req, action: 'CREATE', resourceType: 'riskAlert', resourceId: id, patientId: appt.clientId,
              metadata: { feature: 'primary-care-rooming', appointmentId, assessmentId: f.recordId, instrumentId: f.instrumentId, severity: 'high', recipient: recipientUserId === pcp?.userId ? 'pcp' : recipientUserId === appt.clinicianId ? 'rendering_provider' : 'entered_by' },
            });
          }
        }
        if (riskAlertIds.length) invalidateInboxForOrg(gate.organizationId);
      } catch (alertErr) {
        console.error('[medical/rooming PUT] safety alert failed', alertErr instanceof Error ? alertErr.name : 'error');
      }
    }

    await auditPhiAccess({
      gate,
      req,
      action: existing ? 'UPDATE' : 'CREATE',
      resourceType: RESOURCE,
      resourceId: row.id,
      patientId: appt.clientId,
      metadata: { appointmentId, event: body.action, status: row.status, vitalsFiled: vitalIds.length, assessmentsFiled: createdRecords.length, riskAlertIds },
    });
    const safetyFlagCount = screeningSafetyFlags(checks.screenings).length;
    const v = (row.vitals ?? null) as RoomingVitals | null;
    return NextResponse.json({
      success: true,
      status: row.status,
      roomedAt: row.roomedAt?.toISOString() ?? null,
      warnings,
      vitalsWritten: vitalIds.length,
      checks: row.checks,
      vitals: v,
      derived: {
        bmi: v ? bmiFromImperial(v.weightLbs, v.heightIn) : null,
        flags: [...(v ? vitalFlags(v) : []), ...screeningSafetyFlags(checks.screenings)],
        recheck: v ? bpRecheckState(v, now) : { state: 'not_needed' },
      },
      // MA prompt only: no score, no recipient name (minimum necessary)
      safety: safetyFlagCount ? { prompt: ROOMING_SAFETY_PROMPT, alertSent: riskAlertIds.length > 0 } : null,
    });
  } catch (err) {
    console.error('[medical/rooming PUT]', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ success: false, error: 'Could not save rooming' }, { status: 500 });
  }
}
