import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auditHr, hrGate, hrJsonError, hrServerError, loadHrSettings, saveHrSettings } from '@/lib/hr/server';
import { HR_AI_FEATURES, MD_LICENSE_TYPES, isHrLeadershipRole } from '@/lib/hr/standard';
import { isBedrockConfigured } from '@/lib/ai/bedrockService';

export const runtime = 'nodejs';

/** GET /api/hr/settings: HR policy settings (HR, leadership, Office Manager read). */
export async function GET() {
  const g = await hrGate('credentialing');
  if (g.ok === false) return g.response;
  try {
    const settings = await loadHrSettings(g.ctx.organizationId);
    return NextResponse.json({
      success: true,
      settings,
      canEdit: g.ctx.role !== 'OFFICE_MANAGER',
      canEditLeadershipSettings: isHrLeadershipRole(g.ctx.role),
      aiFeatures: HR_AI_FEATURES,
      bedrockConfigured: isBedrockConfigured(),
      licenseTypes: MD_LICENSE_TYPES,
    });
  } catch (err) {
    return hrServerError('settings', err);
  }
}

const num = (max: number) => z.number().min(0).max(max).nullable().optional();
const putSchema = z.object({
  blockSchedulingWhenLicenseExpired: z.boolean().optional(),
  dueSoonDays: z.number().int().min(7).max(365).optional(),
  urgentDays: z.number().int().min(1).max(180).optional(),
  caqhAttestationDays: z.number().int().min(30).max(365).optional(),
  exclusionCheckIntervalDays: z.number().int().min(7).max(365).optional(),
  sickAccrualHoursWorked: num(1000),
  sickAnnualAccrualCap: num(2000),
  sickBalanceCap: num(2000),
  sickAnnualUsageCap: num(2000),
  ptoPolicy: z.object({ hoursPerPeriod: num(200), periodsPerYear: num(366), balanceCap: num(2000) }).nullable().optional(),
  ceuRequirements: z.record(z.string().max(20), z.object({ hours: num(500), cycleMonths: num(120) })).optional(),
  immunizationPolicy: z
    .object({ fluRoles: z.array(z.string().max(40)).optional(), hepBRoles: z.array(z.string().max(40)).optional(), tbRoles: z.array(z.string().max(40)).optional(), tbIntervalMonths: num(120) })
    .optional(),
  cprRequiredRoles: z.array(z.string().max(40)).max(20).optional(),
  i9StoreDocumentImages: z.boolean().optional(),
  aiDocumentExtract: z.boolean().optional(),
  aiWritingDrafts: z.boolean().optional(),
  aiReviewAssistant: z.boolean().optional(),
  aiPolicyQa: z.boolean().optional(),
  aiDigest: z.boolean().optional(),
  confirmPolicy: z.boolean().optional(),
});

const LEADERSHIP_ONLY = ['blockSchedulingWhenLicenseExpired', 'aiDocumentExtract', 'aiWritingDrafts', 'aiReviewAssistant', 'aiPolicyQa', 'aiDigest', 'i9StoreDocumentImages', 'confirmPolicy'] as const;

/** PUT: HR edits policy settings; scheduling block, AI features, I-9 images and confirmation are leadership-only. */
export async function PUT(req: Request) {
  const g = await hrGate('admin');
  if (g.ok === false) return g.response;
  let body: z.infer<typeof putSchema>;
  try {
    body = putSchema.parse(await req.json());
  } catch {
    return hrJsonError('Check the settings', 400);
  }
  if (!isHrLeadershipRole(g.ctx.role) && LEADERSHIP_ONLY.some((k) => body[k] !== undefined)) {
    return hrJsonError('Leadership approves scheduling blocks, AI features, I-9 storage and policy confirmation', 403);
  }
  try {
    const settings = await saveHrSettings(g.ctx.organizationId, g.ctx.userId, body);
    await auditHr(g.ctx, req, 'UPDATE', 'hrSettings', g.ctx.organizationId, { fields: Object.keys(body) });
    return NextResponse.json({ success: true, settings });
  } catch (err) {
    return hrServerError('settings save', err);
  }
}
