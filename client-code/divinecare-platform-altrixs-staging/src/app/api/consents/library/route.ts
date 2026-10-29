import { z } from 'zod';
import { auditPhiAccess } from '@/lib/audit/requestMeta';
import { applyLifecycle, libraryView, saveLibrarySettings } from '@/lib/consents/library/store';
import { canApproveTemplates, TEMPLATE_APPROVER_ROLES } from '@/lib/consents/library/lifecycle';
import { autoRemindersEnabled, setAutoReminders } from '@/lib/consents/library/reminders';
import { consentGate, json } from './_gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/consents/library — every template version with status, flags, rendered text, packet settings. */
export async function GET(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  try {
    const [view, autoReminders] = await Promise.all([libraryView(g.gate.organizationId), autoRemindersEnabled(g.gate.organizationId)]);
    await auditPhiAccess({ gate: g.gate, req, action: 'READ', resourceType: 'consentLibrary', metadata: { versions: view.versions.length } });
    return json({ success: true, ...view, autoReminders, approverRoles: TEMPLATE_APPROVER_ROLES, canApprove: canApproveTemplates(g.gate.role) });
  } catch (err) {
    console.error('[consents/library GET]', err instanceof Error ? err.message : 'unknown');
    return json({ success: false, error: 'Could not load the consent library' }, 500);
  }
}

const lifecycleSchema = z.object({
  key: z.string().min(1).max(80),
  version: z.number().int().min(1).max(999),
  action: z.enum(['approve', 'activate', 'retire', 'return_to_draft']),
  note: z.string().trim().max(500).optional().nullable(),
});

/** POST — lifecycle change (approve / activate / retire / return to draft); admin + practice director only. */
export async function POST(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  const parsed = lifecycleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  const b = parsed.data;
  const r = await applyLifecycle(g.actor, b.key, b.version, b.action, b.note ?? null);
  await auditPhiAccess({
    gate: g.gate,
    req,
    action: 'UPDATE',
    resourceType: 'consentTemplate',
    resourceId: `${b.key}@${b.version}`,
    outcome: r.ok ? undefined : 'DENIED',
    metadata: { action: b.action, ...(r.ok === true ? { retiredVersion: r.retiredVersion } : { status: r.status }) },
  });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  return json({ success: true, retiredVersion: r.retiredVersion });
}

const settingsSchema = z.object({
  packetKeys: z.array(z.string().min(1).max(80)).max(80).optional(),
  nppUrl: z.string().trim().max(500).optional().nullable(),
  nppEffectiveDate: z.string().trim().max(40).optional().nullable(),
  /** Practice toggle "Automatic consent reminders" (scripts/consent-reminders.ts) */
  autoReminders: z.boolean().optional(),
});

/** PATCH — packet selection / order, the NPP link and automatic reminders (admin + practice director). */
export async function PATCH(req: Request) {
  const g = await consentGate();
  if (!g.ok) return g.res;
  if (!canApproveTemplates(g.gate.role)) return json({ success: false, error: 'Only an administrator or the practice director can change the consent packet.' }, 403);
  const parsed = settingsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ success: false, error: parsed.error.issues[0]?.message ?? 'Invalid request' }, 400);
  const { autoReminders, ...librarySettings } = parsed.data;
  if (autoReminders !== undefined) await setAutoReminders(g.gate.organizationId, autoReminders, g.gate.userId);
  const r = Object.keys(librarySettings).length ? await saveLibrarySettings(g.actor, librarySettings) : ({ ok: true } as const);
  await auditPhiAccess({ gate: g.gate, req, action: 'UPDATE', resourceType: 'consentLibrarySettings', metadata: { packetKeys: parsed.data.packetKeys?.length ?? null, nppLink: parsed.data.nppUrl !== undefined, autoReminders: autoReminders ?? null } });
  if (r.ok === false) return json({ success: false, error: r.error }, r.status);
  return json({ success: true });
}
