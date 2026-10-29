/**
 * Safety on a primary care rooming screening. A screening entered by the MA / nurse at rooming with a
 * positive critical item (PHQ-9 item 9 above 0, or any instrument whose scoring flags safety) is filed
 * as its assessment record as soon as it is saved, and raises the SAME HIGH RiskAlert as EHR >
 * Assessments / patient link / paper entry (raiseSessionSafetyAlert -> safetyAlertsFor), once per
 * record. Recipient: the patient's PCP, else the visit's rendering provider, else whoever entered it.
 *
 * The MA sees one fixed prompt only (no score, no interpretation, no extra PHI): minimum necessary.
 */
import { raiseSessionSafetyAlert, sessionScored, type SessionAlertResult } from '@/lib/measures/sessionSafety';
import type { ScoredMeasure } from '@/lib/measures/scoring';
import { ROOMING_SAFETY_PROMPT } from './primaryCareWorkflow';

export { ROOMING_SAFETY_PROMPT };

/** Who receives the rooming safety alert: PCP, else rendering provider, else the person who entered it */
export function roomingSafetyRecipient(input: { pcpUserId?: string | null; renderingProviderId?: string | null; enteredById: string }): string {
  return input.pcpUserId || input.renderingProviderId || input.enteredById;
}

/** The rooming screen as the ScoredMeasure the shared alert helper reads */
export function roomingScored(input: {
  instrumentId: string;
  instrumentName: string;
  category: string;
  answers: Record<string, number>;
  result: { totalScore: number; severity: string; interpretation: string; safetyFlagged?: boolean; safetyNotes?: string | null };
}): ScoredMeasure {
  return sessionScored({ ...input, result: { ...input.result, safetyFlagged: Boolean(input.result.safetyFlagged) } });
}

type AlertDb = Parameters<typeof raiseSessionSafetyAlert>[0];

export async function raiseRoomingSafetyAlert(
  db: AlertDb,
  input: {
    organizationId: string;
    client: { id: string; name: string | null };
    recipientUserId: string;
    actorUserId: string;
    recordId: string;
    scored: ScoredMeasure;
  },
): Promise<SessionAlertResult> {
  return raiseSessionSafetyAlert(db, {
    organizationId: input.organizationId,
    // The shared helper sends to client.assignedToId when set: pass the rooming recipient there
    client: { id: input.client.id, name: input.client.name, assignedToId: input.recipientUserId },
    actorUserId: input.actorUserId,
    recordId: input.recordId,
    scored: input.scored,
  });
}

/** MA prompt for the saved / entered screenings (null when no safety item is positive) */
export function roomingSafetyPrompt(flagCount: number): string | null {
  return flagCount > 0 ? ROOMING_SAFETY_PROMPT : null;
}
