import { getModuleData, saveModuleData } from '@/lib/modules/manage';

export const STANDING_ORDERS_MODULE = 'primary-care-standing-orders';

export const STANDING_ORDER_ATTESTATION =
  'I authorize medical assistants to perform this test under this standing order';

export type StandingOrderStatus = 'draft' | 'approved' | 'retired';

export type StandingOrder = {
  id: string;
  name: string;
  cpt: string;
  status: StandingOrderStatus;
  attestation: string;
  approvedAt?: string | null;
  approvedById?: string | null;
  updatedAt: string;
};

/** Six POC tests — all start draft; unusable until Medical Director approves. */
export const STANDING_ORDER_SEED: Omit<StandingOrder, 'updatedAt'>[] = [
  {
    id: 'poc-glucose',
    name: 'Fingerstick glucose',
    cpt: '82962',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
  {
    id: 'poc-ua-dip',
    name: 'Urine dipstick',
    cpt: '81002',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
  {
    id: 'poc-strep',
    name: 'Rapid strep',
    cpt: '87880',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
  {
    id: 'poc-hcg',
    name: 'Urine pregnancy',
    cpt: '81025',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
  {
    id: 'poc-covid',
    name: 'COVID antigen',
    cpt: '87811',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
  {
    id: 'poc-flu',
    name: 'Rapid influenza',
    cpt: '87804',
    status: 'draft',
    attestation: STANDING_ORDER_ATTESTATION,
    approvedAt: null,
    approvedById: null,
  },
];

function withTimestamps(rows: Omit<StandingOrder, 'updatedAt'>[]): StandingOrder[] {
  const now = new Date().toISOString();
  return rows.map((r) => ({ ...r, updatedAt: now }));
}

export async function listStandingOrders(organizationId: string): Promise<StandingOrder[]> {
  const stored = await getModuleData<StandingOrder[]>(organizationId, STANDING_ORDERS_MODULE);
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    const seeded = withTimestamps(STANDING_ORDER_SEED);
    await saveModuleData(organizationId, STANDING_ORDERS_MODULE, seeded);
    return seeded;
  }
  return stored;
}

export async function updateStandingOrderStatus(
  organizationId: string,
  orderId: string,
  status: StandingOrderStatus,
  actorUserId: string
): Promise<{ ok: true; orders: StandingOrder[] } | { ok: false; error: string }> {
  const orders = await listStandingOrders(organizationId);
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return { ok: false, error: 'Standing order not found' };
  const now = new Date().toISOString();
  const current = orders[idx];
  if (status === 'approved') {
    orders[idx] = {
      ...current,
      status: 'approved',
      approvedAt: now,
      approvedById: actorUserId,
      updatedAt: now,
    };
  } else if (status === 'retired') {
    orders[idx] = { ...current, status: 'retired', updatedAt: now };
  } else {
    // editing approved content → back to draft
    orders[idx] = {
      ...current,
      status: 'draft',
      approvedAt: null,
      approvedById: null,
      updatedAt: now,
    };
  }
  await saveModuleData(organizationId, STANDING_ORDERS_MODULE, orders);
  return { ok: true, orders };
}

export function approvedStandingOrdersOnly(orders: StandingOrder[]) {
  return orders.filter((o) => o.status === 'approved');
}
