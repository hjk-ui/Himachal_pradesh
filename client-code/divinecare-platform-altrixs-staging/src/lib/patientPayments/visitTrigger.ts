/**
 * THE AutoPay trigger for visit status changes. Every code path that sets an appointment to COMPLETED,
 * NO_SHOW or LATE_CANCEL calls triggerAutopayAfterVisitStatus() right after the write
 * (tests/patient-autopay.test.ts scans the source for writers that do not).
 *
 * Background and never throws: a charge problem never blocks a visit update. Idempotent: the service
 * keys every charge on visit + type, so a second call (or the nightly sweep) never charges twice. The
 * service re-reads the appointment, so a stale or missing status here is harmless.
 * No server-only imports at load time: lib code and tests can import this file.
 */
import type { Actor } from './types';

export const AUTOPAY_VISIT_STATUSES = ['COMPLETED', 'NO_SHOW', 'LATE_CANCEL'] as const;

export function isAutopayVisitStatus(status: unknown): boolean {
  return typeof status === 'string' && (AUTOPAY_VISIT_STATUSES as readonly string[]).includes(status.toUpperCase().replace(/-/g, '_'));
}

type Runner = (appointmentId: string, actor?: Actor) => Promise<unknown>;

const defaultRunner: Runner = (appointmentId, actor) => import('./server').then((m) => m.runAutopayForVisit(appointmentId, actor));
let runner: Runner = defaultRunner;

/** Tests only: replace the background runner (null restores the real one). */
export function setAutopayVisitRunner(r: Runner | null) {
  runner = r ?? defaultRunner;
}

/**
 * Call after a visit status write. With a status, only COMPLETED / NO_SHOW / LATE_CANCEL run; with no
 * status (e.g. a telehealth session linked to an appointment) the service decides from the current row.
 */
export function triggerAutopayAfterVisitStatus(appointmentId: string | null | undefined, status?: string | null, actor?: Actor): Promise<void> {
  if (!appointmentId) return Promise.resolve();
  if (status != null && !isAutopayVisitStatus(status)) return Promise.resolve();
  return runner(appointmentId, actor).then(
    () => undefined,
    () => undefined
  );
}
