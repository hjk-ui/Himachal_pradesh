/**
 * AutoPay page logic: status derivation, card expiry, tab filters and KPI math.
 * Browser-safe (no Prisma). Covered by tests/autopay-page.test.ts.
 */
import type { AutopayRecord } from '@/features/billing/ledgerApi';
import { autopayChargeCents } from '@/lib/billing/patientLedgerMath';
import { formatCents } from '@/lib/migration/valantReportCommon';
import { DEFAULT_PRACTICE_TIME_ZONE, practiceToday, toPracticeWallTime } from '@/lib/time/practiceTime';

/** Card on file in Altrixs. Only brand, last 4 and expiry ever reach the browser. */
export type AutopayCardInfo = {
  brand: string | null;
  last4: string | null;
  /** MM/YY as stored */
  expiry: string | null;
  /** Saved as a real Stripe PaymentMethod (pm_…) */
  inStripe: boolean;
  /** Placeholder token from the old in-app card form, not a real processor token */
  testToken: boolean;
};

export type AutopayLastCharge = { status: string; at: string; failureReason: string | null };

/** Row returned by GET /api/billing/autopay (ledger list + card / MRN details) */
export type AutopayRow = AutopayRecord & {
  mrn?: string | null;
  card?: AutopayCardInfo | null;
  lastCharge?: AutopayLastCharge | null;
};

export type AutopayStatus = 'active' | 'paused' | 'past_due' | 'ended' | 'needs_card';

export const STATUS_LABEL: Record<AutopayStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  past_due: 'Past due',
  ended: 'Ended',
  needs_card: 'Needs card',
};

export type CardExpiryState = 'ok' | 'expiring' | 'expired' | 'unknown';

/** "MM/YY" or "MM/YYYY" → { year, month } */
export function parseCardExpiry(raw: string | null | undefined): { year: number; month: number } | null {
  const m = String(raw ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return { year, month };
}

/** Display form MM/YY */
export function formatCardExpiry(raw: string | null | undefined): string | null {
  const p = parseCardExpiry(raw);
  return p ? `${String(p.month).padStart(2, '0')}/${String(p.year % 100).padStart(2, '0')}` : null;
}

/** A card is good through the last day of its expiry month; "expiring" = 30 days or less left. */
export function cardExpiryState(raw: string | null | undefined, today: string): CardExpiryState {
  const p = parseCardExpiry(raw);
  if (!p) return 'unknown';
  const [y, mo, d] = today.split('-').map(Number);
  const todayUtc = Date.UTC(y, mo - 1, d);
  const lastDayUtc = Date.UTC(p.year, p.month, 0); // day 0 of next month = last day of this month
  if (todayUtc > lastDayUtc) return 'expired';
  const daysLeft = Math.round((lastDayUtc - todayUtc) / 86_400_000);
  return daysLeft <= 30 ? 'expiring' : 'ok';
}

const PAST_DUE_RE = /past\s*due|overdue|delinquent/i;
const DECLINED_RE = /declin|fail|invalid|expired/i;

export type CardSummary = {
  where: 'altrixs' | 'valant' | null;
  brand: string | null;
  last4: string | null;
  expiry: string | null;
  expiryState: CardExpiryState;
};

/** The card shown for a row: the Altrixs card when one exists, else what Valant exported (not chargeable here). */
export function cardSummary(row: AutopayRow, today: string): CardSummary {
  if (row.card) {
    return {
      where: 'altrixs',
      brand: row.card.brand,
      last4: row.card.last4,
      expiry: formatCardExpiry(row.card.expiry),
      expiryState: cardExpiryState(row.card.expiry, today),
    };
  }
  const last4 = row.last4 ?? null;
  const expiry = row.plan?.cardExpiry ?? null;
  if (!last4 && !expiry && !row.plan?.cardLabel) {
    return { where: null, brand: null, last4: null, expiry: null, expiryState: 'unknown' };
  }
  return {
    where: row.plan?.source === 'valant' ? 'valant' : null,
    brand: null,
    last4,
    expiry: formatCardExpiry(expiry),
    expiryState: cardExpiryState(expiry, today),
  };
}

export type DerivedAutopay = {
  status: AutopayStatus;
  enrolled: boolean;
  ended: boolean;
  needsCard: boolean;
  pastDue: boolean;
  declined: boolean;
  /** Altrixs card expired (a Valant card has to be set up again anyway) */
  cardExpired: boolean;
  cardExpiring: boolean;
  needsAttention: boolean;
  fromValant: boolean;
  card: CardSummary;
};

export function deriveAutopay(row: AutopayRow, today: string): DerivedAutopay {
  const plan = row.plan;
  const enrolled = Boolean(row.enrollmentId);
  const endsKey = plan?.endsAt ? plan.endsAt.slice(0, 10) : null;
  const ended = Boolean(plan && (/ended|cancel/i.test(plan.planStatus ?? '') || (endsKey && endsKey < today)));
  const needsCard = !row.hasCardOnFile;
  const flag = plan?.statusFlag ?? '';
  const pastDue = PAST_DUE_RE.test(flag);
  const declined = (DECLINED_RE.test(flag) && !pastDue) || row.lastCharge?.status === 'failed';
  const card = cardSummary(row, today);
  const cardExpired = card.where === 'altrixs' && card.expiryState === 'expired';
  const cardExpiring = card.expiryState === 'expiring';

  let status: AutopayStatus;
  if (ended) status = 'ended';
  else if (!row.active) status = 'paused';
  else if (pastDue || declined) status = 'past_due';
  else if (needsCard) status = 'needs_card';
  else status = 'active';

  return {
    status,
    enrolled,
    ended,
    needsCard,
    pastDue,
    declined,
    cardExpired,
    cardExpiring,
    needsAttention: enrolled && !ended && (pastDue || declined || cardExpired),
    fromValant: plan?.source === 'valant',
    card,
  };
}

/**
 * What one charge would be: a plan charges its amount ("Balance or $X" = the lower of the two);
 * an Altrixs enrollment without a plan amount charges the balance due. Never negative.
 */
export function chargeAmountCents(row: AutopayRow): number {
  const balance = row.balanceCents ?? 0;
  if (row.plan?.amountCents != null) {
    return autopayChargeCents({ amountCents: row.plan.amountCents, upToBalance: row.plan.upToBalance }, balance, 0);
  }
  return Math.max(0, balance);
}

export type AutopayTab = 'all' | 'active' | 'attention' | 'paused_ended' | 'valant';

export const TAB_LABEL: Record<AutopayTab, string> = {
  all: 'All',
  active: 'Active',
  attention: 'Needs attention',
  paused_ended: 'Paused / ended',
  valant: 'Imported from Valant',
};

export function inTab(tab: AutopayTab, row: AutopayRow, d: DerivedAutopay): boolean {
  if (!d.enrolled) return false;
  switch (tab) {
    case 'all':
      return true;
    case 'active':
      return row.active && !d.ended;
    case 'attention':
      return d.needsAttention;
    case 'paused_ended':
      return d.status === 'paused' || d.status === 'ended';
    case 'valant':
      return d.fromValant && d.needsCard;
  }
}

export type AutopayKpis = {
  active: number;
  activeNeedCard: number;
  next7Count: number;
  next7Cents: number;
  attention: number;
  withBalance: number;
  withBalanceCents: number;
};

/** Practice-clock date (YYYY-MM-DD) of an ISO instant */
export function practiceDateKey(iso: string, timeZone: string): string {
  return toPracticeWallTime(iso, timeZone).date;
}

function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** KPIs over enrolled rows only. Next 7 days = active plans whose next date is today..today+6 (practice clock). */
export function computeKpis(rows: AutopayRow[], today: string, timeZone: string = DEFAULT_PRACTICE_TIME_ZONE): AutopayKpis {
  const last = addDays(today, 6);
  const k: AutopayKpis = { active: 0, activeNeedCard: 0, next7Count: 0, next7Cents: 0, attention: 0, withBalance: 0, withBalanceCents: 0 };
  for (const row of rows) {
    const d = deriveAutopay(row, today);
    if (!d.enrolled) continue;
    const live = row.active && !d.ended;
    if (live) {
      k.active += 1;
      if (d.needsCard) k.activeNeedCard += 1;
      const next = row.plan?.nextChargeAt ? practiceDateKey(row.plan.nextChargeAt, timeZone) : null;
      if (next && next >= today && next <= last) {
        k.next7Count += 1;
        k.next7Cents += chargeAmountCents(row);
      }
    }
    if (d.needsAttention) k.attention += 1;
    if (!d.ended && (row.balanceCents ?? 0) > 0) {
      k.withBalance += 1;
      k.withBalanceCents += row.balanceCents ?? 0;
    }
  }
  return k;
}

export function todayFor(timeZone: string = DEFAULT_PRACTICE_TIME_ZONE, now = new Date()): string {
  return practiceToday(timeZone, now);
}

/** "$1,234.56"; a negative ledger balance is a credit: "Credit $12.00" */
export function formatBalance(cents: number | null | undefined): string {
  if (cents == null) return '—';
  if (cents < 0) return `Credit ${formatCents(-cents)}`;
  return formatCents(cents);
}

/** "$75.00" or "Balance, up to $75.00"; Altrixs enrollments without a plan amount charge the balance due */
export function planAmountLabel(row: AutopayRow): string {
  const p = row.plan;
  if (p?.amountCents != null) return p.upToBalance ? `Balance, up to ${formatCents(p.amountCents)}` : formatCents(p.amountCents);
  if (p?.amountLabel) return p.amountLabel;
  return 'Balance due';
}

export function planFrequencyLabel(row: AutopayRow): string {
  return row.plan?.recurrence?.trim() || (row.plan?.source === 'valant' ? '—' : 'After each session');
}

export function sourceLabel(row: AutopayRow): 'Valant' | 'Altrixs' {
  return row.plan?.source === 'valant' ? 'Valant' : 'Altrixs';
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  // Neutralize spreadsheet formulas, then quote
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const AUTOPAY_CSV_HEADER = [
  'Client', 'MRN', 'Source', 'Status', 'Plan amount', 'Frequency', 'Next charge (practice date)', 'Next charge amount',
  'Ends', 'Card', 'Card exp', 'Card location', 'Ledger balance', 'Valant flag',
];

export function buildAutopayCsv(rows: AutopayRow[], timeZone: string = DEFAULT_PRACTICE_TIME_ZONE, now = new Date()): string {
  const today = todayFor(timeZone, now);
  const lines = [AUTOPAY_CSV_HEADER.map(csvCell).join(',')];
  for (const row of rows) {
    const d = deriveAutopay(row, today);
    if (!d.enrolled) continue;
    const next = row.plan?.nextChargeAt ? practiceDateKey(row.plan.nextChargeAt, timeZone) : '';
    const ends = row.plan?.endsAt ? practiceDateKey(row.plan.endsAt, timeZone) : '';
    lines.push(
      [
        row.clientName,
        row.mrn ?? '',
        sourceLabel(row),
        STATUS_LABEL[d.status],
        planAmountLabel(row),
        planFrequencyLabel(row),
        next,
        next ? formatCents(chargeAmountCents(row)) : '',
        ends,
        d.card.last4 ? `${d.card.brand ?? 'Card'} ending ${d.card.last4}` : '',
        d.card.expiry ?? '',
        d.card.where === 'altrixs' ? 'Altrixs' : d.card.where === 'valant' ? 'Valant (not transferred)' : '',
        formatBalance(row.balanceCents),
        row.plan?.statusFlag ?? '',
      ].map(csvCell).join(',')
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}
