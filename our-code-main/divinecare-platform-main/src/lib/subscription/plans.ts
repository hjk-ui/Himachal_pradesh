import 'server-only';

import { prisma } from '@/lib/db/prisma';
import { getModuleData, saveModuleData } from '@/lib/modules/manage';
import { stripeConfigured } from '@/lib/stripe/config';
import {
  SUBSCRIPTION_PLANS,
  normalizePlanId,
  type BillingCycle,
  type SubscriptionPlanId,
} from './catalog';

export { SUBSCRIPTION_PLANS, formatLimit, normalizePlanId } from './catalog';
export type { BillingCycle, SubscriptionPlanId } from './catalog';

export type SubscriptionState = {
  plan: SubscriptionPlanId;
  billingCycle: BillingCycle;
  updatedAt: string;
  stripePortalConfigured?: boolean;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  stripeStatus?: string | null;
};

export async function getSubscriptionState(organizationId: string): Promise<SubscriptionState> {
  const current = await getModuleData<Partial<SubscriptionState> & { plan?: string }>(
    organizationId,
    'subscription-state'
  );
  const plan = normalizePlanId(current?.plan);
  const billingCycle = current?.billingCycle === 'annual' ? 'annual' : 'monthly';
  return {
    plan,
    billingCycle,
    updatedAt: current?.updatedAt || new Date().toISOString(),
    stripePortalConfigured: stripeConfigured(),
    stripeCustomerId: current?.stripeCustomerId || null,
    stripeSubscriptionId: current?.stripeSubscriptionId || null,
    stripeStatus: current?.stripeStatus || null,
  };
}

export async function saveSubscriptionState(
  organizationId: string,
  input: Pick<SubscriptionState, 'plan' | 'billingCycle'> &
    Partial<Pick<SubscriptionState, 'stripeCustomerId' | 'stripeSubscriptionId' | 'stripeStatus'>>
) {
  const current = await getModuleData<Partial<SubscriptionState>>(organizationId, 'subscription-state');
  const state: SubscriptionState = {
    plan: input.plan,
    billingCycle: input.billingCycle,
    updatedAt: new Date().toISOString(),
    stripePortalConfigured: stripeConfigured(),
    stripeCustomerId:
      input.stripeCustomerId !== undefined ? input.stripeCustomerId : current?.stripeCustomerId || null,
    stripeSubscriptionId:
      input.stripeSubscriptionId !== undefined
        ? input.stripeSubscriptionId
        : current?.stripeSubscriptionId || null,
    stripeStatus: input.stripeStatus !== undefined ? input.stripeStatus : current?.stripeStatus || null,
  };
  await saveModuleData(organizationId, 'subscription-state', state);
  return state;
}

export async function getSubscriptionUsage(organizationId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [activeClients, notesThisMonth, aiNotes, invoices, panels, staffCount] = await Promise.all([
    prisma.client.count({
      where: {
        status: 'ACTIVE',
        OR: [{ location: { organizationId } }, { assignedTo: { organizationId } }],
      },
    }),
    prisma.progressNote.count({
      where: {
        createdAt: { gte: monthStart },
        clinician: { organizationId },
      },
    }),
    prisma.progressNote.count({
      where: {
        createdAt: { gte: monthStart },
        clinician: { organizationId },
        body: { contains: 'AI', mode: 'insensitive' },
      },
    }).then(async (noteCount) => {
      const history = (await getModuleData<any[]>(organizationId, 'ai-session-history')) || [];
      const historyCount = history.filter((item) => {
        const stamp = item?.generatedAt || item?.createdAt;
        if (!stamp) return false;
        const date = new Date(stamp);
        return !Number.isNaN(date.getTime()) && date >= monthStart;
      }).length;
      return Math.max(noteCount, historyCount);
    }),
    getModuleData<any[]>(organizationId, 'invoices').then((items) =>
      (items || []).filter((item) => {
        const stamp = item?.createdAt || item?.sentAt;
        if (!stamp) return false;
        const date = new Date(stamp);
        return !Number.isNaN(date.getTime()) && date >= monthStart;
      }).length
    ),
    getModuleData<any[]>(organizationId, 'payer-panels').then((items) => (items || []).length),
    prisma.user.count({ where: { organizationId, role: { not: 'SUPER_ADMIN' }, status: 'ACTIVE' } }),
  ]);

  return {
    activeClients,
    notesThisMonth,
    aiNotesThisMonth: aiNotes,
    invoicesThisMonth: invoices,
    insurancePanels: panels,
    staffCount,
  };
}

export async function assertActiveClientLimit(organizationId: string) {
  const state = await getSubscriptionState(organizationId);
  const plan = SUBSCRIPTION_PLANS[state.plan];
  if (!Number.isFinite(plan.activeClientLimit)) return { ok: true as const };
  const usage = await getSubscriptionUsage(organizationId);
  if (usage.activeClients >= plan.activeClientLimit) {
    return {
      ok: false as const,
      error: `${plan.name} plan allows up to ${plan.activeClientLimit} active clients. Upgrade to add more active clients.`,
    };
  }
  return { ok: true as const };
}

export async function canUsePlanModule(organizationId: string, module: string) {
  const state = await getSubscriptionState(organizationId);
  const plan = SUBSCRIPTION_PLANS[state.plan];
  const usage = await getSubscriptionUsage(organizationId);

  if (module === 'autopay-clients' || module === 'autopay-charges') {
    return plan.autopay ? { ok: true as const } : { ok: false as const, error: 'AutoPay is not included on the Free plan.' };
  }
  if (module === 'payer-panels' && Number.isFinite(plan.insurancePanelLimit) && usage.insurancePanels >= plan.insurancePanelLimit) {
    return { ok: false as const, error: `${plan.name} plan insurance panel limit reached.` };
  }
  if (module.includes('outcome') || module === 'mbc-outcomes') {
    return plan.outcomeMeasures ? { ok: true as const } : { ok: false as const, error: 'Outcome Measures are not included on the Free plan.' };
  }
  if ((module === 'ai-session-notes' || module === 'ai-session-history') && Number.isFinite(plan.aiNotesLimit) && usage.aiNotesThisMonth >= plan.aiNotesLimit) {
    return { ok: false as const, error: `${plan.name} plan AI Session Notes limit reached.` };
  }
  if (module === 'invoices' && Number.isFinite(plan.invoiceLimit) && usage.invoicesThisMonth >= plan.invoiceLimit) {
    return { ok: false as const, error: `${plan.name} plan invoice limit reached.` };
  }
  return { ok: true as const };
}
