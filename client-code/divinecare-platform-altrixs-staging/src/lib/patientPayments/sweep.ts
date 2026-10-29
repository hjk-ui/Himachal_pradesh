/**
 * Nightly AutoPay catch-up (scripts/patient-autopay-sweep.ts). A visit status change or an ERA posting
 * normally triggers the charge at once; this sweep finds the ones that slipped (process restart, a
 * path without the trigger, a card authorized later the same day) and runs them through the SAME rules.
 *
 * Candidates (from the finder, last N days, default 14): completed / no-show / late-cancel visits and
 * posted ERA claim payments with patient responsibility, for clients with an active AutoPay enrollment
 * and a saved card, that have no PatientCharge row yet. Dry run unless apply: the dry run reports what
 * would happen and writes nothing. Counts only in the output (no PHI).
 */
import { chargeAfterEra, chargeForVisit, previewCharge } from './service';
import type { ServiceDeps } from './types';

export const SWEEP_DEFAULT_DAYS = 14;

export type SweepFinder = {
  visits(organizationId: string, since: Date): Promise<string[]>;
  eras(organizationId: string, since: Date): Promise<string[]>;
};

export type SweepCounts = {
  organizationId: string;
  apply: boolean;
  visits: number;
  eras: number;
  charge: number;
  hold: number;
  skipRecorded: number;
  skipNoRow: number;
  duplicate: number;
  notApplicable: number;
  errors: number;
  skipReasons: Record<string, number>;
};

export async function sweepPatientAutopay(
  deps: ServiceDeps,
  finder: SweepFinder,
  input: { organizationId: string; apply: boolean; days?: number }
): Promise<SweepCounts> {
  const days = Math.max(1, Math.min(60, Math.trunc(input.days ?? SWEEP_DEFAULT_DAYS)));
  const since = new Date(deps.now().getTime() - days * 86_400_000);
  const c: SweepCounts = { organizationId: input.organizationId, apply: input.apply, visits: 0, eras: 0, charge: 0, hold: 0, skipRecorded: 0, skipNoRow: 0, duplicate: 0, notApplicable: 0, errors: 0, skipReasons: {} };
  const settings = await deps.store.settings(input.organizationId);
  if (!settings.enabled) return c;
  const [visits, eras] = await Promise.all([finder.visits(input.organizationId, since), finder.eras(input.organizationId, since)]);
  c.visits = visits.length;
  c.eras = eras.length;
  const skip = (reason: string, recorded: boolean) => {
    if (recorded) c.skipRecorded += 1;
    else c.skipNoRow += 1;
    c.skipReasons[reason] = (c.skipReasons[reason] ?? 0) + 1;
  };
  const targets: ({ appointmentId: string } | { eraClaimId: string })[] = [...visits.map((appointmentId) => ({ appointmentId })), ...eras.map((eraClaimId) => ({ eraClaimId }))];
  for (const t of targets) {
    try {
      if (!input.apply) {
        const p = await previewCharge(deps, t);
        if (p.outcome === 'charge') c.charge += 1;
        else if (p.outcome === 'hold') c.hold += 1;
        else if (p.outcome === 'skip') skip(p.reason ?? 'unknown', p.recorded);
        else if (p.outcome === 'duplicate') c.duplicate += 1;
        else c.notApplicable += 1;
        continue;
      }
      const actor = { userId: null, role: 'system:autopay-sweep' };
      const r = 'appointmentId' in t ? await chargeForVisit(deps, t.appointmentId, actor) : await chargeAfterEra(deps, t.eraClaimId, actor);
      if (r.outcome === 'attempted') c.charge += 1;
      else if (r.outcome === 'held') c.hold += 1;
      else if (r.outcome === 'skipped') skip(r.reason, Boolean(r.charge));
      else if (r.outcome === 'duplicate') c.duplicate += 1;
      else c.notApplicable += 1;
    } catch {
      c.errors += 1;
    }
  }
  await deps
    .audit({
      action: input.apply ? 'patient_autopay_sweep' : 'patient_autopay_sweep_dry_run',
      actorUserId: null,
      actorRole: 'system',
      organizationId: input.organizationId,
      resourceType: 'PatientCharge',
      resourceId: 'autopay-sweep',
      metadata: { days, visits: c.visits, eras: c.eras, charge: c.charge, hold: c.hold, skipRecorded: c.skipRecorded, skipNoRow: c.skipNoRow, duplicate: c.duplicate, errors: c.errors },
    })
    .catch(() => {});
  return c;
}
