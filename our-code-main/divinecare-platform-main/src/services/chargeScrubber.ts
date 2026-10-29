/**
 * Residential & Crisis Charge Scrubber & Hold Guard
 * Ensures strict revenue protection gates before generating or releasing claims.
 */

export interface PriorAuthInfo {
  remainingUnits: number;
  isActive: boolean;
}

export interface ChargeAuditInput {
  cptCode: string;
  clientId: string;
  dos: Date;
  csrStatus?: 'CURRENT' | 'OVERDUE';
  priorAuth?: PriorAuthInfo | null;
  crisisDocComplete?: boolean;
  crisisNotified?: boolean;
}

export type ChargeScrubberStatus = 'READY' | 'BLOCKED' | 'HELD';

export interface ChargeAuditResult {
  status: ChargeScrubberStatus;
  reason: string | null;
  detail?: string;
}

export async function auditChargeForBilling(charge: ChargeAuditInput): Promise<ChargeAuditResult> {
  // Rule: H0018 / H0019 Per Diems
  if (['H0018', 'H0019'].includes(charge.cptCode)) {
    if (charge.csrStatus === 'OVERDUE') {
      return {
        status: 'BLOCKED',
        reason: 'csr_overdue',
        detail: 'Continued-stay review lapsed. Risk of recoupment.',
      };
    }
    if (!charge.priorAuth || !charge.priorAuth.isActive) {
      return {
        status: 'BLOCKED',
        reason: 'pa_missing',
        detail: 'No active prior authorization.',
      };
    }
    if (charge.priorAuth.remainingUnits <= 0) {
      return {
        status: 'BLOCKED',
        reason: 'pa_exhausted',
        detail: 'PA units exhausted. Concurrent review required.',
      };
    }
  }

  // Rule: H2011 Mobile Crisis
  if (charge.cptCode === 'H2011') {
    if (!charge.crisisDocComplete || !charge.crisisNotified) {
      return {
        status: 'HELD',
        reason: 'doc_incomplete',
        detail: 'Held until clinical note and clinician notification are complete.',
      };
    }
  }

  return { status: 'READY', reason: null };
}
