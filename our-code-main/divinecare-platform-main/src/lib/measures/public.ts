import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  answersHaveCrisis,
  getPatientInstrument,
  scorePatientAnswers,
  validateAnswers,
  type PatientInstrument,
} from './instruments';

/** Patient-facing questionnaire flow (token → DOB gate → answer → complete). No staff auth. */

export const MAX_DOB_ATTEMPTS = 3;

export type PublicView =
  | { state: 'invalid' }
  | { state: 'expired' }
  | { state: 'locked' }
  | { state: 'verify'; practiceName: string; attemptsLeft: number }
  | {
      state: 'questions';
      practiceName: string;
      instrument: PatientInstrument;
      answers: Record<string, number>;
      crisis: boolean;
    }
  | { state: 'completed'; crisis: boolean };

type StoredAnswers = {
  answers?: Record<string, number>;
  totalScore?: number;
  severity?: string;
  crisis?: boolean;
};

/** Pure: does the typed date match the stored date of birth (calendar-date compare, UTC)? */
export function dobMatches(stored: Date | null | undefined, input: unknown): boolean {
  if (!stored || typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return false;
  return stored.toISOString().slice(0, 10) === input;
}

const requestSelect = {
  id: true,
  clientId: true,
  organizationId: true,
  instrumentKey: true,
  status: true,
  dobAttempts: true,
  answers: true,
  expiresAt: true,
  organization: { select: { name: true } },
  client: { select: { dateOfBirth: true, assignedToId: true } },
} satisfies Prisma.MeasureRequestSelect;

type RequestRow = Prisma.MeasureRequestGetPayload<{ select: typeof requestSelect }>;

export async function findRequestByHash(tokenHash: string): Promise<RequestRow | null> {
  return prisma.measureRequest.findUnique({ where: { tokenHash }, select: requestSelect });
}

function terminalState(row: RequestRow, now: Date): 'expired' | 'locked' | null {
  if (row.status === 'locked') return 'locked';
  if (row.status === 'expired') return 'expired';
  if (row.status !== 'completed' && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return null;
}

/** Marks lapsed links expired (idempotent). */
async function persistExpiry(row: RequestRow, now: Date) {
  if (row.status !== 'completed' && row.status !== 'expired' && row.expiresAt.getTime() <= now.getTime()) {
    await prisma.measureRequest.updateMany({
      where: { id: row.id, status: { in: ['pending', 'in_progress'] } },
      data: { status: 'expired' },
    });
  }
}

export async function buildPublicView(row: RequestRow | null, verified: boolean, now = new Date()): Promise<PublicView> {
  if (!row) return { state: 'invalid' };
  const terminal = terminalState(row, now);
  if (terminal) {
    await persistExpiry(row, now);
    return { state: terminal };
  }
  const stored = (row.answers ?? {}) as StoredAnswers;
  if (row.status === 'completed') {
    return { state: 'completed', crisis: verified ? Boolean(stored.crisis) : false };
  }
  const practiceName = row.organization.name;
  if (!verified) {
    return { state: 'verify', practiceName, attemptsLeft: Math.max(0, MAX_DOB_ATTEMPTS - row.dobAttempts) };
  }
  const instrument = getPatientInstrument(row.instrumentKey);
  if (!instrument) return { state: 'invalid' };
  const answers = stored.answers ?? {};
  return { state: 'questions', practiceName, instrument, answers, crisis: answersHaveCrisis(instrument, answers) };
}

export type VerifyOutcome =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'wrong_dob'; attemptsLeft?: number };

/** DOB gate: 3 tries, then the link locks. */
export async function verifyDob(row: RequestRow | null, dob: unknown, now = new Date()): Promise<VerifyOutcome> {
  if (!row) return { ok: false, reason: 'invalid' };
  const terminal = terminalState(row, now);
  if (terminal) {
    await persistExpiry(row, now);
    return { ok: false, reason: terminal };
  }
  // Claim an attempt atomically first so parallel guesses cannot exceed the limit.
  const claimed = await prisma.measureRequest.updateMany({
    where: { id: row.id, dobAttempts: { lt: MAX_DOB_ATTEMPTS }, status: { in: ['pending', 'in_progress'] } },
    data: { dobAttempts: { increment: 1 } },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'locked' };

  if (dobMatches(row.client.dateOfBirth, dob)) {
    await prisma.measureRequest.update({ where: { id: row.id }, data: { dobAttempts: { decrement: 1 } } });
    return { ok: true };
  }

  const after = await prisma.measureRequest.findUnique({ where: { id: row.id }, select: { dobAttempts: true } });
  const used = after?.dobAttempts ?? MAX_DOB_ATTEMPTS;
  if (used >= MAX_DOB_ATTEMPTS) {
    await prisma.measureRequest.updateMany({
      where: { id: row.id, status: { in: ['pending', 'in_progress'] } },
      data: { status: 'locked' },
    });
    return { ok: false, reason: 'locked' };
  }
  return { ok: false, reason: 'wrong_dob', attemptsLeft: MAX_DOB_ATTEMPTS - used };
}

export type SaveOutcome =
  | { ok: true; completed: boolean; crisis: boolean }
  | { ok: false; reason: 'invalid' | 'expired' | 'locked' | 'bad_answers' | 'already_completed'; message?: string };

/** Save progress, or complete (every item answered). Caller has already verified the DOB session. */
export async function saveAnswers(
  row: RequestRow | null,
  rawAnswers: unknown,
  complete: boolean,
  now = new Date()
): Promise<SaveOutcome> {
  if (!row) return { ok: false, reason: 'invalid' };
  const terminal = terminalState(row, now);
  if (terminal) {
    await persistExpiry(row, now);
    return { ok: false, reason: terminal };
  }
  if (row.status === 'completed') return { ok: false, reason: 'already_completed' };

  const instrument = getPatientInstrument(row.instrumentKey);
  if (!instrument) return { ok: false, reason: 'invalid' };
  const checked = validateAnswers(instrument, rawAnswers, { complete });
  if (checked.ok === false) return { ok: false, reason: 'bad_answers', message: checked.error };

  const crisis = answersHaveCrisis(instrument, checked.answers);

  if (!complete) {
    await prisma.measureRequest.update({
      where: { id: row.id },
      data: { status: 'in_progress', answers: { answers: checked.answers } satisfies StoredAnswers },
    });
    return { ok: true, completed: false, crisis };
  }

  const score = scorePatientAnswers(row.instrumentKey, checked.answers);
  const claimed = await prisma.measureRequest.updateMany({
    where: { id: row.id, status: { in: ['pending', 'in_progress'] } },
    data: {
      status: 'completed',
      completedAt: now,
      answers: {
        answers: checked.answers,
        totalScore: score?.totalScore,
        severity: score?.severity,
        crisis: Boolean(score?.crisis || crisis),
      } satisfies StoredAnswers,
    },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'already_completed' };

  const isCrisis = Boolean(score?.crisis || crisis);
  if (isCrisis) await raiseCrisisAlert(row);
  return { ok: true, completed: true, crisis: isCrisis };
}

/** Staff-visible alert so a safety answer is never only on the patient's screen. */
async function raiseCrisisAlert(row: RequestRow) {
  try {
    await prisma.riskAlert.create({
      data: {
        clientId: row.clientId,
        organizationId: row.organizationId,
        clinicianId: row.client.assignedToId,
        type: 'crisis_keywords',
        severity: 'HIGH',
        description: 'Patient questionnaire: a safety item was answered above zero. Clinician review required.',
        source: 'assessment',
        sourceId: row.id,
      },
    });
  } catch (err) {
    console.error('[measures crisis alert]', err instanceof Error ? err.message : 'failed');
  }
}
