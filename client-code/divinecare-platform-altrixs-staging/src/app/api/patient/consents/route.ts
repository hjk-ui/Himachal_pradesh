import { z } from 'zod';
import { patientFail, patientGet, patientOk, patientOptions, patientPost, readPatientJson } from '@/patient/infrastructure/http/handler';
import { writeAuditLog } from '@/lib/audit/writeAuditLog';
import { auditRequestMeta } from '@/lib/audit/requestMeta';
import { logPatientAudit } from '@/patient/infrastructure/persistence/audit';
import { patientRevocableConsents, revokeConsent } from '@/lib/consents/library/store2';
import { practiceToday } from '@/lib/time/practiceTime';
import { getPracticeTimeZone } from '@/lib/time/practiceTimeServer';
import { filterForProxy, looksPart2 } from '@/patient/application/proxy/visibility';
import { proxyAuditFields } from '@/patient/infrastructure/persistence/audit';
import type { PatientContext } from '@/patient/domain';

/** Proxy: Part 2 consents stay with the client (42 CFR §2.14); confidential items are hidden. */
async function visibleConsents(ctx: PatientContext) {
  const all = await patientRevocableConsents({ clientId: ctx.clientId, organizationId: ctx.organizationId });
  return filterForProxy(ctx, 'consent_form', all, (c) => ({ id: c.id, part2: looksPart2(c.title), category: 'administrative' }));
}

export function OPTIONS() { return patientOptions(); }

/** GET /api/patient/consents — the patient's signed consents they can revoke. */
export const GET = patientGet(async ({ req, ctx }) => {
  const consents = await visibleConsents(ctx);
  await writeAuditLog({ action: 'LIST', actorUserId: ctx.accountId, actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT', organizationId: ctx.organizationId, resourceType: 'consent', patientId: ctx.clientId, outcome: 'SUCCESS', ...auditRequestMeta(req), metadata: { portal: 'patient-web', purpose: 'revocable_consents', count: consents.length } });
  return patientOk({ consents });
}, ['patient-consents', 60]);

const bodySchema = z.object({
  consentId: z.string().min(1).max(128),
  channels: z.array(z.enum(['sms', 'email', 'voicemail'])).max(3).optional(),
  note: z.string().trim().max(500).optional().nullable(),
  confirm: z.literal(true),
});

/** POST /api/patient/consents — the patient revokes a consent in writing through the portal (effective now). */
export const POST = patientPost(async ({ req, ctx }) => {
  const body = bodySchema.parse(await readPatientJson(req));
  if (ctx.access?.isProxy && !(await visibleConsents(ctx)).some((c) => c.id === body.consentId)) {
    return patientFail('NOT_FOUND', 'Consent not found', 404);
  }
  const today = practiceToday(await getPracticeTimeZone(ctx.organizationId));
  const r = await revokeConsent({ organizationId: ctx.organizationId, userId: null, role: 'PATIENT', clientId: ctx.clientId }, body.consentId, {
    receivedOn: today,
    method: 'written',
    receivedVia: 'portal',
    note: body.note ?? null,
    channels: body.channels,
  });
  await writeAuditLog({
    action: 'UPDATE',
    actorUserId: ctx.accountId,
    actorRole: ctx.access?.isProxy ? 'PATIENT_PROXY' : 'PATIENT',
    organizationId: ctx.organizationId,
    resourceType: 'consentRevocation',
    resourceId: body.consentId,
    patientId: ctx.clientId,
    outcome: r.ok ? 'SUCCESS' : 'FAILURE',
    ...auditRequestMeta(req),
    metadata: { portal: 'patient-web', ...(r.ok === true ? { effects: r.effects, partial: r.partial } : { status: r.status }) },
  });
  if (r.ok === false) return patientFail(r.status === 404 ? 'NOT_FOUND' : 'VALIDATION_ERROR', r.error, r.status);
  await logPatientAudit({ clientId: ctx.clientId, accountId: ctx.accountId, action: 'CONSENT_REVOKED', entityType: 'consent', entityId: body.consentId, ...proxyAuditFields(ctx) });
  return patientOk({ revoked: true, effects: r.effects });
}, ['patient-consent-revoke', 10]);
