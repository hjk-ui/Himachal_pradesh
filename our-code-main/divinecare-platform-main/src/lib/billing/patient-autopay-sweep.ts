import {
  assertPatientPaymentsAllowed,
  patientPaymentsLiveApproved,
} from '@/lib/billing/patient-payments-gate';
import { stripeKeyMode } from '@/lib/stripe/config';
import { prisma } from '@/lib/db/prisma';

export type AutopaySweepAttempt = {
  id: string;
  enrollmentId: string;
  clientId: string;
  organizationId: string;
  amountCents: number;
  periodKey: string;
  status: 'draft' | 'attempted' | 'succeeded' | 'failed' | 'skipped';
  reason?: string;
  mode: 'test' | 'live' | 'stub' | 'unconfigured';
  createdAt: string;
  updatedAt: string;
};

export function periodKeyFor(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function attemptIdempotencyKey(enrollmentId: string, periodKey: string) {
  return `${enrollmentId}:${periodKey}`;
}

/**
 * Pure gate check used by unit tests and the sweep job.
 * Live Stripe keys require PATIENT_PAYMENTS_LIVE_APPROVED=true.
 */
export function evaluateAutopaySweepGate(env: NodeJS.ProcessEnv = process.env): {
  allowed: boolean;
  mode: 'test' | 'live' | 'stub' | 'unconfigured';
  error?: string;
} {
  const prev = process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
  if (env !== process.env && 'PATIENT_PAYMENTS_LIVE_APPROVED' in env) {
    process.env.PATIENT_PAYMENTS_LIVE_APPROVED = env.PATIENT_PAYMENTS_LIVE_APPROVED;
  }
  try {
    const gate = assertPatientPaymentsAllowed();
    if (gate.ok === false) {
      return { allowed: false, mode: 'live', error: gate.error };
    }
    return { allowed: true, mode: gate.mode };
  } finally {
    if (env !== process.env) {
      if (prev === undefined) delete process.env.PATIENT_PAYMENTS_LIVE_APPROVED;
      else process.env.PATIENT_PAYMENTS_LIVE_APPROVED = prev;
    }
  }
}

/**
 * Select active enrollments and create draft/attempt rows (idempotent via unique enrollmentId+periodKey).
 * Does not call Stripe live without approval. Test/stub modes create safe drafts.
 */
export async function runPatientAutopaySweep(options?: {
  organizationId?: string;
  amountCents?: number;
  asOf?: Date;
  dryRun?: boolean;
}): Promise<{
  ok: boolean;
  mode: string;
  processed: number;
  created: number;
  skipped: number;
  failed: number;
  error?: string;
  attempts: AutopaySweepAttempt[];
}> {
  const gate = evaluateAutopaySweepGate();
  if (!gate.allowed) {
    return {
      ok: false,
      mode: gate.mode,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      error: gate.error,
      attempts: [],
    };
  }

  const periodKey = periodKeyFor(options?.asOf || new Date());
  const amountCents = options?.amountCents ?? 2500;
  const where = options?.organizationId
    ? { organizationId: options.organizationId, active: true }
    : { active: true };

  let enrollments: Array<{
    id: string;
    clientId: string;
    organizationId: string;
    last4: string | null;
  }> = [];
  try {
    enrollments = await prisma.autopayEnrollment.findMany({
      where,
      select: { id: true, clientId: true, organizationId: true, last4: true },
      take: 500,
    });
  } catch (err) {
    console.error('[patient-autopay-sweep] enrollment query failed', err);
    return {
      ok: false,
      mode: gate.mode,
      processed: 0,
      created: 0,
      skipped: 0,
      failed: 0,
      error: 'Autopay enrollment table unavailable',
      attempts: [],
    };
  }

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const allAttempts: AutopaySweepAttempt[] = [];

  for (const row of enrollments) {
    const existing = await prisma.autopaySweepAttempt
      .findUnique({
        where: { enrollmentId_periodKey: { enrollmentId: row.id, periodKey } },
      })
      .catch(() => null);

    if (existing) {
      skipped += 1;
      continue;
    }

    let status: AutopaySweepAttempt['status'] = options?.dryRun
      ? 'draft'
      : gate.mode === 'live'
        ? 'attempted'
        : 'draft';
    let reason =
      gate.mode === 'live'
        ? 'Live charge attempt recorded (Stripe capture deferred to payment processor)'
        : 'Test/stub draft — safe, no live charge';

    if (stripeKeyMode() === 'live' && !patientPaymentsLiveApproved()) {
      status = 'failed';
      reason = 'Live keys refused without PATIENT_PAYMENTS_LIVE_APPROVED';
      failed += 1;
    } else {
      created += 1;
    }

    if (options?.dryRun) {
      allAttempts.push({
        id: attemptIdempotencyKey(row.id, periodKey),
        enrollmentId: row.id,
        clientId: row.clientId,
        organizationId: row.organizationId,
        amountCents,
        periodKey,
        status,
        mode: gate.mode,
        reason,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      continue;
    }

    try {
      const saved = await prisma.autopaySweepAttempt.create({
        data: {
          organizationId: row.organizationId,
          enrollmentId: row.id,
          clientId: row.clientId,
          periodKey,
          amountCents,
          status,
          mode: gate.mode,
          reason,
        },
      });
      allAttempts.push({
        id: saved.id,
        enrollmentId: saved.enrollmentId,
        clientId: saved.clientId,
        organizationId: saved.organizationId,
        amountCents: saved.amountCents,
        periodKey: saved.periodKey,
        status: saved.status as AutopaySweepAttempt['status'],
        mode: saved.mode as AutopaySweepAttempt['mode'],
        reason: saved.reason || undefined,
        createdAt: saved.createdAt.toISOString(),
        updatedAt: saved.updatedAt.toISOString(),
      });
    } catch (err) {
      // Unique race → treat as skip (idempotent)
      skipped += 1;
      created = Math.max(0, created - 1);
      console.warn('[patient-autopay-sweep] duplicate skipped', row.id, periodKey, err);
    }
  }

  console.log(
    `[patient-autopay-sweep] mode=${gate.mode} processed=${enrollments.length} created=${created} skipped=${skipped} failed=${failed}`
  );

  return {
    ok: true,
    mode: gate.mode,
    processed: enrollments.length,
    created,
    skipped,
    failed,
    attempts: allAttempts,
  };
}
