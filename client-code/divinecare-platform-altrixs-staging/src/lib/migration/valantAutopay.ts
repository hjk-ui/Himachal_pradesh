/**
 * Valant "Payment Plans" grid (Billing > Patient Balances, exported as Excel or CSV).
 * Columns: Status, Patient ID, Balance, Unapplied Credit, Prepayment, Plan Credit Card,
 * Plan Exp. Date, Plan, Amount, Recurrence, Next Date, End Date.
 *
 * Valant keeps the card itself with its processor; only the cardholder label and last 4 are exported,
 * so an imported plan cannot be charged until the card is captured again in Altrixs.
 */

export type ValantAutopayPlan = {
  sourcePatientId: string;
  planStatus: 'Active' | 'Paused';
  statusFlag: string | null;
  amountCents: number | null;
  /** "Balance or $75.00": charge the balance when it is lower than the amount */
  upToBalance: boolean;
  amountLabel: string;
  recurrence: string | null;
  nextChargeAt: Date | null;
  endsAt: Date | null;
  cardLabel: string | null;
  last4: string | null;
  cardExpiry: string | null;
  balanceCents: number | null;
  unappliedCreditCents: number | null;
  prepaymentCents: number | null;
};

export type ValantAutopayParse =
  | { kind: 'plan'; plan: ValantAutopayPlan }
  | { kind: 'skip'; reason: 'no-plan' | 'ended' | 'footer' }
  | { kind: 'error'; error: string };

const key = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, '');

function get(row: Record<string, string>, ...names: string[]) {
  const wanted = new Set(names.map(key));
  for (const [k, v] of Object.entries(row)) if (wanted.has(key(k))) return String(v ?? '').trim();
  return '';
}

/** "$512.98", "($15.00)", "1,200.00" -> cents; parentheses are negative */
export function moneyToCents(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  const n = Number(s.replace(/[()$,\s-]/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) * (neg ? -1 : 1);
}

/** M/D/YYYY -> noon UTC that day (date only, no timezone drift) */
function usDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), 12));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseValantAutopayRow(row: Record<string, string>): ValantAutopayParse {
  const id = get(row, 'Patient ID', 'Pt. ID').toUpperCase();
  const statusCell = get(row, 'Status');
  if (!id) {
    return /^count:/i.test(statusCell) ? { kind: 'skip', reason: 'footer' } : { kind: 'error', error: 'Patient ID is missing' };
  }
  const plan = get(row, 'Plan');
  if (!plan) return { kind: 'skip', reason: 'no-plan' };
  if (/^ended$/i.test(plan)) return { kind: 'skip', reason: 'ended' };
  if (!/^(active|paused)$/i.test(plan)) return { kind: 'error', error: `Patient ${id}: unknown plan status "${plan}"` };

  const amountLabel = get(row, 'Amount');
  const upToBalance = /^balance\s+or\b/i.test(amountLabel);
  const amountCents = moneyToCents(amountLabel.replace(/^balance\s+or\s*/i, ''));
  if (amountCents === null || amountCents <= 0) {
    return { kind: 'error', error: `Patient ${id}: plan amount "${amountLabel}" is not a dollar amount` };
  }

  const card = get(row, 'Plan Credit Card');
  const last4 = card.match(/(\d{4})\s*$/)?.[1] ?? null;
  const exp = get(row, 'Plan Exp. Date', 'Plan Exp Date').match(/^(\d{1,2})\/(\d{4})$/);
  const end = get(row, 'End Date');

  return {
    kind: 'plan',
    plan: {
      sourcePatientId: id,
      planStatus: /^active$/i.test(plan) ? 'Active' : 'Paused',
      statusFlag: statusCell || null,
      amountCents,
      upToBalance,
      amountLabel,
      recurrence: get(row, 'Recurrence') || null,
      nextChargeAt: usDate(get(row, 'Next Date')),
      endsAt: /^never$/i.test(end) ? null : usDate(end),
      cardLabel: card || null,
      last4,
      cardExpiry: exp ? `${exp[1].padStart(2, '0')}/${exp[2]}` : null,
      balanceCents: moneyToCents(get(row, 'Balance')),
      unappliedCreditCents: moneyToCents(get(row, 'Unapplied Credit')),
      prepaymentCents: moneyToCents(get(row, 'Prepayment')),
    },
  };
}
