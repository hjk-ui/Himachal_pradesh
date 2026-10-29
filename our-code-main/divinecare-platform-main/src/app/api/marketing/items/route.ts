import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireOrgContext } from '@/lib/auth/tenant';
import { canAccessMarketing } from '@/lib/marketing/manage';
import {
  CAMPAIGN_TRANSITIONS,
  assertPartnerType,
  createMarketingItem,
  listMarketingItems,
  type CampaignStatus,
  type MarketingKind,
} from '@/lib/marketing/store';
import { getMarketingSettings } from '@/lib/marketing/manage';
import { SMS_OPT_OUT_FOOTER } from '@/lib/marketing/constants';

export const runtime = 'nodejs';

const KINDS = [
  'form',
  'workflow',
  'review',
  'testimonial',
  'campaign',
  'social',
  'press',
  'partner',
  'event',
  'spend',
] as const;

export async function GET(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const kind = new URL(req.url).searchParams.get('kind') as MarketingKind | null;
  if (!kind || !KINDS.includes(kind)) {
    return NextResponse.json({ success: false, error: 'Invalid kind' }, { status: 400 });
  }
  const items = await listMarketingItems(gate.organizationId, kind);
  return NextResponse.json({ success: true, items, smsFooter: SMS_OPT_OUT_FOOTER });
}

const createSchema = z.object({
  kind: z.enum(KINDS),
  data: z.record(z.string(), z.unknown()),
});

export async function POST(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }
  const { kind, data } = parsed.data;
  if (kind === 'partner' && data.partnerType) {
    data.partnerType = assertPartnerType(String(data.partnerType));
  }
  if (kind === 'campaign') {
    data.status = (data.status as string) || 'draft';
    data.channel = data.channel === 'Text' ? 'Text' : 'Email';
    data.trackingPixels = false;
    data.smsFooter = SMS_OPT_OUT_FOOTER;
  }
  if (kind === 'form') {
    data.live = Boolean(data.live);
    data.publicNotice =
      'Do not enter health details on this form. If you are in crisis, call or text 988.';
  }
  if (kind === 'social') {
    data.status = (data.status as string) || 'draft';
  }
  const item = await createMarketingItem(gate.organizationId, kind, data);
  return NextResponse.json({ success: true, item });
}

const patchSchema = z.object({
  kind: z.enum(KINDS),
  id: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
  transition: z.enum(['submit', 'approve', 'send_back', 'send']).optional(),
});

export async function PATCH(req: Request) {
  const gate = await requireOrgContext();
  if (gate.ok === false) {
    return NextResponse.json({ success: false, error: gate.error }, { status: gate.status });
  }
  if (!canAccessMarketing(gate.role)) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
  }
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Invalid payload' }, { status: 400 });
  }

  const { kind, id, patch, transition } = parsed.data;
  let nextPatch = { ...patch };

  if (kind === 'campaign' && transition) {
    const items = await listMarketingItems<{ id: string; status?: CampaignStatus; channel?: string }>(
      gate.organizationId,
      'campaign'
    );
    const current = items.find((i) => i.id === id);
    if (!current) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const status = (current.status || 'draft') as CampaignStatus;
    const map: Record<string, CampaignStatus> = {
      submit: 'review',
      approve: 'approved',
      send_back: 'send_back',
      send: 'sent',
    };
    const target = map[transition];
    if (!target || !CAMPAIGN_TRANSITIONS[status]?.includes(target)) {
      return NextResponse.json(
        { success: false, error: `Cannot ${transition} from ${status}` },
        { status: 400 }
      );
    }
    if (transition === 'send') {
      const settings = await getMarketingSettings(gate.organizationId);
      if (!settings.postalAddress.trim()) {
        return NextResponse.json(
          {
            success: false,
            error: 'Add the practice postal address (CAN-SPAM) before sending',
          },
          { status: 400 }
        );
      }
      nextPatch = {
        ...nextPatch,
        status: 'sent',
        sentAt: new Date().toISOString(),
        trackingPixels: false,
        smsFooter: SMS_OPT_OUT_FOOTER,
        testMode: true,
      };
    } else {
      nextPatch = { ...nextPatch, status: target };
    }
  }

  const { updateMarketingItem } = await import('@/lib/marketing/store');
  const result = await updateMarketingItem(gate.organizationId, kind, id, nextPatch);
  if (result.ok === false) {
    return NextResponse.json({ success: false, error: result.error }, { status: result.status });
  }
  return NextResponse.json({ success: true, item: result.item });
}
