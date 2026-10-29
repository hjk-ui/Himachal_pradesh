/**
 * READ-ONLY check for card data stored by the retired AutoPay "Capture Card" form
 * (POST /api/billing/autopay/capture-card, 2026-10-14 .. 2026-10-17, now 410).
 *
 *   npx tsx scripts/find-card-data.ts [organizationId]
 *
 * Prints COUNTS ONLY: never a card number, token, last 4, expiry, ZIP, name or id.
 * Nothing is written or deleted; clean-up is a separate, approved step.
 *
 * What the form stored (git history of that route): CardOnFile.gatewayToken = "tok_demo_<ms>_<last4>"
 * (a made-up token, no processor), cardBrand, last4, expiry (MM/YY), billingZip, autopayEnabled,
 * validatedAt. The full card number and CVV were validated in memory and not written to any column
 * or audit entry. This script confirms that against the database and also scans the free-text /
 * JSON places a number could have landed (audit metadata, payment notes, charge failure reasons)
 * for any 13-19 digit sequence that passes the Luhn check.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH = 500;

function luhn(d: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = d.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

/** true when the text holds a 13-19 digit run (spaces / dashes allowed) that passes Luhn */
export function looksLikePan(text: string | null | undefined): boolean {
  if (!text) return false;
  const runs: string[] = text.match(/\d(?:[ -]?\d){12,18}/g) ?? [];
  return runs.some((r) => {
    const d = r.replace(/\D/g, '');
    return d.length >= 13 && d.length <= 19 && luhn(d);
  });
}

async function scan<T extends { id: string }>(
  fetch: (cursor: string | undefined) => Promise<T[]>,
  test: (row: T) => boolean,
): Promise<{ rows: number; hits: number }> {
  let cursor: string | undefined;
  let rows = 0;
  let hits = 0;
  for (;;) {
    const batch = await fetch(cursor);
    if (!batch.length) break;
    rows += batch.length;
    for (const r of batch) if (test(r)) hits += 1;
    cursor = batch[batch.length - 1].id;
    if (batch.length < BATCH) break;
  }
  return { rows, hits };
}

async function main() {
  const organizationId = process.argv[2] || undefined;
  const org = organizationId ? { organizationId } : {};
  const page = (cursor: string | undefined) => ({
    take: BATCH,
    orderBy: { id: 'asc' as const },
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
  });

  const cardsTotal = await prisma.cardOnFile.count({ where: org });
  const cardsDemoToken = await prisma.cardOnFile.count({ where: { ...org, gatewayToken: { startsWith: 'tok_demo_' } } });
  const cardsWithZip = await prisma.cardOnFile.count({ where: { ...org, NOT: { billingZip: '' } } });
  const cardsWithStripePm = await prisma.cardOnFile.count({ where: { ...org, gatewayPaymentMethodId: { not: null } } });
  const cardColumns = await scan(
    (c) =>
      prisma.cardOnFile.findMany({
        where: org,
        select: { id: true, gatewayToken: true, cardBrand: true, last4: true, expiry: true, billingZip: true, gatewayCustomerId: true, gatewayPaymentMethodId: true },
        ...page(c),
      }),
    (r) =>
      [r.gatewayToken, r.cardBrand, r.last4, r.expiry, r.billingZip, r.gatewayCustomerId, r.gatewayPaymentMethodId].some((v) => looksLikePan(v)) ||
      (r.last4 ?? '').replace(/\D/g, '').length > 4,
  );

  const audit = await scan(
    (c) => prisma.auditLog.findMany({ where: org, select: { id: true, metadata: true, resourceId: true }, ...page(c) }),
    (r) => looksLikePan(r.metadata == null ? null : JSON.stringify(r.metadata)) || looksLikePan(r.resourceId),
  );
  const cardAuditEntries = await prisma.auditLog.count({ where: { ...org, resourceType: 'cardOnFile' } });

  const payments = await scan(
    (c) => prisma.payment.findMany({ where: org, select: { id: true, note: true }, ...page(c) }),
    (r) => looksLikePan(r.note),
  );
  const charges = await scan(
    async (c) =>
      prisma.autoPayCharge.findMany({
        where: organizationId
          ? { cardOnFileId: { in: (await prisma.cardOnFile.findMany({ where: org, select: { id: true } })).map((x) => x.id) } }
          : {},
        select: { id: true, failureReason: true },
        ...page(c),
      }),
    (r) => looksLikePan(r.failureReason),
  );

  console.log('Card data check (counts only)', organizationId ? `org ${organizationId}` : 'all orgs');
  console.log(`CardOnFile rows: ${cardsTotal}`);
  console.log(`  with made-up tok_demo_ token (no processor): ${cardsDemoToken}`);
  console.log(`  with a billing ZIP stored: ${cardsWithZip}`);
  console.log(`  with a Stripe payment method id: ${cardsWithStripePm}`);
  console.log(`  rows where any column holds a card-number-like value or last4 > 4 digits: ${cardColumns.hits}`);
  console.log(`AuditLog rows scanned: ${audit.rows} (cardOnFile entries: ${cardAuditEntries}); with a card-number-like value: ${audit.hits}`);
  console.log(`Payment rows scanned: ${payments.rows}; notes with a card-number-like value: ${payments.hits}`);
  console.log(`AutoPayCharge rows scanned: ${charges.rows}; failure reasons with a card-number-like value: ${charges.hits}`);
  console.log('Server logs are not in the database: search CloudWatch / PM2 logs for "[api/billing/autopay/capture-card POST] error" (see the security report).');
}

main()
  .catch((err) => {
    console.error('find-card-data failed:', err instanceof Error ? err.name : 'unknown');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
