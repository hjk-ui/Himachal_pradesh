import { prisma } from '@/lib/db/prisma';
import { listReferrals } from '@/lib/medical/referrals';
import { listCloseLoopNotifies } from '@/lib/medical/close-loop';

export type InBasketTile = {
  id: string;
  label: string;
  count: number;
  href: string;
};

export type InBasketListItem = {
  id: string;
  kind: 'result' | 'close_loop' | 'overdue_lab' | 'referral_report';
  title: string;
  detail: string;
  priority?: 'critical' | 'abnormal' | 'normal';
  href?: string;
  clientId?: string;
  notified?: boolean;
};

/**
 * Provider in-basket — empty lists when sources have nothing (no invented queues).
 */
export async function buildProviderInBasket(organizationId: string): Promise<{
  tiles: InBasketTile[];
  results: InBasketListItem[];
  closeTheLoop: InBasketListItem[];
  overdueLabs: InBasketListItem[];
  referralsAwaiting: InBasketListItem[];
}> {
  // ProgressNoteWorkflow has no client relation — org-scope through ProgressNote.
  const unsignedNotes = await prisma.progressNote
    .count({
      where: {
        client: { organizationId },
        workflow: { status: 'DRAFT' },
      },
    })
    .catch(() => 0);

  let refills = 0;
  try {
    refills = await prisma.ehrRefillRequest.count({
      where: {
        status: 'Pending',
        client: { organizationId },
      },
    });
  } catch {
    refills = 0;
  }

  const tiles: InBasketTile[] = [
    {
      id: 'refills',
      label: 'Refill requests',
      count: refills,
      href: '/dashboard/ehr/prescriptions',
    },
    {
      id: 'rxchange',
      label: 'RxChange requests',
      count: 0,
      href: '/dashboard/ehr/prescriptions',
    },
    {
      id: 'prior_auths',
      label: 'Prior auths pending',
      count: 0,
      href: '/dashboard/ehr/prior-auth',
    },
    {
      id: 'unsigned',
      label: 'Unsigned visit notes',
      count: unsignedNotes,
      href: '/dashboard/ehr/notes',
    },
  ];

  const results: InBasketListItem[] = [];
  const closeTheLoop: InBasketListItem[] = [];
  const overdueLabs: InBasketListItem[] = [];
  const referralsAwaiting: InBasketListItem[] = [];

  const notifies = await listCloseLoopNotifies(organizationId).catch(() => []);
  const notifiedIds = new Set(notifies.map((n) => n.itemId));

  // Dedicated medical referrals awaiting report (not chart-items dump)
  const referrals = await listReferrals(organizationId).catch(() => []);
  for (const ref of referrals) {
    if (ref.internalBhWarmHandoff) continue; // no consult-report step
    if (ref.status === 'sent' || ref.status === 'scheduled' || ref.status === 'seen') {
      referralsAwaiting.push({
        id: ref.id,
        kind: 'referral_report',
        title: `${ref.clientName} · ${ref.specialty}`,
        detail: `Status ${ref.status}; report expected ${ref.expectedReportBy || 'none on file'} (${ref.expectedReportDays}d)`,
        clientId: ref.clientId,
        href: '/dashboard/medical',
      });
    }
  }

  // Optional: chart-item labs / close-loop still surface if present
  const modules = await prisma.clinicModuleState
    .findMany({
      where: {
        organizationId,
        module: { startsWith: 'chart-item:' },
      },
      take: 100,
      select: { module: true, data: true },
    })
    .catch(() => [] as Array<{ module: string; data: unknown }>);

  for (const row of modules) {
    const data = row.data as Record<string, unknown> | null;
    if (!data || typeof data !== 'object') continue;
    const kind = String(data.kind || '');
    const status = String(data.status || '');
    const title = String(data.title || data.label || kind);
    const clientId = typeof data.clientId === 'string' ? data.clientId : undefined;
    if (kind === 'standing-lab' || kind === 'order') {
      if (status === 'awaiting-review' || status === 'resulted') {
        const priority =
          status === 'resulted' && String(data.flag || '') === 'critical'
            ? 'critical'
            : status === 'resulted'
              ? 'abnormal'
              : 'normal';
        results.push({
          id: row.module,
          kind: 'result',
          title,
          detail: status,
          priority,
          href: '/dashboard/medical/labs',
          clientId,
        });
      }
      if (status === 'overdue') {
        overdueLabs.push({
          id: row.module,
          kind: 'overdue_lab',
          title,
          detail: 'Overdue lab order',
          href: '/dashboard/medical/labs',
          clientId,
        });
      }
    }
    if (kind === 'care-gap' && status === 'notify-patient') {
      closeTheLoop.push({
        id: row.module,
        kind: 'close_loop',
        title,
        detail: 'Notify patient (Phone / Portal message / Letter / In person)',
        href: '/dashboard/medical/preventive-care',
        clientId,
        notified: notifiedIds.has(row.module),
      });
    }
  }

  // Critical / abnormal first
  results.sort((a, b) => {
    const rank = (p?: string) => (p === 'critical' ? 0 : p === 'abnormal' ? 1 : 2);
    return rank(a.priority) - rank(b.priority);
  });

  return { tiles, results, closeTheLoop, overdueLabs, referralsAwaiting };
}
