import { z } from 'zod';
import { marketingGate, ok, serverError } from '@/lib/marketing/http';
import { deliveryStatus, getMarketingSettings, saveMarketingSettings } from '@/lib/marketing/settings';
import { AI_FEATURES, INTEGRATIONS } from '@/lib/marketing/constants';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';

export const runtime = 'nodejs';

const hm = z.string().regex(/^\d{2}:\d{2}$/);
const day = z.object({ open: hm, close: hm }).nullable();
const schema = z.object({
  timeZone: z.string().min(3).max(60).optional(),
  businessHours: z.object({ sun: day, mon: day, tue: day, wed: day, thu: day, fri: day, sat: day }).partial().optional(),
  quietHoursStart: hm.optional(),
  quietHoursEnd: hm.optional(),
  physicalAddress: z.string().trim().max(300).nullable().optional(),
  marketingAuthTemplateKey: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  testimonialAuthTemplateKey: z.string().trim().min(2).max(80).regex(/^[a-z0-9-]+$/).optional(),
  senderIdentities: z.array(z.object({ kind: z.enum(['email', 'sms']), label: z.string().trim().max(80), address: z.string().trim().max(200) })).max(10).optional(),
  brandVoice: z.string().trim().max(600).nullable().optional(),
  autoReplyEnabled: z.boolean().optional(),
  autoReplyText: z.string().trim().max(320).nullable().optional(),
  missedCallTextBack: z.boolean().optional(),
  missedCallText: z.string().trim().max(320).nullable().optional(),
  speedToLeadMinutes: z.number().int().min(1).max(1440).optional(),
  smallCellThreshold: z.number().int().min(1).max(50).optional(),
  aiFeatures: z.record(z.string(), z.boolean()).optional(),
  integrationNotes: z.record(z.string(), z.string().max(500)).optional(),
  publicFormsEnabled: z.boolean().optional(),
});

export async function GET() {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const settings = await getMarketingSettings(g.gate.organizationId);
    return ok({ settings, delivery: deliveryStatus(settings.integrationNotes), aiFeatures: AI_FEATURES, integrations: INTEGRATIONS });
  } catch (err) {
    return serverError('settings GET', err);
  }
}

export async function PUT(req: Request) {
  const g = await marketingGate('hub');
  if (!g.ok) return g.res;
  try {
    const body = schema.parse(await req.json());
    const settings = await saveMarketingSettings(g.gate.organizationId, g.gate.userId, body);
    await writeAuditLog({ action: 'MARKETING_SETTINGS_UPDATE', actorUserId: g.gate.userId, actorRole: g.gate.role, organizationId: g.gate.organizationId, resourceType: 'marketing_settings', metadata: { fields: Object.keys(body) } }).catch(() => {});
    return ok({ settings, delivery: deliveryStatus(settings.integrationNotes) });
  } catch (err) {
    return serverError('settings PUT', err);
  }
}
