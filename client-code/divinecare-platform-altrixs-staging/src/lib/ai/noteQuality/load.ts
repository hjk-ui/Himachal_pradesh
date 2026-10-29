/**
 * Loads the facts the quality rules read: the note (org-scoped), its signature, linked claims,
 * chart / plan diagnoses, the treatment plan gate, chart risk flags, author credentials and
 * licensure, practice settings, AI consent and Part 2 status. Read-only.
 */
import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { normalizeNoteType } from '@/lib/ehr/noteTemplates';
import { isTherapyTemplate } from '@/lib/ehr/structuredNotes';
import { THERAPY_TEMPLATES } from '@/lib/ehr/therapy/templates';
import { checkTreatmentPlanGate, loadLicenseLevel } from '@/lib/ehr/therapy/planStore';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { isPart2Classification } from '@/lib/fhir/mapping/privacy';
import { resolvePracticeTimeZone } from '@/lib/time/practiceTime';
import { diagnosisCodesIn, type NoteQualityFacts } from './rules';
import { parsePersistedFindings, riskFlagsFromFindings } from '@/lib/scribe/riskGate';
import type { QualityMode } from './types';

const DAY = 86_400_000;

export type LoadedQualityContext = {
  facts: NoteQualityFacts;
  names: { client: string | null; author: string | null };
  clientId: string;
  authorIds: string[];
  /** Inputs for decideAiGate */
  aiGateInput: { part2: boolean; consent: 'signed' | 'missing' | 'declined'; practiceRequiresConsent: boolean };
};

export async function loadQualityContext(input: {
  noteId: string;
  organizationId: string;
  mode: QualityMode;
}): Promise<{ ok: true; ctx: LoadedQualityContext } | { ok: false; status: number; error: string }> {
  const note = await prisma.progressNote.findFirst({
    where: { id: input.noteId, client: clientOrgFilter(input.organizationId) },
    select: {
      id: true,
      body: true,
      noteType: true,
      dateOfService: true,
      durationMinutes: true,
      cptCode: true,
      placeOfService: true,
      telehealth: true,
      part2: true,
      createdAt: true,
      clinicianId: true,
      client: { select: { id: true, name: true, riskLevel: true, primaryDiagnosisCode: true, secondaryDiagnoses: true } },
      clinician: { select: { id: true, name: true, role: true } },
      workflow: {
        select: { status: true, signedAt: true, attestedAt: true, signedById: true, signedByName: true, cosignRequired: true },
      },
      claims: {
        select: { id: true, cptCode: true, icd10Codes: true, placeOfService: true, serviceLines: { select: { modifier: true } } },
        take: 5,
      },
      addenda: { select: { reason: true, text: true, createdAt: true }, orderBy: { createdAt: 'asc' }, take: 20 },
    },
  });
  if (!note) return { ok: false, status: 404, error: 'Note not found' };

  const meta = resolveNoteMeta(note);
  const noteType = meta.noteType ? normalizeNoteType(meta.noteType) : null;
  const authorId = note.workflow?.signedById || note.clinician?.id || note.clinicianId || null;
  const dos = meta.dateOfService || note.createdAt.toISOString().slice(0, 10);
  const dosAt = new Date(`${dos}T12:00:00Z`);
  const windowStart = new Date(dosAt.getTime() - 30 * DAY);
  const windowEnd = new Date(dosAt.getTime() + DAY);

  const [settings, plan, license, track, credentials, alerts, flaggedAssessments, activePlans, consent, sensitive, captures, priorNotes, notePolicy] = await Promise.all([
    prisma.practiceSettings
      .findUnique({
        where: { organizationId: input.organizationId },
        select: { noteSignDeadlineHours: true, telehealthModifierDefault: true, timeZone: true, aiNoteConsentRequired: true },
      })
      .catch(() => null),
    checkTreatmentPlanGate({ organizationId: input.organizationId, clientId: note.client.id, noteType, cptCode: meta.cptCode }).catch(() => null),
    authorId ? loadLicenseLevel(input.organizationId, authorId).catch(() => null) : Promise.resolve(null),
    authorId
      ? prisma.supervisionTrack.findFirst({ where: { organizationId: input.organizationId, superviseeId: authorId }, select: { id: true } }).catch(() => null)
      : Promise.resolve(null),
    authorId
      ? prisma.staffCredential
          .findMany({ where: { organizationId: input.organizationId, userId: authorId }, select: { title: true, expiresAt: true }, take: 20 })
          .catch(() => [])
      : Promise.resolve([]),
    prisma.riskAlert
      .findMany({
        where: { clientId: note.client.id, severity: 'HIGH', createdAt: { gte: windowStart, lte: windowEnd } },
        select: { createdAt: true, type: true },
        take: 10,
      })
      .catch(() => []),
    prisma.clinicalAssessmentRecord
      .findMany({
        where: { clientId: note.client.id, organizationId: input.organizationId, safetyFlagged: true, createdAt: { gte: windowStart, lte: windowEnd } },
        select: { instrumentName: true, createdAt: true },
        take: 10,
      })
      .catch(() => []),
    prisma.treatmentPlan
      .findMany({
        where: { organizationId: input.organizationId, clientId: note.client.id, status: { in: ['ACTIVE', 'NEEDS_REVIEW'] } },
        select: { diagnosisCodes: true },
        take: 5,
      })
      .catch(() => []),
    checkAiNoteConsent(input.organizationId, note.client.id).catch(() => ({ status: 'missing' as const, warning: '' })),
    prisma.sensitiveRecord
      .findFirst({ where: { organizationId: input.organizationId, clientId: note.client.id }, select: { noteClassification: true } })
      .catch(() => null),
    // AI Scribe captures linked to this note: transcript risk findings (riskGate.ts)
    prisma.scribeCapture
      .findMany({ where: { organizationId: input.organizationId, progressNoteId: note.id }, select: { riskFindings: true, riskAttestation: true }, take: 10 })
      .catch(() => []),
    // The client's last 3 signed notes: cloned-section check
    prisma.progressNote
      .findMany({
        where: { clientId: note.client.id, id: { not: note.id }, part2: note.part2 ? undefined : false, workflow: { status: { in: ['SIGNED', 'LOCKED'] } } },
        orderBy: [{ dateOfService: 'desc' }, { createdAt: 'desc' }],
        take: 3,
        select: { body: true, noteType: true, dateOfService: true, createdAt: true },
      })
      .catch(() => []),
    prisma.notePolicySettings.findUnique({ where: { organizationId: input.organizationId }, select: { formatElementsEnforceFrom: true } }).catch(() => null),
  ]);

  const riskFlags: string[] = [];
  if (note.client.riskLevel === 'HIGH') riskFlags.push('client risk level is High');
  if (alerts.length) riskFlags.push(`${alerts.length} high-severity risk alert${alerts.length === 1 ? '' : 's'} in the 30 days before the visit`);
  for (const a of flaggedAssessments.slice(0, 3)) riskFlags.push(`safety-flagged ${a.instrumentName} on ${a.createdAt.toISOString().slice(0, 10)}`);
  const transcriptFindings = captures.flatMap((c) => parsePersistedFindings(c.riskFindings));
  riskFlags.push(...riskFlagsFromFindings(transcriptFindings));

  const chartDx = [
    ...(note.client.primaryDiagnosisCode ? [note.client.primaryDiagnosisCode.trim().toUpperCase()] : []),
    ...diagnosisCodesIn(note.client.secondaryDiagnoses || ''),
    ...activePlans.flatMap((p) => p.diagnosisCodes.map((c) => c.trim().toUpperCase())),
  ].filter(Boolean);

  // Addenda are part of the legal record: corrections made after a return count toward the checks.
  const addendaText = note.addenda.map((a) => `Addendum (${a.createdAt.toISOString().slice(0, 10)}, ${a.reason}): ${a.text}`);
  const body = [meta.displayBody, ...addendaText].join('\n\n');

  const templatePart2 = noteType && isTherapyTemplate(noteType) ? THERAPY_TEMPLATES[noteType].part2 : false;
  const part2 = meta.part2 || templatePart2 || isPart2Classification(sensitive?.noteClassification);

  const facts: NoteQualityFacts = {
    mode: input.mode,
    note: {
      id: note.id,
      body,
      noteType,
      dateOfService: meta.dateOfService,
      durationMinutes: meta.durationMinutes,
      cptCode: meta.cptCode,
      placeOfService: meta.placeOfService,
      telehealth: meta.telehealth,
      part2,
      createdAt: note.createdAt.toISOString(),
    },
    author: {
      id: authorId,
      role: note.clinician?.role ?? null,
      onLicensureTrack: Boolean(track),
      licenseLevel: license ? { level: license.level, source: license.source } : null,
      credentials: credentials.map((c) => ({ title: c.title, expiresAt: c.expiresAt.toISOString() })),
    },
    workflow: note.workflow
      ? {
          status: note.workflow.status,
          signedAt: note.workflow.signedAt?.toISOString() ?? null,
          attestedAt: note.workflow.attestedAt?.toISOString() ?? null,
          signedByName: note.workflow.signedByName ?? null,
          cosignRequired: note.workflow.cosignRequired,
        }
      : null,
    claims: note.claims.map((c) => ({
      id: c.id,
      cptCode: c.cptCode,
      icd10Codes: c.icd10Codes,
      placeOfService: c.placeOfService,
      modifiers: c.serviceLines.map((l) => (l.modifier || '').trim()).filter(Boolean).flatMap((m) => m.split(/[\s,:]+/)),
    })),
    chartDiagnosisCodes: [...new Set(chartDx)],
    plan: plan ? { required: plan.required, ok: plan.ok, message: plan.message } : null,
    riskFlags,
    transcriptRisk: transcriptFindings.length ? { findings: transcriptFindings.length, attested: captures.some((c) => Boolean(c.riskAttestation)) } : null,
    priorSignedNotes: priorNotes.map((p) => ({ date: (p.dateOfService ?? p.createdAt).toISOString().slice(0, 10), noteType: p.noteType, body: resolveNoteMeta(p).displayBody })),
    settings: {
      noteSignDeadlineHours: settings?.noteSignDeadlineHours ?? 72,
      telehealthModifierDefault: settings?.telehealthModifierDefault ?? '95',
      timeZone: resolvePracticeTimeZone(settings?.timeZone),
      formatElementsEnforceFrom: notePolicy?.formatElementsEnforceFrom ?? null,
    },
    now: new Date().toISOString(),
  };

  return {
    ok: true,
    ctx: {
      facts,
      names: { client: note.client.name, author: note.workflow?.signedByName || note.clinician?.name || null },
      clientId: note.client.id,
      authorIds: [note.workflow?.signedById, note.clinicianId, note.clinician?.id].filter((v): v is string => Boolean(v)),
      aiGateInput: {
        part2,
        consent: consent.status,
        practiceRequiresConsent: settings?.aiNoteConsentRequired ?? true,
      },
    },
  };
}
