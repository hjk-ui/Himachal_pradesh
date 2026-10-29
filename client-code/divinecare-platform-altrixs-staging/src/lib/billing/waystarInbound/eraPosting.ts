/**
 * 835 posting decisions — pure (no DB) so the rules are unit-tested.
 *
 * planEraClaimPosting() decides, for one CLP (835 loop 2100, X221A1), whether it can be posted
 * automatically or must go to the ERA review queue, and what posting means:
 *   - outcome: paid | partial | denied | patient_responsibility | reversal | forwarded | negative
 *   - claim status: PAID (paid, partial, patient responsibility) or DENIED. There is no PARTIAL
 *     ClaimStatus value; a partial payment is PAID with outcome 'partial' plus OPEN denial rows
 *     for the unpaid lines.
 *   - denial records (ClaimDenial reasonCode "CO-50", carcCode "50") with CARC/RARC text
 *
 * Auto-post only when every check passes; any failed check is a review reason.
 */
import { createHash } from 'node:crypto';
import { CARC, CAS_GROUP, CLP_STATUS, RARC } from './codes';
import { allAdjustments, type CasAdjustment, type EraClaim } from './parse835';

export type MatchKind = 'control_number' | 'claim_id' | 'prefix' | 'none' | 'ambiguous';

export type ClaimSnapshot = {
  id: string;
  organizationId: string;
  clientId: string;
  status: string;
  /** Billed total in dollars (service lines, else amountCents / 100) */
  chargeTotal: number;
  serviceLines: Array<{ id: string; cptCode: string; modifier: string | null; totalCharge: number }>;
  /** Another ERA claim payment was already posted to this claim */
  previouslyPosted: boolean;
};

export type PlanInput = {
  era: EraClaim;
  match: MatchKind;
  claim: ClaimSnapshot | null;
  /** The 835 transaction (BPR vs CLP/PLB) and this claim's CAS arithmetic balance */
  remitBalanced: boolean;
  claimBalanced: boolean;
  /** Same TRN02 + CLP01 + CLP07 already stored from another file */
  duplicate: boolean;
};

export type Outcome = 'paid' | 'partial' | 'denied' | 'patient_responsibility' | 'reversal' | 'forwarded' | 'negative';

export type DenialPlan = { reasonCode: string; carcCode: string; reasonText: string; lineSeq: number | null };

export type PostingPlan = {
  decision: 'auto' | 'review';
  reasons: string[];
  outcome: Outcome;
  nextStatus: 'PAID' | 'DENIED' | null;
  paidCents: number;
  patientResponsibility: number;
  /** Non-PR adjustments (contractual / denied amounts), claim + lines */
  adjustmentTotal: number;
  denials: DenialPlan[];
  /** ERA line seq -> ClaimServiceLine id (null when no line matched) */
  lineMatches: Array<{ eraLineSeq: number; serviceLineId: string | null }>;
  summary: string;
};

const POSTABLE_CLAIM_STATUSES = new Set(['SUBMITTED', 'ACCEPTED']);
const PROCESSED = new Set(['1', '2', '3', '19', '20', '21']);

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function adjustmentText(a: Pick<CasAdjustment, 'group' | 'carc'>): string {
  const text = CARC[a.carc];
  return `${a.group}-${a.carc}${text ? ` ${text}` : ''}`;
}

export function remarkText(code: string): string {
  return RARC[code] ? `${code} ${RARC[code]}` : code;
}

export function classifyOutcome(era: EraClaim): Outcome {
  if (era.statusCode === '22') return 'reversal';
  if (era.statusCode === '23' || era.statusCode === '25') return 'forwarded';
  if (era.paid < 0) return 'negative';
  if (era.statusCode === '4') return 'denied';
  if (era.paid > 0) {
    const unpaidLine = era.lines.some((l) => l.charge > 0 && l.paid === 0 && l.adjustments.some((a) => a.group !== 'PR'));
    return unpaidLine ? 'partial' : 'paid';
  }
  return era.patientResponsibility > 0 ? 'patient_responsibility' : 'denied';
}

/** Denial records for a denied claim (one, claim-level) or a partial payment (one per unpaid line). */
export function denialsFor(era: EraClaim, outcome: Outcome): DenialPlan[] {
  const build = (adjs: CasAdjustment[], remarks: string[], lineSeq: number | null): DenialPlan | null => {
    const nonPr = adjs.filter((a) => a.group !== 'PR' && a.amount !== 0).sort((x, y) => y.amount - x.amount);
    const primary = nonPr[0] || adjs[0];
    if (!primary && !remarks.length) return null;
    const parts = [
      ...(nonPr.length ? nonPr : adjs).map((a) => `${adjustmentText(a)} ($${a.amount.toFixed(2)})`),
      ...remarks.map((r) => `RARC ${remarkText(r)}`),
    ];
    return {
      reasonCode: primary ? `${primary.group}-${primary.carc}` : 'CO-16',
      carcCode: primary?.carc || '',
      reasonText: `${lineSeq ? `Line ${lineSeq}: ` : ''}${parts.join('; ')}`.slice(0, 1000),
      lineSeq,
    };
  };
  if (outcome === 'denied') {
    const d = build(
      [...era.claimAdjustments, ...era.lines.flatMap((l) => l.adjustments)],
      [...era.claimRemarks, ...era.lines.flatMap((l) => l.remarks)],
      null
    );
    return d ? [d] : [{ reasonCode: 'CO-16', carcCode: '', reasonText: `Denied by payer (CLP02 ${era.statusCode})`, lineSeq: null }];
  }
  if (outcome === 'partial') {
    return era.lines
      .filter((l) => l.charge > 0 && l.paid === 0)
      .map((l) => build(l.adjustments, l.remarks, l.seq))
      .filter((d): d is DenialPlan => d !== null);
  }
  return [];
}

/** Matches ERA lines to claim service lines by procedure (+ first modifier), in order. */
export function matchLines(era: EraClaim, claim: ClaimSnapshot | null) {
  const pool = [...(claim?.serviceLines || [])];
  return era.lines.map((l) => {
    const proc = (l.originalProcedure || l.procedureCode).toUpperCase();
    let idx = pool.findIndex((s) => s.cptCode.toUpperCase() === proc && (s.modifier || '') === (l.modifiers[0] || ''));
    if (idx < 0) idx = pool.findIndex((s) => s.cptCode.toUpperCase() === proc);
    const hit = idx >= 0 ? pool.splice(idx, 1)[0] : null;
    return { eraLineSeq: l.seq, serviceLineId: hit?.id ?? null };
  });
}

export function planEraClaimPosting(input: PlanInput): PostingPlan {
  const { era, claim } = input;
  const reasons: string[] = [];
  const outcome = classifyOutcome(era);
  const adjustmentTotal = round2(allAdjustments(era).filter((a) => a.group !== 'PR').reduce((t, a) => t + a.amount, 0));

  if (!era.patientControlNumber) reasons.push('CLP01 (claim control number) is empty');
  if (input.match === 'none') reasons.push(`No claim matches CLP01 ${era.patientControlNumber}`);
  if (input.match === 'ambiguous') reasons.push(`CLP01 ${era.patientControlNumber} matches more than one claim`);
  if (input.duplicate) reasons.push('Same check/EFT trace and claim already received in another 835 (duplicate remittance)');
  if (!input.remitBalanced) reasons.push('835 payment does not balance (BPR02 vs claim payments and PLB)');
  if (!input.claimBalanced) reasons.push('Claim adjustments do not balance (charge - paid != CAS total)');
  if (outcome === 'reversal') reasons.push('Payer reversal of a previous payment (CLP02 22); post the take-back manually');
  if (outcome === 'forwarded') reasons.push(`${CLP_STATUS[era.statusCode] || `CLP02 ${era.statusCode}`}; nothing to post`);
  if (outcome === 'negative') reasons.push('Negative claim payment');
  if (!PROCESSED.has(era.statusCode) && era.statusCode !== '4' && outcome !== 'reversal' && outcome !== 'forwarded') {
    reasons.push(`Unrecognized claim status CLP02 ${era.statusCode || '(empty)'}`);
  }
  if (claim) {
    if (!POSTABLE_CLAIM_STATUSES.has(claim.status)) reasons.push(`Claim is ${claim.status}; only SUBMITTED / ACCEPTED claims auto-post`);
    if (claim.previouslyPosted) reasons.push('Another remittance was already posted to this claim');
    if (Math.abs(claim.chargeTotal - era.charge) >= 0.005) {
      reasons.push(`Charge mismatch: claim billed $${claim.chargeTotal.toFixed(2)}, 835 shows $${era.charge.toFixed(2)}`);
    }
  }

  const nextStatus: PostingPlan['nextStatus'] =
    outcome === 'denied' ? 'DENIED' : outcome === 'paid' || outcome === 'partial' || outcome === 'patient_responsibility' ? 'PAID' : null;
  const denials = denialsFor(era, outcome);
  const lineMatches = matchLines(era, claim);
  const summaryParts = [
    `${CLP_STATUS[era.statusCode] || `CLP02 ${era.statusCode}`}`,
    `billed $${era.charge.toFixed(2)}`,
    `paid $${era.paid.toFixed(2)}`,
    `patient responsibility $${era.patientResponsibility.toFixed(2)}`,
  ];
  if (adjustmentTotal) summaryParts.push(`adjusted $${adjustmentTotal.toFixed(2)}`);
  if (denials.length) summaryParts.push(denials.map((d) => d.reasonCode).join(', '));

  return {
    decision: reasons.length ? 'review' : 'auto',
    reasons,
    outcome,
    nextStatus,
    paidCents: Math.round(era.paid * 100),
    patientResponsibility: era.patientResponsibility,
    adjustmentTotal,
    denials,
    lineMatches,
    summary: summaryParts.join(' · '),
  };
}

/** Readable list of CAS rows, e.g. for the review queue. */
export function describeAdjustments(adjs: CasAdjustment[]): string[] {
  return adjs.map((a) => `${CAS_GROUP[a.group] ? `${a.group} (${CAS_GROUP[a.group]})` : a.group} ${a.carc}${CARC[a.carc] ? ` ${CARC[a.carc]}` : ''}: $${a.amount.toFixed(2)}`);
}

// ─── Remittance identity, crossover, accumulation, PLB (pure) ─────────────────

/**
 * Duplicate-detection key of one 835 payment. TRN02 (check / EFT trace) when present; otherwise a
 * hash of payer + payment amount + payment date + the CLP set (claim number, status, paid), so the
 * same remittance re-delivered under another file name is still recognized as a duplicate.
 */
export function remittanceKey(remit: {
  traceNumber: string;
  payerTraceId: string;
  payerId?: string;
  payerName?: string;
  paymentAmount: number;
  paymentDate: string | null;
  claims: Array<{ patientControlNumber: string; statusCode: string; paid: number; payerClaimControlNumber?: string }>;
}): { traceNumber: string; payerTraceId: string } {
  if (remit.traceNumber) return { traceNumber: remit.traceNumber.slice(0, 50), payerTraceId: remit.payerTraceId || '' };
  const clps = remit.claims
    .map((c) => `${c.patientControlNumber}:${c.statusCode}:${c.paid.toFixed(2)}:${c.payerClaimControlNumber || ''}`)
    .sort()
    .join(',');
  const basis = [remit.payerId || '', (remit.payerName || '').toUpperCase(), remit.paymentAmount.toFixed(2), remit.paymentDate || '', clps].join('|');
  return { traceNumber: `NOTRN-${createHash('sha256').update(basis).digest('hex').slice(0, 40)}`, payerTraceId: remit.payerTraceId || '' };
}

/** Medicare -> Medicaid crossover: CLP02 19 (processed as primary, forwarded) or remark MA18 / N522. */
export function crossoverSignal(era: Pick<EraClaim, 'statusCode' | 'claimRemarks' | 'lines'>): string | null {
  if (era.statusCode === '19') return 'CLP02 19: processed as primary, forwarded to the additional payer';
  const remarks = [...(era.claimRemarks || []), ...(era.lines || []).flatMap((l) => l.remarks || [])];
  if (remarks.includes('MA18')) return 'RARC MA18: claim forwarded to the supplemental insurer';
  if (remarks.includes('N522')) return 'RARC N522: duplicate of a claim processed / to be processed as a crossover claim';
  return null;
}

/**
 * Claim totals after posting one remittance: a later remittance on the same claim (a correction,
 * reversal or second payment) adds to what was already posted instead of replacing it.
 */
export function accumulatedTotals(
  previous: { paidAmount: number | null; adjustmentAmount: number | null; patientResponsibility: number | null } | null,
  posted: { paid: number; adjustmentTotal: number; patientResponsibility: number },
  previouslyPosted: boolean
) {
  const base = previouslyPosted && previous ? previous : { paidAmount: 0, adjustmentAmount: 0, patientResponsibility: 0 };
  const r = (n: number) => Math.round(n * 100) / 100;
  return {
    paidAmount: r((base.paidAmount ?? 0) + posted.paid),
    adjustmentAmount: r((base.adjustmentAmount ?? 0) + posted.adjustmentTotal),
    patientResponsibility: r((base.patientResponsibility ?? 0) + posted.patientResponsibility),
  };
}

/**
 * PLB provider-level adjustments as payment-batch lines so a batch reconciles to BPR02:
 * BPR02 = sum(CLP04) - sum(PLB amounts). A positive PLB (WO overpayment recovery, FB forward
 * balance) reduces the deposit; a negative one (L6 interest) increases it.
 */
export function plbBatchLines(adjustments: Array<{ reasonCode: string; reference?: string; amount: number }>) {
  return adjustments
    .filter((p) => Number.isFinite(p.amount) && p.amount !== 0)
    .map((p) => ({ label: `PLB ${p.reasonCode}${p.reference ? ` ${p.reference}` : ''}`.slice(0, 80), paidAmount: Math.round(-p.amount * 100) / 100 }));
}
