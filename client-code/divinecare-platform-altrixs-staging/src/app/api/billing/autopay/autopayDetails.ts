import { prisma } from '@/lib/db/prisma';
import { clientOrgFilter } from '@/lib/clients/orgScope';

export type CardDetail = {
  mrn: string | null;
  card: { brand: string | null; last4: string | null; expiry: string | null; inStripe: boolean; testToken: boolean } | null;
  lastCharge: { status: string; at: string; failureReason: string | null } | null;
};

/** MRN and card on file (brand, last 4, expiry only; the gateway token never leaves the server) */
export async function autopayDetails(organizationId: string, clientIds: string[]): Promise<Map<string, CardDetail>> {
  const out = new Map<string, CardDetail>();
  if (clientIds.length === 0) return out;
  try {
    const rows = await prisma.client.findMany({
      where: { id: { in: clientIds }, AND: [clientOrgFilter(organizationId)] },
      select: {
        id: true,
        mrn: true,
        cardOnFile: {
          select: {
            cardBrand: true,
            last4: true,
            expiry: true,
            gatewayToken: true,
            gatewayPaymentMethodId: true,
            charges: { orderBy: { chargedAt: 'desc' }, take: 1, select: { status: true, chargedAt: true, failureReason: true } },
          },
        },
      },
    });
    for (const r of rows) {
      const c = r.cardOnFile;
      const last = c?.charges[0];
      out.set(r.id, {
        mrn: r.mrn,
        card: c
          ? {
              brand: c.cardBrand || null,
              last4: c.last4 || null,
              expiry: c.expiry || null,
              inStripe: /^pm_/.test(c.gatewayPaymentMethodId ?? ''),
              testToken: /^tok_demo_/.test(c.gatewayToken),
            }
          : null,
        lastCharge: last ? { status: last.status, at: last.chargedAt.toISOString(), failureReason: last.failureReason } : null,
      });
    }
  } catch (err) {
    console.error('[billing autopay GET] card details', err);
  }
  return out;
}

