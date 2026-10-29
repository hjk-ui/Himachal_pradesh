/**
 * Risk language watch: hook-ins for the write paths (server only). Each wrapper is best-effort:
 * it never throws into the caller, so a watch failure can never block a patient message or a
 * note signature. Wired from:
 *   - src/patient/application/messages/service.ts (patient portal messages)
 *   - src/app/api/notes/[id]/route.ts, src/app/api/ehr/notes/[id]/workflow/route.ts (sign)
 *   - src/app/api/clients/[id]/notes/route.ts (note saved)
 *   - src/app/api/sdoh/screenings/route.ts (SDOH screening free-text notes)
 */
import type { Role } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { BEDROCK_MODELS, invokeBedrock, isBedrockConfigured } from '@/lib/ai/bedrockService';
import { checkAiNoteConsent } from '@/lib/ai/noteDraftSafety';
import { lockedSensitiveClientIds } from '@/lib/privacy/sensitiveAccess';
import { resolveNoteMeta } from '@/lib/clients/notes';
import { runRiskWatch, type RiskWatchDb, type RiskWatchDeps, type RiskWatchResult } from './service';
import { scanRiskText } from './engine';
import { patientSafetyPayload, type PatientSafetyPayload } from './crisisResources';

export function defaultRiskWatchDeps(): RiskWatchDeps {
  return {
    db: prisma as unknown as RiskWatchDb,
    audit: writeAuditLog,
    invoke: isBedrockConfigured()
      ? ({ system, userPrompt }) => invokeBedrock({ model: 'HAIKU', system, userPrompt, jsonMode: true, maxTokens: 400, temperature: 0 })
      : null,
    model: BEDROCK_MODELS.HAIKU,
    aiConsent: async (organizationId, clientId) =>
      (await checkAiNoteConsent(organizationId, clientId)).status === 'declined' ? 'declined' : 'allowed',
    isProtectedClient: async (organizationId, clientId) =>
      Boolean(await prisma.sensitiveRecord.findFirst({ where: { organizationId, clientId }, select: { id: true } })),
    lockedUsers: async (organizationId, clientId, users) => {
      const locked = new Set<string>();
      if (!users.length) return locked;
      const rows = await prisma.user.findMany({ where: { id: { in: users.map((u) => u.id) } }, select: { id: true, role: true } });
      for (const u of users) {
        const role = rows.find((r) => r.id === u.id)?.role;
        try {
          const ids = await lockedSensitiveClientIds({ organizationId, userId: u.id, role: role ?? 'CLINICIAN', clientIds: [clientId] });
          if (ids.has(clientId)) locked.add(u.id);
        } catch {
          locked.add(u.id); // fail closed
        }
      }
      return locked;
    },
  };
}

export type RiskWatchSummary = Pick<RiskWatchResult, 'severity' | 'action' | 'alertId'>;

function summary(r: RiskWatchResult): RiskWatchSummary | null {
  return r.severity || r.action !== 'none' ? { severity: r.severity, action: r.action, alertId: r.alertId } : null;
}

function logFailure(where: string, err: unknown) {
  console.error(`[risk-watch] ${where} failed`, err instanceof Error ? err.name : 'unknown');
}

/**
 * Patient portal message (PATIENT sender). Returns the crisis-resource payload for the portal
 * response when the message flags HIGH/MEDIUM. If the database step fails, the rule result alone
 * still decides the payload, so the patient always sees resources for a HIGH phrase.
 */
export async function watchPatientMessage(input: {
  organizationId: string;
  clientId: string;
  threadId: string;
  messageId: string;
  text: string;
  deps?: RiskWatchDeps;
}): Promise<PatientSafetyPayload | null> {
  try {
    const res = await runRiskWatch(
      {
        organizationId: input.organizationId,
        clientId: input.clientId,
        text: input.text,
        source: { kind: 'message', threadId: input.threadId, messageId: input.messageId },
        actor: { userId: null, role: 'client' },
      },
      input.deps ?? defaultRiskWatchDeps()
    );
    return res.patientSafety;
  } catch (err) {
    logFailure('patient message', err);
    const sev = scanRiskText(input.text, 'patient_message').severity;
    return sev === 'high' || sev === 'medium' ? patientSafetyPayload(sev) : null;
  }
}

/** Progress / structured note when it is saved (created) or signed. */
export async function watchProgressNote(input: {
  noteId: string;
  organizationId: string;
  actorUserId: string;
  actorRole: Role | string;
  deps?: RiskWatchDeps;
}): Promise<RiskWatchSummary | null> {
  try {
    const note = await prisma.progressNote.findUnique({
      where: { id: input.noteId },
      select: { id: true, clientId: true, body: true, part2: true, noteType: true, cptCode: true, dateOfService: true, durationMinutes: true, placeOfService: true, telehealth: true, aiDrafted: true },
    });
    if (!note?.body) return null;
    const meta = resolveNoteMeta(note);
    const res = await runRiskWatch(
      {
        organizationId: input.organizationId,
        clientId: note.clientId,
        text: meta.displayBody,
        source: { kind: 'note', noteId: note.id },
        part2: meta.part2,
        actor: { userId: input.actorUserId, role: String(input.actorRole) },
      },
      input.deps ?? defaultRiskWatchDeps()
    );
    return summary(res);
  } catch (err) {
    logFailure('note', err);
    return null;
  }
}

/** SDOH screening free-text notes (staff-entered). */
export async function watchSdohNotes(input: {
  organizationId: string;
  clientId: string;
  screeningId: string;
  notes: string | null | undefined;
  actorUserId: string;
  actorRole: Role | string;
  deps?: RiskWatchDeps;
}): Promise<RiskWatchSummary | null> {
  if (!input.notes?.trim()) return null;
  try {
    const res = await runRiskWatch(
      {
        organizationId: input.organizationId,
        clientId: input.clientId,
        text: input.notes,
        source: { kind: 'sdoh', screeningId: input.screeningId },
        actor: { userId: input.actorUserId, role: String(input.actorRole) },
      },
      input.deps ?? defaultRiskWatchDeps()
    );
    return summary(res);
  } catch (err) {
    logFailure('sdoh', err);
    return null;
  }
}
