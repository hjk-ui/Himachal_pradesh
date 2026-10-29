import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildAutopayCsv,
  cardExpiryState,
  chargeAmountCents,
  computeKpis,
  deriveAutopay,
  formatBalance,
  inTab,
  type AutopayRow,
} from '../src/components/billing/autopay/autopayLogic';

const TZ = 'America/New_York';
const TODAY = '2026-10-18';

type Plan = NonNullable<AutopayRow['plan']>;

function plan(p: Partial<Plan> = {}): Plan {
  return {
    source: 'valant',
    planStatus: 'Active',
    statusFlag: null,
    amountCents: 7500,
    upToBalance: false,
    amountLabel: '$75.00',
    recurrence: 'Monthly',
    nextChargeAt: null,
    endsAt: null,
    cardLabel: null,
    cardExpiry: null,
    sourceBalanceCents: null,
    sourceAsOf: null,
    ...p,
  };
}

function row(r: Partial<AutopayRow> = {}): AutopayRow {
  return {
    clientId: 'c1',
    clientName: 'Test Client',
    active: true,
    last4: '4242',
    enrollmentId: 'e1',
    hasCardOnFile: true,
    balanceCents: 0,
    plan: null,
    mrn: 'MRN-1',
    card: { brand: 'Visa', last4: '4242', expiry: '12/28', inStripe: true, testToken: false },
    lastCharge: null,
    ...r,
  };
}

test('card expiry: good through the last day of the month, expiring within 30 days', () => {
  assert.equal(cardExpiryState('09/26', TODAY), 'expired');
  assert.equal(cardExpiryState('10/26', TODAY), 'expiring');
  assert.equal(cardExpiryState('11/2026', TODAY), 'ok'); // Nov 30 is 43 days out
  assert.equal(cardExpiryState('12/26', TODAY), 'ok');
  assert.equal(cardExpiryState('bad', TODAY), 'unknown');
});

test('status: active, paused, needs card, past due, declined, ended', () => {
  assert.equal(deriveAutopay(row(), TODAY).status, 'active');
  assert.equal(deriveAutopay(row({ active: false }), TODAY).status, 'paused');

  const imported = deriveAutopay(row({ hasCardOnFile: false, card: null, plan: plan({ cardExpiry: '01/2027' }) }), TODAY);
  assert.equal(imported.status, 'needs_card');
  assert.equal(imported.card.where, 'valant');
  assert.equal(imported.needsAttention, false);

  const pastDue = deriveAutopay(row({ plan: plan({ statusFlag: 'Past Due' }) }), TODAY);
  assert.equal(pastDue.status, 'past_due');
  assert.ok(pastDue.pastDue && pastDue.needsAttention);

  const declined = deriveAutopay(row({ lastCharge: { status: 'failed', at: '2026-10-01T12:00:00Z', failureReason: 'card_declined' } }), TODAY);
  assert.equal(declined.status, 'past_due');
  assert.ok(declined.declined && declined.needsAttention);

  assert.equal(deriveAutopay(row({ plan: plan({ planStatus: 'Ended' }) }), TODAY).status, 'ended');
  assert.equal(deriveAutopay(row({ plan: plan({ endsAt: '2026-10-01T12:00:00.000Z' }) }), TODAY).status, 'ended');
});

test('expired Altrixs card needs attention; an expired Valant-only card does not (it must be set up again anyway)', () => {
  const expired = deriveAutopay(row({ card: { brand: 'Visa', last4: '1111', expiry: '08/26', inStripe: true, testToken: false } }), TODAY);
  assert.ok(expired.cardExpired && expired.needsAttention);
  assert.equal(expired.status, 'active');

  const valantExpired = deriveAutopay(row({ hasCardOnFile: false, card: null, plan: plan({ cardExpiry: '08/2026' }) }), TODAY);
  assert.equal(valantExpired.card.expiryState, 'expired');
  assert.equal(valantExpired.needsAttention, false);
  assert.ok(inTab('valant', row({ hasCardOnFile: false, card: null, plan: plan() }), valantExpired));
});

test('charge amount: plan amount, "balance or $X" takes the lower, no plan charges the balance', () => {
  assert.equal(chargeAmountCents(row({ plan: plan({ amountCents: 7500 }), balanceCents: 1000 })), 7500);
  assert.equal(chargeAmountCents(row({ plan: plan({ amountCents: 7500, upToBalance: true }), balanceCents: 1000 })), 1000);
  assert.equal(chargeAmountCents(row({ plan: plan({ amountCents: 7500, upToBalance: true }), balanceCents: -500 })), 0);
  assert.equal(chargeAmountCents(row({ balanceCents: 4200 })), 4200);
  assert.equal(chargeAmountCents(row({ balanceCents: null })), 0);
});

test('KPIs count enrolled rows only and use real amounts', () => {
  const rows: AutopayRow[] = [
    // active, charge in 3 days, balance 120.00
    row({ clientId: 'a', plan: plan({ nextChargeAt: '2026-10-21T12:00:00.000Z' }), balanceCents: 12000 }),
    // active, needs card, "balance or $75" with $40 balance, charge today
    row({ clientId: 'b', hasCardOnFile: false, card: null, plan: plan({ upToBalance: true, nextChargeAt: '2026-10-18T12:00:00.000Z' }), balanceCents: 4000 }),
    // active, charge in 8 days: outside the window; past due
    row({ clientId: 'c', plan: plan({ statusFlag: 'Past due', nextChargeAt: '2026-10-26T12:00:00.000Z' }) }),
    // paused, with balance
    row({ clientId: 'd', active: false, balanceCents: 500 }),
    // ended: ignored for balance and active
    row({ clientId: 'e', plan: plan({ planStatus: 'Ended', nextChargeAt: '2026-10-19T12:00:00.000Z' }), balanceCents: 9999 }),
    // not enrolled (candidate): ignored entirely
    row({ clientId: 'f', enrollmentId: null, active: false, balanceCents: 7777 }),
    // credit balance is not "balance due"
    row({ clientId: 'g', balanceCents: -2500 }),
  ];
  const k = computeKpis(rows, TODAY, TZ);
  assert.equal(k.active, 4); // a, b, c, g
  assert.equal(k.activeNeedCard, 1);
  assert.equal(k.next7Count, 2);
  assert.equal(k.next7Cents, 7500 + 4000);
  assert.equal(k.attention, 1);
  assert.equal(k.withBalance, 3); // a, b, d
  assert.equal(k.withBalanceCents, 12000 + 4000 + 500);
});

test('balance format and CSV export (enrolled only, card last 4 only, formula-safe)', () => {
  assert.equal(formatBalance(123456), '$1,234.56');
  assert.equal(formatBalance(-1200), 'Credit $12.00');
  assert.equal(formatBalance(null), '—');

  const csv = buildAutopayCsv(
    [
      row({ clientName: '=HYPERLINK("x")', plan: plan({ nextChargeAt: '2026-10-21T12:00:00.000Z' }), balanceCents: 12000 }),
      row({ clientId: 'z', enrollmentId: null }),
    ],
    TZ,
    new Date('2026-10-18T15:00:00Z')
  );
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].startsWith(`"'=HYPERLINK(""x"")"`));
  assert.ok(lines[1].includes('Visa ending 4242'));
  assert.ok(lines[1].includes('2026-10-21'));
  assert.ok(lines[1].includes('$120.00'));
});
