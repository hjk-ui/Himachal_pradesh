/**
 * Estimated revenue per program suggestion, from the organization's fee schedule. Pure.
 * Always labelled an estimate: fee × a typical episode length where one is standard, otherwise the
 * per-unit fee alone. Never used for clinical priority.
 */
import type { RevenueEstimate } from './view';
import type { ProgramKey } from './types';

export type FeeRow = { code: string; baseCpt: string | null; feeCents: number; selfPay: boolean; child: boolean; telehealth: boolean; insuranceBillable: boolean; active: boolean };

export const PROGRAM_REVENUE: Record<ProgramKey, { codes: string[]; units: number | null; basis: string }> = {
  prp: { codes: ['H2017', 'H2018', 'H2016'], units: null, basis: 'Fee per unit — PRP billing unit rule is pending confirmation, so no episode total' },
  tms: { codes: ['90868', '90867'], units: 36, basis: 'Estimate: 36-session acute course (TMS course default) × fee' },
  spravato: { codes: ['G2083', 'G2082'], units: 8, basis: 'Estimate: 8-visit induction (twice weekly × 4 weeks) × visit fee; drug not included' },
  aot: { codes: [], units: null, basis: 'Court-ordered program — no fee estimate' },
  residential: { codes: ['H0018', 'H0019'], units: null, basis: 'Per diem — length of stay varies' },
  iop: { codes: ['H0015', 'S9480'], units: null, basis: 'Per diem — program length varies' },
};

/** Best fee row for a code: active, insurance-billable adult in-person first. */
export function pickFee(fees: FeeRow[], code: string): FeeRow | null {
  const hits = fees.filter((f) => f.active && (f.code.toUpperCase() === code || (f.baseCpt ?? '').toUpperCase() === code));
  if (!hits.length) return null;
  const rank = (f: FeeRow) => (f.insuranceBillable ? 0 : 4) + (f.selfPay ? 2 : 0) + (f.child ? 1 : 0) + (f.telehealth ? 1 : 0);
  return [...hits].sort((a, b) => rank(a) - rank(b))[0];
}

export function revenueEstimate(program: ProgramKey, fees: FeeRow[]): RevenueEstimate {
  const cfg = PROGRAM_REVENUE[program];
  for (const code of cfg.codes) {
    const fee = pickFee(fees, code);
    if (fee) {
      return {
        code,
        feeCents: fee.feeCents,
        units: cfg.units,
        estimateCents: cfg.units !== null ? fee.feeCents * cfg.units : null,
        basis: cfg.basis,
      };
    }
  }
  return {
    code: null,
    feeCents: null,
    units: cfg.units,
    estimateCents: null,
    basis: cfg.codes.length ? `No fee schedule entry for ${cfg.codes.join(' / ')}` : cfg.basis,
  };
}
